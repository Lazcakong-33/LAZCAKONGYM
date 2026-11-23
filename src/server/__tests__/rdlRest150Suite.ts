import assert from 'node:assert/strict';
import {
  extractRestSeconds,
  isRdlBarbellExercise,
  isBulgarianDumbbellExercise,
} from '../../utils/routineImporterHelpers';
import { formatDetailedRest } from '../../utils/restFormatter';
import { sanitizeRoutinesRdlRest, sanitizeActiveSessionRdlRest } from '../../hooks/useGymState';
import type { Routine, ActiveWorkoutSession } from '../../types';

console.log('=== TEST SUITE: LAZCAKONG GYM — REST DURATION CORRECTION & TIMER SUITE ===\n');

// 1. Tests for extractRestSeconds (incluyendo 1:30 min (90 s) y 2:30 min (150 s))
console.log('1. Testing extractRestSeconds:');
const testCases: [unknown, number][] = [
  // Casos obligatorios explícitos pedidos por el usuario:
  ['1:30 min (90 s)', 90],
  ['2:30 min (150 s)', 150],

  // Formatos con "min" y "s" explícitos:
  ['1 min 30 s (90 s)', 90],
  ['2 min 30 s (150 s)', 150],

  // Prefijo "Descanso":
  ['Descanso 1:30 min (90 s)', 90],
  ['Descanso 2:30 min (150 s)', 150],
  ['Descanso 1 min 30 s (90 s)', 90],
  ['Descanso 2 min 30 s (150 s)', 150],
  ['Descanso: 1:30 min (90 s)', 90],
  ['Descanso: 2:30 min (150 s)', 150],

  // Recuperación de valores corruptos previos:
  ['31:30 min (1890 s)', 90],
  ['32:30 min (1950 s)', 150],
  ['1890 s', 90],
  ['1950 s', 150],
  ['1890', 90],
  ['1950', 150],
  [1890, 90],
  [1950, 150],

  // Formatos estándar reloj y directos:
  ['1:30', 90],
  ['01:30', 90],
  ['2:30', 150],
  ['02:30', 150],
  ['90 s', 90],
  ['150 s', 150],
  ['90', 90],
  ['150', 150],
  [90, 90],
  [150, 150],
  ['60 s', 60],
  ['1:00 min (60 s)', 60],
  ['2:00', 120],
  ['3:00 min (180 s)', 180],
];

for (const [input, expected] of testCases) {
  const result = extractRestSeconds(input, 90);
  assert.equal(
    result,
    expected,
    `extractRestSeconds(${JSON.stringify(input)}) should be ${expected}, got ${result}`
  );
  console.log(`  ✓ extractRestSeconds(${JSON.stringify(input)}) === ${expected}`);
}

// 2. Tests for formatDetailedRest
console.log('\n2. Testing formatDetailedRest:');
const formatCases: [number, string][] = [
  [90, '1 min 30 s (90 s)'],
  [150, '2 min 30 s (150 s)'],
  [30, '0:30 min (30 s)'],
  [60, '1:00 min (60 s)'],
  [120, '2:00 min (120 s)'],
  [180, '3:00 min (180 s)'],
  [300, '5:00 min (300 s)'],
];

for (const [sec, expected] of formatCases) {
  const result = formatDetailedRest(sec);
  assert.equal(result, expected, `formatDetailedRest(${sec}) should be ${expected}, got ${result}`);
  console.log(`  ✓ formatDetailedRest(${sec}) === "${expected}"`);
}

// 3. Tests for exercise classification
console.log('\n3. Testing isBulgarianDumbbellExercise & isRdlBarbellExercise:');
assert.equal(isBulgarianDumbbellExercise('Sentadilla búlgara con mancuernas'), true);
assert.equal(isBulgarianDumbbellExercise('Sentadilla búlgara'), true);
assert.equal(isBulgarianDumbbellExercise('Sentadilla bulgara con mancuernas'), true);
assert.equal(isBulgarianDumbbellExercise('Bulgarian split squat'), true);
assert.equal(isBulgarianDumbbellExercise('Peso muerto rumano con barra'), false);

assert.equal(isRdlBarbellExercise('Peso muerto rumano con barra'), true);
assert.equal(isRdlBarbellExercise('Peso muerto rumano'), true);
assert.equal(isRdlBarbellExercise('Peso Muerto Rumano (RDL)'), true);
assert.equal(isRdlBarbellExercise('RDL con barra'), true);
assert.equal(isRdlBarbellExercise('Peso muerto rumano con mancuernas'), false);
assert.equal(isRdlBarbellExercise('Sentadilla búlgara con mancuernas'), false);
console.log('  ✓ Exercise classifiers correctly identify Bulgarian & RDL exercises');

