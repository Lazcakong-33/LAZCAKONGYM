import test from 'node:test';
import assert from 'node:assert/strict';
import { getServerGeminiApiKey } from '../src/server/geminiModel.ts';

test('zero cost mode blocks both credential names even if configured', () => {
  for (const flag of ['true',' TRUE ']) {
    assert.equal(getServerGeminiApiKey({LAZCAKONG_ZERO_COST_MODE:flag,GEMINI_API_KEY:'fake-primary',GOOGLE_API_KEY:'fake-secondary'}),undefined);
  }
});
test('current configuration remains backward compatible when mode is off', () => {
  assert.equal(getServerGeminiApiKey({GEMINI_API_KEY:' fake-primary ',GOOGLE_API_KEY:'fake-secondary'}),'fake-primary');
  assert.equal(getServerGeminiApiKey({LAZCAKONG_ZERO_COST_MODE:'false',GOOGLE_API_KEY:'fake-secondary'}),'fake-secondary');
  assert.equal(getServerGeminiApiKey({}),undefined);
});
