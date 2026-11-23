import React, { useState } from 'react';
import { X, Dumbbell, Plus, Check, Clock, Repeat, Target, Sparkles, FolderPlus } from 'lucide-react';
import { Routine, Exercise, LibraryExercise } from '../types';
import { enrichExerciseWithLibrary } from '../utils/enrichRoutines';

interface AddToRoutineModalProps {
  exercise: LibraryExercise | null;
  isOpen: boolean;
  onClose: () => void;
  routines: Routine[];
  onAddExerciseToRoutine: (routineId: string, exercise: Exercise) => void;
  onCreateRoutineWithExercise: (routineTitle: string, dayName: string, exercise: Exercise) => void;
}

const DAYS_OF_WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo', 'Extra'];

export const AddToRoutineModal: React.FC<AddToRoutineModalProps> = ({
  exercise,
  isOpen,
  onClose,
  routines,
  onAddExerciseToRoutine,
  onCreateRoutineWithExercise,
}) => {
  const [selectedRoutineId, setSelectedRoutineId] = useState<string>(() => routines[0]?.id || 'new');
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(routines.length === 0);
  const [newRoutineTitle, setNewRoutineTitle] = useState('');
  const [newRoutineDay, setNewRoutineDay] = useState('Lunes');

  // Exercise prescription config
  const [sets, setSets] = useState<number>(3);
  const [repRange, setRepRange] = useState<string>('10-12');
  const [restSeconds, setRestSeconds] = useState<number>(60);
  const [objective, setObjective] = useState<string>('Hipertrofia');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  if (!isOpen || !exercise) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const newExercise: Exercise = enrichExerciseWithLibrary({
      id: `ex-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: exercise.name,
      libraryExerciseId: exercise.id,
      targetMuscles: exercise.muscleGroup,
      equipment: exercise.equipment || undefined,
      defaultSets: sets,
      repRange,
      restSeconds,
      restText: `${restSeconds} s`,
      objective,
      defaultVideoUrl: exercise.animationUrl || exercise.videoUrl || exercise.url || '',
      thumbnailUrl: exercise.thumbnailUrl || undefined,
      secondaryThumbnailUrl: exercise.secondaryThumbnailUrl || undefined,
      techniqueCues: [
        `Músculo diana: ${exercise.muscleGroup}. Equipamiento: ${exercise.equipment || 'General'}.`,
        'Mantener cadencia controlada 2-0-1 (2 segundos bajada, contracción explosiva y controlada).',
        'Respiración acompasada: inhalar en la fase excéntrica y exhalar en el esfuerzo concéntrico.',
      ],
    });

    if (isCreatingNew || selectedRoutineId === 'new') {
      const title = newRoutineTitle.trim() || `Rutina de ${exercise.muscleGroup}`;
      onCreateRoutineWithExercise(title, newRoutineDay, newExercise);
      setSuccessToast(`¡Añadido a la nueva rutina "${title}"!`);
    } else {
      onAddExerciseToRoutine(selectedRoutineId, newExercise);
      const targetRoutine = routines.find((r) => r.id === selectedRoutineId);
      setSuccessToast(`¡Añadido a "${targetRoutine?.title || 'tu rutina'}"!`);
    }

    setTimeout(() => {
      setSuccessToast(null);
      onClose();
    }, 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#0d1424] border border-slate-700/80 rounded-3xl p-5 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold">
              <Dumbbell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">Añadir a Rutina</h3>
              <p className="text-xs text-amber-400 font-bold truncate max-w-[280px]">
                {exercise.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success toast banner */}
        {successToast && (
          <div className="my-3 p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center space-x-2 animate-in fade-in">
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{successToast}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Target Routine Selection */}
          <div>
            <label className="text-xs font-bold text-slate-300 block mb-2">
              ¿A qué rutina deseas agregarlo?
            </label>

            {routines.length > 0 && !isCreatingNew ? (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {routines.map((routine) => {
                  const isSelected = selectedRoutineId === routine.id;
                  return (
                    <button
                      key={routine.id}
                      type="button"
                      onClick={() => setSelectedRoutineId(routine.id)}
                      className={`w-full p-3 rounded-2xl text-left border transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-400 text-white'
                          : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                          {routine.dayName}
                        </span>
                        <div>
                          <div className="text-xs font-bold text-white">{routine.title}</div>
                          <div className="text-[11px] text-slate-400">
                            {routine.exercises.length} ejercicios registrados
                          </div>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="w-6 h-6 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        </div>
                      )}
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setIsCreatingNew(true)}
                  className="w-full py-2.5 px-3 rounded-2xl border border-dashed border-slate-700 hover:border-amber-400 text-slate-400 hover:text-amber-400 text-xs font-bold flex items-center justify-center space-x-2 transition-colors mt-2"
                >
                  <FolderPlus className="w-4 h-4" />
                  <span>+ Crear Nueva Rutina con este ejercicio</span>
                </button>
              </div>
            ) : (
              <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    Creando Nueva Rutina
                  </span>
                  {routines.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsCreatingNew(false)}
                      className="text-[11px] text-slate-400 hover:text-white underline"
                    >
                      Elegir rutina existente
                    </button>
                  )}
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Nombre de la Rutina</label>
                  <input
                    type="text"
                    value={newRoutineTitle}
                    onChange={(e) => setNewRoutineTitle(e.target.value)}
                    placeholder={`Ej: Rutina de ${exercise.muscleGroup} y Fuerza`}
                    className="w-full text-xs bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400"
                    required={isCreatingNew}
                  />
                </div>

                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Día asignado</label>
                  <select
                    value={newRoutineDay}
                    onChange={(e) => setNewRoutineDay(e.target.value)}
                    className="w-full text-xs bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-white focus:outline-none focus:border-amber-400"
                  >
                    {DAYS_OF_WEEK.map((day) => (
                      <option key={day} value={day}>
                        {day}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          {/* Exercise Parameters Config */}
          <div className="pt-2 border-t border-slate-800 space-y-3">
            <h4 className="text-xs font-bold text-slate-300">Configuración de Series y Cargas</h4>

            <div className="grid grid-cols-2 gap-3">
              {/* Series */}
              <div className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800">
                <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1 font-semibold">
                  <Repeat className="w-3.5 h-3.5 text-amber-400" />
                  Series
                </label>
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setSets(Math.max(1, sets - 1))}
                    className="w-8 h-8 rounded-xl bg-slate-800 text-white font-bold text-sm hover:bg-slate-700"
                  >
                    -
                  </button>
                  <span className="flex-1 text-center font-black text-base text-white">{sets}</span>
                  <button
                    type="button"
                    onClick={() => setSets(Math.min(10, sets + 1))}
                    className="w-8 h-8 rounded-xl bg-slate-800 text-white font-bold text-sm hover:bg-slate-700"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Repeticiones */}
              <div className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800">
                <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1 font-semibold">
                  <Target className="w-3.5 h-3.5 text-emerald-400" />
                  Repeticiones
                </label>
                <input
                  type="text"
                  value={repRange}
                  onChange={(e) => setRepRange(e.target.value)}
                  placeholder="Ej: 10-12 o Fallo"
                  className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-emerald-400 text-center focus:outline-none focus:border-amber-400"
                />
              </div>

              {/* Descanso */}
              <div className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800">
                <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1 font-semibold">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  Descanso (segundos)
                </label>
                <select
                  value={restSeconds}
                  onChange={(e) => setRestSeconds(Number(e.target.value))}
                  className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-amber-300 focus:outline-none focus:border-amber-400"
                >
                  <option value={30}>30 seg</option>
                  <option value={45}>45 seg</option>
                  <option value={60}>60 seg (1 min)</option>
                  <option value={90}>90 seg (1.5 min)</option>
                  <option value={120}>120 seg (2 min)</option>
                  <option value={180}>180 seg (3 min)</option>
                </select>
              </div>

              {/* Objetivo */}
              <div className="p-2.5 rounded-2xl bg-slate-900 border border-slate-800">
                <label className="text-[11px] text-slate-400 flex items-center gap-1 mb-1 font-semibold">
                  Objetivo
                </label>
                <select
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-400"
                >
                  <option value="Hipertrofia">Hipertrofia</option>
                  <option value="Fuerza">Fuerza</option>
                  <option value="Definición">Definición</option>
                  <option value="Resistencia">Resistencia</option>
                </select>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 flex items-center space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center space-x-1.5"
            >
              <Plus className="w-4 h-4 stroke-[3]" />
              <span>Confirmar y Añadir</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
