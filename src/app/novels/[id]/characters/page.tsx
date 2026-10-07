import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { NovelNav } from "@/components/NovelNav";
import { ConfirmButton } from "@/components/ConfirmButton";
import { getNovelOr404, pendingTermCount } from "@/lib/queries";
import { deleteRelationship, saveRelationship, updateCharacter } from "@/app/actions";
import type { Relationship } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function CharactersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const novel = getNovelOr404(id);
  const db = getDb();
  const chars = db
    .select({ c: schema.characters, t: schema.terms })
    .from(schema.characters)
    .innerJoin(schema.terms, eq(schema.terms.id, schema.characters.termId))
    .where(and(eq(schema.characters.novelId, novel.id), eq(schema.terms.status, "approved")))
    .orderBy(asc(schema.terms.firstChapter), asc(schema.terms.id))
    .all();
  const name = new Map(chars.map(({ c, t }) => [c.id, t.th]));
  const rels = db
    .select()
    .from(schema.relationships)
    .where(eq(schema.relationships.novelId, novel.id))
    .orderBy(asc(schema.relationships.speakerId), asc(schema.relationships.listenerId), asc(schema.relationships.validFromChapter))
    .all()
    .filter((r) => name.has(r.speakerId) && name.has(r.listenerId));
  const pending = rels.filter((r) => r.status === "pending");
  const approved = rels.filter((r) => r.status === "approved");

  const CharSelect = ({ field, value, form }: { field: string; value?: number; form?: string }) => (
    <select name={field} defaultValue={value ?? ""} className="input" required form={form}>
      <option value="" disabled>เลือก</option>
      {chars.map(({ c, t }) => (
        <option key={c.id} value={c.id}>{t.th} ({t.zh})</option>
      ))}
    </select>
  );

  const RelRow = ({ r, isPending }: { r: Relationship; isPending?: boolean }) => {
    const f = `rel-${r.id}`;
    return (
      <tr className={isPending ? "bg-sky-50 dark:bg-sky-950/40" : undefined}>
        <td className="min-w-36">
          <form id={f} action={saveRelationship} />
          <input type="hidden" name="id" value={r.id} form={f} />
          <input type="hidden" name="novelId" value={novel.id} form={f} />
          <CharSelect field="speakerId" value={r.speakerId} form={f} />
        </td>
        <td className="min-w-36"><CharSelect field="listenerId" value={r.listenerId} form={f} /></td>
        <td><input name="relation" defaultValue={r.relation ?? ""} className="input" form={f} /></td>
        <td><input name="selfPronoun" defaultValue={r.selfPronoun ?? ""} className="input" form={f} /></td>
        <td><input name="addressTerm" defaultValue={r.addressTerm ?? ""} className="input" form={f} /></td>
        <td className="w-20"><input name="validFromChapter" type="number" step="any" defaultValue={r.validFromChapter} className="input" form={f} /></td>
        <td><input name="notes" defaultValue={r.notes ?? ""} className="input" form={f} /></td>
        <td className="whitespace-nowrap">
          <button className={isPending ? "btn-primary" : "btn"} form={f}>{isPending ? "อนุมัติ" : "บันทึก"}</button>{" "}
          <form action={deleteRelationship} className="inline">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="novelId" value={novel.id} />
            {isPending ? <button className="btn-danger">ปฏิเสธ</button> : <ConfirmButton message="ลบแถวนี้?">ลบ</ConfirmButton>}
          </form>
        </td>
      </tr>
    );
  };

  const head = (
    <thead>
      <tr>
        <th>ผู้พูด</th>
        <th>ผู้ฟัง</th>
        <th>ความสัมพันธ์</th>
        <th>แทนตัวเอง</th>
        <th>เรียกอีกฝ่าย</th>
        <th>ตั้งแต่ตอน</th>
        <th>หมายเหตุ</th>
        <th />
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      <NovelNav novel={novel} pending={pendingTermCount(novel.id)} active="characters" />

      {pending.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="mb-1 font-medium">AI เสนอการเปลี่ยนแปลง ({pending.length})</h2>
          <p className="mb-3 text-xs text-stone-500">แก้ได้ก่อนกดอนุมัติ — มีผลกับการแปลตั้งแต่ตอนที่ระบุเป็นต้นไป</p>
          <table className="table">
            {head}
            <tbody>
              {pending.map((r) => <RelRow key={r.id} r={r} isPending />)}
            </tbody>
          </table>
        </section>
      )}

      <section className="card overflow-x-auto">
        <h2 className="mb-1 font-medium">ตารางสรรพนาม (ใครพูดกับใคร)</h2>
        <p className="mb-3 text-xs text-stone-500">
          ถ้าคู่ใดเปลี่ยนสรรพนามตามเนื้อเรื่อง ให้เพิ่มแถวใหม่ของคู่เดิมพร้อม &quot;ตั้งแต่ตอน&quot; — ระบบจะเลือกแถวล่าสุดที่มีผล ณ ตอนที่แปล
        </p>
        <table className="table">
          {head}
          <tbody>
            {approved.map((r) => <RelRow key={r.id} r={r} />)}
            <tr>
              <td>
                <form id="rel-new" action={saveRelationship} />
                <input type="hidden" name="novelId" value={novel.id} form="rel-new" />
                <CharSelect field="speakerId" form="rel-new" />
              </td>
              <td><CharSelect field="listenerId" form="rel-new" /></td>
              <td><input name="relation" placeholder="เช่น ศิษย์-อาจารย์" className="input" form="rel-new" /></td>
              <td><input name="selfPronoun" placeholder="ข้า" className="input" form="rel-new" /></td>
              <td><input name="addressTerm" placeholder="ท่านอาจารย์" className="input" form="rel-new" /></td>
              <td><input name="validFromChapter" type="number" step="any" defaultValue={1} className="input" form="rel-new" /></td>
              <td><input name="notes" className="input" form="rel-new" /></td>
              <td><button className="btn-primary" form="rel-new">เพิ่ม</button></td>
            </tr>
          </tbody>
        </table>
        {chars.length < 2 && (
          <p className="mt-2 text-xs text-stone-500">ต้องมีตัวละครที่อนุมัติแล้วอย่างน้อย 2 คน (เพิ่มในคลังคำหมวดตัวละคร)</p>
        )}
      </section>

      <section className="card overflow-x-auto">
        <h2 className="mb-3 font-medium">ตัวละคร ({chars.length})</h2>
        <table className="table">
          <thead>
            <tr>
              <th>ชื่อ</th>
              <th>เพศ</th>
              <th>บทบาท</th>
              <th>แทนตัวเองทั่วไป</th>
              <th>คำอธิบาย</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {chars.map(({ c, t }) => {
              const f = `char-${c.id}`;
              return (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">
                    <form id={f} action={updateCharacter} />
                    <input type="hidden" name="id" value={c.id} form={f} />
                    <input type="hidden" name="novelId" value={novel.id} form={f} />
                    <div className="font-medium">{t.th}</div>
                    <div className="text-xs text-stone-500">{t.zh}{t.firstChapter ? ` · ตอน ${t.firstChapter}` : ""}</div>
                  </td>
                  <td className="w-24"><input name="gender" defaultValue={c.gender ?? ""} className="input" form={f} /></td>
                  <td><input name="role" defaultValue={c.role ?? ""} className="input" form={f} /></td>
                  <td className="w-32"><input name="defaultSelfPronoun" defaultValue={c.defaultSelfPronoun ?? ""} placeholder="ข้า" className="input" form={f} /></td>
                  <td className="min-w-64"><input name="description" defaultValue={c.description ?? ""} className="input" form={f} /></td>
                  <td><button className="btn" form={f}>บันทึก</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
