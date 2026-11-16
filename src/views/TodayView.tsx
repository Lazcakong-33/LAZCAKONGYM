import React, { useMemo, useState } from 'react';
import {
  Play,
  Dumbbell,
  Layers,
  ChevronRight,
  CheckCircle2,
} from 'lucide-react';
import { Skeleton } from '../components/Skeleton';
import { Routine, CompletedWorkout, PersonalRecord, ActiveWorkoutSession, Profile } from '../types';
import { TabType } from '../components/Navigation';
import { evaluateWeeklyDaysCompletion, formatDateKeyYYYYMMDD } from '../utils/exportReport';
import { isSameWeekday } from '../utils/workoutAnalyticsEngine';
import { purgeAndSanitizeWorkoutHistory } from '../utils/historySanitizer';
import {
  computeRealTimeRecovery,
  computeOverallAthleteSummary,
} from '../utils/muscleRecoveryEngine';

interface TodayViewProps {
  routines: Routine[];
  history: CompletedWorkout[];
  prs: Record<string, PersonalRecord>;
  activeSession: ActiveWorkoutSession | null;
  activeProfile: Profile;
  onStartWorkout: (routine: Routine) => void;
  onNavigateActive: () => void;
  onSelectDay: (routine: Routine) => void;
  onOpenCreateRoutine: () => void;
  onOpenPlateCalculator: (weight?: number) => void;
  onNavigateTab: (tab: TabType) => void;
  onOpenInstallApk: () => void;
  onOpenAIRoutineModal: () => void;
  onOpenProfileSwitcher?: () => void;
  onLogout?: () => void;
  loading?: boolean;
}

const ORDERED_WEEKDAYS = [
  { name: 'Lunes', short: 'LUN', jsDay: 1 },
  { name: 'Martes', short: 'MAR', jsDay: 2 },
  { name: 'Miércoles', short: 'MIE', jsDay: 3 },
  { name: 'Jueves', short: 'JUE', jsDay: 4 },
  { name: 'Viernes', short: 'VIE', jsDay: 5 },
  { name: 'Sábado', short: 'SAB', jsDay: 6 },
  { name: 'Domingo', short: 'DOM', jsDay: 0 },
] as const;

function getMondayOfWeek(referenceDate: Date, weekOffset: number): Date {
  const d = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const day = d.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday + weekOffset * 7);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Descompone el nombre real de la rutina en las 3 líneas de alto impacto
 * del diseño aprobado:
 * 1) Día (ej. "MIÉRCOLES:")
 * 2) Bloque principal en verde lima (ej. "TRACCIÓN A")
 * 3) Subtítulo muscular entre paréntesis (ej. "(ESPALDA ALTA, CUELLO Y BÍCEPS)")
 */
function formatRoutineHeroLines(routine: Routine, fallbackDayName: string): {
  dayHeader: string;
  mainTitle: string;
  subTitle: string;
} {
  const rawTitle = (routine.title || '').trim();
  let dayPart = (routine.dayName || fallbackDayName || 'HOY').trim();
  let remainder = rawTitle;

  if (rawTitle.includes(':')) {
    const colonIdx = rawTitle.indexOf(':');
    const candidateDay = rawTitle.slice(0, colonIdx).trim();
    const afterColon = rawTitle.slice(colonIdx + 1).trim();
    if (candidateDay.length > 0 && afterColon.length > 0) {
      dayPart = candidateDay;
      remainder = afterColon;
    }
  }

  let mainPart = remainder;
  let parenPart = '';

  const openParenIdx = remainder.indexOf('(');
  const closeParenIdx = remainder.lastIndexOf(')');
  if (openParenIdx !== -1 && closeParenIdx > openParenIdx) {
    mainPart = remainder.slice(0, openParenIdx).trim();
    parenPart = remainder.slice(openParenIdx, closeParenIdx + 1).trim();
  } else if (routine.tagline) {
    parenPart = `(${routine.tagline.trim()})`;
  }

  if (!mainPart) {
    mainPart = rawTitle || 'RUTINA DEL DÍA';
  }

  return {
    dayHeader: `${dayPart.replace(/:$/, '').toUpperCase()}:`,
    mainTitle: mainPart.toUpperCase(),
    subTitle: parenPart.toUpperCase(),
  };
}

const CalendarCheckIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M16 2v4M8 2v4M3 9h18" />
    <path d="m9.5 14.5 2 2 3.5-3.5" />
  </svg>
);

const BicepFlexIcon: React.FC<{ className?: string }> = ({ className = 'w-9 h-9' }) => (
  <svg
    viewBox="0 0 64 64"
    fill="none"
    stroke="#CCFF00"
    strokeWidth="3.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {/* Silueta anatómica de bíceps flexionado en verde lima */}
    <path d="M22 36c-3-6 0-15 6-20 3-2.5 7-2 9 1 1.5 2.2 0 5.5-2.5 6.5-2.2 1-3.5 0-4.5-1.5" />
    <path d="M27 23c-2.5 3.5-3 8.5-1 12.5 2.5-3.5 7.5-5.5 13-4.5 5.5 1 9.5 5 9.5 10.5 0 6.5-6 10.5-14.5 10.5-8 0-15.5-2-19.5-6.5-3-3.5-3.5-8.5-1-13.5" />
    <path d="M35 37c2.5 0.5 4.8 2 6 4" />
  </svg>
);

const SegmentedRecoveryRing: React.FC<{ percentage: number; hasData: boolean }> = ({
  percentage,
  hasData,
}) => {
  const segments = 8;
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const gapLength = 5.5;
  const segmentLength = circumference / segments - gapLength;
  const activeSegments = hasData
    ? Math.max(1, Math.round((Math.min(100, Math.max(0, percentage)) / 100) * segments))
    : 3;

  return (
    <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0 flex items-center justify-center">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
        {Array.from({ length: segments }).map((_, idx) => {
          const isLit = idx < activeSegments;
          const offset = -idx * (segmentLength + gapLength);
          return (
            <circle
              key={idx}
              cx="48"
              cy="48"
              r={radius}
              fill="none"
              stroke={isLit ? '#CCFF00' : '#303030'}
              strokeWidth="7.5"
              strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
              strokeDashoffset={offset}
              strokeLinecap="butt"
              className="transition-all duration-500"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <BicepFlexIcon className="w-10 h-10 sm:w-11 sm:h-11 drop-shadow-[0_0_8px_rgba(204,255,0,0.35)]" />
      </div>
    </div>
  );
};

export const TodayView: React.FC<TodayViewProps> = ({
  routines,
  history,
  activeSession,
  activeProfile,
  onStartWorkout,
  onNavigateActive,
  onSelectDay,
  onNavigateTab,
  onOpenProfileSwitcher,
  loading = false,
}) => {
  const now = useMemo(() => new Date(), []);
  const todayDateKey = useMemo(() => formatDateKeyYYYYMMDD(now) || '', [now]);
  const todayDayName =
    ORDERED_WEEKDAYS.find((wd) => wd.jsDay === now.getDay())?.name || 'Miércoles';

  const [selectedDayName, setSelectedDayName] = useState<string>(todayDayName);
  const [showDaySelector, setShowDaySelector] = useState<boolean>(false);

  const sanitizedHistory = useMemo(
    () => purgeAndSanitizeWorkoutHistory(Array.isArray(history) ? history : [], activeProfile?.weightKg || 95).cleanedHistory,
    [history, activeProfile?.weightKg]
  );

  // Construir los 7 días de la semana actual
  const timelineDays = useMemo(() => {
    const monday = getMondayOfWeek(now, 0);
    const workoutsByDateKey = new Map<string, CompletedWorkout[]>();
    sanitizedHistory.forEach((workout) => {
      const key = formatDateKeyYYYYMMDD(workout.date);
      if (!key) return;
      const list = workoutsByDateKey.get(key) || [];
      list.push(workout);
      workoutsByDateKey.set(key, list);
    });

    return ORDERED_WEEKDAYS.map((wd, idx) => {
      const cellDate = new Date(monday);
      cellDate.setDate(monday.getDate() + idx);
      const dateKey = formatDateKeyYYYYMMDD(cellDate) || '';
      const dayNumber = String(cellDate.getDate()).padStart(2, '0');

      const assignedRoutine =
        routines.find(
          (r) =>
            isSameWeekday(r.dayName || r.title, wd.name) &&
            Array.isArray(r.exercises) &&
            r.exercises.length > 0
        ) || null;

      const completedInDate = workoutsByDateKey.get(dateKey) || [];
      const isCompleted = completedInDate.length > 0;
      const isToday = dateKey === todayDateKey;

      return {
        weekdayName: wd.name,
        shortLabel: wd.short,
        dayNumber,
        dateKey,
        assignedRoutine,
        isCompleted,
        isToday,
      };
    });
  }, [routines, sanitizedHistory, todayDateKey, now]);

  const activeRoutine = useMemo(() => {
    const found = timelineDays.find((d) => d.weekdayName === selectedDayName);
    if (found?.assignedRoutine) return found.assignedRoutine;
    return routines.find((r) => isSameWeekday(r.dayName || r.title, todayDayName)) || routines[0];
  }, [timelineDays, selectedDayName, routines, todayDayName]);

  const currentWeekMondayMs = useMemo(() => getMondayOfWeek(now, 0).getTime(), [now]);
  const currentWeekWorkouts = useMemo(
    () =>
      sanitizedHistory.filter((h) => {
        const t = new Date(h.date).getTime();
        return !Number.isNaN(t) && t >= currentWeekMondayMs;
      }),
    [sanitizedHistory, currentWeekMondayMs]
  );
  const weeklyCompletion = useMemo(
    () => evaluateWeeklyDaysCompletion(sanitizedHistory, routines, now),
    [sanitizedHistory, routines, now]
  );
  const completedCountThisWeek = weeklyCompletion.days.filter((d) => d.isCompleted).length;
  const targetDays = Math.max(1, activeProfile.weeklyTargetDays || 5);
  const weeklyPct = Math.min(100, Math.round((completedCountThisWeek / targetDays) * 100));

  // Volumen total registrado de la semana calendario actual (alineado 1:1 con ProgresoView)
  const weeklyVolumeKg = useMemo(() => {
    return currentWeekWorkouts.reduce((sum, w) => sum + (w.totalVolumeKg || 0), 0);
  }, [currentWeekWorkouts]);

  const displayedVolumeKg = weeklyVolumeKg;
  const hasHistory = sanitizedHistory.length > 0;

  // Motor de recuperación muscular real
  const recoveryReport = useMemo(() => {
    return computeRealTimeRecovery(sanitizedHistory, now.getTime(), routines, 'ALL');
  }, [sanitizedHistory, routines, now]);

  const athleteSummary = useMemo(() => {
    return computeOverallAthleteSummary(recoveryReport, sanitizedHistory, now.getTime());
  }, [recoveryReport, sanitizedHistory, now]);

  const exerciseCount = activeRoutine?.exercises?.length || 0;
  const totalSetsCount = useMemo(() => {
    if (!activeRoutine?.exercises) return 0;
    return activeRoutine.exercises.reduce((acc, ex) => acc + (ex.defaultSets || 3), 0);
  }, [activeRoutine]);

  const heroTitleLines = useMemo(() => {
    if (!activeRoutine) {
      return {
        dayHeader: `${selectedDayName.toUpperCase()}:`,
        mainTitle: 'SIN RUTINA',
        subTitle: '(SELECCIONA O CREA UNA RUTINA)',
      };
    }
    return formatRoutineHeroLines(activeRoutine, selectedDayName);
  }, [activeRoutine, selectedDayName]);

  if (loading) {
    return (
      <div className="space-y-4 pb-16">
        <Skeleton className="h-16 w-full rounded-3xl" />
        <Skeleton className="h-64 w-full rounded-3xl" />
        <Skeleton className="h-32 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-3.5 pb-8 font-['Plus_Jakarta_Sans',sans-serif] text-[#F5F5F5] w-full max-w-md mx-auto md:max-w-none">
      {/* 1. ENCABEZADO 1:1 LAZCAKONG GYM */}
      <header className="flex items-center justify-between gap-3 pt-1 pb-1">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-[#090909] border-2 border-[#CCFF00] flex items-center justify-center overflow-hidden shrink-0 shadow-[0_0_16px_rgba(204,255,0,0.28)]">
            <img
              src="/assets/gorilla_head.png"
              alt="LAZCAKONG GYM"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover scale-110"
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-[22px] xs:text-2xl sm:text-[28px] font-black italic uppercase tracking-tight text-[#F5F5F5] flex items-center gap-1.5 leading-none truncate">
              <span>LAZCAKONG</span>
              <span className="text-[#CCFF00]">GYM</span>
            </h1>
            <span className="text-[10px] sm:text-[11px] font-extrabold italic tracking-[0.28em] text-[#F5F5F5]/90 uppercase block mt-1">
              ELITE PERFORMANCE
            </span>
          </div>
        </div>

        {onOpenProfileSwitcher && (
          <button
            type="button"
            onClick={onOpenProfileSwitcher}
            className="w-11 h-11 rounded-full bg-[#090909] border-2 border-[#CCFF00] flex items-center justify-center text-[#F5F5F5] shadow-[0_0_14px_rgba(204,255,0,0.22)] transition-transform active:scale-95 cursor-pointer shrink-0"
            title={`Perfil: ${activeProfile.name} (Ajustes y Administración)`}
            aria-label="Abrir perfil y configuración"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <circle cx="12" cy="8" r="4" />
              <path d="M5 20c1.5-3.5 4.2-5 7-5s5.5 1.5 7 5" />
            </svg>
          </button>
        )}
      </header>

      {/* SESIÓN ACTIVA EN CURSO (Si existe entrenamiento iniciado) */}
      {activeSession && (
        <section className="p-3.5 rounded-2xl bg-[#171717] border border-[#CCFF00] flex items-center justify-between gap-3 shadow-[0_0_18px_rgba(204,255,0,0.16)]">
          <div className="min-w-0">
            <div className="text-[10px] font-mono font-bold text-[#CCFF00] uppercase tracking-widest">
              ENTRENAMIENTO EN CURSO
            </div>
            <h2 className="text-sm font-black text-[#F5F5F5] truncate mt-0.5">
              {activeSession.routineTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onNavigateActive}
            style={{ backgroundColor: '#CCFF00', color: '#090909' }}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-[#CCFF00] text-[#090909] font-black text-xs uppercase tracking-wider shrink-0 cursor-pointer active:scale-95"
          >
            Continuar
          </button>
        </section>
      )}

      {/* 2. TARJETA PRINCIPAL 1:1: ENTRENAMIENTO DEL DÍA */}
      <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#12160a] via-[#121212] to-[#090909] border border-[#CCFF00]/65 p-4 sm:p-5 shadow-[0_0_26px_rgba(204,255,0,0.12)]">
        {/* Rayos diagonales sutiles e iluminación verde lima de fondo */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(125deg, transparent 30%, rgba(204,255,0,0.12) 48%, transparent 56%, rgba(204,255,0,0.08) 70%, transparent 80%)',
          }}
        />
        <div className="pointer-events-none absolute -right-10 top-4 w-48 h-48 rounded-full bg-[#CCFF00]/15 blur-3xl" />

        {/* Selector rápido de día desplegable al tocar la etiqueta ENTRENAMIENTO DEL DÍA */}
        {showDaySelector && (
          <div className="relative z-20 flex overflow-x-auto gap-1.5 pb-3 mb-2 border-b border-[#303030] hide-scrollbar">
            {timelineDays.map((day) => {
              const isSelected = selectedDayName === day.weekdayName;
              return (
                <button
                  key={day.dateKey}
                  type="button"
                  onClick={() => {
                    setSelectedDayName(day.weekdayName);
                    setShowDaySelector(false);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold whitespace-nowrap flex items-center gap-1 transition-all cursor-pointer shrink-0 ${
                    isSelected
                      ? 'bg-[#CCFF00] text-[#090909] font-black'
                      : 'bg-[#171717] border border-[#303030] text-[#F5F5F5]/80'
                  }`}
                >
                  <span>
                    {day.shortLabel} {day.dayNumber}
                  </span>
                  {day.isCompleted && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* Composición horizontal: Izquierda (Etiqueta + Título en 3 líneas + Ejercicios/Series) | Derecha (Gorila Musculoso) */}
        <div className="relative z-10 flex items-center justify-between gap-2">
          {/* Columna Izquierda */}
          <div className="flex-1 min-w-0 pr-1">
            {/* Píldora ENTRENAMIENTO DEL DÍA */}
            <button
              type="button"
              onClick={() => setShowDaySelector((prev) => !prev)}
              title="Cambiar día de entrenamiento"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#090909]/90 border border-[#CCFF00]/80 shadow-[0_0_12px_rgba(204,255,0,0.16)] mb-3 cursor-pointer active:scale-95 transition-transform"
            >
              <CalendarCheckIcon className="w-4 h-4 text-[#CCFF00] shrink-0" />
              <span className="text-[10px] xs:text-[11px] font-extrabold tracking-wider text-[#F5F5F5] uppercase whitespace-nowrap">
                ENTRENAMIENTO DEL DÍA
              </span>
            </button>

            {/* Nombre real de la rutina con jerarquía deportiva 1:1 */}
            <div
              onClick={() => activeRoutine && onSelectDay(activeRoutine)}
              className="cursor-pointer group"
              title="Ver detalle de ejercicios de la rutina"
            >
              <div className="text-xl xs:text-2xl sm:text-[28px] font-black italic uppercase text-[#F5F5F5] leading-[1.05] tracking-tight">
                {heroTitleLines.dayHeader}
              </div>
              <div className="text-xl xs:text-2xl sm:text-[28px] font-black italic uppercase text-[#CCFF00] leading-[1.05] tracking-tight mt-0.5 drop-shadow-[0_0_10px_rgba(204,255,0,0.25)] break-words">
                {heroTitleLines.mainTitle}
              </div>
              {heroTitleLines.subTitle && (
                <div className="text-xs xs:text-sm sm:text-[15px] font-extrabold italic uppercase text-[#F5F5F5] leading-snug tracking-tight mt-1 break-words">
                  {heroTitleLines.subTitle}
                </div>
              )}
            </div>

            {/* Metadatos: X ejercicios | Y series */}
            <div className="flex items-center gap-2.5 text-xs sm:text-sm text-[#F5F5F5]/90 font-medium mt-3.5 tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <Dumbbell className="w-4 h-4 text-[#CCFF00] shrink-0" />
                <span>
                  <strong className="font-bold">{exerciseCount}</strong> ejercicios
                </span>
              </span>
              <span className="text-[#F5F5F5]/40 font-light">|</span>
              <span className="inline-flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#CCFF00] shrink-0" />
                <span>
                  <strong className="font-bold">{totalSetsCount}</strong> series
                </span>
              </span>
            </div>
          </div>

          {/* Columna Derecha: Gorila Musculoso LAZCAKONG GYM */}
          <div
            onClick={() => activeRoutine && onSelectDay(activeRoutine)}
            className="w-[132px] xs:w-[148px] sm:w-[172px] shrink-0 flex items-center justify-center relative cursor-pointer"
            title="Ver ejercicios de la rutina"
          >
            <div className="pointer-events-none absolute inset-2 rounded-full bg-[#CCFF00]/20 blur-xl" />
            <img
              src="/assets/gorilla_full_logo.png"
              alt="LAZCAKONG GYM"
              referrerPolicy="no-referrer"
              className="relative z-10 w-full h-auto object-contain drop-shadow-[0_0_14px_rgba(204,255,0,0.45)] select-none"
            />
          </div>
        </div>

        {/* Botón Principal Verde Lima #CCFF00 con Texto Negro */}
        <div className="relative z-10 mt-4">
          <button
            type="button"
            onClick={() =>
              activeRoutine ? onStartWorkout(activeRoutine) : onNavigateTab('rutinas')
            }
            style={{ backgroundColor: '#CCFF00', color: '#090909' }}
            className="w-full min-h-[52px] py-3.5 px-5 rounded-2xl bg-[#CCFF00] hover:bg-[#d4ff1a] text-[#090909] font-black italic text-sm xs:text-base sm:text-lg uppercase tracking-wide flex items-center justify-center gap-3 shadow-[0_4px_22px_rgba(204,255,0,0.35)] active:scale-[0.99] transition-all cursor-pointer"
          >
            <Play className="w-5 h-5 fill-[#090909] text-[#090909] shrink-0" />
            <span>COMENZAR ENTRENAMIENTO</span>
          </button>
        </div>
      </section>

      {/* 3. ESTADÍSTICAS: PROGRESO SEMANAL & VOLUMEN TOTAL (2 tarjetas en una fila) */}
      <section className="grid grid-cols-2 gap-3">
        {/* TARJETA IZQUIERDA: PROGRESO SEMANAL */}
        <div className="p-3.5 sm:p-4 rounded-[22px] bg-[#171717] border border-[#303030] flex flex-col justify-between gap-2.5 shadow-lg">
          <div className="flex items-center gap-1.5 text-[10px] xs:text-[11px] font-extrabold uppercase tracking-tight text-[#F5F5F5]">
            <CalendarCheckIcon className="w-4 h-4 text-[#CCFF00] shrink-0" />
            <span className="truncate">PROGRESO SEMANAL</span>
          </div>

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <div className="min-w-0">
              <span className="text-[28px] xs:text-3xl sm:text-4xl font-black text-[#F5F5F5] leading-none tracking-tight tabular-nums block">
                {completedCountThisWeek} / {targetDays}
              </span>
              <span className="text-[11px] text-[#F5F5F5]/75 block font-medium mt-2 truncate">
                Sesiones realizadas
              </span>
            </div>

            {/* Anillo circular de porcentaje */}
            <div className="relative w-14 h-14 sm:w-16 sm:h-16 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 56 56">
                <circle cx="28" cy="28" r="22" stroke="#303030" strokeWidth="5.5" fill="none" />
                <circle
                  cx="28"
                  cy="28"
                  r="22"
                  stroke="#CCFF00"
                  strokeWidth="5.5"
                  strokeDasharray={2 * Math.PI * 22}
                  strokeDashoffset={2 * Math.PI * 22 * (1 - weeklyPct / 100)}
                  strokeLinecap="round"
                  fill="none"
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center font-black text-xs text-[#F5F5F5] tabular-nums">
                {weeklyPct}%
              </div>
            </div>
          </div>
        </div>

        {/* TARJETA DERECHA: VOLUMEN TOTAL */}
        <div className="p-3.5 sm:p-4 rounded-[22px] bg-[#171717] border border-[#303030] flex flex-col justify-between gap-2.5 shadow-lg">
          <div className="flex items-center gap-1.5 text-[10px] xs:text-[11px] font-extrabold uppercase tracking-tight text-[#F5F5F5]">
            <Dumbbell className="w-4 h-4 text-[#CCFF00] shrink-0" />
            <span className="truncate">VOLUMEN TOTAL</span>
          </div>

          <div className="flex items-end justify-between gap-2 pt-0.5">
            <div className="min-w-0">
              <span className="text-2xl xs:text-[26px] sm:text-3xl font-black text-[#F5F5F5] leading-none tracking-tight tabular-nums block truncate">
                {hasHistory && displayedVolumeKg > 0
                  ? Math.round(displayedVolumeKg).toLocaleString('es-CL')
                  : '0'}
              </span>
              <span className="text-base xs:text-lg font-black text-[#F5F5F5] leading-tight block mt-0.5">
                kg
              </span>
              <span className="text-[11px] text-[#F5F5F5]/75 block font-medium mt-1 truncate">
                Carga registrada
              </span>
            </div>

            {/* Gráfico de 5 barras verdes ascendentes */}
            <div className="flex items-end gap-1 h-11 shrink-0 pb-0.5" aria-hidden="true">
              <div className="w-1.5 sm:w-2 bg-[#CCFF00]/40 rounded-[2px] h-2.5" />
              <div className="w-1.5 sm:w-2 bg-[#CCFF00]/55 rounded-[2px] h-4" />
              <div className="w-1.5 sm:w-2 bg-[#CCFF00]/75 rounded-[2px] h-6" />
              <div className="w-1.5 sm:w-2 bg-[#CCFF00]/90 rounded-[2px] h-8" />
              <div className="w-1.5 sm:w-2 bg-[#CCFF00] rounded-[2px] h-11 shadow-[0_0_8px_rgba(204,255,0,0.3)]" />
            </div>
          </div>
        </div>
      </section>

      {/* 4. TARJETA RECUPERACIÓN MUSCULAR 1:1 */}
      <section className="p-4 sm:p-5 rounded-[22px] bg-[#171717] border border-[#303030] shadow-lg flex items-center gap-3.5 sm:gap-4">
        {/* Indicador circular segmentado con icono muscular central */}
        <SegmentedRecoveryRing
          percentage={athleteSummary.overallRecoveryPct}
          hasData={hasHistory}
        />

        {/* Divisor vertical */}
        <div className="w-px self-stretch bg-[#303030] my-1 shrink-0" />

        {/* Contenido derecho */}
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-base sm:text-lg font-black italic uppercase tracking-tight text-[#F5F5F5] leading-tight">
              RECUPERACIÓN MUSCULAR
            </h3>
            <button
              type="button"
              onClick={() => onNavigateTab('mapa-muscular')}
              title="Ver análisis de recuperación muscular"
              className="w-5 h-5 rounded-full border border-[#CCFF00] text-[#CCFF00] flex items-center justify-center text-[11px] font-black shrink-0 cursor-pointer"
            >
              i
            </button>
          </div>

          <p className="text-xs text-[#F5F5F5]/80 leading-snug">
            Estado estimado de tus grupos musculares según tu último entrenamiento.
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span
              style={{ backgroundColor: '#CCFF00', color: '#090909' }}
              className="px-3 py-1 rounded-full bg-[#CCFF00] text-[#090909] font-extrabold text-[10px] xs:text-[11px] tracking-tight uppercase whitespace-nowrap shadow-[0_0_12px_rgba(204,255,0,0.22)]"
            >
              {hasHistory ? `RECUPERACIÓN: ${athleteSummary.overallRecoveryPct}%` : 'SIN DATOS'}
            </span>

            <button
              type="button"
              onClick={() => onNavigateTab('mapa-muscular')}
              className="text-xs sm:text-sm font-bold text-[#CCFF00] hover:underline inline-flex items-center gap-0.5 whitespace-nowrap cursor-pointer active:scale-95"
            >
              <span>Ver mapa</span>
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </section>

      {/* 5. TARJETA TU EVOLUCIÓN 1:1 */}
      <section
        onClick={() => onNavigateTab('records')}
        className="relative overflow-hidden p-4 sm:p-5 rounded-[22px] bg-[#171717] border border-[#303030] hover:border-[#CCFF00]/60 transition-all cursor-pointer shadow-lg flex items-center justify-between gap-3 group"
      >
        {/* Iluminación diagonal y gráfico de barras sutil en el fondo derecho */}
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(115deg, transparent 55%, rgba(204,255,0,0.16) 75%, transparent 92%)',
          }}
        />
        <div
          className="pointer-events-none absolute right-10 bottom-0 flex items-end gap-1.5 opacity-25 pb-2"
          aria-hidden="true"
        >
          <div className="w-2.5 h-3 bg-[#CCFF00] rounded-t-sm" />
          <div className="w-2.5 h-5 bg-[#CCFF00] rounded-t-sm" />
          <div className="w-2.5 h-7 bg-[#CCFF00] rounded-t-sm" />
          <div className="w-2.5 h-10 bg-[#CCFF00] rounded-t-sm" />
          <div className="w-2.5 h-12 bg-[#CCFF00] rounded-t-sm" />
        </div>

        {/* Icono de tendencia en verde lima */}
        <div className="w-11 h-11 shrink-0 flex items-center justify-center relative z-10">
          <svg
            viewBox="0 0 36 36"
            fill="none"
            className="w-9 h-9 text-[#CCFF00] drop-shadow-[0_0_8px_rgba(204,255,0,0.3)]"
            aria-hidden="true"
          >
            <path
              d="M5 24L13.5 15.5L19.5 21.5L31 10"
              stroke="#CCFF00"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M23 10H31V18"
              stroke="#CCFF00"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1="5"
              y1="30"
              x2="31"
              y2="30"
              stroke="#CCFF00"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeOpacity="0.55"
            />
          </svg>
        </div>

        {/* Título y descripción */}
        <div className="flex-1 min-w-0 relative z-10">
          <h3 className="text-base sm:text-lg font-black italic uppercase tracking-tight text-[#F5F5F5] group-hover:text-[#CCFF00] transition-colors leading-tight">
            TU EVOLUCIÓN
          </h3>
          <p className="text-xs text-[#F5F5F5]/80 mt-0.5 truncate">
            Revisa tu progreso, historial y estadísticas.
          </p>
        </div>

        {/* Flecha derecha */}
        <ChevronRight className="w-5 h-5 text-[#CCFF00] stroke-[2.5] shrink-0 relative z-10 group-hover:translate-x-0.5 transition-transform" />
      </section>
    </div>
  );
};
export default TodayView;
