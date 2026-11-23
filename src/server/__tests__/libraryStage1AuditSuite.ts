import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CANONICAL_16_MUSCLE_GROUPS,
  CANONICAL_9_EQUIPMENT_CATEGORIES,
  CANONICAL_EQUIPMENT_FILTERS,
  EXERCISE_LIBRARY,
  MUSCLE_GROUPS,
  filterExerciseCatalog,
  getEliteExerciseCatalog,
  getLibraryCoverageAudit16,
  resolveLibraryExercise,
  resolveVisualResourceStatus,
} from '../../data/exerciseLibrary';
import { enrichExerciseWithLibrary } from '../../utils/enrichRoutines';
import {
  buildTechniqueProProfile,
  findRecommendedAlternative,
} from '../../utils/exerciseAlternatives';
import { canonicalizeMuscleGroup } from '../../utils/csvImporter';
import { computeRealTimeRecovery } from '../../utils/muscleRecoveryEngine';

function runSuite() {
  console.log('=== LAZCAKONG GYM 7.0 — BIBLIOTECA ELITE STAGE 1 AUDIT SUITE ===');

  // 1. Existing ID & exact name uniqueness
  assert.equal(EXERCISE_LIBRARY.length, 689, 'El catálogo expandido Etapa 2A debe contener 669 base + 20 nuevos = 689 registros');
  const ids = new Set<string>();
  const sourceIds = new Set<string>();
  const exactNames = new Set<string>();
  for (const ex of EXERCISE_LIBRARY) {
    assert.ok(ex.id && ex.id.length > 0, 'Todo ejercicio debe conservar su ID');
    assert.ok(!ids.has(ex.id), `ID duplicado detectado: ${ex.id}`);
    ids.add(ex.id);
    if (ex.sourceId) {
      assert.ok(!sourceIds.has(ex.sourceId), `sourceId duplicado detectado: ${ex.sourceId}`);
      sourceIds.add(ex.sourceId);
    }
    assert.ok(!exactNames.has(ex.name), `Nombre exacto duplicado detectado: ${ex.name}`);
    exactNames.add(ex.name);
  }
  console.log('✓ 1. Integridad de 689 IDs, sourceIds y nombres exactos preservada (0 reemplazos)');

  // 2. Elite Data Model completeness for all items
  const eliteCatalog = getEliteExerciseCatalog();
  assert.equal(eliteCatalog.length, EXERCISE_LIBRARY.length);
  for (const rec of eliteCatalog) {
    assert.ok(rec.spanishName.length > 0);
    assert.ok(rec.canonicalGroup16Label.length > 0);
    assert.ok(rec.equipmentCategoryLabel.length > 0);
    assert.ok(rec.biomechanicalPattern.length > 0);
    assert.ok(rec.stepByStepInstructions.length >= 3);
    assert.ok(rec.frequentMistakes.length >= 2);
    assert.ok(rec.safetyRecommendations.length >= 2);
    assert.ok(
      ['verified_animation', 'frame_sequence', 'static_image', 'pending_resource'].includes(
        rec.visualResourceStatus
      )
    );
  }
  console.log('✓ 2. Modelo de datos Elite validado en los 689 registros');

  // 3. Audit counts for 16 groups & 9 equipment categories
  const audit = getLibraryCoverageAudit16(1500);
  assert.equal(CANONICAL_16_MUSCLE_GROUPS.length, 16, 'Deben existir exactamente 16 grupos canónicos');
  assert.equal(CANONICAL_9_EQUIPMENT_CATEGORIES.length, 9, 'Deben existir exactamente 9 categorías de equipo');
  assert.equal(CANONICAL_EQUIPMENT_FILTERS.length, 10, 'CANONICAL_EQUIPMENT_FILTERS = Todos + 9 categorías');
  assert.equal(MUSCLE_GROUPS.length, 17, 'MUSCLE_GROUPS = Todos + 16 grupos canónicos');
  assert.equal(audit.totalCatalogEntries, 689);
  assert.equal(audit.duplicateNameCollisions, 3, 'Exactamente 3 pares semánticos duplicados en mismo equipo (0 nuevos en Etapa 2A)');
  assert.equal(audit.netUniqueBiomechanicalCount, 686, '686 ejercicios biomecánicos netos únicos');
  assert.equal(audit.remainingTo1500FromCurrent, 811);
  assert.equal(audit.remainingTo1500FromNetUnique, 814);
  assert.equal(audit.recommendedBatchesOf20, 41);

  const neckGroup = audit.byGroup16.find((g) => g.id === 'cuello');
  assert.equal(neckGroup?.currentCount, 12, 'Cuello pasa a 12 ejercicios reales en Etapa 2A');
  const bandEquip = audit.byEquipment9.find((e) => e.id === 'bandas_elasticas');
  assert.equal(
    bandEquip?.currentCount,
    14,
    'Bandas elásticas pasa a 14 ejercicios (1 previo + 13 de Etapa 2A)'
  );
  assert.equal(audit.byVisualStatus.verified_animation, 669, '669 animaciones verificadas preservadas');
  assert.equal(audit.byVisualStatus.pending_resource, 20, '20 ejercicios Etapa 2A marcados honestamente como pending_resource');
  console.log('✓ 3. Auditoría de cobertura 16 grupos / 9 equipos / 814 faltantes (41 lotes) verificada');

  // 4. Filter consistency (16 canonical groups + 9 equipment + backwards-compatible filters)
  let sum16 = 0;
  for (const grp of audit.byGroup16) {
    sum16 += grp.currentCount;
    const matched = filterExerciseCatalog(EXERCISE_LIBRARY, { muscle: grp.label });
    assert.ok(matched.length > 0, `El filtro '${grp.label}' debe devolver ejercicios`);
  }
  assert.equal(sum16, 689, 'La suma de los 16 grupos debe cubrir el 100% de los 689 ejercicios');

  let sum9 = 0;
  for (const eq of audit.byEquipment9) {
    sum9 += eq.currentCount;
    const matched = filterExerciseCatalog(EXERCISE_LIBRARY, { equipment: eq.label });
    assert.ok(
      matched.length >= eq.currentCount,
      `El filtro de equipamiento '${eq.label}' debe incluir al menos sus ${eq.currentCount} ejercicios primarios (actual: ${matched.length})`
    );
  }
  assert.equal(sum9, 689, 'La suma de las 9 categorías de equipo debe cubrir 689 ejercicios');

  // Legacy filter strings must keep working seamlessly
  assert.ok(filterExerciseCatalog(EXERCISE_LIBRARY, { muscle: 'Pierna' }).length > 50);
  assert.ok(filterExerciseCatalog(EXERCISE_LIBRARY, { muscle: 'Hombro' }).length > 50);
  assert.ok(filterExerciseCatalog(EXERCISE_LIBRARY, { muscle: 'Abdomen' }).length > 20);
  assert.ok(filterExerciseCatalog(EXERCISE_LIBRARY, { muscle: 'Antebrazo' }).length > 10);
  console.log('✓ 4. Filtros centralizados verificados para 16 grupos, 9 equipos y compatibilidad retroactiva');

  // 5. Honest Visual Resource Status rules (never fabricate animations)
  assert.equal(
    resolveVisualResourceStatus({
      videoUrl: 'https://example.com/anim.webp',
      thumbnailUrl: 'https://example.com/poster.webp',
    }),
    'verified_animation'
  );
  assert.equal(
    resolveVisualResourceStatus({
      videoUrl: null,
      animationUrl: undefined,
      thumbnailUrl: 'https://example.com/poster.webp',
      frames: 8,
    }),
    'frame_sequence'
  );
  assert.equal(
    resolveVisualResourceStatus({
      videoUrl: null,
      animationUrl: undefined,
      thumbnailUrl: 'https://example.com/poster.webp',
    }),
    'static_image'
  );
  assert.equal(
    resolveVisualResourceStatus({
      videoUrl: null,
      animationUrl: undefined,
      thumbnailUrl: null,
    }),
    'pending_resource'
  );
  console.log('✓ 5. Estados visuales honestos (verified_animation / frame_sequence / static_image / pending_resource) verificados');

  // 6. Resolution, Enrichment, Alternatives, TechniquePro, CSV & Recovery compatibility
  const checkNames = [
    'Press de banca plano con barra',
    'Curl femoral',
    'Prensa 45',
    'Gemelos',
    'Abductores',
    'Remo sentado',
    'Press de pecho en máquina',
    'Zancadas laterales',
    'Tirones en Y',
  ];
  for (const name of checkNames) {
    const resolved = resolveLibraryExercise(name);
    assert.ok(resolved, `resolveLibraryExercise debe resolver '${name}'`);
  }

  const enriched = enrichExerciseWithLibrary({
    id: 'test-ex-1',
    name: 'Press de banca plano con barra',
    targetMuscles: 'Pecho',
    defaultSets: 4,
    repRange: '6-8',
    restSeconds: 120,
    restText: '120 s',
    objective: 'Fuerza',
    defaultVideoUrl: '',
    techniqueCues: [],
  });
  assert.equal(enriched.libraryExerciseId, 'dba6c9ac-e99c-4486-5c88-7ff4403c4608');
  assert.ok(enriched.equipment);
  assert.ok(enriched.thumbnailUrl);
  assert.ok(enriched.techniquePro);

  const altRes = findRecommendedAlternative({
    name: 'Press de banca plano con barra',
    libraryExerciseId: 'dba6c9ac-e99c-4486-5c88-7ff4403c4608',
    targetMuscles: 'Pecho',
  });
  assert.ok(altRes.recommended || altRes.otherCandidates.length > 0, 'Debe sugerir alternativas válidas');

  const techProfile = buildTechniqueProProfile({
    name: 'Press de banca plano con barra',
    libraryExerciseId: 'dba6c9ac-e99c-4486-5c88-7ff4403c4608',
  });
  assert.ok(techProfile.muscles.primary.length > 0);
  assert.equal(canonicalizeMuscleGroup('Isquiotibiales', 'Curl femoral'), 'Isquiotibiales');

  const recovery = computeRealTimeRecovery([], Date.now(), []);
  assert.ok(Object.keys(recovery).length >= 10, 'computeRealTimeRecovery sigue operando sin alteraciones');
  console.log('✓ 6. Compatibilidad verificada con rutinas, alternativas, Technique Pro, CSV y mapa de recuperación');

  // 7. Performance & UI code invariants
  const thumbSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ExerciseThumbnail.tsx'), 'utf8');
  assert.ok(
    thumbSrc.includes('MAX_LOADED_IMAGE_CACHE') &&
      thumbSrc.includes('MAX_FAILED_IMAGE_CACHE') &&
      thumbSrc.includes('MAX_BLOB_URL_CACHE') &&
      thumbSrc.includes('URL.revokeObjectURL'),
    'ExerciseThumbnail.tsx debe implementar límites LRU y liberación de Blob URLs'
  );

  const libViewSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/views/ExerciseLibraryView.tsx'), 'utf8');
  assert.ok(
    libViewSrc.includes('IntersectionObserver') &&
      libViewSrc.includes('prefers-reduced-motion') &&
      libViewSrc.includes('CANONICAL_EQUIPMENT_FILTERS') &&
      libViewSrc.includes('resolveVisualResourceStatus') &&
      !libViewSrc.includes('Catálogo SmartWorkout Adaptado') &&
      !libViewSrc.includes('Ver ficha técnica original en SmartWorkout'),
    'ExerciseLibraryView.tsx debe usar IntersectionObserver, reduced-motion, 9 equipos y textos reales LazcaKong'
  );

  const gridSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/MuscleGroupCardsGrid.tsx'), 'utf8');
  assert.ok(
    gridSrc.includes('CANONICAL_16_MUSCLE_GROUPS') &&
      gridSrc.includes('accent') &&
      !gridSrc.includes('#b8e600') &&
      !gridSrc.includes('#B8E600'),
    'MuscleGroupCardsGrid.tsx debe renderizar 16 grupos con tokens dinámicos de acento'
  );

  const adminSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/views/AdminView.tsx'), 'utf8');
  assert.ok(
    !adminSrc.includes('SmartWorkout.app') && !adminSrc.includes('biblioteca SmartWorkout'),
    'AdminView.tsx no debe contener texto obsoleto de SmartWorkout'
  );

  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.ok(
    serverSrc.includes("path.resolve(__dirname, 'public/exercise-library')"),
    'server.ts debe servir archivos estáticos desde public/exercise-library'
  );
  console.log('✓ 7. Reglas de rendimiento, observación por viewport, caché LRU y servidor verificadas');

  console.log('======================================================');
  console.log('   STAGE 1 AUDIT SUITE: ALL CHECKS PASSED (100%)      ');
  console.log('======================================================');
}

runSuite();
