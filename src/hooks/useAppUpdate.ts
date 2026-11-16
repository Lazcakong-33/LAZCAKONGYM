import { useState, useEffect, useCallback } from 'react';
import {
  APP_VERSION,
  APP_BUILD_ID,
  forceAppUpdate,
  getAppUpdateSafetyStatus,
} from '../utils/updateApp';

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
  triggerUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  checkUpdatesNow: () => Promise<boolean>;
}

export function useAppUpdate(): AppUpdateState {
  // Immediately register current running build in localStorage so this client is recognized as updated
  try {
    localStorage.setItem('lazcakon_installed_version', APP_VERSION);
    localStorage.setItem('lazcakon_installed_build_id', APP_BUILD_ID);
    localStorage.setItem('lazcakon_app_version', APP_VERSION);
  } catch {}

  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
  const [latestBroadcastId, setLatestBroadcastId] = useState<string | null>(null);

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
      // 1. Check if a newer Service Worker is waiting on mobile/PWA
      if ('serviceWorker' in navigator) {
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
      const res = await fetch(`/api/version?t=${Date.now()}`, {
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
    triggerUpdate,
    dismissUpdate,
    checkUpdatesNow,
  };
}
