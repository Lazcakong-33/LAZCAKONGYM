import React from 'react';

interface MuscleHeatmapManagerProps {
  selectedMuscle?: string | null;
  onSelectMuscle?: (id: any) => void;
  muscleData?: Record<string, { volume: number; sets: number; status: string }>;
  [key: string]: any;
}

export const MuscleHeatmapManager: React.FC<MuscleHeatmapManagerProps> = ({
  selectedMuscle,
  onSelectMuscle,
  muscleData = {}
}) => {
  return (
    <div className="w-full bg-slate-900/40 border border-slate-800 rounded-3xl p-4 sm:p-6 my-4 shadow-xl">
      <div className="text-center mb-4">
        <span className="text-[10px] uppercase tracking-widest text-emerald-400 font-semibold block mb-1">
          ANALYTICAL HEATMAP • VOLUME & RECOVERY
        </span>
        <h3 className="text-lg font-bold text-white">MAPA DE CALOR MUSCULAR</h3>
        <p className="text-xs text-slate-400">Distribución de carga semanal</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div 
          onClick={() => onSelectMuscle?.('pectoral')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
            selectedMuscle === 'pectoral' ? 'bg-accent/15 border-accent/60' : 'bg-[#171717] border-[#303030] hover:border-accent/30'
          }`}
        >
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Pectoral</span>
          <span className="text-lg font-mono tabular-nums text-white font-bold mt-2">
            {muscleData['pectoral']?.sets !== undefined ? `${muscleData['pectoral'].sets} series` : 'Sin registros'}
          </span>
          <span className="text-[10px] text-accent-text mt-1 uppercase tracking-wider font-mono">
            {muscleData['pectoral']?.sets ? 'Serie Real Registrada' : 'Sin datos recientes'}
          </span>
        </div>

        <div 
          onClick={() => onSelectMuscle?.('cuadriceps')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
            selectedMuscle === 'cuadriceps' ? 'bg-accent/15 border-accent/60' : 'bg-[#171717] border-[#303030] hover:border-accent/30'
          }`}
        >
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Cuádriceps</span>
          <span className="text-lg font-mono tabular-nums text-white font-bold mt-2">
            {muscleData['cuadriceps']?.sets !== undefined ? `${muscleData['cuadriceps'].sets} series` : 'Sin registros'}
          </span>
          <span className="text-[10px] text-accent-text mt-1 uppercase tracking-wider font-mono">
            {muscleData['cuadriceps']?.sets ? 'Serie Real Registrada' : 'Sin datos recientes'}
          </span>
        </div>

        <div 
          onClick={() => onSelectMuscle?.('dorsal')}
          className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
            selectedMuscle === 'dorsal' ? 'bg-accent/15 border-accent/60' : 'bg-[#171717] border-[#303030] hover:border-accent/30'
          }`}
        >
          <span className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Dorsal / Espalda</span>
          <span className="text-lg font-mono tabular-nums text-white font-bold mt-2">
            {muscleData['dorsal']?.sets !== undefined ? `${muscleData['dorsal'].sets} series` : 'Sin registros'}
          </span>
          <span className="text-[10px] text-accent-text mt-1 uppercase tracking-wider font-mono">
            {muscleData['dorsal']?.sets ? 'Serie Real Registrada' : 'Sin datos recientes'}
          </span>
        </div>
      </div>
    </div>
  );
};
