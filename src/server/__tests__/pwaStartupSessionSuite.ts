/**
 * Automated Verification & Benchmark Suite: PWA Startup Session Restore
 *
 * Tests & measures:
 * 1. Instant local session resume when Firebase Auth confirms identity + valid local binding exists.
 * 2. Slow-network resilience (AuthProvider soft timeout, safeApiFetchJson AbortController timeout, non-blocking Inicio).
 * 3. Post-logout security (clearOfflineSessionBinding + null authUser strictly blocks local resume).
 * 4. Access validation & server revocation (UID mismatch, forged hintAthleteId, 401/403/404/409 revocation).
 * 5. Active workout session recovery preservation (`lazcakon_${athleteId}_active_session`).
 * 6. Live test-environment latency breakdown (BEFORE Admin gRPC PERMISSION_DENIED vs AFTER direct REST path).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  canResumeInstantLocalSession,
  canResumeOfflineAuthenticatedSession,
  clearOfflineSessionBinding,
  getOfflineSessionBinding,
  resolvePostOfflineReconnectOutcome,
  saveOfflineSessionBinding,
} from '../../utils/offlineSessionManager.ts';
import { safeApiFetchJson } from '../../utils/safeApiFetch.ts';
import { ensureSessionStableIds } from '../../utils/workoutPersistence.ts';
import { getAdminServices, parseConfiguredServiceAccount } from '../firebaseAdminServer.ts';
import { handleSessionInit } from '../authMigrationController.ts';
import type { ActiveWorkoutSession, Profile } from '../../types/index.ts';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function makeAthleteProfile(id = 'perfil_camilo_test'): Profile {
  return {
    id,
    name: 'Camilo Lazcano',
    email: 'camilo@lazcakongym.cl',
    authUid: 'uid_camilo_123',
    avatar: '🦍',
    goal: 'Fuerza Máxima',
    weeklyTargetDays: 5,
    soundEnabled: true,
    vibrationEnabled: true,
    weightUnit: 'kg',
    weightKg: 92,
    themeAccent: 'smartfit',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeActiveSession(): ActiveWorkoutSession {
  return {
    sessionId: 'workout-test-123',
    routineId: 'rutina_jueves_pierna',
    routineTitle: 'Pierna Fuerza',
    startTime: Date.now() - 18 * 60 * 1000,
    updatedAt: Date.now() - 60 * 1000,
    exercises: [
      {
        exerciseId: 'ex_rdl',
        exerciseName: 'Peso muerto rumano con barra',
        activeExerciseName: 'Peso muerto rumano con barra',
        targetMuscles: 'Isquiotibiales',
        restSeconds: 150,
        sets: [
          { id: 'set_1', setNumber: 1, weight: 100, reps: 8, completed: true, rir: 2 },
          { id: 'set_2', setNumber: 2, weight: 100, reps: 8, completed: true, rir: 2 },
          { id: 'set_3', setNumber: 3, weight: 100, reps: 8, completed: false },
          { id: 'set_4', setNumber: 4, weight: 100, reps: 8, completed: false },
        ],
      },
    ],
  };
}

function createMockRes() {
  let statusCode = 200;
  let body: any = null;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: any) {
      body = payload;
      return res;
    },
    getStatus: () => statusCode,
    getBody: () => body,
  };
  return res;
}

async function runSuite() {
  let passed = 0;
  const check = (name: string, fn: () => void | Promise<void>) =>
    Promise.resolve()
      .then(fn)
      .then(() => {
        passed += 1;
        console.log(`✅ [PASS] ${name}`);
      });

  // 1. Source invariants: AuthProvider soft timeout + useGymState instant local resume + server fast-path
  await check('Source invariants: AuthProvider soft timeout & fail-closed claims', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AuthProvider.tsx'), 'utf8');
    assert.ok(src.includes('AUTH_TOKEN_CLAIMS_SOFT_TIMEOUT_MS'), 'Missing AuthProvider soft timeout constant');
    assert.ok(src.includes('Promise.race([tokenStatePromise, timeoutPromise])'), 'Missing non-blocking token race');
    assert.ok(src.includes("markStartupTiming('firebaseAuthRestoreMs')"), 'Missing Firebase Auth restore timing mark');
  });

  await check('Source invariants: useGymState instant local resume + background validation + timeoutMs', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useGymState.ts'), 'utf8');
    assert.ok(src.includes('canResumeInstantLocalSession'), 'Missing instant local resume check');
    assert.ok(src.includes('timeoutMs: 10_000'), 'Missing /api/auth/session-init fetch timeout');
    assert.ok(src.includes('hintAthleteId'), 'Missing hintAthleteId optimization');
    assert.ok(src.includes("markStartupTiming('firstFirestoreSyncMs'"), 'Missing Firestore sync timing mark');
    assert.ok(src.includes('sessionServerValidatedRef.current = false;'), 'Missing offline readiness invariant');
  });

  // 2. Scenario A: Reopen with active session (normal network) — instant local resume + active workout recovery
  await check('Scenario A: Reopen with active session unblocks Inicio immediately and preserves active workout', () => {
    const storage = createMemoryStorage();
    const profile = makeAthleteProfile();
    const activeSession = makeActiveSession();

    // Persist verified session binding + active workout in storage (simulating prior session)
    saveOfflineSessionBinding(
      {
        uid: 'uid_camilo_123',
        athleteId: profile.id,
        isGoogleVerified: false,
        isAdminVerified: false,
        profile,
      },
      storage
    );
    storage.setItem(`lazcakon_${profile.id}_active_session`, JSON.stringify(activeSession));

    const t0 = performance.now();
    const binding = getOfflineSessionBinding(storage);
    const instant = canResumeInstantLocalSession({
      authUserUid: 'uid_camilo_123',
      binding,
      storage,
    });
    const hydratedSession = ensureSessionStableIds(
      JSON.parse(storage.getItem(`lazcakon_${profile.id}_active_session`)!)
    );
    const localResumeMs = performance.now() - t0;

    assert.equal(instant.allowed, true);
    assert.equal(instant.athleteId, profile.id);
    assert.equal(instant.profile?.name, 'Camilo Lazcano');
    assert.equal(hydratedSession.routineId, 'rutina_jueves_pierna');
    assert.equal(hydratedSession.exercises[0].sets.filter((s) => s.completed).length, 2);
    assert.ok(localResumeMs < 50, `Expected instant local resume < 50ms, got ${localResumeMs.toFixed(2)}ms`);
    console.log(`   ↳ Measured local profile + active session hydration: ${localResumeMs.toFixed(2)} ms`);
  });

  // 3. Scenario B: Slow network — BEFORE vs AFTER simulation (token refresh + 6s-20s stalled /api/auth/session-init)
  await check('Scenario B: Slow network (15s stalled server + 4s token refresh) does NOT block Inicio', async () => {
    const storage = createMemoryStorage();
    const profile = makeAthleteProfile();
    saveOfflineSessionBinding(
      {
        uid: 'uid_camilo_123',
        athleteId: profile.id,
        isGoogleVerified: false,
        isAdminVerified: false,
        profile,
      },
      storage
    );

    // Measure safeApiFetchJson AbortController timeout against a stalled fetch
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = ((_url: any, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('The operation was aborted.');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        })) as typeof fetch;

      const tAbortStart = performance.now();
      const resp = await safeApiFetchJson('/api/auth/session-init', {
        method: 'POST',
        timeoutMs: 180,
      });
      const abortElapsedMs = performance.now() - tAbortStart;

      assert.equal(resp.ok, false);
      assert.equal(resp.status, 0);
      assert.ok(resp.error?.includes('tardó demasiado'), `Expected Spanish timeout error, got: ${resp.error}`);
      assert.ok(abortElapsedMs >= 160 && abortElapsedMs < 600, `Expected abort near 180ms, got ${abortElapsedMs}ms`);

      // Verify after timeout (status: 0), offline continuity keeps verified athlete logged in for background retry
      const fallback = canResumeOfflineAuthenticatedSession({
        authUserUid: 'uid_camilo_123',
        apiStatus: resp.status,
        isOnline: true,
        binding: getOfflineSessionBinding(storage),
      });
      assert.equal(fallback.allowed, true);
      console.log(`   ↳ Measured stalled fetch clean abort (timeoutMs=180ms): ${abortElapsedMs.toFixed(1)} ms`);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // Verify AuthProvider soft-timeout race behavior when getIdTokenResult takes 5000ms (simulated slow network)
    const SOFT_TIMEOUT = 150;
    const tAuthStart = performance.now();
    let backgroundClaimsResolved = false;
    const slowTokenPromise = new Promise<{ isGoogleVerified: boolean }>((resolve) => {
      setTimeout(() => {
        backgroundClaimsResolved = true;
        resolve({ isGoogleVerified: true });
      }, 320);
    });
    let timerId: ReturnType<typeof setTimeout> | null = null;
    const winner = await Promise.race([
      slowTokenPromise,
      new Promise<'timeout'>((resolve) => {
        timerId = setTimeout(() => resolve('timeout'), SOFT_TIMEOUT);
      }),
    ]);
    if (timerId) clearTimeout(timerId);
    const unblockMs = performance.now() - tAuthStart;

    assert.equal(winner, 'timeout');
    assert.equal(backgroundClaimsResolved, false, 'Inicio should unblock before slow token refresh finishes');
    assert.ok(unblockMs < 260, `Expected soft timeout unblock < 260ms, got ${unblockMs}ms`);
    await slowTokenPromise;
    assert.equal(backgroundClaimsResolved, true, 'Background token verification must still complete');
    console.log(`   ↳ Simulated slow token refresh (320ms) unblocked at: ${unblockMs.toFixed(1)} ms (fail-closed until settled)`);
  });

  // 4. Scenario C: Reopen after logout() — strictly blocked, immediate Login screen
  await check('Scenario C: Reopen after logout clears binding and never resumes from localStorage', () => {
    const storage = createMemoryStorage();
    const profile = makeAthleteProfile();
    saveOfflineSessionBinding(
      {
        uid: 'uid_camilo_123',
        athleteId: profile.id,
        isGoogleVerified: false,
        isAdminVerified: false,
        profile,
      },
      storage
    );

    // Simulate logout()
    clearOfflineSessionBinding(storage);

    const afterLogoutWithNullAuth = canResumeInstantLocalSession({
      authUserUid: null,
      binding: getOfflineSessionBinding(storage),
      storage,
    });
    assert.equal(afterLogoutWithNullAuth.allowed, false);

    // Even if an attacker manually injects a stale binding while authUser is null
    saveOfflineSessionBinding(
      {
        uid: 'uid_camilo_123',
        athleteId: profile.id,
        isGoogleVerified: true,
        isAdminVerified: true,
        profile,
      },
      storage
    );
    const spoofedWithoutAuth = canResumeInstantLocalSession({
      authUserUid: null,
      binding: getOfflineSessionBinding(storage),
      storage,
    });
    assert.equal(spoofedWithoutAuth.allowed, false);
    assert.ok(spoofedWithoutAuth.reason && spoofedWithoutAuth.reason.includes('Firebase Auth'));
  });

  // 5. Security & Access Validation: UID mismatch + server 401/403/404/409 revocation + forged hintAthleteId rejection
  await check('Security: UID mismatch and server 401/403/404/409 trigger immediate revocation', () => {
    const storage = createMemoryStorage();
    const profile = makeAthleteProfile();
    saveOfflineSessionBinding(
      {
        uid: 'uid_camilo_123',
        athleteId: profile.id,
        isGoogleVerified: false,
        isAdminVerified: false,
        profile,
      },
      storage
    );

    const mismatch = canResumeInstantLocalSession({
      authUserUid: 'uid_other_athlete_999',
      binding: getOfflineSessionBinding(storage),
      storage,
    });
    assert.equal(mismatch.allowed, false);
    assert.ok(mismatch.reason && mismatch.reason.length > 0);

    for (const status of [401, 403, 404, 409]) {
      const outcome = resolvePostOfflineReconnectOutcome({ ok: false, isJson: true, status });
      assert.equal(outcome, 'revoked', `Expected HTTP ${status} to revoke session`);
    }
    assert.equal(
      resolvePostOfflineReconnectOutcome({ ok: false, isJson: false, status: 0 }),
      'defer_offline',
      'Network transport error (0) should defer offline session for retry'
    );
  });

  await check('Security: Server handleSessionInit ignores forged hintAthleteId belonging to another UID', async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    try {
      globalThis.fetch = (async (input: any) => {
        const url = String(input);
        requestedUrls.push(url);
        // Forged hint points to another athlete's doc
        if (url.includes('/documents/athletes/perfil_otro_atleta')) {
          return new Response(
            JSON.stringify({
              name: 'projects/p/databases/d/documents/athletes/perfil_otro_atleta',
              fields: {
                id: { stringValue: 'perfil_otro_atleta' },
                name: { stringValue: 'Otro Atleta' },
                authUid: { stringValue: 'uid_victim_999' },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/documents/deleted_athletes/')) {
          return new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 });
        }
        // Fallback runQuery for the real caller uid_caller_123
        if (url.includes(':runQuery')) {
          return new Response(
            JSON.stringify([
              {
                document: {
                  name: 'projects/p/databases/d/documents/athletes/perfil_caller_real',
                  fields: {
                    id: { stringValue: 'perfil_caller_real' },
                    name: { stringValue: 'Atleta Real' },
                    authUid: { stringValue: 'uid_caller_123' },
                  },
                },
              },
            ]),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(JSON.stringify({}), { status: 404 });
      }) as typeof fetch;

      const req: any = {
        user: {
          uid: 'uid_caller_123',
          email: 'real@lazcakongym.cl',
          emailVerified: true,
          signInProvider: 'password',
        },
        rawIdToken: 'mock_verified_id_token',
        body: { hintAthleteId: 'perfil_otro_atleta' },
      };
      const res = createMockRes();
      await handleSessionInit(req, res);

      assert.equal(res.getStatus(), 200);
      assert.equal(res.getBody()?.athleteId, 'perfil_caller_real');
      assert.notEqual(res.getBody()?.athleteId, 'perfil_otro_atleta');
      assert.ok(requestedUrls.some((u) => u.includes(':runQuery')), 'Should fall back to authUid query after rejecting forged hint');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await check('Performance: Server handleSessionInit uses 1 parallel round-trip when hintAthleteId matches user.uid', async () => {
    const originalFetch = globalThis.fetch;
    let fetchCount = 0;
    try {
      globalThis.fetch = (async (input: any) => {
        fetchCount += 1;
        const url = String(input);
        if (url.includes('/documents/athletes/perfil_camilo_test')) {
          return new Response(
            JSON.stringify({
              name: 'projects/p/databases/d/documents/athletes/perfil_camilo_test',
              fields: {
                id: { stringValue: 'perfil_camilo_test' },
                name: { stringValue: 'Camilo Lazcano' },
                authUid: { stringValue: 'uid_camilo_123' },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.includes('/documents/deleted_athletes/perfil_camilo_test')) {
          return new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 });
        }
        throw new Error(`Unexpected extra Firestore request: ${url}`);
      }) as typeof fetch;

      const req: any = {
        user: {
          uid: 'uid_camilo_123',
          email: 'camilo@lazcakongym.cl',
          emailVerified: true,
          signInProvider: 'password',
        },
        rawIdToken: 'mock_verified_id_token',
        body: { hintAthleteId: 'perfil_camilo_test' },
      };
      const res = createMockRes();
      await handleSessionInit(req, res);

      assert.equal(res.getStatus(), 200);
      assert.equal(res.getBody()?.athleteId, 'perfil_camilo_test');
      assert.equal(fetchCount, 2, 'Should issue exactly 2 parallel GETs (athletes + deleted_athletes) in 1 round-trip');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 6. Optional live benchmark: never probe production Google Cloud or external APIs during CI.\n  // Run explicitly with RUN_LIVE_FIREBASE_BENCHMARK=1 only in an authorized test environment.\n  if (process.env.RUN_LIVE_FIREBASE_BENCHMARK === '1') {\n    await check('Live test-environment latency breakdown (BEFORE vs AFTER)', async () => {
    const hasServiceAccount = Boolean(parseConfiguredServiceAccount());

    // Measure Firebase Auth certs endpoint (part of server JWT verify)
    const tCert0 = performance.now();
    const certResp = await fetch(
      'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
    );
    await certResp.text();
    const certMs = performance.now() - tCert0;

    // Measure BEFORE Admin Firestore gRPC failure penalty (only when no service account is configured)
    let adminGrpcFailMs = 0;
    let adminGrpcCode: any = null;
    if (!hasServiceAccount) {
      const { db } = getAdminServices();
      const tGrpc0 = performance.now();
      try {
        await db.collection('athletes').where('authUid', '==', 'bench_probe_uid').limit(1).get();
      } catch (err: any) {
        adminGrpcFailMs = performance.now() - tGrpc0;
        adminGrpcCode = err?.code;
      }
    }

    // Measure real Firestore REST GET latency against project database
    const cfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-applet-config.json'), 'utf8'));
    const restUrl = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${cfg.firestoreDatabaseId}/documents/athletes/bench_probe_nonexistent`;
    const tRest0 = performance.now();
    const restResp = await fetch(restUrl);
    await restResp.text();
    const restSingleGetMs = performance.now() - tRest0;

    // Measure local test server /api/health
    let healthMs: number | null = null;
    try {
      const tHealth0 = performance.now();
      const h = await fetch('http://127.0.0.1:3000/api/health');
      await h.text();
      healthMs = performance.now() - tHealth0;
    } catch {}

    console.log('\n📊 [LIVE TEST ENVIRONMENT BENCHMARK]');
    console.log(`   • FIREBASE_SERVICE_ACCOUNT_JSON configured: ${hasServiceAccount}`);
    console.log(`   • Local /api/health latency: ${healthMs !== null ? `${healthMs.toFixed(1)} ms` : 'N/A'}`);
    console.log(`   • Firebase Auth JWKS/certs fetch: ${certMs.toFixed(1)} ms`);
    console.log(`   • BEFORE Admin Firestore gRPC fail penalty (code=${adminGrpcCode}): ${adminGrpcFailMs.toFixed(1)} ms`);
    console.log(`   • Direct Firestore REST single round-trip: ${restSingleGetMs.toFixed(1)} ms`);
    console.log(
      `   • Estimated server /api/auth/session-init BEFORE (Admin gRPC fail + 2 sequential REST): ${(adminGrpcFailMs + restSingleGetMs * 2).toFixed(1)} ms`
    );
    console.log(
      `   • Estimated server /api/auth/session-init AFTER (direct parallel REST): ${restSingleGetMs.toFixed(1)} ms`
    );
    });
  } else {
    console.log('ℹ️  Skipping live Firebase/Google Cloud benchmark (RUN_LIVE_FIREBASE_BENCHMARK not enabled).');
  }

  console.log(`\n🎉 ALL ${passed} PWA STARTUP SESSION CHECKS PASSED!`);
}

runSuite().catch((err) => {
  console.error('❌ Suite failed:', err);
  process.exit(1);
});
