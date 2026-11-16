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
} from 'lucide-react';
import {
  Profile,
  CompletedWorkout,
  PersonalRecord,
  Routine,
  BodyWeightEntry,
  ActiveWorkoutSession,
  Exercise,
} from '../types';
import { CentroDeRendimientoDashboard } from '../components/CentroDeRendimientoDashboard';
import {
  computeElitePerformanceAnalytics,
  PerformancePeriodFilter,
} from '../utils/elitePerformanceAnalytics';
import { OneRMProgressionChart } from '../components/OneRMProgressionChart';
import { ExecutiveBiomechanicalHud } from '../components/ExecutiveBiomechanicalHud';
import { PersonalRecordsHallOfFame } from '../components/PersonalRecordsHallOfFame';
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
  onPurgeHistory?: () => HistoryPurgeReport;
  onNavigateTab?: (tab: any) => void;
  onNavigateToMuscleMap?: (muscleName?: string) => void;
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
}) => {
  // Garantizar que el historial leído esté 100% deduplicado por fecha YYYY-MM-DD y con tiempos reales (45-120 min)
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

  // Motor analítico puro de Rendimiento Deportivo Elite 3.0
  const eliteReport = useMemo(() => {
    return computeElitePerformanceAnalytics({
      history: safeHistory,
      routines: safeRoutines,
      prs,
      bodyWeightLogs,
      period: selectedPeriod,
      weeklyTargetDays: activeProfile?.weeklyTargetDays || 4,
      athleteHeightCm: activeProfile?.heightCm,
    });
  }, [
    safeHistory,
    safeRoutines,
    prs,
    bodyWeightLogs,
    selectedPeriod,
    activeProfile?.weeklyTargetDays,
    activeProfile?.heightCm,
  ]);
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

  const getMondayOfCurrentWeek = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    return new Date(d.setDate(diff)).setHours(0, 0, 0, 0);
  };

  const currentWeekHistory = useMemo(() => {
    const mondayTime = getMondayOfCurrentWeek();
    return safeHistory.filter(w => new Date(w.date).getTime() >= mondayTime);
  }, [safeHistory]);

  const targetHistory = useMemo(() => {
    return progressPeriod === 'current_week' ? currentWeekHistory : safeHistory;
  }, [progressPeriod, currentWeekHistory, safeHistory]);

  // Generación reactiva de métricas y Cuadro Comparativo agrupado estrictamente por Día de la Semana
  const analyticsData = useMemo(() => {
    const getMondayOfDate = (dInput: Date | string | number) => {
      const d = new Date(dInput);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      monday.setHours(0, 0, 0, 0);
      return monday.getTime();
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
      const d = new Date(w.date);
      const mondayTime = getMondayOfDate(d);
      const mondayDate = new Date(mondayTime);
      const sundayDate = new Date(mondayDate);
      sundayDate.setDate(sundayDate.getDate() + 6);
      const startStr = mondayDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
      const endStr = sundayDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
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
            <div className="w-10 h-10 rounded-xl bg-[#CCFF00]/15 border border-[#CCFF00]/30 flex items-center justify-center text-[#CCFF00] shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-bold text-[#CCFF00] uppercase tracking-wider">
                Análisis de Sobrecarga Progresiva
              </div>
              <h2 className="text-sm sm:text-base font-black text-white tracking-tight truncate">
                CUADRO COMPARATIVO DE CARGAS POR DÍA
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 text-xs font-bold text-[#CCFF00]">
            <span className="hidden sm:inline">
              {isComparativeAccordionOpen ? 'Ocultar' : 'Ver detalle'}
            </span>
            <div
              className={`w-9 h-9 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-center text-neutral-300 transition-transform duration-300 ${
                isComparativeAccordionOpen ? 'rotate-180' : ''
              }`}
            >
              <ChevronDown className="w-4 h-4 text-[#CCFF00]" />
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
                className="min-h-[40px] bg-[#090909] border border-[#303030] rounded-xl px-3 py-1.5 text-xs font-bold text-white focus:outline-none focus:border-[#CCFF00]"
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
                      <h3 className="text-sm font-black text-[#CCFF00]">
                        {group.dayHeader}
                      </h3>
                      {onUpdateRoutine && (
                        <button
                          type="button"
                          onClick={() =>
                            setAddingToDay(addingToDay === group.dayName ? null : group.dayName)
                          }
                          className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-bold bg-[#171717] hover:border-[#CCFF00]/60 text-[#CCFF00] border border-[#303030] transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Añadir Ejercicio</span>
                        </button>
                      )}
                    </div>

                    {addingToDay === group.dayName && (
                      <div className="p-3 bg-[#171717] rounded-xl border border-[#CCFF00]/40 space-y-2.5 text-xs animate-in fade-in duration-150">
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
                            className="min-h-[40px] bg-[#090909] border border-[#303030] rounded-xl px-2.5 py-1.5 text-white sm:col-span-2 focus:outline-none focus:border-[#CCFF00]"
                          />
                          <select
                            value={newExMuscle}
                            onChange={(e) => setNewExMuscle(e.target.value)}
                            className="min-h-[40px] bg-[#090909] border border-[#303030] rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-[#CCFF00]"
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
                            className="min-h-[40px] bg-[#CCFF00] text-[#090909] font-black px-3 py-1.5 rounded-xl transition-colors cursor-pointer"
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
                                        className="inline-flex items-center gap-1 text-[10px] font-black text-[#CCFF00]"
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
                                        className="w-14 bg-[#171717] border border-[#303030] rounded-lg px-2 py-1 text-center text-xs font-semibold text-neutral-200 tabular-nums focus:outline-none focus:border-[#CCFF00]"
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
                                        className="w-14 bg-[#171717] border border-[#303030] rounded-lg px-2 py-1 text-center text-xs font-bold text-white tabular-nums focus:outline-none focus:border-[#CCFF00]"
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
                                        className="w-11 bg-[#171717] border border-[#303030] rounded-lg px-1.5 py-1 text-center text-xs font-medium text-neutral-300 tabular-nums focus:outline-none focus:border-[#CCFF00]"
                                      />
                                    </div>
                                  ) : (
                                    <span className="font-bold text-white tabular-nums">
                                      {row.currWeight} kg × {row.currReps}r
                                    </span>
                                  )}
                                </td>

                                <td className="py-3 px-2 text-center align-middle tabular-nums">
                                  <span className="font-bold text-[#CCFF00]">
                                    ~{row.curr1RM} kg
                                  </span>
                                </td>

                                <td
                                  className={`py-3 px-2 text-right align-middle font-bold tabular-nums whitespace-nowrap ${
                                    isPositiveDiff
                                      ? 'text-[#CCFF00]'
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
                                        ? 'text-[#CCFF00]'
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
          <div className="w-10 h-10 rounded-xl bg-[#CCFF00]/15 border border-[#CCFF00]/30 flex items-center justify-center text-[#CCFF00] shrink-0">
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
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#CCFF00] hover:bg-[#d6ff33] text-[#090909] font-black text-xs transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
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
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#090909] hover:border-[#CCFF00]/60 text-white border border-[#303030] text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FileText className="w-4 h-4 text-[#CCFF00] shrink-0" />
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
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#090909] hover:border-[#CCFF00]/60 text-white border border-[#303030] text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#CCFF00] shrink-0" />
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
            className="min-h-[44px] px-3 py-2.5 rounded-xl bg-[#090909] hover:border-[#CCFF00]/60 text-white border border-[#303030] text-xs font-bold transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Printer className="w-4 h-4 text-[#CCFF00] shrink-0" />
            <span className="truncate">Reporte PDF</span>
          </button>
        </div>

        {downloadSuccess && (
          <div className="p-3 rounded-xl bg-[#090909] border border-[#CCFF00]/50 text-[#CCFF00] text-xs flex items-center justify-between gap-2 animate-in fade-in">
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
