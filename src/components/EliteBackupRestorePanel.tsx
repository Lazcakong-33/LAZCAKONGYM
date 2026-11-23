import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileJson,
  Lock,
  RotateCcw,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { Profile } from '../types';
import {
  BackupInspectionResult,
  BackupRestoreStrategy,
} from '../utils/eliteBackupEngine';
import { PreImportBackupSnapshot } from '../utils/safeImportPersistence';

export interface EliteBackupRestoreOptions {
  strategy?: BackupRestoreStrategy;
  confirmed: boolean;
  confirmReplaceExplicit?: boolean;
  authorizeCrossProfile?: boolean;
  restorePreferences?: boolean;
}

interface EliteBackupRestorePanelProps {
  activeProfile: Profile;
  onExportBackup: () => { success: boolean; fileName?: string; message?: string } | void;
  onInspectBackup: (json: string) => BackupInspectionResult;
  onImportBackup: (
    json: string,
    options?: EliteBackupRestoreOptions
  ) => { success: boolean; message: string };
  preImportBackup?: PreImportBackupSnapshot | null;
  onRestorePreImportBackup?: () => { success: boolean; message: string };
  currentCounts?: {
    routines: number;
    history: number;
    prs: number;
    bodyWeightLogs: number;
  };
  title?: string;
}

