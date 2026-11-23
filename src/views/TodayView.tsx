import React, { useMemo, useState } from 'react';
import {
  Play,
  Dumbbell,
  Layers,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Flame,
  Bot,
  Bell,
  ShieldCheck,
} from 'lucide-react';
import { Skeleton } from '../components/Skeleton';
import { Routine, CompletedWorkout, PersonalRecord, ActiveWorkoutSession, Profile } from '../types';
import { TabType } from '../components/Navigation';
import { evaluateWeeklyDaysCompletion, formatDateKeyYYYYMMDD } from '../utils/exportReport';
import { isSameWeekday } from '../utils/workoutAnalyticsEngine';
import { purgeAndSanitizeWorkoutHistory } from '../utils/historySanitizer';
import { summarizeTodayAndWeeklyCalories, getChileWeekdayName, resolveWorkoutChileDateKey } from '../utils/calorieCalculator';
import {
  computeRealTimeRecovery,
  computeOverallAthleteSummary,
} from '../utils/muscleRecoveryEngine';
import { CoachChatModal } from '../components/CoachChatModal';
import { EliteChallengesPanel } from '../components/EliteChallengesPanel';
import {
  buildUpdatedRoutineWithReplacement,
  CoachQuickIntent,
  CoachReplacementPreview,
} from '../utils/coachContextEngine';
import {
  buildUpdatedRoutineWithLoadChange,
  CoachLoadChangePreview,
} from '../utils/coachVoiceEngine';

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
  isHistorySyncing?: boolean;
  historySyncError?: string | null;
  onReplaceActiveExercise?: (
    exerciseId: string,
    replacement: {
      newName: string;
      libraryExerciseId?: string;
      targetMuscles?: string;
      equipment?: string;
      notes?: string;
      restSeconds?: number;
      initialWeight?: number;
    }
  ) => void;
  onUpdateRoutine?: (routine: Routine) => void;
  onUpdateSet?: (
    exerciseId: string,
    setIndex: number,
    field: 'weight' | 'reps' | 'rpe' | 'completed',
    value: unknown
  ) => void;
  unreadRecoveryCount?: number;
  onOpenRecoveryNotifications?: () => void;
  isAdmin?: boolean;
  adminRequiresGoogleSignIn?: boolean;
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
  const dateKey = formatDateKeyYYYYMMDD(referenceDate) || '';
  const parts = dateKey.split('-');
  const y = parseInt(parts[0], 10) || referenceDate.getFullYear();
  const m = parseInt(parts[1], 10) || (referenceDate.getMonth() + 1);
  const d = parseInt(parts[2], 10) || referenceDate.getDate();

  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const jsDay = noonUtc.getUTCDay();
  const diffToMonday = jsDay === 0 ? -6 : 1 - jsDay;
  const mondayUtc = new Date(noonUtc);
  mondayUtc.setUTCDate(noonUtc.getUTCDate() + diffToMonday + weekOffset * 7);
  return mondayUtc;
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
    stroke="var(--accent-readable-text)"
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
              stroke={isLit ? 'var(--accent-primary)' : '#303030'}
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
        <BicepFlexIcon className="w-10 h-10 sm:w-11 sm:h-11 drop-shadow-[0_0_8px_var(--accent-glow)]" />
      </div>
    </div>
  );
};