// 4. Tests for sanitizeRoutinesRdlRest
console.log('\n4. Testing sanitizeRoutinesRdlRest:');
const sampleRoutines: Routine[] = [
  {
    id: 'r1',
    dayName: 'Martes',
    title: 'Pierna & Glúteo',
    tagline: '3 ejercicios • 12 series',
    exercises: [
      {
        id: 'e1',
        name: 'Sentadilla con barra',
        defaultSets: 4,
        repRange: '8 - 10 reps',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: [],
        restSeconds: 180,
        restText: '3:00 min (180 s)',
        targetMuscles: 'Cuádriceps',
      },
      {
        id: 'e2',
        name: 'Sentadilla búlgara con mancuernas',
        defaultSets: 4,
        repRange: '10 - 12 reps',
        objective: 'Hipertrofia Unilateral',
        defaultVideoUrl: '',
        techniqueCues: [],
        restSeconds: 1890, // valor corrupto previo
        restText: '31:30 min (1890 s)',
        descanso: '31:30 min (1890 s)',
        targetMuscles: 'Cuádriceps, Glúteos',
      },
      {
        id: 'e3',
        name: 'Peso muerto rumano con barra',
        defaultSets: 4,
        repRange: '8 - 10 reps',
        objective: 'Hipertrofia Femorales',
        defaultVideoUrl: '',
        techniqueCues: [],
        restSeconds: 1950, // valor corrupto previo
        restText: '32:30 min (1950 s)',
        descanso: '32:30 min (1950 s)',
        targetMuscles: 'Isquiosurales, Glúteos',
      },
    ],
  },
];

const sanitizedRoutines = sanitizeRoutinesRdlRest(sampleRoutines);
assert.equal(sanitizedRoutines[0].exercises[0].restSeconds, 180, 'Sentadilla rest should stay 180');
assert.equal(sanitizedRoutines[0].exercises[1].restSeconds, 90, 'Búlgara rest should be 90s');
assert.equal(sanitizedRoutines[0].exercises[1].restText, '1 min 30 s (90 s)');
assert.equal(sanitizedRoutines[0].exercises[1].descanso, '1 min 30 s (90 s)');
assert.equal(sanitizedRoutines[0].exercises[2].restSeconds, 150, 'RDL rest should be 150s');
assert.equal(sanitizedRoutines[0].exercises[2].restText, '2 min 30 s (150 s)');
assert.equal(sanitizedRoutines[0].exercises[2].descanso, '2 min 30 s (150 s)');
console.log('  ✓ sanitizeRoutinesRdlRest successfully repaired Búlgara to 90s and RDL to 150s');

// 5. Tests for sanitizeActiveSessionRdlRest (conservando 5 de 16 series registradas)
console.log('\n5. Testing sanitizeActiveSessionRdlRest (conservando 5 de 16 series):');
const sampleSession: ActiveWorkoutSession = {
  sessionId: 'sess-active-123',
  routineId: 'r1',
  routineTitle: 'Pierna & Glúteo',
  startTime: Date.now() - 1800000,
  updatedAt: Date.now() - 120000,
  exercises: [
    {
      exerciseId: 'e1',
      libraryExerciseId: 'squat-barbell',
      exerciseName: 'Sentadilla con barra',
      activeExerciseName: 'Sentadilla con barra',
      targetMuscles: 'Cuádriceps',
      sets: [
        // 3 series completadas
        { id: 's1', setNumber: 1, weight: 100, reps: 8, completed: true, previous: '95 kg × 8' },
        { id: 's2', setNumber: 2, weight: 100, reps: 8, completed: true, previous: '95 kg × 8' },
        { id: 's3', setNumber: 3, weight: 105, reps: 6, completed: true, previous: '100 kg × 8' },
        { id: 's4', setNumber: 4, weight: 105, reps: 6, completed: false, previous: '100 kg × 6' },
      ],
      restSeconds: 180,
    },
    {
      exerciseId: 'e2',
      libraryExerciseId: 'cf88eb6f-6101-49f1-a493-ef959eb12cb6',
      exerciseName: 'Sentadilla búlgara con mancuernas',
      activeExerciseName: 'Sentadilla búlgara con mancuernas',
      targetMuscles: 'Cuádriceps, Glúteos',
      sets: [
        // 2 series completadas (suman 3 + 2 = 5 completadas de 16)
        { id: 's5', setNumber: 1, weight: 24, reps: 10, completed: true, previous: '22 kg × 10' },
        { id: 's6', setNumber: 2, weight: 26, reps: 10, completed: true, previous: '24 kg × 10' },
        { id: 's7', setNumber: 3, weight: '', reps: '', completed: false, previous: '26 kg × 8' },
        { id: 's8', setNumber: 4, weight: '', reps: '', completed: false, previous: '26 kg × 8' },
      ],
      restSeconds: 1890, // valor corrupto
    },
    {
      exerciseId: 'e3',
      libraryExerciseId: 'bde8a221-1dd3-40ec-bf89-b26d8e991b77',
      exerciseName: 'Peso muerto rumano con barra',
      activeExerciseName: 'Peso muerto rumano con barra',
      targetMuscles: 'Isquiosurales, Glúteos',
      sets: [
        { id: 's9', setNumber: 1, weight: '', reps: '', completed: false, previous: '80 kg × 10' },
        { id: 's10', setNumber: 2, weight: '', reps: '', completed: false, previous: '80 kg × 10' },
        { id: 's11', setNumber: 3, weight: '', reps: '', completed: false, previous: '80 kg × 10' },
        { id: 's12', setNumber: 4, weight: '', reps: '', completed: false, previous: '80 kg × 10' },
      ],
      restSeconds: 1950, // valor corrupto
    },
    {
      exerciseId: 'e4',
      libraryExerciseId: 'calf-raise',
      exerciseName: 'Elevación de talones',
      activeExerciseName: 'Elevación de talones',
      targetMuscles: 'Gemelos',
      sets: [
        { id: 's13', setNumber: 1, weight: '', reps: '', completed: false },
        { id: 's14', setNumber: 2, weight: '', reps: '', completed: false },
        { id: 's15', setNumber: 3, weight: '', reps: '', completed: false },
        { id: 's16', setNumber: 4, weight: '', reps: '', completed: false },
      ],
      restSeconds: 60,
    },
  ],
};

