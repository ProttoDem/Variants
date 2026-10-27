const socket = io();
const app = document.querySelector("#app");
const connection = document.querySelector("#connection");
const toastEl = document.querySelector("#toast");
let role = null, roomState = null, myId = null, myToken = null, hostToken = null;
let roomCode = null, submitted = false, voted = false, selectedOption = null, currentPage = "home";
const defaults = [
  { prompt: "Чому в середньовічній Європі деякі люди боялися чорних котів?", correct: "Їх пов'язували з чаклунством і відьмами", trap: "Вважалося, що вони крадуть людські сни" },
  { prompt: "Який несподіваний предмет NASA колись використовувала для тренування астронавтів?", correct: "Спеціальні окуляри, що перевертали зображення догори дриґом", trap: "Гумову курку для імітації невагомості" },
  { prompt: "Навіщо фламінго стоять на одній нозі?", correct: "Так вони зменшують втрату тепла", trap: "Щоб друга нога відпочивала після танців" }
];
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function toast(message){toastEl.textContent=message;toastEl.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>toastEl.classList.remove("show"),3000);}
function emit(name,data={}){socket.emit(name,data);}
function playerTokenKey(code){return `varianty_player_${code}`;}
function hostTokenKey(code){return `varianty_host_${code}`;}
socket.on("connect",()=>{connection.classList.add("online");connection.innerHTML="<span></span> На зв'язку";});
socket.on("disconnect",()=>{connection.classList.remove("online");connection.innerHTML="<span></span> Перепідключення…";});
socket.on("toast",d=>toast(d.message));
socket.on("room-created",d=>{roomCode=d.code;hostToken=d.hostToken;localStorage.setItem(hostTokenKey(roomCode),hostToken);role="host";currentPage="game";render();});
socket.on("host-rejoined",()=>{role="host";currentPage="game";});
socket.on("joined-room",d=>{roomCode=d.code;myId=d.playerId;myToken=d.playerToken;localStorage.setItem(playerTokenKey(roomCode),myToken);role="player";submitted=false;voted=false;selectedOption=null;currentPage="game";render();});
socket.on("player-rejoined",d=>{roomCode=d.code;myId=d.playerId;myToken=d.playerToken;role="player";currentPage="game";});
socket.on("state",state=>{if(roomCode && state.code!==roomCode)return;roomState=state;render();});
socket.on("submission-saved",()=>{submitted=true;toast("Брехню збережено 🤫");render();});
socket.on("vote-saved",()=>{voted=true;toast("Голос зараховано!");render();});
socket.on("game-ended",d=>{currentPage="ended";roomState=null;renderLeaderboard(d.leaderboard);});

