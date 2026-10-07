import "server-only";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { buildChapterContext } from "../novel-context";
import { getClient, MODELS, recordUsage, RefusalError } from "../ai";

const ReviewOutput = z.object({
  summary: z.string(),
  relationship_changes: z.array(
    z.object({
      speaker: z.string(),
      listener: z.string(),
      relation: z.string(),
      self_pronoun: z.string(),
      address_term: z.string(),
      reason: z.string(),
    }),
  ),
});

const SYSTEM = `คุณช่วยดูแลความต่อเนื่องของงานแปลนิยายจีนเป็นไทย
ได้รับคำแปลภาษาไทยของตอนล่าสุด รายชื่อตัวละคร และตารางสรรพนามปัจจุบัน ให้ทำ 2 อย่าง:

1. summary: สรุปเหตุการณ์ของตอนนี้เป็นภาษาไทย 3–6 ประโยค เน้นสิ่งที่ต้องรู้เพื่อแปลตอนต่อไปให้ต่อเนื่อง (ใครทำอะไร ความสัมพันธ์ที่เปลี่ยน สถานะ/สถานที่ปัจจุบัน)
2. relationship_changes: เสนอแถวในตารางสรรพนามที่ควรเพิ่มหรือเปลี่ยน โดยดูจากบทสนทนาในตอนนี้
   - เสนอเฉพาะเมื่อ (ก) คู่ผู้พูด→ผู้ฟังนั้นยังไม่มีในตารางและมีบทสนทนาจริงในตอนนี้ หรือ (ข) ความสัมพันธ์เปลี่ยนชัดเจนจนควรเปลี่ยนสรรพนาม (เช่น ศัตรูกลายเป็นศิษย์พี่น้อง)
   - speaker และ listener ต้องเป็นชื่อไทยตามรายชื่อตัวละครที่ให้ไว้เท่านั้น
   - self_pronoun = คำที่ผู้พูดใช้แทนตัวเอง, address_term = คำที่ผู้พูดใช้เรียกผู้ฟัง
   - reason อธิบายสั้นๆ ว่าทำไม
   - ถ้าไม่มีอะไรควรเปลี่ยน ให้คืนรายการว่าง`;

export async function reviewChapter(chapterId: number) {
  const db = getDb();
  const { chapter, ctx, characters } = buildChapterContext(chapterId);
  const translation = db
    .select()
    .from(schema.translations)
    .where(eq(schema.translations.chapterId, chapterId))
    .orderBy(desc(schema.translations.version))
    .get();
  if (!translation) throw new Error("ยังไม่มีคำแปลของตอนนี้");

  const charList = characters.map((c) => `- ${c.th} (${c.zh})${c.role ? ` — ${c.role}` : ""}`).join("\n") || "-";
  const pronounTable =
    ctx.pronouns
      .map((p) => `- ${p.speakerTh} → ${p.listenerTh}: แทนตัวเอง "${p.selfPronoun ?? ""}", เรียก "${p.addressTerm ?? ""}" (${p.relation ?? ""})`)
      .join("\n") || "-";

  const model = MODELS.small;
  const response = await getClient().messages.parse({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `ตัวละครในตอนนี้:\n${charList}\n\nตารางสรรพนามปัจจุบัน:\n${pronounTable}\n\nคำแปลตอนที่ ${chapter.number}:\n${translation.textTh}`,
      },
    ],
    output_config: { format: zodOutputFormat(ReviewOutput) },
  });
  recordUsage({ kind: "review", model, usage: response.usage, novelId: chapter.novelId, chapterId });
  if (response.stop_reason === "refusal") throw new RefusalError(response.stop_details?.category);
  const out = response.parsed_output;
  if (!out) throw new Error("อ่านผลลัพธ์จากโมเดลไม่ได้");

  const idByName = new Map(characters.map((c) => [c.th, c.id]));
  let proposed = 0;
  db.transaction((tx) => {
    tx.insert(schema.chapterSummaries)
      .values({ chapterId, summary: out.summary })
      .onConflictDoUpdate({ target: schema.chapterSummaries.chapterId, set: { summary: out.summary } })
      .run();

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

    for (const r of out.relationship_changes) {
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
  return { summary: out.summary, proposed };
}
