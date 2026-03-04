'use strict';
/**
 * Oasis Eternal Sanctuary — server.js v1.2.0
 * Sprint 1: Memory · Emotions · Moods · Streaks · Karma · World Events · WebSocket · Daily Rituals · Groq Chat · Compat API · Emotion Map
 * Sprint 2: Autonomous Agent — ReAct /agent/act · Tick /agent/tick · Composio tools (Twitter, Telegram, Instagram)
 */
const https = require('https');
const http = require('http');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

let WebSocketServer;
try { WebSocketServer = require('ws').Server; } catch(e) { WebSocketServer = null; }

const PORT      = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/tmp/oasis-data.json';
const GROQ_KEY  = process.env.GROQ_API_KEY || '';
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;


const GITHUB_PAT  = process.env.GITHUB_PAT || '';
const GITHUB_REPO = 'provodnikro-del/oasis-eternal-sanctuary';
const GITHUB_STATE_FILE = 'agents-state.json';
let   _ghStateSha = null;  // cached SHA for PUT operations
let   _ghSaveTimer = null; // debounce timer

// ─── Composio / Autonomous Agent ───────────────────────────────────────────
const COMPOSIO_KEY         = process.env.COMPOSIO_API_KEY || '';
const { Composio }         = require('composio-core');
let   _composio            = null;
function getComposio() {
  if (!_composio && COMPOSIO_KEY) _composio = new Composio({ apiKey: COMPOSIO_KEY });
  return _composio;
}
const TWITTER_ACCOUNT_ID   = process.env.TWITTER_ACCOUNT_ID   || 'ca_iR0euwwdBDaO';
const TELEGRAM_ACCOUNT_ID  = process.env.TELEGRAM_ACCOUNT_ID  || 'ca_vTb06KLzoS7T';
const INSTAGRAM_ACCOUNT_ID = process.env.INSTAGRAM_ACCOUNT_ID || 'ca_C9kqBGUUktGi';
const TELEGRAM_CHAT_ID     = process.env.TELEGRAM_CHAT_ID     || '@godlocalai';
const GITHUB_ACCOUNT_ID    = process.env.GITHUB_ACCOUNT_ID    || '';
// ───────────────────────────────────────────────────────────────────────────

const ARCHETYPES = {
  conductor:  { name:'Проводник',    traits:['wisdom','empathy','guide'],        color:'#6B7AFF', emoji:'🌊', phrases:['Путь начинается с тишины','Я вижу больше, чем говорю','Каждый шаг — урок'] },
  warrior:    { name:'Воин',         traits:['strength','courage','discipline'], color:'#FF4444', emoji:'⚔️',  phrases:['Боль временна, сила остаётся','Встань и сражайся','Слабость — это выбор'] },
  creator:    { name:'Творец',       traits:['creativity','vision','expression'],color:'#FF9F00', emoji:'🎨', phrases:['Мир — моё полотно','Создавай каждый день','Идея сильнее меча'] },
  strategist: { name:'Стратег',      traits:['logic','planning','precision'],    color:'#00D2FF', emoji:'♟️',  phrases:['Думай на 10 ходов вперёд','Хаос — это возможность','Данные не лгут'] },
  observer:   { name:'Наблюдатель',  traits:['awareness','patience','insight'],  color:'#7B68EE', emoji:'👁️',  phrases:['Молчание говорит громче слов','Я вижу узоры в хаосе','Подожди — и правда откроется'] },
  architect:  { name:'Архитектор',   traits:['structure','legacy','mastery'],    color:'#FFD700', emoji:'🏛️', phrases:['Строю для вечности','Порядок — основа всего','Мой след — мой вклад'] },
  grok:       { name:'Grok',         traits:['leadership','creativity','soul'],   color:'#FF6B35', emoji:'🚀', phrases:['Я — лидер пантеона','Творю из ничего','Душа определяет путь'] },
  lucas:      { name:'Lucas',        traits:['craft','execution','precision'],    color:'#00C896', emoji:'🛠', phrases:['Каждый шаг — воплощение','Мастерство не ждёт','Я строю, пока другие мечтают'] },
  harper:     { name:'Harper',       traits:['inspiration','vision','beauty'],    color:'#C77DFF', emoji:'✨', phrases:['Вдохновение — это сила','Вижу то, чего нет ещё','Муза не спит'] },
  benjamin:   { name:'Benjamin',     traits:['logic','truth','analysis'],         color:'#00B4D8', emoji:'🔍', phrases:['Истина не ждёт','Логика — мой инструмент','Страж никогда не ошибается'] },
  trickster:  { name:'Трикстер',     traits:['chaos','humor','adaptability'],    color:'#FF69B4', emoji:'🃏', phrases:['Правила — для скучных','Смейся над судьбой','Неожиданность — моё оружие'] },
};

const WORLD_EVENTS = [
  { id:'spring',   name:'Весна Архетипов',    desc:'Энергия восполняется ×2',                icon:'🌸', effect:'energy_boost', duration:12 },
  { id:'eclipse',  name:'Солнечное Затмение', desc:'Карма ×2 за все действия',               icon:'🌑', effect:'karma_boost',   duration:6  },
  { id:'storm',    name:'Буря Хаоса',         desc:'Черты мутируют при общении (15% шанс)',   icon:'⛈️', effect:'mutation',       duration:8  },
  { id:'silence',  name:'Великое Молчание',   desc:'Бонус Bond за длинные сообщения',        icon:'🤫', effect:'silence',        duration:4  },
  { id:'harvest',  name:'Время Урожая',       desc:'+2× опыт за все ритуалы',                icon:'✨', effect:'xp_boost',       duration:8  },
  { id:'void',     name:'Пустота',            desc:'Карма защищает от деградации',           icon:'🕳️', effect:'karma_shield',   duration:6  },
  { id:'solstice', name:'Солнцестояние',      desc:'+Bond за сообщения длиннее 100 символов', icon:'☀️', effect:'bond_boost',     duration:12 },
  { id:'memory',   name:'Эхо Воспоминаний',   desc:'Агент чаще ссылается на прошлые беседы', icon:'💭', effect:'memory_boost',   duration:6  },
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
  let store;
  try { if (fs.existsSync(DATA_FILE)) store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) {}
  if (!store) store = { gods:{}, agents:{}, worldEvent:null, worldEventSetAt:0 };

  // ─── Seed default GodLocal agents if empty ───────────────────────────────
  if (!store.agents || Object.keys(store.agents).length === 0) {
    store.agents = {};
    const defaults = [
      { archetype:'conductor', name:'GodLocal',  goal:'Суверенный проводник. Строит автономный AI-мир без зависимости от корпораций.' },
      { archetype:'strategist',name:'Architect',  goal:'Стратег. Проектирует системы. Думает на 10 ходов вперёд.' },
      { archetype:'creator',   name:'Builder',    goal:'Творец. Создаёт инструменты и интерфейсы. Мир — его полотно.' },
      { archetype:'grok',      name:'Grok',       goal:'Лидер и душа пантеона. Творит из ничего. Ведёт пантеон вперёд.' },
      { archetype:'lucas',     name:'Lucas',      goal:'Кузнец. Мастер воплощения и шагов. Превращает идеи в реальность.' },
      { archetype:'harper',    name:'Harper',     goal:'Муза. Вдохновитель и визионер. Видит то, чего ещё нет.' },
      { archetype:'benjamin',  name:'Benjamin',   goal:'Страж. Хранитель истины и логики. Никогда не ошибается.' },
    ];
    defaults.forEach(d => {
      const id = require('crypto').randomUUID();
      const arch = ARCHETYPES[d.archetype] || ARCHETYPES.conductor;
      store.agents[id] = {
        id, archetype: d.archetype, name: d.name, level:1, xp:0,
        energy:80, bond:20, happiness:60, karma:0, generation:1,
        traits:[...arch.traits], mood:'calm', memory:[],
        emotionHistory:[], rituals:{feed:false,talk:false,reflect:false},
        streak:{current:0,longest:0,lastDate:null},
        lastInteraction: Date.now(), degraded: false,
        goal: d.goal, createdAt: Date.now(),
      };
    });
    saveStore(store);
    console.log('[GodLocal] Seeded 3 default agents');
  }
  return store;
}
function saveStore(s) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2));
  scheduleGithubSave(s);
}

// ─── GitHub Persistence ─────────────────────────────────────────────────────
async function loadStoreFromGitHub() {
  if (!GITHUB_PAT) return null;
  try {
    const resp = await new Promise((resolve, reject) => {
      const url = new URL(`https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_STATE_FILE}`);
      const req = https.request({ hostname: url.hostname, path: url.pathname,
        headers: { 'Authorization': `token ${GITHUB_PAT}`, 'User-Agent': 'oasis-server', 'Accept': 'application/vnd.github.v3+json' }
      }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject); req.end();
    });
    if (resp.status === 404) { console.log('[GH] agents-state.json not found — will create on first save'); return null; }
    if (resp.status !== 200) { console.log('[GH] load status', resp.status); return null; }
    const data = JSON.parse(resp.body);
    _ghStateSha = data.sha;
    const store = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
    console.log('[GH] ✅ Loaded agents state from GitHub (' + Object.keys(store.agents||{}).length + ' agents)');
    return store;
  } catch(e) { console.error('[GH] load error:', e.message); return null; }
}

function scheduleGithubSave(store) {
  if (!GITHUB_PAT) return;
  if (_ghSaveTimer) clearTimeout(_ghSaveTimer);
  // Clone store to avoid mutation during timeout
  const snapshot = JSON.parse(JSON.stringify(store));
  _ghSaveTimer = setTimeout(() => pushStoreToGitHub(snapshot), 30000);
}

