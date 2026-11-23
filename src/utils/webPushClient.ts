import { auth } from '../firebase';
import { safeApiFetchJson } from './safeApiFetch';
import { detectRuntimePlatform } from './capacitorPlatform';
import { getNativeNotificationPermission } from './nativeNotifications';

export interface MissingPushRequirementClient {
  key: string;
  title: string;
  howToFix: string;
  requiredFor: 'immediate' | 'scheduled_locked';
}

export interface PushReadinessClient {
  vapidConfigured: boolean;
  vapidPublicKey: string | null;
  adminFirestoreReady: boolean;
  adminFirestoreError?: string;
  dispatchSecretReady: boolean;
  schedulerProvider: 'cloud_tasks' | 'qstash' | 'none';
  cloudTasksQueuePath: string | null;
  appUrlReady: boolean;
  appOrigin: string | null;
  readyForImmediatePush: boolean;
  readyForLockedScheduledPush: boolean;
  missingRequirements: MissingPushRequirementClient[];
}

export interface DevicePushStatusResult {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  browserSubscribed: boolean;
  deviceId: string;
  readiness: PushReadinessClient | null;
  serverDeviceRegistered: boolean;
  subscriptionCount: number;
  latestAlarm?: {
    restId?: string;
    status?: string;
    targetEndTime?: number;
    schedulerProvider?: string;
    providerAcceptedAt?: string | null;
    providerStatus?: string | null;
    isTest?: boolean;
    updatedAt?: string;
  } | null;
  error?: string;
}

const PUSH_DEVICE_ID_KEY = 'lazcakon_push_device_id';

