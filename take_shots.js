const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = 'file:///' + path.resolve('out/dashboard/index.html').replace(/\\/g, '/');
const outDir = path.resolve('out/dashboard');

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync('screenshots', { recursive: true });
fs.mkdirSync('out/screenshots', { recursive: true });

console.log('Capturing 1-board.png...');
execSync(`"${chrome}" --headless --disable-gpu --window-size=1440,900 --screenshot="${path.join(outDir, '1-board.png')}" "${base}"`);

console.log('Capturing 2-detail.png...');
execSync(`"${chrome}" --headless --disable-gpu --window-size=1440,900 --screenshot="${path.join(outDir, '2-detail.png')}" "${base}#p=steakhouse-financial"`);

console.log('Capturing 3-filtered.png...');
execSync(`"${chrome}" --headless --disable-gpu --window-size=1440,900 --screenshot="${path.join(outDir, '3-filtered.png')}" "${base}#category=Dexs"`);

['1-board.png', '2-detail.png', '3-filtered.png'].forEach(name => {
  const src = path.join(outDir, name);
  const dest1 = path.join('screenshots', name);
  const dest2 = path.join('out/screenshots', name);
  fs.copyFileSync(src, dest1);
  fs.copyFileSync(src, dest2);
  console.log(name, 'size:', fs.statSync(dest1).size, 'bytes');
});
console.log('Screenshots captured successfully.');
