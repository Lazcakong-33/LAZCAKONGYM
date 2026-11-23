import React, { useEffect, useState } from 'react';
import {
  Timer,
  Plus,
  Minus,
  X,
  Minimize2,
  Maximize2,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Flame,
  Volume2,
  VolumeX,
  Smartphone,
} from 'lucide-react';
import { RestTimerState, RestCompleteNotice } from '../types';
import { buildRestCompleteNotificationBody } from '../utils/backgroundTimer';
import { formatRestMmSs } from '../utils/restFormatter';

interface RestTimerWidgetProps {
  timer: RestTimerState;
  restCompleteNotice?: RestCompleteNotice | null;
  onDismissRestCompleteNotice?: () => void;
  onContinueWorkout?: () => void;
  soundEnabled?: boolean;
  vibrationEnabled?: boolean;
  onUpdateAlertMode?: (updates: { soundEnabled: boolean; vibrationEnabled: boolean }) => void;
  onStop: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onAdjust: (deltaSeconds: number) => void;
  onToggleMinimize: () => void;
}

export const RestTimerWidget: React.FC<RestTimerWidgetProps> = ({
  timer,
  restCompleteNotice,
  onDismissRestCompleteNotice,
  onContinueWorkout,
  soundEnabled = true,
  vibrationEnabled = true,
  onUpdateAlertMode,
  onStop,
  onPause,
  onResume,
  onRestart,
  onAdjust,
  onToggleMinimize,
}) => {
  const [liveRemaining, setLiveRemaining] = useState<number>(timer.remainingSeconds);

  useEffect(() => {
    if (!timer.active) return;

    if (timer.paused) {
      setLiveRemaining(timer.remainingSeconds);
      return;
    }

    const updateRemaining = () => {
      if (timer.targetEndTime) {
        const diffSec = Math.max(0, Math.ceil((timer.targetEndTime - Date.now()) / 1000));
        setLiveRemaining(diffSec);
      } else {
        setLiveRemaining(timer.remainingSeconds);
      }
    };

    updateRemaining();
    const id = window.setInterval(updateRemaining, 250);
    return () => window.clearInterval(id);
  }, [timer.active, timer.paused, timer.targetEndTime, timer.remainingSeconds]);

  if (!timer.active) {
    if (!restCompleteNotice) return null;
    const noticeBody = buildRestCompleteNotificationBody(
      restCompleteNotice.exerciseName,
      restCompleteNotice.nextSetNumber
    );
    return (
      <div
        data-testid="rest-complete-notice"
        role="status"
        aria-live="assertive"
        className="fixed bottom-[calc(5.1rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-md pointer-events-none"
      >
        <div className="pointer-events-auto rounded-2xl p-3.5 bg-[#090909]/95 border-2 border-accent shadow-[0_14px_40px_var(--accent-glow)] backdrop-blur-xl space-y-2.5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src="/notification-icon-192.png"
                alt="LazcaKong Gym"
                className="w-9 h-9 rounded-xl object-cover border border-accent/60 bg-[#090909] shrink-0"
              />
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-wider text-accent-text">
                  {restCompleteNotice.title}
                </p>
                <p className="text-xs font-semibold text-zinc-200 leading-snug">
                  {noticeBody}
                </p>
              </div>
            </div>
            {onDismissRestCompleteNotice && (
              <button
                type="button"
                onClick={onDismissRestCompleteNotice}
                className="w-7 h-7 rounded-lg bg-[#171717] hover:bg-[#242424] border border-[#303030] text-zinc-300 flex items-center justify-center shrink-0 cursor-pointer"
                aria-label="Cerrar aviso de descanso terminado"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => {
              if (onContinueWorkout) {
                onContinueWorkout();
              } else {
                onDismissRestCompleteNotice?.();
              }
            }}
            className="w-full min-h-[38px] px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-98 transition-all cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Continuar entrenamiento</span>
          </button>
        </div>
      </div>
    );
  }

  const displaySec = timer.paused ? timer.remainingSeconds : liveRemaining;
  const mins = Math.floor(displaySec / 60);
  const secs = displaySec % 60;
  const formattedTime = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const progressPct =
    timer.totalSeconds > 0
      ? Math.min(100, Math.max(0, ((timer.totalSeconds - displaySec) / timer.totalSeconds) * 100))
      : 0;

  const isFinalCountdown = !timer.paused && displaySec <= 5 && displaySec > 0;

  if (timer.minimized) {
    return (
      <div
        className={`fixed bottom-[calc(5.2rem+env(safe-area-inset-bottom,0px))] right-3.5 z-50 flex items-center gap-2 rounded-2xl p-1.5 pl-3 shadow-[0_12px_32px_rgba(0,0,0,0.85)] transition-all border ${
          timer.paused
            ? 'bg-[#171717]/95 border-[#303030] text-[#F5F5F5]'
            : isFinalCountdown
            ? 'bg-[#171717] border-[#EF4444] text-[#F5F5F5] shadow-[#EF4444]/20'
            : 'bg-[#090909]/95 border-accent/60 text-[#F5F5F5] shadow-[0_12px_32px_var(--accent-glow)]'
        } backdrop-blur-xl`}
      >
        <button
          type="button"
          onClick={onToggleMinimize}
          className="flex items-center gap-2 text-left py-1 pr-1 cursor-pointer"
          title="Expandir temporizador de descanso"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              timer.paused
                ? 'bg-[#FACC15]'
                : isFinalCountdown
                ? 'bg-[#EF4444] animate-ping'
                : 'bg-accent animate-pulse'
            }`}
          />
          <div>
            <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-400 leading-none">
              {timer.paused ? 'PAUSADO' : 'DESCANSO'}
            </span>
            <div className="flex items-baseline gap-1.5 font-mono tabular-nums">
              <span
                className={`font-black text-base tracking-tight ${
                  timer.paused
                    ? 'text-[#FACC15]'
                    : isFinalCountdown
                    ? 'text-[#EF4444]'
                    : 'text-accent-text'
                }`}
              >
                {formattedTime}
              </span>
              <span className="text-[11px] font-bold text-zinc-300">
                ({displaySec} s)
              </span>
            </div>
          </div>
          <Maximize2 className="w-3.5 h-3.5 text-zinc-400 ml-1" />
        </button>

        {onPause && onResume && (
          <button
            type="button"
            onClick={() => (timer.paused ? onResume() : onPause())}
            className="w-8 h-8 rounded-xl bg-[#171717] border border-[#303030] hover:border-accent/50 flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
            title={timer.paused ? 'Reanudar descanso' : 'Pausar descanso'}
          >
            {timer.paused ? (
              <Play className="w-3.5 h-3.5 text-accent-text fill-current" />
            ) : (
              <Pause className="w-3.5 h-3.5 text-[#F5F5F5]" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onStop}
          className="w-8 h-8 rounded-xl bg-[#171717] border border-[#303030] hover:border-[#EF4444]/60 flex items-center justify-center text-zinc-400 hover:text-[#EF4444] transition-colors cursor-pointer"
          title="Saltar descanso"
        >
          <SkipForward className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-[calc(5.1rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 z-50 w-[94%] max-w-md pointer-events-none">
      <div
        className={`pointer-events-auto rounded-2xl p-3.5 shadow-[0_18px_45px_rgba(0,0,0,0.92)] backdrop-blur-xl border transition-all ${
          timer.paused
            ? 'bg-[#090909]/95 border-[#FACC15]/50'
            : isFinalCountdown
            ? 'bg-[#090909]/95 border-[#EF4444]'
            : 'bg-[#090909]/95 border-accent/50'
        }`}
      >
        {/* Top Row: Exercise Context + Window Controls */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                timer.paused
                  ? 'bg-[#FACC15]/15 border-[#FACC15]/40 text-[#FACC15]'
                  : isFinalCountdown
                  ? 'bg-[#EF4444]/20 border-[#EF4444]/50 text-[#EF4444]'
                  : 'bg-accent/15 border-accent/40 text-accent-text'
              }`}
            >
              {isFinalCountdown ? <Flame className="w-4 h-4" /> : <Timer className="w-4 h-4" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-[10px] font-black uppercase tracking-wider ${
                    timer.paused
                      ? 'text-[#FACC15]'
                      : isFinalCountdown
                      ? 'text-[#EF4444]'
                      : 'text-accent-text'
                  }`}
                >
                  {timer.paused
                    ? 'DESCANSO EN PAUSA'
                    : isFinalCountdown
                    ? '¡PREPÁRATE PARA LA SERIE!'
                    : 'TEMPORIZADOR DE DESCANSO'}
                </span>
              </div>
              {timer.exerciseName && (
                <p className="text-[11px] font-semibold text-zinc-300 truncate">
                  {timer.exerciseName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onUpdateAlertMode && (
              <button
                type="button"
                onClick={() => {
                  if (soundEnabled) {
                    onUpdateAlertMode({ soundEnabled: false, vibrationEnabled: true });
                  } else if (vibrationEnabled) {
                    onUpdateAlertMode({ soundEnabled: false, vibrationEnabled: false });
                  } else {
                    onUpdateAlertMode({ soundEnabled: true, vibrationEnabled: true });
                  }
                }}
                className="h-8 px-2 rounded-lg bg-[#171717] hover:bg-[#242424] border border-[#303030] text-[10px] font-bold text-accent-text flex items-center gap-1 transition-colors cursor-pointer"
                title="Cambiar modo de aviso del descanso"
              >
                {soundEnabled ? (
                  <>
                    <Volume2 className="w-3 h-3" />
                    <span className="hidden xs:inline">Pitido</span>
                  </>
                ) : vibrationEnabled ? (
                  <>
                    <Smartphone className="w-3 h-3" />
                    <span className="hidden xs:inline">Vibración</span>
                  </>
                ) : (
                  <>
                    <VolumeX className="w-3 h-3 text-zinc-400" />
                    <span className="hidden xs:inline text-zinc-300">Silencio</span>
                  </>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={onToggleMinimize}
              className="w-8 h-8 rounded-lg bg-[#171717] hover:bg-[#242424] border border-[#303030] text-zinc-300 flex items-center justify-center transition-colors cursor-pointer"
              title="Minimizar temporizador"
            >
              <Minimize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onStop}
              className="w-8 h-8 rounded-lg bg-[#171717] hover:bg-[#EF4444]/20 border border-[#303030] hover:border-[#EF4444]/50 text-zinc-400 hover:text-[#EF4444] flex items-center justify-center transition-colors cursor-pointer"
              title="Cerrar temporizador"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-[#171717] rounded-full overflow-hidden mb-3 border border-[#303030]/60">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              timer.paused
                ? 'bg-[#FACC15]'
                : isFinalCountdown
                ? 'bg-[#EF4444]'
                : 'bg-accent'
            }`}
            style={{ width: `${100 - progressPct}%` }}
          />
        </div>

        {/* Main Countdown & Controls Grid */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Countdown Readout (MM:SS + segundos totales simultáneos) */}
          <div className="flex flex-col pl-1 font-mono tabular-nums">
            <div className="flex items-baseline gap-1.5">
              <span
                className={`text-3xl font-black tracking-tight leading-none ${
                  timer.paused
                    ? 'text-[#FACC15]'
                    : isFinalCountdown
                    ? 'text-[#EF4444]'
                    : 'text-[#F5F5F5]'
                }`}
              >
                {formattedTime}
              </span>
              <span className="text-xs font-bold text-zinc-300">
                ({displaySec} s)
              </span>
            </div>
            <span className="text-[10px] text-zinc-400 mt-0.5">
              Meta {formatRestMmSs(timer.totalSeconds)} ({timer.totalSeconds} s)
            </span>
          </div>

          {/* Right: Action Buttons (-15s, +15s, +30s, Pause/Resume, Restart, Skip) */}
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <button
              type="button"
              onClick={() => onAdjust(-15)}
              className="min-h-[36px] px-2 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-300 text-[11px] font-mono font-bold flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer"
              title="Restar 15 segundos"
            >
              <Minus className="w-3 h-3" />
              <span>15s</span>
            </button>

            <button
              type="button"
              onClick={() => onAdjust(15)}
              className="min-h-[36px] px-2 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-accent-text text-[11px] font-mono font-bold flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer"
              title="Sumar 15 segundos"
            >
              <Plus className="w-3 h-3" />
              <span>15s</span>
            </button>

            <button
              type="button"
              onClick={() => onAdjust(30)}
              className="min-h-[36px] px-2 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-accent-text text-[11px] font-mono font-bold hidden xs:flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer"
              title="Sumar 30 segundos"
            >
              <Plus className="w-3 h-3" />
              <span>30s</span>
            </button>

            {onPause && onResume && (
              <button
                type="button"
                onClick={() => (timer.paused ? onResume() : onPause())}
                className={`min-h-[36px] w-9 rounded-lg border flex items-center justify-center active:scale-95 transition-all cursor-pointer ${
                  timer.paused
                    ? 'bg-accent/20 border-accent text-accent-text'
                    : 'bg-[#171717] border-[#303030] text-[#F5F5F5] hover:border-zinc-500'
                }`}
                title={timer.paused ? 'Reanudar' : 'Pausar'}
              >
                {timer.paused ? (
                  <Play className="w-3.5 h-3.5 fill-current" />
                ) : (
                  <Pause className="w-3.5 h-3.5" />
                )}
              </button>
            )}

            {onRestart && (
              <button
                type="button"
                onClick={onRestart}
                className="min-h-[36px] w-9 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-300 flex items-center justify-center active:scale-95 transition-all cursor-pointer"
                title="Reiniciar descanso"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={onStop}
              className="min-h-[36px] px-3 rounded-lg bg-accent hover:bg-accent-hover text-accent-contrast font-black text-[11px] uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all cursor-pointer shadow-sm"
              title="Saltar descanso y continuar serie"
            >
              <span>Saltar</span>
              <SkipForward className="w-3.5 h-3.5 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
