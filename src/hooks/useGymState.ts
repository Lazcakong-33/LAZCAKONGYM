import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Profile,
  Routine,
  ActiveWorkoutSession,
  CompletedWorkout,
  PersonalRecord,
  RestTimerState,
  RestCompleteNotice,
  BodyWeightEntry,
  WorkoutSyncStatus,
  SyncOperationType,
  PendingOfflineSyncOp,
  LogoutSafetyStatus,
} from '../types';
import { DEFAULT_PROFILES } from '../data/defaultProfiles';
import { calculateWorkoutCaloriesBurned, getChileLocalDateKey, resolveWorkoutChileDateKey } from '../utils/calorieCalculator';
import {
  purgeAndSanitizeWorkoutHistory,
  sanitizeRoutineTitleForDate,
  sanitizeWorkoutDurationSeconds,
} from '../utils/historySanitizer';
import { DEFAULT_ROUTINES } from '../data/defaultRoutines';
import { getEnrichedDefaultRoutines } from '../utils/enrichRoutines';
import { generateSeedHistory } from '../data/seedHistory';
import { resolveLibraryExercise } from '../data/exerciseLibrary';
import { buildTechniqueProProfile } from '../utils/exerciseAlternatives';
import { findPreviousExerciseSessions } from '../utils/progressionEngine';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile as updateFirebaseProfile,
  signOut,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth';
import { auth } from '../firebase';
import {
  signInWithGoogleHybrid,
  linkWithGoogleHybrid,
  signOutNativeGoogleCache,
  getGoogleAuthOperationLabel,
} from '../utils/nativeAuth';
import {
  scheduleNativeRestNotification,
  cancelNativeRestNotification,
  pauseNativeOngoingRestNotification,
  markNativeRestCompleted,
  consumePendingNativeRestSync,
  getNativeNotificationPermission,
  requestNativeNotificationPermission,
  isCapacitorAndroidRuntime,
  NATIVE_REST_STATE_SYNC_EVENT,
  type NativeRestStateSnapshot,
} from '../utils/nativeNotifications';
import { useAuth } from '../components/AuthProvider';
import { isEffectiveFrontendAdmin } from '../utils/adminAuthCriterion';
import { safeApiFetchJson } from '../utils/safeApiFetch';
import {
  playBeep,
  playRestCompleteAlarm,
  releaseTimerAudioResources,
  REST_COMPLETE_VIBRATION_PATTERN,
  triggerNativeAndWebVibration,
  vibrateDevice,
  cancelDeviceVibration,
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
  getOfflineSyncQueue,
  getOfflineSyncQueueSummary,
  hasPendingSyncOperationType,
  subscribeOfflineSyncQueue,
  processPendingOfflineSyncs,
  subscribeUserDataFromCloud,
  fetchAllAthleteHistorySourcesFromFirebase,
  getLastOfflineQueueStorageError,
  type CloudAthleteDocSnapshot,
} from '../utils/firebaseSync';
import {
  generateStableId,
  deriveRirFromRpe,
  ensureSessionStableIds,
  computeActiveSessionElapsedMs,
  pauseActiveWorkoutSession,
  resumeActiveWorkoutSession,
  clearActiveSessionUiState,
  reconcileActiveSessionWithCloud,
  reconcilePersonalRecordsMap,
  reconcileRoutinesWithCloud,
  reconcileBodyWeightLogs,
} from '../utils/workoutPersistence';
import {
  canResumeInstantLocalSession,
  canResumeOfflineAuthenticatedSession,
  clearOfflineSessionBinding,
  evaluateLogoutSafetyStatus,
  getOfflineSessionBinding,
  resolvePostOfflineReconnectOutcome,
  saveOfflineSessionBinding,
} from '../utils/offlineSessionManager';
import { markStartupTiming, setStartupFlag } from '../utils/startupPerf';
import { safeLocalStorageSetItem } from '../utils/safeStorage';
import { subscribeAppLifecycleResume } from '../utils/capacitorPlatform';
import {
  backupAllRawSourcesBeforeRepair,
  collectAllLocalHistorySources,
  reconcileAndUnifyAthleteHistory,
  reconcilePersonalRecordsFromHistory,
  summarizeHistoryMetrics,
  RAW_UNFILTERED_BACKUP_KEY,
  type AthleteHistoryInventoryReport,
  type HistoryConflictRecord,
  type NamedHistorySourceInput,
} from '../utils/historyRecoveryEngine';
import { applyThemeToRoot, normalizeThemeAccent } from '../utils/theme';
import {
  startBackgroundTicker,
  stopBackgroundTicker,
  enableScreenWakeLock,
  disableScreenWakeLock,
  REST_COMPLETE_NOTIFICATION_TITLE,
  clearRestCompleteNotifications,
  showOrUpdateActiveRestNotification,
  dismissActiveRestNotification,
  resolveNextRestTargetContext,
  sendRestCompleteNotification,
  sendFiveSecondWarningNotification,
  notifyServiceWorkerRestAlarmHandled,
  cancelServiceWorkerRestAlarm,
  scheduleServiceWorkerRestAlarm,
  hasCompleteAlertFired,
  markCompleteAlertHandled,
  resetCompleteAlertTracking,
} from '../utils/backgroundTimer';
import {
  createRestAlarmId,
  scheduleServerRestAlarmPush,
  cancelServerRestAlarmPush,
} from '../utils/webPushClient';

export { resolveNextRestTargetContext };

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
import {
  extractRestSeconds,
  isRdlBarbellExercise,
  isBulgarianDumbbellExercise,
} from '../utils/routineImporterHelpers';
import { formatDetailedRest } from '../utils/restFormatter';
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

export const sanitizeRoutinesRdlRest = (routines: Routine[]): Routine[] => {
  if (!Array.isArray(routines)) return [];
  let changed = false;
  const updatedRoutines = routines.map((routine) => {
    if (!routine || !Array.isArray(routine.exercises)) return routine;
    let routineChanged = false;
    const updatedExercises = routine.exercises.map((ex) => {
      if (!ex) return ex;
      const isRdl =
        isRdlBarbellExercise(ex.name) ||
        isRdlBarbellExercise(ex.alternative) ||
        ex.id === 'hip-rdl' ||
        ex.libraryExerciseId === 'hip-rdl';
      const isBulgarian =
        isBulgarianDumbbellExercise(ex.name) ||
        isBulgarianDumbbellExercise(ex.alternative);

      let targetRestSec: number | null = null;
      if (isRdl) {
        targetRestSec = 150;
      } else if (isBulgarian) {
        targetRestSec = 90;
      } else if (ex.restSeconds === 1890) {
        targetRestSec = 90;
      } else if (ex.restSeconds === 1950) {
        targetRestSec = 150;
      } else if (typeof ex.restText === 'string' && (ex.restText.includes('1890') || ex.restText.includes('31:30'))) {
        targetRestSec = 90;
      } else if (typeof ex.restText === 'string' && (ex.restText.includes('1950') || ex.restText.includes('32:30'))) {
        targetRestSec = 150;
      }

      if (targetRestSec !== null) {
        const expectedFormatted = formatDetailedRest(targetRestSec);
        if (
          ex.restSeconds !== targetRestSec ||
          ex.restText !== expectedFormatted ||
          ex.descanso !== expectedFormatted
        ) {
          routineChanged = true;
          return {
            ...ex,
            restSeconds: targetRestSec,
            restText: expectedFormatted,
            descanso: expectedFormatted,
            ...((ex as any).DESCANSO !== undefined ? { DESCANSO: expectedFormatted } : {}),
          };
        }
      }
      return ex;
    });
    if (routineChanged) {
      changed = true;
      return { ...routine, exercises: updatedExercises };
    }
    return routine;
  });
  return changed ? updatedRoutines : routines;
};

export const sanitizeActiveSessionRdlRest = (
  session: ActiveWorkoutSession | null
): ActiveWorkoutSession | null => {
  if (!session || !Array.isArray(session.exercises)) return session;
  let changed = false;
  const updatedExercises = session.exercises.map((ex) => {
    if (!ex) return ex;
    const isRdl =
      isRdlBarbellExercise(ex.activeExerciseName) ||
      isRdlBarbellExercise(ex.exerciseName) ||
      isRdlBarbellExercise(ex.originalExerciseName) ||
      ex.exerciseId === 'hip-rdl' ||
      ex.libraryExerciseId === 'hip-rdl';
    const isBulgarian =
      isBulgarianDumbbellExercise(ex.activeExerciseName) ||
      isBulgarianDumbbellExercise(ex.exerciseName) ||
      isBulgarianDumbbellExercise(ex.originalExerciseName);

    let targetRestSec: number | null = null;
    if (isRdl) {
      targetRestSec = 150;
    } else if (isBulgarian) {
      targetRestSec = 90;
    } else if (ex.restSeconds === 1890) {
      targetRestSec = 90;
    } else if (ex.restSeconds === 1950) {
      targetRestSec = 150;
    }

    if (targetRestSec !== null && ex.restSeconds !== targetRestSec) {
      changed = true;
      return {
        ...ex,
        restSeconds: targetRestSec,
      };
    }
    return ex;
  });
  if (changed) {
    return {
      ...session,
      exercises: updatedExercises,
    };
  }
  return session;
};

