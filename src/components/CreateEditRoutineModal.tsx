import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Search, Dumbbell, Sparkles, Flame, Zap, Shield, Target } from 'lucide-react';
import { Routine, Exercise } from '../types';
import { EXERCISE_LIBRARY } from '../data/exerciseLibrary';
import {
  FITNESS_MODALITIES,
  FITNESS_MODALITY_LIST,
  FitnessModalityId,
} from '../data/fitnessModalities';
import { sanitizeExerciseRepRange } from '../utils/progressionEngine';

interface CreateEditRoutineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveRoutine: (routine: Routine) => void;
  onDeleteRoutine?: (routineId: string) => void;
  routineToEdit?: Routine | null;
}

const DAYS_OF_WEEK = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo', 'Extra'];

export const CreateEditRoutineModal: React.FC<CreateEditRoutineModalProps> = ({
  isOpen,
  onClose,
  onSaveRoutine,
  onDeleteRoutine,
  routineToEdit,
}) => {
  const [title, setTitle] = useState('');
  const [dayName, setDayName] = useState('Lunes');
  const [tagline, setTagline] = useState('');
  const [selectedModality, setSelectedModality] = useState<FitnessModalityId>('hipertrofia');
  const [targetRepRange, setTargetRepRange] = useState('');
  const [restRange, setRestRange] = useState('');
  const [caloricFocus, setCaloricFocus] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);

  // Exercise library search
  const [showLibrary, setShowLibrary] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState('Todos');

  useEffect(() => {
    if (routineToEdit) {
      setTitle(routineToEdit.title);
      setDayName(routineToEdit.dayName);
      setTagline(routineToEdit.tagline || '');
      const modKey = (routineToEdit.modality as FitnessModalityId) in FITNESS_MODALITIES
        ? (routineToEdit.modality as FitnessModalityId)
        : 'hipertrofia';
      setSelectedModality(modKey);
      const modConfig = FITNESS_MODALITIES[modKey] || FITNESS_MODALITIES.hipertrofia;
      setTargetRepRange(routineToEdit.targetRepRange || modConfig.repRange);
      setRestRange(routineToEdit.restRange || modConfig.restRange);
      setCaloricFocus(routineToEdit.caloricFocus || modConfig.caloricFocus);
      setExercises([...routineToEdit.exercises]);
    } else {
      setTitle('');
      setDayName('Lunes');
      setSelectedModality('hipertrofia');
      const mod = FITNESS_MODALITIES.hipertrofia;
      setTagline(`${mod.name} · ${mod.repRange} · Descanso ${mod.restRange}`);
      setTargetRepRange(mod.repRange);
      setRestRange(mod.restRange);
      setCaloricFocus(mod.caloricFocus);
      setExercises([]);
    }
  }, [routineToEdit, isOpen]);

  if (!isOpen) return null;

  const currentModalityConfig = FITNESS_MODALITIES[selectedModality] || FITNESS_MODALITIES.hipertrofia;

  const handleSelectModality = (modId: FitnessModalityId) => {
    setSelectedModality(modId);
    const mod = FITNESS_MODALITIES[modId];
    if (mod) {
      setTagline(`${mod.name} · ${mod.repRange} · Descanso ${mod.restRange}`);
      setTargetRepRange(mod.repRange);
      setRestRange(mod.restRange);
      setCaloricFocus(mod.caloricFocus);
      // Also adapt default reps & rest of any existing exercises if user desires
      if (exercises.length > 0 && confirm('¿Deseas adaptar los rangos de repeticiones y descansos de los ejercicios existentes a esta modalidad?')) {
        setExercises((prev) =>
          prev.map((ex) => ({
            ...ex,
            repRange: sanitizeExerciseRepRange(ex.name, mod.repRange, modId),
            restSeconds: mod.restSecondsDefault,
            restText: `${mod.restSecondsDefault} s`,
            objective: mod.name,
          }))
        );
      }
    }
  };

  const handleAddFromLibrary = (libItem: {
    id: string;
    name: string;
    muscleGroup: string;
    url: string;
    videoUrl?: string | null;
  }) => {
    const safeReps = sanitizeExerciseRepRange(libItem.name, currentModalityConfig.repRange, selectedModality);
    const newEx: Exercise = {
      id: `custom-ex-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: libItem.name,
      libraryExerciseId: libItem.id,
      targetMuscles: libItem.muscleGroup,
      defaultSets: 3,
      repRange: safeReps,
      restSeconds: currentModalityConfig.restSecondsDefault,
      restText: `${currentModalityConfig.restSecondsDefault} s`,
      objective: currentModalityConfig.name,
      defaultVideoUrl: libItem.videoUrl || libItem.url || '',
      techniqueCues: [
        'Mantener el control del movimiento en la fase excéntrica',
        'Contracción muscular consciente durante cada repetición',
      ],
    };
    setExercises([...exercises, newEx]);
    setShowLibrary(false);
  };

  const handleAddManualExercise = () => {
    const safeReps = sanitizeExerciseRepRange('Nuevo Ejercicio', currentModalityConfig.repRange, selectedModality);
    const newEx: Exercise = {
      id: `custom-ex-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      name: 'Nuevo Ejercicio',
      targetMuscles: 'Torso',
      defaultSets: 3,
      repRange: safeReps,
      restSeconds: currentModalityConfig.restSecondsDefault,
      restText: `${currentModalityConfig.restSecondsDefault} s`,
      objective: currentModalityConfig.name,
      defaultVideoUrl: '',
      techniqueCues: ['Técnica controlada'],
    };
    setExercises([...exercises, newEx]);
  };

  const handleUpdateExercise = (index: number, updates: Partial<Exercise>) => {
    const next = [...exercises];
    next[index] = { ...next[index], ...updates };
    setExercises(next);
  };

  const handleRemoveExercise = (index: number) => {
    setExercises(exercises.filter((_, i) => i !== index));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const routineId = routineToEdit?.id || `rutina-custom-${Date.now()}`;
    const newRoutine: Routine = {
      id: routineId,
      dayName,
      title: title.trim(),
      tagline: tagline.trim() || `${currentModalityConfig.name} · ${targetRepRange || currentModalityConfig.repRange}`,
      modality: selectedModality,
      modalityName: currentModalityConfig.name,
      targetRepRange: targetRepRange.trim() || currentModalityConfig.repRange,
      restRange: restRange.trim() || currentModalityConfig.restRange,
      caloricFocus: caloricFocus.trim() || currentModalityConfig.caloricFocus,
      exercises,
      isCustom: true,
      accentColor: currentModalityConfig.accentColor || 'amber',
    };

    onSaveRoutine(newRoutine);
    onClose();
  };

  const filteredLibrary = EXERCISE_LIBRARY.filter((ex) => {
    const matchesSearch = ex.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMuscle = selectedMuscle === 'Todos' || ex.muscleGroup === selectedMuscle;
    return matchesSearch && matchesMuscle;
  }).slice(0, 30);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-xl bg-[#0d1424] border border-slate-700/80 rounded-3xl p-5 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Dumbbell className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white">
                {routineToEdit ? 'Editar Rutina' : 'Crear Nueva Rutina'}
              </h3>
              <p className="text-[11px] text-slate-400">Personaliza los ejercicios, series y descansos</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-4 my-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Nombre de la Rutina *
              </label>
              <input
                type="text"
                placeholder="ej. Piernas Brutales, Torso Hipertrofia..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xs data-input-field rounded-xl px-3 py-2.5 text-white font-bold shadow-inner"
                required
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Día Asignado
              </label>
              <select
                value={dayName}
                onChange={(e) => setDayName(e.target.value)}
                className="w-full text-xs data-input-field rounded-xl px-3 py-2.5 text-white font-bold shadow-inner"
              >
                {DAYS_OF_WEEK.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Fitness Modality Selector */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block">
                Tipo de Rutina / Modalidad Fitness *
              </label>
              <span className="text-[10px] text-slate-400">
                Parámetros científicos de repeticiones y descanso
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {FITNESS_MODALITY_LIST.map((m) => {
                const isSelected = selectedModality === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSelectModality(m.id)}
                    className={`p-2.5 rounded-2xl border text-left transition-all active:scale-95 flex flex-col justify-between ${
                      isSelected
                        ? `${m.bgClass} ${m.borderClass} ring-1 ring-amber-400/50 shadow-md`
                        : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-base">{m.emoji}</span>
                      <span
                        className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                          isSelected ? m.badgeClass : 'bg-slate-800 text-slate-400'
                        }`}
                      >
                        {m.repRange}
                      </span>
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-white leading-tight">
                        {m.name}
                      </div>
                      <div className="text-[9px] text-slate-400 mt-0.5">
                        ⏱️ {m.restRange} · {m.caloricFocus.split(' ')[0]}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected Modality Scientific Reference Strip & Customization */}
            {currentModalityConfig && (
              <div className="mt-2.5 p-3 rounded-2xl bg-slate-950/90 border border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
                  <div className="flex items-center gap-1.5 font-bold text-amber-400">
                    <span>{currentModalityConfig.emoji}</span>
                    <span>Parámetros Fisiológicos ({currentModalityConfig.name}):</span>
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {currentModalityConfig.intensity}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                  <div>
                    <label className="text-[9px] uppercase font-bold text-slate-400 block mb-1">
                      🎯 Rango de Reps
                    </label>
                    <input
                      type="text"
                      value={targetRepRange}
                      onChange={(e) => setTargetRepRange(e.target.value)}
                      placeholder={currentModalityConfig.repRange}
                      className="w-full text-xs font-mono font-bold bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-white focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-bold text-slate-400 block mb-1">
                      ⏱️ Descanso Entre Series
                    </label>
                    <input
                      type="text"
                      value={restRange}
                      onChange={(e) => setRestRange(e.target.value)}
                      placeholder={currentModalityConfig.restRange}
                      className="w-full text-xs font-mono font-bold bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-cyan-400 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase font-bold text-slate-400 block mb-1">
                      🥩 Enfoque Calórico
                    </label>
                    <input
                      type="text"
                      value={caloricFocus}
                      onChange={(e) => setCaloricFocus(e.target.value)}
                      placeholder={currentModalityConfig.caloricFocus}
                      className="w-full text-xs font-semibold bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-emerald-400 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
              Subtítulo / Objetivo
            </label>
            <input
              type="text"
              placeholder="ej. Fuerza + Masa muscular"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              className="w-full text-xs data-input-field rounded-xl px-3 py-2 text-white shadow-inner"
            />
          </div>

          {/* Exercise List */}
          <div className="pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-black uppercase tracking-wider text-slate-200">
                Ejercicios ({exercises.length})
              </span>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setShowLibrary(true)}
                  className="px-2.5 py-1.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 text-xs font-bold hover:bg-amber-500/30 flex items-center gap-1 transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Desde Librería</span>
                </button>
                <button
                  type="button"
                  onClick={handleAddManualExercise}
                  className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1 transition-all"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Manual</span>
                </button>
              </div>
            </div>

            {/* Exercise cards */}
            <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
              {exercises.length === 0 ? (
                <div className="p-6 rounded-2xl bg-slate-950/60 border border-slate-800/80 text-center">
                  <p className="text-xs text-slate-500">
                    Aún no has agregado ejercicios a esta rutina. Usa el botón "Desde Librería" para elegir entre más de 750 ejercicios.
                  </p>
                </div>
              ) : (
                exercises.map((ex, index) => (
                  <div
                    key={ex.id}
                    className="p-3 rounded-2xl bg-slate-900 border border-slate-800 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2 flex-1 mr-2">
                        <span className="w-5 h-5 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {index + 1}
                        </span>
                        <input
                          type="text"
                          value={ex.name}
                          onChange={(e) => handleUpdateExercise(index, { name: e.target.value })}
                          className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-white focus:outline-none focus:border-amber-400"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveExercise(index)}
                        className="p-1 text-slate-500 hover:text-rose-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">Series</span>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          value={ex.defaultSets}
                          onChange={(e) => handleUpdateExercise(index, { defaultSets: Number(e.target.value) })}
                          className="w-full text-center text-xs font-bold bg-slate-950 border border-slate-800 rounded-lg py-1 text-white"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">Carga (kg)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          placeholder="kg"
                          value={ex.defaultWeight ?? ''}
                          onChange={(e) => {
                            const nextWeight = e.target.value === '' ? undefined : Number(e.target.value);
                            handleUpdateExercise(index, {
                              prevWeight:
                                ex.defaultWeight && ex.defaultWeight > 0 && nextWeight !== ex.defaultWeight
                                  ? ex.defaultWeight
                                  : ex.prevWeight,
                              defaultWeight: nextWeight,
                            });
                          }}
                          className="w-full text-center text-xs font-bold bg-slate-950 border border-slate-800 rounded-lg py-1 text-[#CCFF00]"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">Reps</span>
                        <input
                          type="text"
                          value={ex.repRange}
                          onChange={(e) => handleUpdateExercise(index, { repRange: e.target.value })}
                          className="w-full text-center text-xs font-bold bg-slate-950 border border-slate-800 rounded-lg py-1 text-emerald-400"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5">Descanso (s)</span>
                        <input
                          type="number"
                          step="15"
                          min="0"
                          value={ex.restSeconds}
                          onChange={(e) => {
                            const sec = Number(e.target.value);
                            handleUpdateExercise(index, {
                              restSeconds: sec,
                              restText: sec > 0 ? `${sec} s` : '—',
                            });
                          }}
                          className="w-full text-center text-xs font-bold bg-slate-950 border border-slate-800 rounded-lg py-1 text-amber-400"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center space-x-2 pt-3 border-t border-slate-800">
            {routineToEdit && onDeleteRoutine && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`¿Eliminar la rutina "${routineToEdit.title}"?`)) {
                    onDeleteRoutine(routineToEdit.id);
                    onClose();
                  }
                }}
                className="py-3 px-3 bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30 font-bold text-xs rounded-2xl flex items-center gap-1.5 active:scale-95 transition-all"
              >
                <Trash2 className="w-4 h-4" />
                <span>Eliminar</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-2xl"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-2xl shadow-lg shadow-amber-500/20"
            >
              Guardar Rutina
            </button>
          </div>
        </form>

        {/* Exercise Library Picker Modal */}
        {showLibrary && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <div className="w-full max-w-md bg-[#090d16] border border-amber-500/40 rounded-3xl p-5 shadow-2xl max-h-[85vh] flex flex-col">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-3">
                <h4 className="text-sm font-black text-white">Librería de Ejercicios</h4>
                <button
                  type="button"
                  onClick={() => setShowLibrary(false)}
                  className="p-1 text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search input */}
              <div className="relative mb-3">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  type="text"
                  placeholder="Buscar ejercicio..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-400"
                  autoFocus
                />
              </div>

              {/* Muscle group tabs */}
              <div className="flex items-center space-x-1 overflow-x-auto pb-2 mb-2 scrollbar-none">
                {['Todos', 'Pierna', 'Glúteos', 'Pecho', 'Espalda', 'Hombro', 'Bíceps', 'Tríceps', 'Abdomen', 'Antebrazo'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setSelectedMuscle(m)}
                    className={`text-[10px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors ${
                      selectedMuscle === m
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>

              {/* Exercises list */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                {filteredLibrary.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No se encontraron ejercicios.</p>
                ) : (
                  filteredLibrary.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => handleAddFromLibrary(item)}
                      className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 hover:border-amber-500/50 hover:bg-slate-800 cursor-pointer flex items-center justify-between group transition-all"
                    >
                      <div>
                        <h5 className="text-xs font-bold text-white group-hover:text-amber-300">
                          {item.name}
                        </h5>
                        <span className="text-[10px] text-slate-400">{item.muscleGroup}</span>
                      </div>
                      <Plus className="w-4 h-4 text-amber-400 opacity-60 group-hover:opacity-100" />
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
