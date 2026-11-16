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
} from 'lucide-react';
import { RestTimerState } from '../types';

interface RestTimerWidgetProps {
  timer: RestTimerState;
  onStop: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onRestart?: () => void;
  onAdjust: (deltaSeconds: number) => void;
  onToggleMinimize: () => void;
}

export const RestTimerWidget: React.FC<RestTimerWidgetProps> = ({
  timer,
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

  if (!timer.active) return null;

  const displaySec = timer.paused ? timer.remainingSeconds : liveRemaining;
  const mins = Math.floor(displaySec / 60);
  const secs = displaySec % 60;
  const formattedTime = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

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
            : 'bg-[#090909]/95 border-[#CCFF00]/60 text-[#F5F5F5] shadow-[#CCFF00]/15'
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
                : 'bg-[#CCFF00] animate-pulse'
            }`}
          />
          <div>
            <span className="block text-[9px] font-black uppercase tracking-widest text-zinc-400 leading-none">
              {timer.paused ? 'PAUSADO' : 'DESCANSO'}
            </span>
            <span
              className={`font-mono font-black text-base tabular-nums tracking-tight ${
                timer.paused
                  ? 'text-[#FACC15]'
                  : isFinalCountdown
                  ? 'text-[#EF4444]'
                  : 'text-[#CCFF00]'
              }`}
            >
              {formattedTime}
            </span>
          </div>
          <Maximize2 className="w-3.5 h-3.5 text-zinc-400 ml-1" />
        </button>

        {onPause && onResume && (
          <button
            type="button"
            onClick={() => (timer.paused ? onResume() : onPause())}
            className="w-8 h-8 rounded-xl bg-[#171717] border border-[#303030] hover:border-[#CCFF00]/50 flex items-center justify-center text-[#F5F5F5] transition-colors cursor-pointer"
            title={timer.paused ? 'Reanudar descanso' : 'Pausar descanso'}
          >
            {timer.paused ? (
              <Play className="w-3.5 h-3.5 text-[#CCFF00] fill-[#CCFF00]" />
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
            : 'bg-[#090909]/95 border-[#CCFF00]/50'
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
                  : 'bg-[#CCFF00]/15 border-[#CCFF00]/40 text-[#CCFF00]'
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
                      : 'text-[#CCFF00]'
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
                : 'bg-[#CCFF00]'
            }`}
            style={{ width: `${100 - progressPct}%` }}
          />
        </div>

        {/* Main Countdown & Controls Grid */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Countdown Readout */}
          <div className="flex items-baseline gap-1.5 pl-1">
            <span
              className={`text-3xl font-black font-mono tabular-nums tracking-tight leading-none ${
                timer.paused
                  ? 'text-[#FACC15]'
                  : isFinalCountdown
                  ? 'text-[#EF4444]'
                  : 'text-[#F5F5F5]'
              }`}
            >
              {formattedTime}
            </span>
            <span className="text-[10px] font-mono text-zinc-500">
              / {Math.floor(timer.totalSeconds / 60)}:
              {(timer.totalSeconds % 60).toString().padStart(2, '0')}
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
              className="min-h-[36px] px-2 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-[#CCFF00] text-[11px] font-mono font-bold flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer"
              title="Sumar 15 segundos"
            >
              <Plus className="w-3 h-3" />
              <span>15s</span>
            </button>

            <button
              type="button"
              onClick={() => onAdjust(30)}
              className="min-h-[36px] px-2 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-[#CCFF00] text-[11px] font-mono font-bold hidden xs:flex items-center gap-0.5 active:scale-95 transition-all cursor-pointer"
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
                    ? 'bg-[#CCFF00]/20 border-[#CCFF00] text-[#CCFF00]'
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
              className="min-h-[36px] px-3 rounded-lg bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-[11px] uppercase tracking-wider flex items-center gap-1 active:scale-95 transition-all cursor-pointer shadow-sm"
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
