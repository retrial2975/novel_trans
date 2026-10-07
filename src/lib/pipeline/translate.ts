import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildChapterContext } from "../novel-context";
import { buildChapterBlock, buildChunkMessage, buildStyleBlock } from "../prompt";
import { chunkParagraphs, parseNumberedOutput, splitParagraphs } from "../text";
import { checkConsistency } from "../check";
import { EFFORT, getClient, MODELS, recordUsage, RefusalError, fallbacksEnabled } from "../ai";

export type TranslateEvent =
  | { type: "start"; chunks: number; paragraphs: number }
  | { type: "chunk"; index: number; done: number }
  | { type: "saved"; translationId: number; version: number; issues: number }
  | { type: "error"; message: string };

const PREVIOUS_TAIL = 2;

async function callModel(opts: {
  model: string;
  system: Anthropic.Beta.BetaTextBlockParam[];
  message: string;
  novelId: number;
  chapterId: number;
}): Promise<string> {
  const fallbacks = fallbacksEnabled(opts.model);
  const stream = getClient().beta.messages.stream({
    model: opts.model,
    max_tokens: 32000,
    system: opts.system,
    output_config: { effort: EFFORT },
    messages: [{ role: "user", content: opts.message }],
    ...(fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });
  const res = await stream.finalMessage();
  recordUsage({ kind: "translate", model: res.model, usage: res.usage, novelId: opts.novelId, chapterId: opts.chapterId });
  if (res.stop_reason === "refusal") throw new RefusalError(res.stop_details?.category);
  if (res.stop_reason === "max_tokens") throw new Error("คำแปลยาวเกิน max_tokens — ลดขนาดช่วง (CHUNK_TARGET)");
  return res.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

export async function* translateChapter(
  chapterId: number,
  opts: { styleId?: number | null; model?: string } = {},
): AsyncGenerator<TranslateEvent> {
  const db = getDb();
  const { chapter, style, ctx, matcher } = buildChapterContext(chapterId, opts.styleId);
  const model = opts.model || MODELS.translate;

  const paragraphs = splitParagraphs(chapter.textZh);
  const chunks = chunkParagraphs(paragraphs, {
    target: Number(process.env.CHUNK_TARGET ?? 1800),
    max: Number(process.env.CHUNK_MAX ?? 2500),
  });
  yield { type: "start", chunks: chunks.length, paragraphs: paragraphs.length };

  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: buildStyleBlock(ctx), cache_control: { type: "ephemeral" } },
    { type: "text", text: buildChapterBlock(ctx), cache_control: { type: "ephemeral" } },
  ];

  const segments: string[] = new Array(paragraphs.length).fill("");
  let titleTh: string | null = null;

  for (const [ci, chunk] of chunks.entries()) {
    const previous =
      chunk.start > 0
        ? paragraphs
            .slice(Math.max(0, chunk.start - PREVIOUS_TAIL), chunk.start)
            .map((zh, i) => ({ zh, th: segments[Math.max(0, chunk.start - PREVIOUS_TAIL) + i] }))
        : undefined;

    let message = buildChunkMessage({ start: chunk.start, paragraphs: chunk.paragraphs, previous });
    if (ci === 0 && chapter.titleZh) {
      message += `\n\nและแปลชื่อตอนนี้ด้วย ให้ขึ้นต้นบรรทัดด้วย [0]\n[0] ${chapter.titleZh}`;
    }

    const parsed = parseNumberedOutput(
      await callModel({ model, system, message, novelId: chapter.novelId, chapterId }),
    );
    if (ci === 0 && parsed.has(0)) titleTh = parsed.get(0)!;

    let missing: number[] = [];
    chunk.paragraphs.forEach((_, i) => {
      const idx = chunk.start + i;
      const th = parsed.get(idx + 1);
      if (th) segments[idx] = th;
      else missing.push(idx);
    });

    // One retry for paragraphs the model skipped or merged.
    if (missing.length) {
      const retry = parseNumberedOutput(
        await callModel({
          model,
          system,
          message: `แปลเฉพาะย่อหน้าต่อไปนี้ ตอบโดยขึ้นต้นด้วยหมายเลขเดิม:\n\n${missing
            .map((idx) => `[${idx + 1}] ${paragraphs[idx]}`)
            .join("\n")}`,
          novelId: chapter.novelId,
          chapterId,
        }),
      );
      missing = missing.filter((idx) => {
        const th = retry.get(idx + 1);
        if (th) segments[idx] = th;
        return !th;
      });
    }
    yield { type: "chunk", index: ci, done: ci + 1 };
  }

  const issues = checkConsistency(matcher, paragraphs, segments);
  const last = db
    .select({ version: schema.translations.version })
    .from(schema.translations)
    .where(eq(schema.translations.chapterId, chapterId))
    .orderBy(desc(schema.translations.version))
    .get();
  const version = (last?.version ?? 0) + 1;

  const saved = db.transaction((tx) => {
    const row = tx
      .insert(schema.translations)
      .values({
        chapterId,
        styleId: style.id,
        segments,
        textTh: segments.join("\n\n"),
        model,
        version,
        issues,
      })
      .returning()
      .get();
    tx.update(schema.chapters)
      .set({ status: "translated", ...(titleTh ? { titleTh } : {}) })
      .where(eq(schema.chapters.id, chapterId))
      .run();
    return row;
  });

  yield { type: "saved", translationId: saved.id, version, issues: issues.length };
}
