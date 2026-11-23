/**
 * LAZCAKONG GYM - MUSCLE RECOVERY NOTIFICATIONS VERIFICATION SUITE
 *
 * Verifies:
 * 1. Exact alignment with Mapa Muscular Inteligente calculation & canonical states.
 * 2. First evaluation records baseline without creating notifications.
 * 3. Only transitions from recovering (DESCANSO_RECOMENDADO / RECUPERACION_EN_PROCESO) -> LISTO create alerts.
 * 4. Multiple muscles transitioning to LISTO in the same evaluation are grouped into 1 notification.
 * 5. Reload / repeated evaluations never duplicate alerts and preserve read status.
 * 6. Strict per-athlete isolation in storage.
 * 7. New workout cycle after recovery triggers a fresh alert when recovered again.
 * 8. Single & grouped map navigation target resolution.
 * 9. UI & lifecycle integration (dynamic green dot, visibilitychange/focus/interval checks).
 */

import fs from 'node:fs';
import path from 'node:path';
import { CompletedWorkout } from '../../types/index.ts';
import {
  computeOverallAthleteSummary,
  computeRealTimeRecovery,
} from '../../utils/muscleRecoveryEngine.ts';
import {
  RecoveryNotificationStorageAdapter,
  classifyCanonicalMuscleStatus,
  evaluateMuscleRecoveryNotifications,
  getUnreadRecoveryNotificationCount,
  loadAthleteRecoveryNotificationStore,
  markAllRecoveryNotificationsAsRead,
  markRecoveryNotificationAsRead,
  resolveRecoveryNotificationMapSelection,
} from '../../utils/muscleRecoveryNotifications.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

function createMemoryStorage(): RecoveryNotificationStorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

