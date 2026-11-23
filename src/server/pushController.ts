import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { sendNotification as sendWebPushNotification } from 'web-push';
import { GoogleAuth } from 'google-auth-library';
import type { AuthenticatedUser } from './firebaseAdminServer.ts';
import {
  constantTimeCompare,
  deleteSubcollectionDocWithUserToken,
  getAdminServices,
  getDocumentWithUserToken,
  getSubcollectionDocWithUserToken,
  isFirestorePermissionDeniedError,
  listSubcollectionDocsWithUserToken,
  parseConfiguredServiceAccount,
  probeAdminFirestoreAccess,
  putSubcollectionDocWithUserToken,
} from './firebaseAdminServer.ts';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

export type PushSchedulerProvider = 'cloud_tasks' | 'qstash' | 'none';
export type RestAlarmMode = 'sound' | 'vibrate_only' | 'silent';
export type RestAlarmStatus =
  | 'scheduled'
  | 'paused'
  | 'cancelled'
  | 'superseded'
  | 'sent'
  | 'failed';

export interface StoredPushSubscription {
  deviceId: string;
  athleteId: string;
  authUid: string;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent?: string;
  platform?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StoredRestAlarm {
  restId: string;
  athleteId: string;
  authUid: string;
  deviceId: string;
  sessionId?: string;
  exerciseName?: string;
  nextSetNumber?: number | null;
  targetEndTime: number;
  durationSeconds: number;
  status: RestAlarmStatus;
  mode: RestAlarmMode;
  restEndAlertEnabled: boolean;
  isTest: boolean;
  schedulerProvider?: PushSchedulerProvider;
  schedulerTaskName?: string;
  dispatchAttemptCount?: number;
  providerAcceptedAt?: string | null;
  providerStatus?: string | null;
  invalidatedReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MissingPushRequirement {
  key: string;
  title: string;
  howToFix: string;
  requiredFor: 'immediate' | 'scheduled_locked';
}

export interface PushReadinessReport {
  vapidConfigured: boolean;
  vapidPublicKey: string | null;
  adminFirestoreReady: boolean;
  adminFirestoreError?: string;
  dispatchSecretReady: boolean;
  schedulerProvider: PushSchedulerProvider;
  cloudTasksQueuePath: string | null;
  appUrlReady: boolean;
  appOrigin: string | null;
  readyForImmediatePush: boolean;
  readyForLockedScheduledPush: boolean;
  missingRequirements: MissingPushRequirement[];
}

export interface PushControllerDeps {
  getEnv?: (name: string) => string | undefined;
  probeAdminFirestore?: () => Promise<{ ok: boolean; error?: string }>;
  getAdminServicesFn?: typeof getAdminServices;
  sendWebPush?: (
    sub: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: Record<string, any>
  ) => Promise<{ statusCode: number; headers?: Record<string, string>; body?: string }>;
  fetchFn?: typeof fetch;
  getGoogleAccessToken?: () => Promise<string>;
  nowFn?: () => number;
}

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function isValidFirestoreId(val: unknown): val is string {
  return typeof val === 'string' && VALID_ID_REGEX.test(val);
}

function defaultGetEnv(name: string): string | undefined {
  return process.env[name];
}

export function resolveAppHttpsOrigin(
  req?: Request,
  getEnv: (name: string) => string | undefined = defaultGetEnv
): string | null {
  const candidates = [
    getEnv('APP_URL'),
    req ? `${req.protocol}://${req.get('host') || ''}` : undefined,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol === 'https:') {
        return parsed.origin;
      }
      if (parsed.protocol === 'http:' && parsed.hostname === 'localhost') {
        // Not valid for external callbacks, keep checking https candidates
      }
    } catch {}
  }
  return null;
}

export function resolveCloudTasksQueuePath(
  getEnv: (name: string) => string | undefined = defaultGetEnv
): string | null {
  const full = (getEnv('CLOUD_TASKS_QUEUE_PATH') || '').trim();
  if (full && /^projects\/[^/]+\/locations\/[^/]+\/queues\/[^/]+$/.test(full)) {
    return full;
  }
  const project = (getEnv('GCP_PROJECT_ID') || getEnv('CLOUD_TASKS_PROJECT_ID') || '').trim();
  const location = (getEnv('CLOUD_TASKS_LOCATION') || '').trim();
  const queue = (getEnv('CLOUD_TASKS_QUEUE') || '').trim();
  if (project && location && queue) {
    return `projects/${project}/locations/${location}/queues/${queue}`;
  }
  return null;
}

