import "server-only";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { GlossaryMatcher, type GlossaryEntry } from "./glossary";
import { resolveRelationships } from "./pronouns";
import type { ChapterContext, PromptCharacter, PromptPronoun } from "./prompt";

const { terms, termAliases, characters, relationships, chapters, chapterSummaries, stylePresets, novels } = schema;

export function loadGlossary(novelId: number, status: "approved" | "all" = "approved"): GlossaryEntry[] {
  const db = getDb();
  const rows = db
    .select()
    .from(terms)
    .where(status === "all" ? eq(terms.novelId, novelId) : and(eq(terms.novelId, novelId), eq(terms.status, "approved")))
    .all();
  if (!rows.length) return [];
  const aliases = db
    .select()
    .from(termAliases)
    .where(inArray(termAliases.termId, rows.map((r) => r.id)))
    .all();
  return rows.map((t) => ({
    termId: t.id,
    zh: t.zh,
    th: t.th,
    pinyin: t.pinyin,
    category: t.category,
    notes: t.notes,
    aliases: aliases.filter((a) => a.termId === t.id).map((a) => ({ zh: a.aliasZh, th: a.aliasTh })),
  }));
}

/** Everything needed to prompt for one chapter, restricted to what actually appears in it. */
export function buildChapterContext(chapterId: number, styleId?: number | null) {
  const db = getDb();
  const chapter = db.select().from(chapters).where(eq(chapters.id, chapterId)).get();
  if (!chapter) throw new Error("ไม่พบตอนนี้");
  const novel = db.select().from(novels).where(eq(novels.id, chapter.novelId)).get()!;

  const resolvedStyleId = styleId ?? novel.defaultStyleId;
  const style =
    (resolvedStyleId && db.select().from(stylePresets).where(eq(stylePresets.id, resolvedStyleId)).get()) ||
    db.select().from(stylePresets).orderBy(asc(stylePresets.id)).get();
  if (!style) throw new Error("ยังไม่มี style preset");

  const allGlossary = loadGlossary(novel.id);
  const matcher = new GlossaryMatcher(allGlossary);
  const presentIds = new Set(matcher.termIdsIn(`${chapter.titleZh ?? ""}\n${chapter.textZh}`));
  const glossary = allGlossary.filter((g) => presentIds.has(g.termId));

  const charRows = presentIds.size
    ? db
        .select({ c: characters, t: terms })
        .from(characters)
        .innerJoin(terms, eq(terms.id, characters.termId))
        .where(and(inArray(characters.termId, [...presentIds]), eq(terms.status, "approved")))
        .all()
    : [];
  const promptChars: PromptCharacter[] = charRows.map(({ c, t }) => ({
    id: c.id,
    zh: t.zh,
    th: t.th,
    gender: c.gender,
    role: c.role,
    description: c.description,
    defaultSelfPronoun: c.defaultSelfPronoun,
  }));
  const charIds = promptChars.map((c) => c.id);
  const nameOf = new Map(promptChars.map((c) => [c.id, c.th]));

  const relRows = charIds.length
    ? db
        .select()
        .from(relationships)
        .where(
          and(
            eq(relationships.status, "approved"),
            inArray(relationships.speakerId, charIds),
            inArray(relationships.listenerId, charIds),
          ),
        )
        .all()
    : [];
  const pronouns: PromptPronoun[] = resolveRelationships(relRows, chapter.number).map((r) => ({
    speakerTh: nameOf.get(r.speakerId)!,
    listenerTh: nameOf.get(r.listenerId)!,
    relation: r.relation,
    selfPronoun: r.selfPronoun,
    addressTerm: r.addressTerm,
    notes: r.notes,
  }));

  const summaryCount = Number(process.env.SUMMARY_CHAPTERS ?? 3);
  const previousSummaries = db
    .select({ number: chapters.number, summary: chapterSummaries.summary })
    .from(chapterSummaries)
    .innerJoin(chapters, eq(chapters.id, chapterSummaries.chapterId))
    .where(and(eq(chapters.novelId, novel.id), lt(chapters.number, chapter.number)))
    .orderBy(desc(chapters.number))
    .limit(summaryCount)
    .all()
    .reverse();

  const ctx: ChapterContext = {
    styleInstructions: style.instructions,
    examples: style.examples,
    glossary,
    characters: promptChars,
    pronouns,
    previousSummaries,
    chapterNumber: chapter.number,
    chapterTitleZh: chapter.titleZh,
  };
  return { novel, chapter, style, ctx, matcher, characters: promptChars };
}
