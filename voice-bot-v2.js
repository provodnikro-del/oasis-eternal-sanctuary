'use strict';
/**
 * voice-bot-v2.js — @Provodnikro_bot v2
 * SQLite sessions, ElevenLabs voices, X100 tracker, inline keyboards, /brief
 */

const https = require('https');
const http  = require('http');
const { processVoiceMessage, processTextMessage, getSession, saveSession, startX100, getX100Day, generateBriefing, synthesize, ARCHETYPES, ARCHETYPE_COMMANDS } = require('./voice-agent-v2');

const BOT_TOKEN      = process.env.BOT_TOKEN || '';
const PORT           = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'x100oasis2026';
const APP_URL        = process.env.APP_URL || 'https://x100-voice.onrender.com';

if (!BOT_TOKEN) { console.error('❌ BOT_TOKEN not set'); process.exit(1); }

async function tgPost(method, body) {
  return new Promise((resolve,reject)=>{
    const payload=JSON.stringify(body);
    const req=https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/${method}`,method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},
      res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});});
    req.on('error',reject); req.write(payload); req.end();
  });
}

const sendMsg=(cid,text,extra={})=>tgPost('sendMessage',{chat_id:cid,text,...extra});
const sendTyping=cid=>tgPost('sendChatAction',{chat_id:cid,action:'typing'});
const sendRecording=cid=>tgPost('sendChatAction',{chat_id:cid,action:'record_voice'});
const answerCallback=(cbId,text='')=>tgPost('answerCallbackQuery',{callback_query_id:cbId,text});

async function sendVoice(chatId, audioBuffer, caption='') {
  return new Promise((resolve,reject)=>{
    const boundary='b'+Date.now();
    const meta=`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`;
    const cap=caption?`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.slice(0,1024)}\r\n`:\'\'\';
    const fh=`--${boundary}\r\nContent-Disposition: form-data; name="voice"; filename="r.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`;
    const tail=`\r\n--${boundary}--`;
    const body=Buffer.concat([Buffer.from(meta+cap+fh),audioBuffer,Buffer.from(tail)]);
    const req=https.request({hostname:'api.telegram.org',path:`/bot${BOT_TOKEN}/sendVoice`,method:'POST',
      headers:{'Content-Type':`multipart/form-data; boundary=${boundary}`,'Content-Length':body.length}},
      res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});});
    req.on('error',reject); req.write(body); req.end();
  });
}

function mainKeyboard(session) {
  return { inline_keyboard: [
    [{text:'🌊',callback_data:'arch:conductor'},{text:'⚔️',callback_data:'arch:warrior'},{text:'🎨',callback_data:'arch:creator'}],
    [{text:'♟️',callback_data:'arch:strategist'},{text:'👁️',callback_data:'arch:observer'},{text:'🏛️',callback_data:'arch:architect'}],
    [{text:session.voiceOn?'🔊 Голос':'💬 Текст',callback_data:'toggle:voice'},{text:'📋 Брифинг',callback_data:'action:brief'},{text:'📊 Статус',callback_data:'action:status'}],
  ]};
}

function x100StartKeyboard() {
  return { inline_keyboard: [[{text:'🚀 Начать X100 (день 1)',callback_data:'action:x100start'}]] };
}

async function sendReply(chatId, result, session) {
  const keyboard=mainKeyboard(session);
  if (result.audioBuffers&&result.audioBuffers.length>0) {
    await sendVoice(chatId,result.audioBuffers[0],result.text);
    for (let i=1;i<result.audioBuffers.length;i++) await sendVoice(chatId,result.audioBuffers[i]);
    await sendMsg(chatId,'·',{reply_markup:keyboard});
  } else {
    await sendMsg(chatId,result.text,{reply_markup:keyboard});
  }
}

async function handleCallback(cb) {
  const chatId=cb.message?.chat?.id, data=cb.data||'';
  if (!chatId) return;
  const session=getSession(chatId);
  await answerCallback(cb.id);
  if (data.startsWith('arch:')) {
    const arch=data.split(':')[1];
    if (ARCHETYPES[arch]) {
      session.archetype=arch; saveSession(session);
      const a=ARCHETYPES[arch], reply=`${a.emoji} Режим ${a.name}. ${a.phrases[0]}`;
      const audio=session.voiceOn?await synthesize(reply,arch).catch(()=>[]): [];
      await sendReply(chatId,{text:reply,audioBuffers:audio},session);
    }
    return;
  }
  if (data==='toggle:voice') {
    session.voiceOn=!session.voiceOn; saveSession(session);
    await sendMsg(chatId,session.voiceOn?'🔊 Голос включён':'💬 Текстовый режим',{reply_markup:mainKeyboard(session)});
    return;
  }
  if (data==='action:brief') {
    await sendRecording(chatId);
    const text=await generateBriefing(session).catch(()=>'⚡ Брифинг недоступен.');
    const audioBuffers=session.voiceOn?await synthesize(text,session.archetype).catch(()=>[]): [];
    await sendReply(chatId,{text,audioBuffers},session);
    return;
  }
  if (data==='action:status') {
    const result=await processTextMessage({message:{chat:{id:chatId},text:'/status'}},BOT_TOKEN);
    await sendMsg(chatId,result.text,{reply_markup:mainKeyboard(session)});
    return;
  }
  if (data==='action:x100start') {
    startX100(session);
    const a=ARCHETYPES[session.archetype];
    const text=`${a.emoji} День 1 из 100 запущен! X100 OASIS — путь начался.\n${a.phrases[0]}`;
    const audioBuffers=session.voiceOn?await synthesize(text,session.archetype).catch(()=>[]): [];
    await sendReply(chatId,{text,audioBuffers},session);
    return;
  }
}

