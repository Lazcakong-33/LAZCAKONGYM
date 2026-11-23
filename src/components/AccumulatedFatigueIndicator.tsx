import React, { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Dumbbell,
  Flame,
  Gauge,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
} from 'lucide-react';
import { CompletedWorkout, PersonalRecord, Routine } from '../types';
import {
  DailyComparativeGroup,
  formatDisplayDateDDMMYYYY,
} from '../utils/exportReport';
import { normalizeText } from '../utils/workoutAnalyticsEngine';

export type TrafficLightState = 'green' | 'yellow' | 'red';

export interface EvaluatedSessionSummary {
  id: string;
  label: string;
  subtitle: string;
  dateDisplay: string;
  volumeKg: number;
  setsCount: number;
  avg1RMKg: number;
  sessionRatio: number;
}

interface AccumulatedFatigueIndicatorProps {
  history?: CompletedWorkout[];
  comparativeGroups?: DailyComparativeGroup[];
  routines?: Routine[];
  prs?: Record<string, PersonalRecord>;
}

export const AccumulatedFatigueIndicator: React.FC<AccumulatedFatigueIndicatorProps> = ({
  history = [],
  comparativeGroups = [],
  routines = [],
  prs = {},
}) => {
  // Mapa de series configuradas por ejercicio en la rutina activa
  const setsByExercise = useMemo(() => {
    const map = new Map<string, number>();
    routines.forEach((r) => {
      (r.exercises || []).forEach((ex) => {
        const key = `${normalizeText(r.dayName)}::${normalizeText(ex.name)}`;
        const safeSets = Math.min(6, Math.max(1, Number(ex.defaultSets) || 3));
        map.set(key, safeSets);
        map.set(normalizeText(ex.name), safeSets);
      });
    });
    return map;
  }, [routines]);

  const fatigueAnalysis = useMemo(() => {
    const evaluatedSessions: EvaluatedSessionSummary[] = [];

    // 1. Priorizar las sesiones activas de la semana en curso (sincronizadas con ediciones en vivo del Cuadro Comparativo)
    if (comparativeGroups.length > 0) {
      const sortedGroups = [...comparativeGroups].sort((a, b) => {
        if (a.lastExecutedDate && b.lastExecutedDate) {
          return b.lastExecutedDate.localeCompare(a.lastExecutedDate);
        }
        if (a.lastExecutedDate) return -1;
        if (b.lastExecutedDate) return 1;
        return 0;
      });

      sortedGroups.slice(0, 3).forEach((group, idx) => {
        let sessionVolKg = 0;
        let sessionSets = 0;
        const oneRmValues: number[] = [];

        group.rows.forEach((row) => {
          const specKey = `${normalizeText(group.dayName)}::${normalizeText(row.name)}`;
          const sets =
            setsByExercise.get(specKey) ||
            setsByExercise.get(normalizeText(row.name)) ||
            3;
          const reps = row.currReps > 0 ? row.currReps : 10;
          const weight = row.currWeight > 0 ? row.currWeight : 0;

          sessionVolKg += weight * reps * sets;
          sessionSets += sets;
          if (row.curr1RM > 0) {
            oneRmValues.push(row.curr1RM);
          }
        });

        const avg1RM =
          oneRmValues.length > 0
            ? Math.round(oneRmValues.reduce((a, b) => a + b, 0) / oneRmValues.length)
            : 80;
        const roundedVol = Math.round(sessionVolKg);

        evaluatedSessions.push({
          id: `comp-${group.dayName}-${idx}`,
          label: `Sesión ${idx + 1} · ${group.dayName}`,
          subtitle: group.muscleSummary || `Bloque ${group.dayName}`,
          dateDisplay: group.lastExecutedDate
            ? formatDisplayDateDDMMYYYY(group.lastExecutedDate)
            : 'Semana Activa',
          volumeKg: roundedVol,
          setsCount: Math.max(1, sessionSets),
          avg1RMKg: Math.max(1, avg1RM),
          sessionRatio: Number((roundedVol / Math.max(1, avg1RM)).toFixed(1)),
        });
      });
    }

    // 2. Si hay menos de 3 sesiones en el bloque comparativo, completar con las últimas sesiones del historial
    if (evaluatedSessions.length < 3 && history.length > 0) {
      const sortedHistory = [...history]
        .filter((w) => (w.totalVolumeKg || 0) > 0)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      for (const w of sortedHistory) {
        if (evaluatedSessions.length >= 3) break;
        const dateFormatted = formatDisplayDateDDMMYYYY(w.date);
        const alreadyIncluded = evaluatedSessions.some(
          (s) => s.dateDisplay === dateFormatted && Math.abs(s.volumeKg - w.totalVolumeKg) < 50
        );
        if (alreadyIncluded) continue;

        const ex1RMs = (w.exercisesSummary || [])
          .map(
            (ex) =>
              ex.estimated1RM ||
              (ex.maxWeight > 0 ? Math.round(ex.maxWeight * (1 + (ex.maxReps || 10) / 30)) : 0)
          )
          .filter((v) => v > 0);

        const fallbackPrs = Object.values(prs).map((p) => p.estimated1RM).filter((v) => v > 0);
        const avg1RM =
          ex1RMs.length > 0
            ? Math.round(ex1RMs.reduce((a, b) => a + b, 0) / ex1RMs.length)
            : fallbackPrs.length > 0
            ? Math.round(fallbackPrs.reduce((a, b) => a + b, 0) / fallbackPrs.length)
            : 85;

        const volKg = Math.round(w.totalVolumeKg || 0);
        const setsCount =
          w.completedSetsCount ||
          (w.exercisesSummary || []).reduce((acc, ex) => acc + (ex.sets || 3), 0) ||
          12;

        evaluatedSessions.push({
          id: w.id || `hist-${evaluatedSessions.length}`,
          label: `Sesión #${evaluatedSessions.length + 1}`,
          subtitle: w.routineTitle || 'Entrenamiento Registrado',
          dateDisplay: dateFormatted,
          volumeKg: volKg,
          setsCount,
          avg1RMKg: Math.max(1, avg1RM),
          sessionRatio: Number((volKg / Math.max(1, avg1RM)).toFixed(1)),
        });
      }
    }

    const last3Sessions = evaluatedSessions.slice(0, 3);
    const totalVolumeLast3Kg = last3Sessions.reduce((sum, s) => sum + s.volumeKg, 0);
    const totalSetsLast3 = last3Sessions.reduce((sum, s) => sum + s.setsCount, 0);

    const avg1RMKg =
      last3Sessions.length > 0
        ? Math.round(
            last3Sessions.reduce((sum, s) => sum + s.avg1RMKg, 0) / last3Sessions.length
          )
        : 0;

    // RELACIÓN CENTRAL: Volumen Total (Últimas 3 Sesiones) ÷ 1RM Promedio
    const volumeTo1RMRatio =
      avg1RMKg > 0 ? Number((totalVolumeLast3Kg / avg1RMKg).toFixed(1)) : 0;

    // Normalización a escala porcentual de Fatiga Acumulada (0% - 100%)
    // Umbrales biomecánicos:
    // - Verde (Óptimo): Ratio <= 220 (< 55% fatiga)
    // - Amarillo (Precaución / Overreaching Funcional): Ratio 221 a 310 (55% - 79% fatiga)
    // - Rojo (Peligro Sobreentrenamiento): Ratio > 310 (>= 80% fatiga)
    const fatiguePct =
      volumeTo1RMRatio <= 0
        ? 0
        : Math.min(100, Math.max(12, Math.round((volumeTo1RMRatio / 380) * 100)));

    let trafficLight: TrafficLightState = 'green';
    let statusTitle = 'Semáforo Verde · Fatiga Asimilable y Recuperación Óptima';
    let statusShort = 'Carga Segura (Verde)';
    let medicalWarning =
      'La relación entre el volumen acumulado de tus últimas 3 sesiones y tu 1RM promedio se encuentra en zona fisiológica óptima. Tu sistema nervioso central asimila la carga sin riesgo de sobreentrenamiento.';
    let actionItem = 'Vía libre para aplicar sobrecarga progresiva (+2.5 kg o +1 rep).';

    if (volumeTo1RMRatio > 310 || fatiguePct >= 80) {
      trafficLight = 'red';
      statusTitle = 'Semáforo Rojo · Alerta de Posible Sobreentrenamiento';
      statusShort = 'Riesgo Alto (Rojo)';
      medicalWarning =
        'Advertencia fisiológica: El volumen acumulado en las últimas 3 sesiones supera más de 310 veces tu 1RM promedio. Existe riesgo elevado de saturación del SNC, fatiga articular y estancamiento por sobreentrenamiento.';
      actionItem =
        'Prescripción: Programar día de DESCANSO o reducir el volumen de series un 25-30% (Deload) en la próxima sesión.';
    } else if (volumeTo1RMRatio > 220 || fatiguePct >= 55) {
      trafficLight = 'yellow';
      statusTitle = 'Semáforo Amarillo · Fatiga Acumulada Moderada-Alta (Precaución)';
      statusShort = 'Precaución (Amarillo)';
      medicalWarning =
        'Acumulación significativa de trabajo mecánico respecto a tu 1RM promedio en las últimas 3 sesiones (Overreaching funcional). Estás cerca del límite de recuperación semanal.';
      actionItem =
        'Prescripción: Evitar el fallo muscular absoluto (mantener RPE 7.5–8.5) y priorizar 8h de sueño.';
    }

    return {
      last3Sessions,
      totalVolumeLast3Kg,
      totalSetsLast3,
      avg1RMKg,
      volumeTo1RMRatio,
      fatiguePct,
      trafficLight,
      statusTitle,
      statusShort,
      medicalWarning,
      actionItem,
    };
  }, [comparativeGroups, history, prs, setsByExercise]);

  const isGreen = fatigueAnalysis.trafficLight === 'green';
  const isYellow = fatigueAnalysis.trafficLight === 'yellow';
  const isRed = fatigueAnalysis.trafficLight === 'red';

  return (
    <section
      className={`p-6 sm:p-8 rounded-3xl border shadow-2xl space-y-6 font-sans relative overflow-hidden transition-all backdrop-blur-xl ${
        isRed
          ? 'bg-rose-950/20 border-rose-500/30'
          : isYellow
          ? 'bg-amber-950/15 border-amber-500/30'
          : 'bg-white/5 border-white/10'
      }`}
    >
      {/* Resplandor ambiental según el color del semáforo */}
      <div
        className={`pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl ${
          isRed
            ? 'bg-rose-500/15'
            : isYellow
            ? 'bg-amber-500/12'
            : 'bg-emerald-500/10'
        }`}
      />

      {/* Cabecera Ejecutiva + Semáforo Visual de 3 Luces */}
      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-slate-800/70 pb-5">
        <div className="flex items-start sm:items-center gap-3.5">
          <div
            className={`p-3 rounded-xl border shrink-0 shadow-lg ${
              isRed
                ? 'bg-rose-500/20 border-rose-400/50 text-rose-400 shadow-rose-500/15'
                : isYellow
                ? 'bg-amber-500/20 border-amber-400/50 text-amber-400 shadow-amber-500/15'
                : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-400 shadow-emerald-500/15'
            }`}
          >
            {isRed ? (
              <ShieldAlert className="w-5 h-5" />
            ) : isYellow ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <ShieldCheck className="w-5 h-5" />
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
                Indicador de Fatiga Acumulada &amp; Control de Sobreentrenamiento
              </h3>
              <span className="text-xs font-semibold text-slate-400 tabular-nums">
                · Relación Volumen (3 Sesiones) ÷ 1RM Promedio
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Monitoreo fisiológico basado en el cociente entre el tonelaje acumulado de tus últimas 3 sesiones y tu fuerza máxima promedio (1RM).
            </p>
          </div>
        </div>

        {/* Semáforo Deportivo de 3 Estados (Verde / Amarillo / Rojo) */}
        <div className="flex items-center gap-3 bg-slate-900/90 border border-slate-800 rounded-2xl px-4 py-2.5 self-start lg:self-auto shrink-0 shadow-inner">
          <div className="flex items-center gap-2">
            {/* Luz Verde */}
            <div
              className={`w-4 h-4 rounded-full transition-all flex items-center justify-center ${
                isGreen
                  ? 'bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.95)] ring-2 ring-emerald-300/60 scale-110'
                  : 'bg-emerald-950/70 border border-emerald-800/40 opacity-35'
              }`}
              title="Verde: Fatiga Asimilable (Ratio ≤ 220x)"
            />
            {/* Luz Amarilla */}
            <div
              className={`w-4 h-4 rounded-full transition-all flex items-center justify-center ${
                isYellow
                  ? 'bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.95)] ring-2 ring-amber-300/60 scale-110'
                  : 'bg-amber-950/70 border border-amber-800/40 opacity-35'
              }`}
              title="Amarillo: Precaución / Fatiga Moderada-Alta (Ratio 221x - 310x)"
            />
            {/* Luz Roja */}
            <div
              className={`w-4 h-4 rounded-full transition-all flex items-center justify-center ${
                isRed
                  ? 'bg-rose-500 shadow-[0_0_16px_rgba(244,63,94,0.95)] ring-2 ring-rose-300/60 scale-110 animate-pulse'
                  : 'bg-rose-950/70 border border-rose-800/40 opacity-35'
              }`}
              title="Rojo: Alerta de Sobreentrenamiento (Ratio > 310x)"
            />
          </div>

          <div className="pl-2.5 border-l border-slate-800 text-xs">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">
              Estado Semáforo
            </span>
            <span
              className={`font-black tracking-tight ${
                isRed
                  ? 'text-rose-400'
                  : isYellow
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {fatigueAnalysis.statusShort}
            </span>
          </div>
        </div>
      </div>

      {/* Cinta de 4 Métricas de la Ecuación de Fatiga Acumulada (Bento Box) */}
      <div className="grid grid-cols-2 gap-4 mt-6">
        {/* 1. Volumen Acumulado (Últimas 3 Sesiones) */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-lg">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-semibold mb-1">
            Volumen Total (Últimas 3 Sesiones)
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-mono font-black text-white">
              {fatigueAnalysis.totalVolumeLast3Kg.toLocaleString('es-CL')}
            </span>
            <span className="text-xs font-bold text-cyan-400">kg</span>
          </div>
        </div>

        {/* 2. 1RM Promedio */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-lg">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-semibold mb-1">
            1RM Promedio del Atleta
          </span>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-mono font-black text-cyan-400">
              ~{fatigueAnalysis.avg1RMKg}
            </span>
            <span className="text-xs font-bold text-slate-300">kg</span>
          </div>
        </div>

        {/* 3. Cociente / Relación Volumen ÷ 1RM */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-lg">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-semibold mb-1">
            Relación Volumen / 1RM
          </span>
          <div className="flex items-baseline gap-1">
            <span
              className={`text-2xl font-mono font-black ${
                isRed
                  ? 'text-rose-400'
                  : isYellow
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {fatigueAnalysis.volumeTo1RMRatio}x
            </span>
          </div>
        </div>

        {/* 4. Nivel de Fatiga Acumulada (%) */}
        <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 flex flex-col items-center justify-center text-center shadow-lg">
          <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 font-semibold mb-1">
            Índice de Fatiga Acumulada
          </span>
          <div className="flex items-baseline gap-1">
            <span
              className={`text-2xl font-mono font-black ${
                isRed
                  ? 'text-rose-400'
                  : isYellow
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {fatigueAnalysis.fatiguePct}%
            </span>
          </div>
        </div>
      </div>

      {/* Barra Graduada de Semáforo (Verde / Amarillo / Rojo) + Diagnóstico de Sobreentrenamiento */}
      <div className="relative z-10 p-4 sm:p-5 rounded-xl bg-slate-900/50 border border-slate-800/80 space-y-4">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span
              className={`font-bold ${
                isRed
                  ? 'text-rose-400'
                  : isYellow
                  ? 'text-amber-400'
                  : 'text-emerald-400'
              }`}
            >
              {fatigueAnalysis.statusTitle}
            </span>
            <span className="text-slate-400 tabular-nums font-medium">
              Ratio actual: <strong className="text-white">{fatigueAnalysis.volumeTo1RMRatio}x</strong> ({fatigueAnalysis.fatiguePct}%)
            </span>
          </div>

          {/* Barra segmentada con marcador de posición */}
          <div className="relative pt-1">
            <div className="w-full h-3 rounded-full bg-slate-950 border border-slate-800 overflow-hidden grid grid-cols-12">
              <div className="col-span-6 bg-emerald-500/80 border-r border-slate-950" title="Zona Verde: Recuperación Óptima (0 - 54%)" />
              <div className="col-span-3 bg-amber-400/85 border-r border-slate-950" title="Zona Amarilla: Precaución / Fatiga Moderada-Alta (55 - 79%)" />
              <div className="col-span-3 bg-rose-500/85" title="Zona Roja: Peligro de Sobreentrenamiento (80 - 100%)" />
            </div>

            {/* Indicador de aguja/marcador */}
            <div
              className="absolute top-0 -translate-x-1/2 transition-all duration-500"
              style={{ left: `${Math.min(98, Math.max(2, fatigueAnalysis.fatiguePct))}%` }}
            >
              <div className="w-4 h-5 rounded-md bg-white border-2 border-slate-950 shadow-[0_0_10px_rgba(255,255,255,0.9)]" />
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 font-medium tabular-nums pt-0.5">
            <span className="text-emerald-400">🟢 Verde: Asimilable (≤ 220x 1RM)</span>
            <span className="text-amber-400">🟡 Amarillo: Precaución (221x – 310x)</span>
            <span className="text-rose-400">🔴 Rojo: Sobreentrenamiento (&gt; 310x)</span>
          </div>
        </div>

        {/* Alerta y Prescripción Fisiológica */}
        <div
          className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
            isRed
              ? 'bg-rose-950/35 border-rose-500/40 text-rose-100'
              : isYellow
              ? 'bg-amber-950/30 border-amber-500/35 text-amber-100'
              : 'bg-emerald-950/25 border-emerald-500/30 text-emerald-100'
          }`}
        >
          <p className="leading-relaxed">{fatigueAnalysis.medicalWarning}</p>
          <p className="font-bold text-white pt-0.5">{fatigueAnalysis.actionItem}</p>
        </div>
      </div>

      {/* Desglose de las Últimas 3 Sesiones Evaluadas */}
      {fatigueAnalysis.last3Sessions.length > 0 && (
        <div className="relative z-10 space-y-2.5">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
            Desglose de las Últimas {fatigueAnalysis.last3Sessions.length} Sesiones Computadas
          </span>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs tabular-nums">
            {fatigueAnalysis.last3Sessions.map((sess) => (
              <div
                key={sess.id}
                className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80 flex flex-col justify-between gap-2"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white truncate">{sess.label}</span>
                    <span className="text-[11px] text-slate-400 shrink-0">{sess.dateDisplay}</span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5">{sess.subtitle}</p>
                </div>

                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Volumen Sesión</span>
                    <span className="font-bold text-emerald-400">
                      {sess.volumeKg.toLocaleString('es-CL')} kg
                    </span>
                  </div>
                  <div className="text-center">
                    <span className="text-[10px] text-slate-500 block">1RM Medio</span>
                    <span className="font-bold text-cyan-400">~{sess.avg1RMKg} kg</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-slate-500 block">Ratio Sesión</span>
                    <span className="font-bold text-white">{sess.sessionRatio}x</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
};
