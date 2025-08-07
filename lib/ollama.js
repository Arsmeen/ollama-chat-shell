/* eslint-disable node/no-unsupported-features/node-builtins */
const fetch = global.fetch;                 // ← встроенный fetch, без node-fetch
const { exec } = require('child_process');
const { promisify } = require('util');
const http = require('http');
const { EventEmitter } = require('events');
const execP = promisify(exec);

/* ---------- helpers ---------- */
// function parseChatChunk(buf, ev) {
//   buf = buf.replace(/\r/g, '');
//   const lines = buf.split('\n');
//   let rest = lines.pop();
//   for (const ln of lines) {
//     if (!ln.startsWith('data:')) continue;
//     const p = ln.slice(5).trim();
//     if (p === '[DONE]') { ev.emit('end'); continue; }
//     try {
//       const j = JSON.parse(p);
//       const tok = j.choices?.[0]?.delta?.content;
//       if (tok) ev.emit('token', tok);
//     } catch {}
//   }
//   return rest;
// }
let inReason = false;      // открыта ли сейчас ```thoughts ... endthouts```
function parseChatChunk(buf, ev) {
  buf = buf.replace(/\r/g, '');
  const lines = buf.split('\n');
  let rest = lines.pop();

  for (const ln of lines) {
    if (!ln.startsWith('data:')) continue;
    const p = ln.slice(5).trim();
    if (p === '[DONE]') {
      if (inReason) {               // закрыть, если забыли
        ev.emit('token', '\nendthouts```\n');
        inReason = false;
      }
      ev.emit('end');
      continue;
    }

    try {
      const j = JSON.parse(p);
      const delta = j.choices?.[0]?.delta || {};

      if (delta.reasoning) {
        if (!inReason) {            // первый reasoning-чанк
          ev.emit('token', '```thoughts\n');
          inReason = true;
        }
        ev.emit('token', delta.reasoning);
        continue;                   // reasoning не мешаем с обычным контентом
      }

      // дошли до обычного content, а reasoning был открыт — закрываем блок
      if (inReason) {
        ev.emit('token', '\nendthouts```\n');
        inReason = false;
      }

      if (delta.content) ev.emit('token', delta.content);
    } catch { /* пропускаем битые чанки */ }
  }
  return rest;
}

function parseGenerateChunk(buf, ev) {
  buf = buf.replace(/\r/g, '');
  const lines = buf.split('\n');
  let rest = lines.pop();
  for (const ln of lines) {
    if (!ln.trim()) continue;
    try {
      const j = JSON.parse(ln.trim());
      if (j.done) { ev.emit('end'); continue; }
      if (j.response) ev.emit('token', j.response);
    } catch {}
  }
  return rest;
}

/* ---------- server / model ---------- */
async function isServerUp(host='127.0.0.1',port=11434){
  return new Promise(r=>{
    const req=http.get({host,port,path:'/api/tags',timeout:1000},x=>{x.destroy();r(true);});
    req.on('error',()=>r(false)); req.on('timeout',()=>{req.destroy();r(false);});
  });
}

let pullStarted = false;
async function ensureModel(model) {
  while (true) {
    const { stdout } = await execP('ollama list');
    //console.log('stdout',model,stdout);
    if (stdout.includes(model)) return true;

    if (!pullStarted) {
      pullStarted = true;
      try {
        const res = await execP(`ollama pull ${model}`);
        //console.log('Error res',res.stdout,res.stderr);
        if (res.stdout && res.stdout.includes('Error:')) return false;
        if (res.stderr && res.stderr.includes('Error:')) return false;
      } catch (err) {
        //console.log('Error',err.stdout,err.stderr);
        if (
          err.stdout && err.stdout.includes('Error:') ||
          err.stderr && err.stderr.includes('Error:') ||
          (err.message && (
            err.message.includes('file does not exist') ||
            err.message.includes('not found') ||
            err.message.includes('Error:')
          ))
        ) {
          return false;
        }
      }
    }
    await new Promise(res => setTimeout(res, 2000));
  }
}

/* --- helper для любого эндпоинта --- */
function streamResponse(res, parser, ev) {
  // WHATWG-stream
  if (typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const dec = new TextDecoder(); let buf = '';
    (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = dec.decode(value, { stream: true });
        // ЛОГИРУЕМ каждый чанк:
        //console.log('[ollama raw chunk]', chunk);
        buf += chunk;
        buf = parser(buf, ev);
      }
      ev.emit('end');
    })().catch(e => ev.emit('error', e));
  } else {
    // Node-stream (.on)
    let buf = '';
    res.body.on('data', c => { buf += c.toString('utf8'); buf = parser(buf, ev); });
    res.body.on('end', () => ev.emit('end'));
    res.body.on('error', e => ev.emit('error', e));
  }
}

/* ---------- chat stream ---------- */
function askStream(model, prompt, temperature = 0.7, images = [], reasoning = 1) {
  const ev = new EventEmitter();
  const body = JSON.stringify({
    model, stream: true, temperature,
    messages: [{ role: 'user', content: prompt, images, reasoning: String(reasoning) }]
  });

  fetch('http://localhost:11434/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body
  })
    .then(res => streamResponse(res, parseChatChunk, ev))
    .catch(e  => ev.emit('error', e));

  return ev;
}

/* ---------- generate stream ---------- */
function generateStream(model, prompt, temperature = 0.7, images = [], reasoning = 1) {
  const ev = new EventEmitter();
  const body = JSON.stringify({ model, prompt, images, temperature, stream: true, reasoning: String(reasoning) });

  fetch('http://localhost:11434/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body
  })
    .then(res => streamResponse(res, parseGenerateChunk, ev))
    .catch(e  => ev.emit('error', e));

  return ev;
}

module.exports = { isServerUp, ensureModel, askStream, generateStream };
