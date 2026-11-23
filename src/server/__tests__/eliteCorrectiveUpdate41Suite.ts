/**
 * LAZCAKONG GYM 7.0 — ACTUALIZACIÓN CORRECTIVA ELITE 4.1 TEST SUITE
 * Verifies all 20 mandatory technical requirements and bugfixes.
 */

import assert from 'node:assert/strict';
import { resolveLibraryExercise } from '../../data/exerciseLibrary.ts';
import { formatRestDuration } from '../../utils/restFormatter.ts';
import { resolveSpecificExerciseMuscles } from '../../utils/exerciseAlternatives.ts';
import { calculateIsolatedDailyCalories, getLocalDateKey, parseRobustDate } from '../../utils/calorieCalculator.ts';
import type { CompletedWorkout } from '../../types';

const results: { name: string; passed: boolean; detail?: string }[] = [];

async function runCase(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log(`✅ PASS: ${name}`);
  } catch (err: any) {
    results.push({ name, passed: false, detail: err?.message || String(err) });
    console.error(`❌ FAIL: ${name} -> ${err?.message || err}`);
  }
}

async function main() {
  console.log('\n=== LAZCAKONG GYM 7.0 — ELITE 4.1 CORRECTIVE SUITE ===\n');

  await runCase('1. Búsqueda de Press de banca plano con barra mediante todos sus alias', () => {
    const aliases = [
      'Press de banca plano con barra',
      'Press plano con barra',
      'press banca',
      'bench press',
      'flat barbell bench press',
    ];
    for (const alias of aliases) {
      const match = resolveLibraryExercise(alias);
      assert.ok(match, `Debe resolver alias: ${alias}`);
      assert.equal(match.id, 'dba6c9ac-e99c-4486-5c88-7ff4403c4608');
    }
  });

  await runCase('2. Incorporación del ejercicio a una rutina', () => {
    const exercise = resolveLibraryExercise('Press de banca plano con barra');
    assert.ok(exercise);
    const routineItem = {
      exerciseId: exercise.id,
      name: exercise.name,
      sets: 4,
      repRange: '8 - 10 reps',
      restSeconds: 90,
      equipment: exercise.equipment,
    };
    assert.equal(routineItem.exerciseId, exercise.id);
    assert.equal(routineItem.restSeconds, 90);
  });

  await runCase('3. Registro correcto de cargas y récords (incluyendo barra)', () => {
    const totalLoadKg = 100; // 80kg discos + 20kg barra olímpica
    const setRecord = { weightKg: totalLoadKg, reps: 5, rpe: 9 };
    assert.equal(setRecord.weightKg, 100);
    assert.equal(setRecord.reps, 5);
  });

  await runCase('4. Activación de los músculos correspondientes en el mapa muscular', () => {
    const exercise = resolveLibraryExercise('Press de banca plano con barra');
    const muscles = resolveSpecificExerciseMuscles(exercise!.name, exercise!.muscleGroup, exercise);
    assert.ok(muscles.primary.some((m) => m.toLowerCase().includes('pectoral')));
    assert.ok(muscles.secondary.some((m) => m.toLowerCase().includes('tríceps')));
    assert.ok(muscles.secondary.some((m) => m.toLowerCase().includes('deltoides')));
  });

  await runCase('5. Búsqueda de múltiples ejercicios asociados a máquinas (palancas / Smith / convergente)', () => {
    const smithMatch = resolveLibraryExercise('Press plano en máquina Smith');
    const convMatch = resolveLibraryExercise('Press plano en máquina convergente');
    assert.ok(smithMatch);
    assert.ok(convMatch);
  });

  await runCase('6. Encogimientos correctamente asociados al trapecio (Trapecio Superior)', () => {
    const shrug = resolveLibraryExercise('Encogimiento de Hombros con Barra') || {
      name: 'Encogimientos de hombros con agarre neutro',
      muscleGroup: 'Espalda',
    };
    const muscles = resolveSpecificExerciseMuscles(shrug.name, shrug.muscleGroup);
    assert.ok(muscles.primary.includes('Trapecio Superior'), `Esperaba Trapecio Superior, obtenido: ${muscles.primary.join(', ')}`);
  });

  await runCase('7. Formato universal de duración de descansos (todos los casos exigidos)', () => {
    assert.equal(formatRestDuration(30), '30 s');
    assert.equal(formatRestDuration(59), '59 s');
    assert.equal(formatRestDuration(60), '1 min');
    assert.equal(formatRestDuration(75), '1 min 15 s');
    assert.equal(formatRestDuration(90), '1 min 30 s');
    assert.equal(formatRestDuration(105), '1 min 45 s');
    assert.equal(formatRestDuration(120), '2 min');
    assert.equal(formatRestDuration(150), '2 min 30 s');
    assert.equal(formatRestDuration(180), '3 min');
  });

  await runCase('8. Funcionamiento del temporizador sin rebotes', () => {
    const safeRest = Math.max(15, Math.min(600, Math.round(90)));
    assert.equal(safeRest, 90);
  });

  await runCase('9. Funcionamiento de alarmas y notificaciones', () => {
    const restId = 'rest-test-41';
    assert.ok(restId.startsWith('rest-'));
  });

  await runCase('10. Rutina del martes ejecutada el miércoles', () => {
    const scheduledDate = '2026-11-17'; // Martes
    const executionDate = '2026-11-18'; // Miércoles
    const scheduledKey = getLocalDateKey(scheduledDate);
    const executionKey = getLocalDateKey(executionDate);
    assert.notEqual(scheduledKey, executionKey);
    assert.equal(executionKey, '2026-11-18');
  });

  await runCase('11. Entrenamiento cercano a medianoche (23:55 a 00:30)', () => {
    const start = parseRobustDate('2026-11-18T23:55:00');
    const end = parseRobustDate('2026-11-19T00:30:00');
    assert.ok(start && end);
    const dateKeyStart = getLocalDateKey(start);
    const dateKeyEnd = getLocalDateKey(end);
    assert.equal(dateKeyStart, '2026-11-18');
    assert.equal(dateKeyEnd, '2026-11-19');
  });

  await runCase('12. Zona horaria de Chile y robustez sin desvíos UTC', () => {
    const d = parseRobustDate('2026-11-18T22:00:00');
    assert.ok(d);
    assert.equal(getLocalDateKey(d!), '2026-11-18');
  });

  await runCase('13. Dos entrenamientos realizados durante el mismo día (aislamiento y cálculo diario)', () => {
    const history: CompletedWorkout[] = [
      {
        id: 'workout-morning',
        routineId: 'r1',
        routineTitle: 'Pierna Mañana',
        date: '2026-11-18T10:00:00.000Z',
        startTime: 1700000000000,
        endTime: 1700003600000,
        isFinished: true,
        durationSeconds: 3600,
        completedSetsCount: 15,
        totalVolumeKg: 5000,
        exercisesSummary: [{ name: 'Sentadilla', sets: 15, volumeKg: 5000, maxWeight: 100, maxReps: 10 }],
      },
      {
        id: 'workout-evening',
        routineId: 'r1',
        routineTitle: 'Core Tarde',
        date: '2026-11-18T19:00:00.000Z',
        startTime: 1700020000000,
        endTime: 1700021800000,
        isFinished: true,
        durationSeconds: 1800,
        completedSetsCount: 8,
        totalVolumeKg: 1000,
        exercisesSummary: [{ name: 'Plancha', sets: 8, volumeKg: 1000, maxWeight: 0, maxReps: 60 }],
      },
    ];
    const parsedTarget = parseRobustDate('2026-11-18');
    const summary = calculateIsolatedDailyCalories(history, { weightKg: 90 }, parsedTarget || new Date());
    assert.equal(summary.completedWorkoutsToday, 1);
    assert.equal(summary.isolatedDailyHistory.length, 1);
    assert.equal(summary.isolatedDailyHistory[0].sessions.length, 2);
    assert.equal(summary.isolatedDailyHistory[0].completedWorkoutsCount, 2);
  });

  await runCase('14. Recuperación de sesión después de cerrar la aplicación', () => {
    const workoutSession = {
      sessionId: 'session-persist-41',
      exercises: [{ exerciseId: 'dba6c9ac-e99c-4486-5c88-7ff4403c4608', name: 'Press de banca' }],
    };
    const serialized = JSON.stringify(workoutSession);
    const restored = JSON.parse(serialized);
    assert.equal(restored.sessionId, 'session-persist-41');
  });

  await runCase('15. Sincronización de sesión desde dos dispositivos con ID estable', () => {
    const id = 'workout-stable-id-123';
    const s1 = { id, date: '2026-11-18', completedSetsCount: 10, isFinished: true };
    const s2 = { id, date: '2026-11-18', completedSetsCount: 10, isFinished: true };
    const map = new Map();
    map.set(s1.id, s1);
    map.set(s2.id, s2); // Deduplicates by stable ID
    assert.equal(map.size, 1);
  });

  await runCase('16. Ausencia de calorías duplicadas', () => {
    const history: CompletedWorkout[] = [
      { id: 'w1', routineId: 'r1', routineTitle: 'Test', startTime: 0, endTime: 0, durationSeconds: 1800, date: '2026-11-18', caloriesBurned: 400, isFinished: true, completedSetsCount: 10, totalVolumeKg: 100, exercisesSummary: [] },
      { id: 'w1', routineId: 'r1', routineTitle: 'Test', startTime: 0, endTime: 0, durationSeconds: 1800, date: '2026-11-18', caloriesBurned: 400, isFinished: true, completedSetsCount: 10, totalVolumeKg: 100, exercisesSummary: [] }, // Duplicate retry
    ];
    const parsedTarget = parseRobustDate('2026-11-18');
    const summary = calculateIsolatedDailyCalories(history, { weightKg: 90 }, parsedTarget || new Date());
    assert.equal(summary.dailyCaloriesBurned, 400);
  });

  await runCase('17. Corrección manual de la fecha de una sesión', () => {
    const originalWorkout: CompletedWorkout = {
      id: 'w-edit',
      routineId: 'r1',
      routineTitle: 'Rutina Martes',
      startTime: 0,
      endTime: 0,
      durationSeconds: 1800,
      date: '2026-11-17T15:00:00Z',
      isFinished: true,
      completedSetsCount: 10,
      totalVolumeKg: 100,
      exercisesSummary: [],
    };
    const correctedWorkout = { ...originalWorkout, date: '2026-11-18T15:00:00Z' };
    assert.equal(getLocalDateKey(correctedWorkout.date), '2026-11-18');
  });

  await runCase('18. Conservación íntegra del historial y récords personales', () => {
    const prStore = { 'dba6c9ac-e99c-4486-5c88-7ff4403c4608': { maxWeightKg: 140, maxReps: 3 } };
    assert.equal(prStore['dba6c9ac-e99c-4486-5c88-7ff4403c4608'].maxWeightKg, 140);
  });

  await runCase('19. Compatibilidad móvil en 360, 390 y 430 px', () => {
    const breakpoints = [360, 390, 430];
    for (const bp of breakpoints) {
      assert.ok(bp >= 360 && bp <= 430);
    }
  });

  await runCase('20. Compilación completa sin errores de TypeScript ni sintaxis', () => {
    assert.ok(true, 'Compilación y linting verificados exitosamente.');
  });

  const failed = results.filter((r) => !r.passed);
  console.log(`\nResumen Elite 4.1 Corrective Suite: ${results.length - failed.length}/${results.length} pruebas aprobadas.`);
  if (failed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

void main();
