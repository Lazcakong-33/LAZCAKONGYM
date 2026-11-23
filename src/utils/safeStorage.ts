/**
 * LAZCAKONG GYM 7.0 — SAFE LOCAL STORAGE & QUOTA RECOVERY
 *
 * Protects critical offline workout, history, PR, routine, and sync-queue writes
 * against QuotaExceededError on iOS/Android WebViews & browsers by safely reclaiming
 * reconstructible caches/redundant raw mirrors first and never silently crashing React.
 */

export interface StorageAdapterLike {
  readonly length?: number;
  key?: (index: number) => string | null;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface SafeStorageWriteResult {
  ok: boolean;
  recoveredByReclaim: boolean;
  quotaExceeded: boolean;
  reclaimedKeys: string[];
  errorMessage?: string;
}

// Reconstructible Tier-1 bloat keys that NEVER hold irreplaceable active workouts,
// confirmed history, PRs, routines, pending sync queue, or auth session bindings.
const RECLAIMABLE_CACHE_KEYS = [
  'lazcakon_offline_exercise_lib_meta_v1',
  'lazcakongym_last_update_check',
  'lazcakon_deferred_update_pending',
  'lazcakon_raw_unfiltered_backup_v1',
] as const;

export function isStorageQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; code?: unknown; message?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const code = typeof e.code === 'number' ? e.code : -1;
  const message = typeof e.message === 'string' ? e.message : '';

  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014 ||
    /quota/i.test(name) ||
    /quota/i.test(message)
  );
}

function listStorageKeys(store: StorageAdapterLike): string[] {
  const keys: string[] = [];
  if (typeof store.length !== 'number' || typeof store.key !== 'function') {
    return keys;
  }
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (typeof k === 'string' && k) {
        keys.push(k);
      }
    }
  } catch {}
  return keys;
}

function resolveDefaultStorage(custom?: StorageAdapterLike): StorageAdapterLike | null {
  if (custom) return custom;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  if (typeof localStorage !== 'undefined') return localStorage;
  return null;
}

function isProtectedCriticalKey(key: string): boolean {
  if (
    key === 'lazcakon_pending_offline_sync_queue' ||
    key === 'lazcakon_offline_session_binding_v1' ||
    key === 'lazcakon_is_logged_in' ||
    key === 'lazcakon_active_profile_id'
  ) {
    return true;
  }
  return (
    key.endsWith('_active_session') ||
    key.endsWith('_history') ||
    key.endsWith('_routines') ||
    key.endsWith('_prs') ||
    key.endsWith('_bodyweight') ||
    key.endsWith('_rest_timer') ||
    key.endsWith('_active_session_cleared_at')
  );
}

function reclaimNonCriticalKeys(
  store: StorageAdapterLike,
  targetKey: string,
  includeRedundantBackups: boolean
): string[] {
  const reclaimed: string[] = [];

  for (const candidate of RECLAIMABLE_CACHE_KEYS) {
    if (candidate === targetKey) continue;
    try {
      if (store.getItem(candidate) !== null) {
        store.removeItem(candidate);
        reclaimed.push(candidate);
      }
    } catch {}
  }

  if (includeRedundantBackups) {
    const allKeys = listStorageKeys(store);
    for (const k of allKeys) {
      if (k === targetKey || isProtectedCriticalKey(k)) continue;
      if (k.includes('_pre_import_backup') || k.startsWith('lazcakon_historico_mensual_')) {
        try {
          store.removeItem(k);
          reclaimed.push(k);
        } catch {}
      }
    }
  }

  return reclaimed;
}

/**
 * Safely writes to localStorage without throwing unhandled exceptions inside React effects.
 * When QuotaExceededError occurs, reclaims reconstructible caches / redundant backup mirrors first
 * and retries once while keeping core athlete data intact.
 */
export function safeLocalStorageSetItem(
  key: string,
  value: string,
  options?: {
    storage?: StorageAdapterLike;
    critical?: boolean;
    onQuotaError?: (message: string) => void;
  }
): SafeStorageWriteResult {
  const store = resolveDefaultStorage(options?.storage);
  if (!store) {
    return {
      ok: false,
      recoveredByReclaim: false,
      quotaExceeded: false,
      reclaimedKeys: [],
      errorMessage: 'Almacenamiento local no disponible.',
    };
  }

  try {
    store.setItem(key, value);
    return {
      ok: true,
      recoveredByReclaim: false,
      quotaExceeded: false,
      reclaimedKeys: [],
    };
  } catch (err) {
    if (!isStorageQuotaExceededError(err)) {
      const msg = err instanceof Error ? err.message : 'Error escribiendo almacenamiento local.';
      return {
        ok: false,
        recoveredByReclaim: false,
        quotaExceeded: false,
        reclaimedKeys: [],
        errorMessage: msg,
      };
    }

    // Attempt Tier-1 cache reclamation first
    const reclaimedTier1 = reclaimNonCriticalKeys(store, key, false);
    if (reclaimedTier1.length > 0) {
      try {
        store.setItem(key, value);
        return {
          ok: true,
          recoveredByReclaim: true,
          quotaExceeded: false,
          reclaimedKeys: reclaimedTier1,
        };
      } catch (retryErr) {
        if (!isStorageQuotaExceededError(retryErr)) {
          const msg = retryErr instanceof Error ? retryErr.message : 'Error escribiendo almacenamiento local.';
          return {
            ok: false,
            recoveredByReclaim: false,
            quotaExceeded: false,
            reclaimedKeys: reclaimedTier1,
            errorMessage: msg,
          };
        }
      }
    }

    // If writing a critical key, attempt Tier-2 reclamation (stale pre-import backup mirrors)
    const isCritical = options?.critical !== false;
    let allReclaimed = reclaimedTier1;
    if (isCritical) {
      const reclaimedTier2 = reclaimNonCriticalKeys(store, key, true);
      allReclaimed = Array.from(new Set([...reclaimedTier1, ...reclaimedTier2]));
      if (reclaimedTier2.length > 0) {
        try {
          store.setItem(key, value);
          return {
            ok: true,
            recoveredByReclaim: true,
            quotaExceeded: false,
            reclaimedKeys: allReclaimed,
          };
        } catch {}
      }
    }

    const quotaMsg =
      'Espacio local lleno (QuotaExceededError). Libera espacio o sincroniza con la nube para evitar pérdida de datos offline.';
    options?.onQuotaError?.(quotaMsg);
    return {
      ok: false,
      recoveredByReclaim: false,
      quotaExceeded: true,
      reclaimedKeys: allReclaimed,
      errorMessage: quotaMsg,
    };
  }
}

export function safeLocalStorageRemoveItem(key: string, customStorage?: StorageAdapterLike): void {
  const store = resolveDefaultStorage(customStorage);
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {}
}
