import React, { useState } from 'react';
import { resolveApiUrl } from '../utils/apiUrl';
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
  Trophy,
} from 'lucide-react';
import { Routine, Profile } from '../types';
import exerciseLibrary from '../data/exerciseLibrary.json';
import { sanitizeExerciseRepRange } from '../utils/progressionEngine';

interface AIRoutineGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProfile: Profile;
  onStartWorkout: (routine: Routine) => void;
  onSaveRoutine: (routine: Routine) => void;
}

export const AIRoutineGeneratorModal: React.FC<AIRoutineGeneratorModalProps> = ({
  isOpen,
  onClose,
  activeProfile,
  onStartWorkout,
  onSaveRoutine,
}) => {
  const [level, setLevel] = useState<'principiante' | 'intermedio' | 'avanzado'>('intermedio');
  const [focus, setFocus] = useState<
    'pectoral_brazos' | 'cuad_gemelos' | 'espalda_v' | 'empuje' | 'cadena_posterior' | 'hombros_core'
  >('pectoral_brazos');
  const [duration, setDuration] = useState<number>(45);
  const [goal, setGoal] = useState<
    'fuerza_maxima' | 'potencia' | 'hipertrofia' | 'definicion' | 'recomposicion' | 'resistencia'
  >(() => {
    const pg = (activeProfile?.goal || '').toLowerCase();
    if (pg.includes('fuerza')) return 'fuerza_maxima';
    if (pg.includes('definicion') || pg.includes('quema')) return 'definicion';
    if (pg.includes('potencia')) return 'potencia';
    if (pg.includes('resistencia')) return 'resistencia';
    if (pg.includes('recomposicion')) return 'recomposicion';
    return 'hipertrofia';
  });

  const [isLoading, setIsLoading] = useState(false);
  const [generatedRoutine, setGeneratedRoutine] = useState<Routine | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const generateLocalFallbackRoutine = () => {
    const muscleKeywords: Record<string, string[]> = {
      pectoral_brazos: ['Pecho', 'Bíceps', 'Tríceps'],
      cuad_gemelos: ['Pierna'],
      espalda_v: ['Espalda', 'Tríceps'],
      empuje: ['Pecho', 'Hombro', 'Tríceps'],
      cadena_posterior: ['Pierna', 'Glúteos'],
      hombros_core: ['Hombro', 'Abdomen'],
    };
    const targetMuscles = muscleKeywords[focus] || ['Pecho', 'Espalda', 'Pierna'];
    const candidates = (exerciseLibrary as any[]).filter((ex) => targetMuscles.includes(ex.muscleGroup));
    const pool = candidates.length >= 4 ? candidates : exerciseLibrary;
    const exerciseCount = Math.max(4, Math.min(7, Math.floor(duration / 10)));
    const shuffled = [...pool].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, exerciseCount);

    const sets = level === 'principiante' ? 3 : level === 'intermedio' ? 4 : 5;
    
    let repRange = '6 a 12 reps';
    let restSec = 120;
    let restRange = '1.5 a 3 min';
    let modalityName = 'Hipertrofia (Volumen)';
    let caloricFocus = 'Superávit calórico (+ calorías)';

    if (goal === 'fuerza_maxima') {
      repRange = '1 a 5 reps';
      restSec = 240;
      restRange = '3 a 5 min';
      modalityName = 'Fuerza Máxima';
      caloricFocus = 'Superávit o Mantenimiento';
    } else if (goal === 'potencia') {
      repRange = '3 a 6 reps (rápidas)';
      restSec = 150;
      restRange = '2 a 3 min';
      modalityName = 'Potencia / Explosividad';
      caloricFocus = 'Mantenimiento';
    } else if (goal === 'hipertrofia') {
      repRange = '6 a 12 reps';
      restSec = 120;
      restRange = '1.5 a 3 min';
      modalityName = 'Hipertrofia (Volumen)';
      caloricFocus = 'Superávit calórico (+ calorías)';
    } else if (goal === 'definicion') {
      repRange = '8 a 15 reps';
      restSec = 75;
      restRange = '1 a 2 min';
      modalityName = 'Definición (Pérdida de Grasa)';
      caloricFocus = 'Déficit calórico (- calorías)';
    } else if (goal === 'recomposicion') {
      repRange = '6 a 12 reps';
      restSec = 90;
      restRange = '1.5 a 2.5 min';
      modalityName = 'Recomposición Corporal';
      caloricFocus = 'Normocalórico (Mantenimiento)';
    } else if (goal === 'resistencia') {
      repRange = '15 a 25+ reps';
      restSec = 45;
      restRange = '30 a 60 seg';
      modalityName = 'Resistencia Muscular';
      caloricFocus = 'Mantenimiento';
    }

    const userWeight = activeProfile?.weightKg || 70;
    const levelMultiplier = level === 'principiante' ? 0.6 : level === 'intermedio' ? 0.85 : 1.1;
    const goalMultiplier = goal === 'fuerza_maxima' ? 1.15 : goal === 'definicion' ? 0.85 : 1.0;

    const routineExercises = selected.map((item: any, idx: number) => {
      const safeReps = sanitizeExerciseRepRange(item.name, repRange, goal);
      const isCompound = /sentadilla|press|peso muerto|remo|dominada|hack|leg press/i.test(item.name);
      const baseEstimateKg = isCompound 
        ? Math.round((userWeight * 0.9 * levelMultiplier * goalMultiplier) / 5) * 5 
        : Math.round((userWeight * 0.3 * levelMultiplier * goalMultiplier) / 2.5) * 2.5;

      const minKg = Math.max(5, baseEstimateKg - 5);
      const maxKg = baseEstimateKg + 5;

      return {
        id: `ex-ia-local-${Date.now()}-${idx}`,
        name: item.name,
      libraryExerciseId: item.id,
        targetMuscles: item.muscleGroup,
        defaultSets: sets,
        repRange: safeReps,
        restSeconds: restSec,
        restText: `${restSec} s`,
        objective: `${modalityName} · ${caloricFocus}`,
        defaultVideoUrl: item.videoUrl || item.url || '',
        techniqueCues: [
          `🎯 Carga Inicial Biométrica: ~${baseEstimateKg} kg (${minKg}kg - ${maxKg}kg) calculada s/ peso (${userWeight}kg) y objetivo.`,
          'Fase excéntrica controlada y estable (Gimnasio Comercial)',
        ],
      };
    });

    const titles: Record<string, string> = {
        pectoral_brazos: 'Pectoral & Brazos: Estética Pro',
        cuad_gemelos: 'Cuádriceps & Gemelos: Tren Inferior',
        espalda_v: 'Espalda en V: Dorsales & Tríceps',
        empuje: 'Empuje (Push): Pecho, Hombro & Tríceps',
        cadena_posterior: 'Cadena Posterior: Isquios & Glúteos',
        hombros_core: 'Hombros 3D & Core: Estabilidad',
    };

    return {
      id: `rutina-ia-${Date.now()}`,
      dayName: 'Rutina IA Comercial',
      title: titles[focus] || `Rutina IA Comercial: ${focus.toUpperCase()}`,
      tagline: `${modalityName} · Gimnasio Comercial Completo (Smart Fit)`,
      banner: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=800&auto=format&fit=crop&q=80',
      accentColor: '#f59e0b',
      isCustom: true,
      modality: goal,
      modalityName,
      targetRepRange: repRange,
      restRange,
      caloricFocus,
      exercises: routineExercises,
    };
  };

  const handleGenerate = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setSavedSuccess(false);

    try {
      const response = await fetch(resolveApiUrl('/api/gemini/generate-routine'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          experienceLevel: level,
          equipment: 'gimnasio_completo_comercial',
          focus,
          durationMinutes: duration,
          goal,
          athleteName: activeProfile.name,
        }),
      });

      const data = await response.json();
      if (data.success && data.routine) {
        const fallback = generateLocalFallbackRoutine();
        setGeneratedRoutine({
          ...data.routine,
          modality: data.routine.modality || goal,
          modalityName: data.routine.modalityName || fallback.modalityName,
          targetRepRange: data.routine.targetRepRange || fallback.targetRepRange,
          restRange: data.routine.restRange || fallback.restRange,
          caloricFocus: data.routine.caloricFocus || fallback.caloricFocus,
          exercises: (data.routine.exercises || fallback.exercises).map((ex: any) => ({
            ...ex,
            repRange: sanitizeExerciseRepRange(ex.name, ex.repRange, goal),
          })),
        });
      } else {
        const localRoutine = generateLocalFallbackRoutine();
        setGeneratedRoutine(localRoutine);
      }
    } catch (err: any) {
      console.warn('Network error calling AI route, generating locally:', err);
      const localRoutine = generateLocalFallbackRoutine();
      setGeneratedRoutine(localRoutine);
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartNow = () => {
    if (!generatedRoutine) return;
    onSaveRoutine(generatedRoutine);
    onStartWorkout(generatedRoutine);
    onClose();
  };

  const handleSaveOnly = () => {
    if (!generatedRoutine) return;
    onSaveRoutine(generatedRoutine);
    setSavedSuccess(true);
    setTimeout(() => {
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-[#0d1322] border border-amber-500/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative bg-gradient-to-r from-amber-950/40 via-slate-900 to-amber-950/30 p-5 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 via-orange-500 to-amber-400 p-[2px] shadow-lg shadow-amber-500/25">
                <div className="w-full h-full bg-[#090d16] rounded-[14px] flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-amber-400 animate-pulse" />
                </div>
              </div>
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  Entrenador IA
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Gemini AI
                  </span>
                </h3>
                <p className="text-xs text-slate-400">
                  Rutina personalizada para <strong className="text-slate-200">{activeProfile.name}</strong> (Smart Fit)
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800/80 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {!generatedRoutine ? (
            /* CONFIGURATION FORM */
            <div className="space-y-4 text-xs">
              {/* Level Selector */}
              <div>
                <label className="font-extrabold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5 mb-2">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  PERFIL DEL ATLETA / EXPERIENCIA ATLÉTICA:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'principiante', label: 'BASE / ADAPTACIÓN', desc: 'Control Motor • RIR 3-4 • Máquinas Guiadas', bars: 1 },
                    { id: 'intermedio', label: 'HIPERTROFIA / PROGRESIÓN', desc: 'Sobrecarga Progresiva • RIR 1-2 • Pesos Libres', bars: 2 },
                    { id: 'avanzado', label: 'ALTO RENDIMIENTO', desc: 'Intensidad Máxima • RPE 9-10 • Fallo Técnico', bars: 3 },
                  ].map((lvl) => (
                    <button
                      key={lvl.id}
                      type="button"
                      onClick={() => setLevel(lvl.id as any)}
                      className={`p-3 rounded-2xl border text-left transition-all bg-[#0B0F17] flex flex-col justify-between ${
                        level === lvl.id
                          ? 'border-accent text-white font-black shadow-[0_0_15px_var(--accent-glow)] ring-1 ring-[var(--accent-primary)]'
                          : 'border-zinc-800 text-slate-400 hover:text-white hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-2">
                        {[1, 2, 3].map((barNum) => (
                          <div
                            key={barNum}
                            className={`h-1.5 flex-1 rounded-full transition-colors ${
                              barNum <= lvl.bars
                                ? level === lvl.id ? 'bg-accent' : 'bg-amber-400/80'
                                : 'bg-zinc-800'
                            }`}
                          />
                        ))}
                      </div>
                      <div>
                        <span className="block font-bold text-[11px] leading-tight text-white">{lvl.label}</span>
                        <span className="text-[9px] text-zinc-500 font-mono block mt-1 leading-tight">{lvl.desc}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Muscle Focus (Redesigned into professional 2 or 3 column grid with subtexts) */}
              <div>
                <label className="font-extrabold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5 mb-2">
                  <Target className="w-3.5 h-3.5 text-amber-400" />
                  Grupo Muscular / Enfoque de Hoy:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'pectoral_brazos', label: 'Pectoral & Brazos', sub: 'Pecho, Bíceps, Tríceps' },
                    { id: 'cuad_gemelos', label: 'Cuádriceps & Gemelos', sub: 'Prensa, Hack, Extensiones' },
                    { id: 'espalda_v', label: 'Espalda en V', sub: 'Jalones, Remos en Polea' },
                    { id: 'empuje', label: 'Empuje (Push)', sub: 'Pectoral, Hombro, Tríceps' },
                    { id: 'cadena_posterior', label: 'Cadena Posterior', sub: 'Femorales & Glúteos' },
                    { id: 'hombros_core', label: 'Hombros & Core', sub: 'Deltoides 3D y Abdomen' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFocus(f.id as any)}
                      className={`p-2.5 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                        focus === f.id
                          ? 'bg-amber-500/25 border-amber-400 text-white font-black shadow-md shadow-amber-500/15 ring-1 ring-amber-400'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white hover:border-slate-700'
                      }`}
                    >
                      <span className="block font-bold text-xs leading-tight">{f.label}</span>
                      <span className="block font-mono text-[9px] text-zinc-500 mt-1">{f.sub}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Goal & Duration Grid */}
              <div className="grid grid-cols-2 gap-3 pt-1">
                {/* Goal */}
                <div>
                  <label className="font-extrabold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5 mb-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    Objetivo:
                  </label>
                  <select
                    value={goal}
                    onChange={(e) => setGoal(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white font-bold text-xs focus:outline-none focus:border-amber-400"
                  >
                    <option value="fuerza_maxima">⚡ Fuerza Máxima (1-5 reps • 3-5 min • Superávit/Mant.)</option>
                    <option value="potencia">💥 Potencia / Explosividad (3-6 reps rápidas • 2-3 min • Mant.)</option>
                    <option value="hipertrofia">💪 Hipertrofia / Volumen (6-12 reps • 1.5-3 min • Superávit)</option>
                    <option value="definicion">🔥 Definición (8-15 reps • 1-2 min • Déficit)</option>
                    <option value="recomposicion">⚖️ Recomposición (6-12 reps • 1.5-2.5 min • Normocalórico)</option>
                    <option value="resistencia">🛡️ Resistencia Muscular (15-25+ reps • 30-60 seg • Mant.)</option>
                  </select>
                </div>

                {/* Duration */}
                <div>
                  <label className="font-extrabold text-slate-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5 mb-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    Tiempo:
                  </label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white font-bold text-xs focus:outline-none focus:border-amber-400"
                  >
                    <option value={30}>⏱️ 30 min (Express)</option>
                    <option value={45}>⏱️ 45 min (Estándar)</option>
                    <option value={60}>⏱️ 60 min (Completo)</option>
                    <option value={90}>⏱️ 90 min (Intensivo)</option>
                  </select>
                </div>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </div>
          ) : (
            /* GENERATED ROUTINE PREVIEW */
            <div className="space-y-4">
              {/* Header card */}
              <div className="p-4 rounded-2xl bg-gradient-to-br from-amber-500/20 via-slate-900 to-orange-500/15 border border-amber-500/40 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 font-mono">
                    {generatedRoutine.exercises.length} Ejercicios
                  </span>
                  <span className="text-xs text-amber-300 font-bold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    ~{duration} min
                  </span>
                </div>
                <h4 className="text-base font-black text-white">{generatedRoutine.title}</h4>
                <p className="text-xs text-slate-300">{generatedRoutine.tagline}</p>
                <div className="flex items-center gap-1.5 pt-1.5 flex-wrap">
                  {generatedRoutine.targetRepRange && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      🎯 {generatedRoutine.targetRepRange}
                    </span>
                  )}
                  {generatedRoutine.restRange && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      ⏱️ {generatedRoutine.restRange} descanso
                    </span>
                  )}
                  {generatedRoutine.caloricFocus && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 truncate max-w-full">
                      🥩 {generatedRoutine.caloricFocus}
                    </span>
                  )}
                </div>
              </div>

              {/* Exercises List */}
              <div className="space-y-2">
                <span className="text-[10px] uppercase font-extrabold text-slate-400 tracking-wider block">
                  Plan de Ejercicios Generado (Smart Fit):
                </span>
                {generatedRoutine.exercises.map((ex, idx) => (
                  <div
                    key={ex.id || idx}
                    className="p-3 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-400 font-black text-[11px] flex items-center justify-center shrink-0">
                          {idx + 1}
                        </span>
                        <h5 className="font-bold text-xs text-white">{ex.name}</h5>
                      </div>
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                        {ex.defaultSets} series × {ex.repRange}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pl-7">
                      <span>Músculo: <strong className="text-slate-300">{ex.targetMuscles}</strong></span>
                      <span>Descanso: <strong className="text-amber-300">{ex.restText}</strong></span>
                    </div>

                    {ex.techniqueCues && ex.techniqueCues.length > 0 && (
                      <div className="pl-7 pt-1 text-[10px] text-slate-400 italic space-y-0.5">
                        <div>💡 {ex.techniqueCues[0]}</div>
                        <div className="text-cyan-300">⚡ {ex.techniqueCues[1]}</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {savedSuccess && (
                <div className="p-3 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="font-bold">¡Rutina guardada con éxito en Mis Rutinas!</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-4 bg-slate-950/90 border-t border-slate-800 flex items-center gap-2">
          {!generatedRoutine ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={isLoading}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                    <span>DISEÑANDO RUTINA CON IA...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>GENERAR RUTINA PERSONALIZADA CON IA</span>
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setGeneratedRoutine(null)}
                className="py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs flex items-center gap-1.5 transition-colors"
                title="Configurar otra rutina"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reconfigurar</span>
              </button>

              <button
                type="button"
                onClick={handleSaveOnly}
                className="py-3 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <BookmarkPlus className="w-4 h-4 text-amber-400" />
                <span>Guardar</span>
              </button>

              <button
                type="button"
                onClick={handleStartNow}
                className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/25 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>¡ENTRENAR AHORA!</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
