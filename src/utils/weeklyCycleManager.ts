export interface HistoricoSemanalSummary {
  weekId: string;
  startDate: string;
  endDate: string;
  totalSets: number;
  averageRpe: number;
  averageFatigue: number;
  totalTonnageKg: number;
  muscleSets: Record<string, number>;
  archivedAt: string;
}

export interface HistoricoMensualRecord {
  monthId: string; // ej. "2026-10"
  userId: string;
  monthName: string;
  year: number;
  totalMonthlySets: number;
  averageMonthlyRpe: number;
  averageMonthlyFatigue: number;
  totalMonthlyTonnageKg: number;
  weeklyLogs: Record<string, HistoricoSemanalSummary>;
  updatedAt: string;
}

/**
 * Devuelve el inicio exacto (Lunes a las 00:00:00.000) de la semana en curso según el calendario.
 */
export function getStartOfCurrentWeek(referenceDate: Date = new Date()): Date {
  const d = new Date(referenceDate);
  const day = d.getDay(); // 0 es Domingo, 1 es Lunes, ..., 6 es Sábado
  // Si es domingo (0), restar 6 días para llegar al lunes previo. Si es 1-6, restar (day - 1)
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Devuelve el fin exacto (Domingo a las 23:59:59.999) de la semana en curso.
 */
export function getEndOfCurrentWeek(referenceDate: Date = new Date()): Date {
  const start = getStartOfCurrentWeek(referenceDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

/**
 * Genera el identificador ISO de la semana: ej. "2026-W44"
 */
export function getWeekIdentifier(d: Date = new Date()): string {
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
  const year = d.getFullYear();
  return `${year}-W${weekNumber.toString().padStart(2, '0')}`;
}

/**
 * Genera el identificador del mes: ej. "2026-10"
 */
export function getMonthIdentifier(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Obtiene el nombre del mes en español
 */
export function getMonthName(d: Date = new Date()): string {
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

/**
 * Carga el registro mensual acumulativo desde LocalStorage o Firestore
 */
export function getHistoricoMensualFromStorage(monthId: string = getMonthIdentifier()): HistoricoMensualRecord | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = localStorage.getItem(`lazcakon_historico_mensual_${monthId}`);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Error reading Historico_Mensual_Series from localStorage', err);
  }
  return null;
}

/**
 * Guarda o actualiza un registro en Historico_Mensual_Series (LocalStorage + Cloud Firestore silencioso)
 */
export async function saveToHistoricoMensual(
  weekSummary: HistoricoSemanalSummary,
  userId: string = 'atleta_default'
): Promise<HistoricoMensualRecord> {
  const d = new Date(weekSummary.startDate);
  const monthId = getMonthIdentifier(d);
  const monthName = getMonthName(d);
  const year = d.getFullYear();

  let existing = getHistoricoMensualFromStorage(monthId);

  if (!existing) {
    existing = {
      monthId,
      userId,
      monthName,
      year,
      totalMonthlySets: 0,
      averageMonthlyRpe: 8.0,
      averageMonthlyFatigue: 0,
      totalMonthlyTonnageKg: 0,
      weeklyLogs: {},
      updatedAt: new Date().toISOString(),
    };
  }

  // Insertar o actualizar la semana consolidada
  existing.weeklyLogs[weekSummary.weekId] = weekSummary;

  // Recalcular métricas acumuladas del mes
  const weeksList = Object.values(existing.weeklyLogs);
  const totalSets = weeksList.reduce((acc, w) => acc + (w.totalSets || 0), 0);
  const totalTonnage = weeksList.reduce((acc, w) => acc + (w.totalTonnageKg || 0), 0);
  const avgRpe =
    weeksList.length > 0
      ? Number((weeksList.reduce((acc, w) => acc + (w.averageRpe || 8.0), 0) / weeksList.length).toFixed(1))
      : 8.0;
  const avgFatigue =
    weeksList.length > 0
      ? Math.round(weeksList.reduce((acc, w) => acc + (w.averageFatigue || 0), 0) / weeksList.length)
      : 0;

  existing.totalMonthlySets = totalSets;
  existing.totalMonthlyTonnageKg = totalTonnage;
  existing.averageMonthlyRpe = avgRpe;
  existing.averageMonthlyFatigue = avgFatigue;
  existing.updatedAt = new Date().toISOString();

  // 1. Guardar en LocalStorage
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      localStorage.setItem(`lazcakon_historico_mensual_${monthId}`, JSON.stringify(existing));
      // Guardar también en la lista de meses disponibles
      const monthsRaw = localStorage.getItem('lazcakon_historico_meses_disponibles');
      const monthsSet = new Set<string>(monthsRaw ? JSON.parse(monthsRaw) : []);
      monthsSet.add(monthId);
      localStorage.setItem('lazcakon_historico_meses_disponibles', JSON.stringify(Array.from(monthsSet)));
      window.dispatchEvent(new CustomEvent('lazcakon_historico_mensual_updated', { detail: { monthId, record: existing } }));
    } catch (err) {
      console.warn('Could not save to localStorage', err);
    }
  }

  return existing;
}

/**
 * Evalúa si la semana activa ha cambiado (ha llegado el lunes o finalizado el domingo).
 * Si cambió, migra los datos recopilados al Historico_Mensual_Series y resetea los contadores activos.
 */
export async function checkAndExecuteWeeklyReset(
  currentWeekMetrics: {
    totalSets: number;
    averageRpe: number;
    averageFatigue: number;
    totalTonnageKg: number;
    muscleSets: Record<string, number>;
  },
  userId: string = 'atleta_default'
): Promise<{ didReset: boolean; activeWeekId: string }> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { didReset: false, activeWeekId: getWeekIdentifier() };
  }

  const currentWeekId = getWeekIdentifier();
  const lastActiveWeek = localStorage.getItem('lazcakon_last_active_week');

  // Si es la primera vez que se inicializa en el cliente
  if (!lastActiveWeek) {
    localStorage.setItem('lazcakon_last_active_week', currentWeekId);
    return { didReset: false, activeWeekId: currentWeekId };
  }

  // Si la semana no ha cambiado, no hay reseteo
  if (lastActiveWeek === currentWeekId) {
    return { didReset: false, activeWeekId: currentWeekId };
  }

  // ¡La semana cerró! (Es un nuevo ciclo semanal). Migrar silenciosamente al histórico mensual
  console.log(`[LAZCAKONGYM] Reseteo semanal activado: Cerrando ${lastActiveWeek} -> Iniciando ${currentWeekId}`);

  // Archivar la semana cerrada
  const startOfPrevWeek = new Date();
  startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);
  const startStr = getStartOfCurrentWeek(startOfPrevWeek).toISOString();
  const endStr = getEndOfCurrentWeek(startOfPrevWeek).toISOString();

  const weekSummary: HistoricoSemanalSummary = {
    weekId: lastActiveWeek,
    startDate: startStr,
    endDate: endStr,
    totalSets: currentWeekMetrics.totalSets,
    averageRpe: currentWeekMetrics.averageRpe || 8.0,
    averageFatigue: currentWeekMetrics.averageFatigue || 0,
    totalTonnageKg: currentWeekMetrics.totalTonnageKg || 0,
    muscleSets: currentWeekMetrics.muscleSets || {},
    archivedAt: new Date().toISOString(),
  };

  await saveToHistoricoMensual(weekSummary, userId);

  // Limpiar contadores de simulación y caché activa temporal
  localStorage.setItem('lazcakon_last_active_week', currentWeekId);
  localStorage.removeItem('lazcakon_simulated_sets'); // Limpia series simuladas activas

  // Notificar al frontend que el ciclo semanal se reinició limpiamente
  window.dispatchEvent(
    new CustomEvent('lazcakon_weekly_cycle_reset', {
      detail: {
        previousWeek: lastActiveWeek,
        newWeek: currentWeekId,
      },
    })
  );

  return { didReset: true, activeWeekId: currentWeekId };
}

