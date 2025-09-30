

// === injected: clearAllEventsUI (hackathon patch) ===
function clearAllEventsUI() {
  try {
    // Очистка состояния ленты, если такая структура есть
    if (typeof state !== 'undefined' && state && Array.isArray(state.feed)) {
      state.feed.length = 0;
      if (typeof renderFeed === 'function') renderFeed();
    }
    // Удаление DOM-элементов, если они рендерятся напрямую
    const selectors = ['.event', '.idle-event', '.event-item', '#feed-list .item', '#events .event'];
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
    });
  } catch (e) {
    console && console.warn && console.warn('clearAllEventsUI failed:', e);
  }
}
// === end injected ===
// ===============================
// ФинКвест — main.js (chains fix + subpools + idle 3-tick cooldown) — v6-fix
// ===============================

var SAVE_KEY = "finquest_perday_v6";
var STORY_URL = "story.json";

// === Hidden Ending Score System (invisible counter) ===
var HIDDEN_SCORE_KEY = "finquest_hidden_score_v1";

function getHiddenScore() {
  var v = localStorage.getItem(HIDDEN_SCORE_KEY);
  return v === null ? 0 : (parseInt(v, 10) || 0);
}
function setHiddenScore(val) { localStorage.setItem(HIDDEN_SCORE_KEY, String(parseInt(val, 10) || 0)); }
function addToHiddenScore(delta) { setHiddenScore(getHiddenScore() + (parseInt(delta, 10) || 0)); }

// Configurable endings
var ENDINGS = [
  { id: "bad", title: "Концовка: «Ещё всё впереди»",
    text: "Клуб открыли, но ряд решений мешал росту. Переосмыслите стратегию и попробуйте снова.",
    condition: function(score){ return score <= 0; } },
  { id: "neutral", title: "Концовка: «Держимся на плаву»",
    text: "Нелегко, но клуб выжил. Поток клиентов нестабилен, но фундамент заложен.",
    condition: function(score){ return score >= 1 && score <= 3; } },
  { id: "good", title: "Концовка: «GG WP!»",
    text: "Вы выстроили процессы и вывели клуб в плюс. Команда готова к следующему турниру!",
    condition: function(score){ return score >= 4; } }
];
function pickEndingByScore(score){
  for (var i=0;i<ENDINGS.length;i++){ if (ENDINGS[i].condition(score)) return ENDINGS[i]; }
  return ENDINGS[1]; // fallback neutral
}
function renderHiddenScoreEnding(){
  var end = $("#ending");
  if (!end) return;
  var score = getHiddenScore();
  var e = pickEndingByScore(score);
  end.classList.remove("hidden");
  end.innerHTML = '<div class="ending-card"><h2>'+ e.title +'</h2><p>'+ e.text +'</p><button id="restartBtn" class="primary">Начать заново</button></div>';
  var rb = $("#restartBtn");
  if (rb) rb.onclick = function(){
    setHiddenScore(0);
    // Soft reset: mimic reset button behaviour if present
    var r = $("#btn-reset");
    if (r && typeof r.onclick === "function") { r.onclick(); }
    else {
      // Fallback full reload of state if API surface differs
      if (typeof restart === "function") restart();
      else if (typeof render === "function") render();
    }
  };
}



function renderNodeEnding(node){
  try { hideNextButton(true); } catch(e){}

  // Скрываем пузырь и варианты, чтобы не было мусора от прошлого узла
  try {
    var bubble = document.querySelector('.bubble'); if (bubble) bubble.classList.add('hidden');
    var choices = document.getElementById('choices'); if (choices) { choices.innerHTML = ''; choices.classList.add('hidden'); }
    var cont = document.getElementById('continue'); if (cont) cont.classList.add('hidden');
  } catch(e){}

  try {
    var end = $("#ending");
    if (!end) return;
    var title = (node && node.title) || "Концовка";
    var text  = (node && node.text)  || "";
    end.classList.remove("hidden");
    end.innerHTML = '<div class="ending-card"><h2>'+ title +'</h2><p>'+ text +'</p><div class="ending-actions"><button id="restartBtn" class="primary">Начать заново</button></div></div>';
    var rb = $("#restartBtn");
    if (rb) rb.onclick = function(){
      // попытаться вызвать штатный reset, если он есть
      var r = $("#btn-reset");
      if (r && typeof r.onclick === "function") { r.onclick(); }
      else if (typeof restart === "function") { restart(); }
      else if (typeof renderHiddenScoreEnding === "function") { setHiddenScore(0); renderHiddenScoreEnding(); }
      else { try { location.reload(); } catch(e){} }
    };
  } catch(e){}
}

