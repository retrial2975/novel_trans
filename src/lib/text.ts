/** Split chapter text into non-empty paragraphs (one per line). */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((p) => p.replace(/^[\s　]+|[\s　]+$/g, ""))
    .filter((p) => p.length > 0);
}

export type Chunk = {
  /** Index of the first paragraph of this chunk within the chapter. */
  start: number;
  paragraphs: string[];
};

/**
 * Group paragraphs into chunks of roughly `target` characters without splitting a paragraph.
 * A chunk is closed once adding the next paragraph would exceed `max`, or once it has
 * reached `target`.
 */
export function chunkParagraphs(
  paragraphs: string[],
  opts: { target?: number; max?: number } = {},
): Chunk[] {
  const target = opts.target ?? 1800;
  const max = opts.max ?? 2500;
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;
  let size = 0;

  paragraphs.forEach((p, i) => {
    if (current && (size >= target || size + p.length > max)) {
      chunks.push(current);
      current = null;
    }
    if (!current) {
      current = { start: i, paragraphs: [] };
      size = 0;
    }
    current.paragraphs.push(p);
    size += p.length;
  });
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Split "[12] ข้อความ" style output back into a map of paragraph number → text.
 * Lines without a marker are appended to the previous paragraph.
 */
export function parseNumberedOutput(output: string): Map<number, string> {
  const result = new Map<number, string>();
  let currentKey: number | null = null;
  for (const raw of output.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^\[(\d+)\]\s?(.*)$/);
    if (m) {
      currentKey = Number(m[1]);
      result.set(currentKey, m[2].trim());
    } else if (currentKey !== null) {
      result.set(currentKey, `${result.get(currentKey)}\n${line}`.trim());
    }
  }
  return result;
}

/** Parse imported text that may contain several chapters separated by headings like 第12章. */
export function splitImportedChapters(
  text: string,
): { number: number | null; title: string | null; body: string }[] {
  const normalized = text.replace(/\r\n?/g, "\n");
  const heading = /^[\s　]*(第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*[章回节][^\n]*)$/gm;
  const matches = [...normalized.matchAll(heading)];
  if (matches.length === 0) {
    return [{ number: null, title: null, body: normalized.trim() }];
  }
  const out: { number: number | null; title: string | null; body: string }[] = [];
  matches.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    const body = normalized.slice(start, end).trim();
    if (body) out.push({ number: parseChineseNumber(m[2]), title: m[1].trim(), body });
  });
  return out;
}

const DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

export function parseChineseNumber(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let digit = 0;
  for (const ch of s) {
    if (ch in DIGITS) digit = DIGITS[ch];
    else if (ch in UNITS) {
      total += (digit || 1) * UNITS[ch];
      digit = 0;
    } else return null;
  }
  return total + digit;
}
