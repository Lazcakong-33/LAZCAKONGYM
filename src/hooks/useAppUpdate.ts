import { useState, useEffect, useCallback } from 'react';
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

      // 0. On Capacitor native shells, check self-hosted OTA manifest (development channel unless prod explicitly enabled)
      if (isCapacitorNative) {
        try {
          const channel = resolveOtaChannel();
          const otaResp = await fetchOtaManifestFromServer({
            channel,
            nativeVersionCode: DEFAULT_NATIVE_VERSION_CODE,
          });
          if (otaResp.enabled && otaResp.updateAvailable && otaResp.manifest) {
            const validation = validateOtaManifest(otaResp.manifest, {
              currentWebVersion: APP_VERSION,
              currentNativeVersionCode: DEFAULT_NATIVE_VERSION_CODE,
              expectedChannel: channel,
            });
            const dismissedVer = localStorage.getItem('lazcakongym_dismissed_version');
            const dismissedBuild = localStorage.getItem('lazcakongym_dismissed_update');
            if (
              validation.valid &&
              dismissedVer !== otaResp.manifest.version &&
              dismissedBuild !== otaResp.manifest.buildId
            ) {
              setOtaPendingManifest(otaResp.manifest);
              setServerVersion(otaResp.manifest.version);
              setBroadcastMessage(
                otaResp.manifest.releaseNotes ||
                  `Actualización OTA (${otaResp.manifest.channel}) lista para descargar.`
              );
              setHasUpdateAvailable(true);
              window.dispatchEvent(new CustomEvent('app-update-available'));
              return true;
            }
          }
          setOtaPendingManifest(null);
        } catch (error) {
          console.warn('[LAZCAKONGYM] No se pudo consultar OTA nativo:', error);
        }

        // An APK embeds its own web assets. A newer /api/version or Service Worker
        // cannot update those assets; only a compatible OTA manifest can.
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
            setHasUpdateAvailable(true);
            window.dispatchEvent(new CustomEvent('app-update-available'));
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
