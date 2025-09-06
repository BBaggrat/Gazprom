// ===============================
// ФинКвест — main.js (end_day + pools)
// Поддержка BOTH: STORY.end_day (новое) И STORY.days (fallback)
// Фичи: фон/SFX, __next_event__, cooldownPoolId / __next_day__::pool,
// тайминги в пулах, разные перерывы/IDLE, Reset, без нижнего navbar,
// кастомные тексты перерыва (pool/day/meta)
// ===============================

var SAVE_KEY = "finquest_perday_v3";
var STORY_URL = "story.json";
var STORY = null;

// ---------- helpers for "end_day" vs "days"
function getStoryDays(){ return (STORY && (STORY.end_day || STORY.days)) || []; }
function getDayObj(day){ return getStoryDays().find(function(x){ return x.day === day; }); }

// ---------- cooldown defaults / URL override (для теста можно ?cd=MIN)
function getCooldownMs(){
  try{ var u=new URL(location.href); var m=parseInt(u.searchParams.get("cd")); if(!isNaN(m)&&m>0) return m*60*1000; }catch(e){}
  return 60*60*1000;
}
var COOLDOWN_MS = getCooldownMs();

// перерыв: учитываем pool -> day -> meta
function getCooldownMsForDay(day){
  try{
    // 1) Если активен именованный пул и у него задано время
    if(state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]){
      var pool = STORY.eventPools[state.cooldownPoolId];
      if(typeof pool === "object" && !Array.isArray(pool)){
        if(typeof pool.cooldownMs  === "number") return Math.max(0, pool.cooldownMs|0);
        if(typeof pool.cooldownMin === "number") return Math.max(0, pool.cooldownMin)*60000;
      }
    }
    // 2) На уровне дня
    var d = getDayObj(day);
    if(d){
      if(typeof d.cooldownMs  === "number") return Math.max(0, d.cooldownMs|0);
      if(typeof d.cooldownMin === "number") return Math.max(0, d.cooldownMin)*60000;
    }
    // 3) Глобальные дефолты
    var meta=(STORY&&STORY.meta)||{};
    if(typeof meta.cooldownDefaultMin === "number") return Math.max(0, meta.cooldownDefaultMin)*60000;
  }catch(e){}
  return COOLDOWN_MS;
}

// частота IDLE: pool -> day -> meta
function getIdleIntervalMsForDay(day){
  try{
    if(state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]){
      var pool = STORY.eventPools[state.cooldownPoolId];
      if(typeof pool === "object" && !Array.isArray(pool)){
        if(typeof pool.idleIntervalSec === "number") return Math.max(1, pool.idleIntervalSec|0)*1000;
        if(typeof pool.idleIntervalMin === "number") return Math.max(0, pool.idleIntervalMin)*60000;
      }
    }
    var d=getDayObj(day);
    if(d){
      if(typeof d.idleIntervalSec === "number") return Math.max(1, d.idleIntervalSec|0)*1000;
      if(typeof d.idleIntervalMin === "number") return Math.max(0, d.idleIntervalMin)*60000;
    }
    var meta=(STORY&&STORY.meta)||{};
    if(typeof meta.idleIntervalDefaultSec === "number") return Math.max(1, meta.idleIntervalDefaultSec|0)*1000;
  }catch(e){}
  return 60000; // 60s по умолчанию
}

// ---------- state
var state={
  day:1, dayCompleted:false, nodeId:null,
  resources:{currency:0,reputation:0},
  history:[], lastActiveISO:null, feed:[],
  cooldownUntilISO:null, nextIdleAtISO:null,
  cooldownOnceSeenIds:[], breakEventFired:false,
  nextDayStartNodeId:null,
  staticImage:null, muted:false,
  pendingBgSrc:null,
  cooldownPoolId:null
};

// ---------- utils
function $(s){return document.querySelector(s);}
function el(t,c){var e=document.createElement(t); if(c) e.className=c; return e;}
function nowISO(){return new Date().toISOString();}
function fmtHMS(ms){ms=Math.max(0,ms|0);var s=Math.floor(ms/1000)%60,m=Math.floor(ms/60000)%60,h=Math.floor(ms/3600000);function z(n){return n<10?("0"+n):(""+n);}return(h>0?h+":"+z(m)+":"+z(s):z(m)+":"+z(s));}
function getStartResources(){var s=STORY&&STORY.meta&&STORY.meta.start||{};return{currency:typeof s.currency==="number"?s.currency:0,reputation:typeof s.reputation==="number"?s.reputation:0};}
function getUi(){return (STORY && STORY.meta && STORY.meta.ui) || {};}

