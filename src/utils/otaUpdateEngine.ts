import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater';
import { App as CapacitorApp } from '@capacitor/app';
import { auth } from '../firebase';
import { detectRuntimePlatform } from './capacitorPlatform';
import { resolveApiUrl } from './apiUrl';
import { safeApiFetchJson } from './safeApiFetch';
import {
  APP_BUILD_ID,
  APP_VERSION,
  DEFERRED_UPDATE_FLAG_KEY,
  getAppUpdateSafetyStatus,
  type UpdateSafetyCheck,
  type UpdateSafetyStorage,
} from './updateApp';

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
export const OFFICIAL_RELEASE_APK_DOWNLOAD_URL =
  'https://github.com/Lazcakong-33/LAZCAKONGYM/releases/latest/download/app-release.apk';
export const OFFICIAL_GITHUB_RELEASES_URL =
  'https://github.com/Lazcakong-33/LAZCAKONGYM/releases/latest';
/** Public, development-only OTA index preserved from migration/zero-cost. */
export const DEV_GITHUB_OTA_MANIFEST_URL =
  'https://raw.githubusercontent.com/Lazcakong-33/LAZCAKONGYM/ota-development/ota/manifest.development.json';

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

export interface OtaPluginAdapter {
  notifyAppReady: () => Promise<unknown>;
  download: (options: { url: string; version: string; checksum?: string }) => Promise<BundleInfo>;
  set: (options: { id: string }) => Promise<void>;
  next: (options: { id: string }) => Promise<BundleInfo>;
  reset: (options?: { toLastSuccessful?: boolean }) => Promise<void>;
  current: () => Promise<{ bundle: BundleInfo; native: string }>;
  addListener?: (
    eventName: 'download',
    listenerFunc: (event: { percent?: number; bundle?: BundleInfo }) => void
  ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> | void };
}

export interface OtaApplyResult {
  status: 'applied' | 'staged_for_background' | 'deferred_unsafe' | 'blocked' | 'not_native' | 'error';
  bundleId?: string;
  safety?: UpdateSafetyCheck;
  reason?: string;
}

export interface InstalledOtaRuntimeInfo {
  bundleId: string;
  webVersion: string;
  nativeVersionCode: number;
  nativeVersionName: string;
}

export interface OtaJustInstalledNotice {
  version: string;
  buildId: string;
  installedAt: number;
}

export interface OtaRetryEligibility {
  eligible: boolean;
  attempts: number;
  quarantined: boolean;
  nextRetryAt?: number;
  reason?: string;
}

const DEFAULT_OTA_PLUGIN_ADAPTER: OtaPluginAdapter = {
  notifyAppReady: () => CapacitorUpdater.notifyAppReady(),
  download: (options) => CapacitorUpdater.download(options),
  set: (options) => CapacitorUpdater.set(options),
  next: (options) => CapacitorUpdater.next(options),
  reset: (options) => CapacitorUpdater.reset(options),
  current: () => CapacitorUpdater.current(),
  addListener: (eventName, listenerFunc) =>
    CapacitorUpdater.addListener(eventName, listenerFunc as any),
};

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const TEMPORARY_PREVIEW_HOST_REGEX = /^ais-(dev|pre)-[a-z0-9-]+\./i;
export const OTA_PENDING_BUNDLE_KEY = 'lazcakon_ota_pending_bundle_v1';
export const OTA_RETRY_STATE_KEY = 'lazcakon_ota_retry_state_v1';
export const OTA_QUARANTINE_KEY = 'lazcakon_ota_quarantined_builds_v1';
export const OTA_BOOT_GUARD_KEY = 'lazcakon_ota_boot_guard_v1';
export const OTA_JUST_INSTALLED_KEY = 'lazcakon_ota_just_installed_v1';
export const OTA_DEVICE_ID_KEY = 'lazcakon_ota_device_id_v1';

const RETRY_BACKOFF_MS = [15_000, 60_000, 180_000] as const;
const MAX_RETRY_ATTEMPTS = 3;
const BOOT_LOOP_WINDOW_MS = 90_000;
const BOOT_LOOP_THRESHOLD = 2;

function getSafeStorage(storage?: UpdateSafetyStorage | null): UpdateSafetyStorage | null {
  if (storage !== undefined) return storage;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {}
  return null;
}

