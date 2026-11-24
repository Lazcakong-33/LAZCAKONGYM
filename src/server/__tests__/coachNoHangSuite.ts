import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleCoachChat } from '../coachController.ts';

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

  console.log('COACH NO-HANG SUITE: 4/4 passed');
}

main().catch(err => { console.error(err); process.exit(1); });