export async function getPushReadinessReport(
  req?: Request,
  deps: PushControllerDeps = {}
): Promise<PushReadinessReport> {
  const getEnv = deps.getEnv || defaultGetEnv;
  const vapidPublicKey = (getEnv('VAPID_PUBLIC_KEY') || '').trim() || null;
  const vapidPrivateKey = (getEnv('VAPID_PRIVATE_KEY') || '').trim() || null;
  const vapidConfigured = Boolean(vapidPublicKey && vapidPrivateKey);

  const probe = deps.probeAdminFirestore
    ? await deps.probeAdminFirestore()
    : await probeAdminFirestoreAccess();

  const dispatchSecret = (getEnv('PUSH_DISPATCH_SECRET') || '').trim();
  const dispatchSecretReady = dispatchSecret.length >= 16;

  const cloudTasksQueuePath = resolveCloudTasksQueuePath(getEnv);
  const qstashToken = (getEnv('QSTASH_TOKEN') || '').trim();
  const schedulerProvider: PushSchedulerProvider = cloudTasksQueuePath
    ? 'cloud_tasks'
    : qstashToken
    ? 'qstash'
    : 'none';

  const appOrigin = resolveAppHttpsOrigin(req, getEnv);
  const appUrlReady = Boolean(appOrigin);

  const missingRequirements: MissingPushRequirement[] = [];

  if (!vapidConfigured) {
    missingRequirements.push({
      key: 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY',
      title: 'Claves VAPID para Web Push',
      howToFix:
        'Genera un par con `npx web-push generate-vapid-keys` y configúralo en las variables de entorno VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT (ej. mailto:tu-correo@dominio.com).',
      requiredFor: 'immediate',
    });
  }

  if (!probe.ok) {
    missingRequirements.push({
      key: 'IAM_FIRESTORE_ADC',
      title: 'Permiso IAM en Firestore para la identidad de servicio (ADC)',
      howToFix: `El servidor ya intenta usar Google Cloud ADC sin llave JSON privada, pero su identidad de ejecución actual no tiene permiso IAM en Firestore del proyecto ${firebaseConfig.projectId} (${probe.error || 'PERMISSION_DENIED'}). Solución preferida sin clave JSON: asigna el rol mínimo Cloud Datastore User (roles/datastore.user) en ${firebaseConfig.projectId} a la cuenta de servicio de ejecución del servidor (o despliega en el mismo proyecto). Solo si el entorno sandbox impide asignar IAM entre proyectos, usa FIREBASE_SERVICE_ACCOUNT_JSON como alternativa opcional.`,
      requiredFor: 'scheduled_locked',
    });
  }

  if (!dispatchSecretReady) {
    missingRequirements.push({
      key: 'PUSH_DISPATCH_SECRET',
      title: 'Secreto compartido para autenticar el webhook de vencimiento',
      howToFix:
        'Define PUSH_DISPATCH_SECRET (mínimo 16 caracteres aleatorios) para que POST /api/push/dispatch-rest-alarm rechace llamadas no autorizadas.',
      requiredFor: 'scheduled_locked',
    });
  }

  if (schedulerProvider === 'none') {
    missingRequirements.push({
      key: 'CLOUD_TASKS_QUEUE_PATH (o QSTASH_TOKEN)',
      title: 'Servicio externo de tareas diferidas persistentes',
      howToFix:
        'Configura una cola de Google Cloud Tasks (CLOUD_TASKS_QUEUE_PATH=projects/<PROJECT>/locations/<REGION>/queues/<QUEUE>) habilitando Cloud Tasks en tu proyecto GCP, o configura QSTASH_TOKEN (Upstash QStash). No se usan temporizadores en memoria de Cloud Run.',
      requiredFor: 'scheduled_locked',
    });
  }

  if (!appUrlReady) {
    missingRequirements.push({
      key: 'APP_URL',
      title: 'URL pública HTTPS del backend',
      howToFix:
        'Configura APP_URL con la URL HTTPS pública del servicio Cloud Run para recibir el callback de la tarea programada.',
      requiredFor: 'scheduled_locked',
    });
  }

  return {
    vapidConfigured,
    vapidPublicKey,
    adminFirestoreReady: probe.ok,
    adminFirestoreError: probe.ok ? undefined : probe.error,
    dispatchSecretReady,
    schedulerProvider,
    cloudTasksQueuePath,
    appUrlReady,
    appOrigin,
    readyForImmediatePush: vapidConfigured,
    readyForLockedScheduledPush:
      vapidConfigured &&
      probe.ok &&
      dispatchSecretReady &&
      schedulerProvider !== 'none' &&
      appUrlReady,
    missingRequirements,
  };
}

export function buildRestCompletePushBody(params: {
  exerciseName?: string;
  nextSetNumber?: number | null;
  isTest?: boolean;
}): string {
  const cleanEx = (params.exerciseName || '').trim();
  if (
    cleanEx.length > 0 &&
    typeof params.nextSetNumber === 'number' &&
    Number.isFinite(params.nextSetNumber) &&
    params.nextSetNumber > 0
  ) {
    return `Siguiente serie: ${cleanEx} · Serie ${params.nextSetNumber}`;
  }
  if (params.isTest) {
    return 'Prueba push de LazcaKong Gym. Comprueba la recepción en celular y reloj.';
  }
  return 'Descanso finalizado. Continúa tu entrenamiento.';
}

export function buildWebPushNotificationPayload(params: {
  athleteId: string;
  restId: string;
  targetEndTime: number;
  exerciseName?: string;
  nextSetNumber?: number | null;
  mode: RestAlarmMode;
  isTest: boolean;
  appOrigin: string;
}) {
  const soundEnabled = params.mode === 'sound';
  const vibrationEnabled = params.mode !== 'silent';
  const isSilent = params.mode === 'silent';
  const cleanOrigin = params.appOrigin.replace(/\/$/, '');

  return JSON.stringify({
    type: 'rest-complete',
    restId: params.restId,
    athleteId: params.athleteId,
    targetEndTime: params.targetEndTime,
    isTest: params.isTest,
    mode: params.mode,
    soundEnabled,
    vibrationEnabled,
    silent: isSilent,
    vibrate: !isSilent && vibrationEnabled ? [600, 250, 600, 250, 600] : undefined,
    title: 'LAZCAKONG · DESCANSO TERMINADO',
    body: buildRestCompletePushBody({
      exerciseName: params.exerciseName,
      nextSetNumber: params.nextSetNumber,
      isTest: params.isTest,
    }),
    icon: `${cleanOrigin}/notification-icon-192.png`,
    badge: `${cleanOrigin}/notification-badge-gorilla.png`,
    tag: `lazcakon-rest-done-${params.restId}`,
    exerciseName: params.exerciseName || '',
    nextSetNumber: params.nextSetNumber ?? null,
    sentAt: new Date().toISOString(),
  });
}

async function verifyAthleteOwnerForPush(params: {
  athleteId: string;
  user: AuthenticatedUser;
  rawIdToken?: string;
  deps?: PushControllerDeps;
}): Promise<{ authorized: boolean; status: number; error?: string }> {
  const { athleteId, user, rawIdToken, deps } = params;
  if (!isValidFirestoreId(athleteId)) {
    return { authorized: false, status: 400, error: 'Identificador de atleta inválido.' };
  }
  if (user.uid === athleteId || user.isAdmin === true) {
    return { authorized: true, status: 200 };
  }
  try {
    const { db } = (deps?.getAdminServicesFn || getAdminServices)();
    const snap = await db.collection('athletes').doc(athleteId).get();
    if (!snap.exists) {
      return { authorized: false, status: 404, error: 'Perfil de atleta no encontrado.' };
    }
    const ownerUid = String(snap.data()?.authUid || '').trim();
    if (ownerUid && ownerUid === user.uid) {
      return { authorized: true, status: 200 };
    }
    return {
      authorized: false,
      status: 403,
      error: 'No tienes autorización sobre las notificaciones de este atleta.',
    };
  } catch (err: any) {
    if (isFirestorePermissionDeniedError(err) && rawIdToken) {
      const restDoc = await getDocumentWithUserToken(rawIdToken, 'athletes', athleteId);
      if (restDoc.ok && restDoc.exists) {
        const ownerUid = String(restDoc.data?.authUid || '').trim();
        if (ownerUid && ownerUid === user.uid) {
          return { authorized: true, status: 200 };
        }
        return {
          authorized: false,
          status: 403,
          error: 'No tienes autorización sobre las notificaciones de este atleta.',
        };
      }
      if (restDoc.ok && !restDoc.exists) {
        return { authorized: false, status: 404, error: 'Perfil de atleta no encontrado.' };
      }
    }
    return {
      authorized: false,
      status: 503,
      error: 'No se pudo verificar la titularidad del atleta en Firestore.',
    };
  }
}

