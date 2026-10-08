"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, max } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { TERM_CATEGORIES, type TermCategory } from "@/db/schema";
import { splitImportedChapters } from "@/lib/text";

const { novels, chapters, terms, termAliases, characters, relationships, stylePresets, translations } = schema;

const str = (fd: FormData, key: string) => {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const optStr = (fd: FormData, key: string) => str(fd, key) || null;
const num = (fd: FormData, key: string) => {
  const v = Number(str(fd, key));
  return Number.isFinite(v) ? v : null;
};
const category = (fd: FormData): TermCategory => {
  const c = str(fd, "category") as TermCategory;
  return TERM_CATEGORIES.includes(c) ? c : "other";
};

// ---------- novels ----------

export async function createNovel(fd: FormData) {
  const titleZh = str(fd, "titleZh");
  if (!titleZh) return;
  const row = getDb()
    .insert(novels)
    .values({
      titleZh,
      titleTh: optStr(fd, "titleTh"),
      defaultStyleId: num(fd, "defaultStyleId"),
      translateMode: str(fd, "translateMode") === "manual" ? "manual" : "api",
    })
    .returning()
    .get();
  redirect(`/novels/${row.id}`);
}

export async function updateNovel(fd: FormData) {
  const id = num(fd, "id")!;
  getDb()
    .update(novels)
    .set({
      titleZh: str(fd, "titleZh"),
      titleTh: optStr(fd, "titleTh"),
      defaultStyleId: num(fd, "defaultStyleId") || null,
      translateMode: str(fd, "translateMode") === "manual" ? "manual" : "api",
    })
    .where(eq(novels.id, id))
    .run();
  revalidatePath(`/novels/${id}`);
}

export async function deleteNovel(fd: FormData) {
  getDb().delete(novels).where(eq(novels.id, num(fd, "id")!)).run();
  redirect("/");
}

// ---------- chapters ----------

export async function importChapters(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  const db = getDb();
  let text = str(fd, "text");
  const file = fd.get("file");
  if (file instanceof File && file.size > 0) text = await file.text();
  if (!text) return;

  const startAt = num(fd, "number");
  const manualTitle = optStr(fd, "titleZh");
  const parts = splitImportedChapters(text);
  let next = (db.select({ n: max(chapters.number) }).from(chapters).where(eq(chapters.novelId, novelId)).get()?.n ?? 0) + 1;
  if (startAt) next = startAt;

  db.transaction((tx) => {
    for (const p of parts) {
      const number = parts.length === 1 && startAt ? startAt : (p.number ?? next);
      next = number + 1;
      tx.insert(chapters)
        .values({
          novelId,
          number,
          titleZh: parts.length === 1 && manualTitle ? manualTitle : p.title,
          textZh: p.body,
        })
        .onConflictDoUpdate({
          target: [chapters.novelId, chapters.number],
          set: { textZh: p.body, titleZh: p.title ?? manualTitle, status: "new" },
        })
        .run();
    }
  });
  revalidatePath(`/novels/${novelId}`);
}

export async function updateChapter(fd: FormData) {
  const id = num(fd, "id")!;
  const novelId = num(fd, "novelId")!;
  getDb()
    .update(chapters)
    .set({
      number: num(fd, "number")!,
      titleZh: optStr(fd, "titleZh"),
      titleTh: optStr(fd, "titleTh"),
      textZh: str(fd, "textZh"),
    })
    .where(eq(chapters.id, id))
    .run();
  revalidatePath(`/novels/${novelId}/chapters/${id}`);
}

export async function deleteChapter(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  getDb().delete(chapters).where(eq(chapters.id, num(fd, "id")!)).run();
  redirect(`/novels/${novelId}`);
}

export async function saveSegment(translationId: number, index: number, text: string) {
  const db = getDb();
  const tr = db.select().from(translations).where(eq(translations.id, translationId)).get();
  if (!tr) throw new Error("ไม่พบคำแปล");
  const segments = [...tr.segments];
  segments[index] = text.trim();
  db.update(translations)
    .set({
      segments,
      textTh: segments.join("\n\n"),
      // A manual edit resolves flags for that paragraph.
      issues: tr.issues.filter((i) => i.paragraph !== index || segments[index].includes(i.expected)),
    })
    .where(eq(translations.id, translationId))
    .run();
}

// ---------- terms ----------

function syncCharacterRow(termId: number, novelId: number, cat: TermCategory) {
  const db = getDb();
  if (cat === "character") {
    db.insert(characters).values({ novelId, termId }).onConflictDoNothing().run();
  }
}

export async function createTerm(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  const cat = category(fd);
  const db = getDb();
  const row = db
    .insert(terms)
    .values({
      novelId,
      zh: str(fd, "zh"),
      th: str(fd, "th"),
      pinyin: optStr(fd, "pinyin"),
      category: cat,
      notes: optStr(fd, "notes"),
      status: "approved",
      firstChapter: num(fd, "firstChapter"),
    })
    .onConflictDoNothing()
    .returning()
    .get();
  if (row) syncCharacterRow(row.id, novelId, cat);
  revalidatePath(`/novels/${novelId}`, "layout");
}

export async function updateTerm(fd: FormData) {
  const id = num(fd, "id")!;
  const novelId = num(fd, "novelId")!;
  const cat = category(fd);
  const approve = str(fd, "approve") === "1";
  getDb()
    .update(terms)
    .set({
      zh: str(fd, "zh"),
      th: str(fd, "th"),
      pinyin: optStr(fd, "pinyin"),
      category: cat,
      notes: optStr(fd, "notes"),
      ...(approve ? { status: "approved" as const } : {}),
    })
    .where(eq(terms.id, id))
    .run();
  syncCharacterRow(id, novelId, cat);
  await refreshChapterStatuses(novelId);
  revalidatePath(`/novels/${novelId}`, "layout");
}

export async function deleteTerm(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  getDb().delete(terms).where(eq(terms.id, num(fd, "id")!)).run();
  await refreshChapterStatuses(novelId);
  revalidatePath(`/novels/${novelId}`, "layout");
}

export async function approveAllPending(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  getDb()
    .update(terms)
    .set({ status: "approved" })
    .where(and(eq(terms.novelId, novelId), eq(terms.status, "pending")))
    .run();
  await refreshChapterStatuses(novelId);
  revalidatePath(`/novels/${novelId}`, "layout");
}

/** Turn a (pending) term into an alias of another term. */
export async function mergeTermAsAlias(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  const id = num(fd, "id")!;
  const targetId = num(fd, "targetId");
  if (!targetId || targetId === id) return;
  const db = getDb();
  const term = db.select().from(terms).where(eq(terms.id, id)).get();
  if (!term) return;
  db.transaction((tx) => {
    tx.insert(termAliases).values({ termId: targetId, aliasZh: term.zh, aliasTh: optStr(fd, "aliasTh") }).run();
    tx.delete(terms).where(eq(terms.id, id)).run();
  });
  await refreshChapterStatuses(novelId);
  revalidatePath(`/novels/${novelId}`, "layout");
}

export async function addAlias(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  const aliasZh = str(fd, "aliasZh");
  if (!aliasZh) return;
  getDb()
    .insert(termAliases)
    .values({ termId: num(fd, "termId")!, aliasZh, aliasTh: optStr(fd, "aliasTh") })
    .run();
  revalidatePath(`/novels/${novelId}`, "layout");
}

export async function deleteAlias(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  getDb().delete(termAliases).where(eq(termAliases.id, num(fd, "id")!)).run();
  revalidatePath(`/novels/${novelId}`, "layout");
}

/** Chapters waiting on term review move to "ready" once none of their pending terms remain. */
async function refreshChapterStatuses(novelId: number) {
  const db = getDb();
  const pendingChapters = new Set(
    db
      .select({ ch: terms.firstChapter })
      .from(terms)
      .where(and(eq(terms.novelId, novelId), eq(terms.status, "pending")))
      .all()
      .map((r) => r.ch),
  );
  const waiting = db
    .select()
    .from(chapters)
    .where(and(eq(chapters.novelId, novelId), eq(chapters.status, "terms_pending")))
    .all()
    .filter((c) => !pendingChapters.has(c.number));
  if (waiting.length) {
    db.update(chapters)
      .set({ status: "ready" })
      .where(inArray(chapters.id, waiting.map((c) => c.id)))
      .run();
  }
}

// ---------- characters & relationships ----------

export async function updateCharacter(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  getDb()
    .update(characters)
    .set({
      gender: optStr(fd, "gender"),
      role: optStr(fd, "role"),
      description: optStr(fd, "description"),
      defaultSelfPronoun: optStr(fd, "defaultSelfPronoun"),
    })
    .where(eq(characters.id, num(fd, "id")!))
    .run();
  revalidatePath(`/novels/${novelId}/characters`);
}

export async function saveRelationship(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  const id = num(fd, "id");
  const values = {
    novelId,
    speakerId: num(fd, "speakerId")!,
    listenerId: num(fd, "listenerId")!,
    relation: optStr(fd, "relation"),
    selfPronoun: optStr(fd, "selfPronoun"),
    addressTerm: optStr(fd, "addressTerm"),
    validFromChapter: num(fd, "validFromChapter") ?? 1,
    notes: optStr(fd, "notes"),
    status: "approved" as const,
  };
  if (!values.speakerId || !values.listenerId) return;
  const db = getDb();
  if (id) db.update(relationships).set(values).where(eq(relationships.id, id)).run();
  else db.insert(relationships).values(values).run();
  revalidatePath(`/novels/${novelId}/characters`);
}

export async function deleteRelationship(fd: FormData) {
  const novelId = num(fd, "novelId")!;
  getDb().delete(relationships).where(eq(relationships.id, num(fd, "id")!)).run();
  revalidatePath(`/novels/${novelId}/characters`);
}

// ---------- style presets ----------

function parseExamples(fd: FormData) {
  const zh = fd.getAll("exampleZh").map(String);
  const th = fd.getAll("exampleTh").map(String);
  return zh
    .map((z, i) => ({ zh: z.trim(), th: (th[i] ?? "").trim() }))
    .filter((e) => e.zh && e.th);
}

export async function savePreset(fd: FormData) {
  const id = num(fd, "id");
  const values = { name: str(fd, "name"), instructions: str(fd, "instructions"), examples: parseExamples(fd) };
  if (!values.name || !values.instructions) return;
  const db = getDb();
  if (id) db.update(stylePresets).set(values).where(eq(stylePresets.id, id)).run();
  else db.insert(stylePresets).values(values).run();
  revalidatePath("/presets");
}

export async function deletePreset(fd: FormData) {
  getDb().delete(stylePresets).where(eq(stylePresets.id, num(fd, "id")!)).run();
  revalidatePath("/presets");
}
