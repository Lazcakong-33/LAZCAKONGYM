import { strict as assert } from 'node:assert';
import {
  getChileLocalDateKey,
  getChileWeekdayName,
  resolveWorkoutChileDateKey,
  summarizeTodayAndWeeklyCalories,
  calculateIsolatedDailyCalories,
} from '../../utils/calorieCalculator.ts';
import {
  purgeAndSanitizeWorkoutHistory,
  sanitizeRoutineTitleForDate,
} from '../../utils/historySanitizer.ts';
import { reconcileAndUnifyAthleteHistory } from '../../utils/historyRecoveryEngine.ts';
import { evaluateWeeklyDaysCompletion } from '../../utils/exportReport.ts';
import {
  buildDailyCaloriesReport,
  purgeCorruptedWorkoutsOnServer,
  resolveServerWorkoutChileDateKey,
} from '../dailyCaloriesController.ts';
import { computeElitePerformanceAnalytics } from '../../utils/elitePerformanceAnalytics.ts';
import { calculateExecutedWeekStatus } from '../../utils/weeklyCycleManager.ts';
import { formatDisplayDateDDMMYYYY } from '../../utils/exportReport.ts';
import type { CompletedWorkout, PersonalRecord, Routine } from '../../types/index.ts';

async function runCase(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    console.error(`❌ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

async function main() {
  console.log('\n=== LAZCAKONG GYM — CHILE TIMEZONE & FRIDAY-ON-THURSDAY CALORIES SUITE ===\n');

  // Jueves 19 de noviembre de 2026 a las 21:42 hora de Chile (UTC-3 -> 2026-11-20T00:42:00.000Z)
  const thursdayNightChileIso = '2026-11-20T00:42:00.000Z';
  const thursdayNightEndMs = new Date(thursdayNightChileIso).getTime();
  const thursdayNightStartMs = thursdayNightEndMs - 75 * 60 * 1000; // 20:27 Chile

  const fridayRoutineDoneOnThursday: CompletedWorkout = {
    id: 'workout-thu-night-viernes',
    profileId: 'test-kmilo',
    routineId: 'routine-viernes-id',
    routineTitle: 'Viernes',
    date: thursdayNightChileIso,
    startTime: thursdayNightStartMs,
    endTime: thursdayNightEndMs,
    durationSeconds: 75 * 60,
    totalVolumeKg: 6420,
    completedSetsCount: 16,
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
        muscleGroup: 'Isquiosurales',
        setsDetail: [
          { setNumber: 1, weight: 100, reps: 8, completed: true, rpe: 8 },
          { setNumber: 2, weight: 105, reps: 8, completed: true, rpe: 8.5 },
          { setNumber: 3, weight: 110, reps: 8, completed: true, rpe: 9 },
          { setNumber: 4, weight: 110, reps: 8, completed: true, rpe: 9 },
        ],
      },
      {
        exerciseId: 'ex-bulgarian',
        name: 'Sentadilla búlgara con mancuernas',
        sets: 4,
        maxWeight: 32,
        maxReps: 10,
        volumeKg: 1280,
        muscleGroup: 'Cuádriceps',
        setsDetail: [
          { setNumber: 1, weight: 30, reps: 10, completed: true, rpe: 8 },
          { setNumber: 2, weight: 32, reps: 10, completed: true, rpe: 8.5 },
          { setNumber: 3, weight: 32, reps: 10, completed: true, rpe: 9 },
          { setNumber: 4, weight: 32, reps: 10, completed: true, rpe: 9.5 },
        ],
      },
    ],
  };

  await runCase('1. 21:42 del jueves 19 nov en Chile (00:42Z viernes UTC) corresponde a 2026-11-19 (Jueves)', () => {
    assert.equal(getChileLocalDateKey(thursdayNightChileIso), '2026-11-19');
    assert.equal(getChileWeekdayName(thursdayNightChileIso), 'Jueves');
    assert.equal(resolveWorkoutChileDateKey(fridayRoutineDoneOnThursday), '2026-11-19');
    assert.equal(sanitizeRoutineTitleForDate('Viernes', thursdayNightChileIso), 'Viernes');
  });

  await runCase('2. Rutina "Viernes" completada el jueves por la noche asigna 978 kcal SOLO al jueves (0 kcal el viernes)', () => {
    const sanitized = purgeAndSanitizeWorkoutHistory([fridayRoutineDoneOnThursday], 95);
    assert.equal(sanitized.cleanedHistory.length, 1);
    assert.equal(sanitized.cleanedHistory[0].routineTitle, 'Viernes');

    // A las 21:45 del jueves en Chile (2026-11-20T00:45:00.000Z)
    const thursdayRef = new Date('2026-11-20T00:45:00.000Z');
    const summary = summarizeTodayAndWeeklyCalories(sanitized.cleanedHistory, 95, thursdayRef);

    assert.equal(summary.todayDateKey, '2026-11-19');
    assert.equal(summary.todayCalories, 978);
    assert.equal(summary.todayWorkoutsCount, 1);

    const thuBucket = summary.weekDays.find((d) => d.dateKey === '2026-11-19');
    const friBucket = summary.weekDays.find((d) => d.dateKey === '2026-11-20');
    assert.ok(thuBucket && friBucket);
    assert.equal(thuBucket.weekdayName, 'Jueves');
    assert.equal(thuBucket.isToday, true);
    assert.equal(thuBucket.calories, 978);
    assert.equal(thuBucket.workoutsCount, 1);

    assert.equal(friBucket.weekdayName, 'Viernes');
    assert.equal(friBucket.isToday, false);
    assert.equal(friBucket.calories, 0);
    assert.equal(friBucket.workoutsCount, 0);
  });

  await runCase('3. Al cerrar y volver a abrir la app (tanto jueves noche como viernes mañana), calorías y series siguen solo en jueves', () => {
    const firstPass = purgeAndSanitizeWorkoutHistory([fridayRoutineDoneOnThursday], 95).cleanedHistory;
    const serialized = JSON.stringify(firstPass);
    const rehydrated: CompletedWorkout[] = JSON.parse(serialized);

    const reconciled = reconcileAndUnifyAthleteHistory(
      [
        {
          sourceId: 'local:storage',
          sourceLabel: 'Local',
          sourceType: 'local_storage',
          rawRecords: rehydrated,
        },
        {
          sourceId: 'firestore:test',
          sourceLabel: 'Firestore',
          sourceType: 'firestore_doc',
          rawRecords: rehydrated,
        },
      ],
      95
    );
    const afterReopen = purgeAndSanitizeWorkoutHistory(reconciled.unifiedHistory, 95).cleanedHistory;
    assert.equal(afterReopen.length, 1);
    assert.equal(afterReopen[0].exercisesSummary[0].setsDetail?.length, 4);
    assert.equal(afterReopen[0].exercisesSummary[0].setsDetail?.[2].weight, 110);
    assert.equal(afterReopen[0].exercisesSummary[0].setsDetail?.[2].reps, 8);

    // Reapertura el viernes 20 a las 09:00 AM en Chile (12:00 UTC)
    const fridayMorningRef = new Date('2026-11-20T12:00:00.000Z');
    const summaryFri = summarizeTodayAndWeeklyCalories(afterReopen, 95, fridayMorningRef);
    assert.equal(summaryFri.todayDateKey, '2026-11-20');
    assert.equal(summaryFri.todayCalories, 0);
    assert.equal(summaryFri.todayWorkoutsCount, 0);
    assert.equal(summaryFri.weekDays.find((d) => d.dateKey === '2026-11-19')?.calories, 978);
    assert.equal(summaryFri.weekDays.find((d) => d.dateKey === '2026-11-20')?.calories, 0);
  });

  await runCase('4. Deduplicación si los 978 kcal ya estaban incluidos en los 2.134 kcal del jueves junto a copia desplazada al viernes', () => {
    const earlierThursdayWorkout: CompletedWorkout = {
      id: 'workout-thu-morning',
      profileId: 'test-kmilo',
      routineId: 'routine-jueves-id',
      routineTitle: 'Jueves',
      date: '2026-11-19T14:30:00.000Z', // 11:30 Chile
      startTime: new Date('2026-11-19T13:15:00.000Z').getTime(),
      endTime: new Date('2026-11-19T14:30:00.000Z').getTime(),
      durationSeconds: 75 * 60,
      totalVolumeKg: 5100,
      completedSetsCount: 14,
      caloriesBurned: 1156, // 1156 + 978 = 2134 kcal
      isFinished: true,
      exercisesSummary: [
        {
          exerciseId: 'ex-bench',
          name: 'Press de banca plano con barra',
          sets: 4,
          maxWeight: 90,
          maxReps: 10,
          volumeKg: 3200,
          muscleGroup: 'Pecho',
          setsDetail: [{ setNumber: 1, weight: 90, reps: 10, completed: true }],
        },
      ],
    };

    // Copia duplicada con ID distinto ('recovered-...') y título antiguo ('Rutina Jueves')
    const duplicateCopyWithOldTitle: CompletedWorkout = {
      ...fridayRoutineDoneOnThursday,
      id: 'recovered-2026-11-20-viernes-0',
      routineTitle: 'Rutina Jueves',
      exercisesSummary: fridayRoutineDoneOnThursday.exercisesSummary.map((ex) => ({
        ...ex,
        setsDetail: undefined, // Menos detalle que la copia original
      })),
    };

    const reconciled = reconcileAndUnifyAthleteHistory(
      [
        {
          sourceId: 'local:storage',
          sourceLabel: 'Local',
          sourceType: 'local_storage',
          rawRecords: [earlierThursdayWorkout, duplicateCopyWithOldTitle],
        },
        {
          sourceId: 'firestore:test',
          sourceLabel: 'Firestore',
          sourceType: 'firestore_doc',
          rawRecords: [earlierThursdayWorkout, fridayRoutineDoneOnThursday],
        },
      ],
      95
    );

    const sanitized = purgeAndSanitizeWorkoutHistory(reconciled.unifiedHistory, 95);
    assert.equal(sanitized.cleanedHistory.length, 2); // 1 sesión mañana + 1 sesión noche (978 kcal contada una sola vez)

    const keptNight = sanitized.cleanedHistory.find((w) => w.caloriesBurned === 978)!;
    assert.equal(keptNight.routineTitle, 'Viernes');
    assert.equal(keptNight.exercisesSummary[0].setsDetail?.length, 4);

    const summary = summarizeTodayAndWeeklyCalories(
      sanitized.cleanedHistory,
      95,
      new Date('2026-11-20T00:50:00.000Z')
    );
    assert.equal(summary.todayDateKey, '2026-11-19');
    assert.equal(summary.todayCalories, 2134);
    assert.equal(summary.todayWorkoutsCount, 2);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-19')?.calories, 2134);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-19')?.workoutsCount, 2);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-20')?.calories, 0);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-20')?.workoutsCount, 0);
    assert.equal(summary.weeklyTotalCalories, 2134);
    assert.equal(summary.weeklyWorkoutsCount, 2);

    const isolated = calculateIsolatedDailyCalories(
      sanitized.cleanedHistory,
      { weightKg: 95 },
      new Date('2026-11-20T00:50:00.000Z')
    );
    assert.equal(isolated.dailyCaloriesBurned, 2134);
    assert.equal(isolated.isolatedDailyHistory.length, 1);
    assert.equal(isolated.isolatedDailyHistory[0].dateKey, '2026-11-19');
    assert.equal(isolated.isolatedDailyHistory[0].completedWorkoutsCount, 2);
  });

  await runCase('5. Corrección de registros heredados con fecha UTC truncada (YYYY-MM-DD = 2026-11-20) pero endTime a las 21:42 Chile', () => {
    const legacyTruncated: CompletedWorkout = {
      ...fridayRoutineDoneOnThursday,
      id: 'legacy-utc-truncated',
      date: '2026-11-20', // generado por antiguo toISOString().slice(0, 10)
    };
    assert.equal(resolveWorkoutChileDateKey(legacyTruncated), '2026-11-19');
    const summary = summarizeTodayAndWeeklyCalories([legacyTruncated], 95, new Date('2026-11-20T00:50:00.000Z'));
    assert.equal(summary.todayCalories, 978);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-20')?.calories, 0);
  });

  await runCase('6. evaluateWeeklyDaysCompletion y dailyCaloriesController respetan día real de ejecución en Chile', () => {
    const routines: Routine[] = [
      { id: 'routine-viernes-id', dayName: 'Viernes', title: 'Viernes', tagline: 'Pierna', exercises: [] },
    ];
    const completion = evaluateWeeklyDaysCompletion(
      [fridayRoutineDoneOnThursday],
      routines,
      new Date('2026-11-20T00:45:00.000Z')
    );
    assert.equal(completion.byDayName['Jueves'].isToday, true);
    assert.equal(completion.byDayName['Jueves'].isCompleted, true);
    assert.equal(completion.byDayName['Viernes'].isToday, false);
    assert.equal(completion.byDayName['Viernes'].isCompleted, false);

    const serverReport = buildDailyCaloriesReport({
      athlete: { id: 'test-kmilo', weightKg: 95 },
      workouts: [fridayRoutineDoneOnThursday],
      targetDate: '2026-11-20T00:45:00.000Z',
    });
    assert.equal(serverReport.dateKey, '2026-11-19');
    assert.equal(serverReport.dailyCaloriesBurned, 978);
    assert.equal(serverReport.completedWorkoutsToday, 1);
    assert.equal(serverReport.isolatedDailyHistory[0].dateKey, '2026-11-19');
    assert.equal(serverReport.isolatedDailyHistory[0].routineTitle, 'Viernes');
  });

  await runCase('7. Entrenamientos adelantados y atrasados independizan día programado de fecha efectiva (Inicio, Calendario y Progreso)', () => {
    // Rutina programada "Lunes" ejecutada con atraso el miércoles 18 nov a las 22:15 Chile (2026-11-19T01:15:00Z)
    const delayedMondayRoutine: CompletedWorkout = {
      id: 'workout-delayed-lunes-on-wed',
      profileId: 'test-kmilo',
      routineId: 'routine-lunes-id',
      routineTitle: 'Lunes: Empuje',
      date: '2026-11-19T01:15:00.000Z',
      startTime: new Date('2026-11-19T00:05:00.000Z').getTime(),
      endTime: new Date('2026-11-19T01:15:00.000Z').getTime(),
      durationSeconds: 70 * 60,
      totalVolumeKg: 5800,
      completedSetsCount: 15,
      caloriesBurned: 820,
      isFinished: true,
      exercisesSummary: [
        {
          exerciseId: 'ex-bench-1',
          name: 'Press de banca plano con barra',
          sets: 4,
          maxWeight: 102.5,
          maxReps: 8,
          volumeKg: 3280,
          muscleGroup: 'Pecho',
          setsDetail: [
            { setNumber: 1, weight: 95, reps: 8, completed: true },
            { setNumber: 2, weight: 100, reps: 8, completed: true },
            { setNumber: 3, weight: 102.5, reps: 8, completed: true },
            { setNumber: 4, weight: 102.5, reps: 8, completed: true },
          ],
        },
      ],
    };

    const sanitized = purgeAndSanitizeWorkoutHistory(
      [delayedMondayRoutine, fridayRoutineDoneOnThursday],
      95
    );
    assert.equal(sanitized.cleanedHistory.length, 2);

    const refThuNight = new Date('2026-11-20T00:45:00.000Z'); // Jueves 19 nov 21:45 Chile
    const summary = summarizeTodayAndWeeklyCalories(sanitized.cleanedHistory, 95, refThuNight);
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-16')?.calories, 0); // Lunes programado = 0 kcal
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-18')?.calories, 820); // Miércoles real = 820 kcal
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-19')?.calories, 978); // Jueves real = 978 kcal
    assert.equal(summary.weekDays.find((d) => d.dateKey === '2026-11-20')?.calories, 0); // Viernes programado = 0 kcal
    assert.equal(summary.weeklyTotalCalories, 1798);
    assert.equal(summary.weeklyWorkoutsCount, 2);

    // Calendario semanal
    const routines: Routine[] = [
      { id: 'routine-lunes-id', dayName: 'Lunes', title: 'Lunes: Empuje', tagline: 'Pecho', exercises: [] },
      { id: 'routine-viernes-id', dayName: 'Viernes', title: 'Viernes', tagline: 'Pierna', exercises: [] },
    ];
    const completion = evaluateWeeklyDaysCompletion(sanitized.cleanedHistory, routines, refThuNight);
    assert.equal(completion.byDayName['Lunes'].isCompleted, false);
    assert.equal(completion.byDayName['Miércoles'].isCompleted, true);
    assert.equal(completion.byDayName['Jueves'].isCompleted, true);
    assert.equal(completion.byDayName['Viernes'].isCompleted, false);

    // Progreso (Elite Performance Analytics & WeeklyCycleManager)
    const prs: Record<string, PersonalRecord> = {
      'ex-rdl': {
        exerciseId: 'ex-rdl',
        exerciseName: 'Peso muerto rumano con barra',
        maxWeight: 110,
        repsAtMaxWeight: 8,
        estimated1RM: 139,
        date: thursdayNightChileIso,
      },
    };
    const elite = computeElitePerformanceAnalytics({
      history: sanitized.cleanedHistory,
      routines,
      prs,
      period: '30d',
      weeklyTargetDays: 5,
      profileId: 'test-kmilo',
      referenceNow: refThuNight,
    });
    assert.equal(elite.kpis.totalWorkouts, 2);
    assert.equal(elite.kpis.activeDaysCount, 2);
    assert.equal(elite.kpis.totalVolumeKg, 5800 + 6420);
    assert.equal(elite.monthlyFrequencySeries.length, 1);
    assert.equal(elite.monthlyFrequencySeries[0].startDate, '2026-11-01');

    const weekStatus = calculateExecutedWeekStatus(sanitized.cleanedHistory, { daysPerWeek: 4, totalWeeks: 8 });
    assert.deepEqual(weekStatus.uniqueTrainedDates, ['2026-11-18', '2026-11-19']);
    assert.equal(weekStatus.uniqueDaysCount, 2);
  });

  await runCase('8. Reparación histórica en cliente y servidor detecta wasModified=true y corrige registros heredados sin duplicar', () => {
    const legacyCorrupted: CompletedWorkout = {
      ...fridayRoutineDoneOnThursday,
      id: 'legacy-thu-night-corrupted',
      date: '2026-11-20', // fecha UTC truncada erróneamente al viernes
    };
    const report = purgeAndSanitizeWorkoutHistory([legacyCorrupted], 95);
    assert.equal(report.wasModified, true);
    assert.equal(report.cleanedHistory.length, 1);
    assert.equal(resolveWorkoutChileDateKey(report.cleanedHistory[0]), '2026-11-19');
    assert.equal(formatDisplayDateDDMMYYYY(report.cleanedHistory[0].date), '19-11-2026');

    // Servidor: resolveServerWorkoutChileDateKey + buildDailyCaloriesReport + purgeCorruptedWorkoutsOnServer
    assert.equal(resolveServerWorkoutChileDateKey(legacyCorrupted), '2026-11-19');
    const serverPurged = purgeCorruptedWorkoutsOnServer([legacyCorrupted, legacyCorrupted], 95);
    assert.equal(serverPurged.cleanedHistory.length, 1);
    assert.equal(serverPurged.purgedCount, 1);
    assert.equal(resolveServerWorkoutChileDateKey(serverPurged.cleanedHistory[0]), '2026-11-19');

    const serverReport = buildDailyCaloriesReport({
      athlete: { id: 'test-kmilo', weightKg: 95 },
      workouts: [legacyCorrupted],
      targetDate: '2026-11-20T00:45:00.000Z',
    });
    assert.equal(serverReport.dateKey, '2026-11-19');
    assert.equal(serverReport.dailyCaloriesBurned, 978);
    assert.equal(serverReport.isolatedDailyHistory[0].dateKey, '2026-11-19');
  });

  await runCase('9. Zona horaria America/Santiago en horario de invierno (UTC-4), verano (UTC-3) y domingo noche fin de semana/mes', () => {
    // Invierno en Chile (julio 2026, UTC-4): domingo 19 jul 22:30 Chile -> lunes 20 jul 02:30Z UTC
    const winterSundayNightIso = '2026-07-20T02:30:00.000Z';
    assert.equal(getChileLocalDateKey(winterSundayNightIso), '2026-07-19');
    assert.equal(getChileWeekdayName(winterSundayNightIso), 'Domingo');

    // Fin de mes en Chile (noviembre 2026, UTC-3): lunes 30 nov 22:15 Chile -> martes 1 dic 01:15Z UTC
    const endOfMonthNightIso = '2026-12-01T01:15:00.000Z';
    assert.equal(getChileLocalDateKey(endOfMonthNightIso), '2026-11-30');
    assert.equal(getChileWeekdayName(endOfMonthNightIso), 'Lunes');
  });

  await runCase('10. Conservación íntegra de rutinas, cargas, series detalladas (setsDetail) y récords personales tras saneamiento', () => {
    const sanitized = purgeAndSanitizeWorkoutHistory([fridayRoutineDoneOnThursday], 95);
    const saved = sanitized.cleanedHistory[0];
    assert.equal(saved.routineId, 'routine-viernes-id');
    assert.equal(saved.routineTitle, 'Viernes');
    assert.equal(saved.totalVolumeKg, 6420);
    assert.equal(saved.exercisesSummary.length, 2);
    assert.equal(saved.exercisesSummary[0].maxWeight, 110);
    assert.equal(saved.exercisesSummary[0].maxReps, 8);
    assert.deepEqual(
      saved.exercisesSummary[0].setsDetail?.map((s) => `${s.weight}x${s.reps}`),
      ['100x8', '105x8', '110x8', '110x8']
    );
    assert.deepEqual(
      saved.exercisesSummary[1].setsDetail?.map((s) => `${s.weight}x${s.reps}`),
      ['30x10', '32x10', '32x10', '32x10']
    );
  });

  console.log('\nResumen Chile Timezone & Friday-on-Thursday Suite: 10/10 pruebas aprobadas.\n');
}

main();
