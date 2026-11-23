import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import {
  Activity,
  Cpu,
  Dumbbell,
  Flame,
  Gauge,
  Layers,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { CompletedWorkout, Profile, Routine } from '../types';
import {
  DailyComparativeGroup,
  formatDisplayDateDDMMYYYY,
} from '../utils/exportReport';
import { isSameWeekday, normalizeText } from '../utils/workoutAnalyticsEngine';

export interface SessionRelativeVolumeRow {
  id: string;
  sessionLabel: string;
  dayName: string;
  subtitle: string;
  dateStr?: string;
  totalVolumeKg: number;
  prevTotalVolumeKg: number;
  totalSets: number;
  exercisesCount: number;
  relativeVolumePerSetKg: number;
  prevRelativeVolumePerSetKg: number;
  efficiencyDeltaPct: number;
  bodyWeightRatio: number;
  fatigueLevel: 'low' | 'optimal' | 'high';
  fatigueScorePct: number;
  fatigueLabel: string;
  efficiencyLabel: string;
  recommendation: string;
}

interface SessionRelativeVolumeModuleProps {
  comparativeGroups?: DailyComparativeGroup[];
  routines?: Routine[];
  history?: CompletedWorkout[];
  activeProfile?: Profile;
  selectedDayFilter?: string;
}

const CustomRelativeVolTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  const row: SessionRelativeVolumeRow = payload[0].payload;

  return (
    <div className="bg-slate-950/95 border border-slate-800 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-xs space-y-2 min-w-[220px]">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/80 pb-2">
        <span className="font-bold text-white">{row.sessionLabel}</span>
        <span
          className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
            row.fatigueLevel === 'optimal'
              ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
              : row.fatigueLevel === 'high'
              ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
              : 'bg-blue-950/60 text-blue-300 border border-blue-800/50'
          }`}
        >
          {row.fatigueLabel}
        </span>
      </div>

      <div className="space-y-1.5 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Volumen Relativo:</span>
          <span className="text-sm font-black text-emerald-400">
            {row.relativeVolumePerSetKg.toLocaleString('es-CL')} kg / serie
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Tonelaje Total:</span>
          <span className="font-semibold text-white">
            {row.totalVolumeKg.toLocaleString('es-CL')} kg
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Series Efectivas:</span>
          <span className="font-semibold text-cyan-300">{row.totalSets} series</span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Fatiga Neuromuscular:</span>
          <span className="font-bold text-amber-300">{row.fatigueScorePct}% SNC</span>
        </div>
      </div>
    </div>
  );
};

export const SessionRelativeVolumeModule: React.FC<SessionRelativeVolumeModuleProps> = ({
  comparativeGroups = [],
  routines = [],
  history = [],
  activeProfile,
  selectedDayFilter = 'ALL',
}) => {
  const [sourceMode, setSourceMode] = useState<'active_plan' | 'history_logs'>('active_plan');
  const athleteWeightKg = Math.max(40, Number(activeProfile?.weightKg) || 95);

  // Construir mapa de series por ejercicio desde las rutinas activas
  const setsLookup = useMemo(() => {
    const map = new Map<string, number>();
    routines.forEach((r) => {
      (r.exercises || []).forEach((ex) => {
        const key = `${normalizeText(r.dayName)}::${normalizeText(ex.name)}`;
        map.set(key, Math.min(6, Math.max(1, Number(ex.defaultSets) || 3)));
        map.set(normalizeText(ex.name), Math.min(6, Math.max(1, Number(ex.defaultSets) || 3)));
      });
    });
    return map;
  }, [routines]);

  const classifySessionBiomechanics = (
    relativeVolPerSet: number,
    totalSets: number,
    deltaPct: number
  ): {
    fatigueLevel: 'low' | 'optimal' | 'high';
    fatigueScorePct: number;
    fatigueLabel: string;
    efficiencyLabel: string;
    recommendation: string;
  } => {
    // Cálculo biomecánico del índice de fatiga neuromuscular combinando densidad por serie (kg/serie) y volumen de series
    const densityFactor = Math.min(70, Math.round((relativeVolPerSet / 1100) * 65));
    const volumeFactor = Math.min(30, Math.round((totalSets / 22) * 30));
    const fatigueScorePct = Math.min(98, Math.max(18, densityFactor + volumeFactor));

    if (relativeVolPerSet >= 850 || fatigueScorePct >= 75) {
      return {
        fatigueLevel: 'high',
        fatigueScorePct,
        fatigueLabel: 'Demanda SNC Alta',
        efficiencyLabel: 'Alta Tensión Mecánica',
        recommendation:
          'Alta carga por serie. Prioriza descansos de 120-180s entre series y 48-72h de recuperación neural.',
      };
    }

    if (relativeVolPerSet >= 450 || fatigueScorePct >= 42) {
      return {
        fatigueLevel: 'optimal',
        fatigueScorePct,
        fatigueLabel: 'Fatiga Controlada',
        efficiencyLabel:
          deltaPct > 0 ? 'Eficiencia Óptima (+Progreso)' : 'Zona Óptima Hipertrofia',
        recommendation:
          'Relación ideal estímulo-fatiga. Excelente eficiencia de trabajo mecánico por cada serie invertida.',
      };
    }

    return {
      fatigueLevel: 'low',
      fatigueScorePct,
      fatigueLabel: 'Bajo Estrés Neural',
      efficiencyLabel: 'Estímulo Metabólico / Bombeo',
      recommendation:
        'Baja fatiga del SNC por serie. Margen disponible para incrementar carga progresiva (+2.5 a 5 kg).',
    };
  };

  // 1. Filas calculadas en tiempo real desde la Rutina Activa / Cuadro Comparativo
  const activePlanSessionRows = useMemo<SessionRelativeVolumeRow[]>(() => {
    const groupsToUse =
      selectedDayFilter !== 'ALL' &&
      comparativeGroups.some((g) => isSameWeekday(g.dayName, selectedDayFilter))
        ? comparativeGroups.filter((g) => isSameWeekday(g.dayName, selectedDayFilter))
        : comparativeGroups;

    return groupsToUse.map((group) => {
      let totalVolKg = 0;
      let prevTotalVolKg = 0;
      let totalSets = 0;

      group.rows.forEach((row) => {
        const specificKey = `${normalizeText(group.dayName)}::${normalizeText(row.name)}`;
        const sets =
          setsLookup.get(specificKey) || setsLookup.get(normalizeText(row.name)) || 3;

        const currReps = row.currReps > 0 ? row.currReps : 10;
        const prevReps = row.prevReps > 0 ? row.prevReps : currReps;

        totalVolKg += row.currWeight * currReps * sets;
        prevTotalVolKg += row.prevWeight * prevReps * sets;
        totalSets += sets;
      });

      const safeSets = Math.max(1, totalSets);
      const roundedTotalVol = Math.round(totalVolKg);
      const roundedPrevVol = Math.round(prevTotalVolKg);

      // FÓRMULA CENTRAL: Tonelaje Total ÷ Número de Series
      const relativeVolPerSet = Math.round(roundedTotalVol / safeSets);
      const prevRelativeVolPerSet = Math.round(roundedPrevVol / safeSets);

      const efficiencyDeltaPct =
        prevRelativeVolPerSet > 0
          ? Number(
              (
                ((relativeVolPerSet - prevRelativeVolPerSet) / prevRelativeVolPerSet) *
                100
              ).toFixed(1)
            )
          : 0;

      const bodyWeightRatio = Number((relativeVolPerSet / athleteWeightKg).toFixed(2));
      const bio = classifySessionBiomechanics(
        relativeVolPerSet,
        safeSets,
        efficiencyDeltaPct
      );

      return {
        id: `active-${group.dayName}`,
        sessionLabel: group.dayName,
        dayName: group.dayName,
        subtitle: group.muscleSummary || `Sesión ${group.dayName}`,
        dateStr: group.lastExecutedDate || undefined,
        totalVolumeKg: roundedTotalVol,
        prevTotalVolumeKg: roundedPrevVol,
        totalSets: safeSets,
        exercisesCount: group.rows.length,
        relativeVolumePerSetKg: relativeVolPerSet,
        prevRelativeVolumePerSetKg: prevRelativeVolPerSet,
        efficiencyDeltaPct,
        bodyWeightRatio,
        ...bio,
      };
    });
  }, [comparativeGroups, selectedDayFilter, setsLookup, athleteWeightKg]);

  // 2. Filas calculadas desde el Historial de Sesiones Completadas
  const historySessionRows = useMemo<SessionRelativeVolumeRow[]>(() => {
    const sorted = [...history]
      .filter((w) => (w.totalVolumeKg || 0) > 0)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);

    return sorted.map((w, idx) => {
      const setsFromSummary = (w.exercisesSummary || []).reduce(
        (acc, ex) => acc + (ex.sets || 3),
        0
      );
      const safeSets = Math.max(1, w.completedSetsCount || setsFromSummary || 12);
      const totalVol = Math.round(w.totalVolumeKg || 0);
      const relativeVolPerSet = Math.round(totalVol / safeSets);

      const olderWorkout = sorted[idx + 1];
      const prevSets = olderWorkout
        ? Math.max(1, olderWorkout.completedSetsCount || 12)
        : safeSets;
      const prevRelativeVol = olderWorkout
        ? Math.round((olderWorkout.totalVolumeKg || totalVol) / prevSets)
        : relativeVolPerSet;

      const deltaPct =
        prevRelativeVol > 0
          ? Number(
              (((relativeVolPerSet - prevRelativeVol) / prevRelativeVol) * 100).toFixed(1)
            )
          : 0;

      const bodyWeightRatio = Number((relativeVolPerSet / athleteWeightKg).toFixed(2));
      const bio = classifySessionBiomechanics(relativeVolPerSet, safeSets, deltaPct);
      const displayDate = formatDisplayDateDDMMYYYY(w.date);

      return {
        id: w.id || `hist-${idx}`,
        sessionLabel: displayDate,
        dayName: w.routineTitle || 'Sesión Completada',
        subtitle: w.routineTitle || 'Entrenamiento Registrado',
        dateStr: w.date,
        totalVolumeKg: totalVol,
        prevTotalVolumeKg: olderWorkout ? Math.round(olderWorkout.totalVolumeKg) : totalVol,
        totalSets: safeSets,
        exercisesCount: w.exercisesSummary?.length || 0,
        relativeVolumePerSetKg: relativeVolPerSet,
        prevRelativeVolumePerSetKg: prevRelativeVol,
        efficiencyDeltaPct: deltaPct,
        bodyWeightRatio,
        ...bio,
      };
    });
  }, [history, athleteWeightKg]);

  const displayedRows =
    sourceMode === 'active_plan' && activePlanSessionRows.length > 0
      ? activePlanSessionRows
      : historySessionRows.length > 0
      ? historySessionRows
      : activePlanSessionRows;

  // Resumen global de eficiencia y fatiga
  const globalMetrics = useMemo(() => {
    if (displayedRows.length === 0) {
      return {
        totalTonnageKg: 0,
        totalSets: 0,
        avgRelativeVolKg: 0,
        avgFatiguePct: 0,
        mostEfficientSession: null as SessionRelativeVolumeRow | null,
      };
    }

    const totalTonnageKg = displayedRows.reduce((acc, r) => acc + r.totalVolumeKg, 0);
    const totalSets = displayedRows.reduce((acc, r) => acc + r.totalSets, 0);
    const avgRelativeVolKg = totalSets > 0 ? Math.round(totalTonnageKg / totalSets) : 0;
    const avgFatiguePct = Math.round(
      displayedRows.reduce((acc, r) => acc + r.fatigueScorePct, 0) / displayedRows.length
    );
    const mostEfficientSession = displayedRows.reduce(
      (best, curr) =>
        curr.relativeVolumePerSetKg > best.relativeVolumePerSetKg ? curr : best,
      displayedRows[0]
    );

    return {
      totalTonnageKg,
      totalSets,
      avgRelativeVolKg,
      avgFatiguePct,
      mostEfficientSession,
    };
  }, [displayedRows]);

  return (
    <section className="p-6 sm:p-8 rounded-3xl bg-white/5 backdrop-blur-xl border border-white/10 shadow-2xl space-y-6 font-sans relative overflow-hidden">
      {/* Iluminación ambiental sutil */}
      <div className="pointer-events-none absolute -top-24 right-1/4 w-72 h-72 rounded-full bg-cyan-500/10 blur-3xl" />

      {/* Cabecera del Módulo */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/70 pb-5">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="p-3 rounded-xl bg-cyan-500/15 border border-cyan-500/35 text-cyan-400 shrink-0 shadow-lg shadow-cyan-500/10">
            <Gauge className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                Volumen Relativo por Sesión &amp; Eficiencia Neuromuscular
              </h3>
              <span className="text-xs font-semibold text-cyan-400 tabular-nums">
                · Tonelaje Total ÷ Nº de Series
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Mide cuántos kilogramos efectivos movilizas por cada serie realizada para optimizar tu densidad de fuerza y controlar la fatiga del sistema nervioso central (SNC).
            </p>
          </div>
        </div>

        {/* Selector de Fuente (Rutina Activa por Día vs Historial de Sesiones) */}
        <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800 self-start lg:self-auto">
          <button
            type="button"
            onClick={() => setSourceMode('active_plan')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              sourceMode === 'active_plan'
                ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sesiones Rutina Activa ({activePlanSessionRows.length})
          </button>
          <button
            type="button"
            onClick={() => setSourceMode('history_logs')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
              sourceMode === 'history_logs'
                ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Historial Completado ({historySessionRows.length})
          </button>
        </div>
      </div>

      {/* Cinta de 4 KPIs Ejecutivos de Eficiencia y Fatiga */}
      <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs tabular-nums">
        {/* KPI 1: Volumen Relativo Promedio */}
        <div className="p-4 rounded-xl bg-slate-900/50 border border-cyan-500/35 flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300/90 block">
              Volumen Relativo Medio
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black text-cyan-400">
                {globalMetrics.avgRelativeVolKg.toLocaleString('es-CL')}
              </span>
              <span className="text-xs font-bold text-slate-300">kg / serie</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              Fórmula: {globalMetrics.totalTonnageKg.toLocaleString('es-CL')} kg ÷ {globalMetrics.totalSets} series
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-400/30 flex items-center justify-center text-cyan-400 shrink-0">
            <Zap className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 2: Tonelaje Total Movilizado */}
        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
              Tonelaje Total Evaluado
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black text-white">
                {(globalMetrics.totalTonnageKg / 1000).toFixed(2)}
              </span>
              <span className="text-xs font-bold text-emerald-400">t</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              {globalMetrics.totalTonnageKg.toLocaleString('es-CL')} kg acumulados
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-300 shrink-0">
            <Dumbbell className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 3: Volumen de Series Efectivas */}
        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800/80 flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
              Series Efectivas Totales
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black text-emerald-400">
                {globalMetrics.totalSets}
              </span>
              <span className="text-xs font-bold text-slate-300">series</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              En {displayedRows.length} {displayedRows.length === 1 ? 'sesión' : 'sesiones'} analizadas
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        {/* KPI 4: Índice de Fatiga Neuromuscular Promedio */}
        <div className="p-4 rounded-xl bg-slate-900/50 border border-amber-500/30 flex items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/90 block">
              Fatiga Neuromuscular Media
            </span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span
                className={`text-2xl font-black ${
                  globalMetrics.avgFatiguePct >= 75
                    ? 'text-amber-400'
                    : globalMetrics.avgFatiguePct >= 42
                    ? 'text-emerald-400'
                    : 'text-blue-400'
                }`}
              >
                {globalMetrics.avgFatiguePct}%
              </span>
              <span className="text-xs font-semibold text-slate-300">impacto SNC</span>
            </div>
            <span className="text-[11px] text-slate-400 block mt-0.5">
              {globalMetrics.mostEfficientSession
                ? `Pico: ${globalMetrics.mostEfficientSession.sessionLabel} (${globalMetrics.mostEfficientSession.relativeVolumePerSetKg} kg/s)`
                : 'Sin sesiones activas'}
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0">
            <Cpu className="w-5 h-5" />
          </div>
        </div>
      </div>

      {displayedRows.length === 0 ? (
        <div className="p-6 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center space-y-2">
          <p className="text-xs sm:text-sm text-slate-300 font-semibold">
            No hay sesiones disponibles para calcular el volumen relativo por serie.
          </p>
          <p className="text-xs text-slate-500">
            Configura una rutina activa o registra una sesión de entrenamiento para visualizar tu eficiencia mecánica y fatiga neuromuscular.
          </p>
        </div>
      ) : (
        <div className="relative z-10 space-y-5">
          {/* Gráfico Comparativo de Eficiencia por Sesión (kg / serie) */}
          <div className="p-4 sm:p-5 rounded-xl bg-slate-900/40 border border-slate-800/80 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-white">
                Comparativa de Eficiencia Mecánica por Sesión (kg movilizados por cada serie)
              </span>
              <div className="flex items-center gap-3 text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-emerald-400 inline-block" />
                  <span>Eficiencia Óptima</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />
                  <span>Demanda SNC Alta</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" />
                  <span>Carga Metabólica</span>
                </span>
              </div>
            </div>

            <div className="w-full h-56 sm:h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={displayedRows}
                  margin={{ top: 10, right: 12, left: -12, bottom: 2 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="rgba(148, 163, 184, 0.1)"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="sessionLabel"
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  />
                  <YAxis
                    stroke="#64748B"
                    tick={{ fill: '#94A3B8', fontSize: 11, fontWeight: 600 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v}kg`}
                  />
                  <Tooltip
                    content={<CustomRelativeVolTooltip />}
                    cursor={{ fill: 'rgba(30, 41, 59, 0.45)' }}
                  />
                  <Bar dataKey="relativeVolumePerSetKg" radius={[8, 8, 0, 0]} maxBarSize={54}>
                    {displayedRows.map((entry) => (
                      <Cell
                        key={entry.id}
                        fill={
                          entry.fatigueLevel === 'high'
                            ? '#F59E0B'
                            : entry.fatigueLevel === 'optimal'
                            ? '#10B981'
                            : '#3B82F6'
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Tarjetas / Filas Detalladas por Sesión */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {displayedRows.map((row) => {
              const isHigh = row.fatigueLevel === 'high';
              const isOptimal = row.fatigueLevel === 'optimal';

              return (
                <div
                  key={row.id}
                  className="bg-slate-900/40 border border-slate-800/80 hover:border-slate-700/80 rounded-xl p-5 shadow-lg space-y-4 transition-all"
                >
                  {/* Cabecera de la Sesión */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm sm:text-base font-bold text-white uppercase tracking-tight">
                          {row.sessionLabel}
                        </h4>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                            isOptimal
                              ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                              : isHigh
                              ? 'bg-amber-950/60 text-amber-300 border-amber-800/40'
                              : 'bg-blue-950/60 text-blue-400 border-blue-800/40'
                          }`}
                        >
                          {row.efficiencyLabel}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {row.subtitle} · {row.exercisesCount} ejercicios
                      </p>
                    </div>

                    {/* Variación de Eficiencia vs Sesión Previa */}
                    <span
                      className={`shrink-0 text-xs tabular-nums ${
                        row.efficiencyDeltaPct > 0
                          ? 'text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded-md font-semibold'
                          : row.efficiencyDeltaPct < 0
                          ? 'text-rose-400 bg-rose-950/30 px-2 py-0.5 rounded-md font-semibold'
                          : 'text-slate-400 bg-slate-800/40 px-2 py-0.5 rounded-md font-medium'
                      }`}
                    >
                      {row.efficiencyDeltaPct > 0
                        ? `+${row.efficiencyDeltaPct}% ef.`
                        : `${row.efficiencyDeltaPct}% ef.`}
                    </span>
                  </div>

                  {/* Ecuación Visual: Tonelaje Total ÷ Series = Volumen Relativo */}
                  <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/60 text-xs tabular-nums">
                    <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/70">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold block">
                        Tonelaje Sesión
                      </span>
                      <span className="text-sm font-bold text-white mt-0.5 block">
                        {row.totalVolumeKg.toLocaleString('es-CL')} kg
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        {(row.totalVolumeKg / 1000).toFixed(2)} t totales
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/70">
                      <span className="text-[10px] text-slate-500 uppercase font-semibold block">
                        Nº de Series
                      </span>
                      <span className="text-sm font-bold text-slate-200 mt-0.5 block">
                        {row.totalSets} series
                      </span>
                      <span className="text-[10px] text-slate-500 block">
                        Ant: {row.prevRelativeVolumePerSetKg} kg/s
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-500/40">
                      <span className="text-[10px] text-cyan-300 uppercase font-bold block">
                        Vol. Relativo
                      </span>
                      <span className="text-sm sm:text-base font-black text-cyan-400 mt-0.5 block">
                        {row.relativeVolumePerSetKg} <span className="text-[10px]">kg/serie</span>
                      </span>
                      <span className="text-[10px] text-slate-300 block">
                        {row.bodyWeightRatio}x peso corp.
                      </span>
                    </div>
                  </div>

                  {/* Medidor de Fatiga Neuromuscular (SNC) */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="text-slate-400 font-medium inline-flex items-center gap-1.5">
                        <Activity
                          className={`w-3.5 h-3.5 ${
                            isHigh
                              ? 'text-amber-400'
                              : isOptimal
                              ? 'text-emerald-400'
                              : 'text-blue-400'
                          }`}
                        />
                        <span>Nivel de Fatiga Neuromuscular:</span>
                      </span>
                      <span
                        className={`font-bold ${
                          isHigh
                            ? 'text-amber-400'
                            : isOptimal
                            ? 'text-emerald-400'
                            : 'text-blue-400'
                        }`}
                      >
                        {row.fatigueLabel} ({row.fatigueScorePct}%)
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isHigh
                            ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                            : isOptimal
                            ? 'bg-gradient-to-r from-emerald-500 to-cyan-400'
                            : 'bg-gradient-to-r from-blue-500 to-cyan-400'
                        }`}
                        style={{ width: `${row.fatigueScorePct}%` }}
                      />
                    </div>

                    <p className="text-[11px] text-slate-400 leading-relaxed pt-0.5">
                      {row.recommendation}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
