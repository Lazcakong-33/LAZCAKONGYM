/** Instance-local conservative request budget; provider/account quotas must still be enforced externally. */
export function createCoachBudget(options: { perMinute: number; perUserDay: number; totalDay: number; concurrent: number; now?: () => number }) {
  const now = options.now || Date.now;
  let day = -1, total = 0, running = 0, pausedUntil = 0;
  const users = new Map<string, { minute: number; minuteCount: number; dayCount: number }>();
  function acquire(uid: string): { allowed: true; release: () => void } | { allowed: false; retryAfterSec: number } {
    const time = now(), currentDay = Math.floor(time / 86_400_000), minute = Math.floor(time / 60_000);
    if (currentDay !== day) { day = currentDay; total = 0; users.clear(); }
    if (time < pausedUntil) return { allowed: false, retryAfterSec: Math.ceil((pausedUntil-time)/1000) };
    if (running >= options.concurrent) return { allowed: false, retryAfterSec: 10 };
    const row = users.get(uid) || { minute, minuteCount: 0, dayCount: 0 };
    if (row.minute !== minute) { row.minute = minute; row.minuteCount = 0; }
    if (total >= options.totalDay || row.dayCount >= options.perUserDay) return { allowed: false, retryAfterSec: Math.ceil(((day+1)*86_400_000-time)/1000) };
    if (row.minuteCount >= options.perMinute) return { allowed: false, retryAfterSec: Math.ceil(((minute+1)*60_000-time)/1000) };
    row.minuteCount++; row.dayCount++; total++; running++; users.set(uid,row);
    let released = false;
    return { allowed: true, release: () => { if (!released) { released = true; running--; } } };
  }
  return { acquire, pause: (seconds = 60) => { pausedUntil = Math.max(pausedUntil, now() + seconds*1000); } };
}
const limit = (value: string | undefined, fallback: number, ceiling: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, ceiling) : fallback;
};
export const coachBudget = createCoachBudget({
  perMinute: limit(process.env.COACH_REQUESTS_PER_MINUTE, 5, 20),
  perUserDay: limit(process.env.COACH_REQUESTS_PER_USER_DAY, 30, 200),
  totalDay: limit(process.env.COACH_REQUESTS_TOTAL_DAY, 100, 1000),
  concurrent: limit(process.env.COACH_CONCURRENT_REQUESTS, 3, 5),
});
