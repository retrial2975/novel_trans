"use server";

import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildChapterContext } from "@/lib/novel-context";
import { splitParagraphs } from "@/lib/text";
import {
  buildManualExtractPrompt,
  buildManualTranslatePrompt,
  parseManualTerms,
  parseManualTranslation,
} from "@/lib/manual";
import { applyExtractedTerms, applyReview, knownTermsFor, saveTranslation } from "@/lib/pipeline/apply";

const MANUAL_MODEL = "claude-chat (manual)";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (err: unknown): { ok: false; error: string } => ({
  ok: false,
  error: err instanceof Error ? err.message : String(err),
});

function getChapter(chapterId: number) {
  const chapter = getDb().select().from(schema.chapters).where(eq(schema.chapters.id, chapterId)).get();
  if (!chapter) throw new Error("ไม่พบตอนนี้");
  return chapter;
}

export async function getManualExtractPrompt(chapterId: number): Promise<Result<string>> {
  try {
    const chapter = getChapter(chapterId);
    const { knownHere } = knownTermsFor(chapter);
    return { ok: true, data: buildManualExtractPrompt(knownHere, chapter.titleZh, chapter.textZh) };
  } catch (err) {
    return fail(err);
  }
}

export async function importManualTerms(chapterId: number, answer: string): Promise<Result<{ added: string[] }>> {
  try {
    const chapter = getChapter(chapterId);
    return { ok: true, data: applyExtractedTerms(chapter, parseManualTerms(answer)) };
  } catch (err) {
    return fail(err);
  }
}

/** Paragraph indexes still empty in the latest translation (all of them if none exists). */
function missingParagraphs(chapterId: number, total: number): number[] {
  const latest = getDb()
    .select({ segments: schema.translations.segments })
    .from(schema.translations)
    .where(eq(schema.translations.chapterId, chapterId))
    .orderBy(desc(schema.translations.version))
    .get();
  if (!latest) return [...Array(total).keys()];
  return [...Array(total).keys()].filter((i) => !latest.segments[i]);
}

export async function getManualTranslatePrompt(
  chapterId: number,
  styleId: number | null,
  onlyMissing = false,
): Promise<Result<{ prompt: string; paragraphs: number }>> {
  try {
    const { chapter, ctx } = buildChapterContext(chapterId, styleId);
    const paragraphs = splitParagraphs(chapter.textZh);
    const only = onlyMissing ? missingParagraphs(chapterId, paragraphs.length) : undefined;
    if (only && only.length === 0) throw new Error("ไม่มีย่อหน้าที่ขาด");
    return {
      ok: true,
      data: {
        prompt: buildManualTranslatePrompt({ ctx, paragraphs, only, titleZh: chapter.titleZh }),
        paragraphs: only?.length ?? paragraphs.length,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

export async function importManualTranslation(
  chapterId: number,
  styleId: number | null,
  answer: string,
  merge: boolean,
): Promise<
  Result<{ received: number; missing: number[]; issues: number; summary: boolean; proposed: number; version: number }>
> {
  try {
    const parsed = parseManualTranslation(answer);
    if (parsed.segments.size === 0 && !parsed.summary) {
      throw new Error("ไม่พบย่อหน้าที่มีเลขกำกับ เช่น [1] ... ในข้อความที่วาง");
    }
    const segments: (string | undefined)[] = [];
    for (const [i, th] of parsed.segments) segments[i] = th;

    let saved = null;
    if (parsed.segments.size > 0) {
      saved = saveTranslation({
        chapterId,
        styleId,
        segments,
        model: MANUAL_MODEL,
        titleTh: parsed.titleTh,
        mergeIntoLatest: merge,
      });
    }
    let proposed = 0;
    if (parsed.summary || parsed.changes.length) {
      proposed = applyReview(chapterId, parsed.summary, parsed.changes).proposed;
    }
    const total = splitParagraphs(getChapter(chapterId).textZh).length;
    return {
      ok: true,
      data: {
        received: parsed.segments.size,
        missing: saved?.missing ?? missingParagraphs(chapterId, total),
        issues: saved?.issues ?? 0,
        summary: Boolean(parsed.summary),
        proposed,
        version: saved?.translation.version ?? 0,
      },
    };
  } catch (err) {
    return fail(err);
  }
}
