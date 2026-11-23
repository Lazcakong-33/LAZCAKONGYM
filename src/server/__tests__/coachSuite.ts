import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Request, Response } from 'express';
import {
  buildCoachExerciseAlternatives,
  buildExerciseLoadReport,
  buildMinimizedCoachContext,
  buildUpdatedRoutineWithReplacement,
  createReplacementPreview,
  resolveCoachRoutineAndExercises,
} from '../../utils/coachContextEngine.ts';
import {
  handleCoachChat,
  sanitizeCoachContextValue,
  type CoachOwnershipCheckResult,
} from '../coachController.ts';
import { TodayView } from '../../views/TodayView.tsx';
import { CoachChatModal } from '../../components/CoachChatModal.tsx';
import type {
  ActiveWorkoutSession,
  CompletedWorkout,
  Profile,
  Routine,
} from '../../types/index.ts';

function createMockRes() {
  const res: any = {
    statusCode: 200,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  return res as Response & { statusCode: number; body: any };
}

function createProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'athlete-test-1',
    name: 'Atleta Prueba',
    email: 'atleta@ejemplo.com',
    authUid: 'uid-athlete-1',
    avatar: '🦍',
    goal: 'Hipertrofia',
    weeklyTargetDays: 4,
    soundEnabled: true,
    vibrationEnabled: true,
    weightUnit: 'kg',
    weightKg: 82,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createSampleRoutines(): Routine[] {
  return [
    {
      id: 'routine-mon',
      dayName: 'Lunes',
      title: 'Lunes: Empuje A (Pecho y Tríceps)',
      tagline: 'Pecho, Hombro, Tríceps',
      modality: 'hipertrofia',
      exercises: [
        {
          id: 'ex-bench',
          libraryExerciseId: 'bench-press-barbell',
          name: 'Press de Banca Plano con Barra',
          targetMuscles: 'Pecho',
          equipment: 'Barra',
          defaultSets: 3,
          repRange: '8 - 10 reps',
          restSeconds: 120,
          restText: '2 min',
          objective: 'Hipertrofia',
          defaultVideoUrl: '',
          techniqueCues: ['Retracción escapular'],
        },
        {
          id: 'ex-incline',
          name: 'Press Inclinado con Mancuernas',
          targetMuscles: 'Pecho',
          equipment: 'Mancuernas',
          defaultSets: 3,
          repRange: '10 - 12 reps',
          restSeconds: 90,
          restText: '90 s',
          objective: 'Hipertrofia',
          defaultVideoUrl: '',
          techniqueCues: [],
        },
      ],
    },
  ];
}

async function runTests() {
  let passed = 0;
  const runCase = async (name: string, fn: () => Promise<void> | void) => {
    await fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  };

  // 1A. New athlete with weekday routine and empty history
  await runCase('1A. Atleta nuevo con rutina y sin historial muestra entrenamiento programado y sin series registradas', () => {
    const profile = createProfile();
    const routines = createSampleRoutines();
    const monday = new Date('2026-11-16T10:00:00'); // Monday

    const ctx = buildMinimizedCoachContext({
      activeProfile: profile,
      routines,
      history: [],
      prs: {},
      activeSession: null,
      referenceDate: monday,
    });

    assert.equal(ctx.hasHistory, false);
    assert.equal(ctx.resolution.hasRoutines, true);
    assert.equal(ctx.resolution.selectedRoutine?.id, 'routine-mon');
    assert.equal(ctx.resolution.exercises.length, 2);
    assert.ok(ctx.loadReport);
    assert.equal(ctx.loadReport.hasRegisteredSets, false);
    assert.equal(
      ctx.loadReport.emptyMessage,
      'Aún no tienes series registradas para este ejercicio'
    );
  });

  // 1B. Routine without weekday assignments lets athlete select a day
  await runCase('1B. Rutina sin días de la semana asignados permite elegir un día', () => {
    const noWeekdayRoutines: Routine[] = [
      {
        id: 'r-day-1',
        dayName: 'Bloque 1',
        title: 'Torso Superior',
        tagline: 'Fuerza e hipertrofia',
        exercises: createSampleRoutines()[0].exercises,
      },
      {
        id: 'r-day-2',
        dayName: 'Bloque 2',
        title: 'Tren Inferior',
        tagline: 'Cuádriceps e isquios',
        exercises: [
          {
            id: 'ex-squat',
            name: 'Sentadilla Libre con Barra',
            targetMuscles: 'Pierna',
            equipment: 'Barra',
            defaultSets: 4,
            repRange: '6 - 8 reps',
            restSeconds: 180,
            restText: '3 min',
            objective: 'Fuerza',
            defaultVideoUrl: '',
            techniqueCues: [],
          },
        ],
      },
    ];

    const initialRes = resolveCoachRoutineAndExercises({
      routines: noWeekdayRoutines,
      activeSession: null,
      referenceDate: new Date('2026-11-16T10:00:00'),
    });
    assert.equal(initialRes.hasWeekdayAssignments, false);
    assert.equal(initialRes.selectableRoutines.length, 2);
    assert.equal(initialRes.selectedRoutine?.id, 'r-day-1');

    const pickedDay2 = resolveCoachRoutineAndExercises({
      routines: noWeekdayRoutines,
      activeSession: null,
      selectedRoutineId: 'r-day-2',
      referenceDate: new Date('2026-11-16T10:00:00'),
    });
    assert.equal(pickedDay2.selectedRoutine?.id, 'r-day-2');
    assert.equal(pickedDay2.exercises[0].name, 'Sentadilla Libre con Barra');
  });

  // 2. Athlete with two sessions of the same exercise -> returns latest date + exact sets + separates lifted vs suggested
  await runCase('2. Atleta con dos sesiones del mismo ejercicio devuelve la última fecha, series exactas y distingue carga real vs sugerencia', () => {
    const routines = createSampleRoutines();
    const exerciseItem = resolveCoachRoutineAndExercises({
      routines,
      activeSession: null,
      selectedRoutineId: 'routine-mon',
    }).exercises[0];

    const olderSession: CompletedWorkout = {
      id: 'w-old',
      profileId: 'athlete-test-1',
      routineId: 'routine-mon',
      routineTitle: 'Empuje A',
      date: '2026-11-02T12:00:00.000Z',
      startTime: new Date('2026-11-02T11:00:00.000Z').getTime(),
      endTime: new Date('2026-11-02T12:00:00.000Z').getTime(),
      durationSeconds: 3600,
      totalVolumeKg: 2100,
      completedSetsCount: 3,
      isFinished: true,
      exercisesSummary: [
        {
          exerciseId: 'ex-bench',
          name: 'Press de Banca Plano con Barra',
          equipment: 'Barra',
          sets: 3,
          setsDetail: [
            { setNumber: 1, weight: 70, reps: 10, rpe: 8, completed: true },
            { setNumber: 2, weight: 70, reps: 10, rpe: 8.5, completed: true },
            { setNumber: 3, weight: 70, reps: 9, rpe: 9, completed: true },
          ],
          maxWeight: 70,
          maxReps: 10,
        },
      ],
    };

    const newerSession: CompletedWorkout = {
      id: 'w-new',
      profileId: 'athlete-test-1',
      routineId: 'routine-mon',
      routineTitle: 'Empuje A',
      date: '2026-11-12T12:00:00.000Z',
      startTime: new Date('2026-11-12T11:00:00.000Z').getTime(),
      endTime: new Date('2026-11-12T12:00:00.000Z').getTime(),
      durationSeconds: 3600,
      totalVolumeKg: 2400,
      completedSetsCount: 3,
      isFinished: true,
      exercisesSummary: [
        {
          exerciseId: 'ex-bench',
          name: 'Press de Banca Plano con Barra',
          equipment: 'Barra',
          sets: 3,
          setsDetail: [
            { setNumber: 1, weight: 80, reps: 10, rpe: 7.5, completed: true },
            { setNumber: 2, weight: 80, reps: 10, rpe: 8, completed: true },
            { setNumber: 3, weight: 80, reps: 10, rpe: 8, completed: true },
          ],
          maxWeight: 80,
          maxReps: 10,
        },
      ],
    };

    const report = buildExerciseLoadReport({
      history: [olderSession, newerSession],
      exercise: exerciseItem,
      routineModality: 'hipertrofia',
      activeProfileId: 'athlete-test-1',
    });

    assert.equal(report.hasRegisteredSets, true);
    assert.equal(report.lastSessionIso, '2026-11-12T12:00:00.000Z');
    assert.equal(report.hasPerSetDetail, true);
    assert.deepEqual(
      report.liftedSets.map((s) => ({ w: s.weight, r: s.reps, rpe: s.rpe })),
      [
        { w: 80, r: 10, rpe: 7.5 },
        { w: 80, r: 10, rpe: 8 },
        { w: 80, r: 10, rpe: 8 },
      ]
    );
    // Suggestion (+2.5 kg to 82.5 kg) is cleanly separate from lifted 80 kg
    assert.equal(report.progression.status, 'increase_load');
    assert.equal(report.progression.suggestedWeightKg, 82.5);
    assert.equal(report.liftedSets[0].weight, 80);
  });

  // 3. Cancelled substitution leaves routine and active session untouched
  await runCase('3. Sustitución cancelada no modifica la sesión activa ni la rutina', () => {
    const routines = createSampleRoutines();
    const routinesSnapshot = JSON.stringify(routines);
    const activeSession: ActiveWorkoutSession = {
      sessionId: 'sess-1',
      routineId: 'routine-mon',
      routineTitle: routines[0].title,
      startTime: Date.now(),
      exercises: [
        {
          exerciseId: 'ex-bench',
          exerciseName: 'Press de Banca Plano con Barra',
          activeExerciseName: 'Press de Banca Plano con Barra',
          targetMuscles: 'Pecho',
          equipment: 'Barra',
          sets: [
            { setNumber: 1, weight: 80, reps: 10, completed: true },
            { setNumber: 2, weight: '', reps: '', completed: false },
          ],
        },
      ],
    };
    const sessionSnapshot = JSON.stringify(activeSession);

    const exItem = resolveCoachRoutineAndExercises({
      routines,
      activeSession,
    }).exercises[0];

    const alts = buildCoachExerciseAlternatives({ exercise: exItem });
    assert.ok(alts.alternatives.length > 0);

    const preview = createReplacementPreview({
      exercise: exItem,
      replacement: alts.alternatives[0],
      scope: 'session',
      activeSession,
      selectedRoutine: routines[0],
    });
    assert.equal(preview.originalExerciseName, 'Press de Banca Plano con Barra');
    assert.equal(preview.completedSetsCount, 1);

    // User cancels -> neither routines nor activeSession mutated
    assert.equal(JSON.stringify(routines), routinesSnapshot);
    assert.equal(JSON.stringify(activeSession), sessionSnapshot);
  });

  // 4. Confirmed substitution (routine update keeps no weight transfer & preserves other exercises)
  await runCase('4. Sustitución confirmada aplica reemplazo sin copiar pesos ni alterar otros ejercicios', () => {
    const routines = createSampleRoutines();
    const routineWithWeights: Routine = {
      ...routines[0],
      exercises: routines[0].exercises.map((e, i) =>
        i === 0 ? { ...e, defaultWeight: 85, prevWeight: 80 } : e
      ),
    };

    const exItem = resolveCoachRoutineAndExercises({
      routines: [routineWithWeights],
      activeSession: null,
      selectedRoutineId: routineWithWeights.id,
    }).exercises[0];

    const alts = buildCoachExerciseAlternatives({
      exercise: exItem,
      filterEquipment: 'Máquinas',
    });
    const chosen = alts.alternatives[0];
    assert.ok(chosen, 'Debe encontrar al menos una alternativa en biblioteca');

    const updatedRoutine = buildUpdatedRoutineWithReplacement({
      routine: routineWithWeights,
      originalExerciseId: exItem.id,
      originalExerciseName: exItem.name,
      replacement: chosen,
    });

    assert.equal(updatedRoutine.exercises[0].name, chosen.name);
    assert.equal(updatedRoutine.exercises[0].libraryExerciseId, chosen.libraryExerciseId);
    assert.equal(updatedRoutine.exercises[0].alternative, 'Press de Banca Plano con Barra');
    // Crucial: weight from original exercise MUST NOT transfer
    assert.equal(updatedRoutine.exercises[0].defaultWeight, undefined);
    assert.equal(updatedRoutine.exercises[0].prevWeight, undefined);
    // Second exercise untouched
    assert.equal(updatedRoutine.exercises[1].name, 'Press Inclinado con Mancuernas');
  });

  // 5. Gemini failures never mask errors & context sanitization strips secrets
  await runCase('5. Fallo de Gemini devuelve error explícito y sanitización elimina datos sensibles', async () => {
    const sanitized = sanitizeCoachContextValue({
      athleteGoal: 'Hipertrofia',
      pin: '1234',
      password: 'secret',
      email: 'privado@ejemplo.com',
      rawIdToken: 'jwt-secret',
      nested: { authUid: 'uid-x', exerciseName: 'Press Banca' },
    });
    assert.equal(sanitized.pin, undefined);
    assert.equal(sanitized.password, undefined);
    assert.equal(sanitized.email, undefined);
    assert.equal(sanitized.rawIdToken, undefined);
    assert.equal(sanitized.nested.authUid, undefined);
    assert.equal(sanitized.nested.exerciseName, 'Press Banca');

    const allowOwner = async (): Promise<CoachOwnershipCheckResult> => ({
      authorized: true,
      status: 200,
    });
    const allowRate = () => ({ allowed: true });

    // 5a. Missing API key -> 503 explicit error
    {
      const req = {
        user: { uid: 'uid-1', isAdmin: false },
        body: { athleteId: 'athlete-1', message: '¿Qué me toca hoy?', context: {} },
      } as unknown as Request;
      const res = createMockRes();
      await handleCoachChat(req, res, {
        verifyOwnership: allowOwner,
        getApiKey: () => undefined,
        checkRateLimitFn: allowRate,
      });
      assert.equal(res.statusCode, 503);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'coach/missing-api-key');
      assert.equal(res.body.reply, undefined);
    }

    // 5b. Gemini 429 Quota Error -> 429 retryable explicit error
    {
      const req = {
        user: { uid: 'uid-1', isAdmin: false },
        body: { athleteId: 'athlete-1', message: '¿Qué peso usé?', context: {} },
      } as unknown as Request;
      const res = createMockRes();
      await handleCoachChat(req, res, {
        verifyOwnership: allowOwner,
        getApiKey: () => 'fake-key',
        checkRateLimitFn: allowRate,
        geminiClient: {
          async generateCoachReply() {
            const err: any = new Error('RESOURCE_EXHAUSTED: quota exceeded');
            err.status = 429;
            throw err;
          },
        },
      });
      assert.equal(res.statusCode, 429);
      assert.equal(res.body.success, false);
      assert.equal(res.body.retryable, true);
      assert.equal(res.body.reply, undefined);
    }

    // 5c. Gemini 500 Upstream Error -> 502 retryable explicit error (no fake AI text)
    {
      const req = {
        user: { uid: 'uid-1', isAdmin: false },
        body: { athleteId: 'athlete-1', message: 'Hola coach', context: {} },
      } as unknown as Request;
      const res = createMockRes();
      await handleCoachChat(req, res, {
        verifyOwnership: allowOwner,
        getApiKey: () => 'fake-key',
        checkRateLimitFn: allowRate,
        geminiClient: {
          async generateCoachReply() {
            throw new Error('Upstream Gemini timeout');
          },
        },
      });
      assert.equal(res.statusCode, 502);
      assert.equal(res.body.success, false);
      assert.equal(res.body.retryable, true);
      assert.equal(res.body.reply, undefined);
    }

    // 5d. Mocked Gemini success returns reply + disclaimer
    {
      const req = {
        user: { uid: 'uid-1', isAdmin: false },
        body: { athleteId: 'athlete-1', message: '¿Qué me toca hoy?', context: { athleteGoal: 'Hipertrofia' } },
      } as unknown as Request;
      const res = createMockRes();
      await handleCoachChat(req, res, {
        verifyOwnership: allowOwner,
        getApiKey: () => 'fake-key',
        checkRateLimitFn: allowRate,
        geminiClient: {
          async generateCoachReply({ systemInstruction }) {
            assert.ok(systemInstruction.includes('CONTEXTO_AUTORIZADO_DEL_ATLETA'));
            return 'Hoy te toca Lunes: Empuje A según tu rutina activa.';
          },
        },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.reply.includes('Empuje A'));
      assert.ok(res.body.disclaimer.includes('lesiones'));
    }
  });

  // 6. Isolation between two athletes
  await runCase('6. Aislamiento estricto entre dos atletas (rechaza 401 sin sesión y 403 si atleta A pide atleta B)', async () => {
    const owners: Record<string, string> = {
      'athlete-a': 'uid-a',
      'athlete-b': 'uid-b',
    };

    const verifyOwnership = async ({
      athleteId,
      user,
    }: {
      athleteId: string;
      user: { uid: string; isAdmin: boolean };
    }): Promise<CoachOwnershipCheckResult> => {
      if (user.isAdmin || owners[athleteId] === user.uid) {
        return { authorized: true, status: 200 };
      }
      return {
        authorized: false,
        status: 403,
        error: 'No tienes autorización para consultar los datos de este atleta.',
      };
    };

    // Unauthenticated -> 401
    {
      const req = { body: { athleteId: 'athlete-b', message: 'Hola' } } as unknown as Request;
      const res = createMockRes();
      await handleCoachChat(req, res, { verifyOwnership, checkRateLimitFn: () => ({ allowed: true }) });
      assert.equal(res.statusCode, 401);
    }

    // Athlete A trying to read Athlete B -> 403 Forbidden
    {
      const req = {
        user: { uid: 'uid-a', isAdmin: false },
        body: { athleteId: 'athlete-b', message: '¿Qué peso levantó B?' },
      } as unknown as Request;
      const res = createMockRes();
      await handleCoachChat(req, res, {
        verifyOwnership,
        getApiKey: () => 'fake-key',
        checkRateLimitFn: () => ({ allowed: true }),
      });
      assert.equal(res.statusCode, 403);
      assert.equal(res.body.success, false);
      assert.equal(res.body.code, 'coach/forbidden-athlete');
    }

    // Athlete A reading Athlete A -> 200 OK
    {
      const req = {
        user: { uid: 'uid-a', isAdmin: false },
        body: { athleteId: 'athlete-a', message: '¿Qué me toca hoy?' },
      } as unknown as Request;
      const res = createMockRes();
      await handleCoachChat(req, res, {
        verifyOwnership,
        getApiKey: () => 'fake-key',
        checkRateLimitFn: () => ({ allowed: true }),
        geminiClient: {
          async generateCoachReply() {
            return 'Tu rutina programada de hoy está lista.';
          },
        },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
    }
  });

  // 7. UI Render Verification (TodayView compact card + CoachChatModal intents & disclaimer)
  await runCase('7. Renderizado UI de tarjeta "Habla con tu coach" en Inicio y panel CoachChatModal', () => {
    const profile = createProfile();
    const routines = createSampleRoutines();

    const todayHtml = renderToStaticMarkup(
      React.createElement(TodayView, {
        routines,
        history: [],
        prs: {},
        activeSession: null,
        activeProfile: profile,
        onStartWorkout: () => {},
        onNavigateActive: () => {},
        onSelectDay: () => {},
        onOpenCreateRoutine: () => {},
        onOpenPlateCalculator: () => {},
        onNavigateTab: () => {},
        onOpenInstallApk: () => {},
        onOpenAIRoutineModal: () => {},
      })
    );

    assert.ok(todayHtml.includes('data-testid="today-coach-card"'));
    assert.ok(todayHtml.includes('Habla con tu coach'));
    assert.ok(todayHtml.includes('¿Qué me toca hoy?'));
    assert.ok(todayHtml.includes('¿Qué peso usé la última vez?'));
    assert.ok(todayHtml.includes('¿Con qué reemplazo este ejercicio?'));

    const modalTodayHtml = renderToStaticMarkup(
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
      })
    );
    assert.ok(modalTodayHtml.includes('Coach'));
    assert.ok(modalTodayHtml.includes('LazcaKong IA'));
    assert.ok(modalTodayHtml.includes('No diagnostica lesiones'));

    const modalWeightEmptyHtml = renderToStaticMarkup(
      React.createElement(CoachChatModal, {
        isOpen: true,
        initialIntent: 'last_weight',
        onClose: () => {},
        activeProfile: profile,
        routines,
        history: [],
        prs: {},
        activeSession: null,
        onApplyReplacement: () => {},
      })
    );
    assert.ok(
      modalWeightEmptyHtml.includes('Aún no tienes series registradas para este ejercicio')
    );

    const modalReplaceHtml = renderToStaticMarkup(
      React.createElement(CoachChatModal, {
        isOpen: true,
        initialIntent: 'replace_exercise',
        onClose: () => {},
        activeProfile: profile,
        routines,
        history: [],
        prs: {},
        activeSession: null,
        onApplyReplacement: () => {},
      })
    );
    assert.ok(modalReplaceHtml.includes('Alternativas compatibles'));
    assert.ok(modalReplaceHtml.includes('Usar'));
  });

  console.log(`\nALL ${passed} COACH SUITE TESTS PASSED.`);
}

runTests().catch((err) => {
  console.error('COACH SUITE FAILED:', err);
  process.exit(1);
});
