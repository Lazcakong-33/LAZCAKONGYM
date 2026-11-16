const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function createPng(width, height, drawPixel) {
  const scanlineLength = 1 + width * 4;
  const rawData = Buffer.alloc(scanlineLength * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    rawData[rowOffset] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = drawPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const deflated = zlib.deflateSync(rawData);

  function crc32(buf) {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      crc = (crc ^ buf[i]) >>> 0;
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const typeAndData = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(typeAndData), 0);
    return Buffer.concat([len, typeAndData, crcBuf]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;

  const ihdr = makeChunk('IHDR', ihdrData);
  const idat = makeChunk('IDAT', deflated);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idat, iend]);
}

// Icon design: Dark athletic background (#0b0f19) with glowing crimson hex/shield, barbell, and "L" emblem
function drawGymIcon(x, y, w, h, isMaskable = false) {
  // Normalize coords from -1 to 1
  const scale = isMaskable ? 0.72 : 0.88;
  const nx = ((x / w) * 2 - 1) / scale;
  const ny = ((y / h) * 2 - 1) / scale;
  const dist = Math.sqrt(nx * nx + ny * ny);

  // Background base
  let r = 11, g = 15, b = 25, a = 255;

  // Subtle radial gradient in background
  const bgGrad = Math.max(0, 1 - dist * 0.5);
  r = Math.min(255, Math.round(11 + 25 * bgGrad));
  g = Math.min(255, Math.round(15 + 10 * bgGrad));
  b = Math.min(255, Math.round(25 + 30 * bgGrad));

  // Outer glowing ring
  if (dist >= 0.76 && dist <= 0.84) {
    const ringT = 1 - Math.abs(dist - 0.8) / 0.04;
    r = Math.round(r * (1 - ringT) + 225 * ringT);
    g = Math.round(g * (1 - ringT) + 29 * ringT);
    b = Math.round(b * (1 - ringT) + 72 * ringT);
  }

  // Barbell shaft: ny in [-0.08, 0.08], nx in [-0.68, 0.68]
  const isShaft = Math.abs(ny) <= 0.06 && Math.abs(nx) <= 0.65;
  if (isShaft) {
    r = 241; g = 245; b = 249; // Bright steel white
  }

  // Weight plates on left and right
  // Inner plate: |nx| in [0.38, 0.44], |ny| <= 0.32
  const isInnerPlate = Math.abs(nx) >= 0.38 && Math.abs(nx) <= 0.44 && Math.abs(ny) <= 0.32;
  // Middle big plate: |nx| in [0.46, 0.53], |ny| <= 0.42
  const isMidPlate = Math.abs(nx) >= 0.46 && Math.abs(nx) <= 0.53 && Math.abs(ny) <= 0.42;
  // Outer plate: |nx| in [0.55, 0.60], |ny| <= 0.26
  const isOuterPlate = Math.abs(nx) >= 0.55 && Math.abs(nx) <= 0.60 && Math.abs(ny) <= 0.26;
  // Plate collars: |nx| in [0.34, 0.37], |ny| <= 0.12
  const isCollar = Math.abs(nx) >= 0.34 && Math.abs(nx) <= 0.37 && Math.abs(ny) <= 0.12;

  if (isInnerPlate || isOuterPlate) {
    // Crimson plate
    r = 225; g = 29; b = 72;
  } else if (isMidPlate) {
    // Vibrant rose-red plate with gradient
    r = 244; g = 63; b = 94;
  } else if (isCollar) {
    r = 148; g = 163; b = 184; // Silver collar
  }

  // Central Emblem: Stylized bold "L" inside a dark round emblem with red border
  // Emblem circle at center: dist <= 0.34
  if (dist <= 0.34) {
    if (dist >= 0.31) {
      // Golden / red border for emblem
      r = 251; g = 191; b = 36; // Amber gold
    } else {
      // Dark badge core
      r = 15; g = 23; b = 42;
      
      // Draw bold "L" in center
      // Vertical bar of L: nx in [-0.14, -0.04], ny in [-0.20, 0.16]
      const isLVert = nx >= -0.14 && nx <= -0.04 && ny >= -0.20 && ny <= 0.16;
      // Horizontal bar of L: nx in [-0.14, 0.15], ny in [0.07, 0.16]
      const isLHoriz = nx >= -0.14 && nx <= 0.15 && ny >= 0.07 && ny <= 0.16;
      // Slanted power lightning cut in L
      const isCrownDot = Math.abs(nx) <= 0.04 && ny >= -0.26 && ny <= -0.22;

      if (isLVert || isLHoriz || isCrownDot) {
        r = 255; g = 255; b = 255; // Crisp White L
      }
    }
  }

  return [r, g, b, a];
}