export function createRestAlarmId(prefix = 'rest'): string {
  const rand =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

export function getOrCreatePushDeviceId(): string {
  try {
    if (typeof localStorage !== 'undefined') {
      const existing = localStorage.getItem(PUSH_DEVICE_ID_KEY);
      if (existing && /^[a-zA-Z0-9_-]{4,128}$/.test(existing)) {
        return existing;
      }
      const created = createRestAlarmId('dev');
      localStorage.setItem(PUSH_DEVICE_ID_KEY, created);
      return created;
    }
  } catch {}
  return createRestAlarmId('dev');
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isWebPushSupportedInBrowser(): boolean {
  if (detectRuntimePlatform().isCapacitorNative) {
    return false;
  }
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

async function getBearerHeaders(): Promise<Record<string, string> | null> {
  const currentUser = auth.currentUser;
  if (!currentUser) return null;
  try {
    const token = await currentUser.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  } catch {
    return null;
  }
}

async function getReadyServiceWorkerRegistration(
  timeoutMs = 2500
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;
    return await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

export async function fetchPushConfig(): Promise<PushReadinessClient | null> {
  const res = await safeApiFetchJson<PushReadinessClient & { success: boolean }>('/api/push/config');
  if (!res.ok || !res.data) return null;
  return res.data;
}

export async function fetchDevicePushStatus(athleteId?: string): Promise<DevicePushStatusResult> {
  const deviceId = getOrCreatePushDeviceId();
  const isNative = detectRuntimePlatform().isCapacitorNative;
  const supported = isWebPushSupportedInBrowser();
  const permission: NotificationPermission | 'unsupported' = isNative
    ? await getNativeNotificationPermission()
    : typeof window !== 'undefined' && 'Notification' in window
    ? Notification.permission
    : 'unsupported';

  if (isNative) {
    return {
      supported: false,
      permission,
      browserSubscribed: false,
      deviceId,
      readiness: null,
      serverDeviceRegistered: false,
      subscriptionCount: 0,
    };
  }

  let browserSubscribed = false;
  if (supported) {
    const reg = await getReadyServiceWorkerRegistration(1200);
    if (reg?.pushManager) {
      try {
        const sub = await reg.pushManager.getSubscription();
        browserSubscribed = Boolean(sub?.endpoint);
      } catch {}
    }
  }

  const headers = await getBearerHeaders();
  if (athleteId && headers) {
    const res = await safeApiFetchJson<{
      success: boolean;
      readiness: PushReadinessClient;
      deviceRegistered: boolean;
      subscriptionCount: number;
      latestAlarm?: DevicePushStatusResult['latestAlarm'];
      error?: string;
    }>(
      `/api/push/status?athleteId=${encodeURIComponent(athleteId)}&deviceId=${encodeURIComponent(deviceId)}`,
      { headers }
    );
    if (res.ok && res.data) {
      return {
        supported,
        permission,
        browserSubscribed,
        deviceId,
        readiness: res.data.readiness,
        serverDeviceRegistered: Boolean(res.data.deviceRegistered),
        subscriptionCount: Number(res.data.subscriptionCount || 0),
        latestAlarm: res.data.latestAlarm || null,
      };
    }
  }

  const config = await fetchPushConfig();
  return {
    supported,
    permission,
    browserSubscribed,
    deviceId,
    readiness: config,
    serverDeviceRegistered: false,
    subscriptionCount: 0,
  };
}

/**
 * Explicit athlete action: requests notification permission, subscribes via PushManager
 * with server VAPID public key, and persists the device subscription in Firestore.
 */
export async function subscribeDeviceToWebPush(athleteId: string): Promise<{
  success: boolean;
  message: string;
  permission: NotificationPermission | 'unsupported';
  readiness?: PushReadinessClient | null;
}> {
  if (!isWebPushSupportedInBrowser()) {
    return {
      success: false,
      permission: 'unsupported',
      message: 'Este navegador no soporta Service Worker / Web Push (PushManager).',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    return {
      success: false,
      permission,
      message:
        permission === 'denied'
          ? 'Permiso de notificaciones bloqueado en el navegador. Habilítalo en Ajustes del sitio.'
          : 'Permiso de notificaciones pendiente.',
    };
  }

  const config = await fetchPushConfig();
  if (!config) {
    return {
      success: false,
      permission,
      message: 'No se pudo consultar la configuración Web Push del servidor.',
    };
  }
  if (!config.vapidConfigured || !config.vapidPublicKey) {
    return {
      success: false,
      permission,
      readiness: config,
      message:
        'Permiso concedido en el navegador, pero faltan las claves VAPID configuradas en el servidor para crear la suscripción Web Push.',
    };
  }

  const headers = await getBearerHeaders();
  if (!headers) {
    return {
      success: false,
      permission,
      readiness: config,
      message: 'Inicia sesión con tu cuenta autenticada para registrar este dispositivo.',
    };
  }

  const reg = await getReadyServiceWorkerRegistration(3000);
  if (!reg?.pushManager) {
    return {
      success: false,
      permission,
      readiness: config,
      message: 'El Service Worker aún no está activo. Recarga la app e intenta nuevamente.',
    };
  }

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const appServerKey = urlBase64ToUint8Array(config.vapidPublicKey);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey as unknown as BufferSource,
    });
  }

  const jsonSub = sub.toJSON();
  const deviceId = getOrCreatePushDeviceId();
  const res = await safeApiFetchJson<{
    success: boolean;
    subscribed?: boolean;
    readiness?: PushReadinessClient;
    error?: string;
  }>('/api/push/subscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      athleteId,
      deviceId,
      subscription: {
        endpoint: sub.endpoint,
        keys: {
          p256dh: jsonSub.keys?.p256dh || '',
          auth: jsonSub.keys?.auth || '',
        },
      },
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      platform: typeof navigator !== 'undefined' ? navigator.platform || '' : '',
    }),
  });

  if (!res.ok || !res.data?.success) {
    return {
      success: false,
      permission,
      readiness: res.data?.readiness || config,
      message: res.error || res.data?.error || 'No se pudo registrar la suscripción en el servidor.',
    };
  }

  return {
    success: true,
    permission,
    readiness: res.data.readiness || config,
    message: 'Dispositivo suscrito a Web Push para este atleta.',
  };
}

export async function unsubscribeDeviceFromWebPush(athleteId: string): Promise<boolean> {
  const headers = await getBearerHeaders();
  const deviceId = getOrCreatePushDeviceId();
  const reg = await getReadyServiceWorkerRegistration(1200);
  if (reg?.pushManager) {
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
    } catch {}
  }
  if (!headers) return false;
  const res = await safeApiFetchJson<{ success: boolean }>('/api/push/unsubscribe', {
    method: 'POST',
    headers,
    body: JSON.stringify({ athleteId, deviceId }),
  });
  return Boolean(res.ok && res.data?.success);
}