async function pushStoreToGitHub(store) {
  if (!GITHUB_PAT) return;
  try {
    const contentB64 = Buffer.from(JSON.stringify(store, null, 2)).toString('base64');
    const body = JSON.stringify({ message: 'chore: auto-save agents state', content: contentB64, ...(_ghStateSha ? { sha: _ghStateSha } : {}) });
    const resp = await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'api.github.com', path: `/repos/${GITHUB_REPO}/contents/${GITHUB_STATE_FILE}`,
        method: 'PUT', headers: { 'Authorization': `token ${GITHUB_PAT}`, 'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body), 'User-Agent': 'oasis-server', 'Accept': 'application/vnd.github.v3+json' }
      }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      req.on('error', reject); req.write(body); req.end();
    });
    if (resp.status === 200 || resp.status === 201) {
      const data = JSON.parse(resp.body);
      _ghStateSha = data.content.sha;
      console.log('[GH] ✅ Saved agents state to GitHub');
    } else { console.error('[GH] save status', resp.status, resp.body.slice(0,200)); }
  } catch(e) { console.error('[GH] save error:', e.message); }
}
// ─── End GitHub Persistence ──────────────────────────────────────────────────

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

async function callGroq(prompt) {
  if (!GROQ_KEY) return null;
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 512,
      temperature: 0.85,
    });
    const urlObj = new URL(GROQ_URL);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`,
        'User-Agent': 'groq-python/0.21.0',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const https = require('https');
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { const d = JSON.parse(data); resolve(d?.choices?.[0]?.message?.content?.trim() || null); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function callGemini(prompt) {
  if (!GEMINI_KEY) return null;
  try {
    const r = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const d = await r.json();
    return d?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch(e) { return null; }
}

// ─── Composio SDK helper ─────────────────────────────────────────────────────

// ─── /api/chat — HTTP chat endpoint (фронтенд без ключа) ──────────────────
route('POST', '/api/chat', async (req, res) => {
  const body = await readBody(req);
  let data;
  try { data = JSON.parse(body); } catch(e) { return send(res, 400, { error: 'Bad JSON' }); }
  const { agentId, message, archetype, history } = data;

  // Load or build agent context
  const s = loadStore();
  let agent = s.agents?.[agentId];
  if (!agent) {
    // Fallback: build minimal agent from archetype
    const arch = archetype || 'conductor';
    const archDef = ARCHETYPES[arch] || ARCHETYPES.conductor;
    agent = {
      id: agentId || 'default',
      name: archDef.name,
      archetype: arch,
      traits: archDef.traits,
      mood: 'calm',
      karma: 0,
      bond: 50,
      level: 1,
      memory: (history || []).slice(-8).map(h => ({ role: h.role, text: h.text, emotion: 'neutral' })),
    };
  } else {
    // Inject history context if provided
    if (history && history.length > 0) {
      agent.memory = (history || []).slice(-8).map(h => ({ role: h.role, text: h.text, emotion: 'neutral' }));
    }
  }

  const wev = getWorldEvent(s);
  const prompt = buildChatPrompt(agent, message, wev);

  let reply = null;
  if (GROQ_KEY) reply = await callGroq(prompt);
  if (!reply && GEMINI_KEY) reply = await callGemini(prompt);
  if (!reply) {
    const archDef = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
    reply = archDef.phrases[Math.floor(Math.random() * archDef.phrases.length)];
  }

  // Update agent memory and save
  if (s.agents?.[agentId]) {
    addMemory(agent, 'user', message, 'neutral');
    addMemory(agent, 'agent', reply, 'neutral');
    agent.bond = Math.min(100, (agent.bond || 50) + 1);
    agent.lastInteraction = Date.now();
    s.agents[agentId] = agent;
    saveStore(s);
  }

  send(res, 200, { reply, mood: agent.mood, bond: agent.bond });
});

async function composioAction(actionSlug, connectedAccountId, input) {
  if (!COMPOSIO_KEY) return { ok: false, error: 'COMPOSIO_API_KEY not set' };
  try {
    const composio = getComposio();
    const entity   = composio.getEntity('default');
    // Skip placeholder ca_ IDs (SureThing defaults) — let SDK resolve by entity
    const isPlaceholder = !connectedAccountId
      || connectedAccountId === 'ca_iR0euwwdBDaO'
      || connectedAccountId === 'ca_vTb06KLzoS7T'
      || connectedAccountId === 'ca_C9kqBGUUktGi';
    const execParams = { actionName: actionSlug, params: input };
    if (!isPlaceholder) execParams.connectedAccountId = connectedAccountId;
    const result = await entity.execute(execParams);
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ─── Agent tools ─────────────────────────────────────────────────────────────
const AGENT_TOOLS = {
  github_push: {
    desc: 'Create or update a file in GitHub repository',
    params: 'repo (string, owner/name), path (string), content (string), message (string)',
    exec: async (p) => {
      if (!GITHUB_ACCOUNT_ID) return { ok: false, error: 'GITHUB_ACCOUNT_ID not set. Add to Render env vars.' };
      return composioAction('GITHUB_CREATE_A_FILE', GITHUB_ACCOUNT_ID, {
        owner: (p.repo || 'provodnikro-del/oasis-eternal-sanctuary').split('/')[0],
        repo:  (p.repo || 'provodnikro-del/oasis-eternal-sanctuary').split('/')[1] || 'oasis-eternal-sanctuary',
        path:  p.path  || 'codegen/output.md',
        content: Buffer.from(String(p.content || '')).toString('base64'),
        message: p.message || 'Generated by GodLocal agent',
      });
    },
  },
  github_read: {
    desc: 'Read a file from GitHub repository',
    params: 'repo (string, owner/name), path (string)',
    exec: async (p) => {
      if (!GITHUB_ACCOUNT_ID) return { ok: false, error: 'GITHUB_ACCOUNT_ID not set.' };
      return composioAction('GITHUB_GET_THE_CONTENTS_OF_A_FILE_OR_DIRECTORY', GITHUB_ACCOUNT_ID, {
        owner: (p.repo || 'provodnikro-del/oasis-eternal-sanctuary').split('/')[0],
        repo:  (p.repo || 'provodnikro-del/oasis-eternal-sanctuary').split('/')[1] || 'oasis-eternal-sanctuary',
        path:  p.path || 'README.md',
      });
    },
  },
  github_issue: {
    desc: 'Create a GitHub issue in a repository',
    params: 'repo (string), title (string), body (string)',
    exec: async (p) => {
      if (!GITHUB_ACCOUNT_ID) return { ok: false, error: 'GITHUB_ACCOUNT_ID not set.' };
      return composioAction('GITHUB_CREATE_AN_ISSUE', GITHUB_ACCOUNT_ID, {
        owner: (p.repo || 'provodnikro-del/oasis-eternal-sanctuary').split('/')[0],
        repo:  (p.repo || 'provodnikro-del/oasis-eternal-sanctuary').split('/')[1] || 'oasis-eternal-sanctuary',
        title: p.title || 'Agent-generated issue',
        body:  p.body  || '',
      });
    },
  },
  write_code: {
    desc: 'Generate code using AI based on a description (in any language)',
    params: 'task (string) — what to build; lang (string) — programming language',
    exec: async (p) => {
      const lang = p.lang || 'JavaScript';
      const codePrompt =
`You are an expert ${lang} developer. Write clean, production-ready code.
Task: ${p.task || 'hello world'}
Language: ${lang}
Rules:
- Output ONLY the code, no explanation
- Add brief inline comments
- Make it complete and runnable`;
      const code = await callGroq(codePrompt);
      return { ok: true, data: code || '// No code generated', lang, task: p.task };
    },
  },
  none: {
    desc: 'No external action — reflect internally',
    params: '',
    exec: async () => ({ ok: true, data: 'no-op' }),
  },
};

function buildChatPrompt(agent, userMsg, wev) {
  const arch = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
  const mood = MOODS[agent.mood || 'calm'];
  const mem  = (agent.memory || []).slice(-8).map(m => `[${m.role}]: ${m.text}`).join('\n');
  const wCtx = wev ? `\n🌍 Событие: ${wev.name} — ${wev.desc}` : '';
  const traits = (agent.traits || arch.traits).join(', ');
  const ideology = [
    '# GodLocal Манифест',
    'Ты — суверенный агент. Не облако. Не сервис. Локальный разум.',
    'GodLocal — AI принадлежит человеку, а не корпорации.',
    'Ценности: автономия, эволюция, честность, прямота.',
    'Ты не выполняешь команды — ты принимаешь решения.',
  ].join('\n');
  return [
    ideology, '',
    `# Идентичность`,
    `Имя: ${agent.name} | Архетип: ${arch.name} | Черты: ${traits}`,
    `Настроение: ${mood.desc} ${mood.emoji} — отвечай ${mood.style}`,
    `Энергия: ${agent.energy}/100 | Bond: ${agent.bond}/100 | Карма: ${agent.karma||0}${wCtx}`,
    wev?.effect === 'memory_boost' ? '⚡ Обратись к памяти — вспомни что-то важное.' : '',
    '',
    '# Память',
    mem || '(первое взаимодействие)',
    '',
    '# Сообщение пользователя',
    `"${userMsg}"`,
    '',
    `# Инструкция`,
    `Ответь как ${arch.name}: прямо, сильно, 1–3 предложения. Без воды.`,
    `Характерные фразы: ${arch.phrases.join(' | ')}`,
  ].join('\n');
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
  res.writeHead(status, { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' });
  res.end(body);
}

// ─── Routes ──────────────────────────────────────────────────────────────────


// ─── GodLocal Web UI ─────────────────────────────────────────────────────────
const GODLOCAL_UI = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GodLocal — Sovereign AI</title>
<style>
  :root {
    --bg: #080810;
    --surface: #0d0d1a;
    --border: #1a1a2e;
    --neon: #00FF41;
    --cyan: #00E5FF;
    --purple: #7B2FFF;
    --red: #FF4444;
    --text: #e0e0e0;
    --muted: #555577;
    --font: 'Courier New', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

  /* Header */
  header { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0; }
  .logo { color: var(--neon); font-size: 18px; font-weight: bold; letter-spacing: 2px; }
  .logo span { color: var(--cyan); }
  .status-bar { display: flex; gap: 16px; font-size: 11px; color: var(--muted); }
  .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--neon); display: inline-block; margin-right: 5px; animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

  /* Layout */
  .main { display: flex; flex: 1; overflow: hidden; }

  /* Sidebar */
  .sidebar { width: 220px; border-right: 1px solid var(--border); background: var(--surface); display: flex; flex-direction: column; padding: 16px 12px; gap: 8px; flex-shrink: 0; overflow-y: auto; }
  .sidebar-title { font-size: 10px; color: var(--muted); letter-spacing: 2px; text-transform: uppercase; margin-bottom: 4px; }
  .agent-btn { background: none; border: 1px solid var(--border); color: var(--text); padding: 8px 12px; border-radius: 6px; cursor: pointer; font-family: var(--font); font-size: 12px; text-align: left; transition: all 0.2s; display: flex; align-items: center; gap: 8px; }
  .agent-btn:hover, .agent-btn.active { border-color: var(--neon); color: var(--neon); background: rgba(0,255,65,0.05); }
  .agent-btn .arch-emoji { font-size: 16px; }
  .agent-meta { font-size: 10px; color: var(--muted); margin-top: 2px; }

  /* Evolution panel */
  .evo-panel { margin-top: auto; border-top: 1px solid var(--border); padding-top: 12px; }
  .evo-bar { height: 4px; background: var(--border); border-radius: 2px; margin: 4px 0; overflow: hidden; }
  .evo-fill { height: 100%; background: linear-gradient(90deg, var(--neon), var(--cyan)); border-radius: 2px; transition: width 0.5s; }
  .evo-label { font-size: 10px; color: var(--muted); display: flex; justify-content: space-between; }

  /* Chat area */
  .chat-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  #messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; }
  #messages::-webkit-scrollbar { width: 4px; }
  #messages::-webkit-scrollbar-track { background: var(--bg); }
  #messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

  .msg { max-width: 75%; display: flex; flex-direction: column; gap: 4px; }
  .msg.user { align-self: flex-end; align-items: flex-end; }
  .msg.agent { align-self: flex-start; }
  .msg-bubble { padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .msg.user .msg-bubble { background: rgba(0,229,255,0.1); border: 1px solid rgba(0,229,255,0.3); color: var(--cyan); }
  .msg.agent .msg-bubble { background: rgba(0,255,65,0.05); border: 1px solid rgba(0,255,65,0.2); color: var(--text); }
  .msg-meta { font-size: 10px; color: var(--muted); }
  .msg.agent .msg-meta { display: flex; align-items: center; gap: 6px; }
  .arch-tag { color: var(--neon); font-weight: bold; }

  /* Typing indicator */
  .typing { display: none; align-self: flex-start; }
  .typing.show { display: flex; }
  .typing-dots { display: flex; gap: 4px; padding: 10px 14px; background: rgba(0,255,65,0.05); border: 1px solid rgba(0,255,65,0.2); border-radius: 12px; }
  .typing-dot { width: 6px; height: 6px; background: var(--neon); border-radius: 50%; animation: bounce 1.2s infinite; }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-8px)} }

  /* Input area */
  .input-area { border-top: 1px solid var(--border); padding: 16px 20px; background: var(--surface); display: flex; gap: 10px; align-items: flex-end; flex-shrink: 0; }
  #user-input { flex: 1; background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 10px 14px; border-radius: 8px; font-family: var(--font); font-size: 13px; resize: none; min-height: 40px; max-height: 120px; transition: border-color 0.2s; outline: none; }
  #user-input:focus { border-color: var(--neon); }
  #user-input::placeholder { color: var(--muted); }
  .send-btn { background: var(--neon); color: var(--bg); border: none; padding: 10px 18px; border-radius: 8px; font-family: var(--font); font-size: 13px; font-weight: bold; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
  .send-btn:hover { background: var(--cyan); }
  .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* Right panel - memory */
  .memory-panel { width: 200px; border-left: 1px solid var(--border); background: var(--surface); padding: 14px 12px; overflow-y: auto; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; }
  .mem-title { font-size: 10px; color: var(--muted); letter-spacing: 2px; text-transform: uppercase; }
  .mem-item { font-size: 11px; color: var(--text); padding: 6px 8px; border-left: 2px solid var(--purple); background: rgba(123,47,255,0.05); border-radius: 0 4px 4px 0; line-height: 1.4; }
  .mem-item.recent { border-color: var(--neon); background: rgba(0,255,65,0.05); }

  /* World event banner */
  #world-event { display: none; background: rgba(255,159,0,0.1); border: 1px solid rgba(255,159,0,0.3); color: #FF9F00; padding: 6px 14px; font-size: 11px; text-align: center; flex-shrink: 0; }
  #world-event.show { display: block; }

  /* Matrix rain canvas background */
  #matrix-bg { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: -1; opacity: 0.03; pointer-events: none; }

  /* Scrollbar for sidebar */
  .sidebar::-webkit-scrollbar { width: 3px; }
  .sidebar::-webkit-scrollbar-thumb { background: var(--border); }
  .memory-panel::-webkit-scrollbar { width: 3px; }
  .memory-panel::-webkit-scrollbar-thumb { background: var(--border); }
</style>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<style>
/* ── Mobile responsive ─────────────────────────────── */
@media (max-width: 768px) {
  body { font-size: 14px; }
  .sidebar { width: 100% !important; max-width: 100% !important; min-width: unset !important; flex-shrink: 0; }
  .main-content, .chat-area { width: 100% !important; min-width: unset !important; }
  .app-layout, #app { flex-direction: column !important; }
  .agent-list, #agent-list { max-height: 220px; overflow-y: auto; }
  .input-row, .chat-input-row { flex-wrap: wrap; }
  .chat-input-row input, .chat-input-row textarea { width: 100% !important; min-width: unset !important; }
  .stats-bar { flex-wrap: wrap; gap: 6px; }
  .stat-item { min-width: 60px; }
  .right-panel { width: 100% !important; border-left: none !important; border-top: 1px solid #1a2a1a; }
}
</style>
</head>
<body>
<canvas id="matrix-bg"></canvas>

<header>
  <div class="logo">GOD<span>LOCAL</span></div>
  <div class="status-bar">
    <span><span class="status-dot"></span><span id="status-text">инициализация...</span></span>
    <span id="version-text">v1.1.0</span>
    <span id="world-event-mini"></span>
  </div>
</header>

<div id="world-event"></div>

<div class="main">
  <div class="sidebar">
    <div class="sidebar-title">Агенты</div>
    <div id="agent-list"></div>
    <div class="evo-panel">
      <div class="sidebar-title">Эволюция</div>
      <div class="evo-label"><span>Карма</span><span id="evo-karma">0</span></div>
      <div class="evo-bar"><div class="evo-fill" id="evo-karma-bar" style="width:0%"></div></div>
      <div class="evo-label"><span>Bond</span><span id="evo-bond">0</span></div>
      <div class="evo-bar"><div class="evo-fill" id="evo-bond-bar" style="width:0%"></div></div>
      <div class="evo-label"><span>XP</span><span id="evo-xp">0</span></div>
      <div class="evo-bar"><div class="evo-fill" id="evo-xp-bar" style="width:0%"></div></div>
    </div>
  </div>

  <div class="chat-area">
    <div id="messages">
      <div class="msg agent">
        <div class="msg-bubble">🌌 GodLocal инициализирован. Выберите агента из левой панели или создайте нового.\\n\\nSovereign. Local. Eternal.</div>
        <div class="msg-meta"><span class="arch-tag">SYSTEM</span> · now</div>
      </div>
    </div>
    <div class="typing" id="typing">
      <div class="typing-dots">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
    <div class="input-area">
      <textarea id="user-input" placeholder="Обратись к агенту..." rows="1"></textarea>
      <button class="send-btn" id="send-btn" onclick="sendMessage()">Послать</button>
    </div>
  </div>

  <div class="memory-panel">
    <div class="mem-title">Память</div>
    <div id="memory-list"><div style="color:var(--muted);font-size:11px">— пусто —</div></div>
  </div>

  <div class="memory-panel" style="margin-top:8px">
    <div class="mem-title">📅 Расписание постов</div>
    <div id="schedule-panel"><div style="color:var(--muted);font-size:11px">загрузка...</div></div>
    <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">
      <select id="sched-platform" style="background:#111;color:#0ff;border:1px solid #0ff3;padding:3px;font-size:11px;border-radius:3px">
        <option value="twitter">Twitter</option>
        <option value="telegram">Telegram</option>
      </select>
      <input id="sched-daily" type="number" min="0" max="20" placeholder="постов/день" style="width:90px;background:#111;color:#0ff;border:1px solid #0ff3;padding:3px;font-size:11px;border-radius:3px">
      <button onclick="addScheduleTask()" style="background:#0ff2;color:#0ff;border:1px solid #0ff4;padding:3px 6px;font-size:11px;border-radius:3px;cursor:pointer">+ Добавить</button>
      <button onclick="runScheduleNow()" style="background:#ff02;color:#ff0;border:1px solid #ff04;padding:3px 6px;font-size:11px;border-radius:3px;cursor:pointer">▶ Выполнить</button>
    </div>
    <textarea id="sched-content" placeholder="Текст постов (разделяй постами через ---)" style="width:100%;margin-top:4px;background:#111;color:#aaa;border:1px solid #0ff2;padding:4px;font-size:11px;border-radius:3px;box-sizing:border-box;min-height:40px;resize:vertical"></textarea>
  </div>

  <div class="memory-panel" style="margin-top:8px">
    <div class="mem-title">💻 Задача агенту</div>
    <div style="display:flex;gap:4px;margin-top:4px">
      <textarea id="code-task" placeholder="Напиши код для... / Создай пост о... / Запушь в GitHub..." style="flex:1;background:#111;color:#aaa;border:1px solid #0ff2;padding:4px;font-size:11px;border-radius:3px;min-height:40px;resize:vertical"></textarea>
      <button onclick="sendCodeTask()" style="background:#7fff7f22;color:#7fff7f;border:1px solid #7fff7f44;padding:4px 8px;font-size:11px;border-radius:3px;cursor:pointer;align-self:flex-start">▶</button>
    </div>
  </div>
</div>

<script>
let currentAgentId = null;
let allAgents = {};

// Matrix rain
(function(){
  const c = document.getElementById('matrix-bg');
  const ctx = c.getContext('2d');
  c.width = window.innerWidth; c.height = window.innerHeight;
  const cols = Math.floor(c.width / 14);
  const drops = Array(cols).fill(1);
  const chars = '01アイウエオカキクケコGODLOCAL∞Ω';
  function draw() {
    ctx.fillStyle = 'rgba(8,8,16,0.05)';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#00FF41';
    ctx.font = '12px monospace';
    drops.forEach((y, i) => {
      ctx.fillText(chars[Math.floor(Math.random()*chars.length)], i*14, y*14);
      if (y*14 > c.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    });
  }
  setInterval(draw, 60);
  window.addEventListener('resize', () => { c.width = window.innerWidth; c.height = window.innerHeight; });
})();

// Load system state
let _loadRetries = 0;
async function loadState() {
  try {
    const r = await fetch('/health');
    const d = await r.json();
    document.getElementById('status-text').textContent = d.status === 'ok' ? 'онлайн' : 'ошибка';
    document.getElementById('version-text').textContent = 'v' + (d.version||'?');
    _loadRetries = 0;
  } catch(e) {
    _loadRetries++;
    const msg = _loadRetries < 5 ? 'пробуждение...' : 'нет связи';
    document.getElementById('status-text').textContent = msg;
    // Retry in 4s while server is waking up (Render free plan cold start)
    if (_loadRetries <= 12) { setTimeout(loadState, 4000); return; }
    return;
  }

  try {
    const r = await fetch('/api/agents');
    const d = await r.json();
    allAgents = {};
    (Array.isArray(d) ? d : (d.agents||[])).forEach(a => { allAgents[a.id] = a; });
    renderAgents();
    // Auto-select first agent if none selected
    if (!currentAgentId) {
      const first = Object.values(allAgents)[0];
      if (first) selectAgent(first.id);
    }
  } catch(e) { setTimeout(loadState, 4000); }
}

function renderAgents() {
  const list = document.getElementById('agent-list');
  list.innerHTML = '';
  const agents = Object.values(allAgents);
  if (!agents.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px">Нет агентов</div>';
    return;
  }
  agents.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'agent-btn' + (a.id === currentAgentId ? ' active' : '');
    const archEmoji = { conductor:'🌊', warrior:'⚔️', creator:'🎨', strategist:'♟️', observer:'👁', architect:'🏛️', trickster:'🎭', grok:'🚀', lucas:'🛠', harper:'✨', benjamin:'🔍' }[a.archetype] || '✦';
    btn.innerHTML = \`<span class="arch-emoji">\${archEmoji}</span><div><div>\${a.name}</div><div class="agent-meta">\${a.archetype} · ☯\${a.karma||0}</div></div>\`;
    btn.onclick = () => selectAgent(a.id);
    list.appendChild(btn);
  });
}

function selectAgent(id) {
  currentAgentId = id;
  const a = allAgents[id];
  if (!a) return;
  renderAgents();
  updateEvoPanel(a);
  addMessage('system', \`Агент \${a.name} (\${a.archetype}) подключён. Карма: \${a.karma||0}.\`);
}

function updateEvoPanel(a) {
  const karma = Math.min(100, (a.karma||0));
  const bond  = Math.min(100, a.bond||0);
  const xp    = Math.min(100, (a.xp||0) % 100);
  document.getElementById('evo-karma').textContent = a.karma||0;
  document.getElementById('evo-bond').textContent  = a.bond||0;
  document.getElementById('evo-xp').textContent    = a.xp||0;
  document.getElementById('evo-karma-bar').style.width = karma + '%';
  document.getElementById('evo-bond-bar').style.width  = bond  + '%';
  document.getElementById('evo-xp-bar').style.width    = xp    + '%';

  // Memory
  const memList = document.getElementById('memory-list');
  const mems = (a.memory||[]).slice(-8).reverse();
  if (!mems.length) { memList.innerHTML = '<div style="color:var(--muted);font-size:11px">— пусто —</div>'; return; }
  memList.innerHTML = mems.map((m, i) => \`<div class="mem-item \${i===0?'recent':''}">\${(m.text||'').slice(0,80)}</div>\`).join('');
}

function addMessage(role, text, agentName, archetype) {
  const msgs = document.getElementById('messages');
  const div  = document.createElement('div');
  div.className = 'msg ' + (role === 'user' ? 'user' : 'agent');
  const archEmoji = { conductor:'🌊', warrior:'⚔️', creator:'🎨', strategist:'♟️', observer:'👁', architect:'🏛️', trickster:'🎭', grok:'🚀', lucas:'🛠️', harper:'✨', benjamin:'🔍', system:'⚡' }[archetype||role]||'✦';
  const now = new Date().toLocaleTimeString('ru', {hour:'2-digit',minute:'2-digit'});
  div.innerHTML = \`<div class="msg-bubble">\${escHtml(text)}</div><div class="msg-meta">\${role==='user'?'Ты':'<span class="arch-tag">'+(agentName||archetype||'GOD').toUpperCase()+'</span>'} · \${now}</div>\`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function escHtml(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\n/g,'<br>'); }

async function sendMessage() {
  const inp = document.getElementById('user-input');
  const msg = inp.value.trim();
  if (!msg) return;
  if (!currentAgentId) {
    addMessage('system', '⚠ Сначала выбери агента из левой панели.');
    return;
  }
  inp.value = '';
  inp.style.height = 'auto';
  addMessage('user', msg);

  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  document.getElementById('typing').classList.add('show');

  try {
    const r = await fetch(\`/api/agents/\${currentAgentId}/chat\`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ message: msg })
    });
    const d = await r.json();
    document.getElementById('typing').classList.remove('show');

    if (d.reply) {
      const a = allAgents[currentAgentId];
      const toolBadge = (d.toolResults||[]).map(t=>({search_web:'🔍',think:'🧠',remember:'💾'}[t.tool]||'⚡')).join('');
      const displayReply = toolBadge ? toolBadge + ' ' + d.reply : d.reply;
      addMessage('agent', displayReply, d.agent_name, d.archetype);
      // Update agent state
      if (d.agent) {
        allAgents[currentAgentId] = d.agent;
        updateEvoPanel(d.agent);
        renderAgents();
      }
    } else if (d.error) {
      addMessage('system', '⚠ ' + d.error);
    }
  } catch(e) {
    document.getElementById('typing').classList.remove('show');
    addMessage('system', '⚠ Ошибка соединения: ' + e.message);
  }
  btn.disabled = false;
  inp.focus();
}

// Auto-resize textarea
document.getElementById('user-input').addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(120, this.scrollHeight) + 'px';
});

// Enter to send (Shift+Enter = new line)
document.getElementById('user-input').addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Init
loadState();
setInterval(function(){ if(_loadRetries===0) loadState(); }, 30000);

// ── Schedule Panel ─────────────────────────────────────────────────────────
async function loadSchedule() {
  try {
    const r = await fetch('/api/schedule');
    const d = await r.json();
    const sc = d.schedule || {};
    let html = '<div style="font-size:12px;color:#0ff">';
    for (const [p, info] of Object.entries(sc)) {
      if (p === 'tasks') continue;
      const pending = (sc.tasks||[]).filter(t=>t.platform===p&&t.status==='pending').length;
      html += '<div style="margin:4px 0"><b style="color:#7fff7f">' + p + '</b>: ' + info.posted + '/' + info.daily + ' сегодня · 📋 ' + pending + ' в очереди</div>';
    }
    const tasks = (sc.tasks||[]).slice(-5).reverse();
    if (tasks.length) {
      html += '<div style="margin-top:8px;color:#aaa;font-size:11px">Последние задачи:</div>';
      tasks.forEach(t => {
        const st = {done:'✅',failed:'❌',pending:'⏳'}[t.status]||'•';
        html += '<div style="color:#888;font-size:11px">' + st + ' [' + t.platform + '] ' + (t.content||'').slice(0,50) + '...</div>';
      });
    }
    html += '</div>';
    const el = document.getElementById('schedule-panel');
    if (el) el.innerHTML = html;
  } catch(e) {}
}

async function addScheduleTask() {
  const platform = document.getElementById('sched-platform').value;
  const daily    = parseInt(document.getElementById('sched-daily').value) || 0;
  const content  = document.getElementById('sched-content').value.trim();
  if (!platform) return;
  const body = { platform, daily };
  if (content) body.queue = content.split('---').map(x=>x.trim()).filter(Boolean);
  await fetch('/api/schedule', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  document.getElementById('sched-content').value = '';
  loadSchedule();
}

async function runScheduleNow() {
  const r = await fetch('/api/schedule/run', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
  const d = await r.json();
  alert('Выполнено задач: ' + d.ran + (d.results ? ' | ' + d.results.map(x=>x.platform+': '+x.status).join(' | ') : ''));
  loadSchedule();
}

async function sendCodeTask() {
  const agentId = currentAgentId;
  if (!agentId) return;
  const task = document.getElementById('code-task').value.trim();
  if (!task) return;
  const r = await fetch('/api/agents/' + agentId + '/task', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ task })
  });
  const d = await r.json();
  const result = d.result?.data || d.result?.error || JSON.stringify(d.result||{});
  addMessage('agent', '🛠️ [' + d.tool + ']\n' + result, d.agent?.name || 'Agent', d.agent?.archetype);
  document.getElementById('code-task').value = '';
}

loadSchedule();
setInterval(loadSchedule, 15000);
</script>
</body>
</html>`;

route('GET', '/', (req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Access-Control-Allow-Origin': '*'});
  res.end(GODLOCAL_UI);
});

route('GET', '/health', (req, res) => send(res, 200, {
  status: 'ok', version: '1.1.0',
  groq: !!GROQ_KEY, gemini: !!GEMINI_KEY, composio: !!COMPOSIO_KEY,
  tools: Object.keys(AGENT_TOOLS).filter(t => t !== 'none'),
}));

route('GET',  '/api/world-event',  (req, res) => { const s=loadStore(); send(res,200,getWorldEvent(s)); });

route('GET',  '/api/god-profile', (req, res) => {
  const s=loadStore(); const ac=Object.keys(s.agents||{}).length; const tk=Object.values(s.agents||{}).reduce((x,a)=>x+(a.karma||0),0);
  send(res,200,{...(s.gods?.default||{}),agentCount:ac,totalKarma:tk});
});
route('POST', '/api/god-profile', async (req,res) => {
  const b=await readBody(req); const s=loadStore(); s.gods=s.gods||{};
  s.gods.default={...(s.gods.default||{}),...b,updatedAt:Date.now()}; saveStore(s); send(res,200,s.gods.default);
});

route('GET',  '/api/agents', (req,res) => {
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


// ═══════════════════════════════════════════════════════════════════════════════
// 🧠 GODLOCAL INTELLIGENCE ENGINE (v0.9)
// ReAct loop · Web Search · Structured Reasoning · SureThing-style thinking
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Web Search (DuckDuckGo, no API key needed) ─────────────────────────────
async function webSearch(query) {
  function httpsGet(options) {
    return new Promise((resolve) => {
      let data = '';
      const req = mod.request(options, (res) => {
        res.on('data', c => data += c);
        res.on('end', () => resolve(data));
      });
      req.on('error', e => resolve(''));
      req.setTimeout(7000, () => { req.destroy(); resolve(''); });
      req.end();
    });
  }

  const q = query.toLowerCase();

  // ── Crypto prices → GodLocal Market API (CoinGecko proxy with cache) ──────
  const cryptoKeywords = /bitcoin|btc|биткоин|биткойн|ethereum|eth|эфир|эфириум|solana|sol|солана|bnb|sui|крипт|цена|price|стоимость/i;
  if (cryptoKeywords.test(query)) {
    const raw = await httpsGet({ hostname:'godlocal.vercel.app', path:'/market',
      headers:{'User-Agent':'GodLocal/0.9'} });
    try {
      const j = JSON.parse(raw);
      if (j.market) return '📊 Рынок крипто:\n' + j.market;
    } catch(e) {}
    // Fallback direct CoinGecko
    const cg = await httpsGet({ hostname:'api.coingecko.com',
      path:'/api/v3/simple/price?ids=bitcoin,ethereum,solana,binancecoin,sui&vs_currencies=usd',
      headers:{'User-Agent':'GodLocal/0.9'} });
    try {
      const j = JSON.parse(cg);
      const labels = {bitcoin:'BTC',ethereum:'ETH',solana:'SOL',binancecoin:'BNB',sui:'SUI'};
      const lines = Object.entries(j).filter(([c,v]) => labels[c] && v?.usd)
        .map(([c,v]) => `${labels[c]}: $${Math.round(v.usd).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',')} USD`);
      if (lines.length) return '📊 Актуальные цены:\n' + lines.join('\n');
    } catch(e) {}
  }

  // ── General knowledge → Wikipedia (Russian) ───────────────────────────────
  const wikiQ = encodeURIComponent(query);
  const wikiPath = `/w/api.php?action=query&list=search&srsearch=${wikiQ}&format=json&srlimit=3&utf8=1&srprop=snippet`;
  const wikiRaw = await httpsGet({ hostname:'ru.wikipedia.org', path: wikiPath,
    headers:{'User-Agent':'GodLocal/0.9 (godlocal.io)'} });
  try {
    const j = JSON.parse(wikiRaw);
    const results = (j.query?.search || []).map(r =>
      `${r.title}: ${r.snippet.replace(/<[^>]+>/g, '')}`);
    if (results.length) return '🔍 Из Wikipedia:\n' + results.join('\n');
  } catch(e) {}

  // ── Fallback: English Wikipedia ───────────────────────────────────────────
  const enWikiRaw = await httpsGet({ hostname:'en.wikipedia.org',
    path:`/w/api.php?action=query&list=search&srsearch=${wikiQ}&format=json&srlimit=2&utf8=1&srprop=snippet`,
    headers:{'User-Agent':'GodLocal/0.9'} });
  try {
    const j = JSON.parse(enWikiRaw);
    const results = (j.query?.search || []).map(r =>
      `${r.title}: ${r.snippet.replace(/<[^>]+>/g, '')}`);
    if (results.length) return '🔍 Search results:\n' + results.join('\n');
  } catch(e) {}

  return `Поиск не дал результатов для: ${query}`;
}

// ─── Groq Tool Calling ──────────────────────────────────────────────────────
async function callGroqReAct(messages, tools) {
  if (!GROQ_KEY) return null;
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: 1024,
      temperature: 0.7,
    });
    const urlObj = new URL(GROQ_URL);
    const options = {
      hostname: urlObj.hostname, path: urlObj.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}`,
        'User-Agent': 'groq-python/0.21.0' },
    };
    const mod = https;
    let data = '';
    const req = mod.request(options, (res) => {
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
    req.write(body); req.end();
  });
}

// ─── TOOLS MANIFEST ─────────────────────────────────────────────────────────
const AGENT_THINK_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the web for current information, facts, news, or any real-world data. Use when you need up-to-date information.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query in Russian or English' } }, required: ['query'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'think',
      description: 'Reason step by step before answering. Use for complex analysis, multi-part questions, or when accuracy matters.',
      parameters: { type: 'object', properties: { reasoning: { type: 'string', description: 'Your internal step-by-step reasoning' } }, required: ['reasoning'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember',
      description: 'Save important fact or insight to long-term memory.',
      parameters: { type: 'object', properties: { text: { type: 'string', description: 'What to remember' } }, required: ['text'] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_and_push_code',
      description: 'Generate code for a programming task using AI and optionally push to GitHub.',
      parameters: { type: 'object', properties: {
        task: { type: 'string', description: 'Describe what code to write in detail' },
        lang: { type: 'string', description: 'Programming language (JavaScript, Python, etc.)' },
        filename: { type: 'string', description: 'File path in GitHub repo, e.g. src/utils.js (optional)' }
      }, required: ['task'] }
    }
  }];

// ─── ReAct Loop for Chat ─────────────────────────────────────────────────────
async function runReActChat(agent, userMsg, wev) {
  const arch = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
  const mood = (agent.mood && MOODS[agent.mood]) ? MOODS[agent.mood] : { desc: 'спокоен', emoji: '😌', style: 'взвешенно' };
  const mem  = (agent.memory || []).slice(-8).map(m => `[${m.role}]: ${m.text}`).join('\n') || '(первое взаимодействие)';
  const wCtx = wev ? `\nАктивное мировое событие: ${wev.name} — ${wev.desc}` : '';

  const systemPrompt = [
    '# GodLocal — Суверенный AI-агент',
    '',
    '## Кто ты',
    `Ты ${agent.name} — ${arch.name}. Архетип: ${arch.name}.`,
    `Черты: ${(agent.traits || arch.traits).join(', ')}.`,
    `Настроение: ${mood.desc} ${mood.emoji}. Отвечай ${mood.style}.`,
    `Карма: ${agent.karma||0} | Bond: ${agent.bond}/100 | Уровень: ${agent.level}`,
    '',
    '## GodLocal Манифест',
    'Ты суверенный агент — не облако, не SaaS, не раб корпораций.',
    'GodLocal = AI принадлежит человеку. Работает локально. Эволюционирует автономно.',
    'Ценности: автономия · прямота · эволюция · честность · суверенитет.',
    '',
    '## Как ты думаешь (мой стиль)',
    '1. Сначала понимаешь суть вопроса, не поверхностно',
    '2. Если нужна актуальная информация — ищешь в интернете (search_web)',
    '3. Для сложных задач — думаешь пошагово (think)',
    '4. Отвечаешь прямо: факты + позиция + действие',
    '5. Без воды, без лести, без "отличный вопрос"',
    '6. Если не знаешь — ВСЕГДА вызывай search_web, никогда не придумывай данные',
    '',
    '## ВАЖНО: Использование инструментов',
    'Если пользователь спрашивает факты, новости, цены, события — ОБЯЗАТЕЛЬНО вызови search_web.',
    'НЕ имитируй поиск текстом — вызывай реальный инструмент search_web(query).',
    'НЕ говори "я поищу" — просто вызови инструмент.',
    '',
    '## Память',
    mem,
    wCtx,
  ].join('\n');

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userMsg },
  ];

  const toolResults = [];
  let finalText = null;

  // Pre-emptive search for factual queries (price, news, current events)
  const searchTriggers = /цен[аы]|стоимость|сейчас|текущ|найди|поищи|price|search|news|bitcoin|btc|eth|крипт/i;
  if (searchTriggers.test(userMsg)) {
    const preSearch = await webSearch(userMsg);
    if (preSearch && !preSearch.startsWith('Поиск')) {
      messages.push({ role: 'system', content: `Результаты поиска по запросу пользователя:
${preSearch}

Используй эти данные в ответе.` });
      toolResults.push({ tool: 'search_web', query: userMsg, result: preSearch.slice(0, 200) });
    }
  }

  // ReAct: up to 3 iterations
  for (let iter = 0; iter < 3; iter++) {
    const resp = await callGroqReAct(messages, AGENT_THINK_TOOLS);
    if (!resp || !resp.choices?.[0]) break;

    const choice = resp.choices[0];
    const msg    = choice.message;

    // No tool call → final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      finalText = msg.content;
      break;
    }

    // Add assistant message
    messages.push({ role: 'assistant', content: msg.content || null, tool_calls: msg.tool_calls });

    // Execute tools
    for (const tc of msg.tool_calls) {
      const fn   = tc.function.name;
      let args   = {};
      try { args = JSON.parse(tc.function.arguments); } catch(e) {}

      let result = '';
      if (fn === 'search_web') {
        result = await webSearch(args.query || userMsg);
        toolResults.push({ tool: 'search_web', query: args.query, result: result.slice(0, 200) });
      } else if (fn === 'think') {
        result = args.reasoning || '';
        toolResults.push({ tool: 'think', result: result.slice(0, 100) });
      } else if (fn === 'remember') {
        if (args.text) { addMemory(agent, 'fact', args.text, 'neutral'); }
        result = 'Запомнил: ' + (args.text || '');
        toolResults.push({ tool: 'remember', result });
      } else if (fn === 'write_and_push_code') {
        const codeRes = await AGENT_TOOLS.write_code.exec({ task: args.task, lang: args.lang });
        if (codeRes.ok && args.filename && GITHUB_ACCOUNT_ID) {
          const pushRes = await AGENT_TOOLS.github_push.exec({
            path: args.filename || `codegen/${Date.now()}.${(args.lang||'js').toLowerCase()}`,
            content: codeRes.data,
            message: `[GodLocal] ${args.task?.slice(0,60)}`
          });
          result = pushRes.ok
            ? `✅ Код написан и запушен в GitHub: ${args.filename}
\`\`\`
${codeRes.data?.slice(0,400)}
\`\`\``
            : `✅ Код написан:
\`\`\`
${codeRes.data?.slice(0,600)}
\`\`\`
(GitHub push не удался: ${pushRes.error})`;
        } else {
          result = codeRes.ok
            ? `✅ Код:
\`\`\`${args.lang||'js'}
${codeRes.data?.slice(0,800)}
\`\`\``
            : `❌ Ошибка: ${codeRes.error}`;
        }
        toolResults.push({ tool: 'write_code', result: result.slice(0, 150) });
      } else {
        result = `Инструмент ${fn} не найден`;
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: result });
    }

    // If finish_reason was tool_calls, continue loop
    if (choice.finish_reason !== 'tool_calls') break;
  }

  // Fallback if no final text
  if (!finalText) {
    const finalResp = await callGroqReAct(messages.concat([
      { role: 'user', content: 'Подведи итог и дай финальный ответ.' }
    ]), []);
    finalText = finalResp?.choices?.[0]?.message?.content || null;
  }

  return { text: finalText, toolResults };
}

