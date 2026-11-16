export interface SafeApiFetchResult<T = Record<string, any>> {
  ok: boolean;
  status: number;
  isJson: boolean;
  isHtml: boolean;
  data: T | null;
  error?: string;
}

function isHtmlPayload(contentType: string, rawText: string): boolean {
  const ct = contentType.toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml+xml')) {
    return true;
  }
  const trimmed = rawText.trimStart().toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.startsWith('<body')
  );
}

function buildHtmlResponseErrorMessage(status: number, responseUrl: string, rawText: string): string {
  const lowerUrl = String(responseUrl || '').toLowerCase();
  const lowerBody = rawText.toLowerCase();

  if (
    lowerUrl.includes('__cookie_check') ||
    lowerUrl.includes('accounts.google.com') ||
    lowerBody.includes('__cookie_check') ||
    lowerBody.includes('_aistudio-iframe')
  ) {
    return 'La sesión del navegador móvil o PWA requiere revalidación de cookies. Abre la app en Chrome o Safari (no en navegador integrado), recarga e intenta nuevamente.';
  }

  if (status === 404 || lowerBody.includes('cannot post /api') || lowerBody.includes('cannot get /api')) {
    return 'El servidor de autenticación aún no tiene esta ruta disponible en la versión desplegada. Es necesario actualizar/republicar la aplicación.';
  }

  if (lowerBody.includes('lazcakon') || lowerBody.includes('<div id="root">')) {
    return 'La petición al servidor devolvió la página principal en lugar de JSON. Recarga la app o verifica que el backend actualizado esté publicado.';
  }

  return `El servidor respondió con HTML inesperado (HTTP ${status || 'desconocido'}) en lugar de JSON. Recarga la página e intenta nuevamente.`;
}

/**
 * Performs fetch expecting a JSON API response.
 * Validates HTTP status, Content-Type, and raw payload before parsing JSON so HTML
 * error/proxy/fallback pages never trigger `Unexpected token '<', "<!DOCTYPE"...`.
 */
export async function safeApiFetchJson<T = Record<string, any>>(
  url: string,
  init: RequestInit = {}
): Promise<SafeApiFetchResult<T>> {
  try {
    const mergedHeaders = new Headers(init.headers || {});
    if (!mergedHeaders.has('Accept')) {
      mergedHeaders.set('Accept', 'application/json');
    }

    const res = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: mergedHeaders,
    });

    const contentType = res.headers.get('content-type') || '';
    const rawText = await res.text();
    const htmlDetected = isHtmlPayload(contentType, rawText);

    if (htmlDetected) {
      const friendly = buildHtmlResponseErrorMessage(res.status, res.url || url, rawText);
      console.warn(`[safeApiFetchJson] HTML received from ${url} (HTTP ${res.status}, content-type: ${contentType || 'none'})`);
      return {
        ok: false,
        status: res.status,
        isJson: false,
        isHtml: true,
        data: null,
        error: friendly,
      };
    }

    if (!rawText.trim()) {
      return {
        ok: res.ok,
        status: res.status,
        isJson: false,
        isHtml: false,
        data: null,
        error: res.ok ? undefined : `El servidor respondió sin contenido (HTTP ${res.status}).`,
      };
    }

    const ctLooksJson = contentType.toLowerCase().includes('json');
    let parsed: T | null = null;
    try {
      parsed = JSON.parse(rawText) as T;
    } catch {
      console.warn(
        `[safeApiFetchJson] Invalid JSON from ${url} (HTTP ${res.status}, ct: ${contentType || 'none'}, looksJson: ${ctLooksJson})`
      );
      return {
        ok: false,
        status: res.status,
        isJson: false,
        isHtml: false,
        data: null,
        error: `Respuesta inválida del servidor (HTTP ${res.status}). Intenta recargar la aplicación.`,
      };
    }

    const serverError =
      parsed && typeof parsed === 'object'
        ? ((parsed as any).error as string | undefined) || ((parsed as any).message as string | undefined)
        : undefined;

    return {
      ok: res.ok,
      status: res.status,
      isJson: true,
      isHtml: false,
      data: parsed,
      error: res.ok ? undefined : serverError || `Error del servidor (HTTP ${res.status}).`,
    };
  } catch (err: any) {
    const rawMsg = String(err?.message || '');
    const isNetworkErr =
      rawMsg.toLowerCase().includes('failed to fetch') ||
      rawMsg.toLowerCase().includes('networkerror') ||
      rawMsg.toLowerCase().includes('load failed');

    return {
      ok: false,
      status: 0,
      isJson: false,
      isHtml: false,
      data: null,
      error: isNetworkErr
        ? 'No se pudo conectar con el servidor. Verifica tu conexión a internet e intenta nuevamente.'
        : rawMsg || 'Error de comunicación con el servidor.',
    };
  }
}
