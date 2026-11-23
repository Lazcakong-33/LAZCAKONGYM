import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EXERCISE_LIBRARY,
  filterExerciseCatalog,
  getExerciseFallbackAnimationUrl,
  getLibraryCoverageAudit16,
  getLibraryExerciseById,
  resolveLibraryExercise,
  resolveVisualResourceStatus,
} from '../../data/exerciseLibrary';
import {
  LEGACY_UUID_RESOLUTION_AUDIT,
  normalizeHistoricalWorkoutRecord,
  resolveCanonicalExerciseIdentity,
} from '../../utils/historyRecoveryEngine';
import { buildTechniqueProProfile, libraryItemToExercise } from '../../utils/exerciseAlternatives';
import { isIsolationExercise, sanitizeExerciseRepRange } from '../../utils/progressionEngine';
import { computeRealTimeRecovery } from '../../utils/muscleRecoveryEngine';

const STAGE_2A_IDS = [
  'aa5dabc7-300e-4fc4-99d7-32bc05815966',
  'e83f2499-d624-417b-9bf0-b1f1430de20e',
  '68316f71-8691-4276-af57-4c6502c65738',
  '2aa6471b-ddfc-4175-8455-1b6dd1b52fca',
  '53165adb-d65b-4372-988a-911a9d5a2c92',
  'ecfc75bd-87b8-4d33-8a86-288d1260d682',
  '48140902-6723-4831-82e1-7896e8b281f0',
  '01894547-1890-4f13-8c03-3c46915875fb',
  '624db283-3529-4793-a682-c7da6da13e3f',
  '0be34a40-e0bb-45c9-98d6-d54fef5da65f',
  'c8e30a4e-db6c-4df2-895e-07cb4d4b963f',
  '410fb727-3b25-458f-9961-cbf54dc8dc7d',
  '26624b2b-aed8-4ce1-ad06-dd86fe0b5222',
  'e59e9e42-db8f-4294-8b13-ef75567dd614',
  '098b2137-c29e-40ec-8c34-284a6067a4a0',
  '85efdcb3-a50f-4f53-b106-4215651fc522',
  'd3bc89d6-e5c0-41e7-93d0-45980cda1411',
  '701abdc3-0cdb-4f76-ae8f-ae9a1e427b54',
  '5b53a888-f1de-407f-a422-cdef8f836a9c',
  '2cd7d9d7-7a7e-4b4e-9d9b-1e1ee7a32441',
];

const POSTER_READY_IDS = new Set([
  'aa5dabc7-300e-4fc4-99d7-32bc05815966',
  'e83f2499-d624-417b-9bf0-b1f1430de20e',
  '2aa6471b-ddfc-4175-8455-1b6dd1b52fca',
  '53165adb-d65b-4372-988a-911a9d5a2c92',
  'ecfc75bd-87b8-4d33-8a86-288d1260d682',
  '26624b2b-aed8-4ce1-ad06-dd86fe0b5222',
  'e59e9e42-db8f-4294-8b13-ef75567dd614',
  '5b53a888-f1de-407f-a422-cdef8f836a9c',
  '2cd7d9d7-7a7e-4b4e-9d9b-1e1ee7a32441',
]);

