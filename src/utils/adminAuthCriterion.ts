/**
 * Shared frontend admin verification helpers.
 * Mirrors backend (`isAuthorizedAdminToken`) and Firestore Rules (`isAdmin()`):
 * - NO Custom Claims
 * - NO hardcoded admin emails in frontend
 * - NO PIN or localStorage trust
 * - Strictly requires active Google Sign-In verified ID token + server-config confirmation.
 */
export function extractGoogleVerifiedState(
  tokenResult: { signInProvider?: string | null; claims?: Record<string, any> },
  userEmailVerified = false
): { isGoogleVerified: boolean; signInProvider: string | null } {
  const firebaseClaims = tokenResult?.claims?.firebase as
    | { sign_in_provider?: unknown }
    | undefined;
  const provider =
    (typeof tokenResult?.signInProvider === 'string' && tokenResult.signInProvider) ||
    (typeof firebaseClaims?.sign_in_provider === 'string' && firebaseClaims.sign_in_provider) ||
    null;
  const emailVerified = Boolean(tokenResult?.claims?.email_verified ?? userEmailVerified);
  return {
    isGoogleVerified: Boolean(provider === 'google.com' && emailVerified),
    signInProvider: provider,
  };
}

export function isEffectiveFrontendAdmin(params: {
  hasAuthUser: boolean;
  isGoogleVerifiedSession: boolean;
  serverAdminVerified: boolean;
}): boolean {
  return Boolean(
    params.hasAuthUser &&
      params.isGoogleVerifiedSession &&
      params.serverAdminVerified
  );
}