var STORY = null;

// ---------- helpers for "end_day" vs "days"
function getStoryDays() {
  return (STORY && (STORY.end_day || STORY.days)) || [];
}
function getDayObj(day) {
  return getStoryDays().find(function (x) { return x.day === day; });
}

// ---------- cooldown defaults / URL override
function getCooldownMs() {
  try {
    var u = new URL(location.href);
    var m = parseInt(u.searchParams.get("cd"));
    if (!isNaN(m) && m > 0) return m * 60 * 1000;
  } catch (e) {}
  return 60 * 60 * 1000;
}
var COOLDOWN_MS = getCooldownMs();

function getCooldownMsForDay(day) {
  try {
    if (state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]) {
      var pool = STORY.eventPools[state.cooldownPoolId];
      if (pool && typeof pool === "object" && !Array.isArray(pool)) {
        if (typeof pool.cooldownMs === "number") return Math.max(0, pool.cooldownMs | 0);
        if (typeof pool.cooldownMin === "number") return Math.max(0, pool.cooldownMin) * 60000;
      }
    }
    var d = getDayObj(day);
    if (d) {
      if (typeof d.cooldownMs === "number") return Math.max(0, d.cooldownMs | 0);
      if (typeof d.cooldownMin === "number") return Math.max(0, d.cooldownMin) * 60000;
    }
    var meta = (STORY && STORY.meta) || {};
    if (typeof meta.cooldownDefaultMin === "number") return Math.max(0, meta.cooldownDefaultMin) * 60000;
  } catch (e) {}
  return COOLDOWN_MS;
}

function getIdleIntervalMsForDay(day) {
  try {
    if (state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]) {
      var pool = STORY.eventPools[state.cooldownPoolId];
      if (pool && typeof pool === "object" && !Array.isArray(pool)) {
        if (typeof pool.idleIntervalSec === "number") return Math.max(1, pool.idleIntervalSec | 0) * 1000;
        if (typeof pool.idleIntervalMin === "number") return Math.max(0, pool.idleIntervalMin) * 60000;
      }
    }
    var d = getDayObj(day);
    if (d) {
      if (typeof d.idleIntervalSec === "number") return Math.max(1, d.idleIntervalSec | 0) * 1000;
      if (typeof d.idleIntervalMin === "number") return Math.max(0, d.idleIntervalMin) * 60000;
    }
    var meta = (STORY && STORY.meta) || {};
    if (typeof meta.idleIntervalDefaultSec === "number") return Math.max(1, meta.idleIntervalDefaultSec | 0) * 1000;
  } catch (e) {}
  return 60000;
}

// ---------- state
var state = {
  day: 1,
  dayCompleted: false,
  nodeId: null,
  resources: {},
  history: [],
  lastActiveISO: null,
  feed: [],
  cooldownUntilISO: null,
  nextIdleAtISO: null,
  cooldownOnceSeenIds: [],
  cooldownOnceSeenChains: [],
  idleCooldowns: {},                   // мягкий кулдаун: {eventKey: ticksLeft}
  breakEventFired: false,
  nextDayStartNodeId: null,
  staticImage: null,
  muted: false,
  pendingBgSrc: null,
  cooldownPoolId: null,
  idleContext: {                       // контекст перерыва
    chainNextId: null,                 // следующий event.id в активной цепочке
    chainId: null,                     // id цепочки (once-per-cooldown)
    subPool: null,                     // активный мини-пул
    subLeft: 0                         // сколько событий ещё взять из него
  }
};

// ---------- utils
function $(s) { return document.querySelector(s); }
function el(t, c) { var e = document.createElement(t); if (c) e.className = c; return e; }
function nowISO() { return new Date().toISOString(); }
function fmtHMS(ms) {
  ms = Math.max(0, ms | 0);
  var s = Math.floor(ms / 1000) % 60;
  var m = Math.floor(ms / 60000) % 60;
  var h = Math.floor(ms / 3600000);
  function z(n) { return n < 10 ? ("0" + n) : ("" + n); }
  return (h > 0 ? h + ":" + z(m) + ":" + z(s) : z(m) + ":" + z(s));
}
function getStartResources() {
  var s = STORY && STORY.meta && STORY.meta.start || {};
//   return { currency: s.currency || 0, reputation: s.reputation || 0 };
}
function getUi() { return (STORY && STORY.meta && STORY.meta.ui) || {}; }

