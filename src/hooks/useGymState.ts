import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Profile,
  Routine,
  ActiveWorkoutSession,
  CompletedWorkout,
  PersonalRecord,
  RestTimerState,
  BodyWeightEntry,
} from '../types';
import { DEFAULT_PROFILES } from '../data/defaultProfiles';
import { calculateWorkoutCaloriesBurned, getLocalDateKey } from '../utils/calorieCalculator';
import {
  purgeAndSanitizeWorkoutHistory,
  sanitizeRoutineTitleForDate,
  sanitizeWorkoutDurationSeconds,
} from '../utils/historySanitizer';
import { DEFAULT_ROUTINES } from '../data/defaultRoutines';
import { getEnrichedDefaultRoutines } from '../utils/enrichRoutines';
import { generateSeedHistory } from '../data/seedHistory';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile as updateFirebaseProfile,
  signInWithPopup,
  linkWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { useAuth } from '../components/AuthProvider';
import { isEffectiveFrontendAdmin } from '../utils/adminAuthCriterion';
import { safeApiFetchJson } from '../utils/safeApiFetch';
import {
  playBeep,
  playCountdownTick,
  playRestCompleteAlarm,
  vibrateDevice,
  INTENSE_REST_VIBRATION_PATTERN,
  resumeAudio,
  startSilentAudioKeepAlive,
  stopSilentAudioKeepAlive,
} from '../utils/audio';
import {
  syncUserDataToFirebase,
  saveAthleteToCloud,
  fetchAthletesFromCloud,
  subscribeAthletesFromCloud,
  deleteAthleteFromCloud,
  fetchUserDataFromFirebase,
  registerAthleteWithInvite,
  linkLegacyProfileWithServer,
  queueOfflineSync,
  processPendingOfflineSyncs,
  subscribeUserDataFromCloud,
} from '../utils/firebaseSync';
import { applyThemeToRoot } from '../utils/theme';
import {
  startBackgroundTicker,
  stopBackgroundTicker,
  enableScreenWakeLock,
  disableScreenWakeLock,
  sendRestCompleteNotification,
  sendFiveSecondWarningNotification,
  scheduleServiceWorkerRestAlarm,
  cancelServiceWorkerRestAlarm,
} from '../utils/backgroundTimer';

import { consolidateWeeklyRoutines, resolveCanonicalDay } from '../utils/csvImporter';
import {
  PreImportBackupSnapshot,
  SafeImportPayload,
  createPreImportBackupSnapshot,
  executeSafeImportPersistence,
  getLatestPreImportBackup,
  restorePreImportBackupSnapshot,
} from '../utils/safeImportPersistence';
import {
  BackupInspectionResult,
  BackupRestoreStrategy,
  createSanitizedProfileBackup,
  ensureSafeStorageMigration,
  executeSafeBackupRestore,
  inspectBackupForRestore,
} from '../utils/eliteBackupEngine';
import { extractRestSeconds } from '../utils/routineImporterHelpers';
import { MUSCLE_CONFIG, resolveExerciseMuscleImpact } from '../utils/muscleRecoveryEngine';
import {
  deduplicateRoutinesByDay,
  getSafeExerciseSets,
  isSameWeekday,
  mapToStandardMuscleCategory,
  normalizeText,
} from '../utils/workoutAnalyticsEngine';

/**
 * Función 100% pura calculateWeeklyVolume que recorre las rutinas deduplicadas
 * y calcula el volumen real de series semanales por grupo muscular sin acumuladores globales
 * ni falsos positivos por cadenas vacías o tildes.
 */
export function calculateWeeklyVolume(
  routines: Routine[],
  targetMuscle: string,
  dayFilter: string = 'ALL'
): number {
  if (!Array.isArray(routines) || routines.length === 0 || !targetMuscle) return 0;

  const cleanRoutines = deduplicateRoutinesByDay(routines);
  const targetNorm = normalizeText(targetMuscle);
  if (!targetNorm) return 0;

  const targetStandardCategory = normalizeText(mapToStandardMuscleCategory(targetMuscle));
  const normDayFilter = normalizeText(dayFilter);
  const filterBySpecificDay =
    Boolean(normDayFilter) &&
    normDayFilter !== 'all' &&
    normDayFilter !== 'todos' &&
    normDayFilter !== 'toda la semana';

  return cleanRoutines.reduce((totalVolume, routine) => {
    if (!routine || !Array.isArray(routine.exercises)) return totalVolume;
    if (filterBySpecificDay && !isSameWeekday(routine.dayName, dayFilter)) {
      return totalVolume;
    }

    const routineSets = routine.exercises.reduce((routineSum, ex) => {
      if (!ex) return routineSum;
      const rawMuscle =
        ex.targetMuscles || (ex as any).muscleGroup || (ex as any).musculo || '';
      const exCategoryNorm = normalizeText(mapToStandardMuscleCategory(rawMuscle, ex.name));
      const exMuscleNorm = normalizeText(rawMuscle);

      const isMatch =
        exCategoryNorm === targetStandardCategory ||
        (exMuscleNorm.length > 0 &&
          (exMuscleNorm.includes(targetNorm) || targetNorm.includes(exMuscleNorm)));

      if (isMatch) {
        return routineSum + getSafeExerciseSets(ex);
      }
      return routineSum;
    }, 0);

    return totalVolume + routineSets;
  }, 0);
}

export const PRELOADED_DEFAULT_ROUTINE_IDS = new Set([
  'lunes-leg-day',
  'martes-chest-tri',
  'miercoles-cardio-core',
  'jueves-back-bi',
  'viernes-full-body',
]);

export const filterOutPreloadedRoutines = (list: any[]): Routine[] => {
  if (!Array.isArray(list)) return [];
  const withoutPreloaded = list.filter((r) => r && r.id && !PRELOADED_DEFAULT_ROUTINE_IDS.has(r.id));
  return consolidateWeeklyRoutines(withoutPreloaded);
};

