import fs from 'fs';
import path from 'path';

const publicDir = path.resolve(process.cwd(), 'public');
const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.png'));

console.log('--- PNG DIMENSIONS REPORT ---');
for (const file of files) {
  const filePath = path.join(publicDir, file);
  const buffer = fs.readFileSync(filePath);
  
  // PNG IHDR chunk starts at offset 16 (4 bytes length 'IHDR', 4 bytes width, 4 bytes height)
  if (buffer.length > 24 && buffer[12] === 0x49 && buffer[13] === 0x48 && buffer[14] === 0x44 && buffer[15] === 0x52) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    console.log(`${file}: ${width}x${height} (${buffer.length} bytes)`);
  } else {
    console.log(`${file}: Not a valid PNG or IHDR not found (${buffer.length} bytes)`);
  }
}
console.log('-----------------------------');
