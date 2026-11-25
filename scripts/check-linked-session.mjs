import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { initializePreviewSession } from '../cloudflare/preview-session.ts';

const id = 'lazcakong-zero-cost-test';
function emulator(name) {
  const address = process.env[name];
  assert.match(address ?? '', /^(?:127\.0\.0\.1|localhost):\d+$/, name + ' must point to a local emulator');
  return 'http://' + address;
}
const auth = emulator('FIREBASE_AUTH_EMULATOR_HOST');
const db = emulator('FIRESTORE_EMULATOR_HOST');
const docs = '/v1/projects/' + id + '/databases/(default)/documents';
const env = await initializeTestEnvironment({
  projectId: id, firestore: { rules: readFileSync('firestore.preview.rules', 'utf8') },
});

async function account(label) {
  const email = label + '-' + crypto.randomUUID() + '@example.invalid';
  const password = crypto.randomUUID();
  async function call(method) {
    const r = await fetch(auth + '/identitytoolkit.googleapis.com/v1/accounts:' + method + '?key=demo', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    assert.equal(r.status, 200);
    return r.json();
  }
  const created = await call('signUp');
  return { uid: created.localId, login: () => call('signInWithPassword') };
}

function firebase(url, options) {
  const parsed = new URL(url);
  const hosts = { 'identitytoolkit.googleapis.com': auth + '/identitytoolkit.googleapis.com', 'firestore.googleapis.com': db };
  assert.ok(Object.hasOwn(hosts, parsed.hostname));
  return fetch(hosts[parsed.hostname] + parsed.pathname + parsed.search, options);
}

async function session(token) {
  return initializePreviewSession(new Request('https://preview.invalid/api/auth/session-init', {
    headers: { Authorization: 'Bearer ' + token },
  }), 'demo', firebase, true);
}

try {
  const owner = await account('owner');
  const other = await account('other');
  const athleteId = 'previous-profile-' + crypto.randomUUID();
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), 'athletes', athleteId), {
    id: athleteId, authUid: owner.uid, history: [{ id: 'previous-workout' }],
  }));
  const first = await owner.login();
  const login = await session(first.idToken);
  assert.equal(login.status, 200);
  assert.equal((await login.json()).athleteId, athleteId);
  const profile = db + docs + '/athletes/' + athleteId;
  function access(token, method = 'GET', fields) {
    return fetch(profile + (fields ? '?updateMask.fieldPaths=history' : ''), {
      method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: fields && JSON.stringify({ fields }),
    });
  }
  const before = await access(first.idToken);
  assert.equal(before.status, 200);
  const history = (await before.json()).fields.history.arrayValue.values;
  assert.equal(history[0].mapValue.fields.id.stringValue, 'previous-workout');
  const newHistory = { history: { arrayValue: { values: [...history, { mapValue: { fields: { id: { stringValue: 'second-workout' } } } }] } } };
  assert.equal((await access(first.idToken, 'PATCH', newHistory)).status, 200);
  const outsider = await other.login();
  assert.equal((await session(outsider.idToken)).status, 403);
  assert.equal((await access(outsider.idToken)).status, 403);
  assert.equal((await access(outsider.idToken, 'PATCH', newHistory)).status, 403);
  const next = await owner.login();
  assert.equal((await (await session(next.idToken)).json()).athleteId, athleteId);
  const restored = (await (await access(next.idToken)).json()).fields;
  assert.deepEqual(restored.history, newHistory.history);
  assert.equal(restored.authUid.stringValue, owner.uid);
  console.log('Two emulator accounts: original profile, saved history, repeat sign-in and cross-account denial passed.');
} finally {
  await env.cleanup();
}
