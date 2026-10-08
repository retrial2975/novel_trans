import { z } from "zod";
import { TERM_CATEGORIES } from "@/db/schema";
import type { GlossaryEntry } from "./glossary";
import { buildChapterBlock, buildChunkMessage, buildStyleBlock, type ChapterContext } from "./prompt";
import { buildExtractUserMessage, EXTRACT_SYSTEM, type ExtractedTerm, type RelationshipChange } from "./extract-shared";
import { parseNumberedOutput } from "./text";

/*
 * "Manual" mode: the app builds the full prompt, the user pastes it into a Claude chat / Project,
 * then pastes the answer back. No API calls, so all parsing here has to tolerate chat formatting.
 */

export const SUMMARY_MARKER = "=== สรุป ===";
export const PRONOUN_MARKER = "=== สรรพนาม ===";

export function buildManualExtractPrompt(knownHere: GlossaryEntry[], titleZh: string | null, textZh: string) {
  return `${EXTRACT_SYSTEM}

ตอบเป็น JSON อย่างเดียวในรูปแบบนี้ (ทุกช่องเป็นสตริง, category เป็นหนึ่งใน ${TERM_CATEGORIES.join(" | ")}):
\`\`\`json
{"terms": [{"zh": "", "pinyin": "", "th": "", "category": "character", "notes": "", "gender": "", "role": ""}]}
\`\`\`

${buildExtractUserMessage(knownHere, titleZh, textZh)}`;
}

const LenientTerms = z.object({
  terms: z.array(
    z.object({
      zh: z.string(),
      th: z.string(),
      pinyin: z.string().nullish(),
      category: z.string().nullish(),
      notes: z.string().nullish(),
      gender: z.string().nullish(),
      role: z.string().nullish(),
    }),
  ),
});

