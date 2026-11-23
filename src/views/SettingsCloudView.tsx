import React, { useState, useEffect, useRef } from 'react';
import {
  Save,
  Users,
  LogOut,
  Disc,
  Download,
  Upload,
  RotateCcw,
  Cloud,
  CheckCircle2,
  AlertCircle,
  Volume2,
  Smartphone,
  ShieldCheck,
  ChevronRight,
  RefreshCw,
  Sparkles,
  Check,
  ListPlus,
  TrendingUp,
  Award,
  ArrowRight,
  X,
  Dumbbell,
  Loader2,
  Wifi,
  WifiOff,
  HardDrive,
  Database,
} from 'lucide-react';
import {
  LogoutSafetyStatus,
  OfflineAssetCacheStatus,
  PendingOfflineSyncOp,
  Profile,
  Routine,
  RoutineImportMode,
  WorkoutSyncStatus,
} from '../types';
import {
  THEME_PALETTE_LIST,
  OfficialThemeAccent,
  normalizeThemeAccent,
} from '../utils/theme';
import { useTheme } from '../context/ThemeContext';
import { AVATAR_OPTIONS, GOAL_OPTIONS } from '../data/defaultProfiles';
import { forceAppUpdate, APP_VERSION } from '../utils/updateApp';
import { useAppUpdate } from '../hooks/useAppUpdate';
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
  testWatchAlert,
} from '../utils/backgroundTimer';
import {
  cancelServerRestAlarmPush,
  fetchDevicePushStatus,
  subscribeDeviceToWebPush,
  triggerImmediatePushTest,
  triggerScheduled60sPushTest,
  unsubscribeDeviceFromWebPush,
  type DevicePushStatusResult,
} from '../utils/webPushClient';
import { CsvImportResult } from '../utils/csvImporter';
import {
  PreImportBackupSnapshot,
  SafeImportPayload,
} from '../utils/safeImportPersistence';
import { BackupInspectionResult } from '../utils/eliteBackupEngine';
import {
  EliteBackupRestoreOptions,
  EliteBackupRestorePanel,
} from '../components/EliteBackupRestorePanel';
import {
  clearOfflineExerciseAssetCache,
  downloadRoutineAssetsForOffline,
  getOfflineExerciseCacheStatus,
  resolveRoutineOfflineAssets,
} from '../utils/offlineExerciseLibrary';
import {
  detectRuntimePlatform,
  getOfflineCapabilitiesMatrix,
  getStorageHealthReport,
  type StorageHealthReport,
} from '../utils/capacitorPlatform';
import {
  getNativeNotificationPermission,
  getNativeRestTimerCapabilities,
  openNativeRestSettingScreen,
  type NativeRestTimerCapabilities,
} from '../utils/nativeNotifications';

interface SettingsCloudViewProps {
  activeProfile: Profile;
  onUpdateProfile: (updates: Partial<Profile>) => void;
  onOpenProfileSwitcher: () => void;
  onLogout: () => void;
  onOpenPlateCalculator: (weight?: number) => void;
  onExportBackup: () => { success: boolean; fileName?: string; message?: string } | void;
  onInspectBackup: (json: string) => BackupInspectionResult;
  onImportBackup: (
    json: string,
    options?: EliteBackupRestoreOptions
  ) => { success: boolean; message: string };
  onResetRoutines: () => void;
  onSyncCloud: () => Promise<{ success: boolean; message: string }>;
  onCleanMyData?: () => void;
  onStartRestTimer?: (seconds: number, label?: string) => void;
  activeRestContext?: { exerciseName?: string; nextSetNumber?: number };
  onLinkGoogleAccount?: () => Promise<{ success: boolean; message: string }>;
  onImportCsv?: (result: CsvImportResult | SafeImportPayload) => {
    success: boolean;
    routinesCount: number;
    workoutsCount: number;
    prsCount: number;
    routineNames: string[];
  };
  onNavigateToTab?: (tab: 'hoy' | 'rutinas' | 'activo' | 'progreso' | 'cloud' | 'ejercicios' | 'admin') => void;
  isAdmin?: boolean;
  adminRequiresGoogleSignIn?: boolean;
  preImportBackup?: PreImportBackupSnapshot | null;
  onRestorePreImportBackup?: () => { success: boolean; message: string };
  backupCounts?: {
    routines: number;
    history: number;
    prs: number;
    bodyWeightLogs: number;
  };
  routines?: Routine[];
  selectedAlternatives?: Record<string, boolean>;
  isOnline?: boolean;
  isOfflineSession?: boolean;
  pendingSyncCount?: number;
  pendingSyncOps?: PendingOfflineSyncOp[];
  lastSyncError?: string | null;
  workoutSyncStatus?: WorkoutSyncStatus;
  onRetryWorkoutSync?: () => Promise<{ success: boolean; message: string }>;
  logoutSafetyStatus?: LogoutSafetyStatus;
}

