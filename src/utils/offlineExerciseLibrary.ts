/**
 * LAZCAKONG GYM 7.0 — ETAPA 6: SELECTIVE VERSIONED OFFLINE EXERCISE LIBRARY
 *
 * Descarga bajo demanda ÚNICAMENTE los recursos visuales (animaciones/miniaturas)
 * de los ejercicios presentes en las rutinas configuradas del atleta.
 * Nunca descarga automáticamente el catálogo completo de 669 ejercicios ni borra historial o app shell.
 */

import type {
  OfflineAssetCacheStatus,
  OfflineAssetDescriptor,
  OfflineLibraryRoutineReport,
  Routine,
} from '../types/index.ts';
import { resolveLibraryExercise } from '../data/exerciseLibrary.ts';

export const EXERCISE_LIB_CACHE_VERSION = 'v1';
export const EXERCISE_LIB_CACHE_PREFIX = 'lazcakon-exercise-lib-';
export const EXERCISE_LIB_CACHE_NAME = `${EXERCISE_LIB_CACHE_PREFIX}${EXERCISE_LIB_CACHE_VERSION}`;
export const EXERCISE_LIB_META_KEY = 'lazcakon_offline_exercise_lib_meta_v1';

export interface OfflineCacheAdapter {
  open: (cacheName: string) => Promise<{
    match: (request: string) => Promise<unknown | undefined>;
    put: (request: string, response: unknown) => Promise<void>;
    keys: () => Promise<Array<{ url: string }>>;
    delete: (request: string) => Promise<boolean>;
  }>;
  keys: () => Promise<string[]>;
  delete: (cacheName: string) => Promise<boolean>;
}

