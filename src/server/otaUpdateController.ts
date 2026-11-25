import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  isAuthorizedAdminEmail,
  type AuthenticatedUser,
} from './firebaseAdminServer.ts';

export type OtaChannel = 'development' | 'staging' | 'production';
export type OtaUrgency = 'optional' | 'critical';

export type OtaChangedScope =
  | 'ui'
  | 'library'
  | 'react_ts'
  | 'assets'
  | 'android_java'
  | 'android_manifest'
  | 'gradle'
  | 'native_plugin'
  | 'keystore'
  | 'ios_swift';

export const FORBIDDEN_OTA_NATIVE_SCOPES: readonly OtaChangedScope[] = [
  'android_java',
  'android_manifest',
  'gradle',
  'native_plugin',
  'keystore',
  'ios_swift',
] as const;

export const DEFAULT_NATIVE_VERSION_CODE = 1;
export const DEFAULT_NATIVE_VERSION_NAME = '1.0';
export const SUPPORTED_CAPACITOR_MAJOR = 8;
export const OFFICIAL_GITHUB_REPO = 'Lazcakong-33/LAZCAKONGYM';
export const OFFICIAL_GITHUB_RELEASES_URL = `https://github.com/${OFFICIAL_GITHUB_REPO}/releases/latest`;
export const OFFICIAL_RELEASE_APK_DOWNLOAD_URL = `https://github.com/${OFFICIAL_GITHUB_REPO}/releases/latest/download/app-release.apk`;

export interface OtaManifestPayload {
  version: string;
  buildId: string;
  channel: OtaChannel;
  url: string;
  checksum: string;
  contentsPolicy: 'web_assets_only' | string;
  changedScopes?: OtaChangedScope[];
  requiresApkUpdate?: boolean;
  apkDownloadUrl?: string;
  urgency?: OtaUrgency;
  signature?: string;
  signatureAlgorithm?: 'ed25519';
  minNativeVersionCode: number;
  maxNativeVersionCode?: number;
  capacitorMajor: number;
  releaseNotes?: string;
  publishedAt?: string;
  publishedBy?: string;
  status?: 'active' | 'rolled_back';
}

export interface OtaManifestResponse {
  success: boolean;
  enabled: boolean;
  channel: OtaChannel;
  updateAvailable: boolean;
  manifest: OtaManifestPayload | null;
  apkDownloadUrl?: string;
  reason?: string;
}

export interface OtaValidationResult {
  valid: boolean;
  compatible: boolean;
  requiresApkUpdate: boolean;
  reason?: string;
}

export type OtaDeviceTelemetryStatus =
  | 'up_to_date'
  | 'downloading'
  | 'staged'
  | 'updated'
  | 'deferred_workout'
  | 'rolled_back'
  | 'error';

export interface OtaDeviceTelemetryRecord {
  deviceKey: string;
  uid: string;
  email?: string;
  platform: 'android_apk' | 'ios_app' | 'pwa' | 'web';
  channel: OtaChannel;
  installedVersion: string;
  installedBuildId: string;
  nativeVersionCode: number;
  targetVersion?: string;
  status: OtaDeviceTelemetryStatus;
  errorMessage?: string;
  updatedAt: string;
}

interface PersistedOtaControlState {
  activeByChannel: Partial<Record<OtaChannel, OtaManifestPayload>>;
  historyByChannel: Partial<Record<OtaChannel, OtaManifestPayload[]>>;
  telemetry: OtaDeviceTelemetryRecord[];
}

const OTA_ROOT_DIR = path.resolve(process.cwd(), 'dist-ota');
const OTA_STATE_FILE = path.resolve(OTA_ROOT_DIR, 'ota-control-state.json');
const SAFE_BUNDLE_FILENAME_REGEX = /^lazcakongym-ota-[a-zA-Z0-9._-]+\.zip$/;
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const MAX_HISTORY_PER_CHANNEL = 15;
const MAX_TELEMETRY_RECORDS = 400;