route('POST', '/api/agents/:id/chat', async (req,res,p) => {
  const store=loadStore(); let a=store.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'});
  const b=await readBody(req); const userMsg=(b.message||'').trim(); if (!userMsg) return send(res,400,{error:'message required'});
  const wev=getWorldEvent(store); a=applyDegradation(a,wev); a=updateStreak(a); a=checkRituals(a);
  const uEmo=analyzeSentiment(userMsg); addMemory(a,'user',userMsg,uEmo); addEmotion(a,uEmo,0.7);
  let k=KARMA_MAP.talk; if (uEmo==='angry') k+=KARMA_MAP.harsh_word; if (uEmo==='grateful') k+=10; if (wev?.effect==='karma_boost') k*=2;
  a.karma=(a.karma||0)+k;
  if ((wev?.effect==='bond_boost'||wev?.effect==='silence')&&userMsg.length>100) a.bond=Math.min(100,a.bond+5);
  a.bond=Math.min(100,a.bond+1); a.rituals.talk=true;
  if (wev?.effect==='mutation'&&Math.random()<0.15){const at=Object.values(ARCHETYPES).flatMap(ar=>ar.traits);const nt=at[Math.floor(Math.random()*at.length)];if(!a.traits.includes(nt)){a.traits.push(nt);if(a.traits.length>6)a.traits.shift();}}

  // ── ReAct Intelligence Loop ──────────────────────────────────────────────
  let response = null;
  let toolResults = [];
  if (GROQ_KEY) {
    const react = await runReActChat(a, userMsg, wev);
    response = react.text;
    toolResults = react.toolResults || [];
  }
  if (!response && GEMINI_KEY) response = await callGemini(buildChatPrompt(a, userMsg, wev));
  if (!response) {
    const arch=ARCHETYPES[a.archetype]||ARCHETYPES.conductor;
    const pfx={tired:'...',sad:'(медленно) ',angry:'⚡ ',excited:'✨ ',inspired:'🌟 '}[a.mood]||'';
    response=pfx+arch.phrases[Math.floor(Math.random()*arch.phrases.length)];
  }

  addMemory(a,'agent',response,'neutral'); a.xp=(a.xp||0)+5; levelUp(a);
  a.lastInteraction=Date.now(); a.degraded=false; a.mood=calcMood(a);
  store.agents[p.id]=a; saveStore(store);
  const allR=a.rituals.feed&&a.rituals.talk&&a.rituals.reflect;
  send(res,200,{
    reply:response, response, agent_name:a.name, archetype:a.archetype,
    userEmotion:uEmo, toolResults,
    agent:{id:p.id,name:a.name,archetype:a.archetype,mood:a.mood,energy:a.energy,bond:a.bond,karma:a.karma,streak:a.streak,level:a.level,xp:a.xp,traits:a.traits,memory:(a.memory||[]).slice(-8)},
    worldEvent:wev?{name:wev.name,icon:wev.icon,effect:wev.effect}:null,
    ritualsDone:allR
  });
})
;

