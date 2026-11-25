#!/usr/bin/env node
/**
 * Builds a checksum-verified (and optionally Ed25519-signed) Capacitor OTA web bundle (.zip)
 * from `dist/` into `dist-ota/` alongside `manifest.{channel}.json` and `SHA256SUMS.txt`.
 *
 * Security & Compatibility Guardrails:
 * - Strictly packages web assets (`dist/`) only.
 * - Rejects packaging when native Android/iOS files changed (`--native-changed` or `--changed-files`).
 * - Generates exact SHA-256 checksum for @capgo/capacitor-updater verification.
 * - Optionally signs canonical manifest payload with Ed25519 private key (`OTA_MANIFEST_PRIVATE_KEY_PEM`).
 * - Targets `development` channel by default (never auto-publishes production without explicit env authorization).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DIST_DIR = path.resolve(process.cwd(), 'dist');
const OTA_OUT_DIR = path.resolve(process.cwd(), 'dist-ota');
const DEFAULT_BASE_URL = process.env.OTA_PUBLIC_BASE_URL || 'https://lazcakongym.ai.studio';
const DEFAULT_RELEASE_APK_URL =
  'https://github.com/Lazcakong-33/LAZCAKONGYM/releases/latest/download/app-release.apk';

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
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
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

function buildCanonicalSigningPayload(manifest) {
  return [
    String(manifest.version || '').trim(),
    String(manifest.buildId || '').trim(),
    String(manifest.channel || 'development').trim(),
    String(manifest.url || '').trim(),
    String(manifest.checksum || '').trim().toLowerCase(),
    String(manifest.contentsPolicy || 'web_assets_only').trim(),
    String(Number(manifest.minNativeVersionCode) || 1),
    String(Number(manifest.capacitorMajor) || 8),
    manifest.requiresApkUpdate ? '1' : '0',
    manifest.urgency === 'critical' ? 'critical' : 'optional',
  ].join('|');
}

function parseCliArgs(argv) {
  const args = {
    version: process.env.OTA_BUNDLE_VERSION || '',
    channel: process.env.OTA_CHANNEL || 'development',
    minNativeVersionCode: parseInt(process.env.OTA_MIN_NATIVE_VERSION_CODE || '1', 10) || 1,
    nativeChanged: false,
    changedFiles: [],
    baseUrl: DEFAULT_BASE_URL,
    notes: process.env.OTA_RELEASE_NOTES || '',
    urgency: process.env.OTA_URGENCY === 'critical' ? 'critical' : 'optional',
    apkUrl: process.env.OTA_APK_DOWNLOAD_URL || DEFAULT_RELEASE_APK_URL,
    bundleBasePath: '',
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--native-changed') args.nativeChanged = true;
    else if (token === '--version' && argv[i + 1]) args.version = argv[++i];
    else if (token === '--channel' && argv[i + 1]) args.channel = argv[++i];
    else if (token === '--base-url' && argv[i + 1]) args.baseUrl = argv[++i];
    else if (token === '--bundle-base-url' && argv[i + 1]) args.bundleBasePath = argv[++i];
    else if (token === '--min-native' && argv[i + 1]) args.minNativeVersionCode = parseInt(argv[++i], 10) || 1;
    else if (token === '--notes' && argv[i + 1]) args.notes = argv[++i];
    else if (token === '--urgency' && argv[i + 1]) {
      args.urgency = argv[++i] === 'critical' ? 'critical' : 'optional';
    } else if (token === '--apk-url' && argv[i + 1]) args.apkUrl = argv[++i];
    else if (token === '--changed-files' && argv[i + 1]) {
      args.changedFiles = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return args;
}

function resolveFallbackVersion() {
  try {
    const updateAppSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/updateApp.ts'), 'utf8');
    const match = updateAppSrc.match(
      /export const (?:DEFAULT_APP_VERSION|APP_VERSION)\s*=\s*['"]v?([^'"]+)['"]/
    );
    if (match?.[1]) return match[1];
  } catch {}
  return '7.0.0';
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
  const cleanChannel =
    args.channel === 'production'
      ? 'production'
      : args.channel === 'staging'
        ? 'staging'
        : 'development';

  if (cleanChannel === 'production' && process.env.OTA_PRODUCTION_ENABLED !== 'true') {
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
  const resolvedZipUrl = args.bundleBasePath
    ? `${args.bundleBasePath.replace(/\/+$/, '')}/${zipFilename}`
    : `${normalizedBase}/api/ota/bundles/${zipFilename}`;

  const manifest = {
    version: rawVersion,
    buildId: `${rawVersion}-ota-${checksum.slice(0, 8)}`,
    channel: cleanChannel,
    url: resolvedZipUrl,
    checksum,
    contentsPolicy: 'web_assets_only',
    changedScopes: ['ui', 'library', 'react_ts', 'assets'],
    requiresApkUpdate: false,
    apkDownloadUrl: args.apkUrl,
    urgency: args.urgency,
    minNativeVersionCode: args.minNativeVersionCode,
    capacitorMajor: 8,
    releaseNotes:
      args.notes || `Actualización OTA ${rawVersion} de LAZCAKONG GYM (${cleanChannel}).`,
    publishedAt: new Date().toISOString(),
  };

  const privateKeyPem = String(process.env.OTA_MANIFEST_PRIVATE_KEY_PEM || '').trim();
  if (cleanChannel === 'production' && !privateKeyPem) {
    console.error('[OTA BLOCKED] El canal production exige firma criptográfica Ed25519 obligatoria (OTA_MANIFEST_PRIVATE_KEY_PEM).');
    process.exit(1);
  }
  if (privateKeyPem) {
    const canonicalPayload = Buffer.from(buildCanonicalSigningPayload(manifest), 'utf8');
    const sig = crypto.sign(null, canonicalPayload, privateKeyPem).toString('base64');
    manifest.signature = sig;
    manifest.signatureAlgorithm = 'ed25519';

    const publicKeyPem = String(process.env.OTA_MANIFEST_PUBLIC_KEY_PEM || '').trim();
    if (publicKeyPem) {
      const ok = crypto.verify(null, canonicalPayload, publicKeyPem, Buffer.from(sig, 'base64'));
      if (!ok) {
        console.error('[OTA ERROR] La firma Ed25519 generada no coincide con OTA_MANIFEST_PUBLIC_KEY_PEM.');
        process.exit(1);
      }
    }
  }

  const manifestFilename = `manifest.${cleanChannel}.json`;
  const manifestPath = path.join(OTA_OUT_DIR, manifestFilename);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const manifestChecksum = crypto
    .createHash('sha256')
    .update(fs.readFileSync(manifestPath))
    .digest('hex');
  fs.writeFileSync(
    path.join(OTA_OUT_DIR, 'SHA256SUMS.txt'),
    `${checksum}  ${zipFilename}\n${manifestChecksum}  ${manifestFilename}\n`,
    'utf8'
  );

  console.log(`[OTA READY] Bundle: ${zipFilename} (${zipBuffer.length} bytes)`);
  console.log(`[OTA READY] SHA-256: ${checksum}`);
  console.log(`[OTA READY] Signed: ${manifest.signature ? 'Ed25519' : 'unsigned (checksum-only)'}`);
  console.log(`[OTA READY] Manifest (${cleanChannel}): ${manifestPath}`);
}

main();