// ---------- кастомные тексты перерыва
function getCooldownCopy() {
  if (state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]) {
    var pool = STORY.eventPools[state.cooldownPoolId];
    if (pool && (pool.cooldownTitle || pool.cooldownText)) {
      return {
        title: pool.cooldownTitle || "Перерыв",
        text: pool.cooldownText || "Между днями происходят события…"
      };
    }
  }
  var d = getDayObj(state.day);
  if (d && (d.cooldownTitle || d.cooldownText)) {
    return { title: d.cooldownTitle || "Перерыв", text: d.cooldownText || "Между днями происходят события…" };
  }
  var meta = (STORY && STORY.meta) || {};
  return { title: meta.cooldownTitle || "Перерыв", text: meta.cooldownText || "Между днями происходят события…" };
}

// ---------- audio
var bgAudio = null, sfxAudio = null;
function playBackground(src) {
  if (state.muted || !src) return;
  try { if (bgAudio && bgAudio.src && bgAudio.src.indexOf(src) !== -1 && !bgAudio.paused) return; } catch (e) {}
  try {
    if (bgAudio) { try { bgAudio.pause(); } catch (e) {} bgAudio = null; }
    var ui = getUi();
    bgAudio = new Audio(src);
    bgAudio.loop = true;
    bgAudio.volume = ui.backgroundVolume || 0.5;
    bgAudio.play().catch(function () {});
  } catch (e) {}
}
function ensureBackground() {
  if (state.muted) return;
  var ui = getUi();
  var src = ui.backgroundMusic || state.pendingBgSrc;
  if (src && (!bgAudio || bgAudio.paused)) playBackground(src);
}
function playSfx(src) {
  if (state.muted || !src) return;
  try {
    if (!sfxAudio) sfxAudio = new Audio();
    sfxAudio.pause();
    sfxAudio.src = src;
    var ui = getUi();
    sfxAudio.volume = ui.sfxVolume || 1.0;
    sfxAudio.currentTime = 0;
    sfxAudio.play().catch(function () {});
  } catch (e) {}
}
function playClick() {
  if (state.muted) return;
  try {
    var ui = getUi();
    var a = new Audio("sounds/click.mp3");
    a.volume = ui.clickVolume || 0.6;
    a.play().catch(function () {});
  } catch (e) {}
}

// ---------- init / bind / load
document.addEventListener("DOMContentLoaded", init);
function init() {
  fetch(STORY_URL + "?v=" + Date.now(), { cache: "no-store" })
    .then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (json) {
      STORY = json;
      var ui = getUi();
      if (ui.backgroundMusic) state.pendingBgSrc = ui.backgroundMusic;
      initStaticImageFromMeta();
      if (!loadGame()) {
        state.resources = getStartResources();
        state.nodeId = getDayStartNode(1);
        state.lastActiveISO = nowISO();
      }
      bindUI();
      startTicker();
      render();
    })
    .catch(function () { alert("Не удалось загрузить story.json"); });
}

