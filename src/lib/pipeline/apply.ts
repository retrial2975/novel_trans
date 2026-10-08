import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Chapter } from "@/db/schema";
import { GlossaryMatcher } from "../glossary";
import { buildChapterContext, loadGlossary } from "../novel-context";
import { checkConsistency } from "../check";
import { splitParagraphs } from "../text";
import type { ExtractedTerm, RelationshipChange } from "../extract-shared";

/** Glossary entries (approved + pending) that occur in the chapter, plus every known Chinese string. */
export function knownTermsFor(chapter: Chapter) {
  const known = loadGlossary(chapter.novelId, "all");
  const matcher = new GlossaryMatcher(known);
  const presentIds = new Set(matcher.termIdsIn(chapter.textZh));
  return {
    knownHere: known.filter((k) => presentIds.has(k.termId)),
    knownStrings: new Set(known.flatMap((k) => [k.zh, ...k.aliases.map((a) => a.zh)])),
  };
}

/** Insert proposed terms as "pending" (skipping known or non-occurring ones) and update chapter status. */
export function applyExtractedTerms(chapter: Chapter, proposed: ExtractedTerm[]) {
  const db = getDb();
  const { knownStrings } = knownTermsFor(chapter);
  const added: string[] = [];
  db.transaction((tx) => {
    for (const t of proposed) {
      const zh = t.zh.trim();
      if (!zh || !t.th.trim() || knownStrings.has(zh) || !chapter.textZh.includes(zh)) continue;
      knownStrings.add(zh);
      const term = tx
        .insert(schema.terms)
        .values({
          novelId: chapter.novelId,
          zh,
          th: t.th.trim(),
          pinyin: t.pinyin.trim() || null,
          category: t.category,
          notes: t.notes.trim() || null,
          status: "pending",
          firstChapter: chapter.number,
        })
        .returning()
        .get();
      if (t.category === "character") {
        tx.insert(schema.characters)
          .values({
            novelId: chapter.novelId,
            termId: term.id,
            gender: t.gender.trim() || null,
            role: t.role.trim() || null,
          })
          .run();
      }
      added.push(zh);
    }
    tx.update(schema.chapters)
      .set({ status: added.length ? "terms_pending" : chapter.status === "translated" ? "translated" : "ready" })
      .where(eq(schema.chapters.id, chapter.id))
      .run();
  });
  return { added };
}

/**
 * Store a translation. With `mergeIntoLatest`, only the given (non-empty) segments overwrite the
 * latest version in place — used when a chat answer arrives in several pieces.
 */
export function saveTranslation(opts: {
  chapterId: number;
  styleId: number | null;
  segments: (string | undefined)[];
  model: string;
  titleTh?: string | null;
  mergeIntoLatest?: boolean;
}) {
  const db = getDb();
  const chapter = db.select().from(schema.chapters).where(eq(schema.chapters.id, opts.chapterId)).get();
  if (!chapter) throw new Error("ไม่พบตอนนี้");
  const paragraphs = splitParagraphs(chapter.textZh);
  const matcher = new GlossaryMatcher(loadGlossary(chapter.novelId));

  const latest = db
    .select()
    .from(schema.translations)
    .where(eq(schema.translations.chapterId, opts.chapterId))
    .orderBy(desc(schema.translations.version))
    .get();
  const base = opts.mergeIntoLatest && latest ? latest.segments : [];
  const segments = paragraphs.map((_, i) => opts.segments[i]?.trim() || base[i] || "");
  const issues = checkConsistency(matcher, paragraphs, segments);
  const missing = segments.flatMap((s, i) => (s ? [] : [i]));

  return db.transaction((tx) => {
    let row;
    if (opts.mergeIntoLatest && latest) {
      row = tx
        .update(schema.translations)
        .set({ segments, textTh: segments.join("\n\n"), issues })
        .where(eq(schema.translations.id, latest.id))
        .returning()
        .get();
    } else {
      row = tx
        .insert(schema.translations)
        .values({
          chapterId: opts.chapterId,
          styleId: opts.styleId,
          segments,
          textTh: segments.join("\n\n"),
          model: opts.model,
          version: (latest?.version ?? 0) + 1,
          issues,
        })
        .returning()
        .get();
    }
    tx.update(schema.chapters)
      .set({ status: "translated", ...(opts.titleTh ? { titleTh: opts.titleTh } : {}) })
      .where(eq(schema.chapters.id, opts.chapterId))
      .run();
    return { translation: row, missing, issues: issues.length };
  });
}

/** Save the chapter summary and turn suggested pronoun changes into pending relationship rows. */
export function applyReview(chapterId: number, summary: string | null, changes: RelationshipChange[]) {
  const db = getDb();
  const { chapter, ctx, characters } = buildChapterContext(chapterId);
  const idByName = new Map(characters.map((c) => [c.th, c.id]));
  let proposed = 0;
  db.transaction((tx) => {
    if (summary?.trim()) {
      tx.insert(schema.chapterSummaries)
        .values({ chapterId, summary: summary.trim() })
        .onConflictDoUpdate({ target: schema.chapterSummaries.chapterId, set: { summary: summary.trim() } })
        .run();
    }

    // Replace earlier pending proposals made for this chapter.
    tx.delete(schema.relationships)
      .where(
        and(
          eq(schema.relationships.novelId, chapter.novelId),
          eq(schema.relationships.status, "pending"),
          eq(schema.relationships.validFromChapter, chapter.number),
        ),
      )
      .run();

    for (const r of changes) {
      const speakerId = idByName.get(r.speaker.trim());
      const listenerId = idByName.get(r.listener.trim());
      if (!speakerId || !listenerId || speakerId === listenerId) continue;
      const current = ctx.pronouns.find((p) => p.speakerTh === r.speaker.trim() && p.listenerTh === r.listener.trim());
      if (current && current.selfPronoun === r.self_pronoun && current.addressTerm === r.address_term) continue;
      tx.insert(schema.relationships)
        .values({
          novelId: chapter.novelId,
          speakerId,
          listenerId,
          relation: r.relation || null,
          selfPronoun: r.self_pronoun || null,
          addressTerm: r.address_term || null,
          validFromChapter: chapter.number,
          notes: r.reason || null,
          status: "pending",
        })
        .run();
      proposed++;
    }
  });
  return { proposed };
}
