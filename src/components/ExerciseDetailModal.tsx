import React, { useState } from 'react';
import {
  X,
  ExternalLink,
  Video,
  CheckCircle2,
  Shuffle,
  Plus,
  Trash2,
  Bookmark,
} from 'lucide-react';
import { Exercise } from '../types';
import { enrichExerciseWithLibrary } from '../utils/enrichRoutines';

interface ExerciseDetailModalProps {
  exercise: Exercise | null;
  isOpen: boolean;
  onClose: () => void;
  customLinks?: { id: string; title: string; url: string }[];
  onAddCustomLink?: (exerciseId: string, title: string, url: string) => void;
  onDeleteCustomLink?: (exerciseId: string, linkId: string) => void;
  isAlternativeSelected?: boolean;
  onToggleAlternative?: (exerciseId: string) => void;
}

export const ExerciseDetailModal: React.FC<ExerciseDetailModalProps> = ({
  exercise: savedExercise,
  isOpen,
  onClose,
  customLinks = [],
  onAddCustomLink,
  onDeleteCustomLink,
  isAlternativeSelected = false,
  onToggleAlternative,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const exercise = savedExercise ? enrichExerciseWithLibrary(savedExercise) : null;
  if (!isOpen || !exercise) return null;

  const handleAddLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTitle.trim() && newUrl.trim() && onAddCustomLink) {
      onAddCustomLink(exercise.id, newTitle.trim(), newUrl.trim());
      setNewTitle('');
      setNewUrl('');
      setShowAddForm(false);
    }
  };

  const displayName =
    isAlternativeSelected && exercise.alternative ? exercise.alternative : exercise.name;

  const mediaExercise = isAlternativeSelected && exercise.alternative
    ? enrichExerciseWithLibrary({ ...exercise, id: '', libraryExerciseId: undefined, name: exercise.alternative, defaultVideoUrl: '', thumbnailUrl: undefined, secondaryThumbnailUrl: undefined })
    : exercise;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-['Plus_Jakarta_Sans',sans-serif]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-[#090909] border border-[#303030] rounded-3xl p-5 sm:p-6 shadow-2xl text-[#F5F5F5] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 pb-3.5 border-b border-[#303030]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-black uppercase tracking-wider text-[#CCFF00]">
                {exercise.targetMuscles}
              </span>
              {exercise.objective && (
                <>
                  <span className="text-zinc-600" aria-hidden="true">
                    ·
                  </span>
                  <span className="text-zinc-300">{exercise.objective}</span>
                </>
              )}
            </div>
            <h3 className="text-lg sm:text-xl font-black text-[#F5F5F5] mt-1 leading-snug">
              {displayName}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-zinc-400 hover:text-[#F5F5F5] flex items-center justify-center shrink-0 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alternative Exercise Switcher */}
        {exercise.alternative && (
          <div className="my-3.5 p-3.5 rounded-2xl bg-[#171717] border border-[#303030] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] uppercase font-bold text-zinc-400 block">
                Variante Alternativa Programada
              </span>
              <span className="text-xs sm:text-sm font-black text-[#CCFF00] block leading-snug">
                {exercise.alternative}
              </span>
            </div>
            {onToggleAlternative && (
              <button
                type="button"
                onClick={() => onToggleAlternative(exercise.id)}
                className={`min-h-[40px] py-2 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shrink-0 transition-all cursor-pointer ${
                  isAlternativeSelected
                    ? 'bg-[#CCFF00] text-[#090909]'
                    : 'bg-[#090909] border border-[#303030] text-[#F5F5F5] hover:border-[#CCFF00]'
                }`}
              >
                <Shuffle className="w-3.5 h-3.5" />
                <span>{isAlternativeSelected ? 'Activa' : 'Usar Variante'}</span>
              </button>
            )}
          </div>
        )}

        {/* Prescription Summary */}
        <div className="grid grid-cols-3 gap-2.5 my-3.5 text-center">
          <div className="p-3 rounded-2xl bg-[#171717] border border-[#303030]">
            <span className="text-[10px] uppercase font-bold text-zinc-400 block">Series</span>
            <span className="text-base font-black font-mono tabular-nums text-[#F5F5F5]">
              {exercise.defaultSets}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-[#171717] border border-[#303030]">
            <span className="text-[10px] uppercase font-bold text-zinc-400 block">
              Repeticiones
            </span>
            <span className="text-base font-black font-mono tabular-nums text-[#CCFF00]">
              {exercise.repRange}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-[#171717] border border-[#303030]">
            <span className="text-[10px] uppercase font-bold text-zinc-400 block">Descanso</span>
            <span className="text-base font-black font-mono tabular-nums text-[#F5F5F5]">
              {exercise.restText || `${exercise.restSeconds || 90} seg`}
            </span>
          </div>
        </div>

        {/* Technique Cues */}
        <div className="my-4">
          <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300 mb-2.5 flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-[#CCFF00]" />
            <span>Técnica y Claves de Biomecánica</span>
          </h4>
          <div className="space-y-2">
            {exercise.techniqueCues && exercise.techniqueCues.length > 0 ? (
              exercise.techniqueCues.map((cue, idx) => (
                <div
                  key={idx}
                  className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] text-xs text-zinc-200 leading-relaxed flex items-start gap-2.5"
                >
                  <span className="w-5 h-5 rounded-lg bg-[#090909] border border-[#CCFF00]/50 text-[#CCFF00] flex items-center justify-center font-mono font-black text-[10px] shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span>{cue}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500">No hay notas de técnica registradas.</p>
            )}
          </div>
        </div>

        {/* Original local movement, played inside the app. */}
        {mediaExercise.defaultVideoUrl && /\.(webp|gif)$/i.test(mediaExercise.defaultVideoUrl) && (
          <div className="my-4 rounded-2xl overflow-hidden bg-black border border-[#303030]">
            <img src={mediaExercise.defaultVideoUrl} alt={`Movimiento: ${displayName}`} className="w-full max-h-[50vh] object-contain" />
            <p className="text-center text-xs text-[#CCFF00] py-2">LazcaKong Gym · 8 poses · 4 segundos</p>
          </div>
        )}
        {mediaExercise.defaultVideoUrl && /\.mp4(?:\?|$)/i.test(mediaExercise.defaultVideoUrl) && (
          <video src={mediaExercise.defaultVideoUrl} autoPlay loop muted playsInline controls className="my-4 w-full rounded-2xl" />
        )}
        {/^https?:\/\//i.test(mediaExercise.defaultVideoUrl || '') && !/\.(?:mp4|webp|gif)(?:\?|$)/i.test(mediaExercise.defaultVideoUrl) && (
          <a href={mediaExercise.defaultVideoUrl} target="_blank" rel="noopener noreferrer" className="my-4 flex items-center gap-2 text-sm text-[#CCFF00]">
            <ExternalLink className="w-4 h-4" /> Enlace guardado de este ejercicio
          </a>
        )}
        {!mediaExercise.defaultVideoUrl && (
          <p className="my-4 text-sm text-zinc-400">Este ejercicio se conserva en tu rutina. Selecciona su movimiento en la biblioteca si deseas vincular una animación.</p>
        )}

        {/* User Custom Links / Notes */}
        <div className="my-4 pt-3.5 border-t border-[#303030]">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-black uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
              <Bookmark className="w-4 h-4 text-[#CCFF00]" />
              <span>Tus Enlaces Personalizados ({customLinks.length})</span>
            </h4>
            {onAddCustomLink && (
              <button
                type="button"
                onClick={() => setShowAddForm(!showAddForm)}
                className="text-xs font-bold text-[#CCFF00] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showAddForm ? 'Cancelar' : 'Agregar enlace'}</span>
              </button>
            )}
          </div>

          {showAddForm && onAddCustomLink && (
            <form
              onSubmit={handleAddLink}
              className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] mb-3 space-y-2.5"
            >
              <input
                type="text"
                placeholder="Título del enlace (ej: Video de técnica)"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="w-full min-h-[40px] text-xs bg-[#090909] border border-[#303030] rounded-xl px-3 py-2 text-[#F5F5F5] focus:outline-none focus:border-[#CCFF00]"
                required
              />
              <input
                type="url"
                placeholder="https://..."
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="w-full min-h-[40px] text-xs bg-[#090909] border border-[#303030] rounded-xl px-3 py-2 text-[#F5F5F5] focus:outline-none focus:border-[#CCFF00]"
                required
              />
              <button
                type="submit"
                className="w-full min-h-[40px] py-2 bg-[#CCFF00] hover:bg-[#b8e600] text-[#090909] font-black text-xs uppercase rounded-xl cursor-pointer"
              >
                Guardar Enlace
              </button>
            </form>
          )}

          {customLinks.length === 0 ? (
            <p className="text-xs text-zinc-500">
              Puedes agregar enlaces a tus propios videos de técnica o apuntes personales.
            </p>
          ) : (
            <div className="space-y-1.5">
              {customLinks.map((link) => (
                <div
                  key={link.id}
                  className="p-3 rounded-xl bg-[#171717] border border-[#303030] flex items-center justify-between text-xs"
                >
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-[#CCFF00] hover:underline flex items-center gap-1.5 truncate max-w-[260px]"
                  >
                    <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{link.title}</span>
                  </a>
                  {onDeleteCustomLink && (
                    <button
                      type="button"
                      onClick={() => onDeleteCustomLink(exercise.id, link.id)}
                      className="text-zinc-500 hover:text-[#EF4444] p-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="pt-2">
          <button
            type="button"
            onClick={onClose}
            className="w-full min-h-[46px] py-3 rounded-2xl bg-[#171717] hover:bg-[#242424] border border-[#303030] text-[#F5F5F5] font-bold text-xs uppercase tracking-wider active:scale-95 transition-all cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
