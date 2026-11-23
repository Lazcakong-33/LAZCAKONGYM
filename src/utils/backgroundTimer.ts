/**
 * Background Timer, Screen Wake Lock & Service Worker Lock-Screen Smartwatch Alarm Utility
 * Ensures rest countdowns and smartwatch vibrations trigger accurately at 0s
 * even when the phone screen is turned off or locked, without duplicate alerts.
 */

import {
  REST_COMPLETE_VIBRATION_PATTERN,
  triggerNativeAndWebVibration,
} from './audio';
import {
  cancelNativeOngoingRestNotification,
  cancelNativeRestNotification,
  isCapacitorNativeRuntime,
  requestNativeNotificationPermission,
  sendNativeImmediateRestNotification,
  showOrUpdateNativeOngoingRestNotification,
} from './nativeNotifications';
import { formatRestDuration } from './restFormatter';
import type { ActiveWorkoutSession } from '../types';

// Web Worker instance for persistent background ticks
let workerInstance: Worker | null = null;
let activeWorkerUrl: string | null = null;
let currentTickCallback: (() => void) | null = null;
let fallbackIntervalId: number | null = null;

// Screen WakeLock sentinel to prevent mobile screen from sleeping during active workouts & rests
let wakeLockSentinel: any = null;
let isWakeLockRequested = false;

// Deduplication trackers by restId / targetEndTime so 5s and 0s alerts never fire twice
let lastFiveSecAlertTarget = 0;
let lastCompleteAlertKey = '';
const swFiredCompleteKeys = new Set<string>();
let swBridgeAttached = false;

function normalizeAlertKey(key?: string | number | null): string {
  if (key === undefined || key === null || key === '') return '';
  if (typeof key === 'number') {
    return Number.isFinite(key) && key > 0 ? `ts:${key}` : '';
  }
  const str = String(key).trim();
  if (!str) return '';
  return /^\d+$/.test(str) ? `ts:${str}` : `id:${str}`;
}

export function markCompleteAlertHandled(key?: string | number | null): void {
  const norm = normalizeAlertKey(key);
  if (!norm) return;
  lastCompleteAlertKey = norm;
  swFiredCompleteKeys.add(norm);
  if (swFiredCompleteKeys.size > 40) {
    const oldest = swFiredCompleteKeys.values().next().value;
    if (typeof oldest === 'string') swFiredCompleteKeys.delete(oldest);
  }
}

export function hasCompleteAlertFired(key?: string | number | null): boolean {
  const norm = normalizeAlertKey(key);
  if (!norm) return false;
  return lastCompleteAlertKey === norm || swFiredCompleteKeys.has(norm);
}

export function resetCompleteAlertTracking(key?: string | number | null): void {
  const norm = normalizeAlertKey(key);
  if (norm) {
    swFiredCompleteKeys.delete(norm);
    if (lastCompleteAlertKey === norm) {
      lastCompleteAlertKey = '';
    }
    return;
  }
  lastCompleteAlertKey = '';
  lastFiveSecAlertTarget = 0;
}

function ensureSwMessageBridge(): void {
  if (swBridgeAttached) return;
  if (
    typeof navigator === 'undefined' ||
    !('serviceWorker' in navigator) ||
    typeof navigator.serviceWorker?.addEventListener !== 'function'
  ) {
    return;
  }
  swBridgeAttached = true;
  navigator.serviceWorker.addEventListener('message', (event) => {
    const data = event?.data;
    if (!data) return;
    if (data.type === 'PUSH_REST_ALARM_RECEIVED' && !data.isTest) {
      if (data.restId) markCompleteAlertHandled(String(data.restId));
      if (data.targetEndTime) markCompleteAlertHandled(Number(data.targetEndTime));
    } else if (data.type === 'SW_REST_ALARM_FIRED') {
      if (data.restId) markCompleteAlertHandled(String(data.restId));
      if (data.targetEndTime) markCompleteAlertHandled(Number(data.targetEndTime));
    }
  });
}

