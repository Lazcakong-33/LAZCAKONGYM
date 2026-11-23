import React, { useState, useEffect } from 'react';
import { Sparkles, RefreshCw, X, ShieldAlert } from 'lucide-react';
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
    triggerUpdate,
    dismissUpdate,
  } = useAppUpdate();

  const [safetyStatus, setSafetyStatus] = useState<UpdateSafetyCheck>(() =>
    getAppUpdateSafetyStatus()
  );

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

  if (!hasUpdateAvailable) return null;

  // Strict Semver safety guard: if server/candidate version is NOT greater than current running version, do not render
  if (serverVersion && !isVersionGreater(serverVersion, currentVersion)) {
    return null;
  }

  const isUpdateBlocked = !safetyStatus.canUpdateSafely;
  const blockedBadgeText = safetyStatus.hasActiveWorkout
    ? 'Entrenamiento en curso'
    : 'Sincronización pendiente';

  const displayVersion = serverVersion
    ? serverVersion.startsWith('v')
      ? serverVersion
      : `v${serverVersion}`
    : currentVersion;

  return (
    <aside
      role="region"
      aria-label="Notificación de actualización disponible"
      className="w-full bg-[#090909] border-b border-[#303030] text-[#F5F5F5] py-3 px-3.5 sm:px-5 shadow-2xl relative z-50 transition-all"
    >
      <div className="max-w-4xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#171717] border border-accent/40 text-accent-text flex items-center justify-center shrink-0 relative">
            {isUpdateBlocked ? <ShieldAlert className="w-4 h-4 text-amber-400" /> : <Sparkles className="w-4 h-4" />}
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent animate-ping" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-wider text-accent-text">
                {isUpdateBlocked ? 'ACTUALIZACIÓN PENDIENTE' : 'LAZCAKONGYM · NUEVA VERSIÓN DISPONIBLE'}
              </span>
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#171717] text-accent-text border border-[#303030]">
                {displayVersion}
              </span>
            </div>
            <p className="text-[11px] text-[#F5F5F5]/80 font-medium truncate mt-0.5">
              {isUpdateBlocked
                ? `${safetyStatus.reason || 'Trabajo activo en curso.'} La nueva versión se aplicará cuando sea seguro hacerlo.`
                : broadcastMessage || 'Hay mejoras listas para tu aplicación.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!isUpdateBlocked ? (
            <button
              type="button"
              onClick={triggerUpdate}
              disabled={isUpdating}
              className="px-3.5 py-2 rounded-xl bg-accent hover:bg-accent-hover text-accent-contrast font-black text-xs shadow-[0_6px_18px_var(--accent-glow)] active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-75 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isUpdating ? 'animate-spin' : ''}`} />
              <span>{isUpdating ? 'APLICANDO...' : 'ACTUALIZAR AHORA'}</span>
            </button>
          ) : (
            <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/30">
              {blockedBadgeText}
            </span>
          )}
          <button
            type="button"
            onClick={dismissUpdate}
            disabled={isUpdating}
            aria-label="Cerrar aviso de actualización"
            className="px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#202020] border border-[#303030] text-[#F5F5F5]/70 hover:text-white text-xs font-bold transition-colors shrink-0 cursor-pointer"
          >
            {isUpdateBlocked ? 'POSPONER' : 'MÁS TARDE'}
          </button>
        </div>
      </div>
    </aside>
  );
};