export function compareSemver(candidateVersion: string, currentVersion: string): number {
  const parse = (v: string) =>
    String(v || '')
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);

  const a = parse(candidateVersion);
  const b = parse(currentVersion);
  const len = Math.max(a.length, b.length, 3);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export function isProductionOtaChannelAllowed(): boolean {
  try {
    const metaEnv = (import.meta as any)?.env;
    return String(metaEnv?.VITE_OTA_PRODUCTION_ENABLED || '').toLowerCase() === 'true';
  } catch {
    return false;
  }
}

export function resolveOtaChannel(requested?: string | null): OtaChannel {
  const envChannel = (() => {
    try {
      return String((import.meta as any)?.env?.VITE_OTA_CHANNEL || '').trim().toLowerCase();
    } catch {
      return '';
    }
  })();

  const candidate = String(requested || envChannel || 'development').trim().toLowerCase();
  if (candidate === 'production') {
    return isProductionOtaChannelAllowed() ? 'production' : 'development';
  }
  if (candidate === 'staging') {
    return 'staging';
  }
  return 'development';
}

export function getQuarantinedBuildIds(storage?: UpdateSafetyStorage | null): string[] {
  const store = getSafeStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(OTA_QUARANTINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function quarantineBuildId(buildId: string, storage?: UpdateSafetyStorage | null): void {
  const store = getSafeStorage(storage);
  if (!store || !buildId) return;
  try {
    const existing = getQuarantinedBuildIds(store);
    if (!existing.includes(buildId)) {
      store.setItem?.(OTA_QUARANTINE_KEY, JSON.stringify([...existing, buildId].slice(-20)));
    }
  } catch {}
}

export function evaluateOtaRetryEligibility(
  buildId: string,
  storage?: UpdateSafetyStorage | null,
  nowMs = Date.now()
): OtaRetryEligibility {
  const store = getSafeStorage(storage);
  if (!buildId) {
    return { eligible: false, attempts: 0, quarantined: false, reason: 'Identificador de paquete inválido.' };
  }
  if (getQuarantinedBuildIds(store).includes(buildId)) {
    return {
      eligible: false,
      attempts: MAX_RETRY_ATTEMPTS,
      quarantined: true,
      reason: 'Esta versión OTA fue puesta en cuarentena tras fallos repetidos para proteger tu app.',
    };
  }
  if (!store) return { eligible: true, attempts: 0, quarantined: false };

  try {
    const raw = store.getItem(OTA_RETRY_STATE_KEY);
    if (!raw) return { eligible: true, attempts: 0, quarantined: false };
    const state = JSON.parse(raw) as Record<string, { attempts: number; nextRetryAt: number }>;
    const entry = state?.[buildId];
    if (!entry) return { eligible: true, attempts: 0, quarantined: false };
    if (entry.attempts >= MAX_RETRY_ATTEMPTS) {
      return {
        eligible: false,
        attempts: entry.attempts,
        quarantined: true,
        reason: 'Límite de reintentos alcanzado; paquete bloqueado para evitar bucles.',
      };
    }
    if (entry.nextRetryAt > nowMs) {
      const waitSec = Math.max(1, Math.ceil((entry.nextRetryAt - nowMs) / 1000));
      return {
        eligible: false,
        attempts: entry.attempts,
        quarantined: false,
        nextRetryAt: entry.nextRetryAt,
        reason: `Reintento controlado en ${waitSec} s.`,
      };
    }
    return { eligible: true, attempts: entry.attempts, quarantined: false };
  } catch {
    return { eligible: true, attempts: 0, quarantined: false };
  }
}

export function recordOtaAttemptResult(
  buildId: string,
  succeeded: boolean,
  storage?: UpdateSafetyStorage | null,
  nowMs = Date.now()
): OtaRetryEligibility {
  const store = getSafeStorage(storage);
  if (!store || !buildId) {
    return { eligible: succeeded, attempts: succeeded ? 0 : 1, quarantined: false };
  }

  let state: Record<string, { attempts: number; nextRetryAt: number }> = {};
  try {
    const raw = store.getItem(OTA_RETRY_STATE_KEY);
    if (raw) state = JSON.parse(raw) || {};
  } catch {}

  if (succeeded) {
    delete state[buildId];
    try {
      store.setItem?.(OTA_RETRY_STATE_KEY, JSON.stringify(state));
    } catch {}
    return { eligible: true, attempts: 0, quarantined: false };
  }

  const prevAttempts = state[buildId]?.attempts || 0;
  const attempts = prevAttempts + 1;
  if (attempts >= MAX_RETRY_ATTEMPTS) {
    quarantineBuildId(buildId, store);
    delete state[buildId];
    try {
      store.setItem?.(OTA_RETRY_STATE_KEY, JSON.stringify(state));
    } catch {}
    return {
      eligible: false,
      attempts,
      quarantined: true,
      reason: 'Paquete OTA puesto en cuarentena tras 3 errores consecutivos.',
    };
  }

  const delayMs = RETRY_BACKOFF_MS[Math.min(attempts - 1, RETRY_BACKOFF_MS.length - 1)];
  const nextRetryAt = nowMs + delayMs;
  state[buildId] = { attempts, nextRetryAt };
  try {
    store.setItem?.(OTA_RETRY_STATE_KEY, JSON.stringify(state));
  } catch {}

  return {
    eligible: false,
    attempts,
    quarantined: false,
    nextRetryAt,
    reason: `Descarga fallida (${attempts}/${MAX_RETRY_ATTEMPTS}). Reintento automático en ${Math.round(
      delayMs / 1000
    )} s.`,
  };
}

export function readJustInstalledOtaNotice(
  storage?: UpdateSafetyStorage | null
): OtaJustInstalledNotice | null {
  const store = getSafeStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(OTA_JUST_INSTALLED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OtaJustInstalledNotice;
    if (parsed && typeof parsed.version === 'string') {
      return parsed;
    }
  } catch {}
  return null;
}

export function clearJustInstalledOtaNotice(storage?: UpdateSafetyStorage | null): void {
  const store = getSafeStorage(storage);
  try {
    store?.removeItem?.(OTA_JUST_INSTALLED_KEY);
  } catch {}
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
      reason: 'Esta versión incluye cambios nativos y requiere actualizar el APK completo.',
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

  return { valid: true, compatible: true, requiresApkUpdate: false };
}

export function validateOtaManifest(
  manifest: OtaManifestPayload | null | undefined,
  options?: {
    currentWebVersion?: string;
    currentNativeVersionCode?: number;
    expectedChannel?: OtaChannel;
    allowProduction?: boolean;
  }
): OtaValidationResult {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, compatible: false, requiresApkUpdate: false, reason: 'Manifiesto OTA vacío.' };
  }

  const expectedChannel = options?.expectedChannel || 'development';
  const allowProduction = options?.allowProduction ?? isProductionOtaChannelAllowed();

  if (manifest.channel === 'production' && !allowProduction) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: 'Canal OTA de producción deshabilitado hasta autorización explícita.',
    };
  }

  if (
    manifest.channel === 'production' &&
    (!manifest.signature || manifest.signatureAlgorithm !== 'ed25519')
  ) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: 'El canal producción exige firma criptográfica Ed25519 verificada en el manifiesto.',
    };
  }

  if (manifest.channel !== expectedChannel) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: `Canal OTA no coincide (${manifest.channel} != ${expectedChannel}).`,
    };
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    return { valid: false, compatible: false, requiresApkUpdate: false, reason: 'Falta versión semver OTA.' };
  }

  const currentWebVersion = options?.currentWebVersion || APP_VERSION;
  if (compareSemver(manifest.version, currentWebVersion) <= 0) {
    return {
      valid: false,
      compatible: true,
      requiresApkUpdate: false,
      reason: `La versión instalada (${currentWebVersion}) ya está actualizada respecto a ${manifest.version}.`,
    };
  }

  if (!manifest.checksum || !SHA256_HEX_REGEX.test(manifest.checksum.trim())) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: 'Checksum SHA-256 ausente o con formato inválido.',
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(manifest.url);
  } catch {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: 'URL de bundle OTA inválida.',
    };
  }

  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: 'Solo se permiten descargas OTA por HTTPS sin credenciales embebidas.',
    };
  }

  if (
    manifest.channel !== 'development' &&
    TEMPORARY_PREVIEW_HOST_REGEX.test(parsedUrl.hostname)
  ) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: false,
      reason: 'URL temporal ais-dev/ais-pre bloqueada fuera del canal development.',
    };
  }

  return evaluateOtaCompatibility(
    manifest,
    options?.currentNativeVersionCode ?? DEFAULT_NATIVE_VERSION_CODE
  );
}

