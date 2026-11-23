import { safeApiFetchJson } from '../safeApiFetch';

describe('safeApiFetchJson - protection against HTML responses in /api/* auth requests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test('never throws Unexpected token < when /api/auth/migrate-legacy returns HTML 404 Cannot POST', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      url: 'https://example.run.app/api/auth/migrate-legacy',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () =>
        '<!DOCTYPE html><html lang="en"><head><title>Error</title></head><body><pre>Cannot POST /api/auth/migrate-legacy</pre></body></html>',
    } as any);

    const res = await safeApiFetchJson('/api/auth/migrate-legacy', { method: 'POST' });
    expect(res.ok).toBe(false);
    expect(res.isJson).toBe(false);
    expect(res.isHtml).toBe(true);
    expect(res.error).toContain('no tiene esta ruta disponible');
    expect(res.error).not.toContain('Unexpected token');
  });

  test('detects mobile/PWA __cookie_check.html redirect even on HTTP 200 text/html', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.run.app/__cookie_check.html?return_url=%2Fapi%2Fauth%2Fsession-init',
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<!doctype html><html><script src="/_aistudio-iframe.js"></script></html>',
    } as any);

    const res = await safeApiFetchJson('/api/auth/session-init', { method: 'POST' });
    expect(res.ok).toBe(false);
    expect(res.isHtml).toBe(true);
    expect(res.error).toContain('Chrome o Safari');
  });

  test('parses structured JSON errors (e.g. HTTP 409 requiresLegacyVerification) cleanly', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      url: 'https://example.run.app/api/auth/session-init',
      headers: new Headers({ 'content-type': 'application/json; charset=utf-8' }),
      text: async () =>
        JSON.stringify({
          success: false,
          requiresLegacyVerification: true,
          email: 'atleta@gmail.com',
          error: 'Verifica tu identidad con tu PIN anterior.',
        }),
    } as any);

    const res = await safeApiFetchJson<{
      requiresLegacyVerification?: boolean;
      email?: string;
      error?: string;
    }>('/api/auth/session-init', { method: 'POST' });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(409);
    expect(res.isJson).toBe(true);
    expect(res.isHtml).toBe(false);
    expect(res.data?.requiresLegacyVerification).toBe(true);
    expect(res.error).toBe('Verifica tu identidad con tu PIN anterior.');
  });
});
