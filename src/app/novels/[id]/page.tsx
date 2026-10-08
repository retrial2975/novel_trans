import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { NovelNav } from "@/components/NovelNav";
import { StatusBadge } from "@/components/StatusBadge";
import { getNovelOr404, pendingTermCount } from "@/lib/queries";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteNovel, importChapters, updateNovel } from "@/app/actions";

export const dynamic = "force-dynamic";

export default async function NovelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const novel = getNovelOr404(id);
  const db = getDb();
  const chapters = db
    .select({
      id: schema.chapters.id,
      number: schema.chapters.number,
      titleZh: schema.chapters.titleZh,
      titleTh: schema.chapters.titleTh,
      status: schema.chapters.status,
      length: sql<number>`length(${schema.chapters.textZh})`,
    })
    .from(schema.chapters)
    .where(eq(schema.chapters.novelId, novel.id))
    .orderBy(asc(schema.chapters.number))
    .all();
  const presets = db.select().from(schema.stylePresets).orderBy(asc(schema.stylePresets.id)).all();

  return (
    <div>
      <NovelNav novel={novel} pending={pendingTermCount(novel.id)} active="chapters" />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="card">
          {chapters.length === 0 ? (
            <p className="text-sm text-stone-500">ยังไม่มีตอน — นำเข้าจากแบบฟอร์มด้านขวา</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th className="w-16">ตอน</th>
                  <th>ชื่อตอน</th>
                  <th className="w-24 text-right">อักษร</th>
                  <th className="w-28">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {chapters.map((c) => (
                  <tr key={c.id}>
                    <td>{c.number}</td>
                    <td>
                      <Link href={`/novels/${novel.id}/chapters/${c.id}`} className="hover:underline">
                        {c.titleTh || c.titleZh || `ตอนที่ ${c.number}`}
                      </Link>
                      {c.titleTh && c.titleZh && <div className="text-xs text-stone-500">{c.titleZh}</div>}
                    </td>
                    <td className="text-right text-stone-500">{c.length.toLocaleString()}</td>
                    <td><StatusBadge status={c.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="space-y-4">
          <form action={importChapters} className="card space-y-3">
            <div className="font-medium">นำเข้าตอน</div>
            <input type="hidden" name="novelId" value={novel.id} />
            <p className="text-xs text-stone-500">
              วางข้อความหรืออัปโหลด .txt — ถ้ามีหัวข้อแบบ 第12章 หลายตอนในไฟล์เดียว ระบบจะแยกตอนให้อัตโนมัติ
              (ตอนเลขซ้ำจะถูกเขียนทับ)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">เลขตอน (ถ้าไม่มีหัวข้อ)</label>
                <input name="number" type="number" step="any" className="input" placeholder="ถัดไป" />
              </div>
              <div>
                <label className="label">ชื่อตอน (จีน)</label>
                <input name="titleZh" className="input" />
              </div>
            </div>
            <textarea name="text" rows={8} className="input font-mono" placeholder="วางต้นฉบับภาษาจีน..." />
            <input type="file" name="file" accept=".txt,text/plain" className="text-sm" />
            <button className="btn-primary">นำเข้า</button>
          </form>

          <form action={updateNovel} className="card space-y-3">
            <div className="font-medium">ตั้งค่านิยาย</div>
            <input type="hidden" name="id" value={novel.id} />
            <div>
              <label className="label">ชื่อจีน</label>
              <input name="titleZh" defaultValue={novel.titleZh} className="input" required />
            </div>
            <div>
              <label className="label">ชื่อไทย</label>
              <input name="titleTh" defaultValue={novel.titleTh ?? ""} className="input" />
            </div>
            <div>
              <label className="label">แนวการแปลเริ่มต้น</label>
              <select name="defaultStyleId" defaultValue={novel.defaultStyleId ?? ""} className="input">
                <option value="">— preset แรก —</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">วิธีแปล</label>
              <select name="translateMode" defaultValue={novel.translateMode} className="input">
                <option value="api">ผ่าน API (กดปุ่มเดียว เสียค่า API)</option>
                <option value="manual">คัดลอกไปแปลในแชท Claude / Project (ไม่เสียค่า API)</option>
              </select>
            </div>
            <button className="btn">บันทึก</button>
          </form>

          <form action={deleteNovel} className="text-right">
            <input type="hidden" name="id" value={novel.id} />
            <ConfirmButton message="ลบนิยายนี้พร้อมทุกตอน คลังคำ และคำแปล?">ลบนิยายนี้ทั้งหมด</ConfirmButton>
          </form>
        </div>
      </div>
    </div>
  );
}
