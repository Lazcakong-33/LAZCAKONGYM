/** Server-only model configuration. Keep API keys out of client environment variables. */
export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
}

/**
 * One server-only source for the Gemini Developer API credential.
 * Never expose the value to VITE_* variables, browser code or diagnostics.
 */
export function getServerGeminiApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // Explicit opt-in for a deployment that must never call the billable Gemini API.
  // Existing deployments keep their current behavior until the flag is enabled.
  if (env.LAZCAKONG_ZERO_COST_MODE?.trim().toLowerCase() === 'true') return undefined;
  const candidate = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || '';
  return candidate || undefined;
}