// ---------- кастомные тексты перерыва (pool → day → meta)
function getCooldownCopy() {
  // 1) По пулу (самый высокий приоритет)
  if (state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]) {
    var pool = STORY.eventPools[state.cooldownPoolId];
    if (pool && typeof pool === "object") {
      if (pool.cooldownTitle || pool.cooldownText) {
        return {
          title: pool.cooldownTitle || "Перерыв",
          text:  pool.cooldownText  || "Между днями происходят события…"
        };
      }
    }
  }
  // 2) По дню
  var d = getDayObj(state.day);
  if (d && (d.cooldownTitle || d.cooldownText)) {
    return {
      title: d.cooldownTitle || "Перерыв",
      text:  d.cooldownText  || "Между днями происходят события…"
    };
  }
  // 3) Глобальные дефолты
  var meta = (STORY && STORY.meta) || {};
  return {
    title: meta.cooldownTitle || "Перерыв",
    text:  meta.cooldownText  || "Между днями происходят события…"
  };
}

// ---------- audio
var bgAudio=null, sfxAudio=null;
function playBackground(src){
  if(state.muted||!src) return;
  try{ if(bgAudio&&bgAudio.src&&bgAudio.src.indexOf(src)!==-1&&!bgAudio.paused) return; }catch(e){}
  try{
    if(bgAudio){ try{bgAudio.pause();}catch(e){} bgAudio=null; }
    var ui=getUi(); bgAudio=new Audio(src); bgAudio.loop=true;
    bgAudio.volume=(typeof ui.backgroundVolume==="number"?ui.backgroundVolume:0.5);
    bgAudio.play().catch(function(){});
  }catch(e){}
}
function ensureBackground(){
  if(state.muted) return; var ui=getUi(); var src=ui.backgroundMusic||state.pendingBgSrc;
  if(src && (!bgAudio || bgAudio.paused)) playBackground(src);
}
function playSfx(src){
  if(state.muted||!src) return;
  try{
    if(!sfxAudio) sfxAudio=new Audio();
    sfxAudio.pause(); sfxAudio.src=src;
    var ui=getUi(); sfxAudio.volume=(typeof ui.sfxVolume==="number"?ui.sfxVolume:1.0);
    sfxAudio.currentTime=0; sfxAudio.play().catch(function(){});
  }catch(e){}
}
function playClick(){ if(state.muted) return; try{ var ui=getUi(); var a=new Audio("sounds/click.mp3"); a.volume=(typeof ui.clickVolume==="number"?ui.clickVolume:0.6); a.play().catch(function(){});}catch(e){} }

// ---------- init
document.addEventListener("DOMContentLoaded",init);
function init(){
  fetch(STORY_URL+"?v="+Date.now(),{cache:"no-store"})
    .then(function(r){ if(!r.ok) throw new Error(); return r.json(); })
    .then(function(json){
      STORY=json;
      var ui=getUi(); if(ui.backgroundMusic) state.pendingBgSrc=ui.backgroundMusic;
      initStaticImageFromMeta();
      if(!loadGame()){ state.resources=getStartResources(); state.nodeId=getDayStartNode(1); state.lastActiveISO=nowISO(); }
      bindUI(); startTicker(); render();
    })
    .catch(function(){ alert("Не удалось загрузить story.json"); });
}