export function useGymState() {
  const { user: authUser, loading: authLoading, isGoogleVerifiedSession, refreshAuthSession } = useAuth();
  const sessionInitializedUidRef = useRef<string | null>(null);
  const manualAuthInProgressRef = useRef<boolean>(false);
  const pendingLegacyVerificationRef = useRef<boolean>(false);

  // Profiles (no plaintext PINs or hardcoded Admin flags)
  const [profiles, setProfiles] = useState<Profile[]>(() => {
    try {
      const stored = localStorage.getItem('lazcakon_profiles');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p: any) => {
            const copy = { ...p };
            delete copy.pin;
            return copy;
          });
        }
      }
    } catch {}
    return DEFAULT_PROFILES;
  });

  const [activeProfileId, setActiveProfileId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('lazcakon_active_profile_id');
      if (stored) return stored;
    } catch {}
    return DEFAULT_PROFILES[0]?.id || 'perfil_default';
  });

  // Never trust localStorage or local profile flags for authentication or admin role
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [serverAdminVerified, setServerAdminVerified] = useState<boolean>(false);
  const [adminRequiresGoogleSignIn, setAdminRequiresGoogleSignIn] = useState<boolean>(false);
  const [sessionAthleteId, setSessionAthleteId] = useState<string | null>(null);
  const isAdmin = isEffectiveFrontendAdmin({
    hasAuthUser: Boolean(authUser),
    isGoogleVerifiedSession,
    serverAdminVerified,
  });

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0] || DEFAULT_PROFILES[0];
  const activeProfileIdRef = useRef(activeProfileId);
  activeProfileIdRef.current = activeProfileId;
  const activeWeightRef = useRef<number>(activeProfile?.weightKg || 95);
  activeWeightRef.current = activeProfile?.weightKg || 95;
  const [loadedProfileId, setLoadedProfileId] = useState<string>(activeProfileId);
  const isFinishingWorkoutRef = useRef<boolean>(false);

  const getRestTimerStorageKey = (profileId: string) => `lazcakon_${profileId}_rest_timer`;

  // Save profiles sanitized (no PINs stored locally)
  useEffect(() => {
    try {
      const sanitized = profiles.map((p) => {
        const copy = { ...p };
        delete (copy as any).pin;
        return copy;
      });
      localStorage.setItem('lazcakon_profiles', JSON.stringify(sanitized));
    } catch {}
  }, [profiles]);

  const mergeCloudProfileIntoState = useCallback((cloudProfile: Profile, activateIfNonAdmin = false, adminClaimed = false) => {
    setProfiles((prev) => {
      const idx = prev.findIndex((p) => p.id === cloudProfile.id);
      const localMatch = idx >= 0 ? prev[idx] : undefined;
      const merged: Profile = {
        ...cloudProfile,
        themeAccent: cloudProfile.themeAccent || localMatch?.themeAccent || 'smartfit',
      };
      delete (merged as any).pin;
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = merged;
        return next;
      }
      return [...prev, merged];
    });
    if (activateIfNonAdmin || !adminClaimed) {
      setActiveProfileId(cloudProfile.id);
    }
  }, []);

  // Reconcile persisted Firebase Auth session with server /api/auth/session-init & Firestore profile
  useEffect(() => {
    if (authLoading) return;

    if (!authUser) {
      sessionInitializedUidRef.current = null;
      pendingLegacyVerificationRef.current = false;
      setServerAdminVerified(false);
      setAdminRequiresGoogleSignIn(false);
      setSessionAthleteId(null);
      setIsLoggedIn(false);
      try {
        localStorage.removeItem('lazcakon_is_logged_in');
      } catch {}
      return;
    }

    if (manualAuthInProgressRef.current || pendingLegacyVerificationRef.current) {
      return;
    }

    if (sessionInitializedUidRef.current === authUser.uid && isLoggedIn) {
      return;
    }

    let cancelled = false;
    const bootstrapAuthenticatedSession = async (currentUser: User) => {
      try {
        const idToken = await currentUser.getIdToken();
        const sessionResp = await safeApiFetchJson<Record<string, any>>('/api/auth/session-init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
        });

        const data = sessionResp.data || {};
        if (!sessionResp.ok || !sessionResp.isJson) {
          if (sessionResp.status === 409 && data?.requiresLegacyVerification) {
            pendingLegacyVerificationRef.current = true;
            return;
          }
          if (sessionResp.status === 403 || sessionResp.status === 409) {
            await signOut(auth).catch(() => {});
            if (!cancelled) {
              sessionInitializedUidRef.current = null;
              setServerAdminVerified(false);
              setAdminRequiresGoogleSignIn(false);
              setSessionAthleteId(null);
              setIsLoggedIn(false);
            }
            return;
          }
          throw new Error(
            sessionResp.error || data?.error || 'No se pudo inicializar la sesión en la nube.'
          );
        }

        const tokenState = await refreshAuthSession(currentUser);
        if (cancelled) return;

        const serverSaysAdmin = Boolean(data?.isAdmin);
        const verifiedAdmin = Boolean(serverSaysAdmin && tokenState.isGoogleVerified);
        const resolvedAthleteId = typeof data?.athleteId === 'string' ? data.athleteId : null;
        const initProfile = data?.profile ? (data.profile as Profile) : null;

        setServerAdminVerified(serverSaysAdmin);
        setAdminRequiresGoogleSignIn(Boolean(data?.adminRequiresGoogleSignIn));
        setSessionAthleteId(resolvedAthleteId);
        sessionInitializedUidRef.current = currentUser.uid;

        if (initProfile) {
          mergeCloudProfileIntoState(initProfile, !verifiedAdmin, verifiedAdmin);
        } else if (resolvedAthleteId && (!verifiedAdmin || activeProfileIdRef.current === 'perfil_default')) {
          setActiveProfileId(resolvedAthleteId);
        }

        const { profiles: cloudProfiles, deletedIds } = await fetchAthletesFromCloud({
          isAdmin: verifiedAdmin,
          athleteId: resolvedAthleteId || undefined,
        });

        if (cancelled) return;

        if (cloudProfiles.length > 0) {
          setProfiles((prev) => {
            const activeCloud = cloudProfiles
              .filter((p) => !deletedIds.has(p.id))
              .map((cloudP) => {
                const localMatch = prev.find((lp) => lp.id === cloudP.id);
                return {
                  ...cloudP,
                  themeAccent: cloudP.themeAccent || localMatch?.themeAccent || 'smartfit',
                };
              });
            return activeCloud;
          });
        }

        if (!verifiedAdmin && resolvedAthleteId) {
          setActiveProfileId(resolvedAthleteId);
        } else if (verifiedAdmin && resolvedAthleteId) {
          const validCurrent = cloudProfiles.some((p) => p.id === activeProfileIdRef.current);
          if (!validCurrent) {
            setActiveProfileId(resolvedAthleteId);
          }
        }

        setIsLoggedIn(true);
        processPendingOfflineSyncs().catch(() => {});
      } catch (err) {
        console.warn('[Auth Session Bootstrap]:', err);
      }
    };

    bootstrapAuthenticatedSession(authUser);

    return () => {
      cancelled = true;
    };
  }, [authLoading, authUser, isLoggedIn, mergeCloudProfileIntoState, refreshAuthSession]);

  // Role-scoped real-time Firestore subscription (ONLY when Firebase Auth session is active)
  useEffect(() => {
    if (authLoading || !authUser || !isLoggedIn) return;

    const scopedAthleteId = sessionAthleteId || activeProfileId;
    if (!isAdmin && !scopedAthleteId) return;

    processPendingOfflineSyncs().catch(() => {});

    const unsubscribe = subscribeAthletesFromCloud(
      (cloudProfiles, deletedIds) => {
        deletedIds.forEach((delId) => {
          try {
            localStorage.removeItem(`lazcakon_${delId}_routines`);
            localStorage.removeItem(`lazcakon_${delId}_history`);
            localStorage.removeItem(`lazcakon_${delId}_prs`);
            localStorage.removeItem(`lazcakon_${delId}_bodyweight`);
            localStorage.removeItem(`lazcakon_${delId}_alternatives`);
            localStorage.removeItem(`lazcakon_${delId}_custom_links`);
            localStorage.removeItem(`lazcakon_${delId}_active_session`);
            localStorage.removeItem(`lazcakon_${delId}_rest_timer`);
            localStorage.removeItem(`lazcakon_${delId}_pre_import_backup`);
            localStorage.removeItem(`lazcakon_${delId}_pre_import_backups`);
          } catch {}
        });

        setProfiles((prev) => {
          if (!isAdmin) {
            const own = cloudProfiles.find((p) => p.id === scopedAthleteId);
            if (!own || deletedIds.has(scopedAthleteId)) {
              return prev.filter((p) => !deletedIds.has(p.id));
            }
            const localMatch = prev.find((lp) => lp.id === own.id);
            return [
              {
                ...own,
                themeAccent: own.themeAccent || localMatch?.themeAccent || 'smartfit',
              },
            ];
          }

          const activeCloudProfiles = cloudProfiles
            .filter((p) => !deletedIds.has(p.id))
            .map((cloudP) => {
              const localMatch = prev.find((lp) => lp.id === cloudP.id);
              return {
                ...cloudP,
                themeAccent: cloudP.themeAccent || localMatch?.themeAccent || 'smartfit',
              };
            });

          if (activeCloudProfiles.length > 0) {
            return activeCloudProfiles;
          }

          return prev.filter((p) => !deletedIds.has(p.id));
        });

        if (deletedIds.has(activeProfileIdRef.current)) {
          if (!isAdmin) {
            sessionInitializedUidRef.current = null;
            setIsLoggedIn(false);
            signOut(auth).catch(() => {});
          } else {
            const remaining = cloudProfiles.filter((p) => !deletedIds.has(p.id));
            const adminFallback =
              remaining.find((p) => p.id === sessionAthleteId || p.isAdmin) ||
              remaining[0];
            if (adminFallback) {
              setActiveProfileId(adminFallback.id);
            }
          }
        }
      },
      {
        isAdmin,
        athleteId: scopedAthleteId,
      }
    );

    return () => {
      unsubscribe();
    };
  }, [authLoading, authUser, isLoggedIn, isAdmin, sessionAthleteId, activeProfileId]);

  useEffect(() => {
    localStorage.setItem('lazcakon_active_profile_id', activeProfileId);
  }, [activeProfileId]);

  useEffect(() => {
    if (isLoggedIn && authUser) {
      localStorage.setItem('lazcakon_is_logged_in', 'true');
    } else {
      localStorage.removeItem('lazcakon_is_logged_in');
    }
  }, [isLoggedIn, authUser]);

  // Routines for active profile (eliminando cualquier rutina precargada)
  const [routines, setRoutines] = useState<Routine[]>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_routines`);
      if (stored) {
        const parsed = JSON.parse(stored);
        const filtered = filterOutPreloadedRoutines(parsed);
        localStorage.setItem(`lazcakon_${activeProfileId}_routines`, JSON.stringify(filtered));
        return filtered;
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    if (loadedProfileId !== activeProfileId) return;
    localStorage.setItem(`lazcakon_${activeProfileId}_routines`, JSON.stringify(routines));
  }, [routines, activeProfileId, loadedProfileId]);

  // Limpieza global automática: purgar rutinas precargadas de todos los perfiles en este dispositivo
  useEffect(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('lazcakon_') && key.endsWith('_routines')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const cleaned = filterOutPreloadedRoutines(parsed);
              if (cleaned.length !== parsed.length) {
                localStorage.setItem(key, JSON.stringify(cleaned));
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error purgando rutinas precargadas:', e);
    }
  }, []);

  // Selected Alternative Exercises
  const [selectedAlternatives, setSelectedAlternatives] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_alternatives`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });

  useEffect(() => {
    if (loadedProfileId !== activeProfileId) return;
    localStorage.setItem(`lazcakon_${activeProfileId}_alternatives`, JSON.stringify(selectedAlternatives));
  }, [selectedAlternatives, activeProfileId, loadedProfileId]);

  // Custom Links / Video Notes
  const [customLinks, setCustomLinks] = useState<Record<string, { id: string; title: string; url: string }[]>>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_custom_links`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });

  useEffect(() => {
    if (loadedProfileId !== activeProfileId) return;
    localStorage.setItem(`lazcakon_${activeProfileId}_custom_links`, JSON.stringify(customLinks));
  }, [customLinks, activeProfileId, loadedProfileId]);

  // Workout History (con purga automática de duplicados por fecha YYYY-MM-DD y tiempos inflados)
  const [history, setHistory] = useState<CompletedWorkout[]>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_history`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const { cleanedHistory, wasModified } = purgeAndSanitizeWorkoutHistory(
            parsed,
            activeProfile?.weightKg || 95
          );
          if (wasModified) {
            localStorage.setItem(`lazcakon_${activeProfileId}_history`, JSON.stringify(cleanedHistory));
          }
          return cleanedHistory;
        }
      }
    } catch {}
    return [];
  });

  // Script de Limpieza Global (Data Purge) para todas las cuentas locales en este dispositivo
  useEffect(() => {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('lazcakon_') && key.endsWith('_history')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              const { cleanedHistory, wasModified } = purgeAndSanitizeWorkoutHistory(
                parsed,
                activeProfile?.weightKg || 95
              );
              if (wasModified) {
                localStorage.setItem(key, JSON.stringify(cleanedHistory));
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error ejecutando script de purga de historial:', e);
    }
  }, [activeProfile?.weightKg]);

  useEffect(() => {
    if (loadedProfileId !== activeProfileId) return;
    localStorage.setItem(`lazcakon_${activeProfileId}_history`, JSON.stringify(history));
  }, [history, activeProfileId, loadedProfileId]);

  // PRs (Personal Records)
  const [prs, setPrs] = useState<Record<string, PersonalRecord>>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_prs`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return {};
  });

  useEffect(() => {
    if (loadedProfileId !== activeProfileId) return;
    localStorage.setItem(`lazcakon_${activeProfileId}_prs`, JSON.stringify(prs));
  }, [prs, activeProfileId, loadedProfileId]);

  // Bodyweight & composition logs
  const [bodyWeightLogs, setBodyWeightLogs] = useState<BodyWeightEntry[]>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_bodyweight`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return [];
  });

  useEffect(() => {
    if (loadedProfileId !== activeProfileId) return;
    localStorage.setItem(`lazcakon_${activeProfileId}_bodyweight`, JSON.stringify(bodyWeightLogs));
  }, [bodyWeightLogs, activeProfileId, loadedProfileId]);

  const [preImportBackup, setPreImportBackup] = useState<PreImportBackupSnapshot | null>(() =>
    getLatestPreImportBackup(activeProfileId)
  );

  const routinesRef = useRef(routines);
  routinesRef.current = routines;
  const historyRef = useRef(history);
  historyRef.current = history;
  const prsRef = useRef(prs);
  prsRef.current = prs;
  const bodyWeightLogsRef = useRef(bodyWeightLogs);
  bodyWeightLogsRef.current = bodyWeightLogs;
  const customLinksRef = useRef(customLinks);
  customLinksRef.current = customLinks;
  const selectedAlternativesRef = useRef(selectedAlternatives);
  selectedAlternativesRef.current = selectedAlternatives;
  const activeProfileNameRef = useRef(activeProfile?.name || 'Atleta');
  activeProfileNameRef.current = activeProfile?.name || 'Atleta';

  // Active Workout Session
  const [activeSession, setActiveSession] = useState<ActiveWorkoutSession | null>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_active_session`);
      if (stored) return JSON.parse(stored);
    } catch {}
    return null;
  });

  useEffect(() => {
    if (!activeSession) {
      isFinishingWorkoutRef.current = false;
    }
    if (loadedProfileId !== activeProfileId) return;
    if (activeSession) {
      localStorage.setItem(`lazcakon_${activeProfileId}_active_session`, JSON.stringify(activeSession));
    } else {
      localStorage.removeItem(`lazcakon_${activeProfileId}_active_session`);
    }
  }, [activeSession, activeProfileId, loadedProfileId]);

  // Rest Timer State with background recovery and per-profile persistence
  const [restTimer, setRestTimer] = useState<RestTimerState>(() => {
    try {
      const scopedKey = getRestTimerStorageKey(activeProfileId);
      let stored = localStorage.getItem(scopedKey);
      if (!stored) {
        const legacyStored = localStorage.getItem('lazcakon_rest_timer');
        if (legacyStored) {
          stored = legacyStored;
          localStorage.setItem(scopedKey, legacyStored);
          localStorage.removeItem('lazcakon_rest_timer');
        }
      }
      if (stored) {
        const parsed: RestTimerState = JSON.parse(stored);
        if (parsed.active && parsed.targetEndTime) {
          const remaining = Math.max(0, Math.ceil((parsed.targetEndTime - Date.now()) / 1000));
          if (remaining > 0) {
            return { ...parsed, remainingSeconds: remaining };
          }
        } else if (parsed.active && parsed.paused && parsed.remainingSeconds > 0) {
          return parsed;
        }
      }
    } catch {}
    return {
      active: false,
      totalSeconds: 0,
      remainingSeconds: 0,
      minimized: false,
    };
  });

  const restTimerRef = useRef(restTimer);
  restTimerRef.current = restTimer;

  // Synchronize all athlete-scoped states atomically whenever active athlete profile changes
  useEffect(() => {
    const targetProfileId = activeProfileId;
    const targetWeight = activeWeightRef.current;

    try {
      const storedRoutines = localStorage.getItem(`lazcakon_${targetProfileId}_routines`);
      if (storedRoutines) {
        const filtered = filterOutPreloadedRoutines(JSON.parse(storedRoutines));
        setRoutines(filtered);
        localStorage.setItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify(filtered));
      } else {
        setRoutines([]);
      }

      const storedHist = localStorage.getItem(`lazcakon_${targetProfileId}_history`);
      if (storedHist) {
        const parsedHist = JSON.parse(storedHist);
        const { cleanedHistory, wasModified } = purgeAndSanitizeWorkoutHistory(
          Array.isArray(parsedHist) ? parsedHist : [],
          targetWeight
        );
        setHistory(cleanedHistory);
        if (wasModified) {
          localStorage.setItem(`lazcakon_${targetProfileId}_history`, JSON.stringify(cleanedHistory));
        }
      } else {
        setHistory([]);
      }

      const storedPrs = localStorage.getItem(`lazcakon_${targetProfileId}_prs`);
      setPrs(storedPrs ? JSON.parse(storedPrs) : {});

      const storedBw = localStorage.getItem(`lazcakon_${targetProfileId}_bodyweight`);
      setBodyWeightLogs(storedBw ? JSON.parse(storedBw) : []);

      const storedSession = localStorage.getItem(`lazcakon_${targetProfileId}_active_session`);
      setActiveSession(storedSession ? JSON.parse(storedSession) : null);

      const storedAlts = localStorage.getItem(`lazcakon_${targetProfileId}_alternatives`);
      setSelectedAlternatives(storedAlts ? JSON.parse(storedAlts) : {});

      const storedLinks = localStorage.getItem(`lazcakon_${targetProfileId}_custom_links`);
      setCustomLinks(storedLinks ? JSON.parse(storedLinks) : {});

      setPreImportBackup(getLatestPreImportBackup(targetProfileId));

      const storedTimer = localStorage.getItem(getRestTimerStorageKey(targetProfileId));
      let nextTimer: RestTimerState = {
        active: false,
        totalSeconds: 0,
        remainingSeconds: 0,
        minimized: false,
      };
      if (storedTimer) {
        const parsedTimer: RestTimerState = JSON.parse(storedTimer);
        if (parsedTimer.active && parsedTimer.targetEndTime) {
          const remaining = Math.max(0, Math.ceil((parsedTimer.targetEndTime - Date.now()) / 1000));
          if (remaining > 0) {
            nextTimer = { ...parsedTimer, remainingSeconds: remaining };
          }
        } else if (parsedTimer.active && parsedTimer.paused && parsedTimer.remainingSeconds > 0) {
          nextTimer = parsedTimer;
        }
      }
      restTimerRef.current = nextTimer;
      setRestTimer(nextTimer);
    } catch {
      setRoutines([]);
      setHistory([]);
      setPrs({});
      setBodyWeightLogs([]);
      setActiveSession(null);
      setSelectedAlternatives({});
      setCustomLinks({});
      setPreImportBackup(null);
    } finally {
      isFinishingWorkoutRef.current = false;
      setLoadedProfileId(targetProfileId);
    }

    // Background cloud sync ONLY when authenticated
    if (authUser && isLoggedIn && targetProfileId && targetProfileId !== 'perfil_default') {
      fetchUserDataFromFirebase(targetProfileId)
        .then((res) => {
          if (activeProfileIdRef.current !== targetProfileId) return;
          if (res.success && res.data) {
            if (Array.isArray(res.data.routines)) {
              const cleanRoutines = filterOutPreloadedRoutines(res.data.routines as Routine[]);
              setRoutines(cleanRoutines);
              localStorage.setItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify(cleanRoutines));
              if (cleanRoutines.length !== res.data.routines.length) {
                syncUserDataToFirebase(targetProfileId, { routines: cleanRoutines }).catch(() => {});
              }
            }
            if (Array.isArray(res.data.history)) {
              const { cleanedHistory, wasModified } = purgeAndSanitizeWorkoutHistory(
                res.data.history as CompletedWorkout[],
                activeWeightRef.current
              );
              setHistory(cleanedHistory);
              localStorage.setItem(`lazcakon_${targetProfileId}_history`, JSON.stringify(cleanedHistory));
              if (wasModified) {
                syncUserDataToFirebase(targetProfileId, { history: cleanedHistory }).catch(() => {});
              }
            }
            if (res.data.prs && typeof res.data.prs === 'object') {
              setPrs(res.data.prs as Record<string, PersonalRecord>);
              localStorage.setItem(`lazcakon_${targetProfileId}_prs`, JSON.stringify(res.data.prs));
            }
            if (Array.isArray(res.data.bodyWeightLogs)) {
              setBodyWeightLogs(res.data.bodyWeightLogs as BodyWeightEntry[]);
              localStorage.setItem(`lazcakon_${targetProfileId}_bodyweight`, JSON.stringify(res.data.bodyWeightLogs));
            }
            if (res.data.customLinks && typeof res.data.customLinks === 'object') {
              setCustomLinks(res.data.customLinks as Record<string, { id: string; title: string; url: string }[]>);
              localStorage.setItem(`lazcakon_${targetProfileId}_custom_links`, JSON.stringify(res.data.customLinks));
            }
            if (res.data.selectedAlternatives && typeof res.data.selectedAlternatives === 'object') {
              setSelectedAlternatives(res.data.selectedAlternatives as Record<string, boolean>);
              localStorage.setItem(`lazcakon_${targetProfileId}_alternatives`, JSON.stringify(res.data.selectedAlternatives));
            }
          }
        })
        .catch(() => {});
    }
  }, [activeProfileId, authUser, isLoggedIn]);

  // Idempotent, non-destructive storage schema migration on boot / app update
  useEffect(() => {
    ensureSafeStorageMigration();
  }, []);

  // Apply theme accent to DOM root whenever active profile theme changes
  useEffect(() => {
    applyThemeToRoot(activeProfile?.themeAccent);
  }, [activeProfile?.themeAccent]);

  // Real-time synchronization subscription ONLY for authenticated athlete training data across devices
  useEffect(() => {
    if (!activeProfileId || !authUser || !isLoggedIn || activeProfileId === 'perfil_default') return;
    const subscribedProfileId = activeProfileId;
    const unsubscribeCloud = subscribeUserDataFromCloud(subscribedProfileId, (cloudData) => {
      if (activeProfileIdRef.current !== subscribedProfileId) return;
      if (cloudData) {
        if (Array.isArray(cloudData.routines)) {
          const cleanRoutines = filterOutPreloadedRoutines(cloudData.routines as Routine[]);
          setRoutines(cleanRoutines);
          localStorage.setItem(`lazcakon_${subscribedProfileId}_routines`, JSON.stringify(cleanRoutines));
        }
        if (Array.isArray(cloudData.history)) {
          const { cleanedHistory, wasModified } = purgeAndSanitizeWorkoutHistory(
            cloudData.history as CompletedWorkout[],
            activeWeightRef.current
          );
          setHistory(cleanedHistory);
          localStorage.setItem(`lazcakon_${subscribedProfileId}_history`, JSON.stringify(cleanedHistory));
          if (wasModified) {
            syncUserDataToFirebase(subscribedProfileId, { history: cleanedHistory }).catch(() => {});
          }
        }
        if (cloudData.prs && typeof cloudData.prs === 'object') {
          setPrs(cloudData.prs as Record<string, PersonalRecord>);
          localStorage.setItem(`lazcakon_${subscribedProfileId}_prs`, JSON.stringify(cloudData.prs));
        }
        if (Array.isArray(cloudData.bodyWeightLogs)) {
          setBodyWeightLogs(cloudData.bodyWeightLogs as BodyWeightEntry[]);
          localStorage.setItem(`lazcakon_${subscribedProfileId}_bodyweight`, JSON.stringify(cloudData.bodyWeightLogs));
        }
        if (cloudData.customLinks && typeof cloudData.customLinks === 'object') {
          setCustomLinks(cloudData.customLinks as Record<string, { id: string; title: string; url: string }[]>);
          localStorage.setItem(`lazcakon_${subscribedProfileId}_custom_links`, JSON.stringify(cloudData.customLinks));
        }
        if (cloudData.selectedAlternatives && typeof cloudData.selectedAlternatives === 'object') {
          setSelectedAlternatives(cloudData.selectedAlternatives as Record<string, boolean>);
          localStorage.setItem(`lazcakon_${subscribedProfileId}_alternatives`, JSON.stringify(cloudData.selectedAlternatives));
        }
      }
    });

    return () => {
      unsubscribeCloud();
    };
  }, [activeProfileId, authUser, isLoggedIn]);

  // Track which second tick was last played so we don't depend on React state batching when locked
  const lastPlayedTickSecRef = useRef<number | null>(null);
  const fiveSecFiredTargetRef = useRef<number>(0);
  const completeFiredTargetRef = useRef<number>(0);

  // Rest timer countdown ticker using Web Worker, Service Worker, and Silent Audio Keep-Alive
  useEffect(() => {
    if (!restTimer.active || restTimer.paused || !restTimer.targetEndTime) {
      stopBackgroundTicker();
      stopSilentAudioKeepAlive();
      return;
    }

    // Keep mobile screen awake while resting & ensure Service Worker has the targetEndTime
    enableScreenWakeLock().catch(() => {});
    startSilentAudioKeepAlive(restTimer.exerciseName);
    scheduleServiceWorkerRestAlarm(restTimer.targetEndTime, restTimer.exerciseName).catch(() => {});

    const checkAndTick = () => {
      const current = restTimerRef.current;
      if (!current.active || current.paused || !current.targetEndTime) return;

      const now = Date.now();
      const remainingMs = current.targetEndTime - now;
      const diffSec = Math.ceil(remainingMs / 1000);

      // 1. Direct non-deferred execution for 0s completion (works even when screen is locked & React defers state)
      if (remainingMs <= 0) {
        if (completeFiredTargetRef.current !== current.targetEndTime) {
          completeFiredTargetRef.current = current.targetEndTime;
          if (activeProfile.soundEnabled) playRestCompleteAlarm();
          if (activeProfile.vibrationEnabled) {
            vibrateDevice(INTENSE_REST_VIBRATION_PATTERN);
          }
          sendRestCompleteNotification(current.exerciseName, current.targetEndTime, false);
        }
        stopSilentAudioKeepAlive();
        disableScreenWakeLock();
        localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
        restTimerRef.current = { ...current, active: false, paused: false, remainingSeconds: 0, targetEndTime: undefined };
        setRestTimer(restTimerRef.current);
        return;
      }

      // 2. Direct non-deferred execution for 5-second warning on Smartwatch & Phone (<= 5.3s)
      if (remainingMs <= 5300 && remainingMs > 1000) {
        if (fiveSecFiredTargetRef.current !== current.targetEndTime) {
          fiveSecFiredTargetRef.current = current.targetEndTime;
          sendFiveSecondWarningNotification(current.exerciseName, current.targetEndTime);
        }
      }

      // 3. Per-second countdown ticks (5, 4, 3, 2, 1)
      if (diffSec <= 5 && diffSec >= 1 && lastPlayedTickSecRef.current !== diffSec) {
        lastPlayedTickSecRef.current = diffSec;
        if (activeProfile.vibrationEnabled) {
          vibrateDevice([250, 100, 250]);
        }
        if (activeProfile.soundEnabled) {
          playCountdownTick(diffSec);
        }
      }

      // 4. Update UI state when second changes
      if (diffSec !== current.remainingSeconds) {
        const updated = { ...current, remainingSeconds: diffSec };
        restTimerRef.current = updated;
        localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
        setRestTimer(updated);
      }
    };

    // Start background ticker (Web Worker thread, immune to main-thread throttling)
    startBackgroundTicker(checkAndTick, 350);

    // Instant update whenever user unlocks phone or switches back to app
    const onVisibilityOrFocus = () => {
      resumeAudio();
      checkAndTick();
      if (document.visibilityState === 'visible') {
        enableScreenWakeLock().catch(() => {});
      }
    };

    document.addEventListener('visibilitychange', onVisibilityOrFocus);
    window.addEventListener('focus', onVisibilityOrFocus);
    window.addEventListener('pageshow', onVisibilityOrFocus);

    return () => {
      stopBackgroundTicker();
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('pageshow', onVisibilityOrFocus);
    };
  }, [
    restTimer.active,
    restTimer.paused,
    restTimer.targetEndTime,
    restTimer.exerciseName,
    activeProfile.soundEnabled,
    activeProfile.vibrationEnabled,
  ]);

  const startRestTimer = useCallback((seconds: number, exerciseName?: string) => {
    if (seconds <= 0) return;
    resumeAudio();
    startSilentAudioKeepAlive(exerciseName);
    enableScreenWakeLock().catch(() => {});
    lastPlayedTickSecRef.current = null;
    const now = Date.now();
    const targetEndTime = now + seconds * 1000;
    scheduleServiceWorkerRestAlarm(targetEndTime, exerciseName).catch(() => {});
    const newState: RestTimerState = {
      active: true,
      paused: false,
      totalSeconds: seconds,
      remainingSeconds: seconds,
      exerciseName,
      minimized: false,
      targetEndTime,
      startedAt: now,
    };
    restTimerRef.current = newState;
    setRestTimer(newState);
    localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(newState));
  }, []);

  const stopRestTimer = useCallback(() => {
    stopBackgroundTicker();
    stopSilentAudioKeepAlive();
    cancelServiceWorkerRestAlarm().catch(() => {});
    disableScreenWakeLock();
    lastPlayedTickSecRef.current = null;
    localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
    setRestTimer((prev) => {
      const next = { ...prev, active: false, paused: false, remainingSeconds: 0, targetEndTime: undefined };
      restTimerRef.current = next;
      return next;
    });
  }, []);

  const pauseRestTimer = useCallback(() => {
    setRestTimer((prev) => {
      if (!prev.active || prev.paused) return prev;
      stopBackgroundTicker();
      stopSilentAudioKeepAlive();
      cancelServiceWorkerRestAlarm().catch(() => {});
      const now = Date.now();
      const remaining = prev.targetEndTime
        ? Math.max(1, Math.ceil((prev.targetEndTime - now) / 1000))
        : Math.max(1, prev.remainingSeconds);
      const updated: RestTimerState = {
        ...prev,
        paused: true,
        remainingSeconds: remaining,
        targetEndTime: undefined,
      };
      restTimerRef.current = updated;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resumeRestTimer = useCallback(() => {
    setRestTimer((prev) => {
      if (!prev.active || !prev.paused) return prev;
      resumeAudio();
      startSilentAudioKeepAlive(prev.exerciseName);
      enableScreenWakeLock().catch(() => {});
      const now = Date.now();
      const remaining = Math.max(1, prev.remainingSeconds || prev.totalSeconds || 90);
      const targetEndTime = now + remaining * 1000;
      lastPlayedTickSecRef.current = null;
      scheduleServiceWorkerRestAlarm(targetEndTime, prev.exerciseName).catch(() => {});
      const updated: RestTimerState = {
        ...prev,
        paused: false,
        remainingSeconds: remaining,
        targetEndTime,
      };
      restTimerRef.current = updated;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      return updated;
    });
  }, []);

  const restartRestTimer = useCallback(() => {
    setRestTimer((prev) => {
      if (!prev.active) return prev;
      resumeAudio();
      startSilentAudioKeepAlive(prev.exerciseName);
      enableScreenWakeLock().catch(() => {});
      const total = Math.max(15, prev.totalSeconds || 90);
      const now = Date.now();
      const targetEndTime = now + total * 1000;
      lastPlayedTickSecRef.current = null;
      scheduleServiceWorkerRestAlarm(targetEndTime, prev.exerciseName).catch(() => {});
      const updated: RestTimerState = {
        ...prev,
        active: true,
        paused: false,
        totalSeconds: total,
        remainingSeconds: total,
        targetEndTime,
        startedAt: now,
      };
      restTimerRef.current = updated;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      return updated;
    });
  }, []);

  const adjustRestTimer = useCallback((deltaSeconds: number) => {
    setRestTimer((prev) => {
      if (!prev.active) return prev;
      const now = Date.now();
      const currentRemaining =
        prev.paused || !prev.targetEndTime
          ? prev.remainingSeconds
          : Math.max(0, Math.ceil((prev.targetEndTime - now) / 1000));
      const nextRemaining = Math.max(0, currentRemaining + deltaSeconds);

      if (nextRemaining <= 0) {
        stopBackgroundTicker();
        stopSilentAudioKeepAlive();
        cancelServiceWorkerRestAlarm().catch(() => {});
        disableScreenWakeLock();
        localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
        const next = { ...prev, active: false, paused: false, remainingSeconds: 0, targetEndTime: undefined };
        restTimerRef.current = next;
        return next;
      }

      if (prev.paused) {
        const updatedPaused: RestTimerState = {
          ...prev,
          remainingSeconds: nextRemaining,
          totalSeconds: Math.max(prev.totalSeconds, nextRemaining),
          targetEndTime: undefined,
        };
        restTimerRef.current = updatedPaused;
        localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updatedPaused));
        return updatedPaused;
      }

      const newTarget = now + nextRemaining * 1000;
      lastPlayedTickSecRef.current = null;
      scheduleServiceWorkerRestAlarm(newTarget, prev.exerciseName).catch(() => {});
      const updated: RestTimerState = {
        ...prev,
        remainingSeconds: nextRemaining,
        totalSeconds: Math.max(prev.totalSeconds, nextRemaining),
        targetEndTime: newTarget,
      };
      restTimerRef.current = updated;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      return updated;
    });
  }, []);

  const toggleRestTimerMinimized = useCallback(() => {
    setRestTimer((prev) => {
      const nextMinimized = !prev.minimized;
      const updated = { ...prev, minimized: nextMinimized };
      restTimerRef.current = updated;
      if (prev.active) {
        localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  // Exercise Alternatives
  const toggleExerciseAlternative = useCallback((exerciseId: string) => {
    setSelectedAlternatives((prev) => {
      const nextVal = !prev[exerciseId];
      const updated = { ...prev, [exerciseId]: nextVal };

      // Update in active workout session if present
      setActiveSession((currSession) => {
        if (!currSession) return null;
        return {
          ...currSession,
          exercises: currSession.exercises.map((ex) => {
            if (ex.exerciseId === exerciseId) {
              const baseRoutine = routines.find((r) => r.id === currSession.routineId);
              const originalEx = baseRoutine?.exercises.find((e) => e.id === exerciseId);
              const origName = ex.originalExerciseName || originalEx?.name || ex.exerciseName;
              const newName = nextVal && originalEx?.alternative ? originalEx.alternative : origName;
              const isDifferentExercise = normalizeText(newName) !== normalizeText(ex.activeExerciseName);

              // Look up historical performance for the newly selected exercise only
              let newPrevHint = '';
              for (const hist of history) {
                const found = hist.exercisesSummary.find(
                  (s) => normalizeText(s.name) === normalizeText(newName)
                );
                if (found) {
                  newPrevHint = `${found.maxWeight} kg × ${found.maxReps}`;
                  break;
                }
              }

              return {
                ...ex,
                originalExerciseId: ex.originalExerciseId || ex.exerciseId,
                originalExerciseName: origName,
                useAlternative: nextVal,
                activeExerciseName: newName,
                // Fase 7: No copiar automáticamente cargas entre ejercicios diferentes
                sets: isDifferentExercise
                  ? ex.sets.map((s) =>
                      s.completed
                        ? s
                        : {
                            ...s,
                            weight: '' as number | '',
                            reps: '' as number | '',
                            previous: newPrevHint,
                          }
                    )
                  : ex.sets,
              };
            }
            return ex;
          }),
        };
      });

      return updated;
    });
  }, [routines, history]);

  // Dynamically replace an exercise in the active workout session (preserving original history & clearing uncompleted loads)
  const replaceActiveExerciseWithAI = useCallback(
    (
      exerciseId: string,
      replacement: {
        newName: string;
        targetMuscles?: string;
        equipment?: string;
        notes?: string;
        restSeconds?: number;
      }
    ) => {
      setActiveSession((currSession) => {
        if (!currSession) return null;
        return {
          ...currSession,
          exercises: currSession.exercises.map((ex) => {
            if (ex.exerciseId === exerciseId) {
              const origName = ex.originalExerciseName || ex.exerciseName;
              const origId = ex.originalExerciseId || ex.exerciseId;
              const isDifferentExercise =
                normalizeText(replacement.newName) !== normalizeText(ex.activeExerciseName);

              // Find historical performance exclusively for the replacement exercise
              let newPrevHint = '';
              for (const hist of history) {
                const found = hist.exercisesSummary.find(
                  (s) => normalizeText(s.name) === normalizeText(replacement.newName)
                );
                if (found) {
                  newPrevHint = `${found.maxWeight} kg × ${found.maxReps}`;
                  break;
                }
              }

              return {
                ...ex,
                originalExerciseId: origId,
                originalExerciseName: origName,
                activeExerciseName: replacement.newName,
                targetMuscles: replacement.targetMuscles || ex.targetMuscles,
                equipment: replacement.equipment || ex.equipment,
                notes: replacement.notes
                  ? ex.notes
                    ? `${ex.notes} · ${replacement.notes}`
                    : replacement.notes
                  : ex.notes,
                restSeconds: replacement.restSeconds || ex.restSeconds,
                // Fase 7: No copiar automáticamente cargas entre ejercicios diferentes
                sets: isDifferentExercise
                  ? ex.sets.map((s) =>
                      s.completed
                        ? s
                        : {
                            ...s,
                            weight: '' as number | '',
                            reps: '' as number | '',
                            previous: newPrevHint,
                          }
                    )
                  : ex.sets,
              };
            }
            return ex;
          }),
        };
      });
    },
    [history]
  );

  // Start workout session
  const startWorkout = useCallback((routine: Routine) => {
    // Find previous performance for placeholder/reference
    const exercisesState = routine.exercises.map((ex) => {
      const isAlt = !!selectedAlternatives[ex.id];
      const activeName = isAlt && ex.alternative ? ex.alternative : ex.name;

      // Find previous weight/reps from history
      let previousHint = '';
      for (const hist of history) {
        const found = hist.exercisesSummary.find(
          (s) => normalizeText(s.name) === normalizeText(activeName)
        );
        if (found) {
          previousHint = `${found.maxWeight} kg × ${found.maxReps}`;
          break;
        }
      }

      const sets = Array.from({ length: ex.defaultSets || 3 }).map((_, idx) => ({
        setNumber: idx + 1,
        weight: '' as number | '',
        reps: '' as number | '',
        completed: false,
        previous: previousHint,
      }));

      return {
        exerciseId: ex.id,
        exerciseName: ex.name,
        originalExerciseId: ex.id,
        originalExerciseName: ex.name,
        targetMuscles: ex.targetMuscles,
        equipment: ex.equipment,
        sets,
        useAlternative: isAlt,
        activeExerciseName: activeName,
        notes: '',
        restSeconds: extractRestSeconds(
          (ex as any).DESCANSO ?? ex.descanso ?? ex.restText ?? ex.restSeconds,
          90
        ),
      };
    });

    setActiveSession({
      routineId: routine.id,
      routineTitle: routine.title,
      startTime: Date.now(),
      exercises: exercisesState,
    });
  }, [selectedAlternatives, history]);

  // Start a Free / Express Workout session
  const startFreeWorkout = useCallback((customTitle?: string, initialExercises: Routine['exercises'] = []) => {
    const exercisesState = initialExercises.map((ex) => {
      let previousHint = '';
      for (const hist of history) {
        const found = hist.exercisesSummary.find((s) => s.name === ex.name);
        if (found) {
          previousHint = `${found.maxWeight} kg × ${found.maxReps}`;
          break;
        }
      }

      const sets = Array.from({ length: ex.defaultSets || 3 }).map((_, idx) => ({
        setNumber: idx + 1,
        weight: '' as number | '',
        reps: '' as number | '',
        completed: false,
        previous: previousHint,
      }));

      return {
        exerciseId: ex.id,
        exerciseName: ex.name,
        targetMuscles: ex.targetMuscles,
        sets,
        useAlternative: false,
        activeExerciseName: ex.name,
        notes: '',
        restSeconds: extractRestSeconds(
          (ex as any).DESCANSO ?? ex.descanso ?? ex.restText ?? ex.restSeconds,
          90
        ),
      };
    });

    setActiveSession({
      routineId: `libre-${Date.now()}`,
      routineTitle: customTitle?.trim() || 'Sesión Libre',
      startTime: Date.now(),
      exercises: exercisesState,
    });
  }, [history]);

  // Dynamically add an exercise to the live workout session
  const addExerciseToActiveSession = useCallback((ex: Routine['exercises'][number]) => {
    setActiveSession((prev) => {
      if (!prev) return null;
      let previousHint = '';
      for (const hist of history) {
        const found = hist.exercisesSummary.find((s) => s.name === ex.name);
        if (found) {
          previousHint = `${found.maxWeight} kg × ${found.maxReps}`;
          break;
        }
      }

      const uniqueId = prev.exercises.some((item) => item.exerciseId === ex.id)
        ? `${ex.id}-${Date.now()}`
        : ex.id;

      const sets = Array.from({ length: ex.defaultSets || 3 }).map((_, idx) => ({
        setNumber: idx + 1,
        weight: '' as number | '',
        reps: '' as number | '',
        completed: false,
        previous: previousHint,
      }));

      return {
        ...prev,
        exercises: [
          ...prev.exercises,
          {
            exerciseId: uniqueId,
            exerciseName: ex.name,
            targetMuscles: ex.targetMuscles,
            sets,
            useAlternative: false,
            activeExerciseName: ex.name,
            notes: '',
            restSeconds: extractRestSeconds(
              (ex as any).DESCANSO ?? ex.descanso ?? ex.restText ?? ex.restSeconds,
              90
            ),
          },
        ],
      };
    });
  }, [history]);

  // Remove an exercise from the active workout session
  const removeExerciseFromActiveSession = useCallback((exerciseId: string) => {
    setActiveSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.filter((ex) => ex.exerciseId !== exerciseId),
      };
    });
  }, []);

  // Insert automatic progressive warm-up sets (50% x 10, 70% x 6, 85% x 3)
  const addWarmupSetsToExercise = useCallback((exerciseId: string, baseWeight?: number) => {
    setActiveSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) => {
          if (ex.exerciseId !== exerciseId) return ex;

          // Determine reference working weight
          let refWeight = baseWeight || 0;
          if (!refWeight) {
            const entered = ex.sets.find((s) => typeof s.weight === 'number' && s.weight > 0);
            if (entered && typeof entered.weight === 'number') {
              refWeight = entered.weight;
            }
          }
          if (!refWeight && prs[ex.exerciseId]?.maxWeight) {
            refWeight = prs[ex.exerciseId].maxWeight;
          }
          if (!refWeight) {
            // Try parsing from previous string "80 kg × 10"
            const prevStr = ex.sets[0]?.previous || '';
            const match = prevStr.match(/(\d+(?:\.\d+)?)/);
            if (match) refWeight = parseFloat(match[1]);
          }
          if (!refWeight || refWeight < 10) refWeight = 60;

          const round25 = (val: number) => Math.max(2.5, Math.round(val / 2.5) * 2.5);

          const warmupSets = [
            {
              setNumber: 1,
              weight: round25(refWeight * 0.5),
              reps: 10,
              completed: false,
              previous: '50% Aprox.',
              isWarmup: true,
            },
            {
              setNumber: 2,
              weight: round25(refWeight * 0.7),
              reps: 6,
              completed: false,
              previous: '70% Aprox.',
              isWarmup: true,
            },
            {
              setNumber: 3,
              weight: round25(refWeight * 0.85),
              reps: 3,
              completed: false,
              previous: '85% Aprox.',
              isWarmup: true,
            },
          ];

          const workingSets = ex.sets.filter((s) => !s.isWarmup);
          const merged = [...warmupSets, ...workingSets].map((s, idx) => ({
            ...s,
            setNumber: idx + 1,
          }));

          return { ...ex, sets: merged };
        }),
      };
    });
  }, [prs]);

  // Update set in live session (Fase 6: never auto-increase or overwrite next set weights without explicit athlete action)
  const updateSet = useCallback(
    (exerciseId: string, setIndex: number, field: 'weight' | 'reps' | 'rpe' | 'completed', value: unknown) => {
      setActiveSession((prev) => {
        if (!prev) return null;
        const nextExercises = prev.exercises.map((ex) => {
          if (ex.exerciseId !== exerciseId) return ex;

          const nextSets = [...ex.sets];
          const currentSet = { ...nextSets[setIndex], [field]: value };
          nextSets[setIndex] = currentSet;

          // If completed just became true: trigger sound and vibration feedback
          if (field === 'completed' && value === true) {
            if (activeProfile.soundEnabled) playBeep(false);
            if (activeProfile.vibrationEnabled) vibrateDevice([100, 60, 100]);
          }

          return { ...ex, sets: nextSets };
        });

        return { ...prev, exercises: nextExercises };
      });
    },
    [activeProfile.soundEnabled, activeProfile.vibrationEnabled]
  );

  const updateExerciseRestSeconds = useCallback((exerciseId: string, restSeconds: number) => {
    const safeRest = Math.max(15, Math.min(600, Math.round(restSeconds)));
    setActiveSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) =>
          ex.exerciseId === exerciseId ? { ...ex, restSeconds: safeRest } : ex
        ),
      };
    });
  }, []);

  const addSetToExercise = useCallback((exerciseId: string) => {
    setActiveSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) => {
          if (ex.exerciseId !== exerciseId) return ex;
          const lastSet = ex.sets[ex.sets.length - 1];
          const newSet = {
            setNumber: ex.sets.length + 1,
            weight: lastSet ? lastSet.weight : ('' as number | ''),
            reps: lastSet ? lastSet.reps : ('' as number | ''),
            completed: false,
            previous: lastSet?.previous,
          };
          return { ...ex, sets: [...ex.sets, newSet] };
        }),
      };
    });
  }, []);

  const removeSetFromExercise = useCallback((exerciseId: string, setIndex: number) => {
    setActiveSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) => {
          if (ex.exerciseId !== exerciseId) return ex;
          if (ex.sets.length <= 1) return ex;
          const filtered = ex.sets
            .filter((_, idx) => idx !== setIndex)
            .map((s, idx) => ({ ...s, setNumber: idx + 1 }));
          return { ...ex, sets: filtered };
        }),
      };
    });
  }, []);

  const updateExerciseNotes = useCallback((exerciseId: string, notes: string) => {
    setActiveSession((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        exercises: prev.exercises.map((ex) => (ex.exerciseId === exerciseId ? { ...ex, notes } : ex)),
      };
    });
  }, []);

  // Finish Workout
  const finishWorkout = useCallback((): { workout: CompletedWorkout; newPRs: PersonalRecord[] } | null => {
    if (!activeSession || isFinishingWorkoutRef.current) return null;
    isFinishingWorkoutRef.current = true;

    const endTime = Date.now();
    const rawDurationSeconds = Math.max(1, Math.round((endTime - activeSession.startTime) / 1000));
    let totalVolumeKg = 0;
    let completedSetsCount = 0;
    let totalRepsCount = 0;
    const exercisesSummary: CompletedWorkout['exercisesSummary'] = [];
    const newPRsList: PersonalRecord[] = [];
    const primaryMuscleSet = new Set<string>();
    const secondaryMuscleSet = new Set<string>();

    const updatedPrs = { ...prs };

    activeSession.exercises.forEach((ex) => {
      let exerciseMaxWeight = 0;
      let exerciseMaxReps = 0;
      let exCompletedSets = 0;
      let exTotalReps = 0;

      ex.sets.forEach((set) => {
        if (set.completed) {
          exCompletedSets += 1;
          completedSetsCount += 1;
          const w = typeof set.weight === 'number' ? set.weight : 0;
          const r = typeof set.reps === 'number' ? set.reps : 0;
          totalVolumeKg += w * r;
          totalRepsCount += r;
          exTotalReps += r;

          if (w > exerciseMaxWeight || (w === exerciseMaxWeight && r > exerciseMaxReps)) {
            exerciseMaxWeight = w;
            exerciseMaxReps = r;
          }

          // Check PR (weight or reps at max weight)
          const estimated1RM = w > 0 && r > 0 ? Math.round(w * (1 + r / 30)) : 0;
          const prKey = ex.activeExerciseName === ex.exerciseName ? ex.exerciseId : `swap_${normalizeText(ex.activeExerciseName)}`;
          const existingPR = updatedPrs[prKey] || updatedPrs[ex.exerciseId];

          if (
            w > 0 &&
            r > 0 &&
            (!existingPR ||
              w > existingPR.maxWeight ||
              (w === existingPR.maxWeight && r > existingPR.repsAtMaxWeight))
          ) {
            const prItem: PersonalRecord = {
              exerciseId: prKey,
              exerciseName: ex.activeExerciseName,
              maxWeight: w,
              repsAtMaxWeight: r,
              estimated1RM,
              date: new Date().toISOString(),
            };
            updatedPrs[prKey] = prItem;
            // Avoid duplicate PR entries for the same exercise in the same session
            const existingIdx = newPRsList.findIndex(
              (item) => normalizeText(item.exerciseName) === normalizeText(ex.activeExerciseName)
            );
            if (existingIdx !== -1) {
              newPRsList[existingIdx] = prItem;
            } else {
              newPRsList.push(prItem);
            }
          }
        }
      });

      if (exCompletedSets > 0) {
        let exVol = 0;
        let exRpeSum = 0;
        let exRpeCount = 0;
        ex.sets.forEach((s) => {
          if (s.completed && typeof s.weight === 'number' && typeof s.reps === 'number') {
            exVol += s.weight * s.reps;
          }
          if (s.completed && typeof s.rpe === 'number' && s.rpe >= 1) {
            exRpeSum += s.rpe;
            exRpeCount += 1;
          }
        });
        const exAvgRpe = exRpeCount > 0 ? Number((exRpeSum / exRpeCount).toFixed(1)) : undefined;

        // Resolve primary and secondary muscles worked via biomechanical engine
        const impact = resolveExerciseMuscleImpact(ex.activeExerciseName, ex.targetMuscles || '');
        impact.primary.forEach((mId) => {
          const cat = MUSCLE_CONFIG[mId]?.standardCategory || MUSCLE_CONFIG[mId]?.name;
          if (cat) primaryMuscleSet.add(cat);
        });
        impact.synergists.forEach((syn) => {
          const cat = MUSCLE_CONFIG[syn.id]?.standardCategory || MUSCLE_CONFIG[syn.id]?.name;
          if (cat && !primaryMuscleSet.has(cat)) {
            secondaryMuscleSet.add(cat);
          }
        });
        impact.secondaryNames.forEach((secName) => {
          const cleaned = secName.replace(/\s*\(.*?\)\s*/g, '').trim();
          if (cleaned && !primaryMuscleSet.has(cleaned)) {
            secondaryMuscleSet.add(cleaned);
          }
        });

        exercisesSummary.push({
          exerciseId: ex.exerciseId,
          originalExerciseId: ex.originalExerciseId || ex.exerciseId,
          originalExerciseName: ex.originalExerciseName || ex.exerciseName,
          name: ex.activeExerciseName,
          sets: exCompletedSets,
          totalReps: exTotalReps,
          maxWeight: exerciseMaxWeight,
          maxReps: exerciseMaxReps,
          volumeKg: exVol,
          muscleGroup: ex.targetMuscles,
          estimated1RM:
            exerciseMaxWeight > 0 && exerciseMaxReps > 0
              ? Math.round(exerciseMaxWeight * (1 + exerciseMaxReps / 30))
              : 0,
          rpe: exAvgRpe,
        });
      }
    });

    // Ensure secondary muscles don't duplicate primary muscles
    primaryMuscleSet.forEach((pm) => secondaryMuscleSet.delete(pm));

    // Calcular avgRpe global únicamente si existen registros reales de RPE
    let workoutTotalRpeSum = 0;
    let workoutTotalRpeSets = 0;
    exercisesSummary.forEach((ex) => {
      if (typeof ex.rpe === 'number' && ex.rpe >= 1) {
        workoutTotalRpeSum += ex.rpe * ex.sets;
        workoutTotalRpeSets += ex.sets;
      }
    });
    const workoutAvgRpe =
      workoutTotalRpeSets > 0 ? Number((workoutTotalRpeSum / workoutTotalRpeSets).toFixed(1)) : undefined;

    const nowIso = new Date().toISOString();
    const todayDateKey = getLocalDateKey(nowIso) || nowIso.slice(0, 10);
    const sanitizedDurationSeconds = sanitizeWorkoutDurationSeconds(
      rawDurationSeconds,
      completedSetsCount,
      exercisesSummary.length
    );
    const sanitizedRoutineTitle = sanitizeRoutineTitleForDate(
      activeSession.routineTitle,
      todayDateKey
    );
    const durationMins = Number((sanitizedDurationSeconds / 60).toFixed(2));
    const caloriesBurned = calculateWorkoutCaloriesBurned({
      durationMinutes: durationMins,
      totalVolumeKg,
      bodyWeightKg: activeProfile?.weightKg || 95,
      completedSetsCount,
      completedExercises: exercisesSummary.map((ex) => ({
        name: ex.name,
        muscleGroup: ex.muscleGroup,
        setsCompleted: ex.sets,
        completed: true,
        rpe: ex.rpe,
      })),
      routineTitle: sanitizedRoutineTitle,
    });

    // Compare with most recent prior session of the same routine or title
    const sortedPrevious = [...history]
      .filter((h) => (getLocalDateKey(h.date) || h.date.slice(0, 10)) !== todayDateKey)
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    const matchingPrevSession =
      sortedPrevious.find(
        (h) =>
          h.routineId === activeSession.routineId ||
          normalizeText(h.routineTitle) === normalizeText(sanitizedRoutineTitle)
      ) || sortedPrevious[0];

    const previousSessionComparison = matchingPrevSession
      ? {
          prevDate: matchingPrevSession.date,
          prevVolumeKg: matchingPrevSession.totalVolumeKg || 0,
          volumeDiffKg: Math.round(totalVolumeKg - (matchingPrevSession.totalVolumeKg || 0)),
          prevSets: matchingPrevSession.completedSetsCount || 0,
        }
      : undefined;

    const uniqueWorkoutId = `workout-${endTime}-${Math.random().toString(36).slice(2, 7)}`;
    const completedWorkout: CompletedWorkout = {
      id: uniqueWorkoutId,
      routineId: activeSession.routineId,
      routineTitle: sanitizedRoutineTitle,
      date: nowIso,
      startTime: endTime - sanitizedDurationSeconds * 1000,
      endTime,
      durationSeconds: sanitizedDurationSeconds,
      totalVolumeKg: Math.round(totalVolumeKg),
      completedSetsCount,
      totalRepsCount,
      completedExercisesCount: exercisesSummary.length,
      primaryMusclesWorked: Array.from(primaryMuscleSet),
      secondaryMusclesWorked: Array.from(secondaryMuscleSet),
      previousSessionComparison,
      isFinished: true,
      avgRpe: workoutAvgRpe,
      caloriesBurned,
      exercisesSummary,
    };

    // Garantizar registro único e independiente por fecha YYYY-MM-DD (sin bucles ni acumulación)
    const { cleanedHistory: deduplicatedHistory } = purgeAndSanitizeWorkoutHistory(
      [completedWorkout, ...history],
      activeProfile?.weightKg || 95
    );

    setHistory(deduplicatedHistory);
    setPrs(updatedPrs);
    setActiveSession(null);
    stopRestTimer();

    // Trigger cloud sync or queue offline sync immediately for zero data loss
    const syncPayload = {
      history: deduplicatedHistory,
      prs: updatedPrs,
      routines,
      bodyWeightLogs,
    };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      queueOfflineSync(activeProfile.id, syncPayload);
    } else {
      syncUserDataToFirebase(activeProfile.id, syncPayload).then((res) => {
        if (!res.success) {
          queueOfflineSync(activeProfile.id, syncPayload);
        }
      }).catch(() => {
        queueOfflineSync(activeProfile.id, syncPayload);
      });
    }

    return { workout: completedWorkout, newPRs: newPRsList };
  }, [activeSession, prs, history, routines, bodyWeightLogs, activeProfile.id, activeProfile?.weightKg, stopRestTimer]);

  const cancelWorkout = useCallback(() => {
    setActiveSession(null);
    stopRestTimer();
  }, [stopRestTimer]);

  // Profile management (Strictly gated on Firebase Auth & Custom Claims)
  const switchProfile = useCallback(
    (profileId: string) => {
      if (!isAdmin) return;
      setActiveProfileId(profileId);
    },
    [isAdmin]
  );

  // Admin-only manual profile creation inside app (no plaintext PINs stored)
  const createProfile = useCallback(
    (name: string, emailOrAvatar: string, pinOrGoal?: string, _maybeAvatar?: string, maybeGoal?: string) => {
      if (!isAdmin || !authUser) {
        console.warn('Solo un administrador autenticado o un atleta con invitación puede crear cuentas.');
        return;
      }
      let avatar = '🦍';
      let goal = 'Hipertrofia & Masa';
      if (maybeGoal) {
        avatar = _maybeAvatar || '🦍';
        goal = maybeGoal;
      } else {
        avatar = emailOrAvatar || '🦍';
        goal = pinOrGoal || 'Hipertrofia & Masa';
      }

      const newId = `perfil_${Date.now()}`;
      const newP: Profile = {
        id: newId,
        name,
        email: '',
        avatar,
        goal,
        weeklyTargetDays: 5,
        soundEnabled: true,
        vibrationEnabled: true,
        weightUnit: 'kg',
        isAdmin: false,
        createdAt: new Date().toISOString(),
      };
      setProfiles((prev) => [...prev, newP]);
      setActiveProfileId(newId);

      saveAthleteToCloud(newP, {
        routines: DEFAULT_ROUTINES,
        history: [],
        prs: {},
        bodyWeightLogs: [],
      }).catch((err) => console.warn('Error saving new athlete to cloud:', err));
    },
    [isAdmin, authUser]
  );

  // Complete Starter-Tier authentication cleanly once server returns profile
  const finalizeAuthenticatedSession = useCallback(
    async (payload: {
      uid: string;
      athleteId: string;
      isAdmin: boolean;
      adminRequiresGoogleSignIn?: boolean;
      profile: Profile;
    }) => {
      pendingLegacyVerificationRef.current = false;
      const tokenState = await refreshAuthSession(auth.currentUser);
      const effectiveAdmin = Boolean(payload.isAdmin && tokenState.isGoogleVerified);
      setServerAdminVerified(Boolean(payload.isAdmin));
      setAdminRequiresGoogleSignIn(Boolean(payload.adminRequiresGoogleSignIn));
      setSessionAthleteId(payload.athleteId);
      sessionInitializedUidRef.current = payload.uid;
      mergeCloudProfileIntoState(payload.profile, !effectiveAdmin, effectiveAdmin);
      setActiveProfileId(payload.athleteId);
      setIsLoggedIn(true);
      processPendingOfflineSyncs().catch(() => {});
    },
    [mergeCloudProfileIntoState, refreshAuthSession]
  );

  // Firebase Auth login with Email + Password (Starter Tier: delegates legacy linking to interactive proof flow)
  const loginWithEmailPin = useCallback(
    async (
      email: string,
      pinOrPassword: string
    ): Promise<{
      success: boolean;
      message: string;
      requiresLegacyVerification?: boolean;
      requiresAuthSetupForLegacy?: boolean;
      legacyEmail?: string;
    }> => {
      const trimmedEmail = email.toLowerCase().trim();
      const trimmedSecret = pinOrPassword.trim();

      if (!trimmedEmail || !trimmedSecret) {
        return { success: false, message: 'Ingresa tu correo electrónico y contraseña o PIN heredado.' };
      }

      if (trimmedSecret.length < 6) {
        return {
          success: false,
          requiresAuthSetupForLegacy: true,
          legacyEmail: trimmedEmail,
          message:
            'Firebase Authentication requiere iniciar sesión con Google o crear una contraseña propia (mín. 6 caracteres) y luego verificar tu PIN heredado o código del Coach para vincular tu historial.',
        };
      }

      manualAuthInProgressRef.current = true;
      try {
        const cred = await signInWithEmailAndPassword(auth, trimmedEmail, trimmedSecret);
        const idToken = await cred.user.getIdToken();
        const sessionRes = await safeApiFetchJson<Record<string, any>>('/api/auth/session-init', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
        });
        const sessionData = sessionRes.data || {};
        if (!sessionRes.ok || !sessionRes.isJson) {
          if (sessionRes.status === 409 && sessionData?.requiresLegacyVerification) {
            pendingLegacyVerificationRef.current = true;
            return {
              success: false,
              requiresLegacyVerification: true,
              legacyEmail: sessionData.email || trimmedEmail,
              message:
                sessionData.error ||
                'Verifica tu identidad con tu PIN heredado o código de recuperación del Coach para vincular tu perfil.',
            };
          }
          await signOut(auth).catch(() => {});
          return {
            success: false,
            message:
              sessionRes.error ||
              sessionData?.error ||
              'No autorizado para acceder a esta cuenta.',
          };
        }

        if (!sessionData?.athleteId || !sessionData?.profile) {
          await signOut(auth).catch(() => {});
          return { success: false, message: 'No se pudo cargar tu perfil desde la nube.' };
        }

        await finalizeAuthenticatedSession({
          uid: cred.user.uid,
          athleteId: sessionData.athleteId,
          isAdmin: Boolean(sessionData.isAdmin),
          adminRequiresGoogleSignIn: Boolean(sessionData.adminRequiresGoogleSignIn),
          profile: sessionData.profile as Profile,
        });

        return {
          success: true,
          message: `¡Bienvenido, ${sessionData.profile.name || trimmedEmail}!`,
        };
      } catch (err: any) {
        const code = String(err?.code || '');
        const shouldSuggestLegacySetup =
          code === 'auth/user-not-found' ||
          code === 'auth/invalid-credential' ||
          code === 'auth/wrong-password' ||
          code === 'auth/invalid-login-credentials';
        if (shouldSuggestLegacySetup) {
          return {
            success: false,
            requiresAuthSetupForLegacy: true,
            legacyEmail: trimmedEmail,
            message:
              'Contraseña incorrecta o cuenta aún no migrada a Firebase Auth. Si vienes del sistema anterior, elige Google o crea una contraseña nueva y verifica tu PIN heredado.',
          };
        }
        return {
          success: false,
          message: err?.message || 'Error al iniciar sesión con Firebase Authentication.',
        };
      } finally {
        manualAuthInProgressRef.current = false;
      }
    },
    [finalizeAuthenticatedSession]
  );

  // Firebase Auth login with Google Sign-In (validates Master Admin or linked/unlinked athlete profile)
  const loginWithGoogle = useCallback(async (): Promise<{
    success: boolean;
    message: string;
    requiresLegacyVerification?: boolean;
    legacyEmail?: string;
  }> => {
    manualAuthInProgressRef.current = true;
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const idToken = await cred.user.getIdToken();
      const res = await safeApiFetchJson<Record<string, any>>('/api/auth/session-init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = res.data || {};
      if (!res.ok || !res.isJson || !data?.success) {
        if (res.status === 409 && data?.requiresLegacyVerification) {
          pendingLegacyVerificationRef.current = true;
          return {
            success: false,
            requiresLegacyVerification: true,
            legacyEmail: data.email || cred.user.email || '',
            message:
              data.error ||
              'Encontramos un perfil heredado. Ingresa tu PIN anterior o código de recuperación para vincular tu historial.',
          };
        }
        await signOut(auth).catch(() => {});
        sessionInitializedUidRef.current = null;
        return {
          success: false,
          message:
            res.error ||
            data?.error ||
            'Este correo Google no tiene una cuenta activa. Usa un código de invitación.',
        };
      }

      await finalizeAuthenticatedSession({
        uid: cred.user.uid,
        athleteId: data.athleteId,
        isAdmin: Boolean(data.isAdmin),
        adminRequiresGoogleSignIn: Boolean(data.adminRequiresGoogleSignIn),
        profile: data.profile as Profile,
      });

      return {
        success: true,
        message: `¡Bienvenido, ${data?.profile?.name || cred.user.displayName || 'Atleta'}!`,
      };
    } catch (err: any) {
      const code = String(err?.code || '');
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return { success: false, message: 'Inicio de sesión con Google cancelado.' };
      }
      if (code === 'auth/popup-blocked') {
        return {
          success: false,
          message:
            'El navegador bloqueó la ventana de Google. Permite ventanas emergentes o abre la app en Chrome/Safari e intenta de nuevo.',
        };
      }
      if (code === 'auth/unauthorized-domain') {
        return {
          success: false,
          message: 'Este dominio no está autorizado en Firebase Authentication.',
        };
      }
      return {
        success: false,
        message: err?.message || 'No se pudo iniciar sesión con Google.',
      };
    } finally {
      manualAuthInProgressRef.current = false;
    }
  }, [finalizeAuthenticatedSession]);

  // Step 2 of Legacy Profile Linking: verify ownership via PIN or Coach recovery code while authenticated
  const verifyAndLinkLegacyProfile = useCallback(
    async (params: {
      legacyEmail: string;
      pinOrRecoveryCode: string;
      newPassword?: string;
      authMethod?: 'current_session' | 'google' | 'create_password';
    }): Promise<{ success: boolean; message: string }> => {
      const targetEmail = params.legacyEmail.toLowerCase().trim();
      const secretProof = params.pinOrRecoveryCode.trim();
      if (!targetEmail || !secretProof) {
        return {
          success: false,
          message: 'Ingresa el correo del perfil heredado y tu PIN anterior o código de recuperación.',
        };
      }

      manualAuthInProgressRef.current = true;
      pendingLegacyVerificationRef.current = true;
      let createdFreshPasswordUser: User | null = null;

      try {
        if (params.authMethod === 'google') {
          await signInWithPopup(auth, googleProvider);
        } else if (params.authMethod === 'create_password') {
          const pwd = String(params.newPassword || '').trim();
          if (pwd.length < 6) {
            return {
              success: false,
              message: 'Tu nueva contraseña debe tener al menos 6 caracteres.',
            };
          }
          const cred = await createUserWithEmailAndPassword(auth, targetEmail, pwd);
          createdFreshPasswordUser = cred.user;
        }

        if (!auth.currentUser) {
          return {
            success: false,
            message: 'Autentícate primero con Google o crea tu contraseña para vincular tu perfil.',
          };
        }

        const linkRes = await linkLegacyProfileWithServer({
          email: targetEmail,
          pin: secretProof,
        });

        if (!linkRes.success || !linkRes.athleteId || !linkRes.profile) {
          if (createdFreshPasswordUser) {
            await createdFreshPasswordUser.delete().catch(() => signOut(auth).catch(() => {}));
          }
          return {
            success: false,
            message: linkRes.error || 'No se pudo verificar la identidad del perfil heredado.',
          };
        }

        await finalizeAuthenticatedSession({
          uid: auth.currentUser.uid,
          athleteId: linkRes.athleteId,
          isAdmin: Boolean(linkRes.isAdmin),
          profile: linkRes.profile,
        });

        return {
          success: true,
          message: `¡Historial restaurado y vinculado! Bienvenido, ${linkRes.profile.name}.`,
        };
      } catch (err: any) {
        if (createdFreshPasswordUser) {
          await createdFreshPasswordUser.delete().catch(() => signOut(auth).catch(() => {}));
        }
        const code = String(err?.code || '');
        if (code === 'auth/email-already-in-use') {
          return {
            success: false,
            message:
              'Ese correo ya existe en Firebase Authentication. Inicia sesión con tu contraseña o Google para verificar tu PIN heredado.',
          };
        }
        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          return { success: false, message: 'Inicio de sesión con Google cancelado.' };
        }
        if (code === 'auth/popup-blocked') {
          return {
            success: false,
            message:
              'El navegador móvil bloqueó la ventana de Google. Permite ventanas emergentes o abre el enlace en Chrome/Safari e intenta nuevamente.',
          };
        }
        return {
          success: false,
          message: err?.message || 'Error vinculando el perfil heredado.',
        };
      } finally {
        manualAuthInProgressRef.current = false;
      }
    },
    [finalizeAuthenticatedSession]
  );

  const cancelLegacyVerification = useCallback(async () => {
    pendingLegacyVerificationRef.current = false;
    sessionInitializedUidRef.current = null;
    setServerAdminVerified(false);
    setAdminRequiresGoogleSignIn(false);
    setSessionAthleteId(null);
    setIsLoggedIn(false);
    await signOut(auth).catch(() => {});
  }, []);

  // Register a brand-new athlete atomically via Client SDK Firebase Auth + single-use invite token
  const registerWithInvite = useCallback(
    async (params: {
      token: string;
      name: string;
      email: string;
      password?: string;
      avatar: string;
      goal: string;
      useGoogle?: boolean;
    }): Promise<{ success: boolean; message: string }> => {
      manualAuthInProgressRef.current = true;
      let createdFreshPasswordUser: User | null = null;
      let signedInWithGoogle = false;

      try {
        let finalEmail = params.email.trim().toLowerCase();
        let finalName = params.name.trim();

        if (params.useGoogle) {
          const cred = await signInWithPopup(auth, googleProvider);
          signedInWithGoogle = true;
          finalEmail = String(cred.user.email || finalEmail).trim().toLowerCase();
          finalName = finalName || cred.user.displayName || finalEmail.split('@')[0] || 'Atleta';
        } else {
          const pwd = String(params.password || '');
          if (!finalName) {
            return { success: false, message: 'El nombre del atleta es obligatorio.' };
          }
          if (!finalEmail || !finalEmail.includes('@')) {
            return { success: false, message: 'Ingresa un correo electrónico válido.' };
          }
          if (pwd.length < 6) {
            return { success: false, message: 'La contraseña debe tener al menos 6 caracteres.' };
          }
          const cred = await createUserWithEmailAndPassword(auth, finalEmail, pwd);
          createdFreshPasswordUser = cred.user;
          await updateFirebaseProfile(cred.user, { displayName: finalName }).catch(() => {});
        }

        const res = await registerAthleteWithInvite({
          token: params.token,
          name: finalName,
          email: finalEmail,
          avatar: params.avatar,
          goal: params.goal,
        });

        if (!res.success || !res.athleteId || !res.profile) {
          if (createdFreshPasswordUser) {
            await createdFreshPasswordUser.delete().catch(() => signOut(auth).catch(() => {}));
          } else if (signedInWithGoogle) {
            await signOut(auth).catch(() => {});
          }
          return {
            success: false,
            message: res.error || 'No se pudo completar el registro con el código de invitación.',
          };
        }

        const currentUid = auth.currentUser?.uid || res.authUid || '';
        await finalizeAuthenticatedSession({
          uid: currentUid,
          athleteId: res.athleteId,
          isAdmin: false,
          profile: res.profile,
        });

        return {
          success: true,
          message: `¡Cuenta activada con Firebase Auth! Bienvenido, ${res.profile.name}.`,
        };
      } catch (err: any) {
        if (createdFreshPasswordUser) {
          await createdFreshPasswordUser.delete().catch(() => signOut(auth).catch(() => {}));
        } else if (signedInWithGoogle) {
          await signOut(auth).catch(() => {});
        }
        const code = String(err?.code || '');
        if (code === 'auth/popup-closed-by-user') {
          return { success: false, message: 'Registro con Google cancelado.' };
        }
        if (code === 'auth/email-already-in-use') {
          return {
            success: false,
            message: 'Este correo ya está registrado en Firebase Auth. Inicia sesión o usa Google.',
          };
        }
        return {
          success: false,
          message: err?.message || 'Error al registrar cuenta con código de invitación.',
        };
      } finally {
        manualAuthInProgressRef.current = false;
      }
    },
    [finalizeAuthenticatedSession]
  );

  // Link provisional legacy session to permanent Google identity
  const linkGoogleAccount = useCallback(async (): Promise<{ success: boolean; message: string }> => {
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        return { success: false, message: 'Inicia sesión primero.' };
      }

      const linkedCred = await linkWithPopup(currentUser, googleProvider);
      const idToken = await linkedCred.user.getIdToken(true);
      const res = await safeApiFetchJson<Record<string, any>>('/api/auth/confirm-migration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ linkedProvider: 'google.com' }),
      });
      const data = res.data || {};
      if (!res.ok || !res.isJson) {
        return {
          success: false,
          message: res.error || data?.error || 'No se pudo confirmar la vinculación.',
        };
      }

      await refreshAuthSession(linkedCred.user);
      setProfiles((prev) =>
        prev.map((p) =>
          p.id === activeProfileIdRef.current
            ? { ...p, migrationStatus: 'verified', email: linkedCred.user.email || p.email }
            : p
        )
      );
      return { success: true, message: '¡Cuenta vinculada con Google de forma permanente!' };
    } catch (err: any) {
      if (err?.code === 'auth/credential-already-in-use') {
        return { success: false, message: 'Ese correo Google ya está vinculado a otra cuenta.' };
      }
      if (err?.code === 'auth/popup-closed-by-user') {
        return { success: false, message: 'Vinculación cancelada.' };
      }
      return { success: false, message: err?.message || 'Error al vincular con Google.' };
    }
  }, [refreshAuthSession]);

  const logout = useCallback(async () => {
    pendingLegacyVerificationRef.current = false;
    sessionInitializedUidRef.current = null;
    setServerAdminVerified(false);
    setAdminRequiresGoogleSignIn(false);
    setSessionAthleteId(null);
    setIsLoggedIn(false);
    try {
      localStorage.removeItem('lazcakon_is_logged_in');
    } catch {}
    await signOut(auth).catch(() => {});
  }, []);

  const deleteProfile = useCallback(
    async (profileId: string) => {
      if (!isAdmin) return;
      const target = profiles.find((p) => p.id === profileId);
      if (target?.isAdmin) {
        console.warn('La cuenta del Administrador es el eje central del sistema y no puede ser eliminada.');
        return;
      }

      setProfiles((prev) => prev.filter((p) => p.id !== profileId));

      try {
        localStorage.removeItem(`lazcakon_${profileId}_routines`);
        localStorage.removeItem(`lazcakon_${profileId}_history`);
        localStorage.removeItem(`lazcakon_${profileId}_prs`);
        localStorage.removeItem(`lazcakon_${profileId}_bodyweight`);
        localStorage.removeItem(`lazcakon_${profileId}_alternatives`);
        localStorage.removeItem(`lazcakon_${profileId}_custom_links`);
        localStorage.removeItem(`lazcakon_${profileId}_active_session`);
        localStorage.removeItem(`lazcakon_${profileId}_rest_timer`);
      } catch {}

      if (activeProfileId === profileId) {
        const remaining = profiles.filter((p) => p.id !== profileId);
        const adminFallback =
          remaining.find((p) => p.id === sessionAthleteId || p.isAdmin) ||
          remaining[0];
        if (adminFallback) {
          setActiveProfileId(adminFallback.id);
        }
      }

      await deleteAthleteFromCloud(profileId, activeProfile.name || 'Admin');
    },
    [isAdmin, profiles, activeProfileId, sessionAthleteId, activeProfile.name]
  );

  const updateProfile = useCallback(
    (updates: Partial<Profile>) => {
      const sanitizedUpdates = { ...updates };
      delete (sanitizedUpdates as any).pin;
      delete (sanitizedUpdates as any).isAdmin;
      delete (sanitizedUpdates as any).authUid;

      setProfiles((prev) => {
        const next = prev.map((p) => (p.id === activeProfileId ? { ...p, ...sanitizedUpdates } : p));
        const updated = next.find((p) => p.id === activeProfileId);
        if (updated && authUser) {
          saveAthleteToCloud(updated).catch(() => {});
        }
        return next;
      });
    },
    [activeProfileId, authUser]
  );

  const refreshAthletesFromCloud = useCallback(async (): Promise<{ success: boolean; count: number }> => {
    try {
      if (!authUser) return { success: false, count: 0 };
      const { profiles: cloudList, deletedIds } = await fetchAthletesFromCloud({
        isAdmin,
        athleteId: sessionAthleteId || activeProfileId,
      });
      if (cloudList && cloudList.length > 0) {
        const activeList = cloudList.filter((p) => !deletedIds.has(p.id));
        setProfiles(activeList);
        return { success: true, count: activeList.length };
      }
      return { success: true, count: 0 };
    } catch {
      return { success: false, count: 0 };
    }
  }, [authUser, isAdmin, sessionAthleteId, activeProfileId]);

  // Custom links
  const addCustomLink = useCallback(
    (exerciseId: string, title: string, url: string) => {
      setCustomLinks((prev) => {
        const list = prev[exerciseId] || [];
        return {
          ...prev,
          [exerciseId]: [...list, { id: `link-${Date.now()}`, title, url }],
        };
      });
    },
    []
  );

  const deleteCustomLink = useCallback((exerciseId: string, linkId: string) => {
    setCustomLinks((prev) => {
      const list = prev[exerciseId] || [];
      return {
        ...prev,
        [exerciseId]: list.filter((l) => l.id !== linkId),
      };
    });
  }, []);

  // Routines CRUD (preservando múltiples planificaciones por día identificadas por ID único)
  const createRoutine = useCallback(
    (routine: Routine) => {
      const canonicalDay = resolveCanonicalDay(routine.dayName, routine.title) || 'Lunes';
      const normalizedRoutine: Routine = {
        ...routine,
        dayName: canonicalDay,
        exercises: (routine.exercises || []).map((ex) => ({
          ...ex,
          defaultSets: getSafeExerciseSets(ex),
          dia: canonicalDay,
          day: canonicalDay,
        })),
      };
      const targetProfileId = activeProfileIdRef.current;
      setRoutines((prev) => {
        const existsById = prev.some((r) => r.id === normalizedRoutine.id);
        const rawNext = existsById
          ? prev.map((r) => (r.id === normalizedRoutine.id ? normalizedRoutine : r))
          : [...prev, normalizedRoutine];
        const next = consolidateWeeklyRoutines(rawNext);
        localStorage.setItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify(next));
        syncUserDataToFirebase(targetProfileId, { routines: next }).catch(() => {});
        return next;
      });
    },
    [activeProfileId]
  );

  const updateRoutine = useCallback(
    (routine: Routine) => {
      const canonicalDay = resolveCanonicalDay(routine.dayName, routine.title) || 'Lunes';
      const normalizedRoutine: Routine = {
        ...routine,
        dayName: canonicalDay,
        exercises: (routine.exercises || []).map((ex) => ({
          ...ex,
          defaultSets: getSafeExerciseSets(ex),
          dia: canonicalDay,
          day: canonicalDay,
        })),
      };
      const targetProfileId = activeProfileIdRef.current;
      setRoutines((prev) => {
        const existsById = prev.some((r) => r.id === normalizedRoutine.id);
        const rawNext = existsById
          ? prev.map((r) => (r.id === normalizedRoutine.id ? normalizedRoutine : r))
          : [...prev, normalizedRoutine];
        const next = consolidateWeeklyRoutines(rawNext);
        localStorage.setItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify(next));
        syncUserDataToFirebase(targetProfileId, { routines: next }).catch(() => {});
        return next;
      });
    },
    [activeProfileId]
  );

  const deleteRoutine = useCallback(
    (routineId: string) => {
      setRoutines((prev) => {
        const next = prev.filter((r) => r.id !== routineId);
        localStorage.setItem(`lazcakon_${activeProfileId}_routines`, JSON.stringify(next));
        syncUserDataToFirebase(activeProfileId, { routines: next }).catch(() => {});
        return next;
      });
    },
    [activeProfileId]
  );

  const clearAllRoutines = useCallback(() => {
    const snap = createPreImportBackupSnapshot(
      activeProfileIdRef.current,
      activeProfileNameRef.current,
      {
        routines: routinesRef.current,
        history: historyRef.current,
        prs: prsRef.current,
        bodyWeightLogs: bodyWeightLogsRef.current,
        customLinks: customLinksRef.current,
        selectedAlternatives: selectedAlternativesRef.current,
      },
      'Antes de vaciar rutinas'
    );
    setPreImportBackup(snap);
    setRoutines([]);
    localStorage.setItem(`lazcakon_${activeProfileId}_routines`, JSON.stringify([]));
    syncUserDataToFirebase(activeProfileId, { routines: [] }).catch(() => {});
  }, [activeProfileId]);

  const resetRoutinesToDefault = useCallback(() => {
    const snap = createPreImportBackupSnapshot(
      activeProfileIdRef.current,
      activeProfileNameRef.current,
      {
        routines: routinesRef.current,
        history: historyRef.current,
        prs: prsRef.current,
        bodyWeightLogs: bodyWeightLogsRef.current,
        customLinks: customLinksRef.current,
        selectedAlternatives: selectedAlternativesRef.current,
      },
      'Antes de restablecer rutinas'
    );
    setPreImportBackup(snap);
    setRoutines([]);
    localStorage.setItem(`lazcakon_${activeProfileId}_routines`, JSON.stringify([]));
    syncUserDataToFirebase(activeProfileId, { routines: [] }).catch(() => {});
  }, [activeProfileId]);

  // Versioned, sanitized, integrity-verified JSON Backup (zero PINs, emails, or tokens)
  const exportBackupJSON = useCallback(() => {
    const backupDoc = createSanitizedProfileBackup({
      profile: activeProfile,
      routines: routinesRef.current,
      history: historyRef.current,
      prs: prsRef.current,
      bodyWeightLogs: bodyWeightLogsRef.current,
      customLinks: customLinksRef.current,
      selectedAlternatives: selectedAlternativesRef.current,
    });
    const safeName = (activeProfile.name || 'atleta')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_');
    const fileName = `lazcakongym_respaldo_${safeName}_v${backupDoc.schemaVersion}_${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    const blob = new Blob([JSON.stringify(backupDoc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return {
      success: true,
      fileName,
      message: `Respaldo ${fileName} descargado (${backupDoc.integrity.counts.routines} rutinas, ${backupDoc.integrity.counts.history} sesiones, ${backupDoc.integrity.counts.prs} PRs).`,
    };
  }, [activeProfile]);

  const inspectBackupJSON = useCallback(
    (jsonData: string): BackupInspectionResult => {
      return inspectBackupForRestore({
        rawJson: jsonData,
        targetProfile: activeProfile,
        currentState: {
          routines: routinesRef.current,
          history: historyRef.current,
          prs: prsRef.current,
          bodyWeightLogs: bodyWeightLogsRef.current,
          customLinks: customLinksRef.current,
          selectedAlternatives: selectedAlternativesRef.current,
        },
      });
    },
    [activeProfile]
  );

  const importBackupJSON = useCallback(
    (
      jsonData: string,
      options?: {
        strategy?: BackupRestoreStrategy;
        confirmed?: boolean;
        confirmReplaceExplicit?: boolean;
        authorizeCrossProfile?: boolean;
        restorePreferences?: boolean;
      }
    ) => {
      const targetProfileId = activeProfileIdRef.current;
      const result = executeSafeBackupRestore({
        rawJson: jsonData,
        targetProfile: activeProfile,
        currentState: {
          routines: routinesRef.current,
          history: historyRef.current,
          prs: prsRef.current,
          bodyWeightLogs: bodyWeightLogsRef.current,
          customLinks: customLinksRef.current,
          selectedAlternatives: selectedAlternativesRef.current,
        },
        strategy: options?.strategy || 'merge_safe',
        confirmed: Boolean(options?.confirmed),
        confirmReplaceExplicit: Boolean(options?.confirmReplaceExplicit),
        authorizeCrossProfile: Boolean(options?.authorizeCrossProfile),
        restorePreferences: Boolean(options?.restorePreferences),
      });

      if (!result.success || !result.nextState) {
        return { success: false, message: result.message };
      }

      if (activeProfileIdRef.current === targetProfileId) {
        setRoutines(result.nextState.routines);
        setHistory(result.nextState.history);
        setPrs(result.nextState.prs);
        setBodyWeightLogs(result.nextState.bodyWeightLogs);
        setCustomLinks(result.nextState.customLinks);
        setSelectedAlternatives(result.nextState.selectedAlternatives);
        if (result.backupSnapshot) {
          setPreImportBackup(result.backupSnapshot);
        }
        if (result.nextState.profileUpdates) {
          updateProfile(result.nextState.profileUpdates);
        }
      }

      if (result.cloudPatch && Object.keys(result.cloudPatch).length > 0) {
        syncUserDataToFirebase(targetProfileId, result.cloudPatch).catch(() => {});
      }

      return { success: true, message: result.message };
    },
    [activeProfile, updateProfile]
  );

  // Importación segura (Excel, CSV, JSON, PDF, Imagen):
  // - Respaldo automático previo obligatorio
  // - Conserva rutinas previas por defecto ('append_new')
  // - Jamás sobrescribe entrenamientos completados, cargas, PRs, historial ni mapa muscular
  // - Aislada estrictamente al `activeProfileId`
  const importGymCsvData = useCallback((data: SafeImportPayload) => {
    const targetProfileId = activeProfileIdRef.current;
    const res = executeSafeImportPersistence({
      profileId: targetProfileId,
      profileName: activeProfileNameRef.current,
      athleteWeightKg: activeWeightRef.current || 95,
      currentState: {
        routines: routinesRef.current,
        history: historyRef.current,
        prs: prsRef.current,
        bodyWeightLogs: bodyWeightLogsRef.current,
        customLinks: customLinksRef.current,
        selectedAlternatives: selectedAlternativesRef.current,
      },
      payload: data,
    });

    if (activeProfileIdRef.current === targetProfileId) {
      if (data.routines && data.routines.length > 0) {
        setRoutines(res.nextRoutines);
      }
      if (res.historyModified) {
        setHistory(res.nextHistory);
      }
      if (res.prsModified) {
        setPrs(res.nextPrs);
      }
      setPreImportBackup(res.backupSnapshot);
    }

    if (Object.keys(res.cloudPatch).length > 0) {
      syncUserDataToFirebase(targetProfileId, res.cloudPatch).catch(() => {});
    }

    return {
      success: true,
      routinesCount: res.routinesCount,
      workoutsCount: res.workoutsAddedCount,
      prsCount: res.prsUpdatedCount,
      routineNames: res.routineNames,
      effectiveMode: res.effectiveMode,
      backupId: res.backupSnapshot.id,
    };
  }, []);

  // Restaurar respaldo automático previo a una importación (aislado por perfil)
  const restorePreImportBackup = useCallback((backupId?: string) => {
    try {
      const targetProfileId = activeProfileIdRef.current;
      const { restored, cloudPatch } = restorePreImportBackupSnapshot(targetProfileId, backupId);

      if (activeProfileIdRef.current === targetProfileId) {
        setRoutines(restored.routines);
        setHistory(restored.history);
        setPrs(restored.prs);
        setBodyWeightLogs(restored.bodyWeightLogs);
        setCustomLinks(restored.customLinks);
        setSelectedAlternatives(restored.selectedAlternatives);
      }

      syncUserDataToFirebase(targetProfileId, cloudPatch).catch(() => {});

      return {
        success: true,
        message: `Respaldo previo restaurado (${restored.routinesCount} rutinas, ${restored.historyCount} entrenamientos, ${restored.prsCount} PRs).`,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'No se pudo restaurar el respaldo previo.',
      };
    }
  }, []);

  // Ejecutar purga manual y sincronización con Base de Datos (Data Purge)
  const purgeCorruptedHistory = useCallback(() => {
    const result = purgeAndSanitizeWorkoutHistory(history, activeProfile?.weightKg || 95);
    setHistory(result.cleanedHistory);
    localStorage.setItem(`lazcakon_${activeProfileId}_history`, JSON.stringify(result.cleanedHistory));
    syncUserDataToFirebase(activeProfileId, { history: result.cleanedHistory }).catch(() => {});
    return result;
  }, [history, activeProfileId, activeProfile?.weightKg]);

  // Cloud sync with offline fallback queueing
  const syncToCloud = useCallback(async () => {
    const payload = {
      profile: activeProfile,
      routines,
      history,
      prs,
      customLinks,
      selectedAlternatives,
      bodyWeightLogs,
    };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      queueOfflineSync(activeProfile.id, payload);
      return {
        success: true,
        message: 'Sesión guardada en almacenamiento local. Se sincronizará automáticamente al conectar a internet.',
      };
    }
    const res = await syncUserDataToFirebase(activeProfile.id, payload);
    if (!res.success) {
      queueOfflineSync(activeProfile.id, payload);
    }
    return res;
  }, [activeProfile, routines, history, prs, customLinks, selectedAlternatives, bodyWeightLogs]);

  const addBodyWeightLog = useCallback((weightKg: number, bodyFatPct?: number, note?: string) => {
    const newEntry: BodyWeightEntry = {
      id: `bw-${Date.now()}`,
      date: new Date().toISOString(),
      weightKg,
      bodyFatPct,
      note,
    };
    setBodyWeightLogs((prev) => [newEntry, ...prev]);
  }, []);

  // Clean all data of an athlete (history, PRs, weight logs, active session) with pre-clean safety backup
  const cleanAthleteData = useCallback((targetProfileId: string) => {
    try {
      if (targetProfileId === activeProfileIdRef.current) {
        const snap = createPreImportBackupSnapshot(
          targetProfileId,
          activeProfileNameRef.current,
          {
            routines: routinesRef.current,
            history: historyRef.current,
            prs: prsRef.current,
            bodyWeightLogs: bodyWeightLogsRef.current,
            customLinks: customLinksRef.current,
            selectedAlternatives: selectedAlternativesRef.current,
          },
          'Antes de limpiar historial a cero'
        );
        setPreImportBackup(snap);
      }

      localStorage.setItem(`lazcakon_${targetProfileId}_history`, JSON.stringify([]));
      localStorage.setItem(`lazcakon_${targetProfileId}_prs`, JSON.stringify({}));
      localStorage.setItem(`lazcakon_${targetProfileId}_bodyweight`, JSON.stringify([]));
      localStorage.setItem(`lazcakon_${targetProfileId}_alternatives`, JSON.stringify({}));
      localStorage.removeItem(`lazcakon_${targetProfileId}_active_session`);

      if (targetProfileId === activeProfileId) {
        setHistory([]);
        setPrs({});
        setBodyWeightLogs([]);
        setActiveSession(null);
        setSelectedAlternatives({});
      }

      // Sync cleaned state to Firestore
      syncUserDataToFirebase(targetProfileId, {
        history: [],
        prs: {},
        bodyWeightLogs: [],
        activeSession: null,
        lastCleanedAt: new Date().toISOString(),
      }).catch(() => {});
    } catch (e) {
      console.warn('Error cleaning athlete data:', e);
    }
  }, [activeProfileId]);

  const deleteBodyWeightLog = useCallback((id: string) => {
    setBodyWeightLogs((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const enrichedRoutines = useMemo(() => getEnrichedDefaultRoutines(routines), [routines]);

  return {
    isLoggedIn,
    authLoading,
    login: (profileId: string) => {
      if (isAdmin && authUser) {
        setActiveProfileId(profileId);
      }
    },
    logout,
    loginWithEmailPin,
    loginWithGoogle,
    verifyAndLinkLegacyProfile,
    cancelLegacyVerification,
    registerWithInvite,
    linkGoogleAccount,
    profiles,
    activeProfileId,
    activeProfile,
    isAdmin,
    adminRequiresGoogleSignIn,
    switchProfile,
    createProfile,
    deleteProfile,
    updateProfile,
    cleanAthleteData,
    refreshAthletesFromCloud,

    // Read-only media projection; keep persistent IDs and records intact.
    routines: enrichedRoutines,
    createRoutine,
    updateRoutine,
    deleteRoutine,
    clearAllRoutines,
    resetRoutinesToDefault,

    // Alternatives & Links
    selectedAlternatives,
    toggleExerciseAlternative,
    replaceActiveExerciseWithAI,
    customLinks,
    addCustomLink,
    deleteCustomLink,

    // Active session
    activeSession,
    startWorkout,
    startFreeWorkout,
    addExerciseToActiveSession,
    removeExerciseFromActiveSession,
    addWarmupSetsToExercise,
    updateSet,
    updateExerciseRestSeconds,
    addSetToExercise,
    removeSetFromExercise,
    updateExerciseNotes,
    finishWorkout,
    cancelWorkout,

    // Rest timer
    restTimer,
    startRestTimer,
    stopRestTimer,
    pauseRestTimer,
    resumeRestTimer,
    restartRestTimer,
    adjustRestTimer,
    toggleRestTimerMinimized,

    // Records, History & Analytics
    history,
    prs,
    bodyWeightLogs,
    addBodyWeightLog,
    deleteBodyWeightLog,

    // Backup & Cloud
    preImportBackup,
    restorePreImportBackup,
    exportBackupJSON,
    inspectBackupJSON,
    importBackupJSON,
    importGymCsvData,
    purgeCorruptedHistory,
    syncToCloud,
  };
}
