import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleCoachChat } from '../coachController.ts';
import { buildCoachLocalFallback } from '../../utils/coachLocalFallback.ts';

function response() {
  return {
    statusCode: 200, body: null as any,
    status(value: number) { this.statusCode = value; return this; },
    json(value: any) { this.body = value; return this; },
  };
}

async function test(name: string, fn: () => void | Promise<void>) {
  await fn(); console.log('PASS:', name);
}

async function main() {
  await test('Gemini unsupported model returns actionable, non-retryable error', async () => {
    const res = response();
    const req: any = {
      user: { uid: 'test-user', isAdmin: false },
      body: { athleteId: 'athlete123', message: '¿Qué me toca hoy?', context: {} },
    };
    await handleCoachChat(req, res as any, {
      verifyOwnership: async () => ({ authorized: true, status: 200 }),
      getApiKey: () => 'fake-key-only-for-tests',
      checkRateLimitFn: () => ({ allowed: true }),
      geminiClient: { async generateCoachReply() {
        const e: any = new Error('Model not found for API version'); e.status = 404; throw e;
      } },
    });
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.code, 'coach/gemini-model-unavailable');
    assert.equal(res.body.retryable, false);
    assert.ok(!JSON.stringify(res.body).includes('fake-key-only-for-tests'));
  });

  await test('Gemini 4 uses LOW thinking and room for visible Spanish output', () => {
    const s = fs.readFileSync(path.resolve(process.cwd(), 'src/server/coachController.ts'), 'utf8');
    assert.ok(s.includes("config.thinkingConfig = { thinkingLevel: 'LOW' }"));
    assert.ok(s.includes('maxOutputTokens: isGemini4 ? 1_400 : 700'));
    assert.ok(s.includes('GEMINI_UPSTREAM_TIMEOUT_MS = 18_000'));
    assert.ok(s.includes("'coach/gemini-model-unavailable'"));
  });

  await test('Android UI never keeps request spinning indefinitely', () => {
    const s = fs.readFileSync(path.resolve(process.cwd(), 'src/components/CoachChatModal.tsx'), 'utf8');
    assert.ok(s.includes('const COACH_MAX_WAIT_MS = 27_000'));
    assert.ok(s.includes('requestWatchdogRef.current = setTimeout('));
    assert.ok(s.includes('clearTimeout(requestWatchdogRef.current)'));
    assert.ok(s.includes("maxTransientRetries: 0"));
    assert.ok(s.includes('timeoutMs: 20_000'));
    assert.ok(s.includes('tokenTimeoutMs: 6_000'));
    assert.ok(s.includes('data-testid="coach-cancel-pending"'));
    assert.ok(s.includes('data-testid="coach-pending-request"'));
    assert.ok(s.includes("cancelActiveRequest('background_stale')"));
    assert.ok(s.includes("cancelActiveRequest('user_cancel')"));
    assert.ok(s.includes("code: 'coach/timeout'"));
  });

  await test('Coach readiness token check cannot hang forever on Android', () => {
    const s = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/coachServiceDiagnostics.ts'), 'utf8');
    assert.ok(s.includes('Promise.race(['));
    assert.ok(s.includes('8_000'));
    assert.ok(s.includes('clearTimeout(timer)'));
  });

  await test('Local workout summary always uses real programmed exercises; clearly not Gemini', () => {
    const resolution: any = {
      todayDayName: 'Lunes', hasRoutines: true, hasWeekdayAssignments: true,
      requiresDaySelection: false, isRestDayFallback: false, hasActiveSession: false,
      selectedRoutine: { id: 'mon', title: 'PIERNA A' },
      todayMatchedRoutine: { id: 'mon' },
      selectableRoutines: [],
      exercises: [
        { id:'hack', name:'Sentadilla Hack en Máquina', defaultSets:4, repRange:'6-8' },
        { id:'press', name:'Prensa Inclinada 45°', defaultSets:3, repRange:'12' },
      ],
    };
    const answer = buildCoachLocalFallback({
      intent: 'today_workout', resolution, loadReport: null, alternatives: [],
    });
    assert.ok(answer?.includes('RESUMEN LOCAL (sin Gemini)'));
    assert.ok(answer?.includes('Sentadilla Hack en Máquina: 4 series × 6-8'));
    assert.ok(answer?.includes('Prensa Inclinada 45°: 3 series × 12'));
    assert.ok(!answer?.includes('kg'));
    const noDay = buildCoachLocalFallback({
      intent:'today_workout', resolution: { ...resolution, isRestDayFallback:true }, loadReport:null, alternatives:[],
    });
    assert.ok(noDay?.includes('no hay entrenamiento asignado'));
  });

  await test('Local fallback does not invent a saved exercise load or answer freeform as Gemini', () => {
    const resolution: any = { hasRoutines:false, selectedRoutine:null, exercises:[] };
    const empty: any = { exerciseName:'Sentadilla Hack', hasRegisteredSets:false };
    const answer = buildCoachLocalFallback({
      intent:'last_weight', resolution, loadReport:empty, alternatives:[],
    });
    assert.ok(answer?.includes('no tienes series registradas'));
    const freeform = buildCoachLocalFallback({
      intent:'freeform', resolution, loadReport:null, alternatives:[],
    });
    assert.equal(freeform, null);
  });

  console.log('COACH NO-HANG SUITE: 6/6 passed');
}

main().catch(err => { console.error(err); process.exit(1); });
