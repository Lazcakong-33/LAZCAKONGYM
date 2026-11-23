import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  getPushReadinessReport,
  handleCancelRestPush,
  handleDispatchRestAlarmWebhook,
  handleGetPushConfig,
  handleScheduleRestPush,
  handleSubscribePush,
  handleTestImmediatePush,
  handleTestScheduled60sPush,
  type PushControllerDeps,
} from '../pushController.ts';

function createMockFirestore() {
  const store = new Map<string, Record<string, any>>();

  function matchWhere(data: Record<string, any>, filters: Array<{ field: string; op: string; value: any }>) {
    return filters.every((f) => f.op === '==' && data[f.field] === f.value);
  }

  function docRef(docPath: string) {
    return {
      path: docPath,
      id: docPath.split('/').pop() || '',
      async get() {
        const data = store.get(docPath);
        return {
          exists: Boolean(data),
          id: docPath.split('/').pop() || '',
          data: () => (data ? { ...data } : undefined),
        };
      },
      async set(data: Record<string, any>, opts?: { merge?: boolean }) {
        if (opts?.merge) {
          const prev = store.get(docPath) || {};
          store.set(docPath, { ...prev, ...data });
        } else {
          store.set(docPath, { ...data });
        }
      },
      async delete() {
        store.delete(docPath);
      },
      collection(subName: string) {
        return collectionRef(`${docPath}/${subName}`);
      },
    };
  }

  function collectionRef(colPath: string, filters: Array<{ field: string; op: string; value: any }> = []) {
    return {
      doc(id: string) {
        return docRef(`${colPath}/${id}`);
      },
      where(field: string, op: string, value: any) {
        return collectionRef(colPath, [...filters, { field, op, value }]);
      },
      orderBy() {
        return this;
      },
      limit() {
        return this;
      },
      async get() {
        const prefix = `${colPath}/`;
        const docs = Array.from(store.entries())
          .filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/'))
          .filter(([, v]) => matchWhere(v, filters))
          .map(([k, v]) => ({
            id: k.slice(prefix.length),
            exists: true,
            data: () => ({ ...v }),
          }));
        return { empty: docs.length === 0, docs };
      },
    };
  }

  const db = {
    collection(name: string) {
      return collectionRef(name);
    },
    async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      const tx = {
        get: (ref: any) => ref.get(),
        set: (ref: any, data: Record<string, any>, opts?: { merge?: boolean }) => ref.set(data, opts),
      };
      return fn(tx);
    },
  };

  return { store, db };
}

function makeReqRes(options: {
  body?: Record<string, any>;
  query?: Record<string, any>;
  headers?: Record<string, string>;
  user?: { uid: string; email?: string; isAdmin?: boolean };
} = {}) {
  const req = {
    body: options.body || {},
    query: options.query || {},
    headers: options.headers || {},
    protocol: 'https',
    get: (h: string) => (h.toLowerCase() === 'host' ? 'lazcakongym.example.app' : ''),
    user: options.user,
    rawIdToken: 'mock-id-token',
  } as unknown as Request;

  let statusCode = 200;
  let jsonBody: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      jsonBody = payload;
      return this;
    },
  } as unknown as Response;

  return {
    req,
    res,
    result: () => ({ status: statusCode, body: jsonBody }),
  };
}