// ============================================================================
// CÁLCULO DE "SEMANA ACTUAL EJECUTADA" BASADO EN DÍAS ÚNICOS (YYYY-MM-DD)
// ============================================================================

export interface WorkoutLogEntryMinimal {
  id?: string;
  date: string;
  isFinished?: boolean;
  completedSetsCount?: number;
  exercisesSummary?: unknown[];
}

export interface ActiveRoutineConfig {
  /** Cantidad de días asignados a la rutina por semana (N, ej. 4 o 5 días/semana) */
  daysPerWeek: number;
  /** Duración total del mesociclo o bloque en semanas (ej. 8 o 12 semanas) */
  totalWeeks?: number;
  /** Nombre opcional de la rutina o programa activo */
  routineProgramName?: string;
  /** Fecha opcional de inicio del programa ('YYYY-MM-DD') para filtrar solo sesiones del bloque actual */
  startDate?: string;
}

export interface ExecutedWeekCalculationResult {
  /** Semana actual en ejecución: Math.floor(uniqueDaysCount / N) + 1 */
  currentExecutedWeek: number;
  /** Total de semanas programadas en el bloque/mesociclo */
  totalWeeks: number;
  /** Cantidad total de días únicos calendario (YYYY-MM-DD) entrenados */
  uniqueDaysCount: number;
  /** Días asignados por semana en la rutina (N) */
  daysPerWeek: number;
  /** Días únicos completados dentro de la semana actual en curso (uniqueDaysCount % N) */
  daysInCurrentWeek: number;
  /** Días restantes para desbloquear la siguiente semana (N - daysInCurrentWeek) */
  daysRemainingForNextWeek: number;
  /** Semanas completas ya cerradas (Math.floor(uniqueDaysCount / N)) */
  completedFullWeeks: number;
  /** Porcentaje de avance dentro de la semana actual (0 - 100%) */
  currentWeekProgressPct: number;
  /** Porcentaje de avance global respecto al total de semanas del bloque (0 - 100%) */
  totalProgramProgressPct: number;
  /** Lista ordenada cronológicamente de fechas únicas 'YYYY-MM-DD' contabilizadas */
  uniqueTrainedDates: string[];
}

