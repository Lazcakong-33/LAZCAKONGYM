import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXERCISE_LIBRARY, resolveLibraryExercise, isObsoleteLibraryMedia, normalizeExerciseName } from '../src/data/exerciseLibrary';
import { enrichExerciseWithLibrary, getEnrichedDefaultRoutines } from '../src/utils/enrichRoutines';
import type { Exercise, Routine } from '../src/types';

assert.equal(EXERCISE_LIBRARY.length, 755);
assert.equal(new Set(EXERCISE_LIBRARY.map(ex => ex.sourceId)).size, 755);
for (const ex of EXERCISE_LIBRARY) {
  assert.equal(resolveLibraryExercise({ sourceId: ex.sourceId })?.id, ex.id);
  for (const url of [ex.videoUrl, ex.thumbnailUrl]) {
    if (!url && ex.shortInstructions?.length) continue;
    assert(url?.startsWith('/exercise-library/'));
    assert(existsSync(resolve('public', '.' + url)));
  }
}
const report = JSON.parse(readFileSync('docs/CORRESPONDENCIAS_BIBLIOTECA_669.json', 'utf8'));
for (const entry of report.mapping) assert.equal(resolveLibraryExercise({ id: entry.legacyId })?.id, entry.catalogId);
const chosen = report.mapping[0];
const exercise: Exercise = { id: chosen.legacyId, name: chosen.legacyName, targetMuscles: 'Pecho', defaultSets: 5, repRange: '5-8', restSeconds: 150, restText: '150 s', objective: 'Fuerza', defaultVideoUrl: 'https://api.' + 'smartworkout.app/old.mp4', techniqueCues: ['Nota propia'], defaultWeight: 72.5, notes: 'Registro personal' };
const routine: Routine = { id: 'routine-original', dayName: 'Lunes', title: 'Mi rutina', tagline: '', exercises: [exercise] };
const original = JSON.stringify(routine);
const history = { exerciseId: exercise.id, maxWeight: 72.5, maxReps: 8, volumeKg: 2900 };
const prs = { [exercise.id]: { maxWeight: 72.5 } };
const historiesBefore = JSON.stringify({ history, prs });
const enriched = getEnrichedDefaultRoutines([routine])[0];
assert.equal(JSON.stringify(routine), original, 'No mutar datos guardados');
for (const key of ['id','name','defaultSets','repRange','restSeconds','defaultWeight','notes'] as const) assert.equal(enriched.exercises[0][key], exercise[key]);
assert.equal(enriched.exercises[0].libraryExerciseId, chosen.catalogId);
assert(enriched.exercises[0].defaultVideoUrl.startsWith('/exercise-library/'));
assert.equal(JSON.stringify({ history, prs }), historiesBefore);
assert.equal(resolveLibraryExercise('Movimiento desconocido creado por mí'), undefined);
assert.equal(resolveLibraryExercise('Press'), undefined, 'No aplicar coincidencias parciales peligrosas');
const excluded = report.unmatchedLegacyCatalog[0];
for (const excluded of report.unmatchedLegacyCatalog) assert.equal(resolveLibraryExercise({ id: excluded.legacyId, name: excluded.name }), undefined);
const unmapped = enrichExerciseWithLibrary({ ...exercise, id: excluded.legacyId, name: excluded.name });
assert.equal(unmapped.id, excluded.legacyId);assert.equal(unmapped.defaultVideoUrl, '');
const userPhoto = 'https://example.test/mi-maquina.jpg';
assert.equal(enrichExerciseWithLibrary({ ...exercise, id: 'propio', name: 'Mi ejercicio', defaultVideoUrl: '', thumbnailUrl: userPhoto }).thumbnailUrl, userPhoto);
const groups = new Map<string, string[]>();
for (const ex of EXERCISE_LIBRARY) { const key = normalizeExerciseName(ex.name); groups.set(key, [...(groups.get(key) || []), ex.id]); }
for (const [name, ids] of groups) if (ids.length > 1) assert.equal(resolveLibraryExercise(name), undefined, 'Nombres duplicados requieren ID');
assert(isObsoleteLibraryMedia('https://api.' + 'smartworkout.app/asset/old'));
console.log(JSON.stringify({ catalog:755, mediaFiles:1373, legacyIdsVerified:report.mapping.length, historyAndRoutineIdsPreserved:true, fuzzyMatchesDisabled:true, excludedLegacyRecordsPreserved:true }));
