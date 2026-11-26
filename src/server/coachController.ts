import type { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import type { AuthenticatedUser } from './firebaseAdminServer.ts';
import {
  checkRateLimit,
  getAdminServices,
  getDocumentWithUserToken,
  isFirestorePermissionDeniedError,
  parseConfiguredServiceAccount,
} from './firebaseAdminServer.ts';
import { getGeminiModel, getServerGeminiApiKey } from './geminiModel.ts';

export interface CoachConversationTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CoachChatRequestBody {
  athleteId?: string;
  message?: string;
  intent?: 'today_workout' | 'last_weight' | 'replace_exercise' | 'freeform';
  history?: CoachConversationTurn[];
  context?: Record<string, any>;
}

export interface CoachOwnershipCheckResult {
  authorized: boolean;
  status: number;
  error?: string;
}

export interface CoachGeminiClient {
  generateCoachReply: (params: {
    model: string;
    systemInstruction: string;
    contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  }) => Promise<string>;
}

export interface CoachControllerDeps {
  verifyOwnership?: (params: {
    athleteId: string;
    user: AuthenticatedUser;
    rawIdToken?: string;
  }) => Promise<CoachOwnershipCheckResult>;
  geminiClient?: CoachGeminiClient;
  getApiKey?: () => string | undefined;
  checkRateLimitFn?: (key: string, maxAttempts?: number, windowMs?: number) => {
    allowed: boolean;
    retryAfterSec?: number;
  };
}

const SENSITIVE_KEY_PATTERN = /^(pin|password|passwd|token|rawidtoken|idtoken|secret|apikey|api_key|authorization|credential|credentials|email|authuid)$/i;
const MAX_HISTORY_TURNS = 6;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_CONTEXT_JSON_BYTES = 12000;

/**
 * Recursively strips sensitive credentials or PII keys from context objects before prompting Gemini.
 */
export function sanitizeCoachContextValue(value: any, depth = 0): any {
  if (depth > 6) return undefined;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.slice(0, 600);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((item) => sanitizeCoachContextValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(k.trim())) {
        continue;
      }
      const cleaned = sanitizeCoachContextValue(v, depth + 1);
      if (cleaned !== undefined) {
        out[k] = cleaned;
      }
    }
    return out;
  }
  return undefined;
}

async function verifyOwnershipViaUserTokenRest(params: {
  athleteId: string;
  user: AuthenticatedUser;
  rawIdToken: string;
}): Promise<CoachOwnershipCheckResult> {
  const { athleteId, user, rawIdToken } = params;
  const [athleteDoc, deletedDoc] = await Promise.all([
    getDocumentWithUserToken(rawIdToken, 'athletes', athleteId),
    getDocumentWithUserToken(rawIdToken, 'deleted_athletes', athleteId).catch(() => ({
      ok: false,
      status: 0,
      exists: false,
      id: athleteId,
    })),
  ]);

  if (athleteDoc.ok && !athleteDoc.exists) {
    return {
      authorized: false,
      status: 404,
      error: 'Perfil de atleta no encontrado.',
    };
  }

  if (deletedDoc.ok && deletedDoc.exists) {
    return {
      authorized: false,
      status: 403,
      error: 'Este perfil de atleta fue dado de baja.',
    };
  }

  if (athleteDoc.ok && athleteDoc.exists) {
    const ownerUid =
      typeof athleteDoc.data?.authUid === 'string' ? athleteDoc.data.authUid.trim() : '';
    if (user.isAdmin === true || (ownerUid && ownerUid === user.uid)) {
      return { authorized: true, status: 200 };
    }
    return {
      authorized: false,
      status: 403,
      error: 'No tienes autorización para consultar los datos de este atleta.',
    };
  }

  if (athleteDoc.status === 401) {
    return {
      authorized: false,
      status: 401,
      error: 'Token de autenticación inválido o expirado.',
    };
  }

  if (athleteDoc.status === 403) {
    return {
      authorized: false,
      status: 403,
      error: 'No tienes autorización para consultar los datos de este atleta.',
    };
  }

  return {
    authorized: false,
    status: 503,
    error: 'No se pudo verificar el perfil en Firestore temporalmente.',
  };
}

