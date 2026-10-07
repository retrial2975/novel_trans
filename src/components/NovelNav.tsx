import Link from "next/link";
import type { Novel } from "@/db/schema";

export function NovelNav({ novel, pending, active }: { novel: Novel; pending?: number; active?: string }) {
  const tabs = [
    { key: "chapters", href: `/novels/${novel.id}`, label: "ตอน" },
    { key: "review", href: `/novels/${novel.id}/review`, label: `รีวิวคำใหม่${pending ? ` (${pending})` : ""}` },
    { key: "glossary", href: `/novels/${novel.id}/glossary`, label: "คลังคำ" },
    { key: "characters", href: `/novels/${novel.id}/characters`, label: "ตัวละคร & สรรพนาม" },
  ];
  return (
    <div className="mb-5 space-y-2">
      <div>
        <h1 className="text-2xl font-semibold">{novel.titleTh || novel.titleZh}</h1>
        {novel.titleTh && <div className="text-sm text-stone-500">{novel.titleZh}</div>}
      </div>
      <div className="flex flex-wrap gap-1 border-b border-stone-200 dark:border-stone-800">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              active === t.key ? "border-amber-600 font-medium" : "border-transparent text-stone-500 hover:text-stone-800 dark:hover:text-stone-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
