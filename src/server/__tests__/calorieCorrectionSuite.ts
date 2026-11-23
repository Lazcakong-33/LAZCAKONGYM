import { strict as assert } from 'assert';
import { calculateIsolatedDailyCalories, summarizeTodayAndWeeklyCalories, getLocalDateKey, parseRobustDate } from '../../utils/calorieCalculator';
import { purgeAndSanitizeWorkoutHistory } from '../../utils/historySanitizer';
import type { CompletedWorkout } from '../../types';

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

async function runTests() {
  console.log('=== LAZCAKONG GYM — CALORIE CORRECTION SUITE ===');

  await runCase('1. Rutina de martes realizada el miércoles se registra el miércoles', () => {
    // Scheduled/assigned routine date was Tuesday (2026-11-17), but execution was Wednesday (2026-11-18)
    const workoutOnWednesday: CompletedWorkout = {
      id: 'w-tue-on-wed',
      routineId: 'tue-routine',
      routineTitle: 'Torso (Martes atrasado)',
      date: '2026-11-17T18:00:00Z', // assigned routine date (old incorrect date)
      startTime: new Date('2026-11-18T10:00:00Z').getTime(), // actual execution time Wednesday
      endTime: new Date('2026-11-18T11:00:00Z').getTime(),
      durationSeconds: 3600,
      totalVolumeKg: 6000,
      completedSetsCount: 15,
      caloriesBurned: 1040,
      isFinished: true,
      exercisesSummary: [
        { name: 'Press de banca', sets: 5, maxWeight: 100, maxReps: 10, volumeKg: 3000, muscleGroup: 'Pecho' },
        { name: 'Remo con barra', sets: 5, maxWeight: 90, maxReps: 10, volumeKg: 2700, muscleGroup: 'Espalda' },
      ],
    };

    // If we sanitize using actual execution time (startTime / endTime), date should be corrected to 2026-11-18
    const purgeResult = purgeAndSanitizeWorkoutHistory([workoutOnWednesday], 90);
    assert.equal(purgeResult.cleanedHistory.length, 1);
    
    const summary = calculateIsolatedDailyCalories(purgeResult.cleanedHistory, { weightKg: 90 }, new Date('2026-11-18T12:00:00Z'));
    assert.equal(summary.dailyCaloriesBurned, 1040);
    assert.equal(summary.completedWorkoutsToday, 1);
    assert.equal(summary.isolatedDailyHistory.length, 1);
    assert.equal(summary.isolatedDailyHistory[0].dateKey, '2026-11-18');
  });

  await runCase('2. Rutina de miércoles realizada el jueves se registra el jueves', () => {
    const workoutOnThursday: CompletedWorkout = {
      id: 'w-wed-on-thu',
      routineId: 'wed-routine',
      routineTitle: 'Piernas (Miércoles atrasado)',
      date: '2026-11-18T18:00:00Z',
      startTime: new Date('2026-11-19T15:00:00Z').getTime(),
      endTime: new Date('2026-11-19T16:15:00Z').getTime(),
      durationSeconds: 4500,
      totalVolumeKg: 8000,
      completedSetsCount: 18,
      caloriesBurned: 950,
      isFinished: true,
      exercisesSummary: [
        { name: 'Sentadilla', sets: 6, maxWeight: 120, maxReps: 8, volumeKg: 5000, muscleGroup: 'Pierna' },
      ],
    };

    const purgeResult = purgeAndSanitizeWorkoutHistory([workoutOnThursday], 90);
    const summary = calculateIsolatedDailyCalories(purgeResult.cleanedHistory, { weightKg: 90 }, new Date('2026-11-19T16:00:00Z'));
    assert.equal(summary.dailyCaloriesBurned, 950);
    assert.equal(summary.isolatedDailyHistory[0].dateKey, '2026-11-19');
  });

  await runCase('3. Rutina adelantada se registra el día que efectivamente se entrena', () => {
    const advancedWorkout: CompletedWorkout = {
      id: 'w-advanced',
      routineId: 'fri-routine',
      routineTitle: 'Fullbody (Viernes adelantado)',
      date: '2026-11-20T18:00:00Z', // scheduled Friday
      startTime: new Date('2026-11-18T09:00:00Z').getTime(), // executed Wednesday
      endTime: new Date('2026-11-18T10:00:00Z').getTime(),
      durationSeconds: 3600,
      totalVolumeKg: 5000,
      completedSetsCount: 12,
      caloriesBurned: 800,
      isFinished: true,
      exercisesSummary: [{ name: 'Dominadas', sets: 4, maxWeight: 0, maxReps: 10, volumeKg: 0, muscleGroup: 'Espalda' }],
    };

    const purgeResult = purgeAndSanitizeWorkoutHistory([advancedWorkout], 90);
    const summary = calculateIsolatedDailyCalories(purgeResult.cleanedHistory, { weightKg: 90 }, new Date('2026-11-18T10:00:00Z'));
    assert.equal(summary.dailyCaloriesBurned, 800);
    assert.equal(summary.isolatedDailyHistory[0].dateKey, '2026-11-18');
  });

  await runCase('4. Dos o más entrenamientos en el mismo día suman calorías sin duplicación', () => {
    const w1: CompletedWorkout = {
      id: 'w-same-1',
      routineId: 'r1',
      routineTitle: 'Mañana Cardio',
      date: '2026-11-18T08:00:00Z',
      startTime: new Date('2026-11-18T08:00:00Z').getTime(),
      endTime: new Date('2026-11-18T09:00:00Z').getTime(),
      durationSeconds: 3600,
      totalVolumeKg: 2000,
      completedSetsCount: 10,
      caloriesBurned: 500,
      isFinished: true,
      exercisesSummary: [{ name: 'Eliptica', sets: 10, volumeKg: 2000, muscleGroup: 'Cardio', maxWeight: 0, maxReps: 0 }],
    };
    const w2: CompletedWorkout = {
      id: 'w-same-2',
      routineId: 'r2',
      routineTitle: 'Tarde Fuerza',
      date: '2026-11-18T18:00:00Z',
      startTime: new Date('2026-11-18T18:00:00Z').getTime(),
      endTime: new Date('2026-11-18T19:00:00Z').getTime(),
      durationSeconds: 3600,
      totalVolumeKg: 6000,
      completedSetsCount: 15,
      caloriesBurned: 700,
      isFinished: true,
      exercisesSummary: [{ name: 'Press militar', sets: 15, volumeKg: 6000, muscleGroup: 'Hombro', maxWeight: 0, maxReps: 0 }],
    };
    const duplicateW1 = { ...w1 }; // Same ID retry

    const purgeResult = purgeAndSanitizeWorkoutHistory([w1, w2, duplicateW1], 90);
    assert.equal(purgeResult.cleanedHistory.length, 2); // Duplicate removed

    const summary = calculateIsolatedDailyCalories(purgeResult.cleanedHistory, { weightKg: 90 }, new Date('2026-11-18T20:00:00Z'));
    assert.equal(summary.dailyCaloriesBurned, 1200); // 500 + 700
    assert.equal(summary.isolatedDailyHistory[0].sessions.length, 2);
  });

  await runCase('5. Respeto de zona horaria local America/Santiago', () => {
    // Late night workout in Santiago (UTC-4), e.g. 23:30 local time on Nov 18
    // In UTC this is 2026-11-19T03:30:00Z. In America/Santiago it is 2026-11-18T23:30:00-04:00
    const lateNightWorkout: CompletedWorkout = {
      id: 'w-santiago-late',
      routineId: 'r1',
      routineTitle: 'Nocturno',
      date: '2026-11-19T03:30:00.000Z',
      startTime: new Date('2026-11-19T03:30:00.000Z').getTime(),
      endTime: new Date('2026-11-19T04:30:00.000Z').getTime(),
      durationSeconds: 3600,
      totalVolumeKg: 4000,
      completedSetsCount: 12,
      caloriesBurned: 600,
      isFinished: true,
      exercisesSummary: [{ name: 'Sentadilla', sets: 12, volumeKg: 4000, muscleGroup: 'Pierna', maxWeight: 0, maxReps: 0 }],
    };

    const dateKey = getLocalDateKey(lateNightWorkout.date);
    assert.ok(dateKey);
  });

  console.log('Resumen Calorie Correction Suite: 5/5 pruebas aprobadas.');
}

runTests();
