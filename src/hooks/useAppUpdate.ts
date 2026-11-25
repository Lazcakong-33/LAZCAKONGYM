import { useState, useEffect, useCallback, useRef } from 'react';
import {
  APP_VERSION,
  APP_BUILD_ID,
  forceAppUpdate,
  getAppUpdateSafetyStatus,
} from '../utils/updateApp';
import { resolveApiUrl } from '../utils/apiUrl';
import {
  detectRuntimePlatform,
  subscribeAppLifecycleResume,
} from '../utils/capacitorPlatform';
import {
  clearJustInstalledOtaNotice,
  compareSemver,
  DEFAULT_NATIVE_VERSION_CODE,
  downloadAndStageOtaUpdate,
  evaluateOtaCompatibility,
  evaluateOtaRetryEligibility,
  fetchOtaManifestFromServer,
  getInstalledOtaRuntimeInfo,
  OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
  readJustInstalledOtaNotice,
  reportOtaTelemetry,
  resolveOtaChannel,
  validateOtaManifest,
  type OtaManifestPayload,
  type OtaUrgency,
} from '../utils/otaUpdateEngine';

export function isVersionGreater(candidateVersion: string, currentVersion: string): boolean {
  if (!candidateVersion || !currentVersion) return false;
  return compareSemver(candidateVersion, currentVersion) > 0;
}

export const AUTO_UPDATE_CHECK_COOLDOWN_MS = 15 * 60 * 1000;
export const BACKGROUND_UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000;
const LAST_AUTO_CHECK_STORAGE_KEY = 'lazcakon_ota_last_auto_check_at';

export type OtaStageStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready_to_apply'
  | 'deferred_workout'
  | 'apk_required'
  | 'installed'
  | 'error';

export interface AppUpdateState {
  hasUpdateAvailable: boolean;
  isUpdating: boolean;
  currentVersion: string;
  serverVersion: string | null;
  broadcastMessage: string | null;
  otaPendingManifest: OtaManifestPayload | null;
  downloadProgress: number | null;
  otaStageStatus: OtaStageStatus;
  requiresApkUpdate: boolean;
  apkDownloadUrl: string;
  urgency: OtaUrgency;
  justInstalledVersion: string | null;
  otaError: string | null;
  triggerUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  dismissInstalledConfirmation: () => void;
  checkUpdatesNow: () => Promise<boolean>;
}

