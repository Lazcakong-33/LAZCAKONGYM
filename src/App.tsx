import React, { useState, useEffect } from 'react';
import { useGymState } from './hooks/useGymState';
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
import { SplashScreen } from './components/SplashScreen';
import { UpdateBanner } from './components/UpdateBanner';
import { LandingView } from './views/LandingView';

import { TodayView } from './views/TodayView';
import { RoutinesView } from './views/RoutinesView';
import { ActiveWorkoutView } from './views/ActiveWorkoutView';
import { ProgresoView } from './views/ProgresoView';
import { BiometricsView } from './views/BiometricsView';
import { SettingsCloudView } from './views/SettingsCloudView';
import { AdminView } from './views/AdminView';
import { LoginProfileSelectorView } from './views/LoginProfileSelectorView';
import { ExerciseLibraryView } from './views/ExerciseLibraryView';
import { MapaMuscularView } from './views/MapaMuscularView';

import { Exercise, Routine, CompletedWorkout, PersonalRecord } from './types';

export default function App() {
  const gym = useGymState();

  const [currentTab, setCurrentTab] = useState<TabType>('hoy');
  const [selectedDayId, setSelectedDayId] = useState<string>('lunes-leg-day');
  const [focusedMuscleCategory, setFocusedMuscleCategory] = useState<string | null>(null);

  const handleNavigateToMuscleMap = (muscleName?: string) => {
    setFocusedMuscleCategory(muscleName || null);
    setCurrentTab('mapa-muscular');
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
  const [showLanding, setShowLanding] = useState(true);

  // Fallback tab if non-admin tries to open admin tab
  useEffect(() => {
    if (!gym.isAdmin && currentTab === 'admin') {
      setCurrentTab('hoy');
    }
  }, [gym.isAdmin, currentTab]);

  if (gym.authLoading) {
    return (
      <div className="min-h-dvh bg-[#090909] text-[#F5F5F5] flex flex-col items-center justify-center p-6">
        <SplashScreen minDurationMs={600} />
      </div>
    );
  }

  // Muro de Pago y Bloqueo de Seguridad: Bloqueo total si el usuario no ha iniciado sesión en Firebase Auth
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
          onRegisterWithInvite={gym.registerWithInvite}
          onSelectProfile={gym.login}
          isAdmin={gym.isAdmin}
        />
      </>
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
      initialAccent={gym.activeProfile?.themeAccent}
      onSyncProfileAccent={(accent) => gym.updateProfile({ themeAccent: accent })}
    >
      <div className="min-h-dvh bg-[#090909] text-[#F5F5F5] flex flex-col selection:bg-[#CCFF00] selection:text-[#090909] font-['Plus_Jakarta_Sans',sans-serif]">
        <SplashScreen minDurationMs={2000} />
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
            />
          )}

        {currentTab === 'rutinas' && (
          <RoutinesView
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
            onOpenExerciseModal={setSelectedExerciseModal}
            onOpenPlateCalculator={handleOpenPlateCalculator}
            onNavigateRoutines={() => setCurrentTab('rutinas')}
          />
        )}

        {currentTab === 'mapa-muscular' && (
          <MapaMuscularView
            history={gym.history}
            routines={gym.routines}
            activeProfile={gym.activeProfile}
            onNavigateTab={setCurrentTab}
            onStartWorkout={handleStartWorkout}
            initialSelectedMuscle={focusedMuscleCategory}
            onConsumeInitialMuscle={() => setFocusedMuscleCategory(null)}
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
            onLinkGoogleAccount={gym.linkGoogleAccount}
            onImportCsv={gym.importGymCsvData}
            onNavigateToTab={(tab) => setCurrentTab(tab as any)}
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
      </main>

      {/* Floating Rest Countdown Timer Widget (shown when browsing other tabs during rest) */}
      {(currentTab !== 'activo' || !gym.activeSession) && (
        <RestTimerWidget
          timer={gym.restTimer}
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
      />

      {/* Barbell & Machine Plate Calculator Modal */}
      <PlateCalculatorModal
        isOpen={isPlateCalculatorOpen}
        onClose={() => setIsPlateCalculatorOpen(false)}
        initialWeight={plateCalcInitialWeight}
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
