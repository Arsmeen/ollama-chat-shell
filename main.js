const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs   = require('fs');

const { isServerUp, ensureModel, askStream, generateStream } = require('./lib/ollama.js');
const history = require('./lib/history.js');

/* ---------- config ---------- */
const built = require('./config.json');
const ext   = path.join(process.cwd(), 'config.json');
const cfg   = fs.existsSync(ext) ? JSON.parse(fs.readFileSync(ext, 'utf8')) : built;

ipcMain.handle('cfg:get', () => {
  try {
    return cfg;
  } catch {
    return {};
  }
});

let curProvider = cfg.tts.use || '';
let curVolume   = (cfg.tts[curProvider]?.volume ?? cfg.tts.volume ?? 100);

function broadcast(channel, data){ BrowserWindow.getAllWindows()
  .forEach(w=>w.webContents.send(channel,data)); }

function buildMenu(){
  const haveOA = !!cfg.tts.OpenAI?.token;
  const haveEL = !!cfg.tts.ElevenLabs?.token;

  const template = [{
  label:'View',
  submenu:[
    {role:'reload'},
    {role:'forcereload'},
    {role:'toggledevtools', accelerator:'Ctrl+Shift+I'}  // ← хот-кей вернулся
    ]
  }, {
    label:'TTS',
    submenu:[
      {label:'System (free)', type:'radio', checked:!curProvider,
       click(){curProvider=''; broadcast('tts-provider',curProvider);} },
      {label:'OpenAI', type:'radio', enabled:haveOA,
       checked:curProvider==='OpenAI',
       click(){curProvider='OpenAI'; broadcast('tts-provider',curProvider);} },
      {label:'ElevenLabs', type:'radio', enabled:haveEL,
       checked:curProvider==='ElevenLabs',
       click(){curProvider='ElevenLabs'; broadcast('tts-provider',curProvider);} },
    ]
  },{
    label:'Volume',
    submenu:[...Array(10).keys()].map(i=>{
      const v=(i+1)*10;
      return {label:v+'%', type:'radio', checked:curVolume===v,
        click(){ curVolume=v; broadcast('tts-volume',v);} };
    })
  }];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(buildMenu);

ipcMain.handle('tts-get-settings', ()=>({provider:curProvider, volume:curVolume}));

let tray = null;
let isQuitting = false;

let isGenerating = false;
let isWindowHidden = false;
let blinkTimer = null;
let blinkState = false;
let ttsBlinkTimer = null;
let ttsBlinkState = false;
// Пути к иконкам
const trayIconNormal = path.join(__dirname, 'assets', 'tray.ico');
const trayIconBlink = path.join(__dirname, 'assets', 'tray_blink.ico');
const trayIconPlay   = path.join(__dirname, 'assets', 'tray_play.ico');

let win;
function send(ch, ...a) { win.webContents.send(ch, ...a); }

function createWindow() {
  win = new BrowserWindow({
    width: 600,
    height: 800,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });

  // --- ищем index.html там, где он реально лежит ---
  const htmlPath = fs.existsSync(path.join(__dirname, 'index.html'))
        ? path.join(__dirname, 'index.html')
        : path.join(__dirname, 'renderer', 'index.html');  // fallback

  win.loadFile(htmlPath);

  // === Добавить иконку в трей ===
  tray = new Tray(trayIconNormal);
  tray.setToolTip('SoulChat');
  const ctx = Menu.buildFromTemplate([
    { label:'Play',  click(){ sendCmd('play');  } },
    { label:'Pause', click(){ sendCmd('pause'); } },
    { label:'Stop',  click(){ sendCmd('stop');  } },
    { type:'separator' },
    { label:'Show',  click(){ win.show(); } },
    { label:'Exit',  click(){ isQuitting=true; app.quit(); } }
  ]);
  tray.setContextMenu(ctx);

  // Скрывать окно в трей при сворачивании (или при закрытии — по желанию)
  win.on('minimize', (event) => {
    event.preventDefault();
    win.hide();
    isWindowHidden = true;
    //console.log('minimize');
  });

  tray.on('click', () => {
    isWindowHidden = false;
    win.show();
  });

  // (по желанию) скрывать при close вместо выхода:
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      win.hide();
      isWindowHidden = true;
    }
    return false;
  });

  win.webContents.on('did-finish-load', () => {
    send('app:config', cfg);
    //console.log('[main] app:config отправлен после did-finish-load');
  });

  win.on('show', stopTrayBlink);
}

