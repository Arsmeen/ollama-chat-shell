const chat   = document.getElementById('chat');
const bar    = document.getElementById('file-bar');
const input  = document.getElementById('input');
const fileSel= document.getElementById('fileSel');

const sendB  = document.getElementById('send');
const clearB = document.getElementById('clear');
const checkB = document.getElementById('check');
const plusB  = document.getElementById('plus');
const minusB = document.getElementById('minus');
const attachB= document.getElementById('attach');

/* ---------- конфиг ---------- */
let fullCfg   = null;      // весь config.json
let allTTS    = {};        // ссылка на fullCfg.tts
let ttsCfg    = null;      // активная конфигурация провайдера
let curProvider = '';      // '' | 'OpenAI' | 'ElevenLabs'
let curVolume   = 1;       // 0-1 (единственный источник истины!)
let currentAudio = null;

(async () => {
  const [cfg, menu] = await Promise.all([
    window.appConfig.get(),      // config.json
    window.ttsSettings.get()     // {provider, volume} из меню
  ]);

  fullCfg = cfg;
  allTTS  = cfg.tts || {};

  /* меню имеет приоритет над config.tts.use */
  curProvider = menu.provider || (allTTS.use || '');
  curVolume   = (menu.volume !== undefined
                ? menu.volume
                : (allTTS.volume ?? 100)) / 100;

  selectProvider();              // вычисляем ttsCfg
})();

let streamDiv=null, files=[];  // files = [{name,data}]
let codeFiles = []; 
let maxMsgs=0;

let chatInitialized = false;
let historyTries = 0;

let ollamaWaitTimer = null;

const TW={base:'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/',folder:'assets/svg',ext:'.svg'};

// --- громкость TTS и настройки ---------
ttsSettings.get().then(({provider,volume})=>{
  curVolume = volume/100;
  curProvider = provider;
  selectProvider();              // функция ниже
});

ttsSettings.onVolume(v => {
  curVolume = v / 100;
  if (currentAudio) currentAudio.volume = curVolume;
  console.log('curVolume: ', curVolume);
});
ttsSettings.onProvider(p=>{ curProvider=p; selectProvider(); });

function detectLanguage(name){
  const ext = name.split('.').pop().toLowerCase();
  const map = {
    js:'javascript', jsx:'javascript',
    ts:'typescript', tsx:'typescript',
    py:'python', php:'php', rb:'ruby',
    html:'html', css:'css', scss:'scss',
    json:'json', go:'go', rs:'rust',
    c:'c', h:'c', cpp:'cpp', hpp:'cpp',
    cs:'csharp', java:'java', kt:'kotlin',
    swift:'swift', sh:'bash', bat:'bat'
  };
  return map[ext] ?? 'text';
}

function selectProvider(){
  if (!curProvider){
    ttsCfg = null;                   // системный TTS
    return;
  }
  const source = allTTS[curProvider];
  if (!source){          // вдруг меню выбрало, а в конфиге нет
    ttsCfg = null;
    return;
  }
  ttsCfg = {...source, provider:curProvider};
  // громкость может быть в подпункте:
  if (source.volume !== undefined) curVolume = source.volume/100;
}

// --- закладки --------------------------------------------------------------
const bookmarks = [];
const navUp   = document.getElementById('navUp');
const navDown = document.getElementById('navDown');
const playback= document.getElementById('playback');
const stopBtn = document.getElementById('stopBtn');

function updateNavState(){
  const y = chat.scrollTop;
  const up   = bookmarks.some(b => b.y <  y-4);
  const down = bookmarks.some(b => b.y >  y+4);
  navUp.disabled   = !up;
  navDown.disabled = !down;
  navUp.classList.toggle('enabled', up);
  navDown.classList.toggle('enabled', down);
}

chat.addEventListener('scroll', updateNavState);

navUp.addEventListener('click', () => {
  const y = chat.scrollTop;
  const target = [...bookmarks].reverse().find(b => b.y < y-4);
  if (target) chat.scrollTo({top: target.y-4, behavior:'smooth'});
});