/**
 * Default athlete ownership verification against Firestore `/athletes/{athleteId}`.
 * Enforces `athleteData.authUid === user.uid` (or verified Master Admin `user.isAdmin === true`).
 * Uses direct Firestore REST fast-path on Starter-Tier runtimes without service account JSON
 * to avoid slow Admin gRPC PERMISSION_DENIED failures.
 */
export async function verifyAthleteOwnershipDefault(params: {
  athleteId: string;
  user: AuthenticatedUser;
  rawIdToken?: string;
}): Promise<CoachOwnershipCheckResult> {
  const { athleteId, user, rawIdToken } = params;
  if (!athleteId || !/^[a-zA-Z0-9_-]{1,128}$/.test(athleteId)) {
    return {
      authorized: false,
      status: 400,
      error: 'Identificador de atleta inválido.',
    };
  }

  if (!parseConfiguredServiceAccount() && rawIdToken) {
    try {
      return await verifyOwnershipViaUserTokenRest({ athleteId, user, rawIdToken });
    } catch (restErr: any) {
      console.error('[Coach Ownership REST fast-path error]:', restErr?.message || restErr);
      return {
        authorized: false,
        status: 503,
        error: 'No se pudo validar el perfil del atleta en este momento.',
      };
    }
  }

  try {
    const { db } = getAdminServices();
    const [docSnap, deletedSnap] = await Promise.all([
      db.collection('athletes').doc(athleteId).get(),
      db.collection('deleted_athletes').doc(athleteId).get().catch(() => null),
    ]);

    if (!docSnap.exists) {
      return {
        authorized: false,
        status: 404,
        error: 'Perfil de atleta no encontrado.',
      };
    }

    if (deletedSnap && deletedSnap.exists) {
      return {
        authorized: false,
        status: 403,
        error: 'Este perfil de atleta fue dado de baja.',
      };
    }

    const data = docSnap.data() || {};
    const ownerUid = typeof data.authUid === 'string' ? data.authUid.trim() : '';

    if (user.isAdmin === true || (ownerUid && ownerUid === user.uid)) {
      return { authorized: true, status: 200 };
    }

    return {
      authorized: false,
      status: 403,
      error: 'No tienes autorización para consultar los datos de este atleta.',
    };
  } catch (err: any) {
    if (isFirestorePermissionDeniedError(err) && rawIdToken) {
      try {
        return await verifyOwnershipViaUserTokenRest({ athleteId, user, rawIdToken });
      } catch (restErr: any) {
        console.error('[Coach Ownership REST fallback error]:', restErr?.message || restErr);
      }
    }

    console.error('[Coach Ownership verification error]:', err?.message || err);
    return {
      authorized: false,
      status: 503,
      error: 'No se pudo verificar la propiedad del perfil en el servidor.',
    };
  }
}

const GEMINI_UPSTREAM_TIMEOUT_MS = 18_000;

function createDefaultGeminiClient(apiKey: string): CoachGeminiClient {
  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: GEMINI_UPSTREAM_TIMEOUT_MS,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  return {
    async generateCoachReply({ model, systemInstruction, contents }) {
      const isGemini4 = model.startsWith('gemini-4');
      const config: Record<string, any> = {
        systemInstruction,
        // Hydrogen uses output tokens for both thinking and final answer.
        // A 700-token cap with default HIGH reasoning can yield empty text.
        maxOutputTokens: isGemini4 ? 2_048 : 1_024,
      };
      if (isGemini4) {
        // Google's Gemini 4 Hydrogen guidance: HIGH is the default, LOW is
        // supported and appropriate for a concise fitness-assistant reply.
        config.thinkingConfig = { thinkingLevel: 'LOW' };
      } else {
        config.temperature = 0.25;
      }

      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        const response = await Promise.race([
          ai.models.generateContent({
            model,
            contents,
            config,
          }),
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => {
              const timeoutErr: any = new Error('Tiempo de espera agotado al consultar Gemini.');
              timeoutErr.status = 504;
              timeoutErr.code = 'coach/gemini-timeout';
              reject(timeoutErr);
            }, GEMINI_UPSTREAM_TIMEOUT_MS);
          }),
        ]);

        const text = response.text?.trim() || response.candidates?.flatMap(c => c.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('\n').trim() || '';
        if (!text) {
          const emptyErr: any = new Error('Gemini devolvió una respuesta vacía.');
          emptyErr.status = 502;
          emptyErr.code = 'coach/gemini-empty-response';
          throw emptyErr;
        }
        return text;
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    },
  };
}

