const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Получить путь к основному файлу истории
function handleFile(cfg) {
  const dir = cfg.history_dir || './chat_history';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `ChatHistory.json.gz`);
}

// Получить путь для архивной истории с датой
function datedFile(cfg) {
  const dir = cfg.history_dir || './chat_history';
  const date = new Date().toISOString().slice(0, 10);
  let n = 0, file;
  do {
    file = path.join(dir, `ChatHistory_${date}${n ? '_' + n : ''}.json.gz`);
    n++;
  } while (fs.existsSync(file));
  return file;
}

// Ограничить массив символами с конца (оставить свежие)
function limitByChars(arr, maxChars) {
  if (!maxChars || maxChars < 1000) return arr;
  let out = [];
  let len = 0;
  for (let i = arr.length - 1; i >= 0; i--) {
    const msg = JSON.stringify(arr[i]);
    len += msg.length;
    if (len > maxChars) break;
    out.unshift(arr[i]);
  }
  return out;
}

// Сохранить новую запись (и делать ротацию если нужно)
function addEntry(cfg, entry) {
  const file = handleFile(cfg);
  let data = [];
  if (fs.existsSync(file)) {
    data = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  }
  data.push({ ts: Date.now(), ...entry });

  // Проверка размера
  const maxSize = (cfg.history_max_file_kb || 500) * 1024;
  const gzBuf = zlib.gzipSync(Buffer.from(JSON.stringify(data)));
  if (gzBuf.length > maxSize) {
    // Обрезать историю
    const trimmed = limitByChars(data, cfg.history_max_chars || 3000);
    // Архивировать старое в отдельный файл по дате
    fs.writeFileSync(datedFile(cfg), gzBuf);
    // Перезаписать основной файл только свежими
    const newGz = zlib.gzipSync(Buffer.from(JSON.stringify(trimmed)));
    fs.writeFileSync(file, newGz);
  } else {
    fs.writeFileSync(file, gzBuf);
  }
}

// Вытащить массив для контекста промпта
function loadContext(cfg) {
  const file = handleFile(cfg);
  if (!fs.existsSync(file)) return cfg.start_prompt || '';
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  const concat = raw.map(e => `User: ${e.user}\nAssistant: ${e.ai}`).join('\n');
  return (cfg.start_prompt || '') + '\n' + concat.slice(-(cfg.history_max_chars || 3000));
}

// Получить все записи текущей истории
function loadDayEntries(cfg) {
  const file = handleFile(cfg);
  return fs.existsSync(file)
    ? JSON.parse(zlib.gunzipSync(fs.readFileSync(file)))
    : [];
}

module.exports = { addEntry, loadContext, loadDayEntries };