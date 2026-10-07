import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { estimateCost } from "@/lib/ai";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = { extract: "สกัดคำ", translate: "แปล", review: "สรุป/ตรวจ" };

export default function UsagePage() {
  const db = getDb();
  const u = schema.apiUsage;
  const totals = db
    .select({
      novel: schema.novels.titleZh,
      novelTh: schema.novels.titleTh,
      kind: u.kind,
      model: u.model,
      calls: sql<number>`count(*)`,
      inputTokens: sql<number>`sum(${u.inputTokens})`,
      outputTokens: sql<number>`sum(${u.outputTokens})`,
      cacheReadTokens: sql<number>`sum(${u.cacheReadTokens})`,
      cacheWriteTokens: sql<number>`sum(${u.cacheWriteTokens})`,
    })
    .from(u)
    .leftJoin(schema.novels, eq(schema.novels.id, u.novelId))
    .groupBy(u.novelId, u.kind, u.model)
    .orderBy(desc(sql`sum(${u.outputTokens})`))
    .all();
  const grand = totals.reduce((s, r) => s + (estimateCost(r) ?? 0), 0);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">การใช้ API</h1>
      <p className="text-sm text-stone-500">
        ค่าใช้จ่ายโดยประมาณ (USD) คิดจากราคามาตรฐานต่อ token — ยอดจริงดูที่ Anthropic Console
      </p>
      <div className="card">
        <div className="text-sm text-stone-500">รวมทั้งหมดโดยประมาณ</div>
        <div className="text-2xl font-semibold">${grand.toFixed(3)}</div>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>นิยาย</th>
              <th>ขั้นตอน</th>
              <th>โมเดล</th>
              <th className="text-right">ครั้ง</th>
              <th className="text-right">input</th>
              <th className="text-right">cache read</th>
              <th className="text-right">cache write</th>
              <th className="text-right">output</th>
              <th className="text-right">≈ USD</th>
            </tr>
          </thead>
          <tbody>
            {totals.length === 0 && (
              <tr><td colSpan={9} className="py-6 text-center text-stone-500">ยังไม่มีการเรียก API</td></tr>
            )}
            {totals.map((r, i) => {
              const cost = estimateCost(r);
              return (
                <tr key={i}>
                  <td>{r.novelTh || r.novel || "-"}</td>
                  <td>{KIND_LABELS[r.kind] ?? r.kind}</td>
                  <td className="font-mono text-xs">{r.model}</td>
                  <td className="text-right">{r.calls}</td>
                  <td className="text-right">{r.inputTokens.toLocaleString()}</td>
                  <td className="text-right">{r.cacheReadTokens.toLocaleString()}</td>
                  <td className="text-right">{r.cacheWriteTokens.toLocaleString()}</td>
                  <td className="text-right">{r.outputTokens.toLocaleString()}</td>
                  <td className="text-right">{cost === null ? "?" : `$${cost.toFixed(3)}`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
