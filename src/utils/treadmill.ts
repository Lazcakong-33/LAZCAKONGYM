export function isTreadmill(name: string): boolean {
  return /\b(?:caminadoras?|trotadoras?|treadmill|cinta de (?:correr|caminar)|(?:caminata|caminar|carrera|trote|correr) en (?:la )?cinta)\b/i.test(name);
}

export function treadmillGoal(minutes?: number, prescription = ''): string {
  if (minutes && Number.isFinite(minutes) && minutes > 0) return minutes + ' min';
  if (/^\s*\d+(?:[.,]\d+)?(?:\s*(?:-|–|a)\s*\d+(?:[.,]\d+)?)?\s*(?:min(?:utos?)?|seg(?:undos?)?|s)\s*$/i.test(prescription)) {
    return prescription.trim();
  }
  return 'Por tiempo';
}

export function validMinutes(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function formatLoggedMinutes(sets?: { durationMinutes?: number }[]): string {
  const durations = sets?.map(set => set.durationMinutes).filter(validMinutes);
  return durations?.length ? durations.join(' + ') + ' min' : 'Sin duración registrada';
}
