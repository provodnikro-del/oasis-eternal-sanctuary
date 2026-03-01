'use strict';
/**
 * voice-bot-v2.js — @Provodnikro_bot v2.1
 *
 * Fixes v2.1:
 *   - require('./voice-agent-v2') вынесен в топ файла (убрана утечка памяти)
 *   - /reset исправлен — использует clearSession() из voice-agent-v2
 *   - WEBHOOK_SECRET требует обязательного env var (нет дефолта)
 *   - setup() проверяет результат setWebhook
 *   - sendVoice оборачивается в try/catch
 *   - toggle:voice обновляет клавиатуру сразу
 */

const https = require('https');
const http  = require('http');

// FIX: require один раз в начале файла (убрана утечка памяти)
const {
  processVoiceMessage,
  processTextMessage,
  getSession,
  saveSession,
  startX100,
  getX100Day,
  generateBriefing,
  synthesize,
  clearSession,
  ARCHETYPES,
  ARCHETYPE_COMMANDS,
} = require('./voice-agent-v2');

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const PORT      = process.env.PORT || 3000;
const APP_URL   = process.env.APP_URL || 'https://x100-voice.onrender.com';

// FIX: WEBHOOK_SECRET обязателен
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BOT_TOKEN)      { console.error('❌ BOT_TOKEN not set'); process.exit(1); }
if (!WEBHOOK_SECRET) { console.error('❌ WEBHOOK_SECRET not set — set it as env var on Render'); process.exit(1); }

async function tgPost(method, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(`tgPost parse: ${e.message}`)); } });
    });
    req.on('error', e => reject(new Error(`tgPost ${method} error: ${e.message}`)));
    req.write(payload);
    req.end();
  });
}

const sendMsg       = (cid, text, extra = {}) => tgPost('sendMessage', { chat_id: cid, text, ...extra });
const sendTyping    = cid => tgPost('sendChatAction', { chat_id: cid, action: 'typing' }).catch(e => console.warn('[sendTyping]', e.message));
const sendRecording = cid => tgPost('sendChatAction', { chat_id: cid, action: 'record_voice' }).catch(e => console.warn('[sendRecording]', e.message));
const answerCallback = (cbId, text = '') => tgPost('answerCallbackQuery', { callback_query_id: cbId, text }).catch(e => console.warn('[answerCallback]', e.message));

// FIX: sendVoice с try/catch
async function sendVoice(chatId, audioBuffer, caption) {
  try {
    return await new Promise((resolve, reject) => {
      const boundary = 'b' + Date.now();
      const meta = `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
      const cap  = caption ? `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.slice(0, 1024)}\r\n` : '';
      const fh   = `--${boundary}\r\nContent-Disposition: form-data; name="voice"; filename="r.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`;
      const tail = `\r\n--${boundary}--`;
      const body = Buffer.concat([Buffer.from(meta + cap + fh), audioBuffer, Buffer.from(tail)]);
      const req = https.request({
        hostname: 'api.telegram.org',
        path: `/bot${BOT_TOKEN}/sendVoice`,
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
      }, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(`sendVoice parse: ${e.message}`)); } });
      });
      req.on('error', e => reject(new Error(`sendVoice request error: ${e.message}`)));
      req.write(body); req.end();
    });
  } catch(e) {
    console.error(`[sendVoice] failed for ${chatId}:`, e.message);
    return null;
  }
}

function mainKeyboard(session) {
  return {
    inline_keyboard: [
      [
        { text: '🌊', callback_data: 'arch:conductor' },
        { text: '⚔️', callback_data: 'arch:warrior' },
        { text: '🎨', callback_data: 'arch:creator' },
      ],
      [
        { text: '♟️', callback_data: 'arch:strategist' },
        { text: '👁️', callback_data: 'arch:observer' },
        { text: '🏛️', callback_data: 'arch:architect' },
      ],
      [
        { text: session.voiceOn ? '🔊 Голос' : '💬 Текст', callback_data: 'toggle:voice' },
        { text: '📋 Брифинг', callback_data: 'action:brief' },
        { text: '📊 Статус', callback_data: 'action:status' },
      ],
    ]
  };
}