navDown.addEventListener('click', () => {
  const y = chat.scrollTop;
  const target = bookmarks.find(b => b.y > y+4);
  if (target) chat.scrollTo({top: target.y-4, behavior:'smooth'});
});

// --- воспроизведение --------------------------------------------------------
let currentUtter = null;

function currentAssistantElem(){
  const msgs = [...chat.querySelectorAll('.assistant')];
  const mid  = chat.getBoundingClientRect().top + chat.clientHeight/2;
  return msgs.find(m=>{
    const r = m.getBoundingClientRect();
    return r.top<=mid && r.bottom>=mid;
  }) || msgs[msgs.length-1];
}

function resetPlaybackBtn(){
  currentAudio = null;
  currentUtter = null;
  playback.textContent = '🔊';
  renderEmoji(playback);
  stopBtn.style.display = 'none';
  notifyTray('stopped');
}

function setPlayBtn(icon, showStop = false){
  playback.textContent = icon;    // '🔊' | '▶' | '⏸'
  renderEmoji(playback);
  stopBtn.style.display = showStop ? 'block' : 'none';
}

function notifyTray(state){   // 'playing' | 'paused' | 'stopped'
  window.trayControl?.notify(state);
}

function splitByChunks(txt, size){
  if(!size || txt.length <= size) return [txt];

  const parts = [];
  const punct = /[.!?…]/g;             // конец предложения

  while (txt.length > size){
    let cut = size;

    /* ищем ближайшую точку, начиная с позиции size */
    punct.lastIndex = size;
    const p = punct.exec(txt);
    if (p){
      cut = p.index + 1;               // захватываем сам символ
      /* захватываем следующее пробельное, если есть */
      while (cut < txt.length && /\s/.test(txt[cut])) cut++;
    } else {
      /* если точки нет → режем на первом пробеле после size */
      const space = txt.indexOf(' ', size);
      cut = space !== -1 ? space + 1 : txt.length;
    }

    parts.push(txt.slice(0, cut).trim());
    txt = txt.slice(cut);
  }

  if (txt.length) parts.push(txt.trim());
  return parts;
}

async function speakOpenAI(text) {
  const parts = splitByChunks(text, ttsCfg.chunk || 0);
  let idx = 0;
  let preload = null; // { url, audio }

  // Асинхронная функция загрузки чанка
  async function fetchChunk(i) {
    if(i >= parts.length) return null;
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Authorization':`Bearer ${ttsCfg.token}`
      },
      body:JSON.stringify({
        model: ttsCfg.model || 'gpt-4o-mini-tts',
        input: parts[i],
        voice: ttsCfg.voice || 'shimmer',
        format:'wav',
        speed: ttsCfg.speed || 1.0
      })
    });
    const buf = await res.arrayBuffer();
    const blob = new Blob([buf], {type:'audio/wav'});
    const url  = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.volume = curVolume;
    return { url, audio };
  }

  // Основной цикл
  async function playNext() {
    if(idx >= parts.length) { resetPlaybackBtn(); return; }

    // Если это первый чанк — подгружаем его
    if(!preload) preload = await fetchChunk(idx);

    notifyTray('playing');
    currentAudio = preload.audio;

    // Начинаем грузить следующий чанк заранее
    const preloadNextPromise = fetchChunk(idx + 1);

    // Ставим обработчики окончания
    currentAudio.addEventListener('ended', async () => {
      // Освобождаем blob
      URL.revokeObjectURL(preload.url);

      idx++;
      preload = await preloadNextPromise;
      playNext();
    }, {once:true});
    currentAudio.addEventListener('error', resetPlaybackBtn, {once:true});
    await currentAudio.play();
  }

  playNext();
}