// ─── IPC helpers ───────────────────────────────────────────────────────
function sendCmd(cmd){ BrowserWindow.getAllWindows()
  .forEach(w=>w.webContents.send('tts-command',cmd)); }

ipcMain.on('tts-state', (_, state) => {
  if (!tray) return;

  if (state === 'playing'){
    clearInterval(ttsBlinkTimer);
    ttsBlinkTimer = setInterval(() => {
      ttsBlinkState = !ttsBlinkState;
      tray.setImage(ttsBlinkState ? trayIconPlay : trayIconNormal);
    }, 500);

  } else {                 // paused / stopped
    clearInterval(ttsBlinkTimer);
    ttsBlinkTimer = null;
    tray.setImage(state==='paused' ? trayIconNormal : trayIconNormal);
  }
});

function startTrayBlink() {
  if (blinkTimer) return;
  blinkTimer = setInterval(() => {
    blinkState = !blinkState;
    tray.setImage(blinkState ? trayIconBlink : trayIconNormal);
  }, 600);
}

function stopTrayBlink() {
  if (blinkTimer) clearInterval(blinkTimer);
  blinkTimer = null;
  tray.setImage(trayIconNormal);
}

async function prepare() {
  if (!(await isServerUp())) { send('ollama:offline'); return; }
  const ismodel = await ensureModel(cfg.model);
  if(ismodel) {
    send('model:ready');
    send('chat:history', history.loadDayEntries(cfg));
    //console.log('a');
  } else {
    send('model:wrong');
    //console.log('b');
  }
}

app.whenReady().then(async () => {
  createWindow();
  // send('app:config', cfg);
  // console.log(cfg.chat_font,cfg.input_font);
  await prepare();
});

/* ---------- IPC ---------- */
ipcMain.handle('ollama:check', prepare);

ipcMain.handle('chat:send', async (_e, { text, images }) => {
  const useGen = cfg.generate_with_images && images?.length;
  const mesInclIfImg = cfg.image_include_messages ?? 0;
  const allCtx = history.loadContext(cfg); // история сообщений до 3000 символов

  // если картинка и включён generate → оставляем только последнюю пару
  const ctx = useGen
    ? (() => {
        let last = [];
        if(mesInclIfImg) {
          last = history.loadDayEntries(cfg).slice(((0 - mesInclIfImg))); // если нужно последнюю пару
        }
        //console.log("mesInclIfImg: ",mesInclIfImg);
        return last.map(e => `User: ${e.user}\nAssistant: ${e.ai}`).join('\n');
        // return allCtx;
      })()
    : allCtx;

  // формируем текст user'a
  let msgText = text;
  if (useGen) {
    if (cfg.image_pre_message) {
      msgText = `${cfg.image_pre_message}\n${msgText}`;
    } else {
      msgText = `${msgText}`;
    }
  }
  const prompt = `${cfg.system_prompt}\n\n${ctx}\n\nUser: ${msgText}\nAssistant:`;
  const temp   = cfg.temperature ?? 0.7;

  //console.log("Promt: ",prompt);

  const stream = useGen
      ? generateStream(cfg.model, prompt, temp, images)
      : askStream       (cfg.model, prompt, temp, images);

  let ans = '';
  isGenerating = true;
  stream.on('token', t => {
    ans += t;
    send('chat:chunk', t);
  });
  stream.once('end', () => {
    isGenerating = false;
    if (isWindowHidden) startTrayBlink();
    else stopTrayBlink();
    history.addEntry(cfg, { user: text, ai: ans });
    send('chat:done');
  });
  stream.on('error', e => send('chat:error', e.toString()));
  return null;
});