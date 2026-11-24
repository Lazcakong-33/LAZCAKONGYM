import { useState, useEffect, useCallback, useRef } from 'react';
import {
  APP_VERSION,
  APP_BUILD_ID,
  forceAppUpdate,
  getAppUpdateSafetyStatus,
} from '../utils/updateApp';
import { resolveApiUrl } from '../utils/apiUrl';
import { detectRuntimePlatform } from '../utils/capacitorPlatform';

import {
  DEFAULT_NATIVE_VERSION_CODE,
  downloadAndStageOtaUpdate,
  fetchOtaManifestFromServer,
  resolveOtaChannel,
  validateOtaManifest,
  type OtaManifestPayload,
} from '../utils/otaUpdateEngine';

export function isVersionGreater(candidateVersion: string, currentVersion: string): boolean {
  if (!candidateVersion || !currentVersion) return false;
  const parse = (v: string) =>
    v
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);

  const c = parse(candidateVersion);
  const cur = parse(currentVersion);

  for (let i = 0; i < Math.max(c.length, cur.length); i++) {
    const num1 = c[i] || 0;
    const num2 = cur[i] || 0;
    if (num1 > num2) return true;
    if (num1 < num2) return false;
  }
  return false;
}

export interface AppUpdateState {
  hasUpdateAvailable: boolean;
  isUpdating: boolean;
  currentVersion: string;
  serverVersion: string | null;
  broadcastMessage: string | null;
  otaPendingManifest: OtaManifestPayload | null;
  triggerUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  checkUpdatesNow: () => Promise<boolean>;
}

