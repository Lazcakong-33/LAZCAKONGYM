import {
  BiometricMuscleId,
  CANONICAL_MUSCLE_INFO,
  CanonicalMuscleId,
  MuscleRecoveryState,
  OverallAthleteMuscularSummary,
} from './muscleRecoveryEngine';

export type InteractiveMuscleId =
  // VISTA FRONTAL
  | 'pectoral_superior_left'
  | 'pectoral_superior_right'
  | 'pectoral_medio_left'
  | 'pectoral_medio_right'
  | 'pectoral_inferior_left'
  | 'pectoral_inferior_right'
  | 'deltoides_anterior_left'
  | 'deltoides_anterior_right'
  | 'biceps_left'
  | 'biceps_right'
  | 'antebrazo_left'
  | 'antebrazo_right'
  | 'recto_abdominal'
  | 'oblicuos_left'
  | 'oblicuos_right'
  | 'cuadriceps_recto_left'
  | 'cuadriceps_recto_right'
  | 'cuadriceps_vasto_ext_left'
  | 'cuadriceps_vasto_ext_right'
  | 'cuadriceps_vasto_int_left'
  | 'cuadriceps_vasto_int_right'
  | 'aductores_left'
  | 'aductores_right'
  | 'tibial_anterior_left'
  | 'tibial_anterior_right'
  // VISTA POSTERIOR
  | 'trapecio_superior'
  | 'trapecio_medio_inferior'
  | 'deltoides_posterior_left'
  | 'deltoides_posterior_right'
  | 'romboides_left'
  | 'romboides_right'
  | 'dorsal_ancho_left'
  | 'dorsal_ancho_right'
  | 'erectores_espinales'
  | 'triceps_cabeza_larga_left'
  | 'triceps_cabeza_larga_right'
  | 'triceps_cabeza_lateral_left'
  | 'triceps_cabeza_lateral_right'
  | 'gluteo_mayor_left'
  | 'gluteo_mayor_right'
  | 'gluteo_medio_left'
  | 'gluteo_medio_right'
  | 'isquiotibiales_biceps_femoral_left'
  | 'isquiotibiales_biceps_femoral_right'
  | 'isquiotibiales_semitendinoso_left'
  | 'isquiotibiales_semitendinoso_right'
  | 'gastrocnemio_lateral_left'
  | 'gastrocnemio_lateral_right'
  | 'gastrocnemio_medial_left'
  | 'gastrocnemio_medial_right'
  | 'soleo_left'
  | 'soleo_right';

export type FatigueLevelLabel = 'Alta' | 'Moderada' | 'En progreso' | 'Suficiente';

export interface CanonicalRecoveringMuscleItem {
  canonicalId: CanonicalMuscleId;
  name: string;
  fatigue: number;
  remainingHours: number;
  remainingMinutes: number;
  totalRemainingHours: number;
  fatigueLevelLabel: FatigueLevelLabel;
  statusColor: string;
  representativeBiometricId: BiometricMuscleId;
  interactiveId: InteractiveMuscleId;
  view: 'frontal' | 'posterior';
}

export interface MuscleFatigueBadgeMeta {
  metricTitle: 'Estado' | 'Fatiga estimada';
  label: string;
  color: string;
  bg: string;
  textColor: string;
}

