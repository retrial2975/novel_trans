"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getManualExtractPrompt,
  getManualTranslatePrompt,
  importManualTerms,
  importManualTranslation,
} from "@/app/manual-actions";

/** Copy text even on plain-http LAN addresses, where navigator.clipboard is unavailable. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

type Props = {
  chapterId: number;
  styleId: number | null;
  hasTranslation: boolean;
  missingCount: number;
};

export function ManualPanel({ chapterId, styleId, hasTranslation, missingCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [prompt, setPrompt] = useState<{ kind: string; text: string } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [termsAnswer, setTermsAnswer] = useState("");
  const [answer, setAnswer] = useState("");
  const [merge, setMerge] = useState(hasTranslation && missingCount > 0);

  const showPrompt = async (kind: string, text: string) => {
    const copied = await copyText(text);
    setPrompt({ kind, text });
    setMessage({
      ok: copied,
      text: copied
        ? `คัดลอก${kind}แล้ว — ไปวางในแชท Claude ได้เลย`
        : "คัดลอกอัตโนมัติไม่ได้ — กดในกล่องด้านล่างแล้วคัดลอกเอง (Ctrl/⌘+A, Ctrl/⌘+C)",
    });
  };

  const run = (fn: () => Promise<void>) => startTransition(fn);

  return (
    <div className="card space-y-4">
      <div className="text-sm text-stone-500">
        โหมดแปลผ่านแชท Claude (ไม่ใช้ API): คัดลอก prompt → วางในแชท/Project → คัดลอกคำตอบทั้งหมดกลับมาวางที่นี่
      </div>

      {/* Step 1: extraction */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">① สกัดคำใหม่</span>
          <button
            className="btn"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await getManualExtractPrompt(chapterId);
                if (r.ok) await showPrompt(" prompt สกัดคำ", r.data);
                else setMessage({ ok: false, text: r.error });
              })
            }
          >
            คัดลอก prompt สกัดคำ
          </button>
        </div>
        <textarea
          className="input font-mono text-xs"
          rows={3}
          placeholder="วางคำตอบ (JSON) จาก Claude ที่นี่"
          value={termsAnswer}
          onChange={(e) => setTermsAnswer(e.target.value)}
        />
        <button
          className="btn"
          disabled={pending || !termsAnswer.trim()}
          onClick={() =>
            run(async () => {
              const r = await importManualTerms(chapterId, termsAnswer);
              if (!r.ok) return setMessage({ ok: false, text: r.error });
              setTermsAnswer("");
              setMessage({
                ok: true,
                text: r.data.added.length
                  ? `เพิ่มคำใหม่ ${r.data.added.length} คำ (รอ review): ${r.data.added.join(", ")}`
                  : "ไม่มีคำใหม่ (คำทั้งหมดมีในคลังแล้ว)",
              });
              router.refresh();
            })
          }
        >
          นำเข้าคำ
        </button>
      </div>

      {/* Step 2: translation */}
      <div className="space-y-2 border-t border-stone-100 pt-4 dark:border-stone-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">② แปล</span>
          <button
            className="btn-primary"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const r = await getManualTranslatePrompt(chapterId, styleId);
                if (!r.ok) return setMessage({ ok: false, text: r.error });
                setMerge(false);
                await showPrompt(` prompt แปล (${r.data.paragraphs} ย่อหน้า)`, r.data.prompt);
              })
            }
          >
            คัดลอก prompt แปล
          </button>
          {hasTranslation && missingCount > 0 && (
            <button
              className="btn"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  const r = await getManualTranslatePrompt(chapterId, styleId, true);
                  if (!r.ok) return setMessage({ ok: false, text: r.error });
                  setMerge(true);
                  await showPrompt(` prompt เฉพาะ ${r.data.paragraphs} ย่อหน้าที่ขาด`, r.data.prompt);
                })
              }
            >
              คัดลอก prompt เฉพาะย่อหน้าที่ขาด ({missingCount})
            </button>
          )}
        </div>
        <textarea
          className="input text-sm"
          rows={6}
          placeholder="วางคำตอบทั้งหมดจาก Claude ที่นี่ (ถ้าตอบเป็นหลายข้อความ วางทีละข้อความแล้วติ๊ก 'เติมต่อจากเดิม')"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary"
            disabled={pending || !answer.trim()}
            onClick={() =>
              run(async () => {
                const r = await importManualTranslation(chapterId, styleId, answer, merge && hasTranslation);
                if (!r.ok) return setMessage({ ok: false, text: r.error });
                const d = r.data;
                const parts = [`รับคำแปล ${d.received} ย่อหน้า`];
                if (d.version) parts.push(`บันทึกเป็น v${d.version}`);
                if (d.missing.length) parts.push(`ยังขาด ${d.missing.length} ย่อหน้า (ส่ง "ต่อ" ในแชท หรือกดคัดลอก prompt เฉพาะย่อหน้าที่ขาด)`);
                if (d.issues) parts.push(`ไม่ตรงคลังคำ ${d.issues} จุด`);
                if (d.summary) parts.push("บันทึกสรุปตอนแล้ว");
                if (d.proposed) parts.push(`เสนอเปลี่ยนสรรพนาม ${d.proposed} รายการ (รออนุมัติ)`);
                setMessage({ ok: d.missing.length === 0, text: parts.join(" · ") });
                setAnswer("");
                setMerge(d.missing.length > 0);
                router.refresh();
              })
            }
          >
            นำเข้าคำแปล
          </button>
          {hasTranslation && (
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
              เติมต่อจากคำแปลล่าสุด (ไม่สร้างเวอร์ชันใหม่)
            </label>
          )}
        </div>
      </div>

      {message && (
        <div
          className={`rounded-md p-2 text-sm ${
            message.ok
              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
              : "bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {message.text}
        </div>
      )}

      {prompt && (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-500">
            ดู/คัดลอก{prompt.kind}เอง ({prompt.text.length.toLocaleString()} ตัวอักษร)
          </summary>
          <textarea
            readOnly
            className="input mt-2 font-mono text-xs"
            rows={10}
            value={prompt.text}
            onFocus={(e) => e.currentTarget.select()}
          />
        </details>
      )}
    </div>
  );
}
