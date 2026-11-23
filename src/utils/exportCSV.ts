import { CompletedWorkout, PersonalRecord, BodyWeightEntry, Profile } from '../types';
import { CHILE_TIMEZONE, getChileLocalDateKey } from './calorieCalculator';

/**
 * Escapes a cell value conforming to RFC 4180 CSV standard.
 * Wraps values containing commas, quotes, or newlines in quotes,
 * and escapes double quotes by doubling them.
 */
function escapeCSVCell(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.includes(';')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts a 2D array of cells into a valid CSV string.
 */
function toCSVString(rows: (string | number | undefined | null)[][]): string {
  return rows.map((row) => row.map(escapeCSVCell).join(',')).join('\r\n');
}

/**
 * Triggers a browser download of a CSV file using UTF-8 BOM so
 * Microsoft Excel, Google Sheets, Numbers, and text editors correctly
 * render Spanish accented characters (á, é, í, ó, ú, ñ).
 */
export function triggerCSVDownload(filename: string, csvContent: string): boolean {
  try {
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.error('Error al exportar archivo CSV:', err);
    return false;
  }
}

/**
 * Formats an ISO date into DD-MM-YYYY and HH:mm
 */
function parseDateParts(dateStr: string): { date: string; time: string } {
  const chileKey = getChileLocalDateKey(dateStr);
  const d = new Date(dateStr);
  if (chileKey && /^\d{4}-\d{2}-\d{2}$/.test(chileKey)) {
    const [year, month, day] = chileKey.split('-');
    let timeStr = '00:00';
    if (!isNaN(d.getTime()) && String(dateStr).includes('T')) {
      try {
        timeStr = new Intl.DateTimeFormat('es-CL', {
          timeZone: CHILE_TIMEZONE,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(d);
      } catch {
        timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }
    return {
      date: `${day}-${month}-${year}`,
      time: timeStr,
    };
  }
  return { date: dateStr || 'N/A', time: 'N/A' };
}

/**
 * Generates and downloads a CSV file containing the athlete's exercise & load history,
 * combining the real-time Comparative Strength & Load Evolution table (by day) and
 * the chronological session-by-session exercise logs.
 */
export function exportExercisesAndLoadsToCSV(params: {
  comparativeGroups?: Array<{
    dayName: string;
    dayHeader: string;
    lastExecutedDate: string | null;
    rows: Array<{
      name: string;
      muscleGroup?: string;
      prevWeight: number;
      prevReps: number;
      currWeight: number;
      currReps: number;
      curr1RM: number;
      weightDelta: number;
      pctDelta: number;
      lastExecutedDate?: string | null;
    }>;
  }>;
  history: CompletedWorkout[];
  athlete?: Profile | { name?: string } | string;
  selectedDayFilter?: string;
}): boolean {
  const { comparativeGroups = [], history = [], athlete, selectedDayFilter = 'ALL' } = params;
  const athleteName =
    typeof athlete === 'string' ? athlete : athlete?.name || 'Atleta';

  const rows: (string | number | undefined | null)[][] = [];
  const todayParts = parseDateParts(new Date().toISOString());

  // Bloque de Metadatos del Reporte
  rows.push(['REGISTRO PERSONAL DE EJERCICIOS Y EVOLUCIÓN DE CARGAS - LAZCAKONGYM']);
  rows.push(['Atleta', athleteName, 'Fecha de Exportación', `${todayParts.date} ${todayParts.time}`]);
  rows.push([
    'Filtro de Día',
    selectedDayFilter === 'ALL' ? 'Semana Completa (Todos los días)' : selectedDayFilter,
  ]);
  rows.push([]);

  // SECCIÓN 1: Cuadro Comparativo de Fuerza y Evolución de Cargas (Rutina Activa / Semana en Curso)
  rows.push(['=== 1. EVOLUCIÓN DE CARGAS Y 1RM POR DÍA (RUTINA ACTIVA) ===']);
  rows.push([
    'Día',
    'Sesión / Enfoque',
    'Estado / Fecha Ejecución',
    'Ejercicio',
    'Grupo Muscular',
    'Carga Anterior (kg)',
    'Reps Anteriores',
    'Carga Actual (kg)',
    'Reps Actuales',
    '1RM Estimado (kg)',
    'Diferencia (kg)',
    'Variación (%)',
  ]);

  if (comparativeGroups.length === 0) {
    rows.push(['Sin ejercicios en la rutina activa', '', '', '', '', '', '', '', '', '', '', '']);
  } else {
    comparativeGroups.forEach((group) => {
      const execStatus = group.lastExecutedDate
        ? parseDateParts(group.lastExecutedDate).date
        : 'Planificado';
      group.rows.forEach((r) => {
        const rowDate = r.lastExecutedDate
          ? parseDateParts(r.lastExecutedDate).date
          : execStatus;
        rows.push([
          group.dayName,
          group.dayHeader,
          rowDate,
          r.name,
          r.muscleGroup || 'General',
          r.prevWeight,
          r.prevReps,
          r.currWeight,
          r.currReps,
          r.curr1RM,
          r.weightDelta > 0 ? `+${r.weightDelta}` : r.weightDelta,
          r.pctDelta > 0 ? `+${r.pctDelta}%` : `${r.pctDelta}%`,
        ]);
      });
    });
  }

  rows.push([]);

  // SECCIÓN 2: Historial Cronológico de Sesiones y Cargas Ejecutadas
  rows.push(['=== 2. HISTORIAL CRONOLÓGICO DE SESIONES Y CARGAS ===']);
  rows.push([
    'Fecha (DD-MM-YYYY)',
    'Hora',
    'Rutina / Sesión',
    'Ejercicio',
    'Grupo Muscular',
    'Series Completadas',
    'Carga Máxima (kg)',
    'Repeticiones',
    '1RM Estimado (kg)',
    'Volumen Ejercicio (kg)',
    'Volumen Total Sesión (kg)',
    'Duración Sesión (min)',
  ]);

  const finished = history.filter((h) => h && h.isFinished !== false);
  if (finished.length === 0) {
    rows.push(['Sin sesiones históricas registradas', '', '', '', '', '', '', '', '', '', '', '']);
  } else {
    const sorted = [...finished].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    sorted.forEach((workout) => {
      const { date, time } = parseDateParts(workout.date);
      const durationMin = Math.round((workout.durationSeconds || 0) / 60);
      const totalVolume = Math.round(workout.totalVolumeKg || 0);
      const totalSets = workout.completedSetsCount || 0;

      if (workout.exercisesSummary && workout.exercisesSummary.length > 0) {
        workout.exercisesSummary.forEach((ex) => {
          const exVolume = Math.round(
            ex.volumeKg || (ex.maxWeight && ex.maxReps && ex.sets ? ex.maxWeight * ex.maxReps * ex.sets : 0)
          );
          const estimated1RM =
            ex.estimated1RM ||
            (ex.maxWeight && ex.maxReps ? Math.round(ex.maxWeight * (1 + ex.maxReps / 30)) : ex.maxWeight || 0);

          rows.push([
            date,
            time,
            workout.routineTitle || 'Entrenamiento de Fuerza',
            ex.name || 'Ejercicio',
            ex.muscleGroup || 'General',
            ex.sets || 0,
            ex.maxWeight || 0,
            ex.maxReps || 0,
            estimated1RM,
            exVolume,
            totalVolume,
            durationMin,
          ]);
        });
      } else {
        rows.push([
          date,
          time,
          workout.routineTitle || 'Entrenamiento',
          '(Resumen de sesión)',
          'General',
          totalSets,
          0,
          0,
          0,
          totalVolume,
          totalVolume,
          durationMin,
        ]);
      }
    });
  }

  const csvContent = toCSVString(rows);
  const athleteSlug = athleteName
    ? `_${athleteName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
    : '';
  const daySlug =
    selectedDayFilter && selectedDayFilter !== 'ALL'
      ? `_${selectedDayFilter.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`
      : '';
  const filename = `historial_ejercicios_y_cargas${athleteSlug}${daySlug}_${todayParts.date}.csv`;

  return triggerCSVDownload(filename, csvContent);
}

/**
 * Generates and downloads a CSV file containing the user's workout history.
 * Each exercise performed in each session is detailed with session-level metrics.
 */
export function exportWorkoutsToCSV(
  history: CompletedWorkout[],
  athlete?: Profile | { name?: string } | string
): boolean {
  const finished = history.filter((h) => h.isFinished);
  const rows: (string | number | undefined | null)[][] = [];
  const athleteName = typeof athlete === 'string' ? athlete : athlete?.name;

  // Header row
  rows.push([
    'ID Sesión',
    'Fecha',
    'Hora',
    'Rutina / Entrenamiento',
    'Duración (minutos)',
    'Volumen Sesión (kg)',
    'Series Totales Sesión',
    'Ejercicio',
    'Grupo Muscular',
    'Series Ejercicio',
    'Peso Máximo (kg)',
    'Reps Máximas',
    'Volumen Ejercicio (kg)',
    '1RM Estimado (kg)',
  ]);

  if (finished.length === 0) {
    rows.push(['Sin registros finalizados', '', '', '', '', '', '', '', '', '', '', '', '', '']);
  } else {
    // Sort descending by date (most recent first)
    const sorted = [...finished].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    sorted.forEach((workout) => {
      const { date, time } = parseDateParts(workout.date);
      const durationMin = Math.round((workout.durationSeconds || 0) / 60);
      const totalVolume = Math.round(workout.totalVolumeKg || 0);
      const totalSets = workout.completedSetsCount || 0;

      if (workout.exercisesSummary && workout.exercisesSummary.length > 0) {
        workout.exercisesSummary.forEach((ex) => {
          const exVolume = Math.round(
            ex.volumeKg || (ex.maxWeight && ex.maxReps && ex.sets ? ex.maxWeight * ex.maxReps * ex.sets : 0)
          );
          const estimated1RM =
            ex.estimated1RM ||
            (ex.maxWeight && ex.maxReps ? Math.round(ex.maxWeight * (1 + ex.maxReps / 30)) : ex.maxWeight || 0);

          rows.push([
            workout.id,
            date,
            time,
            workout.routineTitle || 'Entrenamiento Libre',
            durationMin,
            totalVolume,
            totalSets,
            ex.name || 'Ejercicio',
            ex.muscleGroup || 'General',
            ex.sets || 0,
            ex.maxWeight || 0,
            ex.maxReps || 0,
            exVolume,
            estimated1RM,
          ]);
        });
      } else {
        // Fallback row if no exercises breakdown is recorded
        rows.push([
          workout.id,
          date,
          time,
          workout.routineTitle || 'Entrenamiento',
          durationMin,
          totalVolume,
          totalSets,
          '(Resumen de sesión)',
          'General',
          totalSets,
          0,
          0,
          totalVolume,
          0,
        ]);
      }
    });
  }

  const csvContent = toCSVString(rows);
  const todayStr = parseDateParts(new Date().toISOString()).date;
  const athleteSlug = athleteName ? `_${athleteName.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
  const filename = `historial_entrenamientos${athleteSlug}_${todayStr}.csv`;

  return triggerCSVDownload(filename, csvContent);
}

/**
 * Generates and downloads a CSV file containing all Personal Records (PRs)
 * achieved by the user with their estimated 1RM.
 */
export function exportPRsToCSV(
  prs: Record<string, PersonalRecord>,
  athlete?: Profile | { name?: string }
): boolean {
  const prList = Object.values(prs);
  const rows: (string | number | undefined | null)[][] = [];

  // Header row
  rows.push([
    'Ejercicio',
    'Peso Máximo Levantado (kg)',
    'Repeticiones al Peso Máx',
    '1RM Estimado (kg)',
    'Fecha de Logro',
    'Hora',
    'ID Ejercicio',
  ]);

  if (prList.length === 0) {
    rows.push(['Sin récords personales registrados', '', '', '', '', '', '']);
  } else {
    // Sort descending by highest 1RM or weight
    const sorted = [...prList].sort((a, b) => (b.estimated1RM || b.maxWeight) - (a.estimated1RM || a.maxWeight));

    sorted.forEach((pr) => {
      const { date, time } = parseDateParts(pr.date);
      rows.push([
        pr.exerciseName || 'Ejercicio',
        pr.maxWeight || 0,
        pr.repsAtMaxWeight || 1,
        pr.estimated1RM || pr.maxWeight || 0,
        date,
        time,
        pr.exerciseId || '',
      ]);
    });
  }

  const csvContent = toCSVString(rows);
  const todayStr = new Date().toISOString().split('T')[0];
  const athleteSlug = athlete?.name ? `_${athlete.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
  const filename = `records_personales_prs${athleteSlug}_${todayStr}.csv`;

  return triggerCSVDownload(filename, csvContent);
}

/**
 * Generates and downloads a CSV file containing body weight and body fat logs.
 */
export function exportBodyWeightToCSV(
  logs: BodyWeightEntry[],
  athlete?: Profile | { name?: string }
): boolean {
  const rows: (string | number | undefined | null)[][] = [];

  // Header row
  rows.push(['Fecha', 'Hora', 'Peso Corporal (kg)', 'Grasa Corporal (%)', 'Notas']);

  if (!logs || logs.length === 0) {
    rows.push(['Sin registros de peso corporal', '', '', '', '']);
  } else {
    const sorted = [...logs].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    sorted.forEach((entry) => {
      const { date, time } = parseDateParts(entry.date);
      rows.push([
        date,
        time,
        entry.weightKg || 0,
        entry.bodyFatPct !== undefined ? entry.bodyFatPct : '',
        entry.note || '',
      ]);
    });
  }

  const csvContent = toCSVString(rows);
  const todayStr = new Date().toISOString().split('T')[0];
  const athleteSlug = athlete?.name ? `_${athlete.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
  const filename = `peso_corporal_historial${athleteSlug}_${todayStr}.csv`;

  return triggerCSVDownload(filename, csvContent);
}

/**
 * Exports all data (Workouts, PRs, and Body Weight) in a single consolidated
 * multi-section CSV file for complete backup and offline analysis.
 */
export function exportConsolidatedBackupToCSV(
  history: CompletedWorkout[],
  prs: Record<string, PersonalRecord>,
  bodyWeightLogs: BodyWeightEntry[],
  athlete?: Profile
): boolean {
  const finished = history.filter((h) => h.isFinished);
  const prList = Object.values(prs);
  const rows: (string | number | undefined | null)[][] = [];

  const todayStr = new Date().toISOString().split('T')[0];
  const nowFormatted = new Date().toLocaleString('es-ES');

  // Metadata Block
  rows.push(['=== RESPALDO COMPLETO DE ENTRENAMIENTOS Y RÉCORDS ===']);
  rows.push(['Atleta', athlete?.name || 'Usuario']);
  rows.push(['Fecha de Exportación', nowFormatted]);
  rows.push(['Total Sesiones Finalizadas', finished.length]);
  rows.push(['Total Récords Personales (PRs)', prList.length]);
  rows.push(['Total Registros de Peso Corporal', bodyWeightLogs?.length || 0]);
  rows.push(['']);

  // Section 1: Récords Personales (PRs)
  rows.push(['--- SECCIÓN 1: SALA DE TROFEOS Y RÉCORDS PERSONALES (PRs) ---']);
  rows.push([
    'Ejercicio',
    'Peso Máximo (kg)',
    'Reps al Peso Máx',
    '1RM Estimado (kg)',
    'Fecha de Logro',
    'Hora',
  ]);
  if (prList.length === 0) {
    rows.push(['Sin registros de PRs', '', '', '', '', '']);
  } else {
    prList.forEach((pr) => {
      const { date, time } = parseDateParts(pr.date);
      rows.push([
        pr.exerciseName,
        pr.maxWeight,
        pr.repsAtMaxWeight,
        pr.estimated1RM,
        date,
        time,
      ]);
    });
  }
  rows.push(['']);

  // Section 2: Historial Detallado de Entrenamientos
  rows.push(['--- SECCIÓN 2: HISTORIAL DE ENTRENAMIENTOS Y VOLUMEN ---']);
  rows.push([
    'Fecha',
    'Hora',
    'Rutina / Sesión',
    'Duración (min)',
    'Volumen Sesión (kg)',
    'Series Sesión',
    'Ejercicio',
    'Grupo Muscular',
    'Series',
    'Peso Máximo (kg)',
    'Reps',
    'Volumen Ejercicio (kg)',
    '1RM Estimado (kg)',
  ]);
  if (finished.length === 0) {
    rows.push(['Sin sesiones finalizadas', '', '', '', '', '', '', '', '', '', '', '', '']);
  } else {
    const sorted = [...finished].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );
    sorted.forEach((w) => {
      const { date, time } = parseDateParts(w.date);
      const durMin = Math.round((w.durationSeconds || 0) / 60);
      const totalVol = Math.round(w.totalVolumeKg || 0);
      if (w.exercisesSummary && w.exercisesSummary.length > 0) {
        w.exercisesSummary.forEach((ex) => {
          const exVol = Math.round(
            ex.volumeKg || (ex.maxWeight && ex.maxReps && ex.sets ? ex.maxWeight * ex.maxReps * ex.sets : 0)
          );
          const est1RM =
            ex.estimated1RM ||
            (ex.maxWeight && ex.maxReps ? Math.round(ex.maxWeight * (1 + ex.maxReps / 30)) : ex.maxWeight || 0);

          rows.push([
            date,
            time,
            w.routineTitle || 'Entrenamiento Libre',
            durMin,
            totalVol,
            w.completedSetsCount || 0,
            ex.name || 'Ejercicio',
            ex.muscleGroup || 'General',
            ex.sets || 0,
            ex.maxWeight || 0,
            ex.maxReps || 0,
            exVol,
            est1RM,
          ]);
        });
      } else {
        rows.push([
          date,
          time,
          w.routineTitle || 'Entrenamiento',
          durMin,
          totalVol,
          w.completedSetsCount || 0,
          '(Sesión general)',
          'General',
          w.completedSetsCount || 0,
          0,
          0,
          totalVol,
          0,
        ]);
      }
    });
  }
  rows.push(['']);

  // Section 3: Registro de Peso Corporal (si existe)
  if (bodyWeightLogs && bodyWeightLogs.length > 0) {
    rows.push(['--- SECCIÓN 3: SEGUIMIENTO DE PESO CORPORAL ---']);
    rows.push(['Fecha', 'Hora', 'Peso Corporal (kg)', 'Grasa Corporal (%)', 'Notas']);
    bodyWeightLogs.forEach((b) => {
      const { date, time } = parseDateParts(b.date);
      rows.push([date, time, b.weightKg, b.bodyFatPct || '', b.note || '']);
    });
  }

  const csvContent = toCSVString(rows);
  const athleteSlug = athlete?.name ? `_${athlete.name.toLowerCase().replace(/[^a-z0-9]/g, '_')}` : '';
  const filename = `respaldo_completo_fitness${athleteSlug}_${todayStr}.csv`;

  return triggerCSVDownload(filename, csvContent);
}