function bindUI() {
  var c = $("#btn-continue");
  if (c) c.onclick = function () { ensureBackground(); playClick(); goNextContinue(); 

  // ensure link slot under the main image
  try {
    var imgWrap = document.getElementById('image-wrap') || document.getElementById('image') ||
                  document.querySelector('.image') || document.querySelector('.story .picture') ||
                  document.querySelector('.story');
    if (imgWrap && !document.getElementById('imageLink')) {
      var linkDiv = document.createElement('div');
      linkDiv.id = 'imageLink';
      linkDiv.className = 'image-link hidden';
      if (imgWrap.parentNode) imgWrap.parentNode.insertBefore(linkDiv, imgWrap.nextSibling);
    }
  } catch(e){}
};

  var choices = $("#choices");
  if (choices) {
choices.addEventListener("click", function (ev) {
      var btn = ev.target && (ev.target.tagName === "BUTTON" ? ev.target : (ev.target.closest && ev.target.closest("button")));
      if (!btn) return;
      ensureBackground();
      // Prefer bound onclick, else delegate
      if (typeof btn.onclick === "function") { btn.onclick(); return; }
      var node = findNode(state.nodeId);
      if (!node) return;
      var idx = (btn.dataset && btn.dataset.i) ? parseInt(btn.dataset.i, 10) : -1;
      var ch = (Array.isArray(node.choices) && idx >= 0) ? node.choices[idx] : null;
      if (!ch) {
        // try match by label text
        var label = (btn.textContent || "").trim();
        if (Array.isArray(node.choices)) {
          for (var i=0;i<node.choices.length;i++) { if ((node.choices[i].label||"").trim()===label) { ch = node.choices[i]; idx=i; break; } }
        }
      }
      if (ch) { choose(node, ch); }
    }, true);

    choices.addEventListener("click", function (ev) {
      var btn = ev.target && (ev.target.tagName === "BUTTON" ? ev.target : ev.target.closest && ev.target.closest("button"));
      if (!btn) return;
      ensureBackground();
      if (btn.onclick) return; // normal path is bound
      var node = findNode(state.nodeId);
      var idx = btn.dataset && btn.dataset.i ? parseInt(btn.dataset.i, 10) : -1;
      var ch = (node && node.choices && idx >= 0) ? node.choices[idx] : null;
      if (node && ch) { choose(node, ch); }
    }, true);
  }

  var r = $("#btn-reset");
  if (r) r.onclick = function () {
    localStorage.removeItem(SAVE_KEY);
    try { setHiddenScore(0); } catch(e){}
    state = {
      day: 1, dayCompleted: false, nodeId: getDayStartNode(1),
      resources: getStartResources(), history: [], lastActiveISO: nowISO(), feed: [],
      cooldownUntilISO: null, nextIdleAtISO: null,
      cooldownOnceSeenIds: [], cooldownOnceSeenChains: [],
      idleCooldowns: {},
      breakEventFired: false, nextDayStartNodeId: null,
      staticImage: state.staticImage || null, muted: false,
      pendingBgSrc: getUi().backgroundMusic || null, cooldownPoolId: null,
      idleContext: { chainNextId: null, chainId: null, subPool: null, subLeft: 0 }
    };
    render();
  };

  var m = $("#btn-mute");
  if (m) m.onclick = toggleMute;

  document.body.addEventListener("click", function once() {
    ensureBackground();
    document.body.removeEventListener("click", once, true);
  }, true);
}

function loadGame() {
  var raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return false;
  try {
    state = JSON.parse(raw);
    if (!Array.isArray(state.cooldownOnceSeenIds)) state.cooldownOnceSeenIds = [];
    if (!Array.isArray(state.cooldownOnceSeenChains)) state.cooldownOnceSeenChains = [];
    if (typeof state.idleCooldowns !== "object" || !state.idleCooldowns) state.idleCooldowns = {};
    if (typeof state.breakEventFired !== "boolean") state.breakEventFired = false;
    if (typeof state.muted !== "boolean") state.muted = false;
    if (typeof state.pendingBgSrc === "undefined") state.pendingBgSrc = getUi().backgroundMusic || null;
    if (typeof state.cooldownPoolId === "undefined") state.cooldownPoolId = null;
    if (!state.idleContext) state.idleContext = { chainNextId: null, chainId: null, subPool: null, subLeft: 0 };
    return true;
  } catch (e) { return false; }
}

// ---------- story helpers
function getDayStartNode(day) { var d = getDayObj(day); return d ? d.startNodeId : null; }
function getDayBreakEvent(day) { var d = getDayObj(day); return d && d.breakEvent ? d.breakEvent : null; }
function findNode(id) { return (STORY.nodes || []).find(function (n) { return n.id === id; }) || null; }
function getDaySequence(day) { var d = getDayObj(day); return d ? (d.eventSequence || d.sequence || null) : null; }

function resolveNextEventId(currentId, marker) {
  if (marker && marker.indexOf("__next_event__") === 0) {
    var parts = marker.split(/[:]{1,2}/);
    if (parts.length >= 2 && parts[1]) return parts[1];
  }
  var node = findNode(currentId);
  if (node && node.nextEventId) return node.nextEventId;

  var seq = getDaySequence(state.day);
  if (seq && Array.isArray(seq)) {
    var i = seq.indexOf(currentId);
    if (i >= 0 && i < seq.length - 1) return seq[i + 1];
  }

  var nodes = STORY.nodes || [];
  var idx = nodes.findIndex(function (n) { return n.id === currentId; });
  if (idx >= 0 && idx < nodes.length - 1) return nodes[idx + 1].id;

  return currentId;
}

