import type { GlossaryEntry } from "./glossary";

export const CATEGORY_LABELS: Record<string, string> = {
  character: "ตัวละคร",
  technique: "วิชา/เคล็ดวิชา",
  place: "สถานที่",
  item: "สิ่งของ/ของวิเศษ",
  sect: "สำนัก/องค์กร",
  title: "ยศ/ตำแหน่ง",
  other: "อื่นๆ",
};

export type PromptCharacter = {
  id: number;
  zh: string;
  th: string;
  gender: string | null;
  role: string | null;
  description: string | null;
  defaultSelfPronoun: string | null;
};

export type PromptPronoun = {
  speakerTh: string;
  listenerTh: string;
  relation: string | null;
  selfPronoun: string | null;
  addressTerm: string | null;
  notes: string | null;
};

export type ChapterContext = {
  styleInstructions: string;
  examples: { zh: string; th: string }[];
  glossary: GlossaryEntry[];
  characters: PromptCharacter[];
  pronouns: PromptPronoun[];
  previousSummaries: { number: number; summary: string }[];
  chapterNumber: number;
  chapterTitleZh: string | null;
};

const BASE_RULES = `คุณเป็นนักแปลนิยายจีนเป็นภาษาไทยมืออาชีพ งานของคุณคือแปลต้นฉบับภาษาจีนให้เป็นภาษาไทยที่ลื่นไหล ครบถ้วน และสม่ำเสมอตลอดทั้งเรื่อง

กฎที่ต้องทำตามเสมอ:
1. คำที่อยู่ในคลังคำ (glossary) ต้องใช้คำแปลไทยตามที่กำหนดทุกครั้ง ห้ามดัดแปลงหรือสะกดต่าง
2. สรรพนามแทนตัวเองและคำเรียกอีกฝ่ายในบทสนทนา ให้ดูว่า "ใครพูดกับใคร" แล้วใช้ตามตารางสรรพนาม ถ้าคู่นั้นไม่มีในตาราง ให้ใช้สรรพนามเริ่มต้นของผู้พูด แล้วเลือกคำเรียกอีกฝ่ายให้เหมาะกับความสัมพันธ์
3. แปลให้ครบทุกย่อหน้า ห้ามสรุป ห้ามข้าม ห้ามแต่งเติมเนื้อหา
4. ชื่อเฉพาะที่ไม่อยู่ในคลังคำ ให้ถอดเสียงแบบจีนกลางที่นิยมในนิยายแปลไทย
5. รูปแบบผลลัพธ์: ย่อหน้าต้นฉบับมีหมายเลขกำกับ เช่น [12] ให้ตอบเป็นคำแปลทีละย่อหน้าโดยขึ้นต้นด้วยหมายเลขเดียวกัน หนึ่งย่อหน้าต่อหนึ่งบรรทัด ตอบเฉพาะคำแปลเท่านั้น ไม่ต้องมีคำอธิบายหรือหมายเหตุใดๆ`;

/** Stable part of the system prompt (base rules + style preset) — cached across chapters. */
export function buildStyleBlock(ctx: Pick<ChapterContext, "styleInstructions" | "examples">): string {
  let s = `${BASE_RULES}\n\n## แนวการแปล\n${ctx.styleInstructions.trim()}`;
  if (ctx.examples.length) {
    s += `\n\n## ตัวอย่างสำนวนที่ต้องการ`;
    ctx.examples.forEach((ex, i) => {
      s += `\n\nตัวอย่าง ${i + 1}\nจีน: ${ex.zh}\nไทย: ${ex.th}`;
    });
  }
  return s;
}

/** Per-chapter context (glossary, characters, pronouns, summaries) — cached across chunks. */
export function buildChapterBlock(ctx: ChapterContext): string {
  const parts: string[] = [];

  if (ctx.glossary.length) {
    const byCat = new Map<string, GlossaryEntry[]>();
    for (const g of ctx.glossary) {
      const list = byCat.get(g.category) ?? [];
      list.push(g);
      byCat.set(g.category, list);
    }
    const lines: string[] = ["## คลังคำ (ต้องใช้ตามนี้)"];
    for (const [cat, list] of byCat) {
      lines.push(`### ${CATEGORY_LABELS[cat] ?? cat}`);
      for (const g of list) {
        let line = `- ${g.zh} → ${g.th}`;
        const aliases = g.aliases.map((a) => (a.th ? `${a.zh} → ${a.th}` : a.zh));
        if (aliases.length) line += ` (ชื่ออื่น: ${aliases.join(", ")})`;
        if (g.notes) line += ` — ${g.notes}`;
        lines.push(line);
      }
    }
    parts.push(lines.join("\n"));
  }

  if (ctx.characters.length) {
    const lines = ["## ตัวละครที่ปรากฏในตอนนี้"];
    for (const c of ctx.characters) {
      const info = [
        c.gender && `เพศ: ${c.gender}`,
        c.role && `บทบาท: ${c.role}`,
        c.defaultSelfPronoun && `แทนตัวเองโดยทั่วไป: ${c.defaultSelfPronoun}`,
        c.description,
      ].filter(Boolean);
      lines.push(`- ${c.th} (${c.zh})${info.length ? ` — ${info.join("; ")}` : ""}`);
    }
    parts.push(lines.join("\n"));
  }

  if (ctx.pronouns.length) {
    const lines = [
      "## ตารางสรรพนาม (ผู้พูด → ผู้ฟัง)",
      "| ผู้พูด | ผู้ฟัง | ความสัมพันธ์ | แทนตัวเอง | เรียกอีกฝ่าย | หมายเหตุ |",
      "|---|---|---|---|---|---|",
    ];
    for (const p of ctx.pronouns) {
      lines.push(
        `| ${p.speakerTh} | ${p.listenerTh} | ${p.relation ?? ""} | ${p.selfPronoun ?? ""} | ${p.addressTerm ?? ""} | ${p.notes ?? ""} |`,
      );
    }
    parts.push(lines.join("\n"));
  }

  if (ctx.previousSummaries.length) {
    const lines = ["## เรื่องย่อตอนก่อนหน้า"];
    for (const s of ctx.previousSummaries) lines.push(`ตอนที่ ${s.number}: ${s.summary}`);
    parts.push(lines.join("\n"));
  }

  parts.push(
    `## ตอนที่กำลังแปล\nตอนที่ ${ctx.chapterNumber}${ctx.chapterTitleZh ? ` — ${ctx.chapterTitleZh}` : ""}`,
  );
  return parts.join("\n\n");
}

export function buildChunkMessage(opts: {
  start: number;
  paragraphs: string[];
  previous?: { zh: string; th: string }[];
}): string {
  let msg = "";
  if (opts.previous?.length) {
    msg += "ช่วงก่อนหน้า (แปลแล้ว ใช้อ้างอิงให้ต่อเนื่อง ไม่ต้องแปลซ้ำ):\n";
    for (const p of opts.previous) msg += `จีน: ${p.zh}\nไทย: ${p.th}\n`;
    msg += "\n";
  }
  msg += "แปลย่อหน้าต่อไปนี้:\n\n";
  msg += opts.paragraphs.map((p, i) => `[${opts.start + i + 1}] ${p}`).join("\n");
  return msg;
}