export const EliteBackupRestorePanel: React.FC<EliteBackupRestorePanelProps> = ({
  activeProfile,
  onExportBackup,
  onInspectBackup,
  onImportBackup,
  preImportBackup,
  onRestorePreImportBackup,
  currentCounts,
  title = 'Protección de Datos & Respaldo Elite',
}) => {
  const [rawJsonPending, setRawJsonPending] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string>('');
  const [inspection, setInspection] = useState<BackupInspectionResult | null>(null);

  const [strategy, setStrategy] = useState<BackupRestoreStrategy>('merge_safe');
  const [userConfirmed, setUserConfirmed] = useState(false);
  const [confirmReplaceExplicit, setConfirmReplaceExplicit] = useState(false);
  const [authorizeCrossProfile, setAuthorizeCrossProfile] = useState(false);
  const [restorePreferences, setRestorePreferences] = useState(false);

  const [statusFeedback, setStatusFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [confirmUndoSnapshot, setConfirmUndoSnapshot] = useState(false);

  const handleExportClick = () => {
    const res = onExportBackup();
    if (res && typeof res === 'object') {
      setStatusFeedback({
        type: res.success ? 'success' : 'error',
        text:
          res.message ||
          `Respaldo JSON v2.0.0 descargado (${res.fileName || 'protegido sin PIN ni credenciales'}).`,
      });
    } else {
      setStatusFeedback({
        type: 'success',
        text: `Respaldo JSON de ${activeProfile.name} descargado con verificación de integridad (sin PIN ni credenciales).`,
      });
    }
    setTimeout(() => setStatusFeedback(null), 6000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = typeof ev.target?.result === 'string' ? ev.target.result : '';
      const result = onInspectBackup(content);
      setRawJsonPending(content);
      setPendingFileName(file.name);
      setInspection(result);
      setStrategy('merge_safe');
      setUserConfirmed(false);
      setConfirmReplaceExplicit(false);
      setAuthorizeCrossProfile(false);
      setRestorePreferences(false);
      setStatusFeedback(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const clearPending = () => {
    setRawJsonPending(null);
    setPendingFileName('');
    setInspection(null);
    setUserConfirmed(false);
    setConfirmReplaceExplicit(false);
    setAuthorizeCrossProfile(false);
  };

  const canExecuteRestore =
    Boolean(rawJsonPending) &&
    Boolean(inspection?.valid) &&
    userConfirmed &&
    (!inspection?.crossProfileDetected || authorizeCrossProfile) &&
    (strategy !== 'replace_authorized' || confirmReplaceExplicit);

  const handleExecuteRestore = () => {
    if (!rawJsonPending || !canExecuteRestore) return;
    const res = onImportBackup(rawJsonPending, {
      strategy,
      confirmed: userConfirmed,
      confirmReplaceExplicit,
      authorizeCrossProfile,
      restorePreferences,
    });
    setStatusFeedback({
      type: res.success ? 'success' : 'error',
      text: res.message,
    });
    if (res.success) {
      clearPending();
    }
  };

  return (
    <section className="rounded-3xl p-5 bg-[#171717] border border-[#303030] space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-accent/15 border border-accent/40 flex items-center justify-center shrink-0 text-accent-text">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <span className="text-[10px] font-black uppercase tracking-wider text-accent-text block">
              Schema v2.0.0 · Cero Pérdida de Datos
            </span>
            <h3 className="text-sm font-black text-[#F5F5F5]">{title}</h3>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#090909] border border-[#303030] text-[10px] font-bold text-[#F5F5F5]/80 shrink-0">
          <Lock className="w-3 h-3 text-accent-text" />
          <span>Sin PIN / Secretos</span>
        </span>
      </div>

      <p className="text-xs text-[#F5F5F5]/75 leading-relaxed">
        Descarga un respaldo completo y recuperable en JSON de{' '}
        <strong className="text-[#F5F5F5]">{activeProfile.name}</strong> (rutinas, ejercicios,
        sesiones completadas, PRs, peso corporal, enlaces y preferencias). Nunca exporta PINs,
        contraseñas ni tokens.
      </p>

      {currentCounts && (
        <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
          <div className="p-2 rounded-xl bg-[#090909] border border-[#303030]">
            <div className="text-sm font-black text-accent-text">{currentCounts.routines}</div>
            <div className="text-[9px] text-[#F5F5F5]/60 uppercase">Rutinas</div>
          </div>
          <div className="p-2 rounded-xl bg-[#090909] border border-[#303030]">
            <div className="text-sm font-black text-[#F5F5F5]">{currentCounts.history}</div>
            <div className="text-[9px] text-[#F5F5F5]/60 uppercase">Sesiones</div>
          </div>
          <div className="p-2 rounded-xl bg-[#090909] border border-[#303030]">
            <div className="text-sm font-black text-[#F5F5F5]">{currentCounts.prs}</div>
            <div className="text-[9px] text-[#F5F5F5]/60 uppercase">PRs</div>
          </div>
          <div className="p-2 rounded-xl bg-[#090909] border border-[#303030]">
            <div className="text-sm font-black text-[#F5F5F5]">{currentCounts.bodyWeightLogs}</div>
            <div className="text-[9px] text-[#F5F5F5]/60 uppercase">Peso Corp.</div>
          </div>
        </div>
      )}

      {/* Main Actions: DESCARGAR RESPALDO & RESTAURAR RESPALDO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleExportClick}
          className="py-3 px-4 rounded-2xl bg-accent hover:bg-accent-hover text-accent-contrast text-xs font-black flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>DESCARGAR RESPALDO</span>
        </button>

        <label className="py-3 px-4 rounded-2xl bg-[#090909] hover:bg-[#1f1f1f] border border-[#303030] hover:border-accent/60 text-[#F5F5F5] text-xs font-black flex items-center justify-center gap-2 transition-all active:scale-98 cursor-pointer">
          <Upload className="w-4 h-4 text-accent-text" />
          <span>RESTAURAR RESPALDO</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      </div>

      {/* Inline Feedback Banner */}
      {statusFeedback && (
        <div
          className={`p-3 rounded-2xl text-xs font-bold flex items-start gap-2 border ${
            statusFeedback.type === 'success'
              ? 'bg-accent/10 border-accent/50 text-accent-text'
              : 'bg-rose-500/15 border-rose-500/40 text-rose-200'
          }`}
        >
          {statusFeedback.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span>{statusFeedback.text}</span>
        </div>
      )}

      {/* Pre-Restore Inspection, Diff & Confirmation Modal/Card */}
      {inspection && (
        <div className="p-4 rounded-2xl bg-[#090909] border border-accent/60 space-y-3.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2">
              <FileJson className="w-4 h-4 text-accent-text shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-accent-text">
                  Vista Previa & Validación · {pendingFileName}
                </p>
                <h4 className="text-sm font-black text-[#F5F5F5]">
                  {inspection.valid
                    ? `Respaldo de ${inspection.sourceAthleteName}`
                    : 'Archivo Rechazado'}
                </h4>
              </div>
            </div>
            <button
              type="button"
              onClick={clearPending}
              className="p-1.5 rounded-lg bg-[#171717] border border-[#303030] text-[#F5F5F5]/70 hover:text-white cursor-pointer"
              aria-label="Cerrar vista previa"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {!inspection.valid ? (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200 space-y-1">
              <div className="font-black flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <span>Estado: {inspection.integrityStatus.toUpperCase()}</span>
              </div>
              <p>{inspection.error}</p>
            </div>
          ) : (
            <>
              {/* Integrity & Schema Metadata */}
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
                <span className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] text-accent-text font-bold">
                  {inspection.integrityStatus === 'verified'
                    ? `Integridad OK · v${inspection.schemaVersion}`
                    : `Formato Legacy v${inspection.schemaVersion}`}
                </span>
                <span className="px-2 py-1 rounded-lg bg-[#171717] border border-[#303030] text-[#F5F5F5]/75">
                  Exportado: {new Date(inspection.exportedAt).toLocaleString('es-ES')}
                </span>
              </div>

              {/* Exact Counts Preview: Will Add vs Backup Total */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center font-mono">
                <div className="p-2 rounded-xl bg-[#171717] border border-[#303030]">
                  <div className="text-sm font-black text-accent-text">
                    +{inspection.counts.willAdd.routines}
                  </div>
                  <div className="text-[10px] text-[#F5F5F5]/70">
                    Rutinas ({inspection.counts.backup.routines} en arch.)
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-[#171717] border border-[#303030]">
                  <div className="text-sm font-black text-accent-text">
                    +{inspection.counts.willAdd.history}
                  </div>
                  <div className="text-[10px] text-[#F5F5F5]/70">
                    Sesiones ({inspection.counts.backup.history} en arch.)
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-[#171717] border border-[#303030]">
                  <div className="text-sm font-black text-accent-text">
                    +{inspection.counts.willAdd.prs}
                  </div>
                  <div className="text-[10px] text-[#F5F5F5]/70">
                    PRs ({inspection.counts.backup.prs} en arch.)
                  </div>
                </div>
                <div className="p-2 rounded-xl bg-[#171717] border border-[#303030]">
                  <div className="text-sm font-black text-accent-text">
                    +{inspection.counts.willAdd.bodyWeightLogs}
                  </div>
                  <div className="text-[10px] text-[#F5F5F5]/70">
                    Peso Corp. ({inspection.counts.backup.bodyWeightLogs} en arch.)
                  </div>
                </div>
              </div>

              {/* Conflict / Duplicate Detection Summary */}
              {(inspection.conflicts.collidingWorkoutDates.length > 0 ||
                inspection.conflicts.conflictingRoutineTitles.length > 0 ||
                inspection.conflicts.higherExistingPrKeys.length > 0) && (
                <div className="p-3 rounded-xl bg-[#171717] border border-[#303030] space-y-1.5 text-[11px] text-[#F5F5F5]/85">
                  <div className="font-black text-accent-text uppercase tracking-wider text-[10px]">
                    Detección de Duplicados y Conflictos (Protegidos en Fusión)
                  </div>
                  {inspection.conflicts.collidingWorkoutDates.length > 0 && (
                    <p>
                      • Fechas ya existentes ({inspection.conflicts.collidingWorkoutDates.length}):{' '}
                      {inspection.conflicts.collidingWorkoutDates.slice(0, 5).join(', ')}
                      {inspection.conflicts.collidingWorkoutDates.length > 5 ? '…' : ''} (tus
                      sesiones actuales se conservarán intactas en modo fusión).
                    </p>
                  )}
                  {inspection.conflicts.conflictingRoutineTitles.length > 0 && (
                    <p>
                      • Rutinas ya presentes ({inspection.conflicts.conflictingRoutineTitles.length}
                      ): {inspection.conflicts.conflictingRoutineTitles.slice(0, 4).join(', ')}
                    </p>
                  )}
                  {inspection.conflicts.higherExistingPrKeys.length > 0 && (
                    <p>
                      • Récords PR actuales iguales o superiores (
                      {inspection.conflicts.higherExistingPrKeys.length}): nunca se reducirán.
                    </p>
                  )}
                </div>
              )}

              {/* Cross-Profile Isolation Guard */}
              {inspection.crossProfileDetected && (
                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/50 space-y-2 text-xs text-rose-200">
                  <div className="font-black flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>
                      Perfil Distinto Detectado: este respaldo es de &ldquo;
                      {inspection.sourceAthleteName}&rdquo; ({inspection.sourceProfileId}) y estás
                      en &ldquo;{activeProfile.name}&rdquo; ({activeProfile.id}).
                    </span>
                  </div>
                  <label className="flex items-start gap-2 cursor-pointer text-[11px]">
                    <input
                      type="checkbox"
                      checked={authorizeCrossProfile}
                      onChange={(e) => setAuthorizeCrossProfile(e.target.checked)}
                      style={{ accentColor: 'var(--accent-primary)' }}
                      className="mt-0.5"
                    />
                    <span>
                      Autorizo explícitamente restaurar datos de otro perfil dentro de{' '}
                      {activeProfile.name} (los demás perfiles no se verán afectados).
                    </span>
                  </label>
                </div>
              )}

              {/* Strategy Selection */}
              <div className="space-y-2">
                <label className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-start gap-2.5 text-xs text-[#F5F5F5] cursor-pointer">
                  <input
                    type="radio"
                    name={`restore-mode-${activeProfile.id}`}
                    checked={strategy === 'merge_safe'}
                    onChange={() => {
                      setStrategy('merge_safe');
                      setConfirmReplaceExplicit(false);
                    }}
                    style={{ accentColor: 'var(--accent-primary)' }}
                    className="mt-0.5"
                  />
                  <span>
                    <strong className="text-accent-text">
                      Fusionar sin sobrescribir (Recomendado)
                    </strong>
                    <span className="block text-[11px] text-[#F5F5F5]/65">
                      Conserva 100% tus entrenamientos, rutinas, PRs altos y Mapa Muscular actuales.
                      Solo agrega lo que falta y crea un respaldo automático previo.
                    </span>
                  </span>
                </label>

                <label className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-start gap-2.5 text-xs text-[#F5F5F5] cursor-pointer">
                  <input
                    type="radio"
                    name={`restore-mode-${activeProfile.id}`}
                    checked={strategy === 'replace_authorized'}
                    onChange={() => setStrategy('replace_authorized')}
                    style={{ accentColor: 'var(--accent-primary)' }}
                    className="mt-0.5"
                  />
                  <span>
                    <strong className="text-rose-300">
                      Reemplazar datos completos del perfil actual
                    </strong>
                    <span className="block text-[11px] text-[#F5F5F5]/65">
                      Sustituye rutinas, historial, PRs y peso de {activeProfile.name} con el
                      archivo (guardando respaldo previo por seguridad).
                    </span>
                  </span>
                </label>

                {strategy === 'replace_authorized' && (
                  <label className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/50 flex items-start gap-2 text-xs text-rose-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmReplaceExplicit}
                      onChange={(e) => setConfirmReplaceExplicit(e.target.checked)}
                      style={{ accentColor: 'var(--accent-primary)' }}
                      className="mt-0.5"
                    />
                    <span>
                      Confirmo reemplazar los registros actuales de {activeProfile.name}.
                    </span>
                  </label>
                )}

                <label className="p-2.5 rounded-xl bg-[#171717] border border-[#303030] flex items-start gap-2 text-[11px] text-[#F5F5F5]/80 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={restorePreferences}
                    onChange={(e) => setRestorePreferences(e.target.checked)}
                    style={{ accentColor: 'var(--accent-primary)' }}
                    className="mt-0.5"
                  />
                  <span>
                    Restaurar también preferencias no sensibles (objetivo, días meta, unidad kg/lb,
                    tema visual).
                  </span>
                </label>

                <label className="p-2.5 rounded-xl bg-[#171717] border border-accent/40 flex items-start gap-2 text-xs text-[#F5F5F5] cursor-pointer font-bold">
                  <input
                    type="checkbox"
                    checked={userConfirmed}
                    onChange={(e) => setUserConfirmed(e.target.checked)}
                    style={{ accentColor: 'var(--accent-primary)' }}
                    className="mt-0.5"
                  />
                  <span>
                    He revisado el resumen y autorizo restaurar este respaldo en{' '}
                    {activeProfile.name}.
                  </span>
                </label>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={clearPending}
                  className="px-4 py-2.5 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5]/80 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!canExecuteRestore}
                  onClick={handleExecuteRestore}
                  className="flex-1 py-2.5 rounded-xl bg-accent hover:bg-accent-hover disabled:opacity-40 text-accent-contrast font-black text-xs cursor-pointer"
                >
                  CONFIRMAR RESTAURACIÓN SEGURA
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Pre-Restore / Pre-Import Automatic Recovery Point */}
      {preImportBackup && onRestorePreImportBackup && (
        <div className="p-3.5 rounded-2xl bg-[#090909] border border-[#303030] space-y-2">
          <div className="text-[11px] font-bold text-[#F5F5F5]/85">
            Último punto de recuperación automático:{' '}
            <span className="text-accent-text">
              {preImportBackup.routinesCount} rutinas · {preImportBackup.historyCount} sesiones ·{' '}
              {preImportBackup.prsCount} PRs
            </span>
          </div>
          {confirmUndoSnapshot ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const res = onRestorePreImportBackup();
                  setConfirmUndoSnapshot(false);
                  setStatusFeedback({
                    type: res.success ? 'success' : 'error',
                    text: res.message,
                  });
                }}
                className="px-3 py-1.5 rounded-xl bg-accent text-accent-contrast text-xs font-black cursor-pointer"
              >
                Confirmar reversión
              </button>
              <button
                type="button"
                onClick={() => setConfirmUndoSnapshot(false)}
                className="px-3 py-1.5 rounded-xl bg-[#171717] border border-[#303030] text-xs font-bold text-[#F5F5F5]/75 cursor-pointer"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmUndoSnapshot(true)}
              className="w-full py-2 rounded-xl bg-[#171717] border border-[#303030] hover:border-accent/50 text-accent-text text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Revertir al último punto de recuperación automático</span>
            </button>
          )}
        </div>
      )}
    </section>
  );
};
