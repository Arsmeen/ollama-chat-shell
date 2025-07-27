const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

// Папка, где лежат архивы (проверь путь!)
const zipsDir = path.join(__dirname, '..', 'out', 'make', 'zip', 'win32', 'x64');
const configPath = path.join(__dirname, '..', 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('Not found config.json:', configPath);
  process.exit(1);
}

const files = fs.readdirSync(zipsDir)
  .filter(f => /^SoulChat-win32-x64.*\.zip$/.test(f));

if (files.length === 0) {
  console.log('Found archives:', zipsDir);
  process.exit(0);
}

// Добавляем config.json в каждый архив
files.forEach(f => {
  const zipPath = path.join(zipsDir, f);
  const zip = new AdmZip(zipPath);
  zip.addLocalFile(configPath, '');
  zip.writeZip(zipPath);
  console.log('Adding config.json to:', zipPath);
});

console.log('Ready!');
