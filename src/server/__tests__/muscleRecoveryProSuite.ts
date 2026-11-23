import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CoachPlatformStorageAdapter,
  CompletedWorkout,
  RestTimerState,
  Routine,
} from '../../types/index.ts';
import {
  applyAcceptedSmartPlanToRoutine,
  computeOverallAthleteSummary,
  computeRealTimeRecovery,
  computeRecoveryForecast24_48_72,
  evaluateDailyCheckInReadiness,
  evaluateSmartRoutinePlanning,
  loadDailyRecoveryCheckIn,
  RECOVERY_ESTIMATION_DISCLAIMER,
  saveDailyRecoveryCheckIn,
  skipDailyRecoveryCheckIn,
} from '../../utils/muscleRecoveryEngine.ts';
import { buildPreWorkoutCoachBriefing } from '../../utils/coachContextEngine.ts';
import { speakProactiveCoachMessage } from '../../utils/coachVoiceEngine.ts';
import {
  getRecoveringMusclesSorted,
  resolveMostFatiguedMuscleTarget,
} from '../../utils/muscleMapSelection.ts';

function createMemoryStorage(): CoachPlatformStorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const sampleRoutines: Routine[] = [
  {
    id: 'routine-push',
    dayName: 'Lunes',
    title: 'Empuje Élite (Pecho y Tríceps)',
    tagline: 'Fuerza e hipertrofia pectoral',
    exercises: [
      {
        id: 'ex-bench-1',
        name: 'Press de banca con barra',
        targetMuscles: 'Pectoral, Tríceps, Hombros',
        equipment: 'Barra',
        defaultSets: 4,
        repRange: '6 - 10 reps',
        restSeconds: 120,
        restText: '2 min',
        objective: 'Fuerza base',
        defaultVideoUrl: '',
        techniqueCues: ['Retracción escapular'],
        defaultWeight: 100,
      },
      {
        id: 'ex-incline-2',
        name: 'Press inclinado con mancuernas',
        targetMuscles: 'Pectoral Superior, Hombros',
        equipment: 'Mancuernas',
        defaultSets: 3,
        repRange: '8 - 12 reps',
        restSeconds: 90,
        restText: '1.5 min',
        objective: 'Hipertrofia clavicular',
        defaultVideoUrl: '',
        techniqueCues: ['Control excéntrico'],
        defaultWeight: 35,
      },
    ],
  },
  {
    id: 'routine-legs',
    dayName: 'Miércoles',
    title: 'Piernas Completa (Cuádriceps e Isquios)',
    tagline: 'Tren inferior',
    exercises: [
      {
        id: 'ex-squat-1',
        name: 'Sentadilla con barra',
        targetMuscles: 'Cuádriceps, Glúteos',
        equipment: 'Barra',
        defaultSets: 4,
        repRange: '6 - 10 reps',
        restSeconds: 150,
        restText: '2.5 min',
        objective: 'Fuerza tren inferior',
        defaultVideoUrl: '',
        techniqueCues: ['Rodillas alineadas'],
        defaultWeight: 120,
      },
    ],
  },
];

