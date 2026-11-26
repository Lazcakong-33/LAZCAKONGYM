import { detectRuntimePlatform } from './capacitorPlatform.ts';

export const REST_SOUND_CHANNEL_ID = 'lazcakong_rest_finish_alarm_v3';
export const REST_VIBRATE_CHANNEL_ID = 'lazcakong_rest_finish_vibrate_v2';
export const REST_SILENT_CHANNEL_ID = 'lazcakong_rest_finish_silent_v2';
export const REST_LIVE_COUNTDOWN_CHANNEL_ID = 'lazcakong_rest_chronometer_v2';
export const OPEN_ACTIVE_WORKOUT_EVENT = 'lazcakong:open-active-workout';
export const NATIVE_REST_STATE_SYNC_EVENT = 'lazcakong:native-rest-sync';
export const NATIVE_REST_PERMISSION_NEEDED_EVENT = 'lazcakong:native-rest-permission-needed';

export type RestAlertMode = 'sound' | 'vibrate_only' | 'silent';

export interface NativeRestTimerCapabilities {
  sdkInt: number;
  release?: string;
  manufacturer?: string;
  model?: string;
  notificationsEnabled: boolean;
  osNotificationsEnabled?: boolean;
  postNotificationsGranted?: boolean;
  ongoingChannelId?: string;
  ongoingChannelEnabled?: boolean;
  ongoingChannelImportance?: number;
  ongoingChannelLockscreenVisibility?: number;
  finishChannelId?: string;
  finishChannelEnabled?: boolean;
  finishChannelImportance?: number;
  lockScreenSystemEnabled?: boolean;
  supportsChronometerCountdown: boolean;
  supportsPromotedOngoing: boolean;
  canPostPromoted: boolean;
  hasPromotableCharacteristics?: boolean;
  canScheduleExactAlarms?: boolean;
  canUseFullScreenIntent?: boolean;
  ignoringBatteryOptimizations?: boolean;
  magicOsStartupAvailable?: boolean;
  capacitorPermissionState?: string;
}

export interface NativeRestStateSnapshot {
  active: boolean;
  paused: boolean;
  restId: string;
  targetEndTime: number;
  totalSeconds: number;
  remainingSeconds: number;
  exerciseName: string;
  nextSetNumber: number;
  mode: RestAlertMode;
  restEndAlertEnabled: boolean;
  lastFiredRestId?: string;
  lastFiredTargetEndTime?: number;
  pendingAction?: '' | 'paused' | 'resumed' | 'adjusted' | 'skipped' | 'completed';
  pendingActionAt?: number;
  updatedAt?: number;
}

export type NativeRestSettingsScreen =
  | 'notifications'
  | 'channel'
  | 'exact_alarms'
  | 'battery'
  | 'fullscreen_intent'
  | 'magicos_autostart';

