import React, { useMemo, useState, useEffect } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Dumbbell,
} from 'lucide-react';
import {
  CompletedWorkout,
  PersonalRecord,
  Routine,
} from '../types';
import { DailyComparativeGroup } from '../utils/exportReport';
import { normalizeText } from '../utils/workoutAnalyticsEngine';
import { parseLocalDateTimestamp, calculateEstimated1RM } from '../utils/elitePerformanceAnalytics';

export interface Monthly1RMPoint {
  monthKey: string;
  monthLabel: string;
  fullMonthName: string;
  estimated1RM: number;
  maxWeight: number;
  reps: number;
  volumeKg: number;
  sessionsInMonth: number;
  deltaFromPrevKg: number | null;
  deltaFromPrevPct: number | null;
  isPRPoint: boolean;
}

interface ExerciseOption {
  key: string;
  name: string;
  muscleGroup: string;
  currWeight: number;
  currReps: number;
  curr1RM: number;
  monthsCount: number;
}

interface OneRMProgressionChartProps {
  comparativeGroups?: DailyComparativeGroup[];
  history?: CompletedWorkout[];
  prs?: Record<string, PersonalRecord>;
  routines?: Routine[];
}

const MONTH_NAMES_SHORT = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
];

const MONTH_NAMES_FULL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const CustomHistoricalTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) return null;
  const data: Monthly1RMPoint = payload[0].payload;

  return (
    <div className="bg-[#090909] border border-[#CCFF00]/60 rounded-xl p-2.5 sm:p-3 shadow-2xl text-xs space-y-1.5 min-w-[180px] max-w-[230px] sm:max-w-[260px]">
      <div className="flex items-center justify-between gap-3 border-b border-[#303030] pb-1.5">
        <span className="font-bold text-white">{data.fullMonthName}</span>
        {data.isPRPoint && (
          <span className="text-[10px] font-black text-[#CCFF00]">★ Máximo Histórico</span>
        )}
      </div>

      <div className="space-y-1 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-neutral-400">Marca Real Máx.:</span>
          <span className="font-bold text-white">
            {data.maxWeight} kg × {data.reps}r
          </span>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span className="text-neutral-400">1RM Estimado:</span>
          <span className="font-black text-[#CCFF00]">~{data.estimated1RM} kg</span>
        </div>

        <div className="flex items-center justify-between gap-4 text-[11px]">
          <span className="text-neutral-400">Registros en mes:</span>
          <span className="text-neutral-300">{data.sessionsInMonth}</span>
        </div>

        {data.deltaFromPrevKg !== null && (
          <div className="flex items-center justify-between gap-4 pt-1 border-t border-[#303030] text-[11px]">
            <span className="text-neutral-400">Vs mes previo:</span>
            <span
              className={`font-bold ${
                data.deltaFromPrevKg > 0
                  ? 'text-[#CCFF00]'
                  : data.deltaFromPrevKg < 0
                  ? 'text-rose-400'
                  : 'text-neutral-400'
              }`}
            >
              {data.deltaFromPrevKg > 0 ? `+${data.deltaFromPrevKg}` : data.deltaFromPrevKg} kg
              {data.deltaFromPrevPct !== null &&
                ` (${data.deltaFromPrevPct > 0 ? '+' : ''}${data.deltaFromPrevPct}%)`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export const OneRMProgressionChart: React.FC<OneRMProgressionChartProps> = ({
  history = [],
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [chartMetric, setChartMetric] = useState<'maxWeight' | 'estimated1RM'>('maxWeight');

  // Construir catálogo y series mensuales EXCLUSIVAMENTE desde el historial real del atleta (sin interpolar ni inventar meses)
  const { exerciseCatalog, realMonthlyDataByExercise } = useMemo(() => {
    const monthlyMap = new Map<
      string,
      Map<
        string,
        {
          year: number;
          monthIdx: number;
          max1RM: number;
          maxWeight: number;
          reps: number;
          volumeKg: number;
          sessionsInMonth: number;
          name: string;
          muscleGroup: string;
        }
      >
    >();

    const finished = (Array.isArray(history) ? history : []).filter(
      (w) => w && w.isFinished !== false && (w.completedSetsCount || 0) > 0
    );

    finished.forEach((w) => {
      const ts = parseLocalDateTimestamp(w.date, w.startTime);
      if (ts <= 0) return;
      const d = new Date(ts);
      const year = d.getFullYear();
      const monthIdx = d.getMonth();
      const mKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;

      (w.exercisesSummary || []).forEach((ex) => {
        const key = normalizeText(ex.name);
        if (!key) return;
        const wKg = Math.max(0, Number(ex.maxWeight) || 0);
        const r = Math.max(1, Number(ex.maxReps) || 1);
        if (wKg <= 0) return;

        const est1RM =
          ex.estimated1RM && ex.estimated1RM > 0
            ? Math.round(ex.estimated1RM)
            : calculateEstimated1RM(wKg, r);
        const vol =
          typeof ex.volumeKg === 'number' && ex.volumeKg >= 0
            ? Math.round(ex.volumeKg)
            : Math.round(wKg * r * (ex.sets || 1));

        if (!monthlyMap.has(key)) {
          monthlyMap.set(key, new Map());
        }
        const exMonths = monthlyMap.get(key)!;
        const prev = exMonths.get(mKey);
        if (!prev) {
          exMonths.set(mKey, {
            year,
            monthIdx,
            max1RM: est1RM,
            maxWeight: wKg,
            reps: r,
            volumeKg: vol,
            sessionsInMonth: 1,
            name: ex.name,
            muscleGroup: ex.muscleGroup || 'Fuerza',
          });
        } else {
          exMonths.set(mKey, {
            ...prev,
            max1RM: Math.max(prev.max1RM, est1RM),
            maxWeight: wKg > prev.maxWeight ? wKg : prev.maxWeight,
            reps: wKg > prev.maxWeight ? r : prev.reps,
            volumeKg: prev.volumeKg + vol,
            sessionsInMonth: prev.sessionsInMonth + 1,
          });
        }
      });
    });

    const catalog: ExerciseOption[] = [];
    monthlyMap.forEach((months, key) => {
      const sorted = Array.from(months.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      const latest = sorted[sorted.length - 1]?.[1];
      if (!latest) return;
      catalog.push({
        key,
        name: latest.name,
        muscleGroup: latest.muscleGroup,
        currWeight: latest.maxWeight,
        currReps: latest.reps,
        curr1RM: latest.max1RM,
        monthsCount: sorted.length,
      });
    });

    catalog.sort((a, b) => b.monthsCount - a.monthsCount || b.curr1RM - a.curr1RM);

    return { exerciseCatalog: catalog, realMonthlyDataByExercise: monthlyMap };
  }, [history]);

  const [selectedExKey, setSelectedExKey] = useState<string>(() => exerciseCatalog[0]?.key || '');

  useEffect(() => {
    if (
      exerciseCatalog.length > 0 &&
      !exerciseCatalog.some((item) => item.key === selectedExKey)
    ) {
      setSelectedExKey(exerciseCatalog[0].key);
    }
  }, [exerciseCatalog, selectedExKey]);

  const selectedExercise = useMemo(() => {
    return exerciseCatalog.find((item) => item.key === selectedExKey) || exerciseCatalog[0] || null;
  }, [exerciseCatalog, selectedExKey]);

  const monthlySeries = useMemo<Monthly1RMPoint[]>(() => {
    if (!selectedExercise) return [];
    const exMonths = realMonthlyDataByExercise.get(selectedExercise.key);
    if (!exMonths || exMonths.size === 0) return [];

    const sortedEntries = Array.from(exMonths.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const peak1RM = Math.max(...sortedEntries.map(([, v]) => v.max1RM), 0);

    return sortedEntries.map(([mKey, val], idx) => {
      const prevVal = idx > 0 ? sortedEntries[idx - 1][1] : null;
      const deltaKg = prevVal ? Number((val.max1RM - prevVal.max1RM).toFixed(1)) : null;
      const deltaPct =
        prevVal && prevVal.max1RM > 0 && deltaKg !== null
          ? Number(((deltaKg / prevVal.max1RM) * 100).toFixed(1))
          : null;

      return {
        monthKey: mKey,
        monthLabel: `${MONTH_NAMES_SHORT[val.monthIdx]} '${String(val.year).slice(-2)}`,
        fullMonthName: `${MONTH_NAMES_FULL[val.monthIdx]} ${val.year}`,
        estimated1RM: val.max1RM,
        maxWeight: val.maxWeight,
        reps: val.reps,
        volumeKg: val.volumeKg,
        sessionsInMonth: val.sessionsInMonth,
        deltaFromPrevKg: deltaKg,
        deltaFromPrevPct: deltaPct,
        isPRPoint: val.max1RM === peak1RM && peak1RM > 0,
      };
    });
  }, [selectedExercise, realMonthlyDataByExercise]);

  const progressionStats = useMemo(() => {
    if (monthlySeries.length === 0) return null;
    const first = monthlySeries[0];
    const last = monthlySeries[monthlySeries.length - 1];
    const peak1RM = Math.max(...monthlySeries.map((p) => p.estimated1RM));
    const peakWeight = Math.max(...monthlySeries.map((p) => p.maxWeight));
    const totalGainKg = monthlySeries.length >= 2 ? last.estimated1RM - first.estimated1RM : null;
    const totalGainPct =
      totalGainKg !== null && first.estimated1RM > 0
        ? Number(((totalGainKg / first.estimated1RM) * 100).toFixed(1))
        : null;

    return {
      initial1RM: first.estimated1RM,
      current1RM: last.estimated1RM,
      peak1RM,
      peakWeight,
      totalGainKg,
      totalGainPct,
      monthsCount: monthlySeries.length,
    };
  }, [monthlySeries]);

  return (
    <section
      aria-label="Progresión Histórica Mensual"
      className="bg-[#171717] border border-[#303030] rounded-2xl sm:rounded-3xl shadow-xl font-sans overflow-hidden"
    >
      {/* Cabecera colapsable para optimizar desplazamiento en celular */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#1b1b1b] transition-colors min-h-[64px]"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[#CCFF00]/15 border border-[#CCFF00]/30 flex items-center justify-center text-[#CCFF00] shrink-0">
            <Activity className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-bold text-[#CCFF00] uppercase tracking-wider">
              Todo el historial · Meses con registro real
            </div>
            <h3 className="text-sm sm:text-base font-black text-white tracking-tight truncate">
              PROGRESIÓN HISTÓRICA MENSUAL
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 text-xs font-bold text-[#CCFF00]">
          <span className="hidden sm:inline">{isExpanded ? 'Ocultar' : 'Ver historial'}</span>
          <div className="w-9 h-9 rounded-xl bg-[#090909] border border-[#303030] flex items-center justify-center text-neutral-300">
            {isExpanded ? (
              <ChevronUp className="w-4 h-4 text-[#CCFF00]" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div className="p-4 sm:p-6 border-t border-[#303030] space-y-4 bg-[#090909]/40">
          {exerciseCatalog.length === 0 || !selectedExercise ? (
            <div className="p-6 rounded-2xl bg-[#090909] border border-dashed border-[#303030] text-center space-y-2">
              <Dumbbell className="w-8 h-8 text-neutral-600 mx-auto" />
              <div className="text-xs font-bold text-neutral-300">
                Sin historial suficiente con carga externa
              </div>
              <p className="text-[11px] text-neutral-500 max-w-sm mx-auto">
                Cuando registres entrenamientos completados con peso externo, este módulo mostrará únicamente los meses reales con actividad sin interpolar puntos inexistentes.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <select
                  value={selectedExercise.key}
                  onChange={(e) => setSelectedExKey(e.target.value)}
                  aria-label="Seleccionar ejercicio histórico"
                  className="min-h-[44px] w-full sm:w-auto sm:min-w-[260px] bg-[#090909] border border-[#303030] text-white font-bold rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-[#CCFF00] cursor-pointer"
                >
                  {exerciseCatalog.map((ex) => (
                    <option key={ex.key} value={ex.key}>
                      {ex.name} ({ex.monthsCount} {ex.monthsCount === 1 ? 'mes' : 'meses'})
                    </option>
                  ))}
                </select>

                <div className="grid grid-cols-2 sm:inline-flex rounded-xl bg-[#090909] p-1 border border-[#303030]">
                  <button
                    type="button"
                    onClick={() => setChartMetric('maxWeight')}
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      chartMetric === 'maxWeight'
                        ? 'bg-[#171717] text-[#CCFF00]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    Marca Real (kg)
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMetric('estimated1RM')}
                    className={`min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                      chartMetric === 'estimated1RM'
                        ? 'bg-[#171717] text-[#CCFF00]'
                        : 'text-neutral-400 hover:text-white'
                    }`}
                  >
                    1RM Est. (Epley)
                  </button>
                </div>
              </div>

              {progressionStats && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs tabular-nums">
                  <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
                    <span className="text-[11px] text-neutral-400 block">Primer Mes (1RM est.)</span>
                    <span className="text-sm sm:text-base font-black text-white">
                      ~{progressionStats.initial1RM} kg
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
                    <span className="text-[11px] text-neutral-400 block">Último Mes (1RM est.)</span>
                    <span className="text-sm sm:text-base font-black text-[#CCFF00]">
                      ~{progressionStats.current1RM} kg
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
                    <span className="text-[11px] text-neutral-400 block">Máximo Real Histórico</span>
                    <span className="text-sm sm:text-base font-black text-white">
                      {progressionStats.peakWeight} kg
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-[#090909] border border-[#303030]">
                    <span className="text-[11px] text-neutral-400 block">Evolución Histórica</span>
                    {progressionStats.totalGainKg !== null ? (
                      <span
                        className={`text-sm sm:text-base font-black ${
                          progressionStats.totalGainKg >= 0 ? 'text-[#CCFF00]' : 'text-rose-400'
                        }`}
                      >
                        {progressionStats.totalGainKg >= 0
                          ? `+${progressionStats.totalGainKg}`
                          : progressionStats.totalGainKg}{' '}
                        kg ({progressionStats.totalGainPct}%)
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-neutral-500">
                        Solo 1 mes registrado
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="w-full min-w-0 h-52 sm:h-64 p-2.5 sm:p-3 rounded-2xl bg-[#090909] border border-[#303030]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={monthlySeries}
                    margin={{ top: 10, right: 12, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="histLimeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#CCFF00" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#CCFF00" stopOpacity={0.0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#303030" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="monthLabel"
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
                      tickFormatter={(val) => `${val}kg`}
                    />
                    <Tooltip
                      wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }}
                      content={<CustomHistoricalTooltip />}
                    />
                    {progressionStats && (
                      <ReferenceLine
                        y={
                          chartMetric === 'estimated1RM'
                            ? progressionStats.peak1RM
                            : progressionStats.peakWeight
                        }
                        stroke="#737373"
                        strokeDasharray="4 4"
                      />
                    )}
                    <Area
                      type="linear"
                      dataKey={chartMetric}
                      stroke="#CCFF00"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#histLimeGrad)"
                      dot={{ r: 4.5, fill: '#090909', stroke: '#CCFF00', strokeWidth: 2 }}
                      activeDot={{ r: 6.5, fill: '#CCFF00', stroke: '#FFFFFF', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="text-[11px] text-neutral-500">
                Nota: Este gráfico incluye exclusivamente meses con entrenamientos reales registrados (sin suavizados ni meses vacíos interpolados) y cubre todo tu historial independientemente del filtro de período superior.
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
};