export async function scheduleServerRestAlarmPush(params: {
  athleteId: string;
  restId: string;
  targetEndTime: number;
  durationSeconds: number;
  sessionId?: string;
  exerciseName?: string;
  nextSetNumber?: number;
  mode: 'sound' | 'vibrate_only' | 'silent';
  restEndAlertEnabled: boolean;
  supersededRestId?: string;
}): Promise<{
  scheduled: boolean;
  code?: string;
  schedulerProvider?: string;
  readiness?: PushReadinessClient;
  message?: string;
}> {
  if (detectRuntimePlatform().isCapacitorNative) {
    return {
      scheduled: false,
      code: 'NATIVE_LOCAL_NOTIFICATIONS_ACTIVE',
      message: 'En modo app nativa se usan notificaciones locales offline del sistema.',
    };
  }
  if (!params.athleteId || params.athleteId === 'perfil_default') {
    return { scheduled: false, message: 'Requiere sesión de atleta autenticado.' };
  }
  if (!params.restEndAlertEnabled) {
    return { scheduled: false, message: 'Aviso de fin de descanso desactivado.' };
  }
  const headers = await getBearerHeaders();
  if (!headers) {
    return { scheduled: false, message: 'Sesión Firebase no disponible para autenticar el envío.' };
  }
  const deviceId = getOrCreatePushDeviceId();
  const res = await safeApiFetchJson<{
    success: boolean;
    scheduled?: boolean;
    code?: string;
    schedulerProvider?: string;
    readiness?: PushReadinessClient;
    message?: string;
    error?: string;
  }>('/api/push/schedule-rest', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...params,
      deviceId,
      isTest: false,
    }),
  });
  return {
    scheduled: Boolean(res.ok && res.data?.scheduled),
    code: res.data?.code,
    schedulerProvider: res.data?.schedulerProvider,
    readiness: res.data?.readiness,
    message: res.data?.message || res.error || res.data?.error,
  };
}

export async function cancelServerRestAlarmPush(params: {
  athleteId: string;
  restId?: string;
  reason: 'paused' | 'cancelled' | 'superseded';
}): Promise<{ cancelled: boolean }> {
  if (detectRuntimePlatform().isCapacitorNative) {
    return { cancelled: true };
  }
  if (!params.athleteId || params.athleteId === 'perfil_default') {
    return { cancelled: false };
  }
  const headers = await getBearerHeaders();
  if (!headers) return { cancelled: false };
  const res = await safeApiFetchJson<{ success: boolean; cancelled?: boolean }>(
    '/api/push/cancel-rest',
    {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    }
  );
  return { cancelled: Boolean(res.ok && res.data?.cancelled) };
}

export async function triggerImmediatePushTest(params: {
  athleteId: string;
  exerciseName?: string;
  nextSetNumber?: number;
  mode: 'sound' | 'vibrate_only' | 'silent';
}): Promise<{
  success: boolean;
  providerAccepted: boolean;
  restId?: string;
  message: string;
  code?: string;
  readiness?: PushReadinessClient;
}> {
  const headers = await getBearerHeaders();
  if (!headers) {
    return {
      success: false,
      providerAccepted: false,
      message: 'Debes iniciar sesión con tu cuenta autenticada para probar Web Push.',
    };
  }
  const deviceId = getOrCreatePushDeviceId();
  const res = await safeApiFetchJson<{
    success: boolean;
    providerAccepted?: boolean;
    restId?: string;
    code?: string;
    readiness?: PushReadinessClient;
    message?: string;
    error?: string;
  }>('/api/push/test-immediate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...params,
      deviceId,
    }),
  });
  return {
    success: Boolean(res.ok && res.data?.providerAccepted),
    providerAccepted: Boolean(res.data?.providerAccepted),
    restId: res.data?.restId,
    code: res.data?.code,
    readiness: res.data?.readiness,
    message:
      res.data?.message ||
      res.error ||
      res.data?.error ||
      'No se pudo enviar la prueba push inmediata.',
  };
}

export async function triggerScheduled60sPushTest(params: {
  athleteId: string;
  exerciseName?: string;
  nextSetNumber?: number;
  mode: 'sound' | 'vibrate_only' | 'silent';
}): Promise<{
  scheduled: boolean;
  restId?: string;
  targetEndTime?: number;
  schedulerProvider?: string;
  message: string;
  code?: string;
  readiness?: PushReadinessClient;
}> {
  const headers = await getBearerHeaders();
  if (!headers) {
    return {
      scheduled: false,
      message: 'Debes iniciar sesión con tu cuenta autenticada para programar la prueba push.',
    };
  }
  const deviceId = getOrCreatePushDeviceId();
  const res = await safeApiFetchJson<{
    success: boolean;
    scheduled?: boolean;
    restId?: string;
    targetEndTime?: number;
    schedulerProvider?: string;
    code?: string;
    readiness?: PushReadinessClient;
    message?: string;
    error?: string;
  }>('/api/push/test-scheduled-60s', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...params,
      deviceId,
    }),
  });
  return {
    scheduled: Boolean(res.ok && res.data?.scheduled),
    restId: res.data?.restId,
    targetEndTime: res.data?.targetEndTime,
    schedulerProvider: res.data?.schedulerProvider,
    code: res.data?.code,
    readiness: res.data?.readiness,
    message:
      res.data?.message ||
      res.error ||
      res.data?.error ||
      'No se pudo programar la prueba push a 60 s.',
  };
}