function advanceDay() {

try { clearAllEventsUI(); } catch(e){}
state.feed = [];
renderFeed();

  state.day = Math.min(14, state.day + 1);
  state.dayCompleted = false;
  state.nodeId = state.nextDayStartNodeId || getDayStartNode(state.day);
  state.nextDayStartNodeId = null;
  appendFeed("Новый этап: #" + state.day, 0, 0);
}
function isInCooldown() { return state.cooldownUntilISO && new Date(state.cooldownUntilISO) > new Date(); }

// ---------- render
function setImageLink(link) {
  var slot = document.getElementById("imageLink");
  if (!slot) return;
  var url = null, label = null;
  if (typeof link === "string") { url = link; }
  else if (link && typeof link === "object") { url = link.url || link.href; label = link.label || link.text; }
  if (!url || !/^https?:\/\//i.test(url)) {
    slot.innerHTML = "";
    slot.classList.add("hidden");
    return;
  }
  if (!label) {
    try { label = new URL(url).host; } catch (e) { label = "Открыть ссылку"; }
  }
  slot.innerHTML = '<a class="image-link__a" href="'+ url +'" target="_blank" rel="noopener noreferrer">'+ label +'</a>';
  slot.classList.remove("hidden");
}
function clearImageLink() {
  var slot = document.getElementById("imageLink");
  if (slot) { slot.innerHTML = ""; slot.classList.add("hidden"); }
}


// === Helpers to control ending and continue button ===
function hideNextButton(hide) {
  try {
    const selectors = [
      '#btn-next', '#btn-continue', '#next', '#continue',
      '[data-role="continue"]', '[data-action="continue"]',
      '.btn-next', '.next-button', '.continue', '.feed-continue', '.actions .primary', '.actions .btn'
    ];
    let hit = false;
    for (var s of selectors) {
      var els = document.querySelectorAll(s);
      els.forEach(function(el){
        hit = true;
        var target = el.closest('.feed-row, .row, .wrap, .actions') || el;
        if (hide) { target.classList.add('hidden'); target.style.display = 'none'; }
        else { target.classList.remove('hidden'); target.style.display = ''; }
      });
    }
    if (!hit) {
      document.querySelectorAll('button, .btn, .button').forEach(function(el){
        var t = (el.textContent || '').trim().toLowerCase();
        if (t === 'далее' || t === 'continue') {
          var target = el.closest('.feed-row, .row, .wrap, .actions') || el;
          if (hide) { target.classList.add('hidden'); target.style.display = 'none'; }
          else { target.classList.remove('hidden'); target.style.display = ''; }
        }
      });
    }
  } catch(e) {}
}
function hideEnding() {
  try {
    var end = document.querySelector('#ending');
    if (end) {
      end.classList.add('hidden');
      end.innerHTML = '';
    }
    document.body.classList.remove('force-ending');
  } catch(e) {}
}

function render() {
  clearImageLink(); (function(){try{var on=(state&&state.cooldownUntilISO)&&Date.parse(state.cooldownUntilISO)>Date.now();if(on){var pid=state.cooldownPoolId;var pool=(pid&&STORY&&STORY.eventPools)?STORY.eventPools[pid]:null;if(pool&&pool.link) setImageLink(pool.link);}}catch(e){}})(); var di = $("#day-indicator"); if (di) di.textContent = "Этап " + state.day + "/6";
  updateHud(); renderFeed();

  var cd = $("#cooldown"), cdt = $("#cd-time");
  if (isInCooldown()) { cd.classList.remove("hidden"); cdt.textContent = fmtHMS(new Date(state.cooldownUntilISO) - Date.now()); }
  else { cd.classList.add("hidden"); }

  var node = findNode(state.nodeId); if (!node) return;
  // Если это концовка — не дублируем текст в пузыре, рисуем только карточку финала
  if (node.type === 'ending') { renderNodeEnding(node); return; }
  try { hideEnding(); hideNextButton(false); } catch(e){}
  try { var b = document.querySelector('.bubble'); if (b) b.classList.remove('hidden'); var chs = document.getElementById('choices'); if (chs) chs.classList.remove('hidden'); } catch(e){}

  if (node.staticImage) setStaticImage(node.staticImage);
  if (node.sound) playSfx(node.sound);

  $("#speaker").textContent = node.speaker || "";
  $("#text").textContent = node.text || "";

  var choices = $("#choices"); choices.innerHTML = "";
  var cont = $("#continue"); cont.classList.add("hidden");
  var contBtn = $("#btn-continue");

  if (!isInCooldown()) {
    if (node.type === "scene") {
      var arr = node.choices || [];
      if (arr.length) {
        arr.forEach(function (ch) {
          var b = el("button"); b.textContent = ch.label; b.dataset.i = String(arr.indexOf(ch)); b.onclick = function () { choose(node, ch); };
          choices.appendChild(b);
        });
      } else if (node.nextId) {
        cont.classList.remove("hidden");
        cont.dataset.nextId = node.nextId;
        contBtn.textContent = node.label || "Далее";
      }
    }
    if (node.type === "info") {
      if (node.cooldownPoolId) state.cooldownPoolId = node.cooldownPoolId; // концовка может выбрать пул
      cont.classList.remove("hidden");
      cont.dataset.nextId = node.nextId;
      contBtn.textContent = node.label || "Далее";
    }
    if (node.type === "ending") { renderNodeEnding(node); return; }
  } else {
    var cc = getCooldownCopy();
    $("#speaker").textContent = cc.title;
    $("#text").textContent = cc.text;
  }
}

