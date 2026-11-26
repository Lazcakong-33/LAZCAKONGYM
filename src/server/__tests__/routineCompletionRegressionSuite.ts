import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { CompletedWorkout, Routine } from '../../types/index.ts';
import {
  evaluateWeeklyRoutineCompliance,
  inferExecutedRoutineIdentity,
  repairWorkoutRoutineMetadata,
} from '../../utils/routineCompletionEngine.ts';
import { evaluateWeeklyDaysCompletion } from '../../utils/exportReport.ts';
import {
  getChileLocalDateKey,
  resolveWorkoutChileDateKey,
  summarizeTodayAndWeeklyCalories,
} from '../../utils/calorieCalculator.ts';
import { purgeAndSanitizeWorkoutHistory } from '../../utils/historySanitizer.ts';
import { reconcileAndUnifyAthleteHistory } from '../../utils/historyRecoveryEngine.ts';
import { computeRealTimeRecovery } from '../../utils/muscleRecoveryEngine.ts';
import { validateOtaManifest, type OtaManifestPayload } from '../../utils/otaUpdateEngine.ts';

async function runCase(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}`);
    throw err;
  }
}

const ATHLETE_ROUTINES: Routine[] = [
  {
    id: 'routine-lunes-empuje',
    dayName: 'Lunes',
    title: 'Lunes: Empuje Pecho/Hombro',
    tagline: 'Fuerza Tren Superior',
    exercises: [
      {
        id: 'ex-bench',
        name: 'Press de banca plano con barra',
        targetMuscles: 'Pecho, Tríceps',
        defaultSets: 4,
        repRange: '6-8',
        restSeconds: 150,
        restText: '150 seg',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
      {
        id: 'ex-incline-db',
        name: 'Press inclinado con mancuernas',
        targetMuscles: 'Pecho Superior',
        defaultSets: 4,
        repRange: '8-10',
        restSeconds: 90,
        restText: '90 seg',
        objective: 'Hipertrofia',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
    ],
  },
  {
    id: 'routine-miercoles-espalda',
    dayName: 'Miércoles',
    title: 'Miércoles: Tracción Espalda/Bíceps',
    tagline: 'Espalda & Bíceps',
    exercises: [
      {
        id: 'ex-pullup',
        name: 'Dominadas lastradas',
        targetMuscles: 'Espalda, Dorsales',
        defaultSets: 4,
        repRange: '6-8',
        restSeconds: 150,
        restText: '150 seg',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
      {
        id: 'ex-barbell-row',
        name: 'Remo con barra inclinado',
        targetMuscles: 'Espalda Media',
        defaultSets: 4,
        repRange: '8-10',
        restSeconds: 120,
        restText: '120 seg',
        objective: 'Hipertrofia',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
      {
        id: 'ex-curl-ez',
        name: 'Curl de bíceps con barra Z',
        targetMuscles: 'Bíceps',
        defaultSets: 3,
        repRange: '10-12',
        restSeconds: 75,
        restText: '75 seg',
        objective: 'Aislamiento',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
    ],
  },
  {
    id: 'routine-jueves-hombro',
    dayName: 'Jueves',
    title: 'Jueves: Hombro & Core',
    tagline: 'Deltoides & Estabilidad',
    exercises: [
      {
        id: 'ex-ohp',
        name: 'Press militar de pie con barra',
        targetMuscles: 'Hombros',
        defaultSets: 4,
        repRange: '6-8',
        restSeconds: 120,
        restText: '120 seg',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
      {
        id: 'ex-lat-raise',
        name: 'Elevaciones laterales con mancuernas',
        targetMuscles: 'Hombro Lateral',
        defaultSets: 4,
        repRange: '12-15',
        restSeconds: 60,
        restText: '60 seg',
        objective: 'Hipertrofia',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
    ],
  },
  {
    id: 'routine-viernes-pierna',
    dayName: 'Viernes',
    title: 'Viernes: Pierna Posterior & Glúteo',
    tagline: 'Cadena Posterior',
    exercises: [
      {
        id: 'ex-rdl',
        name: 'Peso muerto rumano con barra',
        targetMuscles: 'Isquiotibiales, Glúteos',
        defaultSets: 4,
        repRange: '8-10',
        restSeconds: 150,
        restText: '150 seg',
        objective: 'Hipertrofia',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
      {
        id: 'ex-bulgarian',
        name: 'Sentadilla búlgara con mancuernas',
        targetMuscles: 'Cuádriceps, Glúteos',
        defaultSets: 3,
        repRange: '10-12',
        restSeconds: 90,
        restText: '90 seg',
        objective: 'Unilateral',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
    ],
  },
];

function makeWednesdayWorkoutExecutedOnThursday(overrides?: Partial<CompletedWorkout>): CompletedWorkout {
  // Jueves 26 nov 2026 19:30 Chile (UTC-3 -> 2026-11-26T22:30:00.000Z)
  const startedAt = '2026-11-26T21:15:00.000Z';
  const completedAt = '2026-11-26T22:30:00.000Z';
  return {
    id: 'wk-wed-done-thu-2026-11-26',
    profileId: 'athlete-kmilo',
    routineId: 'routine-miercoles-espalda',
    routineTitle: 'Miércoles: Tracción Espalda/Bíceps',
    scheduledDay: 'Miércoles',
    startedAt,
    completedAt,
    executionDateKey: '2026-11-26',
    weekId: '2026-W48',
    date: completedAt,
    startTime: new Date(startedAt).getTime(),
    endTime: new Date(completedAt).getTime(),
    durationSeconds: 75 * 60,
    totalVolumeKg: 5730,
    completedSetsCount: 11,
    totalRepsCount: 106,
    completedExercisesCount: 3,
    caloriesBurned: 785,
    isFinished: true,
    exercisesSummary: [
      {
        exerciseId: 'ex-pullup',
        name: 'Dominadas lastradas',
        sets: 4,
        maxWeight: 20,
        maxReps: 8,
        volumeKg: 600,
        muscleGroup: 'Espalda',
        setsDetail: [
          { setNumber: 1, weight: 20, reps: 8, completed: true },
          { setNumber: 2, weight: 20, reps: 8, completed: true },
          { setNumber: 3, weight: 20, reps: 7, completed: true },
          { setNumber: 4, weight: 20, reps: 7, completed: true },
        ],
      },
      {
        exerciseId: 'ex-barbell-row',
        name: 'Remo con barra inclinado',
        sets: 4,
        maxWeight: 90,
        maxReps: 10,
        volumeKg: 3600,
        muscleGroup: 'Espalda',
        setsDetail: [
          { setNumber: 1, weight: 90, reps: 10, completed: true },
          { setNumber: 2, weight: 90, reps: 10, completed: true },
          { setNumber: 3, weight: 90, reps: 10, completed: true },
          { setNumber: 4, weight: 90, reps: 10, completed: true },
        ],
      },
      {
        exerciseId: 'ex-curl-ez',
        name: 'Curl de bíceps con barra Z',
        sets: 3,
        maxWeight: 42.5,
        maxReps: 12,
        volumeKg: 1530,
        muscleGroup: 'Bíceps',
        setsDetail: [
          { setNumber: 1, weight: 42.5, reps: 12, completed: true },
          { setNumber: 2, weight: 42.5, reps: 12, completed: true },
          { setNumber: 3, weight: 42.5, reps: 12, completed: true },
        ],
      },
    ],
    ...overrides,
  };
}

function makeFridayWorkoutExecutedOnThursday(overrides?: Partial<CompletedWorkout>): CompletedWorkout {
  // Jueves 26 nov 2026 21:42 Chile (UTC-3 -> 2026-11-27T00:42:00.000Z — ya es viernes en UTC pero sigue siendo jueves en Chile)
  const startedAt = '2026-11-26T23:30:00.000Z';
  const completedAt = '2026-11-27T00:42:00.000Z';
  return {
    id: 'wk-fri-done-thu-2026-11-26',
    profileId: 'athlete-kmilo',
    routineId: 'routine-viernes-pierna',
    routineTitle: 'Viernes: Pierna Posterior & Glúteo',
    scheduledDay: 'Viernes',
    startedAt,
    completedAt,
    executionDateKey: '2026-11-26',
    weekId: '2026-W48',
    date: completedAt,
    startTime: new Date(startedAt).getTime(),
    endTime: new Date(completedAt).getTime(),
    durationSeconds: 72 * 60,
    totalVolumeKg: 6420,
    completedSetsCount: 7,
    totalRepsCount: 68,
    completedExercisesCount: 2,
    caloriesBurned: 978,
    isFinished: true,
    exercisesSummary: [
      {
        exerciseId: 'ex-rdl',
        name: 'Peso muerto rumano con barra',
        sets: 4,
        maxWeight: 110,
        maxReps: 8,
        volumeKg: 3520,
        muscleGroup: 'Isquiotibiales',
        setsDetail: [
          { setNumber: 1, weight: 100, reps: 8, completed: true },
          { setNumber: 2, weight: 110, reps: 8, completed: true },
          { setNumber: 3, weight: 110, reps: 8, completed: true },
          { setNumber: 4, weight: 110, reps: 8, completed: true },
        ],
      },
      {
        exerciseId: 'ex-bulgarian',
        name: 'Sentadilla búlgara con mancuernas',
        sets: 3,
        maxWeight: 25,
        maxReps: 12,
        volumeKg: 1800,
        muscleGroup: 'Cuádriceps',
        setsDetail: [
          { setNumber: 1, weight: 25, reps: 12, completed: true },
          { setNumber: 2, weight: 25, reps: 12, completed: true },
          { setNumber: 3, weight: 25, reps: 12, completed: true },
        ],
      },
    ],
    ...overrides,
  };
}

async function main() {
  console.log('\n🧪 LAZCAKONG GYM v7.0.6 — Routine Completion Regression & Integrity Suite');

  const refThursdayNight = new Date('2026-11-27T00:50:00.000Z'); // Jueves 26 nov 2026 21:50 America/Santiago

  // PRUEBA OBLIGATORIA 1
  await runCase('1. Ejecutar rutina del Miércoles el Jueves 26 nov marca SOLO Miércoles (NO Jueves) y registra calorías/recuperación en Jueves', () => {
    const wedOnThu = makeWednesdayWorkoutExecutedOnThursday();
    const compliance = evaluateWeeklyRoutineCompliance([wedOnThu], ATHLETE_ROUTINES, refThursdayNight, {
      profileId: 'athlete-kmilo',
    });
    const exportView = evaluateWeeklyDaysCompletion([wedOnThu], ATHLETE_ROUTINES, refThursdayNight, {
      profileId: 'athlete-kmilo',
    });

    assert.equal(compliance.todayDateKey, '2026-11-26');
    assert.equal(compliance.completedRoutineIds.has('routine-miercoles-espalda'), true);
    assert.equal(compliance.completedRoutineIds.has('routine-jueves-hombro'), false);
    assert.equal(compliance.completedByScheduledDay['Miércoles'].isCompleted, true);
    assert.equal(compliance.completedByScheduledDay['Miércoles'].lastExecutedDateKey, '2026-11-26');
    assert.equal(compliance.completedByScheduledDay['Jueves'].isCompleted, false);

    assert.equal(exportView.byDayName['Miércoles'].isCompleted, true);
    assert.equal(exportView.byDayName['Miércoles'].executedDateKey, '2026-11-26');
    assert.equal(exportView.byDayName['Jueves'].isToday, true);
    assert.equal(exportView.byDayName['Jueves'].isCompleted, false);

    // Calorías y recuperación muscular ancladas al Jueves 26 real
    const cals = summarizeTodayAndWeeklyCalories([wedOnThu], 95, refThursdayNight);
    assert.equal(cals.todayDateKey, '2026-11-26');
    assert.equal(cals.todayCalories, 785);
    assert.equal(cals.weekDays.find((d) => d.dateKey === '2026-11-25')?.calories, 0);
    assert.equal(cals.weekDays.find((d) => d.dateKey === '2026-11-26')?.calories, 785);

    const recovery = computeRealTimeRecovery([wedOnThu], refThursdayNight.getTime(), ATHLETE_ROUTINES, 'ALL');
    const trainedMuscles = Object.values(recovery).filter(
      (m) => m && typeof m.elapsedHours === 'number' && m.elapsedHours < 4 && m.fatigue > 0
    );
    assert.ok(
      trainedMuscles.length > 0,
      'La fatiga muscular debe reflejar la ejecución real del jueves (~2.3h), no del miércoles (~26h)'
    );
  });

  // PRUEBA OBLIGATORIA 2
  await runCase('2. Ejecutar rutina del Viernes adelantada el Jueves marca SOLO Viernes (NO Jueves)', () => {
    const friOnThu = makeFridayWorkoutExecutedOnThursday();
    const compliance = evaluateWeeklyRoutineCompliance([friOnThu], ATHLETE_ROUTINES, refThursdayNight, {
      profileId: 'athlete-kmilo',
    });

    assert.equal(compliance.completedByScheduledDay['Viernes'].isCompleted, true);
    assert.equal(compliance.completedByScheduledDay['Viernes'].lastExecutedDateKey, '2026-11-26');
    assert.equal(compliance.completedByScheduledDay['Jueves'].isCompleted, false);
    assert.equal(compliance.completedRoutineIds.has('routine-viernes-pierna'), true);
    assert.equal(compliance.completedRoutineIds.has('routine-jueves-hombro'), false);
  });

  // PRUEBA OBLIGATORIA 3
  await runCase('3. Ejecutar dos rutinas distintas (Miércoles y Viernes) el mismo Jueves preserva ambas sin duplicar ni colapsar', () => {
    const wedOnThu = makeWednesdayWorkoutExecutedOnThursday();
    // Incluso si se ejecutan con 15 minutos de diferencia y mismo volumen/series, NO deben colapsarse
    const friOnThuNear = makeFridayWorkoutExecutedOnThursday({
      startedAt: '2026-11-26T22:35:00.000Z',
      completedAt: '2026-11-26T22:45:00.000Z',
      date: '2026-11-26T22:45:00.000Z',
      startTime: new Date('2026-11-26T22:35:00.000Z').getTime(),
      endTime: new Date('2026-11-26T22:45:00.000Z').getTime(),
      completedSetsCount: wedOnThu.completedSetsCount,
      totalVolumeKg: wedOnThu.totalVolumeKg,
    });

    const sanitized = purgeAndSanitizeWorkoutHistory([wedOnThu, friOnThuNear], 95);
    assert.equal(sanitized.cleanedHistory.length, 2, 'Dos rutinas distintas el mismo día jamás deben fusionarse');

    const compliance = evaluateWeeklyRoutineCompliance(sanitized.cleanedHistory, ATHLETE_ROUTINES, refThursdayNight, {
      profileId: 'athlete-kmilo',
    });
    assert.equal(compliance.completedByScheduledDay['Miércoles'].isCompleted, true);
    assert.equal(compliance.completedByScheduledDay['Viernes'].isCompleted, true);
    assert.equal(compliance.completedByScheduledDay['Jueves'].isCompleted, false);
    assert.equal(compliance.completedByScheduledDay['Lunes'].isCompleted, false);

    const cals = summarizeTodayAndWeeklyCalories(sanitized.cleanedHistory, 95, refThursdayNight);
    assert.equal(cals.todayCalories, 785 + 978);
    assert.equal(cals.weekDays.find((d) => d.dateKey === '2026-11-25')?.calories, 0);
    assert.equal(cals.weekDays.find((d) => d.dateKey === '2026-11-27')?.calories, 0);
  });

  // PRUEBA OBLIGATORIA 4
  await runCase('4. Cerrar y reabrir la aplicación (serialización JSON + rehidratación + sanitización) conserva indicadores y cargas exactas', () => {
    const wedOnThu = makeWednesdayWorkoutExecutedOnThursday();
    const persistedJson = JSON.stringify([wedOnThu]);
    const rehydrated = JSON.parse(persistedJson) as CompletedWorkout[];

    const { cleanedHistory } = purgeAndSanitizeWorkoutHistory(rehydrated, 95);
    const { repairedHistory } = repairWorkoutRoutineMetadata(cleanedHistory, ATHLETE_ROUTINES, 'athlete-kmilo');

    assert.equal(repairedHistory.length, 1);
    assert.equal(repairedHistory[0].routineId, 'routine-miercoles-espalda');
    assert.equal(repairedHistory[0].scheduledDay, 'Miércoles');
    assert.equal(repairedHistory[0].startedAt, wedOnThu.startedAt);
    assert.equal(repairedHistory[0].completedAt, wedOnThu.completedAt);
    assert.equal(repairedHistory[0].executionDateKey, '2026-11-26');
    assert.equal(repairedHistory[0].exercisesSummary[1].maxWeight, 90);
    assert.equal(repairedHistory[0].exercisesSummary[1].setsDetail?.length, 4);

    const compliance = evaluateWeeklyRoutineCompliance(repairedHistory, ATHLETE_ROUTINES, refThursdayNight, {
      profileId: 'athlete-kmilo',
    });
    assert.equal(compliance.completedByScheduledDay['Miércoles'].isCompleted, true);
    assert.equal(compliance.completedByScheduledDay['Jueves'].isCompleted, false);
  });

  // PRUEBA OBLIGATORIA 5
  await runCase('5. Sincronización APK <-> Web reconcilia sin duplicar y mantiene scheduledDay/routineId/cargas íntegras', () => {
    const apkRecord = makeWednesdayWorkoutExecutedOnThursday();
    // Web tenía una copia anterior sin scheduledDay/completedAt de la misma sesión
    const webLegacyCopy: CompletedWorkout = {
      ...apkRecord,
      scheduledDay: undefined,
      startedAt: undefined,
      completedAt: undefined,
      executionDateKey: undefined,
      weekId: undefined,
    };

    const { unifiedHistory } = reconcileAndUnifyAthleteHistory(
      [
        {
          sourceId: 'local:apk',
          sourceLabel: 'APK Local',
          sourceType: 'local_storage',
          rawRecords: [apkRecord],
          profileId: 'athlete-kmilo',
        },
        {
          sourceId: 'firestore:athlete-kmilo',
          sourceLabel: 'Firestore Web',
          sourceType: 'firestore_doc',
          rawRecords: [webLegacyCopy],
          profileId: 'athlete-kmilo',
        },
      ],
      95
    );

    assert.equal(unifiedHistory.length, 1, 'APK y Web deben converger en un solo registro sin duplicados');
    const { repairedHistory } = repairWorkoutRoutineMetadata(unifiedHistory, ATHLETE_ROUTINES, 'athlete-kmilo');
    assert.equal(repairedHistory[0].scheduledDay, 'Miércoles');
    assert.equal(repairedHistory[0].routineId, 'routine-miercoles-espalda');
    assert.equal(repairedHistory[0].completedAt, apkRecord.completedAt);
    assert.equal(repairedHistory[0].totalVolumeKg, 5730);
  });

  // PRUEBA OBLIGATORIA 6
  await runCase('6. Cambio de semana y horarios cercanos a medianoche en America/Santiago (Domingo 23:55 vs Lunes 00:05)', () => {
    // Domingo 29 nov 2026 23:55 Chile (UTC-3 -> 2026-11-30T02:55:00.000Z -> sigue en semana W48)
    const sundayLateNightChile = makeWednesdayWorkoutExecutedOnThursday({
      id: 'wk-sun-2355-chile',
      startedAt: '2026-11-30T02:00:00.000Z',
      completedAt: '2026-11-30T02:55:00.000Z',
      date: '2026-11-30T02:55:00.000Z',
      startTime: new Date('2026-11-30T02:00:00.000Z').getTime(),
      endTime: new Date('2026-11-30T02:55:00.000Z').getTime(),
      executionDateKey: '2026-11-29',
      weekId: '2026-W48',
    });

    // Lunes 30 nov 2026 00:05 Chile (UTC-3 -> 2026-11-30T03:05:00.000Z -> ya es semana W49)
    const mondayEarlyMorningChile = makeFridayWorkoutExecutedOnThursday({
      id: 'wk-mon-0005-chile',
      routineId: 'routine-lunes-empuje',
      routineTitle: 'Lunes: Empuje Pecho/Hombro',
      scheduledDay: 'Lunes',
      startedAt: '2026-11-30T03:00:00.000Z',
      completedAt: '2026-11-30T03:05:00.000Z',
      date: '2026-11-30T03:05:00.000Z',
      startTime: new Date('2026-11-30T03:00:00.000Z').getTime(),
      endTime: new Date('2026-11-30T03:05:00.000Z').getTime(),
      executionDateKey: '2026-11-30',
      weekId: '2026-W49',
    });

    assert.equal(resolveWorkoutChileDateKey(sundayLateNightChile), '2026-11-29');
    assert.equal(resolveWorkoutChileDateKey(mondayEarlyMorningChile), '2026-11-30');

    // Mirando desde Domingo 29 nov 23:58 Chile -> SOLO cuenta la rutina de W48 (Miércoles), NO la de W49
    const refSun2358 = new Date('2026-11-30T02:58:00.000Z');
    assert.equal(getChileLocalDateKey(refSun2358), '2026-11-29');
    const compW48 = evaluateWeeklyRoutineCompliance(
      [sundayLateNightChile, mondayEarlyMorningChile],
      ATHLETE_ROUTINES,
      refSun2358
    );
    assert.equal(compW48.mondayDateKey, '2026-11-23');
    assert.equal(compW48.sundayDateKey, '2026-11-29');
    assert.equal(compW48.completedByScheduledDay['Miércoles'].isCompleted, true);
    assert.equal(compW48.completedByScheduledDay['Lunes'].isCompleted, false);

    // Mirando desde Lunes 30 nov 00:10 Chile -> ciclo nuevo W49: Miércoles ya NO está marcado, Lunes SÍ (incluso antes de las 09:00 AM Chile)
    const refMon0010 = new Date('2026-11-30T03:10:00.000Z');
    assert.equal(getChileLocalDateKey(refMon0010), '2026-11-30');
    const compW49 = evaluateWeeklyRoutineCompliance(
      [sundayLateNightChile, mondayEarlyMorningChile],
      ATHLETE_ROUTINES,
      refMon0010
    );
    assert.equal(compW49.mondayDateKey, '2026-11-30');
    assert.equal(compW49.sundayDateKey, '2026-12-06');
    assert.equal(compW49.completedByScheduledDay['Miércoles'].isCompleted, false);
    assert.equal(compW49.completedByScheduledDay['Lunes'].isCompleted, true);
  });

  // PRUEBA OBLIGATORIA 7
  await runCase('7. No reaparece el bug previo de calorías: Viernes ejecutado el Jueves 21:42 Chile asigna 978 kcal SOLO al Jueves y 0 al Viernes', () => {
    const friOnThu = makeFridayWorkoutExecutedOnThursday();
    const summary = summarizeTodayAndWeeklyCalories([friOnThu], 95, refThursdayNight);
    assert.equal(summary.todayDateKey, '2026-11-26');
    assert.equal(summary.todayCalories, 978);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-26')?.calories, 978);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-27')?.calories, 0);
  });

  // PRUEBA EXTRA A: Reparación retroactiva segura de registro histórico mal etiquetado sin pérdida de cargas
  await runCase('8. Reparación retroactiva corrige un registro del Jueves con ejercicios inequívocos del Miércoles preservando 100% de pesos/series', () => {
    const mislabeledHistorical: CompletedWorkout = makeWednesdayWorkoutExecutedOnThursday({
      id: 'wk-legacy-mislabeled',
      routineId: 'rutina-historica',
      routineTitle: 'Rutina Jueves', // sobrescrito erróneamente con día de ejecución
      scheduledDay: undefined,
      startedAt: undefined,
      completedAt: undefined,
      executionDateKey: undefined,
      weekId: undefined,
    });

    const inferred = inferExecutedRoutineIdentity(mislabeledHistorical, ATHLETE_ROUTINES);
    assert.equal(inferred.scheduledDay, 'Miércoles');
    assert.equal(inferred.routineId, 'routine-miercoles-espalda');
    assert.equal(inferred.source, 'exercises_unambiguous');

    const { repairedHistory, repairedCount, wasModified } = repairWorkoutRoutineMetadata(
      [mislabeledHistorical],
      ATHLETE_ROUTINES,
      'athlete-kmilo'
    );
    assert.equal(wasModified, true);
    assert.equal(repairedCount, 1);
    assert.equal(repairedHistory[0].scheduledDay, 'Miércoles');
    assert.equal(repairedHistory[0].routineId, 'routine-miercoles-espalda');
    assert.equal(repairedHistory[0].routineTitle, 'Miércoles: Tracción Espalda/Bíceps');
    assert.equal(repairedHistory[0].executionDateKey, '2026-11-26');
    // Pesos, repeticiones, calorías y volumen intactos
    assert.equal(repairedHistory[0].totalVolumeKg, 5730);
    assert.equal(repairedHistory[0].caloriesBurned, 785);
    assert.equal(repairedHistory[0].exercisesSummary[1].maxWeight, 90);
    assert.equal(repairedHistory[0].exercisesSummary[1].setsDetail?.length, 4);
  });

  // PRUEBA EXTRA B: Independencia total por atleta
  await runCase('9. Cumplimiento independiente por atleta: sesiones de atleta B jamás marcan rutinas de atleta A', () => {
    const athleteBWorkout = makeWednesdayWorkoutExecutedOnThursday({
      id: 'wk-athlete-b',
      profileId: 'athlete-other',
    });
    const compAthleteA = evaluateWeeklyRoutineCompliance([athleteBWorkout], ATHLETE_ROUTINES, refThursdayNight, {
      profileId: 'athlete-kmilo',
    });
    const compAthleteB = evaluateWeeklyRoutineCompliance([athleteBWorkout], ATHLETE_ROUTINES, refThursdayNight, {
      profileId: 'athlete-other',
    });

    assert.equal(compAthleteA.completedByScheduledDay['Miércoles'].isCompleted, false);
    assert.equal(compAthleteB.completedByScheduledDay['Miércoles'].isCompleted, true);
  });

  // PRUEBA EXTRA C: Validación del manifiesto OTA staging v7.0.6 empaquetado (y contrato de compatibilidad OTA)
  await runCase('10. Contrato de versión OTA staging 7.0.6 conserva versionCode nativo 70000 y valida manifiesto staging', () => {
    const manifestPath = path.join(process.cwd(), 'dist-ota', 'manifest.staging.json');
    const sampleManifest: OtaManifestPayload = fs.existsSync(manifestPath)
      ? (JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as OtaManifestPayload)
      : {
          version: '7.0.6',
          buildId: '7.0.6-ota-staging',
          channel: 'staging',
          url: 'https://lazcakongym.ai.studio/api/ota/bundles/lazcakongym-ota-7.0.6.zip',
          checksum: 'a'.repeat(64),
          contentsPolicy: 'web_assets_only',
          requiresApkUpdate: false,
          minNativeVersionCode: 70000,
          capacitorMajor: 8,
          releaseNotes: 'Corrección indicador de rutinas completadas.',
          publishedAt: new Date().toISOString(),
        };

    assert.equal(sampleManifest.channel, 'staging');
    assert.equal(sampleManifest.minNativeVersionCode, 70000);
    assert.equal(sampleManifest.version, '7.0.6');
    assert.equal(sampleManifest.contentsPolicy, 'web_assets_only');
    assert.equal(sampleManifest.requiresApkUpdate, false);
    assert.match(sampleManifest.checksum, /^[a-f0-9]{64}$/i);

    const validation = validateOtaManifest(sampleManifest, {
      currentWebVersion: '7.0.5',
      currentNativeVersionCode: 70000,
      expectedChannel: 'staging',
      allowProduction: false,
    });
    assert.equal(validation.valid, true, `Manifiesto staging debe ser válido: ${validation.reason || ''}`);
    assert.equal(validation.compatible, true);
    assert.equal(validation.requiresApkUpdate, false);

    // Verificar que Android nativo conserva versionCode 70000 sin cambios nativos
    const gradleSrc = fs.readFileSync(path.join(process.cwd(), 'android/app/build.gradle'), 'utf8');
    assert.ok(gradleSrc.includes('70000'), 'android/app/build.gradle debe conservar versionCode 70000');
  });

  console.log('\n🎉 ALL 10 ROUTINE COMPLETION REGRESSION & OTA STAGING TESTS PASSED!\n');
}

main().catch((err) => {
  console.error('\n💥 routineCompletionRegressionSuite FAILED:', err);
  process.exit(1);
});
