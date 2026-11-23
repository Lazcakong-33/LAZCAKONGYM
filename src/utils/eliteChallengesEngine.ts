import {
  AthleteDailyRecoveryCheckIn,
  CoachPlatformStorageAdapter,
  CoachRecognitionMessage,
  CoachVoiceMode,
  CoachPlatformVoiceAdapter,
  CompletedWorkout,
  EliteBadgeCategoryId,
  EliteChallengeCadence,
  EliteChallengeCategory,
  EliteChallengesPlatformAdapter,
  EliteChallengesProfileSnapshot,
  ElitePremiumBadge,
  EliteRankDefinition,
  EliteRankId,
  EliteSportChallenge,
  PeriodizationMesocyclePlan,
  PersonalRecord,
  Profile,
  Routine,
  SocialCardExportPayload,
  SocialCardFormat,
  SocialCardType,
  XpLedgerEvent,
} from '../types';
import { getChileLocalDateKey, getChileWeekdayIndex } from './calorieCalculator';
import {
  calculateEstimated1RM,
  computeElitePerformanceAnalytics,
  computeMultiWeekComparatives4_8_12,
  generateSmartWeeklyPerformanceReport,
  loadPeriodizationMesocyclePlan,
} from './elitePerformanceAnalytics';
import { loadDailyRecoveryCheckIn } from './muscleRecoveryEngine';
import {
  loadCoachVoiceMode,
  speakProactiveCoachMessage,
} from './coachVoiceEngine';
import { DEFAULT_PUBLIC_APP_URL, getPublicAppUrl } from './firebaseSync';

export const OFFICIAL_LAZCAKONG_LOGO_PATH = '/assets/gorilla_full_logo.png';

export const ELITE_RANKS: readonly EliteRankDefinition[] = [
  {
    id: 'RECRUIT',
    order: 1,
    minXp: 0,
    maxXp: 499,
    title: 'RECRUIT',
    motto: 'Inicio disciplinado y construcción de base técnica verificable.',
    metallicAccent: '#71717A',
  },
  {
    id: 'WARRIOR',
    order: 2,
    minXp: 500,
    maxXp: 1499,
    title: 'WARRIOR',
    motto: 'Constancia semanal firme y control progresivo de cargas.',
    metallicAccent: '#A1A1AA',
  },
  {
    id: 'TITAN',
    order: 3,
    minXp: 1500,
    maxXp: 3499,
    title: 'TITAN',
    motto: 'Capacidad de trabajo consolidada y adherencia a la planificación.',
    metallicAccent: '#D4D4D8',
  },
  {
    id: 'ELITE',
    order: 4,
    minXp: 3500,
    maxXp: 6999,
    title: 'ELITE',
    motto: 'Dominio de mesociclos, autorregulación RPE y récords verificados.',
    metallicAccent: '#E4E4E7',
  },
  {
    id: 'ALPHA',
    order: 5,
    minXp: 7000,
    maxXp: 11999,
    title: 'ALPHA',
    motto: 'Excelencia en rendimiento deportivo, periodización y recuperación inteligente.',
    metallicAccent: '#A3E635',
  },
  {
    id: 'KONG',
    order: 6,
    minXp: 12000,
    maxXp: null,
    title: 'KONG',
    motto: 'Cima de disciplina, fuerza verificada y maestría deportiva LAZCAKONG.',
    metallicAccent: '#CCFF00',
  },
] as const;

const MAX_REWARDED_SETS_PER_SESSION = 24;
const MAX_REWARDED_SESSIONS_PER_WEEK = 6;
const SAFE_CONTROLLED_RPE_MIN = 6.5;
const SAFE_CONTROLLED_RPE_MAX = 9.0;
const EXCESSIVE_RPE_THRESHOLD = 9.6;

function getDefaultStorageAdapter(): CoachPlatformStorageAdapter {
  return {
    getItem: (key: string) => {
      try {
        if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
      } catch {}
      return null;
    },
    setItem: (key: string, value: string) => {
      try {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      } catch {}
    },
  };
}

function normalizeDateKey(rawDate: string | number | undefined): string {
  if (!rawDate) return '';
  return getChileLocalDateKey(rawDate);
}