async function speakElevenLabs(text){
  const chunkSize = ttsCfg.chunk || 0;
  const parts = splitByChunks(text, chunkSize);
  let idx = 0;

  async function playNext(){
    if (idx >= parts.length){ resetPlaybackBtn(); return; }

    try{
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ttsCfg.voice}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key':   ttsCfg.token
        },
        body: JSON.stringify({
          text:      parts[idx],
          model_id:  ttsCfg.model || 'eleven_flash_v2_5',
          voice_settings: {stability: 0.4, similarity_boost: 0.7, speed: ttsCfg.speed || 1.0}
        })
      });

      if (!res.ok){                         // ← проверка ответа
        throw new Error(`ElevenLabs HTTP ${res.status}`);
      }

      const buf  = await res.arrayBuffer();
      const blob = new Blob([buf], {type:'audio/mpeg'});
      const url  = URL.createObjectURL(blob);
      const au   = new Audio(url);
      au.volume = curVolume;
      currentAudio = au;

      au.addEventListener('ended', () => { idx++; playNext(); }, {once:true});
      au.addEventListener('error',  resetPlaybackBtn,            {once:true});
      await au.play();

    }catch(err){
      console.error('ElevenLabs TTS error:', err);
      resetPlaybackBtn();
    }
  }
  playNext();
}

// --- выбираем элементы -------------------------------------------------------
// input - выбирается выше
// const micBtn  = document.getElementById('micBtn');

// --- Speech Recognition ------------------------------------------------------
let recognition      = null;
let recognizing      = false;

if ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition            = new SR();
  recognition.lang       = 'ru-RU';     // язык можно поменять
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = e => {
    let chunk = '';
    for (let i = e.resultIndex; i < e.results.length; ++i){
      chunk += e.results[i][0].transcript;
    }
    input.value += (input.value && !input.value.endsWith(' ')?' ':'') + chunk.trim();
  };

  // автоперезапуск, пока кнопка активна
  recognition.onend = () => { if (recognizing) recognition.start(); };
  //
  recognition.onerror  = e => console.error('SR error:', e.error);
  recognition.onstart  = () => console.log('SR started');
  recognition.onspeechend = () => console.log('speech end');
}

// --- функции управления ------------------------------------------------------
// function startRec(){
//   if (!recognition) return;
//   recognizing = true;
//   micBtn.classList.add('active');
//   recognition.start();
// }
// function stopRec(){
//   if (!recognition) return;
//   recognizing = false;
//   micBtn.classList.remove('active');
//   recognition.stop();
// }
// micBtn.addEventListener('click', () => recognizing ? stopRec() : startRec());

// --- глушим диктовку при ЛЮБОЙ отправке --------------------------------------
// const _send = send;              // твоя существующая функция
// window.send = function(){
//   if (recognizing) stopRec();
//   return _send.apply(this, arguments);
// };

playback.addEventListener('click', async () => {
  const selected = (window.getSelection()?.toString() || '').trim();

  /* --- внешний TTS (OpenAI / ElevenLabs) ---------------------------------- */
  if (ttsCfg && (ttsCfg.provider === 'OpenAI' || ttsCfg.provider === 'ElevenLabs')) {
    if (currentAudio) {
      currentAudio.volume = curVolume; 
      if (currentAudio.paused){ await currentAudio.play(); setPlayBtn('⏸', true); notifyTray('playing'); }
      else                   { currentAudio.pause();       setPlayBtn('▶', true); notifyTray('paused'); }
      return;
    }

    const text = selected || (currentAssistantElem()?.innerText || '');
    if(!text) return;

    setPlayBtn('⏸', true);
    notifyTray('playing');
    if (ttsCfg.provider === 'OpenAI') speakOpenAI(text);
    else                              speakElevenLabs(text);
    return;
  }

  /* ─── SpeechSynthesis ───────────────────────────────────────────── */
  /* 1. Управление уже идущим воспроизведением (пауза/продолжение) */
  if (currentUtter) {
    if (speechSynthesis.paused) {          // ► продолжить
      speechSynthesis.resume();
      setPlayBtn('⏸', true);
      notifyTray('playing');
    } else {                               // ❚❚ пауза
      speechSynthesis.pause();
      setPlayBtn('▶', true);
      notifyTray('paused');
    }
    return;
  }

  /* 2. Запуск озвучки выделенного текста, если ничего не играет */
  if (selected) {
    const u = new SpeechSynthesisUtterance(selected);
    u.volume = curVolume;
    currentUtter = u;
    setPlayBtn('⏸', true);
    notifyTray('playing');
    u.onend = u.onerror = resetPlaybackBtn;
    speechSynthesis.speak(u);
    return;
  }

  /* 3. Запуск озвучки текущей реплики */
  const msg = currentAssistantElem();
  if (!msg) return;

  const u = new SpeechSynthesisUtterance(msg.innerText);
  u.volume = curVolume;
  currentUtter = u;
  setPlayBtn('⏸', true);
  notifyTray('playing');
  u.onend = u.onerror = resetPlaybackBtn;
  speechSynthesis.speak(u);
});

