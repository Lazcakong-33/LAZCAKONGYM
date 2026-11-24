import smokeWorker from './preview-worker.mjs';
import { handlePreviewCoach, type PreviewCoachBindings } from './preview-coach.ts';
import { initializePreviewSession } from './preview-session.ts';
import { buildDailyCaloriesReport } from '../src/server/dailyCaloriesController.ts';

const maxBodyBytes = 512 * 1024;

export default {
  async fetch(request: Request, env: PreviewCoachBindings = {}): Promise<Response> {
    const { pathname } = new URL(request.url);
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
    if (request.method === 'POST' && pathname === '/api/auth/session-init') {
      return initializePreviewSession(request, env.PREVIEW_FIREBASE_API_KEY);
    }
    if (request.method !== 'POST' || pathname !== '/api/calories/daily-report') {
      return smokeWorker.fetch(request);
    }

    const headers = { 'Cache-Control': 'no-store' };
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
      const { athlete, workouts, targetDate, timezoneOffsetMinutes } = JSON.parse(body + decoder.decode());
      return Response.json(buildDailyCaloriesReport({
        athlete: athlete || { id: 'default', weightKg: 95 },
        workouts: Array.isArray(workouts) ? workouts : [],
        targetDate,
        timezoneOffsetMinutes,
      }), { headers });
    } catch {
      return Response.json({ success: false, error: 'No se pudo procesar el reporte de calorías.' }, { status: 400, headers });
    } finally {
      reader.releaseLock();
    }
  },
};