function runSuite() {
  console.log('=== LAZCAKONG GYM 7.0 — ETAPA 2A VERIFICATION SUITE ===');

  // 1. Legacy 30 UUID Audit + Unequivocal 17 Alias Resolution + 13 Preserved Original
  assert.equal(LEGACY_UUID_RESOLUTION_AUDIT.length, 30, 'Deben auditarse exactamente las 30 referencias UUID históricas');
  const unequivocal = LEGACY_UUID_RESOLUTION_AUDIT.filter((x) => x.classification === 'unequivocal_compatible');
  const ambiguous = LEGACY_UUID_RESOLUTION_AUDIT.filter((x) => x.classification === 'ambiguous_preserve_original');
  const absent = LEGACY_UUID_RESOLUTION_AUDIT.filter((x) => x.classification === 'absent_preserve_original');
  assert.equal(unequivocal.length, 17, '17 equivalencias inequívocas compatibles');
  assert.equal(ambiguous.length, 6, '6 referencias ambiguas preservadas sin reasignación automática');
  assert.equal(absent.length, 7, '7 referencias ausentes preservadas sin reasignación automática');

  for (const item of unequivocal) {
    const resolved = resolveLibraryExercise({ id: item.legacyUuid });
    assert.ok(resolved, `El UUID histórico inequívoco ${item.legacyUuid} debe resolver al catálogo`);
    assert.equal(resolved!.id, item.mappedCurrentUuid);
  }

  for (const item of [...ambiguous, ...absent]) {
    assert.equal(item.mappedCurrentUuid, null);
    assert.equal(
      getLibraryExerciseById(item.legacyUuid),
      undefined,
      `El UUID histórico ${item.legacyUuid} no debe forzarse en getLibraryExerciseById`
    );
  }

  // History normalization regression check with legacy routine slot IDs + UUIDs
  const legacyWorkout = normalizeHistoricalWorkoutRecord({
    id: 'test-legacy-hist-1',
    date: '2025-11-10',
    routineTitle: 'Leg Day Clásico',
    exercisesSummary: [
      {
        exerciseId: 'lun-prensa-45',
        name: 'Prensa 45°',
        muscleGroup: 'Cuádriceps',
        sets: 4,
        maxWeight: 220,
        maxReps: 10,
      },
      {
        exerciseId: 'lun-curl-femoral',
        name: 'Curl femoral',
        muscleGroup: 'Isquiotibiales',
        sets: 3,
        maxWeight: 65,
        maxReps: 12,
      },
      {
        exerciseId: 'c93a5a8f-0e02-403e-b8c4-5d06ab8b7dc8',
        name: 'Dead bug',
        muscleGroup: 'Core',
        sets: 3,
        maxWeight: 0,
        maxReps: 12,
      },
    ],
  });
  assert.ok(legacyWorkout, 'El historial heredado debe normalizarse intacto');
  assert.equal(legacyWorkout!.exercisesSummary[0].exerciseId, 'lun-prensa-45', 'Conserva exerciseId original de rutina');
  assert.equal(
    legacyWorkout!.exercisesSummary[0].libraryExerciseId,
    'c13acdf8-f5aa-4c2d-b653-270fe1dcb7c6',
    'Conserva el UUID histórico original en registros de historial'
  );
  assert.equal(
    resolveLibraryExercise({ id: legacyWorkout!.exercisesSummary[0].libraryExerciseId })?.id,
    'e17ca855-8185-fbc6-bb54-ab9c4334f0f7',
    'Resuelve compatibilidad del UUID histórico hacia Prensa de Piernas Inclinada mediante exerciseAliases.json'
  );
  assert.equal(legacyWorkout!.exercisesSummary[1].exerciseId, 'lun-curl-femoral', 'Conserva slot ambiguo intacto');
  assert.equal(legacyWorkout!.exercisesSummary[2].exerciseId, 'c93a5a8f-0e02-403e-b8c4-5d06ab8b7dc8', 'Conserva UUID ausente intacto');
  const ambiguousIdentity = resolveCanonicalExerciseIdentity({
    exerciseId: 'lun-curl-femoral',
    name: 'Curl femoral',
  });
  assert.equal(ambiguousIdentity.canonicalKey, 'canon:curl_femoral_maquina');
  console.log('✓ 1. Protección de datos: 30 UUIDs auditados (17 compatibles, 6 ambiguos y 7 ausentes preservados)');

  // 2. Catalog expansion: 669 -> 689 (+20), net unique 666 -> 686 (0 duplicates)
  assert.equal(EXERCISE_LIBRARY.length, 689);
  const audit = getLibraryCoverageAudit16(1500);
  assert.equal(audit.netUniqueBiomechanicalCount, 686, 'Los 20 ejercicios nuevos son biomecánicamente únicos');
  assert.equal(audit.duplicateNameCollisions, 3, 'Cero colisiones semánticas nuevas');

  const prior669 = EXERCISE_LIBRARY.slice(0, 669);
  for (const prev of prior669) {
    assert.ok(!STAGE_2A_IDS.includes(prev.id), 'Ninguno de los 669 IDs previos fue alterado');
  }
  const added20 = EXERCISE_LIBRARY.slice(669);
  assert.equal(added20.length, 20);
  for (let i = 0; i < 20; i++) {
    assert.equal(added20[i].id, STAGE_2A_IDS[i]);
  }
  console.log('✓ 2. Expansión verificada: 669 -> 689 (+20), netos únicos 686, 0 duplicados ni IDs previos alterados');

  // 3. Visual honesty & real local WebP poster validation
  for (const ex of added20) {
    assert.equal(resolveVisualResourceStatus(ex), 'pending_resource', `${ex.name} debe ser pending_resource`);
    assert.equal(ex.videoUrl, null, `${ex.name} no debe simular videoUrl`);
    assert.equal(ex.animationUrl, undefined, `${ex.name} no debe simular animationUrl`);
    assert.equal(
      getExerciseFallbackAnimationUrl(ex.id),
      null,
      `${ex.name} no debe sintetizar URL remota de animación inexistente`
    );

    const cardObj = libraryItemToExercise(ex);
    assert.equal(cardObj.defaultVideoUrl, '', `${ex.name}: defaultVideoUrl vacío hasta contar con animación real`);

    if (POSTER_READY_IDS.has(ex.id)) {
      const expectedLocal = `/exercise-library/${ex.id}-poster.webp`;
      assert.equal(ex.thumbnailUrl, expectedLocal);
      const diskPath = path.resolve(process.cwd(), 'public', 'exercise-library', `${ex.id}-poster.webp`);
      assert.ok(fs.existsSync(diskPath), `Debe existir el archivo real WebP en disco: ${diskPath}`);
      const buf = fs.readFileSync(diskPath);
      assert.ok(buf.length > 8000, `WebP válido con contenido real (${buf.length} bytes)`);
      assert.equal(buf.subarray(0, 4).toString('ascii'), 'RIFF');
      assert.equal(buf.subarray(8, 12).toString('ascii'), 'WEBP');
    } else {
      assert.equal(ex.thumbnailUrl, null, `${ex.name} queda honestamente sin imagen hasta regenerar cuota`);
    }
  }
  console.log('✓ 3. Honestidad visual verificada: 9 posters WebP reales en disco y 11 pendientes sin falsificación');

  // 4. Cervical Biomechanical Safety, Instructions & Contraindications
  const neckExercises = filterExerciseCatalog(EXERCISE_LIBRARY, { muscle: 'Cuello' });
  assert.equal(neckExercises.length, 12, '12 ejercicios reales en grupo Cuello');
  for (const neck of neckExercises) {
    assert.ok(neck.startingPosition && neck.startingPosition.length > 15);
    assert.ok(neck.activePhase && neck.activePhase.length > 15);
    assert.ok(neck.returnPhase && neck.returnPhase.length > 15);
    assert.ok(Array.isArray(neck.safetyWarnings) && neck.safetyWarnings.length >= 2);
    assert.ok(Array.isArray(neck.contraindications) && neck.contraindications.length >= 1);
    assert.ok(isIsolationExercise(neck.name), `Cervical '${neck.name}' clasificado como aislamiento seguro`);
    assert.equal(
      sanitizeExerciseRepRange(neck.name, '3-5 reps'),
      '10 a 15 reps',
      `Cervical '${neck.name}' nunca recibe rangos de carga máxima 1-5`
    );

    const tp = buildTechniqueProProfile({ libraryExerciseId: neck.id, name: neck.name });
    assert.equal(tp.movementPattern, 'Control Cervical');
    assert.ok(tp.specificTips.length >= 3 && tp.specificTips.length <= 5);
    assert.ok(tp.safetyRecommendations.some((s) => /no sustituye valoración médica/i.test(s)));
  }

  const bandExercises = filterExerciseCatalog(EXERCISE_LIBRARY, { equipment: 'Bandas elásticas' });
  assert.equal(bandExercises.length, 14, '14 ejercicios totales en Bandas elásticas (1 previo + 13 Etapa 2A)');
  const coreBand = resolveLibraryExercise('Press Pallof con banda elástica');
  assert.ok(coreBand);
  assert.equal(coreBand!.id, '2cd7d9d7-7a7e-4b4e-9d9b-1e1ee7a32441');
  assert.notEqual(
    resolveLibraryExercise('Pallof press')?.id,
    coreBand!.id,
    'Pallof press histórico en polea sigue separado de Press Pallof con banda elástica'
  );
  console.log('✓ 4. Seguridad cervical, exclusión de cargas máximas, filtros y Technique Pro verificados');

  // 5. Recovery map unaffected
  const rec = computeRealTimeRecovery([], Date.now(), []);
  assert.ok(Object.keys(rec).length >= 10);
  console.log('✓ 5. Mapa muscular y motor de recuperación intactos');

  console.log('======================================================');
  console.log('   STAGE 2A VERIFICATION SUITE: ALL CHECKS PASSED     ');
  console.log('======================================================');
}

runSuite();