function buildCoachSystemInstruction(sanitizedContext: Record<string, any>): string {
  const serializedContext = JSON.stringify(sanitizedContext).slice(0, MAX_CONTEXT_JSON_BYTES);

  return [
    'Eres "Coach LazcaKong IA", coach de entrenamiento de fuerza e hipertrofia dentro de LAZCAKONG GYM.',
    'Responde siempre en español claro, directo y accionable (máximo 4 párrafos cortos o viñetas concisas).',
    'REGLAS ESTRICTAS DE INTEGRIDAD DE DATOS:',
    '1. Para preguntas sobre el atleta usa exclusivamente CONTEXTO_AUTORIZADO_DEL_ATLETA. Para preguntas generales de fuerza, hipertrofia, recuperación, técnica, nutrición deportiva y planificación, usa conocimiento general y marca claramente que no es un dato personal. Si falta contexto, pide el dato necesario. No presentes como historial un ejemplo ni una recomendación.',
    '2. NUNCA inventes series, repeticiones, pesos, fechas ni entrenamientos pasados.',
    '3. Distingue explícitamente entre "Lo que levantaste" (registros reales con fecha y series) y "Sugerencia" (cálculo o recomendación de progresión).',
    '4. Si "hasRegisteredSets" es false o no hay series registradas para un ejercicio, di exactamente que aún no tiene series registradas para ese ejercicio.',
    '5. Si "hasHistory" es false pero existe "selectedRoutine", muestra y explica el entrenamiento programado sin asumir falta de disciplina.',
    '6. Si "isHistorySyncing" o "hasSyncError" es true, menciona brevemente que hay datos en sincronización o pendientes y que la recomendación usa el estado disponible.',
    '7. Identifica explícitamente cualquier métrica de recuperación o calorías como estimación ("estimada").',
    '8. Señala brevemente en qué registro(s) y fecha(s) concretas se basa cada recomendación personalizada.',
    '9. Cuando hables de sustituir un ejercicio, recomienda únicamente alternativas del catálogo provisto en "availableAlternatives" (o indica si no hay opciones en contexto) y recuerda que nunca se copian pesos de otro ejercicio.',
    '10. ALCANCE DE SEGURIDAD: Solo brindas orientación de entrenamiento. No diagnostiques lesiones ni autorices entrenar con dolor médico; ante dolor agudo o lesión, indica pausar y consultar a un profesional de la salud.',
    '',
    `CONTEXTO_AUTORIZADO_DEL_ATLETA=${serializedContext}`,
  ].join('\n');
}

function mapGeminiErrorResponse(err: any): {
  status: number;
  code: string;
  retryable: boolean;
  message: string;
} {
  const rawStatus = Number(err?.status || err?.statusCode || 0);
  const errCode = String(err?.code || '').toLowerCase();
  const rawMsg = String(err?.message || err || 'Error desconocido en Gemini');
  const lower = rawMsg.toLowerCase();

  if (
    rawStatus === 408 ||
    rawStatus === 504 ||
    errCode === 'coach/gemini-timeout' ||
    errCode === 'etimedout' ||
    errCode === 'econnaborted' ||
    err?.name === 'AbortError' ||
    lower.includes('deadline_exceeded') ||
    lower.includes('timed out') ||
    lower.includes('tiempo de espera')
  ) {
    return {
      status: 504,
      code: 'coach/gemini-timeout',
      retryable: true,
      message:
        'El servicio de Coach IA tardó demasiado en responder (timeout). Intenta nuevamente en unos segundos.',
    };
  }

  if (
    rawStatus === 429 ||
    lower.includes('quota') ||
    lower.includes('rate limit') ||
    lower.includes('resource_exhausted')
  ) {
    return {
      status: 429,
      code: 'coach/gemini-quota-exceeded',
      retryable: true,
      message:
        'El servicio de Coach IA alcanzó el límite temporal de solicitudes (cuota). Intenta nuevamente en unos segundos.',
    };
  }

  if (
    rawStatus === 503 ||
    lower.includes('unavailable') ||
    lower.includes('overloaded')
  ) {
    return {
      status: 503,
      code: 'coach/gemini-unavailable',
      retryable: true,
      message:
        'El modelo de Coach IA está temporalmente saturado o en mantenimiento. Intenta nuevamente en unos segundos.',
    };
  }

  if (
    rawStatus === 401 ||
    rawStatus === 403 ||
    lower.includes('api key') ||
    lower.includes('permission_denied') ||
    lower.includes('unauthenticated')
  ) {
    return {
      status: 502,
      code: 'coach/gemini-auth-error',
      retryable: false,
      message: 'No se pudo autenticar la solicitud con el servicio Gemini en el servidor.',
    };
  }

  if (
    rawStatus === 404 ||
    lower.includes('model not found') ||
    lower.includes('not found for api version')
  ) {
    return {
      status: 502,
      code: 'coach/gemini-model-unavailable',
      retryable: false,
      message: 'El modelo configurado para Coach IA no está disponible con la cuenta o API actual. Revisa GEMINI_MODEL y los permisos del proveedor en el servidor.',
    };
  }

  if (rawStatus === 400 || lower.includes('invalid argument')) {
    return {
      status: 502,
      code: 'coach/gemini-model-error',
      retryable: false,
      message: 'El modelo en línea no pudo procesar la solicitud. Revisa la configuración del servicio.',
    };
  }

  return {
    status: 502,
    code: errCode === 'coach/gemini-empty-response' ? 'coach/gemini-empty-response' : 'coach/gemini-upstream-error',
    retryable: true,
    message: 'El modelo en línea no respondió correctamente. Tus datos de entrenamiento siguen disponibles.',
  };
}

