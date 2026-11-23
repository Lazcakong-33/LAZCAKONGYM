import React from 'react';
import { ChevronRight } from 'lucide-react';
import {
  CANONICAL_16_MUSCLE_GROUPS,
  EXERCISE_LIBRARY,
  filterExerciseCatalog,
} from '../data/exerciseLibrary';
import type { Canonical16MuscleGroupId } from '../types';

interface MuscleGroupCardsGridProps {
  onSelectMuscle: (muscle: string) => void;
}

function renderMuscleHighlight(id: Canonical16MuscleGroupId) {
  switch (id) {
    case 'pecho':
      return <ellipse cx="50" cy="40" rx="10" ry="6" className="text-accent fill-current animate-pulse" />;
    case 'espalda':
      return <path d="M40 36 L60 36 L58 55 L42 55 Z" className="text-accent fill-current animate-pulse" />;
    case 'hombros':
      return (
        <>
          <circle cx="34" cy="36" r="5" className="text-accent fill-current" />
          <circle cx="66" cy="36" r="5" className="text-accent fill-current" />
        </>
      );
    case 'biceps':
      return (
        <>
          <circle cx="21" cy="46" r="4" className="text-accent fill-current" />
          <circle cx="79" cy="46" r="4" className="text-accent fill-current" />
        </>
      );
    case 'triceps':
      return (
        <>
          <circle cx="25" cy="45" r="3.5" className="text-accent fill-current" />
          <circle cx="75" cy="45" r="3.5" className="text-accent fill-current" />
        </>
      );
    case 'antebrazos':
      return (
        <>
          <path d="M20 52 L16 70 L20 71 L23 53 Z" className="text-accent fill-current" />
          <path d="M80 52 L84 70 L80 71 L77 53 Z" className="text-accent fill-current" />
        </>
      );
    case 'trapecios':
      return <path d="M42 29 L58 29 L63 36 L37 36 Z" className="text-accent fill-current" />;
    case 'cuello':
      return <rect x="46" y="24" width="8" height="8" rx="2" className="text-accent fill-current" />;
    case 'abdomen_core':
      return <rect x="42" y="44" width="16" height="18" rx="2" className="text-accent fill-current animate-pulse" />;
    case 'cuadriceps':
      return (
        <>
          <path d="M29 73 L39 74 L35 100 L24 98 Z" className="text-accent fill-current" />
          <path d="M71 73 L61 74 L65 100 L76 98 Z" className="text-accent fill-current" />
        </>
      );
    case 'isquiotibiales':
      return (
        <>
          <path d="M26 76 L33 76 L30 102 L22 100 Z" className="text-accent fill-current" />
          <path d="M74 76 L67 76 L70 102 L78 100 Z" className="text-accent fill-current" />
        </>
      );
    case 'gluteos':
      return <ellipse cx="50" cy="65" rx="12" ry="5" className="text-accent fill-current" />;
    case 'aductores_abductores':
      return (
        <>
          <path d="M38 72 L45 72 L43 92 L37 92 Z" className="text-accent fill-current" />
          <path d="M62 72 L55 72 L57 92 L63 92 Z" className="text-accent fill-current" />
        </>
      );
    case 'pantorrillas':
      return (
        <>
          <ellipse cx="26" cy="112" rx="4" ry="8" className="text-accent fill-current" />
          <ellipse cx="74" cy="112" rx="4" ry="8" className="text-accent fill-current" />
        </>
      );
    case 'potencia_explosividad':
      return <path d="M50 32 L42 52 L51 52 L47 70 L60 47 L51 47 Z" className="text-accent fill-current animate-pulse" />;
    case 'movilidad_acondicionamiento':
      return <circle cx="50" cy="52" r="14" fill="none" stroke="currentColor" strokeWidth="4" className="text-accent" />;
    default:
      return null;
  }
}

export const MuscleGroupCardsGrid: React.FC<MuscleGroupCardsGridProps> = ({ onSelectMuscle }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {CANONICAL_16_MUSCLE_GROUPS.map((cat) => {
        const matchingExercises = filterExerciseCatalog(EXERCISE_LIBRARY, { muscle: cat.filterKey });
        const count = matchingExercises.length;
        const topExercises = matchingExercises.slice(0, 3);

        return (
          <div
            key={cat.id}
            onClick={() => onSelectMuscle(cat.filterKey)}
            className="group rounded-3xl p-5 border border-accent/40 hover:border-accent bg-gradient-to-br from-[#171717] via-[#11141c] to-[#090d16] transition-all cursor-pointer shadow-xl relative overflow-hidden flex flex-col justify-between"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-full blur-3xl group-hover:bg-accent/20 transition-all pointer-events-none" />

            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3.5">
                {/* Anatomical Silhouette Thumbnail with Accent Highlights */}
                <div className="w-12 h-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0 relative overflow-hidden group-hover:border-accent/50 transition-colors shadow-inner">
                  <svg className="w-8 h-12 text-slate-700" viewBox="0 0 100 150" fill="currentColor">
                    <circle cx="50" cy="18" r="10" />
                    <path d="M35 32 C35 30 65 30 65 32 L72 70 L60 72 L55 50 L45 50 L40 72 L28 70 Z" />
                    <path d="M28 70 L20 105 L26 107 L33 75 Z" />
                    <path d="M72 70 L80 105 L74 107 L67 75 Z" />
                    <path d="M35 32 L20 45 L24 49 L38 38 Z" />
                    <path d="M65 32 L80 45 L76 49 L62 38 Z" />
                    {renderMuscleHighlight(cat.id)}
                  </svg>
                </div>

                <div>
                  <h3 className="text-base font-black text-accent-text group-hover:text-accent-text transition-colors tracking-tight">
                    {cat.label}
                  </h3>
                  <span
                    className={`text-xs font-mono font-bold block mt-0.5 ${
                      count > 0 ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {count > 0
                      ? `${count} ${count === 1 ? 'ejercicio' : 'ejercicios'}`
                      : 'Próximamente (Lote Etapa 2)'}
                  </span>
                </div>
              </div>

              <div className="w-8 h-8 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-accent-text group-hover:border-accent/40 transition-all">
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>

            {/* Top Preview Exercises */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-1.5">
              {topExercises.length > 0 ? (
                topExercises.map((ex) => (
                  <div key={ex.id} className="text-xs text-slate-300 truncate flex items-center gap-2 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent shrink-0" />
                    <span className="truncate">{ex.name}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-slate-400 italic">
                  Categoría preparada · incorporación programada en Etapa 2
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

