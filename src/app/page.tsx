import Link from "next/link";
import { asc, count, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { createNovel } from "./actions";
import { hasApiKey } from "@/lib/ai";

export const dynamic = "force-dynamic";

export default function Home() {
  const db = getDb();
  const novels = db
    .select({ n: schema.novels, chapters: count(schema.chapters.id) })
    .from(schema.novels)
    .leftJoin(schema.chapters, eq(schema.chapters.novelId, schema.novels.id))
    .groupBy(schema.novels.id)
    .orderBy(desc(schema.novels.createdAt))
    .all();
  const presets = db.select().from(schema.stylePresets).orderBy(asc(schema.stylePresets.id)).all();

  return (
    <div className="space-y-6">
      {!hasApiKey() && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ยังไม่ได้ตั้งค่า <code>ANTHROPIC_API_KEY</code> — จัดการคลังคำได้ แต่สกัดคำ/แปลไม่ได้จนกว่าจะตั้งค่าใน environment
        </div>
      )}
      <h1 className="text-2xl font-semibold">นิยายทั้งหมด</h1>
      {novels.length === 0 ? (
        <p className="text-stone-500">ยังไม่มีนิยาย เพิ่มเรื่องแรกด้านล่าง</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {novels.map(({ n, chapters }) => (
            <li key={n.id}>
              <Link href={`/novels/${n.id}`} className="card block hover:border-amber-500">
                <div className="text-lg font-medium">{n.titleTh || n.titleZh}</div>
                {n.titleTh && <div className="text-sm text-stone-500">{n.titleZh}</div>}
                <div className="mt-1 text-xs text-stone-500">{chapters} ตอน</div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form action={createNovel} className="card grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-4 font-medium">เพิ่มนิยาย</div>
        <div>
          <label className="label">ชื่อจีน *</label>
          <input name="titleZh" required className="input" />
        </div>
        <div>
          <label className="label">ชื่อไทย</label>
          <input name="titleTh" className="input" />
        </div>
        <div>
          <label className="label">แนวการแปลเริ่มต้น</label>
          <select name="defaultStyleId" className="input">
            {presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <button className="btn-primary">สร้าง</button>
        </div>
      </form>
    </div>
  );
}
