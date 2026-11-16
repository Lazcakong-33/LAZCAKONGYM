import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Profile, RoutineImportMode } from '../types';
import { THEME_CONFIGS, ThemeAccent, applyThemeToRoot } from '../utils/theme';
import { useTheme } from '../context/ThemeContext';
import { AVATAR_OPTIONS, GOAL_OPTIONS } from '../data/defaultProfiles';
import { forceAppUpdate, APP_VERSION } from '../utils/updateApp';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { testWatchAlert } from '../utils/backgroundTimer';
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
  onLinkGoogleAccount?: () => Promise<{ success: boolean; message: string }>;
  onImportCsv?: (result: CsvImportResult | SafeImportPayload) => {
    success: boolean;
    routinesCount: number;
    workoutsCount: number;
    prsCount: number;
    routineNames: string[];
  };
  onNavigateToTab?: (tab: 'hoy' | 'rutinas' | 'activo' | 'progreso' | 'cloud' | 'ejercicios') => void;
  preImportBackup?: PreImportBackupSnapshot | null;
  onRestorePreImportBackup?: () => { success: boolean; message: string };
  backupCounts?: {
    routines: number;
    history: number;
    prs: number;
    bodyWeightLogs: number;
  };
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
  onLinkGoogleAccount,
  onImportCsv,
  onNavigateToTab,
  preImportBackup,
  onRestorePreImportBackup,
  backupCounts,
}) => {
  const { themeAccent, accentHex, setThemeAccent, setThemeByHex } = useTheme();
  const [name, setName] = useState(activeProfile.name || '');
  const [avatar, setAvatar] = useState(activeProfile.avatar || '🦍');
  const [goal, setGoal] = useState(activeProfile.goal || 'Hipertrofia & Masa');
  const [weightKg, setWeightKg] = useState<string | number>(activeProfile.weightKg || '');
  const [heightCm, setHeightCm] = useState<string | number>(activeProfile.heightCm || '');
  const [weeklyTargetDays, setWeeklyTargetDays] = useState(activeProfile.weeklyTargetDays || 5);
  const [soundEnabled, setSoundEnabled] = useState(activeProfile.soundEnabled !== false);
  const [vibrationEnabled, setVibrationEnabled] = useState(activeProfile.vibrationEnabled !== false);
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

  const handleTestWatch = async () => {
    setWatchMsg('Enviando alerta háptica y sonido...');
    const res = await testWatchAlert();
    setWatchMsg(res.message);
    setTimeout(() => {
      setWatchMsg(null);
    }, 6000);
  };

  useEffect(() => {
    setName(activeProfile.name || '');
    setAvatar(activeProfile.avatar || '🦍');
    setGoal(activeProfile.goal || 'Hipertrofia & Masa');
    setWeightKg(activeProfile.weightKg || '');
    setHeightCm(activeProfile.heightCm || '');
    setWeeklyTargetDays(activeProfile.weeklyTargetDays || 5);
    setSoundEnabled(activeProfile.soundEnabled !== false);
    setVibrationEnabled(activeProfile.vibrationEnabled !== false);
    setWeightUnit(activeProfile.weightUnit || 'kg');
  }, [activeProfile]);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    onUpdateProfile({
      name: name.trim(),
      avatar,
      goal,
      weightKg: weightKg === '' ? undefined : Number(weightKg),
      heightCm: heightCm === '' ? undefined : Number(heightCm),
      weeklyTargetDays: Number(weeklyTargetDays),
      soundEnabled,
      vibrationEnabled,
      weightUnit,
      themeAccent,
    });

    setFeedbackMsg('¡Perfil actualizado con éxito!');
    setTimeout(() => setFeedbackMsg(null), 3500);
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
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-900 border border-slate-800 cursor-pointer">
            <div className="flex items-center space-x-2.5">
              <Volume2 className="w-4 h-4 text-amber-400" />
              <div>
                <span className="text-xs font-bold text-white block">Sonidos de Entrenamiento</span>
                <span className="text-[10px] text-slate-400">
                  Beeps al completar series y alarma de descanso
                </span>
              </div>
            </div>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
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
              onChange={(e) => setVibrationEnabled(e.target.checked)}
              className="w-4 h-4 accent-amber-500 rounded"
            />
          </label>
        </div>

        {/* Cyberpunk Theme Accent Selector */}
        <div className="pt-2 border-t border-slate-800 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <label
              style={{ color: 'var(--theme-primary)' }}
              className="text-[10px] font-black uppercase block flex items-center gap-1.5 transition-colors duration-300"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Acento Lumínico Cyberpunk (Tema Visual de la PWA)</span>
            </label>
            <span
              style={{
                backgroundColor: 'var(--theme-soft-bg)',
                borderColor: 'var(--theme-border-soft)',
                color: 'var(--theme-primary)',
              }}
              className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg border transition-colors duration-300"
            >
              {accentHex}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.entries(THEME_CONFIGS) as [ThemeAccent, typeof THEME_CONFIGS[ThemeAccent]][]).map(([key, config]) => {
              const isSelected = themeAccent === key || accentHex.toLowerCase() === config.primary.toLowerCase();
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    // 1. Captura el código hexadecimal y el identificador del tema seleccionado
                    setThemeByHex(config.primary);
                    setThemeAccent(key);
                    // 2. Actualiza el estado global del perfil y las variables CSS del DOM (:root)
                    onUpdateProfile({ themeAccent: key });
                    applyThemeToRoot(key);
                  }}
                  className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 active:scale-95 cursor-pointer ${
                    isSelected
                      ? 'bg-slate-900 border-2 shadow-lg'
                      : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                  }`}
                  style={{
                    borderColor: isSelected ? config.primary : undefined,
                    boxShadow: isSelected ? `0 0 15px ${config.glow}` : undefined,
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className="w-4 h-4 rounded-full shadow-md"
                      style={{ backgroundColor: config.primary }}
                    />
                    {isSelected && (
                      <span
                        className="text-[10px] font-black px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: `${config.primary}25`, color: config.primary }}
                      >
                        ACTIVO
                      </span>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-bold text-white truncate">{config.name}</div>
                    <div className="text-[10px] font-mono" style={{ color: isSelected ? config.primary : '#94a3b8' }}>
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
          style={{
            backgroundColor: 'var(--theme-primary)',
            boxShadow: `0 8px 20px -4px var(--theme-glow)`,
          }}
          className="w-full py-3.5 rounded-2xl text-slate-950 font-black text-xs active:scale-98 transition-all flex items-center justify-center space-x-2 hover:opacity-95 cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>GUARDAR CAMBIOS DE PERFIL</span>
        </button>
      </form>

      {/* Smartwatch & Honor Watch Vibración y Alarma */}
      <section className="glass-panel rounded-3xl p-5 border border-amber-500/40 bg-gradient-to-br from-[#121927] to-[#0c121e] space-y-4 shadow-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-white">
                Reloj Inteligente / Honor Watch Fit
              </h3>
              <p className="text-[11px] text-amber-400/90 font-medium">
                Vibración háptica y avisos en tu muñeca al terminar descanso
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          Para que tu <strong>Honor Watch</strong> vibre cada vez que finaliza tu descanso:
        </p>

        <div className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-300 space-y-2">
          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">1</span>
            <span>Abre la app <strong>Honor Salud</strong> (o Salud) en tu celular.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">2</span>
            <span>Ve a <strong>Dispositivos &gt; tu Honor Watch &gt; Notificaciones</strong>.</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">3</span>
            <span>Activa la casilla de <strong>Google Chrome</strong> (o <strong>LAZCAKONGYM</strong>).</span>
          </div>
        </div>

        {watchMsg && (
          <div className="p-3 rounded-2xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold text-center animate-in fade-in">
            {watchMsg}
          </div>
        )}

        <div className="space-y-2">
          <button
            type="button"
            onClick={handleTestWatch}
            className="w-full py-3 px-4 rounded-2xl bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-400 hover:to-orange-400 text-slate-950 font-black text-xs active:scale-95 shadow-md shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
          >
            <Volume2 className="w-4 h-4" />
            <span>PROBAR ALERTA INMEDIATA EN RELOJ</span>
          </button>

          {onStartRestTimer && (
            <button
              type="button"
              onClick={async () => {
                if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted') {
                  await Notification.requestPermission();
                }
                onStartRestTimer(10, 'Prueba Reloj con Pantalla Bloqueada');
                setWatchMsg(
                  '⏱️ ¡Temporizador de 10s iniciado! BLOQUEA TU TELÉFONO AHORA: vibrará a los 5s y a los 0s.'
                );
                setTimeout(() => setWatchMsg(null), 11000);
              }}
              className="w-full py-3 px-4 rounded-2xl bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-400 font-bold text-xs active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Smartphone className="w-4 h-4" />
              <span>PROBAR CON TELÉFONO BLOQUEADO (10 SEG)</span>
            </button>
          )}
        </div>
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

      {/* Firebase Cloud Sync */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Cloud className="w-4 h-4 text-amber-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Sincronización en la Nube
            </h3>
          </div>
          <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
            Cloud Firestore Activo
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Tus rutinas, marcas y registros se guardan localmente en tu celular y pueden respaldarse en tiempo real en Cloud Firestore para consultarlos desde cualquier dispositivo.
        </p>

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
          disabled={syncing}
          className="w-full py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-black text-xs active:scale-98 shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
        >
          <Cloud className="w-4 h-4" />
          <span>{syncing ? 'SINCRONIZANDO...' : 'SINCRONIZAR AHORA CON CLOUD FIRESTORE'}</span>
        </button>

        <div className="pt-2 flex items-center justify-between text-[11px] text-slate-500">
          <span>Servidor seguro · LAZCAKONGYM Cloud</span>
          <span className="font-mono text-emerald-400">
            {activeProfile.authUid ? 'Firebase Auth Activo' : 'Protegido'}
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
          <div className="p-4 rounded-2xl bg-[#090909] border border-[#CCFF00]/50 space-y-3.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#CCFF00]">
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
                <div className="text-base font-black text-[#CCFF00]">
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
                  className="mt-0.5 accent-[#CCFF00]"
                />
                <span>
                  <strong className="text-[#CCFF00]">
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
                  className="mt-0.5 accent-[#CCFF00]"
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
                    className="mt-0.5 accent-[#CCFF00]"
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
                    className="mt-0.5 accent-[#CCFF00]"
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
                className="flex-1 py-2.5 rounded-xl bg-[#CCFF00] hover:bg-[#b8e600] disabled:opacity-40 text-[#090909] font-black text-xs cursor-pointer"
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
                    setTimeout(() => setRestoreFeedbackMsg(null), 4500);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#CCFF00] text-[#090909] text-xs font-black cursor-pointer"
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
                className="w-full py-2 rounded-xl bg-[#090909] border border-[#CCFF00]/40 text-[#CCFF00] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar respaldo previo a la última importación</span>
              </button>
            )}
            {restoreFeedbackMsg && (
              <p className="text-[11px] font-bold text-[#CCFF00]">{restoreFeedbackMsg}</p>
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
          <button
            onClick={() => {
              if (
                confirm(
                  `¿Estás seguro de que deseas limpiar todo tu historial de entrenamientos, marcas PR y registros de peso de ${activeProfile.name}? Comenzarás desde cero.`
                )
              ) {
                onCleanMyData();
                setFeedbackMsg('¡Tu historial y marcas han sido limpiados a cero exitosamente!');
                setTimeout(() => setFeedbackMsg(null), 4000);
              }
            }}
            className="w-full py-2.5 rounded-2xl bg-rose-500/10 border border-rose-500/25 hover:bg-rose-500/20 text-rose-400 text-xs font-bold flex items-center justify-center space-x-1.5 transition-all active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
            <span>Limpiar mi historial y marcas a cero (Comenzar de nuevo)</span>
          </button>
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
                setTimeout(() => setCheckMsg(null), 3000);
              }}
              className="text-[11px] font-bold text-slate-300 hover:text-white px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800 transition-colors"
            >
              {checkMsg || 'Buscar cambios'}
            </button>
          </div>
        )}

        <button
          onClick={async () => {
            setUpdateDeferredMsg(null);
            if (confirm('¿Deseas forzar la limpieza de caché y recargar la aplicación?')) {
              const res = await forceAppUpdate();
              if (res?.deferred) {
                setUpdateDeferredMsg(
                  `Recarga bloqueada para evitar pérdida de datos: ${res.status.reason || 'entrenamiento activo o cola offline pendiente.'}`
                );
              }
            }
          }}
          className="w-full py-2.5 rounded-2xl bg-slate-950 border border-slate-800/80 hover:bg-slate-900 text-slate-400 hover:text-white text-xs font-bold flex items-center justify-center space-x-2 transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Limpiar memoria caché manualmente</span>
        </button>
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

      {/* Logout button */}
      <div className="pt-2">
        <button
          onClick={onLogout}
          className="w-full py-3 rounded-2xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-bold flex items-center justify-center space-x-2 active:scale-95 transition-all"
        >
          <LogOut className="w-4 h-4" />
          <span>Cerrar Sesión / Salir a Selección de Cuenta</span>
        </button>
      </div>
    </div>
  );
};
