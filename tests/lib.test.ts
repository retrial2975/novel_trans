import { describe, expect, it } from "vitest";
import { GlossaryMatcher, type GlossaryEntry } from "@/lib/glossary";
import {
  chunkParagraphs,
  parseChineseNumber,
  parseNumberedOutput,
  splitImportedChapters,
  splitParagraphs,
} from "@/lib/text";
import { resolveRelationships } from "@/lib/pronouns";
import { checkConsistency } from "@/lib/check";

const entry = (termId: number, zh: string, th: string, aliases: GlossaryEntry["aliases"] = []): GlossaryEntry => ({
  termId, zh, th, category: "character", aliases,
});

describe("GlossaryMatcher", () => {
  it("prefers the longest match", () => {
    const m = new GlossaryMatcher([entry(1, "林", "หลิน"), entry(2, "林峰", "หลินเฟิง"), entry(3, "林家庄", "คฤหาสน์ตระกูลหลิน")]);
    const hits = m.findAll("林峰回到林家庄，林伯开门。");
    expect(hits.map((h) => h.matched)).toEqual(["林峰", "林家庄", "林"]);
  });

  it("matches aliases and maps them to the term", () => {
    const m = new GlossaryMatcher([entry(1, "苏瑶", "ซูเหยา", [{ zh: "瑶儿", th: "เหยาเอ๋อร์" }, { zh: "师妹" }])]);
    const hits = m.findAll("师妹，瑶儿来了。");
    expect(hits.map((h) => [h.termId, h.isAlias, h.expectedTh])).toEqual([
      [1, true, null],
      [1, true, "เหยาเอ๋อร์"],
    ]);
    expect(m.termIdsIn("师妹，瑶儿")).toEqual([1]);
  });
});

describe("text helpers", () => {
  it("splits paragraphs and strips full-width indentation", () => {
    expect(splitParagraphs("　　第一段\r\n\r\n  第二段  \n")).toEqual(["第一段", "第二段"]);
  });

  it("chunks without splitting paragraphs", () => {
    const paras = Array.from({ length: 10 }, () => "字".repeat(500));
    const chunks = chunkParagraphs(paras, { target: 1800, max: 2500 });
    expect(chunks.map((c) => c.paragraphs.length)).toEqual([4, 4, 2]);
    expect(chunks.map((c) => c.start)).toEqual([0, 4, 8]);
  });

  it("parses numbered output", () => {
    const out = parseNumberedOutput("[3] หนึ่ง\n\n[4] สอง\nต่อ\n[5]สาม");
    expect([...out.entries()]).toEqual([[3, "หนึ่ง"], [4, "สอง\nต่อ"], [5, "สาม"]]);
  });

  it("parses chinese numerals", () => {
    expect(parseChineseNumber("一百二十")).toBe(120);
    expect(parseChineseNumber("十五")).toBe(15);
    expect(parseChineseNumber("两千零三")).toBe(2003);
    expect(parseChineseNumber("42")).toBe(42);
  });

  it("splits imported text into chapters", () => {
    const res = splitImportedChapters("第一章 开始\n内容一\n第二章 继续\n内容二\n");
    expect(res).toEqual([
      { number: 1, title: "第一章 开始", body: "内容一" },
      { number: 2, title: "第二章 继续", body: "内容二" },
    ]);
  });
});

describe("resolveRelationships", () => {
  const base = { relation: null, addressTerm: null, notes: null };
  const rows = [
    { ...base, id: 1, speakerId: 1, listenerId: 2, selfPronoun: "ข้า", validFromChapter: 1 },
    { ...base, id: 2, speakerId: 1, listenerId: 2, selfPronoun: "พี่", validFromChapter: 120 },
  ];
  it("uses the row valid for the chapter", () => {
    expect(resolveRelationships(rows, 50).map((r) => r.id)).toEqual([1]);
    expect(resolveRelationships(rows, 120).map((r) => r.id)).toEqual([2]);
  });
});

describe("checkConsistency", () => {
  it("flags missing glossary renderings", () => {
    const m = new GlossaryMatcher([entry(1, "林峰", "หลินเฟิง"), entry(2, "青云宗", "สำนักชิงอวิ๋น")]);
    const issues = checkConsistency(m, ["林峰来到青云宗。"], ["หลินฟงมาถึงสำนักชิงอวิ๋น"]);
    expect(issues).toEqual([{ paragraph: 0, zh: "林峰", expected: "หลินเฟิง", termId: 1 }]);
  });
});
