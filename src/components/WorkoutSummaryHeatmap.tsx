import React, { useState, useMemo } from 'react';
import { 
  Flame, 
  Dumbbell, 
  Activity, 
  Clock, 
  ShieldAlert, 
  CheckCircle2,
  TrendingUp,
  BarChart3
} from 'lucide-react';

export type MuscleId =
  | 'chest_left' | 'chest_right'
  | 'abs'
  | 'deltoid_front_left' | 'deltoid_front_right'
  | 'biceps_left' | 'biceps_right'
  | 'triceps_lateral_left' | 'triceps_lateral_right'
  | 'quad_left' | 'quad_right'
  | 'calves_front_left' | 'calves_front_right'
  | 'traps_lats'
  | 'triceps_back_left' | 'triceps_back_right'
  | 'glutes'
  | 'hamstrings_left' | 'hamstrings_right'
  | 'calves_back_left' | 'calves_back_right';

export interface CompletedSet {
  reps: number;
  weightKg: number;
  rpe: number; // 6 a 10 (10 = fallo)
}

export interface WorkoutExerciseLog {
  exerciseName: string;
  primaryMuscle: MuscleId;
  secondaryMuscles?: MuscleId[];
  sets: CompletedSet[];
}

export interface MuscleFatigueStatus {
  muscleId: MuscleId;
  label: string;
  group: 'front' | 'back';
  fatiguePercent: number;
  recoveryHours: number;
  setsCompleted: number;
  totalVolumeKg: number;
  statusText: 'Descansado' | 'Carga Ligera' | 'Fatiga Óptima' | 'Sobrecarga Alta';
  colorCode: string;
}

const ANATOMY_REGISTRY: Record<MuscleId, { name: string; group: 'front' | 'back'; description: string; exercises: string[] }> = {
  chest_left: { name: 'Pectoral Izquierdo', group: 'front', description: 'Pectoral mayor y menor. Involucrado en press de banca y aperturas.', exercises: ['Press de Banca', 'Aperturas'] },
  chest_right: { name: 'Pectoral Derecho', group: 'front', description: 'Pectoral mayor y menor. Involucrado en press de banca y aperturas.', exercises: ['Press de Banca', 'Aperturas'] },
  abs: { name: 'Core / Abdomen', group: 'front', description: 'Recto abdominal y oblicuos. Estabilidad central.', exercises: ['Elevación de piernas', 'Crunch en polea'] },
  deltoid_front_left: { name: 'Deltoides Frontal Izq.', group: 'front', description: 'Haces anteriores del hombro.', exercises: ['Press militar', 'Elevaciones frontales'] },
  deltoid_front_right: { name: 'Deltoides Frontal Der.', group: 'front', description: 'Haces anteriores del hombro.', exercises: ['Press militar', 'Elevaciones frontales'] },
  biceps_left: { name: 'Bíceps Izquierdo', group: 'front', description: 'Flexores del codo.', exercises: ['Curl con barra Z', 'Curl martillo'] },
  biceps_right: { name: 'Bíceps Derecho', group: 'front', description: 'Flexores del codo.', exercises: ['Curl con barra Z', 'Curl martillo'] },
  triceps_lateral_left: { name: 'Tríceps Lateral Izq.', group: 'front', description: 'Cabeza lateral exterior del tríceps.', exercises: ['Extensiones en polea', 'Press cerrado'] },
  triceps_lateral_right: { name: 'Tríceps Lateral Der.', group: 'front', description: 'Cabeza lateral exterior del tríceps.', exercises: ['Extensiones en polea', 'Press cerrado'] },
  quad_left: { name: 'Cuádriceps Izquierdo', group: 'front', description: 'Extensores de rodilla.', exercises: ['Sentadilla trasera', 'Prensa 45°'] },
  quad_right: { name: 'Cuádriceps Derecho', group: 'front', description: 'Extensores de rodilla.', exercises: ['Sentadilla trasera', 'Prensa 45°'] },
  calves_front_left: { name: 'Gemelo / Tibial Izq.', group: 'front', description: 'Zona anterior y tibial.', exercises: ['Elevación de talones'] },
  calves_front_right: { name: 'Gemelo / Tibial Der.', group: 'front', description: 'Zona anterior y tibial.', exercises: ['Elevación de talones'] },

  traps_lats: { name: 'Trapecios y Dorsales', group: 'back', description: 'Dorsal ancho, trapecios y romboides en silueta V.', exercises: ['Dominadas', 'Remo con barra', 'Jalón al pecho'] },
  triceps_back_left: { name: 'Tríceps Posterior Izq.', group: 'back', description: 'Cabezas medial y larga del tríceps.', exercises: ['Press francés', 'Copa a dos manos'] },
  triceps_back_right: { name: 'Tríceps Posterior Der.', group: 'back', description: 'Cabezas medial y larga del tríceps.', exercises: ['Press francés', 'Copa a dos manos'] },
  glutes: { name: 'Glúteos', group: 'back', description: 'Glúteo mayor y medio.', exercises: ['Hip Thrust', 'Sentadilla profunda'] },
  hamstrings_left: { name: 'Isquios / Femoral Izq.', group: 'back', description: 'Flexores de rodilla posteriores.', exercises: ['Peso muerto rumano (RDL)', 'Curl femoral'] },
  hamstrings_right: { name: 'Isquios / Femoral Der.', group: 'back', description: 'Flexores de rodilla posteriores.', exercises: ['Peso muerto rumano (RDL)', 'Curl femoral'] },
  calves_back_left: { name: 'Gemelos Posteriores Izq.', group: 'back', description: 'Gastrocnemio y sóleo posterior.', exercises: ['Elevación de talones de pie'] },
  calves_back_right: { name: 'Gemelos Posteriores Der.', group: 'back', description: 'Gastrocnemio y sóleo posterior.', exercises: ['Elevación de talones de pie'] },
};

