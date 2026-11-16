/**
 * Background Timer, Screen Wake Lock & Service Worker Lock-Screen Smartwatch Alarm Utility
 * Ensures rest countdowns and smartwatch vibrations trigger accurately at 5s and 0s
 * even when the phone screen is turned off or locked.
 */

// Web Worker instance for persistent background ticks
let workerInstance: Worker | null = null;
let currentTickCallback: (() => void) | null = null;
let fallbackIntervalId: number | null = null;

// Screen WakeLock sentinel to prevent mobile screen from sleeping during active workouts & rests
let wakeLockSentinel: any = null;
let isWakeLockRequested = false;

// Deduplication trackers by targetEndTime so 5s and 0s alerts never miss even if ticks jump
let lastFiveSecAlertTarget = 0;
let lastCompleteAlertTarget = 0;

/**
 * Posts a message to the active Service Worker so the SW itself schedules and fires
 * the 5s and 0s system notifications while the phone screen is locked.
 */
export async function scheduleServiceWorkerRestAlarm(
  targetEndTime: number,
  exerciseName?: string
): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  // Ensure notification permission is requested when scheduling a rest timer
  await requestNotificationPermission();

  const payload = {
    type: 'SCHEDULE_REST_ALARM',
    targetEndTime,
    exerciseName: exerciseName || '',
  };

  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
    }
    const reg = await navigator.serviceWorker.ready;
    if (reg && reg.active) {
      reg.active.postMessage(payload);
    }
  } catch (e) {
    console.warn('[LAZCAKONGYM] Failed to schedule SW rest alarm:', e);
  }
}

/**
 * Cancels any pending Service Worker rest alarm when the user stops or finishes the timer.
 */
export async function cancelServiceWorkerRestAlarm(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const payload = { type: 'CANCEL_REST_ALARM' };
  try {
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(payload);
    }
    const reg = await navigator.serviceWorker.ready;
    if (reg && reg.active) {
      reg.active.postMessage(payload);
    }
  } catch {}
}

/**
 * Initializes or starts the background Web Worker timer.
 * Web Workers run in an isolated OS thread and are not suspended or throttled
 * as aggressively by mobile browsers as the main DOM window thread.
 */
export function startBackgroundTicker(onTick: () => void, intervalMs = 350) {
  currentTickCallback = onTick;

  // Clean up any existing ticker
  stopBackgroundTicker();
  currentTickCallback = onTick;

  if (typeof window !== 'undefined' && window.Worker && typeof Blob !== 'undefined') {
    try {
      const workerBlob = new Blob(
        [
          `
          let timerId = null;
          self.onmessage = function(e) {
            if (e.data.command === 'start') {
              if (timerId) clearInterval(timerId);
              timerId = setInterval(function() {
                self.postMessage({ type: 'tick', timestamp: Date.now() });
              }, e.data.interval || 350);
            } else if (e.data.command === 'stop') {
              if (timerId) {
                clearInterval(timerId);
                timerId = null;
              }
            }
          };
        `,
        ],
        { type: 'application/javascript' }
      );

      const workerUrl = URL.createObjectURL(workerBlob);
      workerInstance = new Worker(workerUrl);

      workerInstance.onmessage = (event) => {
        if (event.data?.type === 'tick' && currentTickCallback) {
          currentTickCallback();
        }
      };

      workerInstance.postMessage({ command: 'start', interval: intervalMs });
      return;
    } catch (e) {
      console.warn('Web Worker timer not available, falling back to interval:', e);
    }
  }

  // Fallback to standard window interval
  fallbackIntervalId = window.setInterval(() => {
    if (currentTickCallback) currentTickCallback();
  }, intervalMs);
}

/**
 * Stops the background worker timer
 */
export function stopBackgroundTicker() {
  if (workerInstance) {
    try {
      workerInstance.postMessage({ command: 'stop' });
      workerInstance.terminate();
    } catch {}
    workerInstance = null;
  }
  if (fallbackIntervalId !== null) {
    clearInterval(fallbackIntervalId);
    fallbackIntervalId = null;
  }
}

/**
 * Requests Screen Wake Lock to prevent the phone from auto-locking / turning screen off
 */
export async function enableScreenWakeLock(): Promise<boolean> {
  isWakeLockRequested = true;
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return false;
  }

  try {
    if (wakeLockSentinel && !wakeLockSentinel.released) {
      return true;
    }
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
    return true;
  } catch (err) {
    console.warn('Wake Lock request failed or denied:', err);
    return false;
  }
}

/**
 * Releases Screen Wake Lock
 */
