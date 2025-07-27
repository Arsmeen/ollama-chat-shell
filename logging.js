// logging.js
const iconv = require('iconv-lite');

/**
 * Универсальный вывод, который автоматически
 * перекодирует текст под старые Windows-консоли.
 *
 * Пример:
 *   const log = require('./logging');
 *   log('Привет, мир!', 42);
 */
function log(...args) {
  const msg = args.join(' ');
  if (process.platform === 'win32') {
    const enc  = process.env.TERM_PROGRAM ? 'cp1251' : 'cp866';
    const buff = iconv.encode(msg + '\n', enc);   // ← правильно
    process.stdout.write(buff);
  } else {
    console.log(msg);
  }
}

module.exports = log;          // экспортируем как функцию по умолчанию
