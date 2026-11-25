import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { previewInvites } from '../cloudflare/preview-invites.ts';

const project = 'lazcakong-zero-cost-test';
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(host ?? '', /^(localhost|127\.0\.0\.1):\d+$/);
const env = await initializeTestEnvironment({ projectId: project, firestore: { rules: readFileSync('firestore.preview.rules','utf8') } });
const adminEmail = 'kmiloko19@gmail.com';

// The emulator accepts unsigned fixtures only on loopback.
function fixture(email, provider = 'google.com', verified = true) {
  const now = Math.floor(Date.now()/1000);
  const claims = { aud:project, iss:'https://securetoken.google.com/'+project, sub:'fixture', user_id:'fixture',
    email_verified:verified,email,iat:now,exp:now+3600,auth_time:now,firebase:{sign_in_provider:provider,identities:{}} };
  return Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.';
}
const admin = fixture(adminEmail);
const regular = fixture('athlete@example.invalid');
const call = (method, suffix = '', token = admin, body) => previewInvites(new Request('https://preview.invalid/api/admin/invites'+suffix,{
  method, headers:{ Authorization:'Bearer '+token, 'Content-Type':'application/json' }, body: body && JSON.stringify(body),
}), (url,options) => {
  const parsed = new URL(url);
  assert.equal(parsed.hostname,'firestore.googleapis.com');
  return fetch('http://'+host+parsed.pathname+parsed.search,options);
});
try {
  assert.equal((await call('GET','',regular)).status,403);
  assert.equal((await call('POST','',regular,{})).status,403);
  assert.equal((await call('GET','',fixture(adminEmail,'password'))).status,403);
  assert.equal((await call('GET','',fixture(adminEmail,'google.com',false))).status,403);
  assert.equal((await call('GET','','invalid token')).status,401);
  assert.equal((await call('POST','/batch',admin,{count:0})).status,400);
  assert.equal((await call('POST','/batch',admin,{count:51})).status,400);
  assert.equal((await call('POST','/batch',admin,{count:1.5})).status,400);
  assert.equal((await call('POST','/batch',regular,{count:2})).status,403);
  const single = await call('POST','',admin,{note:'fixture'});
  assert.equal(single.status,201);
  const {invite} = await single.json();
  const batch = await call('POST','/batch',admin,{count:2});
  assert.equal(batch.status,201);
  assert.equal((await batch.json()).tokens.length,2);
  const list = await call('GET');
  assert.equal(list.status,200);
  assert.ok((await list.json()).invites.some(x=>x.token===invite.token && x.note==='fixture'));
  assert.equal((await call('DELETE','/'+invite.token,regular)).status,403);
  assert.equal((await call('DELETE','/'+invite.token)).status,200);
  assert.ok(!(await (await call('GET')).json()).invites.some(x=>x.token===invite.token));
  console.log('Admin invitations: list, create, batch, revoke and role isolation passed.');
} finally { await env.cleanup(); }