export function disableScreenWakeLock() {
  isWakeLockRequested = false;
  if (wakeLockSentinel) {
    try {
      wakeLockSentinel.release();
    } catch {}
    wakeLockSentinel = null;
  }
}

/**
 * Re-acquires screen wake lock if visibility returns and it was active
 */
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && isWakeLockRequested) {
      await enableScreenWakeLock();
    }
  });
}

/**
 * Requests Notification permission so alarms trigger even if phone is in pocket/locked
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }
  try {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
  } catch {
    return false;
  }
  return false;
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function isNotificationGranted(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    Notification.permission === 'granted'
  );
}

/**
 * Sends a system push notification when timer finishes.
 * Uses ServiceWorkerRegistration.showNotification() which is REQUIRED on Android
 * to post system-level notifications that mirror to smartwatches (Honor Watch, Wear OS, etc.)
 */
export async function sendRestCompleteNotification(
  exerciseName?: string,
  targetEndTime?: number,
  shouldVibrate: boolean = true
) {
  if (targetEndTime && lastCompleteAlertTarget === targetEndTime) return;
  if (targetEndTime) lastCompleteAlertTarget = targetEndTime;

  const vibratePattern = [500, 120, 500, 120, 700, 150, 500, 120, 900, 150, 1200];

  // Trigger device vibration (Web Vibration API + Capacitor Haptics if available)
  if (shouldVibrate) {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(vibratePattern);
      } catch {}
    }
    try {
      const win = typeof window !== 'undefined' ? (window as any) : undefined;
      const capHaptics = win?.Capacitor?.Plugins?.Haptics || win?.Plugins?.Haptics;
      if (capHaptics && typeof capHaptics.vibrate === 'function') {
        void capHaptics.vibrate({ duration: 1000 });
      }
    } catch {}
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = '⏱️ ¡DESCANSO COMPLETADO! 🔥';
  const body = exerciseName
    ? `Fin de recuperación en ${exerciseName}. ¡A por la siguiente serie!`
    : '¡Tiempo de recuperación finalizado! Vuelve a la barra.';

  const tag = targetEndTime ? `lazcakon-rest-done-${targetEndTime}` : `lazcakon-rest-done-${Date.now()}`;

  const options: any = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    vibrate: vibratePattern,
    renotify: true,
    requireInteraction: true,
    silent: false,
    timestamp: Date.now(),
    data: { url: '/', time: Date.now() },
  };

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, options);
        return;
      }
    } catch (err) {
      console.warn('[LAZCAKONGYM] SW showNotification failed, using fallback:', err);
    }
  }

  try {
    new Notification(title, options);
  } catch (e) {
    console.warn('[LAZCAKONGYM] Window Notification constructor failed:', e);
  }
}

/**
 * Triggers a 5-second countdown vibration alert on the phone and connected smartwatch
 * when 5 seconds remain in the rest timer.
 */
export async function sendFiveSecondWarningNotification(
  exerciseName?: string,
  targetEndTime?: number
) {
  if (targetEndTime && lastFiveSecAlertTarget === targetEndTime) return;
  if (targetEndTime) lastFiveSecAlertTarget = targetEndTime;

  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate([300, 100, 300, 100, 500]);
    } catch {}
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const title = '⚡ ¡Quedan 5 segundos de descanso!';
  const body = exerciseName
    ? `Prepárate para tu siguiente serie en ${exerciseName}.`
    : 'Prepárate para iniciar tu siguiente serie.';

  const tag = targetEndTime ? `lazcakon-rest-5s-${targetEndTime}` : `lazcakon-rest-5s-${Date.now()}`;

  const options: any = {
    body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag,
    vibrate: [400, 120, 400, 120, 400],
    renotify: true,
    requireInteraction: true,
    silent: false,
    timestamp: Date.now(),
    data: { url: '/', time: Date.now(), type: 'countdown-5s' },
  };

  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && 'showNotification' in reg) {
        await reg.showNotification(title, options);
        return;
      }
    } catch {}
  }

  try {
    new Notification(title, options);
  } catch {}
}

/**
 * Triggers a test notification and vibration specifically for testing smartwatch connectivity
 */
export async function testWatchAlert(): Promise<{ success: boolean; message: string }> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      success: false,
      message: 'Las notificaciones no son compatibles con este navegador.',
    };
  }

  let permission = Notification.permission;
  if (permission !== 'granted') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return {
      success: false,
      message:
        'Permiso de notificaciones denegado. Actívalas en la configuración de tu navegador.',
    };
  }

  await sendRestCompleteNotification('Prueba de Reloj Honor / Smartwatch');
  return {
    success: true,
    message:
      '¡Alerta enviada! Revisa la vibración y notificación en tu Honor Watch y celular.',
  };
}