async function getActiveServiceWorkerRegistration(
  timeoutMs = 1200
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    if (typeof navigator.serviceWorker.getRegistration === 'function') {
      const immediate = await navigator.serviceWorker.getRegistration();
      if (immediate?.active) return immediate;
    }
    const ready = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
    return ready || null;
  } catch {
    return null;
  }
}

async function postMessageToServiceWorker(payload: Record<string, unknown>): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  ensureSwMessageBridge();
  try {
    const controller = navigator.serviceWorker.controller;
    if (controller) {
      controller.postMessage(payload);
      return;
    }
    const reg = await getActiveServiceWorkerRegistration(1000);
    if (reg?.active) {
      reg.active.postMessage(payload);
    }
  } catch (e) {
    console.warn('[LAZCAKONGYM] Failed to post message to SW:', e);
  }
}

/**
 * Schedules a local Service Worker background timer fallback for brief screen locks.
 */
export async function scheduleServiceWorkerRestAlarm(
  targetEndTime: number,
  exerciseName?: string,
  options?: {
    soundEnabled?: boolean;
    vibrationEnabled?: boolean;
    restEndAlertEnabled?: boolean;
    nextSetNumber?: number;
    restId?: string;
    mode?: string;
  }
): Promise<void> {
  if (!targetEndTime) return;
  ensureSwMessageBridge();
  await postMessageToServiceWorker({
    type: 'SCHEDULE_SW_REST_ALARM',
    targetEndTime,
    exerciseName: exerciseName || '',
    nextSetNumber: options?.nextSetNumber || null,
    vibrationEnabled: options?.vibrationEnabled !== false,
    mode: options?.mode || (options?.soundEnabled ? 'sound' : 'vibrate_only'),
    restId: options?.restId || '',
  });
}

/**
 * Tells the Service Worker the foreground page already emitted the 0s alert
 * for restId / targetEndTime so Web Push avoids duplicating the OS popup.
 */
export async function notifyServiceWorkerRestAlarmHandled(
  targetEndTime?: number,
  restId?: string
): Promise<void> {
  if (!targetEndTime && !restId) return;
  await postMessageToServiceWorker({
    type: 'REST_ALARM_HANDLED',
    ...(targetEndTime ? { targetEndTime } : {}),
    ...(restId ? { restId } : {}),
  });
}

/**
 * Marks the restId / targetEndTime cancelled in the Service Worker and closes
 * any stale rest notifications when the athlete skips, pauses, restarts, or cancels.
 * When `preserveOngoing` is true (e.g., adjusting +/-15s), keeps the active ongoing
 * notification in place so it can be updated seamlessly without flicker.
 */
export async function cancelServiceWorkerRestAlarm(
  targetEndTime?: number,
  restId?: string,
  options?: { preserveOngoing?: boolean }
): Promise<void> {
  const preserveOngoing = Boolean(options?.preserveOngoing);
  await cancelNativeRestNotification(restId, targetEndTime, { preserveOngoing });
  await postMessageToServiceWorker({
    type: 'CANCEL_REST_ALARM',
    preserveOngoing,
    ...(targetEndTime ? { targetEndTime } : {}),
    ...(restId ? { restId } : {}),
  });
  if (preserveOngoing) {
    if (restId) {
      await clearActiveRestNotifications(`lazcakon-rest-done-${restId}`);
    } else {
      await clearRestCompleteNotifications();
    }
  } else {
    if (restId) {
      await clearActiveRestNotifications(`lazcakon-rest-done-${restId}`);
    }
    await clearActiveRestNotifications(REST_ACTIVE_NOTIFICATION_TAG);
    if (!restId) {
      await clearActiveRestNotifications();
    }
  }
}

export async function clearRestCompleteNotifications(): Promise<void> {
  try {
    const reg = await getActiveServiceWorkerRegistration(600);
    if (reg && typeof reg.getNotifications === 'function') {
      const list = await reg.getNotifications();
      for (const n of list) {
        if (n.tag && n.tag.startsWith('lazcakon-rest-done-')) {
          n.close();
        }
      }
    }
  } catch {}
}

