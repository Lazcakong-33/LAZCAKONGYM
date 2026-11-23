/**
 * LAZCAKONG GYM - MAPA MUSCULAR INTELIGENTE SELECTION & RECOVERY TEST SUITE
 *
 * Verifies:
 * 1. Opening MapaMuscular with Pectoral at 0 h and Cuádriceps recovering (~38 h)
 *    auto-selects Cuádriceps in frontal view.
 * 2. Opening MapaMuscular when a posterior muscle has peak fatigue (e.g. Dorsal Ancho
 *    or Isquiotibiales) auto-selects posterior view and that muscle.
 * 3. ESTADO MUSCULAR recovering muscles list excludes 0 h muscles and orders strictly
 *    descending by remaining recovery time, exposing name, fatigue level, and hours.
 * 4. Badge metadata for a muscle with 0 h returns "Estado" + "Recuperado" instead
 *    of "Fatiga estimada" + "Suficiente".
 * 5. Empty workout history -> "Registra tu primer entrenamiento para ver tu recuperación".
 * 6. Registered workouts with all muscles at 0 h -> "Sin fatiga pendiente según tus registros".
 * 7. MapaMuscularView preserves manual selection across clock ticks / re-renders.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CompletedWorkout } from '../../types/index.ts';
import { computeRealTimeRecovery } from '../../utils/muscleRecoveryEngine.ts';
import {
  formatRecoveryRemainingTime,
  getMuscleFatigueBadgeMeta,
  getMuscleStatusEmptyMessage,
  getRecoveringMusclesSorted,
  resolveMostFatiguedMuscleTarget,
} from '../../utils/muscleMapSelection.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function makeWorkout(
  id: string,
  endTimeMs: number,
  exercises: {
    name: string;
    muscleGroup: string;
    sets: number;
    reps: number;
    weightKg: number;
  }[]
): CompletedWorkout {
  const startTimeMs = endTimeMs - 45 * 60 * 1000;
  const totalVolumeKg = exercises.reduce(
    (sum, ex) => sum + ex.sets * ex.reps * ex.weightKg,
    0
  );
  const completedSetsCount = exercises.reduce((sum, ex) => sum + ex.sets, 0);

  return {
    id,
    profileId: 'test-athlete-map',
    routineId: `routine-${id}`,
    routineTitle: `Sesión ${id}`,
    date: new Date(endTimeMs).toISOString(),
    startTime: startTimeMs,
    endTime: endTimeMs,
    durationSeconds: 45 * 60,
    totalVolumeKg,
    completedSetsCount,
    isFinished: true,
    exercisesSummary: exercises.map((ex, index) => ({
      exerciseId: `${id}-ex-${index}`,
      name: ex.name,
      muscleGroup: ex.muscleGroup,
      sets: ex.sets,
      maxWeight: ex.weightKg,
      maxReps: ex.reps,
      totalReps: ex.sets * ex.reps,
      volumeKg: ex.sets * ex.reps * ex.weightKg,
      setsDetail: Array.from({ length: ex.sets }, (_, sIdx) => ({
        setNumber: sIdx + 1,
        weight: ex.weightKg,
        reps: ex.reps,
        completed: true,
        completedAt: new Date(endTimeMs - (ex.sets - sIdx) * 60000).toISOString(),
      })),
    })),
  };
}

function runSuite() {
  console.log('\n====================================================================');
  console.log('   LAZCAKONG GYM - VERIFICACIÓN MAPA MUSCULAR INTELIGENTE            ');
  console.log('====================================================================\n');

  const now = Date.UTC(2026, 10, 17, 18, 0, 0);

  // -------------------------------------------------------------------------
  // CASO 1: Pectoral con 0 h pendientes y Cuádriceps con fatiga alta (~38 h)
  // -------------------------------------------------------------------------
  console.log('1. Auto-selección con Pectoral 0 h y Cuádriceps ~38 h pendientes:');
  const fourDaysAgo = now - 96 * 3600 * 1000;
  const sixHoursAgo = now - 6 * 3600 * 1000;

  const chestRecoveredSession = makeWorkout('chest-old', fourDaysAgo, [
    { name: 'Press de banca plano', muscleGroup: 'Pecho', sets: 4, reps: 10, weightKg: 80 },
  ]);
  const quadsHeavySession = makeWorkout('quads-heavy', sixHoursAgo, [
    { name: 'Sentadilla libre con barra', muscleGroup: 'Cuádriceps', sets: 4, reps: 8, weightKg: 100 },
    { name: 'Prensa de piernas 45°', muscleGroup: 'Cuádriceps', sets: 4, reps: 10, weightKg: 180 },
  ]);

  const reportCase1 = computeRealTimeRecovery(
    [chestRecoveredSession, quadsHeavySession],
    now,
    [],
    'ALL'
  );

  const chestState = reportCase1.chest_left;
  const quadState = reportCase1.quad_left;
  assert(
    Boolean(chestState.hasHistoricalData) &&
      chestState.remainingHours === 0 &&
      chestState.remainingMinutes === 0,
    `Pectoral tiene datos históricos y 0 h pendientes (${chestState.remainingHours}h ${chestState.remainingMinutes}m)`
  );
  assert(
    Boolean(quadState.hasHistoricalData) && quadState.remainingHours >= 30,
    `Cuádriceps tiene carga reciente en recuperación (${quadState.remainingHours}h ${quadState.remainingMinutes}m)`
  );

  const targetCase1 = resolveMostFatiguedMuscleTarget(reportCase1);
  assert(
    targetCase1 !== null &&
      targetCase1.interactiveId === 'cuadriceps_recto_left' &&
      targetCase1.view === 'frontal',
    `Auto-selección inicial abre Cuádriceps en vista frontal (obtenido: ${targetCase1?.interactiveId} / ${targetCase1?.view})`
  );

  const recoveringCase1 = getRecoveringMusclesSorted(reportCase1);
  assert(recoveringCase1.length > 0, `Lista de músculos en recuperación tiene ${recoveringCase1.length} elementos`);
  assert(
    recoveringCase1[0].canonicalId === 'quadriceps',
    `Primer músculo en recuperación es Cuádriceps (${recoveringCase1[0].name})`
  );
  assert(
    !recoveringCase1.some((m) => m.canonicalId === 'pectoral_major'),
    'Pectoral (0 h pendientes) no aparece en la lista de músculos aún en recuperación'
  );

  // Verificar orden descendente estricto
  let isSortedDesc = true;
  for (let i = 1; i < recoveringCase1.length; i += 1) {
    if (recoveringCase1[i].totalRemainingHours > recoveringCase1[i - 1].totalRemainingHours) {
      isSortedDesc = false;
      break;
    }
  }
  assert(isSortedDesc, 'Músculos en recuperación están ordenados estrictamente de mayor a menor tiempo restante');

  // Verificar badge de músculo recuperado (Pectoral 0 h -> Estado: Recuperado)
  const chestBadge = getMuscleFatigueBadgeMeta(chestState, true);
  assert(
    chestBadge.metricTitle === 'Estado' && chestBadge.label === 'Recuperado',
    `Ficha de Pectoral con 0 h muestra "${chestBadge.metricTitle}: ${chestBadge.label}"`
  );

  const quadBadge = getMuscleFatigueBadgeMeta(quadState, true);
  assert(
    quadBadge.metricTitle === 'Fatiga estimada' && quadBadge.label !== 'Recuperado',
    `Ficha de Cuádriceps en fatiga mantiene "${quadBadge.metricTitle}: ${quadBadge.label}"`
  );

  // -------------------------------------------------------------------------
  // CASO 2: Músculo posterior con mayor fatiga (Dorsal Ancho)
  // -------------------------------------------------------------------------
  console.log('\n2. Auto-selección en vista posterior cuando espalda tiene mayor fatiga:');
  const twoHoursAgo = now - 2 * 3600 * 1000;
  const backHeavySession = makeWorkout('back-heavy', twoHoursAgo, [
    { name: 'Remo con barra', muscleGroup: 'Espalda', sets: 5, reps: 8, weightKg: 90 },
    { name: 'Jalón al pecho en polea', muscleGroup: 'Espalda', sets: 4, reps: 10, weightKg: 75 },
  ]);

  const reportCase2 = computeRealTimeRecovery(
    [chestRecoveredSession, backHeavySession],
    now,
    [],
    'ALL'
  );
  const targetCase2 = resolveMostFatiguedMuscleTarget(reportCase2);
  assert(
    targetCase2 !== null &&
      targetCase2.interactiveId === 'dorsal_ancho_left' &&
      targetCase2.view === 'posterior',
    `Auto-selección abre Dorsal Ancho en vista posterior (obtenido: ${targetCase2?.interactiveId} / ${targetCase2?.view})`
  );

  // -------------------------------------------------------------------------
  // CASO 3: Formato de horas estimadas y etiquetas de fatiga en lista
  // -------------------------------------------------------------------------
  console.log('\n3. Formato de horas estimadas y niveles de fatiga:');
  const recoveringCase2 = getRecoveringMusclesSorted(reportCase2);
  assert(
    recoveringCase2.every(
      (item) =>
        Boolean(item.name) &&
        Boolean(item.fatigueLevelLabel) &&
        formatRecoveryRemainingTime(item.remainingHours, item.remainingMinutes).length > 0
    ),
    'Cada fila de Estado muscular expone nombre, nivel de fatiga y tiempo restante formateado'
  );
  assert(
    formatRecoveryRemainingTime(0, 0) === '0 h' &&
      formatRecoveryRemainingTime(4, 25) === '4h 25m' &&
      formatRecoveryRemainingTime(38, 0) === '38 h',
    'Formateador de tiempo restante produce "0 h", "4h 25m" y "38 h"'
  );

  // -------------------------------------------------------------------------
  // CASO 4: Estados vacíos (sin entrenamientos vs todos en 0 h)
  // -------------------------------------------------------------------------
  console.log('\n4. Mensajes cuando no hay entrenamientos o todos tienen 0 h pendientes:');
  const emptyHistoryReport = computeRealTimeRecovery([], now, [], 'ALL');
  const emptyRecovering = getRecoveringMusclesSorted(emptyHistoryReport);
  const noHistoryMsg = getMuscleStatusEmptyMessage(false, emptyRecovering.length);
  assert(
    noHistoryMsg === 'Registra tu primer entrenamiento para ver tu recuperación',
    `Sin entrenamientos muestra: "${noHistoryMsg}"`
  );

  const allZeroReport = computeRealTimeRecovery([chestRecoveredSession], now, [], 'ALL');
  const allZeroRecovering = getRecoveringMusclesSorted(allZeroReport);
  assert(allZeroRecovering.length === 0, 'Sesión antigua (>72h) produce 0 músculos aún en recuperación');
  const zeroFatigueMsg = getMuscleStatusEmptyMessage(true, allZeroRecovering.length);
  assert(
    zeroFatigueMsg === 'Sin fatiga pendiente según tus registros',
    `Todos con 0 h pendientes muestra: "${zeroFatigueMsg}"`
  );

  // -------------------------------------------------------------------------
  // CASO 5: Verificación de integración y preservación de selección manual en vista
  // -------------------------------------------------------------------------
  console.log('\n5. Integración en MapaMuscularView.tsx:');
  const viewPath = path.resolve(process.cwd(), 'src/views/MapaMuscularView.tsx');
  const viewSource = fs.readFileSync(viewPath, 'utf8');

  assert(
    viewSource.includes('resolveMostFatiguedMuscleTarget'),
    'MapaMuscularView importa y utiliza resolveMostFatiguedMuscleTarget al abrir'
  );
  assert(
    viewSource.includes('hasManualSelectionRef.current = true'),
    'MapaMuscularView marca selección manual al tocar mapa, lista o controles'
  );
  assert(
    viewSource.includes('if (hasManualSelectionRef.current || autoAppliedRef.current || initialSelectedMuscle)'),
    'Efecto de auto-selección respeta la selección manual existente durante la visita'
  );
  assert(
    viewSource.includes('handleSelectRecoveringMuscle'),
    'La lista de Estado muscular llama a handleSelectRecoveringMuscle para actualizar mapa y ficha'
  );
  assert(
    viewSource.includes('{fatigueLevelBadge.metricTitle}'),
    'La ficha muestra el título dinámico ("Estado" vs "Fatiga estimada")'
  );
  assert(
    viewSource.includes('Músculos en recuperación'),
    'Estado muscular incluye la subsección Músculos en recuperación'
  );

  console.log('\n====================================================================');
  console.log('   TODAS LAS PRUEBAS DEL MAPA MUSCULAR PASARON EXITOSAMENTE         ');
  console.log('====================================================================\n');
}

runSuite();
