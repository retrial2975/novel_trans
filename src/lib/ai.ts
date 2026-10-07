import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getDb, schema } from "@/db";

export const MODELS = {
  /** Translation: large model. */
  translate: process.env.TRANSLATE_MODEL ?? "claude-sonnet-5-5",
  /** Extraction / summaries / relationship suggestions: small, cheap model. */
  small: process.env.SMALL_MODEL ?? "claude-haiku-4-5",
};

export const TRANSLATE_MODEL_CHOICES = ["claude-sonnet-5-5", "claude-opus-5-5"];

export const EFFORT = (process.env.TRANSLATE_EFFORT ?? "medium") as
  | "low"
  | "medium"
  | "high";

// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
const FALLBACK_MODELS = new Set(["claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1"]);
export const fallbacksEnabled = (model: string) =>
  process.env.ANTHROPIC_FALLBACKS !== "off" && FALLBACK_MODELS.has(model);

let client: Anthropic | null = null;
export function getClient(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

type UsageLike = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export function recordUsage(opts: {
  kind: "extract" | "translate" | "review";
  model: string;
  usage: UsageLike;
  novelId?: number;
  chapterId?: number;
}) {
  getDb()
    .insert(schema.apiUsage)
    .values({
      kind: opts.kind,
      model: opts.model,
      novelId: opts.novelId,
      chapterId: opts.chapterId,
      inputTokens: opts.usage.input_tokens,
      outputTokens: opts.usage.output_tokens,
      cacheReadTokens: opts.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: opts.usage.cache_creation_input_tokens ?? 0,
    })
    .run();
}

export class RefusalError extends Error {
  constructor(category?: string | null) {
    super(`โมเดลปฏิเสธคำขอ${category ? ` (หมวด: ${category})` : ""}`);
  }
}

/** Human-readable message for an error thrown by the SDK. */
export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return "API key ไม่ถูกต้อง (ตรวจ ANTHROPIC_API_KEY)";
  if (err instanceof Anthropic.RateLimitError) return "ถูกจำกัดอัตราการเรียก API — ลองใหม่อีกครั้งภายหลัง";
  if (err instanceof Anthropic.BadRequestError) return `คำขอไม่ถูกต้อง: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** USD per million tokens: [input, output]. Cache reads ≈ 0.1× input, writes ≈ 1.25× input. */
export const PRICING: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
};

export function estimateCost(row: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}): number | null {
  const p = PRICING[row.model];
  if (!p) return null;
  const [inp, out] = p;
  return (
    (row.inputTokens * inp +
      row.cacheReadTokens * inp * 0.1 +
      row.cacheWriteTokens * inp * 1.25 +
      row.outputTokens * out) /
    1_000_000
  );
}
