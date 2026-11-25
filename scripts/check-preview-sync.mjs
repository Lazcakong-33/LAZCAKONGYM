import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-lazcakong-preview-sync',
  firestore: { rules: readFileSync('firestore.preview.rules', 'utf8') },
});

try {
  const uid = 'athlete-synthetic';
  const firstDevice = env.authenticatedContext(uid).firestore();
  const secondDevice = env.authenticatedContext(uid).firestore();
  const anotherAthlete = env.authenticatedContext('another-athlete').firestore();
  const ownAthlete = (db) => doc(db, 'athletes', uid);
  const routines = [{ id: 'routine-synthetic', title: 'Rutina de prueba' }];
  const history = [{ id: 'workout-synthetic', date: '2026-11-24' }];
  await setDoc(ownAthlete(firstDevice), { routines }, { merge: true });
  await setDoc(ownAthlete(firstDevice), { history }, { merge: true });
  assert.deepEqual((await getDoc(ownAthlete(secondDevice))).data(), { routines, history });
  await assertFails(getDoc(ownAthlete(anotherAthlete)));
  await assertFails(setDoc(ownAthlete(anotherAthlete), { history: [] }, { merge: true }));
  await assertFails(setDoc(ownAthlete(firstDevice), { isAdmin: true }, { merge: true }));
  await assertFails(setDoc(ownAthlete(firstDevice), { authUid: 'another-athlete' }, { merge: true }));
  await assertFails(getDoc(ownAthlete(env.unauthenticatedContext().firestore())));
  const legacyId = 'existing-profile-id';
  const legacyUid = 'existing-auth-uid';
  const legacyProfile = { id: legacyId, authUid: legacyUid, routines, history };
  await env.withSecurityRulesDisabled((context) =>
    setDoc(doc(context.firestore(), 'athletes', legacyId), legacyProfile)
  );
  const linked = env.authenticatedContext(legacyUid).firestore();
  const findLinked = (db) => query(collection(db, 'athletes'), where('authUid', '==', legacyUid), limit(2));
  const result = await getDocs(findLinked(linked));
  assert.equal(result.size, 1);
  assert.equal(result.docs[0].id, legacyId);
  assert.deepEqual(result.docs[0].data(), legacyProfile);
  assert.deepEqual((await getDoc(doc(linked, 'athletes', legacyId))).data(), legacyProfile);
  await assertFails(getDocs(findLinked(anotherAthlete)));
  await assertFails(getDoc(doc(anotherAthlete, 'athletes', legacyId)));
  await assertFails(setDoc(doc(linked, 'athletes', legacyId), { authUid: 'another-athlete' }, { merge: true }));
  await assertFails(setDoc(doc(linked, 'athletes', legacyId), { isAdmin: true }, { merge: true }));
  await assertFails(getDocs(query(collection(linked, 'athletes'), limit(2))));
  await setDoc(doc(linked, 'athletes', legacyId), { history: [...history, { id: 'another-workout' }] }, { merge: true });
  const saved = (await getDoc(doc(linked, 'athletes', legacyId))).data();
  assert.equal(saved.authUid, legacyUid);
  assert.deepEqual(saved.routines, routines);
  assert.equal(saved.history.length, 2);
  console.log('Preview Firestore sync and isolation passed in two independent clients.');
} finally {
  await env.cleanup();
}