async function listAthleteSubscriptions(params: {
  athleteId: string;
  rawIdToken?: string;
  deps?: PushControllerDeps;
}): Promise<{ ok: boolean; subs: StoredPushSubscription[]; usedUserTokenFallback: boolean; error?: string }> {
  const { athleteId, rawIdToken, deps } = params;
  try {
    const { db } = (deps?.getAdminServicesFn || getAdminServices)();
    const snap = await db
      .collection('athletes')
      .doc(athleteId)
      .collection('push_subscriptions')
      .get();
    const subs = snap.docs
      .map((d) => d.data() as StoredPushSubscription)
      .filter((s) => s && s.enabled !== false && typeof s.endpoint === 'string');
    return { ok: true, subs, usedUserTokenFallback: false };
  } catch (err: any) {
    if (isFirestorePermissionDeniedError(err) && rawIdToken) {
      const res = await listSubcollectionDocsWithUserToken(
        rawIdToken,
        'athletes',
        athleteId,
        'push_subscriptions'
      );
      if (res.ok) {
        const subs = res.docs
          .map((d) => d.data as StoredPushSubscription)
          .filter((s) => s && s.enabled !== false && typeof s.endpoint === 'string');
        return { ok: true, subs, usedUserTokenFallback: true };
      }
    }
    return {
      ok: false,
      subs: [],
      usedUserTokenFallback: false,
      error: err?.message || 'Error leyendo suscripciones push en Firestore.',
    };
  }
}

async function saveAthleteSubscription(params: {
  athleteId: string;
  deviceId: string;
  doc: StoredPushSubscription;
  rawIdToken?: string;
  deps?: PushControllerDeps;
}): Promise<{ ok: boolean; error?: string }> {
  const { athleteId, deviceId, doc, rawIdToken, deps } = params;
  try {
    const { db } = (deps?.getAdminServicesFn || getAdminServices)();
    await db
      .collection('athletes')
      .doc(athleteId)
      .collection('push_subscriptions')
      .doc(deviceId)
      .set(doc, { merge: false });
    return { ok: true };
  } catch (err: any) {
    if (isFirestorePermissionDeniedError(err) && rawIdToken) {
      const restRes = await putSubcollectionDocWithUserToken(
        rawIdToken,
        'athletes',
        athleteId,
        'push_subscriptions',
        deviceId,
        doc
      );
      if (restRes.ok) return { ok: true };
      return {
        ok: false,
        error: restRes.error || `Firestore rechazó la suscripción (HTTP ${restRes.status}).`,
      };
    }
    return { ok: false, error: err?.message || 'Error guardando suscripción Web Push.' };
  }
}

async function deleteAthleteSubscription(params: {
  athleteId: string;
  deviceId: string;
  rawIdToken?: string;
  deps?: PushControllerDeps;
}): Promise<{ ok: boolean }> {
  const { athleteId, deviceId, rawIdToken, deps } = params;
  try {
    const { db } = (deps?.getAdminServicesFn || getAdminServices)();
    await db
      .collection('athletes')
      .doc(athleteId)
      .collection('push_subscriptions')
      .doc(deviceId)
      .delete();
    return { ok: true };
  } catch (err: any) {
    if (isFirestorePermissionDeniedError(err) && rawIdToken) {
      const restRes = await deleteSubcollectionDocWithUserToken(
        rawIdToken,
        'athletes',
        athleteId,
        'push_subscriptions',
        deviceId
      );
      return { ok: restRes.ok };
    }
    return { ok: false };
  }
}

async function getDefaultGoogleCloudAccessToken(
  getEnv: (name: string) => string | undefined = defaultGetEnv
): Promise<string> {
  const sa = parseConfiguredServiceAccount();
  const auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    ...(sa ? { credentials: sa as any } : {}),
    projectId: sa?.project_id || getEnv('GCP_PROJECT_ID') || firebaseConfig.projectId,
  });
  const client = await auth.getClient();
  const tokenResp = await client.getAccessToken();
  const token = typeof tokenResp === 'string' ? tokenResp : tokenResp?.token;
  if (!token) {
    throw new Error('No se pudo obtener token OAuth2 para Google Cloud Tasks.');
  }
  return token;
}

