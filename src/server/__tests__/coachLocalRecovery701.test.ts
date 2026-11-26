import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUseCoachLocalFallback, resolveCoachLocalIntent } from '../../utils/coachLocalFallback.ts';

test('recover known provider errors without bypassing auth', () => {
  for (const [status, code] of [[502,'coach/gemini-empty-response'],[404,'coach/endpoint-not-found'],[429,'coach/rate-limit'],[503,'coach/server-unavailable'],[0,'coach/network-error'],[200,'coach/empty-response']] as const)
    assert.equal(canUseCoachLocalFallback(status, code), true);
  for (const [status, code] of [[401,'coach/session-expired'],[403,'coach/forbidden-athlete'],[409,undefined],[0,'coach/token-timeout'],[502,'coach/proxy-auth-required'],[0,'coach/aborted'],[0,undefined]] as const)
    assert.equal(canUseCoachLocalFallback(status, code), false);
});
test('typed question does not inherit the previous quick action', () => {
  assert.equal(resolveCoachLocalIntent('¿Qué entreno hoy?'), 'today_workout');
  assert.equal(resolveCoachLocalIntent('¿Qué alternativa tengo si está ocupada?'), 'replace_exercise');
  assert.equal(resolveCoachLocalIntent('¿Cuánto peso levanté la última vez?'), 'last_weight');
  assert.equal(resolveCoachLocalIntent('Explícame la hipertrofia'), 'freeform');
});
