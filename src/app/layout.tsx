import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Novel Translator",
  description: "แปลนิยายจีนเป็นไทยด้วย AI พร้อมคลังคำและระบบสรรพนาม",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body className="antialiased">
        <header className="border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900">
          <nav className="mx-auto flex max-w-6xl items-center gap-5 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold text-amber-800 dark:text-amber-500">
              📖 Novel Translator
            </Link>
            <Link href="/" className="hover:underline">นิยาย</Link>
            <Link href="/presets" className="hover:underline">แนวการแปล</Link>
            <Link href="/usage" className="hover:underline">ค่าใช้จ่าย API</Link>
          </nav>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