export async function getInstalledOtaRuntimeInfo(
  adapter: OtaPluginAdapter = DEFAULT_OTA_PLUGIN_ADAPTER,
  storage?: UpdateSafetyStorage | null
): Promise<InstalledOtaRuntimeInfo> {
  const { isCapacitorNative } = detectRuntimePlatform();
  const store = getSafeStorage(storage);
  let webVersion = APP_VERSION;
  try {
    const storedVer = store?.getItem('lazcakon_installed_version');
    if (storedVer && compareSemver(storedVer, APP_VERSION) > 0) {
      webVersion = storedVer;
    }
  } catch {}

  if (!isCapacitorNative) {
    return {
      bundleId: 'builtin',
      webVersion,
      nativeVersionCode: DEFAULT_NATIVE_VERSION_CODE,
      nativeVersionName: DEFAULT_NATIVE_VERSION_NAME,
    };
  }

  let bundleId = 'builtin';
  let nativeVersionCode = DEFAULT_NATIVE_VERSION_CODE;
  let nativeVersionName = DEFAULT_NATIVE_VERSION_NAME;

  try {
    const current = await adapter.current();
    if (current?.bundle?.id) bundleId = current.bundle.id;
    if (current?.bundle?.version && compareSemver(current.bundle.version, webVersion) > 0) {
      webVersion = current.bundle.version;
    }
    if (current?.native) {
      nativeVersionName = current.native;
    }
  } catch {}

  try {
    const info = await CapacitorApp.getInfo();
    const parsedBuild = parseInt(String(info?.build || ''), 10);
    if (Number.isFinite(parsedBuild) && parsedBuild > 0) {
      nativeVersionCode = parsedBuild;
    }
    if (info?.version) {
      nativeVersionName = info.version;
    }
  } catch {}

  return {
    bundleId,
    webVersion,
    nativeVersionCode,
    nativeVersionName,
  };
}

