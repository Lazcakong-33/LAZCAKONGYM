import { auth } from '../firebase.ts';
import { safeApiFetchJson } from './safeApiFetch.ts';

export interface CoachServiceDiagnostic {
  status: 'ready' | 'login_required' | 'missing_key' | 'forbidden' | 'server_unavailable';
  message: string;
  model?: string;
  /** True only means the key is configured, not that Gemini was contacted. */
  readyForLiveRequest: boolean;
}

export async function checkCoachServiceStatus(athleteId: string): Promise<CoachServiceDiagnostic> {
  const user = auth.currentUser;
  if (!user) {
    return {
      status: 'login_required',
      message: 'Inicia sesión con Firebase Authentication para que el Coach IA pueda usar tu perfil.',
      readyForLiveRequest: false,
    };
  }
  let token: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Firebase Auth may hang on mobile WebViews with an interrupted connection.
    // The status check must not become another infinite spinner.
    token = await Promise.race([
      user.getIdToken(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Tiempo de espera de autenticación excedido.')),
          8_000
        );
      }),
    ]);
  } catch (err: any) {
    return {
      status: 'login_required',
      message: String(err?.message || '').includes('Tiempo de espera')
        ? 'Firebase demoró demasiado en validar la sesión. Revisa internet y usa Comprobar conexión nuevamente.'
        : 'No se pudo obtener una sesión válida de Firebase. Vuelve a iniciar sesión.',
      readyForLiveRequest: false,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
  const res = await safeApiFetchJson<{
    success?: boolean;
    athleteAuthorized?: boolean;
    geminiConfigured?: boolean;
    provider?: string;
    readyForLiveRequest?: boolean;
    model?: string;
    message?: string;
    error?: string;
  }>('/api/coach/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ athleteId }),
    timeoutMs: 12_000,
  });
  if (!res.ok || !res.data?.success) {
    return {
      status: res.status === 401 ? 'login_required' : 'server_unavailable',
      message: res.status === 404
        ? 'El servidor publicado aún no tiene el diagnóstico del Coach. Falta desplegar el backend actualizado.'
        : res.data?.error || res.error || 'No responde el servidor del Coach IA.',
      readyForLiveRequest: false,
    };
  }
  const data = res.data;
  if (!data.athleteAuthorized) {
    return {
      status: 'forbidden',
      message: data.message || 'Tu cuenta todavía no está vinculada correctamente con este perfil de atleta.',
      readyForLiveRequest: false,
    };
  }
  if (data.provider === 'workers-ai') {
    const ready = data.readyForLiveRequest === true;
    return {
      status: ready ? 'ready' : 'server_unavailable',
      message: ready ? 'Sesión verificada. Puedes enviar una pregunta al Coach.' : 'La IA de Cloudflare no está disponible.',
      model: data.model,
      readyForLiveRequest: ready,
    };
  }
  if (!data.geminiConfigured) {
    return {
      status: 'missing_key',
      message: 'Falta configurar GEMINI_API_KEY o GOOGLE_API_KEY como secreto privado del servidor. El Coach no puede responder todavía.',
      readyForLiveRequest: false,
    };
  }
  return {
    status: 'ready',
    message: 'Sesión y clave configuradas. Envía una pregunta para comprobar que Gemini responde.',
    model: data.model,
    readyForLiveRequest: true,
  };
}