export function resolveInteractiveTargetForCanonical(
  canonicalId: CanonicalMuscleId,
  representativeBiometricId?: BiometricMuscleId
): { interactiveId: InteractiveMuscleId; view: 'frontal' | 'posterior' } {
  switch (canonicalId) {
    case 'pectoral_major':
      return { interactiveId: 'pectoral_medio_left', view: 'frontal' };
    case 'latissimus_dorsi':
      return { interactiveId: 'dorsal_ancho_left', view: 'posterior' };
    case 'quadriceps':
      return { interactiveId: 'cuadriceps_recto_left', view: 'frontal' };
    case 'hamstrings':
      return { interactiveId: 'isquiotibiales_biceps_femoral_left', view: 'posterior' };
    case 'glutes':
      return { interactiveId: 'gluteo_mayor_left', view: 'posterior' };
    case 'deltoids':
      return { interactiveId: 'deltoides_anterior_left', view: 'frontal' };
    case 'biceps':
      return { interactiveId: 'biceps_left', view: 'frontal' };
    case 'triceps':
      if (
        representativeBiometricId === 'triceps_lateral_left' ||
        representativeBiometricId === 'triceps_lateral_right'
      ) {
        return { interactiveId: 'triceps_cabeza_lateral_left', view: 'posterior' };
      }
      return { interactiveId: 'triceps_cabeza_larga_left', view: 'posterior' };
    case 'calves':
      if (
        representativeBiometricId === 'calves_front_left' ||
        representativeBiometricId === 'calves_front_right'
      ) {
        return { interactiveId: 'tibial_anterior_left', view: 'frontal' };
      }
      return { interactiveId: 'gastrocnemio_lateral_left', view: 'posterior' };
    case 'abs':
      return { interactiveId: 'recto_abdominal', view: 'frontal' };
  }
}

export function formatRecoveryRemainingTime(hours: number, minutes: number): string {
  if (hours <= 0 && minutes <= 0) return '0 h';
  if (minutes > 0 && hours < 10) return `${hours}h ${minutes}m`;
  return `${hours} h`;
}

export function getMuscleFatigueBadgeMeta(
  state: MuscleRecoveryState | undefined,
  hasSelectedMuscleData: boolean
): MuscleFatigueBadgeMeta {
  if (!state || !hasSelectedMuscleData || state.status === 'Sin datos suficientes') {
    return {
      metricTitle: 'Fatiga estimada',
      label: 'Sin datos',
      color: '#A1A1AA',
      bg: '#262626',
      textColor: '#F5F5F5',
    };
  }
  if (state.remainingHours === 0 && state.remainingMinutes === 0) {
    return {
      metricTitle: 'Estado',
      label: 'Recuperado',
      color: '#CCFF00',
      bg: '#CCFF00',
      textColor: '#090909',
    };
  }
  if (state.status === 'Fatiga alta' || state.statusColor === '#EF4444') {
    return {
      metricTitle: 'Fatiga estimada',
      label: 'Alta',
      color: '#EF4444',
      bg: '#EF4444',
      textColor: '#090909',
    };
  }
  if (state.status === 'Fatiga moderada' || state.statusColor === '#F97316') {
    return {
      metricTitle: 'Fatiga estimada',
      label: 'Moderada',
      color: '#F97316',
      bg: '#F59E0B',
      textColor: '#090909',
    };
  }
  if (state.status === 'Recuperación en progreso' || state.statusColor === '#FACC15') {
    return {
      metricTitle: 'Fatiga estimada',
      label: 'En progreso',
      color: '#FACC15',
      bg: '#FACC15',
      textColor: '#090909',
    };
  }
  return {
    metricTitle: 'Fatiga estimada',
    label: 'Suficiente',
    color: '#CCFF00',
    bg: '#CCFF00',
    textColor: '#090909',
  };
}

function getRecoveryListFatigueLabel(state: MuscleRecoveryState): FatigueLevelLabel {
  if (state.status === 'Fatiga alta' || state.statusColor === '#EF4444') return 'Alta';
  if (state.status === 'Fatiga moderada' || state.statusColor === '#F97316') return 'Moderada';
  if (state.status === 'Recuperación en progreso' || state.statusColor === '#FACC15') {
    return 'En progreso';
  }
  return 'Suficiente';
}