export function buildCanonicalManifestSigningPayload(manifest: {
  version: string;
  buildId: string;
  channel: OtaChannel;
  url: string;
  checksum: string;
  contentsPolicy: string;
  minNativeVersionCode: number;
  capacitorMajor: number;
  requiresApkUpdate?: boolean;
  urgency?: OtaUrgency;
}): string {
  return [
    String(manifest.version || '').trim(),
    String(manifest.buildId || '').trim(),
    String(manifest.channel || 'development').trim(),
    String(manifest.url || '').trim(),
    String(manifest.checksum || '').trim().toLowerCase(),
    String(manifest.contentsPolicy || 'web_assets_only').trim(),
    String(Number(manifest.minNativeVersionCode) || 1),
    String(Number(manifest.capacitorMajor) || SUPPORTED_CAPACITOR_MAJOR),
    manifest.requiresApkUpdate ? '1' : '0',
    manifest.urgency === 'critical' ? 'critical' : 'optional',
  ].join('|');
}

export function verifyManifestEd25519Signature(
  manifest: OtaManifestPayload,
  publicKeyPem = process.env.OTA_MANIFEST_PUBLIC_KEY_PEM
): { verified: boolean; checked: boolean; reason?: string } {
  const cleanPublicKey = String(publicKeyPem || '').trim();
  const requireSig =
    manifest.channel === 'production' ||
    String(process.env.OTA_REQUIRE_SIGNATURE || 'false').toLowerCase() === 'true';

  if (!manifest.signature) {
    if (requireSig) {
      return {
        verified: false,
        checked: true,
        reason: 'Firma criptográfica Ed25519 obligatoria en manifiesto OTA (requerida en producción).',
      };
    }
    return { verified: true, checked: false };
  }

  if (!cleanPublicKey) {
    if (requireSig) {
      return {
        verified: false,
        checked: true,
        reason: 'Falta OTA_MANIFEST_PUBLIC_KEY_PEM para validar firma Ed25519 obligatoria.',
      };
    }
    return { verified: true, checked: false };
  }

  try {
    const payload = Buffer.from(buildCanonicalManifestSigningPayload(manifest), 'utf8');
    const sigBuf = Buffer.from(String(manifest.signature), 'base64');
    const ok = crypto.verify(null, payload, cleanPublicKey, sigBuf);
    return ok
      ? { verified: true, checked: true }
      : { verified: false, checked: true, reason: 'Firma Ed25519 inválida en el manifiesto OTA.' };
  } catch {
    return { verified: false, checked: true, reason: 'No se pudo verificar la firma Ed25519 del manifiesto OTA.' };
  }
}

export function evaluateOtaCompatibility(
  manifest: OtaManifestPayload,
  currentNativeVersionCode = DEFAULT_NATIVE_VERSION_CODE
): OtaValidationResult {
  if (manifest.requiresApkUpdate) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: 'Esta versión incluye cambios nativos Android y requiere descargar la nueva APK Release.',
    };
  }

  if (manifest.contentsPolicy !== 'web_assets_only') {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: 'Política OTA inválida: solo se permiten recursos web (React/TS/UI/biblioteca/imágenes).',
    };
  }

  const scopes = Array.isArray(manifest.changedScopes) ? manifest.changedScopes : [];
  const forbiddenScope = scopes.find((s) => FORBIDDEN_OTA_NATIVE_SCOPES.includes(s));
  if (forbiddenScope) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: `Cambio nativo prohibido vía OTA (${forbiddenScope}). Requiere compilación de APK.`,
    };
  }

  if (Number(manifest.capacitorMajor) !== SUPPORTED_CAPACITOR_MAJOR) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: `Versión de Capacitor incompatible (${manifest.capacitorMajor}; requerido ${SUPPORTED_CAPACITOR_MAJOR}).`,
    };
  }

  if (Number(manifest.minNativeVersionCode) > currentNativeVersionCode) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: `Requiere APK nativo versión >= ${manifest.minNativeVersionCode} (instalada: ${currentNativeVersionCode}).`,
    };
  }

  if (
    typeof manifest.maxNativeVersionCode === 'number' &&
    manifest.maxNativeVersionCode > 0 &&
    currentNativeVersionCode > manifest.maxNativeVersionCode
  ) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: 'El paquete OTA no aplica a esta versión nativa instalada.',
    };
  }

  const sigCheck = verifyManifestEd25519Signature(manifest);
  if (!sigCheck.verified) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: sigCheck.reason,
    };
  }

  return { valid: true, compatible: true, requiresApkUpdate: false };
}

