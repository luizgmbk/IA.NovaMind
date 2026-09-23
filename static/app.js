const $=s=>document.querySelector(s);
const messagesEl=$("#messages"), input=$("#input"), form=$("#composer"), send=$("#send"), stopBtn=$("#stop");
const storageKey="novamind_chats_v2";
let chats=JSON.parse(localStorage.getItem(storageKey)||"[]");
let activeId=localStorage.getItem("novamind_active")||null;
let access=localStorage.getItem("novamind_access")||"";
let state={streaming:false,status:null,controller:null,attachments:[]};

function save(){localStorage.setItem(storageKey,JSON.stringify(chats));if(activeId)localStorage.setItem("novamind_active",activeId)}
function current(){return chats.find(c=>c.id===activeId)}
function newChat(){const c={id:crypto.randomUUID(),title:"Novo chat",messages:[],created:Date.now()};chats.unshift(c);activeId=c.id;state.attachments=[];save();renderList();renderMessages();renderAttachments()}
function deleteChat(id){chats=chats.filter(c=>c.id!==id);if(activeId===id)activeId=chats[0]?.id||null;if(!activeId)newChat();save();renderList();renderMessages()}
function renderList(){
  $("#chatList").innerHTML="";
  for(const c of chats){
    const d=document.createElement("div");d.className="chat-item"+(c.id===activeId?" active":"");
    const t=document.createElement("span");t.className="title";t.textContent=c.title;
    const x=document.createElement("button");x.className="del";x.textContent="×";x.title="Excluir";x.onclick=e=>{e.stopPropagation();deleteChat(c.id)};
    d.append(t,x);d.onclick=()=>{activeId=c.id;state.attachments=[];save();renderList();renderMessages();renderAttachments();$("#sidebar").classList.remove("open")};$("#chatList").appendChild(d)
  }
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function formatAssistant(text){
  const parts=String(text).split(/\`\`\`/);
  return parts.map((p,i)=>{
    if(i%2){const lines=p.replace(/^\w+\n/,"");return "<pre><code>"+esc(lines)+"</code></pre>"}
    return esc(p).replace(/\n\n/g,"</p><p>").replace(/\n/g,"<br>").replace(/^/,"<p>").replace(/$/,"</p>")
  }).join("")
}
function renderMessages(){
  const c=current();
  if(!c||!c.messages.length){
    messagesEl.innerHTML='<div class="welcome"><div class="hero-logo">N</div><h2>Como posso ajudar?</h2><p>Converse, pesquise na web, execute Python e analise arquivos ou imagens.</p><div class="chips"><button data-prompt="Me ensine algo novo de um jeito fácil de entender.">Me ensine algo</button><button data-prompt="Pesquise as novidades mais recentes sobre inteligência artificial.">Pesquisar</button><button data-prompt="Me ajude a criar um projeto do zero.">Criar projeto</button><button data-prompt="Me ajude com programação.">Programar</button></div></div>';
    bindChips();return
  }
  messagesEl.innerHTML="";
  c.messages.forEach(m=>appendMessage(m.role,m.content,false));
  messagesEl.scrollTop=messagesEl.scrollHeight
}
function appendMessage(role,content,scroll=true){
  const wrap=document.createElement("div");
  const row=document.createElement("div");row.className="msg "+role;
  if(role==="assistant"){const a=document.createElement("div");a.className="avatar";a.textContent="N";row.appendChild(a)}
  const b=document.createElement("div");b.className="bubble";
  if(role==="assistant")b.innerHTML=formatAssistant(content);else b.textContent=content;
  row.appendChild(b);wrap.appendChild(row);
  if(role==="assistant"&&content){const cp=document.createElement("button");cp.className="copy";cp.textContent="Copiar";cp.onclick=async()=>{await navigator.clipboard.writeText(content);cp.textContent="Copiado";setTimeout(()=>cp.textContent="Copiar",1200)};wrap.appendChild(cp)}
  messagesEl.appendChild(wrap);if(scroll)messagesEl.scrollTop=messagesEl.scrollHeight;return b
}
function bindChips(){document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>{input.value=b.dataset.prompt;input.focus()})}
function renderAttachments(){
  const box=$("#attachments");box.innerHTML="";box.classList.toggle("hidden",!state.attachments.length);
  state.attachments.forEach(a=>{const d=document.createElement("div");d.className="file-chip";d.innerHTML="<span>"+(a.kind==="image"?"🖼":"📄")+"</span><span>"+esc(a.name)+"</span>";const x=document.createElement("button");x.textContent="×";x.onclick=async()=>{state.attachments=state.attachments.filter(v=>v.id!==a.id);renderAttachments();try{await fetch("/api/upload/"+a.id,{method:"DELETE",headers:{"X-Access-Code":access}})}catch{}};d.appendChild(x);box.appendChild(d)})
}
async function loadStatus(){
  try{
    const r=await fetch("/api/status",{cache:"no-store"});state.status=await r.json();
    $("#serverState").textContent=state.status.ai_configured?"IA online":"Site online — falta chave";
    $("#configNotice").classList.toggle("hidden",state.status.ai_configured);
    $("#webToggle").disabled=!state.status.web_configured;
    $("#codeToggle").disabled=!state.status.code_configured;
    if(state.status.protected&&!access)$("#accessDialog").showModal()
  }catch{$("#serverState").textContent="Servidor indisponível"}
}
async function uploadFiles(files){
  for(const file of [...files].slice(0,6-state.attachments.length)){
    const fd=new FormData();fd.append("file",file);
    try{
      $("#serverState").textContent="Enviando "+file.name+"…";
      const r=await fetch("/api/upload",{method:"POST",headers:{"X-Access-Code":access},body:fd});
      const data=await r.json();if(!r.ok)throw new Error(data.detail||"Falha no upload");
      state.attachments.push(data);renderAttachments()
    }catch(e){alert(e.message)}
  }
  loadStatus()
}
async function sendMessage(text){
  if(!text.trim()||state.streaming)return;
  if(!current())newChat();const c=current();
  const userText=text.trim()+(state.attachments.length?"\n\n[Anexos: "+state.attachments.map(a=>a.name).join(", ")+"]":"");
  c.messages.push({role:"user",content:userText});
  if(c.messages.length===1)c.title=text.trim().slice(0,44);
  save();renderList();renderMessages();state.streaming=true;send.disabled=true;stopBtn.classList.remove("hidden");state.controller=new AbortController();
  c.messages.push({role:"assistant",content:""});save();
  const bubble=appendMessage("assistant","");
  try{
    const payload={messages:c.messages.slice(0,-1).map(m=>({role:m.role,content:m.content})),mode:$("#mode").value,web:$("#webToggle").checked,code:$("#codeToggle").checked,attachment_ids:state.attachments.map(a=>a.id)};
    const r=await fetch("/api/chat",{method:"POST",signal:state.controller.signal,headers:{"Content-Type":"application/json","X-Access-Code":access},body:JSON.stringify(payload)});
    if(r.status===401){localStorage.removeItem("novamind_access");access="";$("#accessDialog").showModal();throw new Error("Código de acesso inválido.")}
    if(!r.ok){let e={};try{e=await r.json()}catch{}throw new Error(e.detail||"Erro no servidor.")}
    const reader=r.body.getReader(),decoder=new TextDecoder();let buf="";
    while(true){const {value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const parts=buf.split("\n");buf=parts.pop();
      for(const line of parts){if(!line.trim())continue;const x=JSON.parse(line);if(x.type==="delta"){c.messages[c.messages.length-1].content+=x.text;bubble.innerHTML=formatAssistant(c.messages[c.messages.length-1].content);messagesEl.scrollTop=messagesEl.scrollHeight}else if(x.type==="error")throw new Error(x.message)}
    }
  }catch(e){
    if(e.name==="AbortError"){c.messages[c.messages.length-1].content+="\n[Resposta interrompida]";bubble.innerHTML=formatAssistant(c.messages[c.messages.length-1].content)}
    else{c.messages[c.messages.length-1].content="⚠️ "+e.message;bubble.textContent=c.messages[c.messages.length-1].content}
  }finally{state.streaming=false;send.disabled=false;stopBtn.classList.add("hidden");state.controller=null;save();loadStatus()}
}
form.addEventListener("submit",e=>{e.preventDefault();const t=input.value;input.value="";input.style.height="auto";sendMessage(t)});
input.addEventListener("input",()=>{input.style.height="auto";input.style.height=Math.min(input.scrollHeight,180)+"px"});
input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
$("#fileInput").addEventListener("change",e=>{uploadFiles(e.target.files);e.target.value=""});
$("#newChat").onclick=newChat;$("#stop").onclick=()=>state.controller?.abort();$("#menuBtn").onclick=()=>$("#sidebar").classList.toggle("open");
$("#themeBtn").onclick=()=>{document.body.classList.toggle("light");localStorage.setItem("nm_theme",document.body.classList.contains("light")?"light":"dark")};
$("#accessForm").addEventListener("submit",()=>{access=$("#accessInput").value.trim();localStorage.setItem("novamind_access",access);loadStatus()});
if(localStorage.getItem("nm_theme")==="light")document.body.classList.add("light");
if(!activeId||!chats.some(c=>c.id===activeId))newChat();else{renderList();renderMessages()}
renderAttachments();bindChips();loadStatus();setInterval(loadStatus,30000);
