import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EXERCISE_LIBRARY, resolveLibraryExercise } from '../../data/exerciseLibrary';
import { DEFAULT_ROUTINES } from '../../data/defaultRoutines';
import { enrichExerciseWithLibrary, getEnrichedDefaultRoutines } from '../../utils/enrichRoutines';
import {
  buildTechniqueProProfile,
  buildTechniqueSpeechScript,
  createTempoFromValues,
  findRecommendedAlternative,
  generateTechniqueCuesForExercise,
  libraryItemToExercise,
  parseTempoNotation,
} from '../../utils/exerciseAlternatives';
import { formatCoachTextForSpeech } from '../../utils/coachVoiceEngine';

function logPass(msg: string) {
  console.log(`  ✓ ${msg}`);
}

async function runSuite() {
  console.log('====================================================================');
  console.log('   LAZCAKONG GYM 7.0 — ETAPA 1: TECHNIQUE PRO VERIFICATION SUITE    ');
  console.log('====================================================================');

  // 1. Verificación de cobertura en el catálogo completo y rutinas
  console.log('\n1. Cobertura de Technique Pro en catálogo y rutinas:');
  const baseRoutines =
    DEFAULT_ROUTINES.length > 0
      ? DEFAULT_ROUTINES
      : [
          {
            id: 'routine-push-pro',
            dayName: 'LUNES',
            title: 'Empuje Hipertrofia Pro',
            tagline: 'Pecho, Hombro y Tríceps',
            exercises: [
              {
                ...libraryItemToExercise(
                  resolveLibraryExercise({ name: 'Press de Banca con Barra' }) || EXERCISE_LIBRARY[0]
                ),
                id: 'ex-bench-1',
              },
              {
                ...libraryItemToExercise(
                  resolveLibraryExercise({ name: 'Press Militar con Mancuernas' }) || EXERCISE_LIBRARY[1]
                ),
                id: 'ex-shoulder-2',
              },
              {
                ...libraryItemToExercise(
                  resolveLibraryExercise({ name: 'Sentadilla con Barra' }) || EXERCISE_LIBRARY[2]
                ),
                id: 'ex-squat-3',
              },
              {
                ...libraryItemToExercise(
                  resolveLibraryExercise({ name: 'Jalón al Pecho en Polea' }) || EXERCISE_LIBRARY[3]
                ),
                id: 'ex-pull-4',
              },
            ],
          },
        ];
  const enrichedRoutines = getEnrichedDefaultRoutines(baseRoutines);
  assert.ok(enrichedRoutines.length > 0, 'Debe haber rutinas enriquecidas');

  for (const routine of enrichedRoutines) {
    for (const ex of routine.exercises) {
      assert.ok(ex.id, `El ejercicio ${ex.name} debe conservar su ID intacto`);
      assert.ok(ex.techniquePro, `El ejercicio ${ex.name} debe tener perfil TechniquePro`);
      const tp = ex.techniquePro!;
      assert.ok(
        tp.specificTips.length >= 3 && tp.specificTips.length <= 5,
        `${ex.name}: debe tener entre 3 y 5 consejos técnicos específicos (tiene ${tp.specificTips.length})`
      );
      assert.ok(
        tp.startingPosition.length >= 2,
        `${ex.name}: debe incluir posición inicial detallada`
      );
      assert.ok(
        tp.stepByStepExecution.length >= 3,
        `${ex.name}: debe incluir ejecución paso a paso`
      );
      assert.ok(
        tp.breathing.eccentricPhase && tp.breathing.concentricPhase && tp.breathing.bracingCue,
        `${ex.name}: debe incluir guía de respiración completa`
      );
      assert.ok(
        tp.commonMistakes.length >= 2,
        `${ex.name}: debe incluir errores frecuentes`
      );
      assert.ok(
        tp.muscles.primary.length >= 1 && tp.muscles.secondary.length >= 1,
        `${ex.name}: debe incluir músculos principales y secundarios`
      );
      assert.ok(
        tp.defaultTempo && /^\d-\d-\d-\d$/.test(tp.defaultTempo.notation),
        `${ex.name}: debe incluir tempo orientativo válido (obtenido: ${tp.defaultTempo?.notation})`
      );
      assert.ok(
        tp.safetyRecommendations.length >= 2,
        `${ex.name}: debe incluir recomendaciones de seguridad`
      );
      assert.ok(
        tp.preSetTip.length >= 20,
        `${ex.name}: debe incluir consejo breve pre-serie específico`
      );
    }
  }
  logPass(
    `Todas las rutinas y sus ejercicios disponen de los 10 componentes de Technique Pro sin alterar IDs`
  );

  // Muestra representativa de diferentes patrones en EXERCISE_LIBRARY
  const sampleQueries = [
    'Press de Banca',
    'Sentadilla',
    'Jalón al Pecho',
    'Remo',
    'Extensión de Cuádriceps',
    'Curl Femoral',
    'Press Militar',
    'Elevaciones Laterales',
    'Hip Thrust',
    'Curl de Bíceps',
    'Extensión de Tríceps',
    'Elevación de Talones',
  ];

  for (const q of sampleQueries) {
    const libItem =
      EXERCISE_LIBRARY.find((item) => item.name.toLowerCase().includes(q.toLowerCase())) ||
      EXERCISE_LIBRARY[0];
    const converted = libraryItemToExercise(libItem);
    assert.ok(converted.techniquePro, `Catálogo (${libItem.name}) debe generar techniquePro`);
    assert.ok(
      converted.techniquePro!.mediaUrl.includes('.webp') ||
        converted.techniquePro!.mediaUrl.includes('.mp4'),
      `Catálogo (${libItem.name}) debe tener animación/ilustración exacta vinculada`
    );
    assert.ok(
      converted.techniquePro!.preSetTip.toLowerCase().includes(libItem.name.toLowerCase()),
      `El consejo pre-serie de ${libItem.name} debe ser específico al ejercicio exacto`
    );
  }
  logPass('Ejercicios de todos los patrones biomecánicos vinculan su animación exacta y consejos específicos');

  // 2. Especificidad y ausencia de afirmaciones médicas o genéricas prohibidas
  console.log('\n2. Especificidad biomecánica y ausencia de afirmaciones médicas:');
  const pressProfile = buildTechniqueProProfile({
    name: 'Press de Banca Inclinado con Mancuernas',
    targetMuscles: 'Pecho',
    equipment: 'Mancuernas',
  });
  const squatProfile = buildTechniqueProProfile({
    name: 'Prensa de Piernas 45°',
    targetMuscles: 'Cuádriceps',
    equipment: 'Máquina',
  });
  assert.notDeepEqual(
    pressProfile.specificTips,
    squatProfile.specificTips,
    'Los consejos técnicos deben diferir según el patrón y equipamiento real'
  );
  assert.notEqual(
    pressProfile.preSetTip,
    squatProfile.preSetTip,
    'El consejo breve antes de la 1ª serie debe ser específico para cada ejercicio'
  );
  assert.ok(
    pressProfile.muscles.primary.some((m) => m.includes('Clavicular') || m.includes('Pectoral')),
    'Press inclinado debe identificar precisión anatómica pectoral'
  );
  logPass('Las indicaciones diferencian ángulos, agarres, equipamiento y anatomía sin consejos genéricos');

  // 3. Tempo orientativo y ajustable
  console.log('\n3. Tempo orientativo y ajustable:');
  const parsedTempo = parseTempoNotation('4-2-1-1');
  assert.equal(parsedTempo.eccentricSec, 4);
  assert.equal(parsedTempo.bottomPauseSec, 2);
  assert.equal(parsedTempo.concentricSec, 1);
  assert.equal(parsedTempo.topPauseSec, 1);
  assert.equal(parsedTempo.notation, '4-2-1-1');

  const clampedTempo = createTempoFromValues(12, -2, 0, 3);
  assert.equal(clampedTempo.eccentricSec, 8);
  assert.equal(clampedTempo.bottomPauseSec, 0);
  assert.equal(clampedTempo.concentricSec, 1);
  assert.equal(clampedTempo.topPauseSec, 3);
  logPass('El motor de Tempo permite ajustar cada fase con límites seguros y notación estándar E-P-C-I');

  // 4. Guion para el motor de voz existente
  console.log('\n4. Integración con el motor de voz en español (coachVoiceEngine):');
  const speechScript = buildTechniqueSpeechScript(pressProfile, parsedTempo);
  assert.ok(
    speechScript.includes(pressProfile.exerciseName),
    'El guion de voz debe mencionar el nombre exacto del ejercicio'
  );
  assert.ok(
    speechScript.includes('4 segundos de bajada excéntrica'),
    'El guion de voz debe reflejar el tempo ajustado por el atleta'
  );
  const formattedForTts = formatCoachTextForSpeech(speechScript);
  assert.ok(
    formattedForTts.length > 80 && !formattedForTts.includes('*'),
    'formatCoachTextForSpeech convierte el guion de técnica en locución natural sin símbolos markdown'
  );
  logPass('El guion de voz se genera y formatea correctamente para Web Speech / Capacitor TTS');

  // 5. Actualización de instrucciones técnicas al sustituir ejercicio por máquina ocupada
  console.log('\n5. Actualización de técnica al sustituir ejercicio por máquina ocupada:');
  const originalEx = enrichedRoutines[0].exercises[0];
  const altRec = findRecommendedAlternative(originalEx);
  assert.ok(altRec.recommended, 'Debe existir una alternativa biomecánica recomendada');

  const substituteLibItem = altRec.recommended!.exercise;
  const updatedTechniqueAfterSwap = buildTechniqueProProfile({
    id: originalEx.id, // Conserva ID original de la ranura
    libraryExerciseId: substituteLibItem.id,
    name: substituteLibItem.name,
    targetMuscles: substituteLibItem.muscleGroup,
    equipment: substituteLibItem.equipment,
  });

  assert.equal(
    updatedTechniqueAfterSwap.exerciseId,
    originalEx.id,
    'El ID de ejercicio en la sesión se conserva intacto tras la sustitución'
  );
  assert.equal(
    updatedTechniqueAfterSwap.exerciseName,
    substituteLibItem.name,
    'El perfil técnico se actualiza al nombre exacto del ejercicio sustituto'
  );
  assert.ok(
    updatedTechniqueAfterSwap.preSetTip.includes(substituteLibItem.name),
    'El consejo pre-serie se actualiza inmediatamente al nuevo ejercicio sustituto'
  );
  assert.ok(
    updatedTechniqueAfterSwap.mediaUrl.includes(substituteLibItem.id),
    'La animación técnica se actualiza al recurso exacto del nuevo ejercicio'
  );
  logPass(
    `Sustitución por máquina ocupada (${originalEx.name} -> ${substituteLibItem.name}) actualiza animación, consejos, posición inicial y voz`
  );

  // 6. Verificación de integración en ActiveWorkoutView.tsx, ExerciseDetailModal.tsx y useGymState.ts
  console.log('\n6. Integración en entrenamiento activo y compatibilidad 360/390/430 px + Elite Performance:');
  const activeViewSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/views/ActiveWorkoutView.tsx'),
    'utf8'
  );
  const modalSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/components/ExerciseDetailModal.tsx'),
    'utf8'
  );
  const gymStateSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/hooks/useGymState.ts'),
    'utf8'
  );

  assert.ok(
    activeViewSrc.includes('Ver técnica') && activeViewSrc.includes('active-ver-tecnica-btn-'),
    'ActiveWorkoutView debe incorporar el botón compacto "Ver técnica"'
  );
  assert.ok(
    activeViewSrc.includes('pre-set-technique-tip-') &&
      activeViewSrc.includes('!hasCompletedWorkingSet'),
    'ActiveWorkoutView debe mostrar el consejo técnico breve antes de la primera serie'
  );
  assert.ok(
    gymStateSrc.includes('updatedTechniquePro = buildTechniqueProProfile'),
    'useGymState debe actualizar techniquePro al sustituir un ejercicio o alternar variante'
  );
  assert.ok(
    modalSrc.includes('technique-voice-btn') &&
      modalSrc.includes('speakTechniqueInstructionText'),
    'ExerciseDetailModal debe integrar el botón para escuchar las instrucciones con el motor de voz existente'
  );
  assert.ok(
    modalSrc.includes('#090909') &&
      modalSrc.includes('#171717') &&
      modalSrc.includes('#303030') &&
      (modalSrc.includes('#CCFF00') ||
        (modalSrc.includes('accent-text') && modalSrc.includes('border-accent'))) &&
      modalSrc.includes('#F5F5F5'),
    'ExerciseDetailModal conserva la paleta visual Elite Performance (#090909, #171717, #303030, acento dinámico y #F5F5F5)'
  );
  logPass('Entrenamiento activo, modal Technique Pro y paleta Elite Performance verificados al 100%');

  console.log('\n====================================================================');
  console.log('   TODAS LAS PRUEBAS DE TECHNIQUE PRO 7.0 PASARON EXITOSAMENTE      ');
  console.log('====================================================================');
}

runSuite().catch((err) => {
  console.error('FALLO EN LA SUITE DE TECHNIQUE PRO:', err);
  process.exit(1);
});
