import { CompletedWorkout, BodyWeightEntry, PersonalRecord } from '../types';

export function generateSeedHistory(): {
  history: CompletedWorkout[];
  bodyWeightLogs: BodyWeightEntry[];
  prs: Record<string, PersonalRecord>;
} {
  const now = new Date();

  // Create dates for the past 6 weeks
  const createDate = (daysAgo: number) => {
    const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    return d.toISOString();
  };

  const history: CompletedWorkout[] = [
    // Week 1 (42 days ago)
    {
      id: 'seed-w1-d1',
      routineId: 'lunes-leg-day',
      routineTitle: 'Piernas, Glúteos & Core',
      date: createDate(42),
      startTime: Date.now() - 42 * 86400000,
      endTime: Date.now() - 42 * 86400000 + 3600000,
      durationSeconds: 3600,
      totalVolumeKg: 8400,
      completedSetsCount: 18,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'lun-prensa-45', name: 'Prensa 45°', sets: 4, maxWeight: 180, maxReps: 12, volumeKg: 3840, muscleGroup: 'Pierna', estimated1RM: 252 },
        { exerciseId: 'lun-rdl-mancuernas', name: 'Peso muerto rumano con mancuernas', sets: 3, maxWeight: 26, maxReps: 10, volumeKg: 1560, muscleGroup: 'Pierna', estimated1RM: 35 },
        { exerciseId: 'lun-ext-cuadriceps', name: 'Extensión de cuádriceps', sets: 3, maxWeight: 50, maxReps: 12, volumeKg: 1800, muscleGroup: 'Pierna', estimated1RM: 70 },
        { exerciseId: 'lun-curl-femoral', name: 'Curl femoral', sets: 3, maxWeight: 45, maxReps: 12, volumeKg: 1200, muscleGroup: 'Pierna', estimated1RM: 63 },
      ],
    },
    {
      id: 'seed-w1-d2',
      routineId: 'martes-upper-body',
      routineTitle: 'Torso: Empuje & Tirón',
      date: createDate(41),
      startTime: Date.now() - 41 * 86400000,
      endTime: Date.now() - 41 * 86400000 + 3400000,
      durationSeconds: 3400,
      totalVolumeKg: 7200,
      completedSetsCount: 18,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'mar-press-pecho', name: 'Press de pecho en máquina', sets: 4, maxWeight: 65, maxReps: 10, volumeKg: 2600, muscleGroup: 'Pecho', estimated1RM: 87 },
        { exerciseId: 'mar-remo-sentado', name: 'Remo sentado', sets: 4, maxWeight: 60, maxReps: 10, volumeKg: 2400, muscleGroup: 'Espalda', estimated1RM: 80 },
        { exerciseId: 'mar-jalon-pecho', name: 'Jalón al pecho', sets: 3, maxWeight: 55, maxReps: 10, volumeKg: 1650, muscleGroup: 'Espalda', estimated1RM: 73 },
        { exerciseId: 'mar-press-hombros-maq', name: 'Press de hombros en máquina', sets: 3, maxWeight: 40, maxReps: 10, volumeKg: 1200, muscleGroup: 'Hombro', estimated1RM: 53 },
      ],
    },

    // Week 2 (28 days ago)
    {
      id: 'seed-w2-d1',
      routineId: 'lunes-leg-day',
      routineTitle: 'Piernas, Glúteos & Core',
      date: createDate(28),
      startTime: Date.now() - 28 * 86400000,
      endTime: Date.now() - 28 * 86400000 + 3800000,
      durationSeconds: 3800,
      totalVolumeKg: 9450,
      completedSetsCount: 19,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'lun-prensa-45', name: 'Prensa 45°', sets: 4, maxWeight: 200, maxReps: 10, volumeKg: 4400, muscleGroup: 'Pierna', estimated1RM: 267 },
        { exerciseId: 'lun-rdl-mancuernas', name: 'Peso muerto rumano con mancuernas', sets: 3, maxWeight: 28, maxReps: 10, volumeKg: 1680, muscleGroup: 'Pierna', estimated1RM: 37 },
        { exerciseId: 'lun-ext-cuadriceps', name: 'Extensión de cuádriceps', sets: 3, maxWeight: 55, maxReps: 12, volumeKg: 1980, muscleGroup: 'Pierna', estimated1RM: 77 },
        { exerciseId: 'lun-curl-femoral', name: 'Curl femoral', sets: 3, maxWeight: 50, maxReps: 12, volumeKg: 1390, muscleGroup: 'Pierna', estimated1RM: 70 },
      ],
    },
    {
      id: 'seed-w2-d2',
      routineId: 'martes-upper-body',
      routineTitle: 'Torso: Empuje & Tirón',
      date: createDate(27),
      startTime: Date.now() - 27 * 86400000,
      endTime: Date.now() - 27 * 86400000 + 3600000,
      durationSeconds: 3600,
      totalVolumeKg: 8100,
      completedSetsCount: 18,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'mar-press-pecho', name: 'Press de pecho en máquina', sets: 4, maxWeight: 70, maxReps: 10, volumeKg: 2800, muscleGroup: 'Pecho', estimated1RM: 93 },
        { exerciseId: 'mar-remo-sentado', name: 'Remo sentado', sets: 4, maxWeight: 65, maxReps: 10, volumeKg: 2600, muscleGroup: 'Espalda', estimated1RM: 87 },
        { exerciseId: 'mar-jalon-pecho', name: 'Jalón al pecho', sets: 3, maxWeight: 60, maxReps: 10, volumeKg: 1800, muscleGroup: 'Espalda', estimated1RM: 80 },
        { exerciseId: 'mar-press-hombros-maq', name: 'Press de hombros en máquina', sets: 3, maxWeight: 45, maxReps: 10, volumeKg: 1350, muscleGroup: 'Hombro', estimated1RM: 60 },
      ],
    },

    // Week 3 (14 days ago)
    {
      id: 'seed-w3-d1',
      routineId: 'lunes-leg-day',
      routineTitle: 'Piernas, Glúteos & Core',
      date: createDate(14),
      startTime: Date.now() - 14 * 86400000,
      endTime: Date.now() - 14 * 86400000 + 3900000,
      durationSeconds: 3900,
      totalVolumeKg: 10800,
      completedSetsCount: 20,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'lun-prensa-45', name: 'Prensa 45°', sets: 4, maxWeight: 220, maxReps: 10, volumeKg: 5200, muscleGroup: 'Pierna', estimated1RM: 293 },
        { exerciseId: 'lun-rdl-mancuernas', name: 'Peso muerto rumano con mancuernas', sets: 3, maxWeight: 32, maxReps: 10, volumeKg: 1920, muscleGroup: 'Pierna', estimated1RM: 43 },
        { exerciseId: 'lun-ext-cuadriceps', name: 'Extensión de cuádriceps', sets: 4, maxWeight: 60, maxReps: 12, volumeKg: 2160, muscleGroup: 'Pierna', estimated1RM: 84 },
        { exerciseId: 'lun-curl-femoral', name: 'Curl femoral', sets: 3, maxWeight: 55, maxReps: 12, volumeKg: 1520, muscleGroup: 'Pierna', estimated1RM: 77 },
      ],
    },
    {
      id: 'seed-w3-d2',
      routineId: 'martes-upper-body',
      routineTitle: 'Torso: Empuje & Tirón',
      date: createDate(13),
      startTime: Date.now() - 13 * 86400000,
      endTime: Date.now() - 13 * 86400000 + 3500000,
      durationSeconds: 3500,
      totalVolumeKg: 9100,
      completedSetsCount: 19,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'mar-press-pecho', name: 'Press de pecho en máquina', sets: 4, maxWeight: 75, maxReps: 10, volumeKg: 3000, muscleGroup: 'Pecho', estimated1RM: 100 },
        { exerciseId: 'mar-remo-sentado', name: 'Remo sentado', sets: 4, maxWeight: 70, maxReps: 10, volumeKg: 2800, muscleGroup: 'Espalda', estimated1RM: 93 },
        { exerciseId: 'mar-jalon-pecho', name: 'Jalón al pecho', sets: 3, maxWeight: 65, maxReps: 10, volumeKg: 1950, muscleGroup: 'Espalda', estimated1RM: 87 },
        { exerciseId: 'mar-press-hombros-maq', name: 'Press de hombros en máquina', sets: 3, maxWeight: 50, maxReps: 10, volumeKg: 1500, muscleGroup: 'Hombro', estimated1RM: 67 },
      ],
    },

    // Week 4 (Latest, 3 days ago)
    {
      id: 'seed-w4-d1',
      routineId: 'lunes-leg-day',
      routineTitle: 'Piernas, Glúteos & Core',
      date: createDate(3),
      startTime: Date.now() - 3 * 86400000,
      endTime: Date.now() - 3 * 86400000 + 4100000,
      durationSeconds: 4100,
      totalVolumeKg: 12100,
      completedSetsCount: 21,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'lun-prensa-45', name: 'Prensa 45°', sets: 4, maxWeight: 240, maxReps: 10, volumeKg: 5800, muscleGroup: 'Pierna', estimated1RM: 320 },
        { exerciseId: 'lun-rdl-mancuernas', name: 'Peso muerto rumano con mancuernas', sets: 4, maxWeight: 34, maxReps: 10, volumeKg: 2040, muscleGroup: 'Pierna', estimated1RM: 45 },
        { exerciseId: 'lun-ext-cuadriceps', name: 'Extensión de cuádriceps', sets: 4, maxWeight: 65, maxReps: 12, volumeKg: 2340, muscleGroup: 'Pierna', estimated1RM: 91 },
        { exerciseId: 'lun-curl-femoral', name: 'Curl femoral', sets: 3, maxWeight: 60, maxReps: 12, volumeKg: 1920, muscleGroup: 'Pierna', estimated1RM: 84 },
      ],
    },
    {
      id: 'seed-w4-d2',
      routineId: 'martes-upper-body',
      routineTitle: 'Torso: Empuje & Tirón',
      date: createDate(2),
      startTime: Date.now() - 2 * 86400000,
      endTime: Date.now() - 2 * 86400000 + 3700000,
      durationSeconds: 3700,
      totalVolumeKg: 10200,
      completedSetsCount: 20,
      isFinished: true,
      exercisesSummary: [
        { exerciseId: 'mar-press-pecho', name: 'Press de pecho en máquina', sets: 4, maxWeight: 80, maxReps: 10, volumeKg: 3200, muscleGroup: 'Pecho', estimated1RM: 107 },
        { exerciseId: 'mar-remo-sentado', name: 'Remo sentado', sets: 4, maxWeight: 75, maxReps: 10, volumeKg: 3000, muscleGroup: 'Espalda', estimated1RM: 100 },
        { exerciseId: 'mar-jalon-pecho', name: 'Jalón al pecho', sets: 4, maxWeight: 70, maxReps: 10, volumeKg: 2100, muscleGroup: 'Espalda', estimated1RM: 93 },
        { exerciseId: 'mar-press-hombros-maq', name: 'Press de hombros en máquina', sets: 3, maxWeight: 55, maxReps: 10, volumeKg: 1650, muscleGroup: 'Hombro', estimated1RM: 73 },
      ],
    },
  ];

  // Bodyweight progression
  const bodyWeightLogs: BodyWeightEntry[] = [
    { id: 'bw-1', date: createDate(42), weightKg: 82.5, bodyFatPct: 18.2, note: 'Inicio mesociclo fuerza' },
    { id: 'bw-2', date: createDate(35), weightKg: 82.1, bodyFatPct: 17.8 },
    { id: 'bw-3', date: createDate(28), weightKg: 81.8, bodyFatPct: 17.4, note: 'Buena recuperación y descanso' },
    { id: 'bw-4', date: createDate(21), weightKg: 81.5, bodyFatPct: 17.1 },
    { id: 'bw-5', date: createDate(14), weightKg: 81.2, bodyFatPct: 16.7, note: 'Mayor definición muscular' },
    { id: 'bw-6', date: createDate(7), weightKg: 81.0, bodyFatPct: 16.4 },
    { id: 'bw-7', date: createDate(1), weightKg: 80.8, bodyFatPct: 16.2, note: 'Forma óptima pre-competición' },
  ];

  const prs: Record<string, PersonalRecord> = {
    'lun-prensa-45': {
      exerciseId: 'lun-prensa-45',
      exerciseName: 'Prensa 45°',
      maxWeight: 240,
      repsAtMaxWeight: 10,
      estimated1RM: 320,
      date: createDate(3),
    },
    'mar-press-pecho': {
      exerciseId: 'mar-press-pecho',
      exerciseName: 'Press de pecho en máquina',
      maxWeight: 80,
      repsAtMaxWeight: 10,
      estimated1RM: 107,
      date: createDate(2),
    },
    'mar-remo-sentado': {
      exerciseId: 'mar-remo-sentado',
      exerciseName: 'Remo sentado',
      maxWeight: 75,
      repsAtMaxWeight: 10,
      estimated1RM: 100,
      date: createDate(2),
    },
    'lun-ext-cuadriceps': {
      exerciseId: 'lun-ext-cuadriceps',
      exerciseName: 'Extensión de cuádriceps',
      maxWeight: 65,
      repsAtMaxWeight: 12,
      estimated1RM: 91,
      date: createDate(3),
    },
  };

  return { history, bodyWeightLogs, prs };
}
