/**
 * SUITE DE VERIFICACIÓN: LAZCAKONG GYM 7.0 — ETAPA 2: COACH INTELLIGENCE PRO
 * Ejecución: npx tsx src/server/__tests__/coachIntelligenceProSuite.ts
 */

import {
  buildPreWorkoutCoachBriefing,
  evaluateCompletedSetWithCoach,
  applyAcceptedCoachSetAdjustment,
  buildPostWorkoutCoachReport,
} from '../../utils/coachContextEngine';
import {
  shouldSpeakCoachEvent,
  speakProactiveCoachMessage,
  loadCoachVoiceMode,
  saveCoachVoiceMode,
  getCoachVoiceModeLabel,
} from '../../utils/coachVoiceEngine';
import {
  buildTechniqueProProfile,
  findRecommendedAlternative,
  libraryItemToExercise,
} from '../../utils/exerciseAlternatives';
import {
  EXERCISE_LIBRARY,
  resolveLibraryExercise,
} from '../../data/exerciseLibrary';
import {
  ensureSessionStableIds,
  reconcileActiveSessionWithCloud,
} from '../../utils/workoutPersistence';
import {
  ActiveWorkoutSession,
  CoachPlatformStorageAdapter,
  CoachPlatformVoiceAdapter,
  CompletedWorkout,
  PersonalRecord,
  Routine,
  WorkoutExerciseState,
} from '../../types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`[FALLO COACH INTELLIGENCE PRO 7.0] ${message}`);
  }
}

