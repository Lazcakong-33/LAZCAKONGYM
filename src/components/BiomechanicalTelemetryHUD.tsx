import React, { useEffect, useRef, useState } from 'react';
import { MuscleRecoveryState, BiometricMuscleId } from '../utils/muscleRecoveryEngine';
import { Activity, Layers } from 'lucide-react';

interface BiomechanicalTelemetryHUDProps {
  fatigueReport: Record<BiometricMuscleId, MuscleRecoveryState>;
  selectedMuscle: BiometricMuscleId | null;
  onSelectMuscle: (id: BiometricMuscleId) => void;
  scopeLabel?: string;
}

export const BiomechanicalTelemetryHUD: React.FC<BiomechanicalTelemetryHUDProps> = ({
  fatigueReport,
  selectedMuscle,
  onSelectMuscle,
  scopeLabel = 'Toda la Semana',
}) => {
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlightedMuscleId, setHighlightedMuscleId] = useState<BiometricMuscleId | null>(null);

  useEffect(() => {
    if (selectedMuscle && cardRefs.current[selectedMuscle]) {
      cardRefs.current[selectedMuscle]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedMuscleId(selectedMuscle);
      const timer = setTimeout(() => {
        setHighlightedMuscleId((curr) => (curr === selectedMuscle ? null : curr));
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [selectedMuscle]);

  const mainMuscleKeys: { id: BiometricMuscleId; name: string }[] = [
    { id: 'chest_left', name: 'Pectoral Mayor' },
    { id: 'traps_lats', name: 'Dorsal Ancho' },
    { id: 'quad_left', name: 'Cuádriceps' },
    { id: 'hamstrings_left', name: 'Isquiosurales / Femorales' },
    { id: 'glutes', name: 'Glúteos' },
    { id: 'deltoid_front_left', name: 'Deltoides (Hombros)' },
    { id: 'biceps_left', name: 'Bíceps' },
    { id: 'triceps_lateral_left', name: 'Tríceps' },
    { id: 'calves_back_left', name: 'Gemelos / Pantorrillas' },
    { id: 'abs', name: 'Abdomen / Core' },
  ];

  return (
    <div className="p-5 rounded-3xl bg-[#070A0F] border border-zinc-800 shadow-2xl space-y-4 font-sans">
      {/* HUD Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
        <div>
          <span className="text-[10px] font-mono text-[#00F0FF] uppercase tracking-widest block">
            ESTADO BIOMECÁNICO &amp; VOLUMEN DE SERIES ({scopeLabel.toUpperCase()})
          </span>
          <h3 className="text-sm font-black text-white font-mono tracking-wide uppercase">
            CONSOLA OLED • LISTADO AUTÓNOMO POR MÚSCULO
          </h3>
        </div>
        <div className="text-xs font-mono text-zinc-400">
          Total Zonas Monitoreadas: <strong className="text-accent-text">{mainMuscleKeys.length}</strong>
        </div>
      </div>

      {/* Autonomous Cards Carousel */}
      <div className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-4 hide-scrollbar w-full">
        {mainMuscleKeys.map((item) => {
          const report = fatigueReport[item.id] || {
            fatigue: 0,
            recoveryPercentage: 100,
            status: 'Reposo / Listo',
            statusColor: '#38BDF8',
            badgeClass: 'bg-cyan-500/20 text-[#38BDF8] border-cyan-500/40',
            volume: 0,
            sets: 0,
            remainingHours: 0,
          };

          const isSelected = selectedMuscle === item.id;
          const isHighlighted = highlightedMuscleId === item.id;
          const rem = report.remainingHours;
          const remH = Math.floor(rem);
          const remM = Math.round((rem - remH) * 60);
          const countdownText =
            report.fatigue === 0 || rem <= 0
              ? 'FIBRAS REGENERADAS • LISTO'
              : `LISTO EN: [${remH}h ${remM}m]`;

          const barColor =
            report.statusColor && report.statusColor !== 'transparent'
              ? report.statusColor
              : '#38BDF8';

          return (
            <div
              key={item.id}
              ref={(el) => {
                cardRefs.current[item.id] = el;
              }}
              onClick={() => onSelectMuscle(item.id)}
              className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-3.5 bg-[#0b101d] min-w-[280px] snap-center shrink-0 ${
                isHighlighted || isSelected
                  ? 'border-accent shadow-[0_0_20px_var(--accent-glow)] bg-zinc-900/80'
                  : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              {/* Card Header */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                  {item.name}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-zinc-900 border border-zinc-700 text-[10px] font-mono font-black text-accent-text">
                    <Layers className="w-3 h-3" />
                    {report.sets || 0} series
                  </span>
                  <span
                    className={`px-2.5 py-1 rounded-full border text-[9px] font-mono font-bold uppercase ${report.badgeClass}`}
                  >
                    {report.status}
                  </span>
                </div>
              </div>

              {/* Prominent Biologic Countdown */}
              <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between font-mono">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-accent-text" />
                  <span className="text-[10px] text-zinc-400 uppercase">Cronómetro:</span>
                </div>
                <span
                  className="text-xs sm:text-sm font-black tracking-wider"
                  style={{ color: barColor }}
                >
                  {countdownText}
                </span>
              </div>

              {/* Cellular Metrics & Progress Bar */}
              <div className="space-y-1.5 font-mono">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-400">
                    Recuperación Celular: {report.recoveryPercentage}%
                  </span>
                  <span className="text-zinc-300">
                    Vol: {(report.volume || 0).toLocaleString('es-CL')} kg
                  </span>
                </div>
                <div className="w-full bg-zinc-950 rounded-full h-2 overflow-hidden border border-zinc-800">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${report.recoveryPercentage}%`,
                      backgroundColor: barColor,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