function bindUI(){
  var c=$("#btn-continue"); if(c) c.onclick=function(){ ensureBackground(); playClick(); goNextContinue(); };

  var choices=$("#choices");
  if(choices){ choices.addEventListener("click",function(ev){ if(ev.target&&ev.target.tagName==="BUTTON"){ ensureBackground(); } },true); }

  var r=$("#btn-reset");
  if(r) r.onclick=function(){
    localStorage.removeItem(SAVE_KEY);
    state={day:1,dayCompleted:false,nodeId:getDayStartNode(1),resources:getStartResources(),history:[],lastActiveISO:nowISO(),feed:[],cooldownUntilISO:null,nextIdleAtISO:null,cooldownOnceSeenIds:[],breakEventFired:false,nextDayStartNodeId:null,staticImage:state.staticImage||null,muted:false,pendingBgSrc:getUi().backgroundMusic||null,cooldownPoolId:null};
    render();
  };

  var m=$("#btn-mute"); if(m) m.onclick=toggleMute;

  document.body.addEventListener("click",function once(){ ensureBackground(); document.body.removeEventListener("click",once,true); },true);
}

function loadGame(){
  var raw=localStorage.getItem(SAVE_KEY); if(!raw) return false;
  try{
    state=JSON.parse(raw);
    if(!Array.isArray(state.cooldownOnceSeenIds)) state.cooldownOnceSeenIds=[];
    if(typeof state.breakEventFired!=="boolean") state.breakEventFired=false;
    if(typeof state.muted!=="boolean") state.muted=false;
    if(typeof state.pendingBgSrc==="undefined") state.pendingBgSrc=getUi().backgroundMusic||null;
    if(typeof state.cooldownPoolId==="undefined") state.cooldownPoolId=null;
    return true;
  }catch(e){ return false; }
}

// ---------- story helpers
function getDayStartNode(day){ var d=getDayObj(day); return d?d.startNodeId:null; }
function getDayBreakEvent(day){ var d=getDayObj(day); return d&&d.breakEvent?d.breakEvent:null; }
function findNode(id){ return (STORY.nodes||[]).find(function(n){return n.id===id;}) || null; }

// последовательности внутри дня (если используешь)
function getDaySequence(day){
  var d=getDayObj(day);
  if(!d) return null;
  return d.eventSequence || d.sequence || null;
}

// __next_event__ резолв
function resolveNextEventId(currentId, marker){
  if(marker && marker.indexOf("__next_event__")===0){
    var parts = marker.split(/[:]{1,2}/);
    if(parts.length>=2 && parts[1]) return parts[1];
  }
  var node=findNode(currentId);
  if(node && node.nextEventId) return node.nextEventId;

  var seq=getDaySequence(state.day);
  if(seq && Array.isArray(seq)){
    var i=seq.indexOf(currentId);
    if(i>=0 && i<seq.length-1) return seq[i+1];
  }

  var nodes=STORY.nodes||[];
  var idx=nodes.findIndex(function(n){return n.id===currentId;});
  if(idx>=0 && idx<nodes.length-1) return nodes[idx+1].id;

  return currentId;
}

function advanceDay(){
  state.day=Math.min(14,state.day+1);
  state.dayCompleted=false;
  state.nodeId=state.nextDayStartNodeId||getDayStartNode(state.day);
  state.nextDayStartNodeId=null;
  appendFeed("Новый день: #"+state.day,0,0);
}
function isInCooldown(){ return state.cooldownUntilISO && new Date(state.cooldownUntilISO) > new Date(); }

// ---------- render
function render(){
  var di=$("#day-indicator"); if(di) di.textContent="День "+state.day+"/14";
  updateHud(); renderFeed();

  var cd=$("#cooldown"), cdt=$("#cd-time");
  if(isInCooldown()){ cd.classList.remove("hidden"); cdt.textContent=fmtHMS(new Date(state.cooldownUntilISO)-Date.now()); }
  else{ cd.classList.add("hidden"); }

  var node=findNode(state.nodeId); if(!node) return;

  if(node.staticImage) setStaticImage(node.staticImage);
  if(node.sound)       playSfx(node.sound);

  $("#speaker").textContent=node.speaker||"";
  $("#text").textContent=node.text||"";

  var choices=$("#choices"); choices.innerHTML="";
  var cont=$("#continue"); cont.classList.add("hidden");
  var contBtn=$("#btn-continue");

  if(!isInCooldown()){
    if(node.type==="scene"){
      var arr=(node.choices||[]);
      if(arr.length){
        arr.forEach(function(ch){
          var b=el("button");
          b.textContent=ch.label;
          b.onclick=function(){ choose(node,ch); };
          choices.appendChild(b);
        });
      } else if(node.nextId){
        cont.classList.remove("hidden");
        cont.dataset.nextId=node.nextId;
        contBtn.textContent=node.label||"Далее";
      }
    }
    if(node.type==="info"){
      if(node.cooldownPoolId) state.cooldownPoolId = node.cooldownPoolId; // концовка может выбрать пул
      cont.classList.remove("hidden");
      cont.dataset.nextId=node.nextId;
      contBtn.textContent=node.label||"Далее";
    }
    if(node.type==="ending"){
      var end=$("#ending"); end.classList.remove("hidden"); end.innerHTML="<div>"+(node.text||"Финал")+"</div>";
    }
  } else {
    var cc = getCooldownCopy();
    $("#speaker").textContent = cc.title;
    $("#text").textContent    = cc.text;
  }
}

