import React, { useState, useMemo, useEffect } from 'react';
import {
  Activity,
  BarChart3,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Dumbbell,
  Info,
  Layers,
  Scale,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  ElitePerformanceReport,
  PerformancePeriodFilter,
  ExerciseStrengthSeries,
  MuscleVolumeBreakdownItem,
} from '../utils/elitePerformanceAnalytics';
import { Profile } from '../types';
import { StandardMuscleCategory } from '../utils/workoutAnalyticsEngine';
import { formatDisplayDateDDMMYYYY } from '../utils/exportReport';

interface CentroDeRendimientoDashboardProps {
  report: ElitePerformanceReport;
  activeProfile: Profile;
  selectedPeriod: PerformancePeriodFilter;
  onSelectPeriod: (p: PerformancePeriodFilter) => void;
  onNavigateToMuscleMap?: (muscleName?: string) => void;
  onOpenRecordsModal?: () => void;
}

export const CentroDeRendimientoDashboard: React.FC<CentroDeRendimientoDashboardProps> = ({
  report,
  activeProfile,
  selectedPeriod,
  onSelectPeriod,
  onNavigateToMuscleMap,
  onOpenRecordsModal,
}) => {
  const {
    kpis,
    comparative,
    consistency,
    weeklyFrequencySeries,
    monthlyFrequencySeries,
    muscleBreakdown,
    availableExercisesList,
    exerciseSeriesMap,
    recordsSummary,
    bodyWeight,
  } = report;

  // Selector de ejercicio para el gráfico de fuerza
  const [selectedExerciseKey, setSelectedExerciseKey] = useState<string>(() => {
    return availableExercisesList[0]?.id || '';
  });
  const [exerciseSearch, setExerciseSearch] = useState<string>('');
  const [showSessionLogTable, setShowSessionLogTable] = useState<boolean>(false);

  // Modalidad de métrica en gráfico: 'maxWeight' (marca real levantada) | 'estimated1RM' (estimado Epley)
  const [chartMetric, setChartMetric] = useState<'maxWeight' | 'estimated1RM'>('maxWeight');

  // Selector de grupo muscular para vista detallada
  const [selectedMuscle, setSelectedMuscle] = useState<StandardMuscleCategory | null>(() => {
    const firstActive = muscleBreakdown.find((m) => m.sets > 0 || m.volumeKg > 0);
    return firstActive ? firstActive.muscle : null;
  });

  // Toggle vista frecuencia Semanal vs Mensual
  const [frequencyGranularity, setFrequencyGranularity] = useState<'weekly' | 'monthly'>('weekly');

  // Estados de Evolución Corporal (Etapa E)
  const [bodyChartView, setBodyChartView] = useState<'weight' | 'comparison'>('weight');
  const [comparisonTarget, setComparisonTarget] = useState<'volume' | 'strength'>('volume');
  const [showBodyLogTable, setShowBodyLogTable] = useState<boolean>(false);

  const filteredExercisesOptions = useMemo(() => {
    const q = exerciseSearch.trim().toLowerCase();
    if (!q) return availableExercisesList;
    return availableExercisesList.filter(
      (ex) =>
        ex.name.toLowerCase().includes(q) || ex.muscle.toLowerCase().includes(q)
    );
  }, [availableExercisesList, exerciseSearch]);

  useEffect(() => {
    if (
      availableExercisesList.length > 0 &&
      (!selectedExerciseKey || !exerciseSeriesMap[selectedExerciseKey])
    ) {
      setSelectedExerciseKey(availableExercisesList[0].id);
    }
  }, [availableExercisesList, selectedExerciseKey, exerciseSeriesMap]);

  useEffect(() => {
    if (selectedMuscle) {
      const stillActive = muscleBreakdown.find(
        (m) => m.muscle === selectedMuscle && (m.sets > 0 || m.volumeKg > 0)
      );
      if (!stillActive) {
        const firstActive = muscleBreakdown.find((m) => m.sets > 0 || m.volumeKg > 0);
        setSelectedMuscle(firstActive ? firstActive.muscle : null);
      }
    }
  }, [muscleBreakdown, selectedMuscle]);

  const currentSeries: ExerciseStrengthSeries | undefined = useMemo(() => {
    if (selectedExerciseKey && exerciseSeriesMap[selectedExerciseKey]) {
      return exerciseSeriesMap[selectedExerciseKey];
    }
    const firstAvailable = availableExercisesList[0]?.id;
    if (firstAvailable && exerciseSeriesMap[firstAvailable]) {
      return exerciseSeriesMap[firstAvailable];
    }
    return undefined;
  }, [selectedExerciseKey, exerciseSeriesMap, availableExercisesList]);

  const chartData = useMemo(() => {
    if (!currentSeries || currentSeries.points.length === 0) return [];
    return currentSeries.points.map((pt, idx) => ({
      index: idx + 1,
      dateLabel: pt.dateLabel,
      fullDate: pt.date,
      routineTitle: pt.routineTitle,
      maxWeight: pt.maxWeightKg,
      reps: pt.repsAtMax,
      estimated1RM: pt.estimated1RM,
      setVolume: pt.setVolumeKg,
      totalSets: pt.totalSets,
      loadDelta: pt.loadDeltaFromPrevKg,
      isPR: pt.isAllTimePR,
    }));
  }, [currentSeries]);

  const selectedMuscleDetail: MuscleVolumeBreakdownItem | null = useMemo(() => {
    if (!selectedMuscle) return null;
    return muscleBreakdown.find((m) => m.muscle === selectedMuscle) || null;
  }, [selectedMuscle, muscleBreakdown]);

  const frequencyChartData = useMemo(() => {
    return frequencyGranularity === 'weekly'
      ? weeklyFrequencySeries
      : monthlyFrequencySeries;
  }, [frequencyGranularity, weeklyFrequencySeries, monthlyFrequencySeries]);

  const periodOptions: { id: PerformancePeriodFilter; label: string }[] = [
    { id: '7d', label: '7 días' },
    { id: '30d', label: '30 días' },
    { id: '90d', label: '90 días' },
    { id: '6m', label: '6 meses' },
    { id: '12m', label: '12 meses' },
    { id: 'all', label: 'Todo' },
  ];

  const activeMusclesForFrequency = useMemo(() => {
    return muscleBreakdown.filter((m) => m.sessionsCount > 0 || m.sets > 0);
  }, [muscleBreakdown]);

  return (
    <div className="w-full space-y-4 sm:space-y-6 text-[#F5F5F5]">
      {/* 1. ENCABEZADO COMPACTO MOBILE-FIRST + SELECTOR DE PERÍODO */}
      <div className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold tracking-wider uppercase mb-1">
              <span className="text-[#CCFF00]">LAZCAKONG GYM · ELITE PERFORMANCE</span>
              <span className="text-neutral-600" aria-hidden="true">·</span>
              <span className="text-neutral-400 font-semibold normal-case tracking-normal truncate">
                Atleta: {activeProfile.name || 'Atleta'}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg sm:text-2xl lg:text-3xl font-black text-white tracking-tight truncate">
                CENTRO DE RENDIMIENTO
              </h1>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-[#CCFF00]/15 border border-[#CCFF00]/30 flex items-center justify-center text-[#CCFF00] shrink-0">
                <TrendingUp className="w-4 h-4" />
              </div>
            </div>
          </div>

          <div className="text-xs text-neutral-400 shrink-0 tabular-nums">
            Ventana: <span className="text-[#CCFF00] font-semibold">{report.periodLabel}</span>
          </div>
        </div>

        {/* Selector de Período Temporal (Botones >=44px sin desbordamiento en 360px) */}
        <div className="mt-4 pt-3.5 border-t border-[#303030]/80">
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 sm:gap-2">
            {periodOptions.map((opt) => {
              const isSelected = selectedPeriod === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onSelectPeriod(opt.id)}
                  className={`min-h-[44px] px-2 py-2 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer flex items-center justify-center whitespace-nowrap active:scale-95 ${
                    isSelected
                      ? 'bg-[#CCFF00] text-[#090909] shadow-md shadow-[#CCFF00]/20 font-black'
                      : 'bg-[#090909] text-neutral-300 border border-[#303030] hover:border-neutral-500 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* 2. CUATRO TARJETAS KPI PRINCIPALES (2x2 móvil 360-430px, 4 columnas escritorio) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-4">
        {/* Tarjeta 1: ENTRENAMIENTOS (Diferenciando sesiones vs días distintos) */}
        <div className="min-w-0 bg-[#171717] border border-[#303030] rounded-2xl p-3 sm:p-5 flex flex-col justify-between hover:border-[#CCFF00]/40 transition-colors">
          <div>
            <div className="text-[10px] sm:text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">
              ENTRENAMIENTOS
            </div>
            <div className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tabular-nums tracking-tight">
              {kpis.totalWorkouts > 0 ? kpis.totalWorkouts : '—'}
            </div>
            <div className="text-[11px] sm:text-xs text-neutral-400 mt-1 tabular-nums">
              {kpis.totalWorkouts > 0
                ? `${kpis.totalWorkouts === 1 ? 'Sesión' : 'Sesiones'} en ${kpis.activeDaysCount} ${
                    kpis.activeDaysCount === 1 ? 'día' : 'días'
                  }`
                : 'Sin sesiones registradas'}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#303030]/60 text-[11px] tabular-nums">
            {comparative.hasBaseComparison ? (
              <span
                className={`font-semibold inline-flex items-center gap-1 ${
                  comparative.diffWorkouts >= 0 ? 'text-[#CCFF00]' : 'text-neutral-400'
                }`}
              >
                {comparative.diffWorkouts >= 0
                  ? `+${comparative.diffWorkouts}`
                  : comparative.diffWorkouts}{' '}
                vs período previo
              </span>
            ) : (
              <span className="text-neutral-500">Sin base histórica previa</span>
            )}
          </div>
        </div>

        {/* Tarjeta 2: VOLUMEN TOTAL */}
        <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between hover:border-[#CCFF00]/40 transition-colors">
          <div>
            <div className="text-[10px] sm:text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">
              VOLUMEN TOTAL
            </div>
            <div className="text-2xl sm:text-3xl lg:text-4xl font-black text-[#CCFF00] tabular-nums tracking-tight">
              {kpis.totalVolumeKg > 0 ? (
                <>
                  {kpis.totalVolumeTons >= 1
                    ? `${kpis.totalVolumeTons.toFixed(1)} ton`
                    : `${kpis.totalVolumeKg.toLocaleString()} kg`}
                </>
              ) : (
                '— kg'
              )}
            </div>
            <div className="text-[11px] sm:text-xs text-neutral-400 mt-1 tabular-nums">
              {kpis.totalCompletedSets > 0
                ? `${kpis.totalCompletedSets} series efectivas`
                : 'Carga acumulada real'}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#303030]/60 text-[11px] tabular-nums">
            {comparative.hasBaseComparison && comparative.diffVolumePct !== null ? (
              <span
                className={`font-semibold inline-flex items-center gap-1 ${
                  comparative.diffVolumeKg >= 0 ? 'text-[#CCFF00]' : 'text-rose-400'
                }`}
              >
                {comparative.diffVolumePct >= 0
                  ? `+${comparative.diffVolumePct}%`
                  : `${comparative.diffVolumePct}%`}{' '}
                vs anterior
              </span>
            ) : (
              <span className="text-neutral-500">Sin base histórica previa</span>
            )}
          </div>
        </div>

        {/* Tarjeta 3: RÉCORDS SUPERADOS VERIFICABLES */}
        <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between hover:border-[#CCFF00]/40 transition-colors">
          <div>
            <div className="text-[10px] sm:text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">
              RÉCORDS SUPERADOS
            </div>
            <div className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tabular-nums tracking-tight">
              {recordsSummary.surpassedPRsInPeriodCount > 0
                ? recordsSummary.surpassedPRsInPeriodCount
                : kpis.totalWorkouts > 0
                ? '0'
                : '—'}
            </div>
            <div className="text-[11px] sm:text-xs text-neutral-400 mt-1 tabular-nums">
              {recordsSummary.surpassedPRsInPeriodCount > 0
                ? `En ${recordsSummary.surpassedExercisesInPeriodCount} ejercicio(s)`
                : kpis.baselineMarksCount > 0
                ? `${kpis.baselineMarksCount} marca(s) base inicial`
                : 'Marcas verificadas'}
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#303030]/60 text-[11px] tabular-nums">
            <span
              className={
                recordsSummary.surpassedPRsInPeriodCount > 0
                  ? 'text-[#CCFF00] font-semibold'
                  : 'text-neutral-500'
              }
            >
              {recordsSummary.surpassedPRsInPeriodCount > 0
                ? 'Superaron marca previa'
                : 'Solo cuenta mejoras previas'}
            </span>
          </div>
        </div>

        {/* Tarjeta 4: FRECUENCIA */}
        <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3.5 sm:p-5 flex flex-col justify-between hover:border-[#CCFF00]/40 transition-colors">
          <div>
            <div className="text-[10px] sm:text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1">
              FRECUENCIA
            </div>
            <div className="text-2xl sm:text-3xl lg:text-4xl font-black text-white tabular-nums tracking-tight">
              {kpis.weeklyFrequency > 0 ? `${kpis.weeklyFrequency}` : '—'}
            </div>
            <div className="text-[11px] sm:text-xs text-neutral-400 mt-1">
              Sesiones por semana
            </div>
          </div>
          <div className="mt-3 pt-2 border-t border-[#303030]/60 text-[11px] tabular-nums">
            {consistency.hasEnoughData && consistency.consistencyPct !== null ? (
              <span className="text-[#CCFF00] font-semibold">
                {consistency.consistencyPct}% meta ({activeProfile.weeklyTargetDays || 4}d/sem)
              </span>
            ) : (
              <span className="text-neutral-500">Información insuficiente</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. EVOLUCIÓN DE FUERZA AVANZADA (SIN SUAVIZADO ARTIFICIAL) */}
      <div className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-[#CCFF00] uppercase tracking-wider">
              <Activity className="w-4 h-4 shrink-0" />
              <span>Análisis de Fuerza Real vs 1RM Estimado</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              EVOLUCIÓN DE FUERZA
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {/* Filtro rápido de ejercicio si hay muchos */}
            {availableExercisesList.length > 6 && (
              <input
                type="search"
                value={exerciseSearch}
                onChange={(e) => setExerciseSearch(e.target.value)}
                placeholder="Buscar ejercicio..."
                aria-label="Filtrar ejercicio"
                className="min-h-[44px] bg-[#090909] text-white placeholder-neutral-500 border border-[#303030] rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#CCFF00] sm:w-40"
              />
            )}

            {/* Selector de Ejercicio adaptable mobile-first */}
            {availableExercisesList.length > 0 && (
              <select
                value={selectedExerciseKey}
                onChange={(e) => setSelectedExerciseKey(e.target.value)}
                aria-label="Seleccionar ejercicio"
                className="min-h-[44px] w-full sm:w-auto sm:max-w-[260px] bg-[#090909] text-white border border-[#303030] rounded-xl px-3 py-2 text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[#CCFF00] cursor-pointer truncate"
              >
                {(filteredExercisesOptions.length > 0
                  ? filteredExercisesOptions
                  : availableExercisesList
                ).map((ex) => (
                  <option key={ex.id} value={ex.id}>
                    {ex.name} ({ex.sessionsCount} reg.)
                  </option>
                ))}
              </select>
            )}

            {/* Toggle Métrica: Marca Real vs 1RM Estimado */}
            <div className="grid grid-cols-2 sm:inline-flex rounded-xl bg-[#090909] p-1 border border-[#303030]">
              <button
                type="button"
                onClick={() => setChartMetric('maxWeight')}
                className={`min-h-[36px] px-2.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  chartMetric === 'maxWeight'
                    ? 'bg-[#171717] text-[#CCFF00] shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                Marca Real (kg)
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('estimated1RM')}
                className={`min-h-[36px] px-2.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                  chartMetric === 'estimated1RM'
                    ? 'bg-[#171717] text-[#CCFF00] shadow-sm'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                1RM Estimado
              </button>
            </div>
          </div>
        </div>

        {/* Resumen numérico real del ejercicio seleccionado */}
        {currentSeries && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 rounded-xl bg-[#090909] border border-[#303030]/60 text-xs tabular-nums">
            <div>
              <span className="text-neutral-400 block text-[11px]">Máximo Real Período</span>
              <span className="text-white font-bold text-sm">
                {currentSeries.periodBestWeightKg} kg × {currentSeries.periodBestWeightReps}r
              </span>
              {currentSeries.periodBestWeightDate && (
                <span className="text-[10px] text-neutral-500 block">
                  {formatDisplayDateDDMMYYYY(currentSeries.periodBestWeightDate)}
                </span>
              )}
            </div>
            <div>
              <span className="text-neutral-400 block text-[11px]">Mejor 1RM Estimado</span>
              <span className="text-[#CCFF00] font-bold text-sm">
                ~{currentSeries.periodBest1RM} kg
              </span>
              <span className="text-[10px] text-neutral-500 block">Fórmula Epley</span>
            </div>
            <div>
              <span className="text-neutral-400 block text-[11px]">Máximo Histórico</span>
              <span className="text-white font-bold text-sm">
                {currentSeries.allTimeMaxWeightKg} kg
              </span>
              <span className="text-[10px] text-neutral-500 block">
                ~{currentSeries.allTimeEstimated1RM} kg 1RM · {currentSeries.muscleGroup}
              </span>
            </div>
            <div>
              <span className="text-neutral-400 block text-[11px]">Vs Período Anterior</span>
              {currentSeries.previousPeriodComparison.hasPrevData ? (
                <>
                  <span
                    className={`font-bold text-sm ${
                      currentSeries.previousPeriodComparison.diffBestWeightKg >= 0
                        ? 'text-[#CCFF00]'
                        : 'text-rose-400'
                    }`}
                  >
                    {currentSeries.previousPeriodComparison.diffBestWeightKg >= 0
                      ? `+${currentSeries.previousPeriodComparison.diffBestWeightKg}`
                      : currentSeries.previousPeriodComparison.diffBestWeightKg}{' '}
                    kg reales
                  </span>
                  <span className="text-[10px] text-neutral-500 block">
                    {currentSeries.previousPeriodComparison.diffBest1RM >= 0
                      ? `+${currentSeries.previousPeriodComparison.diffBest1RM}`
                      : currentSeries.previousPeriodComparison.diffBest1RM}{' '}
                    kg en 1RM est.
                  </span>
                </>
              ) : (
                <span className="text-neutral-500 text-[11px] font-medium block mt-0.5">
                  Sin base previa comparable
                </span>
              )}
            </div>
          </div>
        )}

        {/* Gráfico Recharts con segmentos lineales directos (sin suavizados ficticios) */}
        <div className="w-full min-w-0 h-52 sm:h-64 pt-1">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="strengthGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#CCFF00" stopOpacity={0.32} />
                    <stop offset="95%" stopColor="#CCFF00" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#303030" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  stroke="#737373"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#303030' }}
                />
                <YAxis
                  stroke="#737373"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#303030' }}
                  domain={['dataMin - 5', 'dataMax + 5']}
                  unit=" kg"
                />
                {currentSeries &&
                  (chartMetric === 'maxWeight'
                    ? currentSeries.allTimeMaxWeightKg > 0
                    : currentSeries.allTimeEstimated1RM > 0) && (
                    <ReferenceLine
                      y={
                        chartMetric === 'maxWeight'
                          ? currentSeries.allTimeMaxWeightKg
                          : currentSeries.allTimeEstimated1RM
                      }
                      stroke="#737373"
                      strokeDasharray="4 4"
                    />
                  )}
                <Tooltip
                  wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-[#090909] border border-[#CCFF00]/60 rounded-xl p-2.5 sm:p-3 shadow-2xl text-xs space-y-1.5 min-w-[180px] max-w-[230px] sm:max-w-[260px]">
                        <div className="font-bold text-white border-b border-[#303030] pb-1 flex items-center justify-between gap-2">
                          <span>{formatDisplayDateDDMMYYYY(data.fullDate)}</span>
                          {data.isPR && (
                            <span className="text-[10px] text-[#CCFF00] font-black">
                              ★ Nuevo Récord
                            </span>
                          )}
                        </div>
                        <div className="text-neutral-400 text-[11px] truncate">
                          {data.routineTitle}
                        </div>
                        <div className="flex justify-between text-neutral-300 tabular-nums">
                          <span>Marca Real:</span>
                          <span className="font-bold text-white">
                            {data.maxWeight} kg × {data.reps} reps
                          </span>
                        </div>
                        <div className="flex justify-between text-[#CCFF00] tabular-nums">
                          <span>1RM Estimado:</span>
                          <span className="font-bold">~{data.estimated1RM} kg</span>
                        </div>
                        <div className="flex justify-between text-neutral-400 text-[11px] tabular-nums">
                          <span>Series · Volumen:</span>
                          <span>
                            {data.totalSets} ser · {data.setVolume.toLocaleString()} kg
                          </span>
                        </div>
                        {data.loadDelta !== null && (
                          <div className="flex justify-between text-[11px] pt-1 border-t border-[#303030]/70 tabular-nums">
                            <span className="text-neutral-400">Cambio vs anterior:</span>
                            <span
                              className={`font-bold ${
                                data.loadDelta > 0
                                  ? 'text-[#CCFF00]'
                                  : data.loadDelta < 0
                                  ? 'text-rose-400'
                                  : 'text-neutral-300'
                              }`}
                            >
                              {data.loadDelta > 0 ? `+${data.loadDelta}` : data.loadDelta} kg
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
                {/* type="linear" conecta puntos reales directamente sin interpolación engañosa */}
                <Area
                  type="linear"
                  dataKey={chartMetric}
                  stroke="#CCFF00"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#strengthGradient)"
                  dot={(props: any) => {
                    const { cx, cy, payload } = props;
                    if (cx === undefined || cy === undefined) return <g key={props.key} />;
                    const isPR = Boolean(payload?.isPR);
                    return (
                      <circle
                        key={`dot-${payload.index}`}
                        cx={cx}
                        cy={cy}
                        r={isPR ? 5.5 : 4}
                        fill={isPR ? '#CCFF00' : '#090909'}
                        stroke="#CCFF00"
                        strokeWidth={2}
                      />
                    );
                  }}
                  activeDot={{ r: 6.5, fill: '#FFFFFF', stroke: '#CCFF00', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-[#303030] rounded-2xl bg-[#090909]/40">
              <Dumbbell className="w-8 h-8 text-neutral-600 mb-2" />
              <p className="text-xs text-neutral-400 max-w-xs">
                Sin registros de carga para este ejercicio en el período ({report.periodLabel}).
              </p>
            </div>
          )}
        </div>

        {/* Pie informativo + Toggle de detalle por sesión */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-neutral-400 border-t border-[#303030]/60">
          <span>
            {chartMetric === 'estimated1RM'
              ? '1RM estimado (Epley: Peso × (1 + Reps/30)). Trazado lineal entre registros reales.'
              : 'Marca real máxima verificada por sesión. Trazado lineal sin puntos ficticios.'}
          </span>
          {chartData.length > 0 && (
            <button
              type="button"
              onClick={() => setShowSessionLogTable((prev) => !prev)}
              className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#090909] border border-[#303030] text-[#CCFF00] font-bold hover:border-[#CCFF00]/50 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>
                {showSessionLogTable
                  ? 'Ocultar registros'
                  : `Ver ${chartData.length} registro(s)`}
              </span>
              {showSessionLogTable ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {/* Bitácora desplegable de registros reales del ejercicio */}
        {showSessionLogTable && chartData.length > 0 && (
          <div className="rounded-xl bg-[#090909] border border-[#303030] overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead>
                <tr className="border-b border-[#303030] text-[10px] uppercase text-neutral-400">
                  <th className="py-2.5 px-3 font-bold">Fecha</th>
                  <th className="py-2.5 px-3 font-bold">Marca Real</th>
                  <th className="py-2.5 px-3 font-bold">1RM Est.</th>
                  <th className="py-2.5 px-3 font-bold">Series</th>
                  <th className="py-2.5 px-3 font-bold text-right">Evolución</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#303030]/50">
                {[...chartData].reverse().map((row) => (
                  <tr key={`${row.index}-${row.fullDate}`} className="hover:bg-[#171717]/60">
                    <td className="py-2 px-3 text-neutral-300 whitespace-nowrap">
                      {formatDisplayDateDDMMYYYY(row.fullDate)}
                      {row.isPR && (
                        <span className="ml-1.5 text-[10px] font-bold text-[#CCFF00]">★ PR</span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-bold text-white whitespace-nowrap">
                      {row.maxWeight} kg × {row.reps}r
                    </td>
                    <td className="py-2 px-3 text-[#CCFF00] whitespace-nowrap">
                      ~{row.estimated1RM} kg
                    </td>
                    <td className="py-2 px-3 text-neutral-400">{row.totalSets}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {row.loadDelta === null ? (
                        <span className="text-neutral-500">Base</span>
                      ) : row.loadDelta > 0 ? (
                        <span className="text-[#CCFF00] font-bold">+{row.loadDelta} kg</span>
                      ) : row.loadDelta < 0 ? (
                        <span className="text-rose-400 font-bold">{row.loadDelta} kg</span>
                      ) : (
                        <span className="text-neutral-400">0 kg</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. VOLUMEN MUSCULAR AVANZADO (CON SELECCIÓN E HISTORIAL POR MÚSCULO) */}
      <div className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-[#CCFF00] uppercase tracking-wider">
              <Layers className="w-4 h-4 shrink-0" />
              <span>Distribución Primaria (Sin Doble Cómputo)</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              VOLUMEN POR GRUPO MUSCULAR
            </h2>
          </div>

          {onNavigateToMuscleMap && (
            <button
              type="button"
              onClick={() => onNavigateToMuscleMap(selectedMuscle || undefined)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-[#090909] border border-[#303030] hover:border-[#CCFF00]/60 text-xs font-bold text-[#CCFF00] flex items-center gap-1 cursor-pointer transition-colors"
            >
              <span>Mapa Muscular</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <p className="text-xs text-neutral-400">
          Toca cualquier grupo muscular para inspeccionar ejercicios, series efectivas, sesiones y evolución semanal.
        </p>

        {/* Barras interactivas de distribución muscular */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {muscleBreakdown.map((item) => {
            const hasActivity = item.volumeKg > 0 || item.sets > 0;
            const isSelected = selectedMuscle === item.muscle;

            return (
              <button
                key={item.muscle}
                type="button"
                onClick={() =>
                  setSelectedMuscle(isSelected ? null : item.muscle)
                }
                className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer min-h-[56px] ${
                  isSelected
                    ? 'bg-[#090909] border-[#CCFF00] shadow-md shadow-[#CCFF00]/10'
                    : hasActivity
                    ? 'bg-[#090909]/60 border-[#303030] hover:border-neutral-500'
                    : 'bg-[#090909]/30 border-[#303030]/50 opacity-60 hover:opacity-85'
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-white truncate">{item.muscle}</span>
                    <span className="text-[11px] text-neutral-400 whitespace-nowrap tabular-nums">
                      {item.sets} ser · {item.sessionsCount} ses
                    </span>
                  </div>
                  <div className="flex items-center gap-2 tabular-nums shrink-0">
                    <span className="font-extrabold text-[#CCFF00]">
                      {item.volumeKg > 0 ? `${item.volumeKg.toLocaleString()} kg` : '0 kg'}
                    </span>
                    <span className="text-neutral-500 text-[11px] w-8 text-right font-medium">
                      {item.sharePct}%
                    </span>
                  </div>
                </div>

                <div className="w-full h-2 rounded-full bg-[#171717] overflow-hidden border border-[#303030]/60">
                  <div
                    className="h-full rounded-full bg-[#CCFF00] transition-all duration-300"
                    style={{ width: `${Math.max(hasActivity ? 4 : 0, item.sharePct)}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Panel de Detalle del Grupo Muscular Seleccionado */}
        {selectedMuscleDetail && (
          <div className="mt-3 p-4 rounded-2xl bg-[#090909] border border-[#CCFF00]/40 space-y-4 animate-in fade-in duration-150">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#303030] pb-3">
              <div>
                <div className="text-[11px] font-bold text-[#CCFF00] uppercase tracking-wider">
                  Detalle Muscular · {report.periodLabel}
                </div>
                <h3 className="text-base sm:text-lg font-black text-white">
                  {selectedMuscleDetail.muscle}
                </h3>
              </div>

              {onNavigateToMuscleMap && (
                <button
                  type="button"
                  onClick={() => onNavigateToMuscleMap(selectedMuscleDetail.muscle)}
                  className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#CCFF00] text-[#090909] text-xs font-black flex items-center gap-1 cursor-pointer active:scale-95"
                >
                  <span>Ver en Mapa Muscular</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Métricas clave del músculo: volumen, series, frecuencia y última sesión */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-2.5 text-xs tabular-nums">
              <div className="min-w-0 p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                <span className="text-neutral-400 text-[11px] block">Volumen Total</span>
                <span className="text-[#CCFF00] font-black text-sm">
                  {selectedMuscleDetail.volumeKg.toLocaleString()} kg
                </span>
                <span className="text-[10px] text-neutral-500 block">
                  {selectedMuscleDetail.sharePct}% del período
                </span>
              </div>
              <div className="min-w-0 p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                <span className="text-neutral-400 text-[11px] block">Series Efectivas</span>
                <span className="text-white font-black text-sm">
                  {selectedMuscleDetail.sets} series
                </span>
                {selectedMuscleDetail.previousPeriod.hasBaseComparison &&
                selectedMuscleDetail.previousPeriod.diffVolumePct !== null ? (
                  <span
                    className={`text-[10px] font-bold block ${
                      selectedMuscleDetail.previousPeriod.diffVolumeKg >= 0
                        ? 'text-[#CCFF00]'
                        : 'text-rose-400'
                    }`}
                  >
                    {selectedMuscleDetail.previousPeriod.diffVolumePct >= 0
                      ? `+${selectedMuscleDetail.previousPeriod.diffVolumePct}%`
                      : `${selectedMuscleDetail.previousPeriod.diffVolumePct}%`}{' '}
                    vs previo
                  </span>
                ) : (
                  <span className="text-[10px] text-neutral-500 block">Sin base previa</span>
                )}
              </div>
              <div className="min-w-0 p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                <span className="text-neutral-400 text-[11px] block">Frecuencia</span>
                <span className="text-white font-black text-sm">
                  {selectedMuscleDetail.weeklyFrequency > 0
                    ? `${selectedMuscleDetail.weeklyFrequency}/sem`
                    : '—'}
                </span>
                <span className="text-[10px] text-neutral-500 block">
                  {selectedMuscleDetail.sessionsCount} ses · {selectedMuscleDetail.distinctDaysCount} d
                </span>
              </div>
              <div className="min-w-0 p-2.5 rounded-xl bg-[#171717] border border-[#303030]">
                <span className="text-neutral-400 text-[11px] block">Última Sesión</span>
                <span className="text-white font-black text-sm truncate block">
                  {selectedMuscleDetail.lastSessionDate
                    ? formatDisplayDateDDMMYYYY(selectedMuscleDetail.lastSessionDate)
                    : 'Sin sesiones'}
                </span>
                <span className="text-[10px] text-neutral-500 block truncate">
                  {selectedMuscleDetail.sessionLogs.length > 0
                    ? selectedMuscleDetail.sessionLogs[
                        selectedMuscleDetail.sessionLogs.length - 1
                      ].routineTitle
                    : 'En este período'}
                </span>
              </div>
            </div>

            {/* Últimas sesiones registradas del grupo muscular */}
            {selectedMuscleDetail.sessionLogs.length > 0 && (
              <div className="p-2.5 rounded-xl bg-[#171717]/70 border border-[#303030] space-y-1.5">
                <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider">
                  Sesiones recientes de {selectedMuscleDetail.muscle}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs tabular-nums">
                  {[...selectedMuscleDetail.sessionLogs]
                    .reverse()
                    .slice(0, 3)
                    .map((sLog, idx) => (
                      <div
                        key={`${sLog.workoutId}-${idx}`}
                        className="p-2 rounded-lg bg-[#090909] border border-[#303030]/80 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <div className="text-white font-bold truncate text-[11px]">
                            {sLog.routineTitle}
                          </div>
                          <div className="text-[10px] text-neutral-400">
                            {formatDisplayDateDDMMYYYY(sLog.date)} · {sLog.sets} ser
                          </div>
                        </div>
                        <div className="text-[#CCFF00] font-extrabold text-[11px] shrink-0">
                          {sLog.volumeKg.toLocaleString()} kg
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Lista de ejercicios involucrados */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-neutral-300">
                  Ejercicios involucrados ({selectedMuscleDetail.exercises.length})
                </div>
                {selectedMuscleDetail.exercises.length === 0 ? (
                  <div className="p-3 rounded-xl bg-[#171717] border border-[#303030] text-xs text-neutral-500">
                    Sin ejercicios registrados para {selectedMuscleDetail.muscle} en este período.
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {selectedMuscleDetail.exercises.map((ex) => (
                      <div
                        key={ex.id}
                        className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-center justify-between gap-2 text-xs tabular-nums"
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-white truncate">{ex.name}</div>
                          <div className="text-[11px] text-neutral-400">
                            {ex.sets} series · {ex.sessionsCount} ses · Máx {ex.maxWeightKg} kg
                            {ex.repsAtMax > 0 ? ` × ${ex.repsAtMax}r` : ''}
                          </div>
                        </div>
                        <div className="font-extrabold text-[#CCFF00] shrink-0">
                          {ex.volumeKg.toLocaleString()} kg
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Evolución Semanal del grupo muscular */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-neutral-300">
                  Evolución semanal de volumen ({selectedMuscleDetail.muscle})
                </div>
                {selectedMuscleDetail.weeklyEvolution.length > 0 ? (
                  <div className="h-44 p-2 rounded-xl bg-[#171717] border border-[#303030]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={selectedMuscleDetail.weeklyEvolution}
                        margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                      >
                        <CartesianGrid stroke="#303030" strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="weekLabel"
                          stroke="#737373"
                          fontSize={10}
                          tickLine={false}
                        />
                        <YAxis stroke="#737373" fontSize={10} tickLine={false} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || !payload.length) return null;
                            const d = payload[0].payload;
                            return (
                              <div className="bg-[#090909] border border-[#CCFF00]/50 rounded-lg p-2.5 text-xs tabular-nums shadow-xl">
                                <div className="font-bold text-white">Sem. {d.weekLabel}</div>
                                <div className="text-[#CCFF00] font-bold">
                                  {d.volumeKg.toLocaleString()} kg
                                </div>
                                <div className="text-neutral-400 text-[11px]">
                                  {d.sets} series · {d.sessionsCount} sesiones
                                </div>
                              </div>
                            );
                          }}
                        />
                        <Bar dataKey="volumeKg" fill="#CCFF00" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-44 flex items-center justify-center rounded-xl bg-[#171717] border border-[#303030] text-xs text-neutral-500">
                    Sin actividad semanal en este período
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. FRECUENCIA, CONSISTENCIA Y COMPARATIVAS TEMPORALES */}
      <div className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-[#CCFF00] uppercase tracking-wider">
              <BarChart3 className="w-4 h-4 shrink-0" />
              <span>Consistencia y Volumen Periódico</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              FRECUENCIA Y COMPARATIVAS
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:inline-flex rounded-xl bg-[#090909] p-1 border border-[#303030]">
            <button
              type="button"
              onClick={() => setFrequencyGranularity('weekly')}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                frequencyGranularity === 'weekly'
                  ? 'bg-[#171717] text-[#CCFF00]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Vista Semanal
            </button>
            <button
              type="button"
              onClick={() => setFrequencyGranularity('monthly')}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                frequencyGranularity === 'monthly'
                  ? 'bg-[#171717] text-[#CCFF00]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Vista Mensual
            </button>
          </div>
        </div>

        {/* 4 indicadores claros de frecuencia y consistencia */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs tabular-nums">
          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Sesiones vs Días Reales</span>
            <span className="text-white font-black text-base block mt-0.5">
              {consistency.totalWorkouts} ses · {consistency.activeDaysCount} días
            </span>
            <span className="text-[11px] text-neutral-500">
              {consistency.activeDaysCount > 0
                ? `${consistency.avgSessionsPerActiveDay} ses/día activo`
                : 'Sin registros'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Consistencia de Meta</span>
            {consistency.hasEnoughData && consistency.consistencyPct !== null ? (
              <>
                <span className="text-[#CCFF00] font-black text-base block mt-0.5">
                  {consistency.consistencyPct}%
                </span>
                <span className="text-[11px] text-neutral-400">
                  {consistency.weeksMeetingTarget} de {consistency.weeksEvaluated} sem. en meta
                </span>
              </>
            ) : (
              <>
                <span className="text-neutral-300 font-bold text-xs block mt-1">
                  Información insuficiente
                </span>
                <span className="text-[11px] text-neutral-500">
                  {consistency.reasonIfInsufficient}
                </span>
              </>
            )}
          </div>

          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Promedio por Sesión</span>
            <span className="text-white font-black text-base block mt-0.5">
              {kpis.averageSessionVolumeKg > 0
                ? `${kpis.averageSessionVolumeKg.toLocaleString()} kg`
                : '— kg'}
            </span>
            <span className="text-[11px] text-neutral-500">
              {kpis.averageSessionDurationMinutes > 0
                ? `~${kpis.averageSessionDurationMinutes} min/sesión`
                : 'Duración promedio'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Comparativa Equivalente</span>
            {comparative.hasBaseComparison ? (
              <>
                <span
                  className={`font-black text-base block mt-0.5 ${
                    comparative.diffVolumeKg >= 0 ? 'text-[#CCFF00]' : 'text-rose-400'
                  }`}
                >
                  {comparative.diffVolumeKg >= 0 ? '+' : ''}
                  {comparative.diffVolumeKg.toLocaleString()} kg
                </span>
                <span className="text-[11px] text-neutral-400">
                  Previo: {comparative.prevWorkouts} ses ({comparative.prevActiveDaysCount}d)
                </span>
              </>
            ) : (
              <>
                <span className="text-neutral-300 font-bold text-xs block mt-1">
                  Información insuficiente
                </span>
                <span className="text-[11px] text-neutral-500">
                  Sin ventana previa con datos
                </span>
              </>
            )}
          </div>
        </div>

        {/* Gráfico de barras de volumen y sesiones semanales/mensuales */}
        <div className="w-full min-w-0 h-52 sm:h-60 pt-1">
          {frequencyChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={frequencyChartData}
                margin={{ top: 10, right: 10, left: -16, bottom: 0 }}
              >
                <CartesianGrid stroke="#303030" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#737373"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#303030' }}
                />
                <YAxis
                  stroke="#737373"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#303030' }}
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const pt = payload[0].payload;
                    return (
                      <div className="bg-[#090909] border border-[#CCFF00]/50 rounded-xl p-2.5 sm:p-3 text-xs space-y-1 tabular-nums shadow-2xl max-w-[230px] sm:max-w-[260px]">
                        <div className="font-bold text-white border-b border-[#303030] pb-1">
                          {frequencyGranularity === 'weekly' ? `Semana ${pt.label}` : pt.label}
                        </div>
                        <div className="flex justify-between gap-4 text-[#CCFF00] font-bold">
                          <span>Volumen:</span>
                          <span>{pt.volumeKg.toLocaleString()} kg</span>
                        </div>
                        <div className="flex justify-between gap-4 text-neutral-300">
                          <span>Sesiones · Días:</span>
                          <span>
                            {pt.sessionsCount} ses / {pt.activeDaysCount} días
                          </span>
                        </div>
                        <div className="flex justify-between gap-4 text-neutral-400">
                          <span>Series efectivas:</span>
                          <span>{pt.setsCount}</span>
                        </div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="volumeKg" fill="#CCFF00" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full flex flex-col items-center justify-center border border-dashed border-[#303030] rounded-2xl bg-[#090909]/40 text-xs text-neutral-400 p-4 text-center">
              <Calendar className="w-7 h-7 text-neutral-600 mb-2" />
              <span>Sin entrenamientos en el período para graficar volumen periódico.</span>
            </div>
          )}
        </div>

        {/* Frecuencia por grupo muscular */}
        {activeMusclesForFrequency.length > 0 && (
          <div className="pt-2 border-t border-[#303030]/60">
            <div className="text-xs font-bold text-neutral-300 mb-2">
              Frecuencia promedio por grupo muscular ({report.periodLabel})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs tabular-nums">
              {activeMusclesForFrequency.map((m) => (
                <div
                  key={m.muscle}
                  className="min-w-0 p-2.5 rounded-xl bg-[#090909] border border-[#303030] flex flex-col justify-between"
                >
                  <span className="font-bold text-white truncate">{m.muscle}</span>
                  <div className="flex items-baseline justify-between mt-1 gap-1">
                    <span className="text-[#CCFF00] font-black">{m.weeklyFrequency}/sem</span>
                    <span className="text-[11px] text-neutral-400 whitespace-nowrap">
                      {m.distinctDaysCount}d · {m.sessionsCount}s
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 6. EVOLUCIÓN CORPORAL Y COMPOSICIÓN (ETAPA E - EXCLUSIVO DE REGISTROS REALES) */}
      <div className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold text-[#CCFF00] uppercase tracking-wider">
              <Scale className="w-4 h-4 shrink-0" />
              <span>Registros Antropométricos Reales</span>
            </div>
            <h2 className="text-base sm:text-xl font-black text-white tracking-tight mt-0.5">
              EVOLUCIÓN CORPORAL Y TENDENCIAS
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:inline-flex rounded-xl bg-[#090909] p-1 border border-[#303030]">
            <button
              type="button"
              onClick={() => setBodyChartView('weight')}
              className={`min-h-[38px] px-2.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                bodyChartView === 'weight'
                  ? 'bg-[#171717] text-[#CCFF00]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Peso Corporal
            </button>
            <button
              type="button"
              onClick={() => setBodyChartView('comparison')}
              className={`min-h-[38px] px-2.5 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                bodyChartView === 'comparison'
                  ? 'bg-[#171717] text-[#CCFF00]'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Vs Entrenamiento
            </button>
          </div>
        </div>

        {/* 4 Tarjetas resumen de peso y medidas registradas */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs tabular-nums">
          <div className="min-w-0 p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Peso Registrado</span>
            <span className="text-white font-black text-base sm:text-lg block mt-0.5">
              {bodyWeight.currentWeightKg !== null ? `${bodyWeight.currentWeightKg} kg` : '— kg'}
            </span>
            <span
              className={`text-[11px] font-semibold block ${
                bodyWeight.diffWeightKg === null
                  ? 'text-neutral-500'
                  : bodyWeight.diffWeightKg > 0
                  ? 'text-[#CCFF00]'
                  : bodyWeight.diffWeightKg < 0
                  ? 'text-sky-400'
                  : 'text-neutral-400'
              }`}
            >
              {bodyWeight.diffWeightKg !== null
                ? `${bodyWeight.diffWeightKg > 0 ? '+' : ''}${bodyWeight.diffWeightKg} kg en período`
                : bodyWeight.entriesCount === 1
                ? '1 registro en período'
                : 'Sin registros en período'}
            </span>
          </div>

          <div className="min-w-0 p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Vs Período Anterior</span>
            {bodyWeight.previousPeriodComparison.hasPrevData &&
            bodyWeight.previousPeriodComparison.diffLatestKg !== null ? (
              <>
                <span
                  className={`font-black text-base sm:text-lg block mt-0.5 ${
                    bodyWeight.previousPeriodComparison.diffLatestKg > 0
                      ? 'text-[#CCFF00]'
                      : bodyWeight.previousPeriodComparison.diffLatestKg < 0
                      ? 'text-sky-400'
                      : 'text-white'
                  }`}
                >
                  {bodyWeight.previousPeriodComparison.diffLatestKg > 0 ? '+' : ''}
                  {bodyWeight.previousPeriodComparison.diffLatestKg} kg
                </span>
                <span className="text-[11px] text-neutral-400 block">
                  Previo: {bodyWeight.previousPeriodComparison.prevLatestWeightKg} kg (prom.{' '}
                  {bodyWeight.previousPeriodComparison.prevAvgWeightKg} kg)
                </span>
              </>
            ) : (
              <>
                <span className="text-neutral-300 font-bold text-xs block mt-1">
                  Sin base previa
                </span>
                <span className="text-[11px] text-neutral-500 block">
                  No hay pesajes en ventana anterior
                </span>
              </>
            )}
          </div>

          <div className="min-w-0 p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Rango · Promedio</span>
            {bodyWeight.minWeightKg !== null && bodyWeight.maxWeightKg !== null ? (
              <>
                <span className="text-white font-black text-sm sm:text-base block mt-0.5">
                  {bodyWeight.minWeightKg} – {bodyWeight.maxWeightKg} kg
                </span>
                <span className="text-[11px] text-neutral-400 block">
                  Prom: {bodyWeight.avgWeightKg} kg · {bodyWeight.entriesCount} reg.
                </span>
              </>
            ) : (
              <>
                <span className="text-neutral-300 font-bold text-xs block mt-1">—</span>
                <span className="text-[11px] text-neutral-500 block">Sin registros</span>
              </>
            )}
          </div>

          <div className="min-w-0 p-3 rounded-xl bg-[#090909] border border-[#303030]">
            <span className="text-neutral-400 text-[11px] block">Medidas Corporales</span>
            {bodyWeight.composition.latestBodyFatPct !== null ? (
              <>
                <span className="text-[#CCFF00] font-black text-base sm:text-lg block mt-0.5">
                  {bodyWeight.composition.latestBodyFatPct}% grasa
                </span>
                <span className="text-[11px] text-neutral-400 block">
                  {bodyWeight.composition.diffBodyFatPct !== null &&
                  bodyWeight.composition.bodyFatEntriesCount >= 2
                    ? `Var: ${bodyWeight.composition.diffBodyFatPct > 0 ? '+' : ''}${
                        bodyWeight.composition.diffBodyFatPct
                      }%`
                    : `${bodyWeight.composition.bodyFatEntriesCount} med. real(es)`}
                  {bodyWeight.composition.bmi !== null
                    ? ` · IMC ${bodyWeight.composition.bmi}`
                    : ''}
                </span>
              </>
            ) : bodyWeight.composition.bmi !== null &&
              bodyWeight.composition.heightCm !== null ? (
              <>
                <span className="text-white font-black text-base sm:text-lg block mt-0.5">
                  IMC {bodyWeight.composition.bmi}
                </span>
                <span className="text-[11px] text-neutral-400 block">
                  Est. {bodyWeight.composition.heightCm} cm · Sin % grasa registrado
                </span>
              </>
            ) : (
              <>
                <span className="text-neutral-300 font-bold text-xs block mt-1">
                  Sin medidas extra
                </span>
                <span className="text-[11px] text-neutral-500 block">
                  % grasa no registrado
                </span>
              </>
            )}
          </div>
        </div>

        {/* Vista A: Gráfico temporal de Peso Corporal */}
        {bodyChartView === 'weight' ? (
          <div className="w-full min-w-0 h-52 sm:h-60 pt-1">
            {bodyWeight.points.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={bodyWeight.points}
                  margin={{ top: 10, right: 10, left: -16, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="bodyWeightGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#CCFF00" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#CCFF00" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#303030" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="dateLabel"
                    stroke="#737373"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#303030' }}
                  />
                  <YAxis
                    stroke="#737373"
                    fontSize={11}
                    tickLine={false}
                    axisLine={{ stroke: '#303030' }}
                    domain={['dataMin - 2', 'dataMax + 2']}
                    unit=" kg"
                  />
                  {bodyWeight.avgWeightKg !== null && bodyWeight.points.length >= 2 && (
                    <ReferenceLine
                      y={bodyWeight.avgWeightKg}
                      stroke="#737373"
                      strokeDasharray="4 4"
                    />
                  )}
                  <Tooltip
                    wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                    content={({ active, payload }) => {
                      if (!active || !payload || !payload.length) return null;
                      const pt = payload[0].payload;
                      return (
                        <div className="bg-[#090909] border border-[#CCFF00]/60 rounded-xl p-2.5 sm:p-3 shadow-2xl text-xs space-y-1 tabular-nums max-w-[230px] sm:max-w-[260px]">
                          <div className="font-bold text-white border-b border-[#303030] pb-1">
                            {formatDisplayDateDDMMYYYY(pt.date)}
                          </div>
                          <div className="flex justify-between gap-4 text-[#CCFF00] font-bold">
                            <span>Peso corporal:</span>
                            <span>{pt.weightKg} kg</span>
                          </div>
                          {typeof pt.bodyFatPct === 'number' && (
                            <div className="flex justify-between gap-4 text-neutral-300">
                              <span>% Grasa registrado:</span>
                              <span className="font-bold">{pt.bodyFatPct}%</span>
                            </div>
                          )}
                          {pt.deltaFromPrevKg !== null && (
                            <div className="flex justify-between gap-4 text-neutral-300">
                              <span>Vs pesaje previo:</span>
                              <span
                                className={`font-bold ${
                                  pt.deltaFromPrevKg > 0
                                    ? 'text-[#CCFF00]'
                                    : pt.deltaFromPrevKg < 0
                                    ? 'text-sky-400'
                                    : 'text-neutral-400'
                                }`}
                              >
                                {pt.deltaFromPrevKg > 0 ? `+${pt.deltaFromPrevKg}` : pt.deltaFromPrevKg} kg
                              </span>
                            </div>
                          )}
                          {pt.note && (
                            <div className="text-[11px] text-neutral-400 pt-1 border-t border-[#303030]/60 break-words">
                              {pt.note}
                            </div>
                          )}
                        </div>
                      );
                    }}
                  />
                  <Area
                    type="linear"
                    dataKey="weightKg"
                    stroke="#CCFF00"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#bodyWeightGradient)"
                    dot={{ r: 4, fill: '#090909', stroke: '#CCFF00', strokeWidth: 2 }}
                    activeDot={{ r: 6.5, fill: '#FFFFFF', stroke: '#CCFF00', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center border border-dashed border-[#303030] rounded-2xl bg-[#090909]/40 text-xs text-neutral-400 p-4 text-center space-y-2">
                <Scale className="w-7 h-7 text-neutral-600" />
                <p className="max-w-sm">
                  {bodyWeight.hasAnyAllTimeLogs
                    ? `Sin registros de peso en ${report.periodLabel}. Tu último registro histórico fue de ${bodyWeight.allTimeLatestWeightKg} kg (${formatDisplayDateDDMMYYYY(bodyWeight.allTimeLatestDate || '')}).`
                    : 'Aún no hay registros de peso corporal para este atleta.'}
                </p>
                {bodyWeight.hasAnyAllTimeLogs && selectedPeriod !== 'all' && (
                  <button
                    type="button"
                    onClick={() => onSelectPeriod('all')}
                    className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#171717] border border-[#CCFF00]/50 text-[#CCFF00] font-bold text-xs cursor-pointer"
                  >
                    Ver historial completo ({bodyWeight.totalAllTimeLogsCount})
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Vista B: Comparativa Descriptiva Peso Corporal vs Tendencias de Volumen y Fuerza (Sin Causalidad) */
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex rounded-xl bg-[#090909] p-1 border border-[#303030]">
                <button
                  type="button"
                  onClick={() => setComparisonTarget('volume')}
                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    comparisonTarget === 'volume'
                      ? 'bg-[#171717] text-[#CCFF00]'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Peso vs Volumen Semanal
                </button>
                <button
                  type="button"
                  onClick={() => setComparisonTarget('strength')}
                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                    comparisonTarget === 'strength'
                      ? 'bg-[#171717] text-[#CCFF00]'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  Peso vs Fuerza Máx.
                </button>
              </div>

              <span className="text-[11px] text-neutral-400">
                Solo semanas con registros reales (sin puntos interpolados)
              </span>
            </div>

            <div className="w-full min-w-0 h-52 sm:h-60 pt-1">
              {bodyWeight.comparisonWithTrainingSeries.length > 0 &&
              (bodyWeight.points.length > 0 || kpis.totalWorkouts > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={bodyWeight.comparisonWithTrainingSeries}
                    margin={{ top: 10, right: 4, left: -16, bottom: 0 }}
                  >
                    <CartesianGrid stroke="#303030" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="weekLabel"
                      stroke="#737373"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#303030' }}
                    />
                    <YAxis
                      yAxisId="weight"
                      stroke="#CCFF00"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#303030' }}
                      domain={['dataMin - 2', 'dataMax + 2']}
                    />
                    <YAxis
                      yAxisId="training"
                      orientation="right"
                      stroke="#38BDF8"
                      fontSize={10}
                      tickLine={false}
                      axisLine={{ stroke: '#303030' }}
                    />
                    <Tooltip
                      wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                      content={({ active, payload }) => {
                        if (!active || !payload || !payload.length) return null;
                        const pt = payload[0].payload;
                        return (
                          <div className="bg-[#090909] border border-[#CCFF00]/60 rounded-xl p-2.5 sm:p-3 shadow-2xl text-xs space-y-1 tabular-nums max-w-[230px] sm:max-w-[260px]">
                            <div className="font-bold text-white border-b border-[#303030] pb-1">
                              Semana {pt.weekLabel}
                            </div>
                            <div className="flex justify-between gap-3 text-[#CCFF00] font-bold">
                              <span>Peso prom.:</span>
                              <span>
                                {pt.avgBodyWeightKg !== null
                                  ? `${pt.avgBodyWeightKg} kg (${pt.weightSamplesCount} reg.)`
                                  : 'No registrado'}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3 text-sky-400 font-bold">
                              <span>Volumen semanal:</span>
                              <span>{pt.volumeKg.toLocaleString()} kg</span>
                            </div>
                            <div className="flex justify-between gap-3 text-neutral-300">
                              <span>1RM Máx. semana:</span>
                              <span>
                                {pt.topEstimated1RM !== null
                                  ? `~${pt.topEstimated1RM} kg`
                                  : 'Sin carga externa'}
                              </span>
                            </div>
                            <div className="flex justify-between gap-3 text-neutral-400 text-[11px]">
                              <span>Sesiones:</span>
                              <span>{pt.sessionsCount}</span>
                            </div>
                          </div>
                        );
                      }}
                    />
                    {comparisonTarget === 'volume' ? (
                      <Bar
                        yAxisId="training"
                        dataKey="volumeKg"
                        fill="#38BDF8"
                        fillOpacity={0.35}
                        radius={[4, 4, 0, 0]}
                        name="Volumen (kg)"
                      />
                    ) : (
                      <Line
                        yAxisId="training"
                        type="linear"
                        dataKey="topEstimated1RM"
                        stroke="#38BDF8"
                        strokeWidth={2}
                        connectNulls={false}
                        dot={{ r: 3.5, fill: '#090909', stroke: '#38BDF8', strokeWidth: 2 }}
                        name="1RM Máx. Est. (kg)"
                      />
                    )}
                    <Line
                      yAxisId="weight"
                      type="linear"
                      dataKey="avgBodyWeightKg"
                      stroke="#CCFF00"
                      strokeWidth={2.5}
                      connectNulls={false}
                      dot={{ r: 4, fill: '#090909', stroke: '#CCFF00', strokeWidth: 2 }}
                      name="Peso Corporal (kg)"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center border border-dashed border-[#303030] rounded-2xl bg-[#090909]/40 text-xs text-neutral-400 p-4 text-center">
                  Se requieren registros semanales de peso y entrenamiento en el período para visualizar la comparativa.
                </div>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-[#090909] border border-[#303030] text-[11px] text-neutral-400 flex items-start gap-2 leading-relaxed">
              <Info className="w-3.5 h-3.5 text-[#CCFF00] shrink-0 mt-0.5" />
              <span>
                Lectura descriptiva: muestra en paralelo peso corporal ({' '}
                <span className="text-[#CCFF00] font-semibold">línea lima</span>) y{' '}
                {comparisonTarget === 'volume' ? 'volumen semanal' : '1RM máximo semanal'} ({' '}
                <span className="text-sky-400 font-semibold">azul</span>). Los cambios paralelos no
                implican relación causal directa.
              </span>
            </div>
          </div>
        )}

        {/* Pie + Bitácora desplegable de registros corporales */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-neutral-400 border-t border-[#303030]/60">
          <span>
            {bodyWeight.points.length > 0
              ? `Trazado lineal estricto sobre ${bodyWeight.points.length} registro(s) reales del atleta.`
              : 'Los cambios de peso solo reflejan tus pesajes verificados.'}
          </span>
          {bodyWeight.points.length > 0 && (
            <button
              type="button"
              onClick={() => setShowBodyLogTable((prev) => !prev)}
              className="min-h-[36px] px-2.5 py-1 rounded-lg bg-[#090909] border border-[#303030] text-[#CCFF00] font-bold hover:border-[#CCFF00]/50 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>
                {showBodyLogTable
                  ? 'Ocultar pesajes'
                  : `Ver ${bodyWeight.points.length} pesaje(s)`}
              </span>
              {showBodyLogTable ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>

        {showBodyLogTable && bodyWeight.points.length > 0 && (
          <div className="rounded-xl bg-[#090909] border border-[#303030] overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead>
                <tr className="border-b border-[#303030] text-[10px] uppercase text-neutral-400">
                  <th className="py-2.5 px-3 font-bold">Fecha</th>
                  <th className="py-2.5 px-3 font-bold">Peso</th>
                  <th className="py-2.5 px-3 font-bold">% Grasa</th>
                  <th className="py-2.5 px-3 font-bold text-right">Cambio</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#303030]/50">
                {[...bodyWeight.points].reverse().map((row, idx) => (
                  <tr key={`${row.date}-${idx}`} className="hover:bg-[#171717]/60">
                    <td className="py-2 px-3 text-neutral-300 whitespace-nowrap">
                      {formatDisplayDateDDMMYYYY(row.date)}
                      {row.note && (
                        <span className="block text-[10px] text-neutral-500 max-w-[140px] truncate">
                          {row.note}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-bold text-white whitespace-nowrap">
                      {row.weightKg} kg
                    </td>
                    <td className="py-2 px-3 text-neutral-300 whitespace-nowrap">
                      {typeof row.bodyFatPct === 'number' ? `${row.bodyFatPct}%` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {row.deltaFromPrevKg === null ? (
                        <span className="text-neutral-500">Base</span>
                      ) : row.deltaFromPrevKg > 0 ? (
                        <span className="text-[#CCFF00] font-bold">+{row.deltaFromPrevKg} kg</span>
                      ) : row.deltaFromPrevKg < 0 ? (
                        <span className="text-sky-400 font-bold">{row.deltaFromPrevKg} kg</span>
                      ) : (
                        <span className="text-neutral-400">0 kg</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 7. ACCESO DIRECTO UNIFICADO A RÉCORDS PERSONALES ELITE */}
      {onOpenRecordsModal && (
        <button
          type="button"
          onClick={onOpenRecordsModal}
          className="w-full text-left bg-[#171717] hover:bg-[#1a1a1a] border border-[#303030] hover:border-[#CCFF00]/50 rounded-2xl p-4 sm:p-5 flex items-center justify-between gap-3 transition-all cursor-pointer shadow-lg active:scale-[0.99] min-h-[64px]"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#CCFF00]/15 border border-[#CCFF00]/30 flex items-center justify-center text-[#CCFF00] shrink-0">
              <Trophy className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="font-black text-white text-sm sm:text-base flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>RÉCORDS PERSONALES ELITE</span>
                <span className="text-xs text-[#CCFF00] font-bold tabular-nums">
                  · {recordsSummary.surpassedPRsInPeriodCount} superado(s) ·{' '}
                  {recordsSummary.records.length} ejercicio(s)
                </span>
              </div>
              <div className="text-xs text-neutral-400 truncate">
                Marcas reales máximas, 1RM estimado e historial verificable por ejercicio
              </div>
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-neutral-400 shrink-0" />
        </button>
      )}
    </div>
  );
};
