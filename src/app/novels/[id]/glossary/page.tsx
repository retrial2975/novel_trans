import Link from "next/link";
import { and, asc, eq, inArray, like, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { TERM_CATEGORIES } from "@/db/schema";
import { NovelNav } from "@/components/NovelNav";
import { CategorySelect } from "@/components/CategorySelect";
import { ConfirmButton } from "@/components/ConfirmButton";
import { getNovelOr404, pendingTermCount } from "@/lib/queries";
import { CATEGORY_LABELS } from "@/lib/prompt";
import { addAlias, createTerm, deleteAlias, deleteTerm, updateTerm } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function GlossaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cat?: string; q?: string }>;
}) {
  const { id } = await params;
  const { cat, q } = await searchParams;
  const novel = getNovelOr404(id);
  const db = getDb();

  const filters: SQL[] = [eq(schema.terms.novelId, novel.id), eq(schema.terms.status, "approved")];
  if (cat && (TERM_CATEGORIES as readonly string[]).includes(cat)) filters.push(eq(schema.terms.category, cat as never));
  if (q) {
    const aliasHits = db
      .select({ termId: schema.termAliases.termId })
      .from(schema.termAliases)
      .where(like(schema.termAliases.aliasZh, `%${q}%`))
      .all()
      .map((r) => r.termId);
    filters.push(
      or(
        like(schema.terms.zh, `%${q}%`),
        like(schema.terms.th, `%${q}%`),
        like(schema.terms.pinyin, `%${q}%`),
        aliasHits.length ? inArray(schema.terms.id, aliasHits) : undefined,
      )!,
    );
  }
  const rows = db
    .select()
    .from(schema.terms)
    .where(and(...filters))
    .orderBy(asc(schema.terms.category), asc(schema.terms.zh))
    .all();
  const aliases = rows.length
    ? db.select().from(schema.termAliases).where(inArray(schema.termAliases.termId, rows.map((r) => r.id))).all()
    : [];

  const qs = (c?: string) => {
    const p = new URLSearchParams();
    if (c) p.set("cat", c);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  return (
    <div>
      <NovelNav novel={novel} pending={pendingTermCount(novel.id)} active="glossary" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={`/novels/${novel.id}/glossary${qs()}`} className={`badge ${!cat ? "bg-amber-600 text-white" : "bg-stone-200 dark:bg-stone-800"}`}>
          ทั้งหมด
        </Link>
        {TERM_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={`/novels/${novel.id}/glossary${qs(c)}`}
            className={`badge ${cat === c ? "bg-amber-600 text-white" : "bg-stone-200 dark:bg-stone-800"}`}
          >
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
        <form className="ml-auto flex gap-1">
          {cat && <input type="hidden" name="cat" value={cat} />}
          <input name="q" defaultValue={q} placeholder="ค้นหา จีน/ไทย/พินอิน/ชื่อแฝง" className="input w-64" />
          <button className="btn">ค้นหา</button>
        </form>
      </div>

      <form action={createTerm} className="card mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_1.2fr_1fr_1.5fr_auto]">
        <input type="hidden" name="novelId" value={novel.id} />
        <input name="zh" required placeholder="จีน" className="input" />
        <input name="pinyin" placeholder="พินอิน" className="input" />
        <input name="th" required placeholder="ไทย" className="input" />
        <CategorySelect defaultValue={cat ?? "character"} />
        <input name="notes" placeholder="หมายเหตุ" className="input" />
        <button className="btn-primary">เพิ่มคำ</button>
      </form>

      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>จีน</th>
              <th>พินอิน</th>
              <th>ไทย</th>
              <th>หมวด</th>
              <th>หมายเหตุ</th>
              <th>ชื่อแฝง</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-stone-500">ไม่มีคำ</td>
              </tr>
            )}
            {rows.map((t) => {
              const f = `term-${t.id}`;
              return (
                <tr key={t.id}>
                  <td className="min-w-24">
                    <form id={f} action={updateTerm} />
                    <input type="hidden" name="id" value={t.id} form={f} />
                    <input type="hidden" name="novelId" value={novel.id} form={f} />
                    <input name="zh" defaultValue={t.zh} className="input" form={f} />
                  </td>
                  <td className="min-w-24"><input name="pinyin" defaultValue={t.pinyin ?? ""} className="input" form={f} /></td>
                  <td className="min-w-32"><input name="th" defaultValue={t.th} className="input" form={f} /></td>
                  <td className="min-w-28"><CategorySelect defaultValue={t.category} form={f} /></td>
                  <td className="min-w-40"><input name="notes" defaultValue={t.notes ?? ""} className="input" form={f} /></td>
                  <td className="min-w-56">
                    <div className="mb-1 flex flex-wrap gap-1">
                      {aliases
                        .filter((a) => a.termId === t.id)
                        .map((a) => (
                          <form key={a.id} action={deleteAlias} className="inline">
                            <input type="hidden" name="id" value={a.id} />
                            <input type="hidden" name="novelId" value={novel.id} />
                            <span className="badge bg-stone-100 dark:bg-stone-800">
                              {a.aliasZh}
                              {a.aliasTh ? ` → ${a.aliasTh}` : ""}
                              <button className="ml-1 text-stone-400 hover:text-red-600" title="ลบชื่อแฝง">×</button>
                            </span>
                          </form>
                        ))}
                    </div>
                    <form action={addAlias} className="flex gap-1">
                      <input type="hidden" name="termId" value={t.id} />
                      <input type="hidden" name="novelId" value={novel.id} />
                      <input name="aliasZh" placeholder="ชื่อแฝง" className="input w-20" />
                      <input name="aliasTh" placeholder="แปล (ถ้ามี)" className="input w-24" />
                      <button className="btn px-2">+</button>
                    </form>
                  </td>
                  <td className="whitespace-nowrap">
                    <button className="btn" form={f}>บันทึก</button>{" "}
                    <form action={deleteTerm} className="inline">
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="novelId" value={novel.id} />
                      <ConfirmButton message={`ลบคำ ${t.zh}?`}>ลบ</ConfirmButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