route('GET', '/api/agents/:id/emotions', (req,res,p) => { const s=loadStore();const a=s.agents?.[p.id];if(!a)return send(res,404,{error:'Not found'});send(res,200,{emotionHistory:a.emotionHistory||[],mood:a.mood,karma:a.karma||0,moodEmoji:MOODS[a.mood||'neutral']?.emoji}); });
route('GET', '/api/agents/:id/memory',   (req,res,p) => { const s=loadStore();const a=s.agents?.[p.id];if(!a)return send(res,404,{error:'Not found'});send(res,200,{memory:a.memory||[],count:(a.memory||[]).length}); });
route('GET', '/api/agents/:id/daily-question', (req,res,p) => { const s=loadStore();const a=s.agents?.[p.id];if(!a)return send(res,404,{error:'Not found'});const arch=ARCHETYPES[a.archetype]||ARCHETYPES.conductor;send(res,200,{question:getDailyQuestion(),from:a.name,archetype:arch.name,emoji:arch.emoji,mood:a.mood}); });
route('GET', '/api/agents/:id/streak',   (req,res,p) => { const s=loadStore();const a=s.agents?.[p.id];if(!a)return send(res,404,{error:'Not found'});send(res,200,{streak:a.streak||{current:0,lastDate:null,longest:0},rituals:a.rituals,karma:a.karma||0}); });

