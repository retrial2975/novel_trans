import "server-only";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildExtractUserMessage, EXTRACT_SYSTEM, ExtractedTerms } from "../extract-shared";
import { getClient, MODELS, recordUsage, RefusalError } from "../ai";
import { applyExtractedTerms, knownTermsFor } from "./apply";

export async function extractTerms(chapterId: number) {
  const chapter = getDb().select().from(schema.chapters).where(eq(schema.chapters.id, chapterId)).get();
  if (!chapter) throw new Error("ไม่พบตอนนี้");

  // Include pending terms so re-running extraction doesn't propose duplicates.
  const { knownHere } = knownTermsFor(chapter);

  const model = MODELS.small;
  const response = await getClient().messages.parse({
    model,
    max_tokens: 16000,
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: buildExtractUserMessage(knownHere, chapter.titleZh, chapter.textZh) }],
    output_config: { format: zodOutputFormat(ExtractedTerms) },
  });
  recordUsage({ kind: "extract", model, usage: response.usage, novelId: chapter.novelId, chapterId });
  if (response.stop_reason === "refusal") throw new RefusalError(response.stop_details?.category);
  if (response.stop_reason === "max_tokens") throw new Error("ผลลัพธ์ยาวเกินไป (max_tokens) — ลองแบ่งตอนให้สั้นลง");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("อ่านผลลัพธ์จากโมเดลไม่ได้");

  return applyExtractedTerms(chapter, parsed.terms);
}
