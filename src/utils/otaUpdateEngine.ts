import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater';
import { detectRuntimePlatform } from './capacitorPlatform';
import { resolveApiUrl } from './apiUrl';
import {
  APP_VERSION,
  DEFERRED_UPDATE_FLAG_KEY,
  getAppUpdateSafetyStatus,
  type UpdateSafetyCheck,
  type UpdateSafetyStorage,
} from './updateApp';

import { DEFAULT_NATIVE_VERSION_CODE, evaluateOtaCompatibility, type OtaChannel, type OtaManifestPayload, type OtaManifestResponse, type OtaValidationResult } from './otaCompatibility.ts';
export * from './otaCompatibility.ts';

export interface OtaPluginAdapter {
  notifyAppReady: () => Promise<unknown>;
  download: (options: { url: string; version: string; checksum?: string }) => Promise<BundleInfo>;
  set: (options: { id: string }) => Promise<void>;
  next: (options: { id: string }) => Promise<BundleInfo>;
  reset: (options?: { toLastSuccessful?: boolean }) => Promise<void>;
  current: () => Promise<{ bundle: BundleInfo; native: string }>;
}

export interface OtaApplyResult {
  status: 'applied' | 'staged_for_background' | 'deferred_unsafe' | 'blocked' | 'not_native' | 'error';
  bundleId?: string;
  safety?: UpdateSafetyCheck;
  reason?: string;
}

const DEFAULT_OTA_PLUGIN_ADAPTER: OtaPluginAdapter = {
  notifyAppReady: () => CapacitorUpdater.notifyAppReady(),
  download: (options) => CapacitorUpdater.download(options),
  set: (options) => CapacitorUpdater.set(options),
  next: (options) => CapacitorUpdater.next(options),
  reset: (options) => CapacitorUpdater.reset(options),
  current: () => CapacitorUpdater.current(),
};

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;
const TEMPORARY_PREVIEW_HOST_REGEX = /^ais-(dev|pre)-[a-z0-9-]+\./i;
const OTA_PENDING_BUNDLE_KEY = 'lazcakon_ota_pending_bundle_v1';
/** Public, development-only OTA index; never used by production builds/channels. */
export const DEV_GITHUB_OTA_MANIFEST_URL =
  'https://raw.githubusercontent.com/Lazcakong-33/LAZCAKONGYM/ota-development/ota/manifest.development.json';


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

/**
 * Must be called immediately on React app boot in Capacitor native shells
 * so @capgo/capacitor-updater cancels the 10-second rollback watchdog.
 * If a broken OTA crashes before reaching this line, Capgo automatically
 * reverts to the previous working bundle.
 */