async function enqueuePersistentRestTask(params: {
  schedulerProvider: PushSchedulerProvider;
  cloudTasksQueuePath: string | null;
  appOrigin: string;
  athleteId: string;
  restId: string;
  targetEndTime: number;
  deps?: PushControllerDeps;
}): Promise<{ ok: boolean; taskName?: string; error?: string }> {
  const { schedulerProvider, cloudTasksQueuePath, appOrigin, athleteId, restId, targetEndTime, deps } = params;
  const getEnv = deps?.getEnv || defaultGetEnv;
  const fetchFn = deps?.fetchFn || fetch;
  const dispatchSecret = (getEnv('PUSH_DISPATCH_SECRET') || '').trim();
  const callbackUrl = `${appOrigin.replace(/\/$/, '')}/api/push/dispatch-rest-alarm`;
  const payloadObj = { athleteId, restId, targetEndTime };

  if (schedulerProvider === 'cloud_tasks') {
    if (!cloudTasksQueuePath) {
      return { ok: false, error: 'CLOUD_TASKS_QUEUE_PATH no está configurado.' };
    }
    try {
      const accessToken = deps?.getGoogleAccessToken
        ? await deps.getGoogleAccessToken()
        : await getDefaultGoogleCloudAccessToken(getEnv);
      const oidcEmail = (getEnv('CLOUD_TASKS_SERVICE_ACCOUNT_EMAIL') || '').trim();
      const scheduleTime = new Date(Math.max(Date.now() + 1000, targetEndTime)).toISOString();
      const bodyBase64 = Buffer.from(JSON.stringify(payloadObj), 'utf8').toString('base64');

      const httpRequest: Record<string, any> = {
        httpMethod: 'POST',
        url: callbackUrl,
        headers: {
          'Content-Type': 'application/json',
          'X-Lazcakon-Push-Secret': dispatchSecret,
        },
        body: bodyBase64,
      };
      if (oidcEmail) {
        httpRequest.oidcToken = {
          serviceAccountEmail: oidcEmail,
          audience: callbackUrl,
        };
      }

      const taskId = `lzk_${athleteId}_${restId}_${targetEndTime}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
      const createRes = await fetchFn(
        `https://cloudtasks.googleapis.com/v2/${cloudTasksQueuePath}/tasks`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            task: {
              name: `${cloudTasksQueuePath}/tasks/${taskId}`,
              scheduleTime,
              httpRequest,
            },
          }),
        }
      );

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => '');
        return {
          ok: false,
          error: `Cloud Tasks rechazó la tarea (HTTP ${createRes.status}): ${errText.slice(0, 220)}`,
        };
      }
      const createdJson = (await createRes.json()) as { name?: string };
      return {
        ok: true,
        taskName: createdJson?.name || `${cloudTasksQueuePath}/tasks/${taskId}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Error al encolar tarea persistente en Cloud Tasks.',
      };
    }
  }

  if (schedulerProvider === 'qstash') {
    const qstashToken = (getEnv('QSTASH_TOKEN') || '').trim();
    if (!qstashToken) {
      return { ok: false, error: 'QSTASH_TOKEN no está configurado.' };
    }
    try {
      const delaySec = Math.max(1, Math.ceil((targetEndTime - Date.now()) / 1000));
      const res = await fetchFn(
        `https://qstash.upstash.io/v2/publish/${encodeURIComponent(callbackUrl)}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${qstashToken}`,
            'Content-Type': 'application/json',
            'Upstash-Delay': `${delaySec}s`,
            'Upstash-Retries': '2',
            'Upstash-Deduplication-Id': `${athleteId}-${restId}-${targetEndTime}`.slice(0, 128),
            'Upstash-Forward-X-Lazcakon-Push-Secret': dispatchSecret,
          },
          body: JSON.stringify(payloadObj),
        }
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        return {
          ok: false,
          error: `QStash rechazó la tarea (HTTP ${res.status}): ${errText.slice(0, 220)}`,
        };
      }
      const json = (await res.json()) as { messageId?: string };
      return {
        ok: true,
        taskName: json?.messageId || undefined,
      };
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Error al encolar tarea persistente en QStash.',
      };
    }
  }

  return {
    ok: false,
    error: 'No hay ningún servicio de tareas diferidas persistentes configurado.',
  };
}

async function cancelPersistentRestTask(params: {
  schedulerProvider?: PushSchedulerProvider;
  schedulerTaskName?: string;
  deps?: PushControllerDeps;
}): Promise<void> {
  const { schedulerProvider, schedulerTaskName, deps } = params;
  if (!schedulerTaskName || !schedulerProvider || schedulerProvider === 'none') return;
  const getEnv = deps?.getEnv || defaultGetEnv;
  const fetchFn = deps?.fetchFn || fetch;

  if (schedulerProvider === 'cloud_tasks') {
    try {
      const accessToken = deps?.getGoogleAccessToken
        ? await deps.getGoogleAccessToken()
        : await getDefaultGoogleCloudAccessToken(getEnv);
      await fetchFn(`https://cloudtasks.googleapis.com/v2/${schedulerTaskName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {}
  } else if (schedulerProvider === 'qstash') {
    const qstashToken = (getEnv('QSTASH_TOKEN') || '').trim();
    if (!qstashToken) return;
    try {
      await fetchFn(`https://qstash.upstash.io/v2/messages/${encodeURIComponent(schedulerTaskName)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${qstashToken}` },
      });
    } catch {}
  }
}

async function sendWebPushToSubscriptions(params: {
  subs: StoredPushSubscription[];
  payloadJson: string;
  athleteId: string;
  deps?: PushControllerDeps;
  disableDeadSubscription?: (deviceId: string) => Promise<void>;
}) {
  const getEnv = params.deps?.getEnv || defaultGetEnv;
  const publicKey = (getEnv('VAPID_PUBLIC_KEY') || '').trim();
  const privateKey = (getEnv('VAPID_PRIVATE_KEY') || '').trim();
  const subject = (getEnv('VAPID_SUBJECT') || 'mailto:kmiloko19@gmail.com').trim();

  if (!publicKey || !privateKey) {
    throw new Error('Claves VAPID no configuradas en el servidor.');
  }

  const sender =
    params.deps?.sendWebPush ||
    ((sub, payload, opts) =>
      sendWebPushNotification(sub, payload, {
        vapidDetails: { subject, publicKey, privateKey },
        ...opts,
      }));

  const results: Array<{
    deviceId: string;
    accepted: boolean;
    statusCode?: number;
    error?: string;
    gone?: boolean;
  }> = [];

  for (const sub of params.subs) {
    try {
      const res = await sender(
        {
          endpoint: sub.endpoint,
          keys: sub.keys,
        },
        params.payloadJson,
        {
          TTL: 120,
          urgency: 'high',
          topic: `lazcakon-rest-${params.athleteId}`.slice(0, 32),
        }
      );
      results.push({
        deviceId: sub.deviceId,
        accepted: true,
        statusCode: res?.statusCode || 201,
      });
    } catch (err: any) {
      const statusCode = typeof err?.statusCode === 'number' ? err.statusCode : undefined;
      const isGone = statusCode === 404 || statusCode === 410;
      if (isGone && params.disableDeadSubscription) {
        await params.disableDeadSubscription(sub.deviceId).catch(() => {});
      }
      results.push({
        deviceId: sub.deviceId,
        accepted: false,
        statusCode,
        gone: isGone,
        error: err?.body || err?.message || 'Error enviando al proveedor Web Push',
      });
    }
  }

  const acceptedCount = results.filter((r) => r.accepted).length;
  const failedCount = results.length - acceptedCount;

  return {
    acceptedCount,
    failedCount,
    results,
  };
}

