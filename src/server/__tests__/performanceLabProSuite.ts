import {
  computeElitePerformanceAnalytics,
  computeVolumeHorizons,
  computeMultiWeekComparatives4_8_12,
  evaluateIntelligentProgressiveOverload,
  applyAuthorizedOverloadToRoutine,
  detectExerciseStagnation,
  createPeriodizationMesocyclePlan,
  togglePeriodizationDeloadWeek,
  savePeriodizationMesocyclePlan,
  loadPeriodizationMesocyclePlan,
  applyAuthorizedPeriodizationWeekToRoutine,
  computeMuscleBalanceReport,
  generateSmartWeeklyPerformanceReport,
  NON_MEDICAL_BALANCE_DISCLAIMER,
} from '../../utils/elitePerformanceAnalytics';
import { speakProactiveCoachMessage } from '../../utils/coachVoiceEngine';
import {
  CoachPlatformStorageAdapter,
  CompletedWorkout,
  PeriodizationGoalType,
  Routine,
} from '../../types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function createMemoryStorage(): CoachPlatformStorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

export function runPerformanceLabProSuite(): {
  passed: number;
  total: number;
  results: string[];
} {
  const results: string[] = [];
  let passed = 0;
  let total = 0;

  const runTest = (name: string, fn: () => void) => {
    total += 1;
    fn();
    passed += 1;
    results.push(`PASS: ${name}`);
  };

  const NOW = new Date('2026-05-20T18:00:00.000Z').getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const baseRoutine: Routine = {
    id: 'routine-push-a',
    title: 'Empuje Fuerza & Hipertrofia',
    dayName: 'Lunes',
    tagline: 'Fuerza de empuje',
    exercises: [
      {
        id: 'ex-bench-1',
        libraryExerciseId: 'chest_barbell_bench_press',
        name: 'Press de Banca con Barra',
        targetMuscles: 'Pecho',
        equipment: 'Barra',
        defaultSets: 3,
        repRange: '8 reps',
        defaultWeight: 100,
        prevWeight: 97.5,
        defaultReps: 8,
        restSeconds: 120,
        restText: '120s',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
      {
        id: 'ex-ohp-2',
        libraryExerciseId: 'shoulders_overhead_press',
        name: 'Press Militar con Barra',
        targetMuscles: 'Hombros',
        equipment: 'Barra',
        defaultSets: 3,
        repRange: '8 reps',
        defaultWeight: 60,
        prevWeight: 57.5,
        defaultReps: 8,
        restSeconds: 75,
        restText: '75s',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
    ],
  };

  // 1. SOBRECARGA PROGRESIVA INTELIGENTE & AUTORIZACIÓN EXPLÍCITA
  runTest(
    '1. Sobrecarga Progresiva Inteligente: recomienda subir carga con RPE controlado y músculo recuperado, y exige autorización explícita',
    () => {
      const history: CompletedWorkout[] = [
        {
          id: 'w-bench-1',
          profileId: 'athlete-camilo',
          routineId: 'routine-push-a',
          routineTitle: 'Empuje Fuerza & Hipertrofia',
          date: '2026-05-12',
          startTime: NOW - 8 * DAY_MS,
          endTime: NOW - 8 * DAY_MS + 3600_000,
          durationSeconds: 3600,
          totalVolumeKg: 2400,
          completedSetsCount: 3,
          totalRepsCount: 24,
          isFinished: true,
          exercisesSummary: [
            {
              exerciseId: 'ex-bench-1',
              name: 'Press de Banca con Barra',
              muscleGroup: 'Pecho',
              equipment: 'Barra',
              sets: 3,
              maxWeight: 100,
              maxReps: 8,
              volumeKg: 2400,
              setsDetail: [
                { setNumber: 1, weight: 100, reps: 8, rpe: 7.5 },
                { setNumber: 2, weight: 100, reps: 8, rpe: 7.5 },
                { setNumber: 3, weight: 100, reps: 8, rpe: 8.0 },
              ],
            },
          ],
        },
        {
          id: 'w-bench-2',
          profileId: 'athlete-camilo',
          routineId: 'routine-push-a',
          routineTitle: 'Empuje Fuerza & Hipertrofia',
          date: '2026-05-16',
          startTime: NOW - 4 * DAY_MS,
          endTime: NOW - 4 * DAY_MS + 3600_000,
          durationSeconds: 3600,
          totalVolumeKg: 2400,
          completedSetsCount: 3,
          totalRepsCount: 24,
          isFinished: true,
          exercisesSummary: [
            {
              exerciseId: 'ex-bench-1',
              name: 'Press de Banca con Barra',
              muscleGroup: 'Pecho',
              equipment: 'Barra',
              sets: 3,
              maxWeight: 100,
              maxReps: 8,
              volumeKg: 2400,
              setsDetail: [
                { setNumber: 1, weight: 100, reps: 8, rpe: 7.5 },
                { setNumber: 2, weight: 100, reps: 8, rpe: 7.5 },
                { setNumber: 3, weight: 100, reps: 8, rpe: 8.0 },
              ],
            },
          ],
        },
      ];

      const proposals = evaluateIntelligentProgressiveOverload({
        routines: [baseRoutine],
        history,
        currentTime: NOW,
        profileId: 'athlete-camilo',
      });

      assert(proposals.length === 1, 'Debe generar 1 propuesta para el ejercicio con historial');
      const benchProp = proposals[0];
      assert(
        benchProp.overloadType === 'increase_load',
        `Se esperaba increase_load pero se obtuvo ${benchProp.overloadType}`
      );
      assert(
        benchProp.proposedWeightKg > 100,
        'El peso propuesto debe ser superior a 100 kg'
      );
      assert(
        benchProp.requiresExplicitAuthorization === true,
        'Toda propuesta debe requerir autorización explícita del atleta'
      );
      assert(
        baseRoutine.exercises[0].defaultWeight === 100,
        'La rutina original jamás debe mutar automáticamente al evaluar propuestas'
      );

      // Autorizar explícitamente el cambio
      const authorizedRoutine = applyAuthorizedOverloadToRoutine(baseRoutine, benchProp);
      assert(
        authorizedRoutine.exercises[0].defaultWeight === benchProp.proposedWeightKg,
        'Tras autorizar, la copia actualizada de la rutina debe reflejar la nueva carga'
      );
      assert(
        authorizedRoutine.exercises[0].id === 'ex-bench-1',
        'El ID original del ejercicio debe conservarse intacto'
      );
      assert(
        baseRoutine.exercises[0].defaultWeight === 100,
        'El objeto de rutina original debe permanecer inmutable'
      );
    }
  );

  // 2. SOBRECARGA PROGRESIVA FRENADA POR FATIGA RECIENTE (MUSCLE RECOVERY PRO)
  runTest(
    '2. Sobrecarga Progresiva Inteligente: prioriza recuperación si el músculo acaba de entrenarse intensamente',
    () => {
      const recentHeavyWorkout: CompletedWorkout = {
        id: 'w-recent-heavy',
        profileId: 'athlete-camilo',
        routineId: 'routine-push-a',
        routineTitle: 'Empuje Pesado',
        date: '2026-05-20',
        startTime: NOW - 2 * 3600_000, // Hace 2 horas
        endTime: NOW - 1 * 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 4800,
        completedSetsCount: 6,
        totalRepsCount: 48,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-bench-1',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            equipment: 'Barra',
            sets: 6,
            maxWeight: 100,
            maxReps: 8,
            volumeKg: 4800,
            setsDetail: [
              { setNumber: 1, weight: 100, reps: 8, rpe: 9.5 },
              { setNumber: 2, weight: 100, reps: 8, rpe: 9.5 },
              { setNumber: 3, weight: 100, reps: 8, rpe: 10 },
            ],
          },
        ],
      };

      const proposals = evaluateIntelligentProgressiveOverload({
        routines: [baseRoutine],
        history: [recentHeavyWorkout],
        currentTime: NOW,
        profileId: 'athlete-camilo',
      });

      assert(proposals.length === 1, 'Debe evaluar el ejercicio');
      assert(
        proposals[0].overloadType === 'hold_recovery_priority',
        `Con fatiga alta reciente debe priorizar recuperación, obtuvo ${proposals[0].overloadType}`
      );
      assert(
        proposals[0].proposedWeightKg === 100,
        'No debe incrementar carga mientras el músculo está en fatiga aguda'
      );
    }
  );

  // 3. DETECCIÓN DE ESTANCAMIENTO: SESIONES COMPARABLES, CAMBIO DE EQUIPAMIENTO Y DATOS INSUFICIENTES
  runTest(
    '3. Detección de Estancamiento: distingue datos insuficientes, cambio de equipamiento, estancamiento real y retroceso',
    () => {
      // Caso A: Solo 2 sesiones (< 3 requeridas)
      const twoSessionsHistory: CompletedWorkout[] = [1, 2].map((idx) => ({
        id: `w-short-${idx}`,
        profileId: 'athlete-camilo',
        routineId: 'routine-push-a',
        routineTitle: 'Empuje',
        date: `2026-05-0${idx}`,
        startTime: NOW - (15 - idx) * DAY_MS,
        endTime: NOW - (15 - idx) * DAY_MS + 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 1800,
        completedSetsCount: 3,
        totalRepsCount: 24,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-bench-1',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            equipment: 'Barra',
            sets: 3,
            maxWeight: 100,
            maxReps: 8,
            volumeKg: 2400,
          },
        ],
      }));

      const insufficientRes = detectExerciseStagnation({
        routines: [baseRoutine],
        history: twoSessionsHistory,
        profileId: 'athlete-camilo',
      });
      const benchInsuff = insufficientRes.find((r) => r.exerciseId === 'ex-bench-1');
      assert(
        benchInsuff?.status === 'insufficient_comparable_sessions',
        'Con 2 sesiones debe reportar insufficient_comparable_sessions'
      );

      // Caso B: 3 sesiones con la misma carga y repeticiones (estancamiento real) + 1 ejercicio con cambio de equipamiento
      const plateauHistory: CompletedWorkout[] = [1, 2, 3, 4].map((idx) => ({
        id: `w-plat-${idx}`,
        profileId: 'athlete-camilo',
        routineId: 'routine-push-a',
        routineTitle: 'Empuje',
        date: `2026-05-1${idx}`,
        startTime: NOW - (10 - idx) * DAY_MS,
        endTime: NOW - (10 - idx) * DAY_MS + 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 3800,
        completedSetsCount: 6,
        totalRepsCount: 48,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-bench-1',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            equipment: 'Barra',
            sets: 3,
            maxWeight: 100,
            maxReps: 8,
            volumeKg: 2400,
            setsDetail: [
              { setNumber: 1, weight: 100, reps: 8, rpe: 9.0 },
              { setNumber: 2, weight: 100, reps: 8, rpe: 9.0 },
            ],
          },
          {
            exerciseId: 'ex-ohp-2',
            // En las sesiones 1 y 2 usó Barra, en las sesiones 3 y 4 cambió a Mancuernas
            name:
              idx <= 2
                ? 'Press Militar con Barra'
                : 'Press Militar con Mancuernas',
            muscleGroup: 'Hombros',
            equipment: idx <= 2 ? 'Barra' : 'Mancuerna',
            sets: 3,
            maxWeight: idx <= 2 ? 60 : 50,
            maxReps: 8,
            volumeKg: 1400,
          },
        ],
      }));

      const plateauRes = detectExerciseStagnation({
        routines: [baseRoutine],
        history: plateauHistory,
        profileId: 'athlete-camilo',
      });

      const benchPlateau = plateauRes.find((r) => r.exerciseId === 'ex-bench-1');
      assert(
        benchPlateau?.status === 'plateau_detected',
        `Se esperaba plateau_detected en Press de Banca pero se obtuvo ${benchPlateau?.status}`
      );
      assert(
        Boolean(benchPlateau?.techniqueProCue && benchPlateau.techniqueProCue.length > 10),
        'Debe incluir consejo técnico de Technique Pro'
      );

      const ohpVariantChanged = plateauRes.find((r) => r.exerciseId === 'ex-ohp-2');
      assert(
        ohpVariantChanged?.status === 'equipment_or_variant_changed',
        `Al cambiar de Barra a Mancuerna debe detectar equipment_or_variant_changed, obtuvo ${ohpVariantChanged?.status}`
      );
    }
  );

  // 4. PERIODIZACIÓN DEPORTIVA (4, 8 Y 12 SEMANAS + 5 OBJETIVOS + PROGRESIÓN Y DESCARGA)
  runTest(
    '4. Periodización Deportiva: crea ciclos de 4, 8 y 12 semanas para los 5 objetivos, configura descarga y persiste offline por atleta',
    () => {
      const storage = createMemoryStorage();
      const goals: PeriodizationGoalType[] = [
        'fuerza',
        'hipertrofia',
        'resistencia_muscular',
        'rendimiento_deportivo',
        'combinado',
      ];
      const durations: (4 | 8 | 12)[] = [4, 8, 12];

      for (const goal of goals) {
        for (const dur of durations) {
          const plan = createPeriodizationMesocyclePlan({
            profileId: 'athlete-camilo',
            goal,
            durationWeeks: dur,
            now: NOW,
          });
          assert(plan.weeks.length === dur, `El plan de ${dur} semanas debe tener ${dur} semanas`);
          assert(
            plan.preservesOriginalRoutines === true,
            'El plan debe garantizar preservación de rutinas originales'
          );
          const deloadCount = plan.weeks.filter((w) => w.isDeloadWeek).length;
          assert(deloadCount >= 1, 'Cada ciclo debe incluir al menos 1 semana de descarga por defecto');
        }
      }

      // Alternar semana 2 a descarga y persistir
      let plan8w = createPeriodizationMesocyclePlan({
        profileId: 'athlete-camilo',
        goal: 'fuerza',
        durationWeeks: 8,
        now: NOW,
      });
      assert(!plan8w.weeks[1].isDeloadWeek, 'La semana 2 inicia como semana de progresión');
      plan8w = togglePeriodizationDeloadWeek(plan8w, 2, NOW + 1000);
      assert(plan8w.weeks[1].isDeloadWeek, 'Tras toggle, la semana 2 debe ser semana de descarga');

      savePeriodizationMesocyclePlan(plan8w, storage);
      const loadedCamilo = loadPeriodizationMesocyclePlan('athlete-camilo', storage);
      const loadedOther = loadPeriodizationMesocyclePlan('athlete-other', storage);

      assert(loadedCamilo !== null && loadedCamilo.weeks[1].isDeloadWeek, 'Debe cargar el plan persistido del atleta');
      assert(loadedOther === null, 'El plan no debe filtrarse a otro perfil de atleta');

      // Aplicar semana de descarga bajo autorización explícita sin alterar IDs ni rutina original
      const deloadWeek = plan8w.weeks[1];
      const adjustedRoutine = applyAuthorizedPeriodizationWeekToRoutine(baseRoutine, deloadWeek);
      assert(
        adjustedRoutine.exercises[0].id === 'ex-bench-1',
        'Debe conservar el ID del ejercicio al aplicar semana de periodización'
      );
      assert(
        (adjustedRoutine.exercises[0].defaultWeight || 0) < 100,
        'En semana de descarga autorizada debe reducir la carga objetivo (~88%)'
      );
      assert(
        baseRoutine.exercises[0].defaultWeight === 100,
        'La rutina original jamás debe mutar en memoria'
      );
    }
  );

  // 5. BALANCE MUSCULAR INTEGRADO CON MUSCLE RECOVERY PRO & REGLA NO MÉDICA
  runTest(
    '5. Balance Muscular: calcula series primarias y secundarias ponderadas, ratio Empuje/Tracción e incluye descargo no médico',
    () => {
      const history: CompletedWorkout[] = [
        {
          id: 'w-push-balance',
          profileId: 'athlete-camilo',
          routineId: 'routine-push-a',
          routineTitle: 'Empuje Intenso',
          date: '2026-05-18',
          startTime: NOW - 2 * DAY_MS,
          endTime: NOW - 2 * DAY_MS + 3600_000,
          durationSeconds: 3600,
          totalVolumeKg: 4200,
          completedSetsCount: 8,
          totalRepsCount: 64,
          isFinished: true,
          exercisesSummary: [
            {
              exerciseId: 'ex-bench-1',
              name: 'Press de Banca con Barra',
              muscleGroup: 'Pecho',
              sets: 4,
              maxWeight: 100,
              maxReps: 8,
              volumeKg: 3200,
            },
            {
              exerciseId: 'ex-ohp-2',
              name: 'Press Militar con Barra',
              muscleGroup: 'Hombros',
              sets: 4,
              maxWeight: 50,
              maxReps: 8,
              volumeKg: 1000,
            },
          ],
        },
        {
          id: 'w-pull-balance',
          profileId: 'athlete-camilo',
          routineId: 'routine-pull-a',
          routineTitle: 'Tracción',
          date: '2026-05-19',
          startTime: NOW - 1 * DAY_MS,
          endTime: NOW - 1 * DAY_MS + 3600_000,
          durationSeconds: 3600,
          totalVolumeKg: 2400,
          completedSetsCount: 4,
          totalRepsCount: 32,
          isFinished: true,
          exercisesSummary: [
            {
              exerciseId: 'ex-row-1',
              name: 'Remo con Barra',
              muscleGroup: 'Espalda',
              sets: 4,
              maxWeight: 80,
              maxReps: 8,
              volumeKg: 2400,
            },
          ],
        },
      ];

      const balance = computeMuscleBalanceReport({
        history,
        periodDays: 28,
        currentTime: NOW,
        profileId: 'athlete-camilo',
      });

      const pectoral = balance.muscleGroups.find((m) => m.muscleGroup === 'Pectoral');
      const triceps = balance.muscleGroups.find((m) => m.muscleGroup === 'Tríceps');
      const dorsal = balance.muscleGroups.find((m) => m.muscleGroup === 'Dorsal');
      const biceps = balance.muscleGroups.find((m) => m.muscleGroup === 'Bíceps');

      assert(pectoral && pectoral.primaryEffectiveSets === 4, 'Pectoral debe registrar 4 series primarias');
      assert(
        triceps && triceps.secondaryWeightedSets > 0,
        'Tríceps debe recibir series secundarias ponderadas como sinergista de Press de Banca y Press Militar'
      );
      assert(dorsal && dorsal.primaryEffectiveSets === 4, 'Dorsal debe registrar 4 series primarias');
      assert(
        biceps && biceps.secondaryWeightedSets > 0,
        'Bíceps debe recibir series secundarias ponderadas como sinergista del Remo con Barra'
      );
      assert(
        balance.pushSets > balance.pullSets && balance.pushPullRatio !== null && balance.pushPullRatio > 1,
        'Con 2 ejercicios de empuje y 1 de tracción, pushSets debe superar a pullSets'
      );
      assert(
        balance.nonMedicalDisclaimer === NON_MEDICAL_BALANCE_DISCLAIMER &&
          balance.nonMedicalDisclaimer.includes('No constituye diagnóstico'),
        'El reporte de balance muscular debe incluir el descargo no médico explícito'
      );
    }
  );

  // 6. INFORME SEMANAL INTELIGENTE, COMPARATIVAS 4/8/12 SEMANAS, AISLAMIENTO Y NO DOBLE CONTEO
  runTest(
    '6. Informe Semanal Inteligente, Comparativas 4/8/12 semanas, motor de voz es-CL, aislamiento por atleta y prevención de doble conteo',
    () => {
      const wPrevWeek: CompletedWorkout = {
        id: 'w-prev-1',
        profileId: 'athlete-camilo',
        routineId: 'routine-push-a',
        routineTitle: 'Empuje Sem. Previa',
        date: '2026-05-10',
        startTime: NOW - 10 * DAY_MS,
        endTime: NOW - 10 * DAY_MS + 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 2400,
        completedSetsCount: 3,
        totalRepsCount: 24,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-bench-1',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            sets: 3,
            maxWeight: 100,
            maxReps: 8,
            volumeKg: 2400,
          },
        ],
      };

      const wCurrWeek: CompletedWorkout = {
        id: 'w-curr-1',
        profileId: 'athlete-camilo',
        routineId: 'routine-push-a',
        routineTitle: 'Empuje Sem. Actual',
        date: '2026-05-18',
        startTime: NOW - 2 * DAY_MS,
        endTime: NOW - 2 * DAY_MS + 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 2520,
        completedSetsCount: 3,
        totalRepsCount: 24,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-bench-1',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            sets: 3,
            maxWeight: 105, // Nuevo PR superado (+5 kg sobre los 100 kg previos)
            maxReps: 8,
            volumeKg: 2520,
          },
        ],
      };

      // Clon duplicado del mismo entrenamiento + entrenamiento de OTRO atleta
      const wCurrWeekDuplicateClone: CompletedWorkout = {
        ...wCurrWeek,
      };
      const wOtherAthlete: CompletedWorkout = {
        ...wCurrWeek,
        id: 'w-other-athlete-99',
        profileId: 'athlete-sofia',
        totalVolumeKg: 9900,
        completedSetsCount: 12,
      };

      const mixedHistory = [
        wPrevWeek,
        wCurrWeek,
        wCurrWeekDuplicateClone,
        wOtherAthlete,
      ];

      const horizons = computeVolumeHorizons(mixedHistory, new Date(NOW), 'athlete-camilo');
      assert(
        horizons.weeklyVolumeKg === 2520 && horizons.weeklyWorkoutsCount === 1,
        `El volumen semanal de Camilo debe ser exactamente 2520 kg (sin doble conteo ni datos de Sofía), obtuvo ${horizons.weeklyVolumeKg}`
      );
      assert(
        horizons.monthlyVolumeKg === 4920 && horizons.monthlyWorkoutsCount === 2,
        `El volumen mensual debe sumar 4920 kg en 2 sesiones únicas, obtuvo ${horizons.monthlyVolumeKg}`
      );

      const comparatives = computeMultiWeekComparatives4_8_12({
        history: mixedHistory,
        weeklyTargetDays: 4,
        referenceNow: new Date(NOW),
        profileId: 'athlete-camilo',
      });
      assert(
        comparatives.w4.currentWorkouts === 2 &&
          comparatives.w4.verifiedPRsCount === 1 &&
          comparatives.w4.topImprovedExercises.length === 1,
        'La comparativa de 4 semanas debe detectar 2 sesiones, 1 PR superado y evolución de 1RM en Press de Banca'
      );
      assert(
        comparatives.w8.weeksCount === 8 && comparatives.w12.weeksCount === 12,
        'Debe generar los bloques comparativos de 8 y 12 semanas'
      );

      const weeklyReport = generateSmartWeeklyPerformanceReport({
        history: mixedHistory,
        routines: [baseRoutine],
        activeProfile: { id: 'athlete-camilo', name: 'Camilo', weeklyTargetDays: 4 },
        currentTime: NOW,
      });

      assert(
        weeklyReport.completedWorkoutsCount === 1 &&
          weeklyReport.accumulatedVolumeKg === 2520 &&
          weeklyReport.prsAchievedCount === 1,
        'El informe semanal debe reflejar 1 sesión, 2520 kg y 1 PR superado'
      );
      assert(
        weeklyReport.volumeDeltaPct === 5,
        `La evolución de volumen vs semana previa (2520 vs 2400) debe ser +5%, obtuvo ${weeklyReport.volumeDeltaPct}%`
      );
      assert(
        weeklyReport.coachVoiceText.includes('Camilo') &&
          weeklyReport.coachVoiceText.includes('2520'),
        'El texto de voz del Coach debe incluir el resumen del atleta'
      );

      // Verificar integración con motor de voz en modo silent vs important_only
      const spokenSet = new Set<string>();
      const mockVoiceAdapter = {
        isAvailable: () => true,
        speak: () => true,
        stop: () => {},
      };
      const silentRes = speakProactiveCoachMessage({
        mode: 'silent',
        isImportant: true,
        eventKey: 'weekly_rep_1',
        rawText: weeklyReport.coachVoiceText,
        spokenEventKeys: spokenSet,
        voiceAdapter: mockVoiceAdapter,
      });
      assert(!silentRes.spoken && silentRes.reason === 'silent_mode', 'Modo silent no debe emitir voz');

      const importantRes = speakProactiveCoachMessage({
        mode: 'important_only',
        isImportant: true,
        eventKey: 'weekly_rep_1',
        rawText: weeklyReport.coachVoiceText,
        spokenEventKeys: spokenSet,
        voiceAdapter: mockVoiceAdapter,
      });
      assert(importantRes.spoken === true, 'Modo important_only debe pronunciar el informe semanal');

      // Verificar computeElitePerformanceAnalytics completo
      const fullElite = computeElitePerformanceAnalytics({
        history: mixedHistory,
        routines: [baseRoutine],
        period: '30d',
        weeklyTargetDays: 4,
        profileId: 'athlete-camilo',
        referenceNow: new Date(NOW),
      });
      assert(
        fullElite.kpis.totalWorkouts === 2 &&
          fullElite.volumeHorizons.weeklyVolumeKg === 2520 &&
          fullElite.multiWeekComparatives.w4.verifiedPRsCount === 1,
        'El reporte integral Elite debe incluir volumeHorizons y multiWeekComparatives sin doble conteo'
      );
    }
  );

  return { passed, total, results };
}

if (typeof process !== 'undefined' && process.argv?.[1]?.includes('performanceLabProSuite')) {
  const outcome = runPerformanceLabProSuite();
  console.log(outcome.results.join('\n'));
  console.log(`\nPERFORMANCE LAB PRO SUITE: ${outcome.passed}/${outcome.total} PASSED`);
}
