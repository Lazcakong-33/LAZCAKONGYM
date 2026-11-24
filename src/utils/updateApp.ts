/**
 * LAZCAKONGYM - Cache Buster & App Update Utility
 * Ensures mobile devices, PWAs, and desktop browsers clear stale service worker caches
 * and automatically restart into the newest build without losing athlete local records.
 */

// Dev OTA releases inject the actual bundle version during Vite build so that
// the installed JS never redownloads its own release on the next launch.
const buildVersion = (import.meta as unknown as { env?: Record<string, string> })?.env?.VITE_APP_VERSION || '';
export const APP_VERSION = /^v?\\d+\\.\\d+\\.\\d+$/.test(buildVersion)
  ? `v${buildVersion.replace(/^v/i, '')}`
  : 'v6.4.4';
export const APP_BUILD_ID = `${APP_VERSION.replace(/^v/, '')}-ota-segura`;
export const BUILD_DATE = '2026-11-23';

export const OFFLINE_SYNC_QUEUE_STORAGE_KEY = 'lazcakon_pending_offline_sync_queue';
export const DEFERRED_UPDATE_FLAG_KEY = 'lazcakon_deferred_update_pending';
const ACTIVE_SESSION_KEY_REGEX = /^lazcakon_.+_active_session$/;

export interface UpdateSafetyStorage {
  length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface UpdateSafetyCheck {
  canUpdateSafely: boolean;
  hasActiveWorkout: boolean;
  hasPendingOfflineSync: boolean;
  activeWorkoutProfileKeys: string[];
  pendingSyncCount: number;
  reason?: string;
}

export interface ForceAppUpdateResult {
  applied: boolean;
  deferred: boolean;
  status: UpdateSafetyCheck;
}

function getDefaultStorage(): UpdateSafetyStorage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {}
  return null;
}

/**
 * Inspects real profile-scoped workout session keys (`lazcakon_${profileId}_active_session`)
 * and the offline deferred sync queue (`lazcakon_pending_offline_sync_queue`) before allowing
 * any Service Worker skipWaiting or page reload.
 */
export function getAppUpdateSafetyStatus(
  storage: UpdateSafetyStorage | null = getDefaultStorage()
): UpdateSafetyCheck {
  const activeWorkoutProfileKeys: string[] = [];
  let pendingSyncCount = 0;
  let hasLegacyPendingSync = false;

  if (!storage) {
    return {
      canUpdateSafely: true,
      hasActiveWorkout: false,
      hasPendingOfflineSync: false,
      activeWorkoutProfileKeys,
      pendingSyncCount,
    };
  }

  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k) continue;
      if (ACTIVE_SESSION_KEY_REGEX.test(k) || k === 'lazcakongym_active_session') {
        const raw = storage.getItem(k);
        if (!raw || !raw.trim() || raw === 'null' || raw === 'false') continue;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object') {
            activeWorkoutProfileKeys.push(k);
          } else if (parsed === true || typeof parsed === 'string') {
            activeWorkoutProfileKeys.push(k);
          }
        } catch {
          // Conservative: non-empty unparseable active session string blocks reload
          activeWorkoutProfileKeys.push(k);
        }
      }
    }

    const queueRaw = storage.getItem(OFFLINE_SYNC_QUEUE_STORAGE_KEY);
    if (queueRaw && queueRaw.trim()) {
      try {
        const parsedQueue = JSON.parse(queueRaw);
        if (Array.isArray(parsedQueue)) {
          pendingSyncCount = parsedQueue.length;
        } else if (parsedQueue && typeof parsedQueue === 'object') {
          pendingSyncCount = 1;
        }
      } catch {
        pendingSyncCount = 1;
      }
    }

    const legacyPendingRaw = storage.getItem('lazcakongym_pending_sync');
    if (legacyPendingRaw && legacyPendingRaw.trim() && legacyPendingRaw !== 'null' && legacyPendingRaw !== 'false') {
      hasLegacyPendingSync = true;
    }
  } catch {
    // If storage read fails mid-session, treat conservatively as unsafe to reload
    return {
      canUpdateSafely: false,
      hasActiveWorkout: true,
      hasPendingOfflineSync: false,
      activeWorkoutProfileKeys,
      pendingSyncCount,
      reason: 'No se pudo verificar estado de almacenamiento; actualización pospuesta por seguridad.',
    };
  }

  const hasActiveWorkout = activeWorkoutProfileKeys.length > 0;
  const hasPendingOfflineSync = pendingSyncCount > 0 || hasLegacyPendingSync;
  const canUpdateSafely = !hasActiveWorkout && !hasPendingOfflineSync;

  let reason: string | undefined;
  if (hasActiveWorkout && hasPendingOfflineSync) {
    reason = 'Entrenamiento activo y cambios offline pendientes de sincronización.';
  } else if (hasActiveWorkout) {
    reason = 'Sesión de entrenamiento activa en curso.';
  } else if (hasPendingOfflineSync) {
    reason = `Hay ${pendingSyncCount || 1} sincronización(es) offline pendiente(s).`;
  }

  return {
    canUpdateSafely,
    hasActiveWorkout,
    hasPendingOfflineSync,
    activeWorkoutProfileKeys,
    pendingSyncCount,
    reason,
  };
}

