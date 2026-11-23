import { useCallback, useEffect, useRef, useState } from 'react';
import { CompletedWorkout, Routine } from '../types';
import {
  MuscleRecoveryNotification,
  evaluateMuscleRecoveryNotifications,
  getUnreadRecoveryNotificationCount,
  loadAthleteRecoveryNotificationStore,
  markAllRecoveryNotificationsAsRead,
  markRecoveryNotificationAsRead,
} from '../utils/muscleRecoveryNotifications';

export const RECOVERY_CHECKIN_UPDATED_EVENT = 'lazcakong:recovery-checkin-updated';

interface UseMuscleRecoveryNotificationsParams {
  profileId?: string | null;
  isLoggedIn: boolean;
  sessionChecking: boolean;
  isHistorySyncing?: boolean;
  history: CompletedWorkout[];
  routines: Routine[];
  pollIntervalMs?: number;
}

export function useMuscleRecoveryNotifications({
  profileId,
  isLoggedIn,
  sessionChecking,
  isHistorySyncing = false,
  history,
  routines,
  pollIntervalMs = 60_000,
}: UseMuscleRecoveryNotificationsParams) {
  const safeProfileId = isLoggedIn && !sessionChecking && profileId ? profileId : null;

  const [notifications, setNotifications] = useState<MuscleRecoveryNotification[]>(() => {
    if (!safeProfileId) return [];
    return loadAthleteRecoveryNotificationStore(safeProfileId).notifications;
  });

  const latestRef = useRef({
    safeProfileId,
    isHistorySyncing,
    history,
    routines,
  });
  latestRef.current = {
    safeProfileId,
    isHistorySyncing,
    history,
    routines,
  };

  // Cargar avisos guardados inmediatamente al cambiar de atleta
  useEffect(() => {
    if (!safeProfileId) {
      setNotifications([]);
      return;
    }
    const stored = loadAthleteRecoveryNotificationStore(safeProfileId);
    setNotifications(stored.notifications);
  }, [safeProfileId]);

  const recheckNow = useCallback((customNowMs?: number) => {
    const {
      safeProfileId: activeId,
      isHistorySyncing: syncing,
      history: currentHistory,
      routines: currentRoutines,
    } = latestRef.current;

    if (!activeId) return;
    // Evitar sobrescribir estados con SIN_DATOS si el historial todavía está hidratándose desde la nube
    if (syncing && currentHistory.length === 0) return;

    const result = evaluateMuscleRecoveryNotifications({
      profileId: activeId,
      history: currentHistory,
      routines: currentRoutines,
      nowMs: typeof customNowMs === 'number' ? customNowMs : Date.now(),
    });
    setNotifications(result.store.notifications);
  }, []);

  // 1. Comprobar al abrir la app, al cambiar de atleta o al actualizarse el historial/rutinas
  useEffect(() => {
    if (!safeProfileId) return;
    if (isHistorySyncing && history.length === 0) return;
    recheckNow();
  }, [safeProfileId, isHistorySyncing, history, routines, recheckNow]);

  // 2. Comprobar al volver a la app (visibilitychange / focus / pageshow), al actualizar check-in y periódicamente abierta
  useEffect(() => {
    if (!safeProfileId) return;

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        recheckNow();
      }
    };

    const handleWindowFocus = () => {
      recheckNow();
    };

    const handlePageShow = () => {
      recheckNow();
    };

    const handleCheckInUpdated = () => {
      recheckNow();
    };

    const intervalId = window.setInterval(() => {
      recheckNow();
    }, pollIntervalMs);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener(RECOVERY_CHECKIN_UPDATED_EVENT, handleCheckInUpdated);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener(RECOVERY_CHECKIN_UPDATED_EVENT, handleCheckInUpdated);
    };
  }, [safeProfileId, pollIntervalMs, recheckNow]);

  const markAsRead = useCallback(
    (notificationId: string) => {
      if (!safeProfileId) return;
      const updated = markRecoveryNotificationAsRead(safeProfileId, notificationId);
      setNotifications(updated.notifications);
    },
    [safeProfileId]
  );

  const markAllAsRead = useCallback(() => {
    if (!safeProfileId) return;
    const updated = markAllRecoveryNotificationsAsRead(safeProfileId);
    setNotifications(updated.notifications);
  }, [safeProfileId]);

  const unreadCount = getUnreadRecoveryNotificationCount(notifications);

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    recheckNow,
  };
}
