import {
  GoogleAuthProvider,
  linkWithCredential,
  linkWithPopup,
  linkWithRedirect,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { auth, firebaseConfig, googleProvider } from '../firebase.ts';
import { detectRuntimePlatform } from './capacitorPlatform.ts';

let socialLoginInitialized = false;

export interface NativeSocialLoginClient {
  initialize: (options: Record<string, any>) => Promise<void>;
  login: (options: { provider: 'google'; options: Record<string, any> }) => Promise<any>;
  logout: (options: { provider: 'google' }) => Promise<void>;
}

export interface NativeAuthDeps {
  detectPlatform?: typeof detectRuntimePlatform;
  loadSocialLogin?: () => Promise<NativeSocialLoginClient>;
  signInWithPopupFn?: typeof signInWithPopup;
  signInWithRedirectFn?: typeof signInWithRedirect;
  linkWithPopupFn?: typeof linkWithPopup;
  linkWithRedirectFn?: typeof linkWithRedirect;
  signInWithCredentialFn?: typeof signInWithCredential;
  linkWithCredentialFn?: typeof linkWithCredential;
  credentialFromIdToken?: (idToken: string) => ReturnType<typeof GoogleAuthProvider.credential>;
}

export function getGoogleWebClientId(): string {
  try {
    const envClientId = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    )?.env?.VITE_GOOGLE_WEB_CLIENT_ID;
    if (envClientId && envClientId.trim()) {
      return envClientId.trim();
    }
  } catch {}

  try {
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem('lazcakon_google_web_client_id');
      if (stored && stored.trim()) return stored.trim();
    }
  } catch {}

  return String((firebaseConfig as { oAuthClientId?: string })?.oAuthClientId || '').trim();
}

export function getGoogleIosClientId(): string | undefined {
  try {
    const envIosClientId = (
      import.meta as unknown as { env?: Record<string, string | undefined> }
    )?.env?.VITE_GOOGLE_IOS_CLIENT_ID;
    if (envIosClientId && envIosClientId.trim()) {
      return envIosClientId.trim();
    }
  } catch {}
  return undefined;
}

export function getGoogleAuthOperationLabel(detectPlatform = detectRuntimePlatform): string {
  return detectPlatform().isCapacitorNative
    ? 'SocialLogin.login(google) -> signInWithCredential'
    : 'signInWithPopup(google)';
}

export function buildNativeGoogleInitializeOptions(params: {
  webClientId: string;
  iOSClientId?: string;
}) {
  return {
    google: {
      webClientId: params.webClientId,
      ...(params.iOSClientId
        ? { iOSClientId: params.iOSClientId, iOSServerClientId: params.webClientId }
        : {}),
      mode: 'online' as const,
      // Firebase Auth only requires Credential Manager's Google idToken.
      // Skipping post-sign-in AuthorizationClient avoids interactive consent resolution
      // or MainActivity modifications on stock Capacitor BridgeActivity.
      skipAuthOnlyAuthorizationAfterSignIn: true,
    },
  };
}

export function buildNativeGoogleLoginOptions() {
  // IMPORTANT: Do NOT pass `scopes` (not even ['profile', 'email']) on stock BridgeActivity.
  // @capgo/capacitor-social-login includes default OIDC profile/email/openid scopes automatically
  // and rejects with "You CANNOT use scopes without modifying the main activity." if `scopes` is set.
  return {
    provider: 'google' as const,
    options: {},
  };
}

async function ensureNativeSocialLoginInitialized(deps?: NativeAuthDeps): Promise<NativeSocialLoginClient> {
  const loadClient =
    deps?.loadSocialLogin ||
    (async () => {
      const { SocialLogin } = await import('@capgo/capacitor-social-login');
      return SocialLogin as unknown as NativeSocialLoginClient;
    });

  const SocialLogin = await loadClient();
  if (!socialLoginInitialized || deps?.loadSocialLogin) {
    const webClientId = getGoogleWebClientId();
    const iOSClientId = getGoogleIosClientId();
    if (!webClientId) {
      const err: any = new Error(
        'Falta configurar el Web Client ID de Google OAuth (VITE_GOOGLE_WEB_CLIENT_ID / firebase-applet-config.json) para Google Sign-In nativo.'
      );
      err.code = 'auth/missing-native-google-client-id';
      throw err;
    }

    await SocialLogin.initialize(
      buildNativeGoogleInitializeOptions({
        webClientId,
        iOSClientId,
      })
    );
    if (!deps?.loadSocialLogin) {
      socialLoginInitialized = true;
    }
  }
  return SocialLogin;
}