export const TodayView: React.FC<TodayViewProps> = ({
  routines,
  history,
  prs,
  activeSession,
  activeProfile,
  onStartWorkout,
  onNavigateActive,
  onSelectDay,
  onNavigateTab,
  onOpenProfileSwitcher,
  isHistorySyncing = false,
  historySyncError = null,
  onReplaceActiveExercise,
  onUpdateRoutine,
  onUpdateSet,
  unreadRecoveryCount = 0,
  onOpenRecoveryNotifications,
  isAdmin = false,
  adminRequiresGoogleSignIn = false,
  loading = false,
}) => {
  const now = useMemo(() => new Date(), []);
  const todayDateKey = useMemo(() => formatDateKeyYYYYMMDD(now) || '', [now]);
  const todayDayName = useMemo(
    () => getChileWeekdayName(todayDateKey || now),
    [todayDateKey, now]
  );

  const [selectedDayName, setSelectedDayName] = useState<string>(todayDayName);
  const [showDaySelector, setShowDaySelector] = useState<boolean>(false);
  const [showWeeklyCalories, setShowWeeklyCalories] = useState<boolean>(false);
  const [isCoachOpen, setIsCoachOpen] = useState<boolean>(false);
  const [coachInitialIntent, setCoachInitialIntent] =
    useState<CoachQuickIntent>('today_workout');

  const handleOpenCoach = (intent: CoachQuickIntent = 'today_workout') => {
    setCoachInitialIntent(intent);
    setIsCoachOpen(true);
  };

  const handleApplyCoachReplacement = (preview: CoachReplacementPreview) => {
    const {
      originalExerciseId,
      originalExerciseName,
      replacement,
      scope,
      targetRoutineId,
    } = preview;

    if (scope === 'session') {
      if (onReplaceActiveExercise) {
        onReplaceActiveExercise(originalExerciseId, {
          newName: replacement.name,
          libraryExerciseId: replacement.libraryExerciseId,
          targetMuscles: replacement.muscleGroup,
          equipment: replacement.equipment,
          notes: `Sustituyó a ${originalExerciseName} (Coach IA)`,
        });
      }
      return;
    }

    if (scope === 'routine') {
      const targetRoutine =
        routines.find((r) => r.id === targetRoutineId) ||
        routines.find((r) =>
          r.exercises.some(
            (e) => e.id === originalExerciseId || e.name === originalExerciseName
          )
        );
      if (targetRoutine && onUpdateRoutine) {
        const updated = buildUpdatedRoutineWithReplacement({
          routine: targetRoutine,
          originalExerciseId,
          originalExerciseName,
          replacement,
        });
        onUpdateRoutine(updated);
      }
      if (
        activeSession &&
        onReplaceActiveExercise &&
        activeSession.exercises.some(
          (ex) =>
            ex.exerciseId === originalExerciseId ||
            ex.originalExerciseId === originalExerciseId
        )
      ) {
        onReplaceActiveExercise(originalExerciseId, {
          newName: replacement.name,
          libraryExerciseId: replacement.libraryExerciseId,
          targetMuscles: replacement.muscleGroup,
          equipment: replacement.equipment,
          notes: `Sustituido en rutina desde ${originalExerciseName} (Coach IA)`,
        });
      }
    }
  };

  const handleApplyCoachLoadChange = (preview: CoachLoadChangePreview) => {
    const {
      originalExerciseId,
      originalExerciseName,
      proposedWeightKg,
      scope,
      targetRoutineId,
    } = preview;

    const activeEx = activeSession?.exercises.find(
      (ex) =>
        ex.exerciseId === originalExerciseId ||
        ex.originalExerciseId === originalExerciseId
    );

    if (activeEx && onUpdateSet) {
      activeEx.sets.forEach((setItem, setIdx) => {
        if (!setItem.completed) {
          onUpdateSet(activeEx.exerciseId, setIdx, 'weight', proposedWeightKg);
        }
      });
    }

    if (scope === 'routine' && onUpdateRoutine) {
      const targetRoutine =
        routines.find((r) => r.id === targetRoutineId) ||
        routines.find((r) =>
          r.exercises.some(
            (e) => e.id === originalExerciseId || e.name === originalExerciseName
          )
        );
      if (targetRoutine) {
        onUpdateRoutine(
          buildUpdatedRoutineWithLoadChange({
            routine: targetRoutine,
            originalExerciseId,
            originalExerciseName,
            proposedWeightKg,
          })
        );
      }
    }
  };

  const sanitizedHistory = useMemo(
    () => purgeAndSanitizeWorkoutHistory(Array.isArray(history) ? history : [], activeProfile?.weightKg || 95).cleanedHistory,
    [history, activeProfile?.weightKg]
  );

  const caloriesSummary = useMemo(
    () =>
      summarizeTodayAndWeeklyCalories(
        sanitizedHistory,
        activeProfile?.weightKg || 95,
        new Date()
      ),
    [sanitizedHistory, activeProfile?.weightKg]
  );

  const maxWeekCalories = useMemo(
    () => Math.max(1, ...caloriesSummary.weekDays.map((d) => d.calories)),
    [caloriesSummary]
  );

  // Construir los 7 días de la semana actual
  const timelineDays = useMemo(() => {
    const monday = getMondayOfWeek(now, 0);
    const workoutsByDateKey = new Map<string, CompletedWorkout[]>();
    sanitizedHistory.forEach((workout) => {
      const key = resolveWorkoutChileDateKey(workout) || formatDateKeyYYYYMMDD(workout.date);
      if (!key) return;
      const list = workoutsByDateKey.get(key) || [];
      list.push(workout);
      workoutsByDateKey.set(key, list);
    });

    return ORDERED_WEEKDAYS.map((wd, idx) => {
      const cellDate = new Date(monday);
      cellDate.setUTCDate(monday.getUTCDate() + idx);
      const dateKey = cellDate.toISOString().slice(0, 10);
      const dayNumber = String(cellDate.getUTCDate()).padStart(2, '0');

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

  const currentWeekBounds = useMemo(() => {
    const monday = getMondayOfWeek(now, 0);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return {
      mondayKey: monday.toISOString().slice(0, 10),
      sundayKey: sunday.toISOString().slice(0, 10),
    };
  }, [now]);
  const currentWeekWorkouts = useMemo(
    () =>
      sanitizedHistory.filter((h) => {
        const wKey = resolveWorkoutChileDateKey(h) || formatDateKeyYYYYMMDD(h.date) || '';
        return wKey !== '' && wKey >= currentWeekBounds.mondayKey && wKey <= currentWeekBounds.sundayKey;
      }),
    [sanitizedHistory, currentWeekBounds]
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

        <div className="flex items-center gap-2 shrink-0">
          {onOpenRecoveryNotifications && (
            <button
              type="button"
              data-testid="recovery-bell-btn"
              onClick={onOpenRecoveryNotifications}
              className="relative w-11 h-11 rounded-full bg-[#171717] border border-[#303030] hover:border-accent flex items-center justify-center text-[#F5F5F5] transition-colors active:scale-95 cursor-pointer shrink-0"
              title={
                unreadRecoveryCount > 0
                  ? `${unreadRecoveryCount} avisos de recuperación sin leer`
                  : 'Avisos de recuperación muscular'
              }
              aria-label={
                unreadRecoveryCount > 0
                  ? `Avisos de recuperación muscular (${unreadRecoveryCount} sin leer)`
                  : 'Avisos de recuperación muscular'
              }
            >
              <Bell className="w-5 h-5" />
              {unreadRecoveryCount > 0 && (
                <span
                  data-testid="recovery-bell-dot"
                  className="absolute top-2 right-2 w-2.5 h-2.5 rounded-full bg-[#CCFF00] shadow-[0_0_8px_#CCFF00]"
                />
              )}
            </button>
          )}

          {isAdmin && (
            <button
              type="button"
              data-testid="today-admin-btn"
              onClick={() => onNavigateTab('admin')}
              className="h-11 px-3 rounded-full bg-amber-500/15 border border-amber-500/45 hover:bg-amber-500/25 flex items-center justify-center gap-1.5 text-amber-300 text-[11px] font-black uppercase tracking-wider transition-colors active:scale-95 cursor-pointer shrink-0 shadow-[0_0_12px_rgba(245,158,11,0.2)]"
              title="Abrir Panel de Administración"
              aria-label="Panel de Administración"
            >
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              <span className="hidden xs:inline">Admin</span>
            </button>
          )}

          {onOpenProfileSwitcher && (
            <button
              type="button"
              onClick={onOpenProfileSwitcher}
              className="w-11 h-11 rounded-full bg-[#090909] border-2 border-accent flex items-center justify-center text-[#F5F5F5] shadow-[0_0_14px_var(--accent-glow)] transition-transform active:scale-95 cursor-pointer shrink-0"
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
        </div>
      </header>

      {!isAdmin && adminRequiresGoogleSignIn && (
        <section
          data-testid="admin-requires-google-banner"
          className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/35 flex items-center justify-between gap-3"
        >
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-wider text-amber-300">
              Acceso Administrador Bloqueado
            </div>
            <p className="text-[11px] text-amber-100/90 leading-snug mt-0.5">
              Iniciaste sesión con correo/contraseña. Para ver el Panel de Administración, entra con{' '}
              <strong>Continuar con Google</strong>.
            </p>
          </div>
          {onOpenProfileSwitcher && (
            <button
              type="button"
              onClick={onOpenProfileSwitcher}
              className="px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[11px] font-black uppercase tracking-wider shrink-0 cursor-pointer active:scale-95"
            >
              Cambiar
            </button>
          )}
        </section>
      )}

      {/* SESIÓN ACTIVA EN CURSO (Si existe entrenamiento iniciado) */}
      {activeSession && (
        <section className="p-3.5 rounded-2xl bg-[#171717] border border-accent flex items-center justify-between gap-3 shadow-[0_0_18px_var(--accent-glow)]">
          <div className="min-w-0">
            <div className="text-[10px] font-mono font-bold text-accent-text uppercase tracking-widest">
              ENTRENAMIENTO EN CURSO
            </div>
            <h2 className="text-sm font-black text-[#F5F5F5] truncate mt-0.5">
              {activeSession.routineTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onNavigateActive}
            style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-contrast-text)' }}
            className="min-h-[48px] px-4 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs uppercase tracking-wider shrink-0 cursor-pointer active:scale-95"
          >
            Retomar sesión
          </button>
        </section>
      )}

      {/* 2. TARJETA PRINCIPAL 1:1: ENTRENAMIENTO DEL DÍA */}
      <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-[#161616] via-[#121212] to-[#090909] border border-accent/65 p-4 sm:p-5 shadow-[0_0_26px_var(--accent-glow)]">
        {/* Rayos diagonales sutiles e iluminación temática de fondo */}
        <div
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              'linear-gradient(125deg, transparent 30%, var(--accent-soft-bg) 48%, transparent 56%, var(--accent-soft-bg) 70%, transparent 80%)',
          }}
        />
        <div className="pointer-events-none absolute -right-10 top-4 w-48 h-48 rounded-full bg-accent/15 blur-3xl" />

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
                      ? 'bg-accent text-accent-contrast font-black'
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
              aria-expanded={showDaySelector}
              title="Cambiar día de entrenamiento"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#090909]/90 border border-accent/80 shadow-[0_0_12px_var(--accent-glow)] mb-3 cursor-pointer active:scale-95 transition-transform"
            >
              <CalendarCheckIcon className="w-4 h-4 text-accent-text shrink-0" />
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
              <div className="text-xl xs:text-2xl sm:text-[28px] font-black italic uppercase text-accent-text leading-[1.05] tracking-tight mt-0.5 drop-shadow-[0_0_10px_var(--accent-glow)] break-words">
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
                <Dumbbell className="w-4 h-4 text-accent-text shrink-0" />
                <span>
                  <strong className="font-bold">{exerciseCount}</strong> ejercicios
                </span>
              </span>
              <span className="text-[#F5F5F5]/40 font-light">|</span>
              <span className="inline-flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-accent-text shrink-0" />
                <span>
                  <strong className="font-bold">{totalSetsCount}</strong> series
                </span>
              </span>
            </div>
          </div>

          {/* Columna Derecha: Gorila Musculoso LAZCAKONG GYM */}
          <div
            onClick={() => activeRoutine && onSelectDay(activeRoutine)}
            className="w-[24vw] max-w-[36%] xs:w-[148px] sm:w-[172px] shrink-0 flex items-center justify-center relative cursor-pointer"
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

        {/* Botón Principal Temático con Texto de Contraste Accesible */}
        {!activeSession && (
        <div className="relative z-10 mt-4">
          <button
            type="button"
            onClick={() =>
              activeRoutine ? onStartWorkout(activeRoutine) : onNavigateTab('rutinas')
            }
            style={{ backgroundColor: 'var(--accent-primary)', color: 'var(--accent-contrast-text)' }}
            className="w-full min-h-[52px] py-3.5 px-5 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black italic text-sm xs:text-base sm:text-lg uppercase tracking-wide flex items-center justify-center gap-3 shadow-[0_4px_22px_var(--accent-glow)] active:scale-[0.99] transition-all cursor-pointer"
          >
            <Play className="w-5 h-5 fill-current shrink-0" />
            <span>{activeRoutine ? 'Comenzar entrenamiento' : 'Ver mis rutinas'}</span>
          </button>
        </div>
        )}
      </section>

      {/* 3. ESTADÍSTICAS: PROGRESO SEMANAL & VOLUMEN TOTAL (2 tarjetas en una fila) */}
      <section className="grid grid-cols-2 gap-3">
        {/* TARJETA IZQUIERDA: PROGRESO SEMANAL */}
        <div className="p-3.5 sm:p-4 rounded-[22px] bg-[#171717] border border-[#303030] flex flex-col justify-between gap-2.5 shadow-lg">
          <div className="flex items-center gap-1.5 text-[10px] xs:text-[11px] font-extrabold uppercase tracking-tight text-[#F5F5F5]">
            <CalendarCheckIcon className="w-4 h-4 text-accent-text shrink-0" />
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
                  stroke="var(--accent-primary)"
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
            <Dumbbell className="w-4 h-4 text-accent-text shrink-0" />
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

            {/* Gráfico de 5 barras ascendentes temáticas */}
            <div className="flex items-end gap-1 h-11 shrink-0 pb-0.5" aria-hidden="true">
              <div className="w-1.5 sm:w-2 bg-accent/40 rounded-[2px] h-2.5" />
              <div className="w-1.5 sm:w-2 bg-accent/55 rounded-[2px] h-4" />
              <div className="w-1.5 sm:w-2 bg-accent/75 rounded-[2px] h-6" />
              <div className="w-1.5 sm:w-2 bg-accent/90 rounded-[2px] h-8" />
              <div className="w-1.5 sm:w-2 bg-accent rounded-[2px] h-11 shadow-[0_0_8px_var(--accent-glow)]" />
            </div>
          </div>
        </div>
      </section>

      {/* 3A. TARJETA COMPACTA: HABLA CON TU COACH (Coach LazcaKong IA) */}
      <section
        data-testid="today-coach-card"
        className="p-3.5 sm:p-4 rounded-[22px] bg-[#171717] border border-accent/45 shadow-lg space-y-2.5"
      >
        <div className="flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#090909] border border-accent/70 flex items-center justify-center shrink-0">
              <Bot className="w-4.5 h-4.5 text-accent-text" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black italic uppercase tracking-tight text-[#F5F5F5] leading-tight truncate">
                Habla con tu coach
              </h3>
              <p className="text-[11px] text-zinc-400 truncate">
                Coach LazcaKong IA · Rutina, cargas y reemplazos
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleOpenCoach('today_workout')}
            className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#090909] hover:bg-[#222222] border border-accent/60 text-[11px] font-black text-accent-text inline-flex items-center gap-1 shrink-0 cursor-pointer active:scale-95"
          >
            <span>Abrir</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => handleOpenCoach('today_workout')}
            className="px-2.5 py-1.5 rounded-xl bg-[#090909] hover:border-accent border border-[#303030] text-[11px] font-bold text-[#F5F5F5] cursor-pointer transition-colors"
          >
            ¿Qué me toca hoy?
          </button>
          <button
            type="button"
            onClick={() => handleOpenCoach('last_weight')}
            className="px-2.5 py-1.5 rounded-xl bg-[#090909] hover:border-accent border border-[#303030] text-[11px] font-bold text-[#F5F5F5] cursor-pointer transition-colors"
          >
            ¿Qué peso usé la última vez?
          </button>
          <button
            type="button"
            onClick={() => handleOpenCoach('replace_exercise')}
            className="px-2.5 py-1.5 rounded-xl bg-[#090909] hover:border-accent border border-[#303030] text-[11px] font-bold text-[#F5F5F5] cursor-pointer transition-colors"
          >
            ¿Con qué reemplazo este ejercicio?
          </button>
        </div>
      </section>

      {/* 3B. TARJETA CALORÍAS DE HOY + DESPLEGABLE SEMANAL (LUNES A DOMINGO) */}
      <section className="p-4 sm:p-5 rounded-[22px] bg-[#171717] border border-[#303030] shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-tight text-[#F5F5F5]">
                <Flame className="w-4 h-4 text-accent-text shrink-0" />
                <span>CALORÍAS DE HOY</span>
              </div>
              <span className="px-2 py-0.5 rounded-md bg-[#090909] border border-[#303030] text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                Estimadas
              </span>
            </div>

            {caloriesSummary.todayWorkoutsCount === 0 ? (
              <div className="mt-2">
                <p
                  data-testid="today-calories-value"
                  className="text-sm xs:text-base font-black text-[#F5F5F5] leading-snug tabular-nums"
                >
                  0 kcal · Sin entrenamientos registrados
                </p>
                <p className="text-[11px] text-zinc-400 mt-1">
                  Cifra estimada. Solo contabiliza entrenamientos realizados hoy.
                </p>
              </div>
            ) : (
              <div className="mt-2">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span
                    data-testid="today-calories-value"
                    className="text-2xl xs:text-3xl font-black text-accent-text leading-none tracking-tight tabular-nums"
                  >
                    {caloriesSummary.todayCalories.toLocaleString('es-CL')} kcal
                  </span>
                  <span className="text-[11px] font-semibold text-zinc-300">
                    estimadas
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-1">
                  {caloriesSummary.todayWorkoutsCount === 1
                    ? '1 entrenamiento realizado hoy'
                    : `${caloriesSummary.todayWorkoutsCount} entrenamientos realizados hoy`}
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowWeeklyCalories((prev) => !prev)}
            aria-expanded={showWeeklyCalories}
            aria-controls="weekly-calories-breakdown"
            className="min-h-[42px] px-3 py-2 rounded-xl bg-[#090909] hover:bg-[#222222] border border-[#303030] hover:border-accent/60 text-xs font-bold text-accent-text inline-flex items-center gap-1.5 shrink-0 transition-colors cursor-pointer active:scale-95"
          >
            <span>Ver semana</span>
            <ChevronDown
              className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                showWeeklyCalories ? 'rotate-180' : ''
              }`}
            />
          </button>
        </div>

        {showWeeklyCalories && (
          <div
            id="weekly-calories-breakdown"
            className="mt-4 pt-3.5 border-t border-[#303030] space-y-2.5 animate-in fade-in duration-150"
          >
            <div className="flex items-center justify-between gap-2 text-[11px] px-0.5">
              <span className="font-bold uppercase tracking-wider text-zinc-300">
                Semana (Lun – Dom) · kcal estimadas
              </span>
              <button
                type="button"
                onClick={() => setShowWeeklyCalories(false)}
                className="text-xs font-bold text-zinc-400 hover:text-accent-text transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-1.5">
              {caloriesSummary.weekDays.map((day) => {
                const barWidthPct =
                  day.calories > 0
                    ? Math.max(8, Math.round((day.calories / maxWeekCalories) * 100))
                    : 0;
                return (
                  <div
                    key={day.dateKey}
                    data-testid={`week-cal-day-${day.dateKey}`}
                    data-today={day.isToday ? 'true' : 'false'}
                    className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2.5 ${
                      day.isToday
                        ? 'bg-accent/12 border-accent/70'
                        : 'bg-[#090909] border-[#303030]/90'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-[108px] shrink-0">
                      <span
                        className={`text-xs font-bold ${
                          day.isToday ? 'text-accent-text' : 'text-[#F5F5F5]'
                        }`}
                      >
                        {day.weekdayName} {day.dayNumber}
                      </span>
                      {day.isToday && (
                        <span className="px-1.5 py-0.5 rounded bg-accent text-accent-contrast text-[9px] font-black uppercase tracking-wider leading-none">
                          HOY
                        </span>
                      )}
                    </div>

                    <div className="flex-1 h-1.5 rounded-full bg-[#1f1f1f] overflow-hidden min-w-[40px]">
                      {barWidthPct > 0 && (
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            day.isToday ? 'bg-accent' : 'bg-accent/75'
                          }`}
                          style={{ width: `${barWidthPct}%` }}
                        />
                      )}
                    </div>

                    <span
                      className={`text-xs font-mono font-bold tabular-nums text-right shrink-0 min-w-[68px] ${
                        day.isToday || day.calories > 0 ? 'text-accent-text' : 'text-zinc-500'
                      }`}
                    >
                      {day.calories.toLocaleString('es-CL')} kcal
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="px-3.5 py-2.5 rounded-xl bg-[#090909] border border-accent/40 flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#F5F5F5]">
                Total semanal estimado
              </span>
              <span
                data-testid="weekly-calories-total"
                className="text-sm font-black font-mono text-accent-text tabular-nums"
              >
                {caloriesSummary.weeklyTotalCalories.toLocaleString('es-CL')} kcal
              </span>
            </div>
          </div>
        )}
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
              className="w-5 h-5 rounded-full border border-accent text-accent-text flex items-center justify-center text-[11px] font-black shrink-0 cursor-pointer"
            >
              i
            </button>
          </div>

          <p className="text-xs text-[#F5F5F5]/80 leading-snug">
            Estado estimado de tus grupos musculares según tu último entrenamiento.
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            <span
              style={{
                backgroundColor: 'var(--accent-primary)',
                color: 'var(--accent-contrast-text)',
                boxShadow: '0 0 12px var(--accent-glow)',
              }}
              className="px-3 py-1 rounded-full bg-accent text-accent-contrast font-extrabold text-[10px] xs:text-[11px] tracking-tight uppercase whitespace-nowrap"
            >
              {hasHistory ? `RECUPERACIÓN: ${athleteSummary.overallRecoveryPct}%` : 'SIN DATOS'}
            </span>

            <button
              type="button"
              onClick={() => onNavigateTab('mapa-muscular')}
              className="text-xs sm:text-sm font-bold text-accent-text hover:underline inline-flex items-center gap-0.5 whitespace-nowrap cursor-pointer active:scale-95"
            >
              <span>Ver mapa</span>
              <ChevronRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
        </div>
      </section>

      {/* 4B. TARJETA ELITE CHALLENGES PRO (RANGO, XP, DESAFÍOS E INSIGNIAS) */}
      <EliteChallengesPanel
        profile={activeProfile}
        history={sanitizedHistory}
        routines={routines}
        prs={prs}
        variant="compact"
        onNavigateToProgreso={() => onNavigateTab('records')}
      />

      {/* 5. TARJETA TU EVOLUCIÓN 1:1 */}
      <section
        onClick={() => onNavigateTab('records')}
        className="relative overflow-hidden p-4 sm:p-5 rounded-[22px] bg-[#171717] border border-[#303030] hover:border-accent/60 transition-all cursor-pointer shadow-lg flex items-center justify-between gap-3 group"
      >
        {/* Iluminación diagonal y gráfico de barras sutil en el fondo derecho */}
        <div
          className="pointer-events-none absolute inset-0 opacity-25"
          style={{
            backgroundImage:
              'linear-gradient(115deg, transparent 55%, var(--accent-soft-bg) 75%, transparent 92%)',
          }}
        />
        <div
          className="pointer-events-none absolute right-10 bottom-0 flex items-end gap-1.5 opacity-25 pb-2"
          aria-hidden="true"
        >
          <div className="w-2.5 h-3 bg-accent rounded-t-sm" />
          <div className="w-2.5 h-5 bg-accent rounded-t-sm" />
          <div className="w-2.5 h-7 bg-accent rounded-t-sm" />
          <div className="w-2.5 h-10 bg-accent rounded-t-sm" />
          <div className="w-2.5 h-12 bg-accent rounded-t-sm" />
        </div>

        {/* Icono de tendencia en acento */}
        <div className="w-11 h-11 shrink-0 flex items-center justify-center relative z-10">
          <svg
            viewBox="0 0 36 36"
            fill="none"
            className="w-9 h-9 text-accent-text drop-shadow-[0_0_8px_var(--accent-glow)]"
            aria-hidden="true"
          >
            <path
              d="M5 24L13.5 15.5L19.5 21.5L31 10"
              stroke="var(--accent-readable-text)"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M23 10H31V18"
              stroke="var(--accent-readable-text)"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1="5"
              y1="30"
              x2="31"
              y2="30"
              stroke="var(--accent-readable-text)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeOpacity="0.55"
            />
          </svg>
        </div>

        {/* Título y descripción */}
        <div className="flex-1 min-w-0 relative z-10">
          <h3 className="text-base sm:text-lg font-black italic uppercase tracking-tight text-[#F5F5F5] group-hover:text-accent-text transition-colors leading-tight">
            TU EVOLUCIÓN
          </h3>
          <p className="text-xs text-[#F5F5F5]/80 mt-0.5 truncate">
            Revisa tu progreso, historial y estadísticas.
          </p>
        </div>

        {/* Flecha derecha */}
        <ChevronRight className="w-5 h-5 text-accent-text stroke-[2.5] shrink-0 relative z-10 group-hover:translate-x-0.5 transition-transform" />
      </section>

      <CoachChatModal
        isOpen={isCoachOpen}
        initialIntent={coachInitialIntent}
        onClose={() => setIsCoachOpen(false)}
        activeProfile={activeProfile}
        routines={routines}
        history={history}
        prs={prs}
        activeSession={activeSession}
        isHistorySyncing={isHistorySyncing}
        historySyncError={historySyncError}
        onApplyReplacement={handleApplyCoachReplacement}
        onApplyLoadChange={handleApplyCoachLoadChange}
        onStartWorkout={onStartWorkout}
        onNavigateRoutines={() => onNavigateTab('rutinas')}
      />
    </div>
  );
};
export default TodayView;
