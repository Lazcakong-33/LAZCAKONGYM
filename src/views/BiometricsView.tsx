import React, { useMemo } from 'react';
import { Activity, Brain, ShieldCheck, Zap } from 'lucide-react';
import {
  Profile,
  CompletedWorkout,
  PersonalRecord,
  Routine,
  ActiveWorkoutSession,
} from '../types';
import { AccumulatedFatigueIndicator } from '../components/AccumulatedFatigueIndicator';
import { SessionRelativeVolumeModule } from '../components/SessionRelativeVolumeModule';
import { buildGroupedComparativeByDay } from '../utils/exportReport';
import { computeRealTimeRecovery } from '../utils/muscleRecoveryEngine';

interface BiometricsViewProps {
  prs?: Record<string, PersonalRecord>;
  history?: CompletedWorkout[];
  activeProfile?: Profile;
  routines?: Routine[];
  activeSession?: ActiveWorkoutSession | null;
}

export const BiometricsView: React.FC<BiometricsViewProps> = ({
  prs = {},
  history = [],
  activeProfile = { id: 'default', name: 'Atleta', weightKg: 95 } as any,
  routines = [],
  activeSession = null,
}) => {
  const comparativeGroups = useMemo(() => {
    const { groupedByDay } = buildGroupedComparativeByDay({
      routines: Array.isArray(routines) ? routines : [],
      history: Array.isArray(history) ? history : [],
      prs,
      activeSession,
      progressPeriod: 'current_week',
    });
    return groupedByDay;
  }, [routines, history, prs, activeSession]);

  const cnsStatus = useMemo(() => {
    try {
      const report = computeRealTimeRecovery(history, Date.now(), routines, 'ALL');
      const canonicalMap = new Map<string, number>();
      Object.values(report || {}).forEach((m) => {
        if (m && m.canonicalId) {
          const prev = canonicalMap.get(m.canonicalId) || 0;
          canonicalMap.set(m.canonicalId, Math.max(prev, m.fatigue || 0));
        }
      });
      const values = Array.from(canonicalMap.values());
      const systemicFatiguePct =
        values.length > 0
          ? Math.min(100, Math.round(values.reduce((a, b) => a + b, 0) / values.length))
          : 0;
      const recoveryPct = Math.max(0, 100 - systemicFatiguePct);

      if (systemicFatiguePct <= 35) {
        return {
          systemicFatiguePct,
          recoveryPct,
          label: 'SNC Óptimo',
          detail: `${recoveryPct}% Recup.`,
          tone: 'emerald' as const,
        };
      }
      if (systemicFatiguePct <= 65) {
        return {
          systemicFatiguePct,
          recoveryPct,
          label: 'Carga Moderada',
          detail: `${systemicFatiguePct}% Fatiga`,
          tone: 'blue' as const,
        };
      }
      return {
        systemicFatiguePct,
        recoveryPct,
        label: 'Fatiga Elevada',
        detail: `${systemicFatiguePct}% Fatiga`,
        tone: 'amber' as const,
      };
    } catch {
      return {
        systemicFatiguePct: 0,
        recoveryPct: 100,
        label: 'SNC Óptimo',
        detail: '100% Recup.',
        tone: 'emerald' as const,
      };
    }
  }, [history, routines]);

  return (
    <div className="space-y-8 pb-16 font-sans animate-in fade-in duration-300">
      {/* Header Biometría Élite */}
      <section className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-6 relative overflow-hidden">
        <div className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="space-y-2 relative z-10">
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold uppercase tracking-widest drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]">
            <Brain className="w-4 h-4 text-emerald-400" />
            <span>Telemetría Neuromuscular &amp; Fatiga SNC</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Panel de Biometría &amp; Recuperación
          </h1>
          <p className="text-sm text-slate-400 max-w-2xl">
            Control en tiempo real del estrés neuromuscular, volumen relativo por serie y recuperación sistémica.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0 relative z-10">
          <div className="px-4 py-3 rounded-2xl bg-white/5 border border-white/10 text-emerald-300 text-xs font-mono tabular-nums flex items-center gap-3 backdrop-blur-md">
            <Zap className="w-4 h-4 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            <div>
              <span className="block text-[10px] text-slate-400 uppercase tracking-widest font-semibold">SNC Status</span>
              <span className="font-bold text-white">{cnsStatus.label} <span className="text-emerald-400 font-mono">({cnsStatus.detail})</span></span>
            </div>
          </div>
        </div>
      </section>

      {/* 1. Indicador de Fatiga Acumulada & Semáforo de Recuperación */}
      <AccumulatedFatigueIndicator
        history={history}
        comparativeGroups={comparativeGroups}
        routines={routines}
        prs={prs}
      />

      {/* 2. Volumen Relativo por Sesión (KG/Serie) & Eficiencia Neuromuscular */}
      <SessionRelativeVolumeModule
        comparativeGroups={comparativeGroups}
        routines={routines}
        history={history}
        activeProfile={activeProfile}
        selectedDayFilter="ALL"
      />
    </div>
  );
};
export default BiometricsView;
