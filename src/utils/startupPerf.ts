export interface StartupTimingSnapshot {
  bootStartedAtMs: number;
  firebaseAuthRestoreMs: number | null;
  tokenClaimsResolvedMs: number | null;
  tokenClaimsTimedOut: boolean;
  athleteProfileLocalReadyMs: number | null;
  sessionCheckingClearedMs: number | null;
  serverSessionInitMs: number | null;
  serverSessionInitStatus: number | null;
  firstFirestoreSyncMs: number | null;
  usedInstantLocalResume: boolean;
  activeSessionRestored: boolean;
}

const nowMs = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();

const bootOrigin = nowMs();

const state: StartupTimingSnapshot = {
  bootStartedAtMs: Date.now(),
  firebaseAuthRestoreMs: null,
  tokenClaimsResolvedMs: null,
  tokenClaimsTimedOut: false,
  athleteProfileLocalReadyMs: null,
  sessionCheckingClearedMs: null,
  serverSessionInitMs: null,
  serverSessionInitStatus: null,
  firstFirestoreSyncMs: null,
  usedInstantLocalResume: false,
  activeSessionRestored: false,
};

function publishToWindow() {
  try {
    if (typeof window !== 'undefined') {
      (window as any).__lazcakongStartupTimings = { ...state };
    }
  } catch {}
}

export function markStartupTiming(
  key: keyof Omit<
    StartupTimingSnapshot,
    'bootStartedAtMs' | 'tokenClaimsTimedOut' | 'usedInstantLocalResume' | 'activeSessionRestored' | 'serverSessionInitStatus'
  >,
  valueMs?: number
): number {
  const elapsed = typeof valueMs === 'number' ? Math.round(valueMs) : Math.round(nowMs() - bootOrigin);
  if (state[key] === null) {
    state[key] = elapsed;
    publishToWindow();
  }
  return elapsed;
}

export function setStartupFlag<
  K extends 'tokenClaimsTimedOut' | 'usedInstantLocalResume' | 'activeSessionRestored' | 'serverSessionInitStatus'
>(key: K, value: StartupTimingSnapshot[K]): void {
  state[key] = value;
  publishToWindow();
}

export function getStartupTimings(): StartupTimingSnapshot {
  return { ...state };
}

publishToWindow();