const inicioRelease: OtaManifestPayload = {
  version: '6.4.3',
  buildId: '6.4.3-ota-a19b2c04',
  channel: 'development',
  url: 'https://raw.githubusercontent.com/Lazcakong-33/LAZCAKONGYM/160d85f87d404ca8b3a5c3aacf9682e899cbf878/lazcakongym-ota-6.4.3.zip',
  checksum: 'a19b2c04875b0afb1a26918d916a6898246f1ebd782048fb3b3d391f7603b49f',
  contentsPolicy: 'web_assets_only',
  changedScopes: ['ui', 'library', 'react_ts', 'assets'],
  requiresApkUpdate: false,
  urgency: 'optional',
  minNativeVersionCode: 1,
  capacitorMajor: 8,
  releaseNotes: 'Inicio mejorado y acceso directo para retomar tu entrenamiento.',
  publishedAt: '2026-11-23T23:47:16.010Z',
  status: 'active',
};

let memoryControlState: PersistedOtaControlState = {
  activeByChannel: {},
  historyByChannel: {},
  telemetry: [],
};
let controlStateLoaded = false;
let disableDiskPersistenceForTest = false;

function loadPersistedControlState(): PersistedOtaControlState {
  if (controlStateLoaded) return memoryControlState;
  controlStateLoaded = true;
  if (disableDiskPersistenceForTest) return memoryControlState;
  try {
    if (fs.existsSync(OTA_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(OTA_STATE_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        memoryControlState = {
          activeByChannel: parsed.activeByChannel || {},
          historyByChannel: parsed.historyByChannel || {},
          telemetry: Array.isArray(parsed.telemetry) ? parsed.telemetry : [],
        };
      }
    }
  } catch {}
  return memoryControlState;
}

function persistControlState(): void {
  if (disableDiskPersistenceForTest) return;
  try {
    fs.mkdirSync(OTA_ROOT_DIR, { recursive: true });
    fs.writeFileSync(OTA_STATE_FILE, JSON.stringify(memoryControlState, null, 2), 'utf8');
  } catch {}
}

export function resetOtaControlStateForTest(disableDiskPersistence = false): void {
  disableDiskPersistenceForTest = disableDiskPersistence;
  memoryControlState = { activeByChannel: {}, historyByChannel: {}, telemetry: [] };
  controlStateLoaded = true;
}

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

function resolveEffectiveManifestForChannel(channel: OtaChannel): OtaManifestPayload | null {
  const state = loadPersistedControlState();
  const published = state.activeByChannel[channel];
  if (published) return published;

  if (channel === 'production') {
    return parseManifestJson(process.env.OTA_MANIFEST_PRODUCTION_JSON) || readLocalChannelManifest('production');
  }
  const envKey = channel === 'staging' ? 'OTA_MANIFEST_STAGING_JSON' : 'OTA_MANIFEST_DEV_JSON';
  return (
    parseManifestJson(process.env[envKey]) ||
    readLocalChannelManifest(channel) ||
    (channel === 'development' ? inicioRelease : null)
  );
}

function assertAdminRequest(req: Request, res: Response): AuthenticatedUser | null {
  const admin = (req as any).user as AuthenticatedUser | undefined;
  if (!admin || !admin.uid || !admin.isAdmin || !isAuthorizedAdminEmail(admin.email)) {
    res.status(403).json({
      success: false,
      error: 'Acceso denegado: el Centro de Actualizaciones es exclusivo para el Administrador Master.',
    });
    return null;
  }
  return admin;
}

function isValidHttpsPublicUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host === '169.254.169.254'
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
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
        apkDownloadUrl: OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
        reason: 'Canal OTA de producción desactivado hasta autorización explícita.',
      });
      return;
    }
    const prodManifest = resolveEffectiveManifestForChannel('production');
    if (!prodManifest) {
      res.status(200).json({
        success: true,
        enabled: true,
        channel: 'production',
        updateAvailable: false,
        manifest: null,
        apkDownloadUrl: OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
      });
      return;
    }
    const compat = evaluateOtaCompatibility(prodManifest, nativeVersionCode);
    res.status(200).json({
      success: true,
      enabled: true,
      channel: 'production',
      updateAvailable: compat.compatible && !compat.requiresApkUpdate,
      manifest: compat.compatible ? prodManifest : prodManifest.requiresApkUpdate ? prodManifest : null,
      apkDownloadUrl: prodManifest.apkDownloadUrl || OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
      reason: compat.reason,
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
      apkDownloadUrl: OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
      reason: 'Canal OTA de desarrollo desactivado por configuración.',
    });
    return;
  }

  const manifest = resolveEffectiveManifestForChannel(channel);
  if (!manifest) {
    res.status(200).json({
      success: true,
      enabled: true,
      channel,
      updateAvailable: false,
      manifest: null,
      apkDownloadUrl: OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
      supportedCapacitorMajor: SUPPORTED_CAPACITOR_MAJOR,
    });
    return;
  }

  const compat = evaluateOtaCompatibility(manifest, nativeVersionCode);
  res.status(200).json({
    success: true,
    enabled: true,
    channel,
    updateAvailable: compat.compatible && !compat.requiresApkUpdate,
    manifest: compat.compatible ? manifest : manifest.requiresApkUpdate ? manifest : null,
    apkDownloadUrl: manifest.apkDownloadUrl || OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
    reason: compat.reason,
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

/**
 * POST /api/ota/telemetry
 * Authenticated device installation status / error telemetry (never trusts client-supplied UID).
 */
export function handleReportOtaTelemetry(req: Request, res: Response): void {
  const user = (req as any).user as AuthenticatedUser | undefined;
  if (!user || !user.uid) {
    res.status(401).json({ success: false, error: 'Autenticación requerida para telemetría OTA.' });
    return;
  }

  const body = req.body || {};
  const rawDeviceId = String(body.deviceId || 'default').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64) || 'default';
  const platformRaw = String(body.platform || 'web').trim();
  const platform: OtaDeviceTelemetryRecord['platform'] =
    platformRaw === 'android_apk' || platformRaw === 'ios_app' || platformRaw === 'pwa' ? platformRaw : 'web';
  const channel = normalizeChannelParam(body.channel);
  const statusRaw = String(body.status || 'up_to_date').trim();
  const validStatuses: OtaDeviceTelemetryStatus[] = [
    'up_to_date',
    'downloading',
    'staged',
    'updated',
    'deferred_workout',
    'rolled_back',
    'error',
  ];
  const status: OtaDeviceTelemetryStatus = validStatuses.includes(statusRaw as OtaDeviceTelemetryStatus)
    ? (statusRaw as OtaDeviceTelemetryStatus)
    : 'up_to_date';

  const record: OtaDeviceTelemetryRecord = {
    deviceKey: `${user.uid}_${rawDeviceId}`,
    uid: user.uid,
    email: user.email,
    platform,
    channel,
    installedVersion: String(body.installedVersion || '7.0.0').slice(0, 40),
    installedBuildId: String(body.installedBuildId || '7.0.0-ota-release').slice(0, 80),
    nativeVersionCode: Math.max(1, parseInt(String(body.nativeVersionCode || 1), 10) || 1),
    targetVersion: body.targetVersion ? String(body.targetVersion).slice(0, 40) : undefined,
    status,
    errorMessage: body.errorMessage ? String(body.errorMessage).slice(0, 240) : undefined,
    updatedAt: new Date().toISOString(),
  };

  const state = loadPersistedControlState();
  const filtered = state.telemetry.filter((item) => item.deviceKey !== record.deviceKey);
  state.telemetry = [record, ...filtered].slice(0, MAX_TELEMETRY_RECORDS);
  persistControlState();

  res.status(200).json({ success: true });
}

/**
 * GET /api/admin/ota/status
 * Exclusive to Master Admin: returns channel manifests, rollback history, and device telemetry summary.
 */
export function handleAdminGetOtaStatus(req: Request, res: Response): void {
  if (!assertAdminRequest(req, res)) return;
  const state = loadPersistedControlState();

  const prodEnabled = String(process.env.OTA_PRODUCTION_ENABLED || 'false').toLowerCase() === 'true';
  const devEnabled = String(process.env.OTA_DEV_CHANNEL_ENABLED || 'true').toLowerCase() !== 'false';

  const channels: Record<
    OtaChannel,
    {
      enabled: boolean;
      activeManifest: OtaManifestPayload | null;
      history: OtaManifestPayload[];
    }
  > = {
    development: {
      enabled: devEnabled,
      activeManifest: resolveEffectiveManifestForChannel('development'),
      history: state.historyByChannel.development || [],
    },
    staging: {
      enabled: devEnabled,
      activeManifest: resolveEffectiveManifestForChannel('staging'),
      history: state.historyByChannel.staging || [],
    },
    production: {
      enabled: prodEnabled,
      activeManifest: resolveEffectiveManifestForChannel('production'),
      history: state.historyByChannel.production || [],
    },
  };

  const updatedDevices = state.telemetry.filter(
    (d) => d.status === 'updated' || d.status === 'up_to_date'
  );
  const installErrors = state.telemetry.filter(
    (d) => d.status === 'error' || d.status === 'rolled_back'
  );

  res.status(200).json({
    success: true,
    publishedAppVersion: '7.0.0',
    supportedCapacitorMajor: SUPPORTED_CAPACITOR_MAJOR,
    githubRepo: OFFICIAL_GITHUB_REPO,
    githubReleasesUrl: OFFICIAL_GITHUB_RELEASES_URL,
    officialReleaseApkUrl: OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
    productionEnvEnabled: prodEnabled,
    channels,
    telemetrySummary: {
      totalDevices: state.telemetry.length,
      updatedCount: updatedDevices.length,
      errorCount: installErrors.length,
      devices: state.telemetry.slice(0, 50),
      errors: installErrors.slice(0, 30),
    },
  });
}

/**
 * POST /api/admin/ota/publish
 * Exclusive to Master Admin: publishes a validated OTA or Native APK release notice.
 */
export function handleAdminPublishOtaRelease(req: Request, res: Response): void {
  const admin = assertAdminRequest(req, res);
  if (!admin) return;

  const body = req.body || {};
  const channel = normalizeChannelParam(body.channel);
  const version = String(body.version || '').trim().replace(/^v/i, '');
  const releaseNotes = String(body.releaseNotes || '').trim().slice(0, 600);
  const urgency: OtaUrgency = body.urgency === 'critical' ? 'critical' : 'optional';
  const requiresApkUpdate = Boolean(body.requiresApkUpdate);
  const minNativeVersionCode = Math.max(1, parseInt(String(body.minNativeVersionCode || 1), 10) || 1);
  const apkDownloadUrl = String(body.apkDownloadUrl || OFFICIAL_RELEASE_APK_DOWNLOAD_URL).trim();

  if (!version || !/^\d+\.\d+\.\d+(-[a-zA-Z0-9._-]+)?$/.test(version)) {
    res.status(400).json({
      success: false,
      error: 'Formato de versión semver inválido (ejemplo válido: 7.0.1).',
    });
    return;
  }

  let url = String(body.url || '').trim();
  let checksum = String(body.checksum || '').trim().toLowerCase();

  if (!requiresApkUpdate) {
    if (!isValidHttpsPublicUrl(url)) {
      res.status(400).json({
        success: false,
        error: 'La URL del paquete OTA (.zip) debe usar HTTPS público válido.',
      });
      return;
    }
    if (!SHA256_HEX_REGEX.test(checksum)) {
      res.status(400).json({
        success: false,
        error: 'El checksum SHA-256 del paquete OTA debe tener exactamente 64 caracteres hexadecimales.',
      });
      return;
    }
  } else {
    if (!isValidHttpsPublicUrl(apkDownloadUrl)) {
      res.status(400).json({
        success: false,
        error: 'La URL de descarga de la APK Release debe ser HTTPS público válido.',
      });
      return;
    }
    if (!url) url = apkDownloadUrl;
    if (!SHA256_HEX_REGEX.test(checksum)) {
      checksum = '0'.repeat(64);
    }
  }

  const buildId =
    String(body.buildId || '').trim() ||
    `${version}-${requiresApkUpdate ? 'apk' : 'ota'}-${checksum.slice(0, 8)}`;

  const nextManifest: OtaManifestPayload = {
    version,
    buildId,
    channel,
    url,
    checksum,
    contentsPolicy: 'web_assets_only',
    changedScopes: requiresApkUpdate
      ? ['android_java', 'native_plugin']
      : ['ui', 'library', 'react_ts', 'assets'],
    requiresApkUpdate,
    apkDownloadUrl,
    urgency,
    minNativeVersionCode,
    capacitorMajor: SUPPORTED_CAPACITOR_MAJOR,
    releaseNotes: releaseNotes || `Actualización ${version} de LAZCAKONG GYM.`,
    publishedAt: new Date().toISOString(),
    publishedBy: admin.email || admin.uid,
    status: 'active',
    ...(body.signature ? { signature: String(body.signature).trim(), signatureAlgorithm: 'ed25519' as const } : {}),
  };

  if (channel === 'production' && !requiresApkUpdate) {
    const sigCheck = verifyManifestEd25519Signature(nextManifest);
    if (!sigCheck.verified) {
      res.status(400).json({
        success: false,
        error:
          sigCheck.reason ||
          'El canal producción exige una firma Ed25519 verificada contra OTA_MANIFEST_PUBLIC_KEY_PEM.',
      });
      return;
    }
  }

  const state = loadPersistedControlState();
  const prevActive = state.activeByChannel[channel] || resolveEffectiveManifestForChannel(channel);
  const existingHistory = state.historyByChannel[channel] || [];
  if (prevActive && prevActive.buildId !== nextManifest.buildId) {
    state.historyByChannel[channel] = [
      prevActive,
      ...existingHistory.filter((item) => item.buildId !== prevActive.buildId),
    ].slice(0, MAX_HISTORY_PER_CHANNEL);
  }
  state.activeByChannel[channel] = nextManifest;
  persistControlState();

  res.status(200).json({
    success: true,
    channel,
    manifest: nextManifest,
    productionNote:
      channel === 'production' && String(process.env.OTA_PRODUCTION_ENABLED || 'false').toLowerCase() !== 'true'
        ? 'Guardado en canal production. Activa OTA_PRODUCTION_ENABLED=true en Cloud Run para distribuir en producción.'
        : undefined,
  });
}

/**
 * POST /api/admin/ota/rollback
 * Exclusive to Master Admin: restores a previous safe version in the specified channel.
 */
export function handleAdminRollbackOtaRelease(req: Request, res: Response): void {
  const admin = assertAdminRequest(req, res);
  if (!admin) return;

  const channel = normalizeChannelParam(req.body?.channel);
  const targetBuildId = String(req.body?.targetBuildId || '').trim();
  const state = loadPersistedControlState();
  const history = state.historyByChannel[channel] || [];

  if (history.length === 0) {
    res.status(404).json({
      success: false,
      error: `No hay versiones anteriores guardadas en el canal ${channel} para restaurar.`,
    });
    return;
  }

  const target = targetBuildId
    ? history.find((item) => item.buildId === targetBuildId)
    : history[0];

  if (!target) {
    res.status(404).json({
      success: false,
      error: 'La versión solicitada no existe en el historial de respaldo.',
    });
    return;
  }

  const currentActive = state.activeByChannel[channel];
  const remainingHistory = history.filter((item) => item.buildId !== target.buildId);
  if (currentActive) {
    remainingHistory.unshift({ ...currentActive, status: 'rolled_back' });
  }

  const restoredManifest: OtaManifestPayload = {
    ...target,
    status: 'active',
    publishedAt: new Date().toISOString(),
    publishedBy: admin.email || admin.uid,
  };

  state.activeByChannel[channel] = restoredManifest;
  state.historyByChannel[channel] = remainingHistory.slice(0, MAX_HISTORY_PER_CHANNEL);
  persistControlState();

  res.status(200).json({
    success: true,
    channel,
    restored: restoredManifest,
    message: `Canal ${channel} restaurado de forma segura a la versión ${restoredManifest.version}.`,
  });
}

/**
 * POST /api/admin/ota/sync-github
 * Exclusive to Master Admin: reads latest release manifest from GitHub Releases (Lazcakong-33/LAZCAKONGYM).
 */
export async function handleAdminSyncGithubRelease(req: Request, res: Response): Promise<void> {
  if (!assertAdminRequest(req, res)) return;
  const channel = normalizeChannelParam(req.body?.channel);

  try {
    const ghResp = await fetch(`https://api.github.com/repos/${OFFICIAL_GITHUB_REPO}/releases/latest`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'LAZCAKONGYM-OTA-Sync',
      },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8000)
        : undefined,
    });

    if (!ghResp.ok) {
      res.status(200).json({
        success: false,
        error: `GitHub Releases aún no tiene una release pública (${ghResp.status}). Ejecuta el workflow de GitHub Actions primero.`,
        githubReleasesUrl: OFFICIAL_GITHUB_RELEASES_URL,
      });
      return;
    }

    const releaseJson = (await ghResp.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };

    const assets = Array.isArray(releaseJson.assets) ? releaseJson.assets : [];
    const manifestAsset =
      assets.find((a) => a.name === `manifest.${channel}.json`) ||
      assets.find((a) => /^manifest\..+\.json$/i.test(a.name || ''));
    const apkAsset = assets.find((a) => /\.apk$/i.test(a.name || ''));
    const zipAsset = assets.find((a) => /^lazcakongym-ota-.*\.zip$/i.test(a.name || ''));

    let syncedManifest: OtaManifestPayload | null = null;
    if (manifestAsset?.browser_download_url && isValidHttpsPublicUrl(manifestAsset.browser_download_url)) {
      const mRes = await fetch(manifestAsset.browser_download_url, {
        signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(8000)
          : undefined,
      });
      if (mRes.ok) {
        syncedManifest = parseManifestJson(await mRes.text());
      }
    }

    res.status(200).json({
      success: true,
      tagName: releaseJson.tag_name || '',
      releaseUrl: releaseJson.html_url || OFFICIAL_GITHUB_RELEASES_URL,
      apkDownloadUrl: apkAsset?.browser_download_url || OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
      otaZipUrl: zipAsset?.browser_download_url || syncedManifest?.url || '',
      manifest: syncedManifest,
      notes: syncedManifest?.releaseNotes || releaseJson.body || '',
    });
  } catch (err: any) {
    res.status(200).json({
      success: false,
      error: err?.message || 'No se pudo consultar GitHub Releases.',
      githubReleasesUrl: OFFICIAL_GITHUB_RELEASES_URL,
    });
  }
}
