import { NextResponse } from "next/server";
import { reviewChapter } from "@/lib/pipeline/review";
import { describeError, hasApiKey } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!hasApiKey()) throw new Error("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY");
    return NextResponse.json(await reviewChapter(Number(id)));
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 500 });
  }
}
