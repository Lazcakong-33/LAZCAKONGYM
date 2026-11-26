import React, { useState, useEffect } from 'react';
import { useGymState, resolveNextRestTargetContext } from './hooks/useGymState';
import { ThemeProvider } from './context/ThemeContext';
import { Navigation, TabType } from './components/Navigation';
import { RestTimerWidget } from './components/RestTimerWidget';
import { PlateCalculatorModal } from './components/PlateCalculatorModal';
import { ExerciseDetailModal } from './components/ExerciseDetailModal';
import { ProfileModal } from './components/ProfileModal';
import { CreateEditRoutineModal } from './components/CreateEditRoutineModal';
import { CelebrationModal } from './components/CelebrationModal';
import { InstallApkModal } from './components/InstallApkModal';
import { AIRoutineGeneratorModal } from './components/AIRoutineGeneratorModal';
import { UpdateBanner } from './components/UpdateBanner';
import { LandingView } from './views/LandingView';

import { TodayView } from './views/TodayView';
import { RoutinesView } from './views/RoutinesView';
import { ActiveWorkoutView } from './views/ActiveWorkoutView';
import { LoginProfileSelectorView } from './views/LoginProfileSelectorView';
import { RecoveryNotificationsModal } from './components/RecoveryNotificationsModal';
import { useMuscleRecoveryNotifications } from './hooks/useMuscleRecoveryNotifications';
import {
  MuscleRecoveryNotification,
  RecoveredMuscleRef,
} from './utils/muscleRecoveryNotifications';

import { Exercise, Routine, CompletedWorkout, PersonalRecord } from './types';
import { OPEN_ACTIVE_WORKOUT_EVENT } from './utils/nativeNotifications';
import { markOtaBootReady } from './utils/otaUpdateEngine';

const AdminView = React.lazy(() =>
  import('./views/AdminView').then(module => ({ default: module.AdminView }))
);
const SettingsCloudView = React.lazy(() =>
  import('./views/SettingsCloudView').then(module => ({ default: module.SettingsCloudView }))
);
const ProgresoView = React.lazy(() =>
  import('./views/ProgresoView').then(module => ({ default: module.ProgresoView }))
);
const ExerciseLibraryView = React.lazy(() =>
  import('./views/ExerciseLibraryView').then(module => ({ default: module.ExerciseLibraryView }))
);
const BiometricsView = React.lazy(() =>
  import('./views/BiometricsView').then(module => ({ default: module.BiometricsView }))
);
const MapaMuscularView = React.lazy(() =>
  import('./views/MapaMuscularView').then(module => ({ default: module.MapaMuscularView }))
);

