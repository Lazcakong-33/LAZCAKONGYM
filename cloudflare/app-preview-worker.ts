import smokeWorker from './preview-worker.mjs';
import { handlePreviewCoach, type PreviewCoachBindings } from './preview-coach.ts';
import { initializePreviewSession } from './preview-session.ts';
import { buildDailyCaloriesReport, calculateCompletedRoutineCalories } from '../src/server/dailyCaloriesController.ts';

import { evaluateOtaCompatibility, type OtaManifestPayload } from '../src/utils/otaCompatibility.ts';

interface PreviewBindings extends PreviewCoachBindings {
  ASSETS?: { fetch(request: Request): Promise<Response> };
}

const maxBodyBytes = 512 * 1024;

export default {
  async fetch(request: Request, env: PreviewBindings = {}): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const otaHeaders = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    if (request.headers.get('Origin') === 'https://localhost') {
      otaHeaders.set('Access-Control-Allow-Origin', 'https://localhost');
    }
    if (request.method === 'OPTIONS' && pathname === '/api/ota/manifest' && otaHeaders.has('Access-Control-Allow-Origin')) {
      otaHeaders.set('Access-Control-Allow-Methods', 'GET');
      otaHeaders.set('Access-Control-Allow-Headers', 'Cache-Control');
      return new Response(null, { status: 204, headers: otaHeaders });
    }
    if (request.method === 'GET' && pathname === '/api/ota/manifest') {
      const channel = url.searchParams.get('channel') ?? 'development';
      const nativeVersionCode = Number(url.searchParams.get('nativeVersionCode') ?? '1');
      const headers = otaHeaders;
      if (!Number.isSafeInteger(nativeVersionCode) || nativeVersionCode < 1) {
        return Response.json({ error: 'Versión nativa inválida.' }, { status: 400, headers });
      }

      let manifest: OtaManifestPayload | null = null;
      if (channel === 'development' && env.ASSETS) {
        const response = await env.ASSETS.fetch(new Request(new URL('/_preview-ota/manifest.development.json', url)));
        if (response.ok && response.headers.get('Content-Type')?.includes('application/json')) {
          manifest = await response.json().catch(() => null) as OtaManifestPayload | null;
        }
      }
      const eligible = manifest?.channel === 'development'
        && /^\d+\.\d+\.\d+$/.test(manifest.version)
        && /^[a-f0-9]{64}$/i.test(manifest.checksum)
        && manifest.url === `${url.origin}/api/ota/bundles/lazcakongym-ota-${manifest.version}.zip`
        && evaluateOtaCompatibility(manifest, nativeVersionCode).valid;

      return Response.json({
        success: true,
        enabled: channel === 'development',
        channel,
        updateAvailable: Boolean(eligible),
        manifest: eligible ? manifest : null,
      }, { headers });
    }
    if (request.method === 'GET' && /^\/api\/ota\/bundles\/lazcakongym-ota-\d+\.\d+\.\d+\.zip$/.test(pathname) && env.ASSETS) {
      const assetUrl = new URL(pathname.replace('/api/ota/bundles/', '/_preview-ota/'), url);
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (response.ok && !response.headers.get('Content-Type')?.startsWith('text/html')) {
        const headers = new Headers(response.headers);
        otaHeaders.forEach((value, key) => headers.set(key, value));
        return new Response(response.body, { status: response.status, headers });
      }
      return new Response(null, { status: 404 });
    }
    if (request.method === 'GET' && (pathname === '/health' || pathname === '/api/health')) {
      return Response.json({
        ok: true,
        service: 'lazcakong-gym-app-preview',
        mode: 'isolated-preview',
        productionAccess: false,
        firebaseAccess: Boolean(env.PREVIEW_FIREBASE_API_KEY),
        geminiAccess: false,
        workersAiConfigured: Boolean(env.AI && env.COACH_USER_LIMIT && env.COACH_TOTAL_LIMIT),
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method === 'POST' && pathname === '/api/coach/chat') {
      return handlePreviewCoach(request, env);
    }
    if (pathname === '/api/auth/session-init') {
      const fromAndroid = request.headers.get('Origin') === 'https://localhost';
      if (request.method === 'OPTIONS' && fromAndroid) {
        return new Response(null, { status: 204, headers: {
          'Access-Control-Allow-Origin': 'https://localhost',
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cache-Control',
          'Cache-Control': 'no-store',
          Vary: 'Origin',
        } });
      }
      if (request.method === 'POST') {
        const response = await initializePreviewSession(request, env.PREVIEW_FIREBASE_API_KEY);
        const headers = new Headers(response.headers);
        headers.append('Vary', 'Origin');
        if (fromAndroid) headers.set('Access-Control-Allow-Origin', 'https://localhost');
        return new Response(response.body, { status: response.status, headers });
      }
    }
    const isSessionCalories = pathname === '/api/calories/calculate-session';
    const isDailyCalories = pathname === '/api/calories/daily-report';
    if ((!isSessionCalories && !isDailyCalories) || !['POST', 'OPTIONS'].includes(request.method)) {
      return smokeWorker.fetch(request);
    }

    const headers = new Headers({ 'Cache-Control': 'no-store', Vary: 'Origin' });
    const fromAndroid = request.headers.get('Origin') === 'https://localhost';
    if (fromAndroid) headers.set('Access-Control-Allow-Origin', 'https://localhost');
    if (request.method === 'OPTIONS') {
      if (!fromAndroid) return smokeWorker.fetch(request);
      headers.set('Access-Control-Allow-Methods', 'POST');
      headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cache-Control');
      return new Response(null, { status: 204, headers });
    }
    if (!request.headers.get('Content-Type')?.split(';')[0].trim().match(/^application\/json$/i)) {
      return Response.json({ success: false, error: 'Se requiere un cuerpo JSON.' }, { status: 415, headers });
    }

    const reader = request.body?.getReader();
    if (!reader) {
      return Response.json({ success: false, error: 'Falta el cuerpo JSON.' }, { status: 400, headers });
    }

    const decoder = new TextDecoder();
    let body = '';
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) {
          void reader.cancel().catch(() => {});
          return Response.json({ success: false, error: 'El historial supera el tamaño máximo de la vista previa.' }, { status: 413, headers });
        }
        body += decoder.decode(value, { stream: true });
      }
      const payload = JSON.parse(body + decoder.decode());
      if (isSessionCalories) {
        const { workout, athleteWeightKg } = payload ?? {};
        const detail = calculateCompletedRoutineCalories(workout, athleteWeightKg);
        return Response.json({ success: true, caloriesBurned: detail?.caloriesBurned ?? 0, detail }, { headers });
      }
      const { athlete, workouts, targetDate, timezoneOffsetMinutes } = payload;
      return Response.json(buildDailyCaloriesReport({
        athlete: athlete || { id: 'default', weightKg: 95 },
        workouts: Array.isArray(workouts) ? workouts : [],
        targetDate,
        timezoneOffsetMinutes,
      }), { headers });
    } catch {
      const error = isSessionCalories
        ? { success: false, error: 'No se pudieron calcular las calorías de la sesión.', caloriesBurned: 0 }
        : { success: false, error: 'No se pudo procesar el reporte de calorías.' };
      return Response.json(error, { status: 400, headers });
    } finally {
      reader.releaseLock();
    }
  },
};
