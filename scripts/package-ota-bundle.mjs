#!/usr/bin/env node
/**
 * Builds a checksum-verified Capacitor OTA web bundle (.zip) from `dist/`
 * into `dist-ota/` alongside `manifest.development.json`.
 *
 * Security & Compatibility Guardrails:
 * - Strictly packages web assets (`dist/`) only.
 * - Rejects packaging when native Android/iOS files changed (`--native-changed` or `--changed-files`).
 * - Generates exact SHA-256 checksum for @capgo/capacitor-updater verification.
 * - Targets `development` channel by default (never auto-publishes production).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST_DIR = path.resolve(process.cwd(), 'dist');
const OTA_OUT_DIR = path.resolve(process.cwd(), 'dist-ota');
const DEFAULT_BASE_URL = process.env.OTA_PUBLIC_BASE_URL || 'https://lazcakongym.ai.studio';

const NATIVE_CHANGE_PATTERNS = [
  /^android\//i,
  /^ios\//i,
  /^capacitor\.config\.(ts|js|json)$/i,
  /^package(-lock)?\.json$/i,
];

function computeCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function collectFilesRecursively(rootDir, currentDir = rootDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFilesRecursively(rootDir, fullPath));
    } else if (entry.isFile()) {
      const rel = path.relative(rootDir, fullPath).split(path.sep).join('/');
      results.push({ fullPath, zipPath: rel });
    }
  }
  return results;
}

function buildZipBuffer(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const rawData = fs.readFileSync(file.fullPath);
    const compressedData = zlib.deflateRawSync(rawData, { level: 9 });
    const crc = computeCrc32(rawData);
    const nameBuf = Buffer.from(file.zipPath, 'utf8');

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename
    localHeader.writeUInt16LE(8, 8); // Deflate
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressedData);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedData.length, 20);
    centralHeader.writeUInt32LE(rawData.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressedData.length;
  }

  const centralSize = centralParts.reduce((acc, buf) => acc + buf.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function parseCliArgs(argv) {
  const args = {
    version: process.env.OTA_BUNDLE_VERSION || '',
    channel: process.env.OTA_CHANNEL || 'development',
    minNativeVersionCode: parseInt(process.env.OTA_MIN_NATIVE_VERSION_CODE || '1', 10) || 1,
    nativeChanged: false,
    changedFiles: [],
    baseUrl: DEFAULT_BASE_URL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--native-changed') args.nativeChanged = true;
    else if (token === '--version' && argv[i + 1]) args.version = argv[++i];
    else if (token === '--channel' && argv[i + 1]) args.channel = argv[++i];
    else if (token === '--base-url' && argv[i + 1]) args.baseUrl = argv[++i];
    else if (token === '--min-native' && argv[i + 1]) args.minNativeVersionCode = parseInt(argv[++i], 10) || 1;
    else if (token === '--changed-files' && argv[i + 1]) {
      args.changedFiles = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return args;
}

function resolveFallbackVersion() {
  try {
    const updateAppSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/updateApp.ts'), 'utf8');
    const match = updateAppSrc.match(/export const APP_VERSION\s*=\s*['"]v?([^'"]+)['"]/);
    if (match?.[1]) return match[1];
  } catch {}
  return '6.4.2';
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.nativeChanged) {
    console.error('[OTA BLOCKED] Se indicaron cambios nativos (--native-changed). Compila un APK nuevo; no uses OTA.');
    process.exit(1);
  }

  const nativeTouch = args.changedFiles.find((f) => NATIVE_CHANGE_PATTERNS.some((rx) => rx.test(f)));
  if (nativeTouch) {
    console.error(`[OTA BLOCKED] Archivo nativo modificado (${nativeTouch}). Los cambios nativos requieren APK, nunca OTA.`);
    process.exit(1);
  }

  if (!fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
    console.error('[OTA ERROR] dist/index.html no existe. Ejecuta `npm run build` antes de empaquetar OTA.');
    process.exit(1);
  }

  const rawVersion = (args.version || resolveFallbackVersion()).replace(/^v/i, '');
  const cleanChannel = args.channel === 'staging' ? 'staging' : 'development';
  if (args.channel === 'production' && process.env.OTA_PRODUCTION_ENABLED !== 'true') {
    console.error('[OTA BLOCKED] El canal production requiere OTA_PRODUCTION_ENABLED=true bajo autorización explícita.');
    process.exit(1);
  }

  const files = collectFilesRecursively(DIST_DIR);
  const zipBuffer = buildZipBuffer(files);
  const checksum = crypto.createHash('sha256').update(zipBuffer).digest('hex');

  fs.mkdirSync(OTA_OUT_DIR, { recursive: true });
  const zipFilename = `lazcakongym-ota-${rawVersion.replace(/[^a-zA-Z0-9._-]/g, '_')}.zip`;
  const zipPath = path.join(OTA_OUT_DIR, zipFilename);
  fs.writeFileSync(zipPath, zipBuffer);

  const normalizedBase = args.baseUrl.replace(/\/+$/, '');
  const manifest = {
    version: rawVersion,
    buildId: `${rawVersion}-ota-${checksum.slice(0, 8)}`,
    channel: cleanChannel,
    url: `${normalizedBase}/api/ota/bundles/${zipFilename}`,
    checksum,
    contentsPolicy: 'web_assets_only',
    changedScopes: ['ui', 'library', 'react_ts', 'assets'],
    requiresApkUpdate: false,
    minNativeVersionCode: args.minNativeVersionCode,
    capacitorMajor: 8,
    publishedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(OTA_OUT_DIR, `manifest.${cleanChannel}.json`);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`[OTA READY] Bundle: ${zipFilename} (${zipBuffer.length} bytes)`);
  console.log(`[OTA READY] SHA-256: ${checksum}`);
  console.log(`[OTA READY] Manifest (${cleanChannel}): ${manifestPath}`);
}

main();