export function useGymState() {
  const { user: authUser, loading: authLoading, isGoogleVerifiedSession, refreshAuthSession } = useAuth();
  const sessionInitializedUidRef = useRef<string | null>(null);
  const sessionServerValidatedRef = useRef<boolean>(false);
  const sessionValidationInFlightUidRef = useRef<string | null>(null);
  const adminRosterHydratedUidRef = useRef<string | null>(null);
  const activeAuthUidRef = useRef<string | null>(null);
  activeAuthUidRef.current = authUser?.uid ?? null;
  const isUnmountedRef = useRef<boolean>(false);
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);
  const manualAuthInProgressRef = useRef<boolean>(false);
  const pendingLegacyVerificationRef = useRef<boolean>(false);
  const [isManualAuthInProgress, setIsManualAuthInProgress] = useState<boolean>(false);
  const [pendingLegacyVerification, setPendingLegacyVerification] = useState<boolean>(false);
  const [bootstrappedUid, setBootstrappedUid] = useState<string | null>(null);
  const [sessionBootstrapError, setSessionBootstrapError] = useState<string | null>(null);
  const [authStatusNotice, setAuthStatusNotice] = useState<string | null>(null);
  const [bootstrapRetryNonce, setBootstrapRetryNonce] = useState<number>(0);

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
  const [isOfflineSession, setIsOfflineSession] = useState<boolean>(false);
  const isOfflineSessionRef = useRef<boolean>(false);
  isOfflineSessionRef.current = isOfflineSession;
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );
  const [serverAdminVerified, setServerAdminVerified] = useState<boolean>(false);
  const [adminRequiresGoogleSignIn, setAdminRequiresGoogleSignIn] = useState<boolean>(false);
  const [sessionAthleteId, setSessionAthleteId] = useState<string | null>(null);
  const isAdmin = isEffectiveFrontendAdmin({
    hasAuthUser: Boolean(authUser),
    isGoogleVerifiedSession,
    serverAdminVerified,
  });

  // Synchronously cover the gap between Firebase onAuthStateChanged resolving and /api/auth/session-init completing
  const needsSessionBootstrap =
    Boolean(authUser) &&
    !isLoggedIn &&
    !isManualAuthInProgress &&
    !pendingLegacyVerification &&
    !sessionBootstrapError &&
    bootstrappedUid !== authUser?.uid;
  const sessionChecking = authLoading || needsSessionBootstrap;

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0] || DEFAULT_PROFILES[0];
  const activeProfileIdRef = useRef(activeProfileId);
  activeProfileIdRef.current = activeProfileId;
  const activeWeightRef = useRef<number>(activeProfile?.weightKg || 95);
  activeWeightRef.current = activeProfile?.weightKg || 95;
  const activeSoundEnabledRef = useRef<boolean>(activeProfile?.soundEnabled !== false);
  activeSoundEnabledRef.current = activeProfile?.soundEnabled !== false;
  const activeVibrationEnabledRef = useRef<boolean>(activeProfile?.vibrationEnabled !== false);
  activeVibrationEnabledRef.current = activeProfile?.vibrationEnabled !== false;
  const activeRestEndAlertEnabledRef = useRef<boolean>(activeProfile?.restEndAlertEnabled !== false);
  activeRestEndAlertEnabledRef.current = activeProfile?.restEndAlertEnabled !== false;
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
      const hasPendingProfile = hasPendingSyncOperationType(cloudProfile.id, ['profile_update', 'full_sync']);
      const resolvedAccent = normalizeThemeAccent(
        hasPendingProfile && localMatch?.themeAccent
          ? localMatch.themeAccent
          : cloudProfile.themeAccent || localMatch?.themeAccent
      );
      const merged: Profile = {
        ...cloudProfile,
        themeAccent: resolvedAccent,
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

  // Reconcile persisted Firebase Auth session with server /api/auth/session-init & Firestore profile.
  // When Firebase Auth already confirms identity and valid local athlete data exists for the exact same UID,
  // unblock Inicio immediately from local data and complete server validation + Firestore sync in the background.
  useEffect(() => {
    if (authLoading) return;

    if (!authUser) {
      sessionInitializedUidRef.current = null;
      sessionServerValidatedRef.current = false;
      sessionValidationInFlightUidRef.current = null;
      adminRosterHydratedUidRef.current = null;
      pendingLegacyVerificationRef.current = false;
      setPendingLegacyVerification(false);
      setBootstrappedUid(null);
      setSessionBootstrapError(null);
      setServerAdminVerified(false);
      setAdminRequiresGoogleSignIn(false);
      setSessionAthleteId(null);
      setIsLoggedIn(false);
      markStartupTiming('sessionCheckingClearedMs');
      try {
        localStorage.removeItem('lazcakon_is_logged_in');
      } catch {}
      return;
    }

    if (manualAuthInProgressRef.current || pendingLegacyVerificationRef.current) {
      return;
    }

    const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (
      sessionInitializedUidRef.current === authUser.uid &&
      isLoggedIn &&
      (sessionServerValidatedRef.current || !onlineNow)
    ) {
      return;
    }

    const binding = getOfflineSessionBinding();
    const instantLocal = canResumeInstantLocalSession({
      authUserUid: authUser.uid,
      binding,
    });

    // Fast path: identity confirmed by Firebase Auth + valid local athlete binding for this exact UID.
    // Open Inicio immediately without waiting on Cloud Run cold start or slow mobile network,
    // while keeping server validation mandatory in background (with immediate revocation on 401/403/404/409).
    if (!isLoggedIn && instantLocal.allowed && instantLocal.athleteId && instantLocal.profile) {
      setServerAdminVerified(instantLocal.isAdminVerified);
      setAdminRequiresGoogleSignIn(false);
      setSessionAthleteId(instantLocal.athleteId);
      sessionInitializedUidRef.current = authUser.uid;
      sessionServerValidatedRef.current = false;
      mergeCloudProfileIntoState(
        instantLocal.profile,
        !instantLocal.isAdminVerified,
        instantLocal.isAdminVerified
      );
      if (!onlineNow) {
        setIsOfflineSession(true);
      }
      setBootstrappedUid(authUser.uid);
      setSessionBootstrapError(null);
      setAuthStatusNotice(null);
      setIsLoggedIn(true);
      setStartupFlag('usedInstantLocalResume', true);
      markStartupTiming('athleteProfileLocalReadyMs');
      markStartupTiming('sessionCheckingClearedMs');
    }

    // If offline and already resumed from verified local binding, wait for online/resume event to revalidate.
    if (!onlineNow && (instantLocal.allowed || isLoggedIn)) {
      return;
    }

    // Deduplicate concurrent validation when setIsLoggedIn(true) re-triggers this effect.
    if (sessionValidationInFlightUidRef.current === authUser.uid) {
      return;
    }
    sessionValidationInFlightUidRef.current = authUser.uid;

    const isStillActiveForUser = (uid: string) =>
      !isUnmountedRef.current &&
      activeAuthUidRef.current === uid &&
      !manualAuthInProgressRef.current;

    const bootstrapAuthenticatedSession = async (currentUser: User) => {
      const initStartedAt =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      try {
        const currentlyOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
        const latestBinding = getOfflineSessionBinding();

        if (!currentlyOnline) {
          const offlineResume = canResumeOfflineAuthenticatedSession({
            authUserUid: currentUser.uid,
            apiStatus: 0,
            isOnline: false,
            binding: latestBinding,
          });
          if (offlineResume.allowed && offlineResume.athleteId && offlineResume.profile) {
            if (!isStillActiveForUser(currentUser.uid)) return;
            setServerAdminVerified(offlineResume.isAdminVerified);
            setAdminRequiresGoogleSignIn(false);
            setSessionAthleteId(offlineResume.athleteId);
            sessionInitializedUidRef.current = currentUser.uid;
            sessionServerValidatedRef.current = false;
            mergeCloudProfileIntoState(
              offlineResume.profile,
              !offlineResume.isAdminVerified,
              offlineResume.isAdminVerified
            );
            setIsOfflineSession(true);
            setBootstrappedUid(currentUser.uid);
            setSessionBootstrapError(null);
            setAuthStatusNotice(null);
            setIsLoggedIn(true);
            markStartupTiming('athleteProfileLocalReadyMs');
            markStartupTiming('sessionCheckingClearedMs');
            return;
          }
        }

        const idToken = await currentUser.getIdToken();
        if (!isStillActiveForUser(currentUser.uid)) return;

        const hintAthleteId =
          latestBinding &&
          latestBinding.uid === currentUser.uid &&
          latestBinding.athleteId &&
          latestBinding.athleteId !== 'perfil_default'
            ? latestBinding.athleteId
            : undefined;

        const sessionResp = await safeApiFetchJson<Record<string, any>>('/api/auth/session-init', {
          method: 'POST',
          timeoutMs: 10_000,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify(hintAthleteId ? { hintAthleteId } : {}),
        });

        const initDurationMs =
          (typeof performance !== 'undefined' && typeof performance.now === 'function'
            ? performance.now()
            : Date.now()) - initStartedAt;
        markStartupTiming('serverSessionInitMs', initDurationMs);
        setStartupFlag('serverSessionInitStatus', sessionResp.status || 0);

        if (!isStillActiveForUser(currentUser.uid)) return;

        const data = sessionResp.data || {};
        if (!sessionResp.ok || !sessionResp.isJson) {
          if (sessionResp.status === 409 && data?.requiresLegacyVerification) {
            clearOfflineSessionBinding();
            pendingLegacyVerificationRef.current = true;
            if (isStillActiveForUser(currentUser.uid)) {
              sessionInitializedUidRef.current = null;
              sessionServerValidatedRef.current = false;
              setPendingLegacyVerification(true);
              setIsOfflineSession(false);
              setBootstrappedUid(null);
              setSessionBootstrapError(null);
              setServerAdminVerified(false);
              setAdminRequiresGoogleSignIn(false);
              setSessionAthleteId(null);
              setIsLoggedIn(false);
              setAuthStatusNotice(
                data?.error ||
                  'Tu cuenta requiere completar la vinculación con tu PIN heredado o código del Coach.'
              );
              markStartupTiming('sessionCheckingClearedMs');
            }
            return;
          }
          const reconnectOutcome = resolvePostOfflineReconnectOutcome({
            ok: sessionResp.ok,
            isJson: sessionResp.isJson,
            status: sessionResp.status || 0,
          });
          if (reconnectOutcome === 'revoked') {
            const realError =
              data?.error ||
              sessionResp.error ||
              'No se pudo validar tu sesión guardada. Inicia sesión nuevamente.';
            clearOfflineSessionBinding();
            await signOut(auth).catch(() => {});
            if (!isUnmountedRef.current) {
              sessionInitializedUidRef.current = null;
              sessionServerValidatedRef.current = false;
              setIsOfflineSession(false);
              setBootstrappedUid(null);
              setSessionBootstrapError(null);
              setAuthStatusNotice(realError);
              setServerAdminVerified(false);
              setAdminRequiresGoogleSignIn(false);
              setSessionAthleteId(null);
              setIsLoggedIn(false);
              markStartupTiming('sessionCheckingClearedMs');
            }
            return;
          }

          // Pure network transport failure / timeout: keep verified local session open and revalidate on reconnect
          const offlineFallback = canResumeOfflineAuthenticatedSession({
            authUserUid: currentUser.uid,
            apiStatus: sessionResp.status || 0,
            isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
            binding: latestBinding,
          });
          if (offlineFallback.allowed && offlineFallback.athleteId && offlineFallback.profile) {
            if (isStillActiveForUser(currentUser.uid)) {
              setServerAdminVerified(offlineFallback.isAdminVerified);
              setAdminRequiresGoogleSignIn(false);
              setSessionAthleteId(offlineFallback.athleteId);
              sessionInitializedUidRef.current = currentUser.uid;
              sessionServerValidatedRef.current = false;
              mergeCloudProfileIntoState(
                offlineFallback.profile,
                !offlineFallback.isAdminVerified,
                offlineFallback.isAdminVerified
              );
              setIsOfflineSession(true);
              setBootstrappedUid(currentUser.uid);
              setSessionBootstrapError(null);
              setAuthStatusNotice(null);
              setIsLoggedIn(true);
              markStartupTiming('athleteProfileLocalReadyMs');
              markStartupTiming('sessionCheckingClearedMs');
            }
            return;
          }

          throw new Error(
            sessionResp.error || data?.error || 'No se pudo validar la sesión en el servidor.'
          );
        }

        if (!data?.athleteId || !data?.profile) {
          throw new Error('El servidor no devolvió un perfil de atleta válido para esta sesión.');
        }

        const serverSaysAdmin = Boolean(data?.isAdmin);
        let tokenState = await refreshAuthSession(currentUser, false);
        if (serverSaysAdmin && !tokenState.isGoogleVerified) {
          tokenState = await refreshAuthSession(currentUser, true);
        }
        if (!isStillActiveForUser(currentUser.uid)) return;

        const verifiedAdmin = Boolean(serverSaysAdmin && tokenState.isGoogleVerified);
        const resolvedAthleteId = typeof data?.athleteId === 'string' ? data.athleteId : null;
        const initProfile = data?.profile ? (data.profile as Profile) : null;

        if (resolvedAthleteId && initProfile) {
          saveOfflineSessionBinding({
            uid: currentUser.uid,
            athleteId: resolvedAthleteId,
            isGoogleVerified: tokenState.isGoogleVerified,
            isAdminVerified: verifiedAdmin,
            profile: initProfile,
          });
        }

        setIsOfflineSession(false);
        sessionServerValidatedRef.current = true;
        setServerAdminVerified(serverSaysAdmin);
        setAdminRequiresGoogleSignIn(Boolean(data?.adminRequiresGoogleSignIn));
        setSessionAthleteId(resolvedAthleteId);
        sessionInitializedUidRef.current = currentUser.uid;
        if (verifiedAdmin) {
          adminRosterHydratedUidRef.current = currentUser.uid;
        }

        if (initProfile) {
          mergeCloudProfileIntoState(initProfile, !verifiedAdmin, verifiedAdmin);
        } else if (resolvedAthleteId && (!verifiedAdmin || activeProfileIdRef.current === 'perfil_default')) {
          setActiveProfileId(resolvedAthleteId);
        }

        setBootstrappedUid(currentUser.uid);
        setSessionBootstrapError(null);
        setAuthStatusNotice(null);
        setIsLoggedIn(true);
        markStartupTiming('athleteProfileLocalReadyMs');
        markStartupTiming('sessionCheckingClearedMs');

        // Hydrate full cloud athlete list (important for Admin) and flush offline queue in background
        fetchAthletesFromCloud({
          isAdmin: verifiedAdmin,
          athleteId: resolvedAthleteId || undefined,
        })
          .then(({ profiles: cloudProfiles, deletedIds }) => {
            if (!isStillActiveForUser(currentUser.uid)) return;
            if (cloudProfiles.length > 0) {
              setProfiles((prev) => {
                const activeCloud = cloudProfiles
                  .filter((p) => !deletedIds.has(p.id))
                  .map((cloudP) => {
                    const localMatch = prev.find((lp) => lp.id === cloudP.id);
                    const hasPendingProfile = hasPendingSyncOperationType(cloudP.id, [
                      'profile_update',
                      'full_sync',
                    ]);
                    return {
                      ...cloudP,
                      themeAccent: normalizeThemeAccent(
                        hasPendingProfile && localMatch?.themeAccent
                          ? localMatch.themeAccent
                          : cloudP.themeAccent || localMatch?.themeAccent
                      ),
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
          })
          .catch(() => {});

        processPendingOfflineSyncs({ forceNow: true }).catch(() => {});
      } catch (err) {
        const offlineFallback = canResumeOfflineAuthenticatedSession({
          authUserUid: currentUser.uid,
          apiStatus: 0,
          isOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
          binding: getOfflineSessionBinding(),
        });
        if (offlineFallback.allowed && offlineFallback.athleteId && offlineFallback.profile) {
          if (isStillActiveForUser(currentUser.uid)) {
            setServerAdminVerified(offlineFallback.isAdminVerified);
            setAdminRequiresGoogleSignIn(false);
            setSessionAthleteId(offlineFallback.athleteId);
            sessionInitializedUidRef.current = currentUser.uid;
            sessionServerValidatedRef.current = false;
            mergeCloudProfileIntoState(
              offlineFallback.profile,
              !offlineFallback.isAdminVerified,
              offlineFallback.isAdminVerified
            );
            setIsOfflineSession(true);
            setBootstrappedUid(currentUser.uid);
            setSessionBootstrapError(null);
            setAuthStatusNotice(null);
            setIsLoggedIn(true);
            markStartupTiming('athleteProfileLocalReadyMs');
            markStartupTiming('sessionCheckingClearedMs');
          }
          return;
        }

        const message =
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo comprobar tu sesión con el servidor.';
        console.warn('[Auth Session Bootstrap]:', message);
        if (isStillActiveForUser(currentUser.uid)) {
          setIsOfflineSession(false);
          setBootstrappedUid(null);
          setSessionBootstrapError(message);
          setIsLoggedIn(false);
          markStartupTiming('sessionCheckingClearedMs');
        }
      } finally {
        if (sessionValidationInFlightUidRef.current === currentUser.uid) {
          sessionValidationInFlightUidRef.current = null;
        }
      }
    };

    void bootstrapAuthenticatedSession(authUser);
  }, [authLoading, authUser, isLoggedIn, bootstrapRetryNonce, mergeCloudProfileIntoState, refreshAuthSession]);

  const retrySessionBootstrap = useCallback(() => {
    setSessionBootstrapError(null);
    setBootstrappedUid(null);
    setBootstrapRetryNonce((n) => n + 1);
  }, []);

  const clearAuthStatusNotice = useCallback(() => {
    setAuthStatusNotice(null);
  }, []);

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
            const hasPendingProfile = hasPendingSyncOperationType(own.id, ['profile_update', 'full_sync']);
            return [
              {
                ...own,
                themeAccent: normalizeThemeAccent(
                  hasPendingProfile && localMatch?.themeAccent
                    ? localMatch.themeAccent
                    : own.themeAccent || localMatch?.themeAccent
                ),
              },
            ];
          }

          const activeCloudProfiles = cloudProfiles
            .filter((p) => !deletedIds.has(p.id))
            .map((cloudP) => {
              const localMatch = prev.find((lp) => lp.id === cloudP.id);
              const hasPendingProfile = hasPendingSyncOperationType(cloudP.id, [
                'profile_update',
                'full_sync',
              ]);
              return {
                ...cloudP,
                themeAccent: normalizeThemeAccent(
                  hasPendingProfile && localMatch?.themeAccent
                    ? localMatch.themeAccent
                    : cloudP.themeAccent || localMatch?.themeAccent
                ),
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

  // Synchronize verified admin binding & athlete roster if Google token claims settle after startup soft-timeout or manual login
  useEffect(() => {
    if (authLoading || !authUser || !isLoggedIn || !isAdmin) {
      if (!authUser || !isLoggedIn) {
        adminRosterHydratedUidRef.current = null;
      }
      return;
    }

    const resolvedAthleteId = sessionAthleteId || activeProfileId;
    const currentBinding = getOfflineSessionBinding();
    if (
      currentBinding &&
      currentBinding.uid === authUser.uid &&
      (!currentBinding.isGoogleVerified || !currentBinding.isAdminVerified)
    ) {
      saveOfflineSessionBinding({
        uid: authUser.uid,
        athleteId: currentBinding.athleteId,
        isGoogleVerified: true,
        isAdminVerified: true,
        profile: currentBinding.profileSnapshot,
      });
    }

    if (!resolvedAthleteId || adminRosterHydratedUidRef.current === authUser.uid) {
      return;
    }
    adminRosterHydratedUidRef.current = authUser.uid;

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return;
    }

    let cancelled = false;
    fetchAthletesFromCloud({
      isAdmin: true,
      athleteId: resolvedAthleteId,
    })
      .then(({ profiles: cloudProfiles, deletedIds }) => {
        if (cancelled || isUnmountedRef.current || activeAuthUidRef.current !== authUser.uid) return;
        if (cloudProfiles.length > 0) {
          setProfiles((prev) => {
            const activeCloud = cloudProfiles
              .filter((p) => !deletedIds.has(p.id))
              .map((cloudP) => {
                const localMatch = prev.find((lp) => lp.id === cloudP.id);
                const hasPendingProfile = hasPendingSyncOperationType(cloudP.id, [
                  'profile_update',
                  'full_sync',
                ]);
                return {
                  ...cloudP,
                  themeAccent: normalizeThemeAccent(
                    hasPendingProfile && localMatch?.themeAccent
                      ? localMatch.themeAccent
                      : cloudP.themeAccent || localMatch?.themeAccent
                  ),
                };
              });
            return activeCloud;
          });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
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

  // Routines for active profile (eliminando cualquier rutina precargada y asegurando descanso de 150s en RDL)
  const [routines, setRoutines] = useState<Routine[]>(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_routines`);
      if (stored) {
        const parsed = JSON.parse(stored);
        const filtered = filterOutPreloadedRoutines(parsed);
        const sanitized = sanitizeRoutinesRdlRest(filtered);
        localStorage.setItem(`lazcakon_${activeProfileId}_routines`, JSON.stringify(sanitized));
        return sanitized;
      }
    } catch {}
    return [];
  });

  useEffect(() => {
    if (loadedProfileId !== activeProfileId) return;
    safeLocalStorageSetItem(`lazcakon_${activeProfileId}_routines`, JSON.stringify(routines), {
      critical: true,
      onQuotaError: (msg) => {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(msg);
      },
    });
  }, [routines, activeProfileId, loadedProfileId]);

  // Limpieza global automática: purgar rutinas precargadas y sanear descansos RDL en rutinas y sesiones activas
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
              const sanitized = sanitizeRoutinesRdlRest(cleaned);
              const hasChanged = sanitized !== parsed || cleaned.length !== parsed.length;
              if (hasChanged) {
                safeLocalStorageSetItem(key, JSON.stringify(sanitized), { critical: true });
              }
            }
          }
        }
        if (key && key.startsWith('lazcakon_') && key.endsWith('_active_session')) {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            const sanitized = sanitizeActiveSessionRdlRest(parsed);
            if (sanitized !== parsed) {
              safeLocalStorageSetItem(key, JSON.stringify(sanitized), { critical: true });
            }
          }
        }
      }
    } catch (e) {
      console.warn('Error purgando rutinas o saneando descansos RDL:', e);
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
    safeLocalStorageSetItem(`lazcakon_${activeProfileId}_alternatives`, JSON.stringify(selectedAlternatives), {
      critical: false,
    });
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
    safeLocalStorageSetItem(`lazcakon_${activeProfileId}_custom_links`, JSON.stringify(customLinks), {
      critical: false,
    });
  }, [customLinks, activeProfileId, loadedProfileId]);

  // Workout History con respaldo íntegro previo y unión sin pérdidas de todas las fuentes locales
  const [history, setHistory] = useState<CompletedWorkout[]>(() => {
    try {
      backupAllRawSourcesBeforeRepair(activeProfileId);
      const localSources = collectAllLocalHistorySources(activeProfileId);
      if (localSources.length > 0) {
        const unified = reconcileAndUnifyAthleteHistory(localSources, activeProfile?.weightKg || 95);
        if (unified.unifiedHistory.length > 0) {
          localStorage.setItem(`lazcakon_${activeProfileId}_history`, JSON.stringify(unified.unifiedHistory));
          return unified.unifiedHistory;
        }
      }
      const stored = localStorage.getItem(`lazcakon_${activeProfileId}_history`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const { cleanedHistory } = purgeAndSanitizeWorkoutHistory(
            parsed,
            activeProfile?.weightKg || 95
          );
          return cleanedHistory;
        }
      }
    } catch {}
    return [];
  });

  // Estado de sincronización del historial con Cloud Firestore para distinguir "primera sesión" vs "pendiente" vs "error"
  const [isHistorySyncing, setIsHistorySyncing] = useState<boolean>(false);
  const [historySyncError, setHistorySyncError] = useState<string | null>(null);
  const [workoutSyncStatus, setWorkoutSyncStatus] = useState<WorkoutSyncStatus>(() => {
    try {
      const hasPending = getOfflineSyncQueue().some((q) => q.profileId === activeProfileId);
      return hasPending ? 'pending_sync' : 'saved_local';
    } catch {
      return 'saved_local';
    }
  });
  const [workoutSyncError, setWorkoutSyncError] = useState<string | null>(null);
  const workoutSyncSeqRef = useRef<number>(0);
  const [historyInventory, setHistoryInventory] = useState<AthleteHistoryInventoryReport | null>(null);
  const [historyConflicts, setHistoryConflicts] = useState<HistoryConflictRecord[]>([]);
  const [pendingSyncOps, setPendingSyncOps] = useState<PendingOfflineSyncOp[]>(() =>
    getOfflineSyncQueueSummary(activeProfileId).pendingOps
  );
  const pendingSyncCount = pendingSyncOps.length;
  const lastSyncError = useMemo(
    () => [...pendingSyncOps].reverse().find((op) => Boolean(op.lastError))?.lastError || workoutSyncError,
    [pendingSyncOps, workoutSyncError]
  );

  useEffect(() => {
    const syncQueueUi = () => {
      const summary = getOfflineSyncQueueSummary(activeProfileIdRef.current);
      setPendingSyncOps(summary.pendingOps);
    };
    syncQueueUi();
    return subscribeOfflineSyncQueue(syncQueueUi);
  }, [activeProfileId]);

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
    safeLocalStorageSetItem(`lazcakon_${activeProfileId}_history`, JSON.stringify(history), {
      critical: true,
      onQuotaError: (msg) => {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(msg);
      },
    });
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
    safeLocalStorageSetItem(`lazcakon_${activeProfileId}_prs`, JSON.stringify(prs), {
      critical: true,
      onQuotaError: (msg) => {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(msg);
      },
    });
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
    safeLocalStorageSetItem(`lazcakon_${activeProfileId}_bodyweight`, JSON.stringify(bodyWeightLogs), {
      critical: true,
      onQuotaError: (msg) => {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(msg);
      },
    });
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
      if (stored) return sanitizeActiveSessionRdlRest(ensureSessionStableIds(JSON.parse(stored)));
    } catch {}
    return null;
  });
  const activeSessionRef = useRef<ActiveWorkoutSession | null>(activeSession);
  activeSessionRef.current = activeSession;

  // Saneamiento proactivo en memoria para asegurar descansos de 150s en RDL de rutina y sesión activa cargadas
  useEffect(() => {
    setRoutines((prev) => {
      const sanitized = sanitizeRoutinesRdlRest(prev);
      return sanitized !== prev ? sanitized : prev;
    });
    setActiveSession((prev) => {
      const sanitized = sanitizeActiveSessionRdlRest(prev);
      if (sanitized !== prev) {
        activeSessionRef.current = sanitized;
        return sanitized;
      }
      return prev;
    });
  }, []);

  const isLoggedInRef = useRef<boolean>(isLoggedIn);
  isLoggedInRef.current = isLoggedIn;
  const authUserRef = useRef<User | null>(authUser);
  authUserRef.current = authUser;

  useEffect(() => {
    if (!activeSession) {
      isFinishingWorkoutRef.current = false;
    }
    if (loadedProfileId !== activeProfileId) return;
    if (activeSession) {
      safeLocalStorageSetItem(`lazcakon_${activeProfileId}_active_session`, JSON.stringify(activeSession), {
        critical: true,
        onQuotaError: (msg) => {
          setWorkoutSyncStatus('error');
          setWorkoutSyncError(msg);
        },
      });
    } else {
      try {
        localStorage.removeItem(`lazcakon_${activeProfileId}_active_session`);
      } catch {}
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

  const [restCompleteNotice, setRestCompleteNotice] = useState<RestCompleteNotice | null>(null);
  const restCompleteDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismissRestCompleteNotice = useCallback(() => {
    if (restCompleteDismissTimerRef.current) {
      clearTimeout(restCompleteDismissTimerRef.current);
      restCompleteDismissTimerRef.current = null;
    }
    setRestCompleteNotice(null);
    void clearRestCompleteNotifications();
  }, []);

  const showRestCompleteNotice = useCallback(
    (exerciseName?: string, targetEndTime?: number, nextSetNumber?: number) => {
      if (restCompleteDismissTimerRef.current) {
        clearTimeout(restCompleteDismissTimerRef.current);
      }
      const mode: RestCompleteNotice['mode'] = activeSoundEnabledRef.current
        ? 'sound'
        : activeVibrationEnabledRef.current
        ? 'vibrate_only'
        : 'silent';
      setRestCompleteNotice({
        id: `rest-done-${targetEndTime || Date.now()}`,
        title: REST_COMPLETE_NOTIFICATION_TITLE,
        exerciseName,
        nextSetNumber,
        mode,
        triggeredAt: Date.now(),
      });
      restCompleteDismissTimerRef.current = setTimeout(() => {
        restCompleteDismissTimerRef.current = null;
        setRestCompleteNotice(null);
      }, 25000);
    },
    []
  );

  // Synchronize all athlete-scoped states atomically whenever active athlete profile changes
  useEffect(() => {
    const targetProfileId = activeProfileId;
    const targetWeight = activeWeightRef.current;

    setHistoryConflicts([]);
    setHistoryInventory(null);
    setHistorySyncError(null);
    setIsHistorySyncing(false);
    setRestCompleteNotice(null);

    try {
      const storedRoutines = localStorage.getItem(`lazcakon_${targetProfileId}_routines`);
      if (storedRoutines) {
        const filtered = filterOutPreloadedRoutines(JSON.parse(storedRoutines));
        const sanitized = sanitizeRoutinesRdlRest(filtered);
        setRoutines(sanitized);
        safeLocalStorageSetItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify(sanitized), { critical: true });
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
          safeLocalStorageSetItem(`lazcakon_${targetProfileId}_history`, JSON.stringify(cleanedHistory), { critical: true });
        }
      } else {
        setHistory([]);
      }

      const storedPrs = localStorage.getItem(`lazcakon_${targetProfileId}_prs`);
      setPrs(storedPrs ? JSON.parse(storedPrs) : {});

      const storedBw = localStorage.getItem(`lazcakon_${targetProfileId}_bodyweight`);
      setBodyWeightLogs(storedBw ? JSON.parse(storedBw) : []);

      const storedSession = localStorage.getItem(`lazcakon_${targetProfileId}_active_session`);
      const hydratedSession = storedSession ? sanitizeActiveSessionRdlRest(ensureSessionStableIds(JSON.parse(storedSession))) : null;
      activeSessionRef.current = hydratedSession;
      setActiveSession(hydratedSession);
      setStartupFlag('activeSessionRestored', Boolean(hydratedSession));
      if (hydratedSession) {
        safeLocalStorageSetItem(`lazcakon_${targetProfileId}_active_session`, JSON.stringify(hydratedSession), { critical: true });
      }

      const hasPendingQueue = getOfflineSyncQueue().some((q) => q.profileId === targetProfileId);
      setWorkoutSyncStatus(hasPendingQueue ? 'pending_sync' : 'saved_local');
      setWorkoutSyncError(null);

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
          } else {
            const expiredAgoMs = Date.now() - parsedTimer.targetEndTime;
            try {
              localStorage.removeItem(getRestTimerStorageKey(targetProfileId));
            } catch {}
            void dismissActiveRestNotification();
            if (
              expiredAgoMs >= 0 &&
              expiredAgoMs <= 5 * 60 * 1000 &&
              activeRestEndAlertEnabledRef.current &&
              !hasCompleteAlertFired(parsedTimer.restId || parsedTimer.targetEndTime)
            ) {
              markCompleteAlertHandled(parsedTimer.restId);
              markCompleteAlertHandled(parsedTimer.targetEndTime);
              showRestCompleteNotice(
                parsedTimer.exerciseName,
                parsedTimer.targetEndTime,
                parsedTimer.nextSetNumber
              );
            }
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
      const firestoreSyncStartedAt =
        typeof performance !== 'undefined' && typeof performance.now === 'function'
          ? performance.now()
          : Date.now();
      setIsHistorySyncing(true);
      setHistorySyncError(null);
      fetchUserDataFromFirebase(targetProfileId)
        .then((res) => {
          const syncDurationMs =
            (typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now()) - firestoreSyncStartedAt;
          markStartupTiming('firstFirestoreSyncMs', syncDurationMs);
          if (activeProfileIdRef.current !== targetProfileId) return;
          setIsHistorySyncing(false);
          if (!res.success) {
            if ((res as any).permissionDenied) {
              setHistorySyncError(res.message || 'Error de permisos con Cloud Firestore');
            }
            return;
          }
          if (res.success && res.data) {
            setHistorySyncError(null);
            const hasPendingRoutine = hasPendingSyncOperationType(targetProfileId, [
              'routine_save',
              'routine_delete',
              'import_restore',
              'full_sync',
            ]);
            if (Array.isArray(res.data.routines)) {
              const cleanCloudRoutines = filterOutPreloadedRoutines(res.data.routines as Routine[]);
              const reconciledRoutines = reconcileRoutinesWithCloud({
                localRoutines: routinesRef.current,
                cloudRoutines: cleanCloudRoutines,
                hasPendingRoutineOp: hasPendingRoutine,
              });
              if (reconciledRoutines.source !== 'local_kept') {
                setRoutines(reconciledRoutines.resolvedRoutines);
                safeLocalStorageSetItem(
                  `lazcakon_${targetProfileId}_routines`,
                  JSON.stringify(reconciledRoutines.resolvedRoutines),
                  { critical: true }
                );
                if (reconciledRoutines.resolvedRoutines.length !== res.data.routines.length) {
                  syncUserDataToFirebase(targetProfileId, {
                    routines: reconciledRoutines.resolvedRoutines,
                  }).catch(() => {});
                }
              }
            }
            if (Array.isArray(res.data.history)) {
              backupAllRawSourcesBeforeRepair(targetProfileId, { [targetProfileId]: res.data });
              const localSources = collectAllLocalHistorySources(targetProfileId);
              const cloudSourceInput: NamedHistorySourceInput = {
                sourceId: `firestore:${targetProfileId}`,
                sourceLabel: `Firestore (/athletes/${targetProfileId})`,
                sourceType: 'firestore_doc',
                rawRecords: res.data.history,
                profileId: targetProfileId,
              };
              const { unifiedHistory, conflicts } = reconcileAndUnifyAthleteHistory(
                [...localSources, cloudSourceInput],
                activeWeightRef.current
              );
              const sanitizedCloudReport = purgeAndSanitizeWorkoutHistory(
                unifiedHistory,
                activeWeightRef.current
              );
              const sanitizedCloudMerge = sanitizedCloudReport.cleanedHistory;
              // NUNCA vaciar un historial local no vacío con un array vacío de la nube
              if (sanitizedCloudMerge.length > 0 || (historyRef.current.length === 0 && res.data.history.length === 0)) {
                setHistory(sanitizedCloudMerge);
                safeLocalStorageSetItem(
                  `lazcakon_${targetProfileId}_history`,
                  JSON.stringify(sanitizedCloudMerge),
                  { critical: true }
                );
                const cloudDigest = res.data.history
                  .map((w: any) => `${w?.id || ''}|${w?.date || ''}|${w?.routineTitle || ''}|${w?.caloriesBurned || 0}`)
                  .join(';;');
                const sanitizedDigest = sanitizedCloudMerge
                  .map((w) => `${w.id}|${w.date}|${w.routineTitle}|${w.caloriesBurned || 0}`)
                  .join(';;');
                if (sanitizedCloudMerge.length !== res.data.history.length || cloudDigest !== sanitizedDigest) {
                  syncUserDataToFirebase(targetProfileId, { history: sanitizedCloudMerge }).catch(() => {});
                }
              }
              setHistoryConflicts(conflicts);
            }
            if (res.data.prs && typeof res.data.prs === 'object') {
              const mergedPrs = reconcilePersonalRecordsMap(
                prsRef.current,
                res.data.prs as Record<string, PersonalRecord>
              );
              setPrs(mergedPrs);
              safeLocalStorageSetItem(`lazcakon_${targetProfileId}_prs`, JSON.stringify(mergedPrs), { critical: true });
            }
            if (Array.isArray(res.data.bodyWeightLogs)) {
              const hasPendingBw = hasPendingSyncOperationType(targetProfileId, ['bodyweight_update']);
              const mergedBw = reconcileBodyWeightLogs(
                bodyWeightLogsRef.current,
                res.data.bodyWeightLogs as BodyWeightEntry[],
                hasPendingBw
              );
              setBodyWeightLogs(mergedBw);
              safeLocalStorageSetItem(`lazcakon_${targetProfileId}_bodyweight`, JSON.stringify(mergedBw), { critical: true });
            }
            if (res.data.customLinks && typeof res.data.customLinks === 'object') {
              setCustomLinks(res.data.customLinks as Record<string, { id: string; title: string; url: string }[]>);
              safeLocalStorageSetItem(`lazcakon_${targetProfileId}_custom_links`, JSON.stringify(res.data.customLinks), { critical: false });
            }
            if (res.data.selectedAlternatives && typeof res.data.selectedAlternatives === 'object') {
              setSelectedAlternatives(res.data.selectedAlternatives as Record<string, boolean>);
              safeLocalStorageSetItem(`lazcakon_${targetProfileId}_alternatives`, JSON.stringify(res.data.selectedAlternatives), { critical: false });
            }
            const hasPending = getOfflineSyncQueue().some((q) => q.profileId === targetProfileId);
            const localClearedAt = Number(localStorage.getItem(`lazcakon_${targetProfileId}_active_session_cleared_at`) || '0') || 0;
            const cloudHistoryArr = Array.isArray(res.data.history) ? (res.data.history as CompletedWorkout[]) : historyRef.current;
            const reconciled = reconcileActiveSessionWithCloud({
              localSession: activeSessionRef.current,
              cloudSession: res.data.activeSession as ActiveWorkoutSession | null | undefined,
              cloudClearedAt: typeof res.data.activeSessionClearedAt === 'number' ? res.data.activeSessionClearedAt : 0,
              localClearedAt,
              hasPendingOfflineSync: hasPending,
              history: cloudHistoryArr,
            });
            if (reconciled.source === 'cloud_restored' || reconciled.source === 'cleared') {
              activeSessionRef.current = reconciled.resolvedSession;
              setActiveSession(reconciled.resolvedSession);
              if (reconciled.resolvedSession) {
                safeLocalStorageSetItem(
                  `lazcakon_${targetProfileId}_active_session`,
                  JSON.stringify(reconciled.resolvedSession),
                  { critical: true }
                );
              } else {
                try {
                  localStorage.removeItem(`lazcakon_${targetProfileId}_active_session`);
                } catch {}
              }
            }
            if (!hasPending) {
              setWorkoutSyncStatus('synced');
              setWorkoutSyncError(null);
            }
          }
        })
        .catch(() => {
          const syncDurationMs =
            (typeof performance !== 'undefined' && typeof performance.now === 'function'
              ? performance.now()
              : Date.now()) - firestoreSyncStartedAt;
          markStartupTiming('firstFirestoreSyncMs', syncDurationMs);
          setIsHistorySyncing(false);
          setHistorySyncError('Error de red al consultar historial en la nube.');
        });
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
    const unsubscribeCloud = subscribeUserDataFromCloud(
      subscribedProfileId,
      (cloudData) => {
        if (activeProfileIdRef.current !== subscribedProfileId) return;
        setHistorySyncError(null);
        setIsHistorySyncing(false);
        if (cloudData) {
          const hasPendingRoutine = hasPendingSyncOperationType(subscribedProfileId, [
            'routine_save',
            'routine_delete',
            'import_restore',
            'full_sync',
          ]);
          if (Array.isArray(cloudData.routines)) {
            const cleanCloudRoutines = filterOutPreloadedRoutines(cloudData.routines as Routine[]);
            const reconciledRoutines = reconcileRoutinesWithCloud({
              localRoutines: routinesRef.current,
              cloudRoutines: cleanCloudRoutines,
              hasPendingRoutineOp: hasPendingRoutine,
            });
            if (reconciledRoutines.source !== 'local_kept') {
              setRoutines(reconciledRoutines.resolvedRoutines);
              safeLocalStorageSetItem(
                `lazcakon_${subscribedProfileId}_routines`,
                JSON.stringify(reconciledRoutines.resolvedRoutines),
                { critical: true }
              );
            }
          }
          if (Array.isArray(cloudData.history)) {
            backupAllRawSourcesBeforeRepair(subscribedProfileId, { [subscribedProfileId]: cloudData });
            const localSources = collectAllLocalHistorySources(subscribedProfileId);
            const cloudSourceInput: NamedHistorySourceInput = {
              sourceId: `firestore:${subscribedProfileId}`,
              sourceLabel: `Firestore Realtime (/athletes/${subscribedProfileId})`,
              sourceType: 'firestore_doc',
              rawRecords: cloudData.history,
              profileId: subscribedProfileId,
            };
            const { unifiedHistory, conflicts } = reconcileAndUnifyAthleteHistory(
              [...localSources, cloudSourceInput],
              activeWeightRef.current
            );
            const sanitizedRealtimeReport = purgeAndSanitizeWorkoutHistory(
              unifiedHistory,
              activeWeightRef.current
            );
            const sanitizedRealtimeMerge = sanitizedRealtimeReport.cleanedHistory;
            if (sanitizedRealtimeMerge.length > 0 || (historyRef.current.length === 0 && cloudData.history.length === 0)) {
              setHistory(sanitizedRealtimeMerge);
              safeLocalStorageSetItem(
                `lazcakon_${subscribedProfileId}_history`,
                JSON.stringify(sanitizedRealtimeMerge),
                { critical: true }
              );
              const cloudDigest = cloudData.history
                .map((w: any) => `${w?.id || ''}|${w?.date || ''}|${w?.routineTitle || ''}|${w?.caloriesBurned || 0}`)
                .join(';;');
              const sanitizedDigest = sanitizedRealtimeMerge
                .map((w) => `${w.id}|${w.date}|${w.routineTitle}|${w.caloriesBurned || 0}`)
                .join(';;');
              if (sanitizedRealtimeMerge.length !== cloudData.history.length || cloudDigest !== sanitizedDigest) {
                syncUserDataToFirebase(subscribedProfileId, { history: sanitizedRealtimeMerge }).catch(() => {});
              }
            }
            setHistoryConflicts(conflicts);
          }
          if (cloudData.prs && typeof cloudData.prs === 'object') {
            const mergedPrs = reconcilePersonalRecordsMap(
              prsRef.current,
              cloudData.prs as Record<string, PersonalRecord>
            );
            setPrs(mergedPrs);
            safeLocalStorageSetItem(`lazcakon_${subscribedProfileId}_prs`, JSON.stringify(mergedPrs), { critical: true });
          }
          if (Array.isArray(cloudData.bodyWeightLogs)) {
            const hasPendingBw = hasPendingSyncOperationType(subscribedProfileId, ['bodyweight_update']);
            const mergedBw = reconcileBodyWeightLogs(
              bodyWeightLogsRef.current,
              cloudData.bodyWeightLogs as BodyWeightEntry[],
              hasPendingBw
            );
            setBodyWeightLogs(mergedBw);
            safeLocalStorageSetItem(`lazcakon_${subscribedProfileId}_bodyweight`, JSON.stringify(mergedBw), { critical: true });
          }
          if (cloudData.customLinks && typeof cloudData.customLinks === 'object') {
            setCustomLinks(cloudData.customLinks as Record<string, { id: string; title: string; url: string }[]>);
            safeLocalStorageSetItem(`lazcakon_${subscribedProfileId}_custom_links`, JSON.stringify(cloudData.customLinks), { critical: false });
          }
          if (cloudData.selectedAlternatives && typeof cloudData.selectedAlternatives === 'object') {
            setSelectedAlternatives(cloudData.selectedAlternatives as Record<string, boolean>);
            safeLocalStorageSetItem(`lazcakon_${subscribedProfileId}_alternatives`, JSON.stringify(cloudData.selectedAlternatives), { critical: false });
          }
          const hasPending = getOfflineSyncQueue().some((q) => q.profileId === subscribedProfileId);
          const localClearedAt = Number(localStorage.getItem(`lazcakon_${subscribedProfileId}_active_session_cleared_at`) || '0') || 0;
          const cloudHistoryArr = Array.isArray(cloudData.history) ? (cloudData.history as CompletedWorkout[]) : historyRef.current;
          const reconciled = reconcileActiveSessionWithCloud({
            localSession: activeSessionRef.current,
            cloudSession: cloudData.activeSession as ActiveWorkoutSession | null | undefined,
            cloudClearedAt: typeof cloudData.activeSessionClearedAt === 'number' ? cloudData.activeSessionClearedAt : 0,
            localClearedAt,
            hasPendingOfflineSync: hasPending,
            history: cloudHistoryArr,
          });
          if (reconciled.source === 'cloud_restored' || reconciled.source === 'cleared') {
            activeSessionRef.current = reconciled.resolvedSession;
            setActiveSession(reconciled.resolvedSession);
            if (reconciled.resolvedSession) {
              safeLocalStorageSetItem(
                `lazcakon_${subscribedProfileId}_active_session`,
                JSON.stringify(reconciled.resolvedSession),
                { critical: true }
              );
            } else {
              try {
                localStorage.removeItem(`lazcakon_${subscribedProfileId}_active_session`);
              } catch {}
            }
          }
          if (!hasPending) {
            setWorkoutSyncStatus('synced');
            setWorkoutSyncError(null);
          }
        }
      },
      (err) => {
        setIsHistorySyncing(false);
        const msg = String(err?.message || err || '');
        if (msg.includes('permission') || msg.includes('Permission')) {
          setHistorySyncError('Error de permisos en tiempo real con Cloud Firestore');
        } else {
          setHistorySyncError('Error al sincronizar historial en tiempo real');
        }
      }
    );

    return () => {
      unsubscribeCloud();
    };
  }, [activeProfileId, authUser, isLoggedIn]);

  // Track which second tick was last played so we don't depend on React state batching when locked
  const lastPlayedTickSecRef = useRef<number | null>(null);
  const fiveSecFiredTargetRef = useRef<number>(0);
  const completeFiredTargetRef = useRef<number>(0);

  const getCurrentRestAlertMode = (): 'sound' | 'vibrate_only' | 'silent' => {
    if (activeSoundEnabledRef.current) return 'sound';
    if (activeVibrationEnabledRef.current) return 'vibrate_only';
    return 'silent';
  };

  const ensureAndroidRestPermissionOnce = useCallback(async () => {
    if (!isCapacitorAndroidRuntime()) return;
    try {
      const storageKey = 'lazcakong_android_notif_prompted_v1';
      if (localStorage.getItem(storageKey) === '1') return;
      const perm = await getNativeNotificationPermission();
      if (perm === 'default') {
        localStorage.setItem(storageKey, '1');
        await requestNativeNotificationPermission();
      }
    } catch {}
  }, []);

  const applyNativeRestSnapshot = useCallback(
    (snapshot: NativeRestStateSnapshot | null) => {
      if (!snapshot || !isCapacitorAndroidRuntime()) return;
      const curr = restTimerRef.current;
      const pending = snapshot.pendingAction || '';

      if (snapshot.lastFiredRestId) markCompleteAlertHandled(snapshot.lastFiredRestId);
      if (snapshot.lastFiredTargetEndTime) markCompleteAlertHandled(snapshot.lastFiredTargetEndTime);

      if (pending === 'completed') {
        stopBackgroundTicker();
        releaseTimerAudioResources();
        disableScreenWakeLock();
        localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
        const finishedTarget = snapshot.lastFiredTargetEndTime || curr.targetEndTime;
        if (
          activeRestEndAlertEnabledRef.current &&
          snapshot.restEndAlertEnabled !== false &&
          finishedTarget &&
          Date.now() - finishedTarget <= 5 * 60 * 1000
        ) {
          showRestCompleteNotice(
            snapshot.exerciseName || curr.exerciseName,
            finishedTarget,
            snapshot.nextSetNumber || curr.nextSetNumber
          );
        }
        const cleared: RestTimerState = {
          ...curr,
          active: false,
          paused: false,
          remainingSeconds: 0,
          targetEndTime: undefined,
          restId: undefined,
        };
        restTimerRef.current = cleared;
        setRestTimer(cleared);
        return;
      }

      if (pending === 'skipped') {
        stopBackgroundTicker();
        releaseTimerAudioResources();
        cancelDeviceVibration();
        disableScreenWakeLock();
        dismissRestCompleteNotice();
        localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
        const cleared: RestTimerState = {
          ...curr,
          active: false,
          paused: false,
          remainingSeconds: 0,
          targetEndTime: undefined,
          restId: undefined,
        };
        restTimerRef.current = cleared;
        setRestTimer(cleared);
        return;
      }

      if (snapshot.active && snapshot.paused) {
        stopBackgroundTicker();
        const rem = Math.max(1, snapshot.remainingSeconds || curr.remainingSeconds || 60);
        const total = Math.max(snapshot.totalSeconds || 0, rem);
        const updated: RestTimerState = {
          ...curr,
          active: true,
          paused: true,
          remainingSeconds: rem,
          totalSeconds: total,
          exerciseName: snapshot.exerciseName || curr.exerciseName,
          nextSetNumber: snapshot.nextSetNumber || curr.nextSetNumber,
          targetEndTime: undefined,
          restId: undefined,
        };
        restTimerRef.current = updated;
        localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
        setRestTimer(updated);
        return;
      }

      if (snapshot.active && !snapshot.paused && snapshot.targetEndTime > Date.now()) {
        const rem = Math.max(1, Math.ceil((snapshot.targetEndTime - Date.now()) / 1000));
        const total = Math.max(snapshot.totalSeconds || 0, rem);
        if (
          curr.active &&
          !curr.paused &&
          curr.targetEndTime === snapshot.targetEndTime &&
          curr.restId === snapshot.restId
        ) {
          return;
        }
        resetCompleteAlertTracking(snapshot.targetEndTime);
        resetCompleteAlertTracking(snapshot.restId);
        const updated: RestTimerState = {
          ...curr,
          active: true,
          paused: false,
          totalSeconds: total,
          remainingSeconds: rem,
          exerciseName: snapshot.exerciseName || curr.exerciseName,
          nextSetNumber: snapshot.nextSetNumber || curr.nextSetNumber,
          targetEndTime: snapshot.targetEndTime,
          restId: snapshot.restId || curr.restId,
        };
        restTimerRef.current = updated;
        localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
        setRestTimer(updated);
        return;
      }

      if (
        !snapshot.active &&
        curr.active &&
        snapshot.lastFiredRestId &&
        snapshot.lastFiredRestId === curr.restId
      ) {
        stopBackgroundTicker();
        disableScreenWakeLock();
        localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
        const cleared: RestTimerState = {
          ...curr,
          active: false,
          paused: false,
          remainingSeconds: 0,
          targetEndTime: undefined,
          restId: undefined,
        };
        restTimerRef.current = cleared;
        setRestTimer(cleared);
      }
    },
    [dismissRestCompleteNotice, showRestCompleteNotice]
  );

  // Sync native Android notification actions (+15s, Pausar, Reanudar, Saltar, Alarm completed) on launch & resume
  useEffect(() => {
    if (!isCapacitorAndroidRuntime() || typeof window === 'undefined') return;

    const pullNativeSync = async () => {
      const snapshot = await consumePendingNativeRestSync().catch(() => null);
      if (snapshot) {
        applyNativeRestSnapshot(snapshot);
      }
    };

    const onNativeSyncEvent = () => {
      void pullNativeSync();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void pullNativeSync();
      }
    };

    void pullNativeSync();
    window.addEventListener(NATIVE_REST_STATE_SYNC_EVENT, onNativeSyncEvent);
    window.addEventListener('focus', pullNativeSync);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener(NATIVE_REST_STATE_SYNC_EVENT, onNativeSyncEvent);
      window.removeEventListener('focus', pullNativeSync);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [applyNativeRestSnapshot]);

  // Rest timer countdown ticker using Web Worker for open-screen UI + Web Push sync (zero background audio loop, zero SW setTimeout)
  useEffect(() => {
    if (!restTimer.active || restTimer.paused || !restTimer.targetEndTime) {
      stopBackgroundTicker();
      return;
    }

    // Keep mobile screen awake while actively resting on-screen
    enableScreenWakeLock().catch(() => {});

    const checkAndTick = () => {
      const current = restTimerRef.current;
      if (!current.active || current.paused || !current.targetEndTime) return;

      const now = Date.now();
      const remainingMs = current.targetEndTime - now;
      const diffSec = Math.ceil(remainingMs / 1000);

      // 1. Direct non-deferred execution for 0s completion (single-shot across foreground & Web Push / Android Alarm)
      if (remainingMs <= 0) {
        if (completeFiredTargetRef.current !== current.targetEndTime) {
          completeFiredTargetRef.current = current.targetEndTime;
          const soundOn = activeSoundEnabledRef.current;
          const vibOn = activeVibrationEnabledRef.current;
          const alertOn = activeRestEndAlertEnabledRef.current;
          const alreadyHandledBySw =
            hasCompleteAlertFired(current.restId) || hasCompleteAlertFired(current.targetEndTime);

          if (soundOn) {
            playRestCompleteAlarm();
          } else {
            releaseTimerAudioResources();
          }

          if (!isCapacitorAndroidRuntime()) {
            void dismissActiveRestNotification();
            void cancelNativeRestNotification(current.restId, current.targetEndTime);
          }

          if (alertOn) {
            showRestCompleteNotice(current.exerciseName, current.targetEndTime, current.nextSetNumber);
            if (!alreadyHandledBySw) {
              void sendRestCompleteNotification(
                current.exerciseName,
                current.targetEndTime,
                vibOn,
                Boolean(soundOn || vibOn),
                current.nextSetNumber,
                current.restId
              );
            }
          } else if (isCapacitorAndroidRuntime()) {
            void markNativeRestCompleted({
              restId: current.restId,
              targetEndTime: current.targetEndTime,
              exerciseName: current.exerciseName,
              nextSetNumber: current.nextSetNumber,
              mode: getCurrentRestAlertMode(),
              restEndAlertEnabled: false,
            });
            if (vibOn && !alreadyHandledBySw) {
              markCompleteAlertHandled(current.restId);
              markCompleteAlertHandled(current.targetEndTime);
              void triggerNativeAndWebVibration(REST_COMPLETE_VIBRATION_PATTERN);
            }
          } else if (vibOn && !alreadyHandledBySw) {
            markCompleteAlertHandled(current.restId);
            markCompleteAlertHandled(current.targetEndTime);
            void notifyServiceWorkerRestAlarmHandled(current.targetEndTime, current.restId);
            void triggerNativeAndWebVibration(REST_COMPLETE_VIBRATION_PATTERN);
          }
        }
        disableScreenWakeLock();
        localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
        restTimerRef.current = {
          ...current,
          active: false,
          paused: false,
          remainingSeconds: 0,
          targetEndTime: undefined,
          restId: undefined,
        };
        setRestTimer(restTimerRef.current);
        return;
      }

      // 2. 5-second countdown warning & per-second ticks apply ONLY to "Pitido final" mode.
      // In "Solo vibración" and "Silencio", keep countdown silent & un-vibrated until 00:00.
      if (activeSoundEnabledRef.current) {
        if (remainingMs <= 5300 && remainingMs > 1000) {
          if (fiveSecFiredTargetRef.current !== current.targetEndTime) {
            fiveSecFiredTargetRef.current = current.targetEndTime;
            void sendFiveSecondWarningNotification(
              current.exerciseName,
              current.targetEndTime,
              activeVibrationEnabledRef.current,
              false
            );
          }
        }

        if (diffSec <= 5 && diffSec >= 1 && lastPlayedTickSecRef.current !== diffSec) {
          lastPlayedTickSecRef.current = diffSec;
          if (activeVibrationEnabledRef.current) {
            vibrateDevice([250, 100, 250]);
          }
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

    // Sync immediately from real wall-clock targetEndTime before starting background ticker
    checkAndTick();
    // Start background ticker (Web Worker thread for foreground/unlocked accuracy)
    startBackgroundTicker(checkAndTick, 350);

    // Coordinate immediately with Service Worker push messages (avoids double-alerts)
    const onSwMessage = (event: MessageEvent) => {
      const data = event?.data;
      if (!data) return;
      if (data.type === 'PUSH_REST_ALARM_RECEIVED' && !data.isTest) {
        if (data.restId) markCompleteAlertHandled(String(data.restId));
        if (data.targetEndTime) markCompleteAlertHandled(Number(data.targetEndTime));
        checkAndTick();
      } else if (data.type === 'SW_REST_ALARM_FIRED') {
        if (data.restId) markCompleteAlertHandled(String(data.restId));
        if (data.targetEndTime) markCompleteAlertHandled(Number(data.targetEndTime));
        checkAndTick();
      }
    };
    if (
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof navigator.serviceWorker?.addEventListener === 'function'
    ) {
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }

    // Instant update whenever user unlocks phone or switches back to app (never touches audio)
    const onVisibilityOrFocus = () => {
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
      if (
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        typeof navigator.serviceWorker?.removeEventListener === 'function'
      ) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
      document.removeEventListener('visibilitychange', onVisibilityOrFocus);
      window.removeEventListener('focus', onVisibilityOrFocus);
      window.removeEventListener('pageshow', onVisibilityOrFocus);
    };
  }, [
    restTimer.active,
    restTimer.paused,
    restTimer.targetEndTime,
    restTimer.restId,
    restTimer.exerciseName,
    restTimer.nextSetNumber,
    activeProfile.soundEnabled,
    activeProfile.vibrationEnabled,
    activeProfile.restEndAlertEnabled,
    showRestCompleteNotice,
  ]);

  const startRestTimer = useCallback(
    (seconds: number, exerciseName?: string, explicitNextSetNumber?: number) => {
      if (seconds <= 0) return;
      dismissRestCompleteNotice();
      void ensureAndroidRestPermissionOnce();
      const prevTarget = restTimerRef.current?.targetEndTime;
      const prevRestId = restTimerRef.current?.restId;
      if (prevTarget || prevRestId) {
        cancelServiceWorkerRestAlarm(prevTarget, prevRestId, { preserveOngoing: true }).catch(() => {});
      }
      enableScreenWakeLock().catch(() => {});
      lastPlayedTickSecRef.current = null;
      fiveSecFiredTargetRef.current = 0;
      completeFiredTargetRef.current = 0;

      const resolvedContext = resolveNextRestTargetContext(
        activeSessionRef.current,
        exerciseName,
        explicitNextSetNumber
      );

      const now = Date.now();
      const targetEndTime = Math.max(now + seconds * 1000, (prevTarget || 0) + 1);
      const restId = createRestAlarmId('rest');
      resetCompleteAlertTracking(targetEndTime);
      resetCompleteAlertTracking(restId);

      void scheduleServiceWorkerRestAlarm(targetEndTime, resolvedContext.exerciseName, {
        vibrationEnabled: activeVibrationEnabledRef.current,
        soundEnabled: activeSoundEnabledRef.current,
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        nextSetNumber: resolvedContext.nextSetNumber,
        restId,
        mode: getCurrentRestAlertMode(),
      });

      void showOrUpdateActiveRestNotification({
        targetEndTime,
        durationSeconds: seconds,
        totalSeconds: seconds,
        restId,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      });

      void scheduleServerRestAlarmPush({
        athleteId: activeProfileIdRef.current,
        restId,
        targetEndTime,
        durationSeconds: seconds,
        sessionId: activeSessionRef.current?.sessionId,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        ...(prevRestId ? { supersededRestId: prevRestId } : {}),
      });

      void scheduleNativeRestNotification({
        targetEndTime,
        restId,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      });

      const newState: RestTimerState = {
        active: true,
        paused: false,
        totalSeconds: seconds,
        remainingSeconds: seconds,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        minimized: false,
        targetEndTime,
        restId,
        startedAt: now,
      };
      restTimerRef.current = newState;
      setRestTimer(newState);
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(newState));
    },
    [dismissRestCompleteNotice, ensureAndroidRestPermissionOnce]
  );

  const stopRestTimer = useCallback(() => {
    const activeTarget = restTimerRef.current?.targetEndTime;
    const activeRestId = restTimerRef.current?.restId;
    stopBackgroundTicker();
    releaseTimerAudioResources();
    cancelDeviceVibration();
    cancelServiceWorkerRestAlarm(activeTarget, activeRestId).catch(() => {});
    if (activeRestId || activeTarget) {
      void cancelServerRestAlarmPush({
        athleteId: activeProfileIdRef.current,
        ...(activeRestId ? { restId: activeRestId } : {}),
        reason: 'cancelled',
      });
    }
    disableScreenWakeLock();
    dismissRestCompleteNotice();
    lastPlayedTickSecRef.current = null;
    fiveSecFiredTargetRef.current = 0;
    completeFiredTargetRef.current = 0;
    localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
    setRestTimer((prev) => {
      const next = {
        ...prev,
        active: false,
        paused: false,
        remainingSeconds: 0,
        targetEndTime: undefined,
        restId: undefined,
      };
      restTimerRef.current = next;
      return next;
    });
  }, [dismissRestCompleteNotice]);

  const pauseRestTimer = useCallback(() => {
    setRestTimer((prev) => {
      if (!prev.active || prev.paused) return prev;
      stopBackgroundTicker();
      releaseTimerAudioResources();
      cancelDeviceVibration();
      const nativeAndroid = isCapacitorAndroidRuntime();
      cancelServiceWorkerRestAlarm(prev.targetEndTime, prev.restId, {
        preserveOngoing: nativeAndroid,
      }).catch(() => {});
      void cancelServerRestAlarmPush({
        athleteId: activeProfileIdRef.current,
        ...(prev.restId ? { restId: prev.restId } : {}),
        reason: 'paused',
      });
      const now = Date.now();
      const remaining = prev.targetEndTime
        ? Math.max(1, Math.ceil((prev.targetEndTime - now) / 1000))
        : Math.max(1, prev.remainingSeconds);

      if (nativeAndroid) {
        void pauseNativeOngoingRestNotification({
          remainingSeconds: remaining,
          totalSeconds: Math.max(prev.totalSeconds, remaining),
          exerciseName: prev.exerciseName,
          nextSetNumber: prev.nextSetNumber,
          mode: getCurrentRestAlertMode(),
          restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        });
      }

      const updated: RestTimerState = {
        ...prev,
        paused: true,
        remainingSeconds: remaining,
        targetEndTime: undefined,
        restId: undefined,
      };
      restTimerRef.current = updated;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resumeRestTimer = useCallback(() => {
    dismissRestCompleteNotice();
    setRestTimer((prev) => {
      if (!prev.active || !prev.paused) return prev;
      enableScreenWakeLock().catch(() => {});
      const now = Date.now();
      const remaining = Math.max(1, prev.remainingSeconds || prev.totalSeconds || 90);
      const targetEndTime = Math.max(now + remaining * 1000, (completeFiredTargetRef.current || 0) + 1);
      const restId = createRestAlarmId('rest');
      lastPlayedTickSecRef.current = null;
      fiveSecFiredTargetRef.current = 0;
      completeFiredTargetRef.current = 0;
      resetCompleteAlertTracking(targetEndTime);
      resetCompleteAlertTracking(restId);

      void scheduleServiceWorkerRestAlarm(targetEndTime, prev.exerciseName, {
        vibrationEnabled: activeVibrationEnabledRef.current,
        soundEnabled: activeSoundEnabledRef.current,
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        nextSetNumber: prev.nextSetNumber,
        restId,
        mode: getCurrentRestAlertMode(),
      });

      void showOrUpdateActiveRestNotification({
        targetEndTime,
        durationSeconds: remaining,
        totalSeconds: Math.max(prev.totalSeconds || remaining, remaining),
        restId,
        exerciseName: prev.exerciseName,
        nextSetNumber: prev.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      });

      void scheduleServerRestAlarmPush({
        athleteId: activeProfileIdRef.current,
        restId,
        targetEndTime,
        durationSeconds: remaining,
        sessionId: activeSessionRef.current?.sessionId,
        exerciseName: prev.exerciseName,
        nextSetNumber: prev.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        ...(prev.restId ? { supersededRestId: prev.restId } : {}),
      });

      void scheduleNativeRestNotification({
        targetEndTime,
        restId,
        exerciseName: prev.exerciseName,
        nextSetNumber: prev.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      });

      const updated: RestTimerState = {
        ...prev,
        paused: false,
        remainingSeconds: remaining,
        targetEndTime,
        restId,
      };
      restTimerRef.current = updated;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      return updated;
    });
  }, [dismissRestCompleteNotice]);

  const restartRestTimer = useCallback(() => {
    dismissRestCompleteNotice();
    setRestTimer((prev) => {
      if (!prev.active) return prev;
      if (prev.targetEndTime || prev.restId) {
        cancelServiceWorkerRestAlarm(prev.targetEndTime, prev.restId, { preserveOngoing: true }).catch(() => {});
      }
      enableScreenWakeLock().catch(() => {});
      const total = Math.max(15, prev.totalSeconds || 90);
      const now = Date.now();
      const targetEndTime = Math.max(now + total * 1000, (prev.targetEndTime || 0) + 1);
      const restId = createRestAlarmId('rest');
      const resolvedContext = resolveNextRestTargetContext(
        activeSessionRef.current,
        prev.exerciseName
      );
      lastPlayedTickSecRef.current = null;
      fiveSecFiredTargetRef.current = 0;
      completeFiredTargetRef.current = 0;
      resetCompleteAlertTracking(targetEndTime);
      resetCompleteAlertTracking(restId);

      void scheduleServiceWorkerRestAlarm(targetEndTime, resolvedContext.exerciseName, {
        vibrationEnabled: activeVibrationEnabledRef.current,
        soundEnabled: activeSoundEnabledRef.current,
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        nextSetNumber: resolvedContext.nextSetNumber,
        restId,
        mode: getCurrentRestAlertMode(),
      });

      void showOrUpdateActiveRestNotification({
        targetEndTime,
        durationSeconds: total,
        totalSeconds: total,
        restId,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      });

      void scheduleServerRestAlarmPush({
        athleteId: activeProfileIdRef.current,
        restId,
        targetEndTime,
        durationSeconds: total,
        sessionId: activeSessionRef.current?.sessionId,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        ...(prev.restId ? { supersededRestId: prev.restId } : {}),
      });

      void scheduleNativeRestNotification({
        targetEndTime,
        restId,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        mode: getCurrentRestAlertMode(),
        restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      });

      const updated: RestTimerState = {
        ...prev,
        active: true,
        paused: false,
        totalSeconds: total,
        remainingSeconds: total,
        exerciseName: resolvedContext.exerciseName,
        nextSetNumber: resolvedContext.nextSetNumber,
        targetEndTime,
        restId,
        startedAt: now,
      };
      restTimerRef.current = updated;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
      return updated;
    });
  }, [dismissRestCompleteNotice]);

  const adjustRestTimer = useCallback((deltaSeconds: number) => {
    const current = restTimerRef.current;
    if (!current.active) return;
    const now = Date.now();
    const currentRemaining =
      current.paused || !current.targetEndTime
        ? current.remainingSeconds
        : Math.max(0, Math.ceil((current.targetEndTime - now) / 1000));
    const nextRemaining = Math.max(0, currentRemaining + deltaSeconds);

    if (nextRemaining <= 0) {
      stopBackgroundTicker();
      releaseTimerAudioResources();
      cancelDeviceVibration();
      cancelServiceWorkerRestAlarm(current.targetEndTime, current.restId).catch(() => {});
      if (current.restId || current.targetEndTime) {
        void cancelServerRestAlarmPush({
          athleteId: activeProfileIdRef.current,
          ...(current.restId ? { restId: current.restId } : {}),
          reason: 'cancelled',
        });
      }
      disableScreenWakeLock();
      dismissRestCompleteNotice();
      localStorage.removeItem(getRestTimerStorageKey(activeProfileIdRef.current));
      const next: RestTimerState = {
        ...current,
        active: false,
        paused: false,
        remainingSeconds: 0,
        targetEndTime: undefined,
        restId: undefined,
      };
      restTimerRef.current = next;
      setRestTimer(next);
      return;
    }

    if (current.paused) {
      const nextTotal = Math.max(current.totalSeconds, nextRemaining);
      if (isCapacitorAndroidRuntime()) {
        void pauseNativeOngoingRestNotification({
          remainingSeconds: nextRemaining,
          totalSeconds: nextTotal,
          exerciseName: current.exerciseName,
          nextSetNumber: current.nextSetNumber,
          mode: getCurrentRestAlertMode(),
          restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
        });
      }
      const updatedPaused: RestTimerState = {
        ...current,
        remainingSeconds: nextRemaining,
        totalSeconds: nextTotal,
        targetEndTime: undefined,
        restId: undefined,
      };
      restTimerRef.current = updatedPaused;
      localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updatedPaused));
      setRestTimer(updatedPaused);
      return;
    }

    if (current.targetEndTime || current.restId) {
      cancelServiceWorkerRestAlarm(current.targetEndTime, current.restId, { preserveOngoing: true }).catch(() => {});
    }

    const newTarget = now + nextRemaining * 1000;
    const restId = createRestAlarmId('rest');
    lastPlayedTickSecRef.current = null;
    fiveSecFiredTargetRef.current = 0;
    completeFiredTargetRef.current = 0;
    resetCompleteAlertTracking(newTarget);
    resetCompleteAlertTracking(restId);

    void scheduleServiceWorkerRestAlarm(newTarget, current.exerciseName, {
      vibrationEnabled: activeVibrationEnabledRef.current,
      soundEnabled: activeSoundEnabledRef.current,
      restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      nextSetNumber: current.nextSetNumber,
      restId,
      mode: getCurrentRestAlertMode(),
    });

    void showOrUpdateActiveRestNotification({
      targetEndTime: newTarget,
      durationSeconds: nextRemaining,
      totalSeconds: Math.max(current.totalSeconds, nextRemaining),
      restId,
      exerciseName: current.exerciseName,
      nextSetNumber: current.nextSetNumber,
      mode: getCurrentRestAlertMode(),
      restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
    });

    void scheduleServerRestAlarmPush({
      athleteId: activeProfileIdRef.current,
      restId,
      targetEndTime: newTarget,
      durationSeconds: nextRemaining,
      sessionId: activeSessionRef.current?.sessionId,
      exerciseName: current.exerciseName,
      nextSetNumber: current.nextSetNumber,
      mode: getCurrentRestAlertMode(),
      restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
      ...(current.restId ? { supersededRestId: current.restId } : {}),
    });

    void scheduleNativeRestNotification({
      targetEndTime: newTarget,
      restId,
      exerciseName: current.exerciseName,
      nextSetNumber: current.nextSetNumber,
      mode: getCurrentRestAlertMode(),
      restEndAlertEnabled: activeRestEndAlertEnabledRef.current,
    });

    const updated: RestTimerState = {
      ...current,
      remainingSeconds: nextRemaining,
      totalSeconds: Math.max(current.totalSeconds, nextRemaining),
      targetEndTime: newTarget,
      restId,
    };
    restTimerRef.current = updated;
    localStorage.setItem(getRestTimerStorageKey(activeProfileIdRef.current), JSON.stringify(updated));
    setRestTimer(updated);
  }, [dismissRestCompleteNotice]);

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

  // Persist domain/workout patch to Cloud Firestore with structured operationType & offline queue fallback
  const persistWorkoutPatchToCloud = useCallback(
    async (
      profileId: string,
      patch: Record<string, unknown>,
      operationType: SyncOperationType = 'workout_patch'
    ): Promise<{ status: WorkoutSyncStatus; success: boolean; message?: string }> => {
      const seq = ++workoutSyncSeqRef.current;
      const isAuthed = Boolean(authUserRef.current && isLoggedInRef.current && profileId && profileId !== 'perfil_default');

      if (!isAuthed) {
        if (workoutSyncSeqRef.current === seq) {
          setWorkoutSyncStatus('saved_local');
          setWorkoutSyncError(null);
        }
        return { status: 'saved_local', success: false };
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const queued = queueOfflineSync(profileId, patch, operationType);
        const queueErr = !queued ? getLastOfflineQueueStorageError() : null;
        if (workoutSyncSeqRef.current === seq) {
          setWorkoutSyncStatus(queued ? 'pending_sync' : 'error');
          setWorkoutSyncError(queueErr);
        }
        return {
          status: queued ? 'pending_sync' : 'error',
          success: false,
          message: queueErr || 'Sin conexión: pendiente de sincronización.',
        };
      }

      if (workoutSyncSeqRef.current === seq) {
        setWorkoutSyncStatus('pending_sync');
        setWorkoutSyncError(null);
      }

      try {
        const res = await syncUserDataToFirebase(profileId, patch);
        if (res.success) {
          await processPendingOfflineSyncs({ profileId }).catch(() => {});
          const stillQueued = getOfflineSyncQueue().some((q) => q.profileId === profileId);
          if (workoutSyncSeqRef.current === seq) {
            setWorkoutSyncStatus(stillQueued ? 'pending_sync' : 'synced');
            setWorkoutSyncError(null);
          }
          return { status: stillQueued ? 'pending_sync' : 'synced', success: !stillQueued };
        }
        queueOfflineSync(profileId, patch, operationType);
        const queueErr = getLastOfflineQueueStorageError();
        if (workoutSyncSeqRef.current === seq) {
          setWorkoutSyncError(queueErr || res.message || 'No se pudo confirmar el guardado en la nube.');
          setWorkoutSyncStatus('error');
        }
        return { status: 'error', success: false, message: queueErr || res.message };
      } catch (err: any) {
        queueOfflineSync(profileId, patch, operationType);
        const queueErr = getLastOfflineQueueStorageError();
        const msg = queueErr || err?.message || 'Error de red al guardar en la nube.';
        if (workoutSyncSeqRef.current === seq) {
          setWorkoutSyncError(msg);
          setWorkoutSyncStatus('error');
        }
        return { status: 'error', success: false, message: msg };
      }
    },
    []
  );

  // Synchronous immediate local autosave helper for ALL live workout mutations
  const commitActiveSessionMutation = useCallback(
    (
      updater: (prev: ActiveWorkoutSession) => ActiveWorkoutSession | null,
      options?: { syncMode?: 'immediate' | 'local_only' }
    ): ActiveWorkoutSession | null => {
      const prev = activeSessionRef.current;
      if (!prev) return null;
      const mutated = updater(prev);
      if (!mutated) return null;

      const nowMs = Date.now();
      const targetProfileId = activeProfileIdRef.current;
      const normalized = ensureSessionStableIds({
        ...mutated,
        updatedAt: nowMs,
      });

      activeSessionRef.current = normalized;
      const writeRes = safeLocalStorageSetItem(
        `lazcakon_${targetProfileId}_active_session`,
        JSON.stringify(normalized),
        { critical: true }
      );
      setActiveSession(normalized);

      if (!writeRes.ok && writeRes.quotaExceeded && writeRes.errorMessage) {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(writeRes.errorMessage);
      }

      if (options?.syncMode === 'immediate') {
        void persistWorkoutPatchToCloud(
          targetProfileId,
          {
            activeSession: normalized,
            activeSessionUpdatedAt: nowMs,
          },
          'workout_patch'
        );
      } else if (writeRes.ok) {
        const hasPending = getOfflineSyncQueue().some((q) => q.profileId === targetProfileId);
        setWorkoutSyncStatus(hasPending ? 'pending_sync' : 'saved_local');
      }

      return normalized;
    },
    [persistWorkoutPatchToCloud]
  );

  // Exercise Alternatives
  const toggleExerciseAlternative = useCallback(
    (exerciseId: string) => {
      let computedNextVal = false;
      setSelectedAlternatives((prev) => {
        const nextVal = !prev[exerciseId];
        computedNextVal = nextVal;
        return { ...prev, [exerciseId]: nextVal };
      });

      commitActiveSessionMutation(
        (currSession) => {
          const nextVal = computedNextVal;
          return {
            ...currSession,
            exercises: currSession.exercises.map((ex) => {
              if (ex.exerciseId === exerciseId) {
                const baseRoutine = routines.find((r) => r.id === currSession.routineId);
                const originalEx = baseRoutine?.exercises.find((e) => e.id === exerciseId);
                const origName = ex.originalExerciseName || originalEx?.name || ex.exerciseName;
                const newName = nextVal && originalEx?.alternative ? originalEx.alternative : origName;
                const isDifferentExercise = normalizeText(newName) !== normalizeText(ex.activeExerciseName);

                const resolvedAltLib = nextVal ? resolveLibraryExercise({ name: newName }) : null;
                const resolvedOrigLib = !nextVal
                  ? resolveLibraryExercise({
                      id: originalEx?.libraryExerciseId,
                      name: origName,
                    })
                  : null;
                const activeLibId = nextVal
                  ? resolvedAltLib?.id || ex.libraryExerciseId
                  : originalEx?.libraryExerciseId || resolvedOrigLib?.id || ex.libraryExerciseId;
                const activeEquipment = nextVal
                  ? resolvedAltLib?.equipment || undefined
                  : originalEx?.equipment || resolvedOrigLib?.equipment || ex.equipment;

                const matched = findPreviousExerciseSessions({
                  history,
                  exercise: {
                    exerciseId: nextVal ? undefined : ex.originalExerciseId || ex.exerciseId,
                    libraryExerciseId: activeLibId,
                    activeExerciseName: newName,
                    originalExerciseName: origName,
                    equipment: activeEquipment,
                    useAlternative: nextVal,
                  },
                  currentSessionId: currSession.sessionId,
                  currentSessionStartTime: currSession.startTime,
                  activeProfileId: activeProfileIdRef.current,
                  limit: 1,
                })[0];

                const newPrevHint = matched
                  ? matched.maxWeight > 0
                    ? `${matched.maxWeight} kg × ${matched.maxReps}`
                    : `${matched.maxReps} reps`
                  : '';

                const updatedTechniquePro = buildTechniqueProProfile({
                  id: ex.exerciseId,
                  libraryExerciseId: activeLibId,
                  name: newName,
                  targetMuscles: ex.targetMuscles,
                  equipment: activeEquipment,
                });

                return {
                  ...ex,
                  libraryExerciseId: activeLibId,
                  equipment: activeEquipment,
                  originalExerciseId: ex.originalExerciseId || ex.exerciseId,
                  originalExerciseName: origName,
                  useAlternative: nextVal,
                  activeExerciseName: newName,
                  techniqueCues: updatedTechniquePro.specificTips,
                  techniquePro: updatedTechniquePro,
                  sets: isDifferentExercise
                    ? ex.sets.map((s, idx) => {
                        if (s.completed) return s;
                        const detailSnap = matched?.setsDetail?.[idx];
                        const perSetHint = detailSnap
                          ? `${detailSnap.weight} kg × ${detailSnap.reps}`
                          : newPrevHint;
                        return {
                          ...s,
                          weight: '' as number | '',
                          reps: '' as number | '',
                          previous: perSetHint,
                        };
                      })
                    : ex.sets,
                };
              }
              return ex;
            }),
          };
        },
        { syncMode: 'immediate' }
      );
    },
    [routines, history, commitActiveSessionMutation]
  );

  // Dynamically replace an exercise in the active workout session (preserving original history & clearing uncompleted loads)
  const replaceActiveExerciseWithAI = useCallback(
    (
      exerciseId: string,
      replacement: {
        newName: string;
        libraryExerciseId?: string;
        targetMuscles?: string;
        equipment?: string;
        notes?: string;
        restSeconds?: number;
        initialWeight?: number;
      }
    ) => {
      commitActiveSessionMutation(
        (currSession) => ({
          ...currSession,
          exercises: currSession.exercises.map((ex) => {
            if (ex.exerciseId === exerciseId) {
              const origName = ex.originalExerciseName || ex.exerciseName;
              const origId = ex.originalExerciseId || ex.exerciseId;
              const isDifferentExercise =
                normalizeText(replacement.newName) !== normalizeText(ex.activeExerciseName);

              const resolvedLib = resolveLibraryExercise({
                libraryExerciseId: replacement.libraryExerciseId,
                name: replacement.newName,
                equipment: replacement.equipment,
              });

              const matched = findPreviousExerciseSessions({
                history,
                exercise: {
                  libraryExerciseId: resolvedLib?.id || replacement.libraryExerciseId,
                  activeExerciseName: replacement.newName,
                  originalExerciseName: origName,
                  equipment: replacement.equipment || resolvedLib?.equipment,
                  useAlternative: true,
                },
                currentSessionId: currSession.sessionId,
                currentSessionStartTime: currSession.startTime,
                activeProfileId: activeProfileIdRef.current,
                limit: 1,
              })[0];

              const newPrevHint = matched
                ? matched.maxWeight > 0
                  ? `${matched.maxWeight} kg × ${matched.maxReps}`
                  : `${matched.maxReps} reps`
                : '';

              const updatedTechniquePro = buildTechniqueProProfile({
                id: ex.exerciseId,
                libraryExerciseId: resolvedLib?.id || replacement.libraryExerciseId,
                name: replacement.newName,
                targetMuscles: replacement.targetMuscles || resolvedLib?.muscleGroup || ex.targetMuscles,
                equipment: replacement.equipment || resolvedLib?.equipment || ex.equipment,
              });

              return {
                ...ex,
                originalExerciseId: origId,
                originalExerciseName: origName,
                libraryExerciseId: resolvedLib?.id || replacement.libraryExerciseId,
                activeExerciseName: replacement.newName,
                targetMuscles: replacement.targetMuscles || resolvedLib?.muscleGroup || ex.targetMuscles,
                equipment: replacement.equipment || resolvedLib?.equipment || ex.equipment,
                techniqueCues: updatedTechniquePro.specificTips,
                techniquePro: updatedTechniquePro,
                notes: replacement.notes
                  ? ex.notes
                    ? `${ex.notes} · ${replacement.notes}`
                    : replacement.notes
                  : ex.notes,
                restSeconds: replacement.restSeconds || ex.restSeconds,
                sets: isDifferentExercise
                  ? ex.sets.map((s, idx) => {
                      if (s.completed) return s;
                      const detailSnap = matched?.setsDetail?.[idx];
                      const perSetHint = detailSnap
                        ? `${detailSnap.weight} kg × ${detailSnap.reps}`
                        : newPrevHint;
                      return {
                        ...s,
                        weight:
                          typeof replacement.initialWeight === 'number' && replacement.initialWeight > 0
                            ? replacement.initialWeight
                            : ('' as number | ''),
                        reps: '' as number | '',
                        previous: perSetHint,
                      };
                    })
                  : ex.sets,
              };
            }
            return ex;
          }),
        }),
        { syncMode: 'immediate' }
      );
    },
    [history, commitActiveSessionMutation]
  );

  // Start workout session
  const startWorkout = useCallback((routine: Routine) => {
    const nowMs = Date.now();
    // Find previous performance for placeholder/reference strictly matching IDs/aliases & equipment
    const exercisesState = routine.exercises.map((ex) => {
      const isAlt = !!selectedAlternatives[ex.id];
      const activeName = isAlt && ex.alternative ? ex.alternative : ex.name;
      const resolvedLib = resolveLibraryExercise({
        libraryExerciseId: !isAlt ? ex.libraryExerciseId : undefined,
        id: !isAlt ? ex.id : undefined,
        name: activeName,
        equipment: !isAlt ? ex.equipment : undefined,
      });

      const matched = findPreviousExerciseSessions({
        history,
        exercise: {
          exerciseId: ex.id,
          originalExerciseId: ex.id,
          libraryExerciseId: resolvedLib?.id || (!isAlt ? ex.libraryExerciseId : undefined),
          activeExerciseName: activeName,
          originalExerciseName: ex.name,
          equipment: (!isAlt ? ex.equipment : undefined) || resolvedLib?.equipment,
          useAlternative: isAlt,
        },
        currentSessionStartTime: nowMs,
        activeProfileId: activeProfileIdRef.current,
        limit: 1,
      })[0];

      const fallbackHint = matched
        ? matched.maxWeight > 0
          ? `${matched.maxWeight} kg × ${matched.maxReps}`
          : `${matched.maxReps} reps`
        : '';

      const sets = Array.from({ length: ex.defaultSets || 3 }).map((_, idx) => {
        const detailSnap = matched?.setsDetail?.[idx];
        const previousHint = detailSnap
          ? `${detailSnap.weight} kg × ${detailSnap.reps}`
          : fallbackHint;
        return {
          id: generateStableId('set'),
          setNumber: idx + 1,
          weight: '' as number | '',
          reps: '' as number | '',
          completed: false,
          previous: previousHint,
        };
      });

      const resolvedLibId = resolvedLib?.id || (!isAlt ? ex.libraryExerciseId : undefined);
      const resolvedEq = (!isAlt ? ex.equipment : undefined) || resolvedLib?.equipment;
      const techniquePro = buildTechniqueProProfile({
        id: ex.id,
        libraryExerciseId: resolvedLibId,
        name: activeName,
        targetMuscles: ex.targetMuscles,
        equipment: resolvedEq,
      });

      return {
        exerciseId: ex.id,
        libraryExerciseId: resolvedLibId,
        exerciseName: ex.name,
        originalExerciseId: ex.id,
        originalExerciseName: ex.name,
        targetMuscles: ex.targetMuscles,
        equipment: resolvedEq,
        objective: ex.objective,
        repRange: ex.repRange,
        sets,
        useAlternative: isAlt,
        activeExerciseName: activeName,
        techniqueCues: techniquePro.specificTips,
        techniquePro,
        notes: '',
        restSeconds:
          isRdlBarbellExercise(activeName) || isRdlBarbellExercise(ex.name)
            ? 150
            : isBulgarianDumbbellExercise(activeName) || isBulgarianDumbbellExercise(ex.name)
            ? 90
            : extractRestSeconds(
                (ex as any).DESCANSO ?? ex.descanso ?? ex.restText ?? ex.restSeconds,
                90
              ),
      };
    });

    const newSession: ActiveWorkoutSession = {
      sessionId: `workout-${nowMs}-${Math.random().toString(36).slice(2, 7)}`,
      routineId: routine.id,
      routineTitle: routine.title,
      startTime: nowMs,
      updatedAt: nowMs,
      exercises: exercisesState,
    };
    activeSessionRef.current = newSession;
    const startWrite = safeLocalStorageSetItem(
      `lazcakon_${activeProfileIdRef.current}_active_session`,
      JSON.stringify(newSession),
      { critical: true }
    );
    setActiveSession(newSession);
    if (!startWrite.ok && startWrite.quotaExceeded && startWrite.errorMessage) {
      setWorkoutSyncStatus('error');
      setWorkoutSyncError(startWrite.errorMessage);
    } else {
      setWorkoutSyncStatus('saved_local');
      setWorkoutSyncError(null);
    }
  }, [selectedAlternatives, history]);

  // Start a Free / Express Workout session
  const startFreeWorkout = useCallback((customTitle?: string, initialExercises: Routine['exercises'] = []) => {
    const nowMs = Date.now();
    const exercisesState = initialExercises.map((ex) => {
      const resolvedLib = resolveLibraryExercise({
        libraryExerciseId: ex.libraryExerciseId,
        id: ex.id,
        name: ex.name,
        equipment: ex.equipment,
      });

      const matched = findPreviousExerciseSessions({
        history,
        exercise: {
          exerciseId: ex.id,
          libraryExerciseId: resolvedLib?.id || ex.libraryExerciseId,
          activeExerciseName: ex.name,
          originalExerciseName: ex.name,
          equipment: ex.equipment || resolvedLib?.equipment,
        },
        currentSessionStartTime: nowMs,
        activeProfileId: activeProfileIdRef.current,
        limit: 1,
      })[0];

      const fallbackHint = matched
        ? matched.maxWeight > 0
          ? `${matched.maxWeight} kg × ${matched.maxReps}`
          : `${matched.maxReps} reps`
        : '';

      const sets = Array.from({ length: ex.defaultSets || 3 }).map((_, idx) => {
        const detailSnap = matched?.setsDetail?.[idx];
        const previousHint = detailSnap
          ? `${detailSnap.weight} kg × ${detailSnap.reps}`
          : fallbackHint;
        return {
          id: generateStableId('set'),
          setNumber: idx + 1,
          weight: '' as number | '',
          reps: '' as number | '',
          completed: false,
          previous: previousHint,
        };
      });

      return {
        exerciseId: ex.id,
        libraryExerciseId: resolvedLib?.id || ex.libraryExerciseId,
        exerciseName: ex.name,
        originalExerciseId: ex.id,
        originalExerciseName: ex.name,
        targetMuscles: ex.targetMuscles,
        equipment: ex.equipment || resolvedLib?.equipment,
        objective: ex.objective,
        repRange: ex.repRange,
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

    const newFreeSession: ActiveWorkoutSession = {
      sessionId: `workout-${nowMs}-${Math.random().toString(36).slice(2, 7)}`,
      routineId: `libre-${nowMs}`,
      routineTitle: customTitle?.trim() || 'Sesión Libre',
      startTime: nowMs,
      updatedAt: nowMs,
      exercises: exercisesState,
    };
    activeSessionRef.current = newFreeSession;
    const freeWrite = safeLocalStorageSetItem(
      `lazcakon_${activeProfileIdRef.current}_active_session`,
      JSON.stringify(newFreeSession),
      { critical: true }
    );
    setActiveSession(newFreeSession);
    if (!freeWrite.ok && freeWrite.quotaExceeded && freeWrite.errorMessage) {
      setWorkoutSyncStatus('error');
      setWorkoutSyncError(freeWrite.errorMessage);
    } else {
      setWorkoutSyncStatus('saved_local');
      setWorkoutSyncError(null);
    }
  }, [history]);

  // Dynamically add an exercise to the live workout session (synchronous autosave)
  const addExerciseToActiveSession = useCallback(
    (ex: Routine['exercises'][number]) => {
      commitActiveSessionMutation(
        (prev) => {
          const resolvedLib = resolveLibraryExercise({
            libraryExerciseId: ex.libraryExerciseId,
            id: ex.id,
            name: ex.name,
            equipment: ex.equipment,
          });

          const matched = findPreviousExerciseSessions({
            history,
            exercise: {
              exerciseId: ex.id,
              libraryExerciseId: resolvedLib?.id || ex.libraryExerciseId,
              activeExerciseName: ex.name,
              originalExerciseName: ex.name,
              equipment: ex.equipment || resolvedLib?.equipment,
            },
            currentSessionId: prev.sessionId,
            currentSessionStartTime: prev.startTime,
            activeProfileId: activeProfileIdRef.current,
            limit: 1,
          })[0];

          const fallbackHint = matched
            ? matched.maxWeight > 0
              ? `${matched.maxWeight} kg × ${matched.maxReps}`
              : `${matched.maxReps} reps`
            : '';

          const uniqueId = prev.exercises.some((item) => item.exerciseId === ex.id)
            ? `${ex.id}-${Date.now()}`
            : ex.id;

          const sets = Array.from({ length: ex.defaultSets || 3 }).map((_, idx) => {
            const detailSnap = matched?.setsDetail?.[idx];
            const previousHint = detailSnap
              ? `${detailSnap.weight} kg × ${detailSnap.reps}`
              : fallbackHint;
            return {
              id: generateStableId('set'),
              setNumber: idx + 1,
              weight: '' as number | '',
              reps: '' as number | '',
              completed: false,
              previous: previousHint,
            };
          });

          const techniquePro = buildTechniqueProProfile({
            id: uniqueId,
            libraryExerciseId: resolvedLib?.id || ex.libraryExerciseId,
            name: ex.name,
            targetMuscles: ex.targetMuscles,
            equipment: ex.equipment || resolvedLib?.equipment,
          });

          return {
            ...prev,
            exercises: [
              ...prev.exercises,
              {
                exerciseId: uniqueId,
                libraryExerciseId: resolvedLib?.id || ex.libraryExerciseId,
                exerciseName: ex.name,
                originalExerciseId: ex.id,
                originalExerciseName: ex.name,
                targetMuscles: ex.targetMuscles,
                equipment: ex.equipment || resolvedLib?.equipment,
                objective: ex.objective,
                repRange: ex.repRange,
                sets,
                useAlternative: false,
                activeExerciseName: ex.name,
                techniqueCues: techniquePro.specificTips,
                techniquePro,
                notes: '',
                restSeconds: extractRestSeconds(
                  (ex as any).DESCANSO ?? ex.descanso ?? ex.restText ?? ex.restSeconds,
                  90
                ),
              },
            ],
          };
        },
        { syncMode: 'immediate' }
      );
    },
    [history, commitActiveSessionMutation]
  );

  // Remove an exercise from the active workout session (synchronous autosave)
  const removeExerciseFromActiveSession = useCallback(
    (exerciseId: string) => {
      commitActiveSessionMutation(
        (prev) => ({
          ...prev,
          exercises: prev.exercises.filter((ex) => ex.exerciseId !== exerciseId),
        }),
        { syncMode: 'immediate' }
      );
    },
    [commitActiveSessionMutation]
  );

  // Insert automatic progressive warm-up sets (50% x 10, 70% x 6, 85% x 3)
  const addWarmupSetsToExercise = useCallback(
    (exerciseId: string, baseWeight?: number) => {
      commitActiveSessionMutation(
        (prev) => ({
          ...prev,
          exercises: prev.exercises.map((ex) => {
            if (ex.exerciseId !== exerciseId) return ex;

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
              const prevStr = ex.sets[0]?.previous || '';
              const match = prevStr.match(/(\d+(?:\.\d+)?)/);
              if (match) refWeight = parseFloat(match[1]);
            }
            if (!refWeight || refWeight < 10) refWeight = 60;

            const round25 = (val: number) => Math.max(2.5, Math.round(val / 2.5) * 2.5);

            const warmupSets = [
              {
                id: generateStableId('set'),
                setNumber: 1,
                weight: round25(refWeight * 0.5),
                reps: 10,
                completed: false,
                previous: '50% Aprox.',
                isWarmup: true,
              },
              {
                id: generateStableId('set'),
                setNumber: 2,
                weight: round25(refWeight * 0.7),
                reps: 6,
                completed: false,
                previous: '70% Aprox.',
                isWarmup: true,
              },
              {
                id: generateStableId('set'),
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
        }),
        { syncMode: 'local_only' }
      );
    },
    [prs, commitActiveSessionMutation]
  );

  // Update set in live session (persists immediately locally + syncs/queues when set is completed)
  const updateSet = useCallback(
    (exerciseId: string, setIndex: number, field: 'weight' | 'reps' | 'rpe' | 'completed', value: unknown) => {
      const prev = activeSessionRef.current;
      if (!prev) return;

      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const targetProfileId = activeProfileIdRef.current;

      const nextExercises = prev.exercises.map((ex) => {
        if (ex.exerciseId !== exerciseId) return ex;

        const nextSets = [...ex.sets];
        const existingSet = nextSets[setIndex];
        if (!existingSet) return ex;

        const nextRpe =
          field === 'rpe'
            ? typeof value === 'number' && Number.isFinite(value)
              ? value
              : undefined
            : existingSet.rpe;
        const nextRir = deriveRirFromRpe(nextRpe) ?? existingSet.rir;

        const currentSet = {
          ...existingSet,
          id: existingSet.id || generateStableId('set'),
          [field]: value,
          ...(nextRir !== undefined ? { rir: nextRir } : {}),
          ...(field === 'completed' && value === true ? { completedAt: nowIso } : {}),
          ...(field === 'completed' && value === false ? { completedAt: undefined } : {}),
        };
        nextSets[setIndex] = currentSet;

        if (field === 'completed' && value === true) {
          if (activeProfile.soundEnabled) playBeep(false);
          if (activeProfile.vibrationEnabled) vibrateDevice([100, 60, 100]);
        }

        return { ...ex, sets: nextSets };
      });

      const nextSession = ensureSessionStableIds({
        ...prev,
        updatedAt: nowMs,
        exercises: nextExercises,
      });

      activeSessionRef.current = nextSession;
      const setWrite = safeLocalStorageSetItem(
        `lazcakon_${targetProfileId}_active_session`,
        JSON.stringify(nextSession),
        { critical: true }
      );
      setActiveSession(nextSession);
      if (!setWrite.ok && setWrite.quotaExceeded && setWrite.errorMessage) {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(setWrite.errorMessage);
      }

      if (field === 'completed' || (field === 'rpe' && nextExercises.some((ex) => ex.exerciseId === exerciseId && ex.sets[setIndex]?.completed))) {
        void persistWorkoutPatchToCloud(
          targetProfileId,
          {
            activeSession: nextSession,
            activeSessionUpdatedAt: nowMs,
          },
          'workout_patch'
        );
      } else if (setWrite.ok) {
        const hasPending = getOfflineSyncQueue().some((q) => q.profileId === targetProfileId);
        setWorkoutSyncStatus(hasPending ? 'pending_sync' : 'saved_local');
      }
    },
    [activeProfile.soundEnabled, activeProfile.vibrationEnabled, persistWorkoutPatchToCloud]
  );

  const updateExerciseRestSeconds = useCallback(
    (exerciseId: string, restSeconds: number) => {
      const safeRest = Math.max(15, Math.min(600, Math.round(restSeconds)));
      commitActiveSessionMutation(
        (prev) => ({
          ...prev,
          exercises: prev.exercises.map((ex) =>
            ex.exerciseId === exerciseId ? { ...ex, restSeconds: safeRest } : ex
          ),
        }),
        { syncMode: 'local_only' }
      );
    },
    [commitActiveSessionMutation]
  );

  const addSetToExercise = useCallback(
    (exerciseId: string) => {
      commitActiveSessionMutation(
        (prev) => ({
          ...prev,
          exercises: prev.exercises.map((ex) => {
            if (ex.exerciseId !== exerciseId) return ex;
            const lastSet = ex.sets[ex.sets.length - 1];
            const newSet = {
              id: generateStableId('set'),
              setNumber: ex.sets.length + 1,
              weight: lastSet ? lastSet.weight : ('' as number | ''),
              reps: lastSet ? lastSet.reps : ('' as number | ''),
              completed: false,
              previous: lastSet?.previous,
            };
            return { ...ex, sets: [...ex.sets, newSet] };
          }),
        }),
        { syncMode: 'local_only' }
      );
    },
    [commitActiveSessionMutation]
  );

  const removeSetFromExercise = useCallback(
    (exerciseId: string, setIndex: number) => {
      commitActiveSessionMutation(
        (prev) => ({
          ...prev,
          exercises: prev.exercises.map((ex) => {
            if (ex.exerciseId !== exerciseId) return ex;
            if (ex.sets.length <= 1) return ex;
            const filtered = ex.sets
              .filter((_, idx) => idx !== setIndex)
              .map((s, idx) => ({ ...s, setNumber: idx + 1 }));
            return { ...ex, sets: filtered };
          }),
        }),
        { syncMode: 'local_only' }
      );
    },
    [commitActiveSessionMutation]
  );

  const updateExerciseNotes = useCallback(
    (exerciseId: string, notes: string) => {
      commitActiveSessionMutation(
        (prev) => ({
          ...prev,
          exercises: prev.exercises.map((ex) => (ex.exerciseId === exerciseId ? { ...ex, notes } : ex)),
        }),
        { syncMode: 'local_only' }
      );
    },
    [commitActiveSessionMutation]
  );

  const pauseWorkoutSession = useCallback(() => {
    const current = activeSessionRef.current;
    if (!current || current.isPaused) return;
    const nowMs = Date.now();
    if (restTimerRef.current?.active && !restTimerRef.current?.paused) {
      pauseRestTimer();
    }
    commitActiveSessionMutation(
      (prev) => pauseActiveWorkoutSession(prev, nowMs),
      { syncMode: 'immediate' }
    );
  }, [commitActiveSessionMutation, pauseRestTimer]);

  const resumeWorkoutSession = useCallback(() => {
    const current = activeSessionRef.current;
    if (!current || !current.isPaused) return;
    const nowMs = Date.now();
    commitActiveSessionMutation(
      (prev) => resumeActiveWorkoutSession(prev, nowMs),
      { syncMode: 'immediate' }
    );
  }, [commitActiveSessionMutation]);

  // Finish Workout (uses canonical activeSessionRef so zero rapid edits are ever dropped)
  const finishWorkout = useCallback((): { workout: CompletedWorkout; newPRs: PersonalRecord[] } | null => {
    const currentActiveSession = activeSessionRef.current || activeSession;
    if (!currentActiveSession || isFinishingWorkoutRef.current) return null;
    isFinishingWorkoutRef.current = true;

    const targetProfileId = activeProfileIdRef.current;
    const currentHistory = historyRef.current;
    const endTime = Date.now();
    const rawDurationSeconds = Math.max(
      1,
      Math.round(computeActiveSessionElapsedMs(currentActiveSession, endTime) / 1000)
    );
    let totalVolumeKg = 0;
    let completedSetsCount = 0;
    let totalRepsCount = 0;
    const exercisesSummary: CompletedWorkout['exercisesSummary'] = [];
    const newPRsList: PersonalRecord[] = [];
    const primaryMuscleSet = new Set<string>();
    const secondaryMuscleSet = new Set<string>();

    const updatedPrs = { ...prsRef.current };

    currentActiveSession.exercises.forEach((ex) => {
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

        const workingCompletedSets = ex.sets.filter((s) => s.completed && !s.isWarmup);
        const setsForDetail = workingCompletedSets.length > 0 ? workingCompletedSets : ex.sets.filter((s) => s.completed);
        const setsDetail = setsForDetail.map((s, sIdx) => {
          const snap: {
            id?: string;
            setNumber: number;
            weight: number;
            reps: number;
            rpe?: number;
            rir?: number;
            completed?: boolean;
            completedAt?: string;
          } = {
            id: s.id || generateStableId('set'),
            setNumber: sIdx + 1,
            weight: typeof s.weight === 'number' ? s.weight : 0,
            reps: typeof s.reps === 'number' ? s.reps : 0,
            completed: true,
          };
          if (typeof s.completedAt === 'string' && s.completedAt.trim()) {
            snap.completedAt = s.completedAt.trim();
          }
          if (typeof s.rpe === 'number' && Number.isFinite(s.rpe) && s.rpe > 0) {
            snap.rpe = s.rpe;
            snap.rir = typeof s.rir === 'number' ? s.rir : deriveRirFromRpe(s.rpe);
          } else if (typeof s.rir === 'number' && Number.isFinite(s.rir) && s.rir >= 0) {
            snap.rir = s.rir;
          }
          return snap;
        });

        const isSubstitutedEx =
          Boolean(ex.useAlternative) ||
          (Boolean(ex.originalExerciseName) &&
            normalizeText(ex.originalExerciseName) !== normalizeText(ex.activeExerciseName));
        const resolvedSummaryLib = resolveLibraryExercise({
          libraryExerciseId: !isSubstitutedEx ? ex.libraryExerciseId : undefined,
          id: !isSubstitutedEx ? ex.exerciseId : undefined,
          name: ex.activeExerciseName,
          equipment: ex.equipment,
        });

        const summaryEntry: CompletedWorkout['exercisesSummary'][number] = {
          exerciseId: ex.exerciseId,
          originalExerciseId: ex.originalExerciseId || ex.exerciseId,
          originalExerciseName: ex.originalExerciseName || ex.exerciseName,
          name: ex.activeExerciseName,
          sets: workingCompletedSets.length > 0 ? workingCompletedSets.length : exCompletedSets,
          setsDetail,
          totalReps: exTotalReps,
          maxWeight: exerciseMaxWeight,
          maxReps: exerciseMaxReps,
          volumeKg: exVol,
          muscleGroup: ex.targetMuscles,
          estimated1RM:
            exerciseMaxWeight > 0 && exerciseMaxReps > 0
              ? Math.round(exerciseMaxWeight * (1 + exerciseMaxReps / 30))
              : 0,
        };
        if (resolvedSummaryLib?.id || (!isSubstitutedEx && ex.libraryExerciseId)) {
          summaryEntry.libraryExerciseId = resolvedSummaryLib?.id || ex.libraryExerciseId;
        }
        if (ex.equipment || resolvedSummaryLib?.equipment) {
          summaryEntry.equipment = ex.equipment || resolvedSummaryLib?.equipment;
        }
        if (typeof exAvgRpe === 'number') {
          summaryEntry.rpe = exAvgRpe;
        }

        exercisesSummary.push(summaryEntry);
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
    const todayDateKey = getChileLocalDateKey(nowIso);
    const sanitizedDurationSeconds = sanitizeWorkoutDurationSeconds(
      rawDurationSeconds,
      completedSetsCount,
      exercisesSummary.length
    );
    const sanitizedRoutineTitle = sanitizeRoutineTitleForDate(
      currentActiveSession.routineTitle,
      todayDateKey
    );
    const durationMins = Math.round(sanitizedDurationSeconds / 60);
    const caloriesBurned = calculateWorkoutCaloriesBurned({
      durationMinutes: durationMins,
      totalVolumeKg,
      bodyWeightKg: activeWeightRef.current || 95,
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
    const sortedPrevious = [...currentHistory]
      .filter((h) => (resolveWorkoutChileDateKey(h) || getChileLocalDateKey(h.date)) !== todayDateKey)
      .sort((a, b) => (b.startTime || 0) - (a.startTime || 0));
    const matchingPrevSession =
      sortedPrevious.find(
        (h) =>
          h.routineId === currentActiveSession.routineId ||
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

    const stableWorkoutId =
      currentActiveSession.sessionId ||
      `workout-${currentActiveSession.startTime}-${currentActiveSession.routineId || 'session'}`;
    const completedWorkout: CompletedWorkout = {
      id: stableWorkoutId,
      profileId: targetProfileId,
      routineId: currentActiveSession.routineId,
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
      [completedWorkout, ...currentHistory],
      activeWeightRef.current || 95
    );

    activeSessionRef.current = null;
    try {
      localStorage.removeItem(`lazcakon_${targetProfileId}_active_session`);
      clearActiveSessionUiState(currentActiveSession.sessionId || String(currentActiveSession.startTime));
    } catch {}
    const histWrite = safeLocalStorageSetItem(
      `lazcakon_${targetProfileId}_history`,
      JSON.stringify(deduplicatedHistory),
      { critical: true }
    );
    const prsWrite = safeLocalStorageSetItem(
      `lazcakon_${targetProfileId}_prs`,
      JSON.stringify(updatedPrs),
      { critical: true }
    );
    safeLocalStorageSetItem(
      `lazcakon_${targetProfileId}_active_session_cleared_at`,
      String(endTime),
      { critical: true }
    );

    setHistory(deduplicatedHistory);
    setPrs(updatedPrs);
    setActiveSession(null);
    stopRestTimer();
    if (!histWrite.ok && histWrite.quotaExceeded && histWrite.errorMessage) {
      setWorkoutSyncStatus('error');
      setWorkoutSyncError(histWrite.errorMessage);
    } else if (!prsWrite.ok && prsWrite.quotaExceeded && prsWrite.errorMessage) {
      setWorkoutSyncStatus('error');
      setWorkoutSyncError(prsWrite.errorMessage);
    }

    // Trigger cloud sync or queue offline sync immediately with explicit activeSession: null
    const syncPayload = {
      history: deduplicatedHistory,
      prs: updatedPrs,
      routines: routinesRef.current,
      bodyWeightLogs: bodyWeightLogsRef.current,
      activeSession: null,
      activeSessionClearedAt: endTime,
    };
    void persistWorkoutPatchToCloud(targetProfileId, syncPayload, 'workout_finish');

    return { workout: completedWorkout, newPRs: newPRsList };
  }, [activeSession, stopRestTimer, persistWorkoutPatchToCloud]);

  const cancelWorkout = useCallback(() => {
    const targetId = activeProfileIdRef.current;
    const clearedAt = Date.now();
    const prevSession = activeSessionRef.current;
    activeSessionRef.current = null;
    try {
      localStorage.removeItem(`lazcakon_${targetId}_active_session`);
      localStorage.setItem(`lazcakon_${targetId}_active_session_cleared_at`, String(clearedAt));
      clearActiveSessionUiState(prevSession?.sessionId || (prevSession ? String(prevSession.startTime) : undefined));
    } catch {}
    setActiveSession(null);
    stopRestTimer();
    void persistWorkoutPatchToCloud(
      targetId,
      {
        activeSession: null,
        activeSessionClearedAt: clearedAt,
      },
      'workout_cancel'
    );
  }, [stopRestTimer, persistWorkoutPatchToCloud]);

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
      setPendingLegacyVerification(false);
      setSessionBootstrapError(null);
      setAuthStatusNotice(null);
      let tokenState = await refreshAuthSession(auth.currentUser, false);
      if (payload.isAdmin && !tokenState.isGoogleVerified && auth.currentUser) {
        tokenState = await refreshAuthSession(auth.currentUser, true);
      }
      const effectiveAdmin = Boolean(payload.isAdmin && tokenState.isGoogleVerified);
      saveOfflineSessionBinding({
        uid: payload.uid,
        athleteId: payload.athleteId,
        isGoogleVerified: tokenState.isGoogleVerified,
        isAdminVerified: effectiveAdmin,
        profile: payload.profile,
      });
      setIsOfflineSession(false);
      setServerAdminVerified(Boolean(payload.isAdmin));
      setAdminRequiresGoogleSignIn(Boolean(payload.adminRequiresGoogleSignIn));
      setSessionAthleteId(payload.athleteId);
      sessionInitializedUidRef.current = payload.uid;
      if (effectiveAdmin) {
        adminRosterHydratedUidRef.current = null;
      }
      setBootstrappedUid(payload.uid);
      mergeCloudProfileIntoState(payload.profile, !effectiveAdmin, effectiveAdmin);
      setActiveProfileId(payload.athleteId);
      setIsLoggedIn(true);
      processPendingOfflineSyncs({ forceNow: true }).catch(() => {});
    },
    [mergeCloudProfileIntoState, refreshAuthSession]
  );

  const captureAndFormatFirebaseAuthError = useCallback(
    (operation: string, err: any): { code: string; rawMessage: string; formattedMessage: string } => {
      const code = String(err?.code || 'auth/unknown-error');
      const rawMessage = String(err?.message || err || 'Error desconocido');
      // Log only operation, code, and message — never log passwords, PINs, or tokens
      console.warn('[FirebaseAuthError]', {
        operation,
        code,
        message: rawMessage,
      });

      const diagnostic = `[Operación: ${operation} | Código: ${code} | Mensaje: ${rawMessage}]`;

      if (
        code === 'auth/invalid-credential' ||
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-login-credentials'
      ) {
        return {
          code,
          rawMessage,
          formattedMessage: `Contraseña incorrecta o método de acceso distinto para este correo. Si ya cambiaste tu contraseña, verifica que sea la actual o usa "Recuperar por correo" / "Continuar con Google". ${diagnostic}`,
        };
      }
      if (code === 'auth/user-not-found') {
        return {
          code,
          rawMessage,
          formattedMessage: `No se encontró una cuenta en Firebase Authentication con este correo. ${diagnostic}`,
        };
      }
      if (code === 'auth/invalid-email') {
        return {
          code,
          rawMessage,
          formattedMessage: `El formato del correo electrónico no es válido. ${diagnostic}`,
        };
      }
      if (code === 'auth/email-already-in-use') {
        return {
          code,
          rawMessage,
          formattedMessage: `Esta cuenta ya existe en Firebase Authentication. Inicia sesión en la pantalla principal con tu contraseña actual o con Google. ${diagnostic}`,
        };
      }
      if (code === 'auth/too-many-requests') {
        return {
          code,
          rawMessage,
          formattedMessage: `Demasiados intentos fallidos seguidos. Firebase ha bloqueado temporalmente el acceso por seguridad; intenta en unos minutos o usa "Recuperar por correo". ${diagnostic}`,
        };
      }
      if (code === 'auth/network-request-failed') {
        return {
          code,
          rawMessage,
          formattedMessage: `Error de red al conectar con Firebase Authentication. Verifica tu conexión a internet. ${diagnostic}`,
        };
      }
      if (code.includes('-26') || rawMessage.includes('auth/error-code:-26')) {
        return {
          code,
          rawMessage,
          formattedMessage: `Firebase Authentication devolvió ${code} en ${operation}. Inicia sesión desde la pantalla principal con tu contraseña actual o con "Continuar con Google", o usa "Recuperar por correo". ${diagnostic}`,
        };
      }

      return {
        code,
        rawMessage,
        formattedMessage: `Error de autenticación en Firebase: ${rawMessage} ${diagnostic}`,
      };
    },
    []
  );

  // Firebase Auth normal login with Email + Password (authenticates strictly via Firebase Auth, never compares against legacy PIN)
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
      linkingConflict?: boolean;
    }> => {
      const trimmedEmail = email.toLowerCase().trim();
      const trimmedSecret = pinOrPassword.trim();

      if (!trimmedEmail || !trimmedSecret) {
        return { success: false, message: 'Ingresa tu correo electrónico y tu contraseña de Firebase Authentication.' };
      }

      manualAuthInProgressRef.current = true;
      setIsManualAuthInProgress(true);
      setAuthStatusNotice(null);
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
          // Only redirect to legacy PIN verification if the server explicitly confirms the profile is still unmigrated
          if (
            sessionRes.status === 409 &&
            sessionData?.requiresLegacyVerification === true &&
            !sessionData?.linkingConflict &&
            !sessionData?.alreadyLinkedToAnotherUid
          ) {
            pendingLegacyVerificationRef.current = true;
            setPendingLegacyVerification(true);
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
          sessionInitializedUidRef.current = null;
          setBootstrappedUid(null);
          const serverCode = sessionData?.code || `HTTP_${sessionRes.status}`;
          const serverOp = sessionData?.operation || 'POST /api/auth/session-init';
          const serverErr =
            sessionData?.error ||
            sessionRes.error ||
            'No se pudo recuperar el perfil vinculado al authUid en el servidor.';
          return {
            success: false,
            linkingConflict: Boolean(sessionData?.linkingConflict || sessionData?.alreadyLinkedToAnotherUid),
            message: `${serverErr} [Operación: ${serverOp} | Código: ${serverCode}]`,
          };
        }

        if (!sessionData?.athleteId || !sessionData?.profile) {
          await signOut(auth).catch(() => {});
          sessionInitializedUidRef.current = null;
          setBootstrappedUid(null);
          return {
            success: false,
            message: 'Error cargando el perfil desde el servidor: respuesta sin datos de perfil [Operación: POST /api/auth/session-init | Código: EMPTY_PROFILE].',
          };
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
        // Never redirect to legacy PIN linking on password, network, permission, or auth errors
        const formatted = captureAndFormatFirebaseAuthError('signInWithEmailAndPassword', err);
        return {
          success: false,
          message: formatted.formattedMessage,
        };
      } finally {
        manualAuthInProgressRef.current = false;
        setIsManualAuthInProgress(false);
      }
    },
    [captureAndFormatFirebaseAuthError, finalizeAuthenticatedSession]
  );

  // Firebase Auth login with Google Sign-In (validates Master Admin or linked/unlinked athlete profile)
  const loginWithGoogle = useCallback(async (): Promise<{
    success: boolean;
    message: string;
    requiresLegacyVerification?: boolean;
    legacyEmail?: string;
    linkingConflict?: boolean;
  }> => {
    manualAuthInProgressRef.current = true;
    setIsManualAuthInProgress(true);
    setAuthStatusNotice(null);
    try {
      const cred = await signInWithGoogleHybrid();
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
        if (
          res.status === 409 &&
          data?.requiresLegacyVerification === true &&
          !data?.linkingConflict &&
          !data?.alreadyLinkedToAnotherUid
        ) {
          pendingLegacyVerificationRef.current = true;
          setPendingLegacyVerification(true);
          return {
            success: false,
            requiresLegacyVerification: true,
            legacyEmail: data.email || cred.user.email || '',
            message:
              data.error ||
              'Encontramos un perfil heredado pendiente. Ingresa tu PIN anterior o código de recuperación para vincular tu historial.',
          };
        }
        await signOut(auth).catch(() => {});
        sessionInitializedUidRef.current = null;
        setBootstrappedUid(null);
        const serverCode = data?.code || `HTTP_${res.status}`;
        const serverOp = data?.operation || 'POST /api/auth/session-init (Google)';
        const serverErr =
          data?.error ||
          res.error ||
          'Este correo Google no tiene una cuenta vinculada activa.';
        return {
          success: false,
          linkingConflict: Boolean(data?.linkingConflict || data?.alreadyLinkedToAnotherUid),
          message: `${serverErr} [Operación: ${serverOp} | Código: ${serverCode}]`,
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
      const opLabel = getGoogleAuthOperationLabel();
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return {
          success: false,
          message: `Inicio de sesión con Google cancelado por el usuario. [Operación: ${opLabel} | Código: ${code}]`,
        };
      }
      if (code === 'auth/popup-blocked') {
        return {
          success: false,
          message: `El navegador bloqueó la ventana emergente de Google. Permite ventanas emergentes o abre la app en Chrome/Safari. [Operación: ${opLabel} | Código: ${code}]`,
        };
      }
      if (code === 'auth/unauthorized-domain') {
        return {
          success: false,
          message: `Este dominio no está autorizado en Firebase Authentication. [Operación: ${opLabel} | Código: ${code} | Mensaje: ${err?.message || ''}]`,
        };
      }
      const formatted = captureAndFormatFirebaseAuthError(opLabel, err);
      return {
        success: false,
        message: formatted.formattedMessage,
      };
    } finally {
      manualAuthInProgressRef.current = false;
      setIsManualAuthInProgress(false);
    }
  }, [captureAndFormatFirebaseAuthError, finalizeAuthenticatedSession]);

  // Step 2 of Legacy Profile Linking: verify ownership via PIN or Coach recovery code ONLY for unmigrated profiles
  const verifyAndLinkLegacyProfile = useCallback(
    async (params: {
      legacyEmail: string;
      pinOrRecoveryCode: string;
      newPassword?: string;
      authMethod?: 'current_session' | 'google' | 'create_password';
    }): Promise<{ success: boolean; message: string; alreadyMigrated?: boolean; linkingConflict?: boolean }> => {
      const targetEmail = params.legacyEmail.toLowerCase().trim();
      const secretProof = params.pinOrRecoveryCode.trim();
      if (!targetEmail || !secretProof) {
        return {
          success: false,
          message: 'Ingresa el correo del perfil heredado y tu PIN anterior o código de recuperación.',
        };
      }

      manualAuthInProgressRef.current = true;
      setIsManualAuthInProgress(true);
      pendingLegacyVerificationRef.current = true;
      setPendingLegacyVerification(true);
      let createdFreshPasswordUser: User | null = null;

      try {
        if (params.authMethod === 'google') {
          await signInWithGoogleHybrid();
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
          if (linkRes.alreadyMigrated) {
            pendingLegacyVerificationRef.current = false;
            setPendingLegacyVerification(false);
            await signOut(auth).catch(() => {});
            return {
              success: false,
              alreadyMigrated: true,
              message:
                'Este perfil ya completó la migración a Firebase Authentication. Inicia sesión normalmente en esta pantalla con tu correo y contraseña actual o con "Continuar con Google".',
            };
          }
          if (linkRes.linkingConflict || linkRes.alreadyLinkedToAnotherUid) {
            pendingLegacyVerificationRef.current = false;
            setPendingLegacyVerification(false);
            await signOut(auth).catch(() => {});
            return {
              success: false,
              alreadyMigrated: true,
              linkingConflict: true,
              message:
                linkRes.error ||
                'Conflicto de vinculación: este perfil ya está vinculado a otro identificador de Firebase Authentication.',
            };
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
        const opName =
          params.authMethod === 'google'
            ? getGoogleAuthOperationLabel()
            : params.authMethod === 'create_password'
            ? 'createUserWithEmailAndPassword'
            : 'verifyAndLinkLegacyProfile';
        const formatted = captureAndFormatFirebaseAuthError(opName, err);

        if (code === 'auth/email-already-in-use') {
          pendingLegacyVerificationRef.current = false;
          setPendingLegacyVerification(false);
          return {
            success: false,
            alreadyMigrated: true,
            message: `Esta cuenta ya está migrada en Firebase Authentication. Te hemos dirigido al inicio de sesión normal: ingresa con tu contraseña actual, usa "Continuar con Google", o pulsa "Recuperar por correo". [Operación: ${opName} | Código: ${code}]`,
          };
        }
        return {
          success: false,
          message: formatted.formattedMessage,
        };
      } finally {
        manualAuthInProgressRef.current = false;
        setIsManualAuthInProgress(false);
      }
    },
    [captureAndFormatFirebaseAuthError, finalizeAuthenticatedSession]
  );

  const cancelLegacyVerification = useCallback(async () => {
    pendingLegacyVerificationRef.current = false;
    setPendingLegacyVerification(false);
    sessionInitializedUidRef.current = null;
    setBootstrappedUid(null);
    setSessionBootstrapError(null);
    setServerAdminVerified(false);
    setAdminRequiresGoogleSignIn(false);
    setSessionAthleteId(null);
    setIsLoggedIn(false);
    await signOut(auth).catch(() => {});
  }, []);

  const requestPasswordReset = useCallback(
    async (email: string): Promise<{ success: boolean; message: string }> => {
      const cleanEmail = email.toLowerCase().trim();
      if (!cleanEmail) {
        return { success: false, message: 'Ingresa tu correo electrónico para recuperar la contraseña.' };
      }
      try {
        await sendPasswordResetEmail(auth, cleanEmail);
        return {
          success: true,
          message:
            'Correo de recuperación enviado a ' +
            cleanEmail +
            ' (proyecto Firebase: ' +
            (auth.app.options.projectId || 'forward-cortex-1ds98') +
            '). Revisa tu bandeja de entrada y carpeta de spam.',
        };
      } catch (err: any) {
        const formatted = captureAndFormatFirebaseAuthError('sendPasswordResetEmail', err);
        return {
          success: false,
          message: formatted.formattedMessage,
        };
      }
    },
    [captureAndFormatFirebaseAuthError]
  );

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
      setIsManualAuthInProgress(true);
      setAuthStatusNotice(null);
      let createdFreshPasswordUser: User | null = null;
      let signedInWithGoogle = false;

      try {
        let finalEmail = params.email.trim().toLowerCase();
        let finalName = params.name.trim();

        if (params.useGoogle) {
          const cred = await signInWithGoogleHybrid();
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
        setIsManualAuthInProgress(false);
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

      const linkedCred = await linkWithGoogleHybrid(currentUser);
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

  const getLogoutSafetyStatus = useCallback((): LogoutSafetyStatus => {
    return evaluateLogoutSafetyStatus({
      pendingSyncCount,
      hasActiveWorkout: Boolean(activeSessionRef.current),
      isOffline: typeof navigator === 'undefined' ? !isOnline : !navigator.onLine,
    });
  }, [pendingSyncCount, isOnline]);

  // Safe logout: keeps per-profile localStorage & pending offline sync queue intact!
  const logout = useCallback(async () => {
    if (restTimerRef.current?.active) {
      stopRestTimer();
    } else {
      void dismissActiveRestNotification();
    }
    pendingLegacyVerificationRef.current = false;
    setPendingLegacyVerification(false);
    sessionInitializedUidRef.current = null;
    sessionServerValidatedRef.current = false;
    setIsOfflineSession(false);
    setBootstrappedUid(null);
    setSessionBootstrapError(null);
    setAuthStatusNotice(null);
    setServerAdminVerified(false);
    setAdminRequiresGoogleSignIn(false);
    setSessionAthleteId(null);
    setIsLoggedIn(false);
    clearOfflineSessionBinding();
    try {
      localStorage.removeItem('lazcakon_is_logged_in');
    } catch {}
    await signOutNativeGoogleCache();
    await signOut(auth).catch(() => {});
  }, [stopRestTimer]);

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

      if (sanitizedUpdates.themeAccent !== undefined) {
        sanitizedUpdates.themeAccent = normalizeThemeAccent(sanitizedUpdates.themeAccent);
      }

      if (sanitizedUpdates.soundEnabled === false) {
        releaseTimerAudioResources();
      }

      setProfiles((prev) => {
        const targetId = activeProfileIdRef.current;
        const next = prev.map((p) => (p.id === targetId ? { ...p, ...sanitizedUpdates } : p));
        const updated = next.find((p) => p.id === targetId);
        if (updated) {
          // Keep offline session binding snapshot aligned with saved athlete preferences (including themeAccent)
          const existingBinding = getOfflineSessionBinding();
          if (
            existingBinding &&
            authUser &&
            existingBinding.uid === authUser.uid &&
            existingBinding.athleteId === updated.id
          ) {
            saveOfflineSessionBinding({
              uid: existingBinding.uid,
              athleteId: updated.id,
              isGoogleVerified: existingBinding.isGoogleVerified,
              isAdminVerified: existingBinding.isAdminVerified,
              profile: updated,
            });
          }

          if (authUser && updated.id !== 'perfil_default') {
            const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
            if (!onlineNow) {
              queueOfflineSync(updated.id, sanitizedUpdates as Record<string, unknown>, 'profile_update');
            } else {
              saveAthleteToCloud(updated)
                .then((res) => {
                  if (!res.success) {
                    queueOfflineSync(updated.id, sanitizedUpdates as Record<string, unknown>, 'profile_update');
                  }
                })
                .catch(() => {
                  queueOfflineSync(updated.id, sanitizedUpdates as Record<string, unknown>, 'profile_update');
                });
            }
          }
        }
        return next;
      });
    },
    [authUser]
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

  // Routines CRUD (offline-first queued + multi-planning safe)
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
      const prev = routinesRef.current;
      const existsById = prev.some((r) => r.id === normalizedRoutine.id);
      const rawNext = existsById
        ? prev.map((r) => (r.id === normalizedRoutine.id ? normalizedRoutine : r))
        : [...prev, normalizedRoutine];
      const next = consolidateWeeklyRoutines(rawNext);
      routinesRef.current = next;
      const rutWrite = safeLocalStorageSetItem(
        `lazcakon_${targetProfileId}_routines`,
        JSON.stringify(next),
        { critical: true }
      );
      setRoutines(next);
      if (!rutWrite.ok && rutWrite.quotaExceeded && rutWrite.errorMessage) {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(rutWrite.errorMessage);
      }
      void persistWorkoutPatchToCloud(targetProfileId, { routines: next }, 'routine_save');
    },
    [persistWorkoutPatchToCloud]
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
      const prev = routinesRef.current;
      const existsById = prev.some((r) => r.id === normalizedRoutine.id);
      const rawNext = existsById
        ? prev.map((r) => (r.id === normalizedRoutine.id ? normalizedRoutine : r))
        : [...prev, normalizedRoutine];
      const next = consolidateWeeklyRoutines(rawNext);
      routinesRef.current = next;
      const rutWrite = safeLocalStorageSetItem(
        `lazcakon_${targetProfileId}_routines`,
        JSON.stringify(next),
        { critical: true }
      );
      setRoutines(next);
      if (!rutWrite.ok && rutWrite.quotaExceeded && rutWrite.errorMessage) {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(rutWrite.errorMessage);
      }
      void persistWorkoutPatchToCloud(targetProfileId, { routines: next }, 'routine_save');
    },
    [persistWorkoutPatchToCloud]
  );

  const deleteRoutine = useCallback(
    (routineId: string) => {
      const targetProfileId = activeProfileIdRef.current;
      const next = routinesRef.current.filter((r) => r.id !== routineId);
      routinesRef.current = next;
      const rutWrite = safeLocalStorageSetItem(
        `lazcakon_${targetProfileId}_routines`,
        JSON.stringify(next),
        { critical: true }
      );
      setRoutines(next);
      if (!rutWrite.ok && rutWrite.quotaExceeded && rutWrite.errorMessage) {
        setWorkoutSyncStatus('error');
        setWorkoutSyncError(rutWrite.errorMessage);
      }
      void persistWorkoutPatchToCloud(targetProfileId, { routines: next }, 'routine_delete');
    },
    [persistWorkoutPatchToCloud]
  );

  const clearAllRoutines = useCallback(() => {
    const targetProfileId = activeProfileIdRef.current;
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
      'Antes de vaciar rutinas'
    );
    setPreImportBackup(snap);
    routinesRef.current = [];
    setRoutines([]);
    try {
      localStorage.setItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify([]));
    } catch {}
    void persistWorkoutPatchToCloud(targetProfileId, { routines: [] }, 'routine_delete');
  }, [persistWorkoutPatchToCloud]);

  const resetRoutinesToDefault = useCallback(() => {
    const targetProfileId = activeProfileIdRef.current;
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
      'Antes de restablecer rutinas'
    );
    setPreImportBackup(snap);
    routinesRef.current = [];
    setRoutines([]);
    try {
      localStorage.setItem(`lazcakon_${targetProfileId}_routines`, JSON.stringify([]));
    } catch {}
    void persistWorkoutPatchToCloud(targetProfileId, { routines: [] }, 'routine_delete');
  }, [persistWorkoutPatchToCloud]);

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
        void persistWorkoutPatchToCloud(targetProfileId, result.cloudPatch, 'import_restore');
      }

      return { success: true, message: result.message };
    },
    [activeProfile, updateProfile, persistWorkoutPatchToCloud]
  );

  // Importación segura (Excel, CSV, JSON, PDF, Imagen):
  // - Respaldo automático previo obligatorio
  // - Conserva rutinas previas por defecto ('append_new')
  // - Jamás sobrescribe entrenamientos completados, cargas, PRs, historial ni mapa muscular
  // - Aislada estrictamente al `activeProfileId`
  const importGymCsvData = useCallback(
    (data: SafeImportPayload) => {
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
        void persistWorkoutPatchToCloud(targetProfileId, res.cloudPatch, 'import_restore');
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
    },
    [persistWorkoutPatchToCloud]
  );

  // Restaurar respaldo automático previo a una importación (aislado por perfil)
  const restorePreImportBackup = useCallback(
    (backupId?: string) => {
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

        void persistWorkoutPatchToCloud(targetProfileId, cloudPatch, 'import_restore');

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
    },
    [persistWorkoutPatchToCloud]
  );

  // Recuperación Integral de Historial y Auditoría de Fuentes sin pérdidas
  const runManualHistoryRecovery = useCallback(async () => {
    const targetProfileId = activeProfileIdRef.current;
    if (!targetProfileId) return;
    setIsHistorySyncing(true);
    setHistorySyncError(null);

    try {
      backupAllRawSourcesBeforeRepair(targetProfileId);
      const beforeMetrics = summarizeHistoryMetrics(historyRef.current);

      const localSources = collectAllLocalHistorySources(targetProfileId);
      const allNamedSources: NamedHistorySourceInput[] = [...localSources];
      let cloudBindings: AthleteHistoryInventoryReport['uidToAthleteIdBindings'] = [];

      if (authUser && isLoggedIn) {
        try {
          const cloudDocs = await fetchAllAthleteHistorySourcesFromFirebase(targetProfileId);
          cloudBindings = cloudDocs.map((cd) => ({
            athleteId: cd.athleteId,
            boundUid: cd.boundUid,
            isCurrentUid: cd.isCurrentUid,
            docExists: cd.docExists,
            sessionCount: cd.sessionCount,
          }));

          for (const cd of cloudDocs) {
            if (cd.docExists && Array.isArray(cd.rawHistory) && cd.rawHistory.length > 0) {
              allNamedSources.push({
                sourceId: `firestore:${cd.athleteId}`,
                sourceLabel: `Firestore (/athletes/${cd.athleteId})`,
                sourceType: 'firestore_doc',
                rawRecords: cd.rawHistory,
                profileId: cd.athleteId,
                boundUid: cd.boundUid,
              });
            }
          }
        } catch (err: any) {
          setHistorySyncError(err?.message || 'Error al consultar documentos en Firestore');
        }
      }

      const unifiedResult = reconcileAndUnifyAthleteHistory(
        allNamedSources,
        activeWeightRef.current || 95
      );

      const afterMetrics = summarizeHistoryMetrics(unifiedResult.unifiedHistory);

      // Reconciliar PRs combinando guardados + marcas máximas de sesiones
      const currentPrsList = Object.values(prsRef.current || {});
      const reconciledPrsList = reconcilePersonalRecordsFromHistory(
        currentPrsList,
        unifiedResult.unifiedHistory
      );
      const reconciledPrsMap: Record<string, PersonalRecord> = {};
      for (const pr of reconciledPrsList) {
        reconciledPrsMap[pr.exerciseId] = pr;
      }

      // Actualizar estado si se encontraron sesiones o si no había nada
      if (unifiedResult.unifiedHistory.length > 0 || historyRef.current.length === 0) {
        setHistory(unifiedResult.unifiedHistory);
        localStorage.setItem(
          `lazcakon_${targetProfileId}_history`,
          JSON.stringify(unifiedResult.unifiedHistory)
        );
      }

      setPrs(reconciledPrsMap);
      localStorage.setItem(`lazcakon_${targetProfileId}_prs`, JSON.stringify(reconciledPrsMap));

      setHistoryConflicts(unifiedResult.conflicts);

      let backupCreated: string | null = null;
      try {
        const rawJson = localStorage.getItem(RAW_UNFILTERED_BACKUP_KEY);
        if (rawJson) {
          const parsed = JSON.parse(rawJson);
          backupCreated = parsed.firstCreatedAt || null;
        }
      } catch {}

      const report: AthleteHistoryInventoryReport = {
        generatedAt: new Date().toISOString(),
        activeProfileId: targetProfileId,
        authUid: authUser?.uid || null,
        authEmail: authUser?.email || null,
        isAnonymous: authUser?.isAnonymous || false,
        uidToAthleteIdBindings: cloudBindings,
        sources: unifiedResult.sourceInventory,
        beforeRecovery: beforeMetrics,
        afterRecovery: afterMetrics,
        conflicts: unifiedResult.conflicts,
        rawBackupKey: RAW_UNFILTERED_BACKUP_KEY,
        rawBackupCreatedAt: backupCreated,
      };
      setHistoryInventory(report);

      // Sincronizar hacia Firestore si la base remota tenía menos sesiones que el historial recuperado
      if (
        authUser &&
        isLoggedIn &&
        unifiedResult.unifiedHistory.length > 0 &&
        targetProfileId !== 'perfil_default'
      ) {
        syncUserDataToFirebase(targetProfileId, {
          history: unifiedResult.unifiedHistory,
          prs: reconciledPrsMap,
        }).catch(() => {});
      }

      return report;
    } catch (err: any) {
      console.warn('[runManualHistoryRecovery error]:', err);
      setHistorySyncError('Error al procesar recuperación de historial: ' + err?.message);
      return null;
    } finally {
      setIsHistorySyncing(false);
    }
  }, [authUser, isLoggedIn]);

  // Ejecutar purga manual y saneamiento sin pérdidas
  const purgeCorruptedHistory = useCallback(() => {
    return runManualHistoryRecovery();
  }, [runManualHistoryRecovery]);

  // Cloud sync with offline fallback queueing & honest sync state
  const syncToCloud = useCallback(async () => {
    const profileId = activeProfileIdRef.current;
    const payload = {
      profile: activeProfile,
      routines: routinesRef.current,
      history: historyRef.current,
      prs: prsRef.current,
      customLinks: customLinksRef.current,
      selectedAlternatives: selectedAlternativesRef.current,
      bodyWeightLogs: bodyWeightLogsRef.current,
      activeSession: activeSessionRef.current,
      activeSessionUpdatedAt: activeSessionRef.current?.updatedAt || Date.now(),
    };
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      queueOfflineSync(profileId, payload, 'full_sync');
      setWorkoutSyncStatus('pending_sync');
      setWorkoutSyncError(null);
      return {
        success: false,
        message: 'Sin conexión. Guardado en este dispositivo y pendiente de sincronización.',
      };
    }
    setWorkoutSyncStatus('pending_sync');
    setWorkoutSyncError(null);
    const res = await syncUserDataToFirebase(profileId, payload);
    if (!res.success) {
      queueOfflineSync(profileId, payload, 'full_sync');
      setWorkoutSyncStatus('error');
      setWorkoutSyncError(res.message);
      return res;
    }
    await processPendingOfflineSyncs({ forceNow: true, profileId }).catch(() => {});
    const stillQueued = getOfflineSyncQueue().some((q) => q.profileId === profileId);
    setWorkoutSyncStatus(stillQueued ? 'pending_sync' : 'synced');
    setWorkoutSyncError(null);
    return res;
  }, [activeProfile]);

  const retryWorkoutSync = useCallback(async () => {
    const profileId = activeProfileIdRef.current;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setWorkoutSyncStatus('pending_sync');
      setWorkoutSyncError('Sin conexión a internet. Se reintentará al reconectar.');
      return { success: false, message: 'Pendiente de sincronización (sin conexión).' };
    }

    setWorkoutSyncStatus('pending_sync');
    setWorkoutSyncError(null);

    await processPendingOfflineSyncs({ forceNow: true, profileId }).catch(() => {});
    const currentClearedAt = Number(localStorage.getItem(`lazcakon_${profileId}_active_session_cleared_at`) || '0') || 0;
    const patch: Record<string, unknown> = {
      history: historyRef.current,
      prs: prsRef.current,
      routines: routinesRef.current,
      bodyWeightLogs: bodyWeightLogsRef.current,
      activeSession: activeSessionRef.current,
      ...(activeSessionRef.current
        ? { activeSessionUpdatedAt: activeSessionRef.current.updatedAt || Date.now() }
        : currentClearedAt > 0
          ? { activeSessionClearedAt: currentClearedAt }
          : {}),
    };
    const res = await persistWorkoutPatchToCloud(profileId, patch, 'full_sync');
    return {
      success: res.success,
      message: res.success ? 'Sincronizado con la nube.' : (res.message || 'Error al reintentar sincronización.'),
    };
  }, [persistWorkoutPatchToCloud]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOffline = () => {
      setIsOnline(false);
      const hasPending = getOfflineSyncQueue().some((q) => q.profileId === activeProfileIdRef.current);
      if (hasPending || activeSessionRef.current) {
        setWorkoutSyncStatus('pending_sync');
      }
    };
    const handleOnline = () => {
      setIsOnline(true);
      const profileId = activeProfileIdRef.current;
      // If athlete opened app offline or pending background validation, force server re-verification BEFORE flushing pending ops
      if (
        (isOfflineSessionRef.current || !sessionServerValidatedRef.current) &&
        authUserRef.current &&
        sessionValidationInFlightUidRef.current !== authUserRef.current.uid
      ) {
        sessionServerValidatedRef.current = false;
        sessionInitializedUidRef.current = null;
        setIsOfflineSession(false);
        setBootstrapRetryNonce((n) => n + 1);
        return;
      }
      const hasPending = getOfflineSyncQueue().some((q) => q.profileId === profileId);
      if (hasPending && authUserRef.current && isLoggedInRef.current && profileId !== 'perfil_default') {
        void processPendingOfflineSyncs({ forceNow: true, profileId });
      }
    };
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
    const unsubLifecycle = subscribeAppLifecycleResume(() => {
      const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;
      setIsOnline(onlineNow);
      const profileId = activeProfileIdRef.current;
      if (
        onlineNow &&
        (isOfflineSessionRef.current || !sessionServerValidatedRef.current) &&
        authUserRef.current &&
        sessionValidationInFlightUidRef.current !== authUserRef.current.uid
      ) {
        sessionServerValidatedRef.current = false;
        sessionInitializedUidRef.current = null;
        setIsOfflineSession(false);
        setBootstrapRetryNonce((n) => n + 1);
        return;
      }
      if (onlineNow && authUserRef.current && isLoggedInRef.current && profileId !== 'perfil_default') {
        const hasPending = getOfflineSyncQueue().some((q) => q.profileId === profileId);
        if (hasPending) {
          void processPendingOfflineSyncs({ profileId });
        }
      }
    });
    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
      unsubLifecycle();
    };
  }, []);

  const addBodyWeightLog = useCallback(
    (weightKg: number, bodyFatPct?: number, note?: string) => {
      const targetProfileId = activeProfileIdRef.current;
      const newEntry: BodyWeightEntry = {
        id: `bw-${Date.now()}`,
        date: new Date().toISOString(),
        weightKg,
        bodyFatPct,
        note,
      };
      const next = [newEntry, ...bodyWeightLogsRef.current];
      bodyWeightLogsRef.current = next;
      try {
        localStorage.setItem(`lazcakon_${targetProfileId}_bodyweight`, JSON.stringify(next));
      } catch {}
      setBodyWeightLogs(next);
      void persistWorkoutPatchToCloud(targetProfileId, { bodyWeightLogs: next }, 'bodyweight_update');
    },
    [persistWorkoutPatchToCloud]
  );

  // Clean all data of an athlete (history, PRs, weight logs, active session) with pre-clean safety backup
  const cleanAthleteData = useCallback(
    (targetProfileId: string) => {
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

        if (targetProfileId === activeProfileIdRef.current) {
          setHistory([]);
          setPrs({});
          setBodyWeightLogs([]);
          activeSessionRef.current = null;
          setActiveSession(null);
          setSelectedAlternatives({});
        }

        void persistWorkoutPatchToCloud(
          targetProfileId,
          {
            history: [],
            prs: {},
            bodyWeightLogs: [],
            activeSession: null,
            lastCleanedAt: new Date().toISOString(),
          },
          'import_restore'
        );
      } catch (e) {
        console.warn('Error cleaning athlete data:', e);
      }
    },
    [persistWorkoutPatchToCloud]
  );

  const deleteBodyWeightLog = useCallback(
    (id: string) => {
      const targetProfileId = activeProfileIdRef.current;
      const next = bodyWeightLogsRef.current.filter((item) => item.id !== id);
      bodyWeightLogsRef.current = next;
      try {
        localStorage.setItem(`lazcakon_${targetProfileId}_bodyweight`, JSON.stringify(next));
      } catch {}
      setBodyWeightLogs(next);
      void persistWorkoutPatchToCloud(targetProfileId, { bodyWeightLogs: next }, 'bodyweight_update');
    },
    [persistWorkoutPatchToCloud]
  );

  const enrichedRoutines = useMemo(() => getEnrichedDefaultRoutines(routines), [routines]);

  return {
    isLoggedIn,
    authLoading,
    sessionChecking,
    sessionBootstrapError,
    authStatusNotice,
    clearAuthStatusNotice,
    retrySessionBootstrap,
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
    requestPasswordReset,
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
    pauseWorkoutSession,
    resumeWorkoutSession,
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
    restCompleteNotice,
    dismissRestCompleteNotice,
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
    isHistorySyncing,
    historySyncError,
    workoutSyncStatus,
    workoutSyncError,
    retryWorkoutSync,
    isOnline,
    isOfflineSession,
    pendingSyncCount,
    pendingSyncOps,
    lastSyncError,
    getLogoutSafetyStatus,
    historyInventory,
    historyConflicts,
    runManualHistoryRecovery,

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
