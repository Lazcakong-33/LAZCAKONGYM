import smokeWorker from './preview-worker.mjs';
import { buildDailyCaloriesReport } from '../src/server/dailyCaloriesController.ts';

const maxBodyBytes = 512 * 1024;

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/calories/daily-report') {
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