function home(){
 currentPage="home";role=null;roomCode=null;
 app.innerHTML=`<section class="panel hero"><div class="eyebrow">✦ гра для вашої команди ✦</div><h1>Правда — це<br><span>лише один</span><br>із варіантів.</h1><p class="subtitle">Вигадай переконливу брехню, вгадай правду та не попадись на пастку ведучої.</p><div class="form-grid"><div class="field"><label>ТВОЄ ІМ'Я</label><input id="homeName" maxlength="24" placeholder="Наприклад, Яна" /></div><button class="btn full" id="createBtn">✦ Створити гру (для ведучої)</button><div class="separator">АБО ПРИЄДНАТИСЯ</div><div class="two-col"><div class="field"><label>КОД КІМНАТИ</label><input id="joinCode" inputmode="numeric" maxlength="6" placeholder="123456" /></div><div class="field"><label>ІМ'Я ГРАВЦЯ</label><input id="joinName" maxlength="24" placeholder="Твоє ім'я" /></div></div><button class="btn purple full" id="joinBtn">Увійти в кімнату →</button><p class="note">Без реєстрації. Працює у браузері на комп'ютері та телефоні.</p></div></section><div class="footer-note">HALLOWEEN EDITION · Бреши красиво, голосуй мудро</div>`;
 document.querySelector("#createBtn").onclick=()=>{
   const name=document.querySelector("#homeName").value.trim();
   emit("create-room",{hostName:name||"Ведуча",questions:[]});
 };
 document.querySelector("#joinBtn").onclick=()=>{
   const code=document.querySelector("#joinCode").value.trim(),name=document.querySelector("#joinName").value.trim();
   if(code.length!==6)return toast("Введи 6-значний код кімнати.");
   if(!name)return toast("Введи своє ім'я.");
   roomCode=code;emit("join-room",{code,name,playerToken:localStorage.getItem(playerTokenKey(code))||null});
 };
}
function sidebar(){
 const players=roomState?.players||[];
 return `<aside class="stack"><section class="panel"><div class="card-head"><div><div class="eyebrow">КОД КІМНАТИ</div><div class="big-code">${esc(roomCode||roomState?.code||"------")}</div></div><button class="btn secondary" id="copyLink">Копіювати код</button></div><p class="note">Надішли колегам посилання на цей сайт і код кімнати. Вони зайдуть зі своїх телефонів.</p></section><section class="panel"><div class="card-head"><h3 class="section-title">Гравці</h3><span class="tag">${players.length} учасн.</span></div><div class="player-list">${players.length?players.map(p=>`<div class="player"><div class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</div><span class="name">${esc(p.name)}</span><span class="score">${p.score} б.</span><span class="status-dot" title="${p.connected?"Онлайн":"Не в мережі"}" style="background:${p.connected?"var(--green)":"#766b85"}"></span></div>`).join(""):'<p class="note">Поки нікого немає. Запроси команду!</p>'}</div></section></aside>`;
}
function hostPanel(){
 const phase=roomState?.phase||"lobby";
 if(phase==="lobby"){
   return `<section class="panel"><div class="eyebrow">ПАНЕЛЬ ВЕДУЧОЇ</div><h2 class="section-title" style="margin-top:12px">Підготуй раунд</h2><p class="note">Введи запитання, правду та власну пастку. Гравці побачать лише запитання.</p><form id="roundForm" class="stack" style="margin-top:20px"><div class="field"><label>ЗАПИТАННЯ</label><textarea id="prompt" required maxlength="500" placeholder="Наприклад: Чому фламінго стоять на одній нозі?"></textarea></div><div class="field"><label>ПРАВИЛЬНА ВІДПОВІДЬ</label><textarea id="correct" required maxlength="500" placeholder="Справжня відповідь"></textarea></div><div class="field"><label>ПАСТКА ВЕДУЧОЇ (−1 бал)</label><textarea id="trap" required maxlength="500" placeholder="Переконлива, але неправильна відповідь"></textarea></div><div class="btn-row"><button type="button" class="btn secondary" id="fillExample">Вставити приклад</button><button class="btn" type="submit">Почати раунд →</button></div></form><p class="note" style="margin-top:16px">Порада: найкраще працюють дивні факти, у яких правда звучить майже неймовірно.</p></section>`;
 }
 if(phase==="writing"){
   const count=roomState.current?.submissionsCount||0,total=roomState.players.length;
   return `<section class="panel"><div class="eyebrow">РАУНД ${roomState.questionNumber}</div><h2 class="section-title" style="margin-top:12px">Учасники вигадують брехню</h2><p class="question">${esc(roomState.current.prompt)}</p><div class="stat"><strong>${count} / ${total}</strong><span>відповідей надіслано</span></div><div class="round-progress" style="margin:14px 0 18px"><div style="width:${total?Math.min(100,count/total*100):0}%"></div></div><div class="notice">Коли всі готові (або час вийшов), запускай голосування. Відповіді перемішаються разом із правдою та твоєю пасткою.</div><button class="btn full" style="margin-top:18px" id="startVoting">Закрити збір і почати голосування →</button></section>`;
 }
 if(phase==="voting"){
   const count=roomState.current?.votesCount||0,total=roomState.players.length;
   return `<section class="panel"><div class="eyebrow">РАУНД ${roomState.questionNumber}</div><h2 class="section-title" style="margin-top:12px">Голосування триває</h2><p class="question">${esc(roomState.current.prompt)}</p><div class="stat"><strong>${count} / ${total}</strong><span>голосів отримано</span></div><div class="round-progress" style="margin:14px 0 18px"><div style="width:${total?Math.min(100,count/total*100):0}%"></div></div><div class="notice">Гравці бачать однаковий набір варіантів. Правильна відповідь і пастка приховані до розкриття.</div><button class="btn full" style="margin-top:18px" id="reveal">Закрити голосування й розкрити відповіді</button></section>`;
 }
 if(phase==="results")return resultsPanel();
 return "";
}
function resultsPanel(){
 const c=roomState.current,results=c?.results;
 if(!results)return "";
 const sorted=[...results.optionAuthors].sort((a,b)=>b.voteCount-a.voteCount);
 return `<section class="panel"><div class="eyebrow">РАУНД ${roomState.questionNumber} · РОЗКРИТТЯ</div><h2 class="section-title" style="margin:12px 0 8px">Хто кого перехитрив?</h2><p class="muted" style="line-height:1.6">${esc(c.prompt)}</p><div class="stack" style="margin-top:18px">${sorted.map((o,i)=>`<div class="result-row ${o.kind==="correct"?"correct":o.kind==="trap"?"trap":"lie"}"><div class="rank">${String.fromCharCode(65+i)}</div><div class="result-text">${esc(o.text)}<span class="kind">${o.kind==="correct"?"✓ Правильна відповідь":o.kind==="trap"?"⚠ Пастка ведучої":`Брехня: ${esc(o.authorName||"гравець")}`}</span></div><div class="points">${o.voteCount} ${o.voteCount===1?"голос":"голосів"}</div></div>`).join("")}</div><div class="notice" style="margin-top:16px">За правду: +1. За пастку ведучої: −1. Автор брехні отримує +1 за кожен голос за його варіант.</div><h3 class="section-title" style="margin-top:22px">Таблиця лідерів</h3>${leaderboardHTML(roomState.players)}<div class="btn-row" style="margin-top:18px"><button class="btn secondary" id="endGame">Завершити гру</button><button class="btn" id="nextRound">Наступний раунд →</button></div></section>`;
}
function leaderboardHTML(players){
 const sorted=[...players].sort((a,b)=>b.score-a.score);
 return `<div class="player-list">${sorted.map((p,i)=>`<div class="player"><div class="avatar">${i===0?"♛":i+1}</div><span class="name">${esc(p.name)}</span><span class="score">${p.score} балів</span></div>`).join("")}</div>`;
}
function playerPanel(){
 const phase=roomState?.phase||"lobby",c=roomState?.current;
 if(phase==="lobby")return `<section class="panel center"><div class="eyebrow">ТИ В ГРІ</div><h2 class="section-title" style="margin:14px 0">Чекаємо на ведучу…</h2><p class="subtitle">Щойно почнеться раунд, тут з'явиться запитання. Готуй свою найпереконливішу брехню 🤫</p><div class="spinner"></div></section>`;
 if(phase==="writing"){
  return `<section class="panel"><div class="eyebrow">РАУНД ${roomState.questionNumber}</div><h2 class="question">${esc(c.prompt)}</h2><p class="muted">Придумай власну неправдиву відповідь. Постарайся, щоб інші повірили саме тобі.</p><div class="field" style="margin-top:18px"><label>ТВОЯ БРЕХНЯ</label><textarea id="lieInput" maxlength="300" placeholder="Напиши свою версію…"></textarea></div><button class="btn full" style="margin-top:12px" id="submitLie">${submitted?"Оновити відповідь":"Надіслати брехню →"}</button><p class="note" style="margin-top:12px">${submitted?"Відповідь збережено. Можеш змінити її, доки ведуча не закрила збір.":"Інші гравці не побачать твою відповідь до завершення раунду."}</p></section>`;
 }
 if(phase==="voting"){
  const opts=c.options||[];
  return `<section class="panel"><div class="eyebrow">ОБИРАЙ УВАЖНО</div><h2 class="question">${esc(c.prompt)}</h2><p class="muted">Одна відповідь — правда, одна — пастка ведучої. Решта — брехня команди. За власну брехню голосувати не можна.</p><div class="option-list" style="margin-top:18px">${opts.map((o,i)=>{const mine=o.id===selectedOption;return `<button class="option ${mine?"selected":""}" data-option="${o.id}" ${voted?"disabled":""}><span class="option-letter">${String.fromCharCode(65+i)}</span><span>${esc(o.text)}</span></button>`}).join("")}</div><button class="btn purple full" style="margin-top:16px" id="sendVote" ${voted||!selectedOption?"disabled":""}>${voted?"Голос зараховано ✓":"Підтвердити голос"}</button></section>`;
 }
 if(phase==="results"){
   const myVote=c.results?.votes?.find(v=>v.playerName===getMyName());
   return `<section class="panel center"><div class="eyebrow">РАУНД ${roomState.questionNumber} ЗАВЕРШЕНО</div><h2 class="section-title" style="margin:14px 0">Час дізнатися правду!</h2><p class="subtitle">Ведуча вже розкрила всі відповіді. Перевір свій результат у таблиці лідерів.</p>${leaderboardHTML(roomState.players)}<p class="note" style="margin-top:16px">Чекаємо на наступний раунд…</p></section>`;
 }
 return "";
}
function getMyName(){return roomState?.players?.find(p=>p.id===myId)?.name||"";}
function render(){
 if(currentPage==="home"){home();return;}
 if(currentPage==="ended")return;
 if(!roomState){app.innerHTML='<section class="panel center"><div class="spinner"></div><p>Підключаємося до кімнати…</p></section>';return;}
 if(role==="host"){
  app.innerHTML=`<div class="card-head"><div><div class="eyebrow">HALLOWEEN TEAM GAME</div><h2 class="section-title" style="margin-top:8px">Керуємо грою</h2></div><span class="tag">Ведуча</span></div><div class="layout"><div class="stack">${hostPanel()}</div>${sidebar()}</div><div class="footer-note">Не закривай вкладку ведучої, поки триває гра.</div>`;
  bindHost();bindCopy();
 }else if(role==="player"){
  app.innerHTML=`<div class="card-head"><div><div class="eyebrow">КІМНАТА ${esc(roomCode)}</div><h2 class="section-title" style="margin-top:8px">Привіт, ${esc(getMyName())}!</h2></div><span class="tag">Гравець</span></div><div class="layout"><div class="stack">${playerPanel()}</div>${sidebar()}</div>`;
  bindPlayer();bindCopy();
 }else home();
}
function bindCopy(){const b=document.querySelector("#copyLink");if(b)b.onclick=async()=>{try{await navigator.clipboard.writeText(roomCode);toast("Код скопійовано!");}catch{toast("Код кімнати: "+roomCode)}};}
function bindHost(){
 const f=document.querySelector("#roundForm");
 if(f)f.onsubmit=e=>{e.preventDefault();emit("start-round",{prompt:document.querySelector("#prompt").value,correct:document.querySelector("#correct").value,trap:document.querySelector("#trap").value});};
 const ex=document.querySelector("#fillExample");if(ex)ex.onclick=()=>{document.querySelector("#prompt").value=defaults[0].prompt;document.querySelector("#correct").value=defaults[0].correct;document.querySelector("#trap").value=defaults[0].trap;};
 const sv=document.querySelector("#startVoting");if(sv)sv.onclick=()=>emit("start-voting");
 const rv=document.querySelector("#reveal");if(rv)rv.onclick=()=>emit("reveal-results");
 const nr=document.querySelector("#nextRound");if(nr)nr.onclick=()=>{submitted=false;voted=false;selectedOption=null;emit("next-round");};
 const eg=document.querySelector("#endGame");if(eg)eg.onclick=()=>{if(confirm("Завершити гру та показати фінальний рейтинг?"))emit("end-game");};
}
function bindPlayer(){
 const sub=document.querySelector("#submitLie");if(sub)sub.onclick=()=>{const text=document.querySelector("#lieInput").value.trim();if(!text)return toast("Спочатку напиши брехню.");emit("submit-lie",{text});};
 document.querySelectorAll("[data-option]").forEach(b=>b.onclick=()=>{if(voted)return;selectedOption=b.dataset.option;render();});
 const sv=document.querySelector("#sendVote");if(sv)sv.onclick=()=>{if(!selectedOption)return toast("Обери варіант.");emit("vote",{optionId:selectedOption});};
}
function renderLeaderboard(players){
 app.innerHTML=`<section class="panel center"><div class="eyebrow">HALLOWEEN EDITION</div><h1 class="hero" style="font-family:Unbounded,sans-serif;font-size:clamp(28px,5vw,44px);padding:20px 0">Гру завершено <span style="color:var(--orange)">✦</span></h1><p class="subtitle">Ось як розподілилися місця в нашій битві брехунів.</p><div class="stack" style="max-width:550px;margin:0 auto">${players.map((p,i)=>`<div class="result-row"><div class="rank">${i===0?"♛":i+1}</div><div class="result-text">${esc(p.name)}${i===0?'<span class="kind">Переможець гри!</span>':""}</div><div class="points">${p.score} б.</div></div>`).join("")}</div><button class="btn full" style="max-width:300px;margin-top:24px" id="homeAgain">На головну</button></section>`;
 document.querySelector("#homeAgain").onclick=()=>{localStorage.removeItem(hostTokenKey(roomCode));home();};
}
function tryReconnect(){
 const params=new URLSearchParams(location.search),code=params.get("room");
 if(code){document.querySelector("#joinCode").value=code;return;}
 // Restore host/player only after home is available; user can rejoin using saved room code.
 const saved=localStorage.getItem("varianty_last_room");
 if(saved){const ht=localStorage.getItem(hostTokenKey(saved));const pt=localStorage.getItem(playerTokenKey(saved));if(ht){roomCode=saved;emit("rejoin-host",{code:saved,hostToken:ht});}else if(pt){roomCode=saved;emit("rejoin-player",{code:saved,playerToken:pt});}}
}
socket.on("room-created",d=>localStorage.setItem("varianty_last_room",d.code));
socket.on("joined-room",d=>localStorage.setItem("varianty_last_room",d.code));
home();
setTimeout(tryReconnect,350);