function updateHud() {
//   var c = $("#res-currency"), r = $("#res-reputation");
//   if (c) c.textContent = "₽ " + state.resources.currency;
//   if (r) r.textContent = "⭐ " + state.resources.reputation;
}

function choose(node, ch) {
  clearAllEventsUI();
  if (typeof ch.impact !== "undefined") { try { addToHiddenScore(ch.impact); } catch(e){} }

  if (ch.effects) {
    applyEffects(ch.effects);
//     appendFeed("Выбор: " + ch.label, (ch.effects && ch.effects.currency) || 0, (ch.effects && ch.effects.reputation) || 0);
  }
  if (ch.staticImage) setStaticImage(ch.staticImage);
  if (ch.sound) playSfx(ch.sound);

  if (ch.cooldownPoolId) state.cooldownPoolId = ch.cooldownPoolId;
  if (ch.nextDayStartId) state.nextDayStartNodeId = ch.nextDayStartId;

  if (typeof ch.nextId === "string" && ch.nextId.indexOf("__next_event__") === 0) {
    state.nodeId = resolveNextEventId(state.nodeId, ch.nextId);
  } else {
    state.nodeId = ch.nextId || node.nextId;
  }

  ensureBackground(); playClick();
  render(); localStorage.setItem(SAVE_KEY, JSON.stringify(state));
}

function applyEffects(eff) {
  if (!eff || typeof eff !== "object") return;
  if (!state.resources || typeof state.resources !== "object") state.resources = {};
  for (var k in eff) {
    if (!Object.prototype.hasOwnProperty.call(eff, k)) continue;
    var delta = Number(eff[k]) || 0;
    var cur = Number(state.resources[k] || 0);
    state.resources[k] = cur + delta;
  }
}

function goNextContinue() {
  var marker = $("#continue").dataset.nextId;

  if (marker && marker.indexOf("__next_event__") === 0) {
    state.nodeId = resolveNextEventId(state.nodeId, marker);
    render();
    return;
  }
  if (marker && marker.indexOf("__next_day__::") === 0) { state.cooldownPoolId = marker.split("::")[1]; marker = "__next_day__"; }
  if (marker && marker.indexOf("__next_day__:") === 0) { state.nextDayStartNodeId = marker.split(":")[1]; marker = "__next_day__"; }

  if (marker === "__next_day__") {
    state.dayCompleted = true;
    var now = Date.now();
    state.cooldownUntilISO = new Date(now + getCooldownMsForDay(state.day)).toISOString();
    state.nextIdleAtISO = new Date(now + getIdleIntervalMsForDay(state.day)).toISOString();
    state.cooldownOnceSeenIds = [];
    state.cooldownOnceSeenChains = [];
    state.idleCooldowns = {}; // сброс мягких кулдаунов
    state.breakEventFired = false;
    state.idleContext = { chainNextId: null, chainId: null, subPool: null, subLeft: 0 };
    appendFeed("Антон принял решение. Теперь ждем последствий...", 0, 0);
    render(); localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } else {
    state.nodeId = marker; render();
  }
}