const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

// Generate sizes
console.log('Generating PWA Icons...');

const sizes = [
  { file: 'pwa-192x192.png', size: 192, maskable: false },
  { file: 'pwa-512x512.png', size: 512, maskable: false },
  { file: 'pwa-maskable-512x512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
  { file: 'favicon-32x32.png', size: 32, maskable: false },
];

for (const { file, size, maskable } of sizes) {
  const buf = createPng(size, size, (x, y, w, h) => drawGymIcon(x, y, w, h, maskable));
  fs.writeFileSync(path.join(publicDir, file), buf);
  console.log(`Created ${file} (${size}x${size}, ${buf.length} bytes)`);
}

// Also create public/icon.svg
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0f172a" />
      <stop offset="50%" stop-color="#090d16" />
      <stop offset="100%" stop-color="#1e1122" />
    </linearGradient>
    <linearGradient id="crimson" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#f43f5e" />
      <stop offset="100%" stop-color="#be123c" />
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fde047" />
      <stop offset="100%" stop-color="#ca8a04" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="8" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="512" height="512" rx="108" fill="url(#bg)" />

  <!-- Outer Ring Glow -->
  <circle cx="256" cy="256" r="210" fill="none" stroke="url(#crimson)" stroke-width="6" opacity="0.85" filter="url(#glow)" />
  <circle cx="256" cy="256" r="200" fill="none" stroke="#e11d48" stroke-width="2" opacity="0.4" stroke-dasharray="10 6" />

  <!-- Barbell Bar -->
  <rect x="75" y="244" width="362" height="24" rx="12" fill="#f8fafc" />
  
  <!-- Collars -->
  <rect x="150" y="234" width="14" height="44" rx="4" fill="#94a3b8" />
  <rect x="348" y="234" width="14" height="44" rx="4" fill="#94a3b8" />

  <!-- Left Plates -->
  <rect x="168" y="196" width="22" height="120" rx="7" fill="url(#crimson)" />
  <rect x="122" y="174" width="24" height="164" rx="8" fill="#e11d48" />
  <rect x="94" y="206" width="24" height="100" rx="6" fill="#be123c" />

  <!-- Right Plates -->
  <rect x="322" y="196" width="22" height="120" rx="7" fill="url(#crimson)" />
  <rect x="366" y="174" width="24" height="164" rx="8" fill="#e11d48" />
  <rect x="394" y="206" width="24" height="100" rx="6" fill="#be123c" />

  <!-- Center Badge -->
  <circle cx="256" cy="256" r="88" fill="#090d16" stroke="url(#gold)" stroke-width="6" filter="url(#glow)" />
  <circle cx="256" cy="256" r="76" fill="#0f172a" />

  <!-- Center Monogram "L" + Power Icon -->
  <path d="M228 200 H248 V290 H284 V312 H228 Z" fill="#ffffff" />
  <polygon points="274,204 290,204 278,226 294,226 266,260 274,236 262,236" fill="#f59e0b" />
</svg>`;

fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent, 'utf-8');
console.log('Created icon.svg');
