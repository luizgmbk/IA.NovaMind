import os, json, hmac
from pathlib import Path
from typing import Any
import httpx
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app = FastAPI(title="NovaMind AI", version="4.1")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

AI_BASE_URL = os.getenv("AI_BASE_URL", "").rstrip("/")
AI_CHAT_URL = os.getenv("AI_CHAT_URL", "").strip()
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()
AI_MODEL = os.getenv("AI_MODEL", "").strip()
ACCESS_CODE = os.getenv("ACCESS_CODE", "").strip()
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "").strip()

class Message(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[Message] = Field(min_length=1, max_length=80)
    mode: str = "auto"
    web: bool = False

def authorize(code: str | None):
    if ACCESS_CODE and (not code or not hmac.compare_digest(code, ACCESS_CODE)):
        raise HTTPException(status_code=401, detail="Código de acesso inválido.")

def provider_url() -> str:
    if AI_CHAT_URL:
        return AI_CHAT_URL
    if AI_BASE_URL:
        return AI_BASE_URL + "/chat/completions"
    return ""

async def web_context(query: str) -> str:
    if not TAVILY_API_KEY:
        return ""
    payload = {
        "api_key": TAVILY_API_KEY,
        "query": query,
        "search_depth": "advanced",
        "max_results": 5,
        "include_answer": False,
    }
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.post("https://api.tavily.com/search", json=payload)
        r.raise_for_status()
        data = r.json()
    items = []
    for i, item in enumerate(data.get("results", []), 1):
        title = item.get("title", "Fonte")
        url = item.get("url", "")
        content = item.get("content", "")
        items.append(f"[S{i}] {title}\n{url}\n{content[:1800]}")
    return "\n\n".join(items)

@app.get("/")
async def root():
    return FileResponse(STATIC_DIR / "index.html")

@app.get("/healthz")
async def healthz():
    return {"ok": True}

@app.get("/api/status")
async def status():
    return {
        "online": True,
        "ai_configured": bool(provider_url() and AI_API_KEY and AI_MODEL),
        "web_configured": bool(TAVILY_API_KEY),
        "protected": bool(ACCESS_CODE),
        "model": AI_MODEL if AI_MODEL else None,
    }

@app.post("/api/chat")
async def chat(req: ChatRequest, x_access_code: str | None = Header(default=None)):
    authorize(x_access_code)
    url = provider_url()
    if not (url and AI_API_KEY and AI_MODEL):
        raise HTTPException(
            status_code=503,
            detail="O site está online, mas o provedor de IA ainda não foi configurado no servidor."
        )

    messages: list[dict[str, Any]] = [m.model_dump() for m in req.messages]
    if req.web:
        query = next((m.content for m in reversed(req.messages) if m.role == "user"), "")
        if query:
            try:
                context = await web_context(query)
            except Exception:
                context = ""
            if context:
                messages.insert(0, {
                    "role": "system",
                    "content": "Use as fontes abaixo quando forem relevantes. Cite [S1], [S2] etc. Não invente fontes.\n\n" + context,
                })

    mode_hint = {
        "fast": "Responda de forma objetiva e eficiente.",
        "deep": "Analise com cuidado, verifique inconsistências e explique etapas verificáveis quando ajudarem.",
        "auto": "Adapte a profundidade à dificuldade da tarefa.",
    }.get(req.mode, "Adapte a profundidade à dificuldade da tarefa.")
    messages.insert(0, {
        "role": "system",
        "content": "Você é NovaMind, um assistente útil, claro e cuidadoso. " + mode_hint
    })

    payload = {
        "model": AI_MODEL,
        "messages": messages,
        "stream": True,
    }
    headers = {
        "Authorization": f"Bearer {AI_API_KEY}",
        "Content-Type": "application/json",
    }

    async def generate():
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=20.0)) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as r:
                    if r.status_code >= 400:
                        body = await r.aread()
                        yield json.dumps({"type":"error","message":f"Provedor respondeu HTTP {r.status_code}."}) + "\n"
                        return
                    async for line in r.aiter_lines():
                        if not line or not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                            delta = obj.get("choices", [{}])[0].get("delta", {}).get("content")
                            if delta:
                                yield json.dumps({"type":"delta","text":delta}, ensure_ascii=False) + "\n"
                        except Exception:
                            continue
            yield json.dumps({"type":"done"}) + "\n"
        except Exception as exc:
            yield json.dumps({"type":"error","message":"Falha ao conectar ao provedor de IA."}) + "\n"

    return StreamingResponse(generate(), media_type="application/x-ndjson")
