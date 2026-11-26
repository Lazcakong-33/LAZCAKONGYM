import React, { useState, useEffect, useCallback } from 'react';
import {
  Rocket,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  Download,
  Smartphone,
  ShieldCheck,
  GitBranch,
} from 'lucide-react';
import { auth } from '../firebase';
import { safeApiFetchJson } from '../utils/safeApiFetch';
import { APP_VERSION } from '../utils/updateApp';
import { discoverStagingRelease, compareStagingVersions } from '../utils/stagingReleaseDiscovery';
import {
  OFFICIAL_GITHUB_RELEASES_URL,
  OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
  type OtaChannel,
  type OtaManifestPayload,
  type OtaUrgency,
} from '../utils/otaUpdateEngine';

interface ChannelStatusEntry {
  enabled: boolean;
  activeManifest: OtaManifestPayload | null;
  history: OtaManifestPayload[];
}

interface TelemetryDeviceRow {
  deviceKey: string;
  uid: string;
  email?: string;
  platform: string;
  channel: OtaChannel;
  installedVersion: string;
  installedBuildId: string;
  nativeVersionCode: number;
  targetVersion?: string;
  status: string;
  errorMessage?: string;
  updatedAt: string;
}

interface AdminOtaStatusResponse {
  success: boolean;
  publishedAppVersion: string;
  supportedCapacitorMajor: number;
  githubRepo: string;
  githubReleasesUrl: string;
  officialReleaseApkUrl: string;
  productionEnvEnabled: boolean;
  channels: Record<OtaChannel, ChannelStatusEntry>;
  telemetrySummary: {
    totalDevices: number;
    updatedCount: number;
    errorCount: number;
    devices: TelemetryDeviceRow[];
    errors: TelemetryDeviceRow[];
  };
}

