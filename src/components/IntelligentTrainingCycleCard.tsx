import React, { useState, useMemo } from 'react';
import {
  CalendarCheck2,
  Flame,
  Layers,
  Sparkles,
  CheckCircle2,
  Settings,
  Calendar,
  TrendingUp,
  AlertCircle,
  Play,
  RotateCcw,
  Clock,
  Award,
} from 'lucide-react';
import {
  calculateExecutedWeekStatus,
  ActiveRoutineConfig,
  WorkoutLogEntryMinimal,
  normalizeToCalendarDateYYYYMMDD,
} from '../utils/weeklyCycleManager';
import { formatDisplayDateDDMMYYYY } from '../utils/exportReport';

export interface IntelligentTrainingCycleCardProps {
  history: WorkoutLogEntryMinimal[];
  routineConfig: ActiveRoutineConfig;
  onUpdateRoutineConfig: (nextConfig: ActiveRoutineConfig) => void;
  onOpenCoachModal?: () => void;
  compact?: boolean;
}

export const IntelligentTrainingCycleCard: React.FC<IntelligentTrainingCycleCardProps> = ({
  history,
  routineConfig,
  onUpdateRoutineConfig,
  onOpenCoachModal,
  compact = false,
}) => {
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCoachAdviceModal, setShowCoachAdviceModal] = useState(false);

  // Form state for settings
  const [editProgramName, setEditProgramName] = useState(routineConfig.routineProgramName || 'Bloque Activo de Entrenamiento');
  const [editDaysPerWeek, setEditDaysPerWeek] = useState(routineConfig.daysPerWeek || 4);
  const [editTotalWeeks, setEditTotalWeeks] = useState<number | 'indefinite'>(routineConfig.totalWeeks || 8);
  const [editStartDate, setEditStartDate] = useState(routineConfig.startDate || '');

  // Auto-detect retroactive start date if not set in routineConfig
  const effectiveStartDate = useMemo(() => {
    if (routineConfig.startDate) {
      const norm = normalizeToCalendarDateYYYYMMDD(routineConfig.startDate);
      if (norm) return norm;
    }
    // Inspect history to find earliest date
    if (Array.isArray(history) && history.length > 0) {
      const dates = history
        .map((h) => normalizeToCalendarDateYYYYMMDD(h.date))
        .filter(Boolean) as string[];
      if (dates.length > 0) {
        dates.sort();
        return dates[0];
      }
    }
    // Default to today
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  }, [routineConfig.startDate, history]);

  const resolvedConfig: ActiveRoutineConfig = {
    ...routineConfig,
    startDate: effectiveStartDate,
    totalWeeks: routineConfig.totalWeeks || 8,
    daysPerWeek: routineConfig.daysPerWeek || 4,
    routineProgramName: routineConfig.routineProgramName || 'Bloque Activo de Entrenamiento',
  };

  const status = useMemo(
    () => calculateExecutedWeekStatus(history, resolvedConfig),
    [history, resolvedConfig]
  );

  // Calculate elapsed calendar weeks from effectiveStartDate to now
  const elapsedWeeksCount = useMemo(() => {
    if (!effectiveStartDate) return 1;
    const startMs = new Date(effectiveStartDate + 'T00:00:00').getTime();
    const nowMs = new Date().getTime();
    if (isNaN(startMs) || startMs > nowMs) return 1;
    const diffDays = Math.floor((nowMs - startMs) / (1000 * 60 * 60 * 24));
    return Math.max(1, Math.floor(diffDays / 7) + 1);
  }, [effectiveStartDate]);

  // Total configured weeks display
  const totalWeeksDisplay = typeof resolvedConfig.totalWeeks === 'number' ? resolvedConfig.totalWeeks : 'Indefinido';
  const isIndefinite = resolvedConfig.totalWeeks === 'indefinite';

  // Compliance percentage
  const compliancePct = useMemo(() => {
    const targetDaysTotal = elapsedWeeksCount * resolvedConfig.daysPerWeek;
    if (targetDaysTotal <= 0) return 100;
    return Math.min(100, Math.round((status.uniqueDaysCount / targetDaysTotal) * 100));
  }, [elapsedWeeksCount, resolvedConfig.daysPerWeek, status.uniqueDaysCount]);

  // AI Coach Analysis & Recommendations
  const aiCoachAdvice = useMemo(() => {
    if (compliancePct >= 85) {
      if (elapsedWeeksCount >= 6 && elapsedWeeksCount % 4 === 0) {
        return {
          title: 'Semana de Descarga Recomendada (Deload)',
          text: `Excelente consistencia (${compliancePct}% de cumplimiento en ${elapsedWeeksCount} semanas). Si notas fatiga acumulada o una caída de rendimiento, considera una semana de descarga adaptada a tu recuperación.`,
          action: 'Programar Descarga',
        };
      }
      return {
        title: 'Progresión de Cargas Óptima',
        text: `Tu tasa de cumplimiento es de ${compliancePct}% con ${status.uniqueDaysCount} entrenamientos registrados. Si mantienes una técnica correcta y margen de repeticiones, considera progresar gradualmente según tus registros.`,
        action: 'Continuar Ciclo Actual',
      };
    } else if (compliancePct >= 50) {
      return {
        title: 'Ritmo Constante - Ajustar Frecuencia',
        text: `Llevas ${elapsedWeeksCount} semanas de ciclo con un cumplimiento del ${compliancePct}%. Intenta mantener los ${resolvedConfig.daysPerWeek} días programados por semana para maximizar el estímulo hipertrófico.`,
        action: 'Mantener Plan',
      };
    } else {
      return {
        title: 'Bajo Cumplimiento Detectado',
        text: `Se registra un cumplimiento menor al 50% (${compliancePct}%) en las últimas semanas. Si tu disponibilidad horaria cambió, puedes ajustar los días por semana en la configuración del ciclo o reiniciar el conteo.`,
        action: 'Ajustar Frecuencia',
      };
    }
  }, [compliancePct, elapsedWeeksCount, status.uniqueDaysCount, resolvedConfig.daysPerWeek]);

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateRoutineConfig({
      routineProgramName: editProgramName,
      daysPerWeek: Number(editDaysPerWeek) || 4,
      totalWeeks: editTotalWeeks as any,
      startDate: editStartDate || effectiveStartDate,
    });
    setShowSettingsModal(false);
  };

  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0d1526]/95 via-[#090e1a]/95 to-[#060911] backdrop-blur-xl border border-white/[0.08] hover:border-accent/35 p-5 sm:p-6 shadow-[0_16px_40px_-12px_rgba(0,0,0,0.85),inset_0_1px_1px_rgba(255,255,255,0.08)] transition-all duration-300 font-sans space-y-4">
      {/* Ambient neon glow */}
      <div
        className="pointer-events-none absolute -top-16 -right-16 w-40 h-40 rounded-full blur-3xl opacity-40"
        style={{ backgroundColor: 'var(--accent-soft-bg)' }}
      />

      {/* Header: Title, Active Plan Name, Prominent Configuration Button */}
      <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-2xl bg-accent/10 border border-accent/35 flex items-center justify-center shrink-0 shadow-[0_2px_12px_var(--accent-glow)]">
            <CalendarCheck2 className="w-5 h-5 text-accent-text" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-accent-text truncate">
                Contador Inteligente de Semanas
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-[9px] font-semibold text-slate-300">
                Inicio: {formatDisplayDateDDMMYYYY(effectiveStartDate)}
              </span>
            </div>
            <h3 className="text-sm sm:text-base font-black text-white truncate mt-0.5">
              {resolvedConfig.routineProgramName}
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
          <button
            type="button"
            onClick={() => {
              setEditProgramName(resolvedConfig.routineProgramName || '');
              setEditDaysPerWeek(resolvedConfig.daysPerWeek || 4);
              setEditTotalWeeks(resolvedConfig.totalWeeks || 8);
              setEditStartDate(effectiveStartDate);
              setShowSettingsModal(true);
            }}
            className="min-h-[38px] px-4 py-2 rounded-xl bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent-text text-xs font-black inline-flex items-center gap-2 transition-all cursor-pointer shadow-[0_0_15px_var(--accent-glow)]"
            title="Configurar Fecha de Inicio y Tipo de Ciclo"
          >
            <Settings className="w-4 h-4" />
            <span>Configurar Ciclo</span>
          </button>
        </div>
      </div>

      {/* Metrics Grid: Current Week, Elapsed Weeks, Completed Weeks, Workouts Performed */}
      <div className="relative z-10 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/[0.06] flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Semana Actual</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl sm:text-2xl font-black text-accent-text tabular-nums leading-none">
              {status.currentExecutedWeek}
            </span>
            <span className="text-xs font-bold text-slate-500">/ {totalWeeksDisplay}</span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/[0.06] flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Transcurridas</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl sm:text-2xl font-black text-white tabular-nums leading-none">
              {elapsedWeeksCount}
            </span>
            <span className="text-[10px] font-semibold text-slate-400">sem</span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/[0.06] flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Completadas</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl sm:text-2xl font-black text-cyan-400 tabular-nums leading-none">
              {status.completedFullWeeks}
            </span>
            <span className="text-[10px] font-semibold text-slate-400">cerradas</span>
          </div>
        </div>

        <div className="p-3 rounded-2xl bg-slate-950/80 border border-white/[0.06] flex flex-col justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Entrenamientos</span>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-xl sm:text-2xl font-black text-emerald-400 tabular-nums leading-none">
              {status.uniqueDaysCount}
            </span>
            <span className="text-[10px] font-semibold text-slate-400">días</span>
          </div>
        </div>
      </div>

      {/* Visual Progress Bar & Current Week Progress */}
      <div className="relative z-10 space-y-2 pt-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300 font-medium">
            Progreso Semana {status.currentExecutedWeek}:{' '}
            <strong className="text-white font-bold tabular-nums">
              {status.daysInCurrentWeek} / {status.daysPerWeek} días
            </strong>
          </span>
          <span className="text-accent-text font-bold tabular-nums">{compliancePct}% cumplimiento</span>
        </div>

        {/* Segmented blocks for days in current week */}
        <div
          className="grid gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${Math.min(status.daysPerWeek, 7)}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: Math.min(status.daysPerWeek, 7) }).map((_, idx) => {
            const isDone = idx < status.daysInCurrentWeek;
            return (
              <div
                key={idx}
                className={`h-2.5 rounded-full transition-all duration-300 border ${
                  isDone
                    ? 'bg-accent border-accent shadow-[0_0_10px_var(--accent-glow)]'
                    : 'bg-slate-900 border-slate-800'
                }`}
                title={`Día ${idx + 1} (${isDone ? 'Completado' : 'Pendiente'})`}
              />
            );
          })}
        </div>

        {/* Global Progress Bar */}
        {!isIndefinite && typeof resolvedConfig.totalWeeks === 'number' && (
          <div className="space-y-1 pt-1">
            <div className="w-full h-1.5 rounded-full bg-slate-900 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(4, Math.round((status.currentExecutedWeek / resolvedConfig.totalWeeks) * 100)))}%`,
                  boxShadow: '0 0 10px var(--accent-glow)',
                }}
              />
            </div>
            <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
              <span>Ciclo de {resolvedConfig.totalWeeks} semanas</span>
              <span>Faltan {Math.max(0, resolvedConfig.totalWeeks - status.currentExecutedWeek + 1)} sem. para finalizar</span>
            </div>
          </div>
        )}
      </div>

      {/* AI Coach Integration Banner */}
      <div className="relative z-10 pt-2 border-t border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black text-white truncate">{aiCoachAdvice.title}</p>
            <p className="text-[10px] text-slate-400 truncate">{aiCoachAdvice.text}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowCoachAdviceModal(true)}
          className="min-h-[32px] px-3 py-1 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 text-[10px] font-black tracking-wide shrink-0 transition-all cursor-pointer"
        >
          Ver recomendaciones del ciclo
        </button>
      </div>

      {/* Configuration Modal (Fecha de Inicio & Tipo de Ciclo) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-white/[0.12] rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-5 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-4">
              <div className="flex items-center gap-2.5">
                <Settings className="w-5 h-5 text-accent-text" />
                <h3 className="text-base font-black text-white">Configuración del Contador Inteligente</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveSettings} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-300">Nombre de la Planificación</label>
                <input
                  type="text"
                  value={editProgramName}
                  onChange={(e) => setEditProgramName(e.target.value)}
                  className="w-full bg-slate-950 border border-white/[0.1] rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-accent"
                  placeholder="Ej: Bloque Fuerza Hipertrofia 7.0"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-300">Días por Semana (N)</label>
                  <select
                    value={editDaysPerWeek}
                    onChange={(e) => setEditDaysPerWeek(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-white/[0.1] rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-accent"
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <option key={d} value={d}>{d} días / semana</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-accent-text">Tipo de Ciclo (Duración)</label>
                  <select
                    value={String(editTotalWeeks)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditTotalWeeks(val === 'indefinite' ? 'indefinite' : Number(val));
                    }}
                    className="w-full bg-slate-950 border border-accent/40 rounded-xl px-3 py-2.5 text-xs text-white font-bold focus:outline-none focus:border-accent"
                  >
                    <option value="4">4 semanas</option>
                    <option value="6">6 semanas</option>
                    <option value="8">8 semanas</option>
                    <option value="10">10 semanas</option>
                    <option value="12">12 semanas</option>
                    <option value="indefinite">Indefinido</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-accent-text">Fecha de Inicio de la Planificación</label>
                <input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  className="w-full bg-slate-950 border border-accent/40 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono focus:outline-none focus:border-accent"
                  required
                />
                <p className="text-[10px] text-slate-400 font-mono">
                  Establece la fecha exacta en que comenzaste este ciclo para calcular automáticamente el avance retroactivo.
                </p>
              </div>

              <div className="flex justify-end gap-2.5 pt-3 border-t border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setShowSettingsModal(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-900 border border-white/[0.1] text-xs font-bold text-slate-300 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black shadow-[0_0_15px_var(--accent-glow)] cursor-pointer"
                >
                  Guardar Configuración
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Coach Detail Modal */}
      {showCoachAdviceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#121824] border border-purple-500/30 rounded-3xl p-6 w-full max-w-md shadow-2xl space-y-4 animate-in fade-in duration-200">
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-purple-500/20 flex items-center justify-center text-purple-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="text-base font-black text-white">Análisis local del ciclo</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCoachAdviceModal(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed font-sans">
              <div className="p-3.5 rounded-2xl bg-purple-950/30 border border-purple-500/20 space-y-1.5">
                <h4 className="font-bold text-purple-300">{aiCoachAdvice.title}</h4>
                <p>{aiCoachAdvice.text}</p>
              </div>

              <div className="p-3 rounded-2xl bg-slate-950 border border-white/[0.06] space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Días entrenados:</span>
                  <strong className="text-white">{status.uniqueDaysCount} sesiones únicas</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Semanas transcurridas:</span>
                  <strong className="text-white">{elapsedWeeksCount} semanas</strong>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Porcentaje de cumplimiento:</span>
                  <strong className="text-accent-text">{compliancePct}%</strong>
                </div>
              </div>

              <p className="text-[11px] text-slate-400 italic">
                Nota: Estas sugerencias se calculan con reglas locales de cumplimiento, no con una respuesta de IA. No evalúan tu fatiga real ni modifican tus rutinas.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowCoachAdviceModal(false)}
                className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs shadow-lg cursor-pointer"
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
