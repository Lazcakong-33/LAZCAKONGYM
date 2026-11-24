import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { handleCoachStatus, type CoachControllerDeps } from '../coachController.ts';
import { getServerGeminiApiKey } from '../geminiModel.ts';

function fakeResponse() {
  const res: any = {
    statusCode: 200, body: null, headers: {} as Record<string, string>,
    status(n: number) { this.statusCode = n; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
    json(data: unknown) { this.body = data; return this; },
  };
  return res;
}

async function main() {
  let checks = 0;
  const check = async (name: string, fn: () => void | Promise<void>) => {
    await fn(); checks += 1; console.log('PASS', name);
  };

  await check('1. Server-only Gemini keys: correct fallback and no accidental environment leaks', () => {
    assert.equal(getServerGeminiApiKey({ GEMINI_API_KEY: '  secret-A ' } as NodeJS.ProcessEnv), 'secret-A');
    assert.equal(getServerGeminiApiKey({ GOOGLE_API_KEY: '  secret-B ' } as NodeJS.ProcessEnv), 'secret-B');
    assert.equal(getServerGeminiApiKey({ GEMINI_API_KEY: 'A', GOOGLE_API_KEY: 'B' } as NodeJS.ProcessEnv), 'A');
    assert.equal(getServerGeminiApiKey({} as NodeJS.ProcessEnv), undefined);
  });

  await check('2. Unauthenticated status: deny access', async () => {
    const req: any = { body: { athleteId: 'athlete-test' } };
    const res = fakeResponse();
    await handleCoachStatus(req, res);
    assert.equal(res.statusCode, 401);
  });

  const user: any = { uid: 'test-uid', email: 'test@example.invalid', isAdmin: false };
  const allowedOwner: CoachControllerDeps['verifyOwnership'] = async () => ({
    authorized: true, status: 200,
  });

  await check('3. Missing Gemini credential: show accurate preflight failure without pretending connected', async () => {
    const res = fakeResponse();
    await handleCoachStatus({ body: { athleteId: 'athlete-test' }, user } as any, res, {
      verifyOwnership: allowedOwner, getApiKey: () => undefined,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.readyForLiveRequest, false);
    assert.equal(res.body.geminiConfigured, false);
    assert.equal(res.body.athleteAuthorized, true);
    assert.match(res.body.message, /GEMINI_API_KEY/);
  });

  await check('4. Configured credential: confirm only preflight, never expose API key', async () => {
    const res = fakeResponse();
    await handleCoachStatus({ body: { athleteId: 'athlete-test' }, user } as any, res, {
      verifyOwnership: allowedOwner, getApiKey: () => 'server-secret-never-leak',
    });
    assert.equal(res.body.readyForLiveRequest, true);
    assert.equal(res.body.geminiConfigured, true);
    assert.ok(!JSON.stringify(res.body).includes('server-secret-never-leak'));
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.match(res.body.message, /Envía una pregunta/);
  });

  await check('5. Wrong athlete owner: no access even with Gemini credentials', async () => {
    const res = fakeResponse();
    await handleCoachStatus({ body: { athleteId: 'somebody-else' }, user } as any, res, {
      verifyOwnership: async () => ({ authorized: false, status: 403, error: 'Perfil no autorizado.' }),
      getApiKey: () => 'server-secret',
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.athleteAuthorized, false);
    assert.equal(res.body.readyForLiveRequest, false);
    assert.ok(!JSON.stringify(res.body).includes('server-secret'));
  });

  await check('6. Status route is auth-protected and does not expose secrets', () => {
    const server = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
    const start = server.indexOf("app.post('/api/coach/status'");
    const end = server.indexOf("// Coach LazcaKong IA Authenticated Chat Endpoint", start);
    assert.ok(start > 0 && end > start);
    const block = server.slice(start, end);
    assert.ok(block.includes('verifyAuthTokenMiddleware'));
    assert.ok(!block.includes('getServerGeminiApiKey()'));
    assert.ok(!block.includes('GEMINI_API_KEY'));
  });

  await check('7. Update Now button stays visible after verified automatic OTA staging', () => {
    const hook = fs.readFileSync(path.resolve(process.cwd(), 'src/hooks/useAppUpdate.ts'), 'utf8');
    const banner = fs.readFileSync(path.resolve(process.cwd(), 'src/components/UpdateBanner.tsx'), 'utf8');
    assert.ok(hook.includes("result.status === 'staged_for_background'"));
    const segment = hook.slice(hook.indexOf("if (result.status === 'staged_for_background')"),
      hook.indexOf("if (result.status === 'deferred_unsafe')"));
    assert.ok(segment.includes('setOtaPendingManifest(manifest)'));
    assert.ok(segment.includes('setHasUpdateAvailable(true)'));
    assert.ok(hook.includes('applyImmediatelyWhenSafe: false'));
    assert.ok(banner.includes('ACTUALIZAR AHORA'));
    assert.ok(banner.includes('getAppUpdateSafetyStatus()'));
  });

  await check('8. Routine generation never mislabels catalog fallback as Gemini', () => {
    const generator = fs.readFileSync(path.resolve(process.cwd(), 'src/server/geminiRoutineGenerator.ts'), 'utf8');
    const server = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
    const modal = fs.readFileSync(path.resolve(process.cwd(), 'src/components/AIRoutineGeneratorModal.tsx'), 'utf8');
    assert.ok(generator.includes('rutina-local-'));
    assert.ok(server.includes("generationSource = routine.id.startsWith('rutina-local-')"));
    assert.ok(modal.includes('MODO LOCAL · NO ES RESPUESTA DE IA'));
    assert.ok(modal.includes('ORIGEN SIN VERIFICAR'));
    assert.ok(modal.includes('safeApiFetchJson'));
    assert.ok(modal.includes('timeoutMs: 20_000'));
  });

  await check('9. Coach UI includes authenticated readiness diagnosis and retry', () => {
    const modal = fs.readFileSync(path.resolve(process.cwd(), 'src/components/CoachChatModal.tsx'), 'utf8');
    const diagnostic = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/coachServiceDiagnostics.ts'), 'utf8');
    assert.ok(modal.includes('coach-service-diagnostic'));
    assert.ok(modal.includes('Comprobar conexión'));
    assert.ok(diagnostic.includes("Authorization: `Bearer ${token}`"));
    assert.ok(!diagnostic.includes('VITE_GEMINI_API_KEY'));
  });

  console.log('COACH + UPDATE READINESS SUITE PASSED', checks);
}
main().catch((err) => { console.error(err); process.exit(1); });