/**
 * Must be called immediately on React app boot in Capacitor native shells
 * so @capgo/capacitor-updater cancels the 10-second rollback watchdog,
 * detects rapid boot-loops, and exposes post-install confirmation notices.
 */
export async function markOtaBootReady(
  adapter: OtaPluginAdapter = DEFAULT_OTA_PLUGIN_ADAPTER,
  forceNativeForTest = false,
  storage?: UpdateSafetyStorage | null,
  nowMs = Date.now()
): Promise<{
  notified: boolean;
  skipped?: boolean;
  rolledBackBootLoop?: boolean;
  justInstalled?: OtaJustInstalledNotice | null;
}> {
  const { isCapacitorNative } = detectRuntimePlatform();
  if (!isCapacitorNative && !forceNativeForTest) {
    return { notified: false, skipped: true };
  }

  const store = getSafeStorage(storage);
  let activeBundleId = 'builtin';
  let activeBundleVersion = APP_VERSION;

  try {
    const current = await adapter.current();
    if (current?.bundle?.id) activeBundleId = current.bundle.id;
    if (current?.bundle?.version) activeBundleVersion = current.bundle.version;
  } catch {}

  // Boot-loop protection: if a non-builtin OTA bundle enters > threshold quick boots, roll back
  if (store && activeBundleId && activeBundleId !== 'builtin') {
    try {
      const rawGuard = store.getItem(OTA_BOOT_GUARD_KEY);
      const parsed = rawGuard
        ? (JSON.parse(rawGuard) as { bundleId: string; count: number; firstBootAt: number })
        : null;

      const withinWindow = parsed && nowMs - parsed.firstBootAt <= BOOT_LOOP_WINDOW_MS;
      const nextCount = parsed && parsed.bundleId === activeBundleId && withinWindow ? parsed.count + 1 : 1;

      if (nextCount > BOOT_LOOP_THRESHOLD) {
        quarantineBuildId(activeBundleId, store);
        store.removeItem?.(OTA_BOOT_GUARD_KEY);
        store.removeItem?.(OTA_PENDING_BUNDLE_KEY);
        await adapter.reset({ toLastSuccessful: true }).catch(() => {});
        return { notified: false, rolledBackBootLoop: true };
      }

      store.setItem?.(
        OTA_BOOT_GUARD_KEY,
        JSON.stringify({
          bundleId: activeBundleId,
          count: nextCount,
          firstBootAt: withinWindow && parsed ? parsed.firstBootAt : nowMs,
        })
      );
    } catch {}
  }

  try {
    await adapter.notifyAppReady();
    let justInstalled: OtaJustInstalledNotice | null = null;

    if (store) {
      try {
        const pendingRaw = store.getItem(OTA_PENDING_BUNDLE_KEY);
        if (pendingRaw) {
          const pending = JSON.parse(pendingRaw) as {
            bundleId?: string;
            version?: string;
            buildId?: string;
          };
          if (
            pending &&
            (pending.bundleId === activeBundleId ||
              (pending.version && pending.version === activeBundleVersion))
          ) {
            justInstalled = {
              version: pending.version || activeBundleVersion,
              buildId: pending.buildId || APP_BUILD_ID,
              installedAt: nowMs,
            };
            store.setItem?.(OTA_JUST_INSTALLED_KEY, JSON.stringify(justInstalled));
            store.setItem?.('lazcakon_installed_version', justInstalled.version);
            store.setItem?.('lazcakon_installed_build_id', justInstalled.buildId);
            store.removeItem?.(OTA_PENDING_BUNDLE_KEY);
          }
        }
      } catch {}
    }

    return { notified: true, justInstalled };
  } catch {
    return { notified: false };
  }
}

