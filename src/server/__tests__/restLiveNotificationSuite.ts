import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import {
  REST_ACTIVE_NOTIFICATION_TAG,
  REST_COMPLETE_NOTIFICATION_TITLE,
  buildActiveRestNotificationContent,
  cancelServiceWorkerRestAlarm,
  dismissActiveRestNotification,
  formatLocalRestEndTime,
  resetCompleteAlertTracking,
  scheduleServiceWorkerRestAlarm,
  sendRestCompleteNotification,
  showOrUpdateActiveRestNotification,
} from '../../utils/backgroundTimer.ts';

interface CapturedNotification {
  title: string;
  options: Record<string, any>;
  closed: boolean;
}

function createFakeBrowserEnv(initialPermission: NotificationPermission = 'granted') {
  const notifications: CapturedNotification[] = [];
  const postedSwMessages: Record<string, any>[] = [];
  const vibrateCalls: any[] = [];
  let requestPermissionCalls = 0;

  const activeWorker = {
    postMessage(payload: Record<string, any>) {
      postedSwMessages.push(payload);
    },
  };

  const registration = {
    active: activeWorker,
    async showNotification(title: string, options: Record<string, any> = {}) {
      // Chromium rejects silent: true combined with vibrate
      if (options.silent === true && 'vibrate' in options) {
        throw new TypeError("Silent notifications must not specify vibration patterns.");
      }
      if (options.tag) {
        for (const existing of notifications) {
          if (!existing.closed && existing.options.tag === options.tag) {
            existing.closed = true;
          }
        }
      }
      notifications.push({ title, options: { ...options }, closed: false });
    },
    async getNotifications() {
      return notifications
        .filter((n) => !n.closed)
        .map((n) => ({
          tag: n.options.tag,
          title: n.title,
          body: n.options.body,
          data: n.options.data,
          close() {
            n.closed = true;
          },
        }));
    },
  };

  class FakeNotification {
    static permission: NotificationPermission = initialPermission;
    static async requestPermission() {
      requestPermissionCalls += 1;
      return FakeNotification.permission;
    }
    constructor(title: string, options: Record<string, any> = {}) {
      if (options.silent === true && 'vibrate' in options) {
        throw new TypeError("Silent notifications must not specify vibration patterns.");
      }
      notifications.push({ title, options: { ...options }, closed: false });
    }
  }

  const fakeNavigator: any = {
    vibrate(pattern: any) {
      vibrateCalls.push(pattern);
      return true;
    },
    serviceWorker: {
      controller: activeWorker,
      ready: Promise.resolve(registration),
      async getRegistration() {
        return registration;
      },
      addEventListener() {},
      removeEventListener() {},
    },
  };

  const fakeWindow: any = {
    location: { origin: 'https://lazcakongym.ai.studio', href: 'https://lazcakongym.ai.studio/' },
    Notification: FakeNotification,
    navigator: fakeNavigator,
  };

  const prevWindow = (globalThis as any).window;
  const prevNavigator = (globalThis as any).navigator;
  const prevNotification = (globalThis as any).Notification;

  (globalThis as any).window = fakeWindow;
  Object.defineProperty(globalThis, 'navigator', {
    value: fakeNavigator,
    configurable: true,
    writable: true,
  });
  (globalThis as any).Notification = FakeNotification;

  return {
    notifications,
    postedSwMessages,
    vibrateCalls,
    getRequestPermissionCalls: () => requestPermissionCalls,
    setPermission: (perm: NotificationPermission) => {
      FakeNotification.permission = perm;
    },
    getOpenNotifications: () => notifications.filter((n) => !n.closed),
    restore() {
      if (prevWindow === undefined) delete (globalThis as any).window;
      else (globalThis as any).window = prevWindow;
      if (prevNavigator === undefined) delete (globalThis as any).navigator;
      else {
        Object.defineProperty(globalThis, 'navigator', {
          value: prevNavigator,
          configurable: true,
          writable: true,
        });
      }
      if (prevNotification === undefined) delete (globalThis as any).Notification;
      else (globalThis as any).Notification = prevNotification;
    },
  };
}