export const AdminUpdateCenter: React.FC = () => {
  const [statusData, setStatusData] = useState<AdminOtaStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedChannel, setSelectedChannel] = useState<OtaChannel>('staging');
  const [version, setVersion] = useState('7.0.1');
  const [releaseNotes, setReleaseNotes] = useState(
    'Mejoras visuales, optimización de biblioteca y estabilidad.'
  );
  const [urgency, setUrgency] = useState<OtaUrgency>('optional');
  const [requiresApkUpdate, setRequiresApkUpdate] = useState(false);
  const [bundleUrl, setBundleUrl] = useState('');
  const [checksum, setChecksum] = useState('');
  const [signature, setSignature] = useState('');
  const [minNativeVersionCode, setMinNativeVersionCode] = useState('1');

  const [submitting, setSubmitting] = useState(false);
  const [syncingGithub, setSyncingGithub] = useState(false);
  const [stagingCandidate, setStagingCandidate] = useState<OtaManifestPayload | null>(null);
  const [discoveryMsg, setDiscoveryMsg] = useState('Buscando actualización preparada…');
  const [rollingBackBuildId, setRollingBackBuildId] = useState<string | null>(null);
  const [confirmRollbackId, setConfirmRollbackId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(
    null
  );

  const getAdminAuthHeaders = async (): Promise<Record<string, string> | null> => {
    const token = await auth?.currentUser?.getIdToken().catch(() => null);
    if (!token) return null;
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  };

  const fetchOtaStatus = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const headers = await getAdminAuthHeaders();
      if (!headers) {
        setLoadError('Inicia sesión con Google como Administrador Master para gestionar OTA.');
        return;
      }
      const res = await safeApiFetchJson<AdminOtaStatusResponse>('/api/admin/ota/status', {
        method: 'GET',
        headers,
        timeoutMs: 8000,
      });
      if (!res.ok || !res.data?.success) {
        setLoadError(res.error || 'No se pudo consultar el Centro de actualizaciones.');
        return;
      }
      setStatusData(res.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOtaStatus();
  }, [fetchOtaStatus]);

  const discoverNext = useCallback(async (active: string) => {
    setSyncingGithub(true);
    setStagingCandidate(null);
    setDiscoveryMsg('Buscando actualización preparada…');
    try {
      const m = await discoverStagingRelease(active);
      if (!m) {
        setDiscoveryMsg('STAGING está al día. No hay una versión superior disponible.');
        return;
      }
      setSelectedChannel('staging');
      setVersion(m.version);
      setBundleUrl(m.url);
      setChecksum(m.checksum);
      setSignature(m.signature || '');
      setUrgency('optional');
      setRequiresApkUpdate(false);
      setMinNativeVersionCode(String(m.minNativeVersionCode));
      setReleaseNotes(m.releaseNotes!);
      setStagingCandidate(m);
      setDiscoveryMsg('Paquete verificado. Solo falta tu autorización.');
    } catch {
      setDiscoveryMsg('No se pudo verificar la última release de staging. Usa Buscar actualización para reintentar.');
    } finally { setSyncingGithub(false); }
  }, []);
  const stagingActive = statusData?.channels?.staging?.activeManifest?.version || APP_VERSION;
  const stagingStatusReady = Boolean(statusData?.success);
  useEffect(() => {
    if (stagingStatusReady) void discoverNext(stagingActive);
  }, [stagingStatusReady, stagingActive, discoverNext]);

  const handleSyncGithub = async () => {
    if (selectedChannel === 'staging') { await discoverNext(stagingActive); return; }
    setSyncingGithub(true);
    setActionMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      if (!headers) {
        setActionMsg({ type: 'error', text: 'Sesión Google de administrador requerida.' });
        return;
      }
      const res = await safeApiFetchJson<{
        success: boolean;
        tagName?: string;
        releaseUrl?: string;
        apkDownloadUrl?: string;
        otaZipUrl?: string;
        manifest?: OtaManifestPayload | null;
        notes?: string;
        error?: string;
      }>('/api/admin/ota/sync-github', {
        method: 'POST',
        headers,
        body: JSON.stringify({ channel: selectedChannel }),
        timeoutMs: 10000,
      });

      if (!res.ok || !res.data?.success) {
        setActionMsg({
          type: 'error',
          text: res.data?.error || res.error || 'No se encontró release en GitHub.',
        });
        return;
      }

      const { manifest, otaZipUrl, tagName, notes } = res.data;
      if (manifest) {
        setVersion(manifest.version);
        setBundleUrl(manifest.url);
        setChecksum(manifest.checksum);
        setSignature(manifest.signature || '');
        setUrgency(manifest.urgency === 'critical' ? 'critical' : 'optional');
        setRequiresApkUpdate(Boolean(manifest.requiresApkUpdate));
        setMinNativeVersionCode(String(manifest.minNativeVersionCode || 1));
        if (manifest.releaseNotes) setReleaseNotes(manifest.releaseNotes);
        setActionMsg({
          type: 'success',
          text: `Manifiesto ${manifest.version} cargado desde GitHub Release ${tagName || ''}.`,
        });
      } else {
        if (tagName) setVersion(tagName.replace(/^v/i, ''));
        if (otaZipUrl) setBundleUrl(otaZipUrl);
        if (notes) setReleaseNotes(notes.slice(0, 300));
        setActionMsg({
          type: 'success',
          text: `Release ${tagName || 'última'} consultada. Completa el SHA-256 si publicarás ZIP OTA.`,
        });
      }
    } finally {
      setSyncingGithub(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedChannel === 'production' && !statusData?.productionEnvEnabled) {
      setActionMsg({ type: 'error', text: 'Producción permanece bloqueada.' });
      return;
    }
    if (selectedChannel === 'staging' && stagingCandidate) {
      if (compareStagingVersions(stagingCandidate.version, stagingActive) <= 0 ||
          version !== stagingCandidate.version || bundleUrl !== stagingCandidate.url ||
          checksum !== stagingCandidate.checksum || minNativeVersionCode !== String(stagingCandidate.minNativeVersionCode) ||
          requiresApkUpdate || urgency !== 'optional' || signature !== (stagingCandidate.signature || '') ||
          releaseNotes !== stagingCandidate.releaseNotes) {
        setActionMsg({ type: 'error', text: 'Los datos cambiaron. Vuelve a buscar la actualización verificada.' });
        return;
      }
    }
    setSubmitting(true);
    setActionMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      if (!headers) {
        setActionMsg({ type: 'error', text: 'Sesión Google de administrador requerida.' });
        return;
      }
      const res = await safeApiFetchJson<{
        success: boolean;
        manifest?: OtaManifestPayload;
        productionNote?: string;
        error?: string;
      }>('/api/admin/ota/publish', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          channel: selectedChannel,
          ...(selectedChannel === 'staging' && stagingCandidate ? { buildId: stagingCandidate.buildId } : {}),
          version: version.trim(),
          releaseNotes: releaseNotes.trim(),
          urgency,
          requiresApkUpdate,
          url: bundleUrl.trim(),
          checksum: checksum.trim(),
          signature: signature.trim() || undefined,
          minNativeVersionCode: parseInt(minNativeVersionCode, 10) || 1,
          apkDownloadUrl: OFFICIAL_RELEASE_APK_DOWNLOAD_URL,
        }),
        timeoutMs: 8000,
      });

      if (!res.ok || !res.data?.success) {
        setActionMsg({
          type: 'error',
          text: res.data?.error || res.error || 'Error publicando actualización.',
        });
        return;
      }

      setActionMsg({
        type: 'success',
        text:
          res.data.productionNote ||
          `Versión ${res.data.manifest?.version} activada en canal ${selectedChannel}.`,
      });
      await fetchOtaStatus();
    } finally {
      setSubmitting(false);
    }
  };

  const handleRollback = async (targetBuildId: string) => {
    setRollingBackBuildId(targetBuildId);
    setConfirmRollbackId(null);
    setActionMsg(null);
    try {
      const headers = await getAdminAuthHeaders();
      if (!headers) return;
      const res = await safeApiFetchJson<{
        success: boolean;
        message?: string;
        error?: string;
      }>('/api/admin/ota/rollback', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          channel: selectedChannel,
          targetBuildId,
        }),
        timeoutMs: 8000,
      });

      if (!res.ok || !res.data?.success) {
        setActionMsg({
          type: 'error',
          text: res.data?.error || res.error || 'No se pudo revertir la versión.',
        });
        return;
      }
      setActionMsg({
        type: 'success',
        text: res.data.message || 'Versión segura restaurada.',
      });
      await fetchOtaStatus();
    } finally {
      setRollingBackBuildId(null);
    }
  };

  const activeChannelEntry = statusData?.channels?.[selectedChannel];
  const devVersion = statusData?.channels?.development?.activeManifest?.version || APP_VERSION;
  const prodVersion = statusData?.channels?.production?.activeManifest?.version || 'Sin publicar';

  return (
    <section
      data-testid="admin-update-center"
      className="glass-panel rounded-3xl p-5 border border-[#CCFF00]/35 space-y-5 bg-[#090909]/95"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#242424] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#141414] border border-[#CCFF00]/40 p-1 shrink-0 overflow-hidden flex items-center justify-center">
            <img
              src="/assets/gorilla_head.png"
              alt="Centro de actualizaciones"
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover rounded-xl"
            />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-black uppercase tracking-wider text-white">
                Centro de actualizaciones
              </h3>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#CCFF00]/15 text-[#CCFF00] border border-[#CCFF00]/30">
                OTA & APK Release
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Control maestro de paquetes OTA compatibles, APK firmada en GitHub Releases, rollback y dispositivos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => void fetchOtaStatus()}
            disabled={loading}
            className="min-h-[40px] px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-xs font-bold text-slate-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Actualizar estado</span>
          </button>
          <a
            href={statusData?.officialReleaseApkUrl || OFFICIAL_RELEASE_APK_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[40px] px-3.5 py-2 rounded-xl bg-[#CCFF00] hover:bg-[#d9ff33] text-[#090909] font-black text-xs flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            <span>APK Release (.apk)</span>
          </a>
        </div>
      </div>

      {loadError && (
        <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/35 text-rose-300 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{loadError}</span>
        </div>
      )}

      {/* Version Overview Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <div className="p-3 rounded-2xl bg-[#121212] border border-[#262626]">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">
            App Publicada
          </span>
          <span className="text-base font-black font-mono text-white tabular-nums mt-0.5 block">
            v{statusData?.publishedAppVersion || APP_VERSION.replace(/^v/i, '')}
          </span>
          <span className="text-[10px] text-slate-400">Capacitor v8 · Android 36</span>
        </div>

        <div className="p-3 rounded-2xl bg-[#121212] border border-[#262626]">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">
            OTA Desarrollo
          </span>
          <span className="text-base font-black font-mono text-[#CCFF00] tabular-nums mt-0.5 block">
            v{String(devVersion).replace(/^v/i, '')}
          </span>
          <span className="text-[10px] text-emerald-400">
            {statusData?.channels?.development?.enabled !== false ? 'Canal activo' : 'Desactivado'}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-[#121212] border border-[#262626]">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">
            OTA Producción
          </span>
          <span className="text-base font-black font-mono text-slate-200 tabular-nums mt-0.5 block">
            {prodVersion === 'Sin publicar' ? prodVersion : `v${String(prodVersion).replace(/^v/i, '')}`}
          </span>
          <span
            className={`text-[10px] font-semibold ${
              statusData?.productionEnvEnabled ? 'text-emerald-400' : 'text-amber-300'
            }`}
          >
            {statusData?.productionEnvEnabled
              ? 'Producción habilitada'
              : 'Fail-closed (desconectada)'}
          </span>
        </div>

        <div className="p-3 rounded-2xl bg-[#121212] border border-[#262626]">
          <span className="text-[10px] font-bold uppercase text-slate-400 block">
            Dispositivos OTA
          </span>
          <span className="text-base font-black font-mono text-white tabular-nums mt-0.5 block">
            {statusData?.telemetrySummary?.updatedCount ?? 0}/
            {statusData?.telemetrySummary?.totalDevices ?? 0}
          </span>
          <span
            className={`text-[10px] font-semibold ${
              (statusData?.telemetrySummary?.errorCount ?? 0) > 0
                ? 'text-rose-400'
                : 'text-slate-400'
            }`}
          >
            {statusData?.telemetrySummary?.errorCount ?? 0} errores reportados
          </span>
        </div>
      </div>

      {/* GitHub Releases Integration Row */}
      <div className="p-3.5 rounded-2xl bg-[#121212] border border-[#262626] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <GitBranch className="w-4 h-4 text-[#CCFF00] mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-bold text-white">
              Flujo GitHub Actions → GitHub Releases (Sin Android Studio)
            </p>
            <p className="text-[11px] text-slate-400">
              Las compilaciones automáticas y APKs Release firmadas con tu certificado original se publican en{' '}
              <span className="font-mono text-slate-300">Lazcakong-33/LAZCAKONGYM</span>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleSyncGithub()}
            disabled={syncingGithub}
            className="min-h-[40px] px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#CCFF00]/35 text-[#CCFF00] text-xs font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingGithub ? 'animate-spin' : ''}`} />
            <span>{syncingGithub ? 'Consultando...' : 'Cargar última release'}</span>
          </button>
          <a
            href={statusData?.githubReleasesUrl || OFFICIAL_GITHUB_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[40px] px-3 py-2 rounded-xl bg-[#171717] hover:bg-[#222222] border border-[#303030] text-slate-200 text-xs font-bold flex items-center gap-1"
          >
            <span>Releases</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      {actionMsg && (
        <div
          className={`p-3 rounded-2xl border text-xs font-bold flex items-center gap-2 ${
            actionMsg.type === 'success'
              ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-300'
              : 'bg-rose-500/15 border-rose-500/35 text-rose-300'
          }`}
        >
          {actionMsg.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          <span>{actionMsg.text}</span>
        </div>
      )}

      {/* Automatic staging discovery: reading a release never activates it. */}
      <div className="p-4 rounded-2xl border border-[#CCFF00]/35 bg-[#121212] space-y-2" data-testid="ota-auto-discovery">
        <h4 className="font-black text-white text-sm">Actualizaciones listas para autorizar</h4>
        <p className="text-xs text-slate-300">{discoveryMsg}</p>
        {stagingCandidate && (
          <div className="space-y-1 text-xs">
            <div className="text-[#CCFF00] font-black">v{stagingActive.replace(/^v/, '')} → v{stagingCandidate.version} · STAGING</div>
            <p className="text-white">{stagingCandidate.releaseNotes}</p>
            <p className="text-slate-300">SHA-256 cotejado con GitHub · {stagingCandidate.signature ? 'Firma incluida (validación del servidor pendiente)' : 'Sin firma Ed25519; solo prueba'}</p>
          </div>
        )}
        <button type="button" disabled={syncingGithub || submitting || !stagingStatusReady} onClick={() => void discoverNext(stagingActive)} className="px-3 py-2 border border-[#303030] rounded-xl text-xs font-bold text-white disabled:opacity-50">
          {syncingGithub ? 'Comprobando…' : 'Buscar actualización'}
        </button>
      </div>
      {/* Controlled Publish Form */}
      <form onSubmit={handlePublish} className="p-4 rounded-2xl bg-[#121212] border border-[#262626] space-y-3.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-1.5">
            <Rocket className="w-4 h-4 text-[#CCFF00]" />
            <span>Publicar actualización controlada</span>
          </h4>
          <div className="flex items-center gap-1 bg-[#090909] p-1 rounded-xl border border-[#2A2A2A]">
            {(['development', 'staging', 'production'] as OtaChannel[]).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => { setSelectedChannel(ch); setStagingCandidate(null); }}
                disabled={ch === 'production' && !statusData?.productionEnvEnabled}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase cursor-pointer transition-colors ${
                  selectedChannel === ch
                    ? 'bg-[#CCFF00] text-[#090909] font-black'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Versión Semver *
            </label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="7.0.1"
              className="w-full text-xs font-mono font-bold bg-[#090909] border border-[#303030] rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-[#CCFF00]"
              required
            />
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              Prioridad
            </label>
            <select
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as OtaUrgency)}
              className="w-full text-xs font-bold bg-[#090909] border border-[#303030] rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-[#CCFF00]"
            >
              <option value="optional">Opcional (con Más tarde)</option>
              <option value="critical">Crítica / Recomendada</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
              VersionCode Nativo Mín.
            </label>
            <input
              type="number"
              min="1"
              value={minNativeVersionCode}
              onChange={(e) => setMinNativeVersionCode(e.target.value)}
              className="w-full text-xs font-mono font-bold bg-[#090909] border border-[#303030] rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-[#CCFF00]"
            />
          </div>
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
            Notas de la actualización *
          </label>
          <input
            type="text"
            value={releaseNotes}
            onChange={(e) => setReleaseNotes(e.target.value)}
            placeholder="Describe mejoras de interfaz, biblioteca o correcciones..."
            className="w-full text-xs bg-[#090909] border border-[#303030] rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-[#CCFF00]"
            required
          />
        </div>

        <label className="p-3 rounded-xl bg-[#090909] border border-[#2D2D2D] flex items-start gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={requiresApkUpdate}
            onChange={(e) => setRequiresApkUpdate(e.target.checked)}
            className="mt-0.5 accent-[#CCFF00]"
          />
          <span className="text-xs text-slate-200 leading-snug">
            <strong className="text-white block">
              Incluye cambios nativos Android (plugins, permisos, Java/Gradle o SDK)
            </strong>
            <span className="text-[11px] text-slate-400">
              Bloquea el envío OTA y muestra automáticamente el aviso para descargar la nueva APK Release firmada.
            </span>
          </span>
        </label>

        {!requiresApkUpdate && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                URL HTTPS del paquete OTA (.zip) *
              </label>
              <input
                type="url"
                value={bundleUrl}
                onChange={(e) => setBundleUrl(e.target.value)}
                placeholder="https://github.com/Lazcakong-33/LAZCAKONGYM/releases/download/..."
                className="w-full text-xs font-mono bg-[#090909] border border-[#303030] rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-[#CCFF00]"
                required
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                Checksum SHA-256 (64 hex) *
              </label>
              <input
                type="text"
                value={checksum}
                onChange={(e) => setChecksum(e.target.value)}
                placeholder="64 caracteres hexadecimales del .zip"
                className="w-full text-xs font-mono bg-[#090909] border border-[#303030] rounded-xl px-3 py-2.5 text-white focus:outline-none focus:border-[#CCFF00]"
                required
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-[10px] font-bold uppercase text-slate-400 block mb-1">
                Firma criptográfica Ed25519 (opcional base64)
              </label>
              <input
                type="text"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="Generada automáticamente por package-ota-bundle.mjs si OTA_MANIFEST_PRIVATE_KEY_PEM está configurada"
                className="w-full text-xs font-mono bg-[#090909] border border-[#303030] rounded-xl px-3 py-2 text-white focus:outline-none focus:border-[#CCFF00]"
              />
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || syncingGithub || (selectedChannel === 'production' && !statusData?.productionEnvEnabled) || (selectedChannel === 'staging' && Boolean(stagingCandidate) && compareStagingVersions(stagingCandidate!.version, stagingActive) <= 0)}
          className="w-full min-h-[44px] py-3 rounded-xl bg-[#CCFF00] hover:bg-[#d9ff33] text-[#090909] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>
            {submitting
              ? 'Validando y publicando...'
              : requiresApkUpdate
                ? `Publicar aviso de APK nueva (${selectedChannel})`
                : selectedChannel === 'staging' && stagingCandidate ? `Autorizar actualización ${stagingCandidate.version} (STAGING)` : `Publicar paquete OTA en ${selectedChannel}`}
          </span>
        </button>
      </form>

      {/* Safe Rollback History */}
      <div className="p-4 rounded-2xl bg-[#121212] border border-[#262626] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-1.5">
            <RotateCcw className="w-4 h-4 text-amber-400" />
            <span>Respaldo y reversión segura ({selectedChannel})</span>
          </h4>
          {activeChannelEntry?.activeManifest && (
            <span className="text-[11px] font-mono text-[#CCFF00]">
              Activa: v{activeChannelEntry.activeManifest.version}
            </span>
          )}
        </div>

        {!activeChannelEntry?.history?.length ? (
          <p className="text-xs text-slate-400">
            No hay versiones anteriores en historial de {selectedChannel} todavía. Al publicar una nueva actualización se guardará la anterior aquí para rollback inmediato.
          </p>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {activeChannelEntry.history.map((item) => (
              <div
                key={item.buildId}
                className="p-3 rounded-xl bg-[#090909] border border-[#292929] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black font-mono text-white tabular-nums">
                      v{item.version}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 truncate">
                      {item.buildId}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 truncate">
                    {item.releaseNotes || 'Sin notas'}
                  </p>
                </div>

                {confirmRollbackId === item.buildId ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleRollback(item.buildId)}
                      disabled={rollingBackBuildId === item.buildId}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 text-[#090909] text-[11px] font-black cursor-pointer"
                    >
                      Confirmar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRollbackId(null)}
                      className="px-2.5 py-1.5 rounded-lg bg-[#171717] text-slate-300 text-[11px] font-bold cursor-pointer"
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRollbackId(item.buildId)}
                    className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#171717] hover:bg-[#222222] border border-amber-500/35 text-amber-300 text-[11px] font-bold shrink-0 cursor-pointer"
                  >
                    Restaurar versión
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Device Telemetry & Errors */}
      <div className="p-4 rounded-2xl bg-[#121212] border border-[#262626] space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-black uppercase tracking-wider text-white flex items-center gap-1.5">
            <Smartphone className="w-4 h-4 text-[#CCFF00]" />
            <span>Dispositivos actualizados y registro de errores</span>
          </h4>
          <span className="text-[11px] font-mono text-slate-400 tabular-nums">
            {statusData?.telemetrySummary?.devices?.length || 0} recientes
          </span>
        </div>

        {!statusData?.telemetrySummary?.devices?.length ? (
          <p className="text-xs text-slate-400">
            Aún no hay reportes de dispositivos. Los teléfonos Android y navegadores reportarán su estado al comprobar o instalar actualizaciones.
          </p>
        ) : (
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {statusData.telemetrySummary.devices.map((dev) => {
              const isErr = dev.status === 'error' || dev.status === 'rolled_back';
              return (
                <div
                  key={dev.deviceKey}
                  className={`p-2.5 rounded-xl border text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 ${
                    isErr
                      ? 'bg-rose-500/10 border-rose-500/35'
                      : 'bg-[#090909] border-[#292929]'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-white truncate">
                        {dev.email || dev.uid.slice(0, 10)}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {dev.platform} · {dev.channel} · v{dev.installedVersion}
                      </span>
                    </div>
                    {dev.errorMessage && (
                      <p className="text-[11px] text-rose-300 mt-0.5">{dev.errorMessage}</p>
                    )}
                  </div>
                  <span
                    className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded shrink-0 self-start sm:self-center ${
                      isErr
                        ? 'bg-rose-500/20 text-rose-300'
                        : 'bg-[#CCFF00]/15 text-[#CCFF00]'
                    }`}
                  >
                    {dev.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