export function useAppUpdate(): AppUpdateState {
  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
  const [latestBroadcastId, setLatestBroadcastId] = useState<string | null>(null);
  const [otaPendingManifest, setOtaPendingManifest] = useState<OtaManifestPayload | null>(null);
  // Multiple 25-second/visibility checks must never race to download or stage a bundle.
  const isNativeOtaCheckRunning = useRef(false);

  const dismissUpdate = useCallback(() => {
    try {
      localStorage.setItem('lazcakon_installed_version', APP_VERSION);
      localStorage.setItem('lazcakon_installed_build_id', APP_BUILD_ID);
      localStorage.setItem('lazcakongym_dismissed_update', APP_BUILD_ID);
      if (serverVersion) {
        localStorage.setItem('lazcakongym_dismissed_version', serverVersion);
      }
      if (latestBroadcastId) {
        localStorage.setItem('lazcakongym_dismissed_update', latestBroadcastId);
        localStorage.setItem('lazcakon_ack_broadcast_id', latestBroadcastId);
      }
      localStorage.setItem('lazcakon_last_update_ts', String(Date.now()));
    } catch {}
    setHasUpdateAvailable(false);
    window.dispatchEvent(new CustomEvent('app-update-dismissed'));
  }, [latestBroadcastId, serverVersion]);

  const checkUpdatesNow = useCallback(async (): Promise<boolean> => {
    try {
      const { hasServiceWorkerSupport, isCapacitorNative } = detectRuntimePlatform();

      // 0. Installed Android/iOS application: self-hosted OTA, no manual button.
      // Our first-party client owns the poller. The native Capgo autoUpdate flag
      // stays false because this is not an external Capgo-hosted channel.
      if (isCapacitorNative) {
        if (isNativeOtaCheckRunning.current) return false;
        isNativeOtaCheckRunning.current = true;
        try {
          const channel = resolveOtaChannel();
          const otaResp = await fetchOtaManifestFromServer({
            channel,
            nativeVersionCode: DEFAULT_NATIVE_VERSION_CODE,
          });

          if (otaResp.enabled && otaResp.updateAvailable && otaResp.manifest) {
            const manifest = otaResp.manifest;
            const validation = validateOtaManifest(manifest, {
              currentWebVersion: APP_VERSION,
              currentNativeVersionCode: DEFAULT_NATIVE_VERSION_CODE,
              expectedChannel: channel,
            });
            if (validation.valid) {
              // Download once, verify checksum, then activate on the NEXT safe
              // application launch. No interaction, forced reload, or data wipe.
              const result = await downloadAndStageOtaUpdate(manifest, {
                currentWebVersion: APP_VERSION,
                currentNativeVersionCode: DEFAULT_NATIVE_VERSION_CODE,
                applyImmediatelyWhenSafe: false,
                skipDownloadWhenUnsafe: true,
              });

              if (result.status === 'staged_for_background') {
                setOtaPendingManifest(null);
                setServerVersion(null);
                setBroadcastMessage(null);
                setHasUpdateAvailable(false);
                return false;
              }
              if (result.status === 'deferred_unsafe') {
                setOtaPendingManifest(manifest);
                setServerVersion(manifest.version);
                setBroadcastMessage('Actualización automática pendiente: se descargará al terminar el entrenamiento y sincronizar los datos.');
                setHasUpdateAvailable(true);
                return true;
              }
              if (result.status === 'error') {
                console.warn('[LAZCAKONGYM] Actualización automática reintentable:', result.reason);
              } else if (result.status === 'blocked') {
                console.warn('[LAZCAKONGYM] Manifiesto OTA bloqueado:', result.reason);
              }
            } else if (validation.requiresApkUpdate) {
              console.info('[LAZCAKONGYM] Esta versión requiere una nueva APK firmada:', validation.reason);
            }
          }
        } catch (error) {
          console.warn('[LAZCAKONGYM] No se pudo consultar OTA automático:', error);
        } finally {
          isNativeOtaCheckRunning.current = false;
        }

        // A native APK cannot be updated by a PWA Service Worker or /api/version.
        setOtaPendingManifest(null);
        setServerVersion(null);
        setBroadcastMessage(null);
        setHasUpdateAvailable(false);
        return false;
      }

      // 1. Check if a newer Service Worker is waiting on mobile/PWA
      if (hasServiceWorkerSupport && 'serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration) {
          await registration.update().catch(() => {});
          if (registration.waiting) {
            const safety = getAppUpdateSafetyStatus();
            if (safety.canUpdateSafely) {
              // Web/PWA: automatically activate the waiting worker ONLY when safe.
              // forceAppUpdate rechecks safety before reloading.
              await forceAppUpdate();
              return false;
            }
            setHasUpdateAvailable(true);
            window.dispatchEvent(new CustomEvent('app-update-deferred', { detail: safety }));
            return true;
          }
        }
      }

      // 2. Fetch server version from /api/version (never queries restricted Firestore collections)
      const res = await fetch(resolveApiUrl(`/api/version?t=${Date.now()}`), {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      });

      if (res.ok) {
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
          const data = await res.json();
          const targetVer = data.version || APP_VERSION;
          setServerVersion(targetVer);
          if (data.broadcastMessage) {
            setBroadcastMessage(data.broadcastMessage);
          }
          if (data.broadcastId) {
            setLatestBroadcastId(data.broadcastId);
          }

          const dismissedBuild = localStorage.getItem('lazcakongym_dismissed_update');
          const dismissedVer = localStorage.getItem('lazcakongym_dismissed_version');
          const ackBroadcast = localStorage.getItem('lazcakon_ack_broadcast_id');

          const isServerGenuinelyNewer =
            isVersionGreater(targetVer, APP_VERSION) &&
            dismissedBuild !== data.buildId &&
            dismissedVer !== targetVer;

          const hasUnackedBroadcast =
            Boolean(data.broadcastId) &&
            ackBroadcast !== data.broadcastId &&
            dismissedBuild !== data.broadcastId;

          if (isServerGenuinelyNewer || hasUnackedBroadcast) {
            setHasUpdateAvailable(true);
            window.dispatchEvent(new CustomEvent('app-update-available'));
            return true;
          } else {
            setHasUpdateAvailable(false);
            try {
              localStorage.setItem('lazcakon_installed_version', APP_VERSION);
              localStorage.setItem('lazcakon_installed_build_id', APP_BUILD_ID);
            } catch {}
            return false;
          }
        }
      }

      setHasUpdateAvailable(false);
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    // Initial check on mount
    checkUpdatesNow();

    // Listen to custom events to keep all hook instances synchronized
    const onSwUpdate = () => {
      setHasUpdateAvailable(true);
    };
    const onDismissed = () => {
      setHasUpdateAvailable(false);
    };
    window.addEventListener('app-update-available', onSwUpdate);
    window.addEventListener('app-update-dismissed', onDismissed);

    // Periodically poll server every 25 seconds on mobile
    const interval = setInterval(() => {
      checkUpdatesNow();
    }, 25000);

    // Poll whenever user switches back to the app on mobile
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkUpdatesNow();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('app-update-available', onSwUpdate);
      window.removeEventListener('app-update-dismissed', onDismissed);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [checkUpdatesNow]);

  const triggerUpdate = async () => {
    const safety = getAppUpdateSafetyStatus();
    if (!safety.canUpdateSafely) {
      setIsUpdating(false);
      window.dispatchEvent(new CustomEvent('app-update-deferred', { detail: safety }));
      return;
    }

    setIsUpdating(true);

    // If Capacitor native has a validated OTA bundle ready, download & apply via @capgo/capacitor-updater
    const { isCapacitorNative } = detectRuntimePlatform();
    // Never refresh an APK's embedded assets as if they were PWA assets.
    if (isCapacitorNative && !otaPendingManifest) {
      setIsUpdating(false);
      setHasUpdateAvailable(false);
      return;
    }
    if (isCapacitorNative && otaPendingManifest) {
      const otaResult = await downloadAndStageOtaUpdate(otaPendingManifest, {
        currentWebVersion: APP_VERSION,
        currentNativeVersionCode: DEFAULT_NATIVE_VERSION_CODE,
        applyImmediatelyWhenSafe: true,
      });
      if (otaResult.status === 'deferred_unsafe' || otaResult.status === 'blocked' || otaResult.status === 'error') {
        setIsUpdating(false);
        return;
      }
      if (otaResult.status === 'applied' || otaResult.status === 'staged_for_background') {
        try {
          localStorage.setItem('lazcakon_installed_version', otaPendingManifest.version);
          localStorage.setItem('lazcakon_installed_build_id', otaPendingManifest.buildId);
          localStorage.setItem('lazcakongym_dismissed_update', otaPendingManifest.buildId);
          localStorage.setItem('lazcakongym_dismissed_version', otaPendingManifest.version);
          localStorage.setItem('lazcakon_last_update_ts', String(Date.now()));
        } catch {}
        setHasUpdateAvailable(false);
        setIsUpdating(false);
        return;
      }
    }

    try {
      localStorage.setItem('lazcakon_installed_version', APP_VERSION);
      localStorage.setItem('lazcakon_installed_build_id', APP_BUILD_ID);
      localStorage.setItem('lazcakongym_dismissed_update', APP_BUILD_ID);
      if (serverVersion) {
        localStorage.setItem('lazcakongym_dismissed_version', serverVersion);
      }
      localStorage.setItem('lazcakon_last_update_ts', String(Date.now()));
      if (latestBroadcastId) {
        localStorage.setItem('lazcakon_ack_broadcast_id', latestBroadcastId);
      } else {
        localStorage.setItem('lazcakon_ack_broadcast_id', APP_BUILD_ID);
      }
    } catch {}
    try {
      const result = await forceAppUpdate();
      if (result.deferred) {
        setIsUpdating(false);
      }
    } catch {
      if (getAppUpdateSafetyStatus().canUpdateSafely) {
        window.location.reload();
      } else {
        setIsUpdating(false);
      }
    }
  };

  return {
    hasUpdateAvailable,
    isUpdating,
    currentVersion: APP_VERSION,
    serverVersion,
    broadcastMessage,
    otaPendingManifest,
    triggerUpdate,
    dismissUpdate,
    checkUpdatesNow,
  };
}