interface RestTimerNotificationPluginBridge {
  startOrUpdate(options: {
    targetEndTime: number;
    totalSeconds?: number;
    title?: string;
    body?: string;
    shortText?: string;
    restId?: string;
    exerciseName?: string;
    nextSetNumber?: number;
    mode?: RestAlertMode;
    restEndAlertEnabled?: boolean;
  }): Promise<{
    shown: boolean;
    reason?: string;
    notificationId?: number;
    targetEndTime?: number;
    exactAlarmScheduled?: boolean;
    promotedRequested?: boolean;
    canPostPromoted?: boolean;
    hasPromotableCharacteristics?: boolean;
    canScheduleExactAlarms?: boolean;
    canUseFullScreenIntent?: boolean;
  }>;
  pauseOngoing(options: {
    remainingSeconds: number;
    totalSeconds: number;
    exerciseName?: string;
    nextSetNumber?: number;
    mode?: RestAlertMode;
    restEndAlertEnabled?: boolean;
    title?: string;
    body?: string;
  }): Promise<{ paused: boolean; shown: boolean; remainingSeconds: number }>;
  cancelOngoing(options?: { preserveStore?: boolean }): Promise<{ cancelled: boolean }>;
  cancelAllRest(): Promise<{ cancelled: boolean }>;
  markCompletedFromApp(options: {
    restId?: string;
    targetEndTime?: number;
    exerciseName?: string;
    nextSetNumber?: number;
    mode?: RestAlertMode;
    restEndAlertEnabled?: boolean;
  }): Promise<{ completed: boolean }>;
  getNativeState(): Promise<NativeRestStateSnapshot>;
  consumePendingNativeSync(): Promise<NativeRestStateSnapshot>;
  requestPermission(): Promise<NativeRestTimerCapabilities>;
  getCapabilities(): Promise<NativeRestTimerCapabilities>;
  openNotificationSettings(): Promise<{ opened: boolean }>;
  openChannelSettings(options?: { channelId?: string }): Promise<{ opened: boolean }>;
  openExactAlarmSettings(): Promise<{ opened: boolean }>;
  openBatteryOptimizationSettings(): Promise<{ opened: boolean }>;
  openFullScreenIntentSettings(): Promise<{ opened: boolean }>;
  openMagicOsAutostartSettings(): Promise<{ opened: boolean; usedVendorScreen?: boolean }>;
  consumePendingOpenActiveWorkout(): Promise<{ shouldOpen: boolean; restId?: string }>;
  addListener(
    eventName: 'openActiveWorkout',
    listenerFunc: (data: { openActiveWorkout?: boolean; restId?: string }) => void
  ): Promise<{ remove: () => Promise<void> }>;
  addListener(
    eventName: 'restTimerStateSynced',
    listenerFunc: (data: NativeRestStateSnapshot) => void
  ): Promise<{ remove: () => Promise<void> }>;
}

let nativeShellInitialized = false;
let channelsCreated = false;
let restTimerPluginPromise: Promise<RestTimerNotificationPluginBridge | null> | null = null;

async function getRestTimerNotificationPlugin(): Promise<RestTimerNotificationPluginBridge | null> {
  if (!isCapacitorNativeRuntime()) return null;
  if (detectRuntimePlatform().platform !== 'capacitor_android') return null;
  const injected =
    typeof window !== 'undefined'
      ? (window as any)?.Capacitor?.Plugins?.RestTimerNotification
      : null;
  if (injected && typeof injected.startOrUpdate === 'function') {
    return injected as RestTimerNotificationPluginBridge;
  }
  if (!restTimerPluginPromise) {
    restTimerPluginPromise = import('@capacitor/core')
      .then(({ registerPlugin }) =>
        registerPlugin<RestTimerNotificationPluginBridge>('RestTimerNotification')
      )
      .catch(() => null);
  }
  return await restTimerPluginPromise;
}

function dispatchOpenActiveWorkoutEvent(detail?: { restId?: string; source?: string }): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(OPEN_ACTIVE_WORKOUT_EVENT, { detail: detail || {} }));
  } catch {}
}

function dispatchNativeRestSyncEvent(snapshot: NativeRestStateSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(NATIVE_REST_STATE_SYNC_EVENT, { detail: snapshot }));
  } catch {}
}

function dispatchNativePermissionNeededEvent(reason: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent(NATIVE_REST_PERMISSION_NEEDED_EVENT, { detail: { reason } })
    );
  } catch {}
}

export function isCapacitorNativeRuntime(): boolean {
  try {
    return detectRuntimePlatform().isCapacitorNative;
  } catch {
    return false;
  }
}

export function isCapacitorAndroidRuntime(): boolean {
  try {
    return detectRuntimePlatform().platform === 'capacitor_android';
  } catch {
    return false;
  }
}

export function computeNativeNotificationId(key?: string | number | null): number {
  const raw = String(key ?? Date.now());
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 100000 + (Math.abs(hash) % 2140000000);
}

function getChannelForMode(mode?: RestAlertMode): string {
  if (mode === 'silent') return REST_SILENT_CHANNEL_ID;
  if (mode === 'vibrate_only') return REST_VIBRATE_CHANNEL_ID;
  return REST_SOUND_CHANNEL_ID;
}