export function normalizeNativeGoogleError(err: any): Error {
  const existingCode = String(err?.code || '');
  const raw = String(err?.message || err || '');
  const lower = raw.toLowerCase();

  if (existingCode.startsWith('auth/')) {
    return err instanceof Error ? err : new Error(raw);
  }

  if (
    existingCode.toUpperCase() === 'USER_CANCELLED' ||
    lower.includes('user_cancelled') ||
    lower.includes('cancel') ||
    lower.includes('dismissed') ||
    lower.includes('popup_closed')
  ) {
    const wrapped: any = new Error(raw || 'Inicio de sesión con Google cancelado por el usuario.');
    wrapped.code = 'auth/popup-closed-by-user';
    return wrapped;
  }

  if (lower.includes('cannot use scopes') || lower.includes('modifiedmainactivity')) {
    const wrapped: any = new Error(
      `El plugin nativo rechazó scopes adicionales en Android (${raw}).`
    );
    wrapped.code = 'auth/native-google-scopes-unsupported';
    return wrapped;
  }

  // Credential Manager [16] is NOT proof of a missing SHA. It can also be caused
  // by account reauthentication, OAuth consent/test-user or device account state.
  // Keep the raw technical error out of user-visible strings.
  if (lower.includes('[16]') || lower.includes('account reauth failed')) {
    const wrapped: any = new Error(
      'Google no pudo volver a autenticar la cuenta en Android (código 16). Revisa que esta cuenta esté autorizada en la pantalla de consentimiento OAuth y que la firma SHA-1 del APK corresponda al cliente OAuth Android. Consulta el diagnóstico técnico si persiste.'
    );
    wrapped.code = 'auth/native-google-account-reauth-failed';
    return wrapped;
  }

  if (
    lower.includes('developer_error') ||
    lower.includes('developer console') ||
    lower.includes('28444') ||
    lower.includes('no credentials available') ||
    lower.includes('10:') ||
    lower.includes('sha') ||
    lower.includes('12500')
  ) {
    const wrapped: any = new Error(
      'La configuración Google OAuth de Android no coincide con esta APK. Verifica com.lazcakong.gym, las huellas SHA de la firma instalada y el Web Client ID en el mismo proyecto Google Cloud/Firebase.'
    );
    wrapped.code = 'auth/native-google-config-required';
    return wrapped;
  }

  const wrapped: any = err instanceof Error ? err : new Error(raw || 'Error en Google Sign-In nativo');
  if (!wrapped.code) {
    wrapped.code = 'auth/native-google-login-failed';
  }
  return wrapped;
}

async function getNativeGoogleIdToken(deps?: NativeAuthDeps): Promise<string> {
  try {
    const SocialLogin = await ensureNativeSocialLoginInitialized(deps);
    const loginRes = await SocialLogin.login(buildNativeGoogleLoginOptions());

    const result: any = loginRes?.result;
    const idToken =
      result && result.responseType === 'online' ? String(result.idToken || '').trim() : '';

    if (!idToken) {
      const err: any = new Error(
        'Google Sign-In nativo no devolvió idToken válido para autenticar en Firebase.'
      );
      err.code = 'auth/no-id-token';
      throw err;
    }

    return idToken;
  } catch (err) {
    throw normalizeNativeGoogleError(err);
  }
}

function shouldFallbackToWebRedirect(err: any): boolean {
  const code = String(err?.code || '');
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment'
  );
}

/**
 * Signs into Firebase Auth with Google preserving the exact Firebase UID across
 * Web/PWA (`signInWithPopup` with `signInWithRedirect` fallback if blocked)
 * and Capacitor Android/iOS (`@capgo/capacitor-social-login` -> `signInWithCredential`).
 */
export async function signInWithGoogleHybrid(deps?: NativeAuthDeps): Promise<UserCredential> {
  const detect = deps?.detectPlatform || detectRuntimePlatform;
  const { isCapacitorNative } = detect();
  if (!isCapacitorNative) {
    const popupFn = deps?.signInWithPopupFn || signInWithPopup;
    try {
      return await popupFn(auth, googleProvider);
    } catch (err: any) {
      if (shouldFallbackToWebRedirect(err)) {
        const redirectFn = deps?.signInWithRedirectFn || signInWithRedirect;
        await redirectFn(auth, googleProvider);
        const redirectErr: any = new Error('Redirigiendo a Google para completar el inicio de sesión.');
        redirectErr.code = 'auth/redirect-initiated';
        throw redirectErr;
      }
      throw err;
    }
  }

  const idToken = await getNativeGoogleIdToken(deps);
  const toCredential = deps?.credentialFromIdToken || GoogleAuthProvider.credential;
  const credential = toCredential(idToken);
  const credSignIn = deps?.signInWithCredentialFn || signInWithCredential;
  return await credSignIn(auth, credential);
}

/**
 * Links an existing authenticated user to Google preserving the active Firebase UID across
 * Web/PWA (`linkWithPopup` with `linkWithRedirect` fallback if blocked) and Capacitor native (`linkWithCredential`).
 */
export async function linkWithGoogleHybrid(
  currentUser: User,
  deps?: NativeAuthDeps
): Promise<UserCredential> {
  const detect = deps?.detectPlatform || detectRuntimePlatform;
  const { isCapacitorNative } = detect();
  if (!isCapacitorNative) {
    const linkPopupFn = deps?.linkWithPopupFn || linkWithPopup;
    try {
      return await linkPopupFn(currentUser, googleProvider);
    } catch (err: any) {
      if (shouldFallbackToWebRedirect(err)) {
        const linkRedirectFn = deps?.linkWithRedirectFn || linkWithRedirect;
        await linkRedirectFn(currentUser, googleProvider);
        const redirectErr: any = new Error('Redirigiendo a Google para vincular la cuenta.');
        redirectErr.code = 'auth/redirect-initiated';
        throw redirectErr;
      }
      throw err;
    }
  }

  const idToken = await getNativeGoogleIdToken(deps);
  const toCredential = deps?.credentialFromIdToken || GoogleAuthProvider.credential;
  const credential = toCredential(idToken);
  const linkCredFn = deps?.linkWithCredentialFn || linkWithCredential;
  return await linkCredFn(currentUser, credential);
}

/**
 * Clears cached native Google credential state on logout so athletes can switch accounts cleanly on Android/iOS.
 */
export async function signOutNativeGoogleCache(deps?: NativeAuthDeps): Promise<void> {
  const detect = deps?.detectPlatform || detectRuntimePlatform;
  const { isCapacitorNative } = detect();
  if (!isCapacitorNative) return;
  try {
    const SocialLogin = await ensureNativeSocialLoginInitialized(deps);
    await SocialLogin.logout({ provider: 'google' });
  } catch {
    // Non-fatal on logout
  }
}
