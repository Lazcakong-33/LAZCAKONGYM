import React from 'react';
import { ChevronRight } from 'lucide-react';
import { EXERCISE_LIBRARY } from '../data/exerciseLibrary';

interface MuscleGroupCardsGridProps {
  onSelectMuscle: (muscle: string) => void;
}

export const MuscleGroupCardsGrid: React.FC<MuscleGroupCardsGridProps> = ({ onSelectMuscle }) => {
  const categories = [
    { id: 'Pecho', label: 'Pecho' },
    { id: 'Espalda', label: 'Espalda' },
    { id: 'Hombro', label: 'Hombros' },
    { id: 'Pierna', label: 'Piernas' },
    { id: 'Glúteos', label: 'Glúteos' },
    { id: 'Bíceps', label: 'Bíceps' },
    { id: 'Tríceps', label: 'Tríceps' },
    { id: 'Antebrazo', label: 'Antebrazos' },
    { id: 'Abdomen', label: 'Abdominales' },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {categories.map((cat) => {
        const matchingExercises = EXERCISE_LIBRARY.filter((ex) =>
          ex.muscleGroup.toLowerCase().includes(cat.id.toLowerCase())
        );
        const count = matchingExercises.length;
        const topExercises = matchingExercises.slice(0, 3);

        return (
          <div
            key={cat.id}
            onClick={() => onSelectMuscle(cat.id)}
            className="group rounded-3xl p-5 border border-[#CCFF00]/40 hover:border-orange-400 bg-gradient-to-br from-[#1c120a] via-[#11141c] to-[#140b05] transition-all cursor-pointer shadow-xl relative overflow-hidden flex flex-col justify-between"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#CCFF00]/10 rounded-full blur-3xl group-hover:bg-[#CCFF00]/20 transition-all pointer-events-none" />

            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-3.5">
                {/* Anatomical Silhouette Thumbnail with Orange Highlights */}
                <div className="w-12 h-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center shrink-0 relative overflow-hidden group-hover:border-[#CCFF00]/50 transition-colors shadow-inner">
                  <svg className="w-8 h-12 text-slate-700" viewBox="0 0 100 150" fill="currentColor">
                    <circle cx="50" cy="18" r="10" />
                    <path d="M35 32 C35 30 65 30 65 32 L72 70 L60 72 L55 50 L45 50 L40 72 L28 70 Z" />
                    <path d="M28 70 L20 105 L26 107 L33 75 Z" />
                    <path d="M72 70 L80 105 L74 107 L67 75 Z" />
                    <path d="M35 32 L20 45 L24 49 L38 38 Z" />
                    <path d="M65 32 L80 45 L76 49 L62 38 Z" />

                    {/* Orange Highlights for Muscle Group */}
                    {cat.id === 'Pecho' && <ellipse cx="50" cy="40" rx="10" ry="6" className="text-[#CCFF00] fill-current animate-pulse" />}
                    {cat.id === 'Espalda' && <path d="M40 36 L60 36 L58 55 L42 55 Z" className="text-[#CCFF00] fill-current animate-pulse" />}
                    {cat.id === 'Hombro' && <><circle cx="34" cy="36" r="5" className="text-[#CCFF00] fill-current" /><circle cx="66" cy="36" r="5" className="text-[#CCFF00] fill-current" /></>}
                    {cat.id === 'Pierna' && <><path d="M22 75 L28 102 L34 100 L28 73 Z" className="text-[#CCFF00] fill-current" /><path d="M78 75 L72 102 L66 100 L72 73 Z" className="text-[#CCFF00] fill-current" /></>}
                    {cat.id === 'Glúteos' && <ellipse cx="50" cy="65" rx="12" ry="5" className="text-[#CCFF00] fill-current" />}
                    {cat.id === 'Bíceps' && <><circle cx="21" cy="46" r="4" className="text-[#CCFF00] fill-current" /><circle cx="79" cy="46" r="4" className="text-[#CCFF00] fill-current" /></>}
                    {cat.id === 'Tríceps' && <><circle cx="25" cy="45" r="3" className="text-[#CCFF00] fill-current" /><circle cx="75" cy="45" r="3" className="text-[#CCFF00] fill-current" /></>}
                    {cat.id === 'Antebrazo' && <><path d="M20 52 L16 70 L20 71 L23 53 Z" className="text-[#CCFF00] fill-current" /><path d="M80 52 L84 70 L80 71 L77 53 Z" className="text-[#CCFF00] fill-current" /></>}
                    {cat.id === 'Abdomen' && <rect x="42" y="44" width="16" height="18" rx="2" className="text-[#CCFF00] fill-current animate-pulse" />}
                  </svg>
                </div>

                <div>
                  <h3 className="text-base font-black text-[#CCFF00] group-hover:text-[#CCFF00] transition-colors tracking-tight">
                    {cat.label}
                  </h3>
                  <span className="text-xs font-mono text-emerald-400 font-bold block mt-0.5">
                    {count} ejercicios
                  </span>
                </div>
              </div>

              <div className="w-8 h-8 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-400 group-hover:text-[#CCFF00] group-hover:border-[#CCFF00]/40 transition-all">
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>

            {/* Top Preview Exercises */}
            <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-1.5">
              {topExercises.length > 0 ? (
                topExercises.map((ex, idx) => (
                  <div key={idx} className="text-xs text-slate-300 truncate flex items-center gap-2 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#CCFF00] shrink-0" />
                    <span className="truncate">{ex.name}</span>
                  </div>
                ))
              ) : (
                <span className="text-xs text-slate-500 italic">Ejercicios próximamente</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