async function ensureAndroidNotificationChannels(): Promise<void> {
  if (channelsCreated || !isCapacitorNativeRuntime()) return;
  try {
    if (detectRuntimePlatform().platform !== 'capacitor_android') {
      channelsCreated = true;
      return;
    }
    // Native RestTimerNotificationHelper.ensureChannels creates the canonical Android channels;
    // invoking getCapabilities() ensures they exist without going through LocalNotifications VISIBILITY_PRIVATE.
    const plugin = await getRestTimerNotificationPlugin();
    if (plugin && typeof plugin.getCapabilities === 'function') {
      await plugin.getCapabilities().catch(() => null);
      channelsCreated = true;
      return;
    }

    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.createChannel({
      id: REST_SOUND_CHANNEL_ID,
      name: 'Fin de descanso (Alerta con sonido)',
      description: 'Alerta prioritaria con sonido, vibración y aviso visual al terminar el descanso',
      importance: 5,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#CCFF00',
    });
    channelsCreated = true;
  } catch {
    // Non-fatal in non-Android environments
  }
}

export async function getNativeNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isCapacitorNativeRuntime()) {
    return typeof window !== 'undefined' && 'Notification' in window
      ? Notification.permission
      : 'unsupported';
  }
  try {
    if (isCapacitorAndroidRuntime()) {
      const plugin = await getRestTimerNotificationPlugin();
      if (plugin && typeof plugin.getCapabilities === 'function') {
        const caps = await plugin.getCapabilities();
        if (caps?.notificationsEnabled) return 'granted';
      }
    }
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return 'granted';
    if (perm.display === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'unsupported';
  }
}

export async function requestNativeNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!isCapacitorNativeRuntime()) {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    return await Notification.requestPermission();
  }
  try {
    if (isCapacitorAndroidRuntime()) {
      const plugin = await getRestTimerNotificationPlugin();
      if (plugin && typeof plugin.requestPermission === 'function') {
        const caps = await plugin.requestPermission();
        if (caps?.notificationsEnabled) return 'granted';
      }
    }
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await ensureAndroidNotificationChannels();
    const res = await LocalNotifications.requestPermissions();
    if (res.display === 'granted') return 'granted';
    if (res.display === 'denied') return 'denied';
    return 'default';
  } catch {
    return 'unsupported';
  }
}

export async function scheduleNativeRestNotification(params: {
  targetEndTime: number;
  restId?: string;
  exerciseName?: string;
  nextSetNumber?: number;
  mode: RestAlertMode;
  restEndAlertEnabled?: boolean;
}): Promise<boolean> {
  if (!isCapacitorNativeRuntime()) return false;
  if (!params.targetEndTime || params.targetEndTime <= Date.now()) return false;

  // On Android, RestTimerNotificationPlugin.startOrUpdate already owns the exact AlarmManager
  // schedule (RestAlarmReceiver + RestCompleteLockActivity + VISIBILITY_PUBLIC) cleanly.
  // Never double-schedule through @capacitor/local-notifications (which hardcodes VISIBILITY_PRIVATE).
  if (isCapacitorAndroidRuntime()) {
    try {
      const plugin = await getRestTimerNotificationPlugin();
      if (plugin && typeof plugin.getCapabilities === 'function') {
        const caps = await plugin.getCapabilities();
        return Boolean(caps?.notificationsEnabled);
      }
    } catch {
      return false;
    }
    return true;
  }

  if (params.restEndAlertEnabled === false) return false;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await ensureAndroidNotificationChannels();

    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      return false;
    }

    const id = computeNativeNotificationId(params.restId || params.targetEndTime);
    const body =
      params.exerciseName && params.exerciseName.trim() && params.nextSetNumber
        ? `Siguiente serie: ${params.exerciseName.trim()} · Serie ${params.nextSetNumber}`
        : 'Descanso finalizado. Continúa tu entrenamiento.';

    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title: 'LAZCAKONG · DESCANSO TERMINADO',
          body,
          schedule: {
            at: new Date(params.targetEndTime),
            allowWhileIdle: true,
          },
          channelId: getChannelForMode(params.mode),
          smallIcon: 'ic_stat_lazcakong',
          iconColor: '#CCFF00',
          extra: {
            type: 'rest-complete',
            restId: params.restId || '',
            targetEndTime: params.targetEndTime,
          },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

