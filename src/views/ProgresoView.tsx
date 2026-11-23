import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  Calendar,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Medal,
  Plus,
  Printer,
  ShieldCheck,
  TrendingUp,
  Trophy,
  Database,
  Layers,
  AlertTriangle,
  RefreshCw,
  Volume2,
  CheckCircle2,
  Activity,
  Target,
  Zap,
  Scale,
  Info,
} from 'lucide-react';
import type { AthleteHistoryInventoryReport, HistoryConflictRecord } from '../utils/historyRecoveryEngine';
import {
  Profile,
  CompletedWorkout,
  PersonalRecord,
  Routine,
  BodyWeightEntry,
  ActiveWorkoutSession,
  Exercise,
  MultiWeekComparativeHorizon,
  PeriodizationDurationWeeks,
  PeriodizationGoalType,
  PeriodizationMesocyclePlan,
  ProgressiveOverloadProposal,
} from '../types';
import { CentroDeRendimientoDashboard } from '../components/CentroDeRendimientoDashboard';
import {
  computeElitePerformanceAnalytics,
  PerformancePeriodFilter,
  evaluateIntelligentProgressiveOverload,
  applyAuthorizedOverloadToRoutine,
  detectExerciseStagnation,
  createPeriodizationMesocyclePlan,
  loadPeriodizationMesocyclePlan,
  savePeriodizationMesocyclePlan,
  togglePeriodizationDeloadWeek,
  applyAuthorizedPeriodizationWeekToRoutine,
  PERIODIZATION_GOAL_METADATA,
  computeMuscleBalanceReport,
  generateSmartWeeklyPerformanceReport,
} from '../utils/elitePerformanceAnalytics';
import {
  loadCoachVoiceMode,
  speakProactiveCoachMessage,
} from '../utils/coachVoiceEngine';
import { OneRMProgressionChart } from '../components/OneRMProgressionChart';
import { ExecutiveBiomechanicalHud } from '../components/ExecutiveBiomechanicalHud';
import { PersonalRecordsHallOfFame } from '../components/PersonalRecordsHallOfFame';
import { EliteChallengesPanel } from '../components/EliteChallengesPanel';
import { purgeAndSanitizeWorkoutHistory, HistoryPurgeReport } from '../utils/historySanitizer';
import {
  exportToExcel,
  exportToPDF,
  buildGroupedComparativeByDay,
  computeComparativeRowMetrics,
  resolveCanonicalWeekday,
  formatDisplayDateDDMMYYYY,
  evaluateWeeklyDaysCompletion,
  ComparativeExerciseRow,
  DailyComparativeGroup,
  MuscleGroupVolumeRow,
  WeeklyTrendRow,
} from '../utils/exportReport';
import { exportWorkoutsToCSV, exportExercisesAndLoadsToCSV } from '../utils/exportCSV';
import { queryLatestExecutionDatesByDayFromCloud } from '../utils/firebaseSync';
import { calculateExecutedWeekStatus } from '../utils/weeklyCycleManager';
import {
  getChileLocalDateKey,
  getChileWeekdayIndex,
  resolveWorkoutChileDateKey,
} from '../utils/calorieCalculator';
import {
  deduplicateRoutinesByDay,
  isSameWeekday,
  mapToStandardMuscleCategory,
  normalizeText,
} from '../utils/workoutAnalyticsEngine';

interface ProgresoViewProps {
  prs?: Record<string, PersonalRecord>;
  history?: CompletedWorkout[];
  activeProfile?: Profile;
  routines?: Routine[];
  bodyWeightLogs?: BodyWeightEntry[];
  activeSession?: ActiveWorkoutSession | null;
  onUpdateRoutine?: (routine: Routine) => void;
  onPurgeHistory?: () => HistoryPurgeReport | Promise<any>;
  onNavigateTab?: (tab: any) => void;
  onNavigateToMuscleMap?: (muscleName?: string) => void;
  historyInventory?: AthleteHistoryInventoryReport | null;
  historyConflicts?: HistoryConflictRecord[];
  isHistorySyncing?: boolean;
  historySyncError?: string | null;
  onRunHistoryRecovery?: () => Promise<AthleteHistoryInventoryReport | null | undefined>;
}