export interface OfflineStorageAdapter {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export type OfflineAssetFetchFn = (url: string) => Promise<{
  ok: boolean;
  status: number;
  clone?: () => unknown;
}>;

interface StoredOfflineLibraryMeta {
  cacheName: string;
  cacheVersion: string;
  cachedUrls: string[];
  lastUpdatedAt: number | null;
  quotaExceeded: boolean;
  lastError: string | null;
}

function getDefaultStorage(custom?: OfflineStorageAdapter): OfflineStorageAdapter | null {
  if (custom) return custom;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function getDefaultCacheStorage(custom?: OfflineCacheAdapter): OfflineCacheAdapter | null {
  if (custom) return custom;
  if (typeof caches !== 'undefined') return caches as unknown as OfflineCacheAdapter;
  return null;
}

function readMeta(storage?: OfflineStorageAdapter): StoredOfflineLibraryMeta {
  const store = getDefaultStorage(storage);
  if (!store) {
    return {
      cacheName: EXERCISE_LIB_CACHE_NAME,
      cacheVersion: EXERCISE_LIB_CACHE_VERSION,
      cachedUrls: [],
      lastUpdatedAt: null,
      quotaExceeded: false,
      lastError: null,
    };
  }
  try {
    const raw = store.getItem(EXERCISE_LIB_META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        cacheName: EXERCISE_LIB_CACHE_NAME,
        cacheVersion: EXERCISE_LIB_CACHE_VERSION,
        cachedUrls: Array.isArray(parsed.cachedUrls) ? parsed.cachedUrls : [],
        lastUpdatedAt: typeof parsed.lastUpdatedAt === 'number' ? parsed.lastUpdatedAt : null,
        quotaExceeded: Boolean(parsed.quotaExceeded),
        lastError: typeof parsed.lastError === 'string' ? parsed.lastError : null,
      };
    }
  } catch {}
  return {
    cacheName: EXERCISE_LIB_CACHE_NAME,
    cacheVersion: EXERCISE_LIB_CACHE_VERSION,
    cachedUrls: [],
    lastUpdatedAt: null,
    quotaExceeded: false,
    lastError: null,
  };
}

function writeMeta(meta: StoredOfflineLibraryMeta, storage?: OfflineStorageAdapter): void {
  const store = getDefaultStorage(storage);
  if (!store) return;
  try {
    store.setItem(EXERCISE_LIB_META_KEY, JSON.stringify(meta));
  } catch {}
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { name?: string; code?: number; message?: string };
  if (anyErr.name === 'QuotaExceededError' || anyErr.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return true;
  }
  if (anyErr.code === 22 || anyErr.code === 1014) {
    return true;
  }
  const msg = String(anyErr.message || '').toLowerCase();
  return msg.includes('quota') && msg.includes('exceed');
}

/**
 * Inspects strictly the athlete's configured routines (never the whole 669-exercise catalog)
 * and extracts unique animation/thumbnail assets required for offline workout guidance.
 */
export function resolveRoutineOfflineAssets(
  routines: Routine[],
  selectedAlternatives: Record<string, boolean> = {}
): OfflineLibraryRoutineReport {
  const uniqueUrls = new Set<string>();
  const uniqueAssets: OfflineAssetDescriptor[] = [];
  let exercisesCount = 0;

  const pushAsset = (
    url: string | null | undefined,
    exerciseName: string,
    kind: OfflineAssetDescriptor['kind'],
    libraryId?: string
  ) => {
    const clean = typeof url === 'string' ? url.trim() : '';
    if (!clean || (!clean.startsWith('http://') && !clean.startsWith('https://') && !clean.startsWith('/'))) {
      return;
    }
    if (uniqueUrls.has(clean)) return;
    uniqueUrls.add(clean);
    uniqueAssets.push({
      url: clean,
      exerciseName,
      libraryId,
      kind,
    });
  };

  for (const routine of routines || []) {
    if (!routine || !Array.isArray(routine.exercises)) continue;
    for (const ex of routine.exercises) {
      if (!ex) continue;
      exercisesCount++;

      const resolvedPrimary = resolveLibraryExercise({
        libraryExerciseId: ex.libraryExerciseId,
        id: ex.id,
        name: ex.name,
        equipment: ex.equipment,
      });

      const mediaUrl = resolvedPrimary?.animationUrl || ex.defaultVideoUrl;
      if (mediaUrl && /\.(webp|png|jpg|jpeg|gif)(\?|$)/i.test(mediaUrl)) {
        pushAsset(mediaUrl, ex.name, 'animation', resolvedPrimary?.id || ex.libraryExerciseId);
      }
      pushAsset(
        ex.thumbnailUrl || resolvedPrimary?.thumbnailUrl,
        ex.name,
        'thumbnail',
        resolvedPrimary?.id || ex.libraryExerciseId
      );

      // Include selected or configured alternative if present
      if (ex.alternative && (selectedAlternatives[ex.id] || ex.alternative.trim().length > 0)) {
        const resolvedAlt = resolveLibraryExercise({ name: ex.alternative });
        if (resolvedAlt?.animationUrl) {
          pushAsset(resolvedAlt.animationUrl, ex.alternative, 'animation', resolvedAlt.id);
        }
        if (resolvedAlt?.thumbnailUrl) {
          pushAsset(resolvedAlt.thumbnailUrl, ex.alternative, 'secondary_thumbnail', resolvedAlt.id);
        }
      }
    }
  }

  return {
    routinesCount: (routines || []).length,
    exercisesCount,
    uniqueAssets,
    uniqueUrls: Array.from(uniqueUrls),
  };
}

/**
 * Deletes ONLY obsolete versions of `lazcakon-exercise-lib-*` without touching app shell caches or user data.
 */
export async function evictObsoleteExerciseCaches(
  customCacheStorage?: OfflineCacheAdapter
): Promise<{ evictedCaches: string[] }> {
  const cacheApi = getDefaultCacheStorage(customCacheStorage);
  if (!cacheApi) return { evictedCaches: [] };
  const evictedCaches: string[] = [];
  try {
    const names = await cacheApi.keys();
    for (const name of names) {
      if (name.startsWith(EXERCISE_LIB_CACHE_PREFIX) && name !== EXERCISE_LIB_CACHE_NAME) {
        const deleted = await cacheApi.delete(name);
        if (deleted) evictedCaches.push(name);
      }
    }
  } catch {}
  return { evictedCaches };
}

export async function clearOfflineExerciseAssetCache(params?: {
  cacheStorage?: OfflineCacheAdapter;
  storage?: OfflineStorageAdapter;
}): Promise<{ cleared: boolean }> {
  const cacheApi = getDefaultCacheStorage(params?.cacheStorage);
  let cleared = false;
  if (cacheApi) {
    try {
      const names = await cacheApi.keys();
      for (const name of names) {
        if (name.startsWith(EXERCISE_LIB_CACHE_PREFIX)) {
          const ok = await cacheApi.delete(name);
          if (ok) cleared = true;
        }
      }
    } catch {}
  }
  const store = getDefaultStorage(params?.storage);
  if (store) {
    try {
      store.removeItem(EXERCISE_LIB_META_KEY);
      cleared = true;
    } catch {}
  }
  return { cleared };
}

export async function getOfflineExerciseCacheStatus(params: {
  routines: Routine[];
  selectedAlternatives?: Record<string, boolean>;
  cacheStorage?: OfflineCacheAdapter;
  storage?: OfflineStorageAdapter;
}): Promise<OfflineAssetCacheStatus> {
  const report = resolveRoutineOfflineAssets(params.routines, params.selectedAlternatives);
  const meta = readMeta(params.storage);
  const cacheApi = getDefaultCacheStorage(params.cacheStorage);

  let cachedSet = new Set<string>(meta.cachedUrls);
  if (cacheApi) {
    try {
      const cache = await cacheApi.open(EXERCISE_LIB_CACHE_NAME);
      const keys = await cache.keys();
      if (keys.length > 0 || report.uniqueUrls.length > 0) {
        cachedSet = new Set(keys.map((req) => req.url));
      }
    } catch {}
  }

  let cachedAssetsCount = 0;
  for (const url of report.uniqueUrls) {
    if (cachedSet.has(url)) cachedAssetsCount++;
  }

  let storageUsageBytes: number | undefined;
  let storageQuotaBytes: number | undefined;
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      storageUsageBytes = est.usage;
      storageQuotaBytes = est.quota;
    } catch {}
  }

  return {
    cacheName: EXERCISE_LIB_CACHE_NAME,
    cacheVersion: EXERCISE_LIB_CACHE_VERSION,
    targetAssetsCount: report.uniqueUrls.length,
    cachedAssetsCount,
    missingAssetsCount: Math.max(0, report.uniqueUrls.length - cachedAssetsCount),
    lastUpdatedAt: meta.lastUpdatedAt,
    quotaExceeded: meta.quotaExceeded,
    lastError: meta.lastError,
    storageUsageBytes,
    storageQuotaBytes,
  };
}

