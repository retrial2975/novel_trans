import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { NovelNav } from "@/components/NovelNav";
import { CategorySelect } from "@/components/CategorySelect";
import { getNovelOr404 } from "@/lib/queries";
import { approveAllPending, deleteTerm, mergeTermAsAlias, updateTerm } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const novel = getNovelOr404(id);
  const db = getDb();
  const pending = db
    .select({ t: schema.terms, c: schema.characters })
    .from(schema.terms)
    .leftJoin(schema.characters, eq(schema.characters.termId, schema.terms.id))
    .where(and(eq(schema.terms.novelId, novel.id), eq(schema.terms.status, "pending")))
    .orderBy(asc(schema.terms.firstChapter), asc(schema.terms.id))
    .all();
  const approved = db
    .select({ id: schema.terms.id, zh: schema.terms.zh, th: schema.terms.th })
    .from(schema.terms)
    .where(and(eq(schema.terms.novelId, novel.id), eq(schema.terms.status, "approved")))
    .orderBy(asc(schema.terms.zh))
    .all();

  return (
    <div>
      <NovelNav novel={novel} pending={pending.length} active="review" />
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-stone-500">
          คำที่ AI สกัดได้จะยังไม่ถูกใช้ในการแปลจนกว่าจะอนุมัติ — แก้คำแปลให้ถูกก่อนอนุมัติ หรือรวมเป็นชื่อแฝงของคำที่มีอยู่แล้ว
        </p>
        {pending.length > 0 && (
          <form action={approveAllPending}>
            <input type="hidden" name="novelId" value={novel.id} />
            <button className="btn">อนุมัติทั้งหมด ({pending.length})</button>
          </form>
        )}
      </div>

      {pending.length === 0 ? (
        <div className="card text-sm text-stone-500">ไม่มีคำรอ review</div>
      ) : (
        <div className="space-y-3">
          {pending.map(({ t, c }) => (
            <div key={t.id} className="card space-y-3">
              <form id={`t-${t.id}`} action={updateTerm} />
              <input type="hidden" name="id" value={t.id} form={`t-${t.id}`} />
              <input type="hidden" name="novelId" value={novel.id} form={`t-${t.id}`} />
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1.3fr_1fr]">
                <div>
                  <label className="label">จีน</label>
                  <input name="zh" defaultValue={t.zh} className="input" form={`t-${t.id}`} />
                </div>
                <div>
                  <label className="label">พินอิน</label>
                  <input name="pinyin" defaultValue={t.pinyin ?? ""} className="input" form={`t-${t.id}`} />
                </div>
                <div>
                  <label className="label">ไทย</label>
                  <input name="th" defaultValue={t.th} className="input font-medium" form={`t-${t.id}`} />
                </div>
                <div>
                  <label className="label">หมวด</label>
                  <CategorySelect defaultValue={t.category} form={`t-${t.id}`} />
                </div>
              </div>
              <div>
                <label className="label">
                  หมายเหตุ · จากตอน {t.firstChapter ?? "-"}
                  {c && (c.gender || c.role) ? ` · ${[c.gender, c.role].filter(Boolean).join(", ")}` : ""}
                </label>
                <input name="notes" defaultValue={t.notes ?? ""} className="input" form={`t-${t.id}`} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button name="approve" value="1" className="btn-primary" form={`t-${t.id}`}>อนุมัติ</button>
                <button className="btn" form={`t-${t.id}`}>บันทึก (ยังไม่อนุมัติ)</button>
                <form action={deleteTerm}>
                  <input type="hidden" name="id" value={t.id} />
                  <input type="hidden" name="novelId" value={novel.id} />
                  <button className="btn-danger">ทิ้ง</button>
                </form>
                {approved.length > 0 && (
                  <form action={mergeTermAsAlias} className="ml-auto flex items-center gap-1">
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="novelId" value={novel.id} />
                    <select name="targetId" className="input w-48" defaultValue="">
                      <option value="" disabled>รวมเป็นชื่อแฝงของ...</option>
                      {approved.map((a) => (
                        <option key={a.id} value={a.id}>{a.zh} ({a.th})</option>
                      ))}
                    </select>
                    <input name="aliasTh" placeholder="คำแปลเฉพาะ (ถ้ามี)" defaultValue={t.th} className="input w-40" />
                    <button className="btn">รวม</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