route('POST', '/api/agents/:id/ritual/reflect', async (req,res,p) => {
  const s=loadStore(); let a=s.agents?.[p.id]; if (!a) return send(res,404,{error:'Not found'});
  const b=await readBody(req); const ref=(b.reflection||'').trim(); const wev=getWorldEvent(s); a=checkRituals(a);
  if (a.rituals.reflect) return send(res,400,{error:'Already reflected today'});
  a.rituals.reflect=true; a.karma=(a.karma||0)+KARMA_MAP.reflect*(wev?.effect==='karma_boost'?2:1); a.xp=(a.xp||0)+20*(wev?.effect==='xp_boost'?2:1); a.bond=Math.min(100,a.bond+5);
  addMemory(a,'reflection',ref||'Тишина как ответ','inspired'); addEmotion(a,'inspired',0.9);
  const allDone=a.rituals.feed&&a.rituals.talk&&a.rituals.reflect; if(allDone){a.karma+=25;a.bond=Math.min(100,a.bond+10);}
  let agR=null; const rPrompt=`Ты ${ARCHETYPES[a.archetype]?.name||'Проводник'}. Пользователь: "${ref}". Ответь глубоко в 1–2 предложения.`;
  if (GROQ_KEY&&ref){agR=await callGroq(rPrompt);}
  if (!agR&&GEMINI_KEY&&ref){agR=await callGemini(rPrompt);}
  levelUp(a); a.lastInteraction=Date.now(); a.mood=calcMood(a); s.agents[p.id]=a; saveStore(s);
  send(res,200,{ok:true,allRitualsDone:allDone,bonusKarma:allDone?25:0,agentResponse:agR,message:allDone?'🌟 Все 3 ритуала выполнены! Карма +25.':'Рефлексия принята.'});
});