async function runCoachIntelligenceProSuite() {
  console.log('=== INICIANDO SUITE: LAZCAKONG GYM 7.0 — ETAPA 2: COACH INTELLIGENCE PRO ===');

  const benchLib =
    resolveLibraryExercise({ name: 'Press de banca con barra' }) ||
    EXERCISE_LIBRARY[0];
  const squatLib =
    resolveLibraryExercise({ name: 'Sentadilla con barra' }) ||
    EXERCISE_LIBRARY[1];
  const dumbbellBenchLib =
    findRecommendedAlternative({
      name: benchLib.name,
      targetMuscles: benchLib.muscleGroup,
      libraryExerciseId: benchLib.id,
      equipment: benchLib.equipment,
    }).recommended?.exercise || EXERCISE_LIBRARY[2];

  const benchExercise = {
    ...libraryItemToExercise(benchLib),
    id: 'ex-bench-1',
    defaultWeight: 80,
    repRange: '8-10',
    restSeconds: 120,
  };
  const squatExercise = {
    ...libraryItemToExercise(squatLib),
    id: 'ex-squat-2',
    defaultWeight: 100,
    repRange: '6-8',
    restSeconds: 150,
  };

  const sampleRoutine: Routine = {
    id: 'routine-strength-70',
    dayName: 'Día 1',
    title: 'Fuerza Superior e Inferior',
    tagline: 'Fuerza y control',
    modality: 'strength',
    exercises: [benchExercise, squatExercise],
  };

  const recentWorkoutEndMs = Date.now() - 26 * 3600 * 1000;
  const recentWorkoutDate = new Date(recentWorkoutEndMs).toISOString();
  const sampleHistory: CompletedWorkout[] = [
    {
      id: 'w-prev-1',
      profileId: 'camilo',
      routineId: sampleRoutine.id,
      routineTitle: sampleRoutine.title,
      date: recentWorkoutDate,
      startTime: recentWorkoutEndMs - 3100 * 1000,
      endTime: recentWorkoutEndMs,
      isFinished: true,
      durationSeconds: 3100,
      totalVolumeKg: 5400,
      completedSetsCount: 8,
      avgRpe: 8,
      exercisesSummary: [
        {
          exerciseId: 'ex-bench-1',
          libraryExerciseId: benchLib.id,
          name: benchExercise.name,
          sets: 4,
          maxWeight: 80,
          maxReps: 9,
          totalReps: 34,
          volumeKg: 2720,
          muscleGroup: 'Pecho',
          rpe: 8,
          setsDetail: [
            { setNumber: 1, weight: 80, reps: 9, rpe: 8, rir: 2 },
            { setNumber: 2, weight: 80, reps: 9, rpe: 8, rir: 2 },
            { setNumber: 3, weight: 80, reps: 8, rpe: 8.5, rir: 1.5 },
            { setNumber: 4, weight: 80, reps: 8, rpe: 8.5, rir: 1.5 },
          ],
        },
        {
          exerciseId: 'ex-squat-2',
          libraryExerciseId: squatLib.id,
          name: squatExercise.name,
          sets: 4,
          maxWeight: 100,
          maxReps: 7,
          totalReps: 26,
          volumeKg: 2680,
          muscleGroup: 'Cuádriceps',
          rpe: 8,
          setsDetail: [
            { setNumber: 1, weight: 100, reps: 7, rpe: 8, rir: 2 },
            { setNumber: 2, weight: 100, reps: 7, rpe: 8, rir: 2 },
          ],
        },
      ],
    },
  ];

  const samplePRsMap: Record<string, PersonalRecord> = {
    'ex-bench-1': {
      exerciseId: 'ex-bench-1',
      exerciseName: benchExercise.name,
      maxWeight: 82.5,
      repsAtMaxWeight: 8,
      estimated1RM: 104.5,
      date: recentWorkoutDate,
    },
  };

  // 1. Inteligencia Antes del Entrenamiento
  const preBriefing = buildPreWorkoutCoachBriefing({
    routine: sampleRoutine,
    routines: [sampleRoutine],
    history: sampleHistory,
    activeProfile: {
      id: 'camilo',
      name: 'Camilo',
      avatar: '🦍',
      goal: 'Fuerza e Hipertrofia',
      weeklyTargetDays: 4,
      soundEnabled: true,
      vibrationEnabled: true,
      weightUnit: 'kg',
      weightKg: 82,
      createdAt: recentWorkoutDate,
    },
  });

  assert(preBriefing.routineId === sampleRoutine.id, 'Briefing pre-entreno debe referenciar la rutina activa');
  assert(
    typeof preBriefing.readinessScorePct === 'number' &&
      preBriefing.readinessScorePct >= 0 &&
      preBriefing.readinessScorePct <= 100,
    'Briefing pre-entreno debe calcular readinessScorePct entre 0 y 100'
  );
  assert(
    preBriefing.priorityMuscles.length > 0,
    'Briefing pre-entreno debe identificar músculos prioritarios de la rutina'
  );
  assert(
    preBriefing.initialLoadRecommendations.length === 2,
    'Briefing pre-entreno debe generar recomendaciones de carga inicial para cada ejercicio'
  );
  assert(
    (preBriefing.initialLoadRecommendations[0].suggestedWeightKg ?? 0) > 0 &&
      preBriefing.initialLoadRecommendations[0].techniqueFocus.length > 10,
    'Cada recomendación inicial debe incluir peso sugerido y foco técnico Technique Pro'
  );
  console.log('✓ [1/7] Inteligencia antes del entrenamiento (cargas iniciales, músculos prioritarios y ajuste de intensidad) verificada.');

  // 2. Inteligencia Durante el Entrenamiento y Detección de Señales de Rendimiento
  const baseExState: WorkoutExerciseState = {
    exerciseId: 'ex-bench-1',
    originalExerciseId: 'ex-bench-1',
    libraryExerciseId: benchLib.id,
    exerciseName: benchExercise.name,
    originalExerciseName: benchExercise.name,
    activeExerciseName: benchExercise.name,
    targetMuscles: benchExercise.targetMuscles,
    repRange: '8-10',
    useAlternative: false,
    restSeconds: 120,
    techniquePro: benchExercise.techniquePro,
    sets: [
      { id: 's1', setNumber: 1, weight: 80, reps: 10, rpe: 7.5, rir: 2.5, completed: true },
      { id: 's2', setNumber: 2, weight: 80, reps: 8, completed: false },
      { id: 's3', setNumber: 3, weight: 80, reps: 8, completed: false },
    ],
  };

  // 2a. Oportunidad de progresión (tope de rango 10 reps con RPE 7.5 <= 8)
  const evalProgression = evaluateCompletedSetWithCoach({
    exerciseState: baseExState,
    completedSetIndex: 0,
    history: sampleHistory,
    prs: samplePRsMap,
    routineModality: 'strength',
    currentRestSeconds: 120,
  });

  assert(
    evalProgression.signals.includes('progression_opportunity'),
    'Debe detectar progression_opportunity al alcanzar tope de repeticiones con RPE controlado'
  );
  assert(
    evalProgression.loadAction === 'increase' &&
      (evalProgression.suggestedWeightKg ?? 0) > 80,
    'Debe recomendar incremento de carga justificado cuando hay margen de progresión'
  );
  assert(
    baseExState.sets[1].weight === 80,
    'CRÍTICO: evaluateCompletedSetWithCoach NUNCA debe mutar automáticamente las series pendientes'
  );

  // 2b. Récord Personal (85 kg > 82.5 kg PR previo)
  const prExState: WorkoutExerciseState = {
    ...baseExState,
    sets: [
      { id: 's1', setNumber: 1, weight: 85, reps: 8, rpe: 8.5, rir: 1.5, completed: true },
      { id: 's2', setNumber: 2, weight: 80, reps: 8, completed: false },
    ],
  };
  const evalPR = evaluateCompletedSetWithCoach({
    exerciseState: prExState,
    completedSetIndex: 0,
    history: sampleHistory,
    prs: samplePRsMap,
    routineModality: 'strength',
    currentRestSeconds: 120,
  });
  assert(
    evalPR.signals.includes('personal_record'),
    'Debe detectar personal_record al superar la carga/1RM histórica'
  );

  // 2c. Esfuerzo excesivo y fallo muscular (RPE 10 / RIR 0)
  const failureExState: WorkoutExerciseState = {
    ...baseExState,
    sets: [
      { id: 's1', setNumber: 1, weight: 82.5, reps: 8, rpe: 10, rir: 0, completed: true },
      { id: 's2', setNumber: 2, weight: 82.5, reps: 8, completed: false },
    ],
  };
  const evalFailure = evaluateCompletedSetWithCoach({
    exerciseState: failureExState,
    completedSetIndex: 0,
    history: sampleHistory,
    prs: samplePRsMap,
    routineModality: 'strength',
    currentRestSeconds: 120,
  });
  assert(
    evalFailure.signals.includes('excessive_effort') &&
      evalFailure.loadAction === 'decrease' &&
      (evalFailure.suggestedWeightKg ?? 999) < 82.5 &&
      evalFailure.suggestedRestSeconds > 120,
    'En RPE 10 debe detectar excessive_effort, sugerir descarga y ampliar descanso'
  );

  // 2d. Serie cercana al fallo (RPE 9 / RIR 1)
  const nearFailureExState: WorkoutExerciseState = {
    ...baseExState,
    sets: [
      { id: 's1', setNumber: 1, weight: 80, reps: 8, rpe: 9, rir: 1, completed: true },
      { id: 's2', setNumber: 2, weight: 80, reps: 8, completed: false },
    ],
  };
  const evalNearFailure = evaluateCompletedSetWithCoach({
    exerciseState: nearFailureExState,
    completedSetIndex: 0,
    history: sampleHistory,
    prs: samplePRsMap,
    routineModality: 'strength',
    currentRestSeconds: 120,
  });
  assert(
    evalNearFailure.signals.includes('near_failure'),
    'En RPE 9 / RIR 1 debe detectar near_failure'
  );

  // 2e. Caída de rendimiento respecto a la serie previa
  const dropExState: WorkoutExerciseState = {
    ...baseExState,
    sets: [
      { id: 's1', setNumber: 1, weight: 80, reps: 10, rpe: 8, rir: 2, completed: true },
      { id: 's2', setNumber: 2, weight: 80, reps: 6, rpe: 9, rir: 1, completed: true },
      { id: 's3', setNumber: 3, weight: 80, reps: 8, completed: false },
    ],
  };
  const evalDrop = evaluateCompletedSetWithCoach({
    exerciseState: dropExState,
    completedSetIndex: 1,
    history: sampleHistory,
    prs: samplePRsMap,
    routineModality: 'strength',
    currentRestSeconds: 120,
  });
  assert(
    evalDrop.signals.includes('performance_drop'),
    'Debe detectar performance_drop cuando caen las repeticiones respecto a la serie anterior'
  );

  // 2f. Datos insuficientes cuando no se registra RPE/RIR ni existe historial
  const noRpeExState: WorkoutExerciseState = {
    ...baseExState,
    sets: [
      { id: 's1', setNumber: 1, weight: 80, reps: 8, completed: true },
      { id: 's2', setNumber: 2, weight: 80, reps: 8, completed: false },
    ],
  };
  const evalNoRpe = evaluateCompletedSetWithCoach({
    exerciseState: noRpeExState,
    completedSetIndex: 0,
    history: [],
    prs: {},
    routineModality: 'strength',
    currentRestSeconds: 120,
  });
  assert(
    evalNoRpe.signals.includes('insufficient_data') &&
      evalNoRpe.headline.toLowerCase().includes('información suficiente'),
    'Cuando faltan RPE/RIR e historial debe indicar explícitamente insufficient_data sin inventar cambios'
  );
  console.log('✓ [2/7] Detección de rendimiento en vivo (PR, progresión, cerca del fallo, esfuerzo excesivo, caída y datos insuficientes) verificada.');

  // 3. Aceptación y Rechazo explícito de ajustes + Prevención de duplicación de series
  const setsBeforeAccept = baseExState.sets.length;
  const acceptedExState = applyAcceptedCoachSetAdjustment({
    exerciseState: baseExState,
    evaluation: evalProgression,
    applyToAllPending: false,
  });
  assert(
    acceptedExState.sets.length === setsBeforeAccept,
    'Aceptar un ajuste nunca debe duplicar ni eliminar series'
  );
  assert(
    acceptedExState.sets[0].weight === 80 && acceptedExState.sets[0].completed === true,
    'Aceptar un ajuste nunca debe alterar series ya completadas'
  );
  assert(
    acceptedExState.sets[1].weight === evalProgression.suggestedWeightKg &&
      acceptedExState.sets[1].reps === evalProgression.suggestedReps,
    'Aceptar un ajuste debe actualizar la siguiente serie efectiva pendiente'
  );
  assert(
    acceptedExState.sets[2].weight === 80,
    'Con applyToAllPending=false solo debe ajustar la siguiente serie pendiente'
  );
  assert(
    baseExState.sets[1].weight === 80,
    'Si el atleta rechaza el ajuste, el estado original permanece intacto'
  );
  console.log('✓ [3/7] Aceptación/rechazo explícito de ajustes y prevención de duplicación de series verificados.');

  // 4. Sustitución de ejercicio por máquina ocupada + Integración con Technique Pro
  const swappedTechnique = buildTechniqueProProfile({
    id: baseExState.exerciseId,
    libraryExerciseId: dumbbellBenchLib.id,
    name: dumbbellBenchLib.name,
    targetMuscles: dumbbellBenchLib.muscleGroup,
    equipment: dumbbellBenchLib.equipment,
  });
  const swappedExState: WorkoutExerciseState = {
    ...baseExState,
    libraryExerciseId: dumbbellBenchLib.id,
    activeExerciseName: dumbbellBenchLib.name,
    targetMuscles: dumbbellBenchLib.muscleGroup,
    equipment: dumbbellBenchLib.equipment,
    techniquePro: swappedTechnique,
    sets: [
      { id: 's1', setNumber: 1, weight: 32.5, reps: 10, rpe: 8, rir: 2, completed: true },
      { id: 's2', setNumber: 2, weight: 32.5, reps: 10, completed: false },
    ],
  };

  const swappedEval = evaluateCompletedSetWithCoach({
    exerciseState: swappedExState,
    completedSetIndex: 0,
    history: sampleHistory,
    prs: samplePRsMap,
    routineModality: 'hypertrophy',
    currentRestSeconds: 90,
  });

  assert(
    swappedEval.exerciseId === 'ex-bench-1' &&
      swappedEval.exerciseName === dumbbellBenchLib.name,
    'Tras sustituir por máquina ocupada, el Coach debe evaluar el nuevo ejercicio conservando el exerciseId'
  );
  assert(
    swappedEval.techniqueCue.includes(dumbbellBenchLib.name) &&
      swappedEval.techniqueCue.length > 15,
    'La evaluación del ejercicio sustituido debe vincularse al nuevo perfil Technique Pro'
  );
  assert(
    !swappedEval.rationale.toLowerCase().includes('detectamos mala postura') &&
      !swappedEval.techniqueCue.toLowerCase().includes('cámara detectó'),
    'Nunca debe afirmar que se detectó visualmente una mala postura sin análisis visual real'
  );
  console.log('✓ [4/7] Sustitución por máquina ocupada e integración sincrónica con Technique Pro verificadas.');

  // 5. Motor de Voz del Coach (Modos configurables, deduplicación y no interferencia con temporizador)
  const memoryStore = new Map<string, string>();
  const mockStorageAdapter: CoachPlatformStorageAdapter = {
    getItem: (k) => memoryStore.get(k) ?? null,
    setItem: (k, v) => memoryStore.set(k, v),
  };

  assert(
    loadCoachVoiceMode(mockStorageAdapter) === 'important_only',
    'Modo de voz por defecto debe ser important_only'
  );
  saveCoachVoiceMode('full_coach', mockStorageAdapter);
  assert(
    loadCoachVoiceMode(mockStorageAdapter) === 'full_coach',
    'Debe persistir y recuperar el modo de voz configurado'
  );
  assert(
    getCoachVoiceModeLabel('silent') === 'Silencioso' &&
      getCoachVoiceModeLabel('important_only') === 'Solo importantes' &&
      getCoachVoiceModeLabel('full_coach') === 'Coach completo',
    'Etiquetas de modos de voz deben coincidir con la interfaz'
  );

  const spokenSet = new Set<string>();
  const spokenTexts: string[] = [];
  const mockVoiceAdapter: CoachPlatformVoiceAdapter = {
    isAvailable: () => true,
    speak: (text) => {
      spokenTexts.push(text);
      return true;
    },
    stop: () => {},
  };

  // Modo silencioso bloquea todo
  assert(
    speakProactiveCoachMessage({
      rawText: 'Mensaje de prueba',
      mode: 'silent',
      isImportant: true,
      eventKey: 'ev-1',
      spokenEventKeys: spokenSet,
      voiceAdapter: mockVoiceAdapter,
    }).spoken === false,
    'Modo silent no debe emitir voz'
  );

  // Modo important_only bloquea mensajes no importantes y permite importantes
  assert(
    speakProactiveCoachMessage({
      rawText: 'Mensaje rutinario',
      mode: 'important_only',
      isImportant: false,
      eventKey: 'ev-2',
      spokenEventKeys: spokenSet,
      voiceAdapter: mockVoiceAdapter,
    }).spoken === false,
    'Modo important_only debe omitir recomendaciones no críticas'
  );

  assert(
    speakProactiveCoachMessage({
      rawText: 'Récord personal alcanzado',
      mode: 'important_only',
      isImportant: true,
      eventKey: 'ev-3',
      spokenEventKeys: spokenSet,
      voiceAdapter: mockVoiceAdapter,
    }).spoken === true,
    'Modo important_only debe emitir recomendaciones importantes'
  );

  // Deduplicación del mismo eventKey
  assert(
    speakProactiveCoachMessage({
      rawText: 'Récord personal alcanzado',
      mode: 'full_coach',
      isImportant: true,
      eventKey: 'ev-3',
      spokenEventKeys: spokenSet,
      voiceAdapter: mockVoiceAdapter,
    }).spoken === false,
    'Debe evitar mensajes repetitivos con el mismo eventKey'
  );

  // Prevención de conflicto con alarma de descanso (últimos 6s o alarma recién disparada)
  assert(
    shouldSpeakCoachEvent({
      mode: 'full_coach',
      isImportant: true,
      eventKey: 'ev-timer-conflict-1',
      messageText: 'Aviso durante cuenta regresiva',
      spokenEventKeys: spokenSet,
      restTimerActive: true,
      restTimerRemainingSeconds: 4,
    }).allowed === false,
    'No debe hablar durante la cuenta regresiva final (<= 6s) del temporizador de descanso'
  );

  assert(
    shouldSpeakCoachEvent({
      mode: 'full_coach',
      isImportant: true,
      eventKey: 'ev-timer-conflict-2',
      messageText: 'Aviso durante alarma',
      spokenEventKeys: spokenSet,
      restAlertRecentlyTriggeredAt: Date.now() - 1500,
    }).allowed === false,
    'No debe superponerse con la alarma del temporizador recién disparada'
  );
  console.log('✓ [5/7] Modos de voz del Coach, deduplicación y prevención de conflictos con el temporizador verificados.');

  // 6. Funcionamiento sin conexión y persistencia de la sesión activa
  const rawActiveSession: ActiveWorkoutSession = {
    sessionId: 'sess-coach-70',
    routineId: sampleRoutine.id,
    routineTitle: sampleRoutine.title,
    startTime: Date.now() - 600000,
    updatedAt: Date.now() - 5000,
    exercises: [acceptedExState],
  };

  const stabilized = ensureSessionStableIds(rawActiveSession);
  assert(
    stabilized.exercises[0].sets.length === 3 &&
      stabilized.exercises[0].sets[1].weight === evalProgression.suggestedWeightKg,
    'La persistencia de sesión activa debe conservar los ajustes aceptados del Coach sin duplicar series'
  );

  const staleCloudSession: ActiveWorkoutSession = {
    ...stabilized,
    updatedAt: Date.now() - 60000,
    exercises: [baseExState],
  };
  const reconciled = reconcileActiveSessionWithCloud({
    localSession: stabilized,
    cloudSession: staleCloudSession,
    hasPendingOfflineSync: true,
    history: sampleHistory,
  });
  assert(
    reconciled.resolvedSession?.exercises[0].sets[1].weight === evalProgression.suggestedWeightKg &&
      reconciled.source === 'local_kept',
    'La reconciliación offline/cloud debe priorizar el progreso local más reciente del atleta'
  );
  console.log('✓ [6/7] Funcionamiento determinista sin conexión y persistencia de sesión verificados.');

  // 7. Resumen Postentrenamiento Coach Intelligence Pro
  const todayEndMs = Date.now();
  const completedSessionWorkout: CompletedWorkout = {
    id: 'w-today-70',
    profileId: 'camilo',
    routineId: sampleRoutine.id,
    routineTitle: sampleRoutine.title,
    date: new Date(todayEndMs).toISOString(),
    startTime: todayEndMs - 3200 * 1000,
    endTime: todayEndMs,
    isFinished: true,
    durationSeconds: 3200,
    totalVolumeKg: 5840,
    completedSetsCount: 8,
    avgRpe: 8,
    previousSessionComparison: {
      prevDate: recentWorkoutDate,
      prevVolumeKg: 5400,
      prevSets: 8,
      volumeDiffKg: 440,
    },
    exercisesSummary: [
      {
        exerciseId: 'ex-bench-1',
        libraryExerciseId: benchLib.id,
        name: benchExercise.name,
        sets: 4,
        maxWeight: 85,
        maxReps: 8,
        totalReps: 32,
        volumeKg: 2800,
        muscleGroup: 'Pecho',
        rpe: 8,
      },
      {
        exerciseId: 'ex-squat-2',
        libraryExerciseId: squatLib.id,
        name: squatExercise.name,
        sets: 4,
        maxWeight: 102.5,
        maxReps: 7,
        totalReps: 28,
        volumeKg: 3040,
        muscleGroup: 'Cuádriceps',
        rpe: 8,
      },
    ],
  };

  const postReport = buildPostWorkoutCoachReport({
    workout: completedSessionWorkout,
    history: [completedSessionWorkout, ...sampleHistory],
    newPRs: [
      {
        exerciseId: 'ex-bench-1',
        exerciseName: benchExercise.name,
        maxWeight: 85,
        repsAtMaxWeight: 8,
        estimated1RM: 107.7,
        date: completedSessionWorkout.date,
      },
    ],
    routines: [sampleRoutine],
  });

  assert(
    postReport.totalVolumeKg === 5840 && postReport.prCount === 1,
    'Informe postentrenamiento debe reflejar volumen total y récords personales'
  );
  assert(
    postReport.previousComparison.summaryText.includes('440'),
    'Informe postentrenamiento debe incluir comparativa con la sesión previa'
  );
  assert(
    postReport.nextSessionRecommendations.length === 2,
    'Informe postentrenamiento debe generar recomendaciones para la próxima sesión por ejercicio'
  );
  assert(
    postReport.estimatedMuscleRecovery.length > 0,
    'Informe postentrenamiento debe calcular la recuperación muscular estimada'
  );
  console.log('✓ [7/7] Informe Postentrenamiento Coach Intelligence Pro verificado.');

  console.log('=== TODAS LAS PRUEBAS DE COACH INTELLIGENCE PRO 7.0 PASARON EXITOSAMENTE ===');
}

runCoachIntelligenceProSuite().catch((err) => {
  console.error(err);
  process.exit(1);
});