/**
 * Normaliza cualquier fecha (ISO string, 'YYYY-MM-DD' o 'DD-MM-YYYY') a clave calendario 'YYYY-MM-DD'.
 */
export function normalizeToCalendarDateYYYYMMDD(rawDate: string | Date): string | null {
  if (!rawDate) return null;

  if (rawDate instanceof Date) {
    if (isNaN(rawDate.getTime())) return null;
    const y = rawDate.getFullYear();
    const m = String(rawDate.getMonth() + 1).padStart(2, '0');
    const d = String(rawDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const trimmed = String(rawDate).trim();
  // 1. Formato nativo YYYY-MM-DD al inicio del string
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // 2. Formato DD-MM-YYYY o DD/MM/YYYY
  const dmyMatch = trimmed.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/);
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
  }

  // 3. Fallback Date parser local
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Calcula automáticamente la "Semana Actual Ejecutada" de la rutina activa del atleta.
 *
 * Reglas:
 * 1. Conteo basado en Días Únicos calendario ('YYYY-MM-DD') con al menos un entrenamiento registrado.
 * 2. Múltiples sesiones en un mismo día (ej. mañana torso + tarde cardio) cuentan como 1 solo día entrenado.
 * 3. Semana = Math.floor(dias_unicos / N) + 1, donde N es la frecuencia semanal asignada a la rutina.
 */
export function calculateExecutedWeekStatus(
  workoutHistory: WorkoutLogEntryMinimal[],
  routineConfig: ActiveRoutineConfig
): ExecutedWeekCalculationResult {
  // Asegurar N >= 1 (por defecto 4 días/semana si no se especifica o es 0)
  const daysPerWeek = Math.max(1, Math.round(routineConfig.daysPerWeek || 4));
  const totalWeeks = Math.max(1, Math.round(routineConfig.totalWeeks || 8));
  const minStartDateKey = routineConfig.startDate
    ? normalizeToCalendarDateYYYYMMDD(routineConfig.startDate)
    : null;

  // Set para deduplicar múltiples sesiones ocurridas en una misma fecha 'YYYY-MM-DD'
  const uniqueDatesSet = new Set<string>();

  if (Array.isArray(workoutHistory)) {
    for (const session of workoutHistory) {
      if (!session || !session.date) continue;

      // Verificar que la sesión sea válida (no descartada vacía)
      const hasCompletedWork =
        session.isFinished !== false ||
        (typeof session.completedSetsCount === 'number' && session.completedSetsCount > 0) ||
        (Array.isArray(session.exercisesSummary) && session.exercisesSummary.length > 0);

      if (!hasCompletedWork) continue;

      const dateKey = normalizeToCalendarDateYYYYMMDD(session.date);
      if (!dateKey) continue;

      if (minStartDateKey && dateKey < minStartDateKey) continue;

      uniqueDatesSet.add(dateKey);
    }
  }

  const uniqueTrainedDates = Array.from(uniqueDatesSet).sort();
  const uniqueDaysCount = uniqueTrainedDates.length;

  // Fórmula oficial: Semana = Math.floor(dias_unicos / N) + 1
  const completedFullWeeks = Math.floor(uniqueDaysCount / daysPerWeek);
  const currentExecutedWeek = completedFullWeeks + 1;

  // Días acumulados dentro de la semana actual en curso (0 a N - 1)
  const daysInCurrentWeek = uniqueDaysCount % daysPerWeek;
  const daysRemainingForNextWeek = daysPerWeek - daysInCurrentWeek;

  // Porcentaje de progreso dentro de la semana actual
  const currentWeekProgressPct = Math.round((daysInCurrentWeek / daysPerWeek) * 100);

  // Porcentaje de progreso total del mesociclo (basado en días únicos sobre totalWeeks * N)
  const totalTargetDays = totalWeeks * daysPerWeek;
  const totalProgramProgressPct = Math.min(
    100,
    Math.round((uniqueDaysCount / totalTargetDays) * 100)
  );

  return {
    currentExecutedWeek,
    totalWeeks,
    uniqueDaysCount,
    daysPerWeek,
    daysInCurrentWeek,
    daysRemainingForNextWeek,
    completedFullWeeks,
    currentWeekProgressPct,
    totalProgramProgressPct,
    uniqueTrainedDates,
  };
}