function updateHud(){
  var c=$("#res-currency"), r=$("#res-reputation");
  if(c) c.textContent="₽ "+state.resources.currency;
  if(r) r.textContent="⭐ "+state.resources.reputation;
}

function choose(node, ch){
  if(ch.effects){
    applyEffects(ch.effects);
    appendFeed("Выбор: "+ch.label,(ch.effects&&ch.effects.currency)||0,(ch.effects&&ch.effects.reputation)||0);
  }
  if(ch.staticImage) setStaticImage(ch.staticImage);
  if(ch.sound)       playSfx(ch.sound);

  if(ch.cooldownPoolId) state.cooldownPoolId = ch.cooldownPoolId;
  if(ch.nextDayStartId) state.nextDayStartNodeId = ch.nextDayStartId;

  if(typeof ch.nextId==="string" && ch.nextId.indexOf("__next_event__")===0){
    state.nodeId = resolveNextEventId(state.nodeId, ch.nextId);
  } else {
    state.nodeId = ch.nextId || node.nextId;
  }

  ensureBackground(); playClick();
  render(); localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function applyEffects(eff){ for(var k in eff){ if(state.resources.hasOwnProperty(k)){ state.resources[k]+=eff[k]; } } }

function goNextContinue(){
  var marker=$("#continue").dataset.nextId;

  // __next_event__ (с опциональным таргетом)
  if(marker && marker.indexOf("__next_event__")===0){
    state.nodeId = resolveNextEventId(state.nodeId, marker);
    render();
    return;
  }

  // "__next_day__::poolId" + "__next_day__:StartNode"
  if(marker && marker.indexOf("__next_day__::")===0){ state.cooldownPoolId = marker.split("::")[1]; marker="__next_day__"; }
  if(marker && marker.indexOf("__next_day__:")===0){ state.nextDayStartNodeId = marker.split(":")[1]; marker="__next_day__"; }

  if(marker==="__next_day__"){
    state.dayCompleted=true;
    var now=Date.now();
    state.cooldownUntilISO=new Date(now+getCooldownMsForDay(state.day)).toISOString();
    state.nextIdleAtISO=new Date(now+getIdleIntervalMsForDay(state.day)).toISOString();
    state.cooldownOnceSeenIds=[]; state.breakEventFired=false;
    appendFeed("День завершён. Перерыв начался…",0,0);
    render(); localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } else {
    state.nodeId=marker; render();
  }
}

// ---------- ticker
function startTicker(){ setInterval(tick,1000); }
function tick(){
  if(state.cooldownUntilISO && new Date(state.cooldownUntilISO) <= new Date()){
    if(!state.breakEventFired){
      var be=getDayBreakEvent(state.day);
      if(be){
        if(be.effects) applyEffects(be.effects);
        appendFeed(be.text,(be.effects&&be.effects.currency)||0,(be.effects&&be.effects.reputation)||0);
        if(be.staticImage) setStaticImage(be.staticImage);
        if(be.sound)       playSfx(be.sound);
      }
      state.breakEventFired=true;
    }
    state.cooldownUntilISO=null; state.nextIdleAtISO=null; state.cooldownPoolId=null;
    if(state.dayCompleted) advanceDay();
    render(); localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return;
  }

  if(isInCooldown()){
    var now=new Date();
    if(!state.nextIdleAtISO){
      state.nextIdleAtISO=new Date(now.getTime()+getIdleIntervalMsForDay(state.day)).toISOString();
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    }
    var nextIdle=new Date(state.nextIdleAtISO);
    if(now>=nextIdle){
      spawnIdleEvent();
      state.nextIdleAtISO=new Date(now.getTime()+getIdleIntervalMsForDay(state.day)).toISOString();
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    }
    var cdt=$("#cd-time"); if(cdt) cdt.textContent=fmtHMS(new Date(state.cooldownUntilISO)-Date.now());
  }
}

// ---------- idle pool selection
function getDayEventsPool(day){
  // 1) Пул перерыва (именованный)
  if(state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]){
    var pool=STORY.eventPools[state.cooldownPoolId];
    if(Array.isArray(pool)) return pool;
    if(pool && Array.isArray(pool.events)) return pool.events;
  }

  // 2) На уровне дня
  var d=getDayObj(day);
  // поддержка обоих названий списка событий внутри дня: end_day.events (если оставили), либо старый days[].events
  if(d){
    if(Array.isArray(d.end_day) && d.end_day.length) return d.end_day; // если внутри дня ввели новый ключ
    if(Array.isArray(d.events)  && d.events.length)  return d.events;  // старый ключ
  }

  // 3) Глобальный fallback
  return STORY.idleEvents || [];
}

