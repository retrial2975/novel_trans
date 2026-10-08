import { z } from "zod";
import { TERM_CATEGORIES } from "@/db/schema";
import type { GlossaryEntry } from "./glossary";

export const ExtractedTerms = z.object({
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
export type ExtractedTerm = z.infer<typeof ExtractedTerms>["terms"][number];

export const EXTRACT_SYSTEM = `คุณช่วยสร้างคลังคำสำหรับแปลนิยายจีนเป็นภาษาไทย
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

export function buildExtractUserMessage(knownHere: GlossaryEntry[], titleZh: string | null, textZh: string) {
  return `คำที่มีแล้ว (ไม่ต้องใส่ซ้ำ): ${knownHere.map((k) => `${k.zh}=${k.th}`).join(", ") || "-"}

ต้นฉบับ:
${titleZh ?? ""}
${textZh}`;
}

export type RelationshipChange = {
  speaker: string;
  listener: string;
  relation: string;
  self_pronoun: string;
  address_term: string;
  reason: string;
};