// ---------- ticker
function startTicker() { setInterval(tick, 1000); }
function tick() {
  if (state.cooldownUntilISO && new Date(state.cooldownUntilISO) <= new Date()) {
    if (!state.breakEventFired) {
      var be = getDayBreakEvent(state.day);
      if (be) {
        if (be.effects) applyEffects(be.effects);
//         appendFeed(be.text, (be.effects && be.effects.currency) || 0, (be.effects && be.effects.reputation) || 0);
        if (be.staticImage) setStaticImage(be.staticImage);
        if (be.sound) playSfx(be.sound);
      }
      state.breakEventFired = true;
    }
    state.cooldownUntilISO = null;
    state.nextIdleAtISO = null;
    state.cooldownPoolId = null;
    state.idleContext = { chainNextId: null, chainId: null, subPool: null, subLeft: 0 };
    state.idleCooldowns = {};
    if (state.dayCompleted) advanceDay();
    render(); localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return;
  }

  if (isInCooldown()) {
    var now = new Date();
    if (!state.nextIdleAtISO) {
      state.nextIdleAtISO = new Date(now.getTime() + getIdleIntervalMsForDay(state.day)).toISOString();
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    }
    var nextIdle = new Date(state.nextIdleAtISO);
    if (now >= nextIdle) {
      spawnIdleEvent();
      state.nextIdleAtISO = new Date(now.getTime() + getIdleIntervalMsForDay(state.day)).toISOString();
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    }
    var cdt = $("#cd-time"); if (cdt) cdt.textContent = fmtHMS(new Date(state.cooldownUntilISO) - Date.now());
  }
}

// ---------- idle events
function getDayEventsPool(day) {
  if (state.cooldownPoolId && STORY.eventPools && STORY.eventPools[state.cooldownPoolId]) {
    var pool = STORY.eventPools[state.cooldownPoolId];
    if (Array.isArray(pool)) return pool;
    if (pool && Array.isArray(pool.events)) return pool.events;
  }
  var d = getDayObj(day);
  if (d) {
    if (Array.isArray(d.end_day) && d.end_day.length) return d.end_day;
    if (Array.isArray(d.events) && d.events.length) return d.events;
  }
  return STORY.idleEvents || [];
}

function currentIdlePoolArray() {
  if (state.idleContext && state.idleContext.subPool && state.idleContext.subLeft > 0) {
    return state.idleContext.subPool.slice();
  }
  var pool = getDayEventsPool(state.day);
  return Array.isArray(pool) ? pool : [];
}

function findIdleEventById(id) {
  if (!id) return null;
  if (state.idleContext && state.idleContext.subPool) {
    var sp = state.idleContext.subPool;
    var f = sp.find(function (e) { return (e.id || e.text) === id; });
    if (f) return f;
  }
  var arr = getDayEventsPool(state.day);
  arr = Array.isArray(arr) ? arr : [];
  return arr.find(function (e) { return (e.id || e.text) === id; }) || null;
}

function filterAvailableEvents(pool) {
  if (!pool || !pool.length) return [];
  return pool.filter(function (ev) {
    var key = ev.id || ev.text;
    if (ev.once === true && state.cooldownOnceSeenIds.indexOf(key) !== -1) return false;
    if (state.idleCooldowns && state.idleCooldowns[key] > 0) return false; // мягкий кулдаун 3 тика
    // узлы цепочки не попадают случайно, пока цепочка не активна
    if (ev.inChain && (!state.idleContext || state.idleContext.chainId !== ev.inChain)) return false;
    return true;
  });
}

// единообразный «воспроизвести idle-событие»
function fireIdleEvent(chosen) {
  if (chosen.effects) applyEffects(chosen.effects);
  if (chosen.staticImage) setStaticImage(chosen.staticImage);
  (function(){var L=null; if(chosen.link) L=chosen.link; else { try{ if(state.cooldownPoolId&&STORY.eventPools&&STORY.eventPools[state.cooldownPoolId]){var p=STORY.eventPools[state.cooldownPoolId]; if(p&&p.link) L=p.link;}}catch(e){} } if(L) setImageLink(L); else clearImageLink();})();
  if (chosen.sound) playSfx(chosen.sound);
  appendFeed(
    chosen.text,
//     (chosen.effects && chosen.effects.currency) || 0,
//     (chosen.effects && chosen.effects.reputation) || 0
  );
  if (chosen.once === true) {
    var cid = chosen.id || chosen.text;
    if (state.cooldownOnceSeenIds.indexOf(cid) === -1) state.cooldownOnceSeenIds.push(cid);
  }
  // установить мягкий кулдаун на 3 тика
  var key = chosen.id || chosen.text;
  state.idleCooldowns[key] = 3;
}

