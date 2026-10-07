import { NextResponse } from "next/server";
import { extractTerms } from "@/lib/pipeline/extract";
import { describeError, hasApiKey } from "@/lib/ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    if (!hasApiKey()) throw new Error("ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY");
    return NextResponse.json(await extractTerms(Number(id)));
  } catch (err) {
    return NextResponse.json({ error: describeError(err) }, { status: 500 });
  }
}
