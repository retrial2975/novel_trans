export type RelationshipRow = {
  id: number;
  speakerId: number;
  listenerId: number;
  relation: string | null;
  selfPronoun: string | null;
  addressTerm: string | null;
  validFromChapter: number;
  notes: string | null;
};

/**
 * For each (speaker, listener) pair, pick the row in effect at `chapterNumber`:
 * the one with the greatest validFromChapter that is ≤ chapterNumber.
 */
export function resolveRelationships<T extends RelationshipRow>(
  rows: T[],
  chapterNumber: number,
): T[] {
  const best = new Map<string, T>();
  for (const r of rows) {
    if (r.validFromChapter > chapterNumber) continue;
    const key = `${r.speakerId}:${r.listenerId}`;
    const prev = best.get(key);
    if (!prev || r.validFromChapter > prev.validFromChapter || (r.validFromChapter === prev.validFromChapter && r.id > prev.id)) {
      best.set(key, r);
    }
  }
  return [...best.values()];
}