function x100StartKeyboard() {
  return {
    inline_keyboard: [[
      { text: '🚀 Начать X100 (день 1)', callback_data: 'action:x100start' }
    ]]
  };
}

async function sendReply(chatId, result, session) {
  const keyboard = mainKeyboard(session);
  if (result.audioBuffers && result.audioBuffers.length > 0) {
    await sendVoice(chatId, result.audioBuffers[0], result.text);
    for (let i = 1; i < result.audioBuffers.length; i++) {
      await sendVoice(chatId, result.audioBuffers[i]);
    }
    await sendMsg(chatId, result.text.slice(0, 300) + (result.text.length > 300 ? '…' : ''), { reply_markup: keyboard });
  } else {
    await sendMsg(chatId, result.text, { reply_markup: keyboard });
  }
}

async function handleCallback(cb) {
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const data   = cb.data || '';
  if (!chatId) return;

  const session = getSession(chatId);
  await answerCallback(cb.id);

  if (data.startsWith('arch:')) {
    const arch = data.split(':')[1];
    if (ARCHETYPES[arch]) {
      session.archetype = arch;
      saveSession(session);
      const a = ARCHETYPES[arch];
      const reply = `${a.emoji} Режим ${a.name}. ${a.phrases[0]}`;
      const audio = session.voiceOn ? await synthesize(reply, arch).catch(() => []) : [];
      await sendReply(chatId, { text: reply, audioBuffers: audio }, session);
    }
    return;
  }

  if (data === 'toggle:voice') {
    session.voiceOn = !session.voiceOn;
    saveSession(session);
    const icon = session.voiceOn ? '🔊 Голос включён' : '💬 Текстовый режим';
    // FIX: клавиатура обновляется сразу
    await sendMsg(chatId, icon, { reply_markup: mainKeyboard(session) });
    return;
  }

  if (data === 'action:brief') {
    await sendRecording(chatId);
    const text = await generateBriefing(session);
    const audioBuffers = session.voiceOn ? await synthesize(text, session.archetype).catch(() => []) : [];
    await sendReply(chatId, { text, audioBuffers }, session);
    return;
  }

  if (data === 'action:status') {
    const update = { message: { chat: { id: chatId }, text: '/status' } };
    const result = await processTextMessage(update, BOT_TOKEN);
    await sendMsg(chatId, result.text, { reply_markup: mainKeyboard(session) });
    return;
  }

  if (data === 'action:x100start') {
    startX100(session);
    const a = ARCHETYPES[session.archetype];
    const text = `${a.emoji} День 1 из 100 запущен! X100 OASIS — путь начался.\n${a.phrases[0]}`;
    const audioBuffers = session.voiceOn ? await synthesize(text, session.archetype).catch(() => []) : [];
    await sendReply(chatId, { text, audioBuffers }, session);
    return;
  }
}

