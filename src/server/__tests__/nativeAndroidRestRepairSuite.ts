/**
 * LAZCAKONG GYM 7.0 — SUITE DE VERIFICACIÓN NATIVA DEL CRONÓMETRO ANDROID / HONOR 400 PRO
 *
 * Verifica los escenarios A–L a nivel de contrato nativo Java/XML/Manifest y puente JS/TS:
 * - A/B/C/D: Cronómetro regresivo 60/90/120/150s sin polling JS, VISIBILITY_PUBLIC, sin .setSilent(true)
 * - E: Controles en notificación (Pausar, Reanudar, +15s, Saltar) + sincronización nativa bidireccional
 * - F/G/H: Fin de descanso 00:00 via AlarmManager, deduplicación por restId, 3 modos (sound/vibrate_only/silent)
 * - I: Cierre/cancelación/finalización de sesión limpia alarmas y notificaciones sin huérfanos
 * - J/K: Android 16 Live Updates (setRequestPromotedOngoing + setShortCriticalText + hasPromotableCharacteristics)
 *        y Android 14+ Full-Screen Intent condicional a pantalla bloqueada/apagada con RestCompleteLockActivity
 * - L: Cumplimiento estricto Google Play (SCHEDULE_EXACT_ALARM sí, USE_EXACT_ALARM no, sin permisos invasivos)
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  REST_LIVE_COUNTDOWN_CHANNEL_ID,
  REST_SOUND_CHANNEL_ID,
  REST_VIBRATE_CHANNEL_ID,
  REST_SILENT_CHANNEL_ID,
  getNativeNotificationPermission,
  scheduleNativeRestNotification,
  showOrUpdateNativeOngoingRestNotification,
  pauseNativeOngoingRestNotification,
  cancelNativeRestNotification,
  markNativeRestCompleted,
  consumePendingNativeRestSync,
  getNativeRestTimerCapabilities,
  openNativeRestSettingScreen,
} from '../../utils/nativeNotifications.ts';
import {
  formatSimultaneousRestMmSsSeconds,
  formatRestMmSs,
} from '../../utils/restFormatter.ts';

const ROOT = process.cwd();

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAIL: ${name} -> ${err?.message || err}`);
    throw err;
  }
}

function createMockCapacitorAndroidEnv() {
  const calls: Array<{ method: string; args?: any }> = [];
  const listeners = new Map<string, Array<(data: any) => void>>();
  let state = {
    active: false,
    paused: false,
    restId: '',
    targetEndTime: 0,
    totalSeconds: 0,
    remainingSeconds: 0,
    exerciseName: '',
    nextSetNumber: 0,
    mode: 'sound' as 'sound' | 'vibrate_only' | 'silent',
    restEndAlertEnabled: true,
    lastFiredRestId: '',
    lastFiredTargetEndTime: 0,
    pendingAction: '' as '' | 'paused' | 'resumed' | 'adjusted' | 'skipped' | 'completed',
    pendingActionAt: 0,
    updatedAt: 0,
  };

  const pluginProxy = {
    async startOrUpdate(opts: any) {
      calls.push({ method: 'startOrUpdate', args: opts });
      state = {
        ...state,
        active: true,
        paused: false,
        restId: opts.restId || `rest_${opts.targetEndTime}`,
        targetEndTime: opts.targetEndTime,
        totalSeconds: opts.totalSeconds || 90,
        remainingSeconds: Math.max(1, Math.ceil((opts.targetEndTime - Date.now()) / 1000)),
        exerciseName: opts.exerciseName || '',
        nextSetNumber: opts.nextSetNumber || 0,
        mode: opts.mode || 'sound',
        restEndAlertEnabled: opts.restEndAlertEnabled !== false,
        pendingAction: '',
        updatedAt: Date.now(),
      };
      return {
        shown: true,
        notificationId: 77001,
        targetEndTime: opts.targetEndTime,
        exactAlarmScheduled: true,
        promotedRequested: true,
        canPostPromoted: true,
        hasPromotableCharacteristics: true,
        canScheduleExactAlarms: true,
        canUseFullScreenIntent: true,
      };
    },
    async pauseOngoing(opts: any) {
      calls.push({ method: 'pauseOngoing', args: opts });
      state = {
        ...state,
        active: true,
        paused: true,
        restId: '',
        targetEndTime: 0,
        remainingSeconds: opts.remainingSeconds,
        totalSeconds: opts.totalSeconds,
        pendingAction: '',
        updatedAt: Date.now(),
      };
      return { paused: true, shown: true, remainingSeconds: opts.remainingSeconds };
    },
    async cancelOngoing(opts?: any) {
      calls.push({ method: 'cancelOngoing', args: opts });
      if (!opts?.preserveStore) {
        state = { ...state, active: false, paused: false, restId: '', targetEndTime: 0, remainingSeconds: 0 };
      }
      return { cancelled: true };
    },
    async cancelAllRest() {
      calls.push({ method: 'cancelAllRest' });
      state = { ...state, active: false, paused: false, restId: '', targetEndTime: 0, remainingSeconds: 0, pendingAction: '' };
      return { cancelled: true };
    },
    async markCompletedFromApp(opts: any) {
      calls.push({ method: 'markCompletedFromApp', args: opts });
      state = {
        ...state,
        active: false,
        paused: false,
        restId: '',
        targetEndTime: 0,
        remainingSeconds: 0,
        lastFiredRestId: opts.restId || state.lastFiredRestId,
        lastFiredTargetEndTime: opts.targetEndTime || state.lastFiredTargetEndTime,
      };
      return { completed: true };
    },
    async getNativeState() {
      return { ...state };
    },
    async consumePendingNativeSync() {
      const snap = { ...state };
      state.pendingAction = '';
      state.pendingActionAt = 0;
      return snap;
    },
    async requestPermission() {
      return await this.getCapabilities();
    },
    async getCapabilities() {
      return {
        sdkInt: 36,
        release: '16',
        manufacturer: 'HONOR',
        model: 'Honor 400 Pro',
        notificationsEnabled: true,
        osNotificationsEnabled: true,
        postNotificationsGranted: true,
        ongoingChannelId: REST_LIVE_COUNTDOWN_CHANNEL_ID,
        ongoingChannelEnabled: true,
        ongoingChannelImportance: 3,
        ongoingChannelLockscreenVisibility: 1,
        finishChannelId: REST_SOUND_CHANNEL_ID,
        finishChannelEnabled: true,
        finishChannelImportance: 4,
        lockScreenSystemEnabled: true,
        supportsChronometerCountdown: true,
        supportsPromotedOngoing: true,
        canPostPromoted: true,
        hasPromotableCharacteristics: true,
        canScheduleExactAlarms: true,
        canUseFullScreenIntent: true,
        ignoringBatteryOptimizations: true,
        magicOsStartupAvailable: true,
      };
    },
    async openNotificationSettings() { calls.push({ method: 'openNotificationSettings' }); return { opened: true }; },
    async openChannelSettings(opts: any) { calls.push({ method: 'openChannelSettings', args: opts }); return { opened: true }; },
    async openExactAlarmSettings() { calls.push({ method: 'openExactAlarmSettings' }); return { opened: true }; },
    async openBatteryOptimizationSettings() { calls.push({ method: 'openBatteryOptimizationSettings' }); return { opened: true }; },
    async openFullScreenIntentSettings() { calls.push({ method: 'openFullScreenIntentSettings' }); return { opened: true }; },
    async openMagicOsAutostartSettings() { calls.push({ method: 'openMagicOsAutostartSettings' }); return { opened: true, usedVendorScreen: true }; },
    async consumePendingOpenActiveWorkout() { return { shouldOpen: false, restId: '' }; },
    async addListener(event: string, fn: (data: any) => void) {
      const arr = listeners.get(event) || [];
      arr.push(fn);
      listeners.set(event, arr);
      return { remove: async () => {} };
    },
  };

  const prevWindow = (globalThis as any).window;
  (globalThis as any).window = {
    androidBridge: {},
    Capacitor: {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      isPluginAvailable: (name: string) => name === 'RestTimerNotification',
      Plugins: {
        RestTimerNotification: pluginProxy,
      },
    },
    dispatchEvent() {
      return true;
    },
  };

  return {
    calls,
    simulateNativeAdd15s() {
      state.targetEndTime += 15_000;
      state.remainingSeconds += 15;
      state.pendingAction = 'adjusted';
      state.pendingActionAt = Date.now();
    },
    simulateNativePause() {
      state.paused = true;
      state.targetEndTime = 0;
      state.remainingSeconds = 45;
      state.pendingAction = 'paused';
      state.pendingActionAt = Date.now();
    },
    simulateNativeCompleted() {
      state.active = false;
      state.paused = false;
      state.lastFiredRestId = state.restId;
      state.lastFiredTargetEndTime = state.targetEndTime;
      state.targetEndTime = 0;
      state.pendingAction = 'completed';
      state.pendingActionAt = Date.now();
    },
    restore() {
      if (prevWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = prevWindow;
      }
    },
  };
}

async function runSuite() {
  console.log('\n=== LAZCAKONG GYM 7.0 — SUITE REPARACIÓN NATIVA CRONÓMETRO HONOR 400 PRO ===\n');

  await test('Escenario A: Descansos 60/90/120/150s formatean MM:SS y segundos totales exactos', () => {
    for (const sec of [60, 90, 120, 150]) {
      const formatted = formatSimultaneousRestMmSsSeconds(sec);
      const mmss = formatRestMmSs(sec);
      assert.ok(formatted.includes(mmss), `${sec}s debe mostrar ${mmss}`);
      assert.ok(formatted.includes(`${sec} s`), `${sec}s debe mostrar ${sec} s`);
    }
  });

  await test('Escenarios B-D: Helper y Plugin nativos Java eliminan setSilent(true), aplican VISIBILITY_PUBLIC y canales v2', () => {
    const pluginJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestTimerNotificationPlugin.java'),
      'utf8'
    );
    const helperJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestTimerNotificationHelper.java'),
      'utf8'
    );

    const pluginCodeOnly = pluginJava
      .split('\n')
      .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
      .join('\n');
    assert.ok(!pluginCodeOnly.includes('.setSilent(true)'), 'MagicOS oculta notificaciones con .setSilent(true); no debe usarse');
    assert.ok(pluginJava.includes('setUsesChronometer(true)'));
    assert.ok(pluginJava.includes('setChronometerCountDown(true)'));
    assert.ok(pluginJava.includes('setWhen(targetEndTime)'));
    assert.ok(pluginJava.includes('setTimeoutAfter(remainingMs)'));
    assert.ok(pluginJava.includes('VISIBILITY_PUBLIC'));
    assert.ok(helperJava.includes('CHANNEL_ONGOING_ID = "lazcakong_rest_chronometer_v2"'));
    assert.ok(helperJava.includes('NotificationManager.IMPORTANCE_DEFAULT'));
    assert.ok(helperJava.includes('ongoing.setSound(null, null)'));
    assert.ok(helperJava.includes('Notification.VISIBILITY_PUBLIC'));
    assert.ok(helperJava.includes('LEGACY_CHANNEL_ONGOING_ID'));
  });

  await test('Escenario E: Acciones nativas (Pausar, Reanudar, +15s, Saltar) y RestTimerStore existen en Java y BroadcastReceiver', () => {
    const actionReceiverJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestTimerActionReceiver.java'),
      'utf8'
    );
    const storeJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestTimerStore.java'),
      'utf8'
    );
    const pluginJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestTimerNotificationPlugin.java'),
      'utf8'
    );

    for (const action of ['ACTION_PAUSE', 'ACTION_RESUME', 'ACTION_ADD_15S', 'ACTION_SKIP', 'ACTION_DISMISS_COMPLETE']) {
      assert.ok(actionReceiverJava.includes(action), `ActionReceiver falta acción: ${action}`);
    }
    assert.ok(pluginJava.includes('"Pausar"') && pluginJava.includes('"Reanudar"'));
    assert.ok(pluginJava.includes('"+15s"') && pluginJava.includes('"Saltar"'));
    assert.ok(storeJava.includes('pauseFromNativeAction'));
    assert.ok(storeJava.includes('resumeFromNativeAction'));
    assert.ok(storeJava.includes('adjustFromNativeAction'));
    assert.ok(storeJava.includes('clearFromNativeAction'));
    assert.ok(storeJava.includes('tryClaimCompletion'));
  });

  await test('Escenarios F-I: AlarmManager nativo (RestAlarmReceiver + RestBootReceiver), deduplicación y 3 canales por modo', () => {
    const alarmReceiverJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestAlarmReceiver.java'),
      'utf8'
    );
    const bootReceiverJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestBootReceiver.java'),
      'utf8'
    );
    const helperJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestTimerNotificationHelper.java'),
      'utf8'
    );

    assert.ok(alarmReceiverJava.includes('triggerRestComplete'));
    assert.ok(alarmReceiverJava.includes('intentRestId.equals(state.restId)'));
    assert.ok(bootReceiverJava.includes('ACTION_BOOT_COMPLETED'));
    assert.ok(bootReceiverJava.includes('ACTION_MY_PACKAGE_REPLACED'));
    assert.ok(bootReceiverJava.includes('ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED'));
    assert.ok(helperJava.includes('CHANNEL_FINISH_SOUND_ID'));
    assert.ok(helperJava.includes('CHANNEL_FINISH_VIBRATE_ID'));
    assert.ok(helperJava.includes('CHANNEL_FINISH_SILENT_ID'));
    assert.ok(helperJava.includes('tryClaimCompletion'));
    assert.ok(helperJava.includes('setExactAndAllowWhileIdle'));
  });

  await test('Escenarios J-K: Android 16 Promoted Ongoing y Full-Screen visual alert en RestCompleteLockActivity condicional y legal', () => {
    const helperJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestTimerNotificationHelper.java'),
      'utf8'
    );
    const lockActivityJava = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/java/com/lazcakong/gym/RestCompleteLockActivity.java'),
      'utf8'
    );
    const lockLayoutXml = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/res/layout/activity_rest_complete_lock.xml'),
      'utf8'
    );
    const manifestXml = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );

    assert.ok(helperJava.includes('canPostPromotedNotifications'));
    assert.ok(helperJava.includes('hasPromotableCharacteristics'));
    assert.ok(helperJava.includes('setRequestPromotedOngoing'));
    assert.ok(helperJava.includes('setShortCriticalText'));
    assert.ok(helperJava.includes('canUseFullScreenIntentSafe'));
    assert.ok(helperJava.includes('if (!hostForeground && (isLocked || !screenOn) && canFsi)'));
    assert.ok(helperJava.includes('setFullScreenIntent(fullScreenPi, true)'));
    assert.ok(lockActivityJava.includes('setShowWhenLocked(true)'));
    assert.ok(lockActivityJava.includes('setTurnScreenOn(true)'));
    assert.ok(lockActivityJava.includes('45_000L'));
    assert.ok(lockLayoutXml.includes('btn_continue_workout'));
    assert.ok(lockLayoutXml.includes('btn_dismiss_alert'));
    assert.ok(manifestXml.includes('RestCompleteLockActivity'));
    assert.ok(manifestXml.includes('android:showWhenLocked="true"'));
    assert.ok(manifestXml.includes('android:turnScreenOn="true"'));
  });

  await test('Escenario L: Manifest cumple Google Play (sin USE_EXACT_ALARM, overlay ni REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)', () => {
    const manifestXml = fs.readFileSync(
      path.join(ROOT, 'android/app/src/main/AndroidManifest.xml'),
      'utf8'
    );
    assert.ok(manifestXml.includes('android.permission.SCHEDULE_EXACT_ALARM'));
    assert.ok(manifestXml.includes('android.permission.POST_NOTIFICATIONS'));
    assert.ok(manifestXml.includes('android.permission.POST_PROMOTED_NOTIFICATIONS'));
    assert.ok(manifestXml.includes('android.permission.USE_FULL_SCREEN_INTENT'));
    assert.ok(!manifestXml.includes('USE_EXACT_ALARM'));
    assert.ok(!manifestXml.includes('SYSTEM_ALERT_WINDOW'));
    assert.ok(!manifestXml.includes('REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'));
    assert.ok(!manifestXml.includes('foregroundServiceType="specialUse"'));
  });

  await test('Ciclo completo en puente TS Android simulado: iniciar, pausar, +15s nativo, completar 00:00, cancelar y deep-links', async () => {
    const mock = createMockCapacitorAndroidEnv();
    try {
      assert.equal(REST_LIVE_COUNTDOWN_CHANNEL_ID, 'lazcakong_rest_chronometer_v2');
      assert.equal(REST_SOUND_CHANNEL_ID, 'lazcakong_rest_finish_sound_v2');
      assert.equal(REST_VIBRATE_CHANNEL_ID, 'lazcakong_rest_finish_vibrate_v2');
      assert.equal(REST_SILENT_CHANNEL_ID, 'lazcakong_rest_finish_silent_v2');

      const perm = await getNativeNotificationPermission();
      assert.equal(perm, 'granted');

      const caps = await getNativeRestTimerCapabilities();
      assert.ok(caps?.supportsPromotedOngoing && caps?.canScheduleExactAlarms && caps?.canUseFullScreenIntent);

      const end = Date.now() + 90_000;
      const started = await showOrUpdateNativeOngoingRestNotification({
        targetEndTime: end,
        totalSeconds: 90,
        title: 'LazcaKong Gym · Descanso de 1 min 30 s',
        body: 'Press Banca · Serie 2',
        shortText: 'Descanso',
        restId: 'rest_smoke_1',
        exerciseName: 'Press Banca',
        nextSetNumber: 2,
        mode: 'sound',
        restEndAlertEnabled: true,
      });
      assert.equal(started, true);

      // Android must NOT double schedule via @capacitor/local-notifications
      const scheduledFlag = await scheduleNativeRestNotification({
        targetEndTime: end,
        restId: 'rest_smoke_1',
        mode: 'sound',
      });
      assert.equal(scheduledFlag, true);

      mock.simulateNativeAdd15s();
      const syncedAdd = await consumePendingNativeRestSync();
      assert.equal(syncedAdd?.pendingAction, 'adjusted');
      assert.ok((syncedAdd?.targetEndTime || 0) > end);

      await pauseNativeOngoingRestNotification({
        remainingSeconds: 60,
        totalSeconds: 90,
        exerciseName: 'Press Banca',
        nextSetNumber: 2,
      });

      mock.simulateNativeCompleted();
      const syncedComplete = await consumePendingNativeRestSync();
      assert.equal(syncedComplete?.pendingAction, 'completed');

      const completedCall = await markNativeRestCompleted({
        restId: 'rest_smoke_1',
        targetEndTime: end,
        mode: 'sound',
      });
      assert.equal(completedCall, true);

      await cancelNativeRestNotification('rest_smoke_1', end);
      assert.ok(mock.calls.some((c) => c.method === 'cancelAllRest'));

      await openNativeRestSettingScreen('magicos_autostart');
      await openNativeRestSettingScreen('battery');
      await openNativeRestSettingScreen('exact_alarms');
      await openNativeRestSettingScreen('fullscreen_intent');
      assert.ok(mock.calls.some((c) => c.method === 'openMagicOsAutostartSettings'));
      assert.ok(mock.calls.some((c) => c.method === 'openFullScreenIntentSettings'));
    } finally {
      mock.restore();
    }
  });

  await test('UI Ajustes contiene diagnóstico Honor CRONÓMETRO EN SEGUNDO PLANO', () => {
    const settingsSrc = fs.readFileSync(path.join(ROOT, 'src/views/SettingsCloudView.tsx'), 'utf8');
    assert.ok(settingsSrc.includes('CRONÓMETRO EN SEGUNDO PLANO'));
    assert.ok(settingsSrc.includes('openNativeRestSettingScreen'));
    assert.ok(settingsSrc.includes('Probar cronómetro 15 s (bloquea el teléfono)'));
    assert.ok(settingsSrc.includes('Guía rápida Honor 400 Pro'));
  });

  console.log(`\n🎉 Todas las ${passed} pruebas de reparación nativa Honor 400 Pro pasaron!`);
}

runSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
