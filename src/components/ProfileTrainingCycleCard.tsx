import React, { useState } from 'react';
import { IntelligentTrainingCycleCard } from './IntelligentTrainingCycleCard';
import type { ActiveRoutineConfig, WorkoutLogEntryMinimal } from '../utils/weeklyCycleManager';

interface Props {
  activeProfileId: string;
  history: WorkoutLogEntryMinimal[];
}

export function ProfileTrainingCycleCard({ activeProfileId, history }: Props) {
  // This component is keyed by profile ID. Never read or write a shared athlete key.
  const cycleStorageKey = activeProfileId
    ? `lazcakon_perfil_${activeProfileId}_active_routine_config`
    : null;
  const [routineConfig, setRoutineConfig] = useState<ActiveRoutineConfig>(() => {
    const defaults: ActiveRoutineConfig = {
      routineProgramName: 'Bloque Activo de Entrenamiento LAZCAKONG',
      daysPerWeek: 4,
      totalWeeks: 8,
    };
    if (typeof window !== 'undefined' && cycleStorageKey) {
      try {
        const raw = localStorage.getItem(cycleStorageKey);
        if (!raw) return defaults;
        const stored = JSON.parse(raw);
        if (!stored || typeof stored !== 'object') return defaults;
        return {
          routineProgramName: typeof stored.routineProgramName === 'string' ? stored.routineProgramName : defaults.routineProgramName,
          daysPerWeek: Number.isInteger(stored.daysPerWeek) && stored.daysPerWeek >= 1 && stored.daysPerWeek <= 7 ? stored.daysPerWeek : defaults.daysPerWeek,
          totalWeeks: stored.totalWeeks === 'indefinite' || [4, 6, 8, 10, 12].includes(stored.totalWeeks) ? stored.totalWeeks : defaults.totalWeeks,
          startDate: typeof stored.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(stored.startDate) ? stored.startDate : undefined,
        };
      } catch { /* unavailable local storage or invalid data */ }
    }
    return defaults;
  });

  const handleUpdateRoutineConfig = (nextConfig: ActiveRoutineConfig) => {
    setRoutineConfig(nextConfig);
    if (typeof window !== 'undefined' && cycleStorageKey) {
      try { localStorage.setItem(cycleStorageKey, JSON.stringify(nextConfig)); }
      catch { /* keep the in-memory configuration; do not touch other athlete data */ }
    }
  };

  return <IntelligentTrainingCycleCard history={history} routineConfig={routineConfig} onUpdateRoutineConfig={handleUpdateRoutineConfig} />;
}
