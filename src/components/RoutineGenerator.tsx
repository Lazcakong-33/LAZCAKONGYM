import React, { useState } from 'react';
import { 
  Sparkles, 
  Dumbbell, 
  Clock, 
  Flame, 
  Target, 
  Layers, 
  CheckCircle2, 
  RotateCcw,
  Zap,
  ShieldCheck,
  ChevronRight,
  BookmarkPlus
} from 'lucide-react';
import { Routine, Exercise } from '../types';

export type TrainingGoal = 'hipertrofia' | 'fuerza_maxima' | 'resistencia' | 'potencia';
export type TrainingDays = 3 | 4 | 5;
export type MuscleFocus = 'torso' | 'piernas' | 'empuje' | 'tiron' | 'full_body';

interface RoutineGeneratorProps {
  onSaveRoutine?: (routine: Routine) => void;
  onStartWorkout?: (routine: Routine) => void;
}

export const RoutineGenerator: React.FC<RoutineGeneratorProps> = ({
  onSaveRoutine,
  onStartWorkout,
}) => {
  const [goal, setGoal] = useState<TrainingGoal>('hipertrofia');
  const [days, setDays] = useState<TrainingDays>(4);
  const [focus, setFocus] = useState<MuscleFocus>('torso');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedRoutine, setGeneratedRoutine] = useState<Routine | null>(null);
  const [saved, setSaved] = useState(false);

  const goalConfigs: Record<TrainingGoal, { label: string; reps: string; sets: string; rpe: string; rest: string; restSec: number }> = {
    hipertrofia: { label: 'Hipertrofia Muscular', reps: '8 a 12 reps', sets: '3 - 4 series', rpe: 'RPE 8 - 9 (RIR 1-2)', rest: '90 - 120 seg', restSec: 120 },
    fuerza_maxima: { label: 'Fuerza Máxima', reps: '3 a 6 reps', sets: '4 - 5 series', rpe: 'RPE 8 - 8.5 (RIR 2)', rest: '2 - 4 min', restSec: 180 },
    resistencia: { label: 'Resistencia Muscular', reps: '15 a 25 reps', sets: '2 - 3 series', rpe: 'RPE 9 - 10 (RIR 0-1)', rest: '45 - 60 seg', restSec: 60 },
    potencia: { label: 'Potencia / Explosiva', reps: '3 a 5 reps (máx. velocidad)', sets: '3 - 5 series', rpe: 'RPE 7.5 (RIR 3)', rest: '2 - 3 min', restSec: 150 },
  };

  const exercisePool: Record<MuscleFocus, { name: string; equipment: string; targetMuscle: string; substitute: string; cue: string }[]> = {
    torso: [
      { name: 'Press de Banca Plano con Barra Olimpica', equipment: 'Barra y Banco', targetMuscle: 'chest_left', substitute: 'Press en máquina Hammer Strength / Mancuernas', cue: 'Retracción escapular firme, pies anclados al suelo.' },
      { name: 'Jalón al Pecho en Polea Alta', equipment: 'Polea Alta', targetMuscle: 'traps_lats', substitute: 'Dominadas asistidas o Jalón con agarre neutro', cue: 'Llevar los codos hacia las caderas, pecho elevado.' },
      { name: 'Press Militar con Mancuernas Sentado', equipment: 'Mancuernas', targetMuscle: 'deltoid_front_left', substitute: 'Press en máquina selectorizada de hombros', cue: 'Evitar arqueo lumbar excesivo, mantener core rígido.' },
      { name: 'Remo en Polea Baja sentado', equipment: 'Polea Baja', targetMuscle: 'traps_lats', substitute: 'Remo con mancuerna a una mano apoyado en banco', cue: 'Mantener la columna neutra y traccionar al ombligo.' },
      { name: 'Extensiones de Tríceps con Cuerda', equipment: 'Polea Doble', targetMuscle: 'triceps_lateral_left', substitute: 'Press francés con barra Z o mancuernas', cue: 'Codos fijos a los costados, bloqueo completo abajo.' }
    ],
    piernas: [
      { name: 'Prensa de Piernas 45°', equipment: 'Máquina Palanca', targetMuscle: 'quad_left', substitute: 'Sentadilla en máquina Smith (Multipower)', cue: 'No bloquear las rodillas arriba, recorrido profundo controlado.' },
      { name: 'Extensiones de Cuádriceps', equipment: 'Máquina Selectorizada', targetMuscle: 'quad_right', substitute: 'Zancadas estáticas con mancuernas', cue: 'Contracción isométrica de 1 segundo en extensión máxima.' },
      { name: 'Curl Femoral Tumbado', equipment: 'Máquina Selectorizada', targetMuscle: 'hamstrings_left', substitute: 'Peso muerto rumano con mancuernas', cue: 'Evitar levantar la cadera del banco al flexionar.' },
      { name: 'Hip Thrust en Máquina / Smith', equipment: 'Máquina / Smith', targetMuscle: 'glutes', substitute: 'Puente de glúteos con mancuerna o barra libre', cue: 'Retroversión pélvica arriba, mirada al frente.' },
      { name: 'Elevación de Talones para Gemelos', equipment: 'Máquina de Gemelos', targetMuscle: 'calves_back_left', substitute: 'Elevaciones en escalón con mancuerna', cue: 'Rango de movimiento completo, estiramiento profundo abajo.' }
    ],
    empuje: [
      { name: 'Press Inclinado con Mancuernas', equipment: 'Mancuernas y Banco', targetMuscle: 'chest_left', substitute: 'Press inclinado en máquina convergente', cue: 'Ángulo de banco a 30°, control excéntrico de 2s.' },
      { name: 'Aperturas en Peck Deck', equipment: 'Máquina Selectorizada', targetMuscle: 'chest_right', substitute: 'Aperturas con poleas cruzadas', cue: 'Abrazo imaginario, flexión leve de codo constante.' },
      { name: 'Press de Hombros en Máquina Hammer', equipment: 'Máquina Convergente', targetMuscle: 'deltoid_front_right', substitute: 'Press militar con barra libre', cue: 'Trayectoria vertical fluida sin colisionar discos.' },
      { name: 'Extensiones de Tríceps tras nuca con polea', equipment: 'Polea Alta', targetMuscle: 'triceps_lateral_right', substitute: 'Press cerrado en banco plano', cue: 'Mantener los codos apuntando al frente.' }
    ],
    tiron: [
      { name: 'Remo Convergente en Máquina de Palanca', equipment: 'Máquina Hammer', targetMuscle: 'traps_lats', substitute: 'Remo con barra olímpica o mancuerna', cue: 'Pecho pegado al soporte, tracción potente.' },
      { name: 'Jalón Abierto en Polea Alta', equipment: 'Polea Alta', targetMuscle: 'traps_lats', substitute: 'Jalón con agarre estrecho neutro', cue: 'Depresión escapular antes de iniciar el tirón.' },
      { name: 'Curl de Bíceps con Barra Z', equipment: 'Barra Z', targetMuscle: 'biceps_left', substitute: 'Curl martillo con mancuernas', cue: 'Sin impulso de cadera, aislamiento estricto.' }
    ],
    full_body: [
      { name: 'Sentadilla Goblet con Mancuerna', equipment: 'Mancuerna', targetMuscle: 'quad_left', substitute: 'Prensa de piernas 45°', cue: 'Espalda recta, profundidad bajo paralela.' },
      { name: 'Press de Banca Plano con Mancuernas', equipment: 'Mancuernas y Banco', targetMuscle: 'chest_left', substitute: 'Press plano en máquina smith', cue: 'Control de estabilidad bilateral.' },
      { name: 'Remo en Polea Baja', equipment: 'Polea Baja', targetMuscle: 'traps_lats', substitute: 'Remo en máquina palanca', cue: 'Contracción dorsal al final del recorrido.' },
      { name: 'Plancha Abdominal Isométrica', equipment: 'Peso Corporal', targetMuscle: 'abs', substitute: 'Elevación de piernas colgado', cue: 'Glúteos y abdomen contraídos simultáneamente.' }
    ]
  };

  const handleGenerate = () => {
    setIsGenerating(true);
    setSaved(false);

    setTimeout(() => {
      const cfg = goalConfigs[goal];
      const pool = exercisePool[focus] || exercisePool.torso;
      
      const dayNames = days === 3 
        ? ['Día 1: Fuerza & Base', 'Día 2: Volumen y Densidad', 'Día 3: Rendimiento Total'] 
        : days === 4 
        ? ['Día 1: Tren Superior A', 'Día 2: Tren Inferior A', 'Día 3: Tren Superior B', 'Día 4: Tren Inferior B'] 
        : ['Día 1: Empuje', 'Día 2: Tirón', 'Día 3: Piernas', 'Día 4: Hombro & Core', 'Día 5: Full Body Élite'];

      const exercisesList: Exercise[] = pool.map((item, idx) => ({
        id: `ex-gen-${Date.now()}-${idx}`,
        name: item.name,
        targetMuscles: item.targetMuscle,
        defaultSets: goal === 'fuerza_maxima' ? 5 : 4,
        repRange: cfg.reps,
        restSeconds: cfg.restSec,
        restText: cfg.rest,
        objective: `${cfg.label} · ${cfg.rpe}`,
        defaultVideoUrl: '',
        techniqueCues: [item.cue, `Alternativa Hora Punta: ${item.substitute}`],
      }));

      const newRoutine: Routine = {
        id: `rutina-ia-${Date.now()}`,
        dayName: dayNames[0],
        title: `Smart Fit Pro: ${focus.toUpperCase()} (${goal.toUpperCase()})`,
        tagline: `${cfg.label} · ${cfg.reps} · Descanso ${cfg.rest}`,
        banner: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
        exercises: exercisesList,
      };

      setGeneratedRoutine(newRoutine);
      setIsGenerating(false);
    }, 600);
  };

  const handleSave = () => {
    if (generatedRoutine) {
      if (onSaveRoutine) onSaveRoutine(generatedRoutine);
      setSaved(true);
    }
  };

  const handleStart = () => {
    if (generatedRoutine && onStartWorkout) {
      onStartWorkout(generatedRoutine);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto bg-[#070A0F] rounded-3xl border border-zinc-800 p-6 shadow-2xl space-y-6 text-white font-sans">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
            <span className="text-[10px] font-mono font-black tracking-widest text-accent-text uppercase">
              LAZCAKONGYM TRAINER AI • GIMNASIOS COMERCIALES
            </span>
          </div>
          <h2 className="text-xl md:text-2xl font-black text-white tracking-tight mt-1">
            ASISTENTE DE RUTINAS INTELIGENTE
          </h2>
        </div>
        <div className="w-10 h-10 rounded-2xl bg-accent/10 border border-accent/30 flex items-center justify-center text-accent-text">
          <Sparkles className="w-5 h-5 animate-spin" style={{ animationDuration: '6s' }} />
        </div>
      </div>

      {/* Selectors Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Goal Selector */}
        <div className="space-y-2">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
            1. OBJETIVO DE ENTRENAMIENTO
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['hipertrofia', 'fuerza_maxima', 'resistencia', 'potencia'] as TrainingGoal[]).map((g) => (
              <button
                key={g}
                onClick={() => setGoal(g)}
                className={`p-3 rounded-2xl text-xs font-bold transition-all border text-left flex flex-col justify-between ${
                  goal === g 
                    ? 'bg-accent text-accent-contrast border-accent shadow-[0_0_16px_var(--accent-glow)]' 
                    : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <span className="capitalize">{g.replace('_', ' ')}</span>
                <span className={`text-[10px] font-mono mt-1 ${goal === g ? 'text-accent-contrast/80' : 'text-zinc-500'}`}>
                  {goalConfigs[g].reps}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Days Selector */}
        <div className="space-y-2">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
            2. FRECUENCIA (DÍAS / SEMANA)
          </label>
          <div className="grid grid-cols-3 gap-2">
            {([3, 4, 5] as TrainingDays[]).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`py-4 rounded-2xl text-sm font-black font-mono transition-all border text-center ${
                  days === d 
                    ? 'bg-[#00F0FF] text-zinc-950 border-[#00F0FF] shadow-lg shadow-[#00F0FF]/20' 
                    : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {d} Días
              </button>
            ))}
          </div>
        </div>

        {/* Focus Selector */}
        <div className="space-y-2">
          <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
            3. ENFOQUE MUSCULAR PRINCIPAL
          </label>
          <div className="grid grid-cols-2 gap-2">
            {(['torso', 'piernas', 'empuje', 'tiron', 'full_body'] as MuscleFocus[]).map((f) => (
              <button
                key={f}
                onClick={() => setFocus(f)}
                className={`p-3 rounded-2xl text-xs font-bold transition-all border text-center capitalize ${
                  focus === f 
                    ? 'bg-amber-400 text-zinc-950 border-amber-400 shadow-lg shadow-amber-400/20' 
                    : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {f.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Generate Action Button */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating}
        className="w-full py-4 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-sm uppercase tracking-wider shadow-[0_0_24px_var(--accent-glow)] transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
      >
        {isGenerating ? (
          <>
            <RotateCcw className="w-5 h-5 animate-spin" />
            <span>CALIBRANDO RUTINA BIOMECÁNICA...</span>
          </>
        ) : (
          <>
            <Zap className="w-5 h-5 fill-current" />
            <span>GENERAR RUTINA PERSONALIZADA SMART FIT</span>
          </>
        )}
      </button>

      {/* Generated Routine Preview */}
      {generatedRoutine && (
        <div className="mt-6 p-6 rounded-3xl bg-zinc-900/90 border border-zinc-800 space-y-5 animate-in fade-in duration-300">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
            <div>
              <span className="text-[10px] font-mono text-accent-text uppercase tracking-wider block">
                {generatedRoutine.tagline}
              </span>
              <h3 className="text-xl font-black text-white mt-0.5">{generatedRoutine.title}</h3>
            </div>
            
            <div className="flex items-center gap-2">
              <button
                onClick={handleSave}
                disabled={saved}
                className="px-3.5 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors border border-zinc-700"
              >
                <BookmarkPlus className="w-4 h-4 text-accent-text" />
                <span>{saved ? 'Guardada' : 'Guardar'}</span>
              </button>
              {onStartWorkout && (
                <button
                  onClick={handleStart}
                  className="px-4 py-2 rounded-xl bg-accent text-accent-contrast font-black text-xs flex items-center gap-1.5 hover:bg-accent-hover transition-colors shadow-[0_0_16px_var(--accent-glow)]"
                >
                  <ChevronRight className="w-4 h-4" />
                  <span>Iniciar Entreno</span>
                </button>
              )}
            </div>
          </div>

          {/* Exercises List */}
          <div className="space-y-3">
            <h4 className="text-xs font-mono text-zinc-400 uppercase tracking-wider">
              EJERCICIOS PROGRAMADOS ({generatedRoutine.exercises.length})
            </h4>
            <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
              {generatedRoutine.exercises.map((ex, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-[#070A0F] border border-zinc-800 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-mono text-cyan-400 uppercase">{ex.objective}</span>
                      <h5 className="font-bold text-white text-sm">{ex.name}</h5>
                    </div>
                    <span className="px-2.5 py-1 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono font-bold text-amber-400 shrink-0">
                      {ex.defaultSets} x {ex.repRange}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-zinc-800/80 text-xs font-mono">
                    <div className="text-zinc-300 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Descanso: <strong className="text-white">{ex.restText}</strong></span>
                    </div>
                    <div className="text-zinc-400 text-right sm:text-right">
                      ID: <span className="text-zinc-300 font-mono">{ex.targetMuscles}</span>
                    </div>
                  </div>

                  {ex.techniqueCues && ex.techniqueCues.length > 0 && (
                    <div className="pt-2 text-[11px] text-zinc-400 space-y-1 bg-zinc-900/50 p-2.5 rounded-xl border border-zinc-800">
                      <div className="text-accent-text font-bold">• Cue: {ex.techniqueCues[0]}</div>
                      {ex.techniqueCues[1] && (
                        <div className="text-cyan-300">• {ex.techniqueCues[1]}</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