export async function fetchOtaManifestFromServer(options?: {
  channel?: OtaChannel;
  nativeVersionCode?: number;
  fetcher?: typeof fetch;
}): Promise<OtaManifestResponse> {
  const channel = resolveOtaChannel(options?.channel);
  const nativeVersionCode = options?.nativeVersionCode ?? DEFAULT_NATIVE_VERSION_CODE;
  const fetcher = options?.fetcher || fetch;

  const endpoint = resolveApiUrl(
    `/api/ota/manifest?channel=${encodeURIComponent(channel)}&nativeVersionCode=${encodeURIComponent(
      String(nativeVersionCode)
    )}&t=${Date.now()}`
  );

  const response = await fetcher(endpoint, {
    method: 'GET',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
  });

  if (!response.ok) {
    return {
      success: false,
      enabled: false,
      channel,
      updateAvailable: false,
      manifest: null,
      reason: `Error HTTP ${response.status} consultando manifiesto OTA.`,
    };
  }

  const data = (await response.json()) as OtaManifestResponse;
  return data;
}

export async function downloadAndStageOtaUpdate(
  manifest: OtaManifestPayload,
  options?: {
    adapter?: OtaPluginAdapter;
    storage?: UpdateSafetyStorage | null;
    currentWebVersion?: string;
    currentNativeVersionCode?: number;
    allowProduction?: boolean;
    forceNativeForTest?: boolean;
    applyImmediatelyWhenSafe?: boolean;
    skipRetryGuard?: boolean;
    onProgress?: (percent: number) => void;
  }
): Promise<OtaApplyResult> {
  const { isCapacitorNative } = detectRuntimePlatform();
  if (!isCapacitorNative && !options?.forceNativeForTest) {
    return {
      status: 'not_native',
      reason: 'OTA nativo solo aplica dentro de la aplicación Capacitor Android/iOS.',
    };
  }

  const storage = getSafeStorage(options?.storage);

  if (!options?.skipRetryGuard) {
    const retryCheck = evaluateOtaRetryEligibility(manifest.buildId, storage);
    if (!retryCheck.eligible) {
      return {
        status: 'blocked',
        reason: retryCheck.reason || 'Paquete OTA temporalmente en espera o en cuarentena.',
      };
    }
  }

  const validation = validateOtaManifest(manifest, {
    currentWebVersion: options?.currentWebVersion || APP_VERSION,
    currentNativeVersionCode: options?.currentNativeVersionCode ?? DEFAULT_NATIVE_VERSION_CODE,
    expectedChannel: manifest.channel,
    allowProduction: options?.allowProduction,
  });

  if (!validation.valid) {
    return {
      status: 'blocked',
      reason: validation.reason,
    };
  }

  const adapter = options?.adapter || DEFAULT_OTA_PLUGIN_ADAPTER;

  let downloadListenerHandle: { remove: () => Promise<void> | void } | null = null;
  if (typeof options?.onProgress === 'function' && typeof adapter.addListener === 'function') {
    try {
      const handlePromise = adapter.addListener('download', (evt) => {
        const pct = Math.max(0, Math.min(100, Math.round(Number(evt?.percent ?? 0))));
        options.onProgress?.(pct);
      });
      downloadListenerHandle = await Promise.resolve(handlePromise);
    } catch {}
  }

  let downloadedBundle: BundleInfo;
  try {
    options?.onProgress?.(5);
    downloadedBundle = await adapter.download({
      url: manifest.url,
      version: manifest.version,
      checksum: manifest.checksum,
    });
    options?.onProgress?.(100);
    recordOtaAttemptResult(manifest.buildId, true, storage);
  } catch (err: any) {
    const retryStatus = recordOtaAttemptResult(manifest.buildId, false, storage);
    return {
      status: 'error',
      reason: retryStatus.reason || err?.message || 'Error verificando o descargando el paquete OTA.',
    };
  } finally {
    try {
      await downloadListenerHandle?.remove?.();
    } catch {}
  }

  try {
    storage?.setItem?.(
      OTA_PENDING_BUNDLE_KEY,
      JSON.stringify({
        bundleId: downloadedBundle.id,
        version: manifest.version,
        buildId: manifest.buildId,
        checksum: manifest.checksum,
        channel: manifest.channel,
        downloadedAt: Date.now(),
      })
    );
  } catch {}

  const safety = getAppUpdateSafetyStatus(storage);
  if (!safety.canUpdateSafely) {
    try {
      storage?.setItem?.(DEFERRED_UPDATE_FLAG_KEY, String(Date.now()));
    } catch {}
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('app-update-deferred', { detail: safety }));
    }
    return {
      status: 'deferred_unsafe',
      bundleId: downloadedBundle.id,
      safety,
      reason: safety.reason || 'Entrenamiento activo o cola offline pendiente; OTA pospuesto con seguridad.',
    };
  }

  if (options?.applyImmediatelyWhenSafe) {
    await adapter.set({ id: downloadedBundle.id });
    try {
      storage?.setItem?.(
        OTA_JUST_INSTALLED_KEY,
        JSON.stringify({
          version: manifest.version,
          buildId: manifest.buildId,
          installedAt: Date.now(),
        })
      );
      storage?.removeItem?.(OTA_PENDING_BUNDLE_KEY);
    } catch {}
    return {
      status: 'applied',
      bundleId: downloadedBundle.id,
      safety,
    };
  }

  await adapter.next({ id: downloadedBundle.id });
  return {
    status: 'staged_for_background',
    bundleId: downloadedBundle.id,
    safety,
  };
}

