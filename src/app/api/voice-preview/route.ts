import {
  getConfig,
  configurationProblems,
  SpeechError,
} from "@/server/speech/config";
import { FileSpeechRepository } from "@/server/speech/cache";
import { PreviewService } from "@/server/speech/service";
import { captionPhrases } from "@/domain/speech";
export const runtime = "nodejs";
export const maxDuration = 30;
const globalPreview = globalThis as typeof globalThis & {
  groqVoicePreviewService?: PreviewService;
};
const service = (globalPreview.groqVoicePreviewService ??= new PreviewService(
  new FileSpeechRepository(),
));
const headers = { "Cache-Control": "no-store" };
export async function GET() {
  const c = getConfig();
  return Response.json(
    {
      model: c.modelId,
      voice: c.voiceId,
      problems: configurationProblems(c),
      enabled: process.env.NODE_ENV !== "production",
    },
    { headers },
  );
}
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production")
    return Response.json(
      {
        error:
          "Development preview is disabled in production. Add access controls and durable storage before enabling.",
      },
      { status: 403, headers },
    );
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    return Response.json(
      { error: "Use Generate Preview from this application." },
      { status: 403, headers },
    );
  try {
    const raw = await request.text();
    if (raw.length > 2000)
      throw new SpeechError("input", "Preview request is too large.", 400);
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      throw new SpeechError("input", "Invalid JSON request.", 400);
    }
    const { entry, status } = await service.preview(body, getConfig());
    return Response.json(
      {
        status,
        audio: `data:audio/wav;base64,${entry.speech.audio_base64}`,
        captions: captionPhrases(entry.speech, entry.identity.text),
        metadata: entry.metadata,
      },
      { headers },
    );
  } catch (e) {
    const error =
      e instanceof SpeechError
        ? e
        : new SpeechError(
            "invalid_response",
            "Preview preparation failed validation. Check configuration and cache; no automatic retry was attempted.",
          );
    return Response.json(
      {
        error: error.message,
        code: error.code,
        retryAfterSeconds: error.retryAfterSeconds,
      },
      {
        status: error.status,
        headers: {
          ...headers,
          ...(error.retryAfterSeconds
            ? { "Retry-After": String(error.retryAfterSeconds) }
            : {}),
        },
      },
    );
  }
}