export async function showOrUpdateNativeOngoingRestNotification(params: {
  targetEndTime: number;
  totalSeconds?: number;
  title: string;
  body: string;
  shortText?: string;
  restId?: string;
  exerciseName?: string;
  nextSetNumber?: number;
  mode?: RestAlertMode;
  restEndAlertEnabled?: boolean;
}): Promise<boolean> {
  if (!isCapacitorNativeRuntime()) return false;
  if (!params.targetEndTime || params.targetEndTime <= Date.now()) return false;
  if (!isCapacitorAndroidRuntime()) return false;

  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (!plugin) return false;
    const res = await plugin.startOrUpdate({
      targetEndTime: params.targetEndTime,
      totalSeconds: params.totalSeconds,
      title: params.title,
      body: params.body,
      shortText: params.shortText || 'Descanso',
      restId: params.restId || '',
      exerciseName: params.exerciseName || '',
      nextSetNumber: params.nextSetNumber || 0,
      mode: params.mode || 'sound',
      restEndAlertEnabled: params.restEndAlertEnabled !== false,
    });
    if (!res?.shown && res?.reason === 'permission_denied') {
      dispatchNativePermissionNeededEvent('permission_denied');
    }
    return Boolean(res?.shown);
  } catch {
    return false;
  }
}

export async function pauseNativeOngoingRestNotification(params: {
  remainingSeconds: number;
  totalSeconds: number;
  exerciseName?: string;
  nextSetNumber?: number;
  mode?: RestAlertMode;
  restEndAlertEnabled?: boolean;
}): Promise<boolean> {
  if (!isCapacitorAndroidRuntime()) return false;
  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (!plugin || typeof plugin.pauseOngoing !== 'function') return false;
    const res = await plugin.pauseOngoing({
      remainingSeconds: Math.max(1, Math.round(params.remainingSeconds)),
      totalSeconds: Math.max(1, Math.round(params.totalSeconds)),
      exerciseName: params.exerciseName || '',
      nextSetNumber: params.nextSetNumber || 0,
      mode: params.mode || 'sound',
      restEndAlertEnabled: params.restEndAlertEnabled !== false,
    });
    return Boolean(res?.shown);
  } catch {
    return false;
  }
}

export async function cancelNativeOngoingRestNotification(options?: {
  preserveStore?: boolean;
}): Promise<void> {
  if (!isCapacitorAndroidRuntime()) return;
  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (plugin) {
      await plugin.cancelOngoing(options?.preserveStore ? { preserveStore: true } : undefined);
    }
  } catch {}
}

export async function markNativeRestCompleted(params: {
  restId?: string;
  targetEndTime?: number;
  exerciseName?: string;
  nextSetNumber?: number;
  mode?: RestAlertMode;
  restEndAlertEnabled?: boolean;
}): Promise<boolean> {
  if (!isCapacitorAndroidRuntime()) return false;
  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (!plugin || typeof plugin.markCompletedFromApp !== 'function') return false;
    const res = await plugin.markCompletedFromApp({
      restId: params.restId || '',
      targetEndTime: params.targetEndTime || 0,
      exerciseName: params.exerciseName || '',
      nextSetNumber: params.nextSetNumber || 0,
      mode: params.mode || 'sound',
      restEndAlertEnabled: params.restEndAlertEnabled !== false,
    });
    return Boolean(res?.completed);
  } catch {
    return false;
  }
}

export async function getNativeRestState(): Promise<NativeRestStateSnapshot | null> {
  if (!isCapacitorAndroidRuntime()) return null;
  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (!plugin || typeof plugin.getNativeState !== 'function') return null;
    return await plugin.getNativeState();
  } catch {
    return null;
  }
}