async function runSuite() {
  console.log('=== LAZCAKONG GYM 7.0 — ETAPA 3: MUSCLE RECOVERY PRO SUITE ===');
  const now = new Date('2026-11-18T12:00:00Z').getTime();

  // ---------------------------------------------------------------------------
  // 1. RECUPERACIÓN CON HISTORIAL VACÍO E INDICADORES DE ESTIMACIÓN ORIENTATIVA
  // ---------------------------------------------------------------------------
  const emptyReport = computeRealTimeRecovery([], now, sampleRoutines, 'ALL');
  const emptySummary = computeOverallAthleteSummary(emptyReport, [], now);
  assert.equal(emptySummary.overallRecoveryPct, 100, 'Historial vacío debe iniciar en 100% recuperación');
  assert.equal(emptySummary.highFatigueCount, 0);
  assert.equal(emptySummary.inRecoveryCount, 0);
  assert.equal(emptyReport.chest_left.isEstimation, true);
  assert.equal(
    emptyReport.chest_left.estimationDisclaimer,
    RECOVERY_ESTIMATION_DISCLAIMER,
    'Cada indicador debe identificarse explícitamente como estimación orientativa'
  );
  console.log('✓ 1. Recuperación con historial vacío e identificación de estimación orientativa verificada.');

  // ---------------------------------------------------------------------------
  // 2. PARTICIPACIÓN MUSCULAR PRIMARIA Y SECUNDARIA
  // ---------------------------------------------------------------------------
  const pushWorkout4hAgo: CompletedWorkout = {
    id: 'w-push-1',
    profileId: 'athlete-a',
    routineId: 'routine-push',
    routineTitle: 'Empuje Élite',
    date: new Date(now - 4 * 3600 * 1000).toISOString(),
    startTime: now - 5 * 3600 * 1000,
    endTime: now - 4 * 3600 * 1000,
    durationSeconds: 3600,
    totalVolumeKg: 4000,
    completedSetsCount: 4,
    isFinished: true,
    avgRpe: 9,
    exercisesSummary: [
      {
        exerciseId: 'ex-bench-1',
        name: 'Press de banca con barra',
        muscleGroup: 'Pectoral',
        sets: 4,
        maxWeight: 100,
        maxReps: 10,
        volumeKg: 4000,
        rpe: 9,
        setsDetail: [
          { id: 's1', setNumber: 1, weight: 100, reps: 10, rpe: 8.5, completed: true },
          { id: 's2', setNumber: 2, weight: 100, reps: 10, rpe: 9.0, completed: true },
          { id: 's3', setNumber: 3, weight: 100, reps: 10, rir: 1, completed: true },
          { id: 's4', setNumber: 4, weight: 100, reps: 10, rir: 0.5, completed: true },
        ],
      },
    ],
  };

  const singlePushReport = computeRealTimeRecovery([pushWorkout4hAgo], now, sampleRoutines, 'ALL');
  const chestState = singlePushReport.chest_left;
  const tricepsState = singlePushReport.triceps_lateral_left;
  assert.ok(chestState.fatigue > tricepsState.fatigue, 'El músculo primario (Pectoral) debe recibir mayor fatiga que el sinergista (Tríceps)');
  assert.ok(tricepsState.fatigue > 0, 'El músculo secundario/sinergista (Tríceps) debe registrar participación ponderada > 0');
  assert.equal(chestState.exercisesTriggered[0]?.role, 'primary');
  assert.equal(tricepsState.exercisesTriggered[0]?.role, 'synergist');
  console.log('✓ 2. Participación muscular primaria (100%) y secundaria/sinergista ponderada verificada.');

  // ---------------------------------------------------------------------------
  // 3. RECUPERACIÓN TRAS SESIONES CONSECUTIVAS Y ALERTA DE SOBRECARGA
  // ---------------------------------------------------------------------------
  const pushWorkout20hAgo: CompletedWorkout = {
    ...pushWorkout4hAgo,
    id: 'w-push-0',
    date: new Date(now - 20 * 3600 * 1000).toISOString(),
    startTime: now - 21 * 3600 * 1000,
    endTime: now - 20 * 3600 * 1000,
  };

  const consecutiveReport = computeRealTimeRecovery(
    [pushWorkout4hAgo, pushWorkout20hAgo],
    now,
    sampleRoutines,
    'ALL'
  );
  const consecutiveSummary = computeOverallAthleteSummary(
    consecutiveReport,
    [pushWorkout4hAgo, pushWorkout20hAgo],
    now
  );
  assert.ok(
    consecutiveReport.chest_left.fatigue > singlePushReport.chest_left.fatigue,
    'Dos sesiones consecutivas en 20 h deben acumular más fatiga que una sola sesión'
  );
  assert.equal(
    consecutiveReport.chest_left.trainingFrequency7d,
    2,
    'La frecuencia de entrenamiento en 7 días debe contabilizar 2 sesiones distintas'
  );
  assert.ok(
    consecutiveSummary.repetitiveStrainAlerts.some((a) => a.canonicalId === 'pectoral_major'),
    'Debe emitirse alerta de sobrecarga repetitiva al entrenar el mismo grupo en < 48 h'
  );
  console.log('✓ 3. Recuperación tras sesiones consecutivas, frecuencia 7d y alerta de sobrecarga verificadas.');

  // ---------------------------------------------------------------------------
  // 4. PREVENCIÓN ESTRICTA DE DOBLE CONTEO (SESIONES CLONADAS Y SERIES DUPLICADAS)
  // ---------------------------------------------------------------------------
  const clonedWorkoutSameId: CompletedWorkout = { ...pushWorkout4hAgo };
  const clonedWorkoutDifferentIdSameSignature: CompletedWorkout = {
    ...pushWorkout4hAgo,
    id: 'w-push-1-cloned-sync',
  };
  const workoutWithDuplicateSetIds: CompletedWorkout = {
    ...pushWorkout4hAgo,
    id: 'w-push-dup-sets',
    exercisesSummary: [
      {
        ...pushWorkout4hAgo.exercisesSummary[0],
        sets: 8, // Inflado artificialmente
        setsDetail: [
          { id: 's1', setNumber: 1, weight: 100, reps: 10, rpe: 8.5, completed: true },
          { id: 's1', setNumber: 1, weight: 100, reps: 10, rpe: 8.5, completed: true }, // Duplicado
          { id: 's2', setNumber: 2, weight: 100, reps: 10, rpe: 9.0, completed: true },
          { id: 's2', setNumber: 2, weight: 100, reps: 10, rpe: 9.0, completed: true }, // Duplicado
          { id: 's3', setNumber: 3, weight: 100, reps: 10, rir: 1, completed: true },
          { id: 's4', setNumber: 4, weight: 100, reps: 10, rir: 0.5, completed: true },
        ],
      },
      // Bloque de ejercicio duplicado idéntico en la misma sesión
      {
        ...pushWorkout4hAgo.exercisesSummary[0],
        sets: 4,
        setsDetail: [
          { id: 's1', setNumber: 1, weight: 100, reps: 10, rpe: 8.5, completed: true },
          { id: 's2', setNumber: 2, weight: 100, reps: 10, rpe: 9.0, completed: true },
          { id: 's3', setNumber: 3, weight: 100, reps: 10, rir: 1, completed: true },
          { id: 's4', setNumber: 4, weight: 100, reps: 10, rir: 0.5, completed: true },
        ],
      },
    ],
  };

  const deduplicatedSessionsReport = computeRealTimeRecovery(
    [pushWorkout4hAgo, clonedWorkoutSameId, clonedWorkoutDifferentIdSameSignature],
    now,
    sampleRoutines,
    'ALL'
  );
  assert.equal(
    deduplicatedSessionsReport.chest_left.fatigue,
    singlePushReport.chest_left.fatigue,
    'Sesiones clonadas (mismo ID o misma firma temporal/volumen) jamás deben sumarse dos veces'
  );
  assert.equal(
    deduplicatedSessionsReport.chest_left.sets,
    singlePushReport.chest_left.sets,
    'El conteo de series efectivas no debe duplicarse ante sesiones clonadas'
  );

  const deduplicatedSetsReport = computeRealTimeRecovery(
    [workoutWithDuplicateSetIds],
    now,
    sampleRoutines,
    'ALL'
  );
  assert.equal(
    deduplicatedSetsReport.chest_left.sets,
    4,
    'Series repetidas con el mismo ID o ejercicios duplicados en la misma sesión deben contabilizarse una sola vez (4 series)'
  );
  console.log('✓ 4. Prevención de doble conteo de series y sesiones verificada.');

  // ---------------------------------------------------------------------------
  // 5. EVALUACIÓN DIARIA DEL ATLETA, REGLA DE SEGURIDAD ANTE DOLOR/ALERTA Y PERSISTENCIA OFFLINE
  // ---------------------------------------------------------------------------
  const storage = createMemoryStorage();
  const dateKey = '2026-11-18';

  // Omitir cuestionario debe ser válido y no bloquear al atleta
  const skippedRecord = skipDailyRecoveryCheckIn('athlete-a', dateKey, storage);
  assert.equal(skippedRecord.skipped, true);
  const skippedEval = evaluateDailyCheckInReadiness(skippedRecord);
  assert.equal(skippedEval.isSkipped, true);
  assert.equal(skippedEval.blocksIntenseRecommendation, false);

  // Guardar cuestionario con señales de alerta (molestia 'alert' y sueño < 5h)
  const alertCheckIn = saveDailyRecoveryCheckIn(
    {
      profileId: 'athlete-a',
      dateKey,
      sleepHours: 4.5,
      sleepQuality: 2,
      energyLevel: 2,
      perceivedFatigue: 5,
      muscleSoreness: 'alert',
      trainingDisposition: 2,
    },
    storage
  );
  const loadedCheckIn = loadDailyRecoveryCheckIn('athlete-a', dateKey, storage);
  assert.ok(loadedCheckIn, 'La evaluación diaria debe persistir y recuperarse offline');
  assert.equal(loadedCheckIn?.sleepHours, 4.5);

  const alertEval = evaluateDailyCheckInReadiness(loadedCheckIn);
  assert.equal(alertEval.hasAlertSignal, true);
  assert.equal(
    alertEval.blocksIntenseRecommendation,
    true,
    'Señales de alerta deben bloquear recomendaciones de entrenamiento intenso'
  );
  assert.ok(
    alertEval.safetyDisclaimer.includes('no diagnostican lesiones médicas'),
    'El aviso de seguridad debe aclarar que las respuestas de dolor no diagnostican lesiones médicas'
  );
  console.log('✓ 5. Evaluación diaria (opción de omitir, persistencia offline y regla de seguridad ante dolor/alerta) verificada.');

  // ---------------------------------------------------------------------------
  // 6. AISLAMIENTO ESTRICTO DE DATOS ENTRE ATLETAS
  // ---------------------------------------------------------------------------
  const athleteBCheckIn = loadDailyRecoveryCheckIn('athlete-b', dateKey, storage);
  assert.equal(
    athleteBCheckIn,
    null,
    'La evaluación diaria del Atleta A jamás debe filtrarse al Atleta B'
  );

  const athleteBReport = computeRealTimeRecovery(
    [pushWorkout4hAgo], // Pertenece a 'athlete-a'
    now,
    sampleRoutines,
    'ALL',
    'ALL',
    { profileId: 'athlete-b' }
  );
  assert.equal(
    athleteBReport.chest_left.fatigue,
    0,
    'Los entrenamientos de athlete-a jamás deben generar fatiga en el perfil de athlete-b'
  );
  console.log('✓ 6. Aislamiento estricto de datos entre atletas (historial y check-in diario) verificado.');

  // ---------------------------------------------------------------------------
  // 7. PLANIFICACIÓN INTELIGENTE PRE-RUTINA, SUSTITUCIÓN TECHNIQUE PRO Y NO-MUTACIÓN
  // ---------------------------------------------------------------------------
  const originalPushSnapshot = JSON.stringify(sampleRoutines[0]);

  // Evaluar rutina de Empuje cuando Pectoral y Tríceps están fatigados
  const smartPlanFatigued = evaluateSmartRoutinePlanning({
    routine: sampleRoutines[0],
    routines: sampleRoutines,
    history: [pushWorkout4hAgo, pushWorkout20hAgo],
    currentTime: now,
    profileId: 'athlete-a',
  });

  assert.ok(
    smartPlanFatigued.fatiguedMusclesInRoutine.length > 0,
    'Debe detectar los músculos fatigados implicados en la rutina de Empuje'
  );
  assert.ok(
    smartPlanFatigued.recommendedAlternativeRoutine?.routineId === 'routine-legs',
    'Debe recomendar la rutina existente de Piernas cuyos músculos están 100% frescos hoy'
  );
  assert.equal(
    smartPlanFatigued.options.length,
    6,
    'Debe ofrecer las 6 opciones explícitas (mantener, reducir intensidad, reducir volumen, sustituir, cambiar rutina, recomendar descanso)'
  );
  assert.ok(
    smartPlanFatigued.substitutionProposals.length > 0,
    'Debe proponer sustituciones de ejercicios para los músculos primarios fatigados'
  );

  // Verificar que al existir señal de alerta en el check-in diario, NUNCA recomienda mantener entrenamiento intenso
  const smartPlanWithAlert = evaluateSmartRoutinePlanning({
    routine: sampleRoutines[0],
    routines: sampleRoutines,
    history: [pushWorkout4hAgo],
    currentTime: now,
    dailyCheckIn: alertCheckIn,
    profileId: 'athlete-a',
  });
  assert.equal(smartPlanWithAlert.hasAlertSignal, true);
  assert.equal(
    smartPlanWithAlert.recommendedAction,
    'recommend_rest',
    'Cuando existen señales de alerta en el check-in diario, debe recomendar descanso/descarga y nunca entrenamiento intenso'
  );
  const maintainOptionUnderAlert = smartPlanWithAlert.options.find(
    (o) => o.action === 'maintain_plan'
  );
  assert.equal(maintainOptionUnderAlert?.isRecommended, false);
  assert.equal(maintainOptionUnderAlert?.isBlockedByAlert, true);

  // Verificar aplicación explícita de sustitución de ejercicios: actualiza Technique Pro, conserva IDs originales y NO muta la rutina guardada
  const subOutcome = applyAcceptedSmartPlanToRoutine({
    routine: sampleRoutines[0],
    routines: sampleRoutines,
    action: 'substitute_exercises',
    evaluation: smartPlanFatigued,
  });
  assert.ok(subOutcome.sessionRoutine, 'Debe generar una rutina de sesión con los ejercicios sustituidos');
  assert.equal(
    subOutcome.sessionRoutine?.exercises[0].id,
    'ex-bench-1',
    'La sustitución de ejercicios JAMÁS debe modificar el ID original del ejercicio'
  );
  assert.notEqual(
    subOutcome.sessionRoutine?.exercises[0].name,
    'Press de banca con barra',
    'El nombre del ejercicio en la copia de sesión debe actualizarse al reemplazo aceptado'
  );
  assert.ok(
    subOutcome.sessionRoutine?.exercises[0].techniquePro &&
      subOutcome.sessionRoutine.exercises[0].techniquePro.specificTips.length >= 3,
    'El ejercicio sustituido debe incluir su perfil completo de Technique Pro actualizado'
  );
  assert.equal(
    JSON.stringify(sampleRoutines[0]),
    originalPushSnapshot,
    'La rutina original almacenada jamás debe mutarse automáticamente'
  );

  // Verificar reducción de volumen explícita
  const volOutcome = applyAcceptedSmartPlanToRoutine({
    routine: sampleRoutines[0],
    routines: sampleRoutines,
    action: 'reduce_volume',
    evaluation: smartPlanFatigued,
  });
  assert.equal(volOutcome.sessionRoutine?.exercises[0].defaultSets, 3);
  assert.equal(sampleRoutines[0].exercises[0].defaultSets, 4, 'La rutina original conserva sus 4 series');
  console.log('✓ 7. Planificación inteligente pre-rutina, sustitución con Technique Pro y no-mutación de rutinas verificadas.');

  // ---------------------------------------------------------------------------
  // 8. PRONÓSTICO DE RECUPERACIÓN (24 H, 48 H, 72 H) Y DETECCIÓN DE INCERTIDUMBRE
  // ---------------------------------------------------------------------------
  const emptyForecast = computeRecoveryForecast24_48_72([], now, sampleRoutines);
  assert.equal(
    emptyForecast.uncertaintyLevel,
    'high',
    'Sin historial debe indicar mayor incertidumbre en el pronóstico'
  );

  const activeForecast = computeRecoveryForecast24_48_72(
    [pushWorkout4hAgo, pushWorkout20hAgo],
    now,
    sampleRoutines,
    { profileId: 'athlete-a' }
  );
  assert.equal(activeForecast.uncertaintyLevel, 'low');
  assert.ok(
    activeForecast.horizons.h24.estimatedOverallRecoveryPct <=
      activeForecast.horizons.h48.estimatedOverallRecoveryPct &&
      activeForecast.horizons.h48.estimatedOverallRecoveryPct <=
        activeForecast.horizons.h72.estimatedOverallRecoveryPct,
    'El pronóstico de recuperación debe progresar monótonamente de +24h a +48h y +72h'
  );
  const chestForecast = activeForecast.byCanonicalMuscle.find(
    (m) => m.groupId === 'pectoral_major'
  );
  assert.ok(chestForecast, 'Debe incluir desglose pronosticado para Pectoral');
  assert.ok(
    chestForecast.currentRecoveryPct < chestForecast.h24RecoveryPct &&
      chestForecast.h24RecoveryPct <= chestForecast.h48RecoveryPct &&
      chestForecast.h48RecoveryPct <= chestForecast.h72RecoveryPct,
    'El porcentaje de recuperación de Pectoral debe incrementarse a las 24h, 48h y 72h'
  );
  console.log('✓ 8. Pronóstico de recuperación a 24 h, 48 h y 72 h e indicador de incertidumbre verificados.');

  // ---------------------------------------------------------------------------
  // 9. INTEGRACIÓN CON COACH INTELLIGENCE PRO Y MOTOR DE VOZ (SIN INTERFERENCIA CON DESCANSO)
  // ---------------------------------------------------------------------------
  const preBriefing = buildPreWorkoutCoachBriefing({
    routine: sampleRoutines[0],
    history: [pushWorkout4hAgo],
    routines: sampleRoutines,
    referenceDate: new Date(now),
    dailyCheckIn: alertCheckIn,
  });
  assert.ok(preBriefing.recoveryForecast, 'PreWorkoutCoachBriefing debe integrar el pronóstico 24/48/72h');
  assert.ok(preBriefing.smartPlanning, 'PreWorkoutCoachBriefing debe integrar la evaluación de planificación inteligente');
  assert.equal(
    preBriefing.intensityAdjustment.action,
    'moderate_deload',
    'Coach Intelligence Pro debe sincronizar su ajuste de intensidad con las alertas de Muscle Recovery Pro'
  );

  let spokenCount = 0;
  const mockVoiceAdapter = {
    isAvailable: () => true,
    speak: () => {
      spokenCount += 1;
      return true;
    },
    stop: () => {},
  };

  const silentVoice = speakProactiveCoachMessage({
    rawText: smartPlanFatigued.voiceSummaryText,
    eventKey: 'test_silent_recovery',
    spokenEventKeys: new Set<string>(),
    isImportant: true,
    mode: 'silent',
    voiceAdapter: mockVoiceAdapter,
  });
  assert.equal(silentVoice.spoken, false);
  assert.equal(silentVoice.reason, 'silent_mode');

  const endingRestTimer: RestTimerState = {
    active: true,
    paused: false,
    totalSeconds: 90,
    remainingSeconds: 2,
    minimized: false,
  };
  const timerGuardedVoice = speakProactiveCoachMessage({
    rawText: smartPlanFatigued.voiceSummaryText,
    eventKey: 'test_timer_guarded',
    spokenEventKeys: new Set<string>(),
    isImportant: true,
    mode: 'full_coach',
    restTimerActive: endingRestTimer.active,
    restTimerPaused: endingRestTimer.paused,
    restTimerRemainingSeconds: endingRestTimer.remainingSeconds,
    voiceAdapter: mockVoiceAdapter,
  });
  assert.equal(
    timerGuardedVoice.spoken,
    false,
    'El motor de voz jamás debe interferir cuando el temporizador de descanso está por finalizar'
  );
  assert.equal(timerGuardedVoice.reason, 'rest_timer_imminent_alarm');

  const activeVoice = speakProactiveCoachMessage({
    rawText: smartPlanFatigued.voiceSummaryText,
    eventKey: 'test_active_voice',
    spokenEventKeys: new Set<string>(),
    isImportant: true,
    mode: 'important_only',
    voiceAdapter: mockVoiceAdapter,
  });
  assert.equal(activeVoice.spoken, true);
  assert.equal(spokenCount, 1);
  console.log('✓ 9. Integración con Coach Intelligence Pro y motor de voz es-CL sin interferir con el descanso verificada.');

  // ---------------------------------------------------------------------------
  // 10. PRIORIZACIÓN AUTOMÁTICA Y CONSERVACIÓN DEL MAPA MUSCULAR EXISTENTE
  // ---------------------------------------------------------------------------
  const sortedRecovering = getRecoveringMusclesSorted(consecutiveSummary);
  assert.ok(sortedRecovering.length > 0);
  assert.equal(
    sortedRecovering[0].canonicalId,
    'pectoral_major',
    'Pectoral debe priorizarse automáticamente en primer lugar tras sesiones de Empuje'
  );
  const topTarget = resolveMostFatiguedMuscleTarget(consecutiveSummary);
  assert.equal(topTarget?.interactiveId, 'pectoral_medio_left');
  assert.equal(topTarget?.view, 'frontal');

  const mapaViewPath = path.resolve(process.cwd(), 'src/views/MapaMuscularView.tsx');
  const mapaSource = fs.readFileSync(mapaViewPath, 'utf8');
  assert.ok(mapaSource.includes('/images/anatomia-frontal.png'), 'Debe conservar la ilustración oficial frontal');
  assert.ok(mapaSource.includes('/images/anatomia-posterior.png'), 'Debe conservar la ilustración oficial posterior');
  assert.ok(mapaSource.includes('data-testid="smart-muscle-prioritization-card"'));
  assert.ok(mapaSource.includes('data-testid="daily-recovery-checkin-card"'));
  assert.ok(mapaSource.includes('data-testid="recovery-forecast-24-48-72"'));
  assert.ok(mapaSource.includes('data-testid="smart-routine-planner-card"'));
  assert.ok(mapaSource.includes('Ver Técnica Pro'));
  console.log('✓ 10. Priorización inteligente y conservación del Mapa Muscular interactivo verificadas.');

  console.log('=== TODAS LAS PRUEBAS DE MUSCLE RECOVERY PRO (ETAPA 3) PASARON EXITOSAMENTE ===');
}

runSuite().catch((err) => {
  console.error('Fallo en muscleRecoveryProSuite:', err);
  process.exit(1);
});
