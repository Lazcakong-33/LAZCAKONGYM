// Isolated deployment smoke test. Never forwards requests to production.
const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}
export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && ['/health', '/api/health'].includes(pathname)) {
      return json({ ok: true, service: 'lazcakong-gym-zero-cost-test', mode: 'isolated-preview', productionAccess: false, firebaseAccess: false, geminiAccess: false });
    }
    if (request.method === 'GET' && pathname === '/') {
      return new Response('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LAZCAKONG ZERO COST</title><style>body{background:#090909;color:#f5f5f5;font:16px system-ui;max-width:42rem;margin:10vh auto;padding:24px}h1{color:#ccff00}a{color:#ccff00}</style><h1>LAZCAKONG ZERO COST</h1><p>Entorno aislado de prueba de Cloudflare.</p><p>No es la aplicación de producción. No permite iniciar sesión, consultar atletas ni publicar actualizaciones.</p><p><a href="/api/health">Comprobar estado del servidor</a></p></html>', {headers: {...headers, 'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"}});
    }
    // Do not read credentials, request bodies, Firebase, or the production origin.
    return json({ ok:false, code:'PREVIEW_ONLY', message:'Ruta no habilitada en el entorno de prueba.' }, 503);
  }
};
