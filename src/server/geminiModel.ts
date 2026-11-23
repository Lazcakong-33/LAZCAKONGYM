/** Server-only model configuration. Keep API keys out of client environment variables. */
export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
}
