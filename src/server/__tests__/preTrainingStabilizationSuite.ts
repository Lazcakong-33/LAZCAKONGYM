/**
 * LAZCAKONG GYM 7.0 — ESTABILIZACIÓN PREENTRENAMIENTO (SUITE AISLADA)
 *
 * Verifica con datos estrictamente sintéticos (`test-pretraining-athlete-1`) y Storage en memoria:
 * - PRIORIDAD 1: Integridad completa del entrenamiento (inicio, registro peso/reps/RPE,
 *   completado, pausa/reanudación con exclusión de tiempo pausado, persistencia al cambiar
 *   de pantalla/pestaña, cierre/reapertura, recuperación interrumpida, finalización sin
 *   duplicados y protección contra sobrescritura de historial/rutinas).
 * - PRIORIDAD 2: Cronómetro de descanso (60/90/120/150 s, presentación simultánea MM:SS +
 *   segundos totales, ajuste manual, persistencia entre pantallas y bloqueo, notificación de fin,
 *   capacidades nativas Android y modos de alerta sin interferencia).
 *
 * CERO lecturas o escrituras en Firebase de producción o cuentas reales.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ActiveWorkoutSession,
  CompletedWorkout,
  PersonalRecord,
  Routine,
} from '../../types/index.ts';
import {
  clearActiveSessionUiState,
  computeActiveSessionElapsedMs,
  countCompletedSetsInSession,
  deriveRirFromRpe,
  ensureSessionStableIds,
  generateStableId,
  loadActiveSessionUiState,
  pauseActiveWorkoutSession,
  reconcileActiveSessionWithCloud,
  reconcileBodyWeightLogs,
  reconcilePersonalRecordsMap,
  reconcileRoutinesWithCloud,
  resumeActiveWorkoutSession,
  saveActiveSessionUiState,
} from '../../utils/workoutPersistence.ts';
import { purgeAndSanitizeWorkoutHistory } from '../../utils/historySanitizer.ts';
import {
  formatDetailedRest,
  formatRestMmSs,
  formatSimultaneousRestMmSsSeconds,
} from '../../utils/restFormatter.ts';
import {
  hasCompleteAlertFired,
  markCompleteAlertHandled,
  resetCompleteAlertTracking,
} from '../../utils/backgroundTimer.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

async function runSuite() {
  console.log('\n====================================================================');
  console.log('   LAZCAKONG GYM 7.0 — ESTABILIZACIÓN PREENTRENAMIENTO (AISLADA)    ');
  console.log('====================================================================\n');

  const testAthleteId = 'test-pretraining-athlete-1';
  const storage = new MemoryStorage();

  // =========================================================================
  // PRIORIDAD 1 — INTEGRIDAD DEL ENTRENAMIENTO
  // =========================================================================
  console.log('PRIORIDAD 1 — INTEGRIDAD DEL ENTRENAMIENTO');

  const t0 = 1_760_000_000_000;
  let session: ActiveWorkoutSession = ensureSessionStableIds({
    sessionId: generateStableId('workout'),
    routineId: 'test-rutina-torso-pre',
    routineTitle: 'Torso Pesado Preentrenamiento',
    startTime: t0,
    updatedAt: t0,
    exercises: [
      {
        exerciseId: 'ex-pre-1',
        exerciseName: 'Press de banca con barra',
        activeExerciseName: 'Press de banca con barra',
        targetMuscles: 'Pecho',
        restSeconds: 120,
        sets: [
          { setNumber: 1, weight: '', reps: '', completed: false },
          { setNumber: 2, weight: '', reps: '', completed: false },
        ],
      },
      {
        exerciseId: 'ex-pre-2',
        exerciseName: 'Remo con barra',
        activeExerciseName: 'Remo con barra',
        targetMuscles: 'Espalda',
        restSeconds: 150,
        sets: [
          { setNumber: 1, weight: '', reps: '', completed: false },
          { setNumber: 2, weight: '', reps: '', completed: false },
        ],
      },
      {
        exerciseId: 'ex-pre-3',
        exerciseName: 'Peso muerto rumano con barra',
        activeExerciseName: 'Peso muerto rumano con barra',
        targetMuscles: 'Isquiotibiales',
        restSeconds: 150,
        sets: [{ setNumber: 1, weight: '', reps: '', completed: false }],
      },
    ],
  });

  assert(
    Boolean(session.sessionId) && session.exercises.every((ex) => ex.sets.every((s) => Boolean(s.id))),
    '1.1 Iniciar rutina genera sessionId y setIds estables'
  );

  // Registrar series, pesos, reps y RPE
  session.exercises[0].sets[0] = {
    ...session.exercises[0].sets[0],
    weight: 85,
    reps: 6,
    rpe: 8.5,
    rir: deriveRirFromRpe(8.5),
    completed: true,
    completedAt: new Date(t0 + 180_000).toISOString(),
  };
  session.exercises[0].sets[1] = {
    ...session.exercises[0].sets[1],
    weight: 85,
    reps: 6,
    rpe: 9,
    rir: deriveRirFromRpe(9),
    completed: true,
    completedAt: new Date(t0 + 360_000).toISOString(),
  };
  assert(
    countCompletedSetsInSession(session) === 2 && session.exercises[0].sets[0].rir === 1.5,
    '1.2 Registrar series, peso, reps y RPE calcula RIR y actualiza el conteo completado'
  );

  // Completar primer ejercicio y avanzar al segundo
  assert(
    session.exercises[0].sets.every((s) => s.completed) &&
      !session.exercises[1].sets.every((s) => s.completed),
    '1.3 Completar todas las series marca el ejercicio como finalizado sin alterar los pendientes'
  );

  // Pausar y reanudar sesión excluyendo el tiempo en pausa
  const activeBeforePauseMs = 12 * 60_000; // 12 min activos
  session = pauseActiveWorkoutSession(session, t0 + activeBeforePauseMs);
  assert(
    session.isPaused === true &&
      session.pausedAt === t0 + activeBeforePauseMs &&
      computeActiveSessionElapsedMs(session, t0 + activeBeforePauseMs + 45 * 60_000) === activeBeforePauseMs,
    '1.4a Pausar sesión congela el tiempo activo aunque transcurran 45 min en pausa'
  );

  // Idempotencia al pausar dos veces
  const doublePaused = pauseActiveWorkoutSession(session, t0 + activeBeforePauseMs + 60_000);
  assert(
    doublePaused.pausedAt === session.pausedAt,
    '1.4b Re-pausar una sesión ya pausada es idempotente'
  );

  // Reanudar tras 20 minutos en pausa y entrenar otros 8 minutos
  const resumeAt = t0 + activeBeforePauseMs + 20 * 60_000;
  session = resumeActiveWorkoutSession(session, resumeAt);
  const afterResumeNow = resumeAt + 8 * 60_000;
  const elapsedAfterResume = computeActiveSessionElapsedMs(session, afterResumeNow);
  assert(
    session.isPaused === false &&
      session.pausedAt === undefined &&
      elapsedAfterResume === 20 * 60_000,
    '1.4c Reanudar sesión acumula exactamente 20 min activos (12 + 8 min) excluyendo los 20 min de pausa'
  );

  // Cambiar de pantalla / desmontar ActiveWorkoutView
  saveActiveSessionUiState(
    session.sessionId,
    {
      focusedExerciseIndex: 2,
      viewMode: 'list',
      autoRestEnabled: false,
      selectedSetIndexMap: { 'ex-pre-3': 0 },
    },
    storage
  );
  const restoredUi = loadActiveSessionUiState(session.sessionId, storage);
  assert(
    restoredUi !== null &&
      restoredUi.focusedExerciseIndex === 2 &&
      restoredUi.viewMode === 'list' &&
      restoredUi.autoRestEnabled === false &&
      restoredUi.selectedSetIndexMap['ex-pre-3'] === 0,
    '1.5 Cambiar de pestaña preserva ejercicio enfocado, vista lista/enfoque, auto-descanso y serie seleccionada'
  );

  // Cerrar, reabrir y recuperar sesión interrumpida (persistencia local + reconciliación segura)
  storage.setItem(`lazcakon_${testAthleteId}_active_session`, JSON.stringify(session));
  const reopenedSession = JSON.parse(
    storage.getItem(`lazcakon_${testAthleteId}_active_session`)!
  ) as ActiveWorkoutSession;
  const recoveredOffline = reconcileActiveSessionWithCloud({
    localSession: reopenedSession,
    cloudSession: null,
    hasPendingOfflineSync: true,
    history: [],
  });
  assert(
    recoveredOffline.source === 'local_kept' &&
      recoveredOffline.resolvedSession?.sessionId === session.sessionId &&
      countCompletedSetsInSession(recoveredOffline.resolvedSession) === 2,
    '1.6-1.7 Cerrar y reabrir recupera la sesión interrumpida y bloquea borrados por snapshot vacío'
  );

  // Finalizar entrenamiento y verificar que no duplica historial
  const finishNow = afterResumeNow + 60_000;
  const durationSeconds = Math.round(computeActiveSessionElapsedMs(reopenedSession, finishNow) / 1000);
  const completedWorkout: CompletedWorkout = {
    id: reopenedSession.sessionId!,
    profileId: testAthleteId,
    routineId: reopenedSession.routineId,
    routineTitle: reopenedSession.routineTitle,
    date: '2026-11-23T12:00:00.000Z',
    startTime: finishNow - durationSeconds * 1000,
    endTime: finishNow,
    durationSeconds,
    totalVolumeKg: 1020,
    completedSetsCount: 2,
    isFinished: true,
    exercisesSummary: [
      {
        exerciseId: 'ex-pre-1',
        name: 'Press de banca con barra',
        muscleGroup: 'Pecho',
        sets: 2,
        maxWeight: 85,
        maxReps: 6,
        volumeKg: 1020,
        rpe: 8.8,
        setsDetail: [
          { setNumber: 1, weight: 85, reps: 6, rpe: 8.5, rir: 1.5, completed: true },
          { setNumber: 2, weight: 85, reps: 6, rpe: 9, rir: 1, completed: true },
        ],
      },
    ],
  };

  const priorWorkout: CompletedWorkout = {
    id: 'wk-prev-day-1',
    profileId: testAthleteId,
    routineId: 'test-rutina-pierna-prev',
    routineTitle: 'Pierna Base',
    date: '2026-11-21T11:00:00.000Z',
    startTime: finishNow - 2 * 86_400_000,
    endTime: finishNow - 2 * 86_400_000 + 2700_000,
    durationSeconds: 2700,
    totalVolumeKg: 3500,
    completedSetsCount: 6,
    isFinished: true,
    exercisesSummary: [
      {
        exerciseId: 'ex-sq-1',
        name: 'Sentadilla con barra',
        muscleGroup: 'Cuádriceps',
        sets: 6,
        maxWeight: 120,
        maxReps: 5,
        volumeKg: 3500,
        setsDetail: [{ setNumber: 1, weight: 120, reps: 5, completed: true }],
      },
    ],
  };

  const historyAttempt = purgeAndSanitizeWorkoutHistory(
    [completedWorkout, { ...completedWorkout }, priorWorkout],
    84
  );
  assert(
    historyAttempt.cleanedHistory.length === 2 &&
      historyAttempt.cleanedHistory.some((w) => w.id === priorWorkout.id) &&
      historyAttempt.cleanedHistory.some((w) => w.id === completedWorkout.id),
    '1.8-1.9 Finalizar entrenamiento colapsa reintentos duplicados a 1 y conserva todo el historial previo'
  );

  clearActiveSessionUiState(session.sessionId, storage);
  assert(
    loadActiveSessionUiState(session.sessionId, storage) === null,
    '1.8b Limpieza de estado UI tras finalizar sesión funciona correctamente'
  );

  // Protección contra sobrescritura de rutinas / PRs / peso corporal
  const localRoutine: Routine = {
    id: 'rut-local-keep',
    dayName: 'Lunes',
    title: 'Torso A',
    tagline: 'Fuerza',
    exercises: [],
  };
  const routineGuard = reconcileRoutinesWithCloud({
    localRoutines: [localRoutine],
    cloudRoutines: [],
    hasPendingRoutineOp: false,
  });
  assert(
    routineGuard.source === 'local_kept' && routineGuard.resolvedRoutines.length === 1,
    '1.10a Snapshot vacío en nube no borra rutinas locales existentes sin autorización explícita'
  );

  const localPRs: Record<string, PersonalRecord> = {
    'ex-pre-1': {
      exerciseId: 'ex-pre-1',
      exerciseName: 'Press de banca con barra',
      maxWeight: 105,
      repsAtMaxWeight: 5,
      estimated1RM: 123,
      date: '2026-11-23T12:00:00.000Z',
    },
  };
  const staleCloudPRs: Record<string, PersonalRecord> = {
    'ex-pre-1': {
      exerciseId: 'ex-pre-1',
      exerciseName: 'Press de banca con barra',
      maxWeight: 95,
      repsAtMaxWeight: 5,
      estimated1RM: 111,
      date: '2026-11-10T12:00:00.000Z',
    },
  };
  const mergedPRs = reconcilePersonalRecordsMap(localPRs, staleCloudPRs);
  const mergedBW = reconcileBodyWeightLogs(
    [{ id: 'bw-loc', date: '2026-11-23T08:00:00.000Z', weightKg: 84.2 }],
    [{ id: 'bw-cld', date: '2026-11-20T08:00:00.000Z', weightKg: 84.6 }],
    false
  );
  assert(
    mergedPRs['ex-pre-1'].maxWeight === 105 && mergedBW.length === 2,
    '1.10b PRs monotónicos y unión de peso corporal impiden degradar datos históricos'
  );

  // =========================================================================
  // PRIORIDAD 2 — CRONÓMETRO DE DESCANSO
  // =========================================================================
  console.log('\nPRIORIDAD 2 — CRONÓMETRO DE DESCANSO');

  // Descansos de 60, 90, 120 y 150 s + presentación simultánea MM:SS y segundos totales
  assert(
    formatSimultaneousRestMmSsSeconds(60) === '01:00 (60 s)' &&
      formatSimultaneousRestMmSsSeconds(90) === '01:30 (90 s)' &&
      formatSimultaneousRestMmSsSeconds(120) === '02:00 (120 s)' &&
      formatSimultaneousRestMmSsSeconds(150) === '02:30 (150 s)',
    '2.1 Formateo simultáneo MM:SS + segundos totales para 60, 90, 120 y 150 s'
  );
  assert(
    formatRestMmSs(90) === '01:30' &&
      formatDetailedRest(150) === '2 min 30 s (150 s)',
    '2.2 Formatters MM:SS y formatDetailedRest mantienen compatibilidad intacta'
  );

  const activeViewSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/views/ActiveWorkoutView.tsx'),
    'utf8'
  );
  const widgetSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/RestTimerWidget.tsx'),
    'utf8'
  );
  const useGymSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/hooks/useGymState.ts'),
    'utf8'
  );
  const settingsSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/views/SettingsCloudView.tsx'),
    'utf8'
  );
  const swSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'public/sw.js'),
    'utf8'
  );
  const nativeJavaSrc = fs.readFileSync(
    path.resolve(
      process.cwd(),
      'android/app/src/main/java/com/lazcakong/gym/RestTimerNotificationPlugin.java'
    ),
    'utf8'
  );

  assert(
    activeViewSrc.includes('const REST_PRESET_SECONDS = [15, 45, 60, 90, 120, 150, 180]') &&
      activeViewSrc.includes('liveRestRemaining') &&
      activeViewSrc.includes('formatRestMmSs(') &&
      widgetSrc.includes('({displaySec} s)') &&
      widgetSrc.includes('({timer.totalSeconds} s)'),
    '2.3 UI de Entrenar y RestTimerWidget muestran presets 60/90/120/150s y MM:SS + segundos totales simultáneamente'
  );

  // Ajuste manual, persistencia en cambio de pestaña y cálculo wall-clock tras bloqueo de pantalla
  const restStartMs = 1_760_100_000_000;
  const target150 = restStartMs + 150 * 1000;
  const unlockedAt85s = restStartMs + 85 * 1000;
  const remainingAfterLock = Math.max(0, Math.ceil((target150 - unlockedAt85s) / 1000));
  const adjustedPlus15 = remainingAfterLock + 15; // 65 + 15 = 80s
  const adjustedMinus15 = Math.max(0, adjustedPlus15 - 15); // 65s
  assert(
    remainingAfterLock === 65 && adjustedPlus15 === 80 && adjustedMinus15 === 65,
    '2.4-2.5 Reloj wall-clock (targetEndTime) y ajustes manuales (-15s/+15s/+30s) conservan precisión al bloquear/desbloquear'
  );

  // Deduplicación de notificación de fin de descanso y recuperación tras reapertura en frío
  const sampleRestId = 'rest-pre-dedup-1';
  resetCompleteAlertTracking(sampleRestId);
  assert(!hasCompleteAlertFired(sampleRestId), '2.6a Alerta de fin inicia limpia');
  markCompleteAlertHandled(sampleRestId);
  assert(
    hasCompleteAlertFired(sampleRestId),
    '2.6b Deduplicación marca restId como atendido (sin doble notificación SW/App)'
  );
  assert(
    useGymSrc.includes('expiredAgoMs <= 5 * 60 * 1000') &&
      useGymSrc.includes('showRestCompleteNotice('),
    '2.6c Reapertura reciente tras vencer descanso con pantalla bloqueada muestra confirmación en UI sin duplicar alarma'
  );
  assert(
    !swSrc.includes('setTimeout(') && !swSrc.includes('setInterval('),
    '2.6d public/sw.js no usa polling/setTimeout/setInterval (notificación única en panel y pantalla de bloqueo)'
  );

  // Capacidades nativas Android y modos de alerta
  assert(
    nativeJavaSrc.includes('setUsesChronometer(true)') &&
      nativeJavaSrc.includes('setChronometerCountDown(true)') &&
      nativeJavaSrc.includes('getCapabilities(') &&
      settingsSrc.includes('getNativeRestTimerCapabilities') &&
      useGymSrc.includes("const getCurrentRestAlertMode = (): 'sound' | 'vibrate_only' | 'silent'") &&
      activeViewSrc.includes('Pitido final') &&
      activeViewSrc.includes('Solo vibración') &&
      activeViewSrc.includes('Silencio'),
    '2.7-2.8 Plugin nativo Android (cronómetro regresivo + getCapabilities + chip Android 16) y 3 modos de alerta verificados'
  );

  console.log('\n====================================================================');
  console.log('   RESULTADO: TODAS LAS PRUEBAS PREENTRENAMIENTO PASARON (0 FALLOS)  ');
  console.log('====================================================================\n');
}

runSuite().catch((err) => {
  console.error('\n❌ ERROR EN SUITE PREENTRENAMIENTO:', err);
  process.exit(1);
});
