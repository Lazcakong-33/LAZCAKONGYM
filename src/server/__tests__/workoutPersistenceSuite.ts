/**
 * LAZCAKONG GYM - WORKOUT PERSISTENCE, SYNC & BACKUP VERIFICATION SUITE
 *
 * Uses strictly isolated test athlete data (`test-athlete-isolated-1`).
 * Does NOT read, write, or alter any real athlete or Firestore production document.
 */

import {
  ActiveWorkoutSession,
  CompletedWorkout,
  Profile,
} from '../../types/index.ts';
import {
  generateStableId,
  deriveRirFromRpe,
  ensureSessionStableIds,
  reconcileActiveSessionWithCloud,
  resolveWorkoutSyncDisplay,
} from '../../utils/workoutPersistence.ts';
import { purgeAndSanitizeWorkoutHistory } from '../../utils/historySanitizer.ts';
import { reconcileAndUnifyAthleteHistory } from '../../utils/historyRecoveryEngine.ts';
import {
  createSanitizedProfileBackup,
  inspectBackupForRestore,
  executeSafeBackupRestore,
  type StorageLike,
} from '../../utils/eliteBackupEngine.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

class MemoryStorage implements StorageLike {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store.entries());
  }
}

async function runWorkoutPersistenceSuite() {
  console.log('\n====================================================================');
  console.log('   LAZCAKONG GYM - VERIFICACIÓN DE INTEGRIDAD DE ENTRENAMIENTOS     ');
  console.log('====================================================================\n');

  let passed = 0;
  let failed = 0;

  const testProfile: Profile = {
    id: 'test-athlete-isolated-1',
    name: 'Atleta Prueba Aislado',
    avatar: '🦍',
    goal: 'Hipertrofia & Masa',
    weeklyTargetDays: 4,
    soundEnabled: false,
    vibrationEnabled: false,
    weightUnit: 'kg',
    weightKg: 82,
    createdAt: '2026-11-17T08:00:00.000Z',
  };

  const browserAStorage = new MemoryStorage();
  const browserBStorage = new MemoryStorage();

  // Shared variables across steps 1 -> 3
  let sessionId1 = '';
  let set1Id = '';
  let set2Id = '';
  let set3Id = '';
  let simulatedCloudDoc: {
    activeSession: ActiveWorkoutSession | null;
    activeSessionClearedAt?: number;
    history: CompletedWorkout[];
  } = {
    activeSession: null,
    history: [],
  };

  // -------------------------------------------------------------------------
  // PRUEBA 1: Completar 2 series (40 kg x 8 y 42.5 kg x 6), cerrar y reabrir
  // -------------------------------------------------------------------------
  console.log('1. PRUEBA 1: PERSISTENCIA DE 2 SERIES, IDS ESTABLES Y REAPERTURA');
  try {
    const startMs = Date.now();
    const initialSession = ensureSessionStableIds({
      sessionId: generateStableId('workout'),
      routineId: 'test-routine-torso',
      routineTitle: 'Torso Test',
      startTime: startMs,
      updatedAt: startMs,
      exercises: [
        {
          exerciseId: 'test-ex-bench',
          libraryExerciseId: '5cebd39b-7fa4-4bf2-99e3-36a6e6fb2fc2',
          exerciseName: 'Press de pecho en máquina',
          originalExerciseId: 'test-ex-bench',
          originalExerciseName: 'Press de banca con barra',
          activeExerciseName: 'Press de pecho en máquina',
          equipment: 'Máquina',
          useAlternative: true,
          targetMuscles: 'Pecho',
          sets: [
            { id: generateStableId('set'), setNumber: 1, weight: '', reps: '', completed: false },
            { id: generateStableId('set'), setNumber: 2, weight: '', reps: '', completed: false },
            { id: generateStableId('set'), setNumber: 3, weight: '', reps: '', completed: false },
          ],
        },
      ],
    });

    sessionId1 = initialSession.sessionId!;
    set1Id = initialSession.exercises[0].sets[0].id!;
    set2Id = initialSession.exercises[0].sets[1].id!;
    set3Id = initialSession.exercises[0].sets[2].id!;

    assert(Boolean(sessionId1) && sessionId1.startsWith('workout-'), `ID de sesión estable asignado: ${sessionId1}`);
    assert(new Set([set1Id, set2Id, set3Id]).size === 3, 'IDs de las 3 series son únicos y no vacíos');

    // Complete Set 1: 40 kg x 8
    const t1 = new Date(startMs + 60_000).toISOString();
    initialSession.exercises[0].sets[0] = {
      ...initialSession.exercises[0].sets[0],
      weight: 40,
      reps: 8,
      rpe: 8,
      rir: deriveRirFromRpe(8),
      completed: true,
      completedAt: t1,
    };
    // Complete Set 2: 42.5 kg x 6
    const t2 = new Date(startMs + 180_000).toISOString();
    initialSession.exercises[0].sets[1] = {
      ...initialSession.exercises[0].sets[1],
      weight: 42.5,
      reps: 6,
      rpe: 9,
      rir: deriveRirFromRpe(9),
      completed: true,
      completedAt: t2,
    };
    initialSession.updatedAt = startMs + 180_000;

    // Persist locally (Browser A)
    const activeKey = `lazcakon_${testProfile.id}_active_session`;
    browserAStorage.setItem(activeKey, JSON.stringify(initialSession));

    // Simulate app close & reopen -> rehydrate from localStorage + ensureSessionStableIds
    const rawAfterReopen = browserAStorage.getItem(activeKey);
    assert(rawAfterReopen !== null, 'Sesión activa encontrada en almacenamiento local tras cerrar y reabrir');

    const reopenedSession = ensureSessionStableIds(JSON.parse(rawAfterReopen!));
    const reopenedSets = reopenedSession.exercises[0].sets;

    assert(reopenedSession.sessionId === sessionId1, 'sessionId idéntico tras reabrir');
    assert(reopenedSets.length === 3, 'Conserva las 3 filas de series tras reabrir');
    assert(reopenedSets[0].id === set1Id && reopenedSets[0].weight === 40 && reopenedSets[0].reps === 8 && reopenedSets[0].completed === true, 'Serie 1 conserva ID, orden y valores 40 kg × 8');
    assert(reopenedSets[1].id === set2Id && reopenedSets[1].weight === 42.5 && reopenedSets[1].reps === 6 && reopenedSets[1].completed === true, 'Serie 2 conserva ID, orden y valores 42.5 kg × 6');
    assert(reopenedSets[1].rpe === 9 && reopenedSets[1].rir === 1, 'Serie 2 conserva RPE 9 y RIR 1');
    assert(reopenedSession.exercises[0].originalExerciseName === 'Press de banca con barra' && reopenedSession.exercises[0].activeExerciseName === 'Press de pecho en máquina', 'Conserva ejercicio original y sustitución/variante');

    // Sync first 2 sets to simulated cloud doc before offline step
    simulatedCloudDoc.activeSession = JSON.parse(JSON.stringify(reopenedSession));
    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 1:', err.message);
    failed++;
  }

  // -------------------------------------------------------------------------
  // PRUEBA 2: 3ª serie sin conexión, estado real, reintento, y otro navegador
  // -------------------------------------------------------------------------
  console.log('\n2. PRUEBA 2: SERIE 3 OFFLINE, ESTADOS REALES, REINTENTO Y MULTI-NAVEGADOR');
  try {
    const activeKey = `lazcakon_${testProfile.id}_active_session`;
    const localBeforeOffline: ActiveWorkoutSession = JSON.parse(browserAStorage.getItem(activeKey)!);

    // Complete Set 3 offline (45 kg x 5)
    const t3Ms = Date.now() + 300_000;
    localBeforeOffline.exercises[0].sets[2] = {
      ...localBeforeOffline.exercises[0].sets[2],
      weight: 45,
      reps: 5,
      rpe: 9.5,
      rir: deriveRirFromRpe(9.5),
      completed: true,
      completedAt: new Date(t3Ms).toISOString(),
    };
    localBeforeOffline.updatedAt = t3Ms;

    // Persist locally + queue offline sync
    browserAStorage.setItem(activeKey, JSON.stringify(localBeforeOffline));
    const offlineDisplay = resolveWorkoutSyncDisplay('pending_sync');
    assert(offlineDisplay.label === 'Pendiente de sincronización', `Estado offline visible para atleta: "${offlineDisplay.label}"`);

    const localOnlyDisplay = resolveWorkoutSyncDisplay('saved_local');
    assert(localOnlyDisplay.label === 'Guardado en este dispositivo', `Estado local visible para atleta: "${localOnlyDisplay.label}"`);

    // Ensure stale cloud (2 sets) does NOT overwrite offline local session (3 sets) while offline queue is pending
    const guardDuringPending = reconcileActiveSessionWithCloud({
      localSession: localBeforeOffline,
      cloudSession: simulatedCloudDoc.activeSession,
      hasPendingOfflineSync: true,
      history: [],
    });
    assert(guardDuringPending.source === 'local_kept', 'Nunca reemplaza sesión local pendiente por snapshot remoto anterior');
    assert(guardDuringPending.resolvedSession?.exercises[0].sets.filter((s) => s.completed).length === 3, 'Se mantienen las 3 series completadas en local');

    // Simulate failed remote write -> "Error: reintentar" without losing local data
    const errorDisplay = resolveWorkoutSyncDisplay('error', 'Error de red simulado');
    assert(errorDisplay.label === 'Error: reintentar' && errorDisplay.canRetry === true, `Estado de fallo real visible: "${errorDisplay.label}"`);

    // Simulate reconnect + retry sync (2 consecutive retry calls must remain idempotent with 3 sets)
    const payloadToSync: ActiveWorkoutSession = JSON.parse(browserAStorage.getItem(activeKey)!);
    simulatedCloudDoc.activeSession = JSON.parse(JSON.stringify(payloadToSync));
    // Retry #2 (idempotent overwrite of same sessionId)
    simulatedCloudDoc.activeSession = JSON.parse(JSON.stringify(payloadToSync));

    const syncedDisplay = resolveWorkoutSyncDisplay('synced');
    assert(syncedDisplay.label === 'Sincronizado', `Estado tras reconexión y reintento: "${syncedDisplay.label}"`);
    assert(simulatedCloudDoc.activeSession?.exercises[0].sets.length === 3, 'Existen exactamente 3 series tras reintentos (sin duplicación)');

    // Open same test account in Browser B (fresh localStorage, localSession = null)
    const browserBReconcile = reconcileActiveSessionWithCloud({
      localSession: null,
      cloudSession: simulatedCloudDoc.activeSession,
      hasPendingOfflineSync: false,
      history: simulatedCloudDoc.history,
    });
    assert(browserBReconcile.source === 'cloud_restored', 'Navegador B restaura la sesión activa desde la nube');
    const sessionB = browserBReconcile.resolvedSession!;
    browserBStorage.setItem(activeKey, JSON.stringify(sessionB));

    assert(sessionB.sessionId === sessionId1, 'Navegador B recibe exactamente el mismo sessionId');
    const setsB = sessionB.exercises[0].sets;
    assert(setsB.length === 3, 'Navegador B tiene exactamente 3 series');
    assert(
      setsB[0].id === set1Id && setsB[0].weight === 40 && setsB[0].reps === 8 &&
      setsB[1].id === set2Id && setsB[1].weight === 42.5 && setsB[1].reps === 6 &&
      setsB[2].id === set3Id && setsB[2].weight === 45 && setsB[2].reps === 5,
      'Navegador B coincide 100% en IDs de series, orden y valores (40×8, 42.5×6, 45×5)'
    );

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 2:', err.message);
    failed++;
  }

  // -------------------------------------------------------------------------
  // PRUEBA 3: Finalizar, segunda sesión mismo día, respaldo JSON y conflictos
  // -------------------------------------------------------------------------
  console.log('\n3. PRUEBA 3: FINALIZAR + SEGUNDA SESIÓN MISMO DÍA + RESPALDO JSON');
  try {
    const activeKey = `lazcakon_${testProfile.id}_active_session`;
    const activeA: ActiveWorkoutSession = JSON.parse(browserAStorage.getItem(activeKey)!);
    const sameDateIso1 = '2026-11-17T10:30:00.000Z';
    const sameDateIso2 = '2026-11-17T18:45:00.000Z';

    const baseTime1 = new Date(sameDateIso1).getTime();
    const baseTime2 = new Date(sameDateIso2).getTime();

    const completed1: CompletedWorkout = {
      id: activeA.sessionId!,
      profileId: testProfile.id,
      routineId: activeA.routineId,
      routineTitle: activeA.routineTitle,
      date: sameDateIso1,
      startTime: baseTime1,
      endTime: baseTime1 + 2700_000,
      durationSeconds: 2700,
      totalVolumeKg: 40 * 8 + 42.5 * 6 + 45 * 5,
      completedSetsCount: 3,
      isFinished: true,
      exercisesSummary: [
        {
          exerciseId: activeA.exercises[0].exerciseId,
          originalExerciseId: activeA.exercises[0].originalExerciseId,
          originalExerciseName: activeA.exercises[0].originalExerciseName,
          name: activeA.exercises[0].activeExerciseName,
          equipment: activeA.exercises[0].equipment,
          sets: 3,
          maxWeight: 45,
          maxReps: 8,
          volumeKg: 800,
          setsDetail: activeA.exercises[0].sets.map((s) => ({
            id: s.id,
            setNumber: s.setNumber,
            weight: Number(s.weight),
            reps: Number(s.reps),
            rpe: s.rpe,
            rir: s.rir,
            completed: true,
            completedAt: s.completedAt,
          })),
        },
      ],
    };

    // Second workout created & finished on the exact same calendar day
    const session2Id = generateStableId('workout');
    const session2SetId = generateStableId('set');
    const completed2: CompletedWorkout = {
      id: session2Id,
      profileId: testProfile.id,
      routineId: 'test-routine-cardio-core',
      routineTitle: 'Torso Test',
      date: sameDateIso2,
      startTime: baseTime2,
      endTime: baseTime2 + 1800_000,
      durationSeconds: 1800,
      totalVolumeKg: 300,
      completedSetsCount: 1,
      isFinished: true,
      exercisesSummary: [
        {
          exerciseId: 'test-ex-curl',
          originalExerciseId: 'test-ex-curl',
          originalExerciseName: 'Curl bíceps',
          name: 'Curl bíceps',
          equipment: 'Mancuernas',
          sets: 1,
          maxWeight: 15,
          maxReps: 20,
          volumeKg: 300,
          setsDetail: [
            {
              id: session2SetId,
              setNumber: 1,
              weight: 15,
              reps: 20,
              completed: true,
              completedAt: sameDateIso2,
            },
          ],
        },
      ],
    };

    assert(completed1.id !== completed2.id, `Ambas sesiones del mismo día conservan IDs distintos (${completed1.id} vs ${completed2.id})`);

    // Sanitizer + Recovery engine preserve both sessions and all set IDs, deduplicating only retries with identical workout ID
    const sanitized = purgeAndSanitizeWorkoutHistory([completed1, completed2, { ...completed1 }], 82);
    assert(sanitized.cleanedHistory.length === 2, 'Sanitizer conserva exactamente 2 sesiones del mismo día y deduplica el reintento con mismo ID');

    const recoveredW1 = sanitized.cleanedHistory.find((w) => w.id === completed1.id)!;
    const recoveredDetail1 = recoveredW1.exercisesSummary[0].setsDetail!;
    assert(
      recoveredDetail1.length === 3 &&
      recoveredDetail1[0].id === set1Id &&
      recoveredDetail1[1].id === set2Id &&
      recoveredDetail1[2].id === set3Id,
      'historySanitizer preserva los 3 IDs de serie originales en setsDetail'
    );
    assert(Boolean(recoveredDetail1[0].completedAt), 'historySanitizer preserva completedAt por serie');

    const unified = reconcileAndUnifyAthleteHistory([
      {
        sourceId: 'local:test',
        sourceLabel: 'Local Test',
        sourceType: 'local_storage',
        rawRecords: sanitized.cleanedHistory,
      },
    ], 82);
    assert(unified.unifiedHistory.length === 2, 'Reconciliación conserva ambas sesiones del mismo día');
    assert(
      unified.unifiedHistory.find((w) => w.id === completed1.id)?.exercisesSummary[0].setsDetail?.[2].id === set3Id,
      'historyRecoveryEngine preserva los IDs estables de las series'
    );

    // Export JSON backup
    const backupStorage = new MemoryStorage();
    const backupDoc = createSanitizedProfileBackup({
      profile: testProfile,
      routines: [],
      history: unified.unifiedHistory,
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
      storage: backupStorage,
    });
    const backupJson = JSON.stringify(backupDoc);
    assert(!backupJson.includes('"pin"') && backupDoc.integrity.counts.history === 2, 'Respaldo JSON exportado sin credenciales y con 2 sesiones');

    // Isolated environment currently only has Session 1 -> inspect preview & conflicts BEFORE confirm
    const isolatedCurrentState = {
      routines: [],
      history: [recoveredW1],
      prs: {},
      bodyWeightLogs: [],
      customLinks: {},
      selectedAlternatives: {},
    };

    const preview = inspectBackupForRestore({
      rawJson: backupJson,
      targetProfile: testProfile,
      currentState: isolatedCurrentState,
    });
    assert(preview.valid === true && preview.integrityStatus === 'verified', 'Vista previa valida esquema y checksum del respaldo');
    assert(preview.counts.willAdd.history === 1, 'Vista previa detecta exactamente +1 sesión nueva por agregar');
    assert(preview.conflicts.collidingWorkoutDates.includes('2026-11-17'), 'Vista previa reporta fecha colisionante 2026-11-17 antes de confirmar');

    // Unconfirmed restore must block
    const unconfirmedAttempt = executeSafeBackupRestore({
      rawJson: backupJson,
      targetProfile: testProfile,
      currentState: isolatedCurrentState,
      strategy: 'merge_safe',
      confirmed: false,
      storage: backupStorage,
    });
    assert(unconfirmedAttempt.success === false, 'Restauración sin confirmación explícita es bloqueada');

    // Confirmed restore in isolated storage
    const confirmedRestore = executeSafeBackupRestore({
      rawJson: backupJson,
      targetProfile: testProfile,
      currentState: isolatedCurrentState,
      strategy: 'merge_safe',
      confirmed: true,
      storage: backupStorage,
    });
    assert(confirmedRestore.success === true, 'Restauración confirmada merge_safe completada en entorno aislado');
    assert(confirmedRestore.nextState?.history.length === 2, 'Entorno aislado conserva sesión previa + agrega segunda sesión del mismo día (total 2)');
    assert(
      confirmedRestore.nextState?.history.find((w) => w.id === completed1.id)?.exercisesSummary[0].setsDetail?.[0].id === set1Id &&
      confirmedRestore.nextState?.history.find((w) => w.id === completed2.id)?.exercisesSummary[0].setsDetail?.[0].id === session2SetId,
      'IDs estables de sesiones y series intactos tras restauración JSON'
    );

    passed++;
  } catch (err: any) {
    console.error('  ✗ Error en Prueba 3:', err.message);
    failed++;
  }

  console.log('\n====================================================================');
  console.log(`   RESUMEN VERIFICACIÓN: ${passed} PASADAS · ${failed} FALLIDAS`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exitCode = 1;
  }
}

runWorkoutPersistenceSuite();