export const ProgresoView: React.FC<ProgresoViewProps> = ({
  prs = {},
  history = [],
  activeProfile = { id: 'default', name: 'Atleta', weightKg: 95 } as any,
  routines = [],
  bodyWeightLogs = [],
  activeSession = null,
  onUpdateRoutine,
  onPurgeHistory,
  onNavigateTab,
  onNavigateToMuscleMap,
  historyInventory = null,
  historyConflicts = [],
  isHistorySyncing = false,
  historySyncError = null,
  onRunHistoryRecovery,
}) => {
  const [isInventoryOpen, setIsInventoryOpen] = useState(false);
  // Garantizar que el historial leído esté deduplicado por ID y preserve todas las sesiones reales
  const safeHistory = useMemo(() => {
    const raw = Array.isArray(history) ? history : [];
    return purgeAndSanitizeWorkoutHistory(raw, activeProfile?.weightKg || 95).cleanedHistory;
  }, [history, activeProfile?.weightKg]);
  const safeRoutines = useMemo(
    () => deduplicateRoutinesByDay(Array.isArray(routines) ? routines : []),
    [routines]
  );

  // Filtro temporal para Centro de Rendimiento Elite (7d, 30d, 90d, 6m, 12m, all)
  const [selectedPeriod, setSelectedPeriod] = useState<PerformancePeriodFilter>('30d');
  const recordsSectionRef = useRef<HTMLDivElement>(null);

  // Motor analítico puro de Rendimiento Deportivo Elite 3.0 + Performance Lab Pro (Etapa 4)
  const eliteReport = useMemo(() => {
    return computeElitePerformanceAnalytics({
      history: safeHistory,
      routines: safeRoutines,
      prs,
      bodyWeightLogs,
      period: selectedPeriod,
      weeklyTargetDays: activeProfile?.weeklyTargetDays || 4,
      athleteHeightCm: activeProfile?.heightCm,
      profileId: activeProfile?.id,
    });
  }, [
    safeHistory,
    safeRoutines,
    prs,
    bodyWeightLogs,
    selectedPeriod,
    activeProfile?.weeklyTargetDays,
    activeProfile?.heightCm,
    activeProfile?.id,
  ]);

  // --- ESTADOS Y CÁLCULOS ETAPA 4: PERFORMANCE LAB PRO ---
  const [selectedMultiWeekHorizon, setSelectedMultiWeekHorizon] =
    useState<MultiWeekComparativeHorizon>('4w');
  const [authorizedProposalIds, setAuthorizedProposalIds] = useState<Record<string, boolean>>({});
  const [performanceLabFeedback, setPerformanceLabFeedback] = useState<string | null>(null);
  const spokenWeeklyEventsRef = useRef<Set<string>>(new Set());

  // Periodización Deportiva (4, 8 y 12 semanas) aislada por atleta
  const [periodizationPlan, setPeriodizationPlan] = useState<PeriodizationMesocyclePlan>(() => {
    const profileId = activeProfile?.id || 'default';
    const loaded = loadPeriodizationMesocyclePlan(profileId);
    if (loaded) return loaded;
    return createPeriodizationMesocyclePlan({
      profileId,
      goal: 'hipertrofia',
      durationWeeks: 4,
    });
  });
  const [selectedRoutineForPeriodization, setSelectedRoutineForPeriodization] = useState<string>(
    () => safeRoutines[0]?.id || ''
  );

  useEffect(() => {
    const profileId = activeProfile?.id || 'default';
    const loaded = loadPeriodizationMesocyclePlan(profileId);
    if (loaded) {
      setPeriodizationPlan(loaded);
    } else {
      const fresh = createPeriodizationMesocyclePlan({
        profileId,
        goal: 'hipertrofia',
        durationWeeks: 4,
      });
      setPeriodizationPlan(fresh);
    }
  }, [activeProfile?.id]);

  useEffect(() => {
    if (
      safeRoutines.length > 0 &&
      (!selectedRoutineForPeriodization ||
        !safeRoutines.some((r) => r.id === selectedRoutineForPeriodization))
    ) {
      setSelectedRoutineForPeriodization(safeRoutines[0].id);
    }
  }, [safeRoutines, selectedRoutineForPeriodization]);

  const progressiveOverloadProposals = useMemo(() => {
    return evaluateIntelligentProgressiveOverload({
      routines: safeRoutines,
      history: safeHistory,
      profileId: activeProfile?.id,
    });
  }, [safeRoutines, safeHistory, activeProfile?.id]);

  const stagnationAnalyses = useMemo(() => {
    return detectExerciseStagnation({
      routines: safeRoutines,
      history: safeHistory,
      profileId: activeProfile?.id,
    });
  }, [safeRoutines, safeHistory, activeProfile?.id]);

  const muscleBalanceReport = useMemo(() => {
    return computeMuscleBalanceReport({
      history: safeHistory,
      periodDays: 28,
      profileId: activeProfile?.id,
    });
  }, [safeHistory, activeProfile?.id]);

  const smartWeeklyReport = useMemo(() => {
    return generateSmartWeeklyPerformanceReport({
      history: safeHistory,
      routines: safeRoutines,
      activeProfile,
    });
  }, [safeHistory, safeRoutines, activeProfile]);

  const handleAuthorizeOverloadProposal = (proposal: ProgressiveOverloadProposal) => {
    if (!onUpdateRoutine) {
      setPerformanceLabFeedback(
        'Modo de solo lectura: abre tus rutinas para aplicar cambios de carga.'
      );
      return;
    }
    const targetRoutine = safeRoutines.find((r) => r.id === proposal.routineId);
    if (!targetRoutine) return;
    const updatedRoutine = applyAuthorizedOverloadToRoutine(targetRoutine, proposal);
    onUpdateRoutine(updatedRoutine);
    setAuthorizedProposalIds((prev) => ({ ...prev, [proposal.id]: true }));
    setPerformanceLabFeedback(
      `Autorizado: ${proposal.exerciseName} actualizado a ${proposal.proposedWeightKg} kg × ${proposal.proposedReps} reps (${proposal.proposedSets} series) en ${proposal.routineTitle}.`
    );
  };

  const handleUpdatePeriodizationGoalOrDuration = (
    nextGoal: PeriodizationGoalType,
    nextDuration: PeriodizationDurationWeeks
  ) => {
    const profileId = activeProfile?.id || 'default';
    const nextPlan = createPeriodizationMesocyclePlan({
      profileId,
      goal: nextGoal,
      durationWeeks: nextDuration,
    });
    setPeriodizationPlan(nextPlan);
    savePeriodizationMesocyclePlan(nextPlan);
  };

  const handleToggleDeloadWeek = (weekNumber: number) => {
    const updated = togglePeriodizationDeloadWeek(periodizationPlan, weekNumber);
    setPeriodizationPlan(updated);
    savePeriodizationMesocyclePlan(updated);
  };

  const handleSelectActiveWeek = (weekNumber: number) => {
    const updated: PeriodizationMesocyclePlan = {
      ...periodizationPlan,
      currentWeekNumber: weekNumber,
      updatedAt: Date.now(),
    };
    setPeriodizationPlan(updated);
    savePeriodizationMesocyclePlan(updated);
  };

  const handleAuthorizePeriodizationOnRoutine = () => {
    if (!onUpdateRoutine) return;
    const targetRoutine = safeRoutines.find((r) => r.id === selectedRoutineForPeriodization);
    const activeWeek =
      periodizationPlan.weeks.find((w) => w.weekNumber === periodizationPlan.currentWeekNumber) ||
      periodizationPlan.weeks[0];
    if (!targetRoutine || !activeWeek) return;

    const updatedRoutine = applyAuthorizedPeriodizationWeekToRoutine(targetRoutine, activeWeek);
    onUpdateRoutine(updatedRoutine);
    setPerformanceLabFeedback(
      `Semana ${activeWeek.weekNumber} (${activeWeek.phaseLabel}) autorizada y aplicada en «${targetRoutine.title}».`
    );
  };

  const handleSpeakWeeklyReport = () => {
    const storedMode = activeProfile?.coachVoiceMode || loadCoachVoiceMode();
    const effectiveMode = storedMode === 'silent' ? 'important_only' : storedMode;
    speakProactiveCoachMessage({
      mode: effectiveMode,
      isImportant: true,
      rawText: smartWeeklyReport.coachVoiceText,
      eventKey: `weekly_report_${smartWeeklyReport.weekEndDate}_${Date.now()}`,
      spokenEventKeys: spokenWeeklyEventsRef.current,
    });
  };
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);
  const [progressPeriod, setProgressPeriod] = useState<'current_week' | 'all'>('current_week');
  const [isComparativeAccordionOpen, setIsComparativeAccordionOpen] = useState<boolean>(false);

  const [selectedComparativeDay, setSelectedComparativeDay] = useState<string>(() => {
    if (activeSession) {
      const matched = Array.isArray(routines)
        ? routines.find((r) => r.id === activeSession.routineId)
        : undefined;
      return resolveCanonicalWeekday(
        matched?.dayName || activeSession.routineTitle,
        new Date().toISOString()
      );
    }
    return 'ALL';
  });

  const [liveLoadOverrides, setLiveLoadOverrides] = useState<
    Record<string, { prevWeight?: number; currWeight?: number; currReps?: number }>
  >({});
  const [addingToDay, setAddingToDay] = useState<string | null>(null);
  const [newExName, setNewExName] = useState<string>('');
  const [newExMuscle, setNewExMuscle] = useState<string>('Pecho');
  const [newExPrevWeight, setNewExPrevWeight] = useState<string>('60');
  const [newExCurrWeight, setNewExCurrWeight] = useState<string>('65');
  const [newExReps, setNewExReps] = useState<string>('10');

  // Sincronizar automáticamente el filtro de día con la sesión activa cuando se inicia un entrenamiento
  useEffect(() => {
    if (!activeSession) return;
    const matched = safeRoutines.find((r) => r.id === activeSession.routineId);
    const activeDay = resolveCanonicalWeekday(
      matched?.dayName || activeSession.routineTitle,
      new Date().toISOString()
    );
    if (activeDay) {
      setSelectedComparativeDay(activeDay);
    }
  }, [activeSession?.routineId, activeSession?.routineTitle, safeRoutines]);

  // Índice de marcas de tiempo ('YYYY-MM-DD') consultado desde Cloud Firestore (NoSQL)
  const [cloudDayTimestamps, setCloudDayTimestamps] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let isMounted = true;
    if (activeProfile?.id) {
      queryLatestExecutionDatesByDayFromCloud(activeProfile.id)
        .then((dateMap) => {
          if (isMounted && dateMap) {
            setCloudDayTimestamps(dateMap);
          }
        })
        .catch(() => {});
    }
    return () => {
      isMounted = false;
    };
  }, [activeProfile?.id, safeHistory.length]);

  const currentWeekBounds = useMemo(() => {
    const todayKey = getChileLocalDateKey(new Date());
    const idx = getChileWeekdayIndex(todayKey);
    const [y, m, d] = todayKey.split('-').map(Number);
    const mondayUtc = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 19, 12, 0, 0));
    mondayUtc.setUTCDate(mondayUtc.getUTCDate() + (idx === 0 ? -6 : 1 - idx));
    const sundayUtc = new Date(mondayUtc);
    sundayUtc.setUTCDate(mondayUtc.getUTCDate() + 6);
    return {
      mondayKey: mondayUtc.toISOString().slice(0, 10),
      sundayKey: sundayUtc.toISOString().slice(0, 10),
    };
  }, []);

  const currentWeekHistory = useMemo(() => {
    return safeHistory.filter((w) => {
      const wKey = resolveWorkoutChileDateKey(w) || getChileLocalDateKey(w.date);
      return Boolean(wKey) && wKey >= currentWeekBounds.mondayKey && wKey <= currentWeekBounds.sundayKey;
    });
  }, [safeHistory, currentWeekBounds]);

  const targetHistory = useMemo(() => {
    return progressPeriod === 'current_week' ? currentWeekHistory : safeHistory;
  }, [progressPeriod, currentWeekHistory, safeHistory]);

  // Generación reactiva de métricas y Cuadro Comparativo agrupado estrictamente por Día de la Semana
  const analyticsData = useMemo(() => {
    const getChileMondayUtcMs = (workoutOrDate: CompletedWorkout | Date | string | number) => {
      const key =
        typeof workoutOrDate === 'object' && workoutOrDate !== null && !(workoutOrDate instanceof Date)
          ? resolveWorkoutChileDateKey(workoutOrDate) || getChileLocalDateKey(workoutOrDate.date)
          : getChileLocalDateKey(workoutOrDate);
      const [y, m, d] = (key || getChileLocalDateKey(new Date())).split('-').map(Number);
      const noonUtc = new Date(Date.UTC(y || 2026, (m || 11) - 1, d || 19, 12, 0, 0));
      const dayIdx = getChileWeekdayIndex(noonUtc);
      noonUtc.setUTCDate(noonUtc.getUTCDate() + (dayIdx === 0 ? -6 : 1 - dayIdx));
      return noonUtc.getTime();
    };

    const finished = [...safeHistory].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    const { groupedByDay: rawGroupedByDay } = buildGroupedComparativeByDay({
      routines: safeRoutines,
      history: currentWeekHistory,
      prs,
      activeSession,
      progressPeriod: 'current_week',
      cloudDayTimestamps,
    });

    const groupedByDay: DailyComparativeGroup[] = rawGroupedByDay.map((group) => {
      const updatedRows = group.rows.map((row) => {
        const overrideKey = `${group.dayName}::${row.exerciseId || normalizeText(row.name)}`;
        const override = liveLoadOverrides[overrideKey];
        if (!override) return row;

        const nextPrevW = override.prevWeight !== undefined ? override.prevWeight : row.prevWeight;
        const nextCurrW = override.currWeight !== undefined ? override.currWeight : row.currWeight;
        const nextCurrR = override.currReps !== undefined ? override.currReps : row.currReps;

        return computeComparativeRowMetrics({
          name: row.name,
          prevWeight: nextPrevW,
          currWeight: nextCurrW,
          prevReps: row.prevReps,
          currReps: nextCurrR,
          dayName: group.dayName,
          dayHeader: group.dayHeader,
          exerciseId: row.exerciseId,
          routineId: row.routineId,
          muscleGroup: row.muscleGroup,
          lastExecutedDate: row.lastExecutedDate,
        });
      });

      return {
        ...group,
        rows: updatedRows,
      };
    });

    const compTable = groupedByDay.flatMap((g) => g.rows);

    const totalVolKg = targetHistory.reduce((acc, curr) => acc + (curr.totalVolumeKg || 0), 0);
    const tons = Number((totalVolKg / 1000).toFixed(2));

    const mGroups: Record<string, number> = {
      Pierna: 0,
      Glúteos: 0,
      Espalda: 0,
      Pecho: 0,
      Hombro: 0,
      Brazos: 0,
      Core: 0,
    };

    targetHistory.forEach((w) => {
      w.exercisesSummary?.forEach((ex) => {
        const stdCat = mapToStandardMuscleCategory(ex.muscleGroup || '', ex.name || '');
        let cat = 'Pierna';
        if (stdCat === 'Glúteos') cat = 'Glúteos';
        else if (stdCat === 'Dorsal') cat = 'Espalda';
        else if (stdCat === 'Pectoral') cat = 'Pecho';
        else if (stdCat === 'Hombros') cat = 'Hombro';
        else if (stdCat === 'Bíceps' || stdCat === 'Tríceps') cat = 'Brazos';
        else if (stdCat === 'Core') cat = 'Core';
        else cat = 'Pierna';

        const vol =
          typeof ex.volumeKg === 'number' && (ex.volumeKg > 0 || (ex.maxWeight || 0) === 0)
            ? ex.volumeKg
            : (ex.maxWeight || 0) * (ex.maxReps || 0) * (ex.sets || 0);
        mGroups[cat] = (mGroups[cat] || 0) + vol;
      });
    });

    const muscleRows: MuscleGroupVolumeRow[] = Object.entries(mGroups).map(([name, volume]) => ({
      name,
      volume,
      sharePct: totalVolKg > 0 ? Math.round((volume / totalVolKg) * 100) : 0,
    }));

    const weekMap: Record<string, { label: string; volumeTons: number; workoutsCount: number; mondayTime: number }> = {};

    finished.forEach((w) => {
      const mondayTime = getChileMondayUtcMs(w);
      const mondayDate = new Date(mondayTime);
      const sundayDate = new Date(mondayDate);
      sundayDate.setUTCDate(sundayDate.getUTCDate() + 6);
      const startStr = mondayDate.toLocaleDateString('es-ES', {
        timeZone: 'America/Santiago',
        day: 'numeric',
        month: 'short',
      });
      const endStr = sundayDate.toLocaleDateString('es-ES', {
        timeZone: 'America/Santiago',
        day: 'numeric',
        month: 'short',
      });
      const label = `Semana del ${startStr} - ${endStr}`;

      if (!weekMap[mondayTime]) {
        weekMap[mondayTime] = {
          label,
          volumeTons: 0,
          workoutsCount: 0,
          mondayTime,
        };
      }
      weekMap[mondayTime].volumeTons += (w.totalVolumeKg || 0);
      weekMap[mondayTime].workoutsCount += 1;
    });

    const weeks: WeeklyTrendRow[] = Object.values(weekMap)
      .sort((a, b) => a.mondayTime - b.mondayTime)
      .map((w) => ({
        label: w.label,
        volumeTons: Number((w.volumeTons / 1000).toFixed(2)),
        workoutsCount: w.workoutsCount,
      }));

    if (weeks.length === 0) {
      weeks.push({
        label: 'Semana Actual (Lunes - Domingo)',
        volumeTons: tons,
        workoutsCount: targetHistory.length,
      });
    }

    return {
      comparativeTable: compTable,
      groupedComparativeByDay: groupedByDay,
      muscleGroupVolume: muscleRows,
      weeklyTrends: weeks,
      totalVolumeTons: tons,
    };
  }, [safeHistory, safeRoutines, currentWeekHistory, prs, activeSession, cloudDayTimestamps, liveLoadOverrides, targetHistory]);

  const handleReactiveLoadChange = (
    group: DailyComparativeGroup,
    row: ComparativeExerciseRow,
    field: 'prevWeight' | 'currWeight' | 'currReps',
    rawVal: string
  ) => {
    const parsed = parseFloat(rawVal);
    const val = Number.isNaN(parsed) ? 0 : parsed;
    const overrideKey = `${group.dayName}::${row.exerciseId || normalizeText(row.name)}`;

    setLiveLoadOverrides((prev) => {
      const existing = prev[overrideKey] || {
        prevWeight: row.prevWeight,
        currWeight: row.currWeight,
        currReps: row.currReps,
      };
      return {
        ...prev,
        [overrideKey]: {
          ...existing,
          [field]: val,
        },
      };
    });

    if (onUpdateRoutine) {
      const routineToUpdate = safeRoutines.find((r) => r.id === row.routineId);
      if (routineToUpdate) {
        const updatedExercises = routineToUpdate.exercises.map((ex) => {
          if (ex.id === row.exerciseId || normalizeText(ex.name) === normalizeText(row.name)) {
            return {
              ...ex,
              defaultWeight: field === 'currWeight' ? val : ex.defaultWeight,
              prevWeight: field === 'prevWeight' ? val : ex.prevWeight,
              defaultReps: field === 'currReps' ? Math.round(val) : ex.defaultReps,
            };
          }
          return ex;
        });

        onUpdateRoutine({
          ...routineToUpdate,
          exercises: updatedExercises,
        });
      }
    }
  };

  const handleAddCustomExerciseToDay = (dayName: string) => {
    if (!newExName.trim() || !onUpdateRoutine) return;
    const matchedRoutine = safeRoutines.find(
      (r) => resolveCanonicalWeekday(r.dayName || r.title, new Date().toISOString()) === dayName
    );
    if (!matchedRoutine) return;

    const pw = parseFloat(newExPrevWeight) || 0;
    const cw = parseFloat(newExCurrWeight) || 0;
    const cr = parseInt(newExReps, 10) || 10;

    const newExerciseObj: Exercise = {
      id: `ex-custom-${Date.now()}`,
      name: newExName.trim(),
      targetMuscles: newExMuscle,
      defaultSets: 3,
      repRange: '8 - 12',
      restSeconds: 90,
      restText: '90 seg',
      objective: `Desarrollo de fuerza e hipertrofia en ${newExMuscle}.`,
      defaultVideoUrl: '',
      techniqueCues: ['Controla la fase excéntrica', 'Mantén tensión continua'],
      defaultWeight: cw,
      prevWeight: pw,
      defaultReps: cr,
    };

    onUpdateRoutine({
      ...matchedRoutine,
      exercises: [...matchedRoutine.exercises, newExerciseObj],
    });

    setAddingToDay(null);
    setNewExName('');
    setNewExPrevWeight('60');
    setNewExCurrWeight('65');
    setNewExReps('10');
  };

  const filteredComparativeGroups = useMemo(() => {
    if (selectedComparativeDay === 'ALL') {
      return analyticsData.groupedComparativeByDay;
    }
    return analyticsData.groupedComparativeByDay.filter(
      (g) => g.dayName === selectedComparativeDay
    );
  }, [analyticsData.groupedComparativeByDay, selectedComparativeDay]);

  return (
    <div className="w-full max-w-7xl mx-auto px-2.5 sm:px-6 space-y-4 sm:space-y-6 pb-32 sm:pb-24 overflow-x-hidden font-sans animate-in fade-in duration-200">
      {/* PANEL DE AUDITORÍA, INVENTARIO Y RECUPERACIÓN DE HISTORIAL COMPLETO */}
      <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 transition-all">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-100">
                  Inventario y Recuperación de Historial
                </h3>
                {isHistorySyncing && (
                  <span className="text-xs text-blue-400 flex items-center gap-1 font-mono">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Sincronizando...
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Auditoría de solo lectura, respaldo íntegro y reconciliación sin pérdidas para todo el historial
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onRunHistoryRecovery?.()}
              disabled={isHistorySyncing}
              className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isHistorySyncing ? 'animate-spin' : ''}`} />
              Re-escanear y Recuperar
            </button>
            <button
              onClick={() => setIsInventoryOpen((prev) => !prev)}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
              aria-label={isInventoryOpen ? 'Ocultar detalles de inventario' : 'Mostrar detalles de inventario'}
            >
              <span>{isInventoryOpen ? 'Ocultar' : 'Detalles'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isInventoryOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>

        {/* Resumen rápido */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 text-xs">
          <div>
            <span className="text-slate-500 block">Sesiones Activas</span>
            <span className="text-sm font-semibold text-slate-200 font-mono tabular-nums">
              {safeHistory.length}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Récords Registrados</span>
            <span className="text-sm font-semibold text-slate-200 font-mono tabular-nums">
              {Object.keys(prs).length} PRs
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Fuentes Auditadas</span>
            <span className="text-sm font-semibold text-slate-200 font-mono tabular-nums">
              {historyInventory?.sources.length || 'Locales + Nube'}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Conflictos Detectados</span>
            <span className={`text-sm font-semibold font-mono tabular-nums ${historyConflicts.length > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {historyConflicts.length === 0 ? '0 (Íntegro)' : `${historyConflicts.length} respaldados`}
            </span>
          </div>
        </div>

        {historySyncError && (
          <div className="mt-3 p-2.5 bg-amber-500/10 border border-amber-500/20 rounded-lg text-xs text-amber-300 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{historySyncError}</span>
          </div>
        )}

        {isInventoryOpen && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 space-y-4 text-xs">
            <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800">
              <h4 className="text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
                Asociación de Identidad de Atleta
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-400 font-mono text-[11px]">
                <div>
                  <span className="text-slate-500 block">ID Perfil Activo:</span>
                  <span className="text-slate-200">{activeProfile.id}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Auth UID Conectado:</span>
                  <span className="text-slate-200">{historyInventory?.authUid || 'Sesión Local'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Respaldo Íntegro Previo:</span>
                  <span className="text-emerald-400">{historyInventory?.rawBackupKey ? 'Activo en LocalStorage' : 'Verificado'}</span>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Inventario de Fuentes Disponibles
              </h4>
              <div className="space-y-1.5">
                {(historyInventory?.sources || [
                  { sourceLabel: `LocalStorage (lazcakon_${activeProfile.id}_history)`, sessionCount: safeHistory.length, statusNote: 'Activo' },
                  { sourceLabel: 'Respaldo Íntegro Sin Filtros (lazcakon_raw_unfiltered_backup_v1)', sessionCount: safeHistory.length, statusNote: 'Preservado' },
                ]).map((src: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-slate-950/40 rounded border border-slate-800/60">
                    <span className="text-slate-300 font-mono">{src.sourceLabel}</span>
                    <div className="flex items-center gap-3 text-slate-400 font-mono text-[11px]">
                      <span>{src.sessionCount ?? 0} sesiones</span>
                      {src.minDate && (
                        <span>
                          {getChileLocalDateKey(src.minDate) || src.minDate.slice(0, 10)} →{' '}
                          {src.maxDate ? getChileLocalDateKey(src.maxDate) || src.maxDate.slice(0, 10) : ''}
                        </span>
                      )}
                      <span className="text-emerald-400">{src.statusNote || 'OK'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {historyConflicts.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  Conflictos de Sesión Identificados y Respaldados
                </h4>
                <div className="space-y-1.5">
                  {historyConflicts.map((c, idx) => (
                    <div key={idx} className="p-2.5 bg-amber-500/5 rounded border border-amber-500/20 text-[11px] text-slate-300">
                      <div className="flex items-center justify-between font-mono font-medium text-amber-200">
                        <span>{c.routineTitle} ({getChileLocalDateKey(c.date) || c.date.slice(0, 10)})</span>
                        <span className="text-slate-400">ID: {c.workoutId}</span>
                      </div>
                      <p className="text-slate-400 mt-1">{c.reason}</p>
                      <div className="mt-1.5 grid grid-cols-2 gap-2 text-slate-400 font-mono">
                        <div>
                          <span className="text-emerald-400 block">Conservada ({c.keptSource}):</span>
                          <span>{c.keptSummary.exercises} ejercicios, {c.keptSummary.sets} series, {c.keptSummary.totalVolumeKg} kg</span>
                        </div>
                        <div>
                          <span className="text-amber-400 block">Variante Respaldada ({c.conflictingSource}):</span>
                          <span>{c.conflictingSummary.exercises} ejercicios, {c.conflictingSummary.sets} series, {c.conflictingSummary.totalVolumeKg} kg</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 1. CENTRO DE RENDIMIENTO ELITE 3.0 (DASHBOARD PRINCIPAL UNIFICADO) */}
      <CentroDeRendimientoDashboard
        report={eliteReport}
        activeProfile={activeProfile}
        selectedPeriod={selectedPeriod}
        onSelectPeriod={setSelectedPeriod}
        onNavigateToMuscleMap={(muscleName) => {
          if (onNavigateToMuscleMap) {
            onNavigateToMuscleMap(muscleName);
          } else if (onNavigateTab) {
            onNavigateTab('mapa-muscular');
          }
        }}
        onOpenRecordsModal={() => {
          recordsSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
        }}
      />

      {/* =====================================================================================
          ETAPA 4: PERFORMANCE LAB PRO — LABORATORIO DE RENDIMIENTO, PERIODIZACIÓN Y BALANCE
         ===================================================================================== */}
      {performanceLabFeedback && (
        <div
          role="status"
          className="bg-[#171717] border border-accent rounded-2xl p-3.5 sm:p-4 text-xs sm:text-sm text-[#F5F5F5] flex items-center justify-between gap-3 shadow-lg"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-accent-text shrink-0" />
            <span className="font-semibold">{performanceLabFeedback}</span>
          </div>
          <button
            type="button"
            onClick={() => setPerformanceLabFeedback(null)}
            className="text-neutral-400 hover:text-white font-bold px-2 py-1 cursor-pointer shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* 1B. HORIZONTES DE VOLUMEN (SEMANAL / MENSUAL / ANUAL) Y COMPARATIVAS DE 4, 8 Y 12 SEMANAS */}
      <section
        aria-label="Comparativas de 4, 8 y 12 semanas y volumen acumulado"
        className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 text-[#F5F5F5]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-accent-text uppercase tracking-wider">
              <Activity className="w-4 h-4 shrink-0" />
              <span>Performance Lab Pro · Centro de Rendimiento Avanzado</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              VOLUMEN (SEMANAL · MENSUAL · ANUAL) Y COMPARATIVAS 4 / 8 / 12 SEMANAS
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-1.5 bg-[#090909] p-1 rounded-xl border border-[#303030]">
            {(['4w', '8w', '12w'] as MultiWeekComparativeHorizon[]).map((h) => {
              const active = selectedMultiWeekHorizon === h;
              const label = h === '4w' ? '4 Semanas' : h === '8w' ? '8 Semanas' : '12 Semanas';
              return (
                <button
                  key={h}
                  type="button"
                  onClick={() => setSelectedMultiWeekHorizon(h)}
                  className={`min-h-[40px] px-2.5 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                    active
                      ? 'bg-accent text-accent-contrast font-black'
                      : 'text-neutral-300 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Resumen Volumen Semanal, Mensual y Anual */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs tabular-nums">
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] uppercase font-bold block">
              Volumen Semanal (7 días)
            </span>
            <span className="text-lg sm:text-xl font-black text-accent-text block mt-0.5">
              {eliteReport.volumeHorizons.weeklyVolumeKg.toLocaleString()} kg
            </span>
            <span className="text-[11px] text-neutral-400">
              {eliteReport.volumeHorizons.weeklyEffectiveSets} series efectivas ·{' '}
              {eliteReport.volumeHorizons.weeklyWorkoutsCount} ses.
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] uppercase font-bold block">
              Volumen Mensual (30 días)
            </span>
            <span className="text-lg sm:text-xl font-black text-white block mt-0.5">
              {eliteReport.volumeHorizons.monthlyVolumeKg.toLocaleString()} kg
            </span>
            <span className="text-[11px] text-neutral-400">
              {eliteReport.volumeHorizons.monthlyEffectiveSets} series efectivas ·{' '}
              {eliteReport.volumeHorizons.monthlyWorkoutsCount} ses.
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] uppercase font-bold block">
              Volumen Anual (365 días)
            </span>
            <span className="text-lg sm:text-xl font-black text-white block mt-0.5">
              {eliteReport.volumeHorizons.annualVolumeKg.toLocaleString()} kg
            </span>
            <span className="text-[11px] text-neutral-400">
              {eliteReport.volumeHorizons.annualEffectiveSets} series efectivas ·{' '}
              {eliteReport.volumeHorizons.annualWorkoutsCount} ses.
            </span>
          </div>
        </div>

        {/* Detalle del bloque comparativo 4w / 8w / 12w seleccionado */}
        {(() => {
          const block =
            selectedMultiWeekHorizon === '4w'
              ? eliteReport.multiWeekComparatives.w4
              : selectedMultiWeekHorizon === '8w'
              ? eliteReport.multiWeekComparatives.w8
              : eliteReport.multiWeekComparatives.w12;

          return (
            <div className="p-3.5 sm:p-4 rounded-2xl bg-[#090909] border border-[#303030] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#303030] pb-2.5">
                <span className="text-xs sm:text-sm font-black text-white">
                  Comparativa de Bloque: {block.label} vs {block.weeksCount} semanas previas
                </span>
                <span className="text-xs text-accent-text font-bold tabular-nums">
                  Cumplimiento rutina:{' '}
                  {block.routineCompliancePct !== null ? `${block.routineCompliancePct}%` : '—'}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
                <div className="p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                  <span className="text-neutral-400 text-[11px] block">Sesiones Completadas</span>
                  <span className="text-base font-black text-white">
                    {block.currentWorkouts} ses.
                  </span>
                  <span className="text-[11px] text-neutral-400 block">
                    {block.hasPreviousBase
                      ? `${block.diffWorkouts >= 0 ? `+${block.diffWorkouts}` : block.diffWorkouts} vs bloque previo (${block.previousWorkouts})`
                      : 'Sin bloque previo'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                  <span className="text-neutral-400 text-[11px] block">Volumen del Bloque</span>
                  <span className="text-base font-black text-accent-text">
                    {block.currentVolumeKg.toLocaleString()} kg
                  </span>
                  <span className="text-[11px] text-neutral-400 block">
                    {block.diffVolumePct !== null
                      ? `${block.diffVolumePct >= 0 ? `+${block.diffVolumePct}%` : `${block.diffVolumePct}%`} vs previo`
                      : 'Base inicial'}
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                  <span className="text-neutral-400 text-[11px] block">Series Efectivas</span>
                  <span className="text-base font-black text-white">
                    {block.currentCompletedSets} series
                  </span>
                  <span className="text-[11px] text-neutral-400 block">
                    Frecuencia: {block.currentWeeklyFrequency} ses/sem
                  </span>
                </div>

                <div className="p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                  <span className="text-neutral-400 text-[11px] block">Récords Superados</span>
                  <span className="text-base font-black text-accent-text">
                    {block.verifiedPRsCount} PRs
                  </span>
                  <span className="text-[11px] text-neutral-400 block">
                    Verificados en {block.weeksCount} sem.
                  </span>
                </div>
              </div>

              {block.topImprovedExercises.length > 0 && (
                <div className="pt-1">
                  <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5">
                    Mayor evolución de 1RM estimado en {block.label}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs tabular-nums">
                    {block.topImprovedExercises.slice(0, 3).map((item) => (
                      <div
                        key={item.exerciseId}
                        className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">{item.exerciseName}</div>
                          <div className="text-[11px] text-neutral-400">
                            ~{item.start1RM} kg → ~{item.end1RM} kg 1RM
                          </div>
                        </div>
                        <span className="text-accent-text font-black shrink-0">
                          +{item.delta1RM} kg (+{item.deltaPct}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </section>

      {/* 6. INFORME SEMANAL INTELIGENTE CON MOTOR DE VOZ COACH INTELLIGENCE PRO */}
      <section
        aria-label="Informe Semanal Inteligente"
        className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 text-[#F5F5F5]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-accent-text uppercase tracking-wider">
              <Zap className="w-4 h-4 shrink-0" />
              <span>Resumen Automático Local · Coach Intelligence Pro</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              INFORME SEMANAL INTELIGENTE
            </h2>
          </div>

          <button
            type="button"
            onClick={handleSpeakWeeklyReport}
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-95 shadow-md"
          >
            <Volume2 className="w-4 h-4 shrink-0" />
            <span>Escuchar Informe Semanal</span>
          </button>
        </div>

        <p className="text-xs sm:text-sm text-neutral-200 bg-[#090909] border border-[#303030] rounded-xl p-3.5 leading-relaxed">
          {smartWeeklyReport.performanceEvolutionSummary}
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Entrenamientos (7d)</span>
            <span className="text-base font-black text-white">
              {smartWeeklyReport.completedWorkoutsCount} / {smartWeeklyReport.targetWorkoutsCount}
            </span>
            <span className="text-[11px] text-accent-text font-semibold block">
              {smartWeeklyReport.routineCompliancePct}% cumplimiento
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Volumen Semanal</span>
            <span className="text-base font-black text-accent-text">
              {smartWeeklyReport.accumulatedVolumeKg.toLocaleString()} kg
            </span>
            <span className="text-[11px] text-neutral-400 block">
              {smartWeeklyReport.volumeDeltaPct !== null
                ? `${smartWeeklyReport.volumeDeltaPct >= 0 ? `+${smartWeeklyReport.volumeDeltaPct}%` : `${smartWeeklyReport.volumeDeltaPct}%`} vs sem. previa`
                : `${smartWeeklyReport.completedSetsCount} series efectivas`}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Récords Logrados</span>
            <span className="text-base font-black text-white">
              {smartWeeklyReport.prsAchievedCount} PRs
            </span>
            <span className="text-[11px] text-neutral-400 block">
              {smartWeeklyReport.prsAchievedList[0]?.exerciseName || 'Marcas verificadas'}
            </span>
          </div>
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Músculos Más Trabajados</span>
            <span className="text-xs font-black text-white truncate block mt-0.5">
              {smartWeeklyReport.mostTrainedMuscles.length > 0
                ? smartWeeklyReport.mostTrainedMuscles.map((m) => m.muscleGroup).join(' · ')
                : 'Sin sesiones esta semana'}
            </span>
            <span className="text-[11px] text-neutral-400 block">
              {smartWeeklyReport.mostTrainedMuscles[0]
                ? `${smartWeeklyReport.mostTrainedMuscles[0].effectiveSets} series principales`
                : 'Registra tu sesión'}
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs font-bold text-accent-text uppercase tracking-wider">
            Recomendaciones para la próxima semana
          </div>
          <ul className="space-y-1.5 text-xs text-neutral-300">
            {smartWeeklyReport.nextWeekRecommendations.map((rec, idx) => (
              <li
                key={idx}
                className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] flex items-start gap-2"
              >
                <span className="text-accent-text font-black">•</span>
                <span>{rec}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 2. SOBRECARGA PROGRESIVA INTELIGENTE (CON AUTORIZACIÓN EXPLÍCITA DEL ATLETA) */}
      <section
        aria-label="Sobrecarga Progresiva Inteligente"
        className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 text-[#F5F5F5]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-accent-text uppercase tracking-wider">
              <TrendingUp className="w-4 h-4 shrink-0" />
              <span>Motor de Progresión + Recuperación Muscular</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              SOBRECARGA PROGRESIVA INTELIGENTE
            </h2>
          </div>
          <span className="text-[11px] text-neutral-400 bg-[#090909] border border-[#303030] px-2.5 py-1 rounded-lg">
            Requiere autorización explícita · Nunca modifica rutinas sin permiso
          </span>
        </div>

        {progressiveOverloadProposals.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#090909] border border-[#303030] text-xs text-neutral-400">
            Completa sesiones de tus rutinas activas para evaluar oportunidades de aumento de carga, repeticiones o volumen.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {progressiveOverloadProposals.slice(0, 6).map((prop) => {
              const isAuthorized = Boolean(authorizedProposalIds[prop.id]);
              const isActionable =
                prop.overloadType === 'increase_load' ||
                prop.overloadType === 'increase_reps' ||
                prop.overloadType === 'increase_volume_sets';

              return (
                <div
                  key={prop.id}
                  className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold text-accent-text uppercase tracking-wide truncate">
                        {prop.routineTitle} · {prop.muscleGroup}
                      </span>
                      <span className="text-[11px] text-neutral-400 tabular-nums shrink-0">
                        Rec: {prop.muscleRecoveryPct}%
                      </span>
                    </div>
                    <h3 className="text-sm font-black text-white">{prop.exerciseName}</h3>
                    <div className="text-xs font-bold text-accent-text">{prop.headline}</div>
                    <p className="text-xs text-neutral-400 leading-relaxed">{prop.rationale}</p>
                  </div>

                  <div className="pt-2 border-t border-[#303030]/70 flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                    <div className="text-neutral-300">
                      <span>
                        Actual: {prop.currentWeightKg} kg × {prop.currentReps}r ({prop.currentSets}s)
                      </span>
                      {prop.avgRecentRpe !== null && (
                        <span className="text-neutral-500 ml-1.5">· RPE {prop.avgRecentRpe}</span>
                      )}
                    </div>

                    {isActionable && onUpdateRoutine && (
                      <button
                        type="button"
                        disabled={isAuthorized}
                        onClick={() => handleAuthorizeOverloadProposal(prop)}
                        className={`min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-black transition-all cursor-pointer ${
                          isAuthorized
                            ? 'bg-[#171717] text-accent-text border border-accent/40'
                            : 'bg-accent hover:bg-accent-hover text-accent-contrast active:scale-95'
                        }`}
                      >
                        {isAuthorized ? '✓ Cambio Autorizado' : 'Autorizar Ajuste en Rutina'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 3. DETECCIÓN DE ESTANCAMIENTO (PLATEAU DETECTION + TECHNIQUE PRO) */}
      <section
        aria-label="Detección de Estancamiento"
        className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 text-[#F5F5F5]"
      >
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-accent-text uppercase tracking-wider">
            <Target className="w-4 h-4 shrink-0" />
            <span>Análisis de Tendencias · Sesiones Comparables + Technique Pro</span>
          </div>
          <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
            DETECTOR DE ESTANCAMIENTO Y RECOMENDACIONES JUSTIFICADAS
          </h2>
        </div>

        {stagnationAnalyses.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#090909] border border-[#303030] text-xs text-neutral-400">
            Sin ejercicios registrados aún para evaluar tendencias de estancamiento.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {stagnationAnalyses.slice(0, 6).map((item) => {
              const badgeMap: Record<
                typeof item.status,
                { label: string; className: string }
              > = {
                progressing: {
                  label: 'En Progresión',
                  className: 'bg-accent/15 text-accent-text border-accent/40',
                },
                plateau_detected: {
                  label: 'Estancamiento Detectado',
                  className: 'bg-amber-400/15 text-amber-300 border-amber-400/40',
                },
                regression_detected: {
                  label: 'Retroceso / Fatiga',
                  className: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
                },
                equipment_or_variant_changed: {
                  label: 'Cambio de Variante',
                  className: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
                },
                insufficient_comparable_sessions: {
                  label: 'Sesiones Insuficientes',
                  className: 'bg-neutral-800 text-neutral-300 border-[#303030]',
                },
              };
              const badge = badgeMap[item.status];

              return (
                <div
                  key={`${item.exerciseId}-${item.exerciseName}`}
                  className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-black text-white text-sm truncate">
                        {item.exerciseName}
                      </h3>
                      <span className="text-[11px] text-neutral-400">
                        {item.muscleGroup} · {item.equipmentSignature} ·{' '}
                        {item.comparableSessionsCount}/{item.minRequiredComparableSessions} ses. comparables
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-lg border text-[10px] font-bold shrink-0 ${badge.className}`}
                    >
                      {badge.label}
                    </span>
                  </div>

                  <p className="text-neutral-300 leading-relaxed">{item.justifiedRecommendation}</p>

                  <div className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] text-[11px] text-neutral-300">
                    <span className="text-accent-text font-bold">Foco Technique Pro: </span>
                    <span>{item.techniqueProCue}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 4. PERIODIZACIÓN DEPORTIVA (CICLOS DE 4, 8 Y 12 SEMANAS) */}
      <section
        aria-label="Periodización Deportiva 4, 8 y 12 semanas"
        className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 text-[#F5F5F5]"
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-accent-text uppercase tracking-wider">
              <Calendar className="w-4 h-4 shrink-0" />
              <span>Planificación de Mesociclos · Progresión y Descarga</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              PERIODIZACIÓN DEPORTIVA (4 · 8 · 12 SEMANAS)
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de Objetivo */}
            <select
              aria-label="Objetivo del ciclo de periodización"
              value={periodizationPlan.goal}
              onChange={(e) =>
                handleUpdatePeriodizationGoalOrDuration(
                  e.target.value as PeriodizationGoalType,
                  periodizationPlan.durationWeeks
                )
              }
              className="min-h-[44px] bg-[#090909] text-white border border-[#303030] rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:border-accent"
            >
              {(Object.keys(PERIODIZATION_GOAL_METADATA) as PeriodizationGoalType[]).map((g) => (
                <option key={g} value={g}>
                  Objetivo: {PERIODIZATION_GOAL_METADATA[g].label}
                </option>
              ))}
            </select>

            {/* Selector de Duración: 4, 8 o 12 semanas */}
            <div className="inline-flex bg-[#090909] p-1 rounded-xl border border-[#303030]">
              {([4, 8, 12] as PeriodizationDurationWeeks[]).map((dur) => {
                const isSelected = periodizationPlan.durationWeeks === dur;
                return (
                  <button
                    key={dur}
                    type="button"
                    onClick={() =>
                      handleUpdatePeriodizationGoalOrDuration(periodizationPlan.goal, dur)
                    }
                    className={`min-h-[36px] px-3 py-1 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-accent text-accent-contrast font-black'
                        : 'text-neutral-300 hover:text-white'
                    }`}
                  >
                    {dur} Sem.
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <p className="text-xs text-neutral-400">
          {PERIODIZATION_GOAL_METADATA[periodizationPlan.goal]?.focusDescription} Toca una semana para seleccionarla o alternar entre{' '}
          <span className="text-accent-text font-semibold">Progresión</span> y{' '}
          <span className="text-sky-400 font-semibold">Descarga</span>. Tus rutinas originales permanecen intactas hasta que autorices aplicar una semana.
        </p>

        {/* Grilla de semanas del mesociclo */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
          {periodizationPlan.weeks.map((w) => {
            const isActiveWeek = periodizationPlan.currentWeekNumber === w.weekNumber;
            return (
              <div
                key={w.weekNumber}
                className={`p-3 rounded-2xl border transition-all flex flex-col justify-between gap-2 ${
                  isActiveWeek
                    ? 'bg-[#090909] border-accent shadow-[0_6px_18px_var(--accent-glow)]'
                    : 'bg-[#090909]/70 border-[#303030]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-1">
                    <button
                      type="button"
                      onClick={() => handleSelectActiveWeek(w.weekNumber)}
                      className="font-black text-white text-sm hover:text-accent-text cursor-pointer text-left"
                    >
                      Semana {w.weekNumber}
                    </button>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                        w.isDeloadWeek
                          ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                          : 'bg-accent/15 text-accent-text border border-accent/30'
                      }`}
                    >
                      {w.isDeloadWeek ? 'Descarga' : 'Progresión'}
                    </span>
                  </div>
                  <div className="text-[11px] text-neutral-300 font-semibold mt-1">
                    {w.phaseLabel}
                  </div>
                  <div className="text-[11px] text-neutral-400 mt-1">
                    RPE {w.targetRpe} (RIR {w.targetRir}) · ~{w.loadIntensityPct1RM}% 1RM ·{' '}
                    {w.repRangeLabel}
                  </div>
                </div>

                <div className="pt-2 border-t border-[#303030]/70 flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() => handleSelectActiveWeek(w.weekNumber)}
                    className={`text-[11px] font-bold cursor-pointer ${
                      isActiveWeek ? 'text-accent-text' : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    {isActiveWeek ? '● Semana Activa' : 'Seleccionar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleDeloadWeek(w.weekNumber)}
                    className="text-[11px] text-neutral-300 hover:text-accent-text underline cursor-pointer"
                  >
                    {w.isDeloadWeek ? 'Hacer Progresión' : 'Hacer Descarga'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Autorización explícita para aplicar la semana activa del mesociclo a una rutina */}
        {safeRoutines.length > 0 && onUpdateRoutine && (
          <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <div className="font-bold text-white">
                Aplicar Semana {periodizationPlan.currentWeekNumber} a una rutina (bajo tu consentimiento)
              </div>
              <div className="text-neutral-400">
                {
                  periodizationPlan.weeks.find(
                    (w) => w.weekNumber === periodizationPlan.currentWeekNumber
                  )?.coachFocusNote
                }
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <select
                aria-label="Seleccionar rutina para aplicar semana de periodización"
                value={selectedRoutineForPeriodization}
                onChange={(e) => setSelectedRoutineForPeriodization(e.target.value)}
                className="min-h-[40px] bg-[#171717] text-white border border-[#303030] rounded-xl px-2.5 py-1.5 text-xs font-bold"
              >
                {safeRoutines.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title || r.dayName}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAuthorizePeriodizationOnRoutine}
                className="min-h-[40px] px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs cursor-pointer active:scale-95"
              >
                Autorizar Semana {periodizationPlan.currentWeekNumber} en Rutina
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 5. BALANCE MUSCULAR INTEGRADO CON MUSCLE RECOVERY PRO */}
      <section
        aria-label="Balance Muscular y Patrones de Movimiento"
        className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 text-[#F5F5F5]"
      >
        <div>
          <div className="flex items-center gap-2 text-xs font-bold text-accent-text uppercase tracking-wider">
            <Scale className="w-4 h-4 shrink-0" />
            <span>Integración Muscle Recovery Pro · Últimos 28 días</span>
          </div>
          <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
            BALANCE MUSCULAR (EMPUJE VS TRACCIÓN · PRIMARIOS Y SINERGISTAS)
          </h2>
        </div>

        {/* Indicadores de patrones Empuje vs Tracción y Tren Superior vs Inferior */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs tabular-nums">
          <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-neutral-400 font-bold uppercase text-[11px]">
                Patrón Empuje vs Tracción
              </span>
              <span className="text-accent-text font-black">
                Ratio:{' '}
                {muscleBalanceReport.pushPullRatio !== null
                  ? `${muscleBalanceReport.pushPullRatio}:1`
                  : '—'}
              </span>
            </div>
            <div className="text-sm font-black text-white">
              Empuje: {muscleBalanceReport.pushSets} ser. · Tracción: {muscleBalanceReport.pullSets} ser.
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-neutral-400 font-bold uppercase text-[11px]">
                Tren Superior vs Tren Inferior
              </span>
              <span className="text-accent-text font-black">
                Ratio:{' '}
                {muscleBalanceReport.upperLowerRatio !== null
                  ? `${muscleBalanceReport.upperLowerRatio}:1`
                  : '—'}
              </span>
            </div>
            <div className="text-sm font-black text-white">
              Superior: {muscleBalanceReport.upperBodySets} ser. · Inferior:{' '}
              {muscleBalanceReport.lowerBodySets} ser.
            </div>
          </div>
        </div>

        {/* Tabla de participación primaria, secundaria, frecuencia y recuperación estimada */}
        <div className="rounded-2xl bg-[#090909] border border-[#303030] overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <thead>
              <tr className="border-b border-[#303030] text-[10px] uppercase text-neutral-400">
                <th className="py-2.5 px-3 font-bold">Grupo Muscular</th>
                <th className="py-2.5 px-3 font-bold">Primarias (100%)</th>
                <th className="py-2.5 px-3 font-bold">Secundarias (Sinerg.)</th>
                <th className="py-2.5 px-3 font-bold">Total Efectivas</th>
                <th className="py-2.5 px-3 font-bold">Frecuencia</th>
                <th className="py-2.5 px-3 font-bold text-right">Recuperación Est.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#303030]/60">
              {muscleBalanceReport.muscleGroups.map((mg) => (
                <tr key={mg.muscleGroup} className="hover:bg-[#171717]/60">
                  <td className="py-2.5 px-3 font-bold text-white">{mg.muscleGroup}</td>
                  <td className="py-2.5 px-3 text-neutral-200">{mg.primaryEffectiveSets} ser</td>
                  <td className="py-2.5 px-3 text-neutral-400">+{mg.secondaryWeightedSets} ser</td>
                  <td className="py-2.5 px-3 font-black text-accent-text">
                    {mg.totalEffectiveSets} ser ({mg.shareOfTotalSetsPct}%)
                  </td>
                  <td className="py-2.5 px-3 text-neutral-300">{mg.weeklyFrequency}/sem</td>
                  <td className="py-2.5 px-3 text-right font-bold text-white">
                    {mg.currentRecoveryPct}%{' '}
                    {mg.remainingRecoveryHours > 0
                      ? `(${Math.ceil(mg.remainingRecoveryHours)}h)`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Observaciones de planificación + Aviso obligatorio no médico */}
        <div className="space-y-2">
          {muscleBalanceReport.planningObservations.map((obs, idx) => (
            <div
              key={idx}
              className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] text-xs text-neutral-300"
            >
              {obs}
            </div>
          ))}
          <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030]/80 text-[11px] text-neutral-400 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 text-accent-text shrink-0 mt-0.5" />
            <span>{muscleBalanceReport.nonMedicalDisclaimer}</span>
          </div>
        </div>
      </section>

      {/* =========================================================================================
          ETAPA 5: ELITE CHALLENGES PRO — EXPERIENCIA, RANGOS, DESAFÍOS, INSIGNIAS Y TARJETAS PNG
         ========================================================================================= */}
      <EliteChallengesPanel
        profile={activeProfile}
        history={safeHistory}
        routines={safeRoutines}
        prs={prs}
        periodizationPlan={periodizationPlan}
        variant="full"
      />

      {/* 2. SALÓN DE LA FAMA DE RÉCORDS PERSONALES (FUENTE UNIFICADA SIN DOBLE CONTEO) */}
      <div ref={recordsSectionRef} id="hall-of-fame-records">
        <PersonalRecordsHallOfFame
          prs={prs}
          history={safeHistory}
          routines={safeRoutines}
          comparativeGroups={analyticsData.groupedComparativeByDay}
          selectedDayFilter={selectedComparativeDay}
          recordsSummary={eliteReport.recordsSummary}
          periodLabel={eliteReport.periodLabel}
          selectedPeriod={selectedPeriod}
        />
      </div>

      {/* 3. INDICADORES DE CARGA Y TENDENCIAS (HUD RESPONSABLE CON FÓRMULA Y LIMITACIONES) */}
      <ExecutiveBiomechanicalHud
        history={safeHistory}
        prs={prs}
        routines={safeRoutines}
        comparativeGroups={analyticsData.groupedComparativeByDay}
        latestVerifiedPR={eliteReport.recordsSummary.records[0] || null}
      />

      {/* 4. CUADRO COMPARATIVO DE FUERZA Y EVOLUCIÓN DE CARGAS (ACORDEÓN UNIFICADO) */}
      <section className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl shadow-xl transition-all duration-300 overflow-hidden">
        <button
          type="button"
          onClick={() => setIsComparativeAccordionOpen(!isComparativeAccordionOpen)}
          className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#1b1b1b] transition-colors min-h-[64px]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent-text shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-accent-text uppercase tracking-wider">
                Análisis de Sobrecarga Progresiva
              </div>
              <h2 className="text-sm sm:text-base font-black text-white tracking-tight truncate">
                CUADRO COMPARATIVO DE CARGAS POR DÍA
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 text-xs font-bold text-accent-text">
            <span className="hidden sm:inline">
              {isComparativeAccordionOpen ? 'Ocultar' : 'Ver detalle'}
            </span>
            <div
              className={`w-9 h-9 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-center text-neutral-300 transition-transform duration-300 ${
                isComparativeAccordionOpen ? 'rotate-180' : ''
              }`}
            >
              <ChevronDown className="w-4 h-4 text-accent-text" />
            </div>
          </div>
        </button>

        {isComparativeAccordionOpen && (
          <div className="p-4 sm:p-6 space-y-4 border-t border-[#303030] bg-[#090909]/40 animate-in fade-in duration-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-neutral-400">
                Edita cargas previas o actuales por día de entrenamiento para actualizar tus proyecciones.
              </span>
              <select
                value={selectedComparativeDay}
                onChange={(e) => setSelectedComparativeDay(e.target.value)}
                aria-label="Filtrar cuadro comparativo por día"
                className="min-h-[40px] bg-[#090909] border border-[#303030] rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-accent"
              >
                <option value="ALL">Todos los Días</option>
                {analyticsData.groupedComparativeByDay.map((g) => (
                  <option key={g.dayName} value={g.dayName}>
                    {g.dayHeader}
                  </option>
                ))}
              </select>
            </div>

            {filteredComparativeGroups.length === 0 ? (
              <div className="py-10 text-center text-neutral-400 text-xs">
                No hay registros en el cuadro comparativo para el filtro seleccionado.
              </div>
            ) : (
              <div className="space-y-4">
                {filteredComparativeGroups.map((group) => (
                  <div
                    key={group.dayName}
                    className="bg-[#090909] rounded-2xl border border-[#303030] p-3.5 sm:p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-black text-accent-text">
                        {group.dayHeader}
                      </h3>
                      {onUpdateRoutine && (
                        <button
                          type="button"
                          onClick={() =>
                            setAddingToDay(addingToDay === group.dayName ? null : group.dayName)
                          }
                          className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold bg-[#171717] hover:border-accent/60 text-accent-text border border-[#303030] transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Añadir Ejercicio</span>
                        </button>
                      )}
                    </div>

                    {addingToDay === group.dayName && (
                      <div className="p-3 bg-[#171717] rounded-xl border border-accent/40 space-y-2.5 text-xs animate-in fade-in duration-150">
                        <div className="font-bold text-white flex items-center justify-between">
                          <span>Nuevo Ejercicio para {group.dayHeader}</span>
                          <button
                            type="button"
                            onClick={() => setAddingToDay(null)}
                            className="text-neutral-400 hover:text-white cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                          <input
                            type="text"
                            placeholder="Nombre (ej. Press Militar)"
                            value={newExName}
                            onChange={(e) => setNewExName(e.target.value)}
                            className="min-h-[40px] bg-[#090909] border border-[#303030] rounded-xl px-2.5 py-1.5 text-white sm:col-span-2 focus:outline-none focus:border-accent"
                          />
                          <select
                            value={newExMuscle}
                            onChange={(e) => setNewExMuscle(e.target.value)}
                            className="min-h-[40px] bg-[#090909] border border-[#303030] rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-accent"
                          >
                            <option value="Pecho">Pecho</option>
                            <option value="Espalda">Espalda</option>
                            <option value="Pierna">Pierna</option>
                            <option value="Hombro">Hombro</option>
                            <option value="Brazos">Brazos</option>
                            <option value="Glúteos">Glúteos</option>
                            <option value="Core">Core</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => handleAddCustomExerciseToDay(group.dayName)}
                            className="min-h-[40px] bg-accent hover:bg-accent-hover text-accent-contrast font-black px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
                          >
                            Guardar
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-[#303030] text-[10px] sm:text-[11px] text-neutral-400 uppercase tracking-wider">
                            <th className="pb-2.5 pr-3 font-bold">Ejercicio</th>
                            <th className="pb-2.5 px-2 text-center font-bold">Anterior</th>
                            <th className="pb-2.5 px-2 text-center font-bold">Actual</th>
                            <th className="pb-2.5 px-2 text-center font-bold">1RM Est.</th>
                            <th className="pb-2.5 px-2 text-right font-bold">Dif.</th>
                            <th className="pb-2.5 pl-2 text-right font-bold">Var. %</th>
                          </tr>
                        </thead>
                        <tbody className="text-xs sm:text-sm text-neutral-200 divide-y divide-[#303030]/60">
                          {group.rows.map((row, idx) => {
                            const isPositiveDiff = row.weightDelta > 0;
                            const isNegativeDiff = row.weightDelta < 0;
                            const isPositivePct = row.pctDelta > 0;
                            const isNegativePct = row.pctDelta < 0;

                            return (
                              <tr
                                key={`${group.dayName}-${row.name}-${idx}`}
                                className="hover:bg-[#171717]/60 transition-colors"
                              >
                                <td className="py-3 pr-3 align-middle">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="font-bold text-white leading-snug">
                                      {row.name}
                                    </span>
                                    {row.curr1RM > row.prev1RM && row.currWeight > 0 && row.prev1RM > 0 && (
                                      <span
                                        className="inline-flex items-center gap-1 text-[10px] font-black text-accent-text"
                                        title="¡Mejora en 1RM Estimado!"
                                      >
                                        <Trophy className="w-3 h-3 shrink-0" />
                                        <span>PR</span>
                                      </span>
                                    )}
                                  </div>
                                  {row.muscleGroup && (
                                    <div className="text-[11px] text-neutral-500 mt-0.5">
                                      {row.muscleGroup}
                                    </div>
                                  )}
                                </td>

                                <td className="py-3 px-2 text-center align-middle">
                                  {onUpdateRoutine ? (
                                    <div className="inline-flex items-center justify-center gap-1">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        step="0.5"
                                        value={row.prevWeight}
                                        onChange={(e) =>
                                          handleReactiveLoadChange(group, row, 'prevWeight', e.target.value)
                                        }
                                        className="w-14 bg-[#171717] border border-[#303030] rounded-lg px-2 py-1 text-center text-xs font-semibold text-neutral-200 tabular-nums focus:outline-none focus:border-accent"
                                      />
                                      <span className="text-[11px] text-neutral-400">kg</span>
                                    </div>
                                  ) : (
                                    <span className="font-semibold text-neutral-200 tabular-nums">
                                      {row.prevWeight} kg · {row.prevReps}r
                                    </span>
                                  )}
                                </td>

                                <td className="py-3 px-2 text-center align-middle">
                                  {onUpdateRoutine ? (
                                    <div className="inline-flex items-center justify-center gap-1">
                                      <input
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        step="0.5"
                                        value={row.currWeight}
                                        onChange={(e) =>
                                          handleReactiveLoadChange(group, row, 'currWeight', e.target.value)
                                        }
                                        className="w-14 bg-[#171717] border border-[#303030] rounded-lg px-2 py-1 text-center text-xs font-bold text-white tabular-nums focus:outline-none focus:border-accent"
                                      />
                                      <span className="text-[11px] text-neutral-500">×</span>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        min="1"
                                        max="50"
                                        value={row.currReps}
                                        onChange={(e) =>
                                          handleReactiveLoadChange(group, row, 'currReps', e.target.value)
                                        }
                                        className="w-11 bg-[#171717] border border-[#303030] rounded-lg px-1.5 py-1 text-center text-xs font-medium text-neutral-300 tabular-nums focus:outline-none focus:border-accent"
                                      />
                                    </div>
                                  ) : (
                                    <span className="font-bold text-white tabular-nums">
                                      {row.currWeight} kg × {row.currReps}r
                                    </span>
                                  )}
                                </td>

                                <td className="py-3 px-2 text-center align-middle tabular-nums">
                                  <span className="font-bold text-accent-text">
                                    ~{row.curr1RM} kg
                                  </span>
                                </td>

                                <td
                                  className={`py-3 px-2 text-right align-middle font-bold tabular-nums whitespace-nowrap ${
                                    isPositiveDiff
                                      ? 'text-accent-text'
                                      : isNegativeDiff
                                      ? 'text-rose-400'
                                      : 'text-neutral-400'
                                  }`}
                                >
                                  {row.weightDelta > 0 ? `+${row.weightDelta}` : row.weightDelta} kg
                                </td>

                                <td className="py-3 pl-2 text-right align-middle tabular-nums whitespace-nowrap">
                                  <span
                                    className={`text-xs font-bold ${
                                      isPositivePct
                                        ? 'text-accent-text'
                                        : isNegativePct
                                        ? 'text-rose-400'
                                        : 'text-neutral-400'
                                    }`}
                                  >
                                    {row.pctDelta > 0 ? `+${row.pctDelta}%` : `${row.pctDelta}%`}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* 5. PROGRESIÓN HISTÓRICA MENSUAL (TODO EL HISTORIAL REAL, COLAPSABLE) */}
      <OneRMProgressionChart
        comparativeGroups={analyticsData.groupedComparativeByDay}
        history={safeHistory}
        prs={prs}
        routines={safeRoutines}
      />

      {/* 6. HERRAMIENTAS DE EXPORTACIÓN UNIFICADAS (SIN DUPLICACIÓN) */}
      <section
        aria-label="Exportación de Datos y Reportes"
        className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent-text shrink-0">
            <FileSpreadsheet className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm sm:text-base font-black text-white tracking-tight">
              EXPORTACIÓN DE HISTORIAL Y REPORTES
            </h2>
            <p className="text-xs text-neutral-400">
              Descarga tu historial de entrenamiento, cargas o informe completo en CSV, Excel o PDF.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            type="button"
            onClick={() => {
              const success = exportWorkoutsToCSV(safeHistory, activeProfile);
              if (success)
                setDownloadSuccess('Historial de entrenamientos exportado correctamente a CSV.');
            }}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span className="truncate">Historial CSV</span>
          </button>

          <button
            type="button"
            onClick={() => {
              const success = exportExercisesAndLoadsToCSV({
                comparativeGroups: analyticsData.groupedComparativeByDay,
                history: safeHistory,
                athlete: activeProfile,
                selectedDayFilter: selectedComparativeDay,
              });
              if (success) setDownloadSuccess('Reporte de cargas y ejercicios exportado a CSV.');
            }}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#090909] hover:border-accent/60 text-white border border-[#303030] text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-4 h-4 text-accent-text shrink-0" />
            <span className="truncate">Cargas CSV</span>
          </button>

          <button
            type="button"
            onClick={() => {
              exportToExcel({
                athlete: activeProfile,
                adminName: activeProfile.name || 'Atleta',
                history: safeHistory,
                bodyWeightLogs,
                comparativeTable: analyticsData.comparativeTable,
                groupedComparativeByDay: analyticsData.groupedComparativeByDay,
                muscleGroupVolumes: analyticsData.muscleGroupVolume,
                weeklyTrends: analyticsData.weeklyTrends,
                totalVolumeTons: analyticsData.totalVolumeTons.toString(),
                totalSessions: safeHistory.length,
              });
              setDownloadSuccess('Libro de Excel (.xlsx) generado y descargado.');
            }}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#090909] hover:border-accent/60 text-white border border-[#303030] text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-accent-text shrink-0" />
            <span className="truncate">Excel (.xlsx)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              exportToPDF({
                athlete: activeProfile,
                adminName: activeProfile.name || 'Atleta',
                history: safeHistory,
                bodyWeightLogs,
                comparativeTable: analyticsData.comparativeTable,
                groupedComparativeByDay: analyticsData.groupedComparativeByDay,
                muscleGroupVolumes: analyticsData.muscleGroupVolume,
                weeklyTrends: analyticsData.weeklyTrends,
                totalVolumeTons: analyticsData.totalVolumeTons.toString(),
                totalSessions: safeHistory.length,
              });
              setDownloadSuccess('Vista de impresión / PDF preparada.');
            }}
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#090909] hover:border-accent/60 text-white border border-[#303030] text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4 text-accent-text shrink-0" />
            <span className="truncate">Reporte PDF</span>
          </button>
        </div>

        {downloadSuccess && (
          <div className="p-3 rounded-xl bg-[#090909] border border-accent/50 text-accent-text text-xs flex items-center justify-between gap-2 animate-in fade-in">
            <span>{downloadSuccess}</span>
            <button
              type="button"
              onClick={() => setDownloadSuccess(null)}
              className="text-neutral-400 hover:text-white cursor-pointer font-bold px-2"
            >
              ✕
            </button>
          </div>
        )}
      </section>
    </div>
  );
};
export default ProgresoView;