const totalSetsBefore = sampleSession.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
const completedSetsBefore = sampleSession.exercises.reduce(
  (acc, ex) => acc + ex.sets.filter((s) => s.completed).length,
  0
);
assert.equal(totalSetsBefore, 16, 'Debe haber exactamente 16 series totales');
assert.equal(completedSetsBefore, 5, 'Debe haber exactamente 5 series registradas');

const sanitizedSession = sanitizeActiveSessionRdlRest(sampleSession);
assert.ok(sanitizedSession);

const totalSetsAfter = sanitizedSession.exercises.reduce((acc, ex) => acc + ex.sets.length, 0);
const completedSetsAfter = sanitizedSession.exercises.reduce(
  (acc, ex) => acc + ex.sets.filter((s) => s.completed).length,
  0
);
assert.equal(totalSetsAfter, 16, 'Deben mantenerse las 16 series');
assert.equal(completedSetsAfter, 5, 'Deben mantenerse exactamente las 5 series completadas');

// Verificar conservación íntegra de cargas y datos de las series completadas
assert.equal(sanitizedSession.exercises[1].sets[0].weight, 24, 'Peso de serie 1 búlgara debe ser 24kg');
assert.equal(sanitizedSession.exercises[1].sets[0].reps, 10, 'Reps de serie 1 búlgara debe ser 10');
assert.equal(sanitizedSession.exercises[1].sets[0].completed, true, 'Serie 1 búlgara debe seguir completada');
assert.equal(sanitizedSession.exercises[1].sets[1].weight, 26, 'Peso de serie 2 búlgara debe ser 26kg');
assert.equal(sanitizedSession.exercises[1].sets[1].reps, 10, 'Reps de serie 2 búlgara debe ser 10');
assert.equal(sanitizedSession.exercises[1].sets[1].completed, true, 'Serie 2 búlgara debe seguir completada');

// Verificar corrección de descansos numéricos
assert.equal(sanitizedSession.exercises[0].restSeconds, 180, 'Sentadilla rest se mantiene en 180s');
assert.equal(sanitizedSession.exercises[1].restSeconds, 90, 'Búlgara rest debe ser 90s');
assert.equal(sanitizedSession.exercises[2].restSeconds, 150, 'RDL rest debe ser 150s');
assert.equal(sanitizedSession.exercises[3].restSeconds, 60, 'Gemelos rest se mantiene en 60s');
console.log('  ✓ 5 de 16 series registradas y cargas conservadas al 100%; descansos reparados a 90s y 150s');

// 6. Tests for timer countdown display (01:30 para búlgara y 02:30 para RDL)
console.log('\n6. Testing timer countdown format:');
function formatTimerDisplay(sec: number): string {
  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const timerBúlgara = formatTimerDisplay(sanitizedSession.exercises[1].restSeconds);
const timerRdl = formatTimerDisplay(sanitizedSession.exercises[2].restSeconds);
assert.equal(timerBúlgara, '01:30', 'El cronómetro de búlgara debe arrancar en 01:30');
assert.equal(timerRdl, '02:30', 'El cronómetro de RDL debe arrancar en 02:30');
console.log(`  ✓ Cronómetro búlgara (90s): "${timerBúlgara}"`);
console.log(`  ✓ Cronómetro RDL (150s): "${timerRdl}"`);

console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!\n');