/**
 * Helper that resolves after ms so cache/SW cleanup can never hang mobile browsers.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | void> {
  return Promise.race([
    promise,
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ]);
}

/**
 * Controlled, non-destructive app update mechanism.
 * Preserves active workout sessions, athlete localStorage data, and offline state,
 * returning `{ applied: false, deferred: true }` without reloading or skipping SW wait when unsafe.
 */
export async function forceAppUpdate(options?: {
  storage?: UpdateSafetyStorage | null;
  onReload?: (targetUrl: string) => void;
}): Promise<ForceAppUpdateResult> {
  const storage = options?.storage !== undefined ? options.storage : getDefaultStorage();

  // 1. Check real active workout session keys and offline sync queue FIRST
  const status = getAppUpdateSafetyStatus(storage);
  if (!status.canUpdateSafely) {
    try {
      storage?.setItem?.(DEFERRED_UPDATE_FLAG_KEY, String(Date.now()));
    } catch {}
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('app-update-deferred', { detail: status }));
    }
    console.warn(`[LAZCAKONGYM] Actualización pospuesta: ${status.reason}`);
    return { applied: false, deferred: true, status };
  }

  try {
    storage?.removeItem?.(DEFERRED_UPDATE_FLAG_KEY);
  } catch {}

  // 2. Synchronously record that this version was applied FIRST
  try {
    storage?.setItem?.('lazcakon_installed_version', APP_VERSION);
    storage?.setItem?.('lazcakon_installed_build_id', APP_BUILD_ID);
    storage?.setItem?.('lazcakongym_dismissed_update', APP_BUILD_ID);
    storage?.setItem?.('lazcakon_app_version', APP_VERSION);
    storage?.setItem?.('lazcakon_last_update_ts', String(Date.now()));
  } catch {}

  if (typeof window === 'undefined') {
    return { applied: true, deferred: false, status };
  }

  // 3. Guaranteed graceful restart timer
  const cleanUrl = window.location.origin + window.location.pathname;
  const targetUrl = `${cleanUrl}?updated=${Date.now()}`;
  const performReload =
    options?.onReload ||
    ((url: string) => {
      try {
        window.location.replace(url);
        setTimeout(() => {
          window.location.href = url;
          window.location.reload();
        }, 200);
      } catch {
        window.location.reload();
      }
    });

  const fallbackRestartTimer = setTimeout(() => {
    performReload(targetUrl);
  }, 650);

  try {
    // 4. Tell waiting service worker to skip waiting gently
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
      }
      const reg = await withTimeout(navigator.serviceWorker.getRegistration(), 300);
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    }
  } catch (err) {
    console.warn('[LAZCAKONGYM] Aviso durante actualización controlada:', err);
  } finally {
    clearTimeout(fallbackRestartTimer);
    performReload(targetUrl);
  }

  return { applied: true, deferred: false, status };
}

/**
 * Trigger service worker update check
 */
export async function checkServiceWorkerUpdate(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;

  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.update();
      if (registration.waiting) {
        return true;
      }
    }
  } catch (err) {
    console.warn('[LAZCAKONGYM] Error checking SW update:', err);
  }
  return false;
}