export const SettingsCloudView: React.FC<SettingsCloudViewProps> = ({
  activeProfile,
  onUpdateProfile,
  onOpenProfileSwitcher,
  onLogout,
  onOpenPlateCalculator,
  onExportBackup,
  onInspectBackup,
  onImportBackup,
  onResetRoutines,
  onSyncCloud,
  onCleanMyData,
  onStartRestTimer,
  activeRestContext,
  onLinkGoogleAccount,
  onImportCsv,
  onNavigateToTab,
  isAdmin = false,
  adminRequiresGoogleSignIn = false,
  preImportBackup,
  onRestorePreImportBackup,
  backupCounts,
  routines = [],
  selectedAlternatives = {},
  isOnline = true,
  isOfflineSession = false,
  pendingSyncCount = 0,
  pendingSyncOps = [],
  lastSyncError = null,
  workoutSyncStatus = 'synced',
  onRetryWorkoutSync,
  logoutSafetyStatus,
}) => {
  const {
    themeAccent,
    savedThemeAccent,
    accentHex,
    previewThemeAccent,
    revertThemePreview,
    setThemeAccent,
  } = useTheme();
  const committedThemeAccent = normalizeThemeAccent(activeProfile.themeAccent || savedThemeAccent);
  const [draftThemeAccent, setDraftThemeAccent] = useState<OfficialThemeAccent>(committedThemeAccent);
  const revertPreviewRef = useRef(revertThemePreview);
  revertPreviewRef.current = revertThemePreview;
  const committedAccentRef = useRef<OfficialThemeAccent>(committedThemeAccent);
  committedAccentRef.current = committedThemeAccent;
  const draftAccentRef = useRef<OfficialThemeAccent>(draftThemeAccent);
  draftAccentRef.current = draftThemeAccent;
  const [name, setName] = useState(activeProfile.name || '');
  const [avatar, setAvatar] = useState(activeProfile.avatar || '🦍');
  const [goal, setGoal] = useState(activeProfile.goal || 'Hipertrofia & Masa');
  const [weightKg, setWeightKg] = useState<string | number>(activeProfile.weightKg || '');
  const [heightCm, setHeightCm] = useState<string | number>(activeProfile.heightCm || '');
  const [weeklyTargetDays, setWeeklyTargetDays] = useState(activeProfile.weeklyTargetDays || 5);
  const [soundEnabled, setSoundEnabled] = useState(activeProfile.soundEnabled !== false);
  const [vibrationEnabled, setVibrationEnabled] = useState(activeProfile.vibrationEnabled !== false);
  const [restEndAlertEnabled, setRestEndAlertEnabled] = useState(
    activeProfile.restEndAlertEnabled !== false
  );
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >(() => getNotificationPermissionStatus());
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>(activeProfile.weightUnit || 'kg');

  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [cloudMsg, setCloudMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Estado de importación segura (vista previa + confirmación previa obligatoria)
  const [importSummary, setImportSummary] = useState<{
    open: boolean;
    totalRows: number;
    routinesCreated: number;
    routineNames: string[];
    workoutsCreated: number;
    prsCreated: number;
  } | null>(null);
  const [pendingCsvImport, setPendingCsvImport] = useState<{
    fileName: string;
    parsed: CsvImportResult;
  } | null>(null);
  const [csvImportMode, setCsvImportMode] = useState<RoutineImportMode>('append_new');
  const [csvReplaceConfirmed, setCsvReplaceConfirmed] = useState(false);
  const [csvPreserveHistory, setCsvPreserveHistory] = useState(true);
  const [csvErrorMsg, setCsvErrorMsg] = useState<string | null>(null);
  const [confirmRestoreBackup, setConfirmRestoreBackup] = useState(false);
  const [restoreFeedbackMsg, setRestoreFeedbackMsg] = useState<string | null>(null);
  const [isProcessingCsv, setIsProcessingCsv] = useState(false);


  // App update lifecycle
  const { hasUpdateAvailable, isUpdating: isAppUpdating, triggerUpdate, checkUpdatesNow } = useAppUpdate();
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const [updateDeferredMsg, setUpdateDeferredMsg] = useState<string | null>(null);
  const [watchMsg, setWatchMsg] = useState<string | null>(null);

  // Web Push & persistent background scheduler state
  const [pushStatus, setPushStatus] = useState<DevicePushStatusResult | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushActionMsg, setPushActionMsg] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [scheduledTest60s, setScheduledTest60s] = useState<{
    restId: string;
    targetEndTime: number;
    remainingSec: number;
    provider?: string;
  } | null>(null);

  // Stage 6: Safe timer cleanup + offline asset library & non-blocking confirmations
  const timeoutsRef = React.useRef<number[]>([]);
  const scheduleTimeout = React.useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timeoutsRef.current.push(id);
  }, []);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach((id) => window.clearTimeout(id));
      timeoutsRef.current = [];
    };
  }, []);

  const [retryingQueue, setRetryingQueue] = useState(false);
  const [showOfflineMatrix, setShowOfflineMatrix] = useState(false);
  const [offlineCacheStatus, setOfflineCacheStatus] = useState<OfflineAssetCacheStatus | null>(null);
  const [storageHealth, setStorageHealth] = useState<StorageHealthReport | null>(null);
  const [downloadingOfflineAssets, setDownloadingOfflineAssets] = useState(false);
  const [assetDownloadProgress, setAssetDownloadProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [assetCacheMessage, setAssetCacheMessage] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [confirmCleanData, setConfirmCleanData] = useState(false);
  const [confirmManualCacheReset, setConfirmManualCacheReset] = useState(false);
  const [confirmLogoutWarning, setConfirmLogoutWarning] = useState(false);

  const platformInfo = React.useMemo(() => detectRuntimePlatform(), []);
  const capabilitiesMatrix = React.useMemo(() => getOfflineCapabilitiesMatrix(), []);
  const [nativeRestCaps, setNativeRestCaps] = useState<NativeRestTimerCapabilities | null>(null);
  const routineAssetSummary = React.useMemo(
    () => resolveRoutineOfflineAssets(routines, selectedAlternatives),
    [routines, selectedAlternatives]
  );

  const refreshOfflineLibraryStatus = React.useCallback(async () => {
    try {
      const [libStatus, healthRes, nativeCaps] = await Promise.all([
        getOfflineExerciseCacheStatus({ routines, selectedAlternatives }),
        getStorageHealthReport(),
        platformInfo.isCapacitorNative ? getNativeRestTimerCapabilities() : Promise.resolve(null),
      ]);
      setOfflineCacheStatus(libStatus);
      setStorageHealth(healthRes);
      setNativeRestCaps(nativeCaps);
    } catch {}
  }, [routines, selectedAlternatives, platformInfo.isCapacitorNative]);

  useEffect(() => {
    void refreshOfflineLibraryStatus();
  }, [refreshOfflineLibraryStatus]);

  const handleDownloadRoutineOfflineLibrary = async () => {
    setDownloadingOfflineAssets(true);
    setAssetCacheMessage(null);
    setAssetDownloadProgress(null);
    try {
      const result = await downloadRoutineAssetsForOffline({
        routines,
        selectedAlternatives,
        onProgress: (prog) => setAssetDownloadProgress({ completed: prog.completed, total: prog.total }),
      });
      if (result.quotaExceeded) {
        setAssetCacheMessage({
          type: 'error',
          text: result.message || 'Almacenamiento insuficiente en el dispositivo para más recursos visuales. Tus rutinas e historial permanecen intactos.',
        });
      } else if (result.failedCount > 0 && result.downloadedCount === 0 && result.alreadyCachedCount === 0) {
        setAssetCacheMessage({
          type: 'warning',
          text: 'No se pudieron descargar los recursos visuales en este momento. Conéctate a internet para completar la descarga.',
        });
      } else {
        setAssetCacheMessage({
          type: 'success',
          text: result.message,
        });
      }
      await refreshOfflineLibraryStatus();
    } catch {
      setAssetCacheMessage({
        type: 'error',
        text: 'No se pudo completar la descarga selectiva de ejercicios.',
      });
    } finally {
      setDownloadingOfflineAssets(false);
      setAssetDownloadProgress(null);
    }
  };

  const handleClearOfflineExerciseLibrary = async () => {
    setDownloadingOfflineAssets(true);
    setAssetCacheMessage(null);
    try {
      await clearOfflineExerciseAssetCache();
      setAssetCacheMessage({
        type: 'warning',
        text: 'Caché visual de ejercicios liberada. Tus rutinas, historial, PRs y perfil permanecen intactos.',
      });
      await refreshOfflineLibraryStatus();
    } finally {
      setDownloadingOfflineAssets(false);
    }
  };

  const currentRestMode: 'sound' | 'vibrate_only' | 'silent' = soundEnabled
    ? 'sound'
    : vibrationEnabled
    ? 'vibrate_only'
    : 'silent';

  const refreshPushStatus = React.useCallback(async () => {
    try {
      if (platformInfo.isCapacitorNative) {
        const [nativePerm, caps] = await Promise.all([
          getNativeNotificationPermission(),
          getNativeRestTimerCapabilities(),
        ]);
        setNotificationPermission(nativePerm);
        if (caps) setNativeRestCaps(caps);
        return;
      }
      const status = await fetchDevicePushStatus(activeProfile.id);
      setPushStatus(status);
      setNotificationPermission(status.permission);
    } catch {}
  }, [activeProfile.id, platformInfo.isCapacitorNative]);

  const handleTestWatch = async () => {
    setWatchMsg('Enviando aviso de prueba...');
    const res = await testWatchAlert({
      exerciseName: activeRestContext?.exerciseName,
      nextSetNumber: activeRestContext?.nextSetNumber,
      vibrationEnabled,
    });
    setNotificationPermission(res.permission);
    setWatchMsg(res.message);
    void refreshPushStatus();
    scheduleTimeout(() => {
      setWatchMsg(null);
    }, 7000);
  };

  const handleExplicitRequestPermission = async () => {
    const nextPerm = await requestNotificationPermission();
    setNotificationPermission(nextPerm);
    if (nextPerm === 'granted') {
      setWatchMsg(
        platformInfo.isCapacitorNative
          ? 'Permiso concedido. Cronómetro en barra, pantalla de bloqueo y alarmas activos.'
          : 'Permiso concedido. Ya puedes activar Web Push o probar el aviso local.'
      );
    } else if (nextPerm === 'denied') {
      if (platformInfo.isCapacitorNative) {
        await openNativeRestSettingScreen('notifications');
        setWatchMsg(
          'Permiso bloqueado en Android. Se abrieron los ajustes de notificación para activar LAZCAKONG GYM.'
        );
      } else {
        setWatchMsg(
          'Permiso bloqueado en el navegador. Habilita las notificaciones de este sitio en los ajustes de Chrome/navegador.'
        );
      }
    } else {
      setWatchMsg('Permiso de notificaciones aún pendiente.');
    }
    void refreshPushStatus();
    scheduleTimeout(() => setWatchMsg(null), 6000);
  };

  const handleSubscribeWebPush = async () => {
    setPushLoading(true);
    setPushActionMsg(null);
    try {
      const res = await subscribeDeviceToWebPush(activeProfile.id);
      setNotificationPermission(res.permission);
      setPushActionMsg({
        type: res.success ? 'success' : 'error',
        text: res.message,
      });
      await refreshPushStatus();
    } finally {
      setPushLoading(false);
    }
  };

  const handleUnsubscribeWebPush = async () => {
    setPushLoading(true);
    setPushActionMsg(null);
    try {
      await unsubscribeDeviceFromWebPush(activeProfile.id);
      setPushActionMsg({
        type: 'warning',
        text: 'Suscripción Web Push desactivada en este dispositivo.',
      });
      await refreshPushStatus();
    } finally {
      setPushLoading(false);
    }
  };

  const handleImmediatePushTest = async () => {
    setPushLoading(true);
    setPushActionMsg(null);
    try {
      const res = await triggerImmediatePushTest({
        athleteId: activeProfile.id,
        exerciseName: activeRestContext?.exerciseName,
        nextSetNumber: activeRestContext?.nextSetNumber,
        mode: currentRestMode,
      });
      if (res.providerAccepted) {
        setPushActionMsg({
          type: 'success',
          text: `${res.message} (ID: ${res.restId || 'testnow'}). Distingue: 1) Proveedor Web Push aceptó el envío; 2) Confirma si llegó al teléfono; 3) Confirma si se reflejó en tu reloj Honor.`,
        });
      } else {
        setPushActionMsg({
          type: 'error',
          text: res.message,
        });
      }
      await refreshPushStatus();
    } finally {
      setPushLoading(false);
    }
  };

  const handleScheduled60sPushTest = async () => {
    setPushLoading(true);
    setPushActionMsg(null);
    try {
      const res = await triggerScheduled60sPushTest({
        athleteId: activeProfile.id,
        exerciseName: activeRestContext?.exerciseName,
        nextSetNumber: activeRestContext?.nextSetNumber,
        mode: currentRestMode,
      });
      if (res.scheduled && res.restId && res.targetEndTime) {
        setScheduledTest60s({
          restId: res.restId,
          targetEndTime: res.targetEndTime,
          remainingSec: Math.max(1, Math.ceil((res.targetEndTime - Date.now()) / 1000)),
          provider: res.schedulerProvider,
        });
        setPushActionMsg({
          type: 'success',
          text: `Tarea persistente programada (${res.schedulerProvider || 'servidor'}) a 60 s (ID: ${res.restId}). Bloquea la pantalla del Honor 400 Pro ahora. El momento exacto del despertar depende de la cola de tareas, FCM y el ahorro de batería de Android/Honor.`,
        });
      } else {
        setPushActionMsg({
          type: 'error',
          text: res.message,
        });
      }
      await refreshPushStatus();
    } finally {
      setPushLoading(false);
    }
  };

  const handleCancelScheduled60sTest = async () => {
    if (!scheduledTest60s) return;
    setPushLoading(true);
    try {
      await cancelServerRestAlarmPush({
        athleteId: activeProfile.id,
        restId: scheduledTest60s.restId,
        reason: 'cancelled',
      });
      setScheduledTest60s(null);
      setPushActionMsg({
        type: 'warning',
        text: 'Prueba programada a 60 s cancelada e invalidada antes de su envío.',
      });
      await refreshPushStatus();
    } finally {
      setPushLoading(false);
    }
  };

  useEffect(() => {
    const refreshAll = () => {
      if (!platformInfo.isCapacitorNative) {
        setNotificationPermission(getNotificationPermissionStatus());
      }
      void refreshPushStatus();
    };
    refreshAll();
    window.addEventListener('focus', refreshAll);
    document.addEventListener('visibilitychange', refreshAll);
    return () => {
      window.removeEventListener('focus', refreshAll);
      document.removeEventListener('visibilitychange', refreshAll);
    };
  }, [refreshPushStatus, platformInfo.isCapacitorNative]);

  useEffect(() => {
    if (!scheduledTest60s) return;
    const interval = window.setInterval(() => {
      const rem = Math.max(0, Math.ceil((scheduledTest60s.targetEndTime - Date.now()) / 1000));
      if (rem <= 0) {
        window.clearInterval(interval);
        setScheduledTest60s(null);
        void refreshPushStatus();
        return;
      }
      setScheduledTest60s((prev) => (prev ? { ...prev, remainingSec: rem } : null));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [scheduledTest60s, refreshPushStatus]);

  useEffect(() => {
    setName(activeProfile.name || '');
    setAvatar(activeProfile.avatar || '🦍');
    setGoal(activeProfile.goal || 'Hipertrofia & Masa');
    setWeightKg(activeProfile.weightKg || '');
    setHeightCm(activeProfile.heightCm || '');
    setWeeklyTargetDays(activeProfile.weeklyTargetDays || 5);
    setSoundEnabled(activeProfile.soundEnabled !== false);
    setVibrationEnabled(activeProfile.vibrationEnabled !== false);
    setRestEndAlertEnabled(activeProfile.restEndAlertEnabled !== false);
    setWeightUnit(activeProfile.weightUnit || 'kg');
    const savedAccent = normalizeThemeAccent(activeProfile.themeAccent);
    setDraftThemeAccent(savedAccent);
    committedAccentRef.current = savedAccent;
  }, [activeProfile]);

  // If the athlete leaves SettingsCloudView without pressing GUARDAR CAMBIOS DE PERFIL, revert unsaved live preview
  useEffect(() => {
    return () => {
      if (draftAccentRef.current !== committedAccentRef.current) {
        revertPreviewRef.current();
      }
    };
  }, []);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    committedAccentRef.current = draftThemeAccent;
    setThemeAccent(draftThemeAccent);
    onUpdateProfile({
      name: name.trim(),
      avatar,
      goal,
      weightKg: weightKg === '' ? undefined : Number(weightKg),
      heightCm: heightCm === '' ? undefined : Number(heightCm),
      weeklyTargetDays: Number(weeklyTargetDays),
      soundEnabled,
      vibrationEnabled,
      restEndAlertEnabled,
      weightUnit,
      themeAccent: draftThemeAccent,
    });

    setFeedbackMsg('¡Perfil y tema lumínico guardados con éxito!');
    scheduleTimeout(() => setFeedbackMsg(null), 3500);
  };

  const handleCloudSync = async () => {
    setSyncing(true);
    setCloudMsg(null);
    try {
      const res = await onSyncCloud();
      if (res.success) {
        setCloudMsg({ type: 'success', text: res.message });
      } else {
        setCloudMsg({ type: 'error', text: res.message });
      }
    } catch {
      setCloudMsg({ type: 'error', text: 'Error inesperado al conectar con Firebase.' });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-5 pb-24 animate-in fade-in duration-300">
      {/* Profile Header Card */}
      <section className="glass-card rounded-3xl p-5 border border-amber-500/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3.5">
            <span className="text-4xl p-2 rounded-2xl bg-amber-500/20 border border-amber-500/30">
              {avatar}
            </span>
            <div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-400">
                Atleta Activo
              </span>
              <h2 className="text-lg font-black text-white">{name}</h2>
              <p className="text-xs text-slate-400">{goal}</p>
            </div>
          </div>
          <button
            onClick={onOpenProfileSwitcher}
            className="px-3.5 py-2 rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-1.5 active:scale-95 transition-all"
          >
            <Users className="w-4 h-4 text-amber-400" />
            <span>Cuentas</span>
          </button>
        </div>
      </section>

      {isAdmin && onNavigateToTab && (
        <section
          data-testid="settings-admin-panel-card"
          className="glass-card rounded-3xl p-4 border border-amber-500/40 bg-amber-500/10 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-amber-400" />
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 block">
                Administrador Verificado
              </span>
              <h3 className="text-sm font-black text-white truncate">
                Panel de Administración
              </h3>
              <p className="text-[11px] text-slate-300 truncate">
                Atletas, enlaces de invitación y control del sistema
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="settings-admin-panel-btn"
            onClick={() => onNavigateToTab('admin')}
            className="px-4 py-2.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shrink-0 cursor-pointer active:scale-95 transition-all"
          >
            <span>Abrir</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </section>
      )}

      {!isAdmin && adminRequiresGoogleSignIn && (
        <section
          data-testid="settings-admin-requires-google"
          className="glass-card rounded-3xl p-4 border border-amber-500/35 bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-300 block">
                Permiso Admin Requiere Google Sign-In
              </span>
              <p className="text-xs text-amber-100/90 leading-snug mt-0.5">
                Tu cuenta está autenticada con correo/contraseña. Cierra sesión e ingresa con{' '}
                <strong>Continuar con Google</strong> para habilitar el Panel de Administración.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="px-3.5 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-xs font-black uppercase tracking-wider shrink-0 cursor-pointer active:scale-95"
          >
            Cambiar acceso
          </button>
        </section>
      )}

      {/* Profile Update Feedback */}
      {feedbackMsg && (
        <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
          <CheckCircle2 className="w-4 h-4" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Profile Form & Biometric Profile */}
      <form
        onSubmit={handleSaveProfile}
        style={{ borderColor: 'var(--theme-border-soft)', boxShadow: `0 10px 30px -12px var(--theme-glow)` }}
        className="glass-panel rounded-3xl p-5 border space-y-4 transition-all duration-300"
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <span
              style={{ color: 'var(--theme-primary)' }}
              className="text-[10px] font-mono font-black uppercase tracking-widest block transition-colors duration-300"
            >
              CALIBRACIÓN DE ENTRENAMIENTO IA
            </span>
            <h3 className="text-base font-black text-white font-mono uppercase">
              PERFIL BIOMÉTRICO & OBJETIVO
            </h3>
          </div>
          <span
            style={{
              backgroundColor: 'var(--theme-soft-bg)',
              borderColor: 'var(--theme-border-soft)',
              color: 'var(--theme-primary)',
            }}
            className="text-xs font-mono px-2.5 py-1 rounded-xl border transition-colors duration-300"
          >
            Ajusta Carga Inicial
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Nombre de Atleta *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-amber-400"
              required
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Objetivo Principal (IA Generator)
            </label>
            <select
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-amber-300 focus:outline-none focus:border-amber-400"
            >
              <option value="Hipertrofia & Masa">💪 Hipertrofia & Masa (Volumen e Intensidad RIR 1-2)</option>
              <option value="Fuerza Máxima">⚡ Fuerza Máxima (Cargas pesadas 80-90% 1RM)</option>
              <option value="Definición & Quema">🔥 Definición & Quema (Descansos cortos, alta densidad)</option>
              <option value="Recomposición Corporal">⚖️ Recomposición Corporal (Equilibrio masa/grasa)</option>
              {GOAL_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Avatar Selection */}
        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
            Icono / Avatar
          </label>
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
            {AVATAR_OPTIONS.map((emoji, idx) => (
              <button
                key={`${emoji}-${idx}`}
                type="button"
                onClick={() => setAvatar(emoji)}
                className={`text-xl p-2 rounded-2xl border transition-all flex-shrink-0 ${
                  avatar === emoji
                    ? 'bg-amber-500/20 border-amber-400 scale-105 shadow-md shadow-amber-500/20'
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Physical Stats (Biometric Calibration Zone) */}
        <div className="p-3.5 rounded-2xl bg-[#070B16] border border-slate-800 space-y-2">
          <div className="text-[10px] font-mono text-slate-400">
            💡 <strong className="text-white">Uso en IA:</strong> Tu peso y objetivo se utilizan para calcular la carga inicial recomendada en cada ejercicio de las rutinas generadas por la IA.
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Peso Corporal
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="0.1"
                  placeholder="75.0"
                  value={weightKg}
                  onChange={(e) => setWeightKg(e.target.value)}
                  className="w-full text-center text-xs font-black font-mono data-input-field rounded-xl py-2 text-white shadow-inner bg-slate-950 border border-slate-800"
                />
                <span className="absolute right-2 top-2 text-[10px] text-slate-400 font-bold">
                  {weightUnit}
                </span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Estatura
              </label>
              <div className="relative">
                <input
                  type="number"
                  placeholder="175"
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className="w-full text-center text-xs font-black font-mono data-input-field rounded-xl py-2 text-white shadow-inner bg-slate-950 border border-slate-800"
                />
                <span className="absolute right-2 top-2 text-[10px] text-slate-400 font-bold">cm</span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-amber-400 block mb-1">
                Días Meta / Sem
              </label>
              <input
                type="number"
                min="1"
                max="7"
                value={weeklyTargetDays}
                onChange={(e) => setWeeklyTargetDays(Number(e.target.value))}
                className="w-full text-center text-xs font-black font-mono data-input-field rounded-xl py-2 text-amber-300 shadow-inner bg-slate-950 border border-slate-800"
              />
            </div>
          </div>
        </div>

        {/* Preferences Toggles */}
        <div className="space-y-2.5 pt-2 border-t border-slate-800">
          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSoundEnabled(true);
                setVibrationEnabled(true);
                onUpdateProfile({ soundEnabled: true, vibrationEnabled: true });
              }}
              className={`min-h-[38px] px-2 py-1.5 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer ${
                soundEnabled
                  ? 'bg-accent/15 border-accent text-accent-text'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Pitido final
            </button>
            <button
              type="button"
              onClick={() => {
                setSoundEnabled(false);
                setVibrationEnabled(true);
                onUpdateProfile({ soundEnabled: false, vibrationEnabled: true });
              }}
              className={`min-h-[38px] px-2 py-1.5 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer ${
                !soundEnabled && vibrationEnabled
                  ? 'bg-accent/15 border-accent text-accent-text'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Solo vibración
            </button>
            <button
              type="button"
              onClick={() => {
                setSoundEnabled(false);
                setVibrationEnabled(false);
                onUpdateProfile({ soundEnabled: false, vibrationEnabled: false });
              }}
              className={`min-h-[38px] px-2 py-1.5 rounded-xl border text-[11px] font-bold transition-colors cursor-pointer ${
                !soundEnabled && !vibrationEnabled
                  ? 'bg-accent/15 border-accent text-accent-text'
                  : 'bg-slate-900 border-slate-800 text-slate-400'
              }`}
            >
              Silencio
            </button>
          </div>

          <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer">
            <div className="flex items-center space-x-2.5">
              <Volume2 className="w-4 h-4 text-amber-400" />
              <div>
                <span className="text-xs font-bold text-white block">Sonidos de Entrenamiento</span>
                <span className="text-[10px] text-slate-400">
                  Pitido único al terminar descanso y al completar series (libera el audio al terminar)
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setSoundEnabled(next);
                onUpdateProfile({ soundEnabled: next });
              }}
              className="w-4 h-4 accent-amber-500 rounded"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer">
            <div className="flex items-center space-x-2.5">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <div>
                <span className="text-xs font-bold text-white block">Vibración Háptica</span>
                <span className="text-[10px] text-slate-400">
                  Retroalimentación táctil en el teléfono
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={vibrationEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setVibrationEnabled(next);
                onUpdateProfile({ vibrationEnabled: next });
              }}
              className="w-4 h-4 accent-amber-500 rounded"
            />
          </label>

          <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer">
            <div className="flex items-center space-x-2.5">
              <AlertCircle className="w-4 h-4 text-accent-text" />
              <div>
                <span className="text-xs font-bold text-white block">Aviso de fin de descanso</span>
                <span className="text-[10px] text-slate-400">
                  Muestra la alerta visual en pantalla y la notificación del sistema (y reloj vinculado) al llegar a 00:00
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={restEndAlertEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                setRestEndAlertEnabled(next);
                onUpdateProfile({ restEndAlertEnabled: next });
              }}
              style={{ accentColor: 'var(--accent-primary)' }}
              className="w-4 h-4 rounded"
            />
          </label>
        </div>

        {/* Selector de Acento Lumínico — 10 Colores Oficiales Elite Performance */}
        <div className="pt-3 border-t border-[#303030] space-y-3" data-testid="accent-theme-selector">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label
              style={{ color: 'var(--accent-readable-text)' }}
              className="text-[11px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-colors duration-200"
            >
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
              <span>ACENTO LUMÍNICO — PERSONALIZA TU APP</span>
            </label>
            <div className="flex items-center gap-2">
              {draftThemeAccent !== committedThemeAccent && (
                <span
                  data-testid="accent-unsaved-preview-badge"
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#171717] border border-[#303030] text-[#F5F5F5]"
                >
                  Vista previa sin guardar
                </span>
              )}
              <span
                style={{
                  backgroundColor: 'var(--accent-soft-bg)',
                  borderColor: 'var(--accent-border-soft)',
                  color: 'var(--accent-readable-text)',
                }}
                className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border tabular-nums transition-colors duration-200"
              >
                {accentHex}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-[#F5F5F5]/75 leading-snug">
            Toca un color para previsualizar el tema al instante. Pulsa <strong className="text-[#F5F5F5]">GUARDAR CAMBIOS DE PERFIL</strong> para aplicarlo de forma permanente en tu cuenta.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {THEME_PALETTE_LIST.map((config) => {
              const isSelected = draftThemeAccent === config.id;
              return (
                <button
                  key={config.id}
                  type="button"
                  data-testid={`theme-option-${config.id}`}
                  aria-pressed={isSelected}
                  onClick={() => {
                    // Vista previa inmediata SIN persistir hasta pulsar GUARDAR CAMBIOS DE PERFIL
                    setDraftThemeAccent(config.id);
                    previewThemeAccent(config.id);
                  }}
                  className={`min-h-[88px] p-3 rounded-2xl border text-left transition-all duration-200 flex flex-col justify-between gap-2.5 active:scale-[0.98] cursor-pointer ${
                    isSelected
                      ? 'bg-[#171717] border-2'
                      : 'bg-[#090909] border-[#303030] hover:border-[#F5F5F5]/35'
                  }`}
                  style={{
                    borderColor: isSelected ? config.primary : undefined,
                    boxShadow: isSelected ? `0 0 18px ${config.glow}` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span
                      className="w-5 h-5 rounded-full shrink-0 border border-white/15"
                      style={{
                        backgroundColor: config.primary,
                        boxShadow: `0 0 10px ${config.glow}`,
                      }}
                    />
                    {isSelected && (
                      <span
                        data-testid={`theme-selected-badge-${config.id}`}
                        className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md border leading-none"
                        style={{
                          backgroundColor: config.softBg,
                          borderColor: config.borderSoft,
                          color: config.readableText,
                        }}
                      >
                        SELECCIONADO
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold text-[#F5F5F5] leading-tight truncate">
                      {config.name}
                    </div>
                    <div
                      className="text-[11px] font-mono font-bold tabular-nums mt-0.5"
                      style={{ color: isSelected ? config.readableText : '#A1A1AA' }}
                    >
                      {config.primary}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Submit */}
        <button
          type="submit"
          data-testid="save-profile-changes-btn"
          style={{
            backgroundColor: 'var(--accent-primary)',
            color: 'var(--accent-contrast-text)',
            boxShadow: `0 8px 20px -4px var(--accent-glow)`,
          }}
          className="w-full min-h-[48px] py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider active:scale-[0.99] transition-all flex items-center justify-center space-x-2 hover:opacity-95 cursor-pointer"
        >
          <Save className="w-4 h-4 shrink-0" />
          <span>GUARDAR CAMBIOS DE PERFIL</span>
        </button>
      </form>

      {/* Smartwatch & Honor Watch Vibración y Alarma */}
      <section className="glass-panel rounded-3xl p-5 border border-[var(--accent-border-soft)] bg-[#171717] space-y-4 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-accent/15 text-accent-text flex items-center justify-center shrink-0">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Notificaciones y Reloj Honor
              </h3>
              <p className="text-[11px] text-zinc-400 font-medium">
                Alerta visual y notificación del sistema al terminar el descanso
              </p>
            </div>
          </div>
        </div>

        {/* Estado actual del permiso de notificaciones + acción explícita */}
        <div className="p-3.5 rounded-2xl bg-slate-950/85 border border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
              Estado del permiso de notificaciones
            </span>
            <span
              className={`text-[11px] font-black px-2.5 py-0.5 rounded-lg border ${
                notificationPermission === 'granted'
                  ? 'bg-accent/15 border-accent/50 text-accent-text'
                  : notificationPermission === 'denied'
                  ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                  : notificationPermission === 'default'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
            >
              {notificationPermission === 'granted'
                ? 'Permitido'
                : notificationPermission === 'denied'
                ? 'Bloqueado'
                : notificationPermission === 'default'
                ? 'Pendiente de permiso'
                : 'No compatible'}
            </span>
          </div>

          {notificationPermission === 'default' && (
            <button
              type="button"
              onClick={handleExplicitRequestPermission}
              className="w-full py-2.5 px-3 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/50 text-accent-text font-black text-xs transition-all cursor-pointer"
            >
              Permitir notificaciones del sistema
            </button>
          )}

          {notificationPermission === 'denied' && (
            <div className="space-y-2">
              <p className="text-[11px] text-rose-300 leading-relaxed">
                {platformInfo.isCapacitorNative
                  ? 'Las notificaciones están bloqueadas en Android. Toca abajo para abrir los ajustes de notificaciones de LAZCAKONG GYM y activarlas.'
                  : 'Las notificaciones están bloqueadas en este navegador. Para activarlas en Android, entra a Ajustes del sitio / Permisos en Chrome y permite las notificaciones para LAZCAKONGYM.'}
              </p>
              {platformInfo.isCapacitorNative && (
                <button
                  type="button"
                  onClick={() => void openNativeRestSettingScreen('notifications')}
                  className="w-full py-2 px-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-200 font-black text-xs transition-all cursor-pointer"
                >
                  Abrir ajustes de notificaciones en Android
                </button>
              )}
            </div>
          )}
        </div>

        <label className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/85 border border-slate-800 cursor-pointer">
          <div>
            <span className="text-xs font-bold text-white block">Aviso de fin de descanso</span>
            <span className="text-[10px] text-slate-400 block">
              {restEndAlertEnabled
                ? 'Activo: muestra aviso visual y envía notificación al terminar el descanso'
                : 'Desactivado: no enviará notificación ni alerta visual al llegar a cero'}
            </span>
          </div>
          <input
            type="checkbox"
            checked={restEndAlertEnabled}
            onChange={(e) => {
              const next = e.target.checked;
              setRestEndAlertEnabled(next);
              onUpdateProfile({ restEndAlertEnabled: next });
            }}
            style={{ accentColor: 'var(--accent-primary)' }}
            className="w-4 h-4 rounded"
          />
        </label>

        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-2.5">
          <div className="flex items-center gap-3 p-2.5 rounded-xl bg-[#090909] border border-slate-800">
            <div className="relative shrink-0">
              <img
                src="/notification-icon-192.png"
                alt="Icono oficial LazcaKong Gym"
                className="w-10 h-10 rounded-xl object-cover border border-[#CCFF00]/50"
              />
              <span
                title="Badge monocromático de gorila"
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#171717] border border-[#CCFF00]/60 flex items-center justify-center p-0.5"
              >
                <img
                  src="/notification-badge-gorilla.png"
                  alt="Badge monocromático de gorila"
                  className="w-full h-full object-contain"
                />
              </span>
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-black uppercase tracking-wider text-accent-text block">
                Identidad visual en notificaciones
              </span>
              <p className="text-[11px] text-slate-300 leading-snug">
                Envía el logo oficial de LazcaKong Gym por HTTPS y un badge monocromático de gorila para la barra de estado y relojes compatibles.
              </p>
            </div>
          </div>
          <p className="text-slate-200 font-semibold">
            Para que tu reloj Honor reciba la notificación según su compatibilidad:
          </p>
          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-accent/15 text-accent-text flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
            <span>Abre <strong>Honor Salud</strong> &gt; <strong>Dispositivos</strong> &gt; tu reloj Honor &gt; <strong>Notificaciones</strong>.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-accent/15 text-accent-text flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
            <span>Activa <strong>Google Chrome</strong> (o la app instalada de LAZCAKONGYM) y mantén el Bluetooth vinculado.</span>
          </div>
          <p className="text-[10px] text-slate-400 pt-1 leading-relaxed">
            Nota técnica: una PWA no controla directamente la pantalla ni puede encenderla. Además, que el reloj muestre el logo de LazcaKong o el icono del navegador depende de cómo Android, Chrome y Honor Salud reflejen las notificaciones.
          </p>
        </div>

        {watchMsg && (
          <div className="p-3 rounded-2xl bg-accent/15 border border-accent/40 text-accent-text text-xs font-bold text-center animate-in fade-in">
            {watchMsg}
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleTestWatch}
            className="w-full py-3 px-4 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Smartphone className="w-4 h-4" />
            <span>Probar aviso en el reloj</span>
          </button>

          {onStartRestTimer && (
            <button
              type="button"
              onClick={async () => {
                const perm = await requestNotificationPermission();
                setNotificationPermission(perm);
                onStartRestTimer(10);
                setWatchMsg(
                  '⏱️ Temporizador de prueba de 10 s iniciado. Con pantalla encendida sonará/vibrará al llegar a cero; con pantalla bloqueada requiere Web Push y programador persistente configurados.'
                );
                setTimeout(() => setWatchMsg(null), 11000);
              }}
              className="w-full py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Smartphone className="w-4 h-4 text-accent-text" />
              <span>Probar cuenta regresiva de 10 s</span>
            </button>
          )}
        </div>

        {/* Notificaciones nativas offline en Capacitor o Web Push en PWA/navegador */}
        {platformInfo.isCapacitorNative ? (
          <div className="p-4 rounded-2xl bg-[#090909] border border-accent/35 space-y-3" data-testid="native-background-timer-settings">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-accent-text block">
                  HONOR / ANDROID NATIVO
                </span>
                <h4 className="text-xs font-black text-white">
                  CRONÓMETRO EN SEGUNDO PLANO
                </h4>
                {nativeRestCaps && (
                  <p className="text-[10px] text-zinc-400 font-mono mt-0.5">
                    {(nativeRestCaps.manufacturer || 'Android').toUpperCase()} {nativeRestCaps.model || ''} · SDK {nativeRestCaps.sdkInt}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void refreshPushStatus()}
                className="px-2.5 py-1.5 rounded-lg bg-[#171717] hover:bg-[#222222] border border-[#303030] text-[10px] font-bold text-slate-200 flex items-center gap-1 cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Actualizar</span>
              </button>
            </div>

            {nativeRestCaps && (
              <div className="space-y-2 text-[11px]">
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-white block">1. Notificaciones Android (POST_NOTIFICATIONS)</span>
                    <span className="text-[10px] text-zinc-400 block">Necesario para barra, panel y pantalla bloqueada</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${nativeRestCaps.notificationsEnabled ? 'bg-accent/15 border-accent/40 text-accent-text' : 'bg-rose-500/15 border-rose-500/40 text-rose-300'}`}>
                      {nativeRestCaps.notificationsEnabled ? 'Activo' : 'Bloqueado'}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        nativeRestCaps.postNotificationsGranted === false
                          ? void handleExplicitRequestPermission()
                          : void openNativeRestSettingScreen('notifications')
                      }
                      className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] text-[10px] font-bold text-slate-200 cursor-pointer"
                    >
                      Ajustar
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-white block">2. Canal del cronómetro y pantalla de bloqueo</span>
                    <span className="text-[10px] text-zinc-400 block">
                      {nativeRestCaps.ongoingChannelId || 'lazcakong_rest_chronometer_v2'} · Público en bloqueo
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${nativeRestCaps.ongoingChannelEnabled && nativeRestCaps.lockScreenSystemEnabled !== false ? 'bg-accent/15 border-accent/40 text-accent-text' : 'bg-amber-500/15 border-amber-500/40 text-amber-300'}`}>
                      {nativeRestCaps.ongoingChannelEnabled ? 'Habilitado' : 'Revisar'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openNativeRestSettingScreen('channel', nativeRestCaps.ongoingChannelId)}
                      className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] text-[10px] font-bold text-slate-200 cursor-pointer"
                    >
                      Canal
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-white block">3. Alarmas exactas (00:00 en punto)</span>
                    <span className="text-[10px] text-zinc-400 block">SCHEDULE_EXACT_ALARM para despertar sin retraso</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${nativeRestCaps.canScheduleExactAlarms ? 'bg-accent/15 border-accent/40 text-accent-text' : 'bg-amber-500/15 border-amber-500/40 text-amber-300'}`}>
                      {nativeRestCaps.canScheduleExactAlarms ? 'Exacta' : 'Pendiente'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openNativeRestSettingScreen('exact_alarms')}
                      className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] text-[10px] font-bold text-slate-200 cursor-pointer"
                    >
                      Abrir
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-white block">4. Batería y segundo plano Honor MagicOS</span>
                    <span className="text-[10px] text-zinc-400 block">
                      {nativeRestCaps.ignoringBatteryOptimizations
                        ? 'Sin restricciones de batería'
                        : 'Con optimización de batería (MagicOS puede suspender procesos)'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void openNativeRestSettingScreen('battery')}
                      className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] text-[10px] font-bold text-slate-200 cursor-pointer"
                    >
                      Batería
                    </button>
                    <button
                      type="button"
                      onClick={() => void openNativeRestSettingScreen('magicos_autostart')}
                      className="px-2 py-1 rounded-lg bg-accent/15 border border-accent/40 text-[10px] font-black text-accent-text cursor-pointer"
                    >
                      Inicio Honor
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-bold text-white block">5. Aviso visual en pantalla bloqueada (Full-Screen)</span>
                    <span className="text-[10px] text-zinc-400 block">Permite mostrar pantalla de fin de descanso al 00:00</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-[10px] font-black px-2 py-0.5 rounded border ${nativeRestCaps.canUseFullScreenIntent ? 'bg-accent/15 border-accent/40 text-accent-text' : 'bg-amber-500/15 border-amber-500/40 text-amber-300'}`}>
                      {nativeRestCaps.canUseFullScreenIntent ? 'Permitido' : 'Revisar'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openNativeRestSettingScreen('fullscreen_intent')}
                      className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] text-[10px] font-bold text-slate-200 cursor-pointer"
                    >
                      Activar
                    </button>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-white">6. Live Updates / Cápsula superior</span>
                    <span className="text-[10px] font-black px-2 py-0.5 rounded border bg-[#171717] border-[#303030] text-slate-200">
                      {nativeRestCaps.supportsPromotedOngoing
                        ? nativeRestCaps.canPostPromoted
                          ? 'Android 16 Promoted OK'
                          : nativeRestCaps.hasPromotableCharacteristics
                          ? 'Característica lista'
                          : 'Modo compatibilidad'
                        : `Android SDK ${nativeRestCaps.sdkInt}`}
                    </span>
                  </div>
                  <p className="text-[10px] text-zinc-400 leading-snug">
                    En Android 16 se solicita Live Update en la barra superior cuando el fabricante lo habilita. En Honor MagicOS, la Magic Capsule nativa está restringida por firmware a apps del sistema; el cronómetro en vivo se muestra de forma persistente en panel superior y pantalla bloqueada.
                  </p>
                </div>
              </div>
            )}

            <div className="p-3 rounded-xl bg-[#111111] border border-[#303030] space-y-1.5 text-[10px] text-slate-300">
              <span className="font-black uppercase tracking-wider text-accent-text block">
                Guía rápida Honor 400 Pro (3 pasos)
              </span>
              <p>1. <strong>Ajustes &gt; Aplicaciones &gt; Inicio de aplicaciones</strong>: desactiva Automático en LAZCAKONG GYM y marca <em>Inicio automático, secundario y ejecutar en segundo plano</em>.</p>
              <p>2. <strong>Ajustes &gt; Notificaciones &gt; LAZCAKONG GYM</strong>: activa <em>Pantalla de bloqueo</em> y desactiva <em>Ocultar notificaciones silenciosas</em>.</p>
              <p>3. <strong>Multitarea</strong>: desliza la tarjeta de LAZCAKONG GYM hacia abajo o toca el candado para fijarla en memoria durante la sesión.</p>
            </div>

            {onStartRestTimer && (
              <button
                type="button"
                onClick={async () => {
                  const perm = await requestNotificationPermission();
                  setNotificationPermission(perm);
                  onStartRestTimer(15, 'Prueba Honor 400 Pro');
                  setWatchMsg(
                    '⏱️ Cronómetro de prueba 15 s iniciado. Sal a WhatsApp o bloquea tu Honor 400 Pro ahora para comprobar el conteo regresivo y la alerta al 00:00.'
                  );
                  void refreshPushStatus();
                  scheduleTimeout(() => setWatchMsg(null), 16000);
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-accent/15 hover:bg-accent/25 border border-accent/50 text-accent-text font-black text-xs transition-all cursor-pointer"
              >
                Probar cronómetro 15 s (bloquea el teléfono)
              </button>
            )}
          </div>
        ) : (
        <div className="p-4 rounded-2xl bg-[#090909] border border-accent/30 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <span className="text-[10px] font-black uppercase tracking-wider text-accent-text block">
                Web Push · Pantalla bloqueada
              </span>
              <h4 className="text-xs font-black text-white">
                Envío remoto desde servidor y cola persistente
              </h4>
            </div>
            <span
              className={`text-[10px] font-black px-2 py-0.5 rounded-lg border shrink-0 ${
                pushStatus?.readiness?.readyForLockedScheduledPush &&
                pushStatus.browserSubscribed &&
                pushStatus.serverDeviceRegistered
                  ? 'bg-accent/15 border-accent/50 text-accent-text'
                  : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
              }`}
            >
              {pushStatus?.readiness?.readyForLockedScheduledPush &&
              pushStatus.browserSubscribed &&
              pushStatus.serverDeviceRegistered
                ? 'Operativo'
                : 'Requiere configuración'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Suscripción este dispositivo</span>
              <strong
                className={
                  pushStatus?.browserSubscribed && pushStatus?.serverDeviceRegistered
                    ? 'text-accent-text'
                    : 'text-amber-300'
                }
              >
                {pushStatus?.browserSubscribed && pushStatus?.serverDeviceRegistered
                  ? `Activa (${pushStatus.subscriptionCount} disp.)`
                  : pushStatus?.browserSubscribed
                  ? 'Solo navegador (sin guardar en servidor)'
                  : 'No suscrito'}
              </strong>
            </div>

            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800">
              <span className="text-[10px] text-slate-400 block">Programador persistente</span>
              <strong
                className={
                  pushStatus?.readiness?.schedulerProvider &&
                  pushStatus.readiness.schedulerProvider !== 'none'
                    ? 'text-accent-text'
                    : 'text-rose-300'
                }
              >
                {pushStatus?.readiness?.schedulerProvider === 'cloud_tasks'
                  ? 'Google Cloud Tasks'
                  : pushStatus?.readiness?.schedulerProvider === 'qstash'
                  ? 'Upstash QStash'
                  : 'No configurado'}
              </strong>
            </div>
          </div>

          {pushStatus?.readiness &&
            pushStatus.readiness.missingRequirements.length > 0 && (
              <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/35 space-y-2">
                <div className="text-[11px] font-black text-rose-300 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Requisitos faltantes en el servidor (no simulado)</span>
                </div>
                <ul className="space-y-1.5">
                  {pushStatus.readiness.missingRequirements.map((req) => (
                    <li
                      key={req.key}
                      className="text-[11px] text-slate-200 bg-slate-950/80 border border-slate-800 rounded-lg p-2 space-y-0.5"
                    >
                      <div className="font-mono font-bold text-accent-text text-[10px]">
                        {req.key} ·{' '}
                        <span className="text-slate-300 font-sans">
                          {req.requiredFor === 'immediate'
                            ? 'Necesario para Push inmediato'
                            : 'Necesario para Push programado (pantalla bloqueada)'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-300 leading-snug">{req.howToFix}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

          {pushActionMsg && (
            <div
              className={`p-3 rounded-xl text-[11px] font-bold leading-relaxed border ${
                pushActionMsg.type === 'success'
                  ? 'bg-accent/15 border-accent/40 text-accent-text'
                  : pushActionMsg.type === 'warning'
                  ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                  : 'bg-rose-500/15 border-rose-500/40 text-rose-200'
              }`}
            >
              {pushActionMsg.text}
            </div>
          )}

          {scheduledTest60s && (
            <div className="p-3 rounded-xl bg-accent/10 border border-accent/50 flex items-center justify-between gap-2">
              <div className="text-[11px]">
                <span className="font-black text-accent-text block">
                  Prueba 60 s en cola · {scheduledTest60s.remainingSec} s
                </span>
                <span className="text-[10px] text-slate-300 font-mono">
                  Bloquea tu teléfono ahora ({scheduledTest60s.restId})
                </span>
              </div>
              <button
                type="button"
                onClick={handleCancelScheduled60sTest}
                disabled={pushLoading}
                className="px-3 py-1.5 rounded-lg bg-rose-500/20 border border-rose-500/40 text-rose-200 text-[11px] font-bold cursor-pointer shrink-0"
              >
                Cancelar prueba 60 s
              </button>
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={handleSubscribeWebPush}
              disabled={pushLoading}
              className="w-full py-2.5 px-3 rounded-xl bg-[#171717] hover:bg-[#222222] border border-accent/50 text-accent-text font-black text-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {pushStatus?.browserSubscribed && pushStatus?.serverDeviceRegistered
                ? 'Actualizar suscripción Web Push de este dispositivo'
                : 'Activar Web Push en este dispositivo'}
            </button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleImmediatePushTest}
                disabled={pushLoading}
                className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
              >
                Prueba push inmediata
              </button>

              <button
                type="button"
                onClick={handleScheduled60sPushTest}
                disabled={pushLoading}
                className="py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-white font-bold text-xs transition-all cursor-pointer disabled:opacity-50"
              >
                Prueba push programada (60 s)
              </button>
            </div>

            {pushStatus?.browserSubscribed && (
              <button
                type="button"
                onClick={handleUnsubscribeWebPush}
                disabled={pushLoading}
                className="w-full py-1.5 text-[10px] font-bold text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
              >
                Desactivar suscripción Web Push de este dispositivo
              </button>
            )}
          </div>

          <p className="text-[10px] text-slate-400 leading-relaxed">
            La llegada exacta con el Honor 400 Pro bloqueado depende de Google FCM, la cola de tareas diferidas y el modo Doze/ahorro de batería del sistema; no garantiza precisión al milisegundo ni entrega si el dispositivo está en reposo profundo sin conexión.
          </p>
        </div>
        )}
      </section>

      {/* Gym Tools Direct Access */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
        <div className="flex items-center space-x-2">
          <Disc className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Herramientas del Gimnasio
          </h3>
        </div>

        <button
          onClick={() => onOpenPlateCalculator(100)}
          className="w-full p-3.5 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 text-left flex items-center justify-between group active:scale-98 transition-all"
        >
          <div className="flex items-center space-x-3">
            <span className="text-xl">🏋️</span>
            <div>
              <h4 className="text-xs font-black text-white group-hover:text-cyan-400 transition-colors">
                Calculadora de Discos para Barra & Prensa
              </h4>
              <p className="text-[10px] text-slate-400">
                Visualización gráfica de discos por lado
              </p>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-slate-500" />
        </button>
      </section>

      {/* Firebase Cloud Sync & Offline Sync Queue */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            {isOnline ? (
              <Wifi className="w-4 h-4 text-emerald-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-amber-400" />
            )}
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Sincronización y Modo Offline
            </h3>
          </div>
          <span
            className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full border ${
              !isOnline || isOfflineSession
                ? 'text-amber-300 bg-amber-500/15 border-amber-500/30'
                : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
            }`}
          >
            {!isOnline
              ? 'Sin Conexión (Offline)'
              : isOfflineSession
              ? 'Sesión Offline Activa'
              : 'Cloud Firestore Activo'}
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Tus rutinas, series, notas, RPE/RIR y marcas se guardan localmente al instante. Cuando no tienes señal en el gimnasio, las operaciones se encolan y se concilian sin sobrescribir cambios al volver a estar en línea.
        </p>

        {/* Estado de Cola Offline */}
        <div className="p-3.5 rounded-2xl bg-slate-950/75 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold text-slate-300">Cola de sincronización pendiente</span>
            <span
              data-testid="settings-pending-sync-count"
              className={`font-mono font-black px-2 py-0.5 rounded-lg ${
                pendingSyncCount > 0
                  ? 'bg-amber-500/20 text-amber-300'
                  : workoutSyncStatus === 'error'
                  ? 'bg-rose-500/20 text-rose-300'
                  : 'bg-emerald-500/15 text-emerald-400'
              }`}
            >
              {pendingSyncCount} pendiente{pendingSyncCount === 1 ? '' : 's'}
            </span>
          </div>

          {pendingSyncOps.length > 0 && (
            <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
              {pendingSyncOps.slice(0, 4).map((op) => (
                <div
                  key={op.id}
                  className="flex items-center justify-between text-[11px] bg-slate-900/80 border border-slate-800 rounded-xl px-2.5 py-1.5 text-slate-300"
                >
                  <span className="truncate font-semibold">{op.operationType}</span>
                  <span className="font-mono text-[10px] text-amber-300 shrink-0">
                    intentos: {op.attempts} · {op.status}
                  </span>
                </div>
              ))}
            </div>
          )}

          {lastSyncError && (
            <p className="text-[11px] text-amber-300/90 leading-snug">
              Último aviso de red: {lastSyncError}
            </p>
          )}

          {pendingSyncCount > 0 && onRetryWorkoutSync && (
            <button
              type="button"
              disabled={!isOnline || retryingQueue}
              onClick={async () => {
                setRetryingQueue(true);
                setCloudMsg(null);
                try {
                  const res = await onRetryWorkoutSync();
                  setCloudMsg({
                    type: res.success ? 'success' : 'error',
                    text: res.message,
                  });
                } finally {
                  setRetryingQueue(false);
                }
              }}
              className="w-full py-2.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-45 border border-amber-500/40 text-amber-200 font-black text-xs transition-all cursor-pointer"
            >
              {!isOnline
                ? 'Esperando conexión a internet para enviar cola'
                : retryingQueue
                ? 'REINTENTANDO COLA OFFLINE...'
                : 'PROCESAR COLA OFFLINE AHORA'}
            </button>
          )}
        </div>

        {cloudMsg && (
          <div
            className={`p-3 rounded-2xl text-xs font-bold flex items-center gap-2 ${
              cloudMsg.type === 'success'
                ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300'
                : 'bg-rose-500/20 border border-rose-500/40 text-rose-300'
            }`}
          >
            {cloudMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{cloudMsg.text}</span>
          </div>
        )}

        <button
          onClick={handleCloudSync}
          disabled={syncing || !isOnline}
          className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs active:scale-98 shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
        >
          <Cloud className="w-4 h-4" />
          <span>
            {!isOnline
              ? 'SIN CONEXIÓN · GUARDADO LOCAL ACTIVO'
              : syncing
              ? 'SINCRONIZANDO...'
              : 'SINCRONIZAR AHORA CON CLOUD FIRESTORE'}
          </span>
        </button>

        {/* Capacidades reales Offline vs Online */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowOfflineMatrix((prev) => !prev)}
            className="w-full flex items-center justify-between text-[11px] font-bold text-slate-300 hover:text-amber-300 py-1.5 cursor-pointer"
          >
            <span>¿Qué funciona sin internet en esta plataforma ({platformInfo.platform.toUpperCase()})?</span>
            <span className="text-amber-400">{showOfflineMatrix ? 'Ocultar' : 'Ver detalle'}</span>
          </button>

          {showOfflineMatrix && (
            <div className="mt-2 space-y-1.5 bg-slate-950/80 border border-slate-800 rounded-2xl p-3">
              {capabilitiesMatrix.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 text-[11px] border-b border-slate-800/70 last:border-b-0 pb-1.5 last:pb-0"
                >
                  <div className="min-w-0">
                    <span className="font-bold text-slate-200 block">{item.label}</span>
                    <span className="text-slate-400 text-[10px] leading-tight block">{item.detail}</span>
                  </div>
                  <span
                    className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                      item.worksOffline
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-slate-800 text-slate-400'
                    }`}
                  >
                    {item.worksOffline ? 'Offline OK' : 'Solo Online'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-1 flex items-center justify-between text-[11px] text-slate-500">
          <span>Servidor seguro · LAZCAKONGYM Cloud</span>
          <span className="font-mono text-emerald-400">
            {isOfflineSession ? 'UID Offline Verificado' : activeProfile.authUid ? 'Firebase Auth Activo' : 'Protegido'}
          </span>
        </div>

        {activeProfile.migrationStatus === 'provisional_claimed' && onLinkGoogleAccount && (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2.5">
            <div className="flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-200 leading-relaxed">
                <strong className="text-amber-300 block">Asegura tu cuenta permanentemente</strong>
                Tu cuenta fue migrada automáticamente desde el acceso anterior. Vincula tu cuenta Google para mantener acceso directo sin perder tus entrenamientos.
              </div>
            </div>
            <button
              type="button"
              onClick={async () => {
                setCloudMsg(null);
                const res = await onLinkGoogleAccount();
                setCloudMsg({
                  type: res.success ? 'success' : 'error',
                  text: res.message,
                });
              }}
              className="w-full py-2.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-black text-xs flex items-center justify-center gap-2 shadow cursor-pointer"
            >
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>VINCULAR CON GOOGLE</span>
            </button>
          </div>
        )}
      </section>

      {/* Selective Versioned Offline Exercise Library (Strictly Routine-Scoped) */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Database className="w-4 h-4 text-accent-text" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Biblioteca Offline de Mis Rutinas
            </h3>
          </div>
          <span className="text-[10px] font-mono font-bold text-accent-text bg-accent/10 px-2 py-0.5 rounded border border-accent/25">
            {offlineCacheStatus?.cacheName || 'lazcakon-exercise-lib-v1'}
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Descarga selectivamente las ilustraciones e instrucciones visuales únicamente de los {routineAssetSummary.exercisesCount} ejercicios asignados en tus {routineAssetSummary.routinesCount} rutinas actuales para ahorrar memoria en tu teléfono.
        </p>

        <div className="grid grid-cols-3 gap-2 text-center font-mono">
          <div className="p-2.5 rounded-xl bg-slate-950/75 border border-slate-800">
            <div className="text-base font-black text-accent-text">
              {offlineCacheStatus ? `${offlineCacheStatus.cachedAssetsCount}/${offlineCacheStatus.targetAssetsCount}` : `0/${routineAssetSummary.uniqueUrls.length}`}
            </div>
            <div className="text-[10px] text-slate-400 uppercase">En Caché</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/75 border border-slate-800">
            <div className="text-base font-black text-white">
              {routines.length}
            </div>
            <div className="text-[10px] text-slate-400 uppercase">Rutinas</div>
          </div>
          <div className="p-2.5 rounded-xl bg-slate-950/75 border border-slate-800">
            <div className="text-base font-black text-sky-400">
              {typeof storageHealth?.usageBytes === 'number'
                ? `${(storageHealth.usageBytes / (1024 * 1024)).toFixed(1)} MB`
                : 'N/D'}
            </div>
            <div className="text-[10px] text-slate-400 uppercase">Espacio App</div>
          </div>
        </div>

        {storageHealth?.isLowSpaceWarning && (
          <div className="p-2.5 rounded-xl bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[11px] font-semibold">
            Advertencia: espacio del dispositivo ocupado al {storageHealth.usagePct}%. Recomendamos conservar solo las rutinas esenciales.
          </div>
        )}

        {assetDownloadProgress && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] text-amber-300 font-bold">
              <span>Descargando recursos visuales de tus rutinas...</span>
              <span className="font-mono">
                {assetDownloadProgress.completed}/{assetDownloadProgress.total}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
              <div
                className="h-full bg-accent transition-all duration-150"
                style={{
                  width: `${
                    assetDownloadProgress.total > 0
                      ? Math.round((assetDownloadProgress.completed / assetDownloadProgress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        )}

        {assetCacheMessage && (
          <div
            className={`p-3 rounded-2xl text-xs font-semibold flex items-start gap-2 ${
              assetCacheMessage.type === 'success'
                ? 'bg-emerald-500/15 border border-emerald-500/35 text-emerald-300'
                : assetCacheMessage.type === 'warning'
                ? 'bg-amber-500/15 border border-amber-500/35 text-amber-300'
                : 'bg-rose-500/15 border border-rose-500/35 text-rose-300'
            }`}
          >
            <HardDrive className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{assetCacheMessage.text}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={downloadingOfflineAssets || !isOnline || routines.length === 0}
            onClick={() => void handleDownloadRoutineOfflineLibrary()}
            className="flex-1 py-3 rounded-2xl bg-accent hover:bg-accent-hover disabled:opacity-45 text-accent-contrast font-black text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>
              {downloadingOfflineAssets
                ? 'DESCARGANDO...'
                : !isOnline
                ? 'CONÉCTATE PARA DESCARGAR'
                : 'DESCARGAR RUTINAS OFFLINE'}
            </span>
          </button>

          {offlineCacheStatus && offlineCacheStatus.cachedAssetsCount > 0 && (
            <button
              type="button"
              disabled={downloadingOfflineAssets}
              onClick={() => void handleClearOfflineExerciseLibrary()}
              className="px-3.5 py-3 rounded-2xl bg-slate-950 border border-slate-800 hover:border-rose-500/40 text-slate-300 hover:text-rose-300 text-xs font-bold cursor-pointer"
              title="Liberar caché visual sin borrar rutinas ni historial"
            >
              Limpiar visual
            </button>
          )}
        </div>
      </section>

      {/* Copias de Seguridad & Restauración Segura (Disponible para cada atleta autorizado) */}
      <EliteBackupRestorePanel
        activeProfile={activeProfile}
        onExportBackup={onExportBackup}
        onInspectBackup={onInspectBackup}
        onImportBackup={onImportBackup}
        preImportBackup={preImportBackup}
        onRestorePreImportBackup={onRestorePreImportBackup}
        currentCounts={backupCounts}
      />

      {/* Migración de datos & Limpieza */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
            Importar Rutinas e Historial (CSV)
          </h3>
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
            Hevy • Strong • FitNotes • Excel
          </span>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          ¿Tienes tus rutinas o entrenamientos en Hevy, Strong o una planilla CSV? Sube tu archivo aquí: se extraerán automáticamente tus <strong className="text-white">rutinas de ejercicios</strong>, todo tu <strong className="text-white">historial de entrenamientos</strong> y tus <strong className="text-white">récords personales (PRs)</strong>.
        </p>

        <label className={`w-full p-3 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white text-xs font-black flex items-center justify-center space-x-2 transition-all cursor-pointer shadow-lg shadow-emerald-900/20 active:scale-95 ${
          isProcessingCsv ? 'opacity-70 pointer-events-none' : ''
        }`}>
          {isProcessingCsv ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>ANALIZANDO ARCHIVO...</span>
            </>
          ) : (
            <>
              <Upload className="w-4 h-4" />
              <span>SELECCIONAR ARCHIVO (CSV / EXCEL / PDF)</span>
            </>
          )}
          <input
            type="file"
            accept=".csv, .xlsx, .xls, .pdf, .txt"
            disabled={isProcessingCsv}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setIsProcessingCsv(true);
              setCsvErrorMsg(null);
              try {
                const { parseRoutineFile } = await import('../utils/universalFileImporter');
                const parsed = await parseRoutineFile(file);
                if (parsed.stats.totalRows === 0) {
                  setCsvErrorMsg(
                    'No se reconocieron columnas de ejercicios válidas en el archivo. Asegúrate de incluir columnas como "Día", "Músculo", "Ejercicio", "Series", "Reps" o formato Hevy/Strong.'
                  );
                  return;
                }
                setCsvImportMode('append_new');
                setCsvReplaceConfirmed(false);
                setCsvPreserveHistory(true);
                setPendingCsvImport({
                  fileName: file.name,
                  parsed,
                });
              } catch (err: any) {
                setCsvErrorMsg(
                  'Error al analizar el archivo: ' + (err?.message || 'Error inesperado')
                );
              } finally {
                setIsProcessingCsv(false);
                if (e.target) e.target.value = '';
              }
            }}
            className="hidden"
          />
        </label>

        {csvErrorMsg && (
          <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{csvErrorMsg}</span>
          </div>
        )}

        {/* Vista previa y confirmación explícita antes de guardar */}
        {pendingCsvImport && (
          <div className="p-4 rounded-2xl bg-[#090909] border border-accent/50 space-y-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-accent-text">
                  Vista previa segura · {pendingCsvImport.fileName}
                </p>
                <h4 className="text-sm font-black text-[#F5F5F5]">
                  Confirmar Importación en {activeProfile.name}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setPendingCsvImport(null)}
                className="p-1.5 rounded-lg bg-[#171717] text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center font-mono">
              <div className="p-2 rounded-xl bg-[#171717] border border-[#303030]">
                <div className="text-base font-black text-accent-text">
                  {pendingCsvImport.parsed.routines.length}
                </div>
                <div className="text-[10px] text-[#F5F5F5]/60 uppercase">Rutinas</div>
              </div>
              <div className="p-2 rounded-xl bg-[#171717] border border-[#303030]">
                <div className="text-base font-black text-[#F5F5F5]">
                  {pendingCsvImport.parsed.workouts.length}
                </div>
                <div className="text-[10px] text-[#F5F5F5]/60 uppercase">Sesiones CSV</div>
              </div>
              <div className="p-2 rounded-xl bg-[#171717] border border-[#303030]">
                <div className="text-base font-black text-[#F5F5F5]">
                  {Object.keys(pendingCsvImport.parsed.prs || {}).length}
                </div>
                <div className="text-[10px] text-[#F5F5F5]/60 uppercase">PRs CSV</div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-start gap-2.5 text-xs text-[#F5F5F5] cursor-pointer">
                <input
                  type="radio"
                  name="csvImportMode"
                  checked={csvImportMode === 'append_new'}
                  onChange={() => {
                    setCsvImportMode('append_new');
                    setCsvReplaceConfirmed(false);
                  }}
                  style={{ accentColor: 'var(--accent-primary)' }}
                  className="mt-0.5"
                />
                <span>
                  <strong className="text-accent-text">
                    Guardar como nueva planificación (Recomendado)
                  </strong>
                  <span className="block text-[11px] text-[#F5F5F5]/65">
                    Conserva todas tus rutinas previas y crea un respaldo automático previo.
                  </span>
                </span>
              </label>

              <label className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-start gap-2.5 text-xs text-[#F5F5F5] cursor-pointer">
                <input
                  type="radio"
                  name="csvImportMode"
                  checked={csvImportMode === 'replace_all'}
                  onChange={() => setCsvImportMode('replace_all')}
                  style={{ accentColor: 'var(--accent-primary)' }}
                  className="mt-0.5"
                />
                <span>
                  <strong className="text-rose-300">
                    Reemplazar rutinas semanales previas
                  </strong>
                  <span className="block text-[11px] text-[#F5F5F5]/65">
                    Requiere confirmación explícita (nunca borra historial, PRs ni Mapa Muscular).
                  </span>
                </span>
              </label>

              {csvImportMode === 'replace_all' && (
                <label className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/50 flex items-start gap-2 text-xs text-rose-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={csvReplaceConfirmed}
                    onChange={(e) => setCsvReplaceConfirmed(e.target.checked)}
                    style={{ accentColor: 'var(--accent-primary)' }}
                    className="mt-0.5"
                  />
                  <span>
                    Confirmo explícitamente reemplazar las rutinas anteriores de {activeProfile.name}.
                  </span>
                </label>
              )}

              {(pendingCsvImport.parsed.workouts.length > 0 ||
                Object.keys(pendingCsvImport.parsed.prs || {}).length > 0) && (
                <label className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-start gap-2 text-[11px] text-[#F5F5F5]/85 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={csvPreserveHistory}
                    onChange={(e) => setCsvPreserveHistory(e.target.checked)}
                    style={{ accentColor: 'var(--accent-primary)' }}
                    className="mt-0.5"
                  />
                  <span>
                    Solo importar rutinas (Recomendado: mantener intactos mis entrenamientos completados, PRs y Mapa Muscular actuales).
                  </span>
                </label>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingCsvImport(null)}
                className="px-4 py-2.5 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5]/80 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={csvImportMode === 'replace_all' && !csvReplaceConfirmed}
                onClick={() => {
                  if (!onImportCsv) return;
                  const payload: SafeImportPayload = {
                    routines: pendingCsvImport.parsed.routines,
                    workouts: csvPreserveHistory ? [] : pendingCsvImport.parsed.workouts,
                    prs: csvPreserveHistory ? {} : pendingCsvImport.parsed.prs,
                    importMode: csvImportMode,
                    confirmReplaceExisting:
                      csvImportMode === 'replace_all' && csvReplaceConfirmed,
                    preserveWorkoutsAndHistory: csvPreserveHistory,
                    sourceLabel: `Importación ${pendingCsvImport.fileName}`,
                  };
                  const res = onImportCsv(payload);
                  setImportSummary({
                    open: true,
                    totalRows: pendingCsvImport.parsed.stats.totalRows,
                    routinesCreated:
                      res.routinesCount || pendingCsvImport.parsed.routines.length,
                    routineNames:
                      res.routineNames ||
                      pendingCsvImport.parsed.routines.map((r) => r.title),
                    workoutsCreated: res.workoutsCount || 0,
                    prsCreated: res.prsCount || 0,
                  });
                  setPendingCsvImport(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-contrast font-black text-xs cursor-pointer"
              >
                Confirmar Importación Segura
              </button>
            </div>
          </div>
        )}

        {/* Respaldo automático previo a importación */}
        {preImportBackup && onRestorePreImportBackup && (
          <div className="p-3.5 rounded-2xl bg-[#171717] border border-[#303030] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-[#F5F5F5]">
                Respaldo pre-importación ({preImportBackup.routinesCount} rutinas ·{' '}
                {preImportBackup.historyCount} entrenamientos · {preImportBackup.prsCount} PRs)
              </div>
            </div>
            {confirmRestoreBackup ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const r = onRestorePreImportBackup();
                    setConfirmRestoreBackup(false);
                    setRestoreFeedbackMsg(r.message);
                    scheduleTimeout(() => setRestoreFeedbackMsg(null), 4500);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black cursor-pointer"
                >
                  Confirmar restauración
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRestoreBackup(false)}
                  className="px-3 py-1.5 rounded-xl bg-[#090909] border border-[#303030] text-xs font-bold text-[#F5F5F5]/75 cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRestoreBackup(true)}
                className="w-full py-2 rounded-xl bg-[#090909] border border-accent/40 text-accent-text text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar respaldo previo a la última importación</span>
              </button>
            )}
            {restoreFeedbackMsg && (
              <p className="text-[11px] font-bold text-accent-text">{restoreFeedbackMsg}</p>
            )}
          </div>
        )}

        {/* Tarjeta de Confirmación y Acceso Directo a la Rutina Cargada */}
        {importSummary && importSummary.open && (
          <div className="p-4 rounded-2xl bg-gradient-to-b from-emerald-950/90 via-slate-900 to-slate-950 border border-emerald-500/50 shadow-2xl space-y-3.5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center text-emerald-400">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-black text-white">¡Rutina e Historial Cargados!</h4>
                  <p className="text-[11px] text-emerald-300 font-medium">
                    Se procesaron con éxito {importSummary.totalRows} registros del CSV.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setImportSummary(null)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
                title="Cerrar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Cuadrícula de estadísticas */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                <div className="text-lg font-black text-amber-400">{importSummary.routinesCreated}</div>
                <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Rutinas Activas</div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                <div className="text-lg font-black text-sky-400">{importSummary.workoutsCreated}</div>
                <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Historial Sesiones</div>
              </div>
              <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-center">
                <div className="text-lg font-black text-emerald-400">{importSummary.prsCreated}</div>
                <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Récords PRs</div>
              </div>
            </div>

            {/* Listado de Rutinas activas creadas */}
            {importSummary.routineNames.length > 0 && (
              <div className="p-3 rounded-xl bg-slate-900/90 border border-amber-500/25 space-y-2">
                <div className="text-[11px] font-bold text-amber-300 flex items-center space-x-1.5">
                  <Dumbbell className="w-3.5 h-3.5 text-amber-400" />
                  <span>Rutinas cargadas y listas para entrenar:</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {importSummary.routineNames.map((name, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-bold"
                    >
                      {name}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] text-slate-300 leading-relaxed pt-1">
                  📍 <strong className="text-white">¿Dónde aparece activa?</strong> Está guardada en la pestaña <strong className="text-amber-400">"Rutinas"</strong> (en la barra inferior). Tócala para iniciar tu entrenamiento en cualquier momento.
                </p>
              </div>
            )}

            {/* Botones de navegación directa */}
            <div className="flex items-center space-x-2 pt-1">
              {onNavigateToTab && (
                <>
                  <button
                    onClick={() => {
                      setImportSummary(null);
                      onNavigateToTab('rutinas');
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs flex items-center justify-center space-x-1.5 transition-all shadow-md active:scale-95"
                  >
                    <span>IR A VER MIS RUTINAS AHORA</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                  {importSummary.workoutsCreated > 0 && (
                    <button
                      onClick={() => {
                        setImportSummary(null);
                        onNavigateToTab('progreso');
                      }}
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center space-x-1 transition-all active:scale-95"
                    >
                      <span>Ver Historial</span>
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {onCleanMyData && (
          confirmCleanData ? (
            <div className="p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/35 space-y-2.5">
              <p className="text-xs font-bold text-rose-200 leading-relaxed">
                ¿Confirmas limpiar todo el historial, marcas PR y registros de peso de {activeProfile.name}? Comenzarás desde cero.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onCleanMyData();
                    setConfirmCleanData(false);
                    setFeedbackMsg('¡Tu historial y marcas han sido limpiados a cero exitosamente!');
                    scheduleTimeout(() => setFeedbackMsg(null), 4000);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black cursor-pointer"
                >
                  Confirmar limpieza
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmCleanData(false)}
                  className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCleanData(true)}
              className="w-full py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/20 text-rose-400 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all active:scale-95 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
              <span>Limpiar mi historial y marcas a cero (Comenzar de nuevo)</span>
            </button>
          )
        )}
      </section>

      {/* App Version & Lifecycle Update */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <RefreshCw className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Estado de la Aplicación
            </h3>
          </div>
          <span className="text-[10px] font-black text-amber-300 bg-amber-500/20 px-2.5 py-0.5 rounded-full border border-amber-500/30">
            {APP_VERSION}
          </span>
        </div>

        {hasUpdateAvailable ? (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-amber-500/10 border border-amber-500/40 space-y-3">
            <div className="flex items-center gap-2 text-amber-300 text-xs font-bold">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>Hay una nueva versión disponible</span>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Toca el botón para aplicar los últimos cambios. Una vez aplicada, este botón desaparecerá.
            </p>
            <button
              onClick={async () => {
                await triggerUpdate();
              }}
              disabled={isAppUpdating}
              className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20"
            >
              <RefreshCw className={`w-4 h-4 ${isAppUpdating ? 'animate-spin' : ''}`} />
              <span>{isAppUpdating ? 'APLICANDO...' : 'APLICAR ACTUALIZACIÓN'}</span>
            </button>
          </div>
        ) : (
          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Tu aplicación está 100% actualizada</span>
            </div>
            <button
              onClick={async () => {
                setCheckMsg('Buscando...');
                const hasNew = await checkUpdatesNow();
                setCheckMsg(hasNew ? '¡Actualizando!' : '¡Al día!');
                scheduleTimeout(() => setCheckMsg(null), 3000);
              }}
              className="text-[11px] font-bold text-slate-300 hover:text-white px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 transition-colors"
            >
              {checkMsg || 'Buscar cambios'}
            </button>
          </div>
        )}

        {confirmManualCacheReset ? (
          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/35 space-y-2.5">
            <p className="text-xs font-bold text-amber-200 leading-relaxed">
              ¿Deseas verificar y recargar la caché de la aplicación? Si tienes una sesión o cambios offline pendientes, la recarga se pospondrá automáticamente para proteger tus datos.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  setConfirmManualCacheReset(false);
                  const res = await forceAppUpdate();
                  if (res?.deferred) {
                    setUpdateDeferredMsg(
                      `Recarga bloqueada para evitar pérdida de datos: ${res.status.reason || 'entrenamiento activo o cola offline pendiente.'}`
                    );
                  }
                }}
                className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black cursor-pointer"
              >
                Confirmar recarga segura
              </button>
              <button
                type="button"
                onClick={() => setConfirmManualCacheReset(false)}
                className="px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setUpdateDeferredMsg(null);
              setConfirmManualCacheReset(true);
            }}
            className="w-full py-2.5 rounded-2xl bg-slate-950 border border-slate-800/80 hover:bg-slate-900 text-slate-400 hover:text-white text-xs font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Limpiar memoria caché manualmente</span>
          </button>
        )}
        {updateDeferredMsg && (
          <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-semibold">
            {updateDeferredMsg}
          </div>
        )}

        {/* Quick Tips for Mobile Users */}
        <details className="text-[11px] text-slate-400 bg-slate-950/60 p-3 rounded-2xl border border-slate-800/80">
          <summary className="cursor-pointer font-bold text-slate-300 hover:text-amber-400 select-none">
            ¿Cómo actualizar si sigue sin aparecer en tu celular?
          </summary>
          <div className="mt-2.5 space-y-2 text-[11px] leading-relaxed text-slate-400 border-t border-slate-800/60 pt-2">
            <div>
              <strong className="text-amber-400 block">📱 En Google Chrome (Android):</strong>
              Toca los 3 puntos arriba a la derecha → <em>Configuración</em> → <em>Privacidad y seguridad</em> → <em>Borrar datos de navegación</em> → Selecciona solo <em>"Imágenes y archivos en caché"</em> y toca Borrar.
            </div>
            <div>
              <strong className="text-amber-400 block">🍏 En Safari (iPhone / iPad):</strong>
              Abre los Ajustes del iPhone → <em>Safari</em> → <em>Avanzado</em> → <em>Datos de sitios web</em> → Busca "lazcakon" y desliza para eliminar.
            </div>
            <div>
              <strong className="text-amber-400 block">📲 Si instalaste la App en Pantalla de Inicio (PWA):</strong>
              Cierra la app completamente deslizándola hacia arriba en la vista de aplicaciones abiertas y vuelve a abrirla con conexión a internet.
            </div>
          </div>
        </details>
      </section>

      {/* Safe Logout button with Pending Sync / Active Workout Protection */}
      <div className="pt-2 space-y-2.5">
        {confirmLogoutWarning ? (
          <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/40 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-slate-200 leading-relaxed space-y-1">
                <strong className="text-amber-300 block">
                  Protección de datos pendientes
                </strong>
                <p>
                  {logoutSafetyStatus?.warningMessage ||
                    'Tienes cambios o una sesión sin sincronizar con la nube.'}
                </p>
                <p className="text-[11px] text-slate-400">
                  Tus registros y cola offline se conservarán seguros en este dispositivo para sincronizarse cuando vuelvas a iniciar sesión con conexión.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setConfirmLogoutWarning(false);
                  onLogout();
                }}
                className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-black cursor-pointer"
              >
                Salir manteniendo cola local
              </button>
              <button
                type="button"
                onClick={() => setConfirmLogoutWarning(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-300 text-xs font-bold cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              if (logoutSafetyStatus?.requiresWarning) {
                setConfirmLogoutWarning(true);
              } else {
                onLogout();
              }
            }}
            className="w-full py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-bold flex items-center justify-center space-x-2 active:scale-95 transition-all cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Cerrar Sesión / Salir a Selección de Cuenta</span>
          </button>
        )}
      </div>
    </div>
  );
};