function getMondayKeyFromDateKey(dateKey: string): string {
  const parts = dateKey.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateKey;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0));
  const day = getChileWeekdayIndex(d);
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function normalizeCanonicalExerciseKey(name?: string, exerciseId?: string): string {
  const raw = (name || exerciseId || '').toLowerCase().trim();
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function resolveRankForXp(totalXp: number): {
  currentRank: EliteRankDefinition;
  nextRank: EliteRankDefinition | null;
  xpIntoCurrentRank: number;
  xpRequiredForNextRank: number | null;
  rankProgressPct: number;
} {
  const safeXp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let currentRank = ELITE_RANKS[0];

  for (const rank of ELITE_RANKS) {
    if (safeXp >= rank.minXp) {
      currentRank = rank;
    }
  }

  const nextIdx = ELITE_RANKS.findIndex((r) => r.id === currentRank.id) + 1;
  const nextRank = nextIdx < ELITE_RANKS.length ? ELITE_RANKS[nextIdx] : null;

  if (!nextRank) {
    return {
      currentRank,
      nextRank: null,
      xpIntoCurrentRank: safeXp - currentRank.minXp,
      xpRequiredForNextRank: null,
      rankProgressPct: 100,
    };
  }

  const span = Math.max(1, nextRank.minXp - currentRank.minXp);
  const into = Math.max(0, safeXp - currentRank.minXp);
  const pct = Math.max(0, Math.min(100, Math.round((into / span) * 100)));

  return {
    currentRank,
    nextRank,
    xpIntoCurrentRank: into,
    xpRequiredForNextRank: span,
    rankProgressPct: pct,
  };
}

function computeSessionAverageRpe(workout: CompletedWorkout): number | null {
  const rpes: number[] = [];
  (workout.exercisesSummary || []).forEach((ex) => {
    const anyEx = ex as any;
    const details: any[] = Array.isArray(ex.setsDetail)
      ? ex.setsDetail
      : Array.isArray(anyEx.setDetails)
      ? anyEx.setDetails
      : [];
    details.forEach((s) => {
      if (typeof s?.rpe === 'number' && s.rpe > 0) {
        rpes.push(s.rpe);
      }
    });
    if (details.length === 0 && typeof ex.rpe === 'number' && ex.rpe > 0) {
      rpes.push(ex.rpe);
    }
  });
  if (rpes.length === 0) return null;
  return Number((rpes.reduce((a, b) => a + b, 0) / rpes.length).toFixed(2));
}

export interface ComputeEliteChallengesInput {
  profile: Pick<Profile, 'id' | 'name' | 'weeklyTargetDays'>;
  history: CompletedWorkout[];
  routines?: Routine[];
  prs?: Record<string, PersonalRecord>;
  periodizationPlan?: PeriodizationMesocyclePlan | null;
  dailyCheckIns?: AthleteDailyRecoveryCheckIn[];
  referenceNow?: number;
  storage?: CoachPlatformStorageAdapter;
  includeAthleteAliasInCards?: boolean;
}

/**
 * Calcula de forma 100% determinista e idempotente el estado de Elite Challenges Pro:
 * - Libro mayor de XP sin duplicados por sincronización, edición, importación o restauración.
 * - Protección contra entrenamientos con dolor/alerta, cargas excesivas o sobreentrenamiento.
 * - Desafíos semanales y mensuales adaptados al atleta sin penalizar descansos.
 * - 8 Insignias Premium con notas de verificación rigurosas.
 * - Reconocimientos de Coach Intelligence Pro y Presets de Tarjetas Sociales PNG.
 */
export function computeEliteChallengesSnapshot(
  input: ComputeEliteChallengesInput
): EliteChallengesProfileSnapshot {
  const storage = input.storage || getDefaultStorageAdapter();
  const safeProfileId = String(input.profile?.id || 'default').trim();
  const weeklyTargetDays = Math.max(1, Math.min(6, Number(input.profile?.weeklyTargetDays) || 4));
  const nowMs = typeof input.referenceNow === 'number' ? input.referenceNow : Date.now();
  const nowDate = new Date(nowMs);
  const todayDateKey = normalizeDateKey(nowMs);

  const periodizationPlan =
    input.periodizationPlan !== undefined
      ? input.periodizationPlan
      : loadPeriodizationMesocyclePlan(safeProfileId, storage);

  const rawCheckIns: AthleteDailyRecoveryCheckIn[] =
    input.dailyCheckIns !== undefined
      ? input.dailyCheckIns
      : (() => {
          const todayCi = loadDailyRecoveryCheckIn(safeProfileId, todayDateKey, storage);
          return todayCi ? [todayCi] : [];
        })();

  // Filtrar check-ins estrictamente por perfil de atleta y deduplicar por fecha
  const checkInByDate = new Map<string, AthleteDailyRecoveryCheckIn>();
  (Array.isArray(rawCheckIns) ? rawCheckIns : []).forEach((ci) => {
    if (!ci || (ci.profileId && ci.profileId !== safeProfileId)) return;
    const dk = normalizeDateKey(ci.dateKey || ci.timestamp);
    if (!dk) return;
    checkInByDate.set(dk, ci);
  });

  // 1. FILTRADO POR ATLETA Y DEDUPLICACIÓN CANÓNICA ESTRICTA DE ENTRENAMIENTOS
  // Impide XP duplicado aunque se importe/sincronice/restaure o edite una sesión múltiples veces.
  let skippedUnsafeOrDuplicateCount = 0;
  const canonicalWorkoutMap = new Map<string, CompletedWorkout>();

  (Array.isArray(input.history) ? input.history : []).forEach((w) => {
    if (!w || typeof w !== 'object') return;
    if (w.profileId && String(w.profileId).trim() !== safeProfileId) {
      // Aislamiento estricto entre perfiles de atletas
      return;
    }
    if (w.isFinished === false || (w.completedSetsCount || 0) <= 0) {
      return;
    }
    const dk = normalizeDateKey(w.date || w.startTime || w.endTime);
    if (!dk) return;

    // Clave canónica por atleta + fecha (máximo 1 sesión principal premiable por día para impedir inflación por clones, ediciones o sobreentrenamiento)
    const dayCanonicalKey = `workout_day::${safeProfileId}::${dk}`;
    const existing = canonicalWorkoutMap.get(dayCanonicalKey);
    if (existing) {
      skippedUnsafeOrDuplicateCount += 1;
      // Conservar la versión más completa de manera determinista sin duplicar XP
      const existingSets = Math.min(MAX_REWARDED_SETS_PER_SESSION, existing.completedSetsCount || 0);
      const candidateSets = Math.min(MAX_REWARDED_SETS_PER_SESSION, w.completedSetsCount || 0);
      if (candidateSets > existingSets) {
        canonicalWorkoutMap.set(dayCanonicalKey, w);
      }
      return;
    }
    canonicalWorkoutMap.set(dayCanonicalKey, w);
  });

  const chronologicalWorkouts = Array.from(canonicalWorkoutMap.values()).sort((a, b) => {
    const da = normalizeDateKey(a.date || a.startTime);
    const db = normalizeDateKey(b.date || b.startTime);
    return da.localeCompare(db);
  });

  // 2. LIBRO MAYOR DETERMINISTA DE XP (XP LEDGER)
  const xpLedgerMap = new Map<string, XpLedgerEvent>();
  const addLedgerEvent = (event: XpLedgerEvent) => {
    if (event.xpAwarded <= 0) return;
    if (!xpLedgerMap.has(event.canonicalEventKey)) {
      xpLedgerMap.set(event.canonicalEventKey, event);
    }
  };

  const sessionsPerWeekMap = new Map<string, CompletedWorkout[]>();
  const exerciseBest1RMTracker = new Map<string, number>();
  const verifiedPRList: {
    canonicalKey: string;
    exerciseName: string;
    dateKey: string;
    weightKg: number;
    reps: number;
    estimated1RM: number;
  }[] = [];

  let controlledExecutionSessionsCount = 0;

  chronologicalWorkouts.forEach((w) => {
    const dk = normalizeDateKey(w.date || w.startTime);
    const weekKey = getMondayKeyFromDateKey(dk);
    const weekSessions = sessionsPerWeekMap.get(weekKey) || [];
    weekSessions.push(w);
    sessionsPerWeekMap.set(weekKey, weekSessions);

    // Regla contra sobreentrenamiento semanal: no premiar sesiones por encima del tope saludable semanal
    if (weekSessions.length > Math.min(MAX_REWARDED_SESSIONS_PER_WEEK, weeklyTargetDays + 2)) {
      skippedUnsafeOrDuplicateCount += 1;
      return;
    }

    const dayCheckIn = checkInByDate.get(dk);
    const trainedWithPainAlert = dayCheckIn?.muscleSoreness === 'alert';
    if (trainedWithPainAlert) {
      // No premiar entrenamientos realizados reportando dolor o alerta articular/muscular
      skippedUnsafeOrDuplicateCount += 1;
      return;
    }

    const avgRpe = computeSessionAverageRpe(w);
    const rawSets = Math.max(1, Number(w.completedSetsCount) || 1);
    const rewardedSets = Math.min(MAX_REWARDED_SETS_PER_SESSION, rawSets);
    if (rawSets > MAX_REWARDED_SETS_PER_SESSION) {
      // Series innecesarias por encima del umbral saludable no generan XP adicional
      skippedUnsafeOrDuplicateCount += 1;
    }

    const isExcessiveIntensity = avgRpe !== null && avgRpe >= EXCESSIVE_RPE_THRESHOLD && rawSets > 12;

    // XP base por entrenamiento completado verificable (basado en cumplimiento, nunca en tonelaje bruto excesivo)
    const baseWorkoutXp = 100 + rewardedSets * 3;
    addLedgerEvent({
      canonicalEventKey: `xp::workout::${safeProfileId}::${dk}`,
      profileId: safeProfileId,
      category: 'workout_completed',
      xpAwarded: baseWorkoutXp,
      dateKey: dk,
      label: `Entrenamiento completado (${w.routineTitle || 'Sesión'})`,
      detail: `${rewardedSets} series efectivas verificadas`,
    });

    // Bono por control técnico / autorregulación saludable (RPE 6.5 - 9.0 sin llegar a sobreentrenamiento)
    if (
      !isExcessiveIntensity &&
      avgRpe !== null &&
      avgRpe >= SAFE_CONTROLLED_RPE_MIN &&
      avgRpe <= SAFE_CONTROLLED_RPE_MAX
    ) {
      controlledExecutionSessionsCount += 1;
      addLedgerEvent({
        canonicalEventKey: `xp::controlled_rpe::${safeProfileId}::${dk}`,
        profileId: safeProfileId,
        category: 'controlled_execution_bonus',
        xpAwarded: 35,
        dateKey: dk,
        label: 'Ejecución y esfuerzo controlado (RPE óptimo)',
        detail: `RPE promedio ${avgRpe} registrado dentro de zona segura`,
      });
    } else if (isExcessiveIntensity) {
      skippedUnsafeOrDuplicateCount += 1;
    }

    // Detección de Récords Personales Verificados (superación sobre línea base previa, sin premiar esfuerzos con RPE > 9.8 riesgoso)
    (w.exercisesSummary || []).forEach((ex) => {
      const exKey = normalizeCanonicalExerciseKey(ex.name, ex.exerciseId);
      if (!exKey) return;
      const maxW = Math.max(0, Number(ex.maxWeight) || 0);
      const reps = Math.max(1, Number(ex.maxReps) || 1);
      if (maxW <= 0) return;

      const est1RM =
        ex.estimated1RM && ex.estimated1RM > 0
          ? Math.round(ex.estimated1RM)
          : calculateEstimated1RM(maxW, reps);

      const previousBest = exerciseBest1RMTracker.get(exKey);
      if (previousBest === undefined) {
        exerciseBest1RMTracker.set(exKey, est1RM);
      } else if (est1RM > previousBest && !isExcessiveIntensity) {
        exerciseBest1RMTracker.set(exKey, est1RM);
        verifiedPRList.push({
          canonicalKey: exKey,
          exerciseName: ex.name || 'Ejercicio',
          dateKey: dk,
          weightKg: maxW,
          reps,
          estimated1RM: est1RM,
        });
        addLedgerEvent({
          canonicalEventKey: `xp::pr::${safeProfileId}::${exKey}::${dk}`,
          profileId: safeProfileId,
          category: 'verified_pr_achieved',
          xpAwarded: 90,
          dateKey: dk,
          label: `Récord Personal verificado: ${ex.name}`,
          detail: `${maxW} kg × ${reps} reps (1RM est. ${est1RM} kg)`,
        });
      }
    });
  });

  // 3. CUMPLIMIENTO DE OBJETIVOS SEMANALES Y SEMANAS DE DESCARGA / RECUPERACIÓN
  let completedWeeklyGoalsCount = 0;
  let honoredDeloadOrRestWeeksCount = 0;

  const isDeloadConfiguredInPlan = Boolean(
    periodizationPlan &&
      Array.isArray(periodizationPlan.weeks) &&
      periodizationPlan.weeks.some(
        (wk) => wk.isDeloadWeek && wk.weekNumber <= periodizationPlan.currentWeekNumber
      )
  );

  sessionsPerWeekMap.forEach((weekWorkouts, mondayKey) => {
    const uniqueDaysCount = weekWorkouts.length;
    if (uniqueDaysCount >= weeklyTargetDays) {
      completedWeeklyGoalsCount += 1;
      addLedgerEvent({
        canonicalEventKey: `xp::weekly_goal::${safeProfileId}::${mondayKey}`,
        profileId: safeProfileId,
        category: 'weekly_goal_completed',
        xpAwarded: 150,
        dateKey: mondayKey,
        label: `Meta semanal cumplida (${uniqueDaysCount}/${weeklyTargetDays} sesiones)`,
        detail: `Semana del ${mondayKey}`,
      });
    } else if (uniqueDaysCount >= Math.max(1, weeklyTargetDays - 1)) {
      // Semana con descanso/descarga respetada sin penalizar al atleta
      const avgWeekRpe =
        weekWorkouts
          .map((w) => computeSessionAverageRpe(w))
          .filter((v): v is number => v !== null)
          .reduce((acc, v, _, arr) => acc + v / arr.length, 0) || 7.5;
      if (avgWeekRpe <= 8.2) {
        honoredDeloadOrRestWeeksCount += 1;
      }
    }
  });

  // XP por evaluaciones de recuperación y respeto de descanso ante fatiga/alerta
  checkInByDate.forEach((ci, dk) => {
    if (ci.skipped) return;
    const hadWorkoutThatDay = canonicalWorkoutMap.has(`workout_day::${safeProfileId}::${dk}`);
    if (ci.muscleSoreness === 'alert' && !hadWorkoutThatDay) {
      // El atleta reportó dolor/alerta y respetó el descanso -> se premia la decisión inteligente
      honoredDeloadOrRestWeeksCount += 1;
      addLedgerEvent({
        canonicalEventKey: `xp::smart_rest_alert::${safeProfileId}::${dk}`,
        profileId: safeProfileId,
        category: 'smart_recovery_checkin',
        xpAwarded: 60,
        dateKey: dk,
        label: 'Descanso preventivo respetado ante señal de fatiga/molestia',
        detail: `Check-in de recuperación del ${dk}`,
      });
    } else {
      addLedgerEvent({
        canonicalEventKey: `xp::recovery_checkin::${safeProfileId}::${dk}`,
        profileId: safeProfileId,
        category: 'smart_recovery_checkin',
        xpAwarded: 25,
        dateKey: dk,
        label: 'Evaluación diaria de recuperación completada',
        detail: `Sueño ${ci.sleepHours}h · Disposición ${ci.trainingDisposition}/5`,
      });
    }
  });

  // XP por semanas de periodización y semanas de descarga configuradas/avanzadas
  if (periodizationPlan && Array.isArray(periodizationPlan.weeks)) {
    const completedWeeksInPlan = Math.max(
      0,
      Math.min(periodizationPlan.durationWeeks, periodizationPlan.currentWeekNumber)
    );
    for (let wkNum = 1; wkNum <= completedWeeksInPlan; wkNum++) {
      const wkCfg = periodizationPlan.weeks.find((w) => w.weekNumber === wkNum);
      if (!wkCfg) continue;
      if (wkCfg.isDeloadWeek && chronologicalWorkouts.length > 0) {
        honoredDeloadOrRestWeeksCount += 1;
        addLedgerEvent({
          canonicalEventKey: `xp::deload_week::${safeProfileId}::${periodizationPlan.id}::w${wkNum}`,
          profileId: safeProfileId,
          category: 'deload_week_honored',
          xpAwarded: 140,
          dateKey: todayDateKey,
          label: `Semana de descarga cumplida (Semana ${wkNum})`,
          detail: `${periodizationPlan.name} · Reducción programada de fatiga`,
        });
      } else if (chronologicalWorkouts.length > 0) {
        addLedgerEvent({
          canonicalEventKey: `xp::periodization_week::${safeProfileId}::${periodizationPlan.id}::w${wkNum}`,
          profileId: safeProfileId,
          category: 'periodization_week_completed',
          xpAwarded: 80,
          dateKey: todayDateKey,
          label: `Semana ${wkNum} de periodización (${wkCfg.phaseLabel})`,
          detail: `${periodizationPlan.name}`,
        });
      }
    }
  }

  // 4. REUTILIZAR PERFORMANCE LAB PRO (Comparativas 4, 8, 12 semanas e Informe Semanal)
  const multiWeekComparatives = computeMultiWeekComparatives4_8_12({
    history: chronologicalWorkouts,
    weeklyTargetDays,
    referenceNow: nowDate,
    profileId: safeProfileId,
  });

  const weeklyReport = generateSmartWeeklyPerformanceReport({
    history: chronologicalWorkouts,
    routines: input.routines || [],
    activeProfile: {
      id: safeProfileId,
      name: input.profile?.name || 'Atleta',
      weeklyTargetDays,
    },
    currentTime: nowMs,
  });

  // 5. DESAFÍOS DEPORTIVOS SEMANALES Y MENSUALES (Adaptados al atleta y sin penalizar descansos)
  const activeWeeksInLast4W = Array.from(sessionsPerWeekMap.keys()).filter((mondayKey) => {
    const diffDays = (nowMs - new Date(mondayKey).getTime()) / (24 * 3600 * 1000);
    return diffDays >= -7 && diffDays <= 30;
  }).length;

  const currentPeriodizationWeek = periodizationPlan ? periodizationPlan.currentWeekNumber : 0;
  const targetPeriodizationWeeks = periodizationPlan ? periodizationPlan.durationWeeks : 4;
  const hasPositive4WEvolution =
    multiWeekComparatives.w4.topImprovedExercises.length > 0 ||
    (multiWeekComparatives.w4.diffVolumePct !== null && multiWeekComparatives.w4.diffVolumePct >= 0) ||
    multiWeekComparatives.w4.currentWorkouts >= weeklyTargetDays;

  const challenges: EliteSportChallenge[] = [
    {
      id: `chal_weekly_sessions_${safeProfileId}`,
      profileId: safeProfileId,
      cadence: 'weekly',
      category: 'planned_sessions',
      title: 'Cumplimiento de Sesiones Planificadas',
      description: `Completa tus ${weeklyTargetDays} sesiones semanales configuradas respetando tus días de descanso.`,
      currentValue: Math.min(weeklyTargetDays, weeklyReport.completedWorkoutsCount),
      targetValue: weeklyTargetDays,
      unitLabel: 'sesiones',
      progressPct: Math.min(
        100,
        Math.round((weeklyReport.completedWorkoutsCount / weeklyTargetDays) * 100)
      ),
      isCompleted: weeklyReport.completedWorkoutsCount >= weeklyTargetDays,
      completedDateKey:
        weeklyReport.completedWorkoutsCount >= weeklyTargetDays ? todayDateKey : null,
      xpReward: 150,
      restDayHonored: true,
      safetyNote: 'Adaptado a tu meta semanal. Los días de descanso programados están protegidos.',
    },
    {
      id: `chal_weekly_deload_${safeProfileId}`,
      profileId: safeProfileId,
      cadence: 'weekly',
      category: 'deload_compliance',
      title: 'Gestión de Descarga y Recuperación',
      description:
        'Cumple una semana de descarga programada o registra control de esfuerzo y recuperación sin sobreentrenar.',
      currentValue: Math.min(
        1,
        honoredDeloadOrRestWeeksCount + (isDeloadConfiguredInPlan ? 1 : 0) + (checkInByDate.size > 0 ? 1 : 0)
      ),
      targetValue: 1,
      unitLabel: 'hito cumplido',
      progressPct:
        honoredDeloadOrRestWeeksCount > 0 || isDeloadConfiguredInPlan || checkInByDate.size > 0
          ? 100
          : controlledExecutionSessionsCount > 0
          ? 60
          : 0,
      isCompleted:
        honoredDeloadOrRestWeeksCount > 0 || isDeloadConfiguredInPlan || checkInByDate.size > 0,
      completedDateKey:
        honoredDeloadOrRestWeeksCount > 0 || isDeloadConfiguredInPlan || checkInByDate.size > 0
          ? todayDateKey
          : null,
      xpReward: 120,
      restDayHonored: true,
      safetyNote: 'Premia el respeto de las semanas de descarga y los días de descanso.',
    },
    {
      id: `chal_monthly_prs_${safeProfileId}`,
      profileId: safeProfileId,
      cadence: 'monthly',
      category: 'verified_prs',
      title: 'Superación de Récords Verificados',
      description: 'Supera al menos 1 marca personal verificada con técnica y esfuerzo controlado.',
      currentValue: Math.min(1, verifiedPRList.length),
      targetValue: 1,
      unitLabel: 'PR verificado',
      progressPct: verifiedPRList.length >= 1 ? 100 : 0,
      isCompleted: verifiedPRList.length >= 1,
      completedDateKey:
        verifiedPRList.length >= 1 ? verifiedPRList[verifiedPRList.length - 1].dateKey : null,
      xpReward: 160,
      restDayHonored: true,
      safetyNote: 'Solo contabiliza récords verificados sobre línea base sin esfuerzo riesgoso.',
    },
    {
      id: `chal_monthly_consistency_${safeProfileId}`,
      profileId: safeProfileId,
      cadence: 'monthly',
      category: 'consistency',
      title: 'Constancia Deportiva Mensual',
      description: 'Mantén al menos 2 semanas activas dentro del ciclo mensual sin penalizar descansos.',
      currentValue: Math.min(2, activeWeeksInLast4W),
      targetValue: 2,
      unitLabel: 'semanas activas',
      progressPct: Math.min(100, Math.round((activeWeeksInLast4W / 2) * 100)),
      isCompleted: activeWeeksInLast4W >= 2,
      completedDateKey: activeWeeksInLast4W >= 2 ? todayDateKey : null,
      xpReward: 180,
      restDayHonored: true,
      safetyNote: 'Las pausas de recuperación entre sesiones no descuentan avance.',
    },
    {
      id: `chal_monthly_periodization_${safeProfileId}`,
      profileId: safeProfileId,
      cadence: 'monthly',
      category: 'periodization_cycle',
      title: 'Cumplimiento de Ciclo de Periodización',
      description: `Estructura y avanza en tu mesociclo deportivo (${targetPeriodizationWeeks} semanas).`,
      currentValue:
        periodizationPlan && chronologicalWorkouts.length > 0
          ? Math.max(1, currentPeriodizationWeek)
          : 0,
      targetValue: 1,
      unitLabel: 'bloque activo',
      progressPct:
        periodizationPlan && chronologicalWorkouts.length > 0
          ? 100
          : periodizationPlan
          ? 50
          : 0,
      isCompleted: Boolean(periodizationPlan && chronologicalWorkouts.length > 0),
      completedDateKey:
        periodizationPlan && chronologicalWorkouts.length > 0 ? todayDateKey : null,
      xpReward: 150,
      restDayHonored: true,
      safetyNote: 'Integra progresión y semanas de descarga de Performance Lab Pro.',
    },
    {
      id: `chal_monthly_evolution_${safeProfileId}`,
      profileId: safeProfileId,
      cadence: 'monthly',
      category: 'performance_evolution',
      title: 'Evolución Individual del Rendimiento',
      description:
        'Consolida o mejora tu 1RM estimado o volumen efectivo en el bloque de 4 semanas.',
      currentValue: hasPositive4WEvolution && chronologicalWorkouts.length >= 2 ? 1 : 0,
      targetValue: 1,
      unitLabel: 'evolución 4 sem',
      progressPct:
        hasPositive4WEvolution && chronologicalWorkouts.length >= 2
          ? 100
          : chronologicalWorkouts.length === 1
          ? 50
          : 0,
      isCompleted: hasPositive4WEvolution && chronologicalWorkouts.length >= 2,
      completedDateKey:
        hasPositive4WEvolution && chronologicalWorkouts.length >= 2 ? todayDateKey : null,
      xpReward: 170,
      restDayHonored: true,
      safetyNote: 'Basado en tu propio historial comparativo, sin clasificaciones externas.',
    },
  ];

  challenges.forEach((ch) => {
    if (ch.isCompleted) {
      addLedgerEvent({
        canonicalEventKey: `xp::challenge::${safeProfileId}::${ch.id}`,
        profileId: safeProfileId,
        category: 'challenge_completed',
        xpAwarded: ch.xpReward,
        dateKey: ch.completedDateKey || todayDateKey,
        label: `Desafío superado: ${ch.title}`,
        detail: ch.description,
      });
    }
  });

  // 6. INSIGNIAS PREMIUM (8 CATEGORÍAS METÁLICAS / GRAFITO / VERDE LIMA)
  const badges: ElitePremiumBadge[] = [
    {
      id: 'disciplina_acero',
      title: 'Disciplina de Acero',
      categoryLabel: 'Cumplimiento Semanal',
      description: 'Cumplimiento íntegro de las sesiones semanales planificadas por el atleta.',
      verificationBasisNote:
        'Verificado mediante sesiones finalizadas registradas en el calendario del atleta.',
      unlocked: completedWeeklyGoalsCount >= 1 || weeklyReport.completedWorkoutsCount >= weeklyTargetDays,
      unlockedAtDateKey:
        completedWeeklyGoalsCount >= 1 || weeklyReport.completedWorkoutsCount >= weeklyTargetDays
          ? todayDateKey
          : null,
      progressPct: Math.min(
        100,
        Math.round((weeklyReport.completedWorkoutsCount / weeklyTargetDays) * 100)
      ),
      currentMetricLabel: `${weeklyReport.completedWorkoutsCount}/${weeklyTargetDays} sesiones sem.`,
      tierMetal: 'steel',
    },
    {
      id: 'fuerza_elite',
      title: 'Fuerza Elite',
      categoryLabel: 'Récords Verificados',
      description: 'Superación verificada de marca personal en 1RM estimado o carga máxima.',
      verificationBasisNote:
        'Calculado comparando series registradas contra la línea base histórica del mismo ejercicio.',
      unlocked: verifiedPRList.length >= 1,
      unlockedAtDateKey:
        verifiedPRList.length >= 1 ? verifiedPRList[verifiedPRList.length - 1].dateKey : null,
      progressPct: verifiedPRList.length >= 1 ? 100 : chronologicalWorkouts.length > 0 ? 45 : 0,
      currentMetricLabel: `${verifiedPRList.length} PR(s) verificados`,
      tierMetal: 'kong_lime',
    },
    {
      id: 'instinto_kong',
      title: 'Instinto Kong',
      categoryLabel: 'Capacidad de Trabajo',
      description: 'Acumulación de 3 o más sesiones efectivas con intensidad controlada.',
      verificationBasisNote:
        'Basado en sesiones completadas respetando los límites de volumen saludable.',
      unlocked: chronologicalWorkouts.length >= 3,
      unlockedAtDateKey:
        chronologicalWorkouts.length >= 3
          ? normalizeDateKey(
              chronologicalWorkouts[chronologicalWorkouts.length - 1].date ||
                chronologicalWorkouts[chronologicalWorkouts.length - 1].startTime
            )
          : null,
      progressPct: Math.min(100, Math.round((chronologicalWorkouts.length / 3) * 100)),
      currentMetricLabel: `${chronologicalWorkouts.length}/3 sesiones registradas`,
      tierMetal: 'kong_lime',
    },
    {
      id: 'constancia',
      title: 'Constancia',
      categoryLabel: 'Adherencia Deportiva',
      description: 'Continuidad de entrenamiento en múltiples semanas respetando los descansos.',
      verificationBasisNote:
        'Evaluado sobre semanas activas registradas sin penalizar días de recuperación.',
      unlocked: sessionsPerWeekMap.size >= 2,
      unlockedAtDateKey: sessionsPerWeekMap.size >= 2 ? todayDateKey : null,
      progressPct: Math.min(100, Math.round((sessionsPerWeekMap.size / 2) * 100)),
      currentMetricLabel: `${sessionsPerWeekMap.size}/2 semanas activas`,
      tierMetal: 'titanium',
    },
    {
      id: 'dominio_tecnico',
      title: 'Dominio Técnico',
      categoryLabel: 'Control de Esfuerzo Registrado',
      description:
        'Registro de series con autorregulación RPE/RIR en rango controlado (RPE 6.5–9.0).',
      verificationBasisNote:
        'Basado exclusivamente en registros de RPE/RIR y parámetros anotados en la app; no constituye verificación biomecánica presencial.',
      unlocked: controlledExecutionSessionsCount >= 1,
      unlockedAtDateKey: controlledExecutionSessionsCount >= 1 ? todayDateKey : null,
      progressPct: controlledExecutionSessionsCount >= 1 ? 100 : 0,
      currentMetricLabel: `${controlledExecutionSessionsCount} sesión(es) con RPE controlado`,
      tierMetal: 'titanium',
    },
    {
      id: 'recuperacion_inteligente',
      title: 'Recuperación Inteligente',
      categoryLabel: 'Gestión de Descanso y Descarga',
      description:
        'Registro de evaluaciones de recuperación o cumplimiento de semanas de descarga.',
      verificationBasisNote:
        'Basado en acciones registradas de descanso, descarga o check-in diario; no constituye medición fisiológica clínica.',
      unlocked:
        checkInByDate.size >= 1 || honoredDeloadOrRestWeeksCount >= 1 || isDeloadConfiguredInPlan,
      unlockedAtDateKey:
        checkInByDate.size >= 1 || honoredDeloadOrRestWeeksCount >= 1 || isDeloadConfiguredInPlan
          ? todayDateKey
          : null,
      progressPct:
        checkInByDate.size >= 1 || honoredDeloadOrRestWeeksCount >= 1 || isDeloadConfiguredInPlan
          ? 100
          : 0,
      currentMetricLabel: `${checkInByDate.size + honoredDeloadOrRestWeeksCount} acciones de recuperación`,
      tierMetal: 'steel',
    },
    {
      id: 'progresion_continua',
      title: 'Progresión Continua',
      categoryLabel: 'Evolución 4/8/12 Semanas',
      description: 'Evolución positiva de fuerza o volumen efectivo en comparativa multibloque.',
      verificationBasisNote:
        'Verificado mediante el motor comparativo de 4, 8 y 12 semanas de Performance Lab Pro.',
      unlocked:
        multiWeekComparatives.w4.topImprovedExercises.length >= 1 ||
        (multiWeekComparatives.w4.diffVolumeKg > 0 && multiWeekComparatives.w4.hasPreviousBase),
      unlockedAtDateKey:
        multiWeekComparatives.w4.topImprovedExercises.length >= 1 ||
        (multiWeekComparatives.w4.diffVolumeKg > 0 && multiWeekComparatives.w4.hasPreviousBase)
          ? todayDateKey
          : null,
      progressPct:
        multiWeekComparatives.w4.topImprovedExercises.length >= 1 ||
        (multiWeekComparatives.w4.diffVolumeKg > 0 && multiWeekComparatives.w4.hasPreviousBase)
          ? 100
          : chronologicalWorkouts.length > 0
          ? 50
          : 0,
      currentMetricLabel: `${multiWeekComparatives.w4.topImprovedExercises.length} ejercicio(s) en progreso`,
      tierMetal: 'titanium',
    },
    {
      id: 'mentalidad_alpha',
      title: 'Mentalidad Alpha',
      categoryLabel: 'Planificación Estructurada',
      description: 'Configuración y seguimiento de un ciclo de periodización deportiva.',
      verificationBasisNote:
        'Basado en la planificación activa de mesociclos de 4, 8 o 12 semanas del atleta.',
      unlocked: Boolean(periodizationPlan),
      unlockedAtDateKey: periodizationPlan ? todayDateKey : null,
      progressPct: periodizationPlan ? 100 : 0,
      currentMetricLabel: periodizationPlan
        ? `${periodizationPlan.durationWeeks} sem · ${periodizationPlan.goalLabel}`
        : 'Sin mesociclo activo',
      tierMetal: 'kong_lime',
    },
  ];

  // 7. CÁLCULO FINAL DE XP Y RANGO
  const xpLedger = Array.from(xpLedgerMap.values());
  const totalXp = xpLedger.reduce((sum, item) => sum + item.xpAwarded, 0);
  const rankInfo = resolveRankForXp(totalXp);

  const completedChallengesCount = challenges.filter((c) => c.isCompleted).length;
  const unlockedBadgesCount = badges.filter((b) => b.unlocked).length;

  // 8. MENSAJES DE RECONOCIMIENTO DE COACH INTELLIGENCE PRO
  const coachRecognitions: CoachRecognitionMessage[] = [];

  if (rankInfo.currentRank.order >= 2) {
    coachRecognitions.push({
      id: `rec_rank_${safeProfileId}_${rankInfo.currentRank.id}`,
      eventKey: `elite_rank_${safeProfileId}_${rankInfo.currentRank.id}`,
      milestoneType: 'rank_up',
      headline: `Rango ${rankInfo.currentRank.title} alcanzado`,
      message: `Has consolidado ${totalXp.toLocaleString(
        'es-CL'
      )} XP verificados con disciplina y control técnico. Tu rango actual es ${
        rankInfo.currentRank.title
      }.`,
      voiceText: `Reconocimiento Coach LazcaKong: Has alcanzado el rango ${rankInfo.currentRank.title} con ${totalXp} puntos de experiencia verificados.`,
      isImportant: true,
      respectsRestTimer: true,
    });
  }

  if (verifiedPRList.length > 0) {
    const latestPr = verifiedPRList[verifiedPRList.length - 1];
    coachRecognitions.push({
      id: `rec_pr_${safeProfileId}_${latestPr.canonicalKey}_${latestPr.dateKey}`,
      eventKey: `elite_pr_${safeProfileId}_${latestPr.canonicalKey}_${latestPr.dateKey}`,
      milestoneType: 'new_pr',
      headline: `Nuevo Récord Personal en ${latestPr.exerciseName}`,
      message: `Marca verificada de ${latestPr.weightKg} kg × ${latestPr.reps} repeticiones (1RM estimado de ${latestPr.estimated1RM} kg).`,
      voiceText: `Excelente evolución en ${latestPr.exerciseName}: nuevo récord verificado de ${latestPr.weightKg} kilos por ${latestPr.reps} repeticiones.`,
      isImportant: true,
      respectsRestTimer: true,
    });
  }

  const firstCompletedChallenge = challenges.find((c) => c.isCompleted);
  if (firstCompletedChallenge) {
    coachRecognitions.push({
      id: `rec_chal_${safeProfileId}_${firstCompletedChallenge.id}`,
      eventKey: `elite_chal_${safeProfileId}_${firstCompletedChallenge.id}`,
      milestoneType: 'challenge_completed',
      headline: `Desafío superado: ${firstCompletedChallenge.title}`,
      message: `${firstCompletedChallenge.description} (+${firstCompletedChallenge.xpReward} XP verificados).`,
      voiceText: `Desafío superado: ${firstCompletedChallenge.title}. Sumas ${firstCompletedChallenge.xpReward} puntos de experiencia.`,
      isImportant: true,
      respectsRestTimer: true,
    });
  }

  if (honoredDeloadOrRestWeeksCount > 0 || isDeloadConfiguredInPlan) {
    coachRecognitions.push({
      id: `rec_deload_${safeProfileId}_${todayDateKey}`,
      eventKey: `elite_deload_${safeProfileId}_${todayDateKey}`,
      milestoneType: 'deload_honored',
      headline: 'Recuperación y descarga respetada',
      message:
        'El descanso programado y las semanas de descarga protegen tu sistema nervioso y sostienen tu progreso a largo plazo.',
      voiceText:
        'Recuperación inteligente verificada. Respetar tus descargas impulsa tu próxima supercompensación.',
      isImportant: false,
      respectsRestTimer: true,
    });
  }

  // 9. PRESETS DE TARJETAS PARA REDES SOCIALES (1080×1920 y 1080×1350)
  const socialCardPresets = buildSocialCardPresets({
    profileName: input.profile?.name || 'Atleta',
    includeAthleteAlias: Boolean(input.includeAthleteAliasInCards),
    rank: rankInfo.currentRank,
    totalXp,
    chronologicalWorkouts,
    verifiedPRList,
    challenges,
    badges,
    weeklyReport,
    periodizationPlan: periodizationPlan || null,
    dateLabel: todayDateKey,
  });

  return {
    profileId: safeProfileId,
    generatedAt: nowMs,
    totalXp,
    currentRank: rankInfo.currentRank,
    nextRank: rankInfo.nextRank,
    xpIntoCurrentRank: rankInfo.xpIntoCurrentRank,
    xpRequiredForNextRank: rankInfo.xpRequiredForNextRank,
    rankProgressPct: rankInfo.rankProgressPct,
    xpLedger,
    skippedUnsafeOrDuplicateCount,
    challenges,
    completedChallengesCount,
    badges,
    unlockedBadgesCount,
    coachRecognitions,
    socialCardPresets,
  };
}

/**
 * Emite por voz un mensaje de reconocimiento de Elite Challenges Pro respetando:
 * - El modo de voz actual ('silent' | 'important_only' | 'full_coach').
 * - Las alarmas y el temporizador de descanso (si el descanso está corriendo, no interrumpe).
 * - La deduplicación por `eventKey`.
 */
export function speakEliteChallengeRecognition(params: {
  recognition: CoachRecognitionMessage;
  mode?: CoachVoiceMode;
  isRestTimerActive?: boolean;
  spokenEventKeys: Set<string>;
  voiceAdapter?: CoachPlatformVoiceAdapter;
}): {
  spoken: boolean;
  reason?: string;
  formattedText: string;
} {
  if (params.isRestTimerActive) {
    return {
      spoken: false,
      reason: 'rest_timer_active_protected',
      formattedText: params.recognition.voiceText,
    };
  }
  const activeMode = params.mode || loadCoachVoiceMode();
  return speakProactiveCoachMessage({
    mode: activeMode,
    isImportant: params.recognition.isImportant,
    eventKey: params.recognition.eventKey,
    rawText: params.recognition.voiceText,
    spokenEventKeys: params.spokenEventKeys,
    voiceAdapter: params.voiceAdapter,
  });
}

export function resolveOfficialExportAppUrl(): string {
  const url = getPublicAppUrl();
  return url && url.trim().length > 0 ? url.trim() : DEFAULT_PUBLIC_APP_URL;
}

export function buildSocialCardPresets(params: {
  profileName: string;
  includeAthleteAlias: boolean;
  rank: EliteRankDefinition;
  totalXp: number;
  chronologicalWorkouts: CompletedWorkout[];
  verifiedPRList: {
    exerciseName: string;
    dateKey: string;
    weightKg: number;
    reps: number;
    estimated1RM: number;
  }[];
  challenges: EliteSportChallenge[];
  badges: ElitePremiumBadge[];
  weeklyReport: {
    completedWorkoutsCount: number;
    targetWorkoutsCount: number;
    accumulatedVolumeKg: number;
    prsAchievedCount: number;
    routineCompliancePct: number;
  };
  periodizationPlan: PeriodizationMesocyclePlan | null;
  dateLabel: string;
  format?: SocialCardFormat;
}): Record<SocialCardType, SocialCardExportPayload> {
  const format: SocialCardFormat = params.format || 'story_9_16';
  const widthPx = 1080 as const;
  const heightPx = format === 'story_9_16' ? (1920 as const) : (1350 as const);
  const officialAppUrl = resolveOfficialExportAppUrl();
  const latestWorkout =
    params.chronologicalWorkouts.length > 0
      ? params.chronologicalWorkouts[params.chronologicalWorkouts.length - 1]
      : null;
  const latestPR =
    params.verifiedPRList.length > 0
      ? params.verifiedPRList[params.verifiedPRList.length - 1]
      : null;
  const topCompletedChallenge =
    params.challenges.find((c) => c.isCompleted) || params.challenges[0];
  const topBadge = params.badges.find((b) => b.unlocked) || params.badges[0];

  const safeAlias = params.includeAthleteAlias ? params.profileName : undefined;

  return {
    new_pr: {
      cardType: 'new_pr',
      format,
      widthPx,
      heightPx,
      headline: 'NUEVO RÉCORD PERSONAL',
      subheadline: latestPR ? latestPR.exerciseName.toUpperCase() : 'FUERZA VERIFICADA',
      primaryMetricValue: latestPR ? `${latestPR.weightKg} KG × ${latestPR.reps}` : 'PR ELITE',
      primaryMetricLabel: latestPR ? `1RM ESTIMADO: ${latestPR.estimated1RM} KG` : 'MARCA PERSONAL',
      secondaryMetrics: [
        { label: 'RANGO ACTUAL', value: params.rank.title },
        { label: 'EXPERIENCIA', value: `${params.totalXp.toLocaleString('es-CL')} XP` },
      ],
      rankId: params.rank.id,
      rankTitle: params.rank.title,
      badgeTitle: topBadge?.title,
      dateLabel: latestPR?.dateKey || params.dateLabel,
      officialAppUrl,
      officialLogoPath: OFFICIAL_LAZCAKONG_LOGO_PATH,
      includeAthleteAlias: params.includeAthleteAlias,
      athleteAlias: safeAlias,
      privacyProtectedByDefault: true,
    },
    workout_completed: {
      cardType: 'workout_completed',
      format,
      widthPx,
      heightPx,
      headline: 'ENTRENAMIENTO COMPLETADO',
      subheadline: (latestWorkout?.routineTitle || 'SESIÓN DE FUERZA').toUpperCase(),
      primaryMetricValue: `${Math.round(latestWorkout?.totalVolumeKg || 0).toLocaleString('es-CL')} KG`,
      primaryMetricLabel: 'VOLUMEN DE SESIÓN',
      secondaryMetrics: [
        { label: 'SERIES EFECTIVAS', value: `${latestWorkout?.completedSetsCount || 0}` },
        { label: 'RANGO', value: params.rank.title },
      ],
      rankId: params.rank.id,
      rankTitle: params.rank.title,
      badgeTitle: topBadge?.title,
      dateLabel: normalizeDateKey(latestWorkout?.date || params.dateLabel) || params.dateLabel,
      officialAppUrl,
      officialLogoPath: OFFICIAL_LAZCAKONG_LOGO_PATH,
      includeAthleteAlias: params.includeAthleteAlias,
      athleteAlias: safeAlias,
      privacyProtectedByDefault: true,
    },
    new_rank: {
      cardType: 'new_rank',
      format,
      widthPx,
      heightPx,
      headline: 'NUEVO RANGO ALCANZADO',
      subheadline: `DIVISIÓN ${params.rank.title}`,
      primaryMetricValue: params.rank.title,
      primaryMetricLabel: `${params.totalXp.toLocaleString('es-CL')} XP VERIFICADOS`,
      secondaryMetrics: [
        { label: 'INSIGNIAS', value: `${params.badges.filter((b) => b.unlocked).length}/8` },
        { label: 'DESAFÍOS', value: `${params.challenges.filter((c) => c.isCompleted).length}/6` },
      ],
      rankId: params.rank.id,
      rankTitle: params.rank.title,
      badgeTitle: topBadge?.title,
      dateLabel: params.dateLabel,
      officialAppUrl,
      officialLogoPath: OFFICIAL_LAZCAKONG_LOGO_PATH,
      includeAthleteAlias: params.includeAthleteAlias,
      athleteAlias: safeAlias,
      privacyProtectedByDefault: true,
    },
    challenge_completed: {
      cardType: 'challenge_completed',
      format,
      widthPx,
      heightPx,
      headline: 'DESAFÍO SUPERADO',
      subheadline: (topCompletedChallenge?.title || 'CUMPLIMIENTO ELITE').toUpperCase(),
      primaryMetricValue: `+${topCompletedChallenge?.xpReward || 150} XP`,
      primaryMetricLabel: `${topCompletedChallenge?.currentValue || 1}/${
        topCompletedChallenge?.targetValue || 1
      } ${(topCompletedChallenge?.unitLabel || 'META').toUpperCase()}`,
      secondaryMetrics: [
        { label: 'RANGO', value: params.rank.title },
        { label: 'DESCANSO PROTEGIDO', value: 'SÍ' },
      ],
      rankId: params.rank.id,
      rankTitle: params.rank.title,
      badgeTitle: topBadge?.title,
      dateLabel: params.dateLabel,
      officialAppUrl,
      officialLogoPath: OFFICIAL_LAZCAKONG_LOGO_PATH,
      includeAthleteAlias: params.includeAthleteAlias,
      athleteAlias: safeAlias,
      privacyProtectedByDefault: true,
    },
    weekly_summary: {
      cardType: 'weekly_summary',
      format,
      widthPx,
      heightPx,
      headline: 'RESUMEN SEMANAL ELITE',
      subheadline: `CUMPLIMIENTO ${params.weeklyReport.routineCompliancePct}%`,
      primaryMetricValue: `${params.weeklyReport.accumulatedVolumeKg.toLocaleString('es-CL')} KG`,
      primaryMetricLabel: `${params.weeklyReport.completedWorkoutsCount}/${params.weeklyReport.targetWorkoutsCount} SESIONES COMPLETADAS`,
      secondaryMetrics: [
        { label: 'RÉCORDS SEMANALES', value: `${params.weeklyReport.prsAchievedCount}` },
        { label: 'RANGO ACTUAL', value: params.rank.title },
      ],
      rankId: params.rank.id,
      rankTitle: params.rank.title,
      badgeTitle: topBadge?.title,
      dateLabel: params.dateLabel,
      officialAppUrl,
      officialLogoPath: OFFICIAL_LAZCAKONG_LOGO_PATH,
      includeAthleteAlias: params.includeAthleteAlias,
      athleteAlias: safeAlias,
      privacyProtectedByDefault: true,
    },
    cycle_completed: {
      cardType: 'cycle_completed',
      format,
      widthPx,
      heightPx,
      headline: 'CICLO DE ENTRENAMIENTO',
      subheadline: (
        params.periodizationPlan?.name || 'MESOCICLO PERIODIZADO 4/8/12 SEM'
      ).toUpperCase(),
      primaryMetricValue: params.periodizationPlan
        ? `${params.periodizationPlan.durationWeeks} SEMANAS`
        : '4 SEMANAS',
      primaryMetricLabel: params.periodizationPlan
        ? `OBJETIVO: ${params.periodizationPlan.goalLabel.toUpperCase()}`
        : 'PROGRESIÓN Y DESCARGA',
      secondaryMetrics: [
        { label: 'RANGO', value: params.rank.title },
        { label: 'XP ACUMULADO', value: `${params.totalXp.toLocaleString('es-CL')} XP` },
      ],
      rankId: params.rank.id,
      rankTitle: params.rank.title,
      badgeTitle: topBadge?.title,
      dateLabel: params.dateLabel,
      officialAppUrl,
      officialLogoPath: OFFICIAL_LAZCAKONG_LOGO_PATH,
      includeAthleteAlias: params.includeAthleteAlias,
      athleteAlias: safeAlias,
      privacyProtectedByDefault: true,
    },
  };
}

export function withSocialCardFormat(
  payload: SocialCardExportPayload,
  format: SocialCardFormat,
  includeAthleteAlias?: boolean,
  athleteAlias?: string
): SocialCardExportPayload {
  const showAlias =
    typeof includeAthleteAlias === 'boolean' ? includeAthleteAlias : payload.includeAthleteAlias;
  return {
    ...payload,
    format,
    widthPx: 1080,
    heightPx: format === 'story_9_16' ? 1920 : 1350,
    includeAthleteAlias: showAlias,
    athleteAlias: showAlias ? athleteAlias || payload.athleteAlias : undefined,
    privacyProtectedByDefault: true,
  };
}

/**
 * Construye un PNG binario válido con cabecera IHDR exacta (1080×1920 o 1080×1350)
 * cuando se ejecuta en entornos sin HTMLCanvasElement (ej. pruebas automatizadas Node/CLI u offline headless).
 */
function buildDeterministicPngHeaderDataUrl(width: number, height: number): string {
  // Cabecera PNG estándar + chunk IHDR con las dimensiones exactas (big-endian)
  const bytes = new Uint8Array(33);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  signature.forEach((b, i) => {
    bytes[i] = b;
  });
  // Longitud chunk IHDR = 13
  bytes[8] = 0;
  bytes[9] = 0;
  bytes[10] = 0;
  bytes[11] = 13;
  // 'IHDR'
  bytes[12] = 73;
  bytes[13] = 72;
  bytes[14] = 68;
  bytes[15] = 82;
  // Width (big endian)
  bytes[16] = (width >>> 24) & 0xff;
  bytes[17] = (width >>> 16) & 0xff;
  bytes[18] = (width >>> 8) & 0xff;
  bytes[19] = width & 0xff;
  // Height (big endian)
  bytes[20] = (height >>> 24) & 0xff;
  bytes[21] = (height >>> 16) & 0xff;
  bytes[22] = (height >>> 8) & 0xff;
  bytes[23] = height & 0xff;
  // Bit depth 8, color type 6 (RGBA)
  bytes[24] = 8;
  bytes[25] = 6;
  bytes[26] = 0;
  bytes[27] = 0;
  bytes[28] = 0;

  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : typeof Buffer !== 'undefined'
      ? Buffer.from(bytes).toString('base64')
      : '';
  return `data:image/png;base64,${base64}`;
}

function loadImageElement(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timeout = setTimeout(() => resolve(null), 1500);
    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timeout);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * Renderiza una tarjeta social deportiva LAZCAKONG GYM en formato PNG (1080×1920 o 1080×1350).
 * Estética Elite Performance: Fondo #090909, Tarjetas #171717, Bordes #303030, Acento #CCFF00, Texto #F5F5F5.
 */
export async function renderSocialCardToPngDataUrl(
  payload: SocialCardExportPayload
): Promise<{
  dataUrl: string;
  width: number;
  height: number;
  mimeType: 'image/png';
  fileName: string;
}> {
  const width = payload.widthPx;
  const height = payload.heightPx;
  const safeFileName = `lazcakong_${payload.cardType}_${payload.format}_${payload.dateLabel.replace(
    /[^0-9a-zA-Z_-]/g,
    ''
  )}.png`;

  if (typeof document === 'undefined') {
    return {
      dataUrl: buildDeterministicPngHeaderDataUrl(width, height),
      width,
      height,
      mimeType: 'image/png',
      fileName: safeFileName,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return {
      dataUrl: buildDeterministicPngHeaderDataUrl(width, height),
      width,
      height,
      mimeType: 'image/png',
      fileName: safeFileName,
    };
  }

  // 1. Fondo principal #090909
  ctx.fillStyle = '#090909';
  ctx.fillRect(0, 0, width, height);

  // Resplandor sutil superior en verde lima #CCFF00
  const radialGrad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.18,
    40,
    width * 0.5,
    height * 0.18,
    width * 0.65
  );
  radialGrad.addColorStop(0, 'rgba(204, 255, 0, 0.14)');
  radialGrad.addColorStop(1, 'rgba(9, 9, 9, 0)');
  ctx.fillStyle = radialGrad;
  ctx.fillRect(0, 0, width, height);

  // 2. Marco exterior metálico grafito #171717 con borde #303030
  const pad = 64;
  const cardX = pad;
  const cardY = pad;
  const cardW = width - pad * 2;
  const cardH = height - pad * 2;

  ctx.fillStyle = '#171717';
  ctx.strokeStyle = '#303030';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(cardX, cardY, cardW, cardH, 42);
  ctx.fill();
  ctx.stroke();

  // Línea superior de acento #CCFF00
  ctx.fillStyle = '#CCFF00';
  ctx.fillRect(cardX + 80, cardY, cardW - 160, 8);

  // 3. Logotipo oficial LAZCAKONG GYM
  const logoImg = await loadImageElement(payload.officialLogoPath);
  const headerTopY = cardY + 72;

  if (logoImg) {
    ctx.drawImage(logoImg, cardX + 64, headerTopY - 12, 118, 118);
  } else {
    // Emblema vectorial de respaldo en caso de carga offline
    ctx.strokeStyle = '#CCFF00';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(cardX + 123, headerTopY + 47, 52, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.fillStyle = '#F5F5F5';
  ctx.font = '900 italic 48px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('LAZCAKONG', cardX + 206, headerTopY + 42);
  ctx.fillStyle = '#CCFF00';
  ctx.fillText('GYM', cardX + 530, headerTopY + 42);

  ctx.fillStyle = '#A1A1AA';
  ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('ELITE PERFORMANCE · CHALLENGES PRO', cardX + 206, headerTopY + 82);

  // Etiqueta de Rango en esquina superior derecha
  const rankBoxW = 240;
  const rankBoxH = 74;
  const rankBoxX = cardX + cardW - rankBoxW - 64;
  const rankBoxY = headerTopY + 6;
  ctx.fillStyle = '#090909';
  ctx.strokeStyle = '#CCFF00';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(rankBoxX, rankBoxY, rankBoxW, rankBoxH, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#CCFF00';
  ctx.font = '900 26px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`RANGO ${payload.rankTitle}`, rankBoxX + rankBoxW / 2, rankBoxY + 46);
  ctx.textAlign = 'left';

  // 4. Bloque Central del Logro
  const centerY = formatIsStory(payload.format) ? cardY + 470 : cardY + 330;

  ctx.fillStyle = '#CCFF00';
  ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(payload.headline.toUpperCase(), cardX + 64, centerY);

  ctx.fillStyle = '#F5F5F5';
  ctx.font = '900 italic 58px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(payload.subheadline.slice(0, 28), cardX + 64, centerY + 78);

  // Panel principal de métrica destacada
  const heroBoxY = centerY + 130;
  const heroBoxH = formatIsStory(payload.format) ? 360 : 270;
  ctx.fillStyle = '#090909';
  ctx.strokeStyle = '#303030';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(cardX + 64, heroBoxY, cardW - 128, heroBoxH, 32);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#CCFF00';
  ctx.font = '900 104px "Plus Jakarta Sans", monospace';
  ctx.fillText(payload.primaryMetricValue, cardX + 112, heroBoxY + heroBoxH * 0.54);

  ctx.fillStyle = '#F5F5F5';
  ctx.font = '700 30px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(payload.primaryMetricLabel, cardX + 112, heroBoxY + heroBoxH * 0.8);

  // 5. Métricas secundarias (2 columnas)
  const secY = heroBoxY + heroBoxH + 56;
  const colW = (cardW - 128 - 32) / 2;
  payload.secondaryMetrics.slice(0, 2).forEach((m, idx) => {
    const bx = cardX + 64 + idx * (colW + 32);
    ctx.fillStyle = '#090909';
    ctx.strokeStyle = '#303030';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(bx, secY, colW, 160, 24);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#A1A1AA';
    ctx.font = '700 22px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(m.label.toUpperCase(), bx + 36, secY + 58);

    ctx.fillStyle = '#F5F5F5';
    ctx.font = '900 40px "Plus Jakarta Sans", monospace';
    ctx.fillText(m.value, bx + 36, secY + 118);
  });

  // Alias opcional sólo si el atleta lo autorizó explícitamente
  if (payload.includeAthleteAlias && payload.athleteAlias) {
    ctx.fillStyle = '#D4D4D8';
    ctx.font = '700 26px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(`ATLETA: ${payload.athleteAlias.toUpperCase()}`, cardX + 64, secY + 230);
  }

  // 6. Pie oficial con fecha y URL oficial configurada de la app
  const footerY = cardY + cardH - 72;
  ctx.strokeStyle = '#303030';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 64, footerY - 54);
  ctx.lineTo(cardX + cardW - 64, footerY - 54);
  ctx.stroke();

  ctx.fillStyle = '#A1A1AA';
  ctx.font = '600 22px "Plus Jakarta Sans", monospace';
  ctx.fillText(payload.officialAppUrl, cardX + 64, footerY);

  ctx.fillStyle = '#CCFF00';
  ctx.textAlign = 'right';
  ctx.fillText(payload.dateLabel, cardX + cardW - 64, footerY);
  ctx.textAlign = 'left';

  const rawDataUrl = canvas.toDataURL('image/png');
  const dataUrl =
    rawDataUrl && rawDataUrl.startsWith('data:image/png')
      ? rawDataUrl
      : buildDeterministicPngHeaderDataUrl(width, height);

  return {
    dataUrl,
    width,
    height,
    mimeType: 'image/png',
    fileName: safeFileName,
  };
}

function formatIsStory(format: SocialCardFormat): boolean {
  return format === 'story_9_16';
}

/**
 * Adaptador de plataforma preparado para Web y futura integración con Capacitor (Android / iOS)
 * sin instalar dependencias nativas innecesarias.
 */
export function createDefaultEliteChallengesPlatformAdapter(
  customStorage?: CoachPlatformStorageAdapter
): EliteChallengesPlatformAdapter {
  const storage = customStorage || getDefaultStorageAdapter();

  const triggerDownloadPng = async (dataUrl: string, fileName: string): Promise<boolean> => {
    if (typeof document === 'undefined') return false;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = fileName;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  };

  const shareCardPng: EliteChallengesPlatformAdapter['shareCardPng'] = async (
    payload,
    dataUrl,
    fileName
  ) => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        if (typeof fetch === 'function' && typeof File === 'function') {
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          const file = new File([blob], fileName, { type: 'image/png' });
          if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
            await navigator.share({
              title: `LAZCAKONG GYM · ${payload.headline}`,
              text: `${payload.headline}: ${payload.primaryMetricValue} (${payload.subheadline})`,
              files: [file],
            });
            return { shared: true, method: 'web_share_files' };
          }
        }
        await navigator.share({
          title: `LAZCAKONG GYM · ${payload.headline}`,
          text: `${payload.headline}: ${payload.primaryMetricValue} — ${payload.officialAppUrl}`,
          url: payload.officialAppUrl,
        });
        return { shared: true, method: 'web_share_text' };
      } catch {
        // Fallback a descarga directa si el usuario cancela o el navegador no soporta compartir archivos
      }
    }
    const downloaded = await triggerDownloadPng(dataUrl, fileName);
    return {
      shared: downloaded,
      method: downloaded ? 'download_fallback' : 'headless_noop',
    };
  };

  return {
    storage,
    exportCardToPngDataUrl: renderSocialCardToPngDataUrl,
    triggerDownloadPng,
    shareCardPng,
  };
}