export async function clearActiveRestNotifications(specificTag?: string): Promise<void> {
  try {
    const reg = await getActiveServiceWorkerRegistration(600);
    if (reg && typeof reg.getNotifications === 'function') {
      const list = await reg.getNotifications();
      for (const n of list) {
        if (!n.tag) continue;
        if (specificTag ? n.tag === specificTag : n.tag.startsWith('lazcakon-rest-')) {
          n.close();
        }
      }
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
      activeWorkerUrl = workerUrl;
      workerInstance = new Worker(workerUrl);

      workerInstance.onmessage = (event) => {
        if (event.data?.type === 'tick' && currentTickCallback) {
          currentTickCallback();
        }
      };

      workerInstance.postMessage({ command: 'start', interval: intervalMs });
      return;
    } catch (e) {
      if (activeWorkerUrl) {
        try {
          URL.revokeObjectURL(activeWorkerUrl);
        } catch {}
        activeWorkerUrl = null;
      }
      console.warn('Web Worker timer not available, falling back to interval:', e);
    }
  }

  // Fallback to standard window interval
  fallbackIntervalId = window.setInterval(() => {
    if (currentTickCallback) currentTickCallback();
  }, intervalMs);
}

/**
 * Stops the background worker timer and releases Blob URL resources
 */
