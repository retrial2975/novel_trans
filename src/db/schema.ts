import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`);

export const stylePresets = sqliteTable("style_presets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  instructions: text("instructions").notNull(),
  // JSON: { zh: string; th: string }[]
  examples: text("examples", { mode: "json" })
    .$type<{ zh: string; th: string }[]>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: createdAt(),
});

export const novels = sqliteTable("novels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titleZh: text("title_zh").notNull(),
  titleTh: text("title_th"),
  defaultStyleId: integer("default_style_id").references(() => stylePresets.id, {
    onDelete: "set null",
  }),
  // "api": translate with the Anthropic API; "manual": copy prompts into a Claude chat / Project.
  translateMode: text("translate_mode").$type<"api" | "manual">().notNull().default("api"),
  createdAt: createdAt(),
});

export const CHAPTER_STATUSES = ["new", "terms_pending", "ready", "translated"] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const chapters = sqliteTable(
  "chapters",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    number: real("number").notNull(),
    titleZh: text("title_zh"),
    titleTh: text("title_th"),
    textZh: text("text_zh").notNull(),
    status: text("status").$type<ChapterStatus>().notNull().default("new"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chapters_novel_number").on(t.novelId, t.number)],
);

export const TERM_CATEGORIES = [
  "character",
  "technique",
  "place",
  "item",
  "sect",
  "title",
  "other",
] as const;
export type TermCategory = (typeof TERM_CATEGORIES)[number];

export const terms = sqliteTable(
  "terms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    novelId: integer("novel_id")
      .notNull()
      .references(() => novels.id, { onDelete: "cascade" }),
    zh: text("zh").notNull(),
    th: text("th").notNull(),
    pinyin: text("pinyin"),
    category: text("category").$type<TermCategory>().notNull().default("other"),
    notes: text("notes"),
    status: text("status").$type<"pending" | "approved">().notNull().default("approved"),
    firstChapter: real("first_chapter"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("terms_novel_zh").on(t.novelId, t.zh),
    index("terms_novel_status").on(t.novelId, t.status),
  ],
);

export const termAliases = sqliteTable(
  "term_aliases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    termId: integer("term_id")
      .notNull()
      .references(() => terms.id, { onDelete: "cascade" }),
    aliasZh: text("alias_zh").notNull(),
    // Optional: how this alias specifically should be rendered (e.g. 师兄 → ศิษย์พี่).
    // When empty, the main term's Thai is used as a hint only and not enforced by the checker.
    aliasTh: text("alias_th"),
  },
  (t) => [index("term_aliases_term").on(t.termId)],
);

export const characters = sqliteTable("characters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  termId: integer("term_id")
    .notNull()
    .unique()
    .references(() => terms.id, { onDelete: "cascade" }),
  gender: text("gender"),
  role: text("role"),
  description: text("description"),
  defaultSelfPronoun: text("default_self_pronoun"),
});

export const relationships = sqliteTable("relationships", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  novelId: integer("novel_id")
    .notNull()
    .references(() => novels.id, { onDelete: "cascade" }),
  speakerId: integer("speaker_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  listenerId: integer("listener_id")
    .notNull()
    .references(() => characters.id, { onDelete: "cascade" }),
  relation: text("relation"),
  selfPronoun: text("self_pronoun"),
  addressTerm: text("address_term"),
  validFromChapter: real("valid_from_chapter").notNull().default(1),
  notes: text("notes"),
  // AI-proposed changes arrive as "pending" and only affect prompts once approved.
  status: text("status").$type<"pending" | "approved">().notNull().default("approved"),
  createdAt: createdAt(),
});

export type TranslationIssue = {
  paragraph: number;
  zh: string;
  expected: string;
  termId: number;
};

export const translations = sqliteTable(
  "translations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chapterId: integer("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    styleId: integer("style_id").references(() => stylePresets.id, { onDelete: "set null" }),
    // One Thai string per source paragraph (same order as the chapter's paragraphs).
    segments: text("segments", { mode: "json" }).$type<string[]>().notNull(),
    textTh: text("text_th").notNull(),
    model: text("model").notNull(),
    version: integer("version").notNull(),
    issues: text("issues", { mode: "json" })
      .$type<TranslationIssue[]>()
      .notNull()
      .default(sql`'[]'`),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("translations_chapter_version").on(t.chapterId, t.version)],
);

export const chapterSummaries = sqliteTable("chapter_summaries", {
  chapterId: integer("chapter_id")
    .primaryKey()
    .references(() => chapters.id, { onDelete: "cascade" }),
  summary: text("summary").notNull(),
});

export const apiUsage = sqliteTable("api_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  novelId: integer("novel_id").references(() => novels.id, { onDelete: "set null" }),
  chapterId: integer("chapter_id").references(() => chapters.id, { onDelete: "set null" }),
  kind: text("kind").$type<"extract" | "translate" | "review">().notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  createdAt: createdAt(),
});

export type Novel = typeof novels.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type Term = typeof terms.$inferSelect;
export type TermAlias = typeof termAliases.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Relationship = typeof relationships.$inferSelect;
export type StylePreset = typeof stylePresets.$inferSelect;
export type Translation = typeof translations.$inferSelect;
