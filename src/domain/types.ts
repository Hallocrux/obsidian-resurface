/**
 * Resurface domain data types.
 *
 * A NoteId is the durable identity of a note. The path is only its current
 * location in the vault and may change when Obsidian or another tool moves the
 * file.
 */

import type { State } from "ts-fsrs";

/** 笔记路径（相对 vault 根目录） */
export type NotePath = string;

/** 稳定笔记身份（写入 Markdown frontmatter） */
export type NoteId = string;

/** Obsidian frontmatter 中由 Resurface 管理的字段 */
export const NOTE_ID_FRONTMATTER_KEY = "resurface-id";

/** ISO 8601 时间戳 */
export type ISOTimestamp = string;

/** FSRS 评分：1=Again, 2=Hard, 3=Good, 4=Easy */
export type Rating = 1 | 2 | 3 | 4;

export type ReviewMode =
  | "incubating"
  | "rediscovery"
  | "learning"
  | "suspended";

export type TriageAction = "never" | "later" | "soon" | "learn";

/** Learning actions use human-readable names plus the universal Never action. */
export type LearningAction = "again" | "hard" | "good" | "easy" | "never";

export type ReviewAction = TriageAction | LearningAction;

export interface RediscoveryState {
  /** Number of completed Later decisions. */
  level: number;
  lastSeenAt: ISOTimestamp | null;
}

/** The serialisable part of an FSRS card. The due date lives on NoteState. */
export interface FsrsCardState {
  stability: number;
  difficulty: number;
  lastReview: ISOTimestamp | null;
  state: State;
  reps: number;
  lapses: number;
}

/** data.json 顶层结构 */
export interface ResurfaceData {
  version: number;
  settings: Settings;
  notes: Record<NoteId, NoteState>;
  archive: Record<NoteId, NoteState>;
  revlog: ReviewLogEntry[];
  stats: Stats;
  fsrsParams: FSRSParameters | null;
}

/** 用户设置 */
export interface Settings {
  // 基础层
  firstReviewDays: number;
  firstReviewJitter: number;
  rediscoverySoonDays: number;
  rediscoveryLaterIntervals: number[];
  ratingMode: "2-button" | "4-button";
  autoAdvance: boolean;

  /** 允许进入复习池的目录；空数组表示整个 vault。 */
  allowedPaths: string[];

  /** 低于该字符数的笔记不进入队列；0 表示不限制。 */
  minCharacters: number;

  // 高级层
  desiredRetention: number;
  tldrFieldName: string;
  tldrFallbackLength: number;
  showStreak: boolean;

  /** Retained for schema compatibility; edit-trigger scheduling is not active in v2. */
  editThresholdAbsolute: number;
  editThresholdRatio: number;
  editTriggerAction: "x0.3" | "x0.5" | "x0.7" | "reset" | "none";

  dayBoundaryHour: number;
}

/** 一条笔记的完整状态 */
export interface NoteState {
  id: NoteId;
  path: NotePath;
  mode: ReviewMode;
  addedAt: ISOTimestamp;
  nextReview: ISOTimestamp | null;

  rediscovery: RediscoveryState | null;
  fsrs: FsrsCardState | null;
  suspendedAt: ISOTimestamp | null;

  // 现有字符数过滤
  characterCount: number;

  // 旧版本已写入的编辑跟踪字段，v2 暂不驱动调度
  lastSnapshotLength: number;
  lastSnapshotHash: string;
  lastEditTriggerAt: ISOTimestamp | null;
}

/** 复习记录（FSRS 评分时记录当前路径快照；triage 不伪装成 FSRS log） */
export interface ReviewLogEntry {
  noteId: NoteId;
  path: NotePath;
  timestamp: ISOTimestamp;
  rating: Rating;
  elapsedDays: number;
  scheduledDays: number;
  stabilityBefore: number;
  stabilityAfter: number;
  difficultyAfter: number;
}

/** 统计指标 */
export interface Stats {
  totalReviews: number;
  streakDays: number;
  lastReviewDate: string; // YYYY-MM-DD，用于 streak 计算
  firstUseDate: ISOTimestamp;
}

/** 用户个性化 FSRS 参数（MVP 不用，后续再做） */
export interface FSRSParameters {
  w: number[];
  lastOptimizedAt: ISOTimestamp;
  trainingSize: number;
}

/** 默认设置 */
export const DEFAULT_SETTINGS: Settings = {
  firstReviewDays: 3,
  firstReviewJitter: 1,
  rediscoverySoonDays: 3,
  rediscoveryLaterIntervals: [30, 90, 180, 365],
  ratingMode: "2-button",
  autoAdvance: false,

  allowedPaths: [],
  minCharacters: 50,

  desiredRetention: 0.9,
  tldrFieldName: "tldr",
  tldrFallbackLength: 100,
  showStreak: true,

  editThresholdAbsolute: 50,
  editThresholdRatio: 0.2,
  editTriggerAction: "x0.5",

  dayBoundaryHour: 4,
};

/** 当前 data.json schema 版本 */
export const CURRENT_SCHEMA_VERSION = 2;

/** 首次加载时的默认 data */
export function createDefaultData(): ResurfaceData {
  return {
    version: CURRENT_SCHEMA_VERSION,
    settings: {
      ...DEFAULT_SETTINGS,
      rediscoveryLaterIntervals: [...DEFAULT_SETTINGS.rediscoveryLaterIntervals],
    },
    notes: {},
    archive: {},
    revlog: [],
    stats: {
      totalReviews: 0,
      streakDays: 0,
      lastReviewDate: "",
      firstUseDate: new Date().toISOString(),
    },
    fsrsParams: null,
  };
}
