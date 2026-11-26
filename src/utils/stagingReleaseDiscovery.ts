import type { OtaManifestPayload } from './otaUpdateEngine';

const REPO = 'Lazcakong-33/LAZCAKONGYM';
const HEX = /^[a-f0-9]{64}$/;
type Asset = { name?: string; browser_download_url?: string; digest?: string };
type Release = { tag_name?: string; prerelease?: boolean; draft?: boolean; body?: string; assets?: Asset[] };
const numbers = (v: string) => /^v?\d+\.\d+\.\d+$/.test(v) ? v.replace(/^v/, '').split('.').map(Number) : null;
export function compareStagingVersions(a: string, b: string): number {
  const x = numbers(a), y = numbers(b);
  if (!x || !y) throw new Error('Versión no válida.');
  for (let i=0; i<3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

export async function readStagingRelease(release: Release): Promise<OtaManifestPayload> {
  const tag = release.tag_name || '';
  const version = tag.match(/^ota-staging-v(\d+\.\d+\.\d+)$/)?.[1];
  if (!version || release.draft || release.prerelease !== true) throw new Error('Release staging no válida.');
  const base = 'https://github.com/' + REPO + '/releases/download/' + tag + '/';
  const filename = 'lazcakongym-ota-' + version + '.zip';
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const zip = assets.find(a => a.name === filename);
  const manifest = assets.find(a => a.name === 'manifest.staging.json');
  if (zip?.browser_download_url !== base + filename || manifest?.browser_download_url !== base + 'manifest.staging.json')
    throw new Error('Archivos de release no coinciden.');
  const digest = zip.digest?.replace(/^sha256:/, '') || '';
  const manifestDigest = manifest.digest?.replace(/^sha256:/, '') || '';
  if (!HEX.test(digest) || !HEX.test(manifestDigest)) throw new Error('Faltan comprobaciones SHA-256.');
  const encoded = release.body?.match(/<!-- LAZCAKONG_STAGING_MANIFEST_BASE64:([A-Za-z0-9+/=]+) -->/)?.[1];
  if (!encoded || encoded.length > 24000) throw new Error('Manifiesto automático no disponible.');
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  if (hash !== manifestDigest) throw new Error('El manifiesto no coincide con el archivo publicado.');
  const m = JSON.parse(new TextDecoder().decode(bytes)) as OtaManifestPayload;
  if (m.channel !== 'staging' || m.version !== version || m.url !== zip.browser_download_url || m.checksum !== digest ||
      m.contentsPolicy !== 'web_assets_only' || m.requiresApkUpdate !== false || m.minNativeVersionCode !== 70000 ||
      m.capacitorMajor !== 8 || m.urgency !== 'optional' || m.buildId !== version + '-ota-' + digest.slice(0,8) ||
      !Array.isArray(m.changedScopes) || m.changedScopes.some(s => !['ui','library','react_ts','assets'].includes(s)) ||
      (m.signature && m.signatureAlgorithm !== 'ed25519') || typeof m.releaseNotes !== 'string' || !m.releaseNotes.trim() || m.releaseNotes.length > 600)
    throw new Error('Manifiesto incompatible o incompleto.');
  return m;
}

export async function discoverStagingRelease(activeVersion: string, fetcher: typeof fetch = fetch): Promise<OtaManifestPayload | null> {
  const response = await fetcher('https://api.github.com/repos/' + REPO + '/releases?per_page=100', {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('GitHub no respondió (' + response.status + ').');
  const list = await response.json() as Release[];
  if (!Array.isArray(list)) throw new Error('Respuesta de GitHub no válida.');
  const candidates = list.filter(r => !r.draft && r.prerelease === true && /^ota-staging-v\d+\.\d+\.\d+$/.test(r.tag_name || ''))
    .sort((a,b) => compareStagingVersions(b.tag_name!.slice(13), a.tag_name!.slice(13)));
  const latest = candidates[0];
  if (!latest || compareStagingVersions(latest.tag_name!.slice(13), activeVersion) <= 0) return null;
  return readStagingRelease(latest);
}
