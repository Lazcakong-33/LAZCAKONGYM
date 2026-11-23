/**
 * LAZCAKONG GYM 7.0 — Universal Rest Duration Formatter
 * Formats rest duration in seconds into clear, professional Spanish strings.
 */
export function formatRestDuration(seconds: number | undefined | null): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '0 s';
  if (s < 60) {
    return `${Math.round(s)} s`;
  }
  if (s % 60 === 0) {
    const mins = Math.round(s / 60);
    return `${mins} min`;
  }
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins} min ${rem} s`;
}

/**
 * Formato obligatorio simultáneo M:SS min y segundos totales entre paréntesis:
 * - 0:30 min (30 s)
 * - 1:00 min (60 s)
 * - 1:30 min (90 s)
 * - 2:00 min (120 s)
 * - 2:30 min (150 s)
 * - 3:00 min (180 s)
 * - 5:00 min (300 s)
 */
export function formatDetailedRest(seconds: number | undefined | null): string {
  const s = Number(seconds);
  const validSec = Number.isFinite(s) && s > 0 ? Math.round(s) : 90;
  const mins = Math.floor(validSec / 60);
  const secs = validSec % 60;
  if (mins > 0 && secs > 0) {
    return `${mins} min ${secs} s (${validSec} s)`;
  }
  const mmSs = `${mins}:${String(secs).padStart(2, '0')}`;
  return `${mmSs} min (${validSec} s)`;
}

/**
 * Formato estándar MM:SS con padding (ej. 01:00, 01:30, 02:00, 02:30).
 */
export function formatRestMmSs(seconds: number | undefined | null): string {
  const s = Number(seconds);
  const safe = Number.isFinite(s) && s > 0 ? Math.round(s) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Presentación simultánea obligatoria MM:SS + total en segundos (ej. "02:30 (150 s)").
 */
export function formatSimultaneousRestMmSsSeconds(seconds: number | undefined | null): string {
  const s = Number(seconds);
  const safe = Number.isFinite(s) && s > 0 ? Math.round(s) : 0;
  return `${formatRestMmSs(safe)} (${safe} s)`;
}