export async function handleGetPushConfig(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const readiness = await getPushReadinessReport(req, deps);
  return res.status(200).json({
    success: true,
    ...readiness,
  });
}

export async function handleGetPushStatus(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  const rawIdToken = (req as any).rawIdToken as string | undefined;
  if (!user?.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }

  const athleteId = String(req.query?.athleteId || req.body?.athleteId || '').trim();
  const deviceId = String(req.query?.deviceId || req.body?.deviceId || '').trim();
  const authCheck = await verifyAthleteOwnerForPush({ athleteId, user, rawIdToken, deps });
  if (!authCheck.authorized) {
    return res.status(authCheck.status).json({ success: false, error: authCheck.error });
  }

  const readiness = await getPushReadinessReport(req, deps);
  const subList = await listAthleteSubscriptions({ athleteId, rawIdToken, deps });

  const deviceRegistered = Boolean(
    deviceId && subList.subs.some((s) => s.deviceId === deviceId && s.enabled !== false)
  );

  let latestAlarm: Partial<StoredRestAlarm> | null = null;
  try {
    const { db } = (deps.getAdminServicesFn || getAdminServices)();
    const alarmSnap = await db
      .collection('athletes')
      .doc(athleteId)
      .collection('rest_alarms')
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get();
    if (!alarmSnap.empty) {
      latestAlarm = alarmSnap.docs[0].data() as StoredRestAlarm;
    }
  } catch (err: any) {
    if (isFirestorePermissionDeniedError(err) && rawIdToken) {
      const alarmsRes = await listSubcollectionDocsWithUserToken(
        rawIdToken,
        'athletes',
        athleteId,
        'rest_alarms'
      );
      if (alarmsRes.ok && alarmsRes.docs.length > 0) {
        const sorted = alarmsRes.docs
          .map((d) => d.data as StoredRestAlarm)
          .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
        latestAlarm = sorted[0] || null;
      }
    }
  }

  return res.status(200).json({
    success: true,
    readiness,
    deviceRegistered,
    subscriptionCount: subList.subs.length,
    subscriptionsReadable: subList.ok,
    latestAlarm: latestAlarm
      ? {
          restId: latestAlarm.restId,
          status: latestAlarm.status,
          targetEndTime: latestAlarm.targetEndTime,
          schedulerProvider: latestAlarm.schedulerProvider,
          providerAcceptedAt: latestAlarm.providerAcceptedAt || null,
          providerStatus: latestAlarm.providerStatus || null,
          isTest: Boolean(latestAlarm.isTest),
          updatedAt: latestAlarm.updatedAt,
        }
      : null,
  });
}

export async function handleSubscribePush(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  const rawIdToken = (req as any).rawIdToken as string | undefined;
  if (!user?.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }

  const { athleteId, deviceId, subscription, userAgent, platform } = req.body || {};
  const authCheck = await verifyAthleteOwnerForPush({
    athleteId: String(athleteId || ''),
    user,
    rawIdToken,
    deps,
  });
  if (!authCheck.authorized) {
    return res.status(authCheck.status).json({ success: false, error: authCheck.error });
  }
  if (!isValidFirestoreId(deviceId)) {
    return res.status(400).json({ success: false, error: 'deviceId inválido.' });
  }

  const endpoint = String(subscription?.endpoint || '').trim();
  const p256dh = String(subscription?.keys?.p256dh || '').trim();
  const authKey = String(subscription?.keys?.auth || '').trim();

  if (!endpoint.startsWith('https://') || endpoint.length > 2048 || p256dh.length < 10 || authKey.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'Objeto PushSubscription inválido (endpoint HTTPS y claves p256dh/auth requeridas).',
    });
  }

  const nowIso = new Date((deps.nowFn || Date.now)()).toISOString();
  const doc: StoredPushSubscription = {
    deviceId,
    athleteId: String(athleteId),
    authUid: user.uid,
    endpoint,
    keys: { p256dh, auth: authKey },
    ...(userAgent ? { userAgent: String(userAgent).slice(0, 340) } : {}),
    ...(platform ? { platform: String(platform).slice(0, 75) } : {}),
    enabled: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const saved = await saveAthleteSubscription({
    athleteId: String(athleteId),
    deviceId,
    doc,
    rawIdToken,
    deps,
  });

  if (!saved.ok) {
    return res.status(503).json({
      success: false,
      error: saved.error || 'No se pudo guardar la suscripción Web Push en Firestore.',
    });
  }

  const readiness = await getPushReadinessReport(req, deps);
  return res.status(200).json({
    success: true,
    subscribed: true,
    deviceId,
    readiness,
  });
}

export async function handleUnsubscribePush(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  const rawIdToken = (req as any).rawIdToken as string | undefined;
  if (!user?.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }

  const { athleteId, deviceId } = req.body || {};
  const authCheck = await verifyAthleteOwnerForPush({
    athleteId: String(athleteId || ''),
    user,
    rawIdToken,
    deps,
  });
  if (!authCheck.authorized) {
    return res.status(authCheck.status).json({ success: false, error: authCheck.error });
  }
  if (!isValidFirestoreId(deviceId)) {
    return res.status(400).json({ success: false, error: 'deviceId inválido.' });
  }

  const deleted = await deleteAthleteSubscription({
    athleteId: String(athleteId),
    deviceId,
    rawIdToken,
    deps,
  });
  return res.status(200).json({ success: deleted.ok, unsubscribed: deleted.ok, deviceId });
}

async function invalidateExistingAlarm(params: {
  athleteId: string;
  restId: string;
  reason: 'paused' | 'cancelled' | 'superseded';
  deps?: PushControllerDeps;
}): Promise<{ found: boolean; status?: RestAlarmStatus }> {
  const { athleteId, restId, reason, deps } = params;
  if (!isValidFirestoreId(restId)) return { found: false };
  const { db } = (deps?.getAdminServicesFn || getAdminServices)();
  const ref = db.collection('athletes').doc(athleteId).collection('rest_alarms').doc(restId);
  const snap = await ref.get();
  if (!snap.exists) return { found: false };

  const data = snap.data() as StoredRestAlarm;
  const nextStatus: RestAlarmStatus =
    reason === 'paused' ? 'paused' : reason === 'superseded' ? 'superseded' : 'cancelled';

  if (data.status === 'scheduled') {
    await ref.set(
      {
        status: nextStatus,
        invalidatedReason: reason,
        updatedAt: new Date((deps?.nowFn || Date.now)()).toISOString(),
      },
      { merge: true }
    );
    await cancelPersistentRestTask({
      schedulerProvider: data.schedulerProvider,
      schedulerTaskName: data.schedulerTaskName,
      deps,
    });
  }
  return { found: true, status: nextStatus };
}