/** Parse the JSON a chat answer contains (with or without a ```json fence or surrounding prose). */
export function parseManualTerms(answer: string): ExtractedTerm[] {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = fenced ? fenced[1] : answer;
  const first = raw.search(/[[{]/);
  const last = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (first === -1 || last < first) throw new Error("ไม่พบ JSON ในข้อความที่วาง");
  raw = raw.slice(first, last + 1);

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("JSON ไม่ถูกต้อง — ลองคัดลอกคำตอบใหม่ทั้งหมด");
  }
  if (Array.isArray(data)) data = { terms: data };
  const parsed = LenientTerms.safeParse(data);
  if (!parsed.success) throw new Error("รูปแบบ JSON ไม่ตรง (ต้องมี terms ที่มี zh และ th)");

  return parsed.data.terms.map((t) => ({
    zh: t.zh,
    th: t.th,
    pinyin: t.pinyin ?? "",
    category: (TERM_CATEGORIES as readonly string[]).includes(t.category ?? "")
      ? (t.category as ExtractedTerm["category"])
      : "other",
    notes: t.notes ?? "",
    gender: t.gender ?? "",
    role: t.role ?? "",
  }));
}

const MANUAL_OUTPUT_RULES = `## รูปแบบคำตอบ (สำคัญ ระบบจะอ่านคำตอบอัตโนมัติ)
- ตอบเป็นข้อความธรรมดา ไม่ใช้ code block ไม่ใช้ตัวหนา
- คำแปลทีละย่อหน้า ขึ้นต้นด้วยหมายเลขเดิม เช่น [12] คำแปล... หนึ่งย่อหน้าต่อบรรทัด ห้ามข้ามหรือรวมย่อหน้า
- ถ้าคำตอบยาวเกินจนต้องตัด ให้หยุดที่จบย่อหน้า แล้วเมื่อได้รับคำว่า "ต่อ" ให้แปลต่อจากย่อหน้าถัดไปในรูปแบบเดิม`;

const MANUAL_REVIEW_RULES = `หลังแปลครบทุกย่อหน้าแล้ว ให้ต่อท้ายด้วย 2 ส่วนนี้:

${SUMMARY_MARKER}
สรุปเหตุการณ์ของตอนนี้ 3–6 ประโยค เน้นสิ่งที่ต้องรู้เพื่อแปลตอนต่อไปให้ต่อเนื่อง

${PRONOUN_MARKER}
เสนอแถวในตารางสรรพนามที่ควรเพิ่มหรือเปลี่ยน เฉพาะคู่ที่ยังไม่มีในตารางและมีบทสนทนาจริงในตอนนี้ หรือคู่ที่ความสัมพันธ์เปลี่ยนชัดเจน
หนึ่งแถวต่อบรรทัด รูปแบบ: ผู้พูด -> ผู้ฟัง | แทนตัวเอง | เรียกอีกฝ่าย | ความสัมพันธ์ | เหตุผล
ใช้ชื่อไทยตามรายชื่อตัวละครเท่านั้น ถ้าไม่มีให้เขียนว่า ไม่มี`;

/** Full translation prompt for pasting into a chat: style + chapter context + numbered text. */
export function buildManualTranslatePrompt(opts: {
  ctx: ChapterContext;
  paragraphs: string[];
  /** Paragraph indexes to include; defaults to all. */
  only?: number[];
  titleZh?: string | null;
}) {
  const indexes = opts.only ?? opts.paragraphs.map((_, i) => i);
  // buildChunkMessage numbers paragraphs as start+i+1, so build one block per contiguous run.
  const runs: { start: number; paragraphs: string[] }[] = [];
  for (const idx of indexes) {
    const last = runs[runs.length - 1];
    if (last && last.start + last.paragraphs.length === idx) last.paragraphs.push(opts.paragraphs[idx]);
    else runs.push({ start: idx, paragraphs: [opts.paragraphs[idx]] });
  }
  const body = runs
    .map((r) => buildChunkMessage(r).replace(/^แปลย่อหน้าต่อไปนี้:\n\n/, ""))
    .join("\n");

  const isPartial = Boolean(opts.only);
  let prompt = `${buildStyleBlock(opts.ctx)}\n\n${buildChapterBlock(opts.ctx)}\n\n${MANUAL_OUTPUT_RULES}`;
  if (!isPartial) prompt += `\n\n${MANUAL_REVIEW_RULES}`;
  prompt += `\n\n## ${isPartial ? "แปลเฉพาะย่อหน้าต่อไปนี้ (ส่วนที่ยังขาด)" : "ต้นฉบับ"}\n\n`;
  if (!isPartial && opts.titleZh) prompt += `ชื่อตอน ให้แปลเป็นบรรทัดแรกโดยขึ้นต้นด้วย [0]\n[0] ${opts.titleZh}\n\n`;
  return prompt + body;
}

export type ManualTranslationResult = {
  segments: Map<number, string>; // paragraph index (0-based) → Thai
  titleTh: string | null;
  summary: string | null;
  changes: RelationshipChange[];
};

/** Split a pasted chat answer into numbered paragraphs, summary and pronoun suggestions. */
export function parseManualTranslation(answer: string): ManualTranslationResult {
  const text = answer.replace(/\r\n?/g, "\n").replace(/\*\*/g, "");
  const sIdx = text.indexOf(SUMMARY_MARKER);
  const pIdx = text.indexOf(PRONOUN_MARKER);
  const cut = [sIdx, pIdx].filter((i) => i >= 0);
  const main = cut.length ? text.slice(0, Math.min(...cut)) : text;

  const numbered = parseNumberedOutput(main);
  const segments = new Map<number, string>();
  for (const [n, th] of numbered) if (n >= 1) segments.set(n - 1, th);

  const section = (from: number) => {
    if (from < 0) return null;
    const rest = text.slice(from).split("\n").slice(1);
    const end = rest.findIndex((l) => l.trim().startsWith("==="));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  };

  const changes: RelationshipChange[] = [];
  for (const line of (section(pIdx) ?? "").split("\n")) {
    const m = line
      .trim()
      .replace(/^[-*•]\s*/, "")
      .match(/^(.+?)\s*(?:->|→)\s*(.+?)\s*\|(.*)$/);
    if (!m) continue;
    const [self, address, relation, reason] = m[3].split("|").map((s) => s.trim());
    changes.push({
      speaker: m[1].trim(),
      listener: m[2].trim(),
      self_pronoun: self ?? "",
      address_term: address ?? "",
      relation: relation ?? "",
      reason: reason ?? "",
    });
  }

  return {
    segments,
    titleTh: numbered.get(0) ?? null,
    summary: section(sIdx) || null,
    changes,
  };
}
