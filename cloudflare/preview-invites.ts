const collection = 'projects/lazcakong-zero-cost-test/databases/(default)/documents/invites';
const api = 'https://firestore.googleapis.com/v1/';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
type Value = { stringValue?: string; booleanValue?: boolean; timestampValue?: string };
type Invite = Record<string, string | boolean>;

function generateToken() {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => alphabet[byte % alphabet.length]).join('');
  return 'LZK-' + chars.slice(0, 4) + '-' + chars.slice(4);
}

async function digest(token: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

// Firestore verifies the caller's ID token and enforces the invitation collection rules on every operation.
export async function previewInvites(request: Request, requestFirebase: typeof fetch = fetch) {
  const path = new URL(request.url).pathname;
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Origin' });
  if (request.headers.get('Origin') === 'https://localhost') {
    headers.set('Access-Control-Allow-Origin', 'https://localhost');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');
  }
  const reply = (data: object, status = 200) => Response.json(data, { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const auth = request.headers.get('Authorization');
  if (!auth || !/^Bearer [\w.-]{1,8192}$/i.test(auth)) return reply({ success: false, error: 'Inicia sesión.' }, 401);
  const call = async (url: string, init: RequestInit = {}) => {
    const result = await requestFirebase(url, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!result.ok) throw new Error(String(result.status));
    return result.json();
  };
  const root = '/api/admin/invites';
  const commit = (writes: object[]) => call(api + collection.slice(0, -'/invites'.length) + ':commit', {
    method: 'POST', body: JSON.stringify({ writes }),
  });
  try {
    if (request.method === 'GET' && path === root) {
      const invites: Invite[] = [];
      let page = '';
      do {
        const url = new URL(api + collection);
        url.searchParams.set('pageSize', '300');
        if (page) url.searchParams.set('pageToken', page);
        const result = await call(url.href);
        for (const doc of result.documents ?? []) {
          const fields = doc.fields as Record<string, Value>;
          if (!fields?.token?.stringValue) continue;
          const invite: Invite = {};
          for (const key of ['token','createdAt','createdBy','note','used','revoked','expiresAt','usedAt','usedBy']) {
            const value = fields[key];
            const v = value?.stringValue ?? value?.booleanValue ?? value?.timestampValue;
            if (v !== undefined) invite[key] = v;
          }
          invites.push(invite);
        }
        page = result.nextPageToken;
      } while (page);
      invites.sort((a,b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
      return reply({ success: true, invites });
    }
    if (request.method === 'POST' && (path === root || path === root + '/batch')) {
      const body = await request.json().catch(() => null) as { count?: number; note?: string; createdBy?: string } | null;
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ success: false, error: 'Solicitud inválida.' }, 400);
      const batch = path.endsWith('/batch');
      const count = batch ? Number(body.count ?? 50) : 1;
      if (!Number.isInteger(count) || count < 1 || count > 50) return reply({ success: false, error: 'Cantidad inválida.' }, 400);
      const createdAt = new Date().toISOString();
      const invites = Array.from({ length: count }, (_, i) => ({
        token: generateToken(), createdAt, createdBy: String(body.createdBy || 'Coach Admin').trim(),
        note: batch ? 'Pase Beta Exclusivo #' + (i + 1) : String(body.note || '').trim(), used: false, revoked: false,
      }));
      await commit(await Promise.all(invites.map(async invite => ({
        update: { name: collection + '/' + await digest(invite.token), fields: Object.fromEntries(Object.entries(invite).map(([k,v]) => [k, typeof v === 'boolean' ? { booleanValue:v } : { stringValue:v }])) },
        currentDocument: { exists: false },
      }))));
      return reply(batch ? { success:true, invites, tokens:invites.map(i=>i.token) } : { success:true, invite:invites[0] }, 201);
    }
    if (request.method === 'DELETE' && path.startsWith(root + '/')) {
      const token = path.slice(root.length + 1).trim().toUpperCase();
      if (!/^[A-Z0-9_-]{1,128}$/.test(token)) return reply({ success:false, error:'Código inválido.' },400);
      await commit([{ delete:collection + '/' + await digest(token) },{ delete:collection + '/' + token }]);
      return reply({ success:true });
    }
    return reply({ success:false, error:'Método no permitido.' },405);
  } catch (error) {
    const code = error instanceof Error ? Number(error.message) : 0;
    if (code === 401 || code === 403) return reply({ success: false, error: 'Se requiere una sesión de administrador verificada.' },code);
    return reply({ success:false, error:'No se pudieron procesar las invitaciones.' },503);
  }
}