async function handleUpdate(update) {
  if (update.callback_query) return await handleCallback(update.callback_query);
  const msg=update.message;
  if (!msg) return;
  const chatId=msg.chat.id, isVoice=!!(msg.voice||msg.audio), isText=!!msg.text;
  const session=getSession(chatId);
  try {
    if (isVoice) {
      await sendRecording(chatId);
      const result=await processVoiceMessage(update,BOT_TOKEN);
      if (result.transcription) await sendMsg(chatId,`🎤 _"${result.transcription}"_`,{parse_mode:'Markdown'});
      await sendReply(chatId,result,session);
      return;
    }
    if (isText) {
      const text=msg.text.trim();
      if (text==='/start') {
        const x100d=getX100Day(session), arch=ARCHETYPES[session.archetype];
        const startText=[`${arch.emoji} *Проводник активирован*`,'','Я — Джарвис Ростислава. Голосовой AI-партнёр X100 OASIS.','','🎤 Голосовое → голосовой ответ','💬 Текст → ответ архетипа','📋 /brief — брифинг','📝 "Запомни: ..." — заметка','🔄 /reset — сброс','',x100d?`📅 X100: день ${x100d}/100`:'🚀 X100 не запущена'].join('\n');
        await sendMsg(chatId,startText,{parse_mode:'Markdown',reply_markup:x100d?mainKeyboard(session):x100StartKeyboard()});
        return;
      }
      if (text==='/help') {
        const arch=ARCHETYPES[session.archetype];
        const helpText=[`*${arch.emoji} ${arch.name} — Команды:*`,'','🎤 Голосовое → ответ','📋 /brief — брифинг','📅 /x100start — 100 дней','📝 "Запомни: [текст]"','📊 /status','🔄 /reset'].join('\n');
        await sendMsg(chatId,helpText,{parse_mode:'Markdown',reply_markup:mainKeyboard(session)});
        return;
      }
      if (text==='/reset') {
        await sendMsg(chatId,'🔄 Память сброшена.',{reply_markup:mainKeyboard(session)});
        return;
      }
      if (text==='/brief') {
        await sendRecording(chatId);
        const briefText=await generateBriefing(session).catch(()=>ARCHETYPES[session.archetype].phrases[0]);
        const audioBuffers=session.voiceOn?await synthesize(briefText,session.archetype).catch(()=>[]): [];
        await sendReply(chatId,{text:briefText,audioBuffers},session);
        return;
      }
      if (text==='/x100start') {
        startX100(session);
        const a=ARCHETYPES[session.archetype];
        const replyText=`${a.emoji} День 1 запущен!\n${a.phrases[0]}`;
        const audioBuffers=session.voiceOn?await synthesize(replyText,session.archetype).catch(()=>[]): [];
        await sendReply(chatId,{text:replyText,audioBuffers},session);
        return;
      }
      await sendTyping(chatId);
      const result=await processTextMessage(update,BOT_TOKEN);
      await sendReply(chatId,result,session);
    }
  } catch(err) {
    console.error(`❌ [${chatId}]:`,err.message);
    await sendMsg(chatId,'⚡ Что-то пошло не так. Попробуй ещё раз.').catch(()=>{});
  }
}

const server=http.createServer(async(req,res)=>{
  if (req.method==='GET'&&req.url==='/health') {
    res.writeHead(200,{'Content-Type':'application/json'});
    return res.end(JSON.stringify({status:'ok',bot:'@Provodnikro_bot',version:'2.0.0',gemini:!!process.env.GEMINI_API_KEY,elevenlabs:!!process.env.ELEVENLABS_KEY}));
  }
  if (req.method==='POST'&&req.url===`/webhook/${WEBHOOK_SECRET}`) {
    let body='';
    req.on('data',c=>body+=c);
    req.on('end',async()=>{
      res.writeHead(200); res.end('{"ok":true}');
      try{await handleUpdate(JSON.parse(body))}catch(e){console.error('Webhook err:',e.message);}
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

async function setup() {
  const webhookUrl=`${APP_URL}/webhook/${WEBHOOK_SECRET}`;
  try {
    const r=await tgPost('setWebhook',{url:webhookUrl,allowed_updates:['message','callback_query'],drop_pending_updates:true});
    console.log(r.ok?`✅ Webhook: ${webhookUrl}`:`⚠️ ${r.description}`);
  } catch(e){console.warn('⚠️ Webhook error:',e.message);}
  server.listen(PORT,()=>console.log(`\n🤖 @Provodnikro_bot v2 | Port ${PORT} | Gemini ${process.env.GEMINI_API_KEY?'✅':'❌'} | ElevenLabs ${process.env.ELEVENLABS_KEY?'✅':'⚠️ Google TTS'}\n`));
}

setup().catch(e=>{console.error('Fatal:',e);process.exit(1);});
