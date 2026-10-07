import { translateChapter } from "@/lib/pipeline/translate";
import { reviewChapter } from "@/lib/pipeline/review";
import { describeError, hasApiKey } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

/** Streams progress as NDJSON: translation chunks, then the post-translation review. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chapterId = Number(id);
  const body = (await req.json().catch(() => ({}))) as { styleId?: number; model?: string; review?: boolean };

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        if (!hasApiKey()) throw new Error("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY");
        for await (const ev of translateChapter(chapterId, { styleId: body.styleId, model: body.model })) send(ev);
        if (body.review !== false) {
          send({ type: "review_start" });
          try {
            const r = await reviewChapter(chapterId);
            send({ type: "review_done", proposed: r.proposed });
          } catch (err) {
            send({ type: "review_error", message: describeError(err) });
          }
        }
      } catch (err) {
        send({ type: "error", message: describeError(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