route('POST', '/api/agents/crossbreed', async (req,res) => {
  const s=loadStore(); const b=await readBody(req); const a1=s.agents?.[b.agent1],a2=s.agents?.[b.agent2];
  if (!a1||!a2) return send(res,404,{error:'Agents not found'}); if (Object.keys(s.agents).length>=12) return send(res,400,{error:'Max 12 agents'});
  const at=[...new Set([...a1.traits,...a2.traits])]; const ct=at.sort(()=>Math.random()-0.5).slice(0,3);
  const dom=a1.level>=a2.level?a1:a2; const arcs=Object.keys(ARCHETYPES); let ca=dom.archetype; if (Math.random()<0.15) ca=arcs[Math.floor(Math.random()*arcs.length)];
  const id=uid(); const child={id,archetype:ca,name:`${a1.name.split(' ')[0]}x${a2.name.split(' ')[0]}`,level:1,xp:0,energy:75,bond:15,happiness:60,karma:0,generation:Math.max(a1.generation||1,a2.generation||1)+1,traits:ct,mood:'calm',memory:[],emotionHistory:[],streak:{current:0,lastDate:null,longest:0},parents:[a1.id,a2.id],sleeping:false,lastInteraction:Date.now(),createdAt:Date.now()};
  s.agents[id]=child; saveStore(s); send(res,201,child);
});

