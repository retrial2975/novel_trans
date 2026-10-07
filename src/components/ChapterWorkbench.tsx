"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { TranslationIssue } from "@/db/schema";
import { saveSegment } from "@/app/actions";

type Props = {
  chapterId: number;
  paragraphs: string[];
  translation: { id: number; segments: string[]; issues: TranslationIssue[]; version: number } | null;
  versions: { version: number; label: string }[];
  presets: { id: number; name: string }[];
  defaultStyleId: number | null;
  models: string[];
  defaultModel: string;
};

export function ChapterWorkbench(props: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [styleId, setStyleId] = useState(props.defaultStyleId ?? undefined);
  const [model, setModel] = useState(props.defaultModel);
  const [busy, setBusy] = useState<null | "extract" | "translate">(null);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const issuesByParagraph = useMemo(() => {
    const m = new Map<number, TranslationIssue[]>();
    for (const i of props.translation?.issues ?? []) m.set(i.paragraph, [...(m.get(i.paragraph) ?? []), i]);
    return m;
  }, [props.translation]);

  const addLog = (s: string) => setLog((l) => [...l, s]);

  async function extract() {
    setBusy("extract");
    setLog([]);
    addLog("กำลังสกัดคำเฉพาะ...");
    try {
      const res = await fetch(`/api/chapters/${props.chapterId}/extract`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      addLog(data.added.length ? `พบคำใหม่ ${data.added.length} คำ: ${data.added.join(", ")}` : "ไม่พบคำใหม่");
      router.refresh();
    } catch (e) {
      addLog(`ผิดพลาด: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function translate() {
    setBusy("translate");
    setLog([]);
    setProgress(null);
    try {
      const res = await fetch(`/api/chapters/${props.chapterId}/translate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ styleId, model }),
      });
      if (!res.body) throw new Error("ไม่มีการตอบกลับจากเซิร์ฟเวอร์");
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const ev = JSON.parse(line);
          switch (ev.type) {
            case "start":
              setProgress({ done: 0, total: ev.chunks });
              addLog(`เริ่มแปล ${ev.paragraphs} ย่อหน้า แบ่งเป็น ${ev.chunks} ช่วง`);
              break;
            case "chunk":
              setProgress((p) => (p ? { ...p, done: ev.done } : p));
              break;
            case "saved":
              addLog(`บันทึกเวอร์ชัน v${ev.version} แล้ว${ev.issues ? ` — พบจุดที่ไม่ตรงคลังคำ ${ev.issues} จุด` : ""}`);
              router.push(pathname);
              router.refresh();
              break;
            case "review_start":
              addLog("กำลังสรุปตอนและตรวจความสัมพันธ์...");
              break;
            case "review_done":
              addLog(`สรุปตอนแล้ว${ev.proposed ? ` — AI เสนอเปลี่ยนสรรพนาม ${ev.proposed} รายการ (รออนุมัติ)` : ""}`);
              router.refresh();
              break;
            case "review_error":
              addLog(`สรุป/ตรวจไม่สำเร็จ: ${ev.message}`);
              break;
            case "error":
              addLog(`ผิดพลาด: ${ev.message}`);
              break;
          }
        }
      }
    } catch (e) {
      addLog(`ผิดพลาด: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  const tr = props.translation;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3">
        <div>
          <label className="label">แนวการแปล</label>
          <select className="input" value={styleId} onChange={(e) => setStyleId(Number(e.target.value))}>
            {props.presets.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">โมเดลแปล</label>
          <select className="input" value={model} onChange={(e) => setModel(e.target.value)}>
            {props.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <button className="btn" disabled={!!busy} onClick={extract}>
          {busy === "extract" ? "กำลังสกัด..." : "① สกัดคำใหม่"}
        </button>
        <button className="btn-primary" disabled={!!busy} onClick={translate}>
          {busy === "translate" ? "กำลังแปล..." : tr ? "② แปลใหม่" : "② แปล"}
        </button>
        {props.versions.length > 0 && (
          <div className="ml-auto">
            <label className="label">เวอร์ชัน</label>
            <select
              className="input"
              value={tr?.version}
              onChange={(e) => router.push(`${pathname}?v=${e.target.value}`)}
            >
              {props.versions.map((v) => (
                <option key={v.version} value={v.version}>{v.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {(log.length > 0 || progress) && (
        <div className="card space-y-1 text-sm">
          {progress && (
            <div className="mb-2 h-2 overflow-hidden rounded bg-stone-200 dark:bg-stone-800">
              <div
                className="h-full bg-amber-600 transition-all"
                style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          )}
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {tr && tr.issues.length > 0 && (
        <div className="flex items-center gap-3 text-sm">
          <span className="badge bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
            ไม่ตรงคลังคำ {tr.issues.length} จุด
          </span>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
            แสดงเฉพาะย่อหน้าที่มีปัญหา
          </label>
        </div>
      )}

      <div className="card divide-y divide-stone-100 p-0 dark:divide-stone-800">
        {props.paragraphs.map((zh, i) => {
          const issues = issuesByParagraph.get(i);
          if (onlyIssues && !issues) return null;
          return (
            <div key={`${tr?.id}-${i}`} className="grid gap-4 p-3 md:grid-cols-2">
              <div className="text-[15px] leading-7">
                <span className="mr-2 select-none text-xs text-stone-400">{i + 1}</span>
                {zh}
              </div>
              <div>
                {tr ? (
                  <Segment translationId={tr.id} index={i} initial={tr.segments[i] ?? ""} />
                ) : (
                  <span className="text-sm text-stone-400">—</span>
                )}
                {issues && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {issues.map((iss, k) => (
                      <span key={k} className="badge bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
                        {iss.zh} ควรเป็น “{iss.expected}”
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Segment({ translationId, index, initial }: { translationId: number; index: number; initial: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(initial);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <div
        className="cursor-text whitespace-pre-wrap rounded text-[15px] leading-7 hover:bg-amber-50 dark:hover:bg-stone-800"
        title="คลิกเพื่อแก้ไข"
        onClick={() => setEditing(true)}
      >
        {text || <span className="text-sm text-red-500">(ไม่มีคำแปล — คลิกเพื่อเพิ่ม)</span>}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <textarea
        autoFocus
        className="input text-[15px] leading-7"
        rows={Math.max(3, Math.ceil(text.length / 60))}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          className="btn-primary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await saveSegment(translationId, index, text);
              setEditing(false);
              router.refresh();
            })
          }
        >
          บันทึก
        </button>
        <button
          className="btn"
          onClick={() => {
            setText(initial);
            setEditing(false);
          }}
        >
          ยกเลิก
        </button>
      </div>
    </div>
  );
}
