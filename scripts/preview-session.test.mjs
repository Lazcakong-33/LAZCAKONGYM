import assert from 'node:assert/strict';
import test from 'node:test';
import { initializePreviewSession } from '../cloudflare/preview-session.ts';

const project = 'lazcakong-zero-cost-test';
const uid = 'synthetic-account';
const claims = {
  aud: project, iss: 'https://securetoken.google.com/' + project,
  sub: uid, firebase: { sign_in_provider: 'password' },
};
const request = new Request('https://preview.invalid/api/auth/session-init', {
  headers: { Authorization: 'Bearer test.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.test' },
});

async function session(ids, strict = false) {
  const calls = [];
  const fetchFirebase = async (url, options) => {
    if (url.includes('/accounts:lookup')) return Response.json({ users: [{ localId: uid }] });
    if (url.endsWith(':runQuery')) {
      const { structuredQuery } = JSON.parse(options.body);
      assert.equal(structuredQuery.where.fieldFilter.value.stringValue, uid);
      assert.equal(structuredQuery.limit, 2);
      return Response.json(ids.map(id => ({ document: {
        name: 'projects/' + project + '/databases/(default)/documents/athletes/' + id,
        fields: { authUid: { stringValue: uid } },
      } })));
    }
    calls.push({ url, method: options.method ?? 'GET' });
    return Response.json({});
  };
  const response = await initializePreviewSession(request, 'test', fetchFirebase, strict);
  return { body: await response.json(), status: response.status, calls };
}

test('an existing link opens the original athlete without creating a second profile', async () => {
  const result = await session(['legacy-id']);
  assert.equal(result.status, 200);
  assert.equal(result.body.athleteId, 'legacy-id');
  assert.deepEqual(result.calls, []);
});

test('an unlinked preview account keeps its UID profile', async () => {
  const result = await session([]);
  assert.equal(result.status, 200);
  assert.equal(result.body.athleteId, uid);
  assert.equal(result.calls.length, 1);
  assert.ok(result.calls[0].url.endsWith('/athletes/' + uid));
  assert.equal(result.calls[0].method, 'GET');
});

test('ambiguous links and missing required links stop before profile initialization', async () => {
  for (const [ids, status] of [[['first', 'second'], 503], [[], 403]]) {
    const result = await session(ids, true);
    assert.equal(result.status, status);
    assert.deepEqual(result.calls, []);
  }
});