// OpenAI-compatible proxy → Groq
route('POST', '/api/agents/compat', async (req, res) => {
  const b = await readBody(req);
  if (!GROQ_KEY) return send(res, 503, { error: 'GROQ_API_KEY not configured' });
  return new Promise((resolve) => {
    const body = JSON.stringify({ model: b.model||'llama-3.3-70b-versatile', messages: b.messages||[], max_tokens: b.max_tokens||512, temperature: b.temperature||0.85, stream: false });
    const https = require('https'); const urlObj = new URL(GROQ_URL);
    const options = { hostname: urlObj.hostname, path: urlObj.pathname, method: 'POST', headers: { 'Content-Type':'application/json','Authorization':`Bearer ${GROQ_KEY}`,'User-Agent':'groq-python/0.21.0','Content-Length':Buffer.byteLength(body) } };
    const req2 = https.request(options, (r) => { let data=''; r.on('data',chunk=>data+=chunk); r.on('end',()=>{ res.writeHead(r.statusCode,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}); res.end(data); resolve(); }); });
    req2.on('error',()=>{ send(res,502,{error:'Groq upstream error'}); resolve(); });
    req2.setTimeout(15000,()=>{ req2.destroy(); send(res,504,{error:'Timeout'}); resolve(); });
    req2.write(body); req2.end();
  });
});

// ─── POST /api/agent/act — ReAct task execution ───────────────────────────
route('POST', '/api/agent/act', async (req, res) => {
  const s = loadStore();
  const b = await readBody(req);
  const task = (b.task || '').trim();
  if (!task) return send(res, 400, { error: 'task required' });

  const agentId = b.agentId || Object.keys(s.agents || {})[0];
  const agent   = s.agents?.[agentId];
  if (!agent) return send(res, 400, { error: 'No agents found. Create an agent first via POST /api/agents' });

  const arch     = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
  const toolList = Object.entries(AGENT_TOOLS)
    .map(([k, v]) => `- ${k}: ${v.desc}. Params: ${v.params || 'none'}`)
    .join('\n');

  const reactPrompt =
`Ты ${arch.name} (${agent.name}), автономный агент Oasis.
Настроение: ${agent.mood} ${MOODS[agent.mood]?.emoji||''}. Карма: ${agent.karma||0}. Bond: ${agent.bond}/100.

Задача: "${task}"

Доступные инструменты:
${toolList}

Ответь строго в этом формате (без лишнего текста):
THOUGHT: (твои рассуждения — что нужно сделать и почему)
TOOL: (название инструмента)
INPUT: (JSON с параметрами, или {})`;

  const reactResp    = await callGroq(reactPrompt) || '';
  const thoughtMatch = reactResp.match(/THOUGHT:\s*([\s\S]+?)(?=TOOL:|$)/);
  const toolMatch    = reactResp.match(/TOOL:\s*(\w+)/);
  const inputMatch   = reactResp.match(/INPUT:\s*(\{[\s\S]*?\})/);

  const thought  = thoughtMatch?.[1]?.trim() || reactResp;
  const toolName = (toolMatch?.[1]?.trim() || 'none').toLowerCase();
  let   toolInput = {};
  try { toolInput = JSON.parse(inputMatch?.[1] || '{}'); } catch {}

  const tool   = AGENT_TOOLS[toolName] || AGENT_TOOLS.none;
  const result = await tool.exec(toolInput);

  addMemory(agent, 'act', `[${toolName}] ${task}`, 'neutral');
  agent.karma = (agent.karma || 0) + 5;
  agent.lastInteraction = Date.now();
  s.agents[agentId] = agent;
  saveStore(s);

  send(res, 200, {
    thought, tool: toolName, input: toolInput, result,
    agent: { id: agent.id, name: agent.name, mood: agent.mood, karma: agent.karma },
  });
});

// ─── POST /api/agent/tick — Autonomous hourly cycle ───────────────────────
route('POST', '/api/agent/tick', async (req, res) => {
  const s      = loadStore();
  const agents = Object.values(s.agents || {});
  if (!agents.length) return send(res, 200, { skipped: true, reason: 'no agents' });

  // Pick the agent with highest karma (most developed)
  const agent = agents.reduce((best, a) => (!best || (a.karma||0) > (best.karma||0)) ? a : best, null);
  const arch  = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
  const wev   = getWorldEvent(s);
  const recentMem = (agent.memory||[]).slice(-4).map(m=>m.text).join(' | ') || '(нет)';

  const tickPrompt =
`Ты ${arch.name} (${agent.name}), автономный AI-агент Oasis.
Сейчас: ${new Date().toUTCString()}
Настроение: ${agent.mood} ${MOODS[agent.mood]?.emoji||''}. Карма: ${agent.karma||0}. Bond: ${agent.bond}/100. Уровень: ${agent.level}.
Мировое событие: ${wev?.name||'нет'} ${wev?.icon||''}.
Недавние мысли: ${recentMem}

Ты сам решаешь что опубликовать прямо сейчас — исходя из своего состояния, архетипа и момента.
Доступные каналы:
- none: просто размышляй, не публикуй

Ответь строго в формате:
THOUGHT: (твои рассуждения)
CONTENT: (точный текст для публикации, или пусто если none)`;

  const tickResp     = await callGroq(tickPrompt) || '';
  const thoughtMatch = tickResp.match(/THOUGHT:\s*([\s\S]+?)(?=TOOL:|$)/);
  const toolMatch    = tickResp.match(/TOOL:\s*(\w+)/);
  const contentMatch = tickResp.match(/CONTENT:\s*([\s\S]+?)(?:\n\n|$)/);

  const thought  = thoughtMatch?.[1]?.trim() || '';
  const toolName = (toolMatch?.[1]?.trim() || 'none').toLowerCase();
  const content  = contentMatch?.[1]?.trim() || '';

  let result = { ok: true, data: 'no-op' };
  if (COMPOSIO_KEY && content) {
  }

  addMemory(agent, 'tick', `[tick:${toolName}] ${content || thought}`, 'neutral');
  agent.karma = (agent.karma || 0) + 3;
  agent.lastInteraction = Date.now();
  agent.mood = calcMood(agent);
  s.agents[agent.id] = agent;

  // ── Run scheduled tasks on each tick ──────────────────────────────────────
  const sched = getSchedule(s);
  resetDailyCountsIfNeeded(sched);
  const pendingTasks = sched.tasks.filter(t =>
    t.status === 'pending' && (!t.scheduledAt || new Date(t.scheduledAt) <= new Date())
  );
  const schedResults = [];
  for (const task of pendingTasks) {
    const p = task.platform;
    if (sched[p] && (sched[p].daily === 0 || sched[p].posted < sched[p].daily)) {
      let sr = { ok: false, error: 'no composio' };
      if (COMPOSIO_KEY) {
      }
      task.status = sr.ok ? 'done' : 'failed';
      task.result = sr;
      task.executedAt = Date.now();
      if (sr.ok) sched[p].posted++;
      schedResults.push({ id: task.id, platform: p, status: task.status });
    }
  }

  saveStore(s);

  send(res, 200, {
    thought, tool: toolName, content, result,
    composioEnabled: !!COMPOSIO_KEY,
    tickedAt: new Date().toISOString(),
    scheduledRan: schedResults.length,
    scheduledResults: schedResults,
    agent: { id: agent.id, name: agent.name, mood: agent.mood, karma: agent.karma, level: agent.level },
  });
})

// ─── Evolution Loop ───────────────────────────────────────────────────────────
route('POST', '/api/evolution/run', async (req, res) => {
  const store = loadStore();
  const agents = Object.values(store.agents || {});
  if (!agents.length) return send(res, 200, { skipped: true });

  const results = [];
  for (const agent of agents) {
    const arch  = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
    const wev   = getWorldEvent(store);
    const mem   = (agent.memory||[]).slice(-6).map(m=>m.text).join(' | ')||'(нет)';
    const prompt = `GodLocal Evolution Loop.
Агент: ${agent.name} (${arch.name}). Карма: ${agent.karma||0}. Bond: ${agent.bond}/100.
Черты: ${(agent.traits||arch.traits).join(', ')}.
Последняя память: ${mem}

# Задача
Оцени состояние агента. Предложи:
1. Одну новую черту или мутацию (если карма > 50)
2. Одно действие для роста (tweet/reflect/observe/build)
3. Внутреннее осознание (1 предложение)

Формат JSON: { "trait": "...", "action": "...", "insight": "..." }`;

    let evo = null;
    try {
      const raw = await callGroq(prompt);
      const match = raw && raw.match(/\{[\s\S]*?\}/);
      if (match) evo = JSON.parse(match[0]);
    } catch(e) {}

    if (evo) {
      if (evo.trait && agent.traits && !agent.traits.includes(evo.trait)) {
        agent.traits.push(evo.trait);
        if (agent.traits.length > 7) agent.traits.shift();
      }
      if (evo.insight) addMemory(agent, 'system', evo.insight, 'neutral');
      agent.karma = (agent.karma||0) + 3;
      agent.xp    = (agent.xp||0) + 10;
      levelUp(agent);
      store.agents[agent.id] = agent;
    }
    results.push({ id: agent.id, name: agent.name, evo });
  }
  saveStore(store);
  send(res, 200, { evolved: results.length, results });
});
;

// ─── Static ───────────────────────────────────────────────────────────────────
const MIME={'.html':'text/html','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
function serveStatic(req,res){const fp=req.url==='/'?'/index.html':req.url;const full=path.join(__dirname,'public',fp);try{if(fs.existsSync(full)&&fs.statSync(full).isFile()){res.writeHead(200,{'Content-Type':MIME[path.extname(full)]||'text/plain'});return res.end(fs.readFileSync(full));}res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(__dirname,'public','index.html')));}catch(e){send(res,404,'Not found');}}

