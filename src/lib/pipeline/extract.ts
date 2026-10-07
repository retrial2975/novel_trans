import "server-only";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { TERM_CATEGORIES } from "@/db/schema";
import { GlossaryMatcher } from "../glossary";
import { loadGlossary } from "../novel-context";
import { getClient, MODELS, recordUsage, RefusalError } from "../ai";

const ExtractedTerms = z.object({
  terms: z.array(
    z.object({
      zh: z.string(),
      pinyin: z.string(),
      th: z.string(),
      category: z.enum(TERM_CATEGORIES),
      notes: z.string(),
      gender: z.string(),
      role: z.string(),
    }),
  ),
});

const SYSTEM = `คุณช่วยสร้างคลังคำสำหรับแปลนิยายจีนเป็นภาษาไทย
อ่านต้นฉบับแล้วดึง "คำเฉพาะ" ที่ต้องแปลให้สม่ำเสมอทั้งเรื่อง ได้แก่
- character: ชื่อตัวละคร ฉายา
- technique: ชื่อวิชา เคล็ดวิชา กระบวนท่า ระดับพลัง
- place: สถานที่ เมือง ภูเขา แคว้น
- item: สิ่งของ อาวุธ ของวิเศษ ยา
- sect: สำนัก ตระกูล องค์กร
- title: ยศ ตำแหน่ง คำเรียกขาน
- other: คำเฉพาะอื่นที่ควรแปลเหมือนกันทุกครั้ง

กติกา:
- zh ต้องเป็นข้อความที่ปรากฏในต้นฉบับตรงตัวอักษร ใช้รูปที่สมบูรณ์ที่สุด (เช่น ชื่อเต็ม)
- th: ชื่อคนและสถานที่ให้ถอดเสียงจีนกลางแบบที่นิยมในนิยายแปลไทย (เช่น 林峰 → หลินเฟิง); วิชา/สิ่งของ/ยศ ให้แปลความหมายหรือผสมตามที่นิยาย
- notes: ข้อมูลสั้นๆ ที่ช่วยการแปล (เช่น เป็นศิษย์ของใคร) ถ้าไม่มีให้เป็นสตริงว่าง
- gender และ role ใช้กับ character เท่านั้น (เช่น "ชาย", "หญิง"; "ตัวเอก", "อาจารย์ของตัวเอก") ถ้าไม่ใช่ตัวละครหรือไม่ทราบให้เป็นสตริงว่าง
- ห้ามใส่คำที่อยู่ในรายการ "คำที่มีแล้ว" และห้ามใส่คำทั่วไปที่ไม่ใช่คำเฉพาะ
- ถ้าไม่มีคำใหม่ ให้คืนรายการว่าง`;

export async function extractTerms(chapterId: number) {
  const db = getDb();
  const chapter = db.select().from(schema.chapters).where(eq(schema.chapters.id, chapterId)).get();
  if (!chapter) throw new Error("ไม่พบตอนนี้");

  // Include pending terms so re-running extraction doesn't propose duplicates.
  const known = loadGlossary(chapter.novelId, "all");
  const matcher = new GlossaryMatcher(known);
  const presentIds = new Set(matcher.termIdsIn(chapter.textZh));
  const knownHere = known.filter((k) => presentIds.has(k.termId));
  const knownStrings = new Set(known.flatMap((k) => [k.zh, ...k.aliases.map((a) => a.zh)]));

  const model = MODELS.small;
  const response = await getClient().messages.parse({
    model,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `คำที่มีแล้ว (ไม่ต้องใส่ซ้ำ): ${knownHere.map((k) => `${k.zh}=${k.th}`).join(", ") || "-"}

ต้นฉบับ:
${chapter.titleZh ?? ""}
${chapter.textZh}`,
      },
    ],
    output_config: { format: zodOutputFormat(ExtractedTerms) },
  });
  recordUsage({ kind: "extract", model, usage: response.usage, novelId: chapter.novelId, chapterId });
  if (response.stop_reason === "refusal") throw new RefusalError(response.stop_details?.category);
  if (response.stop_reason === "max_tokens") throw new Error("ผลลัพธ์ยาวเกินไป (max_tokens) — ลองแบ่งตอนให้สั้นลง");
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("อ่านผลลัพธ์จากโมเดลไม่ได้");

  const added: string[] = [];
  db.transaction((tx) => {
    for (const t of parsed.terms) {
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
      .where(eq(schema.chapters.id, chapterId))
      .run();
  });
  return { added };
}
