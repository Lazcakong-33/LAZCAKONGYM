import assert from 'node:assert/strict';
import { EXERCISE_LIBRARY, getLibraryCoverageAudit16, resolveLibraryExercise } from '../../data/exerciseLibrary';
import { NECK_EXERCISE_ADDITIONS } from '../../data/neckExerciseAdditions';
import { getNeckMovementSpec } from '../../utils/neckMovementSpec';

const neck = EXERCISE_LIBRARY.filter((ex) => ex.canonicalGroup16 === 'cuello' || ex.muscleGroup === 'Cuello');
assert.equal(neck.length, 20, 'Neck catalog must have 20 distinct cervical technique cards');
assert.equal(NECK_EXERCISE_ADDITIONS.length, 8, 'Eight new cards added without rewriting existing IDs');
assert.equal(new Set(neck.map((ex) => ex.id)).size, neck.length, 'No duplicate neck IDs');
assert.equal(new Set(neck.map((ex) => ex.name.toLocaleLowerCase('es'))).size, neck.length, 'No duplicate card names');

for (const ex of neck) {
  const demo = getNeckMovementSpec(ex);
  assert.ok(demo, 'Missing animation pattern for ' + ex.name);
  assert.equal(ex.visualResourceStatus, 'frame_sequence', 'Not marked as animated vector demo: ' + ex.name);
  assert.equal(ex.frames, 8, 'Eight animation stages required: ' + ex.name);
  assert.equal(ex.durationMs, 4000, 'Four-second loop required: ' + ex.name);
  assert.equal(ex.animationUrl, undefined, 'Cannot fabricate a GIF URL: ' + ex.name);
  assert.equal(ex.videoUrl, null, 'Cannot fabricate a video: ' + ex.name);
  assert.ok(ex.startingPosition && ex.activePhase && ex.returnPhase, 'Incomplete steps: ' + ex.name);
  assert.ok(ex.safetyWarnings?.length, 'Missing safety guidance: ' + ex.name);
  assert.equal(resolveLibraryExercise({ id: ex.id })?.id, ex.id, 'Failed resolving by original ID: ' + ex.id);
}

const isometric = neck.filter((ex) => getNeckMovementSpec(ex)?.isometric);
assert.ok(isometric.length >= 10, 'Resisted isometrics must stay distinct from moving demonstrations');
const band = neck.filter((ex) => getNeckMovementSpec(ex)?.resistance === 'band');
assert.ok(band.length >= 5, 'All five existing elastic-band cervical exercises must be recognized');
assert.ok(isometric.every((ex) => getNeckMovementSpec(ex)?.kind.startsWith('iso-')),
  'Isometric exercise must never show dynamic flexion, tilt or head rotation');
assert.ok(!getNeckMovementSpec({ name:'Press de banca con barra hasta el cuello', muscleGroup:'Pecho', equipment:'Barra' }),
  'Bench press must never receive a cervical demo');
const audit = getLibraryCoverageAudit16();
assert.equal(audit.byGroup16.find((g) => g.id === 'cuello')?.currentCount, 20);
console.log('NECK LIBRARY SUITE PASSED: 20/20 unique cards, 20/20 motion patterns, 5 band variations, 4-second loops.');
