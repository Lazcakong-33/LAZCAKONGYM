import React, { useState, useEffect } from 'react';
import { RefreshCw, Download, CheckCircle2, ShieldAlert, X } from 'lucide-react';
import { useAppUpdate, isVersionGreater } from '../hooks/useAppUpdate';
import { APP_BUILD_ID, getAppUpdateSafetyStatus, UpdateSafetyCheck } from '../utils/updateApp';

export const CURRENT_APP_VERSION = APP_BUILD_ID;

export const UpdateBanner: React.FC = () => {
  const {
    hasUpdateAvailable,
    isUpdating,
    currentVersion,
    serverVersion,
    broadcastMessage,
    otaPendingManifest,
    downloadProgress,
    otaStageStatus,
    requiresApkUpdate,
    apkDownloadUrl,
    urgency,
    justInstalledVersion,
    otaError,
    triggerUpdate,
    dismissUpdate,
    dismissInstalledConfirmation,
  } = useAppUpdate();

  const [safetyStatus, setSafetyStatus] = useState<UpdateSafetyCheck>(() =>
    getAppUpdateSafetyStatus()
  );
  const [logoError, setLogoError] = useState(false);

  useEffect(() => {
    const checkSafety = () => {
      setSafetyStatus(getAppUpdateSafetyStatus());
    };
    checkSafety();
    const interval = setInterval(checkSafety, 2500);
    window.addEventListener('storage', checkSafety);
    window.addEventListener('app-update-deferred', checkSafety);
    return () => {
      clearInterval(interval);
      window.removeEventListener('storage', checkSafety);
      window.removeEventListener('app-update-deferred', checkSafety);
    };
  }, []);

  // Post-install confirmation toast banner
  if (!hasUpdateAvailable && justInstalledVersion) {
    const formattedInstalled = justInstalledVersion.startsWith('v')
      ? justInstalledVersion
      : `v${justInstalledVersion}`;
    return (
      <aside
        role="status"
        aria-label="Actualización instalada con éxito"
        className="w-full bg-[#090909] border-b border-[#CCFF00]/45 text-[#F5F5F5] py-3 px-3.5 sm:px-5 shadow-2xl relative z-50"
      >
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#141414] border border-[#CCFF00]/50 p-1 shrink-0 overflow-hidden flex items-center justify-center">
              {!logoError ? (
                <img
                  src="/assets/gorilla_head.png"
                  alt="LAZCAKONG GYM"
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="w-full h-full object-cover rounded-lg"
                />
              ) : (
                <span className="text-xs font-black text-[#CCFF00]">LK</span>
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CheckCircle2 className="w-4 h-4 text-[#CCFF00] shrink-0" />
                <span className="text-xs font-black tracking-tight text-white">
                  Actualización instalada con éxito
                </span>
                <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#171717] text-[#CCFF00] border border-[#303030] tabular-nums">
                  {formattedInstalled}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5 truncate">
                LAZCAKONG GYM ya está ejecutando la última versión compatible sin pérdida de datos.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={dismissInstalledConfirmation}
            aria-label="Cerrar confirmación de actualización"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-[#F5F5F5] text-xs font-bold shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            <span>Continuar</span>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>
    );
  }

  if (!hasUpdateAvailable) return null;

  // Strict Semver safety guard: if server/candidate version is NOT greater than current running version, do not render
  if (serverVersion && !isVersionGreater(serverVersion, currentVersion)) {
    return null;
  }

  const isUpdateBlocked = !safetyStatus.canUpdateSafely && !requiresApkUpdate;
  const displayVersion = serverVersion
    ? serverVersion.startsWith('v')
      ? serverVersion
      : `v${serverVersion}`
    : currentVersion;

  const isDownloading =
    !requiresApkUpdate &&
    downloadProgress !== null &&
    (otaStageStatus === 'downloading' || (isUpdating && downloadProgress < 100));

  const progressPct = Math.max(0, Math.min(100, Math.round(downloadProgress ?? 0)));

  return (
    <aside
      role="region"
      aria-label="Notificación de actualización disponible"
      className="w-full bg-[#090909] border-b border-[#CCFF00]/35 text-[#F5F5F5] py-3 px-3.5 sm:px-5 shadow-2xl relative z-50 transition-all"
    >
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
          <div className="w-11 h-11 rounded-xl bg-[#141414] border border-[#CCFF00]/50 p-1 shrink-0 overflow-hidden flex items-center justify-center">
            {!logoError ? (
              <img
                src="/assets/gorilla_head.png"
                alt="LAZCAKONG GYM"
                referrerPolicy="no-referrer"
                onError={() => setLogoError(true)}
                className="w-full h-full object-cover rounded-lg"
              />
            ) : (
              <span className="text-xs font-black text-[#CCFF00]">LK</span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs sm:text-sm font-black tracking-tight text-white">
                ¡Nueva actualización disponible!
              </span>
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#171717] text-[#CCFF00] border border-[#303030] tabular-nums">
                {displayVersion}
              </span>
              <span className="text-[10px] font-semibold text-slate-400">
                {requiresApkUpdate
                  ? 'Requiere APK Release'
                  : urgency === 'critical'
                    ? 'Recomendada'
                    : otaStageStatus === 'ready_to_apply'
                      ? 'Lista para aplicar'
                      : 'OTA automática'}
              </span>
            </div>

            <p className="text-[11px] text-[#F5F5F5]/85 font-medium leading-snug line-clamp-2">
              {requiresApkUpdate
                ? otaPendingManifest?.releaseNotes ||
                  'Incluye mejoras nativas de Android. Descarga la nueva APK oficial conservando tus datos.'
                : isUpdateBlocked
                  ? `${safetyStatus.reason || 'Entrenamiento en curso.'} Descargada en segundo plano; se aplicará al terminar tu entrenamiento.`
                  : otaPendingManifest?.releaseNotes ||
                    broadcastMessage ||
                    'Mejoras de rendimiento, interfaz y estabilidad listas para instalar sin perder tu sesión.'}
            </p>

            {isDownloading && (
              <div className="pt-1 space-y-1">
                <div className="flex items-center justify-between text-[10px] font-mono text-[#CCFF00] tabular-nums">
                  <span>Descargando paquete compatible...</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#1C1C1E] overflow-hidden">
                  <div
                    className="h-full bg-[#CCFF00] transition-all duration-150"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {otaError && (
              <p className="text-[11px] font-semibold text-rose-300 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>{otaError}</span>
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          {requiresApkUpdate ? (
            <a
              href={apkDownloadUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#CCFF00] hover:bg-[#d9ff33] text-[#090909] font-black text-xs shadow-[0_6px_18px_rgba(204,255,0,0.28)] active:scale-95 transition-all flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Descargar APK</span>
            </a>
          ) : !isUpdateBlocked ? (
            <button
              type="button"
              onClick={() => void triggerUpdate()}
              disabled={isUpdating}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#CCFF00] hover:bg-[#d9ff33] text-[#090909] font-black text-xs shadow-[0_6px_18px_rgba(204,255,0,0.28)] active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-75 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? 'Aplicando...' : 'ACTUALIZAR AHORA'}</span>
            </button>
          ) : (
            <span className="min-h-[44px] px-3 py-2 rounded-xl text-[11px] font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span>Al terminar sesión</span>
            </span>
          )}

          <button
            type="button"
            onClick={dismissUpdate}
            disabled={isUpdating}
            aria-label="Posponer actualización"
            className="min-h-[44px] px-3.5 py-2 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-[#F5F5F5]/80 hover:text-white text-xs font-bold transition-colors shrink-0 cursor-pointer"
          >
            Más tarde
          </button>
        </div>
      </div>
    </aside>
  );
};
