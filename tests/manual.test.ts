import { describe, expect, it } from "vitest";
import { buildManualTranslatePrompt, parseManualTerms, parseManualTranslation } from "@/lib/manual";
import type { ChapterContext } from "@/lib/prompt";

const ctx: ChapterContext = {
  styleInstructions: "สำนวนทดสอบ",
  examples: [],
  glossary: [],
  characters: [],
  pronouns: [],
  previousSummaries: [],
  chapterNumber: 1,
  chapterTitleZh: null,
};

describe("parseManualTerms", () => {
  it("reads fenced JSON with prose around it and fills defaults", () => {
    const terms = parseManualTerms(
      'นี่คือผลลัพธ์:\n```json\n{"terms":[{"zh":"林峰","th":"หลินเฟิง","category":"character"},{"zh":"甲","th":"ก","category":"weird"}]}\n```\nจบ',
    );
    expect(terms).toEqual([
      { zh: "林峰", th: "หลินเฟิง", pinyin: "", category: "character", notes: "", gender: "", role: "" },
      { zh: "甲", th: "ก", pinyin: "", category: "other", notes: "", gender: "", role: "" },
    ]);
  });

  it("accepts a bare array", () => {
    expect(parseManualTerms('[{"zh":"甲","th":"ก"}]')).toHaveLength(1);
  });

  it("rejects text without JSON", () => {
    expect(() => parseManualTerms("ไม่มีคำใหม่")).toThrow();
  });
});

describe("parseManualTranslation", () => {
  it("splits paragraphs, title, summary and pronoun suggestions", () => {
    const res = parseManualTranslation(
      [
        "**[0] กลับมา**",
        "[1] หนึ่ง",
        "[2] สอง",
        "",
        "=== สรุป ===",
        "หลินเฟิงกลับมา",
        "",
        "=== สรรพนาม ===",
        "- หลินเฟิง -> ซูเหยา | ข้า | ศิษย์น้อง | ศิษย์พี่น้อง | คุยกัน",
        "ไม่มี",
      ].join("\n"),
    );
    expect([...res.segments.entries()]).toEqual([[0, "หนึ่ง"], [1, "สอง"]]);
    expect(res.titleTh).toBe("กลับมา");
    expect(res.summary).toBe("หลินเฟิงกลับมา");
    expect(res.changes).toEqual([
      { speaker: "หลินเฟิง", listener: "ซูเหยา", self_pronoun: "ข้า", address_term: "ศิษย์น้อง", relation: "ศิษย์พี่น้อง", reason: "คุยกัน" },
    ]);
  });

  it("handles a continuation with only paragraphs", () => {
    const res = parseManualTranslation("[3] สาม\n[4] สี่");
    expect([...res.segments.keys()]).toEqual([2, 3]);
    expect(res.summary).toBeNull();
  });
});

describe("buildManualTranslatePrompt", () => {
  it("numbers only the requested paragraphs and keeps original numbers", () => {
    const p = buildManualTranslatePrompt({ ctx, paragraphs: ["甲", "乙", "丙", "丁"], only: [1, 3] });
    expect(p).toContain("[2] 乙");
    expect(p).toContain("[4] 丁");
    expect(p).not.toContain("[1] 甲");
    expect(p).not.toContain("=== สรุป ===");
  });

  it("asks for the summary and title on a full prompt", () => {
    const p = buildManualTranslatePrompt({ ctx, paragraphs: ["甲"], titleZh: "第一章" });
    expect(p).toContain("[0] 第一章");
    expect(p).toContain("[1] 甲");
    expect(p).toContain("=== สรุป ===");
  });
});