export async function consumePendingNativeRestSync(): Promise<NativeRestStateSnapshot | null> {
  if (!isCapacitorAndroidRuntime()) return null;
  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (!plugin || typeof plugin.consumePendingNativeSync !== 'function') return null;
    return await plugin.consumePendingNativeSync();
  } catch {
    return null;
  }
}

export async function getNativeRestTimerCapabilities(): Promise<NativeRestTimerCapabilities | null> {
  if (!isCapacitorAndroidRuntime()) return null;
  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (!plugin || typeof plugin.getCapabilities !== 'function') return null;
    return await plugin.getCapabilities();
  } catch {
    return null;
  }
}

export async function openNativeRestSettingScreen(
  screen: NativeRestSettingsScreen,
  channelId?: string
): Promise<{ opened: boolean; usedVendorScreen?: boolean }> {
  if (!isCapacitorAndroidRuntime()) return { opened: false };
  try {
    const plugin = await getRestTimerNotificationPlugin();
    if (!plugin) return { opened: false };
    switch (screen) {
      case 'notifications':
        return await plugin.openNotificationSettings();
      case 'channel':
        return await plugin.openChannelSettings({ channelId: channelId || REST_LIVE_COUNTDOWN_CHANNEL_ID });
      case 'exact_alarms':
        return await plugin.openExactAlarmSettings();
      case 'battery':
        return await plugin.openBatteryOptimizationSettings();
      case 'fullscreen_intent':
        return await plugin.openFullScreenIntentSettings();
      case 'magicos_autostart':
        return await plugin.openMagicOsAutostartSettings();
      default:
        return { opened: false };
    }
  } catch {
    return { opened: false };
  }
}

export async function cancelNativeRestNotification(
  restId?: string,
  targetEndTime?: number,
  options?: { preserveOngoing?: boolean }
): Promise<void> {
  if (!isCapacitorNativeRuntime()) return;
  if (isCapacitorAndroidRuntime()) {
    try {
      const plugin = await getRestTimerNotificationPlugin();
      if (plugin) {
        if (options?.preserveOngoing) {
          // Next startOrUpdate call replaces the notification & AlarmManager seamlessly.
        } else if (typeof plugin.cancelAllRest === 'function') {
          await plugin.cancelAllRest();
        } else {
          await plugin.cancelOngoing();
        }
      }
    } catch {}
  }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const ids = new Set<number>();
    if (restId) ids.add(computeNativeNotificationId(restId));
    if (targetEndTime) ids.add(computeNativeNotificationId(targetEndTime));

    const pending = await LocalNotifications.getPending().catch(() => ({ notifications: [] }));
    for (const item of pending.notifications || []) {
      const extra: any = (item as any)?.extra;
      if (
        ids.has(item.id) ||
        (extra?.type === 'rest-complete' && (!restId && !targetEndTime))
      ) {
        ids.add(item.id);
      }
    }

    if (ids.size > 0) {
      await LocalNotifications.cancel({
        notifications: Array.from(ids).map((id) => ({ id })),
      });
    }
  } catch {}
}

