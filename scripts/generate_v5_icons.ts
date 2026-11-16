import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

async function generateIcons() {
  const publicDir = path.resolve(process.cwd(), 'public');
  const sourceImage = path.join(publicDir, 'brand_logo.png'); // or pwa-512x512.png
  
  if (!fs.existsSync(sourceImage)) {
    console.error('Source image not found:', sourceImage);
    return;
  }

  console.log('Generating V5 elite PWA icons from:', sourceImage);

  // 1. Any 192x192
  const any192Path = path.join(publicDir, 'lazcakong-elite-v5-any-192.png');
  await sharp(sourceImage)
    .resize(192, 192, { fit: 'contain', background: { r: 9, g: 9, b: 9, alpha: 1 } })
    .png()
    .toFile(any192Path);

  // 2. Any 512x512
  const any512Path = path.join(publicDir, 'lazcakong-elite-v5-any-512.png');
  await sharp(sourceImage)
    .resize(512, 512, { fit: 'contain', background: { r: 9, g: 9, b: 9, alpha: 1 } })
    .png()
    .toFile(any512Path);

  // 3. Maskable 192x192 (with 20% safe zone padding so Android mask doesn't crop the gorilla head)
  const maskable192Path = path.join(publicDir, 'lazcakong-elite-v5-maskable-192.png');
  const inner192 = await sharp(sourceImage)
    .resize(140, 140, { fit: 'contain', background: { r: 9, g: 9, b: 9, alpha: 1 } })
    .toBuffer();
  await sharp({
    create: {
      width: 192,
      height: 192,
      channels: 4,
      background: { r: 9, g: 9, b: 9, alpha: 1 }
    }
  })
    .composite([{ input: inner192, left: 26, top: 26 }])
    .png()
    .toFile(maskable192Path);

  // 4. Maskable 512x512 (with 20% safe zone padding)
  const maskable512Path = path.join(publicDir, 'lazcakong-elite-v5-maskable-512.png');
  const inner512 = await sharp(sourceImage)
    .resize(360, 360, { fit: 'contain', background: { r: 9, g: 9, b: 9, alpha: 1 } })
    .toBuffer();
  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 9, g: 9, b: 9, alpha: 1 }
    }
  })
    .composite([{ input: inner512, left: 76, top: 76 }])
    .png()
    .toFile(maskable512Path);

  console.log('V5 Icons generated successfully. Verifying...');

  const files = [
    'lazcakong-elite-v5-any-192.png',
    'lazcakong-elite-v5-any-512.png',
    'lazcakong-elite-v5-maskable-192.png',
    'lazcakong-elite-v5-maskable-512.png'
  ];

  for (const f of files) {
    const p = path.join(publicDir, f);
    const buf = fs.readFileSync(p);
    const stat = fs.statSync(p);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const isPng = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    console.log(`- ${f}: ${width}x${height}, PNG: ${isPng}, Size: ${stat.size} bytes, SHA256: ${hash}`);
  }
}

generateIcons().catch(console.error);
