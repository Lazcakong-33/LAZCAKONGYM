export type OtaChannel = 'development' | 'staging' | 'production';

export type OtaChangedScope =
  | 'ui'
  | 'library'
  | 'react_ts'
  | 'assets'
  | 'android_java'
  | 'android_manifest'
  | 'gradle'
  | 'native_plugin'
  | 'keystore'
  | 'ios_swift';

export const FORBIDDEN_OTA_NATIVE_SCOPES: readonly OtaChangedScope[] = [
  'android_java',
  'android_manifest',
  'gradle',
  'native_plugin',
  'keystore',
  'ios_swift',
] as const;

export const DEFAULT_NATIVE_VERSION_CODE = 1;
export const DEFAULT_NATIVE_VERSION_NAME = '1.0';
export const SUPPORTED_CAPACITOR_MAJOR = 8;

export interface OtaManifestPayload {
  version: string;
  buildId: string;
  channel: OtaChannel;
  url: string;
  checksum: string;
  contentsPolicy: 'web_assets_only' | string;
  changedScopes?: OtaChangedScope[];
  requiresApkUpdate?: boolean;
  minNativeVersionCode: number;
  maxNativeVersionCode?: number;
  capacitorMajor: number;
  releaseNotes?: string;
  publishedAt?: string;
}

export interface OtaManifestResponse {
  success: boolean;
  enabled: boolean;
  channel: OtaChannel;
  updateAvailable: boolean;
  manifest: OtaManifestPayload | null;
  reason?: string;
}

export interface OtaValidationResult {
  valid: boolean;
  compatible: boolean;
  requiresApkUpdate: boolean;
  reason?: string;
}

export function evaluateOtaCompatibility(
  manifest: OtaManifestPayload,
  currentNativeVersionCode = DEFAULT_NATIVE_VERSION_CODE
): OtaValidationResult {
  if (manifest.requiresApkUpdate) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: 'Esta versión incluye cambios nativos y requiere actualizar el APK completo.',
    };
  }

  if (manifest.contentsPolicy !== 'web_assets_only') {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: 'Política OTA inválida: solo se permiten recursos web (React/TS/UI/biblioteca/imágenes).',
    };
  }

  const scopes = Array.isArray(manifest.changedScopes) ? manifest.changedScopes : [];
  const forbiddenScope = scopes.find((s) => FORBIDDEN_OTA_NATIVE_SCOPES.includes(s));
  if (forbiddenScope) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: `Cambio nativo prohibido vía OTA (${forbiddenScope}). Requiere compilación de APK.`,
    };
  }

  if (Number(manifest.capacitorMajor) !== SUPPORTED_CAPACITOR_MAJOR) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: `Versión de Capacitor incompatible (${manifest.capacitorMajor}; requerido ${SUPPORTED_CAPACITOR_MAJOR}).`,
    };
  }

  if (Number(manifest.minNativeVersionCode) > currentNativeVersionCode) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: `Requiere APK nativo versión >= ${manifest.minNativeVersionCode} (instalada: ${currentNativeVersionCode}).`,
    };
  }

  if (
    typeof manifest.maxNativeVersionCode === 'number' &&
    manifest.maxNativeVersionCode > 0 &&
    currentNativeVersionCode > manifest.maxNativeVersionCode
  ) {
    return {
      valid: false,
      compatible: false,
      requiresApkUpdate: true,
      reason: 'El paquete OTA no aplica a esta versión nativa instalada.',
    };
  }

  return { valid: true, compatible: true, requiresApkUpdate: false };
}