export async function sendNativeImmediateRestNotification(params: {
  title: string;
  body: string;
  restId?: string;
  targetEndTime?: number;
  exerciseName?: string;
  nextSetNumber?: number;
  mode?: RestAlertMode;
  restEndAlertEnabled?: boolean;
}): Promise<boolean> {
  if (!isCapacitorNativeRuntime()) return false;
  if (isCapacitorAndroidRuntime()) {
    return await markNativeRestCompleted({
      restId: params.restId,
      targetEndTime: params.targetEndTime,
      exerciseName: params.exerciseName,
      nextSetNumber: params.nextSetNumber,
      mode: params.mode || 'sound',
      restEndAlertEnabled: params.restEndAlertEnabled !== false,
    });
  }

  await cancelNativeOngoingRestNotification();
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await ensureAndroidNotificationChannels();
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') return false;

    const id = computeNativeNotificationId(params.restId || params.targetEndTime || Date.now());
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title: params.title,
          body: params.body,
          schedule: { at: new Date(Date.now() + 150) },
          channelId: getChannelForMode(params.mode || 'sound'),
          smallIcon: 'ic_stat_lazcakong',
          iconColor: '#CCFF00',
          extra: {
            type: 'rest-complete',
            restId: params.restId || '',
            targetEndTime: params.targetEndTime || Date.now(),
          },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

export async function triggerCapacitorHaptics(
  pattern: number[] = [600, 250, 600, 250, 600]
): Promise<boolean> {
  if (!isCapacitorNativeRuntime()) return false;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const pulseDurations = pattern.filter((_, idx) => idx % 2 === 0);
    for (let i = 0; i < pulseDurations.length; i++) {
      const duration = Math.max(200, pulseDurations[i] || 300);
      try {
        await Haptics.vibrate({ duration });
      } catch {
        await Haptics.impact({ style: ImpactStyle.Heavy });
      }
      const pauseMs = pattern[i * 2 + 1] ?? 200;
      if (i < pulseDurations.length - 1) {
        await new Promise((r) => setTimeout(r, duration + pauseMs));
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Initializes native Capacitor shell integrations (StatusBar, SplashScreen, Android channels,
 * notification action sync, Network online/offline bridging, and safe Android Back button handling).
 */
export async function initNativeShell(): Promise<void> {
  if (nativeShellInitialized || !isCapacitorNativeRuntime()) return;
  nativeShellInitialized = true;

  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    if (isCapacitorAndroidRuntime()) {
      await StatusBar.setBackgroundColor({ color: '#090909' });
    }
  } catch {}

  await ensureAndroidNotificationChannels();

  try {
    const { Network } = await import('@capacitor/network');
    void Network.addListener('networkStatusChange', (status) => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(status.connected ? 'online' : 'offline'));
      }
    });
  } catch {}

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    void LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      const extra: any = action?.notification?.extra;
      if (extra?.type === 'rest-complete' || extra?.type === 'rest-active') {
        dispatchOpenActiveWorkoutEvent({
          restId: extra?.restId ? String(extra.restId) : '',
          source: 'local_notification',
        });
      }
    });
  } catch {}

  try {
    const restPlugin = await getRestTimerNotificationPlugin();
    if (restPlugin) {
      void restPlugin.addListener('openActiveWorkout', (data) => {
        dispatchOpenActiveWorkoutEvent({
          restId: data?.restId || '',
          source: 'rest_countdown_notification',
        });
      });
      void restPlugin.addListener('restTimerStateSynced', (snapshot) => {
        dispatchNativeRestSyncEvent(snapshot);
      });
      const pending = await restPlugin.consumePendingOpenActiveWorkout().catch(() => null);
      if (pending?.shouldOpen) {
        dispatchOpenActiveWorkoutEvent({
          restId: pending.restId || '',
          source: 'rest_countdown_launch',
        });
      }
    }
  } catch {}

  try {
    const { App } = await import('@capacitor/app');
    void App.addListener('appStateChange', ({ isActive }) => {
      if (isActive && typeof window !== 'undefined') {
        window.dispatchEvent(new Event('focus'));
      }
    });
    void App.addListener('resume', () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('focus'));
      }
    });
    void App.addListener('backButton', ({ canGoBack }) => {
      if (typeof window !== 'undefined') {
        const evt = new CustomEvent('lazcakong:android-back', { cancelable: true });
        const notCanceled = window.dispatchEvent(evt);
        if (!notCanceled) return;
      }
      if (canGoBack && typeof window !== 'undefined' && window.history.length > 1) {
        window.history.back();
      } else {
        void App.minimizeApp().catch(() => {});
      }
    });
  } catch {}

  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    setTimeout(() => {
      void SplashScreen.hide().catch(() => {});
    }, 350);
  } catch {}
}
