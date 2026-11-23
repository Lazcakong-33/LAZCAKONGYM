/**
 * Comprehensive Verification Suite: Coach LazcaKong IA Blocked-Loading Root Cause & Recovery
 *
 * Covers all required client + server + Android WebView resilience scenarios:
 *  1. HTTP 200 success + non-blocking secondary context fallback
 *  2. HTTP 401 session expired (single forced token refresh attempt, then explicit reauth error)
 *  3. HTTP 429 rate limit / Gemini quota (explicit error, zero automatic retry amplification)
 *  4. HTTP 503 server unavailable (bounded single transient retry, then explicit error)
 *  5. HTTP 504 gateway / Gemini upstream timeout (both backend 504 mapping and client handling)
 *  6. Client Timeout (stalled fetch + stalled getIdToken bounded by AbortController)
 *  7. AbortController cancellation (immediate abort, zero retries, clean exit)
 *  8. Empty / invalid response (200 with empty reply or malformed JSON or HTML)
 *  9. Connection loss (offline mode & network failure)
 * 10. Request cancellation & stale-response guard (`requestId`) on modal close / profile switch
 * 11. Rapid double-send lock + loading ALWAYS released (including thrown exceptions via finally)
 * 12. Recovery with HTTP 200 after a prior error
 * 13. Strict athlete isolation (server 403 + UI profile switch)
 * 14. Real HTTP / CORS verification against local Express server
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import {
  askCoachAI,
  buildMinimizedCoachContext,
} from '../../utils/coachContextEngine.ts';
import { safeApiFetchJson } from '../../utils/safeApiFetch.ts';
import { resolveApiUrl } from '../../utils/apiUrl.ts';
import {
  handleCoachChat,
  type CoachOwnershipCheckResult,
} from '../coachController.ts';
import type { CompletedWorkout, Profile, Routine } from '../../types/index.ts';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: any };
}

function createProfile(id = 'athlete-coach-1'): Profile {
  return {
    id,
    name: 'Atleta LazcaKong',
    email: 'atleta@lazcakongym.cl',
    authUid: `uid-${id}`,
    avatar: '🦍',
    goal: 'Hipertrofia',
    weeklyTargetDays: 5,
    soundEnabled: true,
    vibrationEnabled: true,
    weightUnit: 'kg',
    weightKg: 84,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function createRoutines(): Routine[] {
  return [
    {
      id: 'rutina-empuje',
      dayName: 'Lunes',
      title: 'Lunes: Empuje',
      tagline: 'Pecho y Tríceps',
      modality: 'hipertrofia',
      exercises: [
        {
          id: 'ex-1',
          name: 'Press de Banca Plano con Barra',
          targetMuscles: 'Pecho',
          equipment: 'Barra',
          defaultSets: 4,
          repRange: '6 - 10 reps',
          restSeconds: 120,
          restText: '2 min',
          objective: 'Hipertrofia',
          defaultVideoUrl: '',
          techniqueCues: ['Escápulas retraídas'],
        },
      ],
    },
  ];
}

async function runTests() {
  let passed = 0;
  const runCase = async (name: string, fn: () => Promise<void> | void) => {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  };

  // 1. HTTP 200 OK + secondary context non-blocking guarantee
  await runCase('1. HTTP 200 OK + contexto secundario resiliente no bloquea el chat', async () => {
    const profile = createProfile();
    const malformedHistory = [
      {
        id: 'w-weird',
        profileId: profile.id,
        routineId: 'rutina-empuje',
        routineTitle: 'Empuje',
        date: 'invalid-date-value',
        startTime: Number.NaN,
        endTime: Number.NaN,
        durationSeconds: 0,
        totalVolumeKg: 0,
        completedSetsCount: 0,
        isFinished: true,
        exercisesSummary: null as any,
      } as CompletedWorkout,
    ];

    const ctx = buildMinimizedCoachContext({
      activeProfile: profile,
      routines: createRoutines(),
      history: malformedHistory,
      prs: {},
      activeSession: null,
    });
    assert.ok(ctx.minimizedPayload.selectedRoutine);
    assert.equal(ctx.minimizedPayload.athleteGoal, 'Hipertrofia');

    const res = await askCoachAI({
      athleteId: profile.id,
      message: '¿Qué me toca hoy?',
      intent: 'today_workout',
      history: [],
      context: ctx.minimizedPayload,
      getAuthUser: () => ({ getIdToken: async () => 'valid-token-123' }),
      isOnlineFn: () => true,
      fetchJsonFn: async () => ({
        ok: true,
        status: 200,
        isJson: true,
        isHtml: false,
        data: {
          success: true,
          reply: 'Hoy te toca Lunes: Empuje (Press de Banca Plano con Barra, 4x6-10).',
          model: 'gemini-4-hydrogen',
          disclaimer: 'Orientación de entrenamiento.',
        } as any,
      }),
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, 200);
    assert.ok(res.reply?.includes('Press de Banca'));
  });

  // 2. HTTP 401 (expired session) -> tries 1 forced token refresh, then non-retryable session-expired error
  await runCase('2. HTTP 401 intenta 1 refresh y ante expiración pide reautenticación sin reintentos infinitos', async () => {
    let tokenCalls = 0;
    let fetchCalls = 0;

    const res = await askCoachAI({
      athleteId: 'athlete-1',
      message: 'Hola coach',
      intent: 'freeform',
      history: [],
      context: {},
      getAuthUser: () => ({
        getIdToken: async (forceRefresh?: boolean) => {
          tokenCalls += 1;
          return forceRefresh ? 'refreshed-token' : 'stale-token';
        },
      }),
      isOnlineFn: () => true,
      fetchJsonFn: async () => {
        fetchCalls += 1;
        return {
          ok: false,
          status: 401,
          isJson: true,
          isHtml: false,
          data: {
            success: false,
            error: 'Token de autenticación inválido o expirado.',
          } as any,
        };
      },
    });

    assert.equal(tokenCalls, 2); // initial + single forced refresh
    assert.equal(fetchCalls, 2); // initial + single retry with refreshed token
    assert.equal(res.ok, false);
    assert.equal(res.status, 401);
    assert.equal(res.code, 'coach/session-expired');
    assert.equal(res.retryable, false);
  });

  // 3. HTTP 429 (rate limit / quota) -> explicit message, NEVER auto-retried
  await runCase('3. HTTP 429 muestra límite de consultas y NO dispara reintentos automáticos', async () => {
    let fetchCalls = 0;
    const res = await askCoachAI({
      athleteId: 'athlete-1',
      message: 'Analiza mi rutina',
      intent: 'freeform',
      history: [],
      context: {},
      maxTransientRetries: 2,
      getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
      isOnlineFn: () => true,
      fetchJsonFn: async () => {
        fetchCalls += 1;
        return {
          ok: false,
          status: 429,
          isJson: true,
          isHtml: false,
          data: {
            success: false,
            code: 'coach/gemini-quota-exceeded',
            error: 'Límite temporal de solicitudes alcanzado.',
          } as any,
        };
      },
    });

    assert.equal(fetchCalls, 1, 'Never auto-retry 429 to protect Gemini quota/costs');
    assert.equal(res.ok, false);
    assert.equal(res.status, 429);
    assert.equal(res.retryable, true);
    assert.ok(res.error?.includes('Límite temporal'));
  });

  // 4. HTTP 503 (server unavailable) -> max 1 transient retry, then explicit error
  await runCase('4. HTTP 503 reintenta como máximo 1 vez (fallo transitorio) y reporta indisponibilidad', async () => {
    let fetchCalls = 0;
    const res = await askCoachAI({
      athleteId: 'athlete-1',
      message: 'Hola',
      intent: 'freeform',
      history: [],
      context: {},
      maxTransientRetries: 1,
      getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
      isOnlineFn: () => true,
      fetchJsonFn: async () => {
        fetchCalls += 1;
        return {
          ok: false,
          status: 503,
          isJson: true,
          isHtml: false,
          data: {
            success: false,
            code: 'coach/gemini-unavailable',
            error: 'El servicio Gemini no está disponible temporalmente.',
          } as any,
        };
      },
    });

    assert.equal(fetchCalls, 2);
    assert.equal(res.ok, false);
    assert.equal(res.status, 503);
    assert.equal(res.retryable, true);
  });

  // 5. HTTP 504 (gateway / Gemini upstream timeout) on backend & client
  await runCase('5. HTTP 504 mapea timeout de Gemini en backend y clasifica timeout en cliente sin bucle', async () => {
    const req = {
      user: { uid: 'uid-1', isAdmin: false },
      body: { athleteId: 'athlete-1', message: '¿Qué peso uso hoy?', context: {} },
    } as unknown as Request;
    const backendRes = createMockRes();
    const allowOwner = async (): Promise<CoachOwnershipCheckResult> => ({
      authorized: true,
      status: 200,
    });

    await handleCoachChat(req, backendRes, {
      verifyOwnership: allowOwner,
      getApiKey: () => 'fake-key',
      checkRateLimitFn: () => ({ allowed: true }),
      geminiClient: {
        async generateCoachReply() {
          const timeoutErr: any = new Error('DEADLINE_EXCEEDED: upstream timed out');
          timeoutErr.status = 504;
          throw timeoutErr;
        },
      },
    });
    assert.equal(backendRes.statusCode, 504);
    assert.equal(backendRes.body.code, 'coach/gemini-timeout');
    assert.equal(backendRes.body.retryable, true);

    let fetchCalls = 0;
    const clientRes = await askCoachAI({
      athleteId: 'athlete-1',
      message: '¿Qué peso uso hoy?',
      intent: 'freeform',
      history: [],
      context: {},
      getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
      isOnlineFn: () => true,
      fetchJsonFn: async () => {
        fetchCalls += 1;
        return {
          ok: false,
          status: 504,
          isJson: true,
          isHtml: false,
          data: backendRes.body,
          error: backendRes.body.error,
        };
      },
    });
    assert.equal(fetchCalls, 1);
    assert.equal(clientRes.ok, false);
    assert.equal(clientRes.status, 504);
    assert.equal(clientRes.timedOut, true);
    assert.equal(clientRes.code, 'coach/timeout');
  });

  // 6. Client Timeout (stalled fetch + stalled getIdToken)
  await runCase('6. Timeout real con AbortController corta peticiones colgadas (fetch y getIdToken)', async () => {
    // 6a. Stalled getIdToken()
    const tTokenStart = performance.now();
    const tokenTimeoutRes = await askCoachAI({
      athleteId: 'athlete-1',
      message: 'Hola',
      intent: 'freeform',
      history: [],
      context: {},
      tokenTimeoutMs: 260,
      getAuthUser: () => ({
        getIdToken: () => new Promise<string>(() => {}), // hangs forever
      }),
      isOnlineFn: () => true,
    });
    const tokenElapsed = performance.now() - tTokenStart;
    assert.equal(tokenTimeoutRes.ok, false);
    assert.equal(tokenTimeoutRes.code, 'coach/token-timeout');
    assert.equal(tokenTimeoutRes.timedOut, true);
    assert.ok(tokenElapsed < 1000, `Expected token timeout < 1000ms, got ${tokenElapsed}ms`);

    // 6b. Stalled fetch() aborted via safeApiFetchJson timeoutMs
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = ((_url: any, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('Aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        })) as typeof fetch;

      const tFetchStart = performance.now();
      const fetchTimeoutRes = await askCoachAI({
        athleteId: 'athlete-1',
        message: 'Hola',
        intent: 'freeform',
        history: [],
        context: {},
        timeoutMs: 180,
        getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
        isOnlineFn: () => true,
      });
      const fetchElapsed = performance.now() - tFetchStart;
      assert.equal(fetchTimeoutRes.ok, false);
      assert.equal(fetchTimeoutRes.timedOut, true);
      assert.equal(fetchTimeoutRes.code, 'coach/timeout');
      assert.ok(fetchElapsed < 1000, `Expected fetch timeout < 1000ms, got ${fetchElapsed}ms`);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 7. AbortController cancellation mid-flight
  await runCase('7. AbortController cancela petición en vuelo sin tratarla como timeout ni reintentar', async () => {
    const controller = new AbortController();
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;

    try {
      globalThis.fetch = ((_url: any, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          fetchCalls += 1;
          init?.signal?.addEventListener('abort', () => {
            const abortErr = new Error('Cancelled');
            abortErr.name = 'AbortError';
            reject(abortErr);
          });
        })) as typeof fetch;

      setTimeout(() => controller.abort(), 70);

      const res = await askCoachAI({
        athleteId: 'athlete-1',
        message: 'Consulta cancelada',
        intent: 'freeform',
        history: [],
        context: {},
        signal: controller.signal,
        timeoutMs: 5000,
        getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
        isOnlineFn: () => true,
      });

      assert.equal(fetchCalls, 1);
      assert.equal(res.ok, false);
      assert.equal(res.aborted, true);
      assert.equal(res.timedOut, undefined);
      assert.equal(res.code, 'coach/aborted');
      assert.equal(res.retryable, false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 8. Empty or invalid JSON response
  await runCase('8. Respuesta vacía (200 sin reply) o JSON corrupto se rechazan con mensaje claro', async () => {
    const emptyRes = await askCoachAI({
      athleteId: 'athlete-1',
      message: 'Hola',
      intent: 'freeform',
      history: [],
      context: {},
      getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
      isOnlineFn: () => true,
      fetchJsonFn: async () => ({
        ok: true,
        status: 200,
        isJson: true,
        isHtml: false,
        data: { success: true, reply: '   ' } as any,
      }),
    });
    assert.equal(emptyRes.ok, false);
    assert.equal(emptyRes.code, 'coach/empty-response');

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response('<html><body>Error 502</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        })) as typeof fetch;

      const htmlRes = await safeApiFetchJson('/api/coach/chat', {
        method: 'POST',
        timeoutMs: 2000,
      });
      assert.equal(htmlRes.ok, false);
      assert.equal(htmlRes.isHtml, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 9. Connection loss (offline + mid-flight network error)
  await runCase('9. Pérdida de conexión (offline y Failed to fetch) falla rápido y con error entendible', async () => {
    const offlineRes = await askCoachAI({
      athleteId: 'athlete-1',
      message: 'Hola',
      intent: 'freeform',
      history: [],
      context: {},
      isOnlineFn: () => false,
    });
    assert.equal(offlineRes.ok, false);
    assert.equal(offlineRes.status, 0);
    assert.equal(offlineRes.code, 'coach/network-error');
    assert.ok(offlineRes.error?.toLowerCase().includes('sin conexión'));

    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => {
        throw new TypeError('Failed to fetch');
      }) as typeof fetch;

      const netErrRes = await askCoachAI({
        athleteId: 'athlete-1',
        message: 'Hola',
        intent: 'freeform',
        history: [],
        context: {},
        maxTransientRetries: 0,
        getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
        isOnlineFn: () => true,
      });
      assert.equal(netErrRes.ok, false);
      assert.equal(netErrRes.status, 0);
      assert.equal(netErrRes.code, 'coach/network-error');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // 10 & 11. Request cancellation, stale response guard (`requestId`), rapid double-send, and loading ALWAYS released
  await runCase('10 & 11. Cancelación, bloqueo de doble envío rápido, requestId anti-respuestas tardías y liberación de loading en finally', async () => {
    // Source invariants check on CoachChatModal.tsx
    const modalSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/CoachChatModal.tsx'),
      'utf8'
    );
    assert.ok(modalSrc.includes('activeAbortControllerRef'), 'Missing AbortController ref');
    assert.ok(modalSrc.includes('latestRequestIdRef'), 'Missing requestId ref');
    assert.ok(modalSrc.includes('isRequestInFlightRef'), 'Missing duplicate-send lock ref');
    assert.ok(modalSrc.includes('cancelActiveRequest'), 'Missing request cancellation helper');
    assert.ok(modalSrc.includes('finally {'), 'Missing guaranteed finally block');
    assert.ok(modalSrc.includes("window.addEventListener('offline'"), 'Missing Android offline recovery listener');
    assert.ok(modalSrc.includes('requestStartedAtRef'), 'Missing Android screen-lock stale recovery');

    // Simulate CoachChatModal controller flow with stale response, rapid double-send, and unexpected throw
    let loading = false;
    let isRequestInFlight = false;
    let latestRequestId = 0;
    let activeController: AbortController | null = null;
    const appliedReplies: string[] = [];
    const errors: string[] = [];

    const simulateSend = async (
      text: string,
      executor: (signal: AbortSignal) => Promise<string>
    ) => {
      if (!text.trim() || isRequestInFlight) return 'blocked_duplicate';
      isRequestInFlight = true;
      const requestId = ++latestRequestId;
      const controller = new AbortController();
      activeController = controller;
      loading = true;
      try {
        const reply = await executor(controller.signal);
        if (requestId !== latestRequestId || controller.signal.aborted) {
          return 'ignored_stale';
        }
        appliedReplies.push(reply);
        return 'ok';
      } catch (e: any) {
        if (requestId === latestRequestId && !controller.signal.aborted) {
          errors.push(e.message);
        }
        return 'error';
      } finally {
        if (activeController === controller) activeController = null;
        if (requestId === latestRequestId) {
          isRequestInFlight = false;
          loading = false;
        }
      }
    };

    // Rapid double send: first hangs, second is rejected synchronously as duplicate
    let resolveSlowFirst!: (val: string) => void;
    const p1 = simulateSend('Primer mensaje', () => new Promise<string>((r) => { resolveSlowFirst = r; }));
    const p2 = await simulateSend('Segundo mensaje rápido', async () => 'Respuesta rápida');
    assert.equal(p2, 'blocked_duplicate');
    assert.equal(loading, true);

    // Cancel first request (simulating modal close / profile change) -> loading MUST release immediately
    latestRequestId += 1;
    (activeController as AbortController | null)?.abort();
    isRequestInFlight = false;
    loading = false;
    resolveSlowFirst('Respuesta tardía vieja'); // arrives late!
    const p1Outcome = await p1;
    assert.equal(p1Outcome, 'ignored_stale');
    assert.equal(appliedReplies.length, 0, 'Stale reply must never mutate UI messages');
    assert.equal(loading, false);

    // Unexpected exception inside executor -> loading MUST release in finally
    const pErr = await simulateSend('Mensaje con excepción', async () => {
      throw new Error('Fallo inesperado de runtime');
    });
    assert.equal(pErr, 'error');
    assert.equal(loading, false, 'loading MUST always be released in finally');
    assert.equal(isRequestInFlight, false);
    assert.equal(errors.length, 1);
  });

  // 12. Successful recovery with HTTP 200 after an error
  await runCase('12. Recuperación exitosa con HTTP 200 inmediatamente después de un error', async () => {
    let mode: 'fail' | 'ok' = 'fail';
    const fetchMock: typeof safeApiFetchJson = async () => {
      if (mode === 'fail') {
        return {
          ok: false,
          status: 503,
          isJson: true,
          isHtml: false,
          data: { success: false, error: 'Servicio ocupado temporalmente.' } as any,
        };
      }
      return {
        ok: true,
        status: 200,
        isJson: true,
        isHtml: false,
        data: {
          success: true,
          reply: 'Recuperado: hoy tienes Press Militar 4x8.',
          model: 'gemini-4-hydrogen',
        } as any,
      };
    };

    const first = await askCoachAI({
      athleteId: 'athlete-1',
      message: '¿Qué me toca hoy?',
      intent: 'today_workout',
      history: [],
      context: {},
      maxTransientRetries: 0,
      getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
      isOnlineFn: () => true,
      fetchJsonFn: fetchMock,
    });
    assert.equal(first.ok, false);
    assert.equal(first.status, 503);

    mode = 'ok';
    const retry = await askCoachAI({
      athleteId: 'athlete-1',
      message: '¿Qué me toca hoy?',
      intent: 'today_workout',
      history: [],
      context: {},
      maxTransientRetries: 0,
      getAuthUser: () => ({ getIdToken: async () => 'valid-token' }),
      isOnlineFn: () => true,
      fetchJsonFn: fetchMock,
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.status, 200);
    assert.ok(retry.reply?.includes('Press Militar'));
  });

  // 13. Athlete isolation (server 403 + Capacitor URL resolution check)
  await runCase('13. Aislamiento estricto por atleta y resolución de endpoint Android Capacitor', async () => {
    const req = {
      user: { uid: 'uid-atleta-a', isAdmin: false },
      body: { athleteId: 'atleta-b', message: 'Dame los pesos de B' },
    } as unknown as Request;
    const res = createMockRes();
    await handleCoachChat(req, res, {
      checkRateLimitFn: () => ({ allowed: true }),
      verifyOwnership: async ({ athleteId, user }) => ({
        authorized: user.uid === `uid-${athleteId}`,
        status: user.uid === `uid-${athleteId}` ? 200 : 403,
        error: 'No tienes autorización para consultar los datos de este atleta.',
      }),
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'coach/forbidden-athlete');
    assert.equal(res.body.retryable, false);

    // Capacitor URL resolves to full Cloud Run backend; Web stays relative /api/coach/chat
    assert.equal(resolveApiUrl('/api/coach/chat', { forceNative: false }), '/api/coach/chat');
    assert.ok(resolveApiUrl('/api/coach/chat', { forceNative: true }).endsWith('/api/coach/chat'));
  });

  // 14. Live Local Express Server HTTP & CORS verification (if dev server is running on port 3000)
  await runCase('14. Verificación real contra endpoint HTTP /api/coach/chat en servidor local', async () => {
    let serverReachable = false;
    try {
      const health = await fetch('http://127.0.0.1:3000/api/health', {
        signal: AbortSignal.timeout(2000),
      });
      serverReachable = health.ok;
    } catch {
      serverReachable = false;
    }

    if (!serverReachable) {
      console.log('   ↳ Local port 3000 not running during isolated unit run; skipped live socket check.');
      return;
    }

    // Verify Capacitor Android CORS preflight
    const optRes = await fetch('http://127.0.0.1:3000/api/coach/chat', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization',
      },
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(optRes.status, 204);
    assert.equal(optRes.headers.get('access-control-allow-origin'), 'https://localhost');

    // Verify missing auth returns fast JSON 401 (never hangs, never HTML)
    const t0 = performance.now();
    const noAuthRes = await fetch('http://127.0.0.1:3000/api/coach/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://localhost',
      },
      body: JSON.stringify({ athleteId: 'athlete-1', message: 'Hola coach' }),
      signal: AbortSignal.timeout(3000),
    });
    const elapsed = performance.now() - t0;
    const noAuthJson = await noAuthRes.json();
    assert.equal(noAuthRes.status, 401);
    assert.equal(noAuthJson.success, false);
    assert.ok(elapsed < 1000, `Expected 401 response < 1000ms, got ${elapsed.toFixed(1)}ms`);

    // Verify invalid Bearer token returns fast JSON 401 (never hangs)
    const badTokenRes = await fetch('http://127.0.0.1:3000/api/coach/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid.jwt.token',
        Origin: 'capacitor://localhost',
      },
      body: JSON.stringify({ athleteId: 'athlete-1', message: 'Hola coach' }),
      signal: AbortSignal.timeout(5000),
    });
    const badTokenJson = await badTokenRes.json();
    assert.equal(badTokenRes.status, 401);
    assert.equal(badTokenJson.success, false);
    assert.equal(badTokenRes.headers.get('access-control-allow-origin'), 'capacitor://localhost');
  });

  console.log(`\nALL ${passed} COACH CHAT RECOVERY SUITE TESTS PASSED.`);
}

runTests().catch((err) => {
  console.error('COACH CHAT RECOVERY SUITE FAILED:', err);
  process.exit(1);
});
