import {
  computeEliteChallengesSnapshot,
  createDefaultEliteChallengesPlatformAdapter,
  ELITE_RANKS,
  OFFICIAL_LAZCAKONG_LOGO_PATH,
  renderSocialCardToPngDataUrl,
  resolveOfficialExportAppUrl,
  resolveRankForXp,
  speakEliteChallengeRecognition,
  withSocialCardFormat,
} from '../../utils/eliteChallengesEngine';
import {
  createPeriodizationMesocyclePlan,
  savePeriodizationMesocyclePlan,
} from '../../utils/elitePerformanceAnalytics';
import {
  AthleteDailyRecoveryCheckIn,
  CoachPlatformStorageAdapter,
  CompletedWorkout,
  EliteBadgeCategoryId,
  EliteRankId,
  Routine,
  SocialCardType,
} from '../../types';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function createMemoryStorage(): CoachPlatformStorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

export async function runEliteChallengesProSuite(): Promise<{
  passed: number;
  total: number;
  results: string[];
}> {
  const results: string[] = [];
  let passed = 0;
  let total = 0;

  const runTest = async (name: string, fn: () => void | Promise<void>) => {
    total += 1;
    await fn();
    passed += 1;
    results.push(`PASS: ${name}`);
  };

  const NOW = new Date('2026-06-18T18:00:00.000Z').getTime();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const syntheticRoutine: Routine = {
    id: 'routine-synth-1',
    title: 'Fuerza Sintética A',
    dayName: 'Lunes',
    tagline: 'Empuje y Tracción',
    exercises: [
      {
        id: 'ex-synth-bench',
        libraryExerciseId: 'chest_barbell_bench_press',
        name: 'Press de Banca con Barra',
        targetMuscles: 'Pecho',
        equipment: 'Barra',
        defaultSets: 4,
        repRange: '6-8 reps',
        defaultWeight: 90,
        prevWeight: 85,
        defaultReps: 8,
        restSeconds: 120,
        restText: '120s',
        objective: 'Fuerza',
        defaultVideoUrl: '',
        techniqueCues: [],
      },
    ],
  };

  // 1. CÁLCULO DE XP, PROGRESIÓN DE LOS 6 RANGOS Y PROTECCIÓN CONTRA SOBREENTRENAMIENTO / DOLOR
  await runTest(
    '1. Cálculo de XP, transición exacta por los 6 rangos (RECRUIT a KONG) y bloqueo de entrenamientos con dolor o exceso de series',
    () => {
      const rankExpectations: { xp: number; expected: EliteRankId }[] = [
        { xp: 0, expected: 'RECRUIT' },
        { xp: 499, expected: 'RECRUIT' },
        { xp: 500, expected: 'WARRIOR' },
        { xp: 1500, expected: 'TITAN' },
        { xp: 3500, expected: 'ELITE' },
        { xp: 7000, expected: 'ALPHA' },
        { xp: 12000, expected: 'KONG' },
        { xp: 18500, expected: 'KONG' },
      ];

      for (const item of rankExpectations) {
        const resolved = resolveRankForXp(item.xp);
        assert(
          resolved.currentRank.id === item.expected,
          `Para ${item.xp} XP se esperaba rango ${item.expected}, pero se obtuvo ${resolved.currentRank.id}`
        );
      }

      assert(ELITE_RANKS.length === 6, 'Deben existir exactamente los 6 rangos oficiales');

      // Sesión saludable controlada (2026-06-15) vs Sesión con alerta de dolor (2026-06-16)
      const safeWorkout: CompletedWorkout = {
        id: 'w-safe-1',
        profileId: 'synth-athlete-01',
        routineId: 'routine-synth-1',
        routineTitle: 'Fuerza Sintética A',
        date: '2026-06-15',
        startTime: NOW - 3 * DAY_MS,
        endTime: NOW - 3 * DAY_MS + 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 2880,
        completedSetsCount: 4,
        totalRepsCount: 32,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-synth-bench',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            sets: 4,
            maxWeight: 90,
            maxReps: 8,
            volumeKg: 2880,
            setsDetail: [
              { setNumber: 1, weight: 90, reps: 8, rpe: 7.5 },
              { setNumber: 2, weight: 90, reps: 8, rpe: 8.0 },
            ],
          },
        ],
      };

      const painWorkout: CompletedWorkout = {
        ...safeWorkout,
        id: 'w-pain-2',
        date: '2026-06-16',
        startTime: NOW - 2 * DAY_MS,
        endTime: NOW - 2 * DAY_MS + 3600_000,
      };

      const checkInsWithAlert: AthleteDailyRecoveryCheckIn[] = [
        {
          id: 'ci-pain-1',
          profileId: 'synth-athlete-01',
          dateKey: '2026-06-16',
          timestamp: NOW - 2 * DAY_MS,
          sleepHours: 6,
          sleepQuality: 3,
          energyLevel: 2,
          perceivedFatigue: 4,
          muscleSoreness: 'alert', // Alerta de dolor registrada ese día
          trainingDisposition: 2,
        },
      ];

      const snapOnlySafe = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-01', name: 'Atleta Uno', weeklyTargetDays: 3 },
        history: [safeWorkout],
        routines: [syntheticRoutine],
        dailyCheckIns: checkInsWithAlert,
        referenceNow: NOW,
      });

      const snapWithPainSession = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-01', name: 'Atleta Uno', weeklyTargetDays: 3 },
        history: [safeWorkout, painWorkout],
        routines: [syntheticRoutine],
        dailyCheckIns: checkInsWithAlert,
        referenceNow: NOW,
      });

      const workoutXpEventsInSafe = snapOnlySafe.xpLedger.filter(
        (e) => e.category === 'workout_completed'
      );
      const workoutXpEventsWithPain = snapWithPainSession.xpLedger.filter(
        (e) => e.category === 'workout_completed'
      );

      assert(
        workoutXpEventsInSafe.length === 1 && workoutXpEventsWithPain.length === 1,
        'La sesión realizada en un día con alerta de dolor (muscleSoreness=alert) NO debe otorgar XP de entrenamiento'
      );
      assert(
        snapWithPainSession.skippedUnsafeOrDuplicateCount >= 1,
        'Debe contabilizar el bloqueo preventivo de sesión con dolor'
      );
    }
  );

  // 2. PREVENCIÓN DE XP DUPLICADO (SINCRONIZACIÓN, EDICIÓN DE HISTORIAL, IMPORTACIÓN Y RESTAURACIÓN DE RESPALDOS)
  await runTest(
    '2. Prevención estricta de XP duplicado ante sincronización repetida, edición de historial, importaciones o restauración de respaldos',
    () => {
      const w1: CompletedWorkout = {
        id: 'w-orig-101',
        profileId: 'synth-athlete-01',
        routineId: 'routine-synth-1',
        routineTitle: 'Empuje Base',
        date: '2026-06-10',
        startTime: NOW - 8 * DAY_MS,
        endTime: NOW - 8 * DAY_MS + 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 2400,
        completedSetsCount: 4,
        totalRepsCount: 32,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-synth-bench',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            sets: 4,
            maxWeight: 85,
            maxReps: 8,
            volumeKg: 2400,
          },
        ],
      };

      const w2: CompletedWorkout = {
        ...w1,
        id: 'w-orig-102',
        date: '2026-06-15',
        startTime: NOW - 3 * DAY_MS,
        endTime: NOW - 3 * DAY_MS + 3600_000,
        totalVolumeKg: 2880,
        exercisesSummary: [
          {
            exerciseId: 'ex-synth-bench',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            sets: 4,
            maxWeight: 92.5, // Nuevo PR verificado sobre los 85 kg previos
            maxReps: 8,
            volumeKg: 2880,
          },
        ],
      };

      const baseSnap = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-01', name: 'Atleta Uno', weeklyTargetDays: 3 },
        history: [w1, w2],
        routines: [syntheticRoutine],
        referenceNow: NOW,
      });

      // Simular sincronización repetida, edición de título/notas, importación CSV con otro ID y restauración de respaldo
      const w1SyncedClone: CompletedWorkout = { ...w1 };
      const w2EditedTitle: CompletedWorkout = {
        ...w2,
        id: 'w-imported-backup-999',
        routineTitle: 'Empuje Base (Editado tras restaurar respaldo)',
      };
      const w2RestoredBackupClone: CompletedWorkout = {
        ...w2,
        id: 'w-restored-backup-888',
      };

      const duplicatedSnap = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-01', name: 'Atleta Uno', weeklyTargetDays: 3 },
        history: [w1, w2, w1SyncedClone, w2EditedTitle, w2RestoredBackupClone],
        routines: [syntheticRoutine],
        referenceNow: NOW,
      });

      assert(
        baseSnap.totalXp === duplicatedSnap.totalXp,
        `El XP total debe ser idéntico tras importar/restaurar/editar respaldos (${baseSnap.totalXp} vs ${duplicatedSnap.totalXp})`
      );
      assert(
        baseSnap.xpLedger.length === duplicatedSnap.xpLedger.length,
        'La cantidad de eventos en el libro mayor de XP no debe duplicarse'
      );
      assert(
        duplicatedSnap.skippedUnsafeOrDuplicateCount >= 3,
        'Debe registrar las sesiones duplicadas descartadas'
      );
    }
  );

  // 3. AISLAMIENTO ESTRICTO ENTRE ATLETAS
  await runTest(
    '3. Aislamiento estricto de XP, rangos, desafíos e insignias entre perfiles de atletas',
    () => {
      const storage = createMemoryStorage();
      const workoutAthleteA: CompletedWorkout = {
        id: 'w-ath-a-1',
        profileId: 'synth-athlete-alpha',
        routineId: 'routine-synth-1',
        routineTitle: 'Sesión Alpha',
        date: '2026-06-15',
        startTime: NOW - 3 * DAY_MS,
        endTime: NOW - 3 * DAY_MS + 3600_000,
        durationSeconds: 3600,
        totalVolumeKg: 3200,
        completedSetsCount: 5,
        totalRepsCount: 40,
        isFinished: true,
        exercisesSummary: [
          {
            exerciseId: 'ex-synth-bench',
            name: 'Press de Banca con Barra',
            muscleGroup: 'Pecho',
            sets: 5,
            maxWeight: 100,
            maxReps: 8,
            volumeKg: 3200,
          },
        ],
      };

      const workoutAthleteB: CompletedWorkout = {
        ...workoutAthleteA,
        id: 'w-ath-b-1',
        profileId: 'synth-athlete-beta',
        totalVolumeKg: 5000,
        completedSetsCount: 10,
      };

      const snapAlpha = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-alpha', name: 'Alpha', weeklyTargetDays: 3 },
        history: [workoutAthleteA, workoutAthleteB],
        routines: [syntheticRoutine],
        referenceNow: NOW,
        storage,
      });

      const snapEmptyGamma = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-gamma', name: 'Gamma', weeklyTargetDays: 3 },
        history: [workoutAthleteA, workoutAthleteB],
        routines: [syntheticRoutine],
        referenceNow: NOW,
        storage,
      });

      assert(
        snapAlpha.totalXp > 0 &&
          snapAlpha.xpLedger.every((e) => e.profileId === 'synth-athlete-alpha'),
        'El perfil Alpha solo debe contabilizar sus propios eventos deportivos'
      );
      assert(
        snapEmptyGamma.totalXp === 0 && snapEmptyGamma.currentRank.id === 'RECRUIT',
        `Un perfil sin entrenamientos propios debe tener 0 XP y rango RECRUIT, obtuvo ${snapEmptyGamma.totalXp}`
      );
    }
  );

  // 4. DESAFÍOS DEPORTIVOS, RECONOCIMIENTO DE DESCANSOS/DESCARGAS Y LAS 8 INSIGNIAS PREMIUM
  await runTest(
    '4. Desafíos semanales y mensuales, respeto de descansos y semanas de descarga, y las 8 categorías de Insignias Premium',
    () => {
      const storage = createMemoryStorage();
      const plan = createPeriodizationMesocyclePlan({
        profileId: 'synth-athlete-pro',
        goal: 'fuerza',
        durationWeeks: 8,
        deloadWeeks: [2, 4, 8],
        now: NOW,
      });
      plan.currentWeekNumber = 2; // Semana 2 es semana de descarga
      savePeriodizationMesocyclePlan(plan, storage);

      const history3Weeks: CompletedWorkout[] = [
        // Semana previa (hace 10 días)
        {
          id: 'w-pro-1',
          profileId: 'synth-athlete-pro',
          routineId: 'routine-synth-1',
          routineTitle: 'Fuerza 1',
          date: '2026-06-08',
          startTime: NOW - 10 * DAY_MS,
          endTime: NOW - 10 * DAY_MS + 3600_000,
          durationSeconds: 3600,
          totalVolumeKg: 2400,
          completedSetsCount: 4,
          totalRepsCount: 32,
          isFinished: true,
          exercisesSummary: [
            {
              exerciseId: 'ex-synth-bench',
              name: 'Press de Banca con Barra',
              muscleGroup: 'Pecho',
              sets: 4,
              maxWeight: 90,
              maxReps: 8,
              volumeKg: 2400,
              setsDetail: [{ setNumber: 1, weight: 90, reps: 8, rpe: 8.0 }],
            },
          ],
        },
        // Semana actual: 3 sesiones completadas (meta semanal = 3) + PR superado
        ...[3, 2, 1].map((daysAgo, idx) => ({
          id: `w-pro-curr-${idx}`,
          profileId: 'synth-athlete-pro',
          routineId: 'routine-synth-1',
          routineTitle: `Fuerza Sem Actual ${idx + 1}`,
          date: `2026-06-${18 - daysAgo}`,
          startTime: NOW - daysAgo * DAY_MS,
          endTime: NOW - daysAgo * DAY_MS + 3600_000,
          durationSeconds: 3600,
          totalVolumeKg: 2800 + idx * 100,
          completedSetsCount: 4,
          totalRepsCount: 32,
          isFinished: true,
          exercisesSummary: [
            {
              exerciseId: 'ex-synth-bench',
              name: 'Press de Banca con Barra',
              muscleGroup: 'Pecho',
              sets: 4,
              maxWeight: 95 + idx * 2.5,
              maxReps: 8,
              volumeKg: 2800 + idx * 100,
              setsDetail: [{ setNumber: 1, weight: 95 + idx * 2.5, reps: 8, rpe: 8.0 }],
            },
          ],
        })),
      ];

      const snap = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-pro', name: 'Atleta Pro', weeklyTargetDays: 3 },
        history: history3Weeks,
        routines: [syntheticRoutine],
        referenceNow: NOW,
        storage,
      });

      assert(snap.challenges.length === 6, 'Deben existir los 6 desafíos deportivos (semanales y mensuales)');
      assert(
        snap.challenges.every((c) => c.restDayHonored === true),
        'Todos los desafíos deben respetar los períodos de descanso sin penalización'
      );
      assert(
        snap.completedChallengesCount >= 5,
        `Con meta semanal cumplida, PR, constancia y descarga debe completar al menos 5 desafíos, obtuvo ${snap.completedChallengesCount}`
      );

      const expectedBadgeIds: EliteBadgeCategoryId[] = [
        'disciplina_acero',
        'fuerza_elite',
        'instinto_kong',
        'constancia',
        'dominio_tecnico',
        'recuperacion_inteligente',
        'progresion_continua',
        'mentalidad_alpha',
      ];
      assert(
        expectedBadgeIds.every((id) => snap.badges.some((b) => b.id === id)),
        'Deben existir las 8 categorías obligatorias de Insignias Premium'
      );

      const techBadge = snap.badges.find((b) => b.id === 'dominio_tecnico')!;
      const recBadge = snap.badges.find((b) => b.id === 'recuperacion_inteligente')!;
      assert(
        techBadge.verificationBasisNote.includes('no constituye verificación biomecánica'),
        'La insignia de técnica debe aclarar que se basa en registros y no afirma verificación biomecánica presencial'
      );
      assert(
        recBadge.verificationBasisNote.includes('no constituye medición fisiológica'),
        'La insignia de recuperación debe aclarar que se basa en registros y no afirma medición fisiológica real'
      );
    }
  );

  // 5. TARJETAS PARA REDES SOCIALES (PNG 1080×1920 Y 1080×1350, LOGO Y URL OFICIAL, PRIVACIDAD POR DEFECTO)
  await runTest(
    '5. Generación de tarjetas PNG (1080×1920 y 1080×1350), 6 tipos oficiales, logotipo y URL oficial, y privacidad por defecto',
    async () => {
      const snap = computeEliteChallengesSnapshot({
        profile: { id: 'synth-athlete-cards', name: 'NombrePrivadoTest', weeklyTargetDays: 4 },
        history: [],
        routines: [syntheticRoutine],
        referenceNow: NOW,
      });

      const requiredCardTypes: SocialCardType[] = [
        'new_pr',
        'workout_completed',
        'new_rank',
        'challenge_completed',
        'weekly_summary',
        'cycle_completed',
      ];

      for (const ct of requiredCardTypes) {
        const preset = snap.socialCardPresets[ct];
        assert(Boolean(preset), `Debe existir el preset de tarjeta social para ${ct}`);
        assert(
          preset.officialLogoPath === OFFICIAL_LAZCAKONG_LOGO_PATH,
          'Debe utilizar el logotipo oficial de LAZCAKONG GYM'
        );
        assert(
          preset.officialAppUrl === resolveOfficialExportAppUrl() &&
            preset.officialAppUrl.startsWith('https://'),
          'Debe utilizar la dirección oficial configurada de la aplicación sin inventar URLs'
        );
        assert(
          preset.privacyProtectedByDefault === true &&
            preset.includeAthleteAlias === false &&
            preset.athleteAlias === undefined,
          'Por defecto no debe exponer el nombre ni datos personales del atleta'
        );
      }

      // Renderizar en 1080×1920 (Stories/Reels) y 1080×1350 (Publicación)
      const storyCard = withSocialCardFormat(snap.socialCardPresets.new_rank, 'story_9_16');
      const postCard = withSocialCardFormat(snap.socialCardPresets.new_rank, 'post_4_5');

      const renderedStory = await renderSocialCardToPngDataUrl(storyCard);
      const renderedPost = await renderSocialCardToPngDataUrl(postCard);

      assert(
        renderedStory.width === 1080 &&
          renderedStory.height === 1920 &&
          renderedStory.mimeType === 'image/png' &&
          renderedStory.dataUrl.startsWith('data:image/png;base64,'),
        'El formato Stories/Reels debe exportar un PNG válido de 1080×1920'
      );
      assert(
        renderedPost.width === 1080 &&
          renderedPost.height === 1350 &&
          renderedPost.mimeType === 'image/png' &&
          renderedPost.dataUrl.startsWith('data:image/png;base64,'),
        'El formato Publicación debe exportar un PNG válido de 1080×1350'
      );
    }
  );

  // 6. COACH INTELLIGENCE PRO: RECONOCIMIENTO DE LOGROS, RESPETO DE VOZ Y NO INTERRUPCIÓN DEL TEMPORIZADOR
  await runTest(
    '6. Coach Intelligence Pro: reconoce logros deportivos, respeta modos de voz, evita repetición y no interrumpe el temporizador de descanso',
    () => {
      const spokenKeys = new Set<string>();
      const mockVoiceAdapter = {
        isAvailable: () => true,
        speak: () => true,
        stop: () => {},
      };

      const recognition = {
        id: 'rec-test-1',
        eventKey: 'elite_rank_synth_WARRIOR',
        milestoneType: 'rank_up' as const,
        headline: 'Rango WARRIOR alcanzado',
        message: 'Has alcanzado el rango WARRIOR.',
        voiceText: 'Reconocimiento Coach LazcaKong: Has alcanzado el rango WARRIOR.',
        isImportant: true,
        respectsRestTimer: true as const,
      };

      // Caso A: Temporizador de descanso activo -> NO debe hablar ni interrumpir la alarma
      const timerActiveRes = speakEliteChallengeRecognition({
        recognition,
        mode: 'full_coach',
        isRestTimerActive: true,
        spokenEventKeys: spokenKeys,
        voiceAdapter: mockVoiceAdapter,
      });
      assert(
        timerActiveRes.spoken === false &&
          timerActiveRes.reason === 'rest_timer_active_protected',
        'No debe emitir voz cuando el temporizador de descanso está activo'
      );

      // Caso B: Modo silencioso -> NO debe hablar
      const silentRes = speakEliteChallengeRecognition({
        recognition,
        mode: 'silent',
        isRestTimerActive: false,
        spokenEventKeys: spokenKeys,
        voiceAdapter: mockVoiceAdapter,
      });
      assert(
        silentRes.spoken === false && silentRes.reason === 'silent_mode',
        'Debe respetar el modo silencioso del Coach'
      );

      // Caso C: Modo important_only sin temporizador -> Habla 1 vez y deduplica la segunda vez
      const firstSpeak = speakEliteChallengeRecognition({
        recognition,
        mode: 'important_only',
        isRestTimerActive: false,
        spokenEventKeys: spokenKeys,
        voiceAdapter: mockVoiceAdapter,
      });
      assert(firstSpeak.spoken === true, 'Debe pronunciar el logro importante');

      const duplicateSpeak = speakEliteChallengeRecognition({
        recognition,
        mode: 'important_only',
        isRestTimerActive: false,
        spokenEventKeys: spokenKeys,
        voiceAdapter: mockVoiceAdapter,
      });
      assert(
        duplicateSpeak.spoken === false && duplicateSpeak.reason === 'duplicate_event',
        'No debe repetir el mismo mensaje de reconocimiento'
      );
    }
  );

  return { passed, total, results };
}

if (typeof process !== 'undefined' && process.argv?.[1]?.includes('eliteChallengesProSuite')) {
  runEliteChallengesProSuite().then((outcome) => {
    console.log(outcome.results.join('\n'));
    console.log(`\nELITE CHALLENGES PRO SUITE: ${outcome.passed}/${outcome.total} PASSED`);
  });
}