stopBtn.addEventListener('click', ()=>{
  if(currentAudio){ currentAudio.pause(); notifyTray('paused'); currentAudio=null; }
  speechSynthesis.cancel();
  currentUtter=null;
  playback.textContent='🔊';
  stopBtn.style.display='none';
  renderEmoji(playback);
});

// --- внедрение кнопки-закладки в каждую AI-реплику --------------------------
function attachBookmark(msgEl){
  const dot = document.createElement('button');
  dot.className = 'bookmark-btn';
  msgEl.style.position='relative';
  msgEl.appendChild(dot);

  // Получаем количество символов в тексте сообщения
  const charCount = msgEl.textContent ? msgEl.textContent.length : 0;

  if(charCount > 0) {
    // Создаем элемент для отображения количества символов
    const charCountElement = document.createElement('span');
    charCountElement.classList.add('char-count'); // Добавляем класс для стилизации
    charCountElement.textContent = charCount;

    // Вставляем элемент с количеством символов после bookmark-btn
    msgEl.appendChild(charCountElement);
  }

  dot.addEventListener('click', ()=>{
    const active = dot.classList.toggle('active');
    if(active){
      bookmarks.push({elem:msgEl, y:msgEl.offsetTop});
      bookmarks.sort((a,b)=>a.y-b.y);
    }else{
      const i = bookmarks.findIndex(b=>b.elem===msgEl);
      if(i>-1) bookmarks.splice(i,1);
    }
    updateNavState();
  });
}

// --- twemoji helper ---------------------------------------------------------
function renderEmoji(node){
  if(window.twemoji) twemoji.parse(node,TW);
}

// сразу прорисуем панель навигации
renderEmoji(document.getElementById('nav'));
// сразу прорисуем кнопку микрофона
// setInterval(() => {
//       renderEmoji(document.getElementById('micBtn'));
// }, 1500);
//renderEmoji(document.getElementById('input-bar'));

function hideUserCode(root){
  const mkIcon = f => `<span class="file-icon" title="${f.filename}">📄</span>`;
  let html = root.innerHTML;

  // Находим первый ```startcode и последний ```endcode
  const start = html.indexOf('```startcode');
  const end   = html.lastIndexOf('```endcode');

  if (start !== -1 && end !== -1 && end > start) {
    let codeBlock = html.slice(start + 12, end);
    // Оставляем только куски "filename": "..."
    let files = [];
    // Грубый парсер: ищет все filename в тексте, игнорируя всё между ними
    codeBlock.replace(/"filename"\s*:\s*"([^"]+)"/g, (match, fname) => {
      files.push({filename: fname});
    });

    // Заменяем только этот блок на иконки (если что-то нашли)
    if (files.length) {
      html = html.slice(0, start) + files.map(mkIcon).join(' ') + html.slice(end + 11); // 11 = длина '```endcode'
      root.innerHTML = html;
    }
    return;
  }
  // если блок не найден — не меняем
}

