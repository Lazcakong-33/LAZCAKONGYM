import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Gauge,
  Info,
  ShieldCheck,
  Trophy,
  Zap,
} from 'lucide-react';
import {
  CompletedWorkout,
  PersonalRecord,
  Routine,
} from '../types';
import {
  DailyComparativeGroup,
  formatDisplayDateDDMMYYYY,
} from '../utils/exportReport';
import { normalizeText } from '../utils/workoutAnalyticsEngine';
import { ElitePersonalRecordItem } from '../utils/elitePerformanceAnalytics';
import { getChileLocalDateKey, getChileWeekdayIndex, resolveWorkoutChileDateKey } from '../utils/calorieCalculator';

interface ExecutiveBiomechanicalHudProps {
  comparativeGroups?: DailyComparativeGroup[];
  routines?: Routine[];
  history?: CompletedWorkout[];
  prs?: Record<string, PersonalRecord>;
  latestVerifiedPR?: ElitePersonalRecordItem | null;
  cnsStatus?: {
    systemicFatiguePct: number;
    recoveryPct: number;
    label: string;
    detail: string;
    tone: 'emerald' | 'blue' | 'amber';
  };
}

export const ExecutiveBiomechanicalHud: React.FC<ExecutiveBiomechanicalHudProps> = ({
  comparativeGroups = [],
  routines = [],
  history = [],
  prs = {},
  latestVerifiedPR = null,
}) => {
  const [showFormulaInfo, setShowFormulaInfo] = useState<boolean>(false);

  const setsByEx = useMemo(() => {
    const map = new Map<string, number>();
    routines.forEach((r) => {
      (r.exercises || []).forEach((ex) => {
        const safeSets = Math.min(6, Math.max(1, Number(ex.defaultSets) || 3));
        map.set(`${normalizeText(r.dayName)}::${normalizeText(ex.name)}`, safeSets);
        map.set(normalizeText(ex.name), safeSets);
      });
    });
    return map;
  }, [routines]);

  const hudMetrics = useMemo(() => {
    let weeklyTotalVolumeKg = 0;
    let weeklyPrevVolumeKg = 0;
    let weeklyTotalSets = 0;

    const sessionSummaries: { volKg: number; avg1RM: number; sets: number }[] = [];

    const todayKeyChile = getChileLocalDateKey(new Date());
    const todayIdxChile = getChileWeekdayIndex(todayKeyChile);
    const [yC, mC, dC] = todayKeyChile.split('-').map(Number);
    const mondayUtc = new Date(Date.UTC(yC || 2026, (mC || 11) - 1, dC || 19, 12, 0, 0));
    mondayUtc.setUTCDate(mondayUtc.getUTCDate() + (todayIdxChile === 0 ? -6 : 1 - todayIdxChile));
    const sundayUtc = new Date(mondayUtc);
    sundayUtc.setUTCDate(mondayUtc.getUTCDate() + 6);
    const mondayKey = mondayUtc.toISOString().slice(0, 10);
    const sundayKey = sundayUtc.toISOString().slice(0, 10);

    const sortedFinishedHistory = [...history]
      .filter((w) => w && w.isFinished !== false && (w.completedSetsCount || 0) > 0)
      .sort((a, b) => (b.startTime || new Date(b.date).getTime()) - (a.startTime || new Date(a.date).getTime()));

    const currentWeekFinished = sortedFinishedHistory.filter((w) => {
      const wKey = resolveWorkoutChileDateKey(w) || getChileLocalDateKey(w.date);
      return Boolean(wKey) && wKey >= mondayKey && wKey <= sundayKey;
    });

    if (sortedFinishedHistory.length > 0) {
      const activeHistScope =
        currentWeekFinished.length > 0 ? currentWeekFinished : sortedFinishedHistory.slice(0, 5);

      activeHistScope.forEach((w) => {
        const sets =
          w.completedSetsCount ||
          (w.exercisesSummary || []).reduce((acc, ex) => acc + (ex.sets || 0), 0);
        const volKg = Math.round(w.totalVolumeKg || 0);
        weeklyTotalVolumeKg += volKg;
        weeklyTotalSets += sets;
        if (w.previousSessionComparison?.prevVolumeKg) {
          weeklyPrevVolumeKg += w.previousSessionComparison.prevVolumeKg;
        }
      });

      for (const w of sortedFinishedHistory) {
        if (sessionSummaries.length >= 3) break;
        const ex1RMs = (w.exercisesSummary || [])
          .map(
            (ex) =>
              ex.estimated1RM ||
              (ex.maxWeight > 0
                ? Math.round(ex.maxWeight * (1 + (ex.maxReps || 10) / 30))
                : 0)
          )
          .filter((v) => v > 0);
        const avg1RM =
          ex1RMs.length > 0
            ? Math.round(ex1RMs.reduce((a, b) => a + b, 0) / ex1RMs.length)
            : 0;
        const sets =
          w.completedSetsCount ||
          (w.exercisesSummary || []).reduce((acc, ex) => acc + (ex.sets || 0), 0) ||
          1;
        if ((w.totalVolumeKg || 0) > 0 && avg1RM > 0) {
          sessionSummaries.push({
            volKg: Math.round(w.totalVolumeKg || 0),
            avg1RM,
            sets,
          });
        }
      }
    } else {
      comparativeGroups.forEach((group) => {
        let groupVolKg = 0;
        let groupPrevVolKg = 0;
        let groupSets = 0;
        const group1RMs: number[] = [];

        group.rows.forEach((row) => {
          const specKey = `${normalizeText(group.dayName)}::${normalizeText(row.name)}`;
          const sets =
            setsByEx.get(specKey) || setsByEx.get(normalizeText(row.name)) || 3;
          const currReps = row.currReps > 0 ? row.currReps : 10;
          const prevReps = row.prevReps > 0 ? row.prevReps : currReps;

          groupVolKg += row.currWeight * currReps * sets;
          groupPrevVolKg += row.prevWeight * prevReps * sets;
          groupSets += sets;

          if (row.curr1RM > 0) {
            group1RMs.push(row.curr1RM);
          }
        });

        weeklyTotalVolumeKg += groupVolKg;
        weeklyPrevVolumeKg += groupPrevVolKg;
        weeklyTotalSets += groupSets;

        if (groupVolKg > 0 && group1RMs.length > 0) {
          const avgGroup1RM = Math.round(
            group1RMs.reduce((a, b) => a + b, 0) / group1RMs.length
          );
          sessionSummaries.push({
            volKg: Math.round(groupVolKg),
            avg1RM: Math.max(1, avgGroup1RM),
            sets: Math.max(1, groupSets),
          });
        }
      });
    }

    const avgLoadPerSet =
      weeklyTotalSets > 0 ? Math.round(weeklyTotalVolumeKg / weeklyTotalSets) : 0;
    const prevLoadPerSet =
      weeklyTotalSets > 0 && weeklyPrevVolumeKg > 0
        ? Math.round(weeklyPrevVolumeKg / weeklyTotalSets)
        : 0;
    const loadDeltaPct =
      prevLoadPerSet > 0
        ? Number((((avgLoadPerSet - prevLoadPerSet) / prevLoadPerSet) * 100).toFixed(1))
        : null;

    // Índice de Carga Relativa (Volumen últimas 3 sesiones ÷ 1RM medio estimado)
    const last3 = sessionSummaries.slice(0, 3);
    const volLast3Kg = last3.reduce((acc, s) => acc + s.volKg, 0);
    const avg1RMGlobal =
      last3.length > 0
        ? Math.round(last3.reduce((acc, s) => acc + s.avg1RM, 0) / last3.length)
        : 0;
    const relativeLoadRatio =
      avg1RMGlobal > 0 ? Number((volLast3Kg / avg1RMGlobal).toFixed(1)) : 0;

    let loadLevel: 'low' | 'moderate' | 'high' | 'none' = 'none';
    let loadLabel = 'Sin datos suficientes';
    let loadSubtext = 'Registra sesiones con carga externa';

    if (relativeLoadRatio > 0) {
      if (relativeLoadRatio > 310) {
        loadLevel = 'high';
        loadLabel = 'Carga Elevada';
        loadSubtext = 'Volumen alto acumulado (>310x)';
      } else if (relativeLoadRatio > 220) {
        loadLevel = 'moderate';
        loadLabel = 'Carga Moderada-Alta';
        loadSubtext = 'Tendencia progresiva (221x–310x)';
      } else {
        loadLevel = 'low';
        loadLabel = 'Carga Controlada';
        loadSubtext = 'Tendencia sostenible (≤220x)';
      }
    }

    // Marca destacada reciente (unificada si se pasó latestVerifiedPR)
    let featuredMark: {
      exerciseName: string;
      curr1RM: number;
      currWeight: number;
      currReps: number;
      dateLabel: string;
    } | null = null;

    if (latestVerifiedPR) {
      featuredMark = {
        exerciseName: latestVerifiedPR.exerciseName,
        curr1RM: latestVerifiedPR.best1RM,
        currWeight: latestVerifiedPR.bestWeightKg,
        currReps: latestVerifiedPR.bestWeightReps,
        dateLabel: formatDisplayDateDDMMYYYY(latestVerifiedPR.bestWeightDate),
      };
    } else {
      const prList = Object.values(prs).sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
      if (prList.length > 0) {
        const top = prList[0];
        featuredMark = {
          exerciseName: top.exerciseName,
          curr1RM: top.estimated1RM,
          currWeight: top.maxWeight,
          currReps: top.repsAtMaxWeight,
          dateLabel: formatDisplayDateDDMMYYYY(top.date),
        };
      }
    }

    return {
      loadLevel,
      loadLabel,
      loadSubtext,
      avgLoadPerSet,
      loadDeltaPct,
      weeklyTotalSets,
      relativeLoadRatio,
      avg1RMGlobal,
      volLast3Kg,
      featuredMark,
    };
  }, [comparativeGroups, routines, history, prs, setsByEx, latestVerifiedPR]);

  return (
    <section
      aria-label="Indicadores Estimados de Carga y Tendencias"
      className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl space-y-4 font-sans"
    >
      {/* Cabecera unificada */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#303030] pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Gauge className="w-4 h-4 text-accent-text shrink-0" />
          <span className="text-xs sm:text-sm font-black uppercase tracking-wider text-white truncate">
            Indicadores de Carga y Tendencias
          </span>
        </div>

        <button
          type="button"
          onClick={() => setShowFormulaInfo((prev) => !prev)}
          className="min-h-[36px] px-2.5 py-1 rounded-xl bg-[#090909] border border-[#303030] hover:border-accent/50 text-[11px] font-bold text-accent-text inline-flex items-center gap-1.5 cursor-pointer"
        >
          <Info className="w-3.5 h-3.5" />
          <span>Fórmula y limitaciones</span>
          {showFormulaInfo ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      </div>

      {/* Panel explicativo accesible de fórmulas y alcance no clínico */}
      {showFormulaInfo && (
        <div className="p-3.5 sm:p-4 rounded-2xl bg-[#090909] border border-accent/30 text-xs text-neutral-300 space-y-2 animate-in fade-in duration-150">
          <div className="font-bold text-white flex items-center gap-1.5">
            <Info className="w-4 h-4 text-accent-text shrink-0" />
            <span>Cómo se calculan estas estimaciones y sus límites</span>
          </div>
          <ul className="space-y-1.5 text-[11px] sm:text-xs text-neutral-400 list-disc pl-4">
            <li>
              <strong className="text-neutral-200">Carga Media por Serie:</strong> Volumen total de carga externa dividido entre las series completadas ({hudMetrics.weeklyTotalSets} series recientes).
            </li>
            <li>
              <strong className="text-neutral-200">Índice Volumen / 1RM:</strong> Relación matemática entre el tonelaje acumulado de tus últimas 3 sesiones ({hudMetrics.volLast3Kg.toLocaleString()} kg) y el 1RM promedio estimado (~{hudMetrics.avg1RMGlobal} kg).
            </li>
            <li>
              <strong className="text-neutral-200">Limitaciones importantes:</strong> Estos valores son referencias matemáticas de carga mecánica externa. <strong>No constituyen diagnósticos del sistema nervioso central, sobreentrenamiento ni riesgo médico de lesión.</strong> Evalúa siempre tu descanso, estrés, técnica y sensación subjetiva (RPE).
            </li>
          </ul>
        </div>
      )}

      {/* Cuadrícula Adaptativa de 4 Indicadores (2x2 móvil, 4 en desktop) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
        {/* 1. Tendencia de Carga Estimada */}
        <div
          className={`p-3.5 rounded-2xl border flex flex-col justify-between gap-2 bg-[#090909] ${
            hudMetrics.loadLevel === 'high'
              ? 'border-rose-500/40'
              : hudMetrics.loadLevel === 'moderate'
              ? 'border-amber-500/40'
              : 'border-[#303030]'
          }`}
        >
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-400 truncate">
              Tendencia de Carga
            </span>
            {hudMetrics.loadLevel === 'high' || hudMetrics.loadLevel === 'moderate' ? (
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  hudMetrics.loadLevel === 'high' ? 'text-rose-400' : 'text-amber-400'
                }`}
              />
            ) : (
              <ShieldCheck className="w-4 h-4 text-accent-text shrink-0" />
            )}
          </div>

          <div>
            <div
              className={`text-sm sm:text-base font-black tracking-tight truncate ${
                hudMetrics.loadLevel === 'high'
                  ? 'text-rose-400'
                  : hudMetrics.loadLevel === 'moderate'
                  ? 'text-amber-400'
                  : hudMetrics.loadLevel === 'low'
                  ? 'text-accent-text'
                  : 'text-neutral-300'
              }`}
            >
              {hudMetrics.loadLabel}
            </div>
            <span className="text-[11px] text-neutral-400 block mt-0.5 truncate">
              {hudMetrics.loadSubtext}
            </span>
          </div>
        </div>

        {/* 2. Carga Media por Serie (kg/serie) */}
        <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-400 truncate">
              Carga Media / Serie
            </span>
            <Zap className="w-4 h-4 text-accent-text shrink-0" />
          </div>

          <div>
            <div className="flex items-baseline gap-1">
              <span className="text-lg sm:text-xl font-black text-accent-text">
                {hudMetrics.avgLoadPerSet > 0
                  ? hudMetrics.avgLoadPerSet.toLocaleString('es-CL')
                  : '—'}
              </span>
              <span className="text-xs font-bold text-neutral-300">kg/serie</span>
            </div>
            <div className="text-[11px] mt-0.5 truncate">
              {hudMetrics.loadDeltaPct !== null ? (
                <span
                  className={`font-semibold ${
                    hudMetrics.loadDeltaPct >= 0 ? 'text-accent-text' : 'text-rose-400'
                  }`}
                >
                  {hudMetrics.loadDeltaPct >= 0
                    ? `+${hudMetrics.loadDeltaPct}%`
                    : `${hudMetrics.loadDeltaPct}%`}{' '}
                  vs referencia previa
                </span>
              ) : (
                <span className="text-neutral-500">
                  {hudMetrics.weeklyTotalSets} serie(s) recientes
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 3. Índice Volumen / 1RM */}
        <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-neutral-400 truncate">
              Índice Vol. / 1RM
            </span>
            <Activity className="w-4 h-4 text-accent-text shrink-0" />
          </div>

          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg sm:text-xl font-black text-white">
                {hudMetrics.relativeLoadRatio > 0 ? `${hudMetrics.relativeLoadRatio}x` : '—'}
              </span>
              <span className="text-[11px] font-semibold text-neutral-400">
                estimado
              </span>
            </div>
            <span className="text-[11px] text-neutral-400 block mt-0.5 truncate">
              {hudMetrics.relativeLoadRatio > 310
                ? 'Volumen alto · Considerar descarga'
                : hudMetrics.relativeLoadRatio > 220
                ? 'Rango medio-alto (221x–310x)'
                : hudMetrics.relativeLoadRatio > 0
                ? 'Rango moderado (≤220x)'
                : 'Sin historial suficiente'}
            </span>
          </div>
        </div>

        {/* 4. Mejor Marca Destacada */}
        <div className="p-3.5 rounded-2xl bg-[#090909] border border-accent/30 flex flex-col justify-between gap-2">
          <div className="flex items-center justify-between gap-1.5">
            <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-accent-text truncate">
              Marca Destacada
            </span>
            <Trophy className="w-4 h-4 text-accent-text shrink-0" />
          </div>

          {hudMetrics.featuredMark ? (
            <div>
              <div className="flex items-baseline justify-between gap-1.5">
                <span className="text-sm sm:text-base font-black text-white truncate">
                  {hudMetrics.featuredMark.currWeight} kg × {hudMetrics.featuredMark.currReps}r
                </span>
                <span className="text-[11px] font-bold text-accent-text shrink-0">
                  ~{hudMetrics.featuredMark.curr1RM}kg 1RM
                </span>
              </div>
              <span
                className="text-[11px] text-neutral-400 block mt-0.5 truncate"
                title={hudMetrics.featuredMark.exerciseName}
              >
                {hudMetrics.featuredMark.exerciseName} · {hudMetrics.featuredMark.dateLabel}
              </span>
            </div>
          ) : (
            <div>
              <span className="text-sm font-bold text-neutral-300 block">
                Sin marcas aún
              </span>
              <span className="text-[11px] text-neutral-500 block mt-0.5">
                Completa una sesión con carga
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
