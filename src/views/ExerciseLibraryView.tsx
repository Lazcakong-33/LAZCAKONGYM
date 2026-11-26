import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search,
  Filter,
  Dumbbell,
  Play,
  Plus,
  Info,
  ExternalLink,
  X,
  Sparkles,
  Check,
  ChevronDown,
} from 'lucide-react';
import { Routine, Exercise, LibraryExercise } from '../types';
import { EXERCISE_LIBRARY, MUSCLE_GROUPS, EQUIPMENT_LIST } from '../data/exerciseLibrary';
import { AddToRoutineModal } from '../components/AddToRoutineModal';
import { MuscleGroupCardsGrid } from '../components/MuscleGroupCardsGrid';
import { ExerciseThumbnail } from '../components/ExerciseThumbnail';

interface ExerciseLibraryViewProps {
  routines: Routine[];
  onAddExerciseToRoutine: (routineId: string, exercise: Exercise) => void;
  onCreateRoutineWithExercise: (routineTitle: string, dayName: string, exercise: Exercise) => void;
  onOpenAIRoutineModal?: () => void;
}

export const ExerciseLibraryView: React.FC<ExerciseLibraryViewProps> = ({
  routines,
  onAddExerciseToRoutine,
  onCreateRoutineWithExercise,
  onOpenAIRoutineModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string>('Todos');
  const [selectedEquipment, setSelectedEquipment] = useState<string>('Todos');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [visibleCount, setVisibleCount] = useState<number>(24);

  // Modals state
  const [selectedExerciseForAdd, setSelectedExerciseForAdd] = useState<LibraryExercise | null>(null);
  const [selectedExerciseDetail, setSelectedExerciseDetail] = useState<LibraryExercise | null>(null);

  // Filter exercises
  const filteredExercises = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return EXERCISE_LIBRARY.filter((ex) => {
      // Muscle filter
      if (selectedMuscle !== 'Todos') {
        if (!ex.muscleGroup.toLowerCase().includes(selectedMuscle.toLowerCase())) {
          return false;
        }
      }

      // Equipment filter
      if (selectedEquipment !== 'Todos') {
        const matchesMain = ex.equipment && ex.equipment.toLowerCase().includes(selectedEquipment.toLowerCase());
        const matchesAll = ex.allEquipment && ex.allEquipment.some((eq) => eq.toLowerCase().includes(selectedEquipment.toLowerCase()));
        if (!matchesMain && !matchesAll) {
          return false;
        }
      }

      // Search query
      if (q) {
        const matchesName = ex.name.toLowerCase().includes(q);
        const matchesMuscle = ex.muscleGroup.toLowerCase().includes(q);
        const matchesEq = ex.equipment ? ex.equipment.toLowerCase().includes(q) : false;
        const matchesTags = ex.tags ? ex.tags.some((t) => t.toLowerCase().includes(q)) : false;
        if (!matchesName && !matchesMuscle && !matchesEq && !matchesTags) {
          return false;
        }
      }

      return true;
    });
  }, [searchQuery, selectedMuscle, selectedEquipment]);

  // Reset pagination on filter change
  useEffect(() => {
    setVisibleCount(24);
  }, [searchQuery, selectedMuscle, selectedEquipment]);

  const displayedExercises = useMemo(() => {
    return filteredExercises.slice(0, visibleCount);
  }, [filteredExercises, visibleCount]);

  const handleLoadMore = () => {
    setVisibleCount((prev) => Math.min(prev + 24, filteredExercises.length));
  };

  const handleClearFilters = () => {
    setSearchQuery('');
    setSelectedMuscle('Todos');
    setSelectedEquipment('Todos');
  };

  const hasActiveFilters = searchQuery !== '' || selectedMuscle !== 'Todos' || selectedEquipment !== 'Todos';

  return (
    <div className="space-y-4 pb-24 animate-in fade-in duration-200">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#171717] via-[#111111] to-[#090909] border border-slate-800 p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold text-[#CCFF00] uppercase tracking-wider">
                Biblioteca LazcaKong Gym
              </span>
              <span className="text-slate-500 text-xs">·</span>
              <span className="text-[11px] font-mono text-slate-400">{EXERCISE_LIBRARY.length} Ejercicios</span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Biblioteca de Ejercicios
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Consulta las fichas de técnica y reproduce las animaciones disponibles.
            </p>
          </div>

          {onOpenAIRoutineModal && (
            <button
              onClick={onOpenAIRoutineModal}
              className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-[#CCFF00] to-[#b8e600] hover:from-[#d8ff44] hover:to-[#CCFF00] text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center space-x-2 shrink-0"
            >
              <Sparkles className="w-4 h-4 stroke-[2.5]" />
              <span>Generar Rutina IA</span>
            </button>
          )}
        </div>
      </div>

      {/* Search & Filter Controls */}
      <div className="space-y-3">
        {/* Search input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar ejercicio (ej: press banca, curl bíceps, sentadilla, dominadas)..."
            className="w-full bg-[#171717] border border-slate-800 rounded-2xl pl-10 pr-10 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Muscle Category Filter Scroll */}
        <div>
          <div className="flex items-center justify-between mb-1.5 px-0.5">
            <span className="text-[11px] font-bold text-slate-400">Grupo Muscular</span>
            {hasActiveFilters && (
              <button
                onClick={handleClearFilters}
                className="text-[10px] text-[#CCFF00] hover:text-[#CCFF00] font-semibold"
              >
                Limpiar filtros
              </button>
            )}
          </div>
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
            {MUSCLE_GROUPS.map((muscle) => {
              const isSelected = selectedMuscle === muscle;
              return (
                <button
                  key={muscle}
                  onClick={() => setSelectedMuscle(muscle)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all ${
                    isSelected
                      ? 'bg-amber-400 text-slate-950 shadow-md shadow-amber-400/20'
                      : 'bg-[#171717] border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  {muscle}
                </button>
              );
            })}
          </div>
        </div>

        {/* Equipment Dropdown & Quick Badges */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 shrink-0">
            <Filter className="w-3.5 h-3.5 text-slate-500" />
            <span>Equipamiento:</span>
          </div>
          <select
            value={selectedEquipment}
            onChange={(e) => setSelectedEquipment(e.target.value)}
            className="flex-1 bg-[#171717] border border-slate-800 text-xs text-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-amber-400"
          >
            {EQUIPMENT_LIST.map((eq) => (
              <option key={eq} value={eq}>
                {eq === 'Todos' ? 'Cualquier equipamiento' : eq}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* View Mode Toggle Bar */}
      <div className="flex items-center justify-between bg-[#171717] p-1.5 rounded-2xl border border-slate-800">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              viewMode === 'grid'
                ? 'bg-[#CCFF00] text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>🗂️ Cuadrícula Muscular</span>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              viewMode === 'list'
                ? 'bg-[#CCFF00] text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>📋 Lista de Ejercicios</span>
          </button>
        </div>

        {selectedMuscle !== 'Todos' && (
          <button
            onClick={() => setSelectedMuscle('Todos')}
            className="text-[11px] text-[#CCFF00] hover:text-[#CCFF00] font-bold px-2.5 py-1 rounded-lg bg-[#CCFF00]/10 border border-amber-500/30"
          >
            Ver todos ✕
          </button>
        )}
      </div>

      {viewMode === 'grid' && selectedMuscle === 'Todos' && !searchQuery ? (
        <MuscleGroupCardsGrid
          onSelectMuscle={(muscle) => {
            setSelectedMuscle(muscle);
            setViewMode('list');
          }}
        />
      ) : (
        <>
          {/* Results Header Count */}
          <div className="flex items-center justify-between px-1 text-xs text-slate-400">
            <div>
              Mostrando <span className="font-bold text-white tabular-nums">{displayedExercises.length}</span> de{' '}
              <span className="font-bold text-white tabular-nums">{filteredExercises.length}</span> ejercicios
            </div>
            {selectedMuscle !== 'Todos' && (
              <span className="text-[11px] text-[#CCFF00] font-bold">
                Filtro: {selectedMuscle}
              </span>
            )}
          </div>

      {/* Empty State */}
      {displayedExercises.length === 0 && (
        <div className="text-center py-16 px-4 rounded-3xl bg-[#171717] border border-slate-800">
          <Dumbbell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white">No se encontraron ejercicios</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Prueba ajustando los términos de búsqueda o eliminando los filtros de músculo y equipamiento.
          </p>
          <button
            onClick={handleClearFilters}
            className="mt-4 py-2 px-4 bg-[#CCFF00] hover:bg-[#b8e600] text-slate-950 font-bold text-xs rounded-xl"
          >
            Restablecer Filtros
          </button>
        </div>
      )}

      {/* Exercise Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayedExercises.map((exercise) => (
          <ExerciseCardItem
            key={exercise.id}
            exercise={exercise}
            onOpenDetail={() => setSelectedExerciseDetail(exercise)}
            onAddToRoutine={() => setSelectedExerciseForAdd(exercise)}
          />
        ))}
      </div>

      {/* Load More Button */}
      {visibleCount < filteredExercises.length && (
        <div className="text-center pt-4">
          <button
            onClick={handleLoadMore}
            className="py-3 px-6 rounded-2xl bg-[#171717] hover:bg-slate-800 border border-slate-700/80 text-white font-bold text-xs shadow-lg transition-all active:scale-95 inline-flex items-center space-x-2"
          >
            <span>Cargar más ejercicios ({filteredExercises.length - visibleCount} restantes)</span>
            <ChevronDown className="w-4 h-4 text-[#CCFF00]" />
          </button>
        </div>
      )}

      {/* Modal: Add To Routine */}
      <AddToRoutineModal
        exercise={selectedExerciseForAdd}
        isOpen={Boolean(selectedExerciseForAdd)}
        onClose={() => setSelectedExerciseForAdd(null)}
        routines={routines}
        onAddExerciseToRoutine={onAddExerciseToRoutine}
        onCreateRoutineWithExercise={onCreateRoutineWithExercise}
      />

      {/* Modal: Exercise Detail Preview */}
      {selectedExerciseDetail && (
        <ExerciseDetailQuickModal
          exercise={selectedExerciseDetail}
          isOpen={Boolean(selectedExerciseDetail)}
          onClose={() => setSelectedExerciseDetail(null)}
          onAddToRoutine={() => {
            const ex = selectedExerciseDetail;
            setSelectedExerciseDetail(null);
            setSelectedExerciseForAdd(ex);
          }}
        />
      )}
        </>
      )}
    </div>
  );
};

interface ExerciseCardItemProps {
  exercise: LibraryExercise;
  onOpenDetail: () => void;
  onAddToRoutine: () => void;
}

const ExerciseCardItem: React.FC<ExerciseCardItemProps> = ({
  exercise,
  onOpenDetail,
  onAddToRoutine,
}) => {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMouseEnter = () => {
    setIsPlaying(true);
    if (videoRef.current && !videoFailed) {
      videoRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  const handleMouseLeave = () => {
    setIsPlaying(false);
    if (videoRef.current && !videoFailed) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  return (
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="group rounded-3xl bg-[#171717] border border-slate-800/80 hover:border-[#CCFF00]/40 overflow-hidden flex flex-col justify-between transition-all duration-200 shadow-md hover:shadow-xl hover:shadow-black/50"
    >
      {/* Media Container: Video MP4 Loop with Image Fallback */}
      <div
        onClick={onOpenDetail}
        className="relative aspect-square w-full bg-slate-950 overflow-hidden cursor-pointer"
      >
        {exercise.videoUrl && !videoFailed ? (
          exercise.videoUrl.endsWith('.gif') || exercise.videoUrl.endsWith('.webp') ? (
            <img
              src={isPlaying ? exercise.videoUrl : exercise.thumbnailUrl || exercise.videoUrl}
              alt={exercise.name}
              loading="lazy"
              decoding="async"
              onError={() => setVideoFailed(true)}
              className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <video
              ref={videoRef}
              src={exercise.videoUrl}
              poster={exercise.thumbnailUrl || undefined}
              loop
              muted
              playsInline
              preload="none"
              onError={() => setVideoFailed(true)}
              className="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
            />
          )
        ) : (
          <ExerciseThumbnail
            src={exercise.thumbnailUrl}
            alt={exercise.name}
            muscleGroup={exercise.muscleGroup}
            className="w-full h-full border-0 rounded-none"
            imgClassName="w-full h-full object-contain transition-transform duration-300 group-hover:scale-105"
          />
        )}

        {/* Video badge */}
        <div className="absolute top-2.5 right-2.5 bg-black/70 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] font-bold text-[#CCFF00] flex items-center gap-1 border border-white/10">
          <Play className="w-2.5 h-2.5 fill-current" />
          <span>{exercise.videoUrl && !videoFailed ? '8 poses · 4 s' : 'Animación pendiente'}</span>
        </div>

        {/* Overlay scrim */}
        <div className="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0d1424] via-[#0d1424]/60 to-transparent pointer-events-none" />
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          {/* Metadata without pills */}
          <div className="text-[11px] font-bold text-slate-400 flex items-center gap-2 mb-1">
            <span className="text-[#CCFF00]">{exercise.muscleGroup}</span>
            <span className="text-slate-600">·</span>
            <span>{exercise.equipment || 'General'}</span>
          </div>

          <h3
            onClick={onOpenDetail}
            className="text-sm font-extrabold text-white group-hover:text-[#CCFF00] transition-colors cursor-pointer line-clamp-2 leading-snug"
          >
            {exercise.name}
          </h3>
        </div>

        {/* Action Buttons */}
        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center space-x-2">
          <button
            type="button"
            onClick={onOpenDetail}
            className="flex-1 py-2 px-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold text-xs flex items-center justify-center space-x-1 transition-colors"
          >
            <Info className="w-3.5 h-3.5" />
            <span>Detalle</span>
          </button>

          <button
            type="button"
            onClick={onAddToRoutine}
            className="flex-1 py-2 px-2.5 rounded-xl bg-[#CCFF00] hover:bg-[#b8e600] text-slate-950 font-black text-xs flex items-center justify-center space-x-1 shadow-md shadow-amber-500/10 active:scale-95 transition-all"
          >
            <Plus className="w-3.5 h-3.5 stroke-[3]" />
            <span>Añadir</span>
          </button>
        </div>
      </div>
    </div>
  );
};

interface ExerciseDetailQuickModalProps {
  exercise: LibraryExercise;
  isOpen: boolean;
  onClose: () => void;
  onAddToRoutine: () => void;
}

const ExerciseDetailQuickModal: React.FC<ExerciseDetailQuickModalProps> = ({
  exercise,
  isOpen,
  onClose,
  onAddToRoutine,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#171717] border border-slate-700/80 rounded-3xl p-5 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="text-xs font-bold text-slate-400 flex items-center gap-2">
              <span className="text-[#CCFF00]">{exercise.muscleGroup}</span>
              <span>·</span>
              <span>{exercise.equipment || 'Material General'}</span>
            </div>
            <h3 className="text-lg font-black text-white mt-1 leading-snug">
              {exercise.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Video Player Section */}
        <div className="my-4 rounded-2xl overflow-hidden bg-black aspect-square relative border border-slate-800">
          {exercise.videoUrl ? (
            exercise.videoUrl.endsWith('.gif') || exercise.videoUrl.endsWith('.webp') ? (
              <img
                src={exercise.videoUrl}
                alt={exercise.name}
                className="w-full h-full object-contain"
              />
            ) : (
              <video
                src={exercise.videoUrl}
                poster={exercise.thumbnailUrl || undefined}
                autoPlay
                loop
                muted
                playsInline
                controls
                className="w-full h-full object-contain"
              />
            )
          ) : exercise.thumbnailUrl ? (
            <img
              src={exercise.thumbnailUrl}
              alt={exercise.name}
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600">
              <Dumbbell className="w-12 h-12 text-slate-500" />
            </div>
          )}
        </div>

        {exercise.shortInstructions?.length ? (
          <section className="mb-4 text-sm text-slate-300">
            <h3 className="mb-2 font-bold text-white">Ejecución</h3>
            <ol className="list-decimal space-y-1 pl-5">
              {exercise.shortInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
            </ol>
          </section>
        ) : null}

        {/* Details & Specs */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-4">
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Grupo Muscular Principal
            </span>
            <span className="font-extrabold text-[#CCFF00] text-sm">
              {exercise.muscleGroup}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Equipamiento Requerido
            </span>
            <span className="font-extrabold text-white text-sm">
              {exercise.equipment || 'Peso Corporal'}
            </span>
          </div>
        </div>

        {/* Biomechanical Guidelines */}
        <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 mb-4">
          <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#CCFF00]" />
            Pautas de Ejecución Técnica
          </h4>
          <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
            <li>Mantén el rango completo de movimiento con control estricto.</li>
            <li>Evita balanceos o inercias que resten trabajo al músculo objetivo.</li>
            <li>Inhala al bajar el peso (excéntrico) y exhala en la fase de empuje/tirón.</li>
          </ul>
        </div>

        {/* Action Button */}
        <div className="flex items-center space-x-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs"
          >
            Cerrar
          </button>
          <button
            onClick={onAddToRoutine}
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-[#CCFF00] to-[#b8e600] hover:from-[#d8ff44] hover:to-[#CCFF00] text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center space-x-1.5"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Añadir a Mis Rutinas</span>
          </button>
        </div>
      </div>
    </div>
  );
};