export async function rollbackOtaToPreviousBundle(
  adapter: OtaPluginAdapter = DEFAULT_OTA_PLUGIN_ADAPTER,
  forceNativeForTest = false
): Promise<{ rolledBack: boolean; reason?: string }> {
  const { isCapacitorNative } = detectRuntimePlatform();
  if (!isCapacitorNative && !forceNativeForTest) {
    return { rolledBack: false, reason: 'Rollback OTA solo aplica en Capacitor nativo.' };
  }
  try {
    await adapter.reset({ toLastSuccessful: true });
    return { rolledBack: true };
  } catch (err: any) {
    return { rolledBack: false, reason: err?.message || 'No se pudo revertir el bundle OTA.' };
  }
}

function getOrCreateDeviceId(): string {
  const store = getSafeStorage();
  if (!store) return 'browser-default';
  try {
    const existing = store.getItem(OTA_DEVICE_ID_KEY);
    if (existing) return existing;
    const generated = `lzk_${Math.random().toString(36).slice(2, 10)}`;
    store.setItem?.(OTA_DEVICE_ID_KEY, generated);
    return generated;
  } catch {
    return 'browser-default';
  }
}

export async function reportOtaTelemetry(params: {
  channel: OtaChannel;
  installedVersion: string;
  installedBuildId: string;
  nativeVersionCode?: number;
  targetVersion?: string;
  status: 'up_to_date' | 'downloading' | 'staged' | 'updated' | 'deferred_workout' | 'rolled_back' | 'error';
  errorMessage?: string;
}): Promise<void> {
  try {
    const currentUser = auth?.currentUser;
    if (!currentUser) return;
    const idToken = await currentUser.getIdToken();
    if (!idToken) return;

    const { platform } = detectRuntimePlatform();
    const mappedPlatform =
      platform === 'capacitor_android'
        ? 'android_apk'
        : platform === 'capacitor_ios'
          ? 'ios_app'
          : platform === 'pwa_standalone'
            ? 'pwa'
            : 'web';

    await safeApiFetchJson('/api/ota/telemetry', {
      method: 'POST',
      timeoutMs: 6000,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        deviceId: getOrCreateDeviceId(),
        platform: mappedPlatform,
        channel: params.channel,
        installedVersion: params.installedVersion,
        installedBuildId: params.installedBuildId,
        nativeVersionCode: params.nativeVersionCode ?? DEFAULT_NATIVE_VERSION_CODE,
        targetVersion: params.targetVersion,
        status: params.status,
        errorMessage: params.errorMessage,
      }),
    });
  } catch {
    // Non-fatal telemetry: never disrupt user flow
  }
}
