const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  send : data => ipcRenderer.invoke('chat:send', data),
  check:     () => ipcRenderer.invoke('ollama:check'),

  onChunk: fn => ipcRenderer.on('chat:chunk',   (_e,t)=>fn(t)),
  onDone : fn => ipcRenderer.on('chat:done',    ()=>fn()),
  onHist : fn => ipcRenderer.on('chat:history', (_e,h)=>fn(h)),
  onCfg  : fn => ipcRenderer.on('app:config',   (_e,c)=>fn(c)),

  onError : fn => ipcRenderer.on('chat:error',   (_e,e)=>fn(e)),
  onOff   : fn => ipcRenderer.on('ollama:offline',()=>fn()),
  onReady : fn => ipcRenderer.on('model:ready',  ()=>fn()),
  onWrong : fn => ipcRenderer.on('model:wrong',  ()=>fn())
});

contextBridge.exposeInMainWorld('appConfig', {
  get: () => ipcRenderer.invoke('cfg:get')   // async Promise с полным конфигом
});

contextBridge.exposeInMainWorld('ttsSettings',{
  get: ()=> ipcRenderer.invoke('tts-get-settings'),
  onVolume:  cb=> ipcRenderer.on('tts-volume',   (_,v)=>cb(v)),
  onProvider:cb=> ipcRenderer.on('tts-provider', (_,p)=>cb(p))
});

contextBridge.exposeInMainWorld('trayControl',{
  notify: state => ipcRenderer.send('tts-state', state),   // playing|paused|stopped
  onCmd:  cb    => ipcRenderer.on('tts-command', (_,c)=>cb(c))
});