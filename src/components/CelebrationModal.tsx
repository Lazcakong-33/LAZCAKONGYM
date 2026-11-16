import React, { useMemo } from 'react';
import {
  Trophy,
  Clock,
  Dumbbell,
  CheckCircle2,
  X,
  TrendingUp,
  TrendingDown,
  Layers,
  Repeat,
  Activity,
  ChevronRight,
} from 'lucide-react';
import { CompletedWorkout, PersonalRecord } from '../types';
import { MUSCLE_CONFIG, resolveExerciseMuscleImpact } from '../utils/muscleRecoveryEngine';

interface CelebrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  workout: CompletedWorkout | null;
  newPRs: PersonalRecord[];
  onOpenMuscleMap?: () => void;
}

function formatDateShort(rawDate?: string): string {
  if (!rawDate) return '';
  const parsed = new Date(rawDate);
  if (!Number.isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, '0');
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const yyyy = parsed.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return rawDate.slice(0, 10);
}

export const CelebrationModal: React.FC<CelebrationModalProps> = ({
  isOpen,
  onClose,
  workout,
  newPRs,
  onOpenMuscleMap,
}) => {
  const summaryMetrics = useMemo(() => {
    if (!workout) return null;

    const mins = Math.floor(workout.durationSeconds / 60);
    const secs = workout.durationSeconds % 60;
    const durationText =
      mins > 0 ? `${mins}m ${secs.toString().padStart(2, '0')}s` : `${secs}s`;

    const completedExercises =
      workout.completedExercisesCount ?? (workout.exercisesSummary || []).length;

    const totalReps =
      workout.totalRepsCount ??
      (workout.exercisesSummary || []).reduce(
        (acc, ex) => acc + (ex.totalReps ?? ex.sets * ex.maxReps),
        0
      );

    // Primary and Secondary muscles from workout or resolved dynamically from exercisesSummary
    let primaryMuscles = workout.primaryMusclesWorked || [];
    let secondaryMuscles = workout.secondaryMusclesWorked || [];

    if (primaryMuscles.length === 0 && (workout.exercisesSummary || []).length > 0) {
      const pSet = new Set<string>();
      const sSet = new Set<string>();
      workout.exercisesSummary.forEach((ex) => {
        const impact = resolveExerciseMuscleImpact(ex.name, ex.muscleGroup || '');
        impact.primary.forEach((mId) => {
          const cat = MUSCLE_CONFIG[mId]?.standardCategory || MUSCLE_CONFIG[mId]?.name;
          if (cat) pSet.add(cat);
        });
        impact.synergists.forEach((syn) => {
          const cat = MUSCLE_CONFIG[syn.id]?.standardCategory || MUSCLE_CONFIG[syn.id]?.name;
          if (cat && !pSet.has(cat)) sSet.add(cat);
        });
        impact.secondaryNames.forEach((sec) => {
          const cleaned = sec.replace(/\s*\(.*?\)\s*/g, '').trim();
          if (cleaned && !pSet.has(cleaned)) sSet.add(cleaned);
        });
      });
      pSet.forEach((pm) => sSet.delete(pm));
      primaryMuscles = Array.from(pSet);
      secondaryMuscles = Array.from(sSet);
    }

    return {
      durationText,
      completedExercises,
      totalReps,
      primaryMuscles,
      secondaryMuscles,
    };
  }, [workout]);

  if (!isOpen || !workout || !summaryMetrics) return null;

  const prevComp = workout.previousSessionComparison;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3.5 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200 font-['Plus_Jakarta_Sans',sans-serif]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-[#090909] border border-[#CCFF00]/50 rounded-3xl shadow-[0_24px_60px_rgba(0,0,0,0.95)] p-5 sm:p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-[#171717] hover:bg-[#242424] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center transition-colors cursor-pointer"
          aria-label="Cerrar resumen"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3.5 mb-5 pr-10">
          <div className="w-12 h-12 rounded-2xl bg-[#CCFF00] text-[#090909] flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(204,255,0,0.3)]">
            <Trophy className="w-6 h-6 stroke-[2.5]" />
          </div>
          <div className="min-w-0">
            <span className="inline-block text-[10px] font-black uppercase tracking-[0.2em] text-[#CCFF00]">
              RESUMEN DEL ENTRENAMIENTO
            </span>
            <h2 className="text-lg sm:text-xl font-black text-[#F5F5F5] leading-tight truncate">
              {workout.routineTitle}
            </h2>
            <p className="text-xs text-zinc-400 font-mono">
              Sesión registrada · {formatDateShort(workout.date)}
            </p>
          </div>
        </div>

        {/* Core Registered Metrics Grid (Real Data Only - Zero Invented Calories) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-4">
          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <Clock className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>Duración Real</span>
            </div>
            <div className="text-lg font-black text-[#F5F5F5] font-mono tabular-nums">
              {summaryMetrics.durationText}
            </div>
          </div>

          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <Dumbbell className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>Volumen Total</span>
            </div>
            <div className="text-lg font-black text-[#CCFF00] font-mono tabular-nums">
              {workout.totalVolumeKg.toLocaleString()} kg
            </div>
          </div>

          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>Ejercicios</span>
            </div>
            <div className="text-lg font-black text-[#F5F5F5] font-mono tabular-nums">
              {summaryMetrics.completedExercises}
            </div>
          </div>

          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <Layers className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>Series Efectivas</span>
            </div>
            <div className="text-lg font-black text-[#F5F5F5] font-mono tabular-nums">
              {workout.completedSetsCount}
            </div>
          </div>

          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <Repeat className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>Repeticiones</span>
            </div>
            <div className="text-lg font-black text-[#F5F5F5] font-mono tabular-nums">
              {summaryMetrics.totalReps}
            </div>
          </div>

          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
              <Activity className="w-3.5 h-3.5 text-[#CCFF00]" />
              <span>RPE Promedio</span>
            </div>
            <div className="text-lg font-black text-[#F5F5F5] font-mono tabular-nums">
              {typeof workout.avgRpe === 'number' ? `@${workout.avgRpe}` : 'No reg.'}
            </div>
          </div>
        </div>

        {/* Comparison with Previous Session (when available) */}
        {prevComp && (
          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3.5 mb-4">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                Comparación vs. Sesión Previa ({formatDateShort(prevComp.prevDate)})
              </span>
              <span
                className={`inline-flex items-center gap-1 text-xs font-mono font-black px-2 py-0.5 rounded-lg border ${
                  prevComp.volumeDiffKg >= 0
                    ? 'bg-[#CCFF00]/15 border-[#CCFF00]/40 text-[#CCFF00]'
                    : 'bg-[#171717] border-[#303030] text-zinc-300'
                }`}
              >
                {prevComp.volumeDiffKg >= 0 ? (
                  <TrendingUp className="w-3.5 h-3.5" />
                ) : (
                  <TrendingDown className="w-3.5 h-3.5" />
                )}
                <span>
                  {prevComp.volumeDiffKg >= 0 ? '+' : ''}
                  {prevComp.volumeDiffKg.toLocaleString()} kg
                </span>
              </span>
            </div>
            <p className="text-xs text-zinc-300 font-mono tabular-nums">
              Sesión anterior: <strong>{prevComp.prevVolumeKg.toLocaleString()} kg</strong> en{' '}
              <strong>{prevComp.prevSets} series</strong> · Hoy:{' '}
              <strong className="text-[#CCFF00]">{workout.totalVolumeKg.toLocaleString()} kg</strong> en{' '}
              <strong>{workout.completedSetsCount} series</strong>.
            </p>
          </div>
        )}

        {/* Muscles Worked (Primary & Secondary) */}
        {(summaryMetrics.primaryMuscles.length > 0 || summaryMetrics.secondaryMuscles.length > 0) && (
          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3.5 mb-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400">
                Impacto Anatómico Registrado
              </span>
              <span className="text-[10px] font-mono text-[#CCFF00]">
                Sincronizado con Mapa Muscular
              </span>
            </div>

            {summaryMetrics.primaryMuscles.length > 0 && (
              <div>
                <span className="block text-[10px] text-zinc-400 font-semibold mb-1">
                  Músculos Primarios:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {summaryMetrics.primaryMuscles.map((m) => (
                    <span
                      key={m}
                      className="px-2.5 py-1 rounded-lg bg-[#090909] border border-[#CCFF00]/50 text-[#CCFF00] text-xs font-bold"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {summaryMetrics.secondaryMuscles.length > 0 && (
              <div>
                <span className="block text-[10px] text-zinc-400 font-semibold mb-1">
                  Sinergistas y Secundarios:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {summaryMetrics.secondaryMuscles.map((m) => (
                    <span
                      key={m}
                      className="px-2.5 py-0.5 rounded-lg bg-[#090909] border border-[#303030] text-zinc-300 text-[11px] font-semibold"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Verified Personal Records (PRs) */}
        {newPRs.length > 0 && (
          <div className="bg-[#171717] border border-[#CCFF00]/50 rounded-2xl p-3.5 mb-4 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-black text-[#CCFF00] uppercase tracking-wider">
              <Trophy className="w-4 h-4 fill-current" />
              <span>¡{newPRs.length} Récord(s) Personal(es) Verificado(s)!</span>
            </div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {newPRs.map((pr, i) => (
                <div
                  key={`${pr.exerciseId}-${i}`}
                  className="flex items-center justify-between text-xs bg-[#090909] px-3 py-2 rounded-xl border border-[#303030]"
                >
                  <span className="text-[#F5F5F5] font-bold truncate pr-2">
                    {pr.exerciseName}
                  </span>
                  <span className="text-[#CCFF00] font-mono font-black shrink-0 tabular-nums">
                    {pr.maxWeight} kg × {pr.repsAtMaxWeight} reps
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Exercises Breakdown */}
        {workout.exercisesSummary && workout.exercisesSummary.length > 0 && (
          <div className="bg-[#171717] border border-[#303030] rounded-2xl p-3.5 mb-5">
            <span className="block text-[10px] font-black uppercase tracking-wider text-zinc-400 mb-2">
              Desglose por Ejercicio ({workout.exercisesSummary.length})
            </span>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {workout.exercisesSummary.map((ex, idx) => (
                <div
                  key={`${ex.name}-${idx}`}
                  className="flex items-center justify-between gap-2 text-xs bg-[#090909] px-3 py-2 rounded-xl border border-[#303030]/80"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-[#F5F5F5] truncate">{ex.name}</p>
                    {ex.originalExerciseName && ex.originalExerciseName !== ex.name && (
                      <p className="text-[10px] text-zinc-500 truncate">
                        Sustituyó a: {ex.originalExerciseName}
                      </p>
                    )}
                  </div>
                  <div className="text-right font-mono tabular-nums shrink-0">
                    <span className="text-[#CCFF00] font-bold">
                      {ex.maxWeight} kg × {ex.maxReps}
                    </span>
                    <span className="block text-[10px] text-zinc-400">
                      {ex.sets} series · {(ex.volumeKg || 0).toLocaleString()} kg
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-2.5">
          {onOpenMuscleMap && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenMuscleMap();
              }}
              className="flex-1 min-h-[48px] py-3 px-4 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#CCFF00]/50 text-[#CCFF00] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              <span>Ver Impacto en Mapa Muscular</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 min-h-[48px] py-3 px-4 rounded-xl bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs uppercase tracking-wider transition-all active:scale-95 cursor-pointer shadow-[0_0_20px_rgba(204,255,0,0.25)]"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
};