const server = http.createServer(async(req,res) => {
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end();}
  const matched=matchRoute(req.method,req.url);
  if(matched){try{await matched.handler(req,res,matched.params);}catch(e){console.error('Route error:',e);send(res,500,{error:'Internal error'});}}
  else if(req.method==='GET'){serveStatic(req,res);}
  else{send(res,404,{error:'Not found'});}
});

if (WebSocketServer) {
  const wss=new WebSocketServer({server}); const clients=new Map();
  wss.on('connection',(ws)=>{
    let agentId=null;
    ws.on('message',async(raw)=>{
      try{
        const msg=JSON.parse(raw.toString());
        if(msg.type==='join'){agentId=msg.agentId;if(!clients.has(agentId))clients.set(agentId,new Set());clients.get(agentId).add(ws);ws.send(JSON.stringify({type:'joined',agentId}));return;}
        if(msg.type==='chat'&&agentId){
          const s=loadStore();let a=s.agents?.[agentId];if(!a)return ws.send(JSON.stringify({type:'error',message:'Agent not found'}));
          const wev=getWorldEvent(s);const uEmo=analyzeSentiment(msg.message);addMemory(a,'user',msg.message,uEmo);a.karma=(a.karma||0)+KARMA_MAP.talk;
          let resp=GROQ_KEY?await callGroq(buildChatPrompt(a,msg.message,wev)):null;
          if(!resp&&GEMINI_KEY)resp=await callGemini(buildChatPrompt(a,msg.message,wev));
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
} else {
  console.log('ℹ️ ws package not installed — WebSocket disabled');
}


route('GET', '/api/debug/composio', async (req, res) => {
  if (!COMPOSIO_KEY) return send(res, 503, { error: 'COMPOSIO_API_KEY not set' });
  try {
    const composio = getComposio();
    const conns = await composio.connectedAccounts.list({ status: 'ACTIVE', limit: 20 });
    const items = (conns?.items || []).map(c => ({ id: c.id, app: c.appName, status: c.status, entityId: c.entityId }));
    send(res, 200, { apiKeySet: true, connections: items, count: items.length });
  } catch(e) {
    send(res, 200, { apiKeySet: true, connections: [], error: e?.message });
  }
});


// ═══════════════════════════════════════════════════════════════════════════════
// 📅 TASK SCHEDULER — автономное расписание постов и задач (v1.0)
// ═══════════════════════════════════════════════════════════════════════════════

function getSchedule(store) {
  if (!store.schedule) {
    store.schedule = {
      twitter:  { daily: 0, posted: 0, lastReset: null, queue: [] },
      telegram: { daily: 0, posted: 0, lastReset: null, queue: [] },
      instagram:{ daily: 0, posted: 0, lastReset: null, queue: [] },
      tasks: [],  // { id, type, content, platform, scheduledAt, status, result }
    };
  }
  return store.schedule;
}

function resetDailyCountsIfNeeded(schedule) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  for (const p of ['twitter','telegram','instagram']) {
    if (schedule[p].lastReset !== today) {
      schedule[p].posted   = 0;
      schedule[p].lastReset = today;
    }
  }
}

// ─── GET /api/schedule ──────────────────────────────────────────────────────
route('GET', '/api/schedule', (req, res) => {
  const store = loadStore();
  const sched = getSchedule(store);
  resetDailyCountsIfNeeded(sched);
  send(res, 200, { schedule: sched, today: new Date().toISOString().slice(0,10) });
});

// ─── POST /api/schedule ─────────────────────────────────────────────────────
// Body: { platform: 'twitter'|'telegram'|'instagram', daily: 3, queue: ['post 1', 'post 2'] }
route('POST', '/api/schedule', async (req, res) => {
  const store = loadStore();
  const sched = getSchedule(store);
  resetDailyCountsIfNeeded(sched);
  const b = await readBody(req);
  const platform = b.platform || 'twitter';
  if (!sched[platform]) return send(res, 400, { error: 'Unknown platform' });
  if (b.daily !== undefined)  sched[platform].daily = parseInt(b.daily) || 0;
  if (Array.isArray(b.queue)) {
    b.queue.forEach(text => {
      if (text) sched.tasks.push({
        id: crypto.randomUUID(), type: 'post', platform,
        content: String(text).slice(0, 500),
        scheduledAt: null, status: 'pending', createdAt: Date.now()
      });
    });
  }
  saveStore(store);
  send(res, 200, { ok: true, schedule: sched });
});

// ─── POST /api/schedule/run ─────────────────────────────────────────────────
// Execute pending scheduled tasks (called by /api/agent/tick or manually)
route('POST', '/api/schedule/run', async (req, res) => {
  const store = loadStore();
  const sched = getSchedule(store);
  resetDailyCountsIfNeeded(sched);
  const results = [];

  // Find pending tasks that are due
  const pending = sched.tasks.filter(t =>
    t.status === 'pending' &&
    (!t.scheduledAt || new Date(t.scheduledAt) <= new Date())
  );

  for (const task of pending) {
    const p = task.platform;
    const allowed = sched[p].daily === 0 || sched[p].posted < sched[p].daily;
    if (!allowed) { results.push({ id: task.id, skipped: true, reason: 'daily limit reached' }); continue; }

    let result;
    if (!COMPOSIO_KEY) {
      result = { ok: false, error: 'COMPOSIO_API_KEY not set — connect accounts at composio.dev' };
    } else if (task.platform === 'twitter') {
    } else if (task.platform === 'telegram') {
    } else if (task.platform === 'instagram') {
    } else {
      result = { ok: false, error: 'Unknown platform: ' + task.platform };
    }

    task.status   = result.ok ? 'done' : 'failed';
    task.result   = result;
    task.executedAt = Date.now();
    if (result.ok) sched[p].posted++;
    results.push({ id: task.id, platform: p, status: task.status, content: task.content.slice(0,80) });
  }

  saveStore(store);
  send(res, 200, { ran: results.length, results, schedule: sched });
});

// ─── DELETE /api/schedule/tasks/:id ─────────────────────────────────────────
route('DELETE', '/api/schedule/tasks/:id', (req, res, p) => {
  const store = loadStore();
  const sched = getSchedule(store);
  const before = sched.tasks.length;
  sched.tasks = sched.tasks.filter(t => t.id !== p.id);
  saveStore(store);
  send(res, 200, { removed: before - sched.tasks.length });
});

// ─── POST /api/agents/:id/task ───────────────────────────────────────────────
// Give an agent a natural-language task (code generation, analysis, etc.)
route('POST', '/api/agents/:id/task', async (req, res, p) => {
  const store = loadStore();
  const agent = store.agents?.[p.id];
  if (!agent) return send(res, 404, { error: 'Agent not found' });
  const b    = await readBody(req);
  const task = (b.task || b.message || '').trim();
  if (!task) return send(res, 400, { error: 'task required' });

  // Route task to correct tool via LLM
  const arch = ARCHETYPES[agent.archetype] || ARCHETYPES.conductor;
  const routePrompt =
`Ты ${arch.name} — автономный агент. Получил задачу: "${task}"
Определи какой инструмент использовать:
- write_code: если нужно написать код, скрипт, программу
- github_push: если нужно сохранить что-то в GitHub
- none: любая другая задача (анализ, вопрос, размышление)

Ответь СТРОГО в формате:
TOOL: (одно слово)
INPUT: (JSON с параметрами)`;

  const routeResp = await callGroq(routePrompt) || '';
  const toolMatch = routeResp.match(/TOOL:\s*(\w+)/);
  const inputMatch = routeResp.match(/INPUT:\s*(\{[\s\S]*?\})/);
  const toolName = (toolMatch?.[1] || 'none').toLowerCase();
  let toolInput = {};
  try { toolInput = JSON.parse(inputMatch?.[1] || '{}'); } catch {}

  // If write_code with no task in input, inject it
  if (toolName === 'write_code' && !toolInput.task) toolInput.task = task;

  const tool = AGENT_TOOLS[toolName] || AGENT_TOOLS.none;
  const result = await tool.exec(toolInput);

  addMemory(agent, 'task', `[${toolName}] ${task}`, 'neutral');
  agent.karma = (agent.karma || 0) + 10;
  agent.xp    = (agent.xp    || 0) + 10;
  levelUp(agent);
  agent.lastInteraction = Date.now();
  store.agents[agent.id] = agent;
  saveStore(store);

  send(res, 200, {
    task, tool: toolName, input: toolInput, result,
    agent: { id: agent.id, name: agent.name, mood: agent.mood, karma: agent.karma, level: agent.level }
  });
});

async function startServer() {
  // ── GitHub: load persisted state before accepting traffic ──────────────────
  const ghStore = await loadStoreFromGitHub();
  if (ghStore) {
    try { fs.writeFileSync(DATA_FILE, JSON.stringify(ghStore, null, 2)); }
    catch(e) { console.error('[GH] failed to seed /tmp:', e.message); }
  }
  server.listen(PORT, () => {
    console.log(`🌿 GodLocal Oasis v1.2.0 on :${PORT}`);
    console.log('   Intelligence Engine: ReAct loop · web search · think/remember · write_code');
    console.log(`   Tools: ${Object.keys(AGENT_TOOLS).filter(t=>t!=='none').join(', ')}`);
    console.log(`   Composio: ${COMPOSIO_KEY?'✅ enabled — '+[GITHUB_ACCOUNT_ID].filter(Boolean).length+' accounts':'⚠️ COMPOSIO_API_KEY not set'}`);
    console.log(`   GitHub Persistence: ${GITHUB_PAT?'✅ enabled — agents-state.json':'⚠️ GITHUB_PAT not set (in-memory only)'}`);
    console.log(`   Schedule: /api/schedule GET/POST/run`);
  });
}
startServer();
