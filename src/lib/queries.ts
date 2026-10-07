import "server-only";
import { and, count, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/db";

export function getNovelOr404(id: string | number) {
  const novel = getDb().select().from(schema.novels).where(eq(schema.novels.id, Number(id))).get();
  if (!novel) notFound();
  return novel;
}

export function pendingTermCount(novelId: number) {
  return (
    getDb()
      .select({ n: count() })
      .from(schema.terms)
      .where(and(eq(schema.terms.novelId, novelId), eq(schema.terms.status, "pending")))
      .get()?.n ?? 0
  );
}
