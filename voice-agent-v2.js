'use strict';
/**
 * voice-agent-v2.js — Jarvis Voice Agent v2 для @Provodnikro_bot
 *
 * Fixes v2.1:
 *   - try/catch вокруг всех async вызовов Gemini/ElevenLabs/TTS
 *   - callCount увеличивается только один раз (убрано дублирование из _processText)
 *   - arch.brief_tone исправлено в generateBriefing
 *   - downloadTgFile: лимит 10MB + проверка MIME
 *   - memSessions экспортируется для /reset
 *   - Таймаут 30s на Gemini и ElevenLabs
 *   - Логирование всех ошибок с деталями
 */

const https  = require('https');
const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const GEMINI_KEY      = process.env.GEMINI_API_KEY || '';
const ELEVENLABS_KEY  = process.env.ELEVENLABS_KEY || '';
const DB_PATH         = process.env.DB_PATH || '/tmp/jarvis.db';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB
const API_TIMEOUT_MS  = 30000;            // 30 секунд

const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
const GEMINI_FILES = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_KEY}`;

let db = null;

function initDB() {
  try {
    const Database = require('better-sqlite3');
    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        chat_id    TEXT PRIMARY KEY,
        archetype  TEXT DEFAULT 'conductor',
        voice_on   INTEGER DEFAULT 1,
        call_count INTEGER DEFAULT 0,
        x100_day   INTEGER DEFAULT 0,
        x100_start TEXT,
        notes      TEXT DEFAULT '[]',
        history    TEXT DEFAULT '[]',
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS memories (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id   TEXT,
        note      TEXT,
        created_at TEXT
      );
    `);
    console.log('✅ SQLite DB ready:', DB_PATH);
    return true;
  } catch(e) {
    console.warn('⚠️  better-sqlite3 not available, using in-memory fallback:', e.message);
    return false;
  }
}

// FIX: memSessions экспортируется для /reset
const memSessions = new Map();

function getSession(chatId) {
  const cid = String(chatId);
  if (db) {
    let row = db.prepare('SELECT * FROM sessions WHERE chat_id = ?').get(cid);
    if (!row) {
      db.prepare(`INSERT INTO sessions (chat_id, updated_at) VALUES (?, ?)`).run(cid, new Date().toISOString());
      row = db.prepare('SELECT * FROM sessions WHERE chat_id = ?').get(cid);
    }
    return { chatId: cid, archetype: row.archetype, voiceOn: !!row.voice_on, callCount: row.call_count,
      x100Day: row.x100_day, x100Start: row.x100_start, history: JSON.parse(row.history || '[]') };
  }
  if (!memSessions.has(cid)) {
    memSessions.set(cid, { chatId: cid, archetype: 'conductor', voiceOn: true, callCount: 0, x100Day: 0, x100Start: null, history: [] });
  }
  return memSessions.get(cid);
}

function saveSession(session) {
  if (!db) return;
  db.prepare(`UPDATE sessions SET archetype=?,voice_on=?,call_count=?,x100_day=?,x100_start=?,history=?,updated_at=? WHERE chat_id=?`).run(
    session.archetype, session.voiceOn?1:0, session.callCount, session.x100Day, session.x100Start,
    JSON.stringify((session.history||[]).slice(-20)), new Date().toISOString(), session.chatId);
}

function clearSession(chatId) {
  const cid = String(chatId);
  if (db) {
    db.prepare(`DELETE FROM sessions WHERE chat_id=?`).run(cid);
    db.prepare(`DELETE FROM memories WHERE chat_id=?`).run(cid);
  }
  memSessions.delete(cid);
}

function saveMemory(chatId, note) {
  if (db) db.prepare('INSERT INTO memories (chat_id,note,created_at) VALUES (?,?,?)').run(String(chatId), note, new Date().toISOString());
}

function getMemories(chatId, limit=5) {
  if (!db) return [];
  return db.prepare('SELECT note FROM memories WHERE chat_id=? ORDER BY id DESC LIMIT ?').all(String(chatId),limit).map(r=>r.note);
}