export default function App() {
  useEffect(() => {
    void markOtaBootReady().then((res) => {
      if (res?.justInstalled && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ota-just-installed', { detail: res.justInstalled }));
      }
    });
  }, []);

  const gym = useGymState();

  const [currentTab, setCurrentTab] = useState<TabType>('hoy');
  const [selectedDayId, setSelectedDayId] = useState<string>('lunes-leg-day');
  const [focusedMuscleCategory, setFocusedMuscleCategory] = useState<string | null>(null);
  const [focusedRecoveredMuscles, setFocusedRecoveredMuscles] = useState<
    RecoveredMuscleRef[] | null
  >(null);
  const [isRecoveryNotificationsOpen, setIsRecoveryNotificationsOpen] = useState(false);
  const [muscleSummarySignal, setMuscleSummarySignal] = useState(0);

  const recoveryNotifications = useMuscleRecoveryNotifications({
    profileId: gym.activeProfile?.id,
    isLoggedIn: gym.isLoggedIn,
    sessionChecking: gym.sessionChecking,
    isHistorySyncing: gym.isHistorySyncing,
    history: gym.history,
    routines: gym.routines,
  });

  const handleNavigateToMuscleMap = (muscleName?: string) => {
    setFocusedRecoveredMuscles(null);
    setFocusedMuscleCategory(muscleName || null);
    setCurrentTab('mapa-muscular');
  };

  const handleSelectRecoveryNotification = (notification: MuscleRecoveryNotification) => {
    recoveryNotifications.markAsRead(notification.id);
    setIsRecoveryNotificationsOpen(false);
    setFocusedMuscleCategory(null);
    setFocusedRecoveredMuscles(notification.muscles);
    setCurrentTab('mapa-muscular');
  };

  const handleOpenMuscleSummaryFromBell = () => {
    setIsRecoveryNotificationsOpen(false);
    setCurrentTab('mapa-muscular');
    setMuscleSummarySignal((prev) => prev + 1);
  };


  // Modals
  const [selectedExerciseModal, setSelectedExerciseModal] = useState<Exercise | null>(null);
  const [isPlateCalculatorOpen, setIsPlateCalculatorOpen] = useState(false);
  const [plateCalcInitialWeight, setPlateCalcInitialWeight] = useState(100);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isCreateEditRoutineOpen, setIsCreateEditRoutineOpen] = useState(false);
  const [routineToEdit, setRoutineToEdit] = useState<Routine | null>(null);

  // Workout finished celebration modal
  const [finishedWorkout, setFinishedWorkout] = useState<CompletedWorkout | null>(null);
  const [finishedPRs, setFinishedPRs] = useState<PersonalRecord[]>([]);
  const [isCelebrationOpen, setIsCelebrationOpen] = useState(false);

  // APK and PWA install modal
  const [isInstallApkOpen, setIsInstallApkOpen] = useState(false);

  // AI Routine Generator modal
  const [isAIRoutineModalOpen, setIsAIRoutineModalOpen] = useState(false);

  // Fallback tab if non-admin tries to open admin tab
  useEffect(() => {
    if (!gym.isAdmin && currentTab === 'admin') {
      setCurrentTab('hoy');
    }
  }, [gym.isAdmin, currentTab]);

  // Open active workout session directly when athlete taps an ongoing or completed rest notification
  useEffect(() => {
    const openActiveWorkoutTab = () => {
      setCurrentTab('activo');
    };

    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('openActiveWorkout') === '1') {
        openActiveWorkoutTab();
        url.searchParams.delete('openActiveWorkout');
        const cleaned = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
        window.history.replaceState({}, '', cleaned);
      }
    } catch {}

    window.addEventListener(OPEN_ACTIVE_WORKOUT_EVENT, openActiveWorkoutTab);

    const onSwMessage = (event: MessageEvent) => {
      if (event?.data?.type === 'OPEN_ACTIVE_WORKOUT') {
        openActiveWorkoutTab();
      }
    };
    const hasSw =
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof navigator.serviceWorker?.addEventListener === 'function';
    if (hasSw) {
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }

    return () => {
      window.removeEventListener(OPEN_ACTIVE_WORKOUT_EVENT, openActiveWorkoutTab);
      if (hasSw) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage);
      }
    };
  }, []);

  // 1. Session restoration in progress
  if (gym.sessionChecking) {
    return (
      <div className="min-h-dvh bg-[#090909] text-white flex flex-col items-center justify-center p-6 font-['Plus_Jakarta_Sans',sans-serif]">
        <div role="status" className="flex flex-col items-center gap-3 text-center">
          <img src="/assets/gorilla_full_logo.png" alt="" width="80" height="80" className="h-20 w-20 object-contain" />
          <strong className="text-xl font-black tracking-tight">LAZCAKONG GYM</strong>
          <div className="w-5 h-5 rounded-full border-2 border-[#CCFF00] border-t-transparent motion-safe:animate-spin" />
          <p className="text-xs font-mono font-bold tracking-widest uppercase text-[var(--accent-readable-text)]">
            Verificando tu sesión…
          </p>
        </div>
      </div>
    );
  }

  // 2. Real session verification failure (never grant unvalidated access and never hide real errors)
  if (!gym.isLoggedIn && gym.sessionBootstrapError) {
    return (
      <div className="min-h-dvh bg-[#090909] text-[#F5F5F5] flex flex-col items-center justify-center p-6 font-['Plus_Jakarta_Sans',sans-serif]">
        <div className="w-full max-w-md rounded-3xl bg-[#111318] border border-rose-500/35 p-6 space-y-5 shadow-2xl text-center">
          <img
            src="/assets/gorilla_full_logo.png"
            alt="LAZCAKONG GYM"
            referrerPolicy="no-referrer"
            className="w-20 h-20 mx-auto object-contain"
          />
          <div className="space-y-2">
            <h2 className="text-lg font-black uppercase tracking-tight text-white">
              No se pudo verificar tu sesión
            </h2>
            <p className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-2xl p-3 font-semibold leading-relaxed">
              {gym.sessionBootstrapError}
            </p>
          </div>
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={gym.retrySessionBootstrap}
              className="w-full py-3.5 rounded-2xl bg-[var(--accent-primary)] hover:bg-[var(--accent-hover)] text-[var(--accent-contrast-text)] font-black text-xs uppercase tracking-wider transition-all cursor-pointer"
            >
              Reintentar verificación
            </button>
            <button
              type="button"
              onClick={gym.logout}
              className="w-full py-3 rounded-2xl bg-[#171717] hover:bg-[#232323] border border-[#303030] text-slate-300 font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
            >
              Cerrar sesión e ir al acceso
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 3. No active session -> show access screen once
  if (!gym.isLoggedIn) {
    return (
      <>
        <UpdateBanner />
        <LandingView
          profiles={gym.profiles}
          onCreateProfile={gym.createProfile}
          onLoginWithEmailPin={gym.loginWithEmailPin}
          onLoginWithGoogle={gym.loginWithGoogle}
          onVerifyAndLinkLegacyProfile={gym.verifyAndLinkLegacyProfile}
          onCancelLegacyVerification={gym.cancelLegacyVerification}
          onRequestPasswordReset={gym.requestPasswordReset}
          onRegisterWithInvite={gym.registerWithInvite}
          onSelectProfile={gym.login}
          isAdmin={gym.isAdmin}
          authNotice={gym.authStatusNotice}
          onDismissAuthNotice={gym.clearAuthStatusNotice}
        />
      </>
    );
  }

  if (!gym.activeProfile) {
    return (
      <div className="min-h-dvh bg-[#090909] text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
        <p className="text-sm font-bold text-slate-300">Cargando perfil del atleta…</p>
        <button
          type="button"
          onClick={gym.retrySessionBootstrap}
          className="px-4 py-2.5 rounded-xl bg-amber-500 text-black text-xs font-black cursor-pointer"
        >
          Reintentar carga
        </button>
      </div>
    );
  }

  const handleStartWorkout = (routine: Routine) => {
    gym.startWorkout(routine);
    setCurrentTab('activo');
  };

  const handleSelectRoutineDay = (routine: Routine) => {
    setSelectedDayId(routine.id);
    setCurrentTab('rutinas');
  };

  const handleOpenPlateCalculator = (weight?: number) => {
    if (weight && weight > 0) {
      setPlateCalcInitialWeight(weight);
    }
    setIsPlateCalculatorOpen(true);
  };

  const handleOpenCreateRoutine = () => {
    setRoutineToEdit(null);
    setIsCreateEditRoutineOpen(true);
  };

  const handleOpenEditRoutine = (routine: Routine) => {
    setRoutineToEdit(routine);
    setIsCreateEditRoutineOpen(true);
  };

  const handleAddExerciseToRoutine = (routineId: string, exercise: Exercise) => {
    const routine = gym.routines.find((r) => r.id === routineId);
    if (!routine) return;
    gym.updateRoutine({
      ...routine,
      exercises: [...routine.exercises, exercise],
    });
  };

  const handleCreateRoutineWithExercise = (routineTitle: string, dayName: string, exercise: Exercise) => {
    const newRoutine: Routine = {
      id: `rutina-${Date.now()}`,
      title: routineTitle,
      dayName: dayName || 'Lunes',
      tagline: `Entrenamiento enfocado en ${exercise.targetMuscles}`,
      exercises: [exercise],
      isCustom: true,
      accentColor: 'amber',
    };
    gym.createRoutine(newRoutine);
  };

  const handleFinishWorkout = () => {
    const res = gym.finishWorkout();
    if (res) {
      setFinishedWorkout(res.workout);
      setFinishedPRs(res.newPRs);
      setIsCelebrationOpen(true);
      setCurrentTab('records');
    }
  };

  return (
    <ThemeProvider
      profileId={gym.activeProfile?.id}
      initialAccent={gym.activeProfile?.themeAccent}
      onSyncProfileAccent={(accent) => gym.updateProfile({ themeAccent: accent })}
    >
      <div className="min-h-dvh bg-[#090909] text-[#F5F5F5] flex flex-col selection:bg-[var(--accent-primary)] selection:text-[var(--accent-contrast-text)] font-['Plus_Jakarta_Sans',sans-serif]">
        <UpdateBanner />
        {/* Main View Area - Single Fixed Bottom Navigation Bar */}
        <main
          className={`flex-1 w-full mx-auto overflow-x-hidden ${
            currentTab === 'mapa-muscular'
              ? 'max-w-none p-0 pb-[calc(6.75rem+env(safe-area-inset-bottom,0px))]'
              : `px-3.5 sm:px-5 pt-3 sm:pt-4 pb-[calc(8.75rem+env(safe-area-inset-bottom,0px))] ${
                  currentTab === 'admin' || currentTab === 'records'
                    ? 'max-w-7xl'
                    : currentTab === 'ejercicios'
                    ? 'max-w-5xl'
                    : 'max-w-4xl'
                }`
          }`}
        >
          <React.Suspense fallback={<p role="status" className="py-8 text-center text-sm text-[#F5F5F5]">Cargando pantalla…</p>}>
          {currentTab === 'hoy' && (
            <TodayView
              routines={gym.routines}
              history={gym.history}
              prs={gym.prs}
              activeSession={gym.activeSession}
              activeProfile={gym.activeProfile}
              onStartWorkout={handleStartWorkout}
              onNavigateActive={() => setCurrentTab('activo')}
              onSelectDay={handleSelectRoutineDay}
              onOpenCreateRoutine={handleOpenCreateRoutine}
              onOpenPlateCalculator={handleOpenPlateCalculator}
              onNavigateTab={setCurrentTab}
              onOpenInstallApk={() => setIsInstallApkOpen(true)}
              onOpenAIRoutineModal={() => setIsAIRoutineModalOpen(true)}
              onOpenProfileSwitcher={() => setIsProfileModalOpen(true)}
              onLogout={gym.logout}
              isHistorySyncing={gym.isHistorySyncing}
              historySyncError={gym.historySyncError}
              onReplaceActiveExercise={gym.replaceActiveExerciseWithAI}
              onUpdateRoutine={gym.updateRoutine}
              onUpdateSet={gym.updateSet}
              unreadRecoveryCount={recoveryNotifications.unreadCount}
              onOpenRecoveryNotifications={() => setIsRecoveryNotificationsOpen(true)}
              isAdmin={gym.isAdmin}
              adminRequiresGoogleSignIn={gym.adminRequiresGoogleSignIn}
            />
          )}

        {currentTab === 'rutinas' && (
          <RoutinesView
            key={gym.activeProfile?.id || 'no-profile'}
            routines={gym.routines}
            history={gym.history}
            selectedDayId={selectedDayId}
            onSelectRoutineId={setSelectedDayId}
            onStartWorkout={handleStartWorkout}
            onOpenExerciseModal={setSelectedExerciseModal}
            onOpenPlateCalculator={handleOpenPlateCalculator}
            selectedAlternatives={gym.selectedAlternatives}
            onToggleAlternative={gym.toggleExerciseAlternative}
            onOpenCreateRoutine={handleOpenCreateRoutine}
            onOpenEditRoutine={handleOpenEditRoutine}
            onDeleteRoutine={gym.deleteRoutine}
            onClearAllRoutines={gym.clearAllRoutines}
            onOpenAIRoutineModal={() => setIsAIRoutineModalOpen(true)}
            onResetRoutines={gym.resetRoutinesToDefault}
            onAddRoutine={gym.createRoutine}
            onImportCsv={gym.importGymCsvData}
            activeProfileName={gym.activeProfile?.name}
            preImportBackup={gym.preImportBackup}
            onRestorePreImportBackup={gym.restorePreImportBackup}
          />
        )}

        {currentTab === 'ejercicios' && (
          <ExerciseLibraryView
            routines={gym.routines}
            onAddExerciseToRoutine={handleAddExerciseToRoutine}
            onCreateRoutineWithExercise={handleCreateRoutineWithExercise}
            onOpenAIRoutineModal={() => setIsAIRoutineModalOpen(true)}
            onOpenExerciseModal={setSelectedExerciseModal}
          />
        )}

        {currentTab === 'activo' && (
          <ActiveWorkoutView
            activeSession={gym.activeSession}
            routines={gym.routines}
            prs={gym.prs}
            history={gym.history}
            activeProfile={gym.activeProfile}
            restTimer={gym.restTimer}
            restCompleteNotice={gym.restCompleteNotice}
            onDismissRestCompleteNotice={gym.dismissRestCompleteNotice}
            isHistorySyncing={gym.isHistorySyncing}
            historySyncError={gym.historySyncError}
            workoutSyncStatus={gym.workoutSyncStatus}
            workoutSyncError={gym.workoutSyncError}
            onRetryWorkoutSync={gym.retryWorkoutSync}
            isOnline={gym.isOnline}
            isOfflineSession={gym.isOfflineSession}
            pendingSyncCount={gym.pendingSyncCount}
            onStartWorkout={handleStartWorkout}
            onStartFreeWorkout={gym.startFreeWorkout}
            onAddExerciseToSession={gym.addExerciseToActiveSession}
            onRemoveExerciseFromSession={gym.removeExerciseFromActiveSession}
            onAddWarmupSets={gym.addWarmupSetsToExercise}
            onStartRestTimer={gym.startRestTimer}
            onStopRestTimer={gym.stopRestTimer}
            onPauseRestTimer={gym.pauseRestTimer}
            onResumeRestTimer={gym.resumeRestTimer}
            onRestartRestTimer={gym.restartRestTimer}
            onAdjustRestTimer={gym.adjustRestTimer}
            onUpdateExerciseRest={gym.updateExerciseRestSeconds}
            onUpdateSet={gym.updateSet}
            onAddSet={gym.addSetToExercise}
            onRemoveSet={gym.removeSetFromExercise}
            onToggleAlternative={gym.toggleExerciseAlternative}
            onReplaceActiveExercise={gym.replaceActiveExerciseWithAI}
            onUpdateNotes={gym.updateExerciseNotes}
            onFinishWorkout={handleFinishWorkout}
            onCancelWorkout={gym.cancelWorkout}
            onPauseWorkoutSession={gym.pauseWorkoutSession}
            onResumeWorkoutSession={gym.resumeWorkoutSession}
            onOpenExerciseModal={setSelectedExerciseModal}
            onOpenPlateCalculator={handleOpenPlateCalculator}
            onNavigateRoutines={() => setCurrentTab('rutinas')}
            onUpdateRoutine={gym.updateRoutine}
            onUpdateProfile={gym.updateProfile}
          />
        )}

        {currentTab === 'mapa-muscular' && (
          <MapaMuscularView
            history={gym.history}
            routines={gym.routines}
            activeProfile={gym.activeProfile}
            onNavigateTab={setCurrentTab}
            onStartWorkout={handleStartWorkout}
            onOpenExerciseModal={setSelectedExerciseModal}
            restTimer={gym.restTimer}
            restCompleteNotice={gym.restCompleteNotice}
            initialSelectedMuscle={focusedMuscleCategory}
            onConsumeInitialMuscle={() => setFocusedMuscleCategory(null)}
            unreadRecoveryCount={recoveryNotifications.unreadCount}
            onOpenRecoveryNotifications={() => setIsRecoveryNotificationsOpen(true)}
            focusedRecoveredMuscles={focusedRecoveredMuscles}
            onConsumeFocusedRecoveredMuscles={() => setFocusedRecoveredMuscles(null)}
            openMuscleSummarySignal={muscleSummarySignal}
          />
        )}

        {currentTab === 'records' && (
          <ProgresoView
            prs={gym.prs}
            history={gym.history}
            activeProfile={gym.activeProfile}
            routines={gym.routines}
            bodyWeightLogs={gym.bodyWeightLogs}
            activeSession={gym.activeSession}
            onUpdateRoutine={gym.createRoutine}
            onPurgeHistory={gym.purgeCorruptedHistory}
            onNavigateTab={setCurrentTab}
            onNavigateToMuscleMap={handleNavigateToMuscleMap}
            historyInventory={gym.historyInventory}
            historyConflicts={gym.historyConflicts}
            isHistorySyncing={gym.isHistorySyncing}
            historySyncError={gym.historySyncError}
            onRunHistoryRecovery={gym.runManualHistoryRecovery}
          />
        )}

        {currentTab === 'biometrics' && (
          <BiometricsView
            prs={gym.prs}
            history={gym.history}
            activeProfile={gym.activeProfile}
            routines={gym.routines}
            activeSession={gym.activeSession}
          />
        )}

        {currentTab === 'cloud' && (
          <SettingsCloudView
            activeProfile={gym.activeProfile}
            onUpdateProfile={gym.updateProfile}
            onOpenProfileSwitcher={() => setIsProfileModalOpen(true)}
            onLogout={gym.logout}
            onOpenPlateCalculator={handleOpenPlateCalculator}
            onExportBackup={gym.exportBackupJSON}
            onInspectBackup={gym.inspectBackupJSON}
            onImportBackup={gym.importBackupJSON}
            onResetRoutines={gym.resetRoutinesToDefault}
            onSyncCloud={gym.syncToCloud}
            onCleanMyData={() => gym.cleanAthleteData(gym.activeProfile.id)}
            onStartRestTimer={gym.startRestTimer}
            activeRestContext={resolveNextRestTargetContext(gym.activeSession)}
            onLinkGoogleAccount={gym.linkGoogleAccount}
            onImportCsv={gym.importGymCsvData}
            onNavigateToTab={(tab) => setCurrentTab(tab as any)}
            isAdmin={gym.isAdmin}
            adminRequiresGoogleSignIn={gym.adminRequiresGoogleSignIn}
            preImportBackup={gym.preImportBackup}
            onRestorePreImportBackup={gym.restorePreImportBackup}
            backupCounts={{
              routines: gym.routines.length,
              history: gym.history.length,
              prs: Object.keys(gym.prs || {}).length,
              bodyWeightLogs: gym.bodyWeightLogs.length,
            }}
            routines={gym.routines}
            selectedAlternatives={gym.selectedAlternatives}
            isOnline={gym.isOnline}
            isOfflineSession={gym.isOfflineSession}
            pendingSyncCount={gym.pendingSyncCount}
            pendingSyncOps={gym.pendingSyncOps}
            lastSyncError={gym.lastSyncError}
            workoutSyncStatus={gym.workoutSyncStatus}
            onRetryWorkoutSync={gym.retryWorkoutSync}
            logoutSafetyStatus={gym.getLogoutSafetyStatus()}
          />
        )}

        {currentTab === 'admin' && gym.isAdmin && (
          <AdminView
            activeProfile={gym.activeProfile}
            profiles={gym.profiles}
            routines={gym.routines}
            history={gym.history}
            bodyWeightLogs={gym.bodyWeightLogs}
            onCreateRoutine={handleOpenCreateRoutine}
            onEditRoutine={handleOpenEditRoutine}
            onOpenInstallApk={() => setIsInstallApkOpen(true)}
            onCleanAthleteData={gym.cleanAthleteData}
            onDeleteAthlete={gym.deleteProfile}
            onRefreshAthletes={gym.refreshAthletesFromCloud}
            onExportBackup={gym.exportBackupJSON}
            onInspectBackup={gym.inspectBackupJSON}
            onImportBackup={gym.importBackupJSON}
            preImportBackup={gym.preImportBackup}
            onRestorePreImportBackup={gym.restorePreImportBackup}
            backupCounts={{
              routines: gym.routines.length,
              history: gym.history.length,
              prs: Object.keys(gym.prs || {}).length,
              bodyWeightLogs: gym.bodyWeightLogs.length,
            }}
          />
        )}
      </React.Suspense>
        </main>

      {/* Floating Rest Countdown Timer Widget / Rest Complete Notice */}
      {(currentTab !== 'activo' ||
        !gym.activeSession ||
        (!gym.restTimer.active && !!gym.restCompleteNotice)) && (
        <RestTimerWidget
          timer={gym.restTimer}
          restCompleteNotice={gym.restCompleteNotice}
          onDismissRestCompleteNotice={gym.dismissRestCompleteNotice}
          onContinueWorkout={() => {
            gym.dismissRestCompleteNotice();
            if (gym.activeSession) {
              setCurrentTab('activo');
            }
          }}
          soundEnabled={gym.activeProfile?.soundEnabled !== false}
          vibrationEnabled={gym.activeProfile?.vibrationEnabled !== false}
          onUpdateAlertMode={(updates) => gym.updateProfile(updates)}
          onStop={gym.stopRestTimer}
          onPause={gym.pauseRestTimer}
          onResume={gym.resumeRestTimer}
          onRestart={gym.restartRestTimer}
          onAdjust={gym.adjustRestTimer}
          onToggleMinimize={gym.toggleRestTimerMinimized}
        />
      )}

      {/* Exercise Biomechanics & Technique Modal */}
      <ExerciseDetailModal
        exercise={selectedExerciseModal}
        isOpen={!!selectedExerciseModal}
        onClose={() => setSelectedExerciseModal(null)}
        customLinks={selectedExerciseModal ? gym.customLinks[selectedExerciseModal.id] || [] : []}
        onAddCustomLink={gym.addCustomLink}
        onDeleteCustomLink={gym.deleteCustomLink}
        isAlternativeSelected={
          selectedExerciseModal ? !!gym.selectedAlternatives[selectedExerciseModal.id] : false
        }
        onToggleAlternative={gym.toggleExerciseAlternative}
        activeSession={gym.activeSession}
        routines={gym.routines}
        history={gym.history}
        activeProfileId={gym.activeProfileId}
        onReplaceActiveExercise={gym.replaceActiveExerciseWithAI}
        onUpdateRoutine={gym.updateRoutine}
      />

      {/* Barbell & Machine Plate Calculator Modal */}
      <PlateCalculatorModal
        isOpen={isPlateCalculatorOpen}
        onClose={() => setIsPlateCalculatorOpen(false)}
        initialWeight={plateCalcInitialWeight}
      />

      {/* Muscle Recovery Notifications Modal */}
      <RecoveryNotificationsModal
        isOpen={isRecoveryNotificationsOpen}
        onClose={() => setIsRecoveryNotificationsOpen(false)}
        notifications={recoveryNotifications.notifications}
        unreadCount={recoveryNotifications.unreadCount}
        activeProfileName={gym.activeProfile?.name}
        onSelectNotification={handleSelectRecoveryNotification}
        onMarkAllAsRead={recoveryNotifications.markAllAsRead}
        onOpenMuscleSummary={handleOpenMuscleSummaryFromBell}
        onOpenMuscleMap={
          currentTab !== 'mapa-muscular'
            ? () => {
                setCurrentTab('mapa-muscular');
              }
            : undefined
        }
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        profiles={gym.profiles}
        activeProfileId={gym.activeProfileId}
        isAdmin={gym.isAdmin}
        adminRequiresGoogleSignIn={gym.adminRequiresGoogleSignIn}
        onSwitchProfile={gym.switchProfile}
        onCreateProfile={gym.createProfile}
        onDeleteProfile={gym.deleteProfile}
        onLogout={gym.logout}
        onOpenInstallApk={() => setIsInstallApkOpen(true)}
        onNavigateTab={(tab) => setCurrentTab(tab as any)}
      />

      {/* Create / Edit Routine Modal */}
      <CreateEditRoutineModal
        isOpen={isCreateEditRoutineOpen}
        onClose={() => {
          setIsCreateEditRoutineOpen(false);
          setRoutineToEdit(null);
        }}
        onSaveRoutine={(routine) => {
          if (routineToEdit) {
            gym.updateRoutine(routine);
          } else {
            gym.createRoutine(routine);
          }
        }}
        onDeleteRoutine={gym.deleteRoutine}
        routineToEdit={routineToEdit}
      />

      {/* Celebration Modal when finishing workout */}
      <CelebrationModal
        isOpen={isCelebrationOpen}
        onClose={() => setIsCelebrationOpen(false)}
        workout={finishedWorkout}
        newPRs={finishedPRs}
        history={gym.history}
        routines={gym.routines}
        onOpenMuscleMap={() => setCurrentTab('mapa-muscular')}
      />

      {/* Single-Use Invite & APK Modal (Strictly Admin Only) */}
      {gym.isAdmin && (
        <InstallApkModal
          isOpen={isInstallApkOpen}
          onClose={() => setIsInstallApkOpen(false)}
          isAdmin={gym.isAdmin}
          adminName={gym.activeProfile.name}
        />
      )}

      {/* AI Routine Generator Modal */}
      <AIRoutineGeneratorModal
        isOpen={isAIRoutineModalOpen}
        onClose={() => setIsAIRoutineModalOpen(false)}
        activeProfile={gym.activeProfile}
        onStartWorkout={handleStartWorkout}
        onSaveRoutine={(routine) => gym.createRoutine(routine)}
      />

      {/* Single Primary Fixed Bottom Navigation Bar */}
      <Navigation
        currentTab={currentTab}
        onTabChange={setCurrentTab}
        hasActiveWorkout={!!gym.activeSession}
        isAdmin={gym.isAdmin}
      />
      </div>
    </ThemeProvider>
  );
}
