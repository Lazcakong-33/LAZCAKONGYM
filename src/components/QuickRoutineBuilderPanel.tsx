import React, { useMemo, useState } from 'react';
import {
  ArrowLeftRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  Layers,
  Plus,
  Search,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Exercise, Routine } from '../types';
import { EXERCISE_LIBRARY, filterExerciseCatalog } from '../data/exerciseLibrary';
import { normalizar } from '../utils/csvImporter';
import { isSameWeekday } from '../utils/workoutAnalyticsEngine';

const FULL_WEEK_DAYS = [
  'Lunes',
  'Martes',
  'Miércoles',
  'Jueves',
  'Viernes',
  'Sábado',
  'Domingo',
] as const;

const MUSCLE_FILTERS = [
  'Todos',
  'Pectoral',
  'Dorsal',
  'Cuadriceps',
  'Isquiotibiales',
  'Gluteos',
  'Deltoides',
  'Biceps',
  'Triceps',
  'Abdomen',
  'Gemelos',
];

interface SplitTemplate {
  id: string;
  label: string;
  titleSuffix: string;
  tagline: string;
  targetMusclesFilter: string[];
}

const QUICK_SPLIT_TEMPLATES: SplitTemplate[] = [
  {
    id: 'push',
    label: 'Empuje (Pecho · Hombro · Tríceps)',
    titleSuffix: 'Empuje & Hipertrofia',
    tagline: 'Pectoral, Deltoides Anterior/Lateral y Tríceps',
    targetMusclesFilter: ['Pectoral', 'Deltoides', 'Triceps'],
  },
  {
    id: 'pull',
    label: 'Tirón (Espalda · Bíceps)',
    titleSuffix: 'Tirón & Densidad Dorsal',
    tagline: 'Dorsal Ancho, Romboides y Bíceps Braquial',
    targetMusclesFilter: ['Dorsal', 'Biceps'],
  },
  {
    id: 'legs_quads',
    label: 'Pierna (Énfasis Cuádriceps)',
    titleSuffix: 'Pierna & Fuerza Dominante Rodilla',
    tagline: 'Cuádriceps, Aductores y Gemelos',
    targetMusclesFilter: ['Cuadriceps', 'Gemelos'],
  },
  {
    id: 'posterior',
    label: 'Cadena Posterior (Glúteos · Isquios)',
    titleSuffix: 'Glúteos & Isquiotibiales',
    tagline: 'Dominante de Cadera, Glúteo Mayor e Isquiosurales',
    targetMusclesFilter: ['Gluteos', 'Isquiotibiales'],
  },
  {
    id: 'upper',
    label: 'Torso Completo (Upper Body)',
    titleSuffix: 'Torso Completo',
    tagline: 'Pecho, Espalda, Hombros y Brazos',
    targetMusclesFilter: ['Pectoral', 'Dorsal', 'Deltoides'],
  },
  {
    id: 'fullbody',
    label: 'Cuerpo Completo (Full Body)',
    titleSuffix: 'Full Body Metabólico',
    tagline: 'Estímulo Global de Fuerza e Hipertrofia',
    targetMusclesFilter: ['Cuadriceps', 'Pectoral', 'Dorsal', 'Gluteos'],
  },
];

interface QuickRoutineBuilderPanelProps {
  routines: Routine[];
  activeRoutine?: Routine;
  onSelectRoutineId: (id: string) => void;
  onSaveRoutine: (routine: Routine) => void;
  onDeleteRoutine?: (routineId: string) => void;
  isOpenByDefault?: boolean;
}

