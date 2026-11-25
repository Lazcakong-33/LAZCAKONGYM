const projectId = 'lazcakong-zero-cost-test';
const issuer = `https://securetoken.google.com/${projectId}`;

async function findLinkedAthlete(
  uid: string,
  token: string,
  requestFirebase: typeof fetch
): Promise<string | null> {
  const response = await requestFirebase(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          select: { fields: [{ fieldPath: 'authUid' }] },
          from: [{ collectionId: 'athletes' }],
          where: { fieldFilter: { field: { fieldPath: 'authUid' }, op: 'EQUAL', value: { stringValue: uid } } },
          limit: 2,
        },
      }),
      signal: AbortSignal.timeout(6000),
    }
  );
  if (!response.ok) throw new Error('Preview Firestore lookup failed');
  const rows = await response.json() as Array<{
    document?: { name: string; fields?: { authUid?: { stringValue?: string } } };
  }>;
  const matches = rows.flatMap(({ document }) => document ? [document] : []);
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error('An account must link to a single athlete');
  const [match] = matches;
  const prefix = `projects/${projectId}/databases/(default)/documents/athletes/`;
  const id = match.name.startsWith(prefix) ? match.name.slice(prefix.length) : '';
  if (!id || id.includes('/') || match.fields?.authUid?.stringValue !== uid) {
    throw new Error('Athlete link did not match the verified account');
  }
  return id;
}

async function ensurePreviewAthlete(
  uid: string,
  token: string,
  requestFirebase: typeof fetch
): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/athletes/${uid}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const existing = await requestFirebase(url, { headers, signal: AbortSignal.timeout(4000) });
  if (existing.ok) return;
  if (existing.status !== 404) throw new Error('Preview athlete could not be read');

  const created = await requestFirebase(`${url}?currentDocument.exists=false`, {
    method: 'PATCH',
    headers,
    signal: AbortSignal.timeout(4000),
    body: JSON.stringify({
      fields: {
        id: { stringValue: uid },
        name: { stringValue: 'Atleta de prueba' },
      },
    }),
  });
  if (created.ok) return;
  // Concurrent sign-ins can create the same document. Verify the winner without overwriting it.
  if (created.status === 409 || created.status === 412) {
    const winner = await requestFirebase(url, { headers, signal: AbortSignal.timeout(4000) });
    if (winner.ok) return;
  }
  throw new Error('Preview athlete could not be initialized');
}

function sessionResponse(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function initializePreviewSession(
  request: Request,
  apiKey: string | undefined,
  requestFirebase: typeof fetch = fetch,
  requireLinkedAthlete = false
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
  let adminIdentity = false;
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
    adminIdentity = provider === 'google.com' && claims.email_verified === true && claims.email === 'kmiloko19@gmail.com';
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
      users?: Array<{ localId: string; email?: string; disabled?: boolean; emailVerified?: boolean; createdAt?: string }>;
    };
    const user = users?.[0];
    if (user?.localId !== uid || user.disabled) return unauthorized();
    if (signInProvider === 'google.com' && user.emailVerified !== true) return unauthorized();

    const linkedAthleteId = await findLinkedAthlete(uid, token, requestFirebase);
    if (requireLinkedAthlete && !linkedAthleteId) {
      return sessionResponse({ success: false, error: 'La cuenta de prueba no tiene un perfil vinculado.' }, 403);
    }
    if (!linkedAthleteId) await ensurePreviewAthlete(uid, token, requestFirebase);
    const athleteId = linkedAthleteId ?? uid;
    let isAdmin = false;
    if (adminIdentity && user.email === 'kmiloko19@gmail.com' && user.emailVerified === true) {
      const permission = await requestFirebase(
        'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/invites?pageSize=1&mask.fieldPaths=createdAt',
        { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(4000) }
      ).catch(() => null);
      isAdmin = permission?.ok === true;
    }
    return sessionResponse({
      success: true,
      athleteId,
      authUid: uid,
      isAdmin,
      signInProvider,
      emailVerified: user.emailVerified === true,
      adminRequiresGoogleSignIn: false,
      claimsUpdated: false,
      profile: {
        id: athleteId,
        authUid: uid,
        name: 'Atleta de prueba',
        isAdmin,
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