export async function markOtaBootReady(
  adapter: OtaPluginAdapter = DEFAULT_OTA_PLUGIN_ADAPTER,
  forceNativeForTest = false
): Promise<{ notified: boolean; skipped?: boolean }> {
  const { isCapacitorNative } = detectRuntimePlatform();
  if (!isCapacitorNative && !forceNativeForTest) {
    return { notified: false, skipped: true };
  }
  try {
    await adapter.notifyAppReady();
    return { notified: true };
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

  const emptyResponse: OtaManifestResponse = {
    success: false,
    enabled: false,
    channel,
    updateAvailable: false,
    manifest: null,
  };

  const endpoint = resolveApiUrl(
    `/api/ota/manifest?channel=${encodeURIComponent(channel)}&nativeVersionCode=${encodeURIComponent(
      String(nativeVersionCode)
    )}&t=${Date.now()}`
  );

  // Existing Cloud Run endpoint remains authoritative, including an explicit
  // enabled:false response (remote kill switch). Do not bypass it.
  let apiResponse: OtaManifestResponse | null = null;
  try {
    const response = await fetcher(endpoint, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(6500) : undefined,
    });
    if (response.ok) {
      const data = await response.json();
      if (data && data.channel === channel && typeof data.enabled === 'boolean') {
        apiResponse = data as OtaManifestResponse;
        if (!apiResponse.enabled || (apiResponse.updateAvailable && apiResponse.manifest)) {
          return apiResponse;
        }
      }
    }
  } catch (err) {
    console.warn('[LAZCAKONGYM] Servidor OTA no disponible:', err);
  }

  // Independent distribution of *development* web bundles via GitHub Releases.
  // Production never falls back to a development channel or public manifest.
  if (channel !== 'development') {
    return apiResponse || emptyResponse;
  }

  try {
    const response = await fetcher(`${DEV_GITHUB_OTA_MANIFEST_URL}?t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
      signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(6500) : undefined,
    });
    if (!response.ok) return apiResponse || emptyResponse;
    const manifest = await response.json() as OtaManifestPayload;
    if (manifest?.channel !== 'development') return apiResponse || emptyResponse;
    // Compatibility and version checks still run in useAppUpdate before showing
    // any update button; do not trust the index simply because it is HTTP 200.
    return {
      success: true,
      enabled: true,
      channel: 'development',
      updateAvailable: Boolean(manifest.url && manifest.checksum),
      manifest: manifest.url && manifest.checksum ? manifest : null,
    };
  } catch (err) {
    console.warn('[LAZCAKONGYM] Manifiesto OTA de GitHub no disponible:', err);
    return apiResponse || emptyResponse;
  }
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
    /** Automatic mode: wait until workout and offline changes are safe before downloading. */
    skipDownloadWhenUnsafe?: boolean;
  }
): Promise<OtaApplyResult> {
  const { isCapacitorNative } = detectRuntimePlatform();
  if (!isCapacitorNative && !options?.forceNativeForTest) {
    return {
      status: 'not_native',
      reason: 'OTA nativo solo aplica dentro de la aplicación Capacitor Android/iOS.',
    };
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
  const storage =
    options?.storage !== undefined
      ? options.storage
      : typeof localStorage !== 'undefined'
        ? localStorage
        : null;


  // Staging for next launch avoids any forced restart during navigation.
  // If a bundle is already downloaded, reuse it instead of downloading every
  // 25 seconds. Revalidate compatibility above on every manifest poll.
  const safetyBeforeDownload = getAppUpdateSafetyStatus(storage);
  if (!safetyBeforeDownload.canUpdateSafely && options?.skipDownloadWhenUnsafe) {
    try { storage?.setItem?.(DEFERRED_UPDATE_FLAG_KEY, String(Date.now())); } catch {}
    return {
      status: 'deferred_unsafe',
      safety: safetyBeforeDownload,
      reason: safetyBeforeDownload.reason || 'Sesión de entrenamiento o sincronización pendientes.',
    };
  }

  type PendingOtaRecord = {
    bundleId: string;
    version: string;
    checksum: string;
    channel: OtaChannel;
    downloadedAt: number;
    staged?: boolean;
  };
  let priorBundle: PendingOtaRecord | null = null;
  try {
    const raw = storage?.getItem(OTA_PENDING_BUNDLE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PendingOtaRecord;
      const isMatching =
        parsed?.version === manifest.version &&
        parsed?.checksum === manifest.checksum &&
        parsed?.channel === manifest.channel &&
        typeof parsed?.bundleId === 'string' &&
        parsed.bundleId.length > 0 &&
        Number.isFinite(parsed.downloadedAt) &&
        Date.now() - parsed.downloadedAt >= 0 &&
        Date.now() - parsed.downloadedAt < 6 * 60 * 60 * 1000;
      if (isMatching) priorBundle = parsed;
    }
  } catch {}

  if (priorBundle?.staged && !options?.applyImmediatelyWhenSafe) {
    return {
      status: 'staged_for_background',
      bundleId: priorBundle.bundleId,
      safety: safetyBeforeDownload,
      reason: 'Paquete descargado y programado para el próximo inicio.',
    };
  }

  let downloadedBundle: BundleInfo;
  if (priorBundle) {
    downloadedBundle = { id: priorBundle.bundleId } as BundleInfo;
  } else {
    try {
      downloadedBundle = await adapter.download({
        url: manifest.url,
        version: manifest.version,
        checksum: manifest.checksum,
      });
    } catch (err: any) {
      return {
        status: 'error',
        reason: err?.message || 'Error verificando o descargando el paquete OTA.',
      };
    }
  }

  const savePending = (staged: boolean): void => {
    try {
      storage?.setItem?.(
        OTA_PENDING_BUNDLE_KEY,
        JSON.stringify({
          bundleId: downloadedBundle.id,
          version: manifest.version,
          checksum: manifest.checksum,
          channel: manifest.channel,
          downloadedAt: priorBundle?.downloadedAt || Date.now(),
          staged,
        } satisfies PendingOtaRecord)
      );
    } catch {}
  };
  savePending(false);

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

  try {
    if (options?.applyImmediatelyWhenSafe) {
      await adapter.set({ id: downloadedBundle.id });
      return {
        status: 'applied',
        bundleId: downloadedBundle.id,
        safety,
      };
    }

    await adapter.next({ id: downloadedBundle.id });
    savePending(true);
    try { storage?.removeItem?.(DEFERRED_UPDATE_FLAG_KEY); } catch {}
    return {
      status: 'staged_for_background',
      bundleId: downloadedBundle.id,
      safety,
    };
  } catch (err: any) {
    return {
      status: 'error',
      bundleId: downloadedBundle.id,
      safety,
      reason: err?.message || 'No se pudo activar la actualización OTA descargada.',
    };
  }
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