/**
 * POST /api/coach/status
 * Authenticated, READ-ONLY diagnostic. Never returns keys, credentials,
 * athlete records or raw tokens, and does not call the paid Gemini API.
 */
export async function handleCoachStatus(
  req: Request,
  res: Response,
  deps?: CoachControllerDeps
) {
  res.setHeader('Cache-Control', 'private, no-store');
  const user = (req as any).user as AuthenticatedUser | undefined;
  if (!user?.uid) {
    return res.status(401).json({
      success: false, code: 'coach/unauthorized',
      error: 'Debes iniciar sesión para diagnosticar Coach IA.',
    });
  }
  const apiKey = deps?.getApiKey ? deps.getApiKey() : getServerGeminiApiKey();
  const geminiConfigured = Boolean(apiKey?.trim() || deps?.geminiClient);
  const athleteId = String(req.body?.athleteId || '').trim();
  if (!athleteId || !/^[a-zA-Z0-9_-]{1,128}$/.test(athleteId)) {
    return res.status(400).json({
      success: false, code: 'coach/invalid-athlete-id',
      error: 'No se pudo identificar el perfil de atleta activo.',
    });
  }
  const verify = deps?.verifyOwnership || verifyAthleteOwnershipDefault;
  let ownership: CoachOwnershipCheckResult;
  try {
    ownership = await verify({
      athleteId,
      user,
      rawIdToken: (req as any).rawIdToken,
    });
  } catch {
    ownership = {
      authorized: false, status: 503,
      error: 'No se pudo verificar el perfil del atleta en este momento.',
    };
  }
  return res.status(200).json({
    success: true,
    authenticated: true,
    athleteAuthorized: ownership.authorized,
    ownershipCode: ownership.authorized ? 'ok' :
      ownership.status === 503 ? 'temporarily-unavailable' : 'not-authorized',
    geminiConfigured,
    model: getGeminiModel(),
    readyForLiveRequest: ownership.authorized && geminiConfigured,
    // A configured key is NOT proof that Gemini accepts live requests.
    message: !ownership.authorized
      ? (ownership.error || 'No está autorizado este perfil de atleta.')
      : !geminiConfigured
      ? 'GEMINI_API_KEY no está configurada en el servidor. Debes agregarla como secreto privado en el alojamiento.'
      : 'La sesión y la clave están configuradas. Usa Enviar para comprobar una respuesta real de Gemini.',
  });
}

/**
 * POST /api/coach/chat
 * Authenticated server-side Gemini endpoint for Coach LazcaKong IA.
 */