async function handleUpdate(update) {
  if (update.callback_query) {
    try { await handleCallback(update.callback_query); }
    catch(e) { console.error('[handleCallback] error:', e.message); }
    return;
  }

  const msg = update.message;
  if (!msg) return;

  const chatId  = msg.chat.id;
  const isVoice = !!(msg.voice || msg.audio);
  const isText  = !!msg.text;
  const session = getSession(chatId);

  try {
    if (isVoice) {
      await sendRecording(chatId);
      const result = await processVoiceMessage(update, BOT_TOKEN);
      if (result.transcription) {
        await sendMsg(chatId, `🎤 _"${result.transcription}"_`, { parse_mode: 'Markdown' }).catch(() => {});
      }
      await sendReply(chatId, result, session);
      return;
    }

    if (isText) {
      const text = msg.text.trim();

      if (text === '/start') {
        const x100d = getX100Day(session);
        const arch  = ARCHETYPES[session.archetype];
        const startText = [
          `${arch.emoji} *Проводник активирован*`,
          '',
          'Я — Джарвис Ростислава. Голосовой AI-партнёр X100 OASIS.',
          '',
          '🎤 Отправь голосовое → получи голосовой ответ',
          '💬 Пиши текст → отвечу текстом',
          '📋 /brief — утренний голосовой брифинг',
          '📝 "Запомни: ..." — сохраню заметку',
          '🔄 /reset — очистить историю',
          '',
          x100d
            ? `📅 X100: день ${x100d}/100`
            : '🚀 X100 программа ещё не запущена',
        ].join('\n');

        const keyboard = x100d ? mainKeyboard(session) : x100StartKeyboard();
        await sendMsg(chatId, startText, { parse_mode: 'Markdown', reply_markup: keyboard });
        return;
      }

      if (text === '/help') {
        const arch = ARCHETYPES[session.archetype];
        const helpText = [
          `*${arch.emoji} ${arch.name} — Команды:*`,
          '',
          '🎤 Голосовое → голосовой ответ',
          '💬 Текст → ответ архетипа',
          '📋 /brief — голосовой брифинг',
          '📅 /x100start — запустить 100 дней',
          '📝 "Запомни: [текст]" — заметка',
          '📊 /status — состояние системы',
          '🔄 /reset — сброс памяти',
          '',
          '*Переключение:*',
          ...Object.values(ARCHETYPES).map(a => `${a.emoji} "Переключись на ${a.name}"`),
          '',
          '"Отвечай текстом" / "Отвечай голосом"',
        ].join('\n');
        await sendMsg(chatId, helpText, { parse_mode: 'Markdown', reply_markup: mainKeyboard(session) });
        return;
      }

      if (text === '/reset') {
        clearSession(chatId);
        await sendMsg(chatId, '🔄 Память сброшена. Начинаем заново.', { reply_markup: mainKeyboard(getSession(chatId)) });
        return;
      }

      if (text === '/brief') {
        await sendRecording(chatId);
        const briefText = await generateBriefing(session);
        const audioBuffers = session.voiceOn ? await synthesize(briefText, session.archetype).catch(() => []) : [];
        await sendReply(chatId, { text: briefText, audioBuffers }, session);
        return;
      }

      if (text === '/x100start') {
        startX100(session);
        const a = ARCHETYPES[session.archetype];
        const replyText = `${a.emoji} День 1 запущен! 100 дней X100 OASIS начались.\n\n${a.phrases[0]}`;
        const audioBuffers = session.voiceOn ? await synthesize(replyText, session.archetype).catch(() => []) : [];
        await sendReply(chatId, { text: replyText, audioBuffers }, session);
        return;
      }

      await sendTyping(chatId);
      const result = await processTextMessage(update, BOT_TOKEN);
      await sendReply(chatId, result, session);
    }

  } catch(err) {
    console.error(`❌ handleUpdate error [${chatId}]:`, err.message);
    await sendMsg(chatId, '⚡ Что-то пошло не так. Попробуй ещё раз.').catch(() => {});
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok', bot: '@Provodnikro_bot', version: '2.1.0',
      gemini: !!process.env.GEMINI_API_KEY,
      elevenlabs: !!process.env.ELEVENLABS_KEY,
    }));
  }

  if (req.method === 'POST' && req.url === `/webhook/${WEBHOOK_SECRET}`) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      res.writeHead(200);
      res.end('{"ok":true}');
      try { await handleUpdate(JSON.parse(body)); }
      catch(e) { console.error('[webhook] parse/handle error:', e.message); }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

async function setup() {
  const webhookUrl = `${APP_URL}/webhook/${WEBHOOK_SECRET}`;
  try {
    const r = await tgPost('setWebhook', { url: webhookUrl, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
    if (r.ok) {
      console.log(`✅ Webhook set: ${webhookUrl}`);
    } else {
      console.error(`❌ Webhook FAILED: ${r.description}`);
    }
  } catch(e) { console.error('❌ setWebhook error:', e.message); }

  server.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════╗
║   @Provodnikro_bot — Jarvis v2.1         ║
╠══════════════════════════════════════════╣
║ Port      : ${PORT}
║ Gemini    : ${process.env.GEMINI_API_KEY ? '✅ ready' : '❌ missing'}
║ ElevenLabs: ${process.env.ELEVENLABS_KEY ? '✅ per-voice' : '⚠️  Google TTS'}
╚══════════════════════════════════════════╝
`);
  });
}

setup().catch(e => { console.error('Fatal startup error:', e); process.exit(1); });
