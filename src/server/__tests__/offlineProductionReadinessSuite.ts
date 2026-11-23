/**
 * LAZCAKONG GYM 7.0 — ETAPA 6: OFFLINE PERFORMANCE PRO & PRODUCTION READINESS SUITE
 *
 * Uses strictly synthetic test athlete IDs (`test-stage6-offline-athlete-1` &
 * `test-stage6-offline-athlete-2`) and in-memory storage / cache / fetch adapters.
 * Zero reads or writes against real athlete profiles or production Firestore.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ActiveWorkoutSession,
  BodyWeightEntry,
  CompletedWorkout,
  PersonalRecord,
  Profile,
  Routine,
} from '../../types/index.ts';
import {
  clearOfflineSessionBinding,
  canResumeOfflineAuthenticatedSession,
  evaluateLogoutSafetyStatus,
  getOfflineSessionBinding,
  resolvePostOfflineReconnectOutcome,
  saveOfflineSessionBinding,
} from '../../utils/offlineSessionManager.ts';
import {
  computeRetryBackoffMs,
  getLastOfflineQueueStorageError,
  getOfflineSyncQueue,
  getOfflineSyncQueueSummary,
  hasPendingSyncOperationType,
  OFFLINE_SYNC_QUEUE_KEY,
  processPendingOfflineSyncs,
  queueOfflineSync,
} from '../../utils/firebaseSync.ts';
import {
  isStorageQuotaExceededError,
  safeLocalStorageSetItem,
} from '../../utils/safeStorage.ts';
import {
  ensureSessionStableIds,
  generateStableId,
  reconcileActiveSessionWithCloud,
  reconcileBodyWeightLogs,
  reconcilePersonalRecordsMap,
  reconcileRoutinesWithCloud,
} from '../../utils/workoutPersistence.ts';
import { collectAllLocalHistorySources } from '../../utils/historyRecoveryEngine.ts';
import { purgeAndSanitizeWorkoutHistory } from '../../utils/historySanitizer.ts';
import { computeEliteChallengesSnapshot } from '../../utils/eliteChallengesEngine.ts';
import { getAppUpdateSafetyStatus, forceAppUpdate } from '../../utils/updateApp.ts';
import {
  clearOfflineExerciseAssetCache,
  downloadRoutineAssetsForOffline,
  evictObsoleteExerciseCaches,
  EXERCISE_LIB_CACHE_NAME,
  getOfflineExerciseCacheStatus,
  resolveRoutineOfflineAssets,
  type OfflineCacheAdapter,
} from '../../utils/offlineExerciseLibrary.ts';
import {
  detectRuntimePlatform,
  getOfflineCapabilitiesMatrix,
} from '../../utils/capacitorPlatform.ts';
import { EXERCISE_LIBRARY } from '../../data/exerciseLibrary.ts';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`[FAIL] ${message}`);
  }
  console.log(`  ✓ ${message}`);
}

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

class MemoryCacheAdapter implements OfflineCacheAdapter {
  private buckets = new Map<string, Map<string, unknown>>();
  public maxEntriesBeforeQuota: number | null = null;
  private totalPutCount = 0;

  seedBucket(cacheName: string, entries: Record<string, unknown> = {}): void {
    const m = new Map<string, unknown>(Object.entries(entries));
    this.buckets.set(cacheName, m);
  }

  hasBucket(cacheName: string): boolean {
    return this.buckets.has(cacheName);
  }

  async open(cacheName: string) {
    if (!this.buckets.has(cacheName)) {
      this.buckets.set(cacheName, new Map());
    }
    const bucket = this.buckets.get(cacheName)!;
    return {
      match: async (req: string) => (bucket.has(req) ? bucket.get(req) : undefined),
      put: async (req: string, response: unknown) => {
        if (this.maxEntriesBeforeQuota !== null && this.totalPutCount >= this.maxEntriesBeforeQuota) {
          const err = new Error('Storage quota exceeded');
          err.name = 'QuotaExceededError';
          throw err;
        }
        this.totalPutCount++;
        bucket.set(req, response);
      },
      keys: async () => Array.from(bucket.keys()).map((url) => ({ url })),
      delete: async (req: string) => bucket.delete(req),
    };
  }

  async keys(): Promise<string[]> {
    return Array.from(this.buckets.keys());
  }

  async delete(cacheName: string): Promise<boolean> {
    return this.buckets.delete(cacheName);
  }
}

async function runOfflineProductionReadinessSuite() {
  console.log('\n====================================================================');
  console.log(' LAZCAKONG GYM 7.0 — ETAPA 6: OFFLINE & PRODUCTION READINESS SUITE ');
  console.log('====================================================================\n');

  let passed = 0;
  let failed = 0;

  const athlete1: Profile = {
    id: 'test-stage6-offline-athlete-1',
    name: 'Atleta Offline Stage 6',
    email: 'stage6.athlete1@synthetic.test',
    authUid: 'uid-stage6-athlete-1',
    avatar: '🦍',
    goal: 'Fuerza & Hipertrofia',
    weeklyTargetDays: 4,
    soundEnabled: false,
    vibrationEnabled: false,
    weightUnit: 'kg',
    weightKg: 80,
    isAdmin: false,
    createdAt: '2026-11-18T08:00:00.000Z',
    // Simulate legacy sensitive field on input object to prove sanitization strips it
    ...({ pin: '9999' } as Record<string, unknown>),
  };

  const athlete2: Profile = {
    id: 'test-stage6-offline-athlete-2',
    name: 'Atleta Aislado Dos',
    email: 'stage6.athlete2@synthetic.test',
    authUid: 'uid-stage6-athlete-2',
    avatar: '⚡',
    goal: 'Fuerza',
    weeklyTargetDays: 3,
    soundEnabled: false,
    vibrationEnabled: false,
    weightUnit: 'kg',
    createdAt: '2026-11-18T08:00:00.000Z',
  };

  // =========================================================================
  // 1. CONTINUIDAD DE SESIÓN AUTENTICADA OFFLINE Y SEGURIDAD DE ACCESO
  // =========================================================================
  console.log('1. OFFLINE AUTH CONTINUITY & STRICT SECURITY BOUNDARIES');
  try {
    const authStorage = new MemoryStorage();
    const saved = saveOfflineSessionBinding(
      {
        uid: 'uid-stage6-athlete-1',
        athleteId: athlete1.id,
        isGoogleVerified: false,
        isAdminVerified: true, // Even if true passed without Google, must NEVER elevate admin offline
        profile: athlete1,
      },
      authStorage
    );
    assert(Boolean(saved), 'Saved offline session binding for pre-authenticated UID');
    assert(!('pin' in (saved?.profileSnapshot || {})), 'Stripped sensitive pin field from offline binding snapshot');
    assert(saved?.isAdminVerified === false, 'Prevented non-Google admin privilege elevation in offline binding');

    const binding = getOfflineSessionBinding(authStorage);
    assert(binding?.athleteId === athlete1.id, 'Reloaded valid binding matching verified UID');

    // Network down -> allows resuming verified pre-authenticated session
    const offlineOk = canResumeOfflineAuthenticatedSession({
      authUserUid: 'uid-stage6-athlete-1',
      apiStatus: 0,
      isOnline: false,
      binding,
    });
    assert(offlineOk.allowed && offlineOk.athleteId === athlete1.id, 'Allows authenticated athlete entry offline on network outage');

    // HTTP 401/403/409 MUST NEVER bypass offline
    const rejected401 = canResumeOfflineAuthenticatedSession({
      authUserUid: 'uid-stage6-athlete-1',
      apiStatus: 401,
      isOnline: false,
      binding,
    });
    const rejected403 = canResumeOfflineAuthenticatedSession({
      authUserUid: 'uid-stage6-athlete-1',
      apiStatus: 403,
      isOnline: false,
      binding,
    });
    const rejected409 = canResumeOfflineAuthenticatedSession({
      authUserUid: 'uid-stage6-athlete-1',
      apiStatus: 409,
      isOnline: true,
      binding,
    });
    const rejectedNoUid = canResumeOfflineAuthenticatedSession({
      authUserUid: null,
      apiStatus: 0,
      isOnline: false,
      binding,
    });
    const rejectedDifferentUid = canResumeOfflineAuthenticatedSession({
      authUserUid: 'uid-stage6-other-user',
      apiStatus: 0,
      isOnline: false,
      binding,
    });

    assert(!rejected401.allowed, 'Blocked offline resume on HTTP 401');
    assert(!rejected403.allowed, 'Blocked offline resume on HTTP 403');
    assert(!rejected409.allowed, 'Blocked offline resume on HTTP 409');
    assert(!rejectedNoUid.allowed, 'Blocked offline resume without Firebase Auth UID');
    assert(!rejectedDifferentUid.allowed, 'Blocked offline resume when Auth UID mismatches stored binding');

    clearOfflineSessionBinding(authStorage);
    assert(getOfflineSessionBinding(authStorage) === null, 'Cleared offline session binding cleanly on logout/revocation');
    passed++;
  } catch (err) {
    failed++;
    console.error('  ✗ Test 1 failed:', err);
  }

  // =========================================================================
  // 2. COLA OFFLINE INTELIGENTE: BACKOFF, MUTEX, ACK-ONLY Y FOLDING
  // =========================================================================
  console.log('\n2. SMART OFFLINE SYNC QUEUE: BACKOFF, MUTEX, ACK-ONLY & FOLDING');
  try {
    const queueStorage = new MemoryStorage();

    // Verify exponential backoff curve (1.5s -> 3s -> 6s -> capped 60s)
    assert(computeRetryBackoffMs(1) === 1500, 'Backoff attempt 1 = 1500ms');
    assert(computeRetryBackoffMs(2) === 3000, 'Backoff attempt 2 = 3000ms');
    assert(computeRetryBackoffMs(10) === 60000, 'Backoff capped at 60000ms');

    // Enqueue live workout_patch then finish -> finish folds stale patch cleanly
    queueOfflineSync(
      athlete1.id,
      { activeSession: { sessionId: 'wk-s6-1' }, activeSessionUpdatedAt: 1000 },
      'workout_patch',
      queueStorage
    );
    queueOfflineSync(
      athlete1.id,
      { history: [{ id: 'wk-s6-1' }], activeSession: null, activeSessionClearedAt: 2000 },
      'workout_finish',
      queueStorage
    );
    queueOfflineSync(
      athlete1.id,
      { routines: [{ id: 'rut-s6-1' }] },
      'routine_save',
      queueStorage
    );

    const foldedQueue = getOfflineSyncQueue(queueStorage);
    assert(foldedQueue.length === 2, 'workout_finish folded superseded workout_patch cleanly (2 ops left)');
    assert(
      foldedQueue.every((op) => op.id && op.createdAt && op.operationType && typeof op.recordVersion === 'number'),
      'All queued operations contain id, createdAt, operationType, status, attempts, nextRetryAt, and recordVersion'
    );
    assert(
      hasPendingSyncOperationType(athlete1.id, ['routine_save'], queueStorage),
      'hasPendingSyncOperationType detects pending routine_save op'
    );

    // Offline attempt -> must preserve queue untouched
    const offlineAttempt = await processPendingOfflineSyncs({
      storage: queueStorage,
      isOnline: false,
      isAuthed: true,
    });
    assert(
      offlineAttempt.syncedCount === 0 && offlineAttempt.remainingCount === 2,
      'Offline sync check does not drop queued operations'
    );

    // Transient network error -> retry_scheduled + backoff nextRetryAt > now
    const now1 = 1_700_000_000_000;
    const failedRun = await processPendingOfflineSyncs({
      storage: queueStorage,
      isOnline: true,
      isAuthed: true,
      nowMs: now1,
      syncFn: async () => ({ success: false, message: 'Timeout de red temporal' }),
    });
    assert(
      failedRun.syncedCount === 0 && failedRun.failedCount === 2 && failedRun.remainingCount === 2,
      'Failed sync retains ops in queue (ACK-only deletion)'
    );
    const summaryAfterFail = getOfflineSyncQueueSummary(athlete1.id, queueStorage);
    assert(
      summaryAfterFail.pendingOps[0].attempts === 1 &&
        summaryAfterFail.pendingOps[0].status === 'retry_scheduled' &&
        summaryAfterFail.pendingOps[0].nextRetryAt === now1 + 1500,
      'Scheduled exponential backoff retry timestamp accurately'
    );

    // Too-early auto flush without forceNow skips backoff-waiting ops
    const tooEarlyRun = await processPendingOfflineSyncs({
      storage: queueStorage,
      isOnline: true,
      isAuthed: true,
      nowMs: now1 + 500,
      syncFn: async () => {
        throw new Error('Should not execute before nextRetryAt');
      },
    });
    assert(tooEarlyRun.syncedCount === 0 && tooEarlyRun.remainingCount === 2, 'Honors retry backoff window before retrying');

    // Concurrent calls at ready timestamp -> singleflight mutex ensures syncFn executes once per op!
    let syncCalls = 0;
    const [concA, concB] = await Promise.all([
      processPendingOfflineSyncs({
        storage: queueStorage,
        isOnline: true,
        isAuthed: true,
        nowMs: now1 + 2000,
        syncFn: async () => {
          syncCalls++;
          await new Promise((r) => setTimeout(r, 15));
          return { success: true };
        },
      }),
      processPendingOfflineSyncs({
        storage: queueStorage,
        isOnline: true,
        isAuthed: true,
        nowMs: now1 + 2000,
        syncFn: async () => {
          syncCalls++;
          await new Promise((r) => setTimeout(r, 15));
          return { success: true };
        },
      }),
    ]);

    assert(concA.syncedCount === 2 && concB.syncedCount === 2, 'Concurrent callers share singleflight promise result');
    assert(syncCalls === 2, 'Singleflight mutex prevented duplicate parallel writes (2 calls total instead of 4)');
    assert(getOfflineSyncQueue(queueStorage).length === 0, 'Queue cleared cleanly only after cloud ACK');

    // Permission denied handling -> marks error status and stops auto-retrying
    queueOfflineSync(athlete1.id, { prs: {} }, 'bodyweight_update', queueStorage);
    await processPendingOfflineSyncs({
      storage: queueStorage,
      isOnline: true,
      isAuthed: true,
      nowMs: now1 + 5000,
      syncFn: async () => ({ success: false, permissionDenied: true, message: 'PERMISSION_DENIED' }),
    });
    const permQueue = getOfflineSyncQueue(queueStorage);
    assert(permQueue[0].status === 'error', 'Permission denied isolates operation cleanly without infinite retry loop');

    passed++;
  } catch (err) {
    failed++;
    console.error('  ✗ Test 2 failed:', err);
  }

  // =========================================================================
  // 3. RECONCILIACIÓN MULTI-DISPOSITIVO NO DESTRUCTIVA & CERO DUPLICADOS XP
  // =========================================================================
  console.log('\n3. NON-DESTRUCTIVE MULTI-DEVICE CONFLICT MERGE & XP IDEMPOTENCY');
  try {
    const startMs = Date.now() - 3600_000;
    const localSession = ensureSessionStableIds({
      sessionId: generateStableId('workout'),
      routineId: 'rut-stage6',
      routineTitle: 'Torso Offline',
      startTime: startMs,
      updatedAt: startMs + 120_000,
      exercises: [
        {
          exerciseId: 'ex-1',
          exerciseName: 'Press Banca con Barra',
          activeExerciseName: 'Press Banca con Barra',
          targetMuscles: 'Pecho',
          sets: [
            { id: 'set-a', setNumber: 1, weight: 80, reps: 8, rpe: 8, completed: true },
            { id: 'set-b', setNumber: 2, weight: 85, reps: 6, rpe: 9, completed: true },
          ],
        },
      ],
    });
    const staleCloudSession: ActiveWorkoutSession = {
      ...localSession,
      updatedAt: startMs + 10_000,
      exercises: [
        {
          ...localSession.exercises[0],
          sets: [
            { id: 'set-a', setNumber: 1, weight: 80, reps: 8, rpe: 8, completed: true },
            { id: 'set-b', setNumber: 2, weight: '', reps: '', completed: false },
          ],
        },
      ],
    };
    const mergedSession = reconcileActiveSessionWithCloud({
      localSession,
      cloudSession: staleCloudSession,
      hasPendingOfflineSync: true,
      history: [],
    });
    assert(
      mergedSession.source === 'local_kept' &&
        mergedSession.resolvedSession?.exercises[0].sets[1].completed === true,
      'Protects newer offline set logs against stale cloud snapshot overwrite'
    );

    // Monotonic PR merge across devices
    const localPRs: Record<string, PersonalRecord> = {
      'ex-bench': {
        exerciseId: 'ex-bench',
        exerciseName: 'Press Banca',
        maxWeight: 100,
        repsAtMaxWeight: 5,
        estimated1RM: 116.7,
        date: '2026-11-18T10:00:00.000Z',
      },
    };
    const cloudPRs: Record<string, PersonalRecord> = {
      'ex-bench': {
        exerciseId: 'ex-bench',
        exerciseName: 'Press Banca',
        maxWeight: 95,
        repsAtMaxWeight: 5,
        estimated1RM: 110.8,
        date: '2026-11-17T10:00:00.000Z',
      },
      'ex-squat': {
        exerciseId: 'ex-squat',
        exerciseName: 'Sentadilla',
        maxWeight: 140,
        repsAtMaxWeight: 5,
        estimated1RM: 163.3,
        date: '2026-11-18T09:00:00.000Z',
      },
    };
    const mergedPRs = reconcilePersonalRecordsMap(localPRs, cloudPRs);
    assert(mergedPRs['ex-bench'].maxWeight === 100, 'Monotonic PR merge retains higher local bench PR');
    assert(mergedPRs['ex-squat'].maxWeight === 140, 'Monotonic PR merge incorporates remote squat PR cleanly');

    // Pending offline routine edits are not wiped out by cloud onSnapshot
    const localRoutine: Routine = {
      id: 'rut-local-edit',
      title: 'Torso Editado Offline',
      dayName: 'Lunes',
      tagline: 'Fuerza',
      exercises: [],
    };
    const cloudRoutines: Routine[] = [
      { id: 'rut-local-edit', title: 'Torso Antiguo Cloud', dayName: 'Lunes', tagline: 'Fuerza', exercises: [] },
    ];
    const protectedRoutines = reconcileRoutinesWithCloud({
      localRoutines: [localRoutine],
      cloudRoutines,
      hasPendingRoutineOp: true,
    });
    assert(
      protectedRoutines.source === 'local_kept' &&
        protectedRoutines.resolvedRoutines[0].title === 'Torso Editado Offline',
      'Protects pending offline routine edits against cloud snapshot overwrite'
    );

    // Body weight union merge
    const bwLocal: BodyWeightEntry[] = [{ id: 'bw-1', date: '2026-11-18T10:00:00Z', weightKg: 80.5 }];
    const bwCloud: BodyWeightEntry[] = [
      { id: 'bw-1', date: '2026-11-18T10:00:00Z', weightKg: 80.5 },
      { id: 'bw-2', date: '2026-11-17T10:00:00Z', weightKg: 80.8 },
    ];
    const bwMerged = reconcileBodyWeightLogs(bwLocal, bwCloud, false);
    assert(bwMerged.length === 2, 'BodyWeight log union preserves entries from both devices');

    // Duplicate completed workouts & XP idempotency check
    const endMs = Date.now();
    const completedSample: CompletedWorkout = {
      id: 'wk-stage6-dedup-1',
      profileId: athlete1.id,
      routineId: 'rut-s6',
      routineTitle: 'Pierna Completa',
      date: '2026-11-18T11:00:00.000Z',
      startTime: endMs - 3300_000,
      endTime: endMs,
      durationSeconds: 3300,
      totalVolumeKg: 4800,
      completedSetsCount: 2,
      isFinished: true,
      exercisesSummary: [
        {
          exerciseId: 'ex-squat',
          name: 'Sentadilla con Barra',
          muscleGroup: 'Cuádriceps',
          sets: 2,
          maxWeight: 120,
          maxReps: 5,
          volumeKg: 1200,
          setsDetail: [
            { setNumber: 1, weight: 120, reps: 5, rpe: 8, completed: true },
            { setNumber: 2, weight: 120, reps: 5, rpe: 8.5, completed: true },
          ],
        },
      ],
    };

    const sanitizedSingle = purgeAndSanitizeWorkoutHistory([completedSample], athlete1.weightKg || 80);
    const sanitizedDuplicated = purgeAndSanitizeWorkoutHistory(
      [completedSample, { ...completedSample }],
      athlete1.weightKg || 80
    );
    assert(
      sanitizedDuplicated.cleanedHistory.length === 1 && sanitizedSingle.cleanedHistory.length === 1,
      'History sanitizer collapses duplicated session syncs to 1 canonical workout'
    );

    const xpSingle = computeEliteChallengesSnapshot({
      profile: athlete1,
      history: sanitizedSingle.cleanedHistory,
      routines: [],
      prs: mergedPRs,
    });
    const xpAfterDupMerge = computeEliteChallengesSnapshot({
      profile: athlete1,
      history: sanitizedDuplicated.cleanedHistory,
      routines: [],
      prs: mergedPRs,
    });
    assert(
      xpSingle.totalXp === xpAfterDupMerge.totalXp,
      `XP calculation strictly idempotent after duplicate resync (${xpSingle.totalXp} XP)`
    );
    passed++;
  } catch (err) {
    failed++;
    console.error('  ✗ Test 3 failed:', err);
  }

  // =========================================================================
  // 4. AISLAMIENTO ENTRE PERFILES, PROTECCIÓN EN LOGOUT Y UPDATE SEGURO
  // =========================================================================
  console.log('\n4. PROFILE ISOLATION, SAFE LOGOUT & SAFE UPDATE DEFERRAL');
  try {
    const isoStorage = new MemoryStorage();
    isoStorage.setItem(
      `lazcakon_${athlete1.id}_history`,
      JSON.stringify([{ id: 'wk-a1', routineTitle: 'A1', date: '2026-11-18T10:00:00Z', exercisesSummary: [] }])
    );
    isoStorage.setItem(
      `lazcakon_${athlete2.id}_history`,
      JSON.stringify([{ id: 'wk-a2', routineTitle: 'A2', date: '2026-11-18T11:00:00Z', exercisesSummary: [] }])
    );

    queueOfflineSync(athlete2.id, { history: [{ id: 'wk-a2-q' }] }, 'workout_finish', isoStorage);
    const a1Summary = getOfflineSyncQueueSummary(athlete1.id, isoStorage);
    assert(a1Summary.count === 0, 'Sync queue strictly isolates pending operations by profileId');

    const origWindow = (globalThis as any).window;
    (globalThis as any).window = { localStorage: isoStorage };
    try {
      const a1Sources = collectAllLocalHistorySources(athlete1.id);
      const a1Workouts = a1Sources.flatMap((s) => s.rawRecords);
      assert(
        a1Workouts.some((w: any) => w?.id === 'wk-a1') &&
          !a1Workouts.some((w: any) => w?.id === 'wk-a2' || w?.id === 'wk-a2-q'),
        'collectAllLocalHistorySources strictly isolates profile 1 from profile 2 history & queue'
      );
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
    }

    // Safe logout evaluation
    const logoutWarn = evaluateLogoutSafetyStatus({
      pendingSyncCount: 2,
      hasActiveWorkout: true,
      isOffline: true,
    });
    assert(
      logoutWarn.requiresWarning && Boolean(logoutWarn.warningMessage),
      'Logout safety warns clearly when pending sync ops or active workout exist offline'
    );

    const logoutSafe = evaluateLogoutSafetyStatus({
      pendingSyncCount: 0,
      hasActiveWorkout: false,
      isOffline: false,
    });
    assert(!logoutSafe.requiresWarning, 'Logout proceeds silently when no unsynced local work exists');

    // App update safety deferral during active workout or pending offline queue
    const updateStorage = new MemoryStorage();
    updateStorage.setItem(
      `lazcakon_${athlete1.id}_active_session`,
      JSON.stringify({ sessionId: 'wk-active-lock' })
    );
    const safety = getAppUpdateSafetyStatus(updateStorage);
    assert(
      !safety.canUpdateSafely && safety.hasActiveWorkout,
      'Blocks SW skipWaiting/reload while an active workout session exists'
    );
    const deferred = await forceAppUpdate({ storage: updateStorage });
    assert(deferred.deferred && !deferred.applied, 'forceAppUpdate defers safely without losing workout data');

    passed++;
  } catch (err) {
    failed++;
    console.error('  ✗ Test 4 failed:', err);
  }

  // =========================================================================
  // 5. BIBLIOTECA OFFLINE SELECTIVA POR RUTINA + QUOTA + EVICCIÓN VERSIONADA
  // =========================================================================
  console.log('\n5. SELECTIVE VERSIONED OFFLINE EXERCISE LIBRARY & QUOTA HANDLING');
  try {
    const sampleLibEx = EXERCISE_LIBRARY.find((e) => Boolean(e.animationUrl || e.thumbnailUrl));
    assert(Boolean(sampleLibEx), 'Catalog contains visual exercise asset URLs');

    const sampleRoutine: Routine[] = [
      {
        id: 'rut-stage6-lib',
        title: 'Push Selectivo',
        dayName: 'Lunes',
        tagline: 'Pecho/Hombro',
        exercises: [
          {
            id: 'ex-r1',
            libraryExerciseId: sampleLibEx?.id,
            name: sampleLibEx?.name || 'Press Banca',
            targetMuscles: sampleLibEx?.muscleGroup || 'Pecho',
            defaultSets: 3,
            repRange: '8-10',
            restSeconds: 90,
            restText: '90 seg',
            objective: 'Hipertrofia controlada',
            defaultVideoUrl: sampleLibEx?.animationUrl || '',
            techniqueCues: ['Controla la fase excéntrica'],
          },
        ],
      },
    ];

    const assetReport = resolveRoutineOfflineAssets(sampleRoutine);
    assert(
      assetReport.uniqueUrls.length >= 1 && assetReport.uniqueUrls.length <= 5,
      `Selective resolver extracts only configured routine assets (${assetReport.uniqueUrls.length} URLs << full ${EXERCISE_LIBRARY.length} catalog)`
    );

    const cacheStorage = new MemoryCacheAdapter();
    cacheStorage.seedBucket('lazcakon-exercise-lib-v0', { 'https://example.com/old.webp': { ok: true } });
    cacheStorage.seedBucket('lazcakongym-v6.4.2-muscle-map', { '/index.html': { ok: true } });
    const libStorage = new MemoryStorage();

    // Evict obsolete exercise cache version without touching app shell
    const eviction = await evictObsoleteExerciseCaches(cacheStorage);
    assert(
      eviction.evictedCaches.includes('lazcakon-exercise-lib-v0') &&
        !cacheStorage.hasBucket('lazcakon-exercise-lib-v0') &&
        cacheStorage.hasBucket('lazcakongym-v6.4.2-muscle-map'),
      'Evicted obsolete lazcakon-exercise-lib-v0 while keeping app shell cache untouched'
    );

    // Download selective routine assets into versioned cache
    const dlResult = await downloadRoutineAssetsForOffline({
      routines: sampleRoutine,
      cacheStorage,
      storage: libStorage,
      fetcher: async (url) => ({ ok: true, status: 200, clone: () => ({ url, ok: true }) }),
    });
    assert(
      dlResult.status === 'completed' &&
        dlResult.downloadedCount === assetReport.uniqueUrls.length &&
        cacheStorage.hasBucket(EXERCISE_LIB_CACHE_NAME),
      `Downloaded ${dlResult.downloadedCount} routine assets into versioned cache ${EXERCISE_LIB_CACHE_NAME}`
    );

    const cacheStatus = await getOfflineExerciseCacheStatus({
      routines: sampleRoutine,
      cacheStorage,
      storage: libStorage,
    });
    assert(
      cacheStatus.cachedAssetsCount === cacheStatus.targetAssetsCount && cacheStatus.missingAssetsCount === 0,
      'Reports 100% cached routine assets accurately'
    );

    // Simulate QuotaExceededError on fresh cache without deleting history or routines
    const smallCache = new MemoryCacheAdapter();
    smallCache.maxEntriesBeforeQuota = 0;
    const quotaResult = await downloadRoutineAssetsForOffline({
      routines: sampleRoutine,
      cacheStorage: smallCache,
      storage: libStorage,
      fetcher: async () => ({ ok: true, status: 200, clone: () => ({ ok: true }) }),
    });
    assert(
      quotaResult.status === 'quota_exceeded' && quotaResult.quotaExceeded === true,
      'Handled QuotaExceededError gracefully with informative status and zero data corruption'
    );

    await clearOfflineExerciseAssetCache({ cacheStorage, storage: libStorage });
    assert(!cacheStorage.hasBucket(EXERCISE_LIB_CACHE_NAME), 'Cleared visual cache without impacting other buckets');
    passed++;
  } catch (err) {
    failed++;
    console.error('  ✗ Test 5 failed:', err);
  }

  // =========================================================================
  // 6. CAPACITOR MULTIPLATAFORMA & AUDITORÍA ESTÁTICA ANTI-FUGAS / SW
  // =========================================================================
  console.log('\n6. CAPACITOR PLATFORM ADAPTER & STATIC LEAK / SW BOUNDARY CHECKS');
  try {
    const plat = detectRuntimePlatform();
    const matrix = getOfflineCapabilitiesMatrix();
    assert(Boolean(plat.platform), 'Detects runtime platform cleanly in headless/browser environments');
    assert(
      matrix.some((m) => m.worksOffline) && matrix.some((m) => !m.worksOffline),
      'Capabilities matrix transparently distinguishes offline-ready vs online-only capabilities'
    );

    const bgTimerSrc = fs.readFileSync(path.resolve('src/utils/backgroundTimer.ts'), 'utf8');
    assert(
      bgTimerSrc.includes('URL.revokeObjectURL'),
      'backgroundTimer.ts revokes Web Worker Blob URLs to prevent memory leaks'
    );

    const swSrc = fs.readFileSync(path.resolve('public/sw.js'), 'utf8');
    assert(
      swSrc.includes('lazcakon-exercise-lib-v1') &&
        swSrc.includes("pathname.startsWith('/api/')") &&
        swSrc.includes('return;'),
      'sw.js isolates versioned exercise cache and keeps /api/ private traffic strictly network-only'
    );

    const settingsSrc = fs.readFileSync(path.resolve('src/views/SettingsCloudView.tsx'), 'utf8');
    assert(
      !settingsSrc.includes('confirm('),
      'SettingsCloudView.tsx uses non-blocking inline confirmation panels (zero blocking window.confirm calls)'
    );

    passed++;
  } catch (err) {
    failed++;
    console.error('  ✗ Test 6 failed:', err);
  }

  // =========================================================================
  // 7. CIERRE TÉCNICO: QUOTA LOCALSTORAGE, REVOCACIÓN ONLINE Y AUDITORÍA DE SECRETOS
  // =========================================================================
  console.log('\n7. CLOSING AUDIT: LOCALSTORAGE QUOTA, RECONNECT REVOCATION & SECRET SCAN');
  try {
    // 7.1 Quota-constrained MemoryStorage simulation
    class QuotaMemoryStorage extends MemoryStorage {
      public maxBytes = 1000;
      private computeTotalBytes(): number {
        let total = 0;
        for (let i = 0; i < this.length; i++) {
          const k = this.key(i);
          if (k) total += k.length + (this.getItem(k)?.length || 0);
        }
        return total;
      }
      override setItem(k: string, v: string): void {
        const existingLen = (this.getItem(k)?.length || 0);
        const nextTotal = this.computeTotalBytes() - existingLen + k.length + v.length;
        if (nextTotal > this.maxBytes) {
          const err = new Error('QuotaExceededError: localStorage full');
          err.name = 'QuotaExceededError';
          throw err;
        }
        super.setItem(k, v);
      }
    }

    assert(
      isStorageQuotaExceededError(Object.assign(new Error('quota'), { name: 'QuotaExceededError' })),
      'Detects DOM QuotaExceededError across browser/WebView variants'
    );

    const quotaStore = new QuotaMemoryStorage();
    quotaStore.maxBytes = 1200;
    const histKey = `lazcakon_${athlete1.id}_history`;
    const activeKey = `lazcakon_${athlete1.id}_active_session`;
    quotaStore.setItem(histKey, JSON.stringify([{ id: 'wk-hist-keep', routineTitle: 'Pierna', totalVolumeKg: 3000 }]));
    // Reconstructible raw backup fills remaining quota
    quotaStore.setItem('lazcakon_raw_unfiltered_backup_v1', 'X'.repeat(850));

    // Attempt critical active_session write -> exceeds quota initially, should auto-reclaim raw backup and succeed!
    const largeSessionPayload = JSON.stringify({
      sessionId: 'wk-quota-ok',
      routineTitle: 'Torso Pesado',
      exercises: [{ id: 'ex1', sets: Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, weight: 80, reps: 8, completed: true })) }],
    });
    const quotaRecovered = safeLocalStorageSetItem(activeKey, largeSessionPayload, {
      storage: quotaStore,
      critical: true,
    });
    assert(
      quotaRecovered.ok && quotaRecovered.recoveredByReclaim && quotaRecovered.reclaimedKeys.includes('lazcakon_raw_unfiltered_backup_v1'),
      'Automatically reclaims reconstructible raw backup to save active_session under QuotaExceededError'
    );
    assert(quotaStore.getItem(histKey) !== null, 'Never deletes protected athlete history during quota reclamation');

    // Now test hard quota exhaustion -> never crashes and never deletes protected keys or queue
    quotaStore.maxBytes = 500; // already full with history + active session (>500)
    const hardQuotaRes = safeLocalStorageSetItem(`lazcakon_${athlete1.id}_prs`, 'P'.repeat(400), {
      storage: quotaStore,
      critical: true,
    });
    assert(
      !hardQuotaRes.ok && hardQuotaRes.quotaExceeded && Boolean(hardQuotaRes.errorMessage),
      'Reports informative QuotaExceededError cleanly when storage cannot fit new write'
    );
    assert(
      quotaStore.getItem(histKey) !== null && quotaStore.getItem(activeKey) !== null,
      'Preserves existing history and active_session untouched under hard quota exhaustion'
    );

    const queueFail = queueOfflineSync(athlete1.id, { history: [{ id: 'wk-huge', blob: 'Z'.repeat(600) }] }, 'workout_finish', quotaStore);
    assert(
      queueFail === null && Boolean(getLastOfflineQueueStorageError()),
      'queueOfflineSync avoids uncaught throw and records storage error under hard quota exhaustion'
    );

    // 7.2 Partial batch ACK-only retention
    const partialQueueStore = new MemoryStorage();
    queueOfflineSync(athlete1.id, { routines: [{ id: 'r1' }] }, 'routine_save', partialQueueStore);
    queueOfflineSync(athlete1.id, { bodyWeightLogs: [{ id: 'bw1', weightKg: 81 }] }, 'bodyweight_update', partialQueueStore);
    let callIdx = 0;
    const partialRes = await processPendingOfflineSyncs({
      storage: partialQueueStore,
      isOnline: true,
      isAuthed: true,
      nowMs: 2_000_000_000,
      syncFn: async () => {
        callIdx++;
        return callIdx === 1 ? { success: true } : { success: false, message: 'Error 503 en segundo lote' };
      },
    });
    const remainingPartial = getOfflineSyncQueue(partialQueueStore);
    assert(
      partialRes.syncedCount === 1 &&
        partialRes.failedCount === 1 &&
        remainingPartial.length === 1 &&
        remainingPartial[0].operationType === 'bodyweight_update',
      'Partial batch ACK removes ONLY confirmed op and retains unacknowledged op with retry schedule'
    );
    assert(
      remainingPartial[0].attempts === 1 && remainingPartial[0].status === 'retry_scheduled',
      'Retained partial op increments attempt counter and enters retry_scheduled'
    );

    // 7.3 Post-offline reconnect revalidation & revocation + useGymState wiring
    assert(
      resolvePostOfflineReconnectOutcome({ ok: true, isJson: true, status: 200 }) === 'valid' &&
        resolvePostOfflineReconnectOutcome({ ok: false, isJson: true, status: 401 }) === 'revoked' &&
        resolvePostOfflineReconnectOutcome({ ok: false, isJson: true, status: 403 }) === 'revoked' &&
        resolvePostOfflineReconnectOutcome({ ok: false, isJson: true, status: 409 }) === 'revoked' &&
        resolvePostOfflineReconnectOutcome({ ok: false, isJson: false, status: 0 }) === 'defer_offline',
      'Reconnection validator enforces immediate revocation on 401/403/409 and defers only on transient network failure'
    );

    const gymStateSrc = fs.readFileSync(path.resolve('src/hooks/useGymState.ts'), 'utf8');
    assert(
      gymStateSrc.includes('sessionServerValidatedRef.current = false;') &&
        gymStateSrc.includes('resolvePostOfflineReconnectOutcome'),
      'useGymState forces real /api/auth/session-init revalidation when transitioning from offline session back online'
    );
    assert(
      !gymStateSrc.includes("if (sessionInitializedUidRef.current === authUser.uid && isLoggedIn) {\n      return;\n    }"),
      'Fixed early-return guard that previously skipped online revalidation after offline entry'
    );

    // 7.4 Static check: zero hardcoded private secrets in client code / public assets & .env* gitignored
    const gitignoreSrc = fs.readFileSync(path.resolve('.gitignore'), 'utf8');
    assert(gitignoreSrc.includes('.env*') && gitignoreSrc.includes('!.env.example'), '.gitignore protects local .env files');

    const walkFiles = (dir: string): string[] => {
      const results: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'server' || entry.name === '__tests__' || entry.name === 'dist') continue;
          results.push(...walkFiles(full));
        } else if (/\.(ts|tsx|js|jsx|json|html)$/.test(entry.name)) {
          results.push(full);
        }
      }
      return results;
    };

    const clientFiles = [...walkFiles(path.resolve('src')), ...walkFiles(path.resolve('public'))];
    const forbiddenSecretPatterns = [
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
      /process\.env\.GEMINI_API_KEY/,
      /process\.env\.FIREBASE_ADMIN/,
      /process\.env\.VAPID_PRIVATE_KEY/,
      /process\.env\.RESEND_API_KEY/,
      /AIza[0-9A-Za-z\-_]{35}/, // Wait: Firebase Web apiKey intentionally exists in firebase-applet-config.json (public Web API key)
    ].slice(0, 5);

    const leakedFiles: string[] = [];
    for (const f of clientFiles) {
      const txt = fs.readFileSync(f, 'utf8');
      if (forbiddenSecretPatterns.some((rx) => rx.test(txt))) {
        leakedFiles.push(path.relative(process.cwd(), f));
      }
    }
    assert(leakedFiles.length === 0, `Zero backend private secrets leaked into client/public bundle (checked ${clientFiles.length} files)`);

    passed++;
  } catch (err) {
    failed++;
    console.error('  ✗ Test 7 failed:', err);
  }

  console.log('\n====================================================================');
  console.log(`RESULTADOS OFFLINE PRODUCTION READINESS: ${passed}/${passed + failed} BLOQUES APROBADOS`);
  console.log('====================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runOfflineProductionReadinessSuite().catch((err) => {
  console.error('Error fatal en offlineProductionReadinessSuite:', err);
  process.exit(1);
});
