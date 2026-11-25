const projectId = 'lazcakong-zero-cost-test';
const issuer = `https://securetoken.google.com/${projectId}`;

function sessionResponse(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function initializePreviewSession(
  request: Request,
  apiKey: string | undefined,
  requestFirebase: typeof fetch = fetch
): Promise<Response> {
  if (!apiKey) {
    return sessionResponse({ success: false, error: 'Firebase de prueba no configurado.' }, 503);
  }

  const unauthorized = () => sessionResponse({
    success: false,
    error: 'Inicia sesión con una cuenta del proyecto Firebase de prueba.',
  }, 401);
  const token = request.headers.get('Authorization')?.match(/^Bearer ([\w.-]+)$/i)?.[1];
  if (!token || token.length > 8192) return unauthorized();

  // The project claims only route the request. Google validates the token before use.
  let uid: string;
  let signInProvider: 'password' | 'google.com';
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return unauthorized();
    const claims = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const provider = claims.firebase?.sign_in_provider;
    if (
      claims.aud !== projectId || claims.iss !== issuer ||
      (provider !== 'password' && provider !== 'google.com') ||
      typeof claims.sub !== 'string' || !/^[\w-]{1,128}$/.test(claims.sub)
    ) return unauthorized();
    uid = claims.sub;
    signInProvider = provider;
  } catch {
    return unauthorized();
  }

  try {
    const response = await requestFirebase(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }),
        signal: AbortSignal.timeout(6000),
      }
    );
    if (response.status === 400 || response.status === 401) return unauthorized();
    if (!response.ok) throw new Error('Firebase unavailable');

    const { users } = await response.json() as {
      users?: Array<{ localId: string; disabled?: boolean; emailVerified?: boolean; createdAt?: string }>;
    };
    const user = users?.[0];
    if (user?.localId !== uid || user.disabled) return unauthorized();
    if (signInProvider === 'google.com' && user.emailVerified !== true) return unauthorized();

    // The Worker returns synthetic identity metadata. The web client syncs
    // training records separately through the isolated Firestore rules.
    return sessionResponse({
      success: true,
      athleteId: uid,
      authUid: uid,
      isAdmin: false,
      signInProvider,
      emailVerified: user.emailVerified === true,
      adminRequiresGoogleSignIn: false,
      claimsUpdated: false,
      profile: {
        id: uid,
        authUid: uid,
        name: 'Atleta de prueba',
        isAdmin: false,
        avatar: '🦍',
        goal: 'Hipertrofia & Masa',
        weeklyTargetDays: 5,
        soundEnabled: true,
        vibrationEnabled: true,
        weightUnit: 'kg',
        weightKg: 95,
        createdAt: new Date(Number(user.createdAt) || 0).toISOString(),
      },
    });
  } catch {
    return sessionResponse({ success: false, error: 'Firebase de prueba no está disponible.' }, 503);
  }
}
