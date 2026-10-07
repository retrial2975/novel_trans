import type { ChapterStatus } from "@/db/schema";

const MAP: Record<ChapterStatus, [string, string]> = {
  new: ["ยังไม่แปล", "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300"],
  terms_pending: ["รอ review คำ", "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"],
  ready: ["พร้อมแปล", "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"],
  translated: ["แปลแล้ว", "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"],
};

export function StatusBadge({ status }: { status: ChapterStatus }) {
  const [label, cls] = MAP[status] ?? MAP.new;
  return <span className={`badge ${cls}`}>{label}</span>;
}