function spawnIdleEvent() {
  // уменьшить кулдауны
  for (var k in state.idleCooldowns) {
    if (state.idleCooldowns[k] > 0) state.idleCooldowns[k]--;
  }

  // если активна цепочка — исполняем её следующий узел
  if (state.idleContext && state.idleContext.chainNextId) {
    var ev = findIdleEventById(state.idleContext.chainNextId);
    if (ev) {
      fireIdleEvent(ev);
      if (ev.next) {
        state.idleContext.chainNextId = ev.next;
      } else {
        if (state.idleContext.chainId && state.cooldownOnceSeenChains.indexOf(state.idleContext.chainId) === -1) {
          state.cooldownOnceSeenChains.push(state.idleContext.chainId);
        }
        state.idleContext.chainNextId = null;
        state.idleContext.chainId = null;
      }
      // учтём мини-пул
      if (state.idleContext && state.idleContext.subPool && state.idleContext.subLeft > 0) {
        state.idleContext.subLeft -= 1;
        if (state.idleContext.subLeft <= 0) { state.idleContext.subPool = null; state.idleContext.subLeft = 0; }
      }
      return;
    } else {
      state.idleContext.chainNextId = null;
      state.idleContext.chainId = null;
    }
  }

  // выбрать событие из мини-пула или основного
  var basePool = currentIdlePoolArray();
  var pool = filterAvailableEvents(basePool);
  if (pool.length === 0) pool = basePool.slice(); // не залипаем

  if (!pool.length) return;

  // случайный выбор по весам
  var sum = pool.reduce(function (a, b) { return a + (b.weight || 1); }, 0);
  var r = Math.random() * sum, chosen = pool[0];
  for (var i = 0; i < pool.length; i++) {
    r -= (pool[i].weight || 1);
    if (r <= 0) { chosen = pool[i]; break; }
  }

  fireIdleEvent(chosen);

  // запустить цепочку от «первого шага»
  if (chosen.chain && chosen.next) {
    if (state.cooldownOnceSeenChains.indexOf(chosen.chain) === -1) {
      state.idleContext.chainId = chosen.chain;
      state.idleContext.chainNextId = chosen.next;
    }
  }

  // запустить мини-пул локации
  if (chosen.enterPool && Array.isArray(chosen.enterPool.events) && chosen.enterPool.events.length) {
    var cnt = Math.max(1, chosen.enterPool.count || 1);
    state.idleContext.subPool = chosen.enterPool.events.slice();
    state.idleContext.subLeft = cnt;
  }

  // если уже в мини-пуле — убываем счётчик
  if (state.idleContext && state.idleContext.subPool && state.idleContext.subLeft > 0) {
    state.idleContext.subLeft -= 1;
    if (state.idleContext.subLeft <= 0) {
      state.idleContext.subPool = null;
      state.idleContext.subLeft = 0;
    }
  }
}

// ---------- feed / images / mute
function appendFeed(text, dc, dr) {
  var t = new Date(), h = t.getHours(), m = t.getMinutes();
  var stamp = (h < 10 ? "0" + h : "" + h) + ":" + (m < 10 ? "0" + m : "" + m);
  var delta = (dc ? (" ₽" + dc) : "") + (dr ? (" ⭐" + dr) : "");
  state.feed.push({ t: stamp, text: text, delta: delta });
  if (state.feed.length > 50) state.feed.shift();
  renderFeed(); updateHud();
}
function renderFeed() {
  var list = $("#feed-list"); if (!list) return;
  list.innerHTML = "";
  state.feed.forEach(function (f) {
    var item = el("div", "feed-item");
    item.innerHTML = "<div>" + f.text + "</div><small>" + f.t + (f.delta ? (" · " + f.delta) : "") + "</small>";
    list.appendChild(item);
  });
  list.scrollTop = list.scrollHeight;
}
function setStaticImage(src) {
  if (!src) return;
  state.staticImage = src;
  var img = document.getElementById('static-image');
  if (img && img.getAttribute('src') !== src) { img.setAttribute('src', src); }
}
function initStaticImageFromMeta() {
  var ui = getUi();
  var def = ui.defaultImage || (Array.isArray(ui.images) && ui.images[0]);
  if (def) setStaticImage(def);
}
function toggleMute() {
  state.muted = !state.muted;
  var b = document.getElementById('btn-mute');
  if (b) { b.textContent = state.muted ? "🔇" : "🔊"; }
  try { if (state.muted) { if (bgAudio) { bgAudio.pause(); } } else { ensureBackground(); } } catch (e) {}
}
