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
  Clock,
  ChevronDown,
  Image as ImageIcon,
} from 'lucide-react';
import { Routine, Exercise, LibraryExercise } from '../types';
import {
  EXERCISE_LIBRARY,
  MUSCLE_GROUPS,
  CANONICAL_EQUIPMENT_FILTERS,
  filterExerciseCatalog,
  resolveVisualResourceStatus,
  resolveCanonical16MuscleGroup,
  getCanonical16GroupLabel,
  resolveCanonical9Equipment,
} from '../data/exerciseLibrary';
import { AddToRoutineModal } from '../components/AddToRoutineModal';
import { MuscleGroupCardsGrid } from '../components/MuscleGroupCardsGrid';
import { ExerciseThumbnail } from '../components/ExerciseThumbnail';
import { NeckMovementDemo } from '../components/NeckMovementDemo';
import { getNeckMovementSpec } from '../utils/neckMovementSpec';
import { libraryItemToExercise } from '../utils/exerciseAlternatives';

interface ExerciseLibraryViewProps {
  routines: Routine[];
  onAddExerciseToRoutine: (routineId: string, exercise: Exercise) => void;
  onCreateRoutineWithExercise: (routineTitle: string, dayName: string, exercise: Exercise) => void;
  onOpenAIRoutineModal?: () => void;
  onOpenExerciseModal?: (exercise: Exercise) => void;
}

