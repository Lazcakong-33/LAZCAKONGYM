import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  COACH_AUTO_TTS_STORAGE_KEY,
  buildUpdatedRoutineWithLoadChange,
  detectCoachVoiceCapabilities,
  formatCoachTextForSpeech,
  loadAutoReadCoachPreference,
  mapSpeechRecognitionErrorToSpanish,
  parseCoachVoiceActionRequest,
  pickSpanishChileVoice,
  saveAutoReadCoachPreference,
  selectNextAutoSpeechMessage,
} from '../../utils/coachVoiceEngine.ts';
import { resolveCoachRoutineAndExercises } from '../../utils/coachContextEngine.ts';
import { CoachChatModal } from '../../components/CoachChatModal.tsx';
import { ActiveWorkoutSession, Profile, Routine } from '../../types/index.ts';

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

function createSampleProfile(): Profile {
  return {
    id: 'atleta_voz_test',
    name: 'Camila',
    avatar: '🦍',
    goal: 'Hipertrofia',
    weeklyTargetDays: 4,
    soundEnabled: true,
    vibrationEnabled: true,
    weightUnit: 'kg',
    weightKg: 64,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function createSampleRoutines(): Routine[] {
  return [
    {
      id: 'rut_lunes',
      dayName: 'Lunes',
      title: 'Lunes: Empuje',
      tagline: 'Pecho, Hombro y Tríceps',
      modality: 'hipertrofia',
      exercises: [
        {
          id: 'ex_press',
          libraryExerciseId: 'barbell_bench_press',
          name: 'Press de Banca con Barra',
          targetMuscles: 'Pecho',
          equipment: 'Barra',
          defaultSets: 3,
          repRange: '6 - 10 reps',
          restSeconds: 120,
          restText: '2 min',
          objective: 'Fuerza e hipertrofia de pectoral',
          defaultVideoUrl: '',
          defaultWeight: 40,
          techniqueCues: ['Escápulas retraídas'],
        },
        {
          id: 'ex_elevaciones',
          name: 'Elevaciones Laterales',
          targetMuscles: 'Hombros',
          equipment: 'Mancuernas',
          defaultSets: 3,
          repRange: '12 - 15 reps',
          restSeconds: 60,
          restText: '1 min',
          objective: 'Deltoide lateral',
          defaultVideoUrl: '',
          defaultWeight: 10,
          techniqueCues: ['Control excéntrico'],
        },
      ],
    },
  ];
}

function createSampleActiveSession(): ActiveWorkoutSession {
  return {
    sessionId: 'sess_voz_1',
    routineId: 'rut_lunes',
    routineTitle: 'Lunes: Empuje',
    startTime: Date.now() - 10 * 60 * 1000,
    exercises: [
      {
        exerciseId: 'ex_press',
        libraryExerciseId: 'barbell_bench_press',
        exerciseName: 'Press de Banca con Barra',
        activeExerciseName: 'Press de Banca con Barra',
        targetMuscles: 'Pecho',
        equipment: 'Barra',
        repRange: '6 - 10 reps',
        sets: [
          {
            id: 'set_done_1',
            setNumber: 1,
            weight: 40,
            reps: 8,
            completed: true,
            completedAt: new Date().toISOString(),
          },
          {
            id: 'set_pending_2',
            setNumber: 2,
            weight: 40,
            reps: '',
            completed: false,
          },
          {
            id: 'set_pending_3',
            setNumber: 3,
            weight: 40,
            reps: '',
            completed: false,
          },
        ],
      },
    ],
  };
}

let passed = 0;
async function runCase(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

async function runTests() {
  // 1. Spanish gym pronunciation rules
  await runCase('1. Pronunciación natural de "42,5 kg × 6" y notación de gimnasio', () => {
    assert.equal(
      formatCoachTextForSpeech('42,5 kg × 6'),
      'cuarenta y dos coma cinco kilos por seis repeticiones'
    );
    assert.equal(
      formatCoachTextForSpeech('42.5 kg x 6 reps'),
      'cuarenta y dos coma cinco kilos por seis repeticiones'
    );
    assert.equal(
      formatCoachTextForSpeech('40 kg × 8'),
      'cuarenta kilos por ocho repeticiones'
    );
    assert.equal(
      formatCoachTextForSpeech('**Sugerencia:** sube a 45 kg @8,5 (RIR 2) al 75%'),
      'Sugerencia: sube a cuarenta y cinco kilos a RPE ocho coma cinco (con dos repeticiones en reserva) al setenta y cinco por ciento'
    );
    assert.equal(
      formatCoachTextForSpeech('Horario de cierre 14:30 y 3 × 8 - 12 reps'),
      'Horario de cierre 14:30 y tres series de ocho a doce repeticiones'
    );
  });

  // 2. Chilean Spanish (es-CL) voice preference order
  await runCase('2. Selección prioritaria de voz Español de Chile (es-CL)', () => {
    const voices = [
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'es-ES', name: 'Mónica' },
      { lang: 'es-MX', name: 'Paulina' },
      { lang: 'es-CL', name: 'Catalina' },
    ] as unknown as SpeechSynthesisVoice[];

    const picked = pickSpanishChileVoice(voices);
    assert.equal(picked?.lang, 'es-CL');

    const fallbackVoices = [
      { lang: 'en-US', name: 'Alex' },
      { lang: 'es-419', name: 'Google español LATAM' },
      { lang: 'es-ES', name: 'Jorge' },
    ] as unknown as SpeechSynthesisVoice[];
    assert.equal(pickSpanishChileVoice(fallbackVoices)?.lang, 'es-419');
    assert.equal(pickSpanishChileVoice([]), null);
  });

  // 3. Auto-TTS preference defaults to OFF and persists on device
  await runCase('3. Preferencia "Leer respuestas en voz alta" apagada inicialmente y persistida', () => {
    const mem = createMemoryStorage();
    assert.equal(loadAutoReadCoachPreference(mem), false);
    assert.equal(loadAutoReadCoachPreference(null), false);

    saveAutoReadCoachPreference(true, mem);
    assert.equal(mem.getItem(COACH_AUTO_TTS_STORAGE_KEY), 'true');
    assert.equal(loadAutoReadCoachPreference(mem), true);

    saveAutoReadCoachPreference(false, mem);
    assert.equal(loadAutoReadCoachPreference(mem), false);
  });

  // 4. Single-read deduplication
  await runCase('4. Lectura única por respuesta nueva cuando auto-TTS está activo', () => {
    const msgs = [
      { id: 'u1', role: 'user', text: '¿Qué me toca?' },
      { id: 'a1', role: 'assistant', text: 'Hoy toca Press de Banca 42,5 kg × 6.' },
    ];
    const spoken = new Set<string>();

    // Off -> nothing read
    assert.equal(selectNextAutoSpeechMessage(msgs, spoken, false), null);

    // On -> reads a1 once
    const first = selectNextAutoSpeechMessage(msgs, spoken, true);
    assert.equal(first?.id, 'a1');
    spoken.add(first!.id);

    // Re-render -> does NOT replay a1
    assert.equal(selectNextAutoSpeechMessage(msgs, spoken, true), null);

    // New user msg -> null
    msgs.push({ id: 'u2', role: 'user', text: 'Gracias' });
    assert.equal(selectNextAutoSpeechMessage(msgs, spoken, true), null);

    // New assistant msg -> plays a2 once
    msgs.push({ id: 'a2', role: 'assistant', text: 'Descansa dos minutos.' });
    const second = selectNextAutoSpeechMessage(msgs, spoken, true);
    assert.equal(second?.id, 'a2');
  });

  // 5. Voice action detection produces non-mutating previews for load & exercise changes
  await runCase('5. Comandos por voz/texto generan vista previa sin mutar rutina ni sesión', () => {
    const routines = createSampleRoutines();
    const session = createSampleActiveSession();
    const resolution = resolveCoachRoutineAndExercises({
      routines,
      activeSession: session,
    });
    const selectedExercise = resolution.exercises[0];

    const originalRoutineWeight = routines[0].exercises[0].defaultWeight;
    const originalPendingWeight = session.exercises[0].sets[1].weight;
    const originalDoneWeight = session.exercises[0].sets[0].weight;

    // Load change request
    const loadAction = parseCoachVoiceActionRequest({
      text: 'Cambia la carga de Press de Banca a 45 kg',
      exercises: resolution.exercises,
      selectedExercise,
      activeSession: session,
      selectedRoutine: resolution.selectedRoutine,
    });

    assert.equal(loadAction.type, 'change_load');
    if (loadAction.type === 'change_load') {
      assert.equal(loadAction.preview.proposedWeightKg, 45);
      assert.equal(loadAction.preview.scope, 'session');
      assert.equal(loadAction.preview.pendingSetsCount, 2);
      assert.equal(loadAction.preview.completedSetsCount, 1);

      // Assert zero mutation happened before confirmation
      assert.equal(routines[0].exercises[0].defaultWeight, originalRoutineWeight);
      assert.equal(session.exercises[0].sets[1].weight, originalPendingWeight);
      assert.equal(session.exercises[0].sets[0].weight, originalDoneWeight);

      // Routine update helper applies cleanly when explicitly confirmed with scope === 'routine'
      const updatedRoutine = buildUpdatedRoutineWithLoadChange({
        routine: routines[0],
        originalExerciseId: loadAction.preview.originalExerciseId,
        originalExerciseName: loadAction.preview.originalExerciseName,
        proposedWeightKg: loadAction.preview.proposedWeightKg,
      });
      assert.equal(updatedRoutine.exercises[0].defaultWeight, 45);
      assert.equal(routines[0].exercises[0].defaultWeight, 40);
    }

    // Question about last weight must NOT open a change-load preview
    const questionAction = parseCoachVoiceActionRequest({
      text: '¿Qué peso usé la última vez en Press de Banca con 42,5 kg?',
      exercises: resolution.exercises,
      selectedExercise,
      activeSession: session,
      selectedRoutine: resolution.selectedRoutine,
    });
    assert.equal(questionAction.type, 'none');

    // Exercise replacement request
    const replaceAction = parseCoachVoiceActionRequest({
      text: 'Cambia Press de Banca con Barra por mancuernas',
      exercises: resolution.exercises,
      selectedExercise,
      activeSession: session,
      selectedRoutine: resolution.selectedRoutine,
    });
    assert.equal(replaceAction.type, 'replace_exercise');
    if (replaceAction.type === 'replace_exercise') {
      assert.equal(replaceAction.equipmentHint, 'Mancuernas');
      assert.ok(replaceAction.suggestedReplacement?.name);
    }
  });

  // 6. Graceful capability handling & SSR UI verification
  await runCase('6. Detección de capacidades, mensajes de error claros y renderizado UI de voz', () => {
    // In Node without window -> both false, never throws
    const capsNode = detectCoachVoiceCapabilities();
    assert.equal(capsNode.sttSupported, false);
    assert.equal(capsNode.ttsSupported, false);

    assert.ok(
      mapSpeechRecognitionErrorToSpanish('not-allowed').includes('Permiso de micrófono denegado')
    );
    assert.ok(
      mapSpeechRecognitionErrorToSpanish('audio-capture').includes('micrófono disponible')
    );
    assert.equal(mapSpeechRecognitionErrorToSpanish('aborted'), '');

    const profile = createSampleProfile();
    const routines = createSampleRoutines();
    const html = renderToStaticMarkup(
      React.createElement(CoachChatModal, {
        isOpen: true,
        initialIntent: 'today_workout',
        onClose: () => {},
        activeProfile: profile,
        routines,
        history: [],
        prs: {},
        activeSession: null,
        onApplyReplacement: () => {},
        onApplyLoadChange: () => {},
      })
    );

    assert.ok(html.includes('data-testid="coach-auto-tts-toggle"'));
    assert.ok(html.includes('aria-checked="false"'));
    assert.ok(html.includes('Leer respuestas en voz alta'));
    assert.ok(html.includes('data-testid="coach-mic-button"'));
    assert.ok(html.includes('min-h-[44px]'));
    assert.ok(html.includes('¿Qué me toca hoy?'));
  });

  console.log(`\nALL ${passed} COACH VOICE SUITE TESTS PASSED.`);
}

runTests().catch((err) => {
  console.error('COACH VOICE SUITE FAILED:', err);
  process.exit(1);
});
