/**
 * LAZCAKONG GYM 7.0 — ETAPA 6: MULTIPLATFORM & CAPACITOR PRODUCTION ADAPTER
 *
 * Centraliza la detección de entorno (Web / PWA / Capacitor Android / Capacitor iOS),
 * diagnóstico de cuota de almacenamiento local, listeners seguros de ciclo de vida
 * y matriz explícita de capacidades Offline vs Online.
 */

export type AppRuntimePlatform = 'web' | 'pwa_standalone' | 'capacitor_android' | 'capacitor_ios';

export interface PlatformEnvironmentInfo {
  platform: AppRuntimePlatform;
  isCapacitorNative: boolean;
  isStandalonePwa: boolean;
  hasServiceWorkerSupport: boolean;
  hasCacheStorageSupport: boolean;
  hasNotificationSupport: boolean;
  hasVibrationSupport: boolean;
}

export interface StorageHealthReport {
  supported: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  usagePct: number | null;
  isLowSpaceWarning: boolean;
}

export interface CapabilityDescriptor {
  id: string;
  label: string;
  worksOffline: boolean;
  detail: string;
}

export function detectRuntimePlatform(): PlatformEnvironmentInfo {
  if (typeof window === 'undefined') {
    return {
      platform: 'web',
      isCapacitorNative: false,
      isStandalonePwa: false,
      hasServiceWorkerSupport: false,
      hasCacheStorageSupport: false,
      hasNotificationSupport: false,
      hasVibrationSupport: false,
    };
  }

  const cap = (window as any).Capacitor;
  const isCapacitorNative = Boolean(
    cap &&
      (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap.isNative)
  );
  const capPlatform =
    cap && typeof cap.getPlatform === 'function' ? String(cap.getPlatform()).toLowerCase() : '';

  const isStandalonePwa = Boolean(
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
      (window.navigator as any)?.standalone === true
  );

  let platform: AppRuntimePlatform = 'web';
  if (isCapacitorNative) {
    platform = capPlatform === 'ios' ? 'capacitor_ios' : 'capacitor_android';
  } else if (isStandalonePwa) {
    platform = 'pwa_standalone';
  }

  return {
    platform,
    isCapacitorNative,
    isStandalonePwa,
    hasServiceWorkerSupport: typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !isCapacitorNative,
    hasCacheStorageSupport: typeof caches !== 'undefined',
    hasNotificationSupport: typeof Notification !== 'undefined',
    hasVibrationSupport: typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
  };
}

export async function getStorageHealthReport(): Promise<StorageHealthReport> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      usagePct: null,
      isLowSpaceWarning: false,
    };
  }

  try {
    const est = await navigator.storage.estimate();
    const usage = typeof est.usage === 'number' ? est.usage : null;
    const quota = typeof est.quota === 'number' && est.quota > 0 ? est.quota : null;
    const usagePct = usage !== null && quota !== null ? Math.round((usage / quota) * 100) : null;
    return {
      supported: true,
      usageBytes: usage,
      quotaBytes: quota,
      usagePct,
      isLowSpaceWarning: usagePct !== null && usagePct >= 85,
    };
  } catch {
    return {
      supported: false,
      usageBytes: null,
      quotaBytes: null,
      usagePct: null,
      isLowSpaceWarning: false,
    };
  }
}

export function subscribeAppLifecycleResume(onResume: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      onResume();
    }
  };

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('focus', onResume);
  window.addEventListener('online', onResume);

  // Optional Capacitor App plugin bridge if packaged inside native shell
  let capacitorHandle: { remove?: () => Promise<void> | void } | null = null;
  try {
    const capApp = (window as any)?.Capacitor?.Plugins?.App;
    if (capApp && typeof capApp.addListener === 'function') {
      capacitorHandle = capApp.addListener('appStateChange', (state: { isActive?: boolean }) => {
        if (state?.isActive) {
          onResume();
        }
      });
    }
  } catch {}

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('focus', onResume);
    window.removeEventListener('online', onResume);
    try {
      void capacitorHandle?.remove?.();
    } catch {}
  };
}

export function getOfflineCapabilitiesMatrix(): CapabilityDescriptor[] {
  return [
    {
      id: 'offline_workouts',
      label: 'Entrenamiento completo (rutinas, series, pesos, reps, RPE/RIR y notas)',
      worksOffline: true,
      detail: 'Guardado síncrono inmediato en el dispositivo y encolado automático al reconectar.',
    },
    {
      id: 'offline_pro_modules',
      label: 'Technique Pro, Coach Intelligence, Recuperación, Performance Lab y Desafíos XP',
      worksOffline: true,
      detail: 'Motores locales funcionando al 100% con el historial ya cargado.',
    },
    {
      id: 'offline_exercise_assets',
      label: 'Animaciones descargadas de tus rutinas',
      worksOffline: true,
      detail: 'Disponible sin red tras pulsar "Descargar ejercicios de mis rutinas".',
    },
    {
      id: 'offline_rest_timer',
      label: 'Temporizador de descanso y alertas locales con app abierta',
      worksOffline: true,
      detail: 'Precisión por targetEndTime local y vibración/audio configurados.',
    },
    {
      id: 'online_cloud_sync',
      label: 'Sincronización multi-dispositivo con Cloud Firestore',
      worksOffline: false,
      detail: 'Requiere conexión a internet para confirmar y fusionar con otros dispositivos.',
    },
    {
      id: 'online_web_push',
      label: 'Despertar remoto Web Push con pantalla bloqueada',
      worksOffline: false,
      detail: 'Requiere conectividad FCM/Web Push del sistema operativo.',
    },
    {
      id: 'online_initial_login',
      label: 'Primer inicio de sesión, registro con invitación o vinculación Google',
      worksOffline: false,
      detail: 'Requiere validación segura del servidor la primera vez antes de habilitar acceso offline.',
    },
  ];
}