export function getRecoveringMusclesSorted(
  source:
    | Record<BiometricMuscleId, MuscleRecoveryState>
    | OverallAthleteMuscularSummary
): CanonicalRecoveringMuscleItem[] {
  // 1. Si se pasa directamente el resumen general del atleta (fuente del gráfico de Estado muscular)
  if (source && 'readyMuscles' in source && Array.isArray(source.readyMuscles)) {
    const allCanonical = source.readyMuscles
      .concat(source.inRecoveryMuscles || [])
      .concat(source.highFatigueMuscles || []);

    const trainedList = allCanonical.filter((m) => m && m.statusColor !== '#71717A');
    const inRecovery = trainedList.filter(
      (m) => m.remainingHours > 0 || m.remainingMinutes > 0
    );

    const list: CanonicalRecoveringMuscleItem[] = inRecovery.map((m) => {
      const target = resolveInteractiveTargetForCanonical(m.canonicalId);
      const fatigueLevelLabel: FatigueLevelLabel =
        m.statusColor === '#EF4444'
          ? 'Alta'
          : m.statusColor === '#F97316'
          ? 'Moderada'
          : m.statusColor === '#FACC15'
          ? 'En progreso'
          : 'Suficiente';

      return {
        canonicalId: m.canonicalId,
        name: m.name,
        fatigue: m.fatigue,
        remainingHours: m.remainingHours,
        remainingMinutes: m.remainingMinutes,
        totalRemainingHours: m.remainingHours + m.remainingMinutes / 60,
        fatigueLevelLabel,
        statusColor: m.statusColor,
        representativeBiometricId: target.interactiveId as unknown as BiometricMuscleId,
        interactiveId: target.interactiveId,
        view: target.view,
      };
    });

    list.sort((a, b) => {
      if (b.totalRemainingHours !== a.totalRemainingHours) {
        return b.totalRemainingHours - a.totalRemainingHours;
      }
      return b.fatigue - a.fatigue;
    });

    return list;
  }

  // 2. Si se pasa el reporte biométrico completo
  const byCanonical = new Map<CanonicalMuscleId, MuscleRecoveryState>();

  (Object.values(source as Record<BiometricMuscleId, MuscleRecoveryState>) as MuscleRecoveryState[]).forEach((state) => {
    if (!state || !state.hasHistoricalData) return;
    const totalRemaining = state.remainingHours + state.remainingMinutes / 60;
    if (totalRemaining <= 0) return;

    const existing = byCanonical.get(state.canonicalId);
    if (!existing) {
      byCanonical.set(state.canonicalId, state);
      return;
    }

    const existingRemaining = existing.remainingHours + existing.remainingMinutes / 60;
    if (
      totalRemaining > existingRemaining ||
      (totalRemaining === existingRemaining && state.fatigue > existing.fatigue)
    ) {
      byCanonical.set(state.canonicalId, state);
    }
  });

  const list: CanonicalRecoveringMuscleItem[] = Array.from(byCanonical.entries()).map(
    ([canonicalId, state]) => {
      const target = resolveInteractiveTargetForCanonical(canonicalId, state.id);
      return {
        canonicalId,
        name:
          CANONICAL_MUSCLE_INFO[canonicalId]?.name ||
          state.name.replace(/ Izquierdo| Derecho| Izq\.| Der\./g, ''),
        fatigue: state.fatigue,
        remainingHours: state.remainingHours,
        remainingMinutes: state.remainingMinutes,
        totalRemainingHours: state.remainingHours + state.remainingMinutes / 60,
        fatigueLevelLabel: getRecoveryListFatigueLabel(state),
        statusColor: state.statusColor,
        representativeBiometricId: state.id,
        interactiveId: target.interactiveId,
        view: target.view,
      };
    }
  );

  list.sort((a, b) => {
    if (b.totalRemainingHours !== a.totalRemainingHours) {
      return b.totalRemainingHours - a.totalRemainingHours;
    }
    return b.fatigue - a.fatigue;
  });

  return list;
}

export function resolveMostFatiguedMuscleTarget(
  source:
    | Record<BiometricMuscleId, MuscleRecoveryState>
    | OverallAthleteMuscularSummary
): { interactiveId: InteractiveMuscleId; view: 'frontal' | 'posterior' } | null {
  const recovering = getRecoveringMusclesSorted(source);
  if (recovering.length === 0) return null;
  return {
    interactiveId: recovering[0].interactiveId,
    view: recovering[0].view,
  };
}

export function getMuscleStatusEmptyMessage(
  hasAnyWorkoutHistory: boolean,
  recoveringCount: number
): string | null {
  if (!hasAnyWorkoutHistory) {
    return 'Registra tu primer entrenamiento para ver tu recuperación';
  }
  if (recoveringCount === 0) {
    return 'Sin fatiga pendiente según tus registros';
  }
  return null;
}
