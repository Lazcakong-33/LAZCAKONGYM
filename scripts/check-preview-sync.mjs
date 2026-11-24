import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

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
  console.log('Preview Firestore sync and isolation passed in two independent clients.');
} finally {
  await env.cleanup();
}
