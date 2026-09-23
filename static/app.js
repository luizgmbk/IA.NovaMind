const $=s=>document.querySelector(s);
const messagesEl=$("#messages"), input=$("#input"), form=$("#composer"), send=$("#send");
let state={messages:[],streaming:false,status:null};
const storageKey="novamind_chats_v1";
let chats=JSON.parse(localStorage.getItem(storageKey)||"[]");
let activeId=localStorage.getItem("novamind_active")||null;
let access=localStorage.getItem("novamind_access")||"";

function save(){localStorage.setItem(storageKey,JSON.stringify(chats)); if(activeId)localStorage.setItem("novamind_active",activeId)}
function current(){return chats.find(c=>c.id===activeId)}
function newChat(){
  const c={id:crypto.randomUUID(),title:"Novo chat",messages:[],created:Date.now()};
  chats.unshift(c);activeId=c.id;save();renderList();renderMessages();
}
function renderList(){
  $("#chatList").innerHTML="";
  for(const c of chats){
    const d=document.createElement("div");d.className="chat-item"+(c.id===activeId?" active":"");
    d.textContent=c.title;d.onclick=()=>{activeId=c.id;save();renderList();renderMessages()};$("#chatList").appendChild(d)
  }
}
function escapeHtml(s){return s.replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
function renderMessages(){
  const c=current();
  if(!c||!c.messages.length){
    messagesEl.innerHTML=`<div class="welcome"><div class="hero-logo">N</div><h2>Como posso ajudar?</h2><p>Converse, estude, programe, pesquise e crie.</p><div class="chips"><button data-prompt="Me ensine algo novo de um jeito fácil de entender.">Me ensine algo</button><button data-prompt="Me ajude a criar um projeto do zero.">Criar projeto</button><button data-prompt="Explique um assunto difícil passo a passo.">Explicar</button><button data-prompt="Me ajude com programação.">Programar</button></div></div>`;
    bindChips(); return;
  }
  messagesEl.innerHTML="";
  c.messages.forEach(m=>appendMessage(m.role,m.content,false));
  messagesEl.scrollTop=messagesEl.scrollHeight;
}
function appendMessage(role,content,scroll=true){
  const row=document.createElement("div");row.className="msg "+role;
  if(role==="assistant"){const a=document.createElement("div");a.className="avatar";a.textContent="N";row.appendChild(a)}
  const b=document.createElement("div");b.className="bubble";b.textContent=content;row.appendChild(b);messagesEl.appendChild(row);
  if(scroll)messagesEl.scrollTop=messagesEl.scrollHeight;return b;
}
function bindChips(){document.querySelectorAll("[data-prompt]").forEach(b=>b.onclick=()=>{input.value=b.dataset.prompt;input.focus()})}
async function loadStatus(){
  try{
    const r=await fetch("/api/status");state.status=await r.json();
    $("#serverState").textContent=state.status.ai_configured?"IA online":"Site online";
    $("#configNotice").classList.toggle("hidden",state.status.ai_configured);
    if(state.status.protected&&!access) $("#accessDialog").showModal();
    $("#webToggle").disabled=!state.status.web_configured;
  }catch{$("#serverState").textContent="Servidor indisponível"}
}
async function sendMessage(text){
  if(!text.trim()||state.streaming)return;
  if(!current())newChat();const c=current();
  c.messages.push({role:"user",content:text.trim()});
  if(c.messages.length===1)c.title=text.trim().slice(0,44);
  save();renderList();renderMessages();state.streaming=true;send.disabled=true;
  c.messages.push({role:"assistant",content:""});save();
  const bubble=appendMessage("assistant","");
  try{
    const r=await fetch("/api/chat",{method:"POST",headers:{"Content-Type":"application/json","X-Access-Code":access},body:JSON.stringify({messages:c.messages.slice(0,-1),mode:$("#mode").value,web:$("#webToggle").checked})});
    if(r.status===401){localStorage.removeItem("novamind_access");access="";$("#accessDialog").showModal();throw new Error("Código de acesso inválido.")}
    if(!r.ok){let e={};try{e=await r.json()}catch{}throw new Error(e.detail||"Erro no servidor.")}
    const reader=r.body.getReader(),decoder=new TextDecoder();let buf="";
    while(true){const {value,done}=await reader.read();if(done)break;buf+=decoder.decode(value,{stream:true});const parts=buf.split("\n");buf=parts.pop();
      for(const line of parts){if(!line.trim())continue;try{const x=JSON.parse(line);if(x.type==="delta"){c.messages[c.messages.length-1].content+=x.text;bubble.textContent=c.messages[c.messages.length-1].content;messagesEl.scrollTop=messagesEl.scrollHeight}else if(x.type==="error")throw new Error(x.message)}catch(e){if(e.message)bubble.textContent=e.message}}
    }
  }catch(e){c.messages[c.messages.length-1].content="⚠️ "+e.message;bubble.textContent=c.messages[c.messages.length-1].content}
  finally{state.streaming=false;send.disabled=false;save()}
}
form.addEventListener("submit",e=>{e.preventDefault();const t=input.value;input.value="";input.style.height="auto";sendMessage(t)});
input.addEventListener("input",()=>{input.style.height="auto";input.style.height=Math.min(input.scrollHeight,180)+"px"});
input.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});
$("#newChat").onclick=newChat;$("#themeBtn").onclick=()=>{document.body.classList.toggle("light");localStorage.setItem("nm_theme",document.body.classList.contains("light")?"light":"dark")};
$("#accessForm").addEventListener("submit",()=>{access=$("#accessInput").value.trim();localStorage.setItem("novamind_access",access)});
if(localStorage.getItem("nm_theme")==="light")document.body.classList.add("light");
if(!activeId||!chats.some(c=>c.id===activeId))newChat();else{renderList();renderMessages()}bindChips();loadStatus();
