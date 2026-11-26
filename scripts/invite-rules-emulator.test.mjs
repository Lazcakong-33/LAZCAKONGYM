import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';

const contingency = process.env.RULES_MODE === 'contingency';
const rules = readFileSync(contingency ? 'contingency_firestore.rules' : 'firestore.rules', 'utf8');
const email = rules.match(/email\.lower\(\) == '([^']+)'/)?.[1];
assert.ok(email);
const projectId = 'demo-lazcakongym-test';
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Emulator required; never use production');
const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
assert.ok(host === 'localhost' || host === '127.0.0.1', 'Local emulator only');
test('invite security: admin identity, atomic single use, revocation and contingency', async () => {
  const env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules } });
  try {
    await env.clearFirestore();
    const db = (uid, token = {}) => env.authenticatedContext(uid, token).firestore();
    const google = { email, email_verified: true, firebase: { sign_in_provider: 'google.com' } };
    const admin = db('test-admin', google);
    const athlete = db('test-athlete');
    const other = db('test-other');
    const spoof = db('test-spoof', { ...google, email_verified: false });
    const password = db('test-password', { ...google, firebase: { sign_in_provider: 'password' } });
    const guest = env.unauthenticatedContext().firestore();
    const hash = 'a'.repeat(64);
    const createdAt = '2026-11-26T00:00:00Z';
    const invite = { token: 'test-invite', createdAt, createdBy: 'test-admin', used: false, revoked: false };
    const mirror = { active: true, used: false, revoked: false, createdAt };
    const ref = (d, col = 'invites', id = hash) => doc(d, col, id);
    await assertFails(setDoc(ref(athlete), invite));
    await assertFails(setDoc(ref(spoof), invite));
    await assertFails(setDoc(ref(password), invite));
    await assertSucceeds(setDoc(ref(admin), invite));
    await assertSucceeds(getDocs(collection(admin, 'invites')));
    await assertFails(getDocs(collection(athlete, 'invites')));
    await assertFails(getDoc(ref(guest)));
    if (contingency) {
      await assertFails(updateDoc(ref(athlete), { used: true, usedByUid: 'test-athlete' }));
      await assertSucceeds(updateDoc(ref(admin), { revoked: true }));
      return;
    }
    await assertSucceeds(setDoc(ref(admin, 'invite_lookup'), mirror));
    await assertSucceeds(getDoc(ref(guest, 'invite_lookup')));
    await assertFails(getDocs(collection(guest, 'invite_lookup')));
    await assertFails(updateDoc(ref(athlete), { used: true, usedByUid: 'test-athlete' }));
    await assertFails(updateDoc(ref(athlete, 'invite_lookup'), { used: true, active: false }));
    const redeem = (d, uid, id = hash) => {
      const batch = writeBatch(d);
      batch.update(ref(d, 'invites', id), { used: true, usedByUid: uid, usedAt: createdAt });
      batch.update(ref(d, 'invite_lookup', id), { used: true, active: false, usedAt: createdAt });
      return batch.commit();
    };
    await assertFails(redeem(athlete, 'test-other'));
    await assertSucceeds(redeem(athlete, 'test-athlete'));
    await assertFails(redeem(other, 'test-other'));
    assert.equal((await getDoc(ref(admin))).data().usedByUid, 'test-athlete');
    const revokedHash = 'b'.repeat(64);
    await assertSucceeds(setDoc(ref(admin, 'invites', revokedHash), { ...invite, revoked: true }));
    await assertSucceeds(setDoc(ref(admin, 'invite_lookup', revokedHash), { ...mirror, active: false, revoked: true }));
    await assertFails(redeem(athlete, 'test-athlete', revokedHash));
    await assertFails(deleteDoc(ref(athlete, 'invites', revokedHash)));
    await assertSucceeds(deleteDoc(ref(admin, 'invites', revokedHash)));
  } finally { await env.cleanup(); }
});
