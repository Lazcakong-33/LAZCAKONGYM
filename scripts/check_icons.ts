import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const publicDir = path.resolve(process.cwd(), 'public');
const files = fs.readdirSync(publicDir).filter(f => f.includes('v5') || f.includes('pwa') || f.includes('icon'));

console.log('--- PWA ICON DIAGNOSTIC REPORT ---');
for (const file of files) {
  const filePath = path.join(publicDir, file);
  const stat = fs.statSync(filePath);
  const buffer = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  
  const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  const isJpg = buffer.length > 2 && buffer[0] === 0xFF && buffer[1] === 0xD8;
  const isSvg = buffer.toString('utf8', 0, 100).includes('<svg');
  
  console.log(`${file}:`);
  console.log(`  - Size: ${stat.size} bytes`);
  console.log(`  - SHA256: ${hash}`);
  console.log(`  - Format: ${isPng ? 'PNG' : isJpg ? 'JPG' : isSvg ? 'SVG' : 'OTHER/ICO'}`);
}
console.log('-----------------------------------');