function loadServiceWorkerHarness() {
  const swPath = path.resolve(process.cwd(), 'public/sw.js');
  const swCode = fs.readFileSync(swPath, 'utf-8');
  const listeners = new Map<string, Array<(evt: any) => void>>();
  const openNotifications: Array<{ title: string; options: Record<string, any>; closed: boolean }> = [];
  const clientMessages: Record<string, any>[] = [];
  const openedUrls: string[] = [];
  let focusedCount = 0;
  let mockHasExistingClient = true;

  const sandbox: any = {
    console,
    URL,
    Promise,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Map,
    Set,
    JSON,
    caches: {
      open: async () => ({ addAll: async () => {}, put: async () => {} }),
      keys: async () => [],
      delete: async () => true,
      match: async () => undefined,
    },
    self: null as any,
  };

  sandbox.self = {
    location: { origin: 'https://lazcakongym.ai.studio' },
    skipWaiting: async () => {},
    addEventListener(type: string, cb: (evt: any) => void) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(cb);
    },
    registration: {
      async showNotification(title: string, options: Record<string, any> = {}) {
        if (options.tag) {
          for (const item of openNotifications) {
            if (!item.closed && item.options.tag === options.tag) {
              item.closed = true;
            }
          }
        }
        openNotifications.push({ title, options: { ...options }, closed: false });
      },
      async getNotifications() {
        return openNotifications
          .filter((n) => !n.closed)
          .map((n) => ({
            tag: n.options.tag,
            title: n.title,
            data: n.options.data,
            close() {
              n.closed = true;
            },
          }));
      },
    },
    clients: {
      claim: async () => {},
      async matchAll() {
        if (!mockHasExistingClient) return [];
        return [
          {
            url: 'https://lazcakongym.ai.studio/',
            focused: false,
            async focus() {
              focusedCount += 1;
            },
            postMessage(msg: Record<string, any>) {
              clientMessages.push(msg);
            },
          },
        ];
      },
      async openWindow(url: string) {
        openedUrls.push(url);
        return null;
      },
    },
  };

  vm.runInNewContext(swCode, sandbox, { filename: 'public/sw.js' });

  async function dispatch(type: string, event: any) {
    const waitPromises: Promise<any>[] = [];
    event.waitUntil = (p: Promise<any>) => {
      waitPromises.push(Promise.resolve(p));
    };
    for (const cb of listeners.get(type) || []) {
      cb(event);
    }
    await Promise.all(waitPromises);
  }

  return {
    swCode,
    openNotifications,
    clientMessages,
    openedUrls,
    getFocusedCount: () => focusedCount,
    setHasExistingClient: (val: boolean) => {
      mockHasExistingClient = val;
    },
    getActiveNotifications: () => openNotifications.filter((n) => !n.closed),
    dispatch,
  };
}

