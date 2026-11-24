import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  DEFAULT_NATIVE_VERSION_CODE,
  SUPPORTED_CAPACITOR_MAJOR,
  evaluateOtaCompatibility,
  type OtaChannel,
  type OtaManifestPayload,
} from '../utils/otaCompatibility.ts';

const OTA_ROOT_DIR = path.resolve(process.cwd(), 'dist-ota');
const SAFE_BUNDLE_FILENAME_REGEX = /^lazcakongym-ota-[a-zA-Z0-9._-]+\.zip$/;

function normalizeChannelParam(raw: unknown): OtaChannel {
  const val = String(raw || 'development').trim().toLowerCase();
  if (val === 'production') return 'production';
  if (val === 'staging') return 'staging';
  return 'development';
}

function parseManifestJson(rawJson: string | undefined): OtaManifestPayload | null {
  if (!rawJson || !rawJson.trim()) return null;
  try {
    const parsed = JSON.parse(rawJson);
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'string' && typeof parsed.url === 'string') {
      return parsed as OtaManifestPayload;
    }
  } catch {}
  return null;
}

function readLocalChannelManifest(channel: OtaChannel): OtaManifestPayload | null {
  const candidatePath = path.resolve(OTA_ROOT_DIR, `manifest.${channel}.json`);
  if (!candidatePath.startsWith(OTA_ROOT_DIR + path.sep)) {
    return null;
  }
  if (!fs.existsSync(candidatePath)) return null;
  try {
    return parseManifestJson(fs.readFileSync(candidatePath, 'utf8'));
  } catch {
    return null;
  }
}

export function handleGetOtaManifest(req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, max-age=0');
  const channel = normalizeChannelParam(req.query?.channel);
  const nativeVersionCode = Math.max(
    1,
    parseInt(String(req.query?.nativeVersionCode || DEFAULT_NATIVE_VERSION_CODE), 10) || DEFAULT_NATIVE_VERSION_CODE
  );

  // Strict fail-closed gate: production OTA stays disconnected until explicit authorization
  if (channel === 'production') {
    const prodEnabled = String(process.env.OTA_PRODUCTION_ENABLED || 'false').toLowerCase() === 'true';
    if (!prodEnabled) {
      res.status(200).json({
        success: true,
        enabled: false,
        channel: 'production',
        updateAvailable: false,
        manifest: null,
        reason: 'Canal OTA de producción desactivado hasta autorización explícita.',
      });
      return;
    }
    const prodManifest =
      parseManifestJson(process.env.OTA_MANIFEST_PRODUCTION_JSON) || readLocalChannelManifest('production');
    if (!prodManifest) {
      res.status(200).json({
        success: true,
        enabled: true,
        channel: 'production',
        updateAvailable: false,
        manifest: null,
      });
      return;
    }
    const compat = evaluateOtaCompatibility(prodManifest, nativeVersionCode);
    const channelMatches = prodManifest.channel === 'production';
    res.status(200).json({
      success: true,
      enabled: true,
      channel: 'production',
      updateAvailable: channelMatches && compat.compatible && !compat.requiresApkUpdate,
      manifest: channelMatches && compat.compatible ? prodManifest : null,
      reason: channelMatches ? compat.reason : 'El manifiesto no corresponde al canal OTA solicitado.',
    });
    return;
  }

  const devEnabled = String(process.env.OTA_DEV_CHANNEL_ENABLED || 'true').toLowerCase() !== 'false';
  if (!devEnabled) {
    res.status(200).json({
      success: true,
      enabled: false,
      channel,
      updateAvailable: false,
      manifest: null,
      reason: 'Canal OTA de desarrollo desactivado por configuración.',
    });
    return;
  }

  const envKey = channel === 'staging' ? 'OTA_MANIFEST_STAGING_JSON' : 'OTA_MANIFEST_DEV_JSON';
  const manifest = parseManifestJson(process.env[envKey]) || readLocalChannelManifest(channel);
  if (!manifest) {
    res.status(200).json({
      success: true,
      enabled: true,
      channel,
      updateAvailable: false,
      manifest: null,
      supportedCapacitorMajor: SUPPORTED_CAPACITOR_MAJOR,
    });
    return;
  }

  const compat = evaluateOtaCompatibility(manifest, nativeVersionCode);
  const channelMatches = manifest.channel === channel;
  res.status(200).json({
    success: true,
    enabled: true,
    channel,
    updateAvailable: channelMatches && compat.compatible && !compat.requiresApkUpdate,
    manifest: channelMatches && compat.compatible ? manifest : null,
    reason: channelMatches ? compat.reason : 'El manifiesto no corresponde al canal OTA solicitado.',
  });
}

export function handleGetOtaBundleZip(req: Request, res: Response): void {
  const devEnabled = String(process.env.OTA_DEV_CHANNEL_ENABLED || 'true').toLowerCase() !== 'false';
  const prodEnabled = String(process.env.OTA_PRODUCTION_ENABLED || 'false').toLowerCase() === 'true';
  if (!devEnabled && !prodEnabled) {
    res.status(403).json({ success: false, error: 'Servicio de paquetes OTA deshabilitado.' });
    return;
  }

  const filename = String(req.params?.filename || '').trim();
  if (!SAFE_BUNDLE_FILENAME_REGEX.test(filename)) {
    res.status(400).json({ success: false, error: 'Nombre de paquete OTA inválido.' });
    return;
  }

  const resolvedFile = path.resolve(OTA_ROOT_DIR, filename);
  if (!resolvedFile.startsWith(OTA_ROOT_DIR + path.sep)) {
    res.status(403).json({ success: false, error: 'Ruta fuera del directorio OTA permitido.' });
    return;
  }

  if (!fs.existsSync(resolvedFile)) {
    res.status(404).json({ success: false, error: 'Paquete OTA no encontrado.' });
    return;
  }

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  fs.createReadStream(resolvedFile).pipe(res);
}