export async function downloadRoutineAssetsForOffline(params: {
  routines: Routine[];
  selectedAlternatives?: Record<string, boolean>;
  cacheStorage?: OfflineCacheAdapter;
  storage?: OfflineStorageAdapter;
  fetcher?: OfflineAssetFetchFn;
  onProgress?: (progress: { completed: number; total: number; currentExercise?: string }) => void;
}): Promise<{
  status: 'completed' | 'partial' | 'quota_exceeded' | 'empty' | 'unsupported';
  downloadedCount: number;
  alreadyCachedCount: number;
  failedCount: number;
  totalTargetCount: number;
  quotaExceeded: boolean;
  message: string;
}> {
  const report = resolveRoutineOfflineAssets(params.routines, params.selectedAlternatives);
  if (report.uniqueAssets.length === 0) {
    return {
      status: 'empty',
      downloadedCount: 0,
      alreadyCachedCount: 0,
      failedCount: 0,
      totalTargetCount: 0,
      quotaExceeded: false,
      message: 'Tus rutinas actuales no tienen recursos visuales descargables pendientes.',
    };
  }

  const cacheApi = getDefaultCacheStorage(params.cacheStorage);
  if (!cacheApi) {
    return {
      status: 'unsupported',
      downloadedCount: 0,
      alreadyCachedCount: 0,
      failedCount: 0,
      totalTargetCount: report.uniqueAssets.length,
      quotaExceeded: false,
      message: 'CacheStorage no está disponible en este entorno.',
    };
  }

  // First evict obsolete exercise cache versions safely (app shell and user history untouched)
  await evictObsoleteExerciseCaches(cacheApi);

  const fetcher: OfflineAssetFetchFn =
    params.fetcher ||
    (async (url: string) => {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      return res;
    });

  const cache = await cacheApi.open(EXERCISE_LIB_CACHE_NAME);
  const existingCachedUrls = new Set<string>();
  let downloadedCount = 0;
  let alreadyCachedCount = 0;
  let failedCount = 0;
  let quotaExceeded = false;
  let processed = 0;
  const total = report.uniqueAssets.length;

  for (const asset of report.uniqueAssets) {
    if (quotaExceeded) break;

    try {
      const existing = await cache.match(asset.url);
      if (existing) {
        alreadyCachedCount++;
        existingCachedUrls.add(asset.url);
        processed++;
        params.onProgress?.({ completed: processed, total, currentExercise: asset.exerciseName });
        continue;
      }

      const response = await fetcher(asset.url);
      if (!response || !response.ok) {
        failedCount++;
      } else {
        const toStore = typeof response.clone === 'function' ? response.clone() : response;
        await cache.put(asset.url, toStore);
        downloadedCount++;
        existingCachedUrls.add(asset.url);
      }
    } catch (err) {
      if (isQuotaExceededError(err)) {
        quotaExceeded = true;
        break;
      }
      failedCount++;
    }

    processed++;
    params.onProgress?.({ completed: processed, total, currentExercise: asset.exerciseName });
  }

  const message = quotaExceeded
    ? `Espacio insuficiente en el dispositivo tras guardar ${downloadedCount + alreadyCachedCount} de ${total} recursos. Tu historial y rutinas permanecen intactos.`
    : failedCount > 0
      ? `Descarga parcial: ${downloadedCount + alreadyCachedCount} listos offline, ${failedCount} pendientes de red.`
      : `Biblioteca offline lista: ${downloadedCount + alreadyCachedCount} recursos visuales de tus rutinas disponibles sin conexión.`;

  writeMeta(
    {
      cacheName: EXERCISE_LIB_CACHE_NAME,
      cacheVersion: EXERCISE_LIB_CACHE_VERSION,
      cachedUrls: Array.from(existingCachedUrls),
      lastUpdatedAt: Date.now(),
      quotaExceeded,
      lastError: quotaExceeded ? message : failedCount > 0 ? message : null,
    },
    params.storage
  );

  return {
    status: quotaExceeded ? 'quota_exceeded' : failedCount > 0 ? 'partial' : 'completed',
    downloadedCount,
    alreadyCachedCount,
    failedCount,
    totalTargetCount: total,
    quotaExceeded,
    message,
  };
}