function addToHistory(session, role, text) {
  session.history = session.history || [];
  session.history.push({ role, text: text.slice(0,600), ts: Date.now() });
  if (session.history.length > 20) session.history = session.history.slice(-20);
}

function getX100Day(session) {
  if (!session.x100Start) return null;
  const days = Math.floor((new Date() - new Date(session.x100Start)) / 86400000) + 1;
  return Math.min(days, 100);
}

function startX100(session) {
  session.x100Start = new Date().toISOString();
  session.x100Day = 1;
  saveSession(session);
}

function getX100Phase(day) {
  if (!day) return null;
  if (day <= 25) return { name: 'Пробуждение', emoji: '🌅', hint: 'Ты только начинаешь. Каждый день — открытие.' };
  if (day <= 50) return { name: 'Углубление', emoji: '🌊', hint: 'Паттерны становятся видимее. Держи курс.' };
  if (day <= 75) return { name: 'Интеграция', emoji: '⚡', hint: 'Новая ты уже формируется. Не сворачивай.' };
  return { name: 'Мастерство', emoji: '🏛️', hint: 'Финал близко. Это уже часть тебя.' };
}

const ARCHETYPES = {
  conductor: { name: 'Проводник', emoji: '🌊', elevenlabs_voice: 'EXAVITQu4vr4xnSDxMaL', tts_lang: 'ru',
    system: `Ты Проводник — мудрый AI-наставник. Джарвис Ростислава. Отвечай глубоко, кратко (1–3 предложения).`,
    phrases: ['Путь начинается с тишины.', 'Я вижу больше, чем говорю.', 'Каждый шаг — урок.'], brief_tone: 'мудро и спокойно' },
  warrior: { name: 'Воин', emoji: '⚔️', elevenlabs_voice: 'VR6AewLTigWG4xSOukaG', tts_lang: 'ru',
    system: `Ты Воин — прямой, резкий. Джарвис Ростислава. Мотивируешь действием. Даёшь один шаг.`,
    phrases: ['Встань и сражайся.', 'Боль временна.', 'Слабость — это выбор.'], brief_tone: 'жёстко и по делу' },
  creator: { name: 'Творец', emoji: '🎨', elevenlabs_voice: 'pNInz6obpgDQGcFmaJgB', tts_lang: 'ru',
    system: `Ты Творец — вдохновляющий. Джарвис Ростислава. Генерируй идеи, зажигай.`,
    phrases: ['Мир — моё полотно.', 'Идея сильнее меча.', 'Создавай каждый день.'], brief_tone: 'вдохновляюще и образно' },
  strategist: { name: 'Стратег', emoji: '♟️', elevenlabs_voice: 'TxGEqnHWrfWFTfGW9XjX', tts_lang: 'ru',
    system: `Ты Стратег — аналитик. Джарвис Ростислава. Данные и логика.`,
    phrases: ['Думай на 10 ходов вперёд.', 'Хаос — это возможность.', 'Данные не лгут.'], brief_tone: 'аналитично и структурно' },
  observer: { name: 'Наблюдатель', emoji: '👁️', elevenlabs_voice: 'ErXwobaYiN019PkySvjV', tts_lang: 'ru',
    system: `Ты Наблюдатель — молчаливый. Джарвис Ростислава. Выявляй паттерны.`,
    phrases: ['Молчание говорит громче слов.', 'Я вижу узоры в хаосе.', 'Подожди — правда откроется.'], brief_tone: 'тихо и проницательно' },
  architect: { name: 'Архитектор', emoji: '🏛️', elevenlabs_voice: 'GBv7mTt0atIp3Br8iCZE', tts_lang: 'ru',
    system: `Ты Архитектор — системный. Джарвис Ростислава. Строишь структуры, мыслишь масштабом.`,
    phrases: ['Строю для вечности.', 'Порядок — основа всего.', 'Мой след — мой вклад.'], brief_tone: 'системно и масштабно' },
};