export async function handleScheduleRestPush(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  const rawIdToken = (req as any).rawIdToken as string | undefined;
  if (!user?.uid) {
    return res.status(401).json({ success: false, scheduled: false, error: 'Autenticación requerida.' });
  }

  const {
    athleteId,
    restId,
    deviceId,
    sessionId,
    exerciseName,
    nextSetNumber,
    targetEndTime,
    durationSeconds,
    mode = 'vibrate_only',
    restEndAlertEnabled = true,
    isTest = false,
    supersededRestId,
  } = req.body || {};

  const authCheck = await verifyAthleteOwnerForPush({
    athleteId: String(athleteId || ''),
    user,
    rawIdToken,
    deps,
  });
  if (!authCheck.authorized) {
    return res.status(authCheck.status).json({ success: false, scheduled: false, error: authCheck.error });
  }

  if (!isValidFirestoreId(restId) || !isValidFirestoreId(deviceId)) {
    return res.status(400).json({
      success: false,
      scheduled: false,
      error: 'restId y deviceId deben ser identificadores válidos.',
    });
  }

  const now = (deps.nowFn || Date.now)();
  const numericEnd = Number(targetEndTime);
  const numericDuration = Number(durationSeconds);
  if (
    !Number.isFinite(numericEnd) ||
    numericEnd <= now ||
    !Number.isFinite(numericDuration) ||
    numericDuration <= 0 ||
    numericDuration > 3600
  ) {
    return res.status(400).json({
      success: false,
      scheduled: false,
      error: 'targetEndTime futuro y durationSeconds (1..3600) requeridos.',
    });
  }

  const validMode: RestAlarmMode =
    mode === 'sound' || mode === 'silent' ? mode : 'vibrate_only';

  if (restEndAlertEnabled === false) {
    return res.status(200).json({
      success: true,
      scheduled: false,
      skipped: true,
      reason: 'restEndAlertEnabled=false',
    });
  }

  const readiness = await getPushReadinessReport(req, deps);
  if (!readiness.readyForLockedScheduledPush || !readiness.appOrigin) {
    return res.status(503).json({
      success: false,
      scheduled: false,
      code: 'LOCKED_PUSH_INFRASTRUCTURE_INCOMPLETE',
      readiness,
      error:
        'Faltan requisitos para programar Web Push persistente con el teléfono bloqueado (no se simula ni se usa temporizador en memoria).',
    });
  }

  const subList = await listAthleteSubscriptions({ athleteId: String(athleteId), rawIdToken, deps });
  if (!subList.ok || subList.subs.length === 0) {
    return res.status(400).json({
      success: false,
      scheduled: false,
      code: 'NO_ACTIVE_PUSH_SUBSCRIPTION',
      readiness,
      error: 'Este atleta aún no tiene ningún dispositivo suscrito a Web Push.',
    });
  }

  const { db } = (deps.getAdminServicesFn || getAdminServices)();

  // Invalidate explicit prior restId + any stale scheduled alarms for this athlete/device
  if (isValidFirestoreId(supersededRestId) && supersededRestId !== restId) {
    await invalidateExistingAlarm({
      athleteId: String(athleteId),
      restId: supersededRestId,
      reason: 'superseded',
      deps,
    }).catch(() => {});
  }

  const existingScheduledSnap = await db
    .collection('athletes')
    .doc(String(athleteId))
    .collection('rest_alarms')
    .where('status', '==', 'scheduled')
    .get();

  for (const docSnap of existingScheduledSnap.docs) {
    if (docSnap.id !== restId) {
      await invalidateExistingAlarm({
        athleteId: String(athleteId),
        restId: docSnap.id,
        reason: 'superseded',
        deps,
      }).catch(() => {});
    }
  }

  const nowIso = new Date(now).toISOString();
  const alarmDoc: StoredRestAlarm = {
    restId,
    athleteId: String(athleteId),
    authUid: user.uid,
    deviceId,
    ...(sessionId ? { sessionId: String(sessionId).slice(0, 128) } : {}),
    ...(exerciseName ? { exerciseName: String(exerciseName).slice(0, 160) } : {}),
    nextSetNumber:
      typeof nextSetNumber === 'number' && Number.isFinite(nextSetNumber) && nextSetNumber > 0
        ? Math.floor(nextSetNumber)
        : null,
    targetEndTime: numericEnd,
    durationSeconds: Math.round(numericDuration),
    status: 'scheduled',
    mode: validMode,
    restEndAlertEnabled: true,
    isTest: Boolean(isTest),
    schedulerProvider: readiness.schedulerProvider,
    dispatchAttemptCount: 0,
    providerAcceptedAt: null,
    providerStatus: null,
    invalidatedReason: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const alarmRef = db
    .collection('athletes')
    .doc(String(athleteId))
    .collection('rest_alarms')
    .doc(restId);

  await alarmRef.set(alarmDoc);

  const taskResult = await enqueuePersistentRestTask({
    schedulerProvider: readiness.schedulerProvider,
    cloudTasksQueuePath: readiness.cloudTasksQueuePath,
    appOrigin: readiness.appOrigin,
    athleteId: String(athleteId),
    restId,
    targetEndTime: numericEnd,
    deps,
  });

  if (!taskResult.ok) {
    await alarmRef.set(
      {
        status: 'failed',
        providerStatus: taskResult.error || 'enqueue_failed',
        updatedAt: new Date((deps.nowFn || Date.now)()).toISOString(),
      },
      { merge: true }
    );
    return res.status(503).json({
      success: false,
      scheduled: false,
      code: 'SCHEDULER_ENQUEUE_FAILED',
      readiness,
      error: taskResult.error || 'No se pudo programar la tarea persistente de aviso.',
    });
  }

  await alarmRef.set(
    {
      schedulerTaskName: taskResult.taskName || '',
      updatedAt: new Date((deps.nowFn || Date.now)()).toISOString(),
    },
    { merge: true }
  );

  return res.status(200).json({
    success: true,
    scheduled: true,
    restId,
    athleteId: String(athleteId),
    targetEndTime: numericEnd,
    schedulerProvider: readiness.schedulerProvider,
    taskName: taskResult.taskName || null,
    message: `Tarea persistente programada (${readiness.schedulerProvider}) para el vencimiento del descanso.`,
  });
}

export async function handleCancelRestPush(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  const rawIdToken = (req as any).rawIdToken as string | undefined;
  if (!user?.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }

  const { athleteId, restId, reason = 'cancelled' } = req.body || {};
  const authCheck = await verifyAthleteOwnerForPush({
    athleteId: String(athleteId || ''),
    user,
    rawIdToken,
    deps,
  });
  if (!authCheck.authorized) {
    return res.status(authCheck.status).json({ success: false, error: authCheck.error });
  }

  const cleanReason: 'paused' | 'cancelled' | 'superseded' =
    reason === 'paused' ? 'paused' : reason === 'superseded' ? 'superseded' : 'cancelled';

  const probe = deps.probeAdminFirestore
    ? await deps.probeAdminFirestore()
    : await probeAdminFirestoreAccess();
  if (!probe.ok) {
    return res.status(200).json({
      success: true,
      cancelled: false,
      skipped: true,
      reason: 'admin_firestore_not_configured',
    });
  }

  if (isValidFirestoreId(restId)) {
    const inv = await invalidateExistingAlarm({
      athleteId: String(athleteId),
      restId,
      reason: cleanReason,
      deps,
    });
    return res.status(200).json({
      success: true,
      cancelled: inv.found,
      restId,
      status: inv.status || cleanReason,
    });
  }

  const { db } = (deps.getAdminServicesFn || getAdminServices)();
  const activeSnap = await db
    .collection('athletes')
    .doc(String(athleteId))
    .collection('rest_alarms')
    .where('status', '==', 'scheduled')
    .get();

  let invalidatedCount = 0;
  for (const docSnap of activeSnap.docs) {
    const r = await invalidateExistingAlarm({
      athleteId: String(athleteId),
      restId: docSnap.id,
      reason: cleanReason,
      deps,
    });
    if (r.found) invalidatedCount += 1;
  }

  return res.status(200).json({
    success: true,
    cancelled: invalidatedCount > 0,
    invalidatedCount,
    status: cleanReason,
  });
}

export async function handleTestImmediatePush(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  const rawIdToken = (req as any).rawIdToken as string | undefined;
  if (!user?.uid) {
    return res.status(401).json({ success: false, error: 'Autenticación requerida.' });
  }

  const {
    athleteId,
    deviceId,
    exerciseName,
    nextSetNumber,
    mode = 'vibrate_only',
  } = req.body || {};

  const authCheck = await verifyAthleteOwnerForPush({
    athleteId: String(athleteId || ''),
    user,
    rawIdToken,
    deps,
  });
  if (!authCheck.authorized) {
    return res.status(authCheck.status).json({ success: false, error: authCheck.error });
  }

  const readiness = await getPushReadinessReport(req, deps);
  if (!readiness.vapidConfigured) {
    return res.status(503).json({
      success: false,
      providerAccepted: false,
      code: 'VAPID_NOT_CONFIGURED',
      readiness,
      error: 'Faltan VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY en el servidor para enviar Web Push.',
    });
  }

  const subList = await listAthleteSubscriptions({
    athleteId: String(athleteId),
    rawIdToken,
    deps,
  });

  if (!subList.ok || subList.subs.length === 0) {
    return res.status(400).json({
      success: false,
      providerAccepted: false,
      code: 'NO_ACTIVE_PUSH_SUBSCRIPTION',
      readiness,
      error: 'No hay suscripción Web Push guardada para este atleta/dispositivo. Activa primero las notificaciones push en este dispositivo.',
    });
  }

  const targetSubs = isValidFirestoreId(deviceId)
    ? subList.subs.filter((s) => s.deviceId === deviceId)
    : subList.subs;
  const effectiveSubs = targetSubs.length > 0 ? targetSubs : subList.subs;

  const appOrigin = readiness.appOrigin || resolveAppHttpsOrigin(req, deps.getEnv);
  if (!appOrigin) {
    return res.status(503).json({
      success: false,
      providerAccepted: false,
      code: 'APP_URL_NOT_CONFIGURED',
      error: 'APP_URL no configurado o inválido. Define APP_URL con la URL HTTPS pública del backend.',
    });
  }

  const restId = `testnow-${(deps.nowFn || Date.now)()}-${crypto.randomBytes(3).toString('hex')}`;
  const validMode: RestAlarmMode =
    mode === 'sound' || mode === 'silent' ? mode : 'vibrate_only';

  const payloadJson = buildWebPushNotificationPayload({
    athleteId: String(athleteId),
    restId,
    targetEndTime: (deps.nowFn || Date.now)(),
    exerciseName: typeof exerciseName === 'string' ? exerciseName : undefined,
    nextSetNumber: typeof nextSetNumber === 'number' ? nextSetNumber : null,
    mode: validMode,
    isTest: true,
    appOrigin,
  });

  const dispatchResult = await sendWebPushToSubscriptions({
    subs: effectiveSubs,
    payloadJson,
    athleteId: String(athleteId),
    deps,
    disableDeadSubscription: async (deadId) => {
      await deleteAthleteSubscription({
        athleteId: String(athleteId),
        deviceId: deadId,
        rawIdToken,
        deps,
      });
    },
  });

  const providerAccepted = dispatchResult.acceptedCount > 0;
  return res.status(providerAccepted ? 200 : 502).json({
    success: providerAccepted,
    providerAccepted,
    restId,
    acceptedCount: dispatchResult.acceptedCount,
    failedCount: dispatchResult.failedCount,
    results: dispatchResult.results,
    message: providerAccepted
      ? 'Envío aceptado por el proveedor Web Push (FCM/navegador). La recepción en el teléfono y el reflejo en el reloj Honor dependen de la red y del sistema Android/Honor Salud.'
      : 'El proveedor Web Push rechazó el envío para todas las suscripciones activas.',
  });
}

export async function handleTestScheduled60sPush(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const now = (deps.nowFn || Date.now)();
  const restId = `test60s-${now}-${crypto.randomBytes(3).toString('hex')}`;
  req.body = {
    ...(req.body || {}),
    restId,
    durationSeconds: 60,
    targetEndTime: now + 60_000,
    isTest: true,
  };
  return handleScheduleRestPush(req, res, deps);
}

export async function handleDispatchRestAlarmWebhook(
  req: Request,
  res: Response,
  deps: PushControllerDeps = {}
) {
  const getEnv = deps.getEnv || defaultGetEnv;
  const expectedSecret = (getEnv('PUSH_DISPATCH_SECRET') || '').trim();
  const providedSecret = String(
    req.headers['x-lazcakon-push-secret'] ||
      req.headers['X-Lazcakon-Push-Secret'] ||
      ''
  ).trim();

  if (!expectedSecret || expectedSecret.length < 16) {
    return res.status(503).json({
      success: false,
      error: 'PUSH_DISPATCH_SECRET no configurado en el servidor.',
    });
  }

  if (!providedSecret || !constantTimeCompare(providedSecret, expectedSecret)) {
    return res.status(401).json({
      success: false,
      error: 'Firma/secreto de tarea diferida inválido o ausente.',
    });
  }

  const { athleteId, restId, targetEndTime } = req.body || {};
  if (!isValidFirestoreId(athleteId) || !isValidFirestoreId(restId)) {
    return res.status(400).json({
      success: false,
      error: 'athleteId y restId válidos son obligatorios.',
    });
  }

  const { db } = (deps.getAdminServicesFn || getAdminServices)();
  const alarmRef = db
    .collection('athletes')
    .doc(athleteId)
    .collection('rest_alarms')
    .doc(restId);

  const now = (deps.nowFn || Date.now)();

  // Atomic transaction ensures strictly-once dispatch & vigency verification
  const claimResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(alarmRef);
    if (!snap.exists) {
      return { proceed: false, reason: 'not_found' as const };
    }
    const alarm = snap.data() as StoredRestAlarm;
    if (alarm.athleteId !== athleteId || alarm.restId !== restId) {
      return { proceed: false, reason: 'identity_mismatch' as const };
    }
    if (alarm.status !== 'scheduled') {
      return { proceed: false, reason: `status_${alarm.status}` as const, alarm };
    }
    if (alarm.restEndAlertEnabled === false) {
      return { proceed: false, reason: 'alerts_disabled' as const, alarm };
    }
    if (
      typeof targetEndTime === 'number' &&
      Number.isFinite(targetEndTime) &&
      alarm.targetEndTime !== targetEndTime
    ) {
      return { proceed: false, reason: 'target_end_time_mismatch' as const, alarm };
    }

    tx.set(
      alarmRef,
      {
        status: 'sent',
        dispatchAttemptCount: (alarm.dispatchAttemptCount || 0) + 1,
        updatedAt: new Date(now).toISOString(),
      },
      { merge: true }
    );
    return { proceed: true, alarm };
  });

  if (!claimResult.proceed || !claimResult.alarm) {
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: claimResult.reason,
      restId,
    });
  }

  const serverExecutionTime = (deps.nowFn || Date.now)();
  const scheduledTime = claimResult.alarm.targetEndTime;
  const deltaMs = serverExecutionTime - scheduledTime;
  console.log(
    `[PushDispatch Timing] restId: ${restId}, athleteId: ${athleteId}, scheduledTime: ${new Date(scheduledTime).toISOString()}, serverExecutionTime: ${new Date(serverExecutionTime).toISOString()}, deltaMs: ${deltaMs}`
  );

  const alarm = claimResult.alarm;
  const subList = await listAthleteSubscriptions({ athleteId, deps });
  if (!subList.ok || subList.subs.length === 0) {
    await alarmRef.set(
      {
        status: 'failed',
        providerStatus: 'no_active_subscriptions',
        updatedAt: new Date((deps.nowFn || Date.now)()).toISOString(),
      },
      { merge: true }
    );
    return res.status(200).json({
      success: false,
      providerAccepted: false,
      skipped: true,
      reason: 'no_active_subscriptions',
      restId,
    });
  }

  const appOrigin = resolveAppHttpsOrigin(req, getEnv);
  if (!appOrigin) {
    return res.status(503).json({
      success: false,
      error: 'APP_URL no configurado o inválido. Define APP_URL con la URL HTTPS pública del backend.',
    });
  }

  const payloadJson = buildWebPushNotificationPayload({
    athleteId,
    restId,
    targetEndTime: alarm.targetEndTime,
    exerciseName: alarm.exerciseName,
    nextSetNumber: alarm.nextSetNumber ?? null,
    mode: alarm.mode || 'vibrate_only',
    isTest: Boolean(alarm.isTest),
    appOrigin,
  });

  try {
    const dispatchResult = await sendWebPushToSubscriptions({
      subs: subList.subs,
      payloadJson,
      athleteId,
      deps,
      disableDeadSubscription: async (deadId) => {
        await db
          .collection('athletes')
          .doc(athleteId)
          .collection('push_subscriptions')
          .doc(deadId)
          .set({ enabled: false, updatedAt: new Date().toISOString() }, { merge: true });
      },
    });

    const providerAccepted = dispatchResult.acceptedCount > 0;
    const providerAcceptedAt = providerAccepted
      ? new Date((deps.nowFn || Date.now)()).toISOString()
      : null;

    await alarmRef.set(
      {
        status: providerAccepted ? 'sent' : 'failed',
        providerAcceptedAt,
        providerStatus: `accepted:${dispatchResult.acceptedCount},failed:${dispatchResult.failedCount}`,
        updatedAt: new Date((deps.nowFn || Date.now)()).toISOString(),
      },
      { merge: true }
    );

    return res.status(200).json({
      success: providerAccepted,
      providerAccepted,
      restId,
      acceptedCount: dispatchResult.acceptedCount,
      failedCount: dispatchResult.failedCount,
    });
  } catch (err: any) {
    await alarmRef.set(
      {
        status: 'failed',
        providerStatus: String(err?.message || 'web_push_error').slice(0, 150),
        updatedAt: new Date((deps.nowFn || Date.now)()).toISOString(),
      },
      { merge: true }
    );
    return res.status(500).json({
      success: false,
      providerAccepted: false,
      error: err?.message || 'Error enviando Web Push.',
    });
  }
}
