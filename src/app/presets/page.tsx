import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deletePreset, savePreset } from "@/app/actions";
import type { StylePreset } from "@/db/schema";

export const dynamic = "force-dynamic";

function PresetForm({ preset }: { preset?: StylePreset }) {
  // Always show at least 3 example slots so new few-shot pairs can be added.
  const examples = [...(preset?.examples ?? [])];
  while (examples.length < 3) examples.push({ zh: "", th: "" });
  return (
    <form action={savePreset} className="space-y-3">
      {preset && <input type="hidden" name="id" value={preset.id} />}
      <div>
        <label className="label">ชื่อ preset</label>
        <input name="name" defaultValue={preset?.name} required className="input" />
      </div>
      <div>
        <label className="label">คำสั่ง (system prompt)</label>
        <textarea name="instructions" defaultValue={preset?.instructions} required rows={7} className="input" />
      </div>
      <div className="space-y-2">
        <div className="label">ตัวอย่างประโยคที่แปลแล้วชอบ (few-shot) — เว้นว่างเพื่อไม่ใช้</div>
        {examples.map((ex, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-2">
            <textarea name="exampleZh" defaultValue={ex.zh} rows={2} placeholder="จีน" className="input" />
            <textarea name="exampleTh" defaultValue={ex.th} rows={2} placeholder="ไทย" className="input" />
          </div>
        ))}
      </div>
      <button className="btn-primary">{preset ? "บันทึก" : "สร้าง preset"}</button>
    </form>
  );
}

export default function PresetsPage() {
  const presets = getDb().select().from(schema.stylePresets).orderBy(asc(schema.stylePresets.id)).all();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">แนวการแปล (Style presets)</h1>
      <p className="text-sm text-stone-500">
        preset คือคำสั่งที่ใส่ใน system prompt ทุกครั้งที่แปล ส่วนนี้ถูก cache ไว้จึงไม่เพิ่มค่าใช้จ่ายมากเมื่อแปลหลายช่วงติดกัน
      </p>
      {presets.map((p) => (
        <details key={p.id} className="card">
          <summary className="cursor-pointer font-medium">{p.name}</summary>
          <div className="mt-3">
            <PresetForm preset={p} />
            <form action={deletePreset} className="mt-2 text-right">
              <input type="hidden" name="id" value={p.id} />
              <ConfirmButton message={`ลบ preset ${p.name}?`}>ลบ</ConfirmButton>
            </form>
          </div>
        </details>
      ))}
      <div className="card">
        <div className="mb-3 font-medium">สร้าง preset ใหม่</div>
        <PresetForm />
      </div>
    </div>
  );
}
