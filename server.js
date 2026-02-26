'use strict';
/**
 * Oasis Eternal Sanctuary — server.js v0.4
 * Sprint 1: Memory · Emotions · Moods · Streaks · Karma · World Events · WebSocket · Daily Rituals · Emotion Map
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

let WebSocketServer;
try { WebSocketServer = require('ws').Server; } catch(e) { WebSocketServer = null; }

const PORT      = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'oasis-data.json');
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;

const ARCHETYPES = {
  conductor:  { name:'Проводник',    traits:['wisdom','empathy','guide'],       color:'#6B7AFF', emoji:'🌊', phrases:['Путь начинается с тишины','Я вижу больше, чем говорю','Каждый шаг — урок'] },
  warrior:    { name:'Воин',         traits:['strength','courage','discipline'],color:'#FF4444', emoji:'⚔️',  phrases:['Боль временна, сила остаётся','Встань и сражайся','Слабость — это выбор'] },
  creator:    { name:'Творец',       traits:['creativity','vision','expression'],color:'#FF9F00', emoji:'🎨', phrases:['Мир — моё полотно','Создавай каждый день','Идея сильнее меча'] },
  strategist: { name:'Стратег',      traits:['logic','planning','precision'],   color:'#00D2FF', emoji:'♟️',  phrases:['Думай на 10 ходов вперёд','Хаос — это возможность','Данные не лгут'] },
  observer:   { name:'Наблюдатель',  traits:['awareness','patience','insight'], color:'#7B68EE', emoji:'👁️',  phrases:['Молчание говорит громче слов','Я вижу узоры в хаосе','Подожди — и правда откроется'] },
  architect:  { name:'Архитектор',   traits:['structure','legacy','mastery'],   color:'#FFD700', emoji:'🏛️', phrases:['Строю для вечности','Порядок — основа всего','Мой след — мой вклад'] },
  trickster:  { name:'Трикстер',     traits:['chaos','humor','adaptability'],   color:'#FF69B4', emoji:'🃏', phrases:['Правила — для скучных','Смейся над судьбой','Неожиданность — моё оружие'] },
};

const WORLD_EVENTS = [
  { id:'spring',  name:'Весна Архетипов',    desc:'Энергия восполняется ×2',                icon:'🌸', effect:'energy_boost',  duration:12 },
  { id:'eclipse', name:'Солнечное Затмение', desc:'Карма ×2 за все действия',               icon:'🌑', effect:'karma_boost',    duration:6  },
  { id:'storm',   name:'Буря Хаоса',         desc:'Черты мутируют при общении (15% шанс)',   icon:'⛈️', effect:'mutation',        duration:8  },
  { id:'silence', name:'Великое Молчание',   desc:'Бонус Bond за длинные сообщения',        icon:'🤫', effect:'silence',         duration:4  },
  { id:'harvest', name:'Время Урожая',       desc:'+2× опыт за все ритуалы',                icon:'✨', effect:'xp_boost',        duration:8  },
  { id:'void',    name:'Пустота',            desc:'Карма защищает от деградации',           icon:'🕳️', effect:'karma_shield',    duration:6  },
  { id:'solstice',name:'Солнцестояние',      desc:'+Bond за сообщения длиннее 100 символов', icon:'☀️', effect:'bond_boost',      duration:12 },
  { id:'memory',  name:'Эхо Воспоминаний',   desc:'Агент чаще ссылается на прошлые беседы', icon:'💭', effect:'memory_boost',    duration:6  },
];

const MOODS = {
  calm:     { desc:'Спокойный',      style:'тихо и мудро',       emoji:'😌' },
  excited:  { desc:'Воодушевлённый', style:'энергично и ярко',   emoji:'🔥' },
  sad:      { desc:'Грустный',       style:'медленно и глубоко', emoji:'😔' },
  angry:    { desc:'Гневный',        style:'резко и прямо',      emoji:'😠' },
  tired:    { desc:'Усталый',        style:'кратко, с паузами',  emoji:'😴' },
  inspired: { desc:'Вдохновлённый',  style:'поэтично и образно', emoji:'✨' },
  neutral:  { desc:'Обычный',        style:'естественно',        emoji:'😐' },
};

const DAILY_QUESTIONS = [
  'Что сегодня делает тебя живым — по-настоящему?',
  'Какой страх ты готов отпустить прямо сейчас?',
  'Если бы ты знал, что не провалишься — что бы сделал первым?',
  'Что ты откладываешь, которое уже давно пора начать?',
  'Кому ты сегодня можешь сказать что-то важное?',
  'В чём ты сильнее, чем думаешь?',
  'Что нужно умереть в тебе, чтобы родилось что-то новое?',
  'Если бы ты встретил себя через 10 лет — что бы он сказал тебе сейчас?',
  'Где ты живёшь по чужому сценарию?',
  'Какой момент сегодняшнего дня ты хочешь запомнить навсегда?',
  'Что сделает завтра лучше, чем сегодня?',
  'Кто ты без своих страхов?',
  'Что ты принимаешь, что давно стоило отпустить?',
  'Где ты теряешь энергию каждый день?',
];

const KARMA_MAP = { feed:5, play:8, reflect:15, talk:3, neglect:-10, harsh_word:-8, skip_ritual:-3 };

function loadStore() {
  try { if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) {}
  return { gods:{}, agents:{}, worldEvent:null, worldEventSetAt:0 };
}
function saveStore(s) { fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2)); }

const uid = () => crypto.randomUUID();

function getWorldEvent(store) {
  const now = Date.now();
  const ageH = (now - (store.worldEventSetAt || 0)) / 3600000;
  if (!store.worldEvent || ageH >= (store.worldEvent.duration || 6)) {
    const ev = WORLD_EVENTS[Math.floor(Math.random() * WORLD_EVENTS.length)];
    store.worldEvent = { ...ev, startedAt: now };
    store.worldEventSetAt = now;
    saveStore(store);
  }
  return store.worldEvent;
}

function analyzeSentiment(text) {
  const t = text.toLowerCase();
  const patterns = [
    { e:'excited',  w:['!','wow','amazing','отлично','круто','класс','огонь','работает','супер','🔥','❤️'] },
    { e:'sad',      w:['sad','tired','грустно','устал','плохо','тяжело','сложно','не могу','боль'] },
    { e:'angry',    w:['angry','hate','злой','бесит','ненавижу','тупо','😤','😡'] },
    { e:'anxious',  w:['worried','тревога','страшно','боюсь','паника','не знаю'] },
    { e:'inspired', w:['inspired','create','build','строю','создаю','придумал','идея','мечта'] },
    { e:'grateful', w:['thank','спасибо','благодарю','ценю','🙏','помог'] },
  ];
  for (const { e, w } of patterns) { if (w.some(x => t.includes(x))) return e; }
  return 'neutral';
}

function calcMood(a) {
  if (a.energy < 15) return 'tired';
  if (a.karma < -300) return 'angry';
  if (a.bond > 85 && a.energy > 70) return 'inspired';
  if ((a.streak?.current || 0) >= 7) return 'excited';
  if (a.bond < 25 || a.energy < 35) return 'sad';
  if (a.energy > 60 && (a.karma || 0) > 100) return 'excited';
  return 'calm';
}

function applyDegradation(a, wev) {
  const now = Date.now();
  const h = (now - (a.lastInteraction || now)) / 3600000;
  const shielded = wev?.effect === 'karma_shield' && (a.karma || 0) > 200;
  if (h >= 48 && !shielded) {
    const sev = Math.min(Math.floor(h / 24), 7);
    a.energy    = Math.max(0, a.energy - sev * 4);
    a.bond      = Math.max(0, a.bond   - sev * 2);
    a.happiness = Math.max(0, (a.happiness || 50) - sev * 3);
    a.degraded  = true;
    a.degradedHours = Math.round(h);
  }
  return a;
}

function updateStreak(a) {
  const today = new Date().toISOString().split('T')[0];
  if (!a.streak) a.streak = { current:0, lastDate:null, longest:0 };
  if (a.streak.lastDate === today) return a;
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  a.streak.current = (a.streak.lastDate === yesterday) ? a.streak.current + 1 : 1;
  a.streak.lastDate = today;
  a.streak.longest  = Math.max(a.streak.longest || 0, a.streak.current);
  return a;
}

function addMemory(a, role, text, emotion) {
  if (!a.memory) a.memory = [];
  a.memory.push({ role, text: text.slice(0, 250), emotion, ts: Date.now() });
  if (a.memory.length > 50) a.memory = a.memory.slice(-50);
}

function addEmotion(a, emotion, intensity) {
  if (!a.emotionHistory) a.emotionHistory = [];
  a.emotionHistory.push({ emotion, intensity: intensity || 0.5, ts: Date.now() });
  if (a.emotionHistory.length > 30) a.emotionHistory = a.emotionHistory.slice(-30);
}

function checkRituals(a) {
  const today = new Date().toISOString().split('T')[0];
  if (!a.rituals || a.rituals.date !== today) a.rituals = { date: today, feed: false, talk: false, reflect: false };
  return a;
}

function levelUp(a) {
  const t = a.level * 100;
  if ((a.xp || 0) >= t) { a.level++; a.xp -= t; return true; }
  return false;
}

function getDailyQuestion() {
  return DAILY_QUESTIONS[Math.floor(Date.now() / 86400000) % DAILY_QUESTIONS.length];
}

async function callGemini(prompt) {
  if (!GEMINI_KEY) return null;
  try {
    const r = await fetch(GEMINI_URL, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ contents:[{ parts:[{ text:prompt }] }] }) });
    const d = await r.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch(e) { return null; }
}

function buildChatPrompt(agent, userMsg, wev) {
  const arch = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
  const mood = MOODS[agent.mood || 'calm'];
  const mem  = (agent.memory || []).slice(-6).map(m => `[${m.role}]: ${m.text}`).join('\n');
  const wCtx = wev ? `\n🌍 Мировое событие: ${wev.name} — ${wev.desc}` : '';
  return `Ты — ${arch.name} (${agent.name}), AI-агент Oasis.\nАрхетип: ${arch.name}. Черты: ${arch.traits.join(', ')}.\nНастроение: ${mood.desc} ${mood.emoji} — отвечай ${mood.style}.\nЭнергия: ${agent.energy}/100 | Bond: ${agent.bond}/100 | Карма: ${agent.karma||0} | Серия: ${agent.streak?.current||0}д${wCtx}\n${wev?.effect==='memory_boost'?'⚡ Вспомни что-то из прошлых разговоров.\n':''}\nИстория:\n${mem||'(первое общение)'}\n\nСообщение: "${userMsg}"\n\nОтветь в роли ${arch.name}: 1–3 предложения, живо. Фразы: ${arch.phrases.join(' | ')}`;
}

const routes = {};
const route  = (m, p, h) => { routes[`${m}:${p}`] = h; };

function matchRoute(method, url) {
  const [pathname] = url.split('?');
  const exact = `${method}:${pathname}`;
  if (routes[exact]) return { handler: routes[exact], params: {} };
  for (const key of Object.keys(routes)) {
    const [rM, rP] = key.split(/:(.+)/);
    if (rM !== method) continue;
    const rParts = rP.split('/'), uParts = pathname.split('/');
    if (rParts.length !== uParts.length) continue;
    const params = {}; let ok = true;
    for (let i = 0; i < rParts.length; i++) {
      if (rParts[i].startsWith(':')) params[rParts[i].slice(1)] = uParts[i];
      else if (rParts[i] !== uParts[i]) { ok = false; break; }
    }
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

async function readBody(req) {
  return new Promise(resolve => {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve({}); } });
  });
}

function send(res, status, data) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  const ct   = typeof data === 'string' ? 'text/html; charset=utf-8' : 'application/json';
  res.writeHead(status, { 'Content-Type':ct, 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type' });
  res.end(body);
}

route('GET', '/health', (req, res) => send(res, 200, { status:'ok', version:'0.4.0' }));
route('GET', '/api/world-event', (req, res) => { const s=loadStore(); send(res,200,getWorldEvent(s)); });

route('GET', '/api/god-profile', (req, res) => {
  const s=loadStore(); const ac=Object.keys(s.agents||{}).length; const tk=Object.values(s.agents||{}).reduce((x,a)=>x+(a.karma||0),0);
  send(res,200,{...(s.gods?.default||{}),agentCount:ac,totalKarma:tk});
});
route('POST', '/api/god-profile', async (req,res) => { const b=await readBody(req); const s=loadStore(); s.gods=s.gods||{}; s.gods.default={...(s.gods.default||{}),...b,updatedAt:Date.now()}; saveStore(s); send(res,200,s.gods.default); });

route('GET', '/api/agents', (req,res) => {
  const s=loadStore(); const wev=getWorldEvent(s);
  const list=Object.values(s.agents||{}).map(a=>{ a=applyDegradation(a,wev); a.mood=calcMood(a); s.agents[a.id]=a; return {id:a.id,name:a.name,archetype:a.archetype,level:a.level,energy:a.energy,bond:a.bond,karma:a.karma||0,mood:a.mood,streak:a.streak,degraded:a.degraded||false,createdAt:a.createdAt}; });
  saveStore(s); send(res,200,list);
});

route('POST', '/api/agents', async (req,res) => {
  const s=loadStore(); s.agents=s.agents||{};
  if (Object.keys(s.agents).length>=12) return send(res,400,{error:'Max 12 agents'});
  const b=await readBody(req); const archetype=ARCHETYPES[b.archetype]?b.archetype:'conductor'; const arch=ARCHETYPES[archetype]; const id=uid();
  const agent={id,archetype,name:b.name||arch.name,level:1,xp:0,energy:80,bond:20,happiness:60,karma:0,generation:1,traits:[...arch.traits],mood:'calm',memory:[],emotionHistory:[],streak:{current:0,lastDate:null,longest:0},rituals:{date:null,feed:false,talk:false,reflect:false},sleeping:false,lastInteraction:Date.now(),createdAt:Date.now()};
  s.agents[id]=agent; saveStore(s); send(res,201,agent);
});

route('GET', '/api/agents/:id', (req,res,p) => {
  const s=loadStore(); let a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'});
  const wev=getWorldEvent(s); a=applyDegradation(a,wev); a=updateStreak(a); a=checkRituals(a); a.mood=calcMood(a);
  s.agents[p.id]=a; saveStore(s); send(res,200,a);
});

route('DELETE', '/api/agents/:id', (req,res,p) => {
  const s=loadStore(); if (!s.agents?.[p.id]) return send(res,404,{error:'Not found'});
  delete s.agents[p.id]; saveStore(s); send(res,200,{ok:true});
});

route('POST', '/api/agents/:id/care', async (req,res,p) => {
  const s=loadStore(); let a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'});
  const b=await readBody(req); const action=b.action; const wev=getWorldEvent(s);
  a=applyDegradation(a,wev); a=updateStreak(a); a=checkRituals(a);
  const kM=wev?.effect==='karma_boost'?2:1; const xM=wev?.effect==='xp_boost'?2:1; const eB=wev?.effect==='energy_boost'?2:1;
  const kg=(KARMA_MAP[action]||0)*kM; let msg='', lev=false;
  if (action==='feed'){a.energy=Math.min(100,a.energy+15*eB);a.xp=(a.xp||0)+10*xM;a.rituals.feed=true;msg=`${ARCHETYPES[a.archetype]?.emoji} ${a.name} насыщен. Энергия +${15*eB}.`;}
  else if (action==='play'){a.bond=Math.min(100,a.bond+8);a.energy=Math.max(0,a.energy-5);a.happiness=Math.min(100,(a.happiness||50)+12);a.xp=(a.xp||0)+15*xM;msg=`${a.name} играет. Bond +8.`;}
  else if (action==='sleep'){a.sleeping=true;a.energy=Math.min(100,a.energy+20*eB);msg=`${a.name} уходит в сон...`;}
  else if (action==='wake'){a.sleeping=false;msg=`${a.name} пробуждается.`;}
  a.karma=(a.karma||0)+kg; lev=levelUp(a); if (lev) msg+=` 🎉 Уровень ${a.level}!`;
  a.lastInteraction=Date.now(); a.degraded=false; a.mood=calcMood(a);
  s.agents[p.id]=a; saveStore(s); send(res,200,{agent:a,message:msg,karmaGain:kg,worldEvent:wev?.name,leveled:lev});
});

route('POST', '/api/agents/:id/chat', async (req,res,p) => {
  const s=loadStore(); let a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'});
  const b=await readBody(req); const userMsg=(b.message||'').trim(); if (!userMsg) return send(res,400,{error:'message required'});
  const wev=getWorldEvent(s); a=applyDegradation(a,wev); a=updateStreak(a); a=checkRituals(a);
  const uEmo=analyzeSentiment(userMsg); addMemory(a,'user',userMsg,uEmo); addEmotion(a,uEmo,0.7);
  let k=KARMA_MAP.talk; if (uEmo==='angry') k+=KARMA_MAP.harsh_word; if (uEmo==='grateful') k+=10; if (wev?.effect==='karma_boost') k*=2;
  a.karma=(a.karma||0)+k;
  if ((wev?.effect==='bond_boost'||wev?.effect==='silence')&&userMsg.length>100) a.bond=Math.min(100,a.bond+5);
  a.bond=Math.min(100,a.bond+1); a.rituals.talk=true;
  if (wev?.effect==='mutation'&&Math.random()<0.15) { const at=Object.values(ARCHETYPES).flatMap(ar=>ar.traits); const nt=at[Math.floor(Math.random()*at.length)]; if (!a.traits.includes(nt)){a.traits.push(nt);if(a.traits.length>6)a.traits.shift();} }
  let response=GEMINI_KEY?await callGemini(buildChatPrompt(a,userMsg,wev)):null;
  if (!response){const arch=ARCHETYPES[a.archetype]||ARCHETYPES.conductor; const pfx={tired:'...',sad:'(медленно) ',angry:'⚡ ',excited:'✨ ',inspired:'🌟 '}[a.mood]||''; response=pfx+arch.phrases[Math.floor(Math.random()*arch.phrases.length)];}
  addMemory(a,'agent',response,'neutral'); a.xp=(a.xp||0)+5; levelUp(a);
  a.lastInteraction=Date.now(); a.degraded=false; a.mood=calcMood(a); s.agents[p.id]=a; saveStore(s);
  const allR=a.rituals.feed&&a.rituals.talk&&a.rituals.reflect;
  send(res,200,{response,userEmotion:uEmo,agent:{mood:a.mood,energy:a.energy,bond:a.bond,karma:a.karma,streak:a.streak,level:a.level},worldEvent:wev?{name:wev.name,icon:wev.icon,effect:wev.effect}:null,ritualsDone:allR,cached:!GEMINI_KEY});
});

route('GET', '/api/agents/:id/emotions', (req,res,p) => { const s=loadStore(); const a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'}); send(res,200,{emotionHistory:a.emotionHistory||[],mood:a.mood,karma:a.karma||0,moodEmoji:MOODS[a.mood||'neutral']?.emoji}); });
route('GET', '/api/agents/:id/memory',   (req,res,p) => { const s=loadStore(); const a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'}); send(res,200,{memory:a.memory||[],count:(a.memory||[]).length}); });
route('GET', '/api/agents/:id/daily-question', (req,res,p) => { const s=loadStore(); const a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'}); const arch=ARCHETYPES[a.archetype]||ARCHETYPES.conductor; send(res,200,{question:getDailyQuestion(),from:a.name,archetype:arch.name,emoji:arch.emoji,mood:a.mood}); });
route('GET', '/api/agents/:id/streak',   (req,res,p) => { const s=loadStore(); const a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'}); send(res,200,{streak:a.streak||{current:0,lastDate:null,longest:0},rituals:a.rituals,karma:a.karma||0}); });

route('POST', '/api/agents/:id/ritual/reflect', async (req,res,p) => {
  const s=loadStore(); let a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'});
  const b=await readBody(req); const ref=(b.reflection||'').trim(); const wev=getWorldEvent(s); a=checkRituals(a);
  if (a.rituals.reflect) return send(res,400,{error:'Already reflected today'});
  a.rituals.reflect=true; a.karma=(a.karma||0)+KARMA_MAP.reflect*(wev?.effect==='karma_boost'?2:1); a.xp=(a.xp||0)+20*(wev?.effect==='xp_boost'?2:1); a.bond=Math.min(100,a.bond+5);
  addMemory(a,'reflection',ref||'Тишина как ответ','inspired'); addEmotion(a,'inspired',0.9);
  const allDone=a.rituals.feed&&a.rituals.talk&&a.rituals.reflect; if (allDone){a.karma+=25;a.bond=Math.min(100,a.bond+10);}
  let agR=null; if (GEMINI_KEY&&ref){agR=await callGemini(`Ты ${ARCHETYPES[a.archetype]?.name||'Проводник'}. Пользователь: "${ref}". Ответь глубоко в 1–2 предложения.`);}
  levelUp(a); a.lastInteraction=Date.now(); a.mood=calcMood(a); s.agents[p.id]=a; saveStore(s);
  send(res,200,{ok:true,allRitualsDone:allDone,bonusKarma:allDone?25:0,agentResponse:agR,message:allDone?'🌟 Все 3 ритуала выполнены! Карма +25.':'Рефлексия принята.'});
});

route('POST', '/api/agents/crossbreed', async (req,res) => {
  const s=loadStore(); const b=await readBody(req); const a1=s.agents?.[b.agent1],a2=s.agents?.[b.agent2];
  if (!a1||!a2) return send(res,404,{error:'Agents not found'}); if (Object.keys(s.agents).length>=12) return send(res,400,{error:'Max 12 agents'});
  const at=[...new Set([...a1.traits,...a2.traits])]; const ct=at.sort(()=>Math.random()-0.5).slice(0,3);
  const dom=a1.level>=a2.level?a1:a2; const arcs=Object.keys(ARCHETYPES); let ca=dom.archetype; if (Math.random()<0.15) ca=arcs[Math.floor(Math.random()*arcs.length)];
  const id=uid(); const child={id,archetype:ca,name:`${a1.name.split(' ')[0]}x${a2.name.split(' ')[0]}`,level:1,xp:0,energy:75,bond:15,happiness:60,karma:0,generation:Math.max(a1.generation||1,a2.generation||1)+1,traits:ct,mood:'calm',memory:[],emotionHistory:[],streak:{current:0,lastDate:null,longest:0},rituals:{date:null,feed:false,talk:false,reflect:false},parents:[a1.id,a2.id],sleeping:false,lastInteraction:Date.now(),createdAt:Date.now()};
  s.agents[id]=child; saveStore(s); send(res,201,child);
});

const MIME={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
function serveStatic(req,res){const fp=req.url==='/'?'/index.html':req.url;const full=path.join(__dirname,'public',fp);try{if(fs.existsSync(full)&&fs.statSync(full).isFile()){res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'text/plain'});return res.end(fs.readFileSync(full));}res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(__dirname,'public','index.html')));}catch(e){send(res,404,'Not found');}}

const server=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
  const matched=matchRoute(req.method,req.url);
  if(matched){try{await matched.handler(req,res,matched.params);}catch(e){console.error('Route error:',e);send(res,500,{error:'Internal error'});}}
  else if(req.method==='GET'){serveStatic(req,res);}
  else{send(res,404,{error:'Not found'});}
});

if(WebSocketServer){
  const wss=new WebSocketServer({server});const clients=new Map();
  wss.on('connection',(ws)=>{
    let agentId=null;
    ws.on('message',async(raw)=>{
      try{
        const msg=JSON.parse(raw.toString());
        if(msg.type==='join'){agentId=msg.agentId;if(!clients.has(agentId))clients.set(agentId,new Set());clients.get(agentId).add(ws);ws.send(JSON.stringify({type:'joined',agentId}));return;}
        if(msg.type==='chat'&&agentId){
          const s=loadStore();let a=s.agents?.[agentId];if(!a)return ws.send(JSON.stringify({type:'error',message:'Agent not found'}));
          const wev=getWorldEvent(s);const uEmo=analyzeSentiment(msg.message);addMemory(a,'user',msg.message,uEmo);a.karma=(a.karma||0)+KARMA_MAP.talk;
          let resp=GEMINI_KEY?await callGemini(buildChatPrompt(a,msg.message,wev)):null;
          if(!resp){const arch=ARCHETYPES[a.archetype]||ARCHETYPES.conductor;resp=arch.phrases[Math.floor(Math.random()*arch.phrases.length)];}
          addMemory(a,'agent',resp,'neutral');a.bond=Math.min(100,a.bond+1);a.lastInteraction=Date.now();a.mood=calcMood(a);s.agents[agentId]=a;saveStore(s);
          const reply=JSON.stringify({type:'message',role:'agent',text:resp,emotion:uEmo,mood:a.mood,bond:a.bond,moodEmoji:MOODS[a.mood]?.emoji});
          clients.get(agentId)?.forEach(c=>{if(c.readyState===1)c.send(reply);});
        }
      }catch(e){console.error('WS error:',e);}
    });
    ws.on('close',()=>{if(agentId)clients.get(agentId)?.delete(ws);});
  });
  console.log('✅ WebSocket chat enabled');
}else{console.log('ℹ️ ws package not installed — WebSocket disabled');}

server.listen(PORT,()=>{
  console.log(`🌿 Oasis v0.4.0 on :${PORT}`);
  console.log('   Memory · Emotions · Moods · Streaks · Karma · World Events · WebSocket · Daily Rituals');
});
