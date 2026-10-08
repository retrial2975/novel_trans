import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { NovelNav } from "@/components/NovelNav";
import { StatusBadge } from "@/components/StatusBadge";
import { ConfirmButton } from "@/components/ConfirmButton";
import { ChapterWorkbench } from "@/components/ChapterWorkbench";
import { getNovelOr404, pendingTermCount } from "@/lib/queries";
import { splitParagraphs } from "@/lib/text";
import { MODELS, TRANSLATE_MODEL_CHOICES } from "@/lib/ai";
import { deleteChapter, updateChapter } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ChapterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; cid: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { id, cid } = await params;
  const { v } = await searchParams;
  const novel = getNovelOr404(id);
  const db = getDb();
  const chapter = db
    .select()
    .from(schema.chapters)
    .where(and(eq(schema.chapters.id, Number(cid)), eq(schema.chapters.novelId, novel.id)))
    .get();
  if (!chapter) notFound();

  const versions = db
    .select({
      id: schema.translations.id,
      version: schema.translations.version,
      model: schema.translations.model,
      styleId: schema.translations.styleId,
      createdAt: schema.translations.createdAt,
    })
    .from(schema.translations)
    .where(eq(schema.translations.chapterId, chapter.id))
    .orderBy(desc(schema.translations.version))
    .all();
  const selected = versions.find((x) => String(x.version) === v) ?? versions[0];
  const translation = selected
    ? db.select().from(schema.translations).where(eq(schema.translations.id, selected.id)).get()
    : undefined;

  const presets = db.select().from(schema.stylePresets).orderBy(asc(schema.stylePresets.id)).all();
  const summary = db
    .select()
    .from(schema.chapterSummaries)
    .where(eq(schema.chapterSummaries.chapterId, chapter.id))
    .get();
  const chapterPending = db
    .select({ id: schema.terms.id })
    .from(schema.terms)
    .where(
      and(
        eq(schema.terms.novelId, novel.id),
        eq(schema.terms.status, "pending"),
        eq(schema.terms.firstChapter, chapter.number),
      ),
    )
    .all().length;
  const pendingRelations = db
    .select({ id: schema.relationships.id })
    .from(schema.relationships)
    .where(
      and(
        eq(schema.relationships.novelId, novel.id),
        eq(schema.relationships.status, "pending"),
        eq(schema.relationships.validFromChapter, chapter.number),
      ),
    )
    .all().length;
  const prev = db
    .select({ id: schema.chapters.id, number: schema.chapters.number })
    .from(schema.chapters)
    .where(and(eq(schema.chapters.novelId, novel.id), lt(schema.chapters.number, chapter.number)))
    .orderBy(desc(schema.chapters.number))
    .get();
  const next = db
    .select({ id: schema.chapters.id, number: schema.chapters.number })
    .from(schema.chapters)
    .where(and(eq(schema.chapters.novelId, novel.id), gt(schema.chapters.number, chapter.number)))
    .orderBy(asc(schema.chapters.number))
    .get();

  const models = [...new Set([MODELS.translate, ...TRANSLATE_MODEL_CHOICES])];

  return (
    <div>
      <NovelNav novel={novel} pending={pendingTermCount(novel.id)} active="chapters" />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold">
              ตอนที่ {chapter.number}
              {chapter.titleTh ? ` — ${chapter.titleTh}` : ""}
            </h2>
            <StatusBadge status={chapter.status} />
          </div>
          {chapter.titleZh && <div className="text-sm text-stone-500">{chapter.titleZh}</div>}
        </div>
        <div className="flex gap-2 text-sm">
          {prev && <Link className="btn" href={`/novels/${novel.id}/chapters/${prev.id}`}>← ตอน {prev.number}</Link>}
          {next && <Link className="btn" href={`/novels/${novel.id}/chapters/${next.id}`}>ตอน {next.number} →</Link>}
        </div>
      </div>

      {chapterPending > 0 && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          มีคำใหม่ {chapterPending} คำจากตอนนี้ที่ยังไม่ได้อนุมัติ —{" "}
          <Link href={`/novels/${novel.id}/review`} className="font-medium underline">ไป review ก่อนแปล</Link>{" "}
          (คำที่ยังไม่อนุมัติจะไม่ถูกใส่ใน prompt)
        </div>
      )}
      {pendingRelations > 0 && (
        <div className="mb-4 rounded-md border border-sky-300 bg-sky-50 p-3 text-sm dark:border-sky-800 dark:bg-sky-950">
          AI เสนอการเปลี่ยนสรรพนาม/ความสัมพันธ์ {pendingRelations} รายการจากตอนนี้ —{" "}
          <Link href={`/novels/${novel.id}/characters`} className="font-medium underline">ตรวจและอนุมัติ</Link>
        </div>
      )}

      <ChapterWorkbench
        chapterId={chapter.id}
        paragraphs={splitParagraphs(chapter.textZh)}
        translation={
          translation
            ? { id: translation.id, segments: translation.segments, issues: translation.issues, version: translation.version }
            : null
        }
        versions={versions.map((x) => ({
          version: x.version,
          label: `v${x.version} · ${x.model} · ${presets.find((p) => p.id === x.styleId)?.name ?? "-"} · ${x.createdAt.toLocaleString("th-TH")}`,
        }))}
        presets={presets.map((p) => ({ id: p.id, name: p.name }))}
        defaultStyleId={novel.defaultStyleId ?? presets[0]?.id ?? null}
        models={models}
        defaultModel={MODELS.translate}
        mode={novel.translateMode}
      />

      {summary && (
        <div className="card mt-6">
          <div className="mb-1 font-medium">สรุปตอนนี้ (ใช้เป็นบริบทตอนถัดไป)</div>
          <p className="text-sm whitespace-pre-wrap">{summary.summary}</p>
        </div>
      )}

      <details className="card mt-6">
        <summary className="cursor-pointer font-medium">แก้ไขต้นฉบับ / ข้อมูลตอน</summary>
        <form action={updateChapter} className="mt-3 space-y-3">
          <input type="hidden" name="id" value={chapter.id} />
          <input type="hidden" name="novelId" value={novel.id} />
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <label className="label">เลขตอน</label>
              <input name="number" type="number" step="any" defaultValue={chapter.number} className="input" />
            </div>
            <div>
              <label className="label">ชื่อตอน (จีน)</label>
              <input name="titleZh" defaultValue={chapter.titleZh ?? ""} className="input" />
            </div>
            <div>
              <label className="label">ชื่อตอน (ไทย)</label>
              <input name="titleTh" defaultValue={chapter.titleTh ?? ""} className="input" />
            </div>
          </div>
          <textarea name="textZh" rows={14} defaultValue={chapter.textZh} className="input font-mono" />
          <div className="flex justify-between">
            <button className="btn">บันทึก</button>
          </div>
        </form>
        <form action={deleteChapter} className="mt-3 text-right">
          <input type="hidden" name="id" value={chapter.id} />
          <input type="hidden" name="novelId" value={novel.id} />
          <ConfirmButton message="ลบตอนนี้และคำแปลทั้งหมดของตอน?">ลบตอนนี้</ConfirmButton>
        </form>
      </details>
    </div>
  );
}
