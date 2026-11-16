import React, { useState } from 'react';
import {
  Sparkles,
  X,
  Play,
  BookmarkPlus,
  Flame,
  Dumbbell,
  Clock,
  Target,
  Layers,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  ShieldCheck,
  Zap,
  Activity,
  Users,
  MessageSquare
} from 'lucide-react';
import { Routine, Profile, Exercise } from '../types';
import exerciseLibrary from '../data/exerciseLibrary.json';

interface AiRoutineModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfile: Profile;
  onStartWorkout: (routine: Routine) => void;
  onSaveRoutine: (routine: Routine) => void;
}

export const AiRoutineModal: React.FC<AiRoutineModalProps> = ({
  isOpen,
  onClose,
  activeProfile,
  onStartWorkout,
  onSaveRoutine,
}) => {
  const [level, setLevel] = useState<'principiante' | 'intermedio' | 'avanzado'>('intermedio');
  const [focus, setFocus] = useState<
    'torso' | 'piernas' | 'empuje' | 'tiron' | 'brazo_completo' | 'core'
  >('torso');
  const [duration, setDuration] = useState<number>(45);
  const [goal, setGoal] = useState<
    'fuerza_maxima' | 'potencia' | 'hipertrofia' | 'resistencia'
  >('hipertrofia');
  const [peakHourMode, setPeakHourMode] = useState<boolean>(false);
  const [customInstructions, setCustomInstructions] = useState<string>('');

  const [isLoading, setIsLoading] = useState(false);
  const [generatedRoutine, setGeneratedRoutine] = useState<Routine | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleGenerate = () => {
    setIsLoading(true);
    setSavedSuccess(false);

    setTimeout(() => {
      const muscleKeywords: Record<string, string[]> = {
        torso: ['Pecho', 'Bíceps', 'Tríceps', 'Hombro'],
        piernas: ['Pierna', 'Glúteos'],
        empuje: ['Pecho', 'Hombro', 'Tríceps'],
        tiron: ['Espalda', 'Bíceps', 'Antebrazo'],
        brazo_completo: ['Bíceps', 'Tríceps', 'Antebrazo'],
        core: ['Abdomen'],
      };

      const targetMuscles = muscleKeywords[focus] || ['Pecho', 'Espalda', 'Pierna'];
      const candidates = (exerciseLibrary as any[]).filter((ex) => targetMuscles.includes(ex.muscleGroup));
      const pool = candidates.length >= 4 ? candidates : exerciseLibrary;
      const exerciseCount = Math.max(4, Math.min(6, Math.floor(duration / 10)));
      const shuffled = [...pool].sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, exerciseCount);

      const sets = level === 'principiante' ? 3 : level === 'intermedio' ? 4 : 5;
      
      let repRange = '8 a 12 reps';
      let restSec = 90;
      let modalityName = 'Hipertrofia Muscular';

      if (goal === 'fuerza_maxima') {
        repRange = '3 a 6 reps';
        restSec = 180;
        modalityName = 'Fuerza Máxima';
      } else if (goal === 'potencia') {
        repRange = '3 a 5 reps explosivas';
        restSec = 150;
        modalityName = 'Potencia';
      } else if (goal === 'resistencia') {
        repRange = '15 a 20 reps';
        restSec = 60;
        modalityName = 'Resistencia Muscular';
      }

      const routineExercises: Exercise[] = selected.map((item: any, idx: number) => {
        let substituteText = `Alternativa hora punta: Mancuernas o poleas libres`;
        if (peakHourMode) {
          substituteText = `[MODO HORA PUNTA] Superserie en polea o mancuernas sin esperar máquina.`;
        }
        return {
          id: `ex-ia-${Date.now()}-${idx}`,
          name: item.name,
      libraryExerciseId: item.id,
          targetMuscles: item.muscleGroup === 'Pecho' ? 'chest_left' : item.muscleGroup === 'Espalda' ? 'traps_lats' : 'quad_left',
          defaultSets: sets,
          repRange: repRange,
          restSeconds: restSec,
          restText: `${restSec}s`,
          objective: `${modalityName} · RPE 8.5-9`,
          defaultVideoUrl: item.videoUrl || '',
          techniqueCues: [
            'Fase excéntrica controlada y estable',
            substituteText,
          ],
        };
      });

      const titles: Record<string, string> = {
        torso: 'Torso Pro: Hipertrofia & Brazos',
        piernas: 'Piernas Pro: Cuádriceps & Densidad',
        empuje: 'Push Day Pro: Pecho, Hombro & Tríceps',
        tiron: 'Pull Day Pro: Espalda, Bíceps & Trapecio',
        brazo_completo: 'Brazos Pro: Bíceps & Tríceps',
        core: 'Core Pro: Estabilidad & Abdomen',
      };

      setGeneratedRoutine({
        id: `rutina-ai-${Date.now()}`,
        dayName: 'Entrenador IA',
        title: titles[focus] || `Smart Fit Pro: ${focus.toUpperCase()}`,
        tagline: `${modalityName} · Gimnasio Comercial Completo (Smart Fit) ${customInstructions ? `· Nota: "${customInstructions}"` : ''}`,
        banner: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
        exercises: routineExercises,
      });

      setIsLoading(false);
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-[#070A0F] border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-zinc-800 bg-zinc-950/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-black text-white tracking-tight">Entrenador IA</h2>
                <span className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  GEMINI AI
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Rutina personalizada para {activeProfile.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-white">
          {!generatedRoutine ? (
            <div className="space-y-6">
              
              {/* Info Badge for Commercial Gym Inventory (Fixed Internal) */}
              <div className="p-3.5 rounded-2xl bg-zinc-900/80 border border-zinc-800 flex items-center gap-3 text-xs font-mono text-zinc-300">
                <div className="w-3 h-3 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span>Inventario automático: <strong>Gimnasio Comercial Completo (Smart Fit)</strong> con máquinas selectorizadas, convergentes/Hammer, multipower/Smith, poleas dobles, bancos y mancuernas.</span>
              </div>

              {/* Goal Selectors */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                  OBJETIVO BIOMECÁNICO
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['hipertrofia', 'fuerza_maxima', 'resistencia', 'potencia'] as const).map((g) => (
                    <button
                      key={g}
                      onClick={() => setGoal(g)}
                      className={`p-3 rounded-2xl text-xs font-bold transition-all border text-left flex flex-col justify-between ${
                        goal === g 
                          ? 'bg-amber-400 text-zinc-950 border-amber-400 shadow-lg shadow-amber-400/20' 
                          : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <span className="capitalize">{g.replace('_', ' ')}</span>
                      <span className={`text-[9px] font-mono mt-1 ${goal === g ? 'text-zinc-900' : 'text-zinc-500'}`}>
                        {g === 'hipertrofia' ? '8-12 reps' : g === 'fuerza_maxima' ? '3-6 reps' : g === 'resistencia' ? '15-20 reps' : '3-5 exp'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Athlete Level & Duration */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                    NIVEL DE EXPERIENCIA
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['principiante', 'intermedio', 'avanzado'] as const).map((lvl) => (
                      <button
                        key={lvl}
                        onClick={() => setLevel(lvl)}
                        className={`py-2.5 rounded-xl text-xs font-bold capitalize transition-all border text-center ${
                          level === lvl 
                            ? 'bg-[#CCFF00] text-zinc-950 border-[#CCFF00] font-black' 
                            : 'bg-zinc-900 text-zinc-300 border-zinc-800'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                    TIEMPO DISPONIBLE
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[45, 60, 75, 90].map((mins) => (
                      <button
                        key={mins}
                        onClick={() => setDuration(mins)}
                        className={`py-2.5 rounded-xl text-xs font-mono font-bold transition-all border text-center ${
                          duration === mins 
                            ? 'bg-[#00F0FF] text-zinc-950 border-[#00F0FF] font-black' 
                            : 'bg-zinc-900 text-zinc-300 border-zinc-800'
                        }`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Muscle Focus Selectors */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block">
                  GRUPO MUSCULAR / ENFOQUE DE HOY
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'torso', label: 'Torso' },
                    { id: 'piernas', label: 'Piernas' },
                    { id: 'empuje', label: 'Empuje (Push)' },
                    { id: 'tiron', label: 'Tirón (Pull)' },
                    { id: 'brazo_completo', label: 'Brazo Completo' },
                    { id: 'core', label: 'Core / Abdomen' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setFocus(f.id as any)}
                      className={`p-3 rounded-2xl text-xs font-bold transition-all border text-center ${
                        focus === f.id 
                          ? 'bg-amber-400 text-zinc-950 border-amber-400 shadow-lg shadow-amber-400/20 font-black' 
                          : 'bg-zinc-900/80 text-zinc-300 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Custom Instructions / Notes */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-zinc-400 uppercase tracking-wider block flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-cyan-400" />
                  <span>INSTRUCCIÓN RÁPIDA OBLIGATORIA (OPCIONAL)</span>
                </label>
                <input
                  type="text"
                  value={customInstructions}
                  onChange={(e) => setCustomInstructions(e.target.value)}
                  placeholder="Ej: Priorizar bíceps y pectoral superior..."
                  className="w-full px-4 py-3 rounded-2xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-400 transition-colors"
                />
              </div>

              {/* Peak Hour Mode Toggle */}
              <div className="p-4 rounded-2xl bg-zinc-900/90 border border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${peakHourMode ? 'bg-amber-400/20 border-amber-400 text-amber-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400'}`}>
                    <Users className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-white">MODO HORA PUNTA (AFLUENCIA ALTA)</h4>
                    <p className="text-[11px] text-zinc-400">Prioriza biseries y poleas/mancuernas para evitar esperar máquinas.</p>
                  </div>
                </div>
                <button
                  onClick={() => setPeakHourMode(!peakHourMode)}
                  className={`w-12 h-6 rounded-full transition-colors relative p-1 ${peakHourMode ? 'bg-amber-400' : 'bg-zinc-800'}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-zinc-950 transition-transform ${peakHourMode ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* Action Button */}
              <button
                onClick={handleGenerate}
                disabled={isLoading}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-[#CCFF00] text-zinc-950 font-black text-sm uppercase tracking-wider shadow-2xl hover:opacity-95 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <RotateCcw className="w-5 h-5 animate-spin" />
                    <span>PROCESANDO MATRIZ BIOMECÁNICA...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 fill-current" />
                    <span>GENERAR RUTINA PERSONALIZADA CON IA</span>
                  </>
                )}
              </button>
            </div>
          ) : (
            /* Generated Routine View */
            <div className="space-y-5 animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
                <div>
                  <span className="text-[10px] font-mono text-amber-400 uppercase block">
                    {generatedRoutine.tagline}
                  </span>
                  <h3 className="text-xl font-black text-white mt-0.5">{generatedRoutine.title}</h3>
                </div>
                <button
                  onClick={() => setGeneratedRoutine(null)}
                  className="px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-400 hover:text-white"
                >
                  Nueva Configuración
                </button>
              </div>

              {/* Exercise List */}
              <div className="space-y-2.5 max-h-80 overflow-y-auto pr-1">
                {generatedRoutine.exercises.map((ex, idx) => (
                  <div key={idx} className="p-3.5 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-1.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[10px] font-mono text-cyan-400">{ex.objective}</span>
                        <h5 className="font-bold text-white text-sm">{ex.name}</h5>
                      </div>
                      <span className="px-2.5 py-1 rounded-xl bg-zinc-950 border border-zinc-800 text-xs font-mono font-bold text-amber-400">
                        {ex.defaultSets} x {ex.repRange}
                      </span>
                    </div>
                    {ex.techniqueCues && (
                      <div className="text-[11px] text-zinc-400 space-y-0.5 pt-1 border-t border-zinc-800/80">
                        <div className="text-zinc-300">• {ex.techniqueCues[0]}</div>
                        <div className="text-cyan-300">• {ex.techniqueCues[1]}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Footer Actions */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => {
                    onSaveRoutine(generatedRoutine);
                    setSavedSuccess(true);
                  }}
                  disabled={savedSuccess}
                  className="flex-1 py-3 rounded-2xl bg-zinc-900 hover:bg-zinc-800 text-white font-bold text-xs flex items-center justify-center gap-2 border border-zinc-800 transition-colors"
                >
                  <BookmarkPlus className="w-4 h-4 text-amber-400" />
                  <span>{savedSuccess ? 'Rutina Guardada en Perfil' : 'Guardar en Mis Rutinas'}</span>
                </button>
                <button
                  onClick={() => {
                    onStartWorkout(generatedRoutine);
                    onClose();
                  }}
                  className="flex-1 py-3 rounded-2xl bg-amber-400 text-zinc-950 font-black text-xs flex items-center justify-center gap-2 hover:bg-amber-300 transition-colors shadow-lg shadow-amber-400/20"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Iniciar Entrenamiento Pro</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