export const ExerciseLibraryView: React.FC<ExerciseLibraryViewProps> = ({
  routines,
  onAddExerciseToRoutine,
  onCreateRoutineWithExercise,
  onOpenAIRoutineModal,
  onOpenExerciseModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<string>('Todos');
  const [selectedEquipment, setSelectedEquipment] = useState<string>('Todos');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [visibleCount, setVisibleCount] = useState<number>(24);

  // Modals state
  const [selectedExerciseForAdd, setSelectedExerciseForAdd] = useState<LibraryExercise | null>(null);
  const [selectedExerciseDetail, setSelectedExerciseDetail] = useState<LibraryExercise | null>(null);

  // Filter exercises using centralized single-source catalog filter
  const filteredExercises = useMemo(() => {
    return filterExerciseCatalog(EXERCISE_LIBRARY, {
      muscle: selectedMuscle,
      equipment: selectedEquipment,
      searchQuery,
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
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-[#0d1424] to-[#090d16] border border-slate-800 p-5 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                Catálogo Técnico LazcaKong Elite
              </span>
              <span className="text-slate-500 text-xs">·</span>
              <span className="text-[11px] font-mono text-slate-400">
                {EXERCISE_LIBRARY.length} Ejercicios
              </span>
            </div>
            <h1 className="text-2xl font-black text-white tracking-tight">
              Biblioteca de Ejercicios
            </h1>
            <p className="text-xs text-slate-400 mt-1 max-w-xl">
              Explora animaciones técnicas verificadas, biomecánica por grupo muscular y variantes con barra, mancuernas, poleas, máquinas, kettlebells y peso corporal.
            </p>
          </div>

          {onOpenAIRoutineModal && (
            <button
              onClick={onOpenAIRoutineModal}
              className="py-2.5 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center space-x-2 shrink-0"
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
            className="w-full bg-[#0d1424] border border-slate-800 rounded-2xl pl-10 pr-10 py-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 transition-colors"
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
                className="text-[10px] text-amber-400 hover:text-amber-300 font-semibold"
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
                      : 'bg-[#0d1424] border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
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
            className="flex-1 bg-[#0d1424] border border-slate-800 text-xs text-slate-200 rounded-xl px-3 py-1.5 focus:outline-none focus:border-amber-400"
          >
            {CANONICAL_EQUIPMENT_FILTERS.map((eq) => (
              <option key={eq} value={eq}>
                {eq === 'Todos' ? 'Cualquier equipamiento' : eq}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* View Mode Toggle Bar */}
      <div className="flex items-center justify-between bg-[#0d1424] p-1.5 rounded-2xl border border-slate-800">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              viewMode === 'grid'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>🗂️ Cuadrícula Muscular</span>
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
              viewMode === 'list'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>📋 Lista de Ejercicios</span>
          </button>
        </div>

        {selectedMuscle !== 'Todos' && (
          <button
            onClick={() => setSelectedMuscle('Todos')}
            className="text-[11px] text-amber-400 hover:text-amber-300 font-bold px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30"
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
              <span className="text-[11px] text-amber-400 font-bold">
                Filtro: {selectedMuscle}
              </span>
            )}
          </div>

      {/* Empty State */}
      {displayedExercises.length === 0 && (
        <div className="text-center py-16 px-4 rounded-3xl bg-[#0d1424] border border-slate-800">
          <Dumbbell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white">No se encontraron ejercicios</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            Prueba ajustando los términos de búsqueda o eliminando los filtros de músculo y equipamiento.
          </p>
          <button
            onClick={handleClearFilters}
            className="mt-4 py-2 px-4 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl"
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
            onOpenDetail={() => {
              if (onOpenExerciseModal) {
                onOpenExerciseModal(libraryItemToExercise(exercise));
              } else {
                setSelectedExerciseDetail(exercise);
              }
            }}
            onAddToRoutine={() => setSelectedExerciseForAdd(exercise)}
          />
        ))}
      </div>

      {/* Load More Button */}
      {visibleCount < filteredExercises.length && (
        <div className="text-center pt-4">
          <button
            onClick={handleLoadMore}
            className="py-3 px-6 rounded-2xl bg-[#0d1424] hover:bg-slate-800 border border-slate-700/80 text-white font-bold text-xs shadow-lg transition-all active:scale-95 inline-flex items-center space-x-2"
          >
            <span>Cargar más ejercicios ({filteredExercises.length - visibleCount} restantes)</span>
            <ChevronDown className="w-4 h-4 text-amber-400" />
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);

  const visualStatus = resolveVisualResourceStatus(exercise);
  const canonicalGroupLabel = getCanonical16GroupLabel(resolveCanonical16MuscleGroup(exercise));
  const canonicalEqLabel = resolveCanonical9Equipment(exercise).label;
  const hasNeckDemo = getNeckMovementSpec(exercise) !== null;
  const animUrl = exercise.animationUrl || exercise.videoUrl || null;
  const isMp4Video = Boolean(animUrl && /\.(mp4|webm)(\?|$)/i.test(animUrl));
  const isAnimatedImage = Boolean(animUrl && /\.(webp|gif)(\?|$)/i.test(animUrl));

  useEffect(() => {
    setVideoFailed(false);
  }, [exercise.id, animUrl]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener?.('change', listener);
    return () => mq.removeEventListener?.('change', listener);
  }, []);

  useEffect(() => {
    const node = cardRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setIsVisible(entry.isIntersecting);
        }
      },
      { threshold: 0.1, rootMargin: '80px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const shouldAnimate = isVisible && !prefersReducedMotion && !videoFailed;

  const handleMouseEnter = () => {
    if (videoRef.current && !videoFailed && isMp4Video) {
      videoRef.current.play().catch(() => {});
    }
  };

  const handleMouseLeave = () => {
    if (videoRef.current && !videoFailed && isMp4Video) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
    }
  };

  const badgeText = (() => {
    if (hasNeckDemo) return 'DEMO 4 S';
    if (visualStatus === 'pending_resource') {
      return exercise.thumbnailUrl ? 'IMAGEN · ANIM. PEND.' : 'PENDIENTE';
    }
    if (visualStatus === 'static_image') return 'FOTO';
    if (animUrl?.toLowerCase().includes('.gif')) return 'ANIM GIF';
    if (isMp4Video) return 'VIDEO MP4';
    return 'ANIM WEBP';
  })();

  const displayedImageSrc =
    shouldAnimate && isAnimatedImage && animUrl
      ? animUrl
      : exercise.thumbnailUrl || (isAnimatedImage ? animUrl : null);

  return (
    <div
      ref={cardRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="group rounded-3xl bg-[#0d1424] border border-slate-800/80 hover:border-amber-500/40 overflow-hidden flex flex-col justify-between transition-all duration-200 shadow-md hover:shadow-xl hover:shadow-black/50"
    >
      {/* Media Container: #090909 stage with object-contain and viewport-gated animation */}
      <div
        onClick={onOpenDetail}
        className="relative aspect-video w-full bg-[#090909] overflow-hidden cursor-pointer flex items-center justify-center"
      >
        {hasNeckDemo ? (
          <NeckMovementDemo exercise={exercise} paused={!shouldAnimate} className="w-full h-full" />
        ) : visualStatus === 'pending_resource' ? (
          exercise.thumbnailUrl ? (
            <ExerciseThumbnail
              src={exercise.thumbnailUrl}
              alt={exercise.name}
              muscleGroup={canonicalGroupLabel}
              className="w-full h-full border-0 rounded-none bg-[#090909]"
              imgClassName="w-full h-full object-contain p-1.5"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center px-4 text-center gap-1.5 bg-[#090909]">
              <Clock className="w-6 h-6 text-amber-400/80" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Recurso pendiente
              </span>
              <span className="text-[10px] text-slate-500">
                Animación técnica en preparación
              </span>
            </div>
          )
        ) : !displayedImageSrc ? (
          isMp4Video && animUrl && !videoFailed ? (
            <video
              ref={videoRef}
              src={animUrl}
              poster={exercise.thumbnailUrl || undefined}
              loop
              muted
              playsInline
              preload="none"
              onError={() => setVideoFailed(true)}
              className="w-full h-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center px-4 text-center gap-1.5 bg-[#090909]">
              <Clock className="w-6 h-6 text-amber-400/80" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                Recurso pendiente
              </span>
              <span className="text-[10px] text-slate-500">
                Animación técnica en preparación
              </span>
            </div>
          )
        ) : isMp4Video && animUrl && !videoFailed ? (
          <video
            ref={videoRef}
            src={animUrl}
            poster={exercise.thumbnailUrl || undefined}
            loop
            muted
            playsInline
            preload="none"
            onError={() => setVideoFailed(true)}
            className="w-full h-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
          />
        ) : isAnimatedImage && shouldAnimate ? (
          <img
            src={displayedImageSrc}
            alt={exercise.name}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onError={() => setVideoFailed(true)}
            className="w-full h-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <ExerciseThumbnail
            src={displayedImageSrc}
            alt={exercise.name}
            muscleGroup={canonicalGroupLabel}
            className="w-full h-full border-0 rounded-none bg-[#090909]"
            imgClassName="w-full h-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
          />
        )}

        {/* Honest Visual Resource Badge */}
        <div
          className={`absolute top-2.5 right-2.5 bg-black/75 backdrop-blur-md px-2 py-0.5 rounded-lg text-[10px] font-bold flex items-center gap-1 border border-white/10 ${
            visualStatus === 'pending_resource'
              ? 'text-slate-300'
              : visualStatus === 'static_image'
              ? 'text-cyan-300'
              : 'text-amber-400'
          }`}
        >
          {hasNeckDemo ? (
            <NeckMovementDemo exercise={exercise} className="w-full h-full" />
          ) : visualStatus === 'pending_resource' ? (
            <Clock className="w-2.5 h-2.5" />
          ) : visualStatus === 'static_image' ? (
            <ImageIcon className="w-2.5 h-2.5" />
          ) : (
            <Play className="w-2.5 h-2.5 fill-current" />
          )}
          <span>{badgeText}</span>
        </div>

        {/* Overlay scrim */}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#0d1424]/85 via-[#0d1424]/30 to-transparent pointer-events-none" />
      </div>

      {/* Content */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          {/* Metadata without pills */}
          <div className="text-[11px] font-bold text-slate-400 flex items-center gap-2 mb-1">
            <span className="text-amber-400 truncate">{canonicalGroupLabel}</span>
            <span className="text-slate-600">·</span>
            <span className="truncate">{exercise.equipment || canonicalEqLabel}</span>
          </div>

          <h3
            onClick={onOpenDetail}
            className="text-sm font-extrabold text-white group-hover:text-amber-300 transition-colors cursor-pointer line-clamp-2 leading-snug"
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
            className="flex-1 py-2 px-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center space-x-1 shadow-md shadow-amber-500/10 active:scale-95 transition-all"
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

  const visualStatus = resolveVisualResourceStatus(exercise);
  const canonicalGroupLabel = getCanonical16GroupLabel(resolveCanonical16MuscleGroup(exercise));
  const canonicalEqLabel = resolveCanonical9Equipment(exercise).label;
  const hasNeckDemo = getNeckMovementSpec(exercise) !== null;
  const mediaSrc = exercise.animationUrl || exercise.videoUrl || null;
  const isAnimatedImage = Boolean(mediaSrc && /\.(gif|webp)(\?|$)/i.test(mediaSrc));
  const directResourceUrl =
    visualStatus !== 'pending_resource' &&
    exercise.url &&
    !/smartworkout\.app/i.test(exercise.url)
      ? exercise.url
      : null;
  const targetMusclesSummary = [
    ...(exercise.primaryMuscles || []),
    ...(exercise.secondaryMuscles || []),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#0d1424] border border-slate-700/80 rounded-3xl p-5 shadow-2xl text-slate-100 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-start justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="text-xs font-bold text-slate-400 flex items-center gap-2">
              <span className="text-amber-400">{canonicalGroupLabel}</span>
              <span>·</span>
              <span>{exercise.equipment || canonicalEqLabel}</span>
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

        {/* Media Player Section */}
        <div className="my-4 rounded-2xl overflow-hidden bg-[#090909] aspect-video relative border border-slate-800 flex items-center justify-center">
          {visualStatus === 'pending_resource' ? (
            exercise.thumbnailUrl ? (
              <div className="w-full h-full relative flex items-center justify-center">
                <img
                  src={exercise.thumbnailUrl}
                  alt={exercise.name}
                  className="w-full h-full object-contain p-2"
                />
                <span className="absolute bottom-2 right-2 bg-black/80 border border-white/10 text-[10px] font-bold text-amber-300 px-2 py-0.5 rounded-md">
                  Imagen de referencia · Animación en preparación
                </span>
              </div>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center px-6 text-center gap-2">
                <Clock className="w-9 h-9 text-amber-400/80" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                  Recurso pendiente
                </span>
                <span className="text-xs text-slate-400">
                  La demostración visual de este ejercicio se encuentra en preparación.
                </span>
              </div>
            )
          ) : mediaSrc ? (
            isAnimatedImage ? (
              <img
                src={mediaSrc}
                alt={exercise.name}
                className="w-full h-full object-contain p-2"
              />
            ) : (
              <video
                src={mediaSrc}
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
              className="w-full h-full object-contain p-2"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-600">
              <Dumbbell className="w-12 h-12 text-slate-500" />
            </div>
          )}
        </div>

        {/* Details & Specs */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-4">
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Grupo Muscular Principal
            </span>
            <span className="font-extrabold text-amber-300 text-sm">
              {canonicalGroupLabel}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Equipamiento Requerido
            </span>
            <span className="font-extrabold text-white text-sm">
              {exercise.equipment || canonicalEqLabel}
            </span>
          </div>
        </div>

        {targetMusclesSummary && (
          <div className="p-3 rounded-2xl bg-slate-900/80 border border-slate-800 mb-3 text-xs">
            <span className="text-[10px] uppercase font-bold text-slate-400 block mb-0.5">
              Músculos Objetivo
            </span>
            <span className="text-slate-200 font-semibold">{targetMusclesSummary}</span>
          </div>
        )}

        {/* Structured Phases when available (Stage 2A+) or Biomechanical Guidelines */}
        {exercise.startingPosition || exercise.activePhase || exercise.returnPhase ? (
          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2.5 mb-4 text-xs">
            <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Fases de Ejecución Técnica
            </h4>
            {exercise.startingPosition && (
              <div>
                <span className="text-[10px] font-bold uppercase text-amber-300 block">
                  Posición inicial
                </span>
                <p className="text-slate-300 leading-relaxed">{exercise.startingPosition}</p>
              </div>
            )}
            {exercise.activePhase && (
              <div>
                <span className="text-[10px] font-bold uppercase text-amber-300 block">
                  Fase activa
                </span>
                <p className="text-slate-300 leading-relaxed">{exercise.activePhase}</p>
              </div>
            )}
            {exercise.returnPhase && (
              <div>
                <span className="text-[10px] font-bold uppercase text-amber-300 block">
                  Retorno controlado
                </span>
                <p className="text-slate-300 leading-relaxed">{exercise.returnPhase}</p>
              </div>
            )}
            {Array.isArray(exercise.shortInstructions) && exercise.shortInstructions.length > 0 && (
              <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside pt-1 border-t border-slate-800">
                {exercise.shortInstructions.map((inst, i) => (
                  <li key={i}>{inst}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-2 mb-4">
            <h4 className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Pautas de Ejecución Técnica
            </h4>
            <ul className="text-xs text-slate-300 space-y-1.5 list-disc list-inside">
              <li>Mantén el rango completo de movimiento con control estricto.</li>
              <li>Evita balanceos o inercias que resten trabajo al músculo objetivo.</li>
              <li>Inhala al bajar el peso (excéntrico) y exhala en la fase de empuje/tirón.</li>
            </ul>
          </div>
        )}

        {/* Safety Warnings & Contraindications */}
        {((Array.isArray(exercise.safetyWarnings) && exercise.safetyWarnings.length > 0) ||
          (Array.isArray(exercise.contraindications) && exercise.contraindications.length > 0)) && (
          <div className="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/30 space-y-1.5 mb-4 text-xs">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-300 block">
              Seguridad y Contraindicaciones
            </span>
            <ul className="text-slate-300 space-y-1 list-disc list-inside">
              {(exercise.safetyWarnings || []).map((w, idx) => (
                <li key={`w-${idx}`}>{w}</li>
              ))}
              {(exercise.contraindications || []).map((c, idx) => (
                <li key={`c-${idx}`} className="text-amber-200/90">
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* External links */}
        <div className="space-y-2 mb-4">
          {directResourceUrl && (
            <a
              href={directResourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs font-bold flex items-center justify-between transition-colors"
            >
              <span>Abrir recurso visual directo</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          )}

          <a
            href={`https://www.youtube.com/results?search_query=${encodeURIComponent(exercise.name + ' tutorial tecnica gimnasio')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-rose-400 hover:text-rose-300 text-xs font-bold flex items-center justify-between transition-colors"
          >
            <span>Buscar tutoriales en YouTube</span>
            <ExternalLink className="w-3.5 h-3.5 text-rose-400" />
          </a>
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
            className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center space-x-1.5"
          >
            <Plus className="w-4 h-4 stroke-[3]" />
            <span>Añadir a Mis Rutinas</span>
          </button>
        </div>
      </div>
    </div>
  );
};