interface WorkoutSummaryHeatmapProps {
  imageSrc: string; // Ruta a 'mapa interactivo.jpg'
  workoutLogs: WorkoutExerciseLog[];
  onFinishReview?: () => void;
}

export const WorkoutSummaryHeatmap: React.FC<WorkoutSummaryHeatmapProps> = ({
  imageSrc,
  workoutLogs = [],
  onFinishReview,
}) => {
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleId>('chest_left');
  const [hoveredMuscle, setHoveredMuscle] = useState<MuscleId | null>(null);

  // Calculate fatigue report from workoutLogs
  const fatigueReport = useMemo(() => {
    const report: Record<MuscleId, MuscleFatigueStatus> = {} as any;

    (Object.keys(ANATOMY_REGISTRY) as MuscleId[]).forEach((mId) => {
      report[mId] = {
        muscleId: mId,
        label: ANATOMY_REGISTRY[mId].name,
        group: ANATOMY_REGISTRY[mId].group,
        fatiguePercent: 0,
        recoveryHours: 0,
        setsCompleted: 0,
        totalVolumeKg: 0,
        statusText: 'Descansado',
        colorCode: 'rgba(113, 113, 122, 0.15)', // #71717A reposo
      };
    });

    workoutLogs.forEach((log) => {
      const primary = log.primaryMuscle;
      const setsCount = log.sets.length;
      let vol = 0;
      let rpeSum = 0;

      log.sets.forEach((set) => {
        vol += set.reps * set.weightKg;
        rpeSum += set.rpe;
      });

      const avgRpe = setsCount > 0 ? rpeSum / setsCount : 8;

      if (report[primary]) {
        report[primary].setsCompleted += setsCount;
        report[primary].totalVolumeKg += vol;
        const fatigue = Math.min(100, Math.round(setsCount * (avgRpe / 8) * 14));
        report[primary].fatiguePercent = Math.max(report[primary].fatiguePercent, fatigue);
      }

      // Secondary muscles get 50% impact
      log.secondaryMuscles?.forEach((sec) => {
        if (report[sec]) {
          report[sec].setsCompleted += Math.round(setsCount * 0.5);
          report[sec].totalVolumeKg += Math.round(vol * 0.5);
          const fatigue = Math.min(100, Math.round(setsCount * 0.5 * (avgRpe / 8) * 14));
          report[sec].fatiguePercent = Math.max(report[sec].fatiguePercent, fatigue);
        }
      });
    });

    // Assign status, recovery hours, and thermal colors
    Object.keys(report).forEach((k) => {
      const mId = k as MuscleId;
      const f = report[mId].fatiguePercent;

      if (f > 70) {
        report[mId].statusText = 'Sobrecarga Alta';
        report[mId].recoveryHours = 72;
        report[mId].colorCode = '#FF3B30'; // Rojo
      } else if (f >= 35) {
        report[mId].statusText = 'Fatiga Óptima';
        report[mId].recoveryHours = 48;
        report[mId].colorCode = '#CCFF00'; // Lima neón
      } else if (f > 0) {
        report[mId].statusText = 'Carga Ligera';
        report[mId].recoveryHours = 24;
        report[mId].colorCode = '#00F0FF'; // Cian
      } else {
        report[mId].statusText = 'Descansado';
        report[mId].recoveryHours = 0;
        report[mId].colorCode = 'rgba(113, 113, 122, 0.15)';
      }
    });

    return report;
  }, [workoutLogs]);

  const activeMeta = ANATOMY_REGISTRY[selectedMuscle];
  const activeFatigue = fatigueReport[selectedMuscle] || {
    fatiguePercent: 0,
    recoveryHours: 0,
    setsCompleted: 0,
    totalVolumeKg: 0,
    statusText: 'Descansado',
  };

  const getPathStyle = (id: MuscleId) => {
    const isSelected = selectedMuscle === id;
    const isHovered = hoveredMuscle === id;
    const data = fatigueReport[id];
    const f = data ? data.fatiguePercent : 0;

    if (isSelected) {
      return {
        fill: '#CCFF00',
        fillOpacity: 0.55,
        stroke: '#CCFF00',
        strokeWidth: '2.5',
        filter: 'drop-shadow(0 0 12px rgba(204,255,0,0.8))',
        cursor: 'pointer',
      };
    }
    if (isHovered) {
      return {
        fill: '#00F0FF',
        fillOpacity: 0.4,
        stroke: '#00F0FF',
        strokeWidth: '2',
        filter: 'drop-shadow(0 0 8px rgba(0,240,255,0.6))',
        cursor: 'pointer',
      };
    }
    if (f > 70) {
      return { fill: '#FF3B30', fillOpacity: 0.5, stroke: '#FF6961', strokeWidth: '1.5', filter: 'drop-shadow(0 0 8px rgba(255,59,48,0.6))', cursor: 'pointer' };
    }
    if (f >= 35) {
      return { fill: '#CCFF00', fillOpacity: 0.45, stroke: '#E6FF66', strokeWidth: '1.5', filter: 'drop-shadow(0 0 8px rgba(204,255,0,0.5))', cursor: 'pointer' };
    }
    if (f > 0) {
      return { fill: '#00F0FF', fillOpacity: 0.35, stroke: '#66F5FF', strokeWidth: '1.5', filter: 'drop-shadow(0 0 6px rgba(0,240,255,0.4))', cursor: 'pointer' };
    }
    return { fill: 'transparent', fillOpacity: 0, stroke: 'transparent', strokeWidth: '1', filter: 'none', cursor: 'pointer' };
  };

  return (
    <div className="w-full max-w-6xl mx-auto bg-[#070A0F] rounded-3xl border border-zinc-800 p-6 shadow-2xl space-y-6 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#CCFF00] animate-pulse" />
            <span className="text-[10px] font-mono font-black uppercase tracking-widest text-[#CCFF00]">
              POST-WORKOUT TELEMETRY • FATIGUE MAPPING
            </span>
          </div>
          <h2 className="text-xl md:text-2xl font-black text-white tracking-tight mt-1">
            MAPA DE CALOR Y FATIGA MUSCULAR
          </h2>
        </div>
        {onFinishReview && (
          <button
            onClick={onFinishReview}
            className="px-4 py-2 rounded-xl bg-[#CCFF00] text-zinc-950 font-black text-xs hover:bg-[#b3e600] transition-colors flex items-center gap-2 shadow-lg shadow-[#CCFF00]/20"
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>Finalizar Revisión</span>
          </button>
        )}
      </div>

      {/* Main Grid: Visualizer + Telemetry Drawer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Anatomical Canvas */}
        <div className="col-span-1 lg:col-span-7 flex flex-col items-center justify-center bg-[#05080c] p-4 rounded-3xl border border-zinc-900 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-15 pointer-events-none" />
          
          <div className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-[#070A0F] border border-zinc-800/80 shadow-2xl flex items-center justify-center">
            {/* Background static image */}
            <img
              src={imageSrc}
              alt="Mapa Interactivo Anatomía"
              className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
            />

            {/* SVG Interactive Overlay */}
            <svg
              className="absolute inset-0 w-full h-full z-10"
              viewBox="0 0 1000 750"
              preserveAspectRatio="none"
            >
              {/* =====================================================
                  1. VISTA FRONTAL (Izquierda: X 0 a 500)
                 ===================================================== */}
              
              {/* Pectoral Izquierdo */}
              <path
                d="M 252 225 Q 215 220 185 242 Q 178 288 245 288 Q 252 260 252 225 Z"
                style={getPathStyle('chest_left')}
                onMouseEnter={() => setHoveredMuscle('chest_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('chest_left')}
              />
              {/* Pectoral Derecho */}
              <path
                d="M 258 225 Q 295 220 325 242 Q 332 288 265 288 Q 258 260 258 225 Z"
                style={getPathStyle('chest_right')}
                onMouseEnter={() => setHoveredMuscle('chest_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('chest_right')}
              />
              {/* Abdomen / Core */}
              <path
                d="M 226 292 L 284 292 L 278 405 Q 255 425 232 405 Z"
                style={getPathStyle('abs')}
                onMouseEnter={() => setHoveredMuscle('abs')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('abs')}
              />
              {/* Deltoides Frontal Izquierdo */}
              <path
                d="M 180 230 Q 148 242 144 285 Q 166 295 182 265 Z"
                style={getPathStyle('deltoid_front_left')}
                onMouseEnter={() => setHoveredMuscle('deltoid_front_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('deltoid_front_left')}
              />
              {/* Deltoides Frontal Derecho */}
              <path
                d="M 330 230 Q 362 242 366 285 Q 344 295 328 265 Z"
                style={getPathStyle('deltoid_front_right')}
                onMouseEnter={() => setHoveredMuscle('deltoid_front_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('deltoid_front_right')}
              />
              {/* Bíceps Izquierdo */}
              <path
                d="M 145 285 Q 135 340 162 365 Q 175 325 168 285 Z"
                style={getPathStyle('biceps_left')}
                onMouseEnter={() => setHoveredMuscle('biceps_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('biceps_left')}
              />
              {/* Bíceps Derecho */}
              <path
                d="M 365 285 Q 375 340 348 365 Q 335 325 342 285 Z"
                style={getPathStyle('biceps_right')}
                onMouseEnter={() => setHoveredMuscle('biceps_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('biceps_right')}
              />
              {/* Tríceps Lateral Izquierdo */}
              <path
                d="M 130 290 Q 120 335 142 365 Q 150 330 138 290 Z"
                style={getPathStyle('triceps_lateral_left')}
                onMouseEnter={() => setHoveredMuscle('triceps_lateral_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('triceps_lateral_left')}
              />
              {/* Tríceps Lateral Derecho */}
              <path
                d="M 380 290 Q 390 335 368 365 Q 360 330 372 290 Z"
                style={getPathStyle('triceps_lateral_right')}
                onMouseEnter={() => setHoveredMuscle('triceps_lateral_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('triceps_lateral_right')}
              />
              {/* Cuádriceps Izquierdo */}
              <path
                d="M 200 415 Q 170 470 188 565 Q 235 565 238 460 Q 235 418 200 415 Z"
                style={getPathStyle('quad_left')}
                onMouseEnter={() => setHoveredMuscle('quad_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('quad_left')}
              />
              {/* Cuádriceps Derecho */}
              <path
                d="M 310 415 Q 340 470 322 565 Q 275 565 272 460 Q 275 418 310 415 Z"
                style={getPathStyle('quad_right')}
                onMouseEnter={() => setHoveredMuscle('quad_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('quad_right')}
              />
              {/* Gemelo Frontal Izquierdo */}
              <path
                d="M 175 585 Q 165 640 182 680 Q 202 640 198 585 Z"
                style={getPathStyle('calves_front_left')}
                onMouseEnter={() => setHoveredMuscle('calves_front_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('calves_front_left')}
              />
              {/* Gemelo Frontal Derecho */}
              <path
                d="M 335 585 Q 345 640 328 680 Q 308 640 312 585 Z"
                style={getPathStyle('calves_front_right')}
                onMouseEnter={() => setHoveredMuscle('calves_front_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('calves_front_right')}
              />

              {/* =====================================================
                  2. VISTA DORSAL (Derecha: X 500 a 1000)
                 ===================================================== */}

              {/* Trapecios y Dorsales */}
              <path
                d="M 745 155 Q 710 185 675 225 Q 675 285 690 380 Q 745 425 745 425 Q 745 425 800 380 Q 815 285 815 225 Q 780 185 745 155 Z"
                style={getPathStyle('traps_lats')}
                onMouseEnter={() => setHoveredMuscle('traps_lats')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('traps_lats')}
              />
              {/* Tríceps Posterior Izquierdo */}
              <path
                d="M 640 250 Q 625 310 655 355 Q 670 310 655 250 Z"
                style={getPathStyle('triceps_back_left')}
                onMouseEnter={() => setHoveredMuscle('triceps_back_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('triceps_back_left')}
              />
              {/* Tríceps Posterior Derecho */}
              <path
                d="M 850 250 Q 865 310 835 355 Q 820 310 835 250 Z"
                style={getPathStyle('triceps_back_right')}
                onMouseEnter={() => setHoveredMuscle('triceps_back_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('triceps_back_right')}
              />
              {/* Glúteos */}
              <path
                d="M 688 395 Q 675 470 745 475 Q 815 470 802 395 Q 745 420 688 395 Z"
                style={getPathStyle('glutes')}
                onMouseEnter={() => setHoveredMuscle('glutes')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('glutes')}
              />
              {/* Isquios / Femorales Izquierdo */}
              <path
                d="M 685 475 Q 670 540 690 565 Q 725 565 735 480 Z"
                style={getPathStyle('hamstrings_left')}
                onMouseEnter={() => setHoveredMuscle('hamstrings_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('hamstrings_left')}
              />
              {/* Isquios / Femorales Derecho */}
              <path
                d="M 805 475 Q 820 540 800 565 Q 765 565 755 480 Z"
                style={getPathStyle('hamstrings_right')}
                onMouseEnter={() => setHoveredMuscle('hamstrings_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('hamstrings_right')}
              />
              {/* Gemelos Posteriores Izquierdo */}
              <path
                d="M 670 575 Q 652 645 682 685 Q 705 645 700 575 Z"
                style={getPathStyle('calves_back_left')}
                onMouseEnter={() => setHoveredMuscle('calves_back_left')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('calves_back_left')}
              />
              {/* Gemelos Posteriores Derecho */}
              <path
                d="M 820 575 Q 838 645 808 685 Q 785 645 790 575 Z"
                style={getPathStyle('calves_back_right')}
                onMouseEnter={() => setHoveredMuscle('calves_back_right')}
                onMouseLeave={() => setHoveredMuscle(null)}
                onClick={() => setSelectedMuscle('calves_back_right')}
              />
            </svg>
          </div>

          {/* Thermal Legend */}
          <div className="w-full mt-4 pt-4 border-t border-zinc-800/80 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-zinc-400">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#71717A]" />
                <span>Reposo</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#00F0FF]" />
                <span>Carga Ligera (1-34%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#CCFF00]" />
                <span>Óptimo (35-70%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#FF3B30]" />
                <span>Sobrecarga (&gt;70%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Telemetry & Fatigue Inspection Drawer */}
        <div className="col-span-1 lg:col-span-5 flex flex-col justify-between bg-[#0b101f] p-6 rounded-3xl border border-zinc-800 space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider block">
                  {activeMeta.group === 'front' ? 'VISTA FRONTAL' : 'VISTA DORSAL'} • {selectedMuscle}
                </span>
                <h3 className="text-xl font-black text-white mt-0.5">{activeMeta.name}</h3>
              </div>
              <span className="px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-cyan-400">
                {activeFatigue.statusText}
              </span>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed bg-[#070A0F] p-3.5 rounded-2xl border border-zinc-800">
              {activeMeta.description}
            </p>

            {/* Fatigue Gauge & Progress */}
            <div className="space-y-2 bg-[#070A0F] p-4 rounded-2xl border border-zinc-800">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400 flex items-center gap-1.5">
                  <Flame className="w-4 h-4 text-amber-400" />
                  <span>Fatigue Score</span>
                </span>
                <span className="font-black text-amber-400 text-sm">{activeFatigue.fatiguePercent}%</span>
              </div>
              <div className="w-full bg-zinc-900 rounded-full h-2.5 overflow-hidden border border-zinc-800">
                <div 
                  className="h-full transition-all duration-500 rounded-full" 
                  style={{ 
                    width: `${activeFatigue.fatiguePercent}%`,
                    backgroundColor: activeFatigue.colorCode === 'rgba(113, 113, 122, 0.15)' ? '#71717A' : activeFatigue.colorCode
                  }}
                />
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-[#070A0F] border border-zinc-800 text-center font-mono">
                <span className="text-[10px] uppercase text-zinc-400 block">Series Realizadas</span>
                <span className="text-xl font-black text-[#CCFF00] mt-0.5 block">
                  {activeFatigue.setsCompleted} <span className="text-xs text-zinc-400 font-normal">series</span>
                </span>
              </div>
              <div className="p-3.5 rounded-2xl bg-[#070A0F] border border-zinc-800 text-center font-mono">
                <span className="text-[10px] uppercase text-zinc-400 block">Volumen Total</span>
                <span className="text-xl font-black text-cyan-400 mt-0.5 block">
                  {activeFatigue.totalVolumeKg.toLocaleString()} <span className="text-xs text-zinc-400 font-normal">kg</span>
                </span>
              </div>
            </div>

            {/* Recovery & Rest Time */}
            <div className="p-3.5 rounded-2xl bg-[#070A0F] border border-zinc-800 flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-2 text-zinc-300">
                <Clock className="w-4 h-4 text-cyan-400" />
                <span>Descanso Estimado:</span>
              </div>
              <span className="font-bold text-white bg-zinc-900 px-3 py-1 rounded-xl border border-zinc-800">
                {activeFatigue.recoveryHours} Horas
              </span>
            </div>

            {/* Suggested Exercises */}
            <div className="space-y-2">
              <h4 className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                <Dumbbell className="w-4 h-4 text-cyan-400" />
                <span>Ejercicios Asociados</span>
              </h4>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {activeMeta.exercises.map((ex, idx) => (
                  <div key={idx} className="p-2.5 rounded-xl bg-[#070A0F] border border-zinc-800 text-xs font-mono text-white flex items-center justify-between">
                    <span>{ex}</span>
                    <span className="text-cyan-400 text-[10px]">Asociado</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
