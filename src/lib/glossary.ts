import type { TermCategory } from "@/db/schema";

export type GlossaryEntry = {
  termId: number;
  zh: string;
  th: string;
  pinyin?: string | null;
  category: TermCategory;
  notes?: string | null;
  aliases: { zh: string; th?: string | null }[];
};

export type GlossaryHit = {
  termId: number;
  /** The exact Chinese string matched (main form or alias). */
  matched: string;
  isAlias: boolean;
  /** Thai the checker should expect for this occurrence, if enforceable. */
  expectedTh: string | null;
  index: number;
};

type Needle = { text: string; termId: number; isAlias: boolean; expectedTh: string | null };

/**
 * Longest-match-first glossary matcher. At each position the longest known string wins,
 * and matched characters are consumed, so a short name (e.g. 林) never matches inside a
 * longer one (e.g. 林峰 or 林家庄).
 */
export class GlossaryMatcher {
  private byFirstChar = new Map<string, Needle[]>();

  constructor(entries: GlossaryEntry[]) {
    const seen = new Set<string>();
    const add = (n: Needle) => {
      if (!n.text || seen.has(n.text)) return;
      seen.add(n.text);
      const key = n.text[0];
      const list = this.byFirstChar.get(key) ?? [];
      list.push(n);
      this.byFirstChar.set(key, list);
    };
    // Main forms first so they win over an identical alias on another term.
    for (const e of entries) add({ text: e.zh, termId: e.termId, isAlias: false, expectedTh: e.th });
    for (const e of entries)
      for (const a of e.aliases)
        add({ text: a.zh, termId: e.termId, isAlias: true, expectedTh: a.th || null });
    for (const list of this.byFirstChar.values()) list.sort((a, b) => b.text.length - a.text.length);
  }

  findAll(text: string): GlossaryHit[] {
    const hits: GlossaryHit[] = [];
    let i = 0;
    while (i < text.length) {
      const candidates = this.byFirstChar.get(text[i]);
      const found = candidates?.find((n) => text.startsWith(n.text, i));
      if (found) {
        hits.push({
          termId: found.termId,
          matched: found.text,
          isAlias: found.isAlias,
          expectedTh: found.expectedTh,
          index: i,
        });
        i += found.text.length;
      } else {
        i += 1;
      }
    }
    return hits;
  }

  /** Unique term ids that occur in the text, in order of first appearance. */
  termIdsIn(text: string): number[] {
    return [...new Set(this.findAll(text).map((h) => h.termId))];
  }
}
