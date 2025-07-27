const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'chat_history');

if (fs.existsSync(dir)) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Folder chat_history deleted');
} else {
  console.log('Folder chat_history not present — all is OK');
}