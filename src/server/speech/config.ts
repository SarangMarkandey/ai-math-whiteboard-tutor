import "server-only";
export class SpeechError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 502,
    public retryAfterSeconds = 0,
  ) {
    super(message);
  }
}
export const speechSettings = {
  version: 2,
  provider: "groq",
  outputFormat: "wav",
  voiceId: "hannah",
  modelId: "canopylabs/orpheus-v1-english",
} as const;
export function getConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    ...speechSettings,
    modelId: env.GROQ_TTS_MODEL?.trim() || speechSettings.modelId,
    voiceId: env.GROQ_TTS_VOICE?.trim() || speechSettings.voiceId,
    apiKey: env.GROQ_API_KEY?.trim() ?? "",
  };
}
export type SpeechConfig = ReturnType<typeof getConfig>;
export function configurationProblems(c: SpeechConfig) {
  return c.apiKey ? [] : ["Missing GROQ_API_KEY"];
}
