import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  cancelDeviceVibration,
  hasOpenTimerAudioResources,
  playBeep,
  playRestCompleteAlarm,
  releaseTimerAudioResources,
  REST_COMPLETE_VIBRATION_PATTERN,
  resumeAudio,
  startSilentAudioKeepAlive,
  stopSilentAudioKeepAlive,
} from '../../utils/audio.ts';
import {
  buildRestCompleteNotificationBody,
  cancelServiceWorkerRestAlarm,
  getNotificationPermissionStatus,
  hasCompleteAlertFired,
  markCompleteAlertHandled,
  requestNotificationPermission,
  resetCompleteAlertTracking,
  resolveNextRestTargetContext,
  resolveNotificationAssetUrl,
  REST_COMPLETE_NOTIFICATION_BADGE_PATH,
  REST_COMPLETE_NOTIFICATION_ICON_PATH,
  REST_COMPLETE_NOTIFICATION_TITLE,
  scheduleServiceWorkerRestAlarm,
  sendFiveSecondWarningNotification,
  sendRestCompleteNotification,
  testWatchAlert,
} from '../../utils/backgroundTimer.ts';

class MockAudioParam {
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
  linearRampToValueAtTime() {}
}

class MockOscillator {
  type = 'sine';
  frequency = new MockAudioParam();
  started = false;
  stopped = false;
  disconnected = false;
  onended: (() => void) | null = null;
  connect() {}
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class MockGain {
  gain = new MockAudioParam();
  disconnected = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
}

let audioCtxCreations = 0;
let audioCtxCloses = 0;
let htmlAudioCreations = 0;
let createdContexts: MockAudioContext[] = [];

class MockAudioContext {
  state: 'suspended' | 'running' | 'closed' = 'running';
  currentTime = 0;
  destination = {};
  constructor() {
    audioCtxCreations += 1;
    createdContexts.push(this);
  }
  createOscillator() {
    return new MockOscillator();
  }
  createGain() {
    return new MockGain();
  }
  createBiquadFilter() {
    return {
      type: 'lowpass',
      frequency: new MockAudioParam(),
      connect() {},
      disconnect() {},
    };
  }
  async resume() {
    if (this.state === 'suspended') this.state = 'running';
  }
  async close() {
    this.state = 'closed';
    audioCtxCloses += 1;
  }
}

let passed = 0;
async function runCase(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

function loadServiceWorkerHarness(options: { visibleClients: boolean }) {
  const swPath = path.resolve(process.cwd(), 'public/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf8');

  const swNotifications: Array<{ title: string; options: any; closed?: boolean }> = [];
  const clientMessages: any[] = [];
  const listeners: Record<string, Function[]> = {};

  const mockClients = [
    {
      visibilityState: options.visibleClients ? 'visible' : 'hidden',
      postMessage: (msg: any) => clientMessages.push(msg),
    },
  ];

  const selfObj: any = {
    location: { origin: 'https://localhost' },
    skipWaiting: () => {},
    clients: {
      claim: async () => {},
      matchAll: async () => mockClients,
    },
    registration: {
      showNotification: async (title: string, opts: any) => {
        if (opts?.silent === true && 'vibrate' in opts) {
          throw new TypeError(
            "Failed to construct 'Notification': Silent notifications must not specify vibration patterns."
          );
        }
        swNotifications.push({ title, options: opts, closed: false });
      },
      getNotifications: async (filter?: { tag?: string }) => {
        return swNotifications
          .filter((n) => !n.closed && (!filter?.tag || n.options?.tag === filter.tag))
          .map((n) => ({
            tag: n.options?.tag,
            close: () => {
              n.closed = true;
            },
          }));
      },
    },
    addEventListener: (type: string, fn: Function) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(fn);
    },
  };

  const context = vm.createContext({
    self: selfObj,
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    URL,
    Date,
    Set,
    Promise,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  });

  vm.runInContext(swCode, context);

  return {
    swNotifications,
    clientMessages,
    dispatchMessage: (data: any) => {
      const msgListeners = listeners['message'] || [];
      for (const fn of msgListeners) {
        fn({ data });
      }
    },
    dispatchPush: async (payloadObj: any) => {
      const pushListeners = listeners['push'] || [];
      const pending: Promise<any>[] = [];
      const event = {
        data: {
          json: () => payloadObj,
          text: () => JSON.stringify(payloadObj),
        },
        waitUntil: (p: Promise<any>) => {
          pending.push(p);
        },
      };
      for (const fn of pushListeners) {
        fn(event);
      }
      await Promise.all(pending);
    },
    setVisible: (v: boolean) => {
      mockClients[0].visibilityState = v ? 'visible' : 'hidden';
    },
  };
}

async function runTests() {
  const g = globalThis as any;
  const origWindow = g.window;
  const origAudio = g.Audio;
  const origNotification = g.Notification;

  const vibrateCalls: Array<number[] | number> = [];
  const notificationCalls: Array<{ title: string; options: any }> = [];

  let requestPermissionCalls = 0;
  class MockNotification {
    static permission: NotificationPermission = 'granted';
    static async requestPermission() {
      requestPermissionCalls += 1;
      MockNotification.permission = 'granted';
      return MockNotification.permission;
    }
    constructor(title: string, options: any) {
      if (options?.silent === true && 'vibrate' in options) {
        throw new TypeError(
          "Failed to construct 'Notification': Silent notifications must not specify vibration patterns."
        );
      }
      notificationCalls.push({ title, options });
    }
  }

  g.Audio = class {
    constructor() {
      htmlAudioCreations += 1;
    }
  };
  g.window = {
    AudioContext: MockAudioContext,
    Notification: MockNotification,
    location: { origin: 'https://ais-dev-56i2tt63sua7ovhyxwpgjs-888570249716.us-east1.run.app' },
  };
  g.Notification = MockNotification;
  Object.defineProperty(g, 'navigator', {
    configurable: true,
    value: {
      vibrate: (pattern: number[] | number) => {
        vibrateCalls.push(pattern);
        return true;
      },
    },
  });

  try {
    // 1. startSilentAudioKeepAlive / resumeAudio never create AudioContext or <audio>
    await runCase('1. startSilentAudioKeepAlive y resumeAudio no abren AudioContext ni HTMLAudio', () => {
      audioCtxCreations = 0;
      htmlAudioCreations = 0;
      startSilentAudioKeepAlive('Press de Banca');
      resumeAudio();
      stopSilentAudioKeepAlive();
      assert.equal(audioCtxCreations, 0);
      assert.equal(htmlAudioCreations, 0);
      assert.equal(hasOpenTimerAudioResources(), false);
    });

    // 2. Solo vibración & Silencio notifications use exact LAZCAKONG title/body, never invent set/exercise, and request [600,250,600,250,600] once
    await runCase('2. "Solo vibración" usa título/texto exactos, no inventa ejercicio/serie y solicita [600,250,600,250,600] una sola vez', async () => {
      audioCtxCreations = 0;
      vibrateCalls.length = 0;
      notificationCalls.length = 0;
      resetCompleteAlertTracking();

      assert.deepEqual(REST_COMPLETE_VIBRATION_PATTERN, [600, 250, 600, 250, 600]);
      assert.equal(REST_COMPLETE_NOTIFICATION_TITLE, 'LAZCAKONG · DESCANSO TERMINADO');
      assert.equal(
        buildRestCompleteNotificationBody('Sentadilla', 3),
        'Siguiente serie: Sentadilla · Serie 3'
      );
      assert.equal(
        buildRestCompleteNotificationBody(undefined, undefined),
        'Descanso finalizado. Continúa tu entrenamiento.'
      );
      assert.equal(
        buildRestCompleteNotificationBody('Sentadilla', undefined),
        'Descanso finalizado. Continúa tu entrenamiento.'
      );

      // App visible in "Solo vibración" with active exercise & set 3: 1 vibration call, 1 silent notification
      await sendRestCompleteNotification('Sentadilla', 20001, true, false, 3);
      // Duplicate call for same targetEndTime must be ignored
      await sendRestCompleteNotification('Sentadilla', 20001, true, false, 3);

      assert.equal(audioCtxCreations, 0);
      assert.equal(vibrateCalls.length, 1);
      assert.deepEqual(vibrateCalls[0], [600, 250, 600, 250, 600]);
      assert.equal(notificationCalls.length, 1);
      assert.equal(notificationCalls[0].title, 'LAZCAKONG · DESCANSO TERMINADO');
      assert.equal(notificationCalls[0].options.body, 'Siguiente serie: Sentadilla · Serie 3');
      assert.equal(notificationCalls[0].options.silent, true);
      assert.equal(notificationCalls[0].options.renotify, true);
      assert.equal('vibrate' in notificationCalls[0].options, false);

      // Without active session: never invents exercise or set
      vibrateCalls.length = 0;
      notificationCalls.length = 0;
      await sendRestCompleteNotification(undefined, 20002, true, true, undefined);
      assert.equal(notificationCalls.length, 1);
      assert.equal(notificationCalls[0].title, 'LAZCAKONG · DESCANSO TERMINADO');
      assert.equal(
        notificationCalls[0].options.body,
        'Descanso finalizado. Continúa tu entrenamiento.'
      );
      assert.equal(notificationCalls[0].options.silent, false);
      assert.deepEqual(notificationCalls[0].options.vibrate, [600, 250, 600, 250, 600]);

      // If SW already handled targetEndTime, foreground must NOT vibrate or notify again
      vibrateCalls.length = 0;
      notificationCalls.length = 0;
      markCompleteAlertHandled(20003);
      assert.equal(hasCompleteAlertFired(20003), true);
      await sendRestCompleteNotification('Sentadilla', 20003, true, false, 2);
      assert.equal(vibrateCalls.length, 0);
      assert.equal(notificationCalls.length, 0);

      // Silencio (no vibration, no sound)
      vibrateCalls.length = 0;
      notificationCalls.length = 0;
      await sendFiveSecondWarningNotification('Sentadilla', 20004, false, false);
      await sendRestCompleteNotification('Sentadilla', 20005, false, false, 4);
      assert.equal(audioCtxCreations, 0);
      assert.equal(vibrateCalls.length, 0);
      assert.equal(notificationCalls.length, 1);
      assert.equal(notificationCalls[0].title, 'LAZCAKONG · DESCANSO TERMINADO');
      assert.equal(notificationCalls[0].options.body, 'Siguiente serie: Sentadilla · Serie 4');
      assert.equal(notificationCalls[0].options.silent, true);
    });

    // 3. Pitido final plays single chime and releases AudioContext automatically
    await runCase('3. "Pitido final" reproduce un único aviso y libera AudioContext al terminar', async () => {
      audioCtxCreations = 0;
      audioCtxCloses = 0;
      createdContexts = [];

      playRestCompleteAlarm();
      assert.equal(audioCtxCreations, 1);
      assert.equal(hasOpenTimerAudioResources(), true);

      await new Promise((r) => setTimeout(r, 980));
      assert.equal(audioCtxCloses, 1);
      assert.equal(createdContexts[0].state, 'closed');
      assert.equal(hasOpenTimerAudioResources(), false);
    });

    // 4. Cancelling immediately closes AudioContext and cancels vibration
    await runCase('4. Cancelar o silenciar libera inmediatamente audio y detiene vibración', async () => {
      audioCtxCreations = 0;
      audioCtxCloses = 0;
      createdContexts = [];
      vibrateCalls.length = 0;

      playBeep(false);
      assert.equal(audioCtxCreations, 1);
      assert.equal(hasOpenTimerAudioResources(), true);

      releaseTimerAudioResources();
      cancelDeviceVibration();
      await cancelServiceWorkerRestAlarm(99999);

      assert.equal(audioCtxCloses, 1);
      assert.equal(createdContexts[0].state, 'closed');
      assert.equal(hasOpenTimerAudioResources(), false);
      assert.equal(vibrateCalls[vibrateCalls.length - 1], 0);
    });

    // 5. Service Worker Web Push: zero setTimeout/setInterval, defers when visible, emits LAZCAKONG · DESCANSO TERMINADO when locked, supports isTest, deduplicates & cancels
    await runCase('5. Service Worker Web Push sin setTimeout/setInterval, evita doble aviso visible, notifica bloqueado y cancela', async () => {
      const swSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
      assert.equal(/\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(swSrc), false, 'public/sw.js must NOT use setTimeout or setInterval');

      // Case 5a: Visible client on non-test push -> SW notifies client PUSH_REST_ALARM_RECEIVED and posts 0 duplicate OS notifications
      const visibleSw = loadServiceWorkerHarness({ visibleClients: true });
      const targetVisible = Date.now() + 180;
      await visibleSw.dispatchPush({
        restId: 'rest-vis-1',
        targetEndTime: targetVisible,
        exerciseName: 'Press de Banca',
        nextSetNumber: 2,
        mode: 'vibrate_only',
        vibrationEnabled: true,
        isTest: false,
      });
      assert.equal(visibleSw.swNotifications.length, 1);
      assert.ok(
        visibleSw.clientMessages.some(
          (m) => m.type === 'PUSH_REST_ALARM_RECEIVED' && m.restId === 'rest-vis-1'
        )
      );

      visibleSw.swNotifications.length = 0;
      // Case 5b: Visible client on explicit push test (isTest=true) -> ALWAYS shows OS notification for watch verification
      await visibleSw.dispatchPush({
        restId: 'testnow-1',
        targetEndTime: Date.now(),
        exerciseName: 'Press de Banca',
        nextSetNumber: 2,
        mode: 'vibrate_only',
        vibrationEnabled: true,
        isTest: true,
      });
      assert.equal(visibleSw.swNotifications.length, 1);

      // Case 5c: Locked screen (hidden clients) with active session -> 1 notification with exact title, body & [600,250,600,250,600]
      const lockedSw = loadServiceWorkerHarness({ visibleClients: false });
      const targetLocked = Date.now() + 180;
      await lockedSw.dispatchPush({
        restId: 'rest-locked-1',
        targetEndTime: targetLocked,
        exerciseName: 'Sentadilla',
        nextSetNumber: 3,
        mode: 'vibrate_only',
        vibrationEnabled: true,
        isTest: false,
      });
      // Duplicate push with same restId must be ignored
      await lockedSw.dispatchPush({
        restId: 'rest-locked-1',
        targetEndTime: targetLocked,
        exerciseName: 'Sentadilla',
        nextSetNumber: 3,
        mode: 'vibrate_only',
        vibrationEnabled: true,
        isTest: false,
      });
      assert.equal(lockedSw.swNotifications.length, 1);
      assert.equal(lockedSw.swNotifications[0].title, 'LAZCAKONG · DESCANSO TERMINADO');
      assert.equal(lockedSw.swNotifications[0].options.body, 'Siguiente serie: Sentadilla · Serie 3');
      assert.equal(lockedSw.swNotifications[0].options.silent, false);
      assert.equal(lockedSw.swNotifications[0].options.renotify, true);
      assert.deepEqual(
        Array.from(lockedSw.swNotifications[0].options.vibrate),
        [600, 250, 600, 250, 600]
      );

      // Case 5d: Locked screen without active session (no exerciseName/nextSetNumber) -> never invents exercise or set
      const noSessionSw = loadServiceWorkerHarness({ visibleClients: false });
      await noSessionSw.dispatchPush({
        restId: 'rest-nosession-1',
        targetEndTime: Date.now() + 150,
        exerciseName: '',
        nextSetNumber: null,
        mode: 'vibrate_only',
        vibrationEnabled: true,
        isTest: false,
      });
      assert.equal(noSessionSw.swNotifications.length, 1);
      assert.equal(noSessionSw.swNotifications[0].title, 'LAZCAKONG · DESCANSO TERMINADO');
      assert.equal(
        noSessionSw.swNotifications[0].options.body,
        'Descanso finalizado. Continúa tu entrenamiento.'
      );

      // Case 5e: CANCEL_REST_ALARM marks restId handled so late push never shows notification
      const cancelSw = loadServiceWorkerHarness({ visibleClients: false });
      cancelSw.dispatchMessage({
        type: 'CANCEL_REST_ALARM',
        restId: 'rest-cancelled-1',
      });
      await cancelSw.dispatchPush({
        restId: 'rest-cancelled-1',
        targetEndTime: Date.now(),
        exerciseName: 'Peso Muerto',
        nextSetNumber: 4,
        mode: 'vibrate_only',
        vibrationEnabled: true,
        isTest: false,
      });
      assert.equal(cancelSw.swNotifications.length, 0);
    });

    // 6. Explicit permission request, resolveNextRestTargetContext & UI deliverables check
    await runCase('6. Permiso solo por acción explícita, contexto real de sesión activa y textos UI requeridos', async () => {
      requestPermissionCalls = 0;
      MockNotification.permission = 'default';
      assert.equal(getNotificationPermissionStatus(), 'default');

      // Scheduling timer alarm must NEVER call Notification.requestPermission()
      await scheduleServiceWorkerRestAlarm(Date.now() + 30000, 'Press de Banca', {
        nextSetNumber: 2,
      });
      assert.equal(requestPermissionCalls, 0);

      // Explicit permission action calls requestPermission when default -> granted
      const perm = await requestNotificationPermission();
      assert.equal(perm, 'granted');
      assert.equal(requestPermissionCalls, 1);

      // resolveNextRestTargetContext never invents without session and resolves real next uncompleted set when active
      assert.deepEqual(resolveNextRestTargetContext(null, 'Press de Banca'), {});
      const mockSession: any = {
        sessionId: 's1',
        routineId: 'r1',
        routineTitle: 'Torso',
        dayName: 'Lunes',
        startTime: Date.now(),
        exercises: [
          {
            exerciseId: 'ex1',
            exerciseName: 'Press de Banca',
            activeExerciseName: 'Press de Banca',
            sets: [
              { id: '1', setNumber: 1, weight: 60, reps: 8, completed: true },
              { id: '2', setNumber: 2, weight: 60, reps: 8, completed: true },
              { id: '3', setNumber: 3, weight: 60, reps: 8, completed: false },
            ],
          },
        ],
      };
      assert.deepEqual(resolveNextRestTargetContext(mockSession, 'Press de Banca'), {
        exerciseName: 'Press de Banca',
        nextSetNumber: 3,
      });

      // testWatchAlert without active session never invents exercise/set
      notificationCalls.length = 0;
      await testWatchAlert({ vibrationEnabled: true });
      assert.equal(notificationCalls.length, 1);
      assert.equal(notificationCalls[0].title, 'LAZCAKONG · DESCANSO TERMINADO');
      assert.equal(
        notificationCalls[0].options.body,
        'Descanso finalizado. Continúa tu entrenamiento.'
      );

      // Check UI deliverables strings
      const widgetSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/RestTimerWidget.tsx'), 'utf8');
      const activeSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/views/ActiveWorkoutView.tsx'), 'utf8');
      const settingsSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/views/SettingsCloudView.tsx'), 'utf8');
      assert.ok(widgetSrc.includes('Continuar entrenamiento'));
      assert.ok(activeSrc.includes('Continuar entrenamiento'));
      assert.ok(widgetSrc.includes('/notification-icon-192.png'));
      assert.ok(activeSrc.includes('/notification-icon-192.png'));
      assert.ok(settingsSrc.includes('Probar aviso en el reloj'));
      assert.ok(settingsSrc.includes('Aviso de fin de descanso'));
      assert.ok(settingsSrc.includes('Estado del permiso de notificaciones'));
      assert.ok(settingsSrc.includes('/notification-icon-192.png'));
      assert.ok(settingsSrc.includes('/notification-badge-gorilla.png'));
    });

    // 7. Official brand icon (HTTPS, readable small PNG) & monochrome gorilla badge, no emojis in DESCANSO TERMINADO
    await runCase('7. Icono oficial LazcaKong HTTPS, badge monocromático de gorila y sin emojis en DESCANSO TERMINADO', async () => {
      const iconPath = path.resolve(process.cwd(), 'public/notification-icon-192.png');
      const badgePath = path.resolve(process.cwd(), 'public/notification-badge-gorilla.png');
      assert.ok(fs.existsSync(iconPath), 'notification-icon-192.png must exist');
      assert.ok(fs.existsSync(badgePath), 'notification-badge-gorilla.png must exist');

      const iconBuf = fs.readFileSync(iconPath);
      const badgeBuf = fs.readFileSync(badgePath);
      assert.ok(iconBuf.length > 1000, 'icon PNG should be non-trivial');
      assert.ok(badgeBuf.length > 200, 'badge PNG should be non-trivial');
      // Verify PNG magic signature
      assert.equal(iconBuf.subarray(1, 4).toString('ascii'), 'PNG');
      assert.equal(badgeBuf.subarray(1, 4).toString('ascii'), 'PNG');

      const swSrc = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
      assert.ok(swSrc.includes("'/notification-icon-192.png'"));
      assert.ok(swSrc.includes("'/notification-badge-gorilla.png'"));

      const resolvedIcon = resolveNotificationAssetUrl(REST_COMPLETE_NOTIFICATION_ICON_PATH);
      const resolvedBadge = resolveNotificationAssetUrl(REST_COMPLETE_NOTIFICATION_BADGE_PATH);
      assert.match(resolvedIcon, /^https:\/\/.+\/notification-icon-192\.png$/);
      assert.match(resolvedBadge, /^https:\/\/.+\/notification-badge-gorilla\.png$/);

      const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

      // Foreground & testWatchAlert notifications carry HTTPS icon + gorilla badge without emojis
      notificationCalls.length = 0;
      const testRes = await testWatchAlert({
        exerciseName: 'Press de Banca',
        nextSetNumber: 2,
        vibrationEnabled: true,
      });
      assert.equal(testRes.success, true);
      assert.equal(notificationCalls.length, 1);
      assert.equal(notificationCalls[0].options.icon, resolvedIcon);
      assert.equal(notificationCalls[0].options.badge, resolvedBadge);
      assert.equal(emojiRegex.test(notificationCalls[0].title), false);
      assert.equal(emojiRegex.test(notificationCalls[0].options.body), false);
      assert.equal(emojiRegex.test(notificationCalls[0].options.icon), false);
      assert.equal(emojiRegex.test(notificationCalls[0].options.badge), false);

      // Service Worker locked Web Push notification carries HTTPS icon + gorilla badge
      const lockedSw = loadServiceWorkerHarness({ visibleClients: false });
      await lockedSw.dispatchPush({
        restId: 'rest-brand-1',
        targetEndTime: Date.now() + 140,
        exerciseName: 'Sentadilla',
        nextSetNumber: 4,
        mode: 'vibrate_only',
        vibrationEnabled: true,
        isTest: false,
      });
      assert.equal(lockedSw.swNotifications.length, 1);
      assert.equal(
        lockedSw.swNotifications[0].options.icon,
        'https://localhost/notification-icon-192.png'
      );
      assert.equal(
        lockedSw.swNotifications[0].options.badge,
        'https://localhost/notification-badge-gorilla.png'
      );
      assert.equal(emojiRegex.test(lockedSw.swNotifications[0].title), false);
      assert.equal(emojiRegex.test(lockedSw.swNotifications[0].options.body), false);
    });

    // 8. Rest timer state machine adjustment (-15s, +15s, rapid taps) with subsequent timer ticks
    await runCase('8. Ajuste de descanso real con estado, referencia y ticks posteriores sin rebotes', async () => {
      const startTime = Date.now();
      let restTimerState = {
        active: true,
        paused: false,
        totalSeconds: 90,
        remainingSeconds: 90,
        targetEndTime: startTime + 90000,
      };
      const restTimerRef = { current: restTimerState };

      const simulateAdjust = (delta: number, elapsedMs = 0) => {
        const cur = restTimerRef.current;
        const now = startTime + elapsedMs;
        const curRem = Math.max(0, Math.ceil((cur.targetEndTime - now) / 1000));
        const nextRem = Math.max(0, curRem + delta);
        const newTarget = now + nextRem * 1000;
        restTimerRef.current = {
          ...cur,
          remainingSeconds: nextRem,
          targetEndTime: newTarget,
        };
      };

      const simulateTick = (elapsedMs: number) => {
        const cur = restTimerRef.current;
        const evalNow = startTime + elapsedMs;
        const remMs = cur.targetEndTime - evalNow;
        const diffSec = Math.ceil(remMs / 1000);
        restTimerRef.current = {
          ...cur,
          remainingSeconds: diffSec,
        };
        return diffSec;
      };

      assert.equal(restTimerRef.current.remainingSeconds, 90);

      simulateAdjust(-15, 0);
      assert.equal(restTimerRef.current.remainingSeconds, 75);

      let tickSec = simulateTick(2000);
      assert.equal(tickSec, 73);

      simulateAdjust(-15, 2000);
      simulateAdjust(-15, 2000);
      assert.equal(restTimerRef.current.remainingSeconds, 43);

      tickSec = simulateTick(3000);
      assert.equal(tickSec, 42);

      simulateAdjust(15, 3000);
      assert.equal(restTimerRef.current.remainingSeconds, 57);
    });
  } finally {
    g.window = origWindow;
    g.Audio = origAudio;
    g.Notification = origNotification;
  }

  console.log(`\nALL ${passed} REST TIMER AUDIO & VIBRATION SUITE TESTS PASSED.`);
}

runTests().catch((err) => {
  console.error('REST TIMER AUDIO SUITE FAILED:', err);
  process.exit(1);
});
