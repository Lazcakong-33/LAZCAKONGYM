import { initializePreviewSession } from './preview-session.ts';

const model = '@cf/meta/llama-3.2-3b-instruct';
const maxMessageChars = 800;
const maxBodyBytes = 4096;

interface RateLimit {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

export interface PreviewCoachBindings {
  PREVIEW_FIREBASE_API_KEY?: string;
  COACH_USER_LIMIT?: RateLimit;
  COACH_TOTAL_LIMIT?: RateLimit;
  AI?: {
    run(model: string, input: {
      messages: Array<{ role: 'system' | 'user'; content: string }>;
      max_tokens: number;
    }): Promise<unknown>;
  };
}

function respond(body: object, status = 200, retryAfter?: number) {
  const headers = new Headers({ 'Cache-Control': 'no-store' });
  if (retryAfter) headers.set('Retry-After', String(retryAfter));
  return Response.json(body, { status, headers });
}

async function readField(request: Request, field: string) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0;
  let data = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        void reader.cancel().catch(() => {});
        return '';
      }
      data += decoder.decode(value, { stream: true });
    }
    const parsed = JSON.parse(data + decoder.decode());
    return typeof parsed?.[field] === 'string' ? parsed[field].trim() : '';
  } catch {
    return '';
  } finally {
    reader.releaseLock();
  }
}

export async function handlePreviewCoach(request: Request, env: PreviewCoachBindings, statusOnly = false) {
  const { AI, COACH_USER_LIMIT, COACH_TOTAL_LIMIT } = env;
  const unavailable = () => respond({
    success: false,
    error: 'La IA gratuita está temporalmente indisponible o alcanzó su cuota. Puedes seguir usando las consultas locales del Coach.',
  }, 503);



  try {
    const session = await initializePreviewSession(request, env.PREVIEW_FIREBASE_API_KEY);
    if (!session.ok) return session;
    const { authUid, athleteId } = await session.json() as { authUid: string; athleteId: string };
    if (statusOnly) {
      const requestedId = await readField(request, 'athleteId');
      if (!requestedId) return respond({ success: false, error: 'Falta el perfil activo.' }, 400);
      const athleteAuthorized = requestedId === athleteId;
      const configured = Boolean(AI && COACH_USER_LIMIT && COACH_TOTAL_LIMIT);
      return respond({ success: true, athleteAuthorized, provider: 'workers-ai', model,
        readyForLiveRequest: athleteAuthorized && configured });
    }
    if (!AI || !COACH_USER_LIMIT || !COACH_TOTAL_LIMIT) return unavailable();

    const message = await readField(request, 'message');
    if (!message || message.length > maxMessageChars) {
      return respond({ success: false, error: `Escribe una pregunta de hasta ${maxMessageChars} caracteres.` }, 400);
    }

    if (!(await COACH_USER_LIMIT.limit({ key: authUid })).success ||
        !(await COACH_TOTAL_LIMIT.limit({ key: 'preview-coach' })).success) {
      return respond({
        success: false,
        code: 'coach/rate-limit',
        error: 'El Coach alcanzó su límite temporal. Intenta de nuevo en un minuto.',
      }, 429, 60);
    }

    const answer = await AI.run(model, {
      messages: [
        { role: 'system', content: 'Eres el Coach LazcaKong. Responde en español claro y breve. Puedes responder preguntas generales. No inventes registros del atleta: no tienes acceso a su historial. No diagnostiques, no recomiendes tratamientos y reconoce cuando no tienes datos suficientes.' },
        { role: 'user', content: message },
      ],
      max_tokens: 240,
    }) as { response?: unknown } | null;
    const reply = typeof answer?.response === 'string' ? answer.response.trim() : '';
    return reply ? respond({ success: true, reply, model }) : unavailable();
  } catch {
    return unavailable();
  }
}