export async function handleCoachChat(
  req: Request,
  res: Response,
  deps?: CoachControllerDeps
) {
  const user = (req as any).user as AuthenticatedUser | undefined;
  const rawIdToken = (req as any).rawIdToken as string | undefined;

  if (!user || !user.uid) {
    return res.status(401).json({
      success: false,
      code: 'coach/unauthorized',
      error: 'Debes iniciar sesión con Firebase Authentication para usar el Coach IA.',
    });
  }

  const rateLimiter = deps?.checkRateLimitFn || checkRateLimit;
  const rateCheck = rateLimiter(`coach-chat:${user.uid}`, 30, 5 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      success: false,
      code: 'coach/rate-limited',
      retryable: true,
      retryAfterSec: rateCheck.retryAfterSec,
      error: `Demasiadas consultas seguidas al Coach IA. Espera ${rateCheck.retryAfterSec || 60} segundos e intenta de nuevo.`,
    });
  }

  const body = (req.body || {}) as CoachChatRequestBody;
  const athleteId = typeof body.athleteId === 'string' ? body.athleteId.trim() : '';
  const userMessage = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE_LENGTH) : '';

  if (!athleteId) {
    return res.status(400).json({
      success: false,
      code: 'coach/missing-athlete-id',
      error: 'Falta el identificador del atleta (athleteId).',
    });
  }

  if (!userMessage) {
    return res.status(400).json({
      success: false,
      code: 'coach/empty-message',
      error: 'Escribe una pregunta o selecciona un acceso rápido para consultar al coach.',
    });
  }

  // Verify strict athlete ownership (cannot query another athlete's ID)
  const verifyOwnership = deps?.verifyOwnership || verifyAthleteOwnershipDefault;
  let ownership: CoachOwnershipCheckResult;
  try {
    ownership = await verifyOwnership({ athleteId, user, rawIdToken });
  } catch (err: any) {
    console.error('[Coach LazcaKong IA] Ownership verification threw:', err?.message || err);
    return res.status(503).json({
      success: false,
      code: 'coach/ownership-check-unavailable',
      retryable: true,
      error: 'No se pudo verificar el perfil del atleta temporalmente. Intenta nuevamente.',
    });
  }

  if (!ownership.authorized) {
    return res.status(ownership.status).json({
      success: false,
      code:
        ownership.status === 403
          ? 'coach/forbidden-athlete'
          : ownership.status === 401
          ? 'coach/unauthorized'
          : 'coach/ownership-check-failed',
      retryable: ownership.status >= 500,
      error: ownership.error || 'Acceso no autorizado al atleta solicitado.',
    });
  }

  const apiKey = deps?.getApiKey ? deps.getApiKey() : getServerGeminiApiKey();
  if (!apiKey && !deps?.geminiClient) {
    return res.status(503).json({
      success: false,
      code: 'coach/missing-api-key',
      retryable: false,
      error: 'El servicio Gemini no tiene configurada la clave GEMINI_API_KEY en el servidor.',
    });
  }

  const sanitizedContext = sanitizeCoachContextValue(body.context || {}) || {};
  const systemInstruction = buildCoachSystemInstruction(sanitizedContext);

  const rawHistory = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const turn of rawHistory) {
    if (!turn || typeof turn.text !== 'string') continue;
    const text = turn.text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) continue;
    contents.push({
      role: turn.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: userMessage }],
  });

  const model = getGeminiModel();
  const client = deps?.geminiClient || createDefaultGeminiClient(apiKey!);

  try {
    const reply = await client.generateCoachReply({
      model,
      systemInstruction,
      contents,
    });

    if (!reply || !String(reply).trim()) {
      return res.status(502).json({
        success: false,
        code: 'coach/gemini-empty-response',
        retryable: true,
        error: 'Coach IA devolvió una respuesta vacía. Intenta nuevamente.',
      });
    }

    return res.status(200).json({
      success: true,
      reply: String(reply).trim(),
      model,
      athleteId,
      disclaimer:
        'Orientación de entrenamiento basada en tus registros. No diagnostica lesiones ni reemplaza evaluación médica.',
    });
  } catch (err: any) {
    const mapped = mapGeminiErrorResponse(err);
    console.error(`[Coach LazcaKong IA] Gemini upstream error (status=${mapped.status}, code=${mapped.code})`);
    return res.status(mapped.status).json({
      success: false,
      code: mapped.code,
      retryable: mapped.retryable,
      error: mapped.message,
    });
  }
}