function filterAvailableEvents(pool){
  if(!pool||!pool.length) return [];
  return pool.filter(function(ev){
    var id=ev.id||ev.text;
    if(ev.once===true && state.cooldownOnceSeenIds.indexOf(id)!==-1) return false;
    return true;
  });
}
function spawnIdleEvent(){
  var pool=filterAvailableEvents(getDayEventsPool(state.day));
  if(!pool.length) return;
  var sum=pool.reduce(function(a,b){return a+(b.weight||1);},0);
  var r=Math.random()*sum, chosen=pool[0];
  for(var i=0;i<pool.length;i++){ r-=(pool[i].weight||1); if(r<=0){ chosen=pool[i]; break; } }
  if(chosen.effects) applyEffects(chosen.effects);
  if(chosen.staticImage) setStaticImage(chosen.staticImage);
  if(chosen.sound)       playSfx(chosen.sound);
  appendFeed(chosen.text,(chosen.effects&&chosen.effects.currency)||0,(chosen.effects&&chosen.effects.reputation)||0);
  if(chosen.once===true && state.cooldownOnceSeenIds.indexOf(chosen.id||chosen.text)===-1){
    state.cooldownOnceSeenIds.push(chosen.id||chosen.text);
  }
}

// ---------- feed / images / mute
function appendFeed(text,dc,dr){
  var t=new Date(), h=t.getHours(), m=t.getMinutes();
  var stamp=(h<10?"0"+h:h)+":"+(m<10?"0"+m:m);
  var delta=(dc?(" ₽"+dc):"")+(dr?(" ⭐"+dr):"");
  state.feed.push({t:stamp,text:text,delta:delta});
  if(state.feed.length>50) state.feed.shift();
  renderFeed(); updateHud();
}
function renderFeed(){
  var list=$("#feed-list"); if(!list) return;
  list.innerHTML="";
  state.feed.forEach(function(f){
    var item=el("div","feed-item");
    item.innerHTML="<div>"+f.text+"</div><small>"+f.t+(f.delta?(" · "+f.delta):"")+"</small>";
    list.appendChild(item);
  });
  list.scrollTop=list.scrollHeight;
}
function setStaticImage(src){
  if(!src) return;
  state.staticImage=src;
  var img=document.getElementById('static-image');
  if(img && img.getAttribute('src')!==src){ img.setAttribute('src',src); }
}
function initStaticImageFromMeta(){
  var ui=getUi();
  var def=ui.defaultImage || (Array.isArray(ui.images)&&ui.images[0]);
  if(def) setStaticImage(def);
}
function toggleMute(){
  state.muted=!state.muted;
  var b=document.getElementById('btn-mute');
  if(b){ if(state.muted){ b.textContent="🔇"; } else { b.textContent="🔊"; } }
  try{ if(state.muted){ if(bgAudio){ bgAudio.pause(); } } else { ensureBackground(); } }catch(e){}
}
