import type { TranslationIssue } from "@/db/schema";
import type { GlossaryMatcher } from "./glossary";

/**
 * Flag paragraphs where a glossary term appears in the Chinese source but its Thai
 * rendering is missing from the translation. Aliases are only enforced when they have
 * their own Thai rendering.
 */
export function checkConsistency(
  matcher: GlossaryMatcher,
  sourceParagraphs: string[],
  thaiSegments: string[],
): TranslationIssue[] {
  const issues: TranslationIssue[] = [];
  sourceParagraphs.forEach((zh, i) => {
    const th = thaiSegments[i] ?? "";
    const seen = new Set<string>();
    for (const hit of matcher.findAll(zh)) {
      if (!hit.expectedTh || seen.has(hit.matched)) continue;
      seen.add(hit.matched);
      if (!th.includes(hit.expectedTh)) {
        issues.push({ paragraph: i, zh: hit.matched, expected: hit.expectedTh, termId: hit.termId });
      }
    }
  });
  return issues;
}