let passed = 0;
async function runCase(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

async function runTests() {
  // 1. Unconfigured environment reports exact missing keys and returns HTTP 503 instead of simulating in-memory timers
  await runCase('1. Entorno incompleto informa exactamente claves faltantes y devuelve 503 sin simular timers en memoria', async () => {
    const mockFs = createMockFirestore();
    await mockFs.db.collection('athletes').doc('ath_1').set({ authUid: 'uid_1', name: 'Atleta Uno' });

    const depsUnconfigured: PushControllerDeps = {
      getEnv: (name) => (name === 'APP_URL' ? 'https://preview.lazcakon.app' : undefined),
      probeAdminFirestore: async () => ({ ok: false, error: 'PERMISSION_DENIED' }),
      getAdminServicesFn: () => ({ db: mockFs.db as any } as any),
    };

    const readiness = await getPushReadinessReport(undefined, depsUnconfigured);
    assert.equal(readiness.readyForImmediatePush, false);
    assert.equal(readiness.readyForLockedScheduledPush, false);
    const missingKeys = readiness.missingRequirements.map((r) => r.key);
    assert.ok(missingKeys.some((k) => k.includes('VAPID_PUBLIC_KEY')));
    assert.ok(missingKeys.some((k) => k.includes('IAM_FIRESTORE_ADC')));
    assert.ok(missingKeys.some((k) => k.includes('PUSH_DISPATCH_SECRET')));
    assert.ok(missingKeys.some((k) => k.includes('CLOUD_TASKS_QUEUE_PATH')));

    // /api/push/config exposes honest readiness
    const cfgCtx = makeReqRes();
    await handleGetPushConfig(cfgCtx.req, cfgCtx.res, depsUnconfigured);
    assert.equal(cfgCtx.result().status, 200);
    assert.equal(cfgCtx.result().body.readyForLockedScheduledPush, false);

    // /api/push/schedule-rest refuses to simulate when persistent scheduler / Admin Firestore is absent
    const schedCtx = makeReqRes({
      user: { uid: 'uid_1' },
      body: {
        athleteId: 'ath_1',
        restId: 'rest-unconf-1',
        deviceId: 'dev-1',
        targetEndTime: Date.now() + 60000,
        durationSeconds: 60,
        mode: 'vibrate_only',
        restEndAlertEnabled: true,
      },
    });
    await handleScheduleRestPush(schedCtx.req, schedCtx.res, depsUnconfigured);
    assert.equal(schedCtx.result().status, 503);
    assert.equal(schedCtx.result().body.scheduled, false);
    assert.equal(schedCtx.result().body.code, 'LOCKED_PUSH_INFRASTRUCTURE_INCOMPLETE');
  });

  // Setup fully configured test environment with mocked Cloud Tasks + web-push transport
  const envMap: Record<string, string> = {
    APP_URL: 'https://preview.lazcakon.app',
    VAPID_PUBLIC_KEY: 'BElocalPublicKeyMock1234567890',
    VAPID_PRIVATE_KEY: 'localPrivateKeyMock1234567890',
    VAPID_SUBJECT: 'mailto:kmiloko19@gmail.com',
    PUSH_DISPATCH_SECRET: 'super-secret-dispatch-token-12345',
    CLOUD_TASKS_QUEUE_PATH: 'projects/forward-cortex-1ds98/locations/us-east1/queues/lazcakon-rest-push',
  };

  // 2. Ownership & webhook secret enforcement
  await runCase('2. Aislamiento por atleta autenticado (401/403) y validación de secreto del webhook', async () => {
    const mockFs = createMockFirestore();
    await mockFs.db.collection('athletes').doc('ath_1').set({ authUid: 'uid_1', name: 'Atleta Uno' });
    await mockFs.db.collection('athletes').doc('ath_2').set({ authUid: 'uid_2', name: 'Atleta Dos' });

    const deps: PushControllerDeps = {
      getEnv: (k) => envMap[k],
      probeAdminFirestore: async () => ({ ok: true }),
      getAdminServicesFn: () => ({ db: mockFs.db as any } as any),
    };

    // Unauthenticated subscribe -> 401
    const unauthCtx = makeReqRes({
      body: { athleteId: 'ath_1', deviceId: 'dev-1' },
    });
    await handleSubscribePush(unauthCtx.req, unauthCtx.res, deps);
    assert.equal(unauthCtx.result().status, 401);

    // Cross-athlete schedule -> 403
    const crossCtx = makeReqRes({
      user: { uid: 'uid_2', isAdmin: false },
      body: {
        athleteId: 'ath_1',
        restId: 'rest-cross-1',
        deviceId: 'dev-1',
        targetEndTime: Date.now() + 30000,
        durationSeconds: 30,
      },
    });
    await handleScheduleRestPush(crossCtx.req, crossCtx.res, deps);
    assert.equal(crossCtx.result().status, 403);

    // Webhook without or with wrong secret -> 401
    const badHook = makeReqRes({
      headers: { 'x-lazcakon-push-secret': 'wrong-secret' },
      body: { athleteId: 'ath_1', restId: 'rest-1' },
    });
    await handleDispatchRestAlarmWebhook(badHook.req, badHook.res, deps);
    assert.equal(badHook.result().status, 401);
  });

  // 3. Full Cloud Tasks persistent scheduling + pause/cancel/restart invalidation + vigency verification + deduplicated dispatch
  await runCase('3. Cola persistente Cloud Tasks, invalidación al pausar/cancelar/reiniciar y verificación de vigencia antes de enviar', async () => {
    const mockFs = createMockFirestore();
    await mockFs.db.collection('athletes').doc('ath_1').set({ authUid: 'uid_1', name: 'Atleta Uno' });

    const cloudTaskCalls: Array<{ method: string; url: string; body?: any }> = [];
    const pushedMessages: Array<{ endpoint: string; payload: any; options: any }> = [];

    const deps: PushControllerDeps = {
      getEnv: (k) => envMap[k],
      probeAdminFirestore: async () => ({ ok: true }),
      getAdminServicesFn: () => ({ db: mockFs.db as any } as any),
      getGoogleAccessToken: async () => 'mock-oauth-access-token',
      fetchFn: (async (url: string, init?: RequestInit) => {
        const method = String(init?.method || 'GET').toUpperCase();
        const parsedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
        cloudTaskCalls.push({ method, url: String(url), body: parsedBody });
        if (method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({ name: parsedBody?.task?.name || 'projects/mock/tasks/task1' }),
            text: async () => '',
          } as any;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '',
        } as any;
      }) as typeof fetch,
      sendWebPush: async (sub, payloadJson, options) => {
        pushedMessages.push({
          endpoint: sub.endpoint,
          payload: JSON.parse(payloadJson),
          options,
        });
        return { statusCode: 201 };
      },
    };

    // a) Subscribe device
    const subCtx = makeReqRes({
      user: { uid: 'uid_1' },
      body: {
        athleteId: 'ath_1',
        deviceId: 'honor-400-pro',
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/mock-honor-token',
          keys: {
            p256dh: 'BMockP256dhKey1234567890abcdef',
            auth: 'MockAuth12345678',
          },
        },
      },
    });
    await handleSubscribePush(subCtx.req, subCtx.res, deps);
    assert.equal(subCtx.result().status, 200);
    assert.equal(subCtx.result().body.subscribed, true);

    // b) Schedule first restId ('rest-A')
    const targetA = Date.now() + 90_000;
    const schedA = makeReqRes({
      user: { uid: 'uid_1' },
      body: {
        athleteId: 'ath_1',
        restId: 'rest-A',
        deviceId: 'honor-400-pro',
        exerciseName: 'Press de Banca',
        nextSetNumber: 2,
        targetEndTime: targetA,
        durationSeconds: 90,
        mode: 'vibrate_only',
        restEndAlertEnabled: true,
      },
    });
    await handleScheduleRestPush(schedA.req, schedA.res, deps);
    assert.equal(schedA.result().status, 200);
    assert.equal(schedA.result().body.scheduled, true);
    assert.equal(schedA.result().body.schedulerProvider, 'cloud_tasks');
    assert.equal(cloudTaskCalls.length, 1);
    assert.equal(cloudTaskCalls[0].method, 'POST');
    const decodedTaskPayload = JSON.parse(
      Buffer.from(cloudTaskCalls[0].body.task.httpRequest.body, 'base64').toString('utf8')
    );
    assert.equal(decodedTaskPayload.restId, 'rest-A');

    // c) Pause rest-A -> invalidates Firestore doc as 'paused' & deletes Cloud Tasks task
    const pauseCtx = makeReqRes({
      user: { uid: 'uid_1' },
      body: { athleteId: 'ath_1', restId: 'rest-A', reason: 'paused' },
    });
    await handleCancelRestPush(pauseCtx.req, pauseCtx.res, deps);
    assert.equal(pauseCtx.result().status, 200);
    assert.equal(pauseCtx.result().body.cancelled, true);
    assert.equal(pauseCtx.result().body.status, 'paused');
    assert.equal(mockFs.store.get('athletes/ath_1/rest_alarms/rest-A')?.status, 'paused');
    assert.ok(cloudTaskCalls.some((c) => c.method === 'DELETE' && c.url.includes('rest-A')));

    // If stale webhook arrives for paused 'rest-A', must skip and send ZERO Web Push
    const staleHook = makeReqRes({
      headers: { 'x-lazcakon-push-secret': envMap.PUSH_DISPATCH_SECRET },
      body: { athleteId: 'ath_1', restId: 'rest-A', targetEndTime: targetA },
    });
    await handleDispatchRestAlarmWebhook(staleHook.req, staleHook.res, deps);
    assert.equal(staleHook.result().status, 200);
    assert.equal(staleHook.result().body.skipped, true);
    assert.equal(staleHook.result().body.reason, 'status_paused');
    assert.equal(pushedMessages.length, 0);

    // d) Resume / start rest-B then immediately restart with rest-C -> rest-B becomes 'superseded'
    const targetB = Date.now() + 60_000;
    const schedB = makeReqRes({
      user: { uid: 'uid_1' },
      body: {
        athleteId: 'ath_1',
        restId: 'rest-B',
        deviceId: 'honor-400-pro',
        exerciseName: 'Press de Banca',
        nextSetNumber: 2,
        targetEndTime: targetB,
        durationSeconds: 60,
        mode: 'vibrate_only',
        restEndAlertEnabled: true,
      },
    });
    await handleScheduleRestPush(schedB.req, schedB.res, deps);
    assert.equal(schedB.result().body.scheduled, true);

    const targetC = Date.now() + 90_000;
    const schedC = makeReqRes({
      user: { uid: 'uid_1' },
      body: {
        athleteId: 'ath_1',
        restId: 'rest-C',
        deviceId: 'honor-400-pro',
        exerciseName: 'Press de Banca',
        nextSetNumber: 3,
        targetEndTime: targetC,
        durationSeconds: 90,
        mode: 'vibrate_only',
        restEndAlertEnabled: true,
        supersededRestId: 'rest-B',
      },
    });
    await handleScheduleRestPush(schedC.req, schedC.res, deps);
    assert.equal(schedC.result().body.scheduled, true);
    assert.equal(mockFs.store.get('athletes/ath_1/rest_alarms/rest-B')?.status, 'superseded');

    // e) Valid webhook for rest-C sends 1 Web Push with exact branding, vibration pattern, and high urgency
    const hookC = makeReqRes({
      headers: { 'x-lazcakon-push-secret': envMap.PUSH_DISPATCH_SECRET },
      body: { athleteId: 'ath_1', restId: 'rest-C', targetEndTime: targetC },
    });
    await handleDispatchRestAlarmWebhook(hookC.req, hookC.res, deps);
    assert.equal(hookC.result().status, 200);
    assert.equal(hookC.result().body.providerAccepted, true);
    assert.equal(pushedMessages.length, 1);
    assert.equal(pushedMessages[0].options.urgency, 'high');
    assert.equal(pushedMessages[0].payload.title, 'LAZCAKONG · DESCANSO TERMINADO');
    assert.equal(pushedMessages[0].payload.body, 'Siguiente serie: Press de Banca · Serie 3');
    assert.equal(pushedMessages[0].payload.icon, 'https://preview.lazcakon.app/notification-icon-192.png');
    assert.equal(pushedMessages[0].payload.badge, 'https://preview.lazcakon.app/notification-badge-gorilla.png');
    assert.deepEqual(pushedMessages[0].payload.vibrate, [600, 250, 600, 250, 600]);
    assert.equal(pushedMessages[0].payload.silent, false);

    // f) Duplicate webhook retry for already-sent rest-C -> skipped, sends ZERO additional pushes
    const hookCRetry = makeReqRes({
      headers: { 'x-lazcakon-push-secret': envMap.PUSH_DISPATCH_SECRET },
      body: { athleteId: 'ath_1', restId: 'rest-C', targetEndTime: targetC },
    });
    await handleDispatchRestAlarmWebhook(hookCRetry.req, hookCRetry.res, deps);
    assert.equal(hookCRetry.result().body.skipped, true);
    assert.equal(hookCRetry.result().body.reason, 'status_sent');
    assert.equal(pushedMessages.length, 1);
  });

  // 4. Immediate test & 60s scheduled push test + zero setTimeout in pushController.ts
  await runCase('4. Prueba push inmediata, prueba programada 60 s y cero setTimeout/setInterval en pushController.ts', async () => {
    const controllerSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/server/pushController.ts'), 'utf8');
    assert.equal(
      /\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(controllerSrc),
      false,
      'pushController.ts must NOT use in-memory setTimeout or setInterval'
    );

    const mockFs = createMockFirestore();
    await mockFs.db.collection('athletes').doc('ath_1').set({ authUid: 'uid_1', name: 'Atleta Uno' });
    await mockFs.db.collection('athletes').doc('ath_1').collection('push_subscriptions').doc('dev-1').set({
      deviceId: 'dev-1',
      athleteId: 'ath_1',
      authUid: 'uid_1',
      endpoint: 'https://fcm.googleapis.com/fcm/send/mock-dev-1',
      keys: { p256dh: 'BMockP256dhKey1234567890abcdef', auth: 'MockAuth12345678' },
      enabled: true,
    });

    const pushed: any[] = [];
    const scheduled60sTasks: any[] = [];
    const deps: PushControllerDeps = {
      getEnv: (k) => envMap[k],
      probeAdminFirestore: async () => ({ ok: true }),
      getAdminServicesFn: () => ({ db: mockFs.db as any } as any),
      getGoogleAccessToken: async () => 'mock-token',
      fetchFn: (async (_url: string, init?: RequestInit) => {
        const parsed = init?.body ? JSON.parse(String(init.body)) : undefined;
        scheduled60sTasks.push(parsed);
        return {
          ok: true,
          status: 200,
          json: async () => ({ name: parsed?.task?.name || 'task-60s' }),
          text: async () => '',
        } as any;
      }) as typeof fetch,
      sendWebPush: async (_sub, payloadJson) => {
        pushed.push(JSON.parse(payloadJson));
        return { statusCode: 201 };
      },
    };

    const immCtx = makeReqRes({
      user: { uid: 'uid_1' },
      body: { athleteId: 'ath_1', deviceId: 'dev-1', mode: 'vibrate_only' },
    });
    await handleTestImmediatePush(immCtx.req, immCtx.res, deps);
    assert.equal(immCtx.result().status, 200);
    assert.equal(immCtx.result().body.providerAccepted, true);
    assert.equal(pushed.length, 1);
    assert.equal(pushed[0].isTest, true);
    assert.equal(pushed[0].title, 'LAZCAKONG · DESCANSO TERMINADO');

    const sched60Ctx = makeReqRes({
      user: { uid: 'uid_1' },
      body: { athleteId: 'ath_1', deviceId: 'dev-1', mode: 'vibrate_only' },
    });
    await handleTestScheduled60sPush(sched60Ctx.req, sched60Ctx.res, deps);
    assert.equal(sched60Ctx.result().status, 200);
    assert.equal(sched60Ctx.result().body.scheduled, true);
    assert.match(sched60Ctx.result().body.restId, /^test60s-/);
    assert.equal(scheduled60sTasks.length, 1);
  });

  console.log(`\nALL ${passed} WEB PUSH REST SCHEDULER SUITE TESTS PASSED.`);
}

runTests().catch((err) => {
  console.error('WEB PUSH REST SUITE FAILED:', err);
  process.exit(1);
});