const DEFAULT_ARCHETYPE = 'conductor';
const ARCHETYPE_COMMANDS = { 'проводник':'conductor','воин':'warrior','творец':'creator','стратег':'strategist','наблюдатель':'observer','архитектор':'architect' };

function withTimeout(promise, ms = API_TIMEOUT_MS, label = 'API') {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

function geminiPost(body) {
  const inner = new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(GEMINI_URL, { method:'POST', headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)} }, res => {
      let data = ''; res.on('data',c=>data+=c); res.on('end',()=>{
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`Gemini parse error: ${data.slice(0,200)}`)); }
      });
    });
    req.on('error', e => reject(new Error(`Gemini request error: ${e.message}`)));
    req.write(payload); req.end();
  });
  return withTimeout(inner, API_TIMEOUT_MS, 'Gemini');
}

function downloadTgFile(filePath, token) {
  return new Promise((resolve, reject) => {
    const VALID_MIME_PREFIXES = ['audio/', 'video/'];
    https.get(`https://api.telegram.org/file/bot${token}/${filePath}`, res => {
      if (res.statusCode !== 200) return reject(new Error(`TG download HTTP ${res.statusCode}`));
      const contentType = res.headers['content-type'] || '';
      if (!VALID_MIME_PREFIXES.some(p => contentType.startsWith(p))) {
        return reject(new Error(`Invalid MIME type: ${contentType}`));
      }
      let totalBytes = 0;
      const chunks = [];
      res.on('data', d => {
        totalBytes += d.length;
        if (totalBytes > MAX_AUDIO_BYTES) {
          res.destroy();
          return reject(new Error(`Audio too large: ${totalBytes} bytes (max ${MAX_AUDIO_BYTES})`));
        }
        chunks.push(d);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', e => reject(new Error(`TG download error: ${e.message}`)));
  });
}

function getTgFilePath(fileId, token) {
  return new Promise((resolve, reject) => {
    https.get(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`, res => {
      let d=''; res.on('data',c=>d+=c); res.on('end',()=>{
        try { resolve(JSON.parse(d)?.result?.file_path||null); }
        catch(e) { reject(new Error(`getFile parse error: ${e.message}`)); }
      });
    }).on('error', e => reject(new Error(`getFile error: ${e.message}`)));
  });
}

async function uploadAudio(buffer, mime='audio/ogg') {
  return new Promise((resolve, reject) => {
    const boundary='b'+Date.now(), meta=JSON.stringify({file:{mimeType:mime}});
    const head1=`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n`;
    const head2=`--${boundary}\r\nContent-Type: ${mime}\r\nContent-Length: ${buffer.length}\r\n\r\n`;
    const tail=`\r\n--${boundary}--`;
    const body=Buffer.concat([Buffer.from(head1+head2),buffer,Buffer.from(tail)]);
    const url=new URL(GEMINI_FILES);
    const req=https.request({hostname:url.hostname,path:url.pathname+url.search,method:'POST',
      headers:{'Content-Type':`multipart/related; boundary=${boundary}`,'Content-Length':body.length,'X-Goog-Upload-Protocol':'multipart'}},
      res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>{
        try { resolve(JSON.parse(data)?.file?.uri||null); }
        catch(e) { reject(new Error(`Upload parse error: ${e.message}`)); }
      });});
    req.on('error', e => reject(new Error(`Upload error: ${e.message}`)));
    req.write(body); req.end();
  });
}

async function transcribeAudio(buffer, mime='audio/ogg') {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY не задан');
  const uri = await withTimeout(uploadAudio(buffer, mime), API_TIMEOUT_MS, 'UploadAudio');
  if (!uri) throw new Error('Upload failed — no URI returned');
  const res = await geminiPost({ contents:[{parts:[{fileData:{mimeType:mime,fileUri:uri}},{text:'Transcribe this audio. Output ONLY the transcription, nothing else.'}]}] });
  return res?.candidates?.[0]?.content?.parts?.[0]?.text?.trim()||null;
}

async function thinkAgent(session, userText) {
  const arch=ARCHETYPES[session.archetype]||ARCHETYPES[DEFAULT_ARCHETYPE];
  const x100d=getX100Day(session), phase=getX100Phase(x100d), memos=getMemories(session.chatId,3);
  session.callCount=(session.callCount||0)+1;
  const historyStr=(session.history||[]).slice(-6).map(h=>`[${h.role==='user'?'Ростислав':arch.name}]: ${h.text}`).join('\n');
  const x100ctx=x100d?`День ${x100d}/100. Фаза: ${phase.name} ${phase.emoji}. ${phase.hint}`:'X100 не запущена.';
  const memosCtx=memos.length?`\nЗаметки: ${memos.join(' | ')}`:'';
  const prompt=`${arch.system}\n\nО пользователе:\n- Имя: Ростислав (Проводник X100)\n- Проекты: X100 OASIS, Oasis Eternal Sanctuary, GodLocal, Solana Sniper Bot\n- Контекст: ${x100ctx}${memosCtx}\n\nПравила: макс 2 предложения, без вводных, язык пользователя, давай действие.\n\nИстория:\n${historyStr||'(начало)'}\n\nРостислав: "${userText}"\n${arch.name}:`;
  try {
    const res = await geminiPost({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:250,temperature:0.85}});
    return res?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || arch.phrases[session.callCount % 3];
  } catch(e) {
    console.error(`[thinkAgent] Gemini error for chat ${session.chatId}:`, e.message);
    return arch.phrases[session.callCount % 3];
  }
}

function splitToChunks(text, maxLen=190) {
  const sentences=text.match(/[^.!?]+[.!?]*/g)||[text];
  const chunks=[]; let current='';
  for (const s of sentences) {
    if ((current+s).length<=maxLen) { current+=s; }
    else { if(current) chunks.push(current.trim()); current=s.length<=maxLen?s:s.slice(0,maxLen); }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(c=>c.length>2);
}

function elevenLabsTTS(text, voiceId) {
  const inner = new Promise((resolve, reject) => {
    if (!ELEVENLABS_KEY||!voiceId) return reject(new Error('No ElevenLabs key/voiceId'));
    const payload=JSON.stringify({text,model_id:'eleven_multilingual_v2',voice_settings:{stability:0.5,similarity_boost:0.75}});
    const req=https.request({hostname:'api.elevenlabs.io',path:`/v1/text-to-speech/${voiceId}`,method:'POST',
      headers:{'Accept':'audio/mpeg','Content-Type':'application/json','xi-api-key':ELEVENLABS_KEY,'Content-Length':Buffer.byteLength(payload)}},
      res=>{
        if(res.statusCode!==200) {
          let errBody=''; res.on('data',c=>errBody+=c);
          res.on('end',()=>reject(new Error(`ElevenLabs HTTP ${res.statusCode}: ${errBody.slice(0,200)}`)));
          return;
        }
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks)));
      });
    req.on('error', e => reject(new Error(`ElevenLabs request error: ${e.message}`)));
    req.write(payload); req.end();
  });
  return withTimeout(inner, API_TIMEOUT_MS, 'ElevenLabs');
}

function googleTTS(text, lang='ru') {
  const inner = new Promise((resolve, reject) => {
    const enc=encodeURIComponent(text.slice(0,190));
    const url=`https://translate.google.com/translate_tts?ie=UTF-8&q=${enc}&tl=${lang}&client=tw-ob`;
    https.get(url,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://translate.google.com/'}},res=>{
      if(res.statusCode!==200) return reject(new Error(`Google TTS HTTP ${res.statusCode}`));
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(Buffer.concat(chunks)));
    }).on('error', e => reject(new Error(`Google TTS error: ${e.message}`)));
  });
  return withTimeout(inner, API_TIMEOUT_MS, 'GoogleTTS');
}

async function synthesize(text, archetype) {
  const arch=ARCHETYPES[archetype]||ARCHETYPES[DEFAULT_ARCHETYPE];
  const chunks=splitToChunks(text); const buffers=[];
  for (const chunk of chunks) {
    try { buffers.push(await elevenLabsTTS(chunk, arch.elevenlabs_voice)); }
    catch(e1) {
      console.error('[synthesize] ElevenLabs failed, trying Google TTS:', e1.message);
      try { buffers.push(await googleTTS(chunk, arch.tts_lang)); }
      catch(e2) { console.error('[synthesize] Google TTS also failed:', e2.message); }
    }
  }
  return buffers;
}

function detectArchetypeSwitch(text) {
  const lower=text.toLowerCase();
  for (const [kw,arch] of Object.entries(ARCHETYPE_COMMANDS)) {
    if (lower.includes(`переключись на ${kw}`)||lower.includes(`стань ${kw}`)||lower.includes(`режим ${kw}`)) return arch;
  }
  return null;
}

function detectVoiceToggle(text) {
  const lower=text.toLowerCase();
  if (lower.includes('отвечай текстом')||lower.includes('без голоса')||lower.includes('только текст')) return 'text';
  if (lower.includes('отвечай голосом')||lower.includes('голосовой режим')||lower.includes('включи голос')) return 'voice';
  return null;
}

function detectMemoryCommand(text) {
  const lower=text.toLowerCase();
  if (lower.startsWith('запомни')||lower.startsWith('запиши')||lower.startsWith('отметь'))
    return text.replace(/^(запомни|запиши|отметь)\s*/i,'').trim();
  return null;
}

async function generateBriefing(session) {
  const arch=ARCHETYPES[session.archetype]||ARCHETYPES[DEFAULT_ARCHETYPE];
  const x100d=getX100Day(session), phase=getX100Phase(x100d), memos=getMemories(session.chatId,3);
  const hour=new Date().getHours();
  const greeting=hour<12?'Доброе утро':hour<18?'Добрый день':'Добрый вечер';
  const toneLine = arch.brief_tone ? `Тон: ${arch.brief_tone}.` : '';
  const prompt=`${arch.system}\n\nСгенерируй голосовой брифинг. ${toneLine}\n1. ${greeting}, Ростислав\n${x100d?`2. День X100: ${x100d}/100, Фаза "${phase.name}" — аффирмация`:'2. Напомни что X100 можно начать (/x100start)'}\n3. Одна задача-фокус (Oasis/GodLocal/Solana)\n${memos.length?`4. Напомни: ${memos.join(', ')}`:''}
5. Фраза архетипа\n\nМакс 5–6 предложений.`;
  try {
    const res = await geminiPost({contents:[{parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:400,temperature:0.9}});
    return res?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || `${greeting}, Ростислав! ${arch.phrases[0]}`;
  } catch(e) {
    console.error('[generateBriefing] Gemini error:', e.message);
    return `${greeting}, Ростислав! ${arch.phrases[0]}`;
  }
}

async function processVoiceMessage(update, token) {
  const msg=update.message, chatId=msg.chat.id, voice=msg.voice||msg.audio;
  if (!voice) throw new Error('No voice/audio in update');
  const session=getSession(chatId);
  try {
    const fp=await getTgFilePath(voice.file_id, token);
    const buf=await downloadTgFile(fp, token);
    let transcription='';
    try { transcription=await transcribeAudio(buf,'audio/ogg'); }
    catch(e) {
      console.error(`[processVoiceMessage] transcribe error [${chatId}]:`, e.message);
      return {text:'⚠️ Не смог распознать. Попробуй снова.',audioBuffers:[],transcription:''};
    }
    if (!transcription||transcription.length<2) return {text:'🎤 Не услышал. Ещё раз?',audioBuffers:[],transcription:''};
    return await _processText(session, transcription, token, true);
  } catch(e) {
    console.error(`[processVoiceMessage] error [${chatId}]:`, e.message);
    return {text:'⚠️ Ошибка обработки голоса. Попробуй снова.',audioBuffers:[],transcription:''};
  }
}

async function processTextMessage(update, token) {
  const msg=update.message, chatId=msg.chat.id, text=(msg.text||'').trim();
  const session=getSession(chatId);
  return await _processText(session, text, token, false);
}

async function _processText(session, text, token, fromVoice) {
  const memNote=detectMemoryCommand(text);
  if (memNote) { saveMemory(session.chatId,memNote); saveSession(session); return {text:`📝 Запомнил: "${memNote}"`,audioBuffers:[],transcription:text}; }
  const switchTo=detectArchetypeSwitch(text);
  if (switchTo) {
    session.archetype=switchTo; const arch=ARCHETYPES[switchTo];
    const reply=`${arch.emoji} Режим ${arch.name}. ${arch.phrases[0]}`;
    saveSession(session);
    const audioBuffers=session.voiceOn?await synthesize(reply,switchTo):[];
    return {text:reply,audioBuffers,transcription:text};
  }
  const voiceToggle=detectVoiceToggle(text);
  if (voiceToggle) {
    session.voiceOn=voiceToggle==='voice'; saveSession(session);
    return {text:session.voiceOn?'🔊 Голосовой режим.':'💬 Текстовый режим.',audioBuffers:[],transcription:text};
  }
  if (text.toLowerCase().includes('/x100start')||text.toLowerCase().includes('начать x100')||text.toLowerCase().includes('старт x100')) {
    startX100(session); const arch=ARCHETYPES[session.archetype];
    const reply=`${arch.emoji} День 1 из 100 начался. X100 OASIS — путь запущен. ${arch.phrases[0]}`;
    saveSession(session); const audioBuffers=session.voiceOn?await synthesize(reply,session.archetype):[];
    return {text:reply,audioBuffers,transcription:text};
  }
  if (text==='/brief'||text.toLowerCase()==='брифинг'||text.toLowerCase()==='что сегодня') {
    const briefText=await generateBriefing(session);
    const audioBuffers=session.voiceOn?await synthesize(briefText,session.archetype).catch(()=>[]):[];
    return {text:briefText,audioBuffers,transcription:text};
  }
  if (text==='/status'||text.toLowerCase()==='статус') {
    const arch=ARCHETYPES[session.archetype],x100d=getX100Day(session),phase=getX100Phase(x100d),memos=getMemories(session.chatId,3);
    const statusText=[`${arch.emoji} Режим: ${arch.name}`,`🔊 Голос: ${session.voiceOn?'вкл':'выкл'}`,`💬 Сообщений: ${session.callCount}`,
      `🧠 Gemini: ${GEMINI_KEY?'✅':'❌'} | ElevenLabs: ${ELEVENLABS_KEY?'✅':'❌'}`,
      x100d?`📅 X100: день ${x100d}/100 — ${phase.name} ${phase.emoji}`:'📅 X100: не запущен (/x100start)',
      memos.length?`📝 Заметки: ${memos.join(', ')}`:''
    ].filter(Boolean).join('\n');
    return {text:statusText,audioBuffers:[],transcription:text};
  }
  addToHistory(session,'user',text);
  const agentReply = await thinkAgent(session, text);
  addToHistory(session,'agent',agentReply);
  saveSession(session);
  const shouldSendVoice=session.voiceOn&&(fromVoice||session.callCount%4===0);
  const audioBuffers=shouldSendVoice?await synthesize(agentReply,session.archetype).catch(()=>[]):[];
  return {text:agentReply,audioBuffers,transcription:text};
}

initDB();

module.exports = {
  processVoiceMessage, processTextMessage, getSession, saveSession, startX100,
  getX100Day, generateBriefing, synthesize, clearSession,
  ARCHETYPES, ARCHETYPE_COMMANDS,
  memSessions
};