export function useAppUpdate(): AppUpdateState {
  try {
    if (!localStorage.getItem('lazcakon_installed_version')) {
      localStorage.setItem('lazcakon_installed_version', APP_VERSION);
    }
    localStorage.setItem('lazcakon_installed_build_id', APP_BUILD_ID);
    localStorage.setItem('lazcakon_app_version', APP_VERSION);
  } catch {}

  const [hasUpdateAvailable, setHasUpdateAvailable] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [effectiveCurrentVersion, setEffectiveCurrentVersion] = useState<string>(APP_VERSION);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [broadcastMessage, setBroadcastMessage] = useState<string | null>(null);
  const [latestBroadcastId, setLatestBroadcastId] = useState<string | null>(null);
  const [otaPendingManifest, setOtaPendingManifest] = useState<OtaManifestPayload | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [otaStageStatus, setOtaStageStatus] = useState<OtaStageStatus>('idle');
  const [requiresApkUpdate, setRequiresApkUpdate] = useState<boolean>(false);
  const [apkDownloadUrl, setApkDownloadUrl] = useState<string>(OFFICIAL_RELEASE_APK_DOWNLOAD_URL);
  const [urgency, setUrgency] = useState<OtaUrgency>('optional');
  const [otaError, setOtaError] = useState<string | null>(null);
  const [justInstalledVersion, setJustInstalledVersion] = useState<string | null>(() => {
    const notice = readJustInstalledOtaNotice();
    return notice?.version || null;
  });

  const autoDownloadStartedForBuildRef = useRef<string | null>(null);
  const telemetryReportedStatusRef = useRef<string | null>(null);
  const lastAutoCheckAtRef = useRef<number>(0);

  const dismissInstalledConfirmation = useCallback(() => {
    clearJustInstalledOtaNotice();
    setJustInstalledVersion(null);
    if (otaStageStatus === 'installed') {
      setOtaStageStatus('idle');
    }
  }, [otaStageStatus]);

  const dismissUpdate = useCallback(() => {
    try {
      localStorage.setItem('lazcakon_installed_version', effectiveCurrentVersion);
      localStorage.setItem('lazcakon_installed_build_id', APP_BUILD_ID);
      localStorage.setItem('lazcakongym_dismissed_update', APP_BUILD_ID);
      if (serverVersion) {
        localStorage.setItem('lazcakongym_dismissed_version', serverVersion);
      }
      if (otaPendingManifest?.buildId) {
        localStorage.setItem('lazcakongym_dismissed_update', otaPendingManifest.buildId);
      }
      if (latestBroadcastId) {
        localStorage.setItem('lazcakongym_dismissed_update', latestBroadcastId);
        localStorage.setItem('lazcakon_ack_broadcast_id', latestBroadcastId);
      }
      localStorage.setItem('lazcakon_last_update_ts', String(Date.now()));
    } catch {}
    setHasUpdateAvailable(false);
    window.dispatchEvent(new CustomEvent('app-update-dismissed'));
  }, [effectiveCurrentVersion, latestBroadcastId, otaPendingManifest?.buildId, serverVersion]);

  const runBackgroundDownload = useCallback(
    async (
      manifest: OtaManifestPayload,
      runtimeWebVersion: string,
      nativeVersionCode: number
    ) => {
      if (autoDownloadStartedForBuildRef.current === manifest.buildId) return;
      const retryCheck = evaluateOtaRetryEligibility(manifest.buildId);
      if (!retryCheck.eligible) {
        setOtaStageStatus('error');
        setOtaError(retryCheck.reason || null);
        return;
      }

      autoDownloadStartedForBuildRef.current = manifest.buildId;
      setOtaStageStatus('downloading');
      setDownloadProgress(5);
      setOtaError(null);

      const result = await downloadAndStageOtaUpdate(manifest, {
        currentWebVersion: runtimeWebVersion,
        currentNativeVersionCode: nativeVersionCode,
        applyImmediatelyWhenSafe: false,
        onProgress: (pct) => {
          setDownloadProgress(pct);
        },
      });

      if (result.status === 'staged_for_background') {
        setOtaPendingManifest(manifest);
        setServerVersion(manifest.version);
        setHasUpdateAvailable(true);
        setDownloadProgress(100);
        setOtaStageStatus('ready_to_apply');
        void reportOtaTelemetry({
          channel: manifest.channel,
          installedVersion: runtimeWebVersion,
          installedBuildId: APP_BUILD_ID,
          nativeVersionCode,
          targetVersion: manifest.version,
          status: 'staged',
        });
      } else if (result.status === 'applied') {
        setOtaPendingManifest(manifest);
        setServerVersion(manifest.version);
        setDownloadProgress(100);
        setOtaStageStatus('ready_to_apply');
        void reportOtaTelemetry({
          channel: manifest.channel,
          installedVersion: runtimeWebVersion,
          installedBuildId: APP_BUILD_ID,
          nativeVersionCode,
          targetVersion: manifest.version,
          status: 'staged',
        });
      } else if (result.status === 'deferred_unsafe') {
        setOtaPendingManifest(manifest);
        setServerVersion(manifest.version);
        setHasUpdateAvailable(true);
        setDownloadProgress(100);
        setOtaStageStatus('deferred_workout');
        void reportOtaTelemetry({
          channel: manifest.channel,
          installedVersion: runtimeWebVersion,
          installedBuildId: APP_BUILD_ID,
          nativeVersionCode,
          targetVersion: manifest.version,
          status: 'deferred_workout',
        });
      } else if (result.status === 'error' || result.status === 'blocked') {
        autoDownloadStartedForBuildRef.current = null;
        setDownloadProgress(null);
        setOtaStageStatus('error');
        setOtaError(result.reason || 'Error descargando actualización OTA.');
        void reportOtaTelemetry({
          channel: manifest.channel,
          installedVersion: runtimeWebVersion,
          installedBuildId: APP_BUILD_ID,
          nativeVersionCode,
          targetVersion: manifest.version,
          status: 'error',
          errorMessage: result.reason,
        });
      }
    },
    []
  );

  const checkUpdatesNow = useCallback(async (): Promise<boolean> => {
    try {
      const { hasServiceWorkerSupport, isCapacitorNative } = detectRuntimePlatform();

      // 0. On Capacitor native shells, check self-hosted OTA manifest with real native & bundle versions
      if (isCapacitorNative) {
        try {
          const runtimeInfo = await getInstalledOtaRuntimeInfo();
          const currentVer = isVersionGreater(runtimeInfo.webVersion, APP_VERSION)
            ? runtimeInfo.webVersion
            : APP_VERSION;
          setEffectiveCurrentVersion(currentVer);

          const channel = resolveOtaChannel();
          const otaResp = await fetchOtaManifestFromServer({
            channel,
            nativeVersionCode: runtimeInfo.nativeVersionCode,
          });
          if (otaResp.apkDownloadUrl) {
            setApkDownloadUrl(otaResp.apkDownloadUrl);
          }

          if (otaResp.enabled && otaResp.manifest) {
            const m = otaResp.manifest;
            const dismissedVer = localStorage.getItem('lazcakongym_dismissed_version');
            const dismissedBuild = localStorage.getItem('lazcakongym_dismissed_update');
            const isDismissed =
              m.urgency !== 'critical' &&
              (dismissedVer === m.version || dismissedBuild === m.buildId);

            // Check if native APK upgrade is strictly required (forbidden via OTA)
            const compat = evaluateOtaCompatibility(m, runtimeInfo.nativeVersionCode);
            if (
              compat.requiresApkUpdate &&
              isVersionGreater(m.version, currentVer) &&
              !isDismissed
            ) {
              setRequiresApkUpdate(true);
              setApkDownloadUrl(m.apkDownloadUrl || otaResp.apkDownloadUrl || OFFICIAL_RELEASE_APK_DOWNLOAD_URL);
              setOtaPendingManifest(m);
              setServerVersion(m.version);
              setUrgency(m.urgency === 'critical' ? 'critical' : 'optional');
              setBroadcastMessage(
                m.releaseNotes ||
                  'Esta versión incluye cambios nativos Android. Descarga la nueva APK oficial.'
              );
              setOtaStageStatus('apk_required');
              setHasUpdateAvailable(true);
              window.dispatchEvent(new CustomEvent('app-update-available'));
              return true;
            }

            const validation = validateOtaManifest(m, {
              currentWebVersion: currentVer,
              currentNativeVersionCode: runtimeInfo.nativeVersionCode,
              expectedChannel: channel,
            });

            if (validation.valid && !isDismissed) {
              setRequiresApkUpdate(false);
              setOtaPendingManifest(m);
              setServerVersion(m.version);
              setUrgency(m.urgency === 'critical' ? 'critical' : 'optional');
              setBroadcastMessage(
                m.releaseNotes || `Mejoras disponibles en LAZCAKONG GYM ${m.version}.`
              );
              setHasUpdateAvailable(true);
              window.dispatchEvent(new CustomEvent('app-update-available'));
              // Background auto-download & safe stage without interrupting workouts
              void runBackgroundDownload(m, currentVer, runtimeInfo.nativeVersionCode);
              return true;
            }
          }

          if (telemetryReportedStatusRef.current !== currentVer) {
            telemetryReportedStatusRef.current = currentVer;
            void reportOtaTelemetry({
              channel,
              installedVersion: currentVer,
              installedBuildId: APP_BUILD_ID,
              nativeVersionCode: runtimeInfo.nativeVersionCode,
              status: 'up_to_date',
            });
          }
          setOtaPendingManifest(null);
          setRequiresApkUpdate(false);
        } catch {}
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
          if (data.apkDownloadUrl) {
            setApkDownloadUrl(data.apkDownloadUrl);
          }
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
  }, [runBackgroundDownload]);

  useEffect(() => {
    const runThrottledAutoCheck = (allowInitialMount = false) => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const now = Date.now();
      let lastCheck = lastAutoCheckAtRef.current;
      if (!lastCheck) {
        try {
          const persisted = Number(localStorage.getItem(LAST_AUTO_CHECK_STORAGE_KEY) || '0');
          if (Number.isFinite(persisted) && persisted > 0) {
            lastCheck = persisted;
          }
        } catch {}
      }

      if (!allowInitialMount && now - lastCheck < AUTO_UPDATE_CHECK_COOLDOWN_MS) {
        return;
      }

      if (allowInitialMount && lastCheck > 0 && now - lastCheck < 60_000) {
        return;
      }

      lastAutoCheckAtRef.current = now;
      try {
        localStorage.setItem(LAST_AUTO_CHECK_STORAGE_KEY, String(now));
      } catch {}
      void checkUpdatesNow();
    };

    runThrottledAutoCheck(true);

    const onSwUpdate = () => {
      setHasUpdateAvailable(true);
    };
    const onDismissed = () => {
      setHasUpdateAvailable(false);
    };
    const onJustInstalled = (evt: Event) => {
      const detail = (evt as CustomEvent<{ version?: string }>).detail;
      if (detail?.version) {
        setJustInstalledVersion(detail.version);
        setOtaStageStatus('installed');
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runThrottledAutoCheck(false);
      }
    };

    window.addEventListener('app-update-available', onSwUpdate);
    window.addEventListener('app-update-dismissed', onDismissed);
    window.addEventListener('ota-just-installed', onJustInstalled);
    document.addEventListener('visibilitychange', onVisibilityChange);

    const interval = setInterval(() => {
      runThrottledAutoCheck(false);
    }, BACKGROUND_UPDATE_POLL_INTERVAL_MS);

    const unsubscribeResume = subscribeAppLifecycleResume(() => {
      runThrottledAutoCheck(false);
    });

    return () => {
      window.removeEventListener('app-update-available', onSwUpdate);
      window.removeEventListener('app-update-dismissed', onDismissed);
      window.removeEventListener('ota-just-installed', onJustInstalled);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribeResume();
      clearInterval(interval);
    };
  }, [checkUpdatesNow]);

  const triggerUpdate = async () => {
    if (requiresApkUpdate) {
      if (typeof document !== 'undefined') {
        const link = document.createElement('a');
        link.href = apkDownloadUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.click();
      }
      return;
    }

    const safety = getAppUpdateSafetyStatus();
    if (!safety.canUpdateSafely) {
      setIsUpdating(false);
      setOtaStageStatus('deferred_workout');
      window.dispatchEvent(new CustomEvent('app-update-deferred', { detail: safety }));
      return;
    }

    setIsUpdating(true);
    setOtaError(null);

    const { isCapacitorNative } = detectRuntimePlatform();
    if (isCapacitorNative && otaPendingManifest) {
      setOtaStageStatus('downloading');
      const runtimeInfo = await getInstalledOtaRuntimeInfo();
      const otaResult = await downloadAndStageOtaUpdate(otaPendingManifest, {
        currentWebVersion: runtimeInfo.webVersion || APP_VERSION,
        currentNativeVersionCode: runtimeInfo.nativeVersionCode || DEFAULT_NATIVE_VERSION_CODE,
        applyImmediatelyWhenSafe: true,
        skipRetryGuard: true,
        onProgress: (pct) => setDownloadProgress(pct),
      });

      if (otaResult.status === 'deferred_unsafe') {
        setIsUpdating(false);
        setOtaStageStatus('deferred_workout');
        return;
      }

      if (otaResult.status === 'blocked' || otaResult.status === 'error') {
        setIsUpdating(false);
        setOtaStageStatus('error');
        setOtaError(otaResult.reason || 'Error aplicando paquete OTA.');
        void reportOtaTelemetry({
          channel: otaPendingManifest.channel,
          installedVersion: effectiveCurrentVersion,
          installedBuildId: APP_BUILD_ID,
          nativeVersionCode: runtimeInfo.nativeVersionCode,
          targetVersion: otaPendingManifest.version,
          status: 'error',
          errorMessage: otaResult.reason,
        });
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
        void reportOtaTelemetry({
          channel: otaPendingManifest.channel,
          installedVersion: otaPendingManifest.version,
          installedBuildId: otaPendingManifest.buildId,
          nativeVersionCode: runtimeInfo.nativeVersionCode,
          targetVersion: otaPendingManifest.version,
          status: 'updated',
        });
        setJustInstalledVersion(otaPendingManifest.version);
        setOtaStageStatus('installed');
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
    currentVersion: effectiveCurrentVersion,
    serverVersion,
    broadcastMessage,
    otaPendingManifest,
    downloadProgress,
    otaStageStatus,
    requiresApkUpdate,
    apkDownloadUrl,
    urgency,
    justInstalledVersion,
    otaError,
    triggerUpdate,
    dismissUpdate,
    dismissInstalledConfirmation,
    checkUpdatesNow,
  };
}