export const QuickRoutineBuilderPanel: React.FC<QuickRoutineBuilderPanelProps> = ({
  routines,
  activeRoutine,
  onSelectRoutineId,
  onSaveRoutine,
  onDeleteRoutine,
  isOpenByDefault = false,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(isOpenByDefault);
  const [activeSubTab, setActiveSubTab] = useState<'database' | 'split'>('database');

  // Estado del selector de base de datos
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState('Todos');
  const [targetDayName, setTargetDayName] = useState<string>(
    activeRoutine?.dayName || 'Lunes'
  );
  const [quickSets, setQuickSets] = useState<number>(3);
  const [quickReps, setQuickReps] = useState<string>('8 a 12 reps');
  const [quickRestSec, setQuickRestSec] = useState<number>(90);
  const [quickWeight, setQuickWeight] = useState<string>('60');
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);

  // Estado para crear un movimiento propio si no está en la biblioteca
  const [customExName, setCustomExName] = useState('');
  const [customExMuscle, setCustomExMuscle] = useState('Pectoral');
  const [customExEquipment, setCustomExEquipment] = useState('Mancuernas');

  // Estado para mover/intercambiar un día en el Split Semanal
  const [dayToConfigure, setDayToConfigure] = useState<string | null>(null);
  const [moveTargetDay, setMoveTargetDay] = useState<string>('Martes');

  // Sincronizar día destino cuando cambia la rutina seleccionada
  React.useEffect(() => {
    if (activeRoutine?.dayName) {
      setTargetDayName(activeRoutine.dayName);
    }
  }, [activeRoutine?.dayName]);

  const showToast = (msg: string) => {
    setFeedbackToast(msg);
    setTimeout(() => setFeedbackToast(null), 3200);
  };

  // Filtrar ejercicios de EXERCISE_LIBRARY usando filtro centralizado
  const filteredLibrary = useMemo(() => {
    return filterExerciseCatalog(EXERCISE_LIBRARY, {
      muscle: selectedMuscle,
      searchQuery,
    }).slice(0, 60);
  }, [searchQuery, selectedMuscle]);

  // Añadir ejercicio de la base de datos al día seleccionado
  const handleAddExerciseFromDB = (libEx: (typeof EXERCISE_LIBRARY)[0]) => {
    const dayName = targetDayName || activeRoutine?.dayName || 'Lunes';
    const existingRoutineForDay = routines.find((r) =>
      isSameWeekday(r.dayName || r.title, dayName)
    );

    const parsedWeight = Math.max(0, Number(quickWeight) || 0);
    const parsedRest = Math.max(15, Number(quickRestSec) || 90);

    const newExercise: Exercise = {
      id: `ex-${normalizar(dayName)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: libEx.name,
      libraryExerciseId: libEx.id,
      targetMuscles: libEx.muscleGroup || 'Fuerza',
      equipment: libEx.equipment || 'Peso Libre',
      defaultSets: Math.min(Math.max(quickSets, 1), 6),
      repRange: quickReps.trim() || '8 a 12 reps',
      restSeconds: parsedRest,
      restText: `${parsedRest} seg`,
      objective: 'Hipertrofia & Fuerza',
      defaultVideoUrl: libEx.videoUrl || libEx.url || '',
      thumbnailUrl: libEx.thumbnailUrl || undefined,
      secondaryThumbnailUrl: libEx.secondaryThumbnailUrl || undefined,
      techniqueCues: [
        'Control excéntrico de 2-3 segundos',
        'Rango completo de movimiento sin impulso',
      ],
      dia: dayName,
      day: dayName,
      defaultWeight: parsedWeight > 0 ? parsedWeight : undefined,
      prevWeight: parsedWeight > 0 ? Math.round(parsedWeight * 0.925) : undefined,
      defaultReps: parseInt(quickReps.match(/\d+/)?.[0] || '10', 10) || 10,
    };

    if (existingRoutineForDay) {
      const updated: Routine = {
        ...existingRoutineForDay,
        dayName,
        exercises: [...existingRoutineForDay.exercises, newExercise],
      };
      onSaveRoutine(updated);
      onSelectRoutineId(updated.id);
      showToast(`✓ "${libEx.name}" añadido al ${dayName} (${updated.exercises.length} ejercicios)`);
    } else {
      const created: Routine = {
        id: `rutina-${normalizar(dayName)}-${Date.now()}`,
        dayName,
        title: `${dayName}: ${libEx.muscleGroup}`,
        tagline: `Sesión enfocada en ${libEx.muscleGroup}`,
        isCustom: true,
        accentColor: 'amber',
        exercises: [newExercise],
      };
      onSaveRoutine(created);
      onSelectRoutineId(created.id);
      showToast(`✓ Día ${dayName} activado con "${libEx.name}"`);
    }
  };

  // Añadir movimiento personalizado escrito por el atleta
  const handleAddCustomExercise = () => {
    if (!customExName.trim()) return;
    const dayName = targetDayName || activeRoutine?.dayName || 'Lunes';
    const existingRoutineForDay = routines.find((r) =>
      isSameWeekday(r.dayName || r.title, dayName)
    );
    const parsedWeight = Math.max(0, Number(quickWeight) || 0);
    const parsedRest = Math.max(15, Number(quickRestSec) || 90);

    const newExercise: Exercise = {
      id: `ex-custom-${normalizar(dayName)}-${Date.now()}`,
      name: customExName.trim(),
      targetMuscles: customExMuscle,
      equipment: customExEquipment,
      defaultSets: Math.min(Math.max(quickSets, 1), 6),
      repRange: quickReps.trim() || '8 a 12 reps',
      restSeconds: parsedRest,
      restText: `${parsedRest} seg`,
      objective: 'Sobrecarga Progresiva',
      defaultVideoUrl: '',
      techniqueCues: ['Ejecución estricta y control muscular'],
      dia: dayName,
      day: dayName,
      defaultWeight: parsedWeight > 0 ? parsedWeight : undefined,
      prevWeight: parsedWeight > 0 ? Math.round(parsedWeight * 0.925) : undefined,
      defaultReps: parseInt(quickReps.match(/\d+/)?.[0] || '10', 10) || 10,
    };

    if (existingRoutineForDay) {
      const updated: Routine = {
        ...existingRoutineForDay,
        dayName,
        exercises: [...existingRoutineForDay.exercises, newExercise],
      };
      onSaveRoutine(updated);
      onSelectRoutineId(updated.id);
    } else {
      const created: Routine = {
        id: `rutina-${normalizar(dayName)}-${Date.now()}`,
        dayName,
        title: `${dayName}: ${customExMuscle}`,
        tagline: `Entrenamiento personalizado de ${customExMuscle}`,
        isCustom: true,
        accentColor: 'amber',
        exercises: [newExercise],
      };
      onSaveRoutine(created);
      onSelectRoutineId(created.id);
    }

    showToast(`✓ Ejercicio personalizado "${customExName.trim()}" añadido al ${dayName}`);
    setCustomExName('');
  };

  // Generar o activar un día del Split Semanal con plantilla rápida de la base de datos
  const handleApplyQuickSplitToDay = (weekdayName: string, template: SplitTemplate) => {
    const matchingLibExercises = EXERCISE_LIBRARY.filter((item) =>
      template.targetMusclesFilter.some(
        (m) => normalizar(item.muscleGroup) === normalizar(m)
      )
    ).slice(0, 5);

    const builtExercises: Exercise[] = matchingLibExercises.map((libEx, idx) => ({
      id: `ex-${normalizar(weekdayName)}-${Date.now()}-${idx}`,
      name: libEx.name,
      libraryExerciseId: libEx.id,
      targetMuscles: libEx.muscleGroup,
      equipment: libEx.equipment || 'Peso Libre',
      defaultSets: 3,
      repRange: '8 a 12 reps',
      restSeconds: 90,
      restText: '90 seg',
      objective: 'Hipertrofia',
      defaultVideoUrl: libEx.videoUrl || libEx.url || '',
      thumbnailUrl: libEx.thumbnailUrl || undefined,
      techniqueCues: ['Control excéntrico y técnica estricta'],
      dia: weekdayName,
      day: weekdayName,
      defaultWeight: 60,
      prevWeight: 55,
      defaultReps: 10,
    }));

    const existing = routines.find((r) => isSameWeekday(r.dayName || r.title, weekdayName));
    const nextRoutine: Routine = {
      id: existing?.id || `rutina-${normalizar(weekdayName)}-${Date.now()}`,
      dayName: weekdayName,
      title: `${weekdayName}: ${template.titleSuffix}`,
      tagline: template.tagline,
      isCustom: true,
      accentColor: 'amber',
      exercises: builtExercises,
    };

    onSaveRoutine(nextRoutine);
    onSelectRoutineId(nextRoutine.id);
    setDayToConfigure(null);
    showToast(`✓ ${weekdayName} configurado como "${template.titleSuffix}" (${builtExercises.length} ejercicios)`);
  };

  // Mover una rutina de un día a otro dentro del Split Semanal
  const handleMoveRoutineToDay = (sourceRoutine: Routine, destinationDay: string) => {
    if (isSameWeekday(sourceRoutine.dayName, destinationDay)) return;

    const cleanTitle = sourceRoutine.title.replace(
      /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s*[:\-·]?\s*/i,
      ''
    );

    const movedRoutine: Routine = {
      ...sourceRoutine,
      dayName: destinationDay,
      title: cleanTitle ? `${destinationDay}: ${cleanTitle}` : `Rutina ${destinationDay}`,
      exercises: sourceRoutine.exercises.map((ex) => ({
        ...ex,
        dia: destinationDay,
        day: destinationDay,
      })),
    };

    onSaveRoutine(movedRoutine);
    onSelectRoutineId(movedRoutine.id);
    setDayToConfigure(null);
    showToast(`✓ Rutina movida de ${sourceRoutine.dayName} a ${destinationDay}`);
  };

  const activeDaysCount = FULL_WEEK_DAYS.filter((d) =>
    routines.some(
      (r) => isSameWeekday(r.dayName || r.title, d) && r.exercises && r.exercises.length > 0
    )
  ).length;

  return (
    <div className="rounded-2xl bg-slate-900/50 border border-slate-800/90 shadow-xl overflow-hidden transition-all font-sans">
      {/* Cabecera colapsable del Constructor Rápido */}
      <div className="p-4 sm:px-5 bg-gradient-to-r from-[#0d1424] via-slate-900/90 to-[#0d1424] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/35 flex items-center justify-center text-emerald-400 shrink-0">
            <Sliders className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm sm:text-base font-extrabold text-white tracking-tight">
                Constructor Rápido de Rutinas &amp; Split Semanal
              </h3>
              <span className="text-[11px] font-semibold text-emerald-400 tabular-nums">
                · {activeDaysCount} días activos / {7 - activeDaysCount} descanso
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Añade ejercicios de la base de datos ({EXERCISE_LIBRARY.length} movimientos), reorganiza el orden o modifica tu split semanal sin usar Excel.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
          <button
            type="button"
            onClick={() => {
              setActiveSubTab('database');
              setIsExpanded(true);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
              isExpanded && activeSubTab === 'database'
                ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/20'
                : 'bg-slate-950/80 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>+ Ejercicio BD</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveSubTab('split');
              setIsExpanded(true);
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 ${
              isExpanded && activeSubTab === 'split'
                ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/20'
                : 'bg-slate-950/80 text-slate-300 hover:text-white border border-slate-800'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" />
            <span>Editar Split</span>
          </button>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="p-2 rounded-xl bg-slate-950/80 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            title={isExpanded ? 'Contraer constructor' : 'Desplegar constructor'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {feedbackToast && (
        <div className="mx-4 mt-3 px-4 py-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-xs font-semibold flex items-center justify-between">
          <span>{feedbackToast}</span>
          <button
            type="button"
            onClick={() => setFeedbackToast(null)}
            className="text-emerald-300 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isExpanded && (
        <div className="p-4 sm:p-5 border-t border-slate-800/80 space-y-5 bg-slate-950/60">
          {activeSubTab === 'database' ? (
            <div className="space-y-4">
              {/* Fila 1: Selección de Día Destino + Prescripción Rápida (Series, Reps, Descanso, Carga) */}
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                <div className="col-span-2 sm:col-span-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Día Destino
                  </label>
                  <select
                    value={targetDayName}
                    onChange={(e) => setTargetDayName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs font-bold text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-500"
                  >
                    {FULL_WEEK_DAYS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Series
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={quickSets}
                    onChange={(e) => setQuickSets(Math.min(6, Math.max(1, Number(e.target.value) || 3)))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-center text-xs font-bold text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Rango Reps
                  </label>
                  <input
                    type="text"
                    value={quickReps}
                    onChange={(e) => setQuickReps(e.target.value)}
                    placeholder="8 a 12 reps"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold text-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Descanso (seg)
                  </label>
                  <input
                    type="number"
                    min={15}
                    max={300}
                    step={15}
                    value={quickRestSec}
                    onChange={(e) => setQuickRestSec(Number(e.target.value) || 90)}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-center text-xs font-semibold text-amber-400 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Carga (kg)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={2.5}
                    value={quickWeight}
                    onChange={(e) => setQuickWeight(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-center text-xs font-bold text-cyan-400 tabular-nums focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {/* Fila 2: Buscador y Filtro por Grupo Muscular */}
              <div className="space-y-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Buscar en la base de datos (ej. Sentadilla Hack, Press Banca, Remo, Polea)..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {MUSCLE_FILTERS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSelectedMuscle(m)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                        selectedMuscle === m
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lista de Resultados de la Base de Datos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                {filteredLibrary.map((libEx) => (
                  <div
                    key={libEx.id}
                    className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-3 transition-all"
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-white block truncate">
                        {libEx.name}
                      </span>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-0.5">
                        <span className="text-blue-400 font-medium">{libEx.muscleGroup}</span>
                        <span aria-hidden="true">·</span>
                        <span>{libEx.equipment || 'Peso Libre'}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleAddExerciseFromDB(libEx)}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500 text-emerald-300 hover:text-slate-950 border border-emerald-500/40 text-xs font-bold inline-flex items-center gap-1 transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Añadir</span>
                    </button>
                  </div>
                ))}
              </div>

              {/* Creador Rápido de Ejercicio Propio */}
              <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-end gap-2.5">
                <div className="flex-1 min-w-[180px]">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    ¿No está en la lista? Crea un movimiento propio para el {targetDayName}:
                  </label>
                  <input
                    type="text"
                    value={customExName}
                    onChange={(e) => setCustomExName(e.target.value)}
                    placeholder="Nombre del ejercicio personalizado..."
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-amber-500"
                  />
                </div>
                <div className="w-32">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block mb-1">
                    Músculo
                  </label>
                  <select
                    value={customExMuscle}
                    onChange={(e) => setCustomExMuscle(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    {MUSCLE_FILTERS.filter((m) => m !== 'Todos').map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleAddCustomExercise}
                  disabled={!customExName.trim()}
                  className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-bold transition-all cursor-pointer"
                >
                  + Crear y Añadir
                </button>
              </div>
            </div>
          ) : (
            /* SUB-PESTAÑA 2: MODIFICADOR INTERACTIVO DE SPLIT SEMANAL (LUNES A DOMINGO) */
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="text-xs text-slate-300">
                  Toca cualquier día de la semana para <strong>activar un día de descanso</strong> con una plantilla científica, <strong>mover una rutina de día</strong> o <strong>asignar descanso</strong>:
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {FULL_WEEK_DAYS.map((weekdayName) => {
                  const routineForDay = routines.find(
                    (r) =>
                      isSameWeekday(r.dayName || r.title, weekdayName) &&
                      Array.isArray(r.exercises) &&
                      r.exercises.length > 0
                  );
                  const isConfiguring = dayToConfigure === weekdayName;

                  return (
                    <div
                      key={weekdayName}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between gap-3 ${
                        routineForDay
                          ? 'bg-slate-900/80 border-slate-700/80'
                          : 'bg-slate-900/30 border-slate-800/40'
                      }`}
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-extrabold uppercase tracking-wider text-white">
                            {weekdayName}
                          </span>
                          {routineForDay ? (
                            <span className="px-2 py-0.5 rounded-md bg-emerald-950/50 border border-emerald-800/50 text-emerald-400 text-[10px] font-bold tabular-nums">
                              {routineForDay.exercises.length} ej.
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-md bg-slate-950/80 border border-slate-800 text-slate-500 text-[10px] font-semibold uppercase tracking-wider">
                              DESCANSO
                            </span>
                          )}
                        </div>

                        {routineForDay ? (
                          <p className="text-xs font-semibold text-amber-400 truncate">
                            {routineForDay.title}
                          </p>
                        ) : (
                          <p className="text-[11px] text-slate-500">
                            Día libre de recuperación
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-800/60">
                        {routineForDay ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onSelectRoutineId(routineForDay.id)}
                              className="flex-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              Ver Día
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDayToConfigure(isConfiguring ? null : weekdayName);
                                setMoveTargetDay(
                                  FULL_WEEK_DAYS.find((d) => d !== weekdayName) || 'Martes'
                                );
                              }}
                              className="px-2.5 py-1 rounded-lg bg-blue-950/60 hover:bg-blue-900/60 border border-blue-800/40 text-blue-400 text-[11px] font-semibold transition-colors cursor-pointer"
                              title="Cambiar día o plantilla"
                            >
                              Mover / Split
                            </button>
                            {onDeleteRoutine && (
                              <button
                                type="button"
                                onClick={() => {
                                  onDeleteRoutine(routineForDay.id);
                                  showToast(`✓ ${weekdayName} marcado como día de DESCANSO`);
                                }}
                                className="p-1 rounded-lg bg-rose-950/40 hover:bg-rose-900/50 border border-rose-800/40 text-rose-400 transition-colors cursor-pointer"
                                title={`Convertir ${weekdayName} en día de DESCANSO`}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setDayToConfigure(isConfiguring ? null : weekdayName)
                            }
                            className="w-full py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/70 text-emerald-400 text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Activar {weekdayName}</span>
                          </button>
                        )}
                      </div>

                      {/* Panel desplegable para configurar o mover este día específico */}
                      {isConfiguring && (
                        <div className="mt-2 pt-2.5 border-t border-slate-800 space-y-2.5 text-xs">
                          {routineForDay && (
                            <div className="space-y-1.5">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                                Mover esta rutina a otro día:
                              </span>
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={moveTargetDay}
                                  onChange={(e) => setMoveTargetDay(e.target.value)}
                                  className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white"
                                >
                                  {FULL_WEEK_DAYS.filter((d) => d !== weekdayName).map((d) => (
                                    <option key={d} value={d}>
                                      {d}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleMoveRoutineToDay(routineForDay, moveTargetDay)
                                  }
                                  className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold cursor-pointer"
                                >
                                  Mover
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 block">
                              Asignar bloque rápido a {weekdayName}:
                            </span>
                            <div className="space-y-1">
                              {QUICK_SPLIT_TEMPLATES.map((tpl) => (
                                <button
                                  key={tpl.id}
                                  type="button"
                                  onClick={() =>
                                    handleApplyQuickSplitToDay(weekdayName, tpl)
                                  }
                                  className="w-full text-left px-2.5 py-1.5 rounded-lg bg-slate-950 hover:bg-emerald-950/40 border border-slate-800 hover:border-emerald-500/40 text-[11px] text-slate-200 hover:text-emerald-300 font-medium transition-colors cursor-pointer"
                                >
                                  {tpl.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