function makeWorkout(
  id: string,
  profileId: string,
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
    profileId,
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
  console.log('   LAZCAKONG GYM - VERIFICACIÓN AVISOS DE RECUPERACIÓN MUSCULAR     ');
  console.log('====================================================================\n');

  const storage = createMemoryStorage();
  const t0 = Date.UTC(2026, 10, 20, 12, 0, 0);
  const athleteA = 'atleta_camilo_test';
  const athleteB = 'atleta_maria_test';

  // -------------------------------------------------------------------------
  // 1. Primera evaluación: registra estado inicial SIN crear aviso
  // -------------------------------------------------------------------------
  console.log('1. Primera evaluación (baseline sin aviso):');
  const oldChestWorkout = makeWorkout('w-chest-old', athleteA, t0 - 96 * 3600 * 1000, [
    { name: 'Press de banca plano', muscleGroup: 'Pecho', sets: 4, reps: 10, weightKg: 80 },
  ]);
  const freshQuadWorkout = makeWorkout('w-quad-fresh', athleteA, t0 - 2 * 3600 * 1000, [
    { name: 'Extensión de cuádriceps en máquina', muscleGroup: 'Cuádriceps', sets: 6, reps: 10, weightKg: 85 },
  ]);

  const eval1 = evaluateMuscleRecoveryNotifications({
    profileId: athleteA,
    history: [oldChestWorkout, freshQuadWorkout],
    nowMs: t0,
    dailyCheckIn: null,
    storage,
  });

  // Confirmar alineación 1:1 con Mapa Muscular Inteligente
  const directReport = computeRealTimeRecovery(
    [oldChestWorkout, freshQuadWorkout],
    t0,
    [],
    'ALL',
    'ALL',
    { profileId: athleteA, dailyCheckIn: null }
  );
  const directSummary = computeOverallAthleteSummary(
    directReport,
    [oldChestWorkout, freshQuadWorkout],
    t0
  );
  const directQuad = directSummary.readyMuscles
    .concat(directSummary.inRecoveryMuscles)
    .concat(directSummary.highFatigueMuscles)
    .find((m) => m.canonicalId === 'quadriceps');

  assert(
    eval1.createdNotification === null && eval1.store.notifications.length === 0,
    'Primera evaluación registra estados iniciales y NO crea ningún aviso'
  );
  assert(
    eval1.unreadCount === 0,
    'Punto verde permanece oculto (unreadCount === 0) tras la evaluación inicial'
  );
  assert(
    eval1.currentStates.pectoral_major === 'LISTO',
    `Pectoral entrenado hace 96h queda registrado como LISTO (${eval1.currentStates.pectoral_major})`
  );
  assert(
    eval1.currentStates.quadriceps === classifyCanonicalMuscleStatus(directQuad!),
    `Cuádriceps coincide exactamente con el estado del Mapa Muscular (${eval1.currentStates.quadriceps})`
  );
  assert(
    eval1.currentStates.biceps === 'SIN_DATOS',
    `Músculo no entrenado (Bíceps) queda registrado como SIN_DATOS`
  );

  // -------------------------------------------------------------------------
  // 2. Transición parcial (DESCANSO_RECOMENDADO -> RECUPERACION_EN_PROCESO) NO crea aviso
  // -------------------------------------------------------------------------
  console.log('\n2. Transición intermedia dentro de recuperación (sin aviso):');
  const tMid = t0 + 28 * 3600 * 1000;
  const evalMid = evaluateMuscleRecoveryNotifications({
    profileId: athleteA,
    history: [oldChestWorkout, freshQuadWorkout],
    nowMs: tMid,
    dailyCheckIn: null,
    storage,
  });

  assert(
    evalMid.currentStates.quadriceps === 'RECUPERACION_EN_PROCESO' ||
      evalMid.currentStates.quadriceps === 'DESCANSO_RECOMENDADO',
    `Cuádriceps sigue en estado de recuperación a +28h (${evalMid.currentStates.quadriceps})`
  );
  assert(
    evalMid.createdNotification === null && evalMid.unreadCount === 0,
    'Pasar entre estados de recuperación sin llegar a LISTO no genera aviso'
  );

  // -------------------------------------------------------------------------
  // 3. Transición a LISTO crea aviso único y enciende punto verde (unreadCount = 1)
  // -------------------------------------------------------------------------
  console.log('\n3. Transición de recuperación a LISTO:');
  const tReady = t0 + 72 * 3600 * 1000;
  const evalReady = evaluateMuscleRecoveryNotifications({
    profileId: athleteA,
    history: [oldChestWorkout, freshQuadWorkout],
    nowMs: tReady,
    dailyCheckIn: null,
    storage,
  });

  assert(
    evalReady.currentStates.quadriceps === 'LISTO',
    'Cuádriceps alcanza estado LISTO tras completar su recuperación'
  );
  assert(
    evalReady.createdNotification !== null,
    `Se crea aviso al pasar a LISTO: "${evalReady.createdNotification?.title}"`
  );
  assert(
    evalReady.createdNotification!.muscles.some((m) => m.canonicalId === 'quadriceps'),
    'El aviso incluye Cuádriceps como músculo recuperado'
  );
  assert(
    !evalReady.createdNotification!.muscles.some((m) => m.canonicalId === 'pectoral_major'),
    'Pectoral (que ya estaba LISTO) no se incluye falsamente en el aviso'
  );
  assert(
    evalReady.unreadCount === 1,
    'Contador de no leídos sube a 1 (punto verde activo)'
  );

  // -------------------------------------------------------------------------
  // 4. Recarga / re-evaluación repetida NO duplica el aviso
  // -------------------------------------------------------------------------
  console.log('\n4. Persistencia y no duplicación al recargar:');
  const evalReload1 = evaluateMuscleRecoveryNotifications({
    profileId: athleteA,
    history: [oldChestWorkout, freshQuadWorkout],
    nowMs: tReady + 60_000,
    dailyCheckIn: null,
    storage,
  });
  const evalReload2 = evaluateMuscleRecoveryNotifications({
    profileId: athleteA,
    history: [oldChestWorkout, freshQuadWorkout],
    nowMs: tReady + 3600_000,
    dailyCheckIn: null,
    storage,
  });

  assert(
    evalReload1.createdNotification === null &&
      evalReload2.createdNotification === null &&
      evalReload2.store.notifications.length === 1,
    'Re-evaluar al recargar o con la app abierta NO duplica el aviso'
  );

  // -------------------------------------------------------------------------
  // 5. Lectura de aviso apaga el punto verde y persiste al recargar
  // -------------------------------------------------------------------------
  console.log('\n5. Lectura de aviso y persistencia del estado leído:');
  const firstNotifId = evalReady.createdNotification!.id;
  const afterRead = markRecoveryNotificationAsRead(athleteA, firstNotifId, tReady + 120_000, storage);
  assert(
    getUnreadRecoveryNotificationCount(afterRead.notifications) === 0 &&
      afterRead.notifications[0].read === true,
    'Al tocar/leer el aviso queda marcado como leído y el punto verde se apaga (unreadCount === 0)'
  );

  const reloadedStore = loadAthleteRecoveryNotificationStore(athleteA, storage);
  assert(
    reloadedStore.notifications.length === 1 &&
      reloadedStore.notifications[0].read === true,
    'El estado de lectura persiste tras recargar'
  );

  // -------------------------------------------------------------------------
  // 6. Agrupación de múltiples músculos listos en la misma revisión + nuevo ciclo
  // -------------------------------------------------------------------------
  console.log('\n6. Agrupación en un solo aviso y nuevo ciclo de entrenamiento:');
  const tNewSession = tReady + 4 * 3600 * 1000;
  const upperPushPullSession = makeWorkout('w-upper-multi', athleteA, tNewSession, [
    { name: 'Press de banca plano', muscleGroup: 'Pecho', sets: 5, reps: 8, weightKg: 90 },
    { name: 'Remo con barra', muscleGroup: 'Espalda', sets: 5, reps: 8, weightKg: 95 },
    { name: 'Curl de bíceps con barra', muscleGroup: 'Bíceps', sets: 4, reps: 10, weightKg: 40 },
  ]);

  const evalPostSession = evaluateMuscleRecoveryNotifications({
    profileId: athleteA,
    history: [oldChestWorkout, freshQuadWorkout, upperPushPullSession],
    nowMs: tNewSession + 2 * 3600 * 1000,
    dailyCheckIn: null,
    storage,
  });

  assert(
    evalPostSession.createdNotification === null,
    'Entrenar nuevos músculos y pasarlos a fatiga NO crea avisos'
  );
  assert(
    evalPostSession.currentStates.pectoral_major !== 'LISTO' &&
      evalPostSession.currentStates.latissimus_dorsi !== 'LISTO',
    `Pectoral (${evalPostSession.currentStates.pectoral_major}) y Dorsal (${evalPostSession.currentStates.latissimus_dorsi}) pasan a estado de recuperación`
  );

  // Avanzar tiempo hasta que todos los grupos de la sesión estén LISTO simultáneamente
  const tAllMultiReady = tNewSession + 96 * 3600 * 1000;
  const evalGrouped = evaluateMuscleRecoveryNotifications({
    profileId: athleteA,
    history: [oldChestWorkout, freshQuadWorkout, upperPushPullSession],
    nowMs: tAllMultiReady,
    dailyCheckIn: null,
    storage,
  });

  assert(
    evalGrouped.createdNotification !== null &&
      evalGrouped.createdNotification.muscles.length >= 2,
    `Múltiples músculos listos en la misma revisión se agrupan en 1 aviso (${evalGrouped.createdNotification?.muscles.length} grupos: "${evalGrouped.createdNotification?.title}")`
  );
  assert(
    evalGrouped.store.notifications.length === 2 && evalGrouped.unreadCount === 1,
    'Ahora hay 2 avisos guardados (1 leído anterior + 1 agrupado nuevo sin leer)'
  );

  const groupedSelection = resolveRecoveryNotificationMapSelection(
    evalGrouped.createdNotification!.muscles
  );
  assert(
    groupedSelection !== null && groupedSelection.isMultiSelect === true,
    `Al tocar un aviso agrupado el mapa activa selección múltiple (${groupedSelection?.primaryView} / ${groupedSelection?.primaryInteractiveId})`
  );

  const afterMarkAll = markAllRecoveryNotificationsAsRead(athleteA, tAllMultiReady + 5000, storage);
  assert(
    getUnreadRecoveryNotificationCount(afterMarkAll.notifications) === 0,
    'Marcar todo como leído limpia todos los pendientes'
  );

  // -------------------------------------------------------------------------
  // 7. Aislamiento estricto por atleta
  // -------------------------------------------------------------------------
  console.log('\n7. Aislamiento por atleta:');
  const evalAthleteB = evaluateMuscleRecoveryNotifications({
    profileId: athleteB,
    history: [],
    nowMs: tAllMultiReady,
    dailyCheckIn: null,
    storage,
  });

  assert(
    evalAthleteB.store.notifications.length === 0 && evalAthleteB.unreadCount === 0,
    'Atleta B no ve ninguno de los avisos ni estados guardados de Atleta A'
  );
  assert(
    loadAthleteRecoveryNotificationStore(athleteA, storage).notifications.length === 2,
    'Atleta A conserva intactos sus 2 avisos al cambiar de atleta'
  );

  // -------------------------------------------------------------------------
  // 8. Verificación de integración UI y ciclo de vida en el código fuente
  // -------------------------------------------------------------------------
  console.log('\n8. Integración UI (campana, punto verde dinámico, ciclo de vida y mapa):');
  const mapSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/views/MapaMuscularView.tsx'),
    'utf8'
  );
  const todaySource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/views/TodayView.tsx'),
    'utf8'
  );
  const hookSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/hooks/useMuscleRecoveryNotifications.ts'),
    'utf8'
  );
  const appSource = fs.readFileSync(
    path.resolve(process.cwd(), 'src/App.tsx'),
    'utf8'
  );

  assert(
    mapSource.includes('unreadRecoveryCount > 0') &&
      mapSource.includes('data-testid="recovery-bell-dot"') &&
      todaySource.includes('unreadRecoveryCount > 0') &&
      todaySource.includes('data-testid="recovery-bell-dot"'),
    'El punto verde de la campana es dinámico y solo aparece cuando unreadRecoveryCount > 0'
  );
  assert(
    hookSource.includes("document.addEventListener('visibilitychange'") &&
      hookSource.includes("window.addEventListener('focus'") &&
      hookSource.includes('window.setInterval'),
    'El hook revisa cambios al abrir, volver a la app (visibilitychange/focus) y mientras está abierta (intervalo)'
  );
  assert(
    appSource.includes('handleSelectRecoveryNotification') &&
      appSource.includes("setCurrentTab('mapa-muscular')") &&
      mapSource.includes('focusedRecoveredMuscles'),
    'Al tocar un aviso se marca leído, abre el Mapa Muscular y muestra los músculos recuperados'
  );

  console.log('\n====================================================================');
  console.log('   TODAS LAS PRUEBAS DE AVISOS DE RECUPERACIÓN PASARON CON ÉXITO    ');
  console.log('====================================================================\n');
}

runSuite();