export function stopBackgroundTicker() {
  if (workerInstance) {
    try {
      workerInstance.postMessage({ command: 'stop' });
      workerInstance.terminate();
    } catch {}
    workerInstance = null;
  }
  if (activeWorkerUrl) {
    try {
      URL.revokeObjectURL(activeWorkerUrl);
    } catch {}
    activeWorkerUrl = null;
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

export const REST_ACTIVE_NOTIFICATION_TAG = 'lazcakon-rest-active';
export const REST_COMPLETE_NOTIFICATION_TITLE = 'LAZCAKONG · DESCANSO TERMINADO';
export const REST_COMPLETE_NOTIFICATION_ICON_PATH = '/notification-icon-192.png';
export const REST_COMPLETE_NOTIFICATION_BADGE_PATH = '/notification-badge-gorilla.png';

/**
 * Formats an epoch timestamp using the device's local clock in 24-hour HH:MM:SS format
 * (e.g., "11:42:30") so the athlete can check exact rest end time from the shade or lock screen.
 */
export function formatLocalRestEndTime(targetEndTime: number, locale?: string): string {
  const date = new Date(targetEndTime);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  try {
    const formatted = new Intl.DateTimeFormat(locale || undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(date);
    // Normalize midnight "24:xx:xx" produced by some ICU locales to "00:xx:xx"
    return formatted.replace(/^24:/, '00:');
  } catch {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
}

export function buildActiveRestNotificationContent(params: {
  durationSeconds: number;
  targetEndTime: number;
  exerciseName?: string;
  nextSetNumber?: number;
  locale?: string;
}): {
  title: string;
  body: string;
  shortText: string;
  durationText: string;
  endTimeText: string;
} {
  const safeSeconds = Math.max(1, Math.round(params.durationSeconds));
  const durationText = formatRestDuration(safeSeconds);
  const endTimeText = formatLocalRestEndTime(params.targetEndTime, params.locale);
  const title = `LazcaKong Gym · Descanso de ${durationText}`;

  const cleanExercise = params.exerciseName?.trim() || '';
  const hasValidSet =
    typeof params.nextSetNumber === 'number' &&
    Number.isFinite(params.nextSetNumber) &&
    params.nextSetNumber > 0;

  let body = `Próxima serie a las ${endTimeText}`;
  if (cleanExercise && hasValidSet) {
    body = `Próxima serie a las ${endTimeText} · ${cleanExercise} (Serie ${params.nextSetNumber})`;
  } else if (cleanExercise) {
    body = `Próxima serie a las ${endTimeText} · ${cleanExercise}`;
  }

  return {
    title,
    body,
    shortText: 'Descanso',
    durationText,
    endTimeText,
  };
}

/**
 * Resolves a static notification asset path against the active page origin
 * so browsers and companion smartwatch bridges receive an explicit HTTPS URL
 * (falls back to the relative path in non-HTTP/test environments).
 */
export function resolveNotificationAssetUrl(assetPath: string): string {
  const cleanPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  if (typeof window !== 'undefined' && window.location?.origin) {
    const origin = window.location.origin;
    if (/^https?:\/\//i.test(origin)) {
      try {
        return new URL(cleanPath, origin).href;
      } catch {
        return `${origin.replace(/\/$/, '')}${cleanPath}`;
      }
    }
  }
  return cleanPath;
}

function normalizeExerciseMatchText(value?: string): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveNextRestTargetContext(
  session: ActiveWorkoutSession | null | undefined,
  preferredExerciseName?: string,
  explicitNextSetNumber?: number
): { exerciseName?: string; nextSetNumber?: number } {
  if (!session || !Array.isArray(session.exercises) || session.exercises.length === 0) {
    return {};
  }

  const normPref = normalizeExerciseMatchText(preferredExerciseName);
  const matchedEx = normPref
    ? session.exercises.find(
        (ex) =>
          normalizeExerciseMatchText(ex.activeExerciseName) === normPref ||
          normalizeExerciseMatchText(ex.exerciseName) === normPref
      )
    : undefined;

  if (matchedEx) {
    const nextSet = matchedEx.sets.find((s) => !s.completed);
    if (nextSet) {
      return {
        exerciseName: matchedEx.activeExerciseName || matchedEx.exerciseName,
        nextSetNumber:
          typeof explicitNextSetNumber === 'number' && explicitNextSetNumber > 0
            ? explicitNextSetNumber
            : nextSet.setNumber,
      };
    }
  }

  for (const ex of session.exercises) {
    const nextSet = ex.sets.find((s) => !s.completed);
    if (nextSet) {
      return {
        exerciseName: ex.activeExerciseName || ex.exerciseName,
        nextSetNumber: nextSet.setNumber,
      };
    }
  }

  return {};
}

export function buildRestCompleteNotificationBody(
  exerciseName?: string,
  nextSetNumber?: number
): string {
  if (
    exerciseName &&
    exerciseName.trim().length > 0 &&
    typeof nextSetNumber === 'number' &&
    Number.isFinite(nextSetNumber) &&
    nextSetNumber > 0
  ) {
    return `Siguiente serie: ${exerciseName.trim()} · Serie ${nextSetNumber}`;
  }
  return 'Descanso finalizado. Continúa tu entrenamiento.';
}

export function getNotificationPermissionStatus(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

/**
 * Requests Notification permission ONLY when invoked via an explicit athlete action.
 */
export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (isCapacitorNativeRuntime()) {
    return await requestNativeNotificationPermission();
  }
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission !== 'denied') {
      return await Notification.requestPermission();
    }
    return Notification.permission;
  } catch {
    return Notification.permission || 'default';
  }
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
 * Displays or updates the single active-rest notification:
 * - On native Android (Capacitor): uses the native system chronometer countdown
 *   (setUsesChronometer + setChronometerCountDown + setWhen + lockscreen public + Android 16 promoted chip).
 * - On Chrome / PWA: posts ONE silent notification with duration and local end time
 *   ("LazcaKong Gym · Descanso de 2 min 30 s" / "Próxima serie a las 11:42:30") using fixed tag
 *   `lazcakon-rest-active`, never spamming per second and never requesting permission implicitly.
 */
export async function showOrUpdateActiveRestNotification(params: {
  targetEndTime: number;
  durationSeconds: number;
  totalSeconds?: number;
  restId?: string;
  exerciseName?: string;
  nextSetNumber?: number;
  mode?: 'sound' | 'vibrate_only' | 'silent';
  restEndAlertEnabled?: boolean;
  locale?: string;
}): Promise<boolean> {
  if (!params.targetEndTime || params.targetEndTime <= Date.now()) return false;

  const content = buildActiveRestNotificationContent({
    durationSeconds: params.durationSeconds,
    targetEndTime: params.targetEndTime,
    exerciseName: params.exerciseName,
    nextSetNumber: params.nextSetNumber,
    locale: params.locale,
  });

  if (isCapacitorNativeRuntime()) {
    return await showOrUpdateNativeOngoingRestNotification({
      targetEndTime: params.targetEndTime,
      totalSeconds: params.totalSeconds ?? params.durationSeconds,
      title: content.title,
      body: content.body,
      shortText: content.shortText,
      restId: params.restId,
      exerciseName: params.exerciseName,
      nextSetNumber: params.nextSetNumber,
      mode: params.mode,
      restEndAlertEnabled: params.restEndAlertEnabled,
    });
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const iconUrl = resolveNotificationAssetUrl(REST_COMPLETE_NOTIFICATION_ICON_PATH);
  const badgeUrl = resolveNotificationAssetUrl(REST_COMPLETE_NOTIFICATION_BADGE_PATH);
  const options: any = {
    body: content.body,
    icon: iconUrl,
    badge: badgeUrl,
    tag: REST_ACTIVE_NOTIFICATION_TAG,
    renotify: false,
    requireInteraction: false,
    silent: true,
    timestamp: params.targetEndTime,
    data: {
      url: '/?openActiveWorkout=1',
      action: 'open-active-workout',
      type: 'rest-active',
      restId: params.restId || '',
      targetEndTime: params.targetEndTime,
    },
  };

  const reg = await getActiveServiceWorkerRegistration(1200);
  if (reg && 'showNotification' in reg) {
    try {
      await reg.showNotification(content.title, options);
      return true;
    } catch (err) {
      console.warn('[LAZCAKONGYM] SW active rest showNotification failed, using fallback:', err);
    }
  }

  try {
    new Notification(content.title, options);
    return true;
  } catch (e) {
    console.warn('[LAZCAKONGYM] Window active rest Notification failed:', e);
    return false;
  }
}

export async function dismissActiveRestNotification(): Promise<void> {
  await cancelNativeOngoingRestNotification({ preserveStore: true });
  await clearActiveRestNotifications(REST_ACTIVE_NOTIFICATION_TAG);
}

/**
 * Sends a single system notification and vibration alert when timer finishes.
 * Uses ServiceWorkerRegistration.showNotification() when available so Android
 * smartwatches (Honor Watch, Wear OS, etc.) mirror the alert without duplicating SW timers.
 */
export async function sendRestCompleteNotification(
  exerciseName?: string,
  targetEndTime?: number,
  shouldVibrate: boolean = true,
  shouldAllowOsAlert: boolean = false,
  nextSetNumber?: number,
  restId?: string
) {
  ensureSwMessageBridge();

  if ((restId && hasCompleteAlertFired(restId)) || (targetEndTime && hasCompleteAlertFired(targetEndTime))) {
    await dismissActiveRestNotification();
    return;
  }
  if (restId) markCompleteAlertHandled(restId);
  if (targetEndTime) markCompleteAlertHandled(targetEndTime);
  if (restId || targetEndTime) {
    void notifyServiceWorkerRestAlarmHandled(targetEndTime, restId);
  }

  // Always dismiss the ongoing rest notification before emitting the single "Descanso terminado" notice
  await dismissActiveRestNotification();

  // Trigger device vibration once directly without touching audio
  if (shouldVibrate) {
    void triggerNativeAndWebVibration(REST_COMPLETE_VIBRATION_PATTERN);
  }

  const title = REST_COMPLETE_NOTIFICATION_TITLE;
  const body = buildRestCompleteNotificationBody(exerciseName, nextSetNumber);

  if (isCapacitorNativeRuntime()) {
    await sendNativeImmediateRestNotification({
      title,
      body,
      restId,
      targetEndTime,
      exerciseName,
      nextSetNumber,
      mode: shouldAllowOsAlert ? 'sound' : shouldVibrate ? 'vibrate_only' : 'silent',
      restEndAlertEnabled: true,
    });
    return;
  }

  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  const tag = restId
    ? `lazcakon-rest-done-${restId}`
    : targetEndTime
    ? `lazcakon-rest-done-${targetEndTime}`
    : `lazcakon-rest-done-${Date.now()}`;

  // Note: Chromium forbids combining `silent: true` with `vibrate`, so omit `vibrate` when `silent: true`.
  const isSilentNotification = !shouldAllowOsAlert;
  const iconUrl = resolveNotificationAssetUrl(REST_COMPLETE_NOTIFICATION_ICON_PATH);
  const badgeUrl = resolveNotificationAssetUrl(REST_COMPLETE_NOTIFICATION_BADGE_PATH);
  const options: any = {
    body,
    icon: iconUrl,
    badge: badgeUrl,
    tag,
    renotify: true,
    requireInteraction: true,
    silent: isSilentNotification,
    ...(isSilentNotification || !shouldVibrate ? {} : { vibrate: REST_COMPLETE_VIBRATION_PATTERN }),
    timestamp: Date.now(),
    data: {
      url: '/?openActiveWorkout=1',
      action: 'open-active-workout',
      time: Date.now(),
      type: 'rest-complete',
      ...(restId ? { restId } : {}),
    },
  };

  const reg = await getActiveServiceWorkerRegistration(1200);
  if (reg && 'showNotification' in reg) {
    try {
      await reg.showNotification(title, options);
      return;
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
 * Triggers a 5-second countdown alert on the phone and connected smartwatch
 * (invoked only in "Pitido final" mode, never in "Solo vibración" or "Silencio").
 */
export async function sendFiveSecondWarningNotification(
  exerciseName?: string,
  targetEndTime?: number,
  shouldVibrate: boolean = true,
  shouldAllowOsAlert: boolean = false
) {
  if (targetEndTime && lastFiveSecAlertTarget === targetEndTime) return;
  if (targetEndTime) lastFiveSecAlertTarget = targetEndTime;

  if (shouldVibrate && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    try {
      navigator.vibrate([300, 100, 300, 100, 500]);
    } catch {}
  }


}

/**
 * Triggers an explicit test notification and vibration for verifying smartwatch reception.
 * Never invents exercise or set data when no active session exists.
 */
export async function testWatchAlert(options?: {
  exerciseName?: string;
  nextSetNumber?: number;
  vibrationEnabled?: boolean;
}): Promise<{ success: boolean; permission: NotificationPermission | 'unsupported'; message: string }> {
  const nativeCap = isCapacitorNativeRuntime();
  if (!nativeCap && (typeof window === 'undefined' || !('Notification' in window))) {
    return {
      success: false,
      permission: 'unsupported',
      message: 'Las notificaciones del sistema no son compatibles con este navegador.',
    };
  }

  const permission = await requestNotificationPermission();

  if (permission !== 'granted') {
    return {
      success: false,
      permission,
      message:
        permission === 'denied'
          ? 'Permiso de notificaciones bloqueado. Habilítalo en los ajustes de la aplicación en tu teléfono.'
          : 'Permiso de notificaciones pendiente. Acéptalo para recibir el aviso en el celular y el reloj.',
    };
  }

  const vibOn = options?.vibrationEnabled !== false;
  await sendRestCompleteNotification(
    options?.exerciseName,
    undefined,
    vibOn,
    true,
    options?.nextSetNumber
  );

  return {
    success: true,
    permission,
    message: nativeCap
      ? 'Notificación nativa de prueba enviada mediante @capacitor/local-notifications y vibración háptica.'
      : 'Aviso de prueba enviado con el logo oficial de LazcaKong Gym y badge monocromático de gorila. Lo que muestre el reloj Honor depende de cómo Android, Chrome y Honor Salud reflejen la notificación (el reloj puede mostrar el icono del navegador).',
  };
}