function decodeHTMLEntities(str){
  const txt = document.createElement('textarea');
  txt.innerHTML = str;
  return txt.value;
}

// Примитивный markdown-фильтр для жирного/курсива/заголовков/ссылок
function simpleMarkdownToHtml(md) {
  // 1. Сохраняем все <main ...>...</main>
  const codeBlocks = [];
  md = md.replace(/<main[^>]*>[\s\S]*?<\/main>/gi, function(m) {
    codeBlocks.push(m);
    return `\uFFF7main${codeBlocks.length-1}\uFFF8`; // Спец-плейсхолдер
  });

  // 2. Делаем markdown только по остальному
  md = md
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*([\s\S]+?)\*\*/g, '<b>$1</b>')
    .replace(/^\* (.+)$/gm, '<span class="md-bullet">$1</span>')
    .replace(/(^|[^`])`([^`\n\r]+?)`(?!`)/g, '$1<span class="inline-code">$2</span>')
    .replace(/\*([^\n\r*]+?)\*/g, '<i>$1</i>')
    .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank">$1</a>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '<br><br>');

  // 3. Восстанавливаем <main ...>...</main>
  md = md.replace(/\uFFF7main(\d+)\uFFF8/g, (m, i) => codeBlocks[+i]);

  return md;
}

function enhanceCodeBlocks(root){
  const html = root.innerHTML;
  // Гибкий паттерн — ловит много блоков, конец: ``` + только пробелы/конец строки/файла
  const re = /```([a-zA-Z0-9#+.\-]*)\n([\s\S]*?)```[\s]*((?=\n)|$)/gm;

  let last = 0;
  const parts = [];
  let m;

  while((m = re.exec(html))){
    if(m.index > last){
      parts.push({type:'html', content: html.slice(last, m.index)});
    }
    parts.push({
      type : 'code',
      lang : (m[1] || 'code').toLowerCase(),
      text : decodeHTMLEntities(m[2])
    });
    last = re.lastIndex;
  }
  if(last < html.length) parts.push({type:'html', content: html.slice(last)});

  // Обработка и сборка
  root.innerHTML = '';
  for(const p of parts){
    if(p.type === 'html'){
      // markdown только для не-кода
      const tmp = document.createElement('div');
      tmp.innerHTML = p.content;
      //tmp.innerHTML = simpleMarkdownToHtml(p.content);
      tmp.childNodes.forEach(n=>root.appendChild(n));
    }else{
      const wrapper = document.createElement('main');
      wrapper.className = 'code-box';

      const header = document.createElement('div');
      header.className = 'code-header';
      header.innerHTML = `<span>${p.lang}</span><button>copy</button>`;

      // const btn = header.querySelector('button');
      // btn.onclick = ()=> {
      //   navigator.clipboard.writeText(p.text);
      //   let hint = document.createElement('span');
      //   hint.textContent  = 'stored to clipboard';
      //   hint.className = 'copy-hint';
      //   btn.parentElement.appendChild(hint);
      //   setTimeout(()=>hint.remove(), 1300);
      // };

      const pre  = document.createElement('pre');
      const code = document.createElement('code');
      code.className = 'language-' + p.lang;
      code.textContent  = p.text;
      pre.appendChild(code);

      wrapper.append(header, pre);
      root.appendChild(wrapper);
    }
  }
  root.innerHTML = simpleMarkdownToHtml(root.innerHTML);
  if (!root._copyDelegated) {
    root.addEventListener('click', function(e){
      if(e.target.tagName === 'BUTTON' && e.target.textContent === 'copy'){
        const codeBox = e.target.closest('.code-box');
        const code    = codeBox && codeBox.querySelector('pre code');
        if(code){
          navigator.clipboard.writeText(code.textContent);
          let hint = document.createElement('span');
          hint.textContent  = 'stored to clipboard';
          hint.className = 'copy-hint';
          e.target.parentElement.appendChild(hint);
          setTimeout(()=>hint.remove(), 1300);
        }
      }
    });
    root._copyDelegated = true;
  }
}

/* helpers */
function add(txt='',cls='system'){
  const d=document.createElement('div');
  d.className='msg '+cls;
  if(cls==='assistant') {
    d.innerHTML=txt;
    enhanceCodeBlocks(d);
    attachBookmark(d); // вызов attachBookmark
  } else if(cls==='user') {
    d.textContent=txt
    hideUserCode(d);
  } else {
    d.innerHTML=txt;
  }
  renderEmoji(d);
  chat.appendChild(d);
  chat.scrollTop=chat.scrollHeight;
  trim();
  return d;
}
function trim(){
  if(maxMsgs<=0)return;
  let pairs=0;
  [...chat.children].forEach(c=>{ if(c.classList.contains('assistant')) pairs++; });
  while(pairs>maxMsgs){
    chat.removeChild(chat.firstChild); chat.removeChild(chat.firstChild); pairs--;
  }
}
function refreshBar(){
  bar.innerHTML='';
  if(!files.length && !codeFiles.length){ bar.style.display='none'; return; }
  bar.style.display='flex';
  files.forEach((f,i)=>{
    const div=document.createElement('div');
    div.className='file-item'; div.textContent=f.name;
    const x=document.createElement('button'); x.textContent='✕';
    x.onclick=()=>{ files.splice(i,1); refreshBar(); };
    div.appendChild(x); bar.appendChild(div);
  });
  codeFiles.forEach((f,i)=>{
    const div=document.createElement('div');
    div.className='file-item'; div.textContent=f.filename;
    const x=document.createElement('button'); x.textContent='✕';
    x.onclick=()=>{ codeFiles.splice(i,1); refreshBar(); };
    div.appendChild(x); bar.appendChild(div);
  });
}

/* config */
let fontTries = 0;
function ensureFontConfig() {
  const sz = getComputedStyle(document.documentElement).getPropertyValue('--chat-font');
  if (!sz || sz === '0.7rem') { // если умолчание, а не твой из конфига
    fontTries++;
    if (fontTries < 4) setTimeout(window.api.check, 250); // ещё раз спросить конфиг
  }
  renderEmoji(document.getElementById('nav'));
}

window.api.onCfg(c => {
  //console.log("try to log:");
  document.documentElement.style.setProperty('--chat-font', c.chat_font || '0.7rem');
  document.documentElement.style.setProperty('--input-font', c.input_font || '0.7rem');
  maxMsgs = c.history_max_messages || 0;
  ensureFontConfig(); // проверить через 1 тик
});

setTimeout(ensureFontConfig, 1000);
//window.api.check();

//console.log("try to log2:");

/* history */
window.api.onHist(arr => {
  chatInitialized = true;  // <- даже если arr.length === 0 (файла не было — всё ок)
  // удалить "Initializing…" если она есть
  if(chat.firstChild && chat.firstChild.className && chat.firstChild.className.includes('system') && chat.firstChild.textContent.includes('Initializing')) {
    chat.removeChild(chat.firstChild);
  }
  arr.forEach(e=>{ add(e.user,'user'); add(e.ai,'assistant'); });
  setTimeout(()=>{
    renderEmoji(chat);
    trim();
    chat.scrollTop = chat.scrollHeight;
  },50);
});

let tryInitLoopTimeout = null;
function tryInitLoop() {
  if (!chatInitialized && historyTries < 5) {
    historyTries++;
    window.api.check();
    tryInitLoopTimeout = setTimeout(tryInitLoop, 5000);
  }
}
// Запуск цикла
tryInitLoopTimeout = setTimeout(tryInitLoop, 5000);
// Функция для отмены
function cancelInitLoop() {
  if (tryInitLoopTimeout) {
    clearTimeout(tryInitLoopTimeout);
    tryInitLoopTimeout = null;
  }
}

/* send */
function send(){
  let text = input.value.trim();
  if(!text && !files.length) return;

  const chatImageEmoji = '🖼️ ';
  if (files.length) {
    text = `${chatImageEmoji}${text}`;
  }

  if(codeFiles.length) {
    text = '```startcode\n' + JSON.stringify(codeFiles, null, 2) + '\n```endcode\n\n' + text;
  }

  add(text||'<img>','user'); // тут добавляется текст в ленту чата
  input.value=''; input.scrollTop=0; input.setSelectionRange(0,0);  // ← курсор в начало

  streamDiv=add('','assistant');
  window.api.send({ text, images: files.map(f=>f.data) });
  files=[]; codeFiles=[]; refreshBar();
  if (recognizing) stopRec();
}
sendB.onclick=send;
/* ----- send по Enter ----- */
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
  // Если Shift+Enter — стандартное поведение: перенос строки
});

/* streaming */
window.api.onChunk(t => {
  if (streamDiv){
    // проверяем, «окно» ли мы у низа (≤ ~40 px)
    const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;

    streamDiv.textContent += t;

    if (atBottom){
      chat.scrollTop = chat.scrollHeight;   // скроллим только когда были внизу
    }
  }
});
window.api.onDone(() => {
  chat.scrollTop = chat.scrollHeight;
  enhanceCodeBlocks(streamDiv);
  attachBookmark(streamDiv);
  renderEmoji(streamDiv);
  updateNavState();
});

/* attach */
attachB.onclick=()=>fileSel.click();
fileSel.onchange=async e=>{
  for(const f of [...e.target.files]){
    if(f.type.startsWith('image/')){
      const data=await new Promise(r=>{
        const fr=new FileReader();
        fr.onload=()=>r(fr.result.split(',')[1]); fr.readAsDataURL(f);
      });
      files.push({name:f.name,data});
    }else{
      await addCodeFile(f);     // новое
    }
  }
  fileSel.value=''; refreshBar();
};

async function addCodeFile(file){
  const text = await file.text();
  codeFiles.push({
    language : detectLanguage(file.name),
    filename : file.name,
    code     : text.replace(/"/g,'\\"')   // экранируем
  });
  refreshBar();
}

/* clear */
clearB.onclick=()=>{ chat.innerHTML=''; streamDiv=null; };

/* font +/- */
function adj(d){ const s=parseFloat(getComputedStyle(chat).fontSize);
  const n=Math.max(10,s+d); chat.style.fontSize=n+'px'; input.style.fontSize=n+'px'; }
plusB.onclick =()=>adj( 2); minusB.onclick=()=>adj(-2);

function stopOWTimer() {
  if (ollamaWaitTimer) {
    clearInterval(ollamaWaitTimer);
    ollamaWaitTimer = null;
  }
}

/* misc UI */
checkB.onclick=()=>{ add('⏳ Checking Ollama…'); window.api.check(); };
window.api.onError(e=>add('⚠️ '+e));
// Показываем "not running, waiting..." и начинаем проверку
window.api.onOff(() => {
  //console.log('offline');
  add('⚠️ Ollama not running, waiting...');
  if (!ollamaWaitTimer) {
    ollamaWaitTimer = setInterval(() => {
      window.api.check(); // дергает main.js (prepare), который снова попытается подключиться
    }, 5000);
  }
});
// Когда появилась "Ollama ready!" — останавливаем проверки
window.api.onReady(() => {
  stopOWTimer();
  add('✅ Ollama ready!');
  //lock(false);
  input.focus();
});

window.api.onWrong(() => {
  cancelInitLoop();
  stopOWTimer();
  add('⚠️ Ollama model wrong! Exit, change and start once more...');
});

window.trayControl?.onCmd(cmd=>{
  if(cmd==='play' ) playback.click();
  if(cmd==='pause') playback.click();
  if(cmd==='stop' ) stopBtn.click();
});

add('⏳ Initializing…');
