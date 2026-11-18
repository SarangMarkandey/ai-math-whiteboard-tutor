import { liveService, guard } from "@/server/lessons/runtime";
export const runtime = "nodejs";
export async function GET(
  r: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await guard(r);
    if (process.env.NODE_ENV === 'production') return new Response('Use the individual narration clips in the playback manifest.', {status:410});
    const job = await liveService().get((await params).id);
    if (!job?.audio) return new Response("Audio is not ready", { status: 404 });
    const b = Buffer.from(job.audio, "base64");
    const headers = {
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    };
    const range = r.headers.get("range");
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m)
        return new Response(null, {
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${b.length}` },
        });
      const start = m[1] ? Number(m[1]) : Math.max(0, b.length - Number(m[2])),
        end = m[1]
          ? m[2]
            ? Math.min(Number(m[2]), b.length - 1)
            : b.length - 1
          : b.length - 1;
      if (start > end || start >= b.length)
        return new Response(null, {
          status: 416,
          headers: { ...headers, "Content-Range": `bytes */${b.length}` },
        });
      const slice = b.subarray(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${b.length}`,
          "Content-Length": String(slice.length),
        },
      });
    }
    return new Response(b, {
      headers: { ...headers, "Content-Length": String(b.length) },
    });
  } catch {
    return new Response("Audio storage is unavailable", { status: 503 });
  }
}
