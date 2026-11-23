import React, { useState, useMemo } from 'react';
import {
  Crown,
  Send,
  Search,
  BookOpen,
  CheckCircle2,
  Users,
  Dumbbell,
  ExternalLink,
  Plus,
  FileSpreadsheet,
  Printer,
  Scale,
  TrendingUp,
  BarChart3,
  Calendar,
  Sparkles,
  RefreshCw,
  Cloud,
  Download,
  Upload,
  ShieldCheck,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';
import { Profile, Routine, CompletedWorkout, BodyWeightEntry } from '../types';
import {
  EXERCISE_LIBRARY,
  MUSCLE_GROUPS,
  filterExerciseCatalog,
  getCanonical16GroupLabel,
  resolveCanonical16MuscleGroup,
} from '../data/exerciseLibrary';
import {
  exportToExcel,
  exportToPDF,
  buildGroupedComparativeByDay,
  ComparativeExerciseRow,
  MuscleGroupVolumeRow,
  WeeklyTrendRow,
} from '../utils/exportReport';
import { syncUserDataToFirebase, broadcastAppUpdateToDevices } from '../utils/firebaseSync';
import { APP_VERSION, APP_BUILD_ID } from '../utils/updateApp';
import { purgeAndSanitizeWorkoutHistory } from '../utils/historySanitizer';
import { BackupInspectionResult } from '../utils/eliteBackupEngine';
import { PreImportBackupSnapshot } from '../utils/safeImportPersistence';
import {
  EliteBackupRestoreOptions,
  EliteBackupRestorePanel,
} from '../components/EliteBackupRestorePanel';

interface AdminViewProps {
  activeProfile: Profile;
  profiles: Profile[];
  routines: Routine[];
  history: CompletedWorkout[];
  bodyWeightLogs: BodyWeightEntry[];
  onCreateRoutine: () => void;
  onEditRoutine: (routine: Routine) => void;
  onOpenInstallApk?: () => void;
  onCleanAthleteData?: (profileId: string) => void;
  onDeleteAthlete?: (profileId: string) => void;
  onRefreshAthletes?: () => Promise<{ success: boolean; count: number }>;
  onExportBackup?: () => { success: boolean; fileName?: string; message?: string } | void;
  onInspectBackup?: (json: string) => BackupInspectionResult;
  onImportBackup?: (
    json: string,
    options?: EliteBackupRestoreOptions
  ) => { success: boolean; message: string };
  preImportBackup?: PreImportBackupSnapshot | null;
  onRestorePreImportBackup?: () => { success: boolean; message: string };
  backupCounts?: {
    routines: number;
    history: number;
    prs: number;
    bodyWeightLogs: number;
  };
}

export const AdminView: React.FC<AdminViewProps> = ({
  activeProfile,
  profiles,
  routines,
  history,
  bodyWeightLogs,
  onCreateRoutine,
  onEditRoutine,
  onOpenInstallApk,
  onCleanAthleteData,
  onDeleteAthlete,
  onRefreshAthletes,
  onExportBackup,
  onInspectBackup,
  onImportBackup,
  preImportBackup,
  onRestorePreImportBackup,
  backupCounts,
}) => {
  const [selectedRoutineId, setSelectedRoutineId] = useState(routines[0]?.id || '');
  const [selectedTargetProfileId, setSelectedTargetProfileId] = useState(
    profiles.find((p) => p.id !== activeProfile.id)?.id || profiles[0]?.id || ''
  );
  const [assignmentSuccess, setAssignmentSuccess] = useState<string | null>(null);
  const [isSyncingCloud, setIsSyncingCloud] = useState(false);
  const [cloudRefreshMsg, setCloudRefreshMsg] = useState<string | null>(null);
  const [isBroadcastingUpdate, setIsBroadcastingUpdate] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<string | null>(null);

  // Selected athlete for analytics and export
  const [selectedAthleteId, setSelectedAthleteId] = useState(
    profiles.find((p) => !p.isAdmin)?.id || profiles[0]?.id || ''
  );

  // Exercise library search & muscle filter
  const [searchLibrary, setSearchLibrary] = useState('');
  const [filterMuscle, setFilterMuscle] = useState('Todos');

  const selectedAthlete = profiles.find((p) => p.id === selectedAthleteId) || activeProfile;

  // Retrieve athlete-specific data if available (with automatic deduplication & duration normalization)
  const athleteHistory: CompletedWorkout[] = useMemo(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${selectedAthleteId}_history`);
      if (stored) {
        const parsed = JSON.parse(stored) as CompletedWorkout[];
        const { cleanedHistory } = purgeAndSanitizeWorkoutHistory(
          Array.isArray(parsed) ? parsed : [],
          selectedAthlete?.weightKg || 95
        );
        return cleanedHistory;
      }
    } catch {}
    const { cleanedHistory } = purgeAndSanitizeWorkoutHistory(history, selectedAthlete?.weightKg || 95);
    return cleanedHistory;
  }, [selectedAthleteId, history, selectedAthlete?.weightKg]);

  const athleteBodyWeight: BodyWeightEntry[] = useMemo(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${selectedAthleteId}_bodyweight`);
      if (stored) return JSON.parse(stored) as BodyWeightEntry[];
    } catch {}
    return bodyWeightLogs;
  }, [selectedAthleteId, bodyWeightLogs]);

  const athleteRoutines: Routine[] = useMemo(() => {
    try {
      const stored = localStorage.getItem(`lazcakon_${selectedAthleteId}_routines`);
      if (stored) {
        const parsed = JSON.parse(stored) as Routine[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return routines;
  }, [selectedAthleteId, routines]);

  // Comparative data calculation for export & overview (grouped by Day of the Week)
  const {
    comparativeTable,
    groupedComparativeByDay,
    muscleGroupVolumes,
    weeklyTrends,
    totalVolumeTons,
    totalSessions,
  } = useMemo(() => {
    const finished = athleteHistory.filter((h) => h.isFinished);
    const totalVol = finished.reduce((acc, curr) => acc + (curr.totalVolumeKg || 0), 0);
    const tons = (totalVol / 1000).toFixed(1);

    const { groupedByDay, flatComparativeTable: compTable } = buildGroupedComparativeByDay({
      routines: athleteRoutines,
      history: finished,
    });

    const mGroups: Record<string, number> = { Pierna: 0, Glúteos: 0, Espalda: 0, Pecho: 0, Hombro: 0, Brazos: 0, Core: 0 };
    finished.forEach((w) => {
      w.exercisesSummary?.forEach((ex) => {
        const rawMuscle = ex.muscleGroup || '';
        let cat = 'Pierna';
        if (rawMuscle.includes('Glúteos')) cat = 'Glúteos';
        else if (rawMuscle.includes('Espalda') || rawMuscle.includes('Dorsal')) cat = 'Espalda';
        else if (rawMuscle.includes('Pecho') || rawMuscle.includes('Pectoral')) cat = 'Pecho';
        else if (rawMuscle.includes('Hombro')) cat = 'Hombro';
        else if (rawMuscle.includes('Bíceps') || rawMuscle.includes('Tríceps')) cat = 'Brazos';
        else if (rawMuscle.includes('Core')) cat = 'Core';

        const vol = ex.volumeKg || (ex.maxWeight * ex.maxReps * ex.sets);
        mGroups[cat] = (mGroups[cat] || 0) + vol;
      });
    });

    const muscleRows: MuscleGroupVolumeRow[] = Object.entries(mGroups).map(([name, volume]) => ({
      name,
      volume,
      sharePct: totalVol > 0 ? Math.round((volume / totalVol) * 100) : 0,
    }));

    const weeks: WeeklyTrendRow[] = [];
    const chunks = 4;
    const len = finished.length;
    for (let i = 0; i < chunks; i++) {
      const startIdx = Math.floor((i * len) / chunks);
      const endIdx = Math.floor(((i + 1) * len) / chunks);
      const slice = finished.slice(startIdx, endIdx);
      const vol = slice.reduce((acc, curr) => acc + (curr.totalVolumeKg || 0), 0);
      weeks.push({
        label: `Semana ${i + 1}`,
        volumeTons: Number((vol / 1000).toFixed(2)),
        workoutsCount: slice.length,
      });
    }

    return {
      comparativeTable: compTable,
      groupedComparativeByDay: groupedByDay,
      muscleGroupVolumes: muscleRows,
      weeklyTrends: weeks,
      totalVolumeTons: tons,
      totalSessions: finished.length,
    };
  }, [athleteHistory, athleteRoutines]);

  // Recharts Data 1: Body Weight Trends Over Time
  const rechartsWeightData = useMemo(() => {
    return [...athleteBodyWeight]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((item) => ({
        fecha: new Date(item.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
        peso: item.weightKg,
        grasa: item.bodyFatPct || undefined,
        nota: item.note || '',
      }));
  }, [athleteBodyWeight]);

  // Recharts Data 2: Total Volume Lifted across Training Weeks
  const rechartsVolumeData = useMemo(() => {
    return weeklyTrends.map((w) => ({
      semana: w.label,
      volumenTons: w.volumeTons,
      volumenKg: Math.round(w.volumeTons * 1000),
      sesiones: w.workoutsCount,
    }));
  }, [weeklyTrends]);

  // Export handlers
  const handleAdminExportExcel = () => {
    exportToExcel({
      athlete: selectedAthlete,
      adminName: activeProfile.name || 'Camilo Lazcano',
      comparativeTable,
      groupedComparativeByDay,
      muscleGroupVolumes,
      weeklyTrends,
      history: athleteHistory,
      bodyWeightLogs: athleteBodyWeight,
      totalVolumeTons,
      totalSessions,
    });
  };

  const handleExportLibrary = () => {
    const groupedData: Record<string, Array<{ Nombre: string; Músculo: string; Equipamiento: string }>> = {};

    EXERCISE_LIBRARY.forEach((ex) => {
      const muscle = getCanonical16GroupLabel(resolveCanonical16MuscleGroup(ex)) || ex.muscleGroup || 'Sin Músculo';
      if (!groupedData[muscle]) groupedData[muscle] = [];
      groupedData[muscle].push({
        Nombre: ex.name,
        Músculo: muscle,
        Equipamiento: ex.equipment || 'Peso corporal',
      });
    });

    const workbook = XLSX.utils.book_new();

    Object.keys(groupedData)
      .sort()
      .forEach((muscle) => {
        const exercises = groupedData[muscle];
        if (exercises.length > 0) {
          const worksheet = XLSX.utils.json_to_sheet(exercises);
          XLSX.utils.book_append_sheet(workbook, worksheet, muscle.substring(0, 31));
        }
      });

    XLSX.writeFile(workbook, 'Biblioteca_Ejercicios.xlsx');
  };

  const handleAdminExportPDF = () => {
    exportToPDF({
      athlete: selectedAthlete,
      adminName: activeProfile.name || 'Camilo Lazcano',
      comparativeTable,
      groupedComparativeByDay,
      muscleGroupVolumes,
      weeklyTrends,
      history: athleteHistory,
      bodyWeightLogs: athleteBodyWeight,
      totalVolumeTons,
      totalSessions,
    });
  };

  // Routine assignment
  const handleAssign = () => {
    const routine = routines.find((r) => r.id === selectedRoutineId);
    const target = profiles.find((p) => p.id === selectedTargetProfileId);
    if (!routine || !target) return;

    try {
      const existingRoutinesKey = `lazcakon_${target.id}_routines`;
      const currentRaw = localStorage.getItem(existingRoutinesKey);
      let list: Routine[] = currentRaw ? JSON.parse(currentRaw) : [];
      const idx = list.findIndex((r) => r.id === routine.id);
      if (idx !== -1) {
        list[idx] = routine;
      } else {
        list.push(routine);
      }
      localStorage.setItem(existingRoutinesKey, JSON.stringify(list));

      // Push updated routines to Cloud Firestore for this athlete
      syncUserDataToFirebase(target.id, { routines: list }).catch((err) => {
        console.warn('Error syncing assigned routine to cloud:', err);
      });

      setAssignmentSuccess(`¡Rutina "${routine.title}" asignada y sincronizada en la nube para ${target.name}!`);
      setTimeout(() => setAssignmentSuccess(null), 4000);
    } catch {
      setAssignmentSuccess('Error al asignar la rutina.');
    }
  };

  const filteredLibrary = filterExerciseCatalog(EXERCISE_LIBRARY, {
    muscle: filterMuscle,
    searchQuery: searchLibrary,
  });

  return (
    <div className="space-y-6 pb-24 animate-in fade-in duration-300">
      {/* Admin Header Banner */}
      <div className="glass-card rounded-3xl p-5 border border-amber-500/50 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-44 h-44 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-3.5">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 flex items-center justify-center font-black shadow-lg shadow-amber-500/30">
              <Crown className="w-7 h-7 fill-slate-950" />
            </div>
            <div>
              <div className="flex items-center space-x-1.5">
                <span className="text-[10px] font-black uppercase tracking-wider text-amber-400">
                  Panel Maestro
                </span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                  Camilo Lazcano (Admin)
                </span>
              </div>
              <h2 className="text-xl font-black text-white">{activeProfile.name}</h2>
              <p className="text-xs text-slate-400">
                Visualización de progresión con Recharts, exportación ejecutiva y Catálogo Técnico LazcaKong Elite
              </p>
            </div>
          </div>

          {/* Athlete Selector for Analytics & Export */}
          <div className="bg-slate-950 p-2 rounded-2xl border border-slate-800 flex items-center space-x-2">
            <Users className="w-4 h-4 text-amber-400" />
            <div className="text-left">
              <label className="text-[9px] uppercase font-bold text-slate-400 block">
                Atleta en Análisis:
              </label>
              <select
                value={selectedAthleteId}
                onChange={(e) => setSelectedAthleteId(e.target.value)}
                className="text-xs font-bold bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1 text-white focus:outline-none focus:border-amber-400 cursor-pointer"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.avatar} {p.name} {p.isAdmin ? '(Admin)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Live Mobile Update Broadcast Card */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-emerald-500/15 via-slate-900 to-amber-500/15 border border-emerald-500/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h4 className="text-sm font-black text-white flex items-center gap-2">
              Enviar Banner de Actualización a Todos los Celulares
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                {APP_VERSION} · En Tiempo Real
              </span>
            </h4>
            <p className="text-xs text-slate-300">
              Fuerza la aparición inmediata del banner superior de actualización en todos los celulares Android y iPhone conectados.
            </p>
            {broadcastFeedback && (
              <p className="text-xs font-bold text-emerald-400 mt-1 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{broadcastFeedback}</span>
              </p>
            )}
          </div>
        </div>
        <button
          onClick={async () => {
            setIsBroadcastingUpdate(true);
            setBroadcastFeedback(null);
            // Clear local acknowledgement too so Admin also sees the banner immediately
            try {
              localStorage.removeItem('lazcakon_ack_broadcast_id');
              localStorage.removeItem('lazcakongym_dismissed_update');
              localStorage.removeItem('lazcakon_installed_build_id');
            } catch {}
            const res = await broadcastAppUpdateToDevices(
              APP_VERSION,
              APP_BUILD_ID,
              'Muro de Pago Seguro & Nuevo Mapa Muscular 360° · Toca para actualizar'
            );
            setIsBroadcastingUpdate(false);
            window.dispatchEvent(new CustomEvent('app-update-available'));
            setBroadcastFeedback(
              res.success
                ? '¡Banner enviado en vivo a todos los celulares conectados!'
                : '¡Banner activado en este dispositivo!'
            );
            setTimeout(() => setBroadcastFeedback(null), 5000);
          }}
          disabled={isBroadcastingUpdate}
          className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-slate-950 font-black text-xs shadow-md shadow-emerald-500/20 transition-all active:scale-95 flex items-center justify-center gap-2 shrink-0 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${isBroadcastingUpdate ? 'animate-spin' : ''}`} />
          <span>{isBroadcastingUpdate ? 'Enviando a celulares...' : 'Enviar Actualización a Celulares'}</span>
        </button>
      </div>

      {/* Quick Single-Use Invite & APK Bar for Coach */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-slate-900 to-emerald-500/15 border border-amber-500/35 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center shrink-0">
            <Users className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h4 className="text-sm font-black text-white flex items-center gap-2">
              Enlaces de Invitación de 1 Solo Uso
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30">
                Solo Admin · Intransferibles
              </span>
            </h4>
            <p className="text-xs text-slate-300">
              Genera enlaces únicos por WhatsApp o QR que caducan automáticamente tras 1 solo uso para que no puedan transferirse a otras personas.
            </p>
          </div>
        </div>
        {onOpenInstallApk && (
          <button
            onClick={onOpenInstallApk}
            className="w-full sm:w-auto px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black text-xs shadow-md shadow-amber-500/20 transition-all active:scale-95 flex items-center justify-center gap-2 shrink-0"
          >
            <Users className="w-4 h-4" />
            <span>Generar Enlace 1 Uso / QR</span>
          </button>
        )}
      </div>

      {/* Registered Athletes Directory Card */}
      <div className="glass-card rounded-3xl p-5 border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black uppercase tracking-wider text-white">
                  Atletas Registrados en el Sistema ({profiles.length})
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30 flex items-center gap-1">
                  <Cloud className="w-3 h-3 text-emerald-400" />
                  <span>Nube Activa</span>
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Sincronizado en tiempo real con Cloud Firestore ({profiles.length} atletas vinculados)
              </p>
            </div>
          </div>

          {onRefreshAthletes && (
            <button
              onClick={async () => {
                setIsSyncingCloud(true);
                const res = await onRefreshAthletes();
                setIsSyncingCloud(false);
                setCloudRefreshMsg(res.success ? `¡Actualizado! (${res.count} atletas en la nube)` : 'Error al conectar');
                setTimeout(() => setCloudRefreshMsg(null), 3500);
              }}
              disabled={isSyncingCloud}
              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-bold text-amber-400 flex items-center justify-center gap-2 transition-all active:scale-95 shadow-sm"
              title="Sincronizar y cargar atletas creados en otros celulares o navegadores"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin' : ''}`} />
              <span>{isSyncingCloud ? 'Sincronizando...' : 'Actualizar Atletas'}</span>
            </button>
          )}
        </div>

        {cloudRefreshMsg && (
          <div className="p-2.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-bold text-center animate-in fade-in flex items-center justify-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{cloudRefreshMsg}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profiles.map((p) => (
            <div
              key={p.id}
              onClick={() => setSelectedAthleteId(p.id)}
              className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between group ${
                selectedAthleteId === p.id
                  ? 'bg-amber-500/10 border-amber-500/60 shadow-md shadow-amber-500/10'
                  : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl p-2 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-center">
                  {p.avatar}
                </span>
                <div>
                  <div className="flex items-center space-x-2">
                    <h4 className="text-xs font-black text-white group-hover:text-amber-300 transition-colors">
                      {p.name}
                    </h4>
                    {p.isAdmin ? (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                        Admin
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/30">
                        Atleta
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono mt-0.5">{p.email || 'Sin correo'}</p>
                  <p className="text-[10px] text-slate-500 mt-0.5">Objetivo: {p.goal}</p>
                </div>
              </div>

              <div className="text-right flex flex-col items-end justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 block font-mono">
                    {p.authUid ? (
                      <code className="text-emerald-400">Firebase Auth ✓</code>
                    ) : (
                      <code className="text-amber-400">Pendiente Migrar</code>
                    )}
                  </span>
                  <span className="text-[10px] text-amber-400 font-bold mt-0.5 inline-block group-hover:underline">
                    {selectedAthleteId === p.id ? 'Seleccionado ⚡' : 'Ver análisis →'}
                  </span>
                </div>

                {!p.isAdmin && (
                  <div className="flex items-center gap-1.5 mt-2">
                    {onCleanAthleteData && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm(
                              `¿Limpiar completamente todos los entrenamientos, marcas y datos de ${p.name}? Empezará desde cero.`
                            )
                          ) {
                            onCleanAthleteData(p.id);
                            setCloudRefreshMsg(`¡Datos del atleta ${p.name} limpiados correctamente!`);
                            setTimeout(() => setCloudRefreshMsg(null), 4000);
                          }
                        }}
                        className="py-1 px-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] font-bold active:scale-95 transition-all shadow-sm"
                        title="Reiniciar historial y marcas a cero"
                      >
                        Limpiar Datos 🧹
                      </button>
                    )}

                    {onDeleteAthlete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            confirm(
                              `⚠️ ¿ELIMINAR ATLETA DEFINITIVAMENTE?\n\n¿Estás seguro de que deseas eliminar permanentemente a ${p.name} (${p.email})?\n\nEsta acción borrará al atleta de Cloud Firestore y DESAPARECERÁ DE TODOS LOS DISPOSITIVOS de inmediato.`
                            )
                          ) {
                            onDeleteAthlete(p.id);
                          }
                        }}
                        className="py-1 px-2.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-400 border border-rose-500/40 text-[10px] font-black active:scale-95 transition-all shadow-sm flex items-center gap-1"
                        title="Eliminar este atleta de todos los dispositivos permanentemente"
                      >
                        <span>Eliminar</span>
                        <span>🗑️</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RECHARTS SECTION: ATHLETE PROGRESSION VISUALIZATION */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Progresión del Atleta ({selectedAthlete.name})
              </h3>
              <p className="text-[11px] text-slate-400">
                Gráficas interactivas con Recharts: evolución de peso corporal y volumen semanal
              </p>
            </div>
          </div>
        </div>

        {/* Charts Grid: Side-by-Side or Stacked */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chart 1: Line Chart - Body Weight Trends over Time */}
          <div className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Scale className="w-4 h-4 text-purple-400" />
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">
                  Tendencia de Peso Corporal (kg)
                </h4>
              </div>
              <span className="text-[11px] font-mono text-purple-400 font-bold bg-purple-500/10 px-2 py-0.5 rounded-lg border border-purple-500/20">
                Último: {rechartsWeightData[rechartsWeightData.length - 1]?.peso || selectedAthlete.weightKg || '80.8'} kg
              </span>
            </div>

            <div className="w-full h-64 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rechartsWeightData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="fecha"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                  />
                  <YAxis
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                    domain={['dataMin - 1.5', 'dataMax + 1.5']}
                    unit="kg"
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="p-2.5 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl text-xs space-y-1">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">
                              {data.fecha}
                            </span>
                            <div className="text-purple-400 font-mono font-black text-sm">
                              {data.peso} kg
                            </div>
                            {data.grasa && (
                              <div className="text-[10px] text-cyan-400 font-semibold font-mono">
                                Grasa: {data.grasa}%
                              </div>
                            )}
                            {data.nota && (
                              <div className="text-[9px] text-slate-400 italic">
                                {data.nota}
                              </div>
                            )}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                  <Line
                    type="monotone"
                    dataKey="peso"
                    name="Peso Corporal (kg)"
                    stroke="#a855f7"
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#a855f7', strokeWidth: 2, stroke: '#090d16' }}
                    activeDot={{ r: 6, fill: '#f59e0b', strokeWidth: 2, stroke: '#ffffff' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Bar Chart - Total Volume Lifted across Training Weeks */}
          <div className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-200">
                  Volumen Levantado por Semana (Toneladas)
                </h4>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                Total: {totalVolumeTons} t
              </span>
            </div>

            <div className="w-full h-64 pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rechartsVolumeData} margin={{ top: 10, right: 15, left: -15, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis
                    dataKey="semana"
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                  />
                  <YAxis
                    stroke="#64748b"
                    tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 600 }}
                    unit="t"
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        return (
                          <div className="p-2.5 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl text-xs space-y-1">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block">
                              {data.semana}
                            </span>
                            <div className="text-emerald-400 font-mono font-black text-sm">
                              {data.volumenTons} toneladas
                            </div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              ({data.volumenKg.toLocaleString()} kg levantados)
                            </div>
                            <div className="text-[10px] text-cyan-400 font-bold">
                              {data.sesiones} sesiones completadas
                            </div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
                  <Bar
                    dataKey="volumenTons"
                    name="Volumen (Toneladas)"
                    fill="#10b981"
                    radius={[8, 8, 0, 0]}
                  >
                    {rechartsVolumeData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === rechartsVolumeData.length - 1 ? '#06b6d4' : '#10b981'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>

      {/* EXPORTACIÓN DE INFORMES EN EXCEL Y PDF */}
      <section className="glass-panel rounded-3xl p-5 border border-emerald-500/40 space-y-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-white">
                Centro de Descarga de Informes (Excel & PDF)
              </h3>
              <p className="text-[11px] text-slate-400">
                Genera los reportes ejecutivos de progreso con cuadro comparativo, volumen y marcas
              </p>
            </div>
          </div>
          <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
            Exportación Oficial
          </span>
        </div>

        {/* Selected athlete summary badge */}
        <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Atleta Seleccionado:</span>
            <span className="text-xs font-black text-amber-400">{selectedAthlete.avatar} {selectedAthlete.name}</span>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Métricas acumuladas:</span>
            <span className="text-xs font-mono font-bold text-white">{totalVolumeTons} t • {totalSessions} sesiones</span>
          </div>
        </div>

        {/* Download Action Buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            onClick={handleAdminExportExcel}
            className="w-full py-4 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs active:scale-98 shadow-xl shadow-emerald-600/25 transition-all flex items-center justify-center space-x-2"
          >
            <FileSpreadsheet className="w-5 h-5" />
            <span>DESCARGAR INFORME EN EXCEL (.XLSX)</span>
          </button>

          <button
            onClick={handleAdminExportPDF}
            className="w-full py-4 px-4 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs active:scale-98 shadow-xl shadow-amber-500/25 transition-all flex items-center justify-center space-x-2"
          >
            <Printer className="w-5 h-5" />
            <span>GENERAR / IMPRIMIR INFORME EN PDF</span>
          </button>
        </div>
      </section>

      {/* Routine Assignment to Athletes */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-4">
        <div className="flex items-center space-x-2">
          <Send className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Asignar Rutina a un Atleta
          </h3>
        </div>

        {assignmentSuccess && (
          <div className="p-3 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4" />
            <span>{assignmentSuccess}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Seleccionar Rutina
            </label>
            <select
              value={selectedRoutineId}
              onChange={(e) => setSelectedRoutineId(e.target.value)}
              className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-amber-400"
            >
              {routines.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.dayName}: {r.title} ({r.exercises.length} ex)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Atleta Destino
            </label>
            <select
              value={selectedTargetProfileId}
              onChange={(e) => setSelectedTargetProfileId(e.target.value)}
              className="w-full text-xs font-bold bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-amber-400"
            >
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.avatar} {p.name} {p.isAdmin ? '(Admin)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          onClick={handleAssign}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs active:scale-98 shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center space-x-2"
        >
          <Send className="w-4 h-4" />
          <span>ASIGNAR RUTINA AL ATLETA</span>
        </button>
      </section>

      {/* Copias de Seguridad & Restauración Segura */}
      {onExportBackup && onInspectBackup && onImportBackup && (
        <EliteBackupRestorePanel
          activeProfile={activeProfile}
          onExportBackup={onExportBackup}
          onInspectBackup={onInspectBackup}
          onImportBackup={onImportBackup}
          preImportBackup={preImportBackup}
          onRestorePreImportBackup={onRestorePreImportBackup}
          currentCounts={backupCounts}
          title="Copias de Seguridad del Perfil Activo (JSON Seguro)"
        />
      )}

      {/* Master Exercise Library */}
      <section className="glass-panel rounded-3xl p-5 border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <div className="flex items-center space-x-2">
            <BookOpen className="w-4 h-4 text-emerald-400" />
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
                Biblioteca Oficial de Ejercicios LazcaKong Elite ({EXERCISE_LIBRARY.length})
              </h3>
              <span className="text-[10px] text-slate-400">
                Catálogo Técnico Biomecánico · 16 grupos musculares y 9 categorías de equipo
              </span>
            </div>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 self-start sm:self-auto">
            {filteredLibrary.length} ejercicios encontrados
          </span>
          <button
            onClick={handleExportLibrary}
            className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all"
          >
            <Download className="w-3 h-3" />
            <span>Exportar Excel</span>
          </button>
        </div>

        {/* Search & Muscle Filters */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            placeholder="Buscar por nombre, músculo o equipamiento..."
            value={searchLibrary}
            onChange={(e) => setSearchLibrary(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-950 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-amber-400"
          />
        </div>

        {/* Category buttons */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 scrollbar-none">
          {MUSCLE_GROUPS.map((m) => (
            <button
              key={m}
              onClick={() => setFilterMuscle(m)}
              className={`text-[10px] font-bold px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors ${
                filterMuscle === m
                  ? 'bg-amber-500 text-slate-950'
                  : 'bg-slate-900 text-slate-400 hover:text-white'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Exercises list */}
        <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
          {filteredLibrary.slice(0, 50).map((ex) => {
            const directResource = ex.url && !/smartworkout\.app/i.test(ex.url) ? ex.url : null;
            return (
              <div
                key={ex.id}
                className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between hover:border-slate-700 transition-colors"
              >
                <div>
                  <h5 className="text-xs font-bold text-white">{ex.name}</h5>
                  <div className="flex items-center space-x-2 mt-0.5">
                    <span className="text-[10px] text-amber-400 font-semibold">
                      {getCanonical16GroupLabel(resolveCanonical16MuscleGroup(ex))}
                    </span>
                    <span className="text-[9px] text-slate-500 font-mono">
                      {ex.equipment || 'Peso corporal'}
                    </span>
                  </div>
                </div>
                {directResource && (
                  <a
                    href={directResource}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1 text-[11px] font-bold"
                    title="Abrir recurso visual directo"
                  >
                    <span>Ver Técnica</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
