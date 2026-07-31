const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '../.next');
console.log('Cleaning .next folder at:', target);

try {
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log('Successfully removed .next folder');
  } else {
    console.log('.next folder does not exist');
  }
} catch (err) {
  console.error('Error removing .next folder:', err.message);
}
