import "server-only";
import { wavDuration, normalizeWav, type Speech } from "../../domain/speech";
import { SpeechError, type SpeechConfig } from "./config";
export type Generated = {
  speech: Speech;
  metadata: {
    requestId?: string;
    remainingRequests?: string;
    remainingTokens?: string;
    resetRequests?: string;
    resetTokens?: string;
  };
};
export function validateAudio(base64: string) {
  if (
    base64.length > 8_000_000 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    throw new SpeechError("invalid_audio", "Invalid WAV audio returned.");
  try {
    return wavDuration(Buffer.from(base64, "base64"));
  } catch (e) {
    throw new SpeechError("invalid_audio", `Provider WAV validation failed: ${e instanceof Error?e.message:"invalid audio"}. No automatic regeneration was attempted.`);
  }
}
export async function generateSpeech(
  text: string,
  c: SpeechConfig,
  fetcher: typeof fetch = fetch,
  timeoutMs = 25000,
): Promise<Generated> {
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetcher("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: c.modelId,
        voice: c.voiceId,
        input: text,
        response_format: c.outputFormat,
      }),
      signal: controller.signal,
      cache: "no-store",
      redirect: "error",
    });
    if (!r.ok) {
      // Recognize only an allowlisted code; never expose raw provider messages.
      const detail:unknown = await r.json().catch(()=>null);
      if (typeof detail === "object" && detail !== null && "error" in detail) {
        const error=detail.error;
        if(typeof error === "object" && error !== null && "code" in error){
          if(error.code === "model_permission_blocked_org") throw new SpeechError("model_permission_blocked_org", "Orpheus is blocked by your Groq organization. An organization Owner must allow canopylabs/orpheus-v1-english in Organization Limits for the organization that owns this API key. Keep the Free Plan; do not enable billing. Then explicitly retry the preview.",403);
          if(error.code === "model_permission_blocked_project") throw new SpeechError("model_permission_blocked_project", "Orpheus is blocked by your Groq project. A project admin must allow canopylabs/orpheus-v1-english in Project Limits. Organization-level permission must also allow it. Keep the Free Plan and explicitly retry after the change.",403);
        }
        if(typeof error === "object" && error !== null && "code" in error && error.code === "model_terms_required")
          throw new SpeechError("model_terms_required", "Your Groq organization admin must review and accept Orpheus model terms in the Groq Playground for the organization that owns this API key. Then click Generate Preview again. Do not enable billing or upgrade.",403);
      }
      const retry = Math.max(1, Number(r.headers.get("retry-after")) || 60);
      throw new SpeechError(
        "provider_error",
        r.status === 429
          ? `Groq rate limit reached. Wait at least ${retry} seconds and check your account limits before retrying.`
          : r.status === 401
            ? "Invalid credentials. Check GROQ_API_KEY."
            : r.status === 403
              ? "Groq denied access. Check model permissions and Free Plan availability; do not upgrade."
              : r.status === 404
                ? "Orpheus model unavailable. Check Groq model access; no fallback was used."
                : `Groq rejected speech (HTTP ${r.status}). Check Free Plan quota and model access; do not enable billing.`,
        r.status === 429 ? 429 : 502,
        r.status === 429 ? retry : 0,
      );
    }
    const b = Buffer.from(await r.arrayBuffer());
    validateAudio(b.toString("base64"));
    const normalized=normalizeWav(b);
    const audio_base64=Buffer.from(normalized.bytes).toString("base64"),durationSeconds=normalized.durationSeconds;
    const safe = (name: string) => {
      const s = r.headers.get(name);
      return s &&
        s.length <= 100 &&
        /^[\w.:-]+$/.test(s) &&
        !s.includes(c.apiKey)
        ? s
        : undefined;
    };
    return {
      speech: { audio_base64, durationSeconds, format: "wav" },
      metadata: {
        requestId: safe("x-request-id"),
        remainingRequests: safe("x-ratelimit-remaining-requests"),
        remainingTokens: safe("x-ratelimit-remaining-tokens"),
        resetRequests: safe("x-ratelimit-reset-requests"),
        resetTokens: safe("x-ratelimit-reset-tokens"),
      },
    };
  } catch (e) {
    if (e instanceof SpeechError) throw e;
    throw new SpeechError(
      controller.signal.aborted ? "timeout" : "network",
      "Groq speech request failed or timed out. Usage may be ambiguous. Check the dashboard before explicitly retrying. No automatic retry or fallback was used.",
    );
  } finally {
    clearTimeout(timer);
  }
}