async function runTests() {
  console.log('🧪 Running LazcaKong Gym Live Rest Notification Suite (PWA + Native Android)...\n');

  let passed = 0;
  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`✅ PASS: ${name}`);
      passed += 1;
    } catch (err: any) {
      console.error(`❌ FAIL: ${name}`);
      console.error(err?.stack || err?.message || err);
      process.exitCode = 1;
    }
  }

  // TEST 1: Exact concrete scenario — 150s rest -> 30s away -> +15s -> skip rest
  await test('Scenario: 150s rest -> 30s background (2:00 remaining) -> +15s update -> skip cancels all', async () => {
    const env = createFakeBrowserEnv('granted');
    const origNow = Date.now;
    let fakeNow = new Date(2026, 10, 21, 11, 40, 0).getTime(); // 11:40:00 local time
    Date.now = () => fakeNow;

    try {
      resetCompleteAlertTracking();

      // 1. Start 150s rest (2 min 30 s) -> ends at 11:42:30 local
      const restId1 = 'rest_case_150';
      const targetEnd1 = fakeNow + 150_000;
      const expectedEndTime1 = formatLocalRestEndTime(targetEnd1);

      const shown1 = await showOrUpdateActiveRestNotification({
        targetEndTime: targetEnd1,
        durationSeconds: 150,
        restId: restId1,
        exerciseName: 'Press Banca Plano',
        nextSetNumber: 3,
      });
      await scheduleServiceWorkerRestAlarm(targetEnd1, 'Press Banca Plano', {
        restId: restId1,
        nextSetNumber: 3,
        soundEnabled: true,
        vibrationEnabled: true,
      });

      assert.equal(shown1, true, 'Ongoing PWA rest notification must be shown');
      const openAfterStart = env.getOpenNotifications();
      assert.equal(openAfterStart.length, 1, 'Must show exactly ONE active-rest notification');
      assert.equal(openAfterStart[0].title, 'LazcaKong Gym · Descanso de 2 min 30 s');
      assert.ok(
        openAfterStart[0].options.body.includes(`Próxima serie a las ${expectedEndTime1}`),
        `Body must include local end time (${expectedEndTime1}), got: ${openAfterStart[0].options.body}`
      );
      assert.equal(openAfterStart[0].options.tag, REST_ACTIVE_NOTIFICATION_TAG);
      assert.equal(openAfterStart[0].options.silent, true, 'Ongoing notice must be silent');
      assert.equal(openAfterStart[0].options.renotify, false, 'Ongoing notice must not renotify');
      assert.equal('vibrate' in openAfterStart[0].options, false, 'Silent notice must not pass vibrate');
      assert.equal(openAfterStart[0].options.data.url, '/?openActiveWorkout=1');

      // 2. Simulate switching to WhatsApp for 30s and returning
      fakeNow += 30_000; // now 11:40:30 local
      const remainingAfterReturn = Math.max(0, Math.ceil((targetEnd1 - Date.now()) / 1000));
      assert.equal(remainingAfterReturn, 120, 'Returning after 30s must show 120s (2:00) remaining');
      assert.equal(env.notifications.length, 1, 'No per-second notifications should be emitted while away');

      // 3. Athlete taps +15s -> remaining 135s (2 min 15 s), new targetEndTime = +15s (11:42:45)
      const nextRemaining = remainingAfterReturn + 15;
      assert.equal(nextRemaining, 135);
      const targetEnd2 = Date.now() + nextRemaining * 1000;
      const restId2 = 'rest_case_135';
      const expectedEndTime2 = formatLocalRestEndTime(targetEnd2);

      // Cancel previous alarm while preserving ongoing tag for seamless in-place update
      await cancelServiceWorkerRestAlarm(targetEnd1, restId1, { preserveOngoing: true });
      await scheduleServiceWorkerRestAlarm(targetEnd2, 'Press Banca Plano', {
        restId: restId2,
        nextSetNumber: 3,
        soundEnabled: true,
        vibrationEnabled: true,
      });
      const shown2 = await showOrUpdateActiveRestNotification({
        targetEndTime: targetEnd2,
        durationSeconds: nextRemaining,
        restId: restId2,
        exerciseName: 'Press Banca Plano',
        nextSetNumber: 3,
      });

      assert.equal(shown2, true);
      const openAfterAdjust = env.getOpenNotifications();
      assert.equal(openAfterAdjust.length, 1, 'Adjusting +15s must replace the SAME single notification');
      assert.equal(openAfterAdjust[0].title, 'LazcaKong Gym · Descanso de 2 min 15 s');
      assert.ok(
        openAfterAdjust[0].options.body.includes(`Próxima serie a las ${expectedEndTime2}`),
        `Updated body must include new local end time (${expectedEndTime2}), got: ${openAfterAdjust[0].options.body}`
      );
      assert.equal(openAfterAdjust[0].options.tag, REST_ACTIVE_NOTIFICATION_TAG);
      assert.equal(openAfterAdjust[0].options.data.targetEndTime, targetEnd2);

      const cancelMsg1 = env.postedSwMessages.find(
        (m) => m.type === 'CANCEL_REST_ALARM' && m.restId === restId1
      );
      assert.ok(cancelMsg1, 'Previous alarm must be cancelled in Service Worker');
      assert.equal(cancelMsg1.preserveOngoing, true, '+15s cancel must preserve ongoing slot');

      // 4. Athlete skips rest -> ongoing notification dismissed & active alarm cancelled
      await cancelServiceWorkerRestAlarm(targetEnd2, restId2);
      assert.equal(env.getOpenNotifications().length, 0, 'Skipping rest must dismiss ongoing notification');
      const cancelMsg2 = env.postedSwMessages.find(
        (m) => m.type === 'CANCEL_REST_ALARM' && m.restId === restId2
      );
      assert.ok(cancelMsg2, 'Skipping rest must send CANCEL_REST_ALARM for current restId');
      assert.equal(cancelMsg2.preserveOngoing, false);
    } finally {
      Date.now = origNow;
      env.restore();
    }
  });

  // TEST 2: Reaching 0s dismisses ongoing notice and emits ONE single DESCANSO TERMINADO notice with vibration
  await test('Reaching 0s dismisses ongoing notification and keeps exactly one DESCANSO TERMINADO alert', async () => {
    const env = createFakeBrowserEnv('granted');
    const origNow = Date.now;
    const baseNow = Date.now();
    Date.now = () => baseNow;

    try {
      resetCompleteAlertTracking();
      const restId = 'rest_finish_zero';
      const targetEnd = baseNow + 90_000;

      await showOrUpdateActiveRestNotification({
        targetEndTime: targetEnd,
        durationSeconds: 90,
        restId,
        exerciseName: 'Sentadilla Libre',
        nextSetNumber: 4,
      });
      assert.equal(env.getOpenNotifications().length, 1);

      // Timer reaches 0
      Date.now = () => targetEnd;
      await sendRestCompleteNotification('Sentadilla Libre', targetEnd, true, true, 4, restId);
      // Duplicate call for same restId must be ignored
      await sendRestCompleteNotification('Sentadilla Libre', targetEnd, true, true, 4, restId);

      const open = env.getOpenNotifications();
      assert.equal(open.length, 1, 'Exactly one completion notification should remain open');
      assert.equal(open[0].title, REST_COMPLETE_NOTIFICATION_TITLE);
      assert.equal(open[0].options.tag, `lazcakon-rest-done-${restId}`);
      assert.deepEqual(open[0].options.vibrate, [600, 250, 600, 250, 600]);
      assert.equal(open[0].options.data.url, '/?openActiveWorkout=1');
      assert.equal(env.vibrateCalls.length, 1, 'Device vibration must fire exactly once');
    } finally {
      Date.now = origNow;
      env.restore();
    }
  });

  // TEST 3: Permission denied/default is strictly respected (never auto-requests permission)
  await test('Respects denied/default notification permission without auto-prompting', async () => {
    const env = createFakeBrowserEnv('denied');
    try {
      const targetEnd = Date.now() + 120_000;
      const deniedResult = await showOrUpdateActiveRestNotification({
        targetEndTime: targetEnd,
        durationSeconds: 120,
        restId: 'rest_denied',
      });
      assert.equal(deniedResult, false);
      assert.equal(env.getOpenNotifications().length, 0);
      assert.equal(env.getRequestPermissionCalls(), 0, 'Must NEVER request permission on timer start');

      env.setPermission('default');
      const defaultResult = await showOrUpdateActiveRestNotification({
        targetEndTime: targetEnd,
        durationSeconds: 120,
        restId: 'rest_default',
      });
      assert.equal(defaultResult, false);
      assert.equal(env.getOpenNotifications().length, 0);
      assert.equal(env.getRequestPermissionCalls(), 0, 'Must NEVER auto-prompt when permission is default');
    } finally {
      env.restore();
    }
  });

  // TEST 4: Service Worker lifecycle (stale cancelled push ignored, push closes ongoing notice, click routes to active workout)
  await test('Service Worker cancels stale push, closes ongoing notice on push, and routes notificationclick to active workout', async () => {
    const sw = loadServiceWorkerHarness();
    assert.equal(
      /\bsetTimeout\s*\(|\bsetInterval\s*\(/.test(sw.swCode),
      false,
      'Service Worker must not contain setTimeout/setInterval'
    );

    // Put ongoing notification in SW registry
    const activeTarget = Date.now() + 150_000;
    sw.openNotifications.push({
      title: 'LazcaKong Gym · Descanso de 2 min 30 s',
      options: {
        tag: REST_ACTIVE_NOTIFICATION_TAG,
        data: { type: 'rest-active', url: '/?openActiveWorkout=1', restId: 'rest_old' },
      },
      closed: false,
    });

    // 1. Cancel rest_old with preserveOngoing: true -> ongoing stays open, rest_old push suppressed
    await sw.dispatch('message', {
      data: { type: 'CANCEL_REST_ALARM', restId: 'rest_old', targetEndTime: activeTarget, preserveOngoing: true },
    });
    assert.equal(sw.getActiveNotifications().length, 1, 'preserveOngoing: true must keep active notice open');

    // Late push for cancelled rest_old must be completely ignored
    await sw.dispatch('push', {
      data: {
        json: () => ({
          type: 'rest-complete',
          restId: 'rest_old',
          targetEndTime: activeTarget,
          title: REST_COMPLETE_NOTIFICATION_TITLE,
          body: 'Siguiente serie: Press Banca · Serie 3',
        }),
      },
    });
    assert.equal(
      sw.getActiveNotifications().some((n) => n.title === REST_COMPLETE_NOTIFICATION_TITLE),
      false,
      'Cancelled restId push must NOT fire'
    );

    // 2. Tap ongoing rest-active notification -> focuses existing client & sends OPEN_ACTIVE_WORKOUT, without closing ongoing notice
    let clickedNoticeClosed = false;
    await sw.dispatch('notificationclick', {
      notification: {
        tag: REST_ACTIVE_NOTIFICATION_TAG,
        data: { type: 'rest-active', url: '/?openActiveWorkout=1', restId: 'rest_new' },
        close() {
          clickedNoticeClosed = true;
        },
      },
    });
    assert.equal(clickedNoticeClosed, false, 'Tapping ongoing rest notice must not dismiss it prematurely');
    assert.equal(sw.getFocusedCount(), 1, 'Tapping notification must focus existing app client');
    assert.ok(
      sw.clientMessages.some((m) => m.type === 'OPEN_ACTIVE_WORKOUT'),
      'Tapping notification must send OPEN_ACTIVE_WORKOUT to client'
    );

    // 3. Legitimate Web Push for rest_new -> closes ongoing notice and displays single DESCANSO TERMINADO
    await sw.dispatch('push', {
      data: {
        json: () => ({
          type: 'rest-complete',
          restId: 'rest_new',
          targetEndTime: activeTarget + 15_000,
          title: REST_COMPLETE_NOTIFICATION_TITLE,
          body: 'Siguiente serie: Press Banca · Serie 3',
        }),
      },
    });
    const activeAfterPush = sw.getActiveNotifications();
    assert.equal(activeAfterPush.length, 1, 'Push must close ongoing notice and leave only 1 completion alert');
    assert.equal(activeAfterPush[0].title, REST_COMPLETE_NOTIFICATION_TITLE);
    assert.equal(activeAfterPush[0].options.data.url, '/?openActiveWorkout=1');

    // 4. Cold launch tap (no existing client) opens /?openActiveWorkout=1
    sw.setHasExistingClient(false);
    let doneNoticeClosed = false;
    await sw.dispatch('notificationclick', {
      notification: {
        tag: 'lazcakon-rest-done-rest_new',
        data: { type: 'rest-complete', url: '/?openActiveWorkout=1', restId: 'rest_new' },
        close() {
          doneNoticeClosed = true;
        },
      },
    });
    assert.equal(doneNoticeClosed, true, 'Tapping finished rest notification should close it');
    assert.equal(sw.openedUrls[0], '/?openActiveWorkout=1');
  });

  // TEST 5: Formatting check for clean duration labels & local end-time text
  await test('Formats active rest notification title and local end-time body cleanly', () => {
    const fixedDate = new Date(2026, 10, 21, 11, 42, 30).getTime();
    const content = buildActiveRestNotificationContent({
      durationSeconds: 150,
      targetEndTime: fixedDate,
      exerciseName: 'Remo con Barra',
      nextSetNumber: 2,
    });
    assert.equal(content.title, 'LazcaKong Gym · Descanso de 2 min 30 s');
    assert.ok(content.body.startsWith('Próxima serie a las '));
    assert.ok(content.body.includes('Remo con Barra (Serie 2)'));
    assert.equal(content.shortText, 'Descanso');
  });

  // TEST 6: Native Android Capacitor 8 plugin & manifest audit
  await test('Native Android plugin implements real chronometer countdown, lockscreen visibility, and Android 16 promoted chip safely', () => {
    const pluginSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'android/app/src/main/java/com/lazcakong/gym/RestTimerNotificationPlugin.java'),
      'utf-8'
    );
    const mainActivitySrc = fs.readFileSync(
      path.resolve(process.cwd(), 'android/app/src/main/java/com/lazcakong/gym/MainActivity.java'),
      'utf-8'
    );
    const manifestSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'android/app/src/main/AndroidManifest.xml'),
      'utf-8'
    );
    const useGymStateSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/hooks/useGymState.ts'),
      'utf-8'
    );
    const appSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

    assert.ok(pluginSrc.includes('setUsesChronometer(true)'), 'Native plugin must enable system chronometer');
    assert.ok(pluginSrc.includes('setChronometerCountDown(true)'), 'Native plugin must count DOWN');
    assert.ok(pluginSrc.includes('setWhen(targetEndTime)'), 'Native plugin must bind exact targetEndTime');
    assert.ok(pluginSrc.includes('VISIBILITY_PUBLIC'), 'Native plugin must be visible on lock screen');
    assert.ok(pluginSrc.includes('setTimeoutAfter(remainingMs)'), 'Native plugin must auto-clear at 00:00');
    assert.ok(pluginSrc.includes('setRequestPromotedOngoing'), 'Native plugin must request Android 16 promoted ongoing chip');
    assert.ok(pluginSrc.includes('setShortCriticalText'), 'Native plugin must set short critical status bar text');
    assert.ok(mainActivitySrc.includes('registerPlugin(RestTimerNotificationPlugin.class)'), 'MainActivity must register plugin');
    assert.ok(mainActivitySrc.includes('onNewIntent'), 'MainActivity must handle onNewIntent for notification taps');
    assert.ok(manifestSrc.includes('POST_PROMOTED_NOTIFICATIONS'), 'Manifest must declare POST_PROMOTED_NOTIFICATIONS');
    assert.ok(!manifestSrc.includes('USE_EXACT_ALARM'), 'Manifest must NOT declare USE_EXACT_ALARM');
    assert.ok(useGymStateSrc.includes('showOrUpdateActiveRestNotification'), 'useGymState must trigger ongoing rest notification');
    assert.ok(useGymStateSrc.includes('dismissActiveRestNotification'), 'useGymState must dismiss ongoing rest notification');
    assert.ok(appSrc.includes("setCurrentTab('activo')"), 'App.tsx must route notification taps to active workout tab');
  });

  // Cleanup check
  await test('dismissActiveRestNotification closes active tag cleanly', async () => {
    const env = createFakeBrowserEnv('granted');
    try {
      await showOrUpdateActiveRestNotification({
        targetEndTime: Date.now() + 60_000,
        durationSeconds: 60,
        restId: 'rest_cleanup',
      });
      assert.equal(env.getOpenNotifications().length, 1);
      await dismissActiveRestNotification();
      assert.equal(env.getOpenNotifications().length, 0);
    } finally {
      env.restore();
    }
  });

  console.log(`\n🎉 All ${passed} live rest notification tests passed!`);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
