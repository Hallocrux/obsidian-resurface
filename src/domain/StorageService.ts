/**
 * StorageService
 *
 * Persistence plus the NoteId/path index. Review decisions stay in
 * ReviewService; this module only owns durable data and identity rebinding.
 */

import type { Plugin } from "obsidian";
import {
  CURRENT_SCHEMA_VERSION,
  createDefaultData,
  type NoteId,
  type NotePath,
  type NoteState,
  type ResurfaceData,
  type ReviewLogEntry,
  type ReviewMode,
  type Settings,
  type FsrsCardState,
} from "./types";
import { isValidNoteId, legacyNoteId } from "./identity";
import { State } from "ts-fsrs";

type UnknownRecord = Record<string, unknown>;

export interface IdentityReconciliation {
  note: NoteState | null;
  conflict: boolean;
}

export class StorageService {
  /** 对外暴露的 data 引用。load() 后可用 */
  data!: ResurfaceData;

  private readonly pathIndex = new Map<NotePath, NoteId>();
  private saveScheduleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly plugin: Plugin) {}

  /** 插件启动时调用 */
  async load(): Promise<void> {
    const raw = (await this.plugin.loadData()) as UnknownRecord | null;
    if (!raw) {
      this.data = createDefaultData();
      this.rebuildPathIndex();
      await this.save();
      return;
    }

    this.data = this.migrate(raw);
    this.rebuildPathIndex();
    // Persist the v2 shape immediately. Legacy IDs are deterministic and will
    // be rebound to frontmatter IDs during the vault backfill pass.
    if (Number(raw.version ?? 0) !== CURRENT_SCHEMA_VERSION) {
      await this.save();
    }
  }

  /** 立刻持久化到 data.json */
  async save(): Promise<void> {
    await this.plugin.saveData(this.data);
  }

  /** 延迟持久化（合并短时间内的多个文件事件）。 */
  scheduleSave(delayMs = 500): void {
    if (this.saveScheduleTimer) clearTimeout(this.saveScheduleTimer);
    this.saveScheduleTimer = setTimeout(() => {
      this.saveScheduleTimer = null;
      void this.save();
    }, delayMs);
  }

  getNoteById(id: NoteId): NoteState | undefined {
    return this.data.notes[id];
  }

  getNoteByPath(path: NotePath): NoteState | undefined {
    const indexedId = this.pathIndex.get(path);
    if (indexedId) {
      const indexed = this.data.notes[indexedId];
      if (indexed) return indexed;
    }

    // This fallback heals indexes after external data edits or a partially
    // completed migration.
    const found = Object.values(this.data.notes).find(
      (note) => note.path === path,
    );
    if (found) this.pathIndex.set(path, found.id);
    return found;
  }

  /** 新笔记或身份协调后写入 active notes。 */
  upsertNote(note: NoteState): void {
    const existing = this.data.notes[note.id];
    if (existing && existing.path !== note.path) {
      this.pathIndex.delete(existing.path);
    }
    this.data.notes[note.id] = note;
    this.pathIndex.set(note.path, note.id);
  }

  /**
   * Associate a file's frontmatter ID with its existing state.
   * legacyPath is used for v1 path-keyed records and rename events.
   */
  reconcileIdentity(
    id: NoteId,
    path: NotePath,
    legacyPath?: NotePath,
  ): IdentityReconciliation {
    const owner = this.data.notes[id];
    if (owner && owner.path !== path && owner.path !== legacyPath) {
      return { note: null, conflict: true };
    }

    let note = owner;
    if (!note) {
      const candidate =
        (legacyPath ? this.getNoteByPath(legacyPath) : undefined) ??
        this.getNoteByPath(path);
      if (!candidate) return { note: null, conflict: false };

      const previousId = candidate.id;
      delete this.data.notes[candidate.id];
      this.pathIndex.delete(candidate.path);
      note = { ...candidate, id, path };
      this.rebindRevlog(previousId, id);
    } else if (note.path !== path) {
      this.pathIndex.delete(note.path);
      note.path = path;
    }

    note.id = id;
    note.path = path;
    this.data.notes[id] = note;
    this.pathIndex.set(path, id);
    return { note, conflict: false };
  }

  /** Keep historical review entries attached when a temporary identity is replaced. */
  private rebindRevlog(previousId: NoteId, nextId: NoteId): void {
    if (previousId === nextId) return;
    for (const entry of this.data.revlog) {
      if (entry.noteId === previousId) entry.noteId = nextId;
    }
  }

  /** Rename fallback for files that do not yet have frontmatter identity. */
  onRename(oldPath: NotePath, newPath: NotePath): void {
    if (oldPath === newPath) return;
    const note = this.getNoteByPath(oldPath);
    if (note) {
      this.pathIndex.delete(oldPath);
      note.path = newPath;
      this.pathIndex.set(newPath, note.id);
    }
    this.scheduleSave();
  }

  /** 笔记删除：按稳定 ID 归档。 */
  onDelete(path: NotePath): void {
    const note = this.getNoteByPath(path);
    if (!note) return;

    delete this.data.notes[note.id];
    this.pathIndex.delete(path);
    this.data.archive[note.id] = note;
    this.scheduleSave();
  }

  /** 添加一条 FSRS 复习记录 */
  appendRevlog(entry: ReviewLogEntry): void {
    this.data.revlog.push(entry);
  }

  listSuspended(): Array<{ id: NoteId; note: NoteState }> {
    return Object.entries(this.data.notes)
      .filter(([, note]) => note.mode === "suspended")
      .map(([id, note]) => ({ id, note }));
  }

  /** Pull future active reviews one calendar day closer to the present. */
  advanceFutureReviewsByOneDay(now: Date = new Date()): number {
    const nowMs = now.getTime();
    if (Number.isNaN(nowMs)) return 0;

    let changed = 0;
    for (const note of Object.values(this.data.notes)) {
      if (note.mode === "suspended" || !note.nextReview) continue;

      const nextReview = new Date(note.nextReview);
      if (Number.isNaN(nextReview.getTime()) || nextReview.getTime() <= nowMs) {
        continue;
      }

      nextReview.setDate(nextReview.getDate() - 1);
      note.nextReview = nextReview.toISOString();
      changed++;
    }
    return changed;
  }

  // ─── Schema 迁移 ──────────────────────────

  private migrate(raw: UnknownRecord): ResurfaceData {
    const defaults = createDefaultData();
    const settings = migrateSettings(raw.settings, defaults.settings);
    const notes = migrateCollection(raw.notes, settings);
    const archive = migrateCollection(raw.archive, settings);

    return {
      version: CURRENT_SCHEMA_VERSION,
      settings,
      notes,
      archive,
      revlog: migrateRevlog(raw.revlog, notes, archive),
      stats: {
        ...defaults.stats,
        ...(isRecord(raw.stats) ? raw.stats : {}),
      },
      fsrsParams: isRecord(raw.fsrsParams)
        ? (raw.fsrsParams as unknown as ResurfaceData["fsrsParams"])
        : null,
    };
  }

  private rebuildPathIndex(): void {
    this.pathIndex.clear();
    for (const note of Object.values(this.data.notes)) {
      this.pathIndex.set(note.path, note.id);
    }
  }
}

function migrateSettings(raw: unknown, defaults: Settings): Settings {
  const source = isRecord(raw) ? raw : {};
  const { dailyLimit: _dailyLimit, ...withoutLegacyBudget } = source;
  const later = normaliseIntervals(source.rediscoveryLaterIntervals);
  return {
    ...defaults,
    ...withoutLegacyBudget,
    // dailyLimit deliberately has no v2 consumer.
    rediscoverySoonDays: positiveNumber(source.rediscoverySoonDays, 3),
    rediscoveryLaterIntervals: later,
    allowedPaths: Array.isArray(source.allowedPaths)
      ? source.allowedPaths.filter((path): path is string => typeof path === "string")
      : [...defaults.allowedPaths],
  } as Settings;
}

function migrateCollection(
  raw: unknown,
  settings: Settings,
): Record<NoteId, NoteState> {
  const output: Record<NoteId, NoteState> = {};
  if (!isRecord(raw)) return output;

  for (const [key, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const path = stringOr(value.path, key);
    // v1 had no durable ID. Invalid IDs are treated as temporary path-backed
    // identities so the watcher can replace them with a UUID after backfill.
    let id = isValidNoteId(value.id) ? value.id : legacyNoteId(path);
    if (output[id]) id = `${legacyNoteId(path)}#duplicate`;
    output[id] = migrateNote(value, id, path, settings);
  }
  return output;
}

function migrateNote(
  raw: UnknownRecord,
  id: NoteId,
  path: NotePath,
  settings: Settings,
): NoteState {
  const addedAt = stringOr(raw.addedAt, new Date().toISOString());
  const oldNextReview = nullableString(raw.nextReview);
  const oldLastReview = nullableString(raw.lastReview);
  const excluded = raw.excluded === true;
  const oldMode = raw.mode;
  const isV2 = isReviewMode(oldMode);

  if (isV2) {
    const mode = oldMode;
    const fsrs =
      (mode === "learning" || mode === "suspended") &&
      (isRecord(raw.fsrs) || typeof raw.stability === "number")
      ? migrateFsrs(raw)
      : null;
    return {
      id,
      path,
      mode,
      addedAt,
      nextReview: mode === "suspended" ? null : oldNextReview,
      rediscovery: mode === "learning" ? null : migrateRediscovery(raw),
      fsrs,
      suspendedAt: nullableString(raw.suspendedAt),
      characterCount: numberOr(raw.characterCount, -1),
      lastSnapshotLength: numberOr(raw.lastSnapshotLength, 0),
      lastSnapshotHash: stringOr(raw.lastSnapshotHash, ""),
      lastEditTriggerAt: nullableString(raw.lastEditTriggerAt),
    };
  }

  const migratedMode = excluded
    ? "suspended"
    : oldLastReview
      ? "learning"
      : "incubating";
  const fsrs = oldLastReview ? migrateFsrs(raw) : null;
  return {
    id,
    path,
    mode: migratedMode,
    addedAt,
    nextReview: migratedMode === "suspended" ? null : oldNextReview,
    rediscovery:
      migratedMode === "learning"
        ? null
        : { level: 0, lastSeenAt: null },
    fsrs,
    suspendedAt: excluded
      ? nullableString(raw.excludedAt) ?? new Date().toISOString()
      : null,
    characterCount: numberOr(raw.characterCount, -1),
    lastSnapshotLength: numberOr(raw.lastSnapshotLength, 0),
    lastSnapshotHash: stringOr(raw.lastSnapshotHash, ""),
    lastEditTriggerAt: nullableString(raw.lastEditTriggerAt),
  };
}

function migrateFsrs(raw: UnknownRecord): FsrsCardState {
  const source = isRecord(raw.fsrs) ? raw.fsrs : raw;
  return {
    stability: numberOr(source.stability, 0),
    difficulty: numberOr(source.difficulty, 0),
    lastReview: nullableString(source.lastReview),
    state: migrateFsrsState(source.state),
    reps: numberOr(source.reps, 0),
    lapses: numberOr(source.lapses, 0),
  };
}

function migrateFsrsState(value: unknown): State {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= State.New &&
    value <= State.Relearning
  ) {
    return value as State;
  }

  if (typeof value === "string") {
    const names: Record<string, State> = {
      new: State.New,
      learning: State.Learning,
      review: State.Review,
      relearning: State.Relearning,
    };
    return names[value.toLowerCase()] ?? State.New;
  }

  return State.New;
}

function migrateRediscovery(raw: UnknownRecord) {
  const source = isRecord(raw.rediscovery) ? raw.rediscovery : raw;
  return {
    level: Math.max(0, Math.floor(numberOr(source.level, 0))),
    lastSeenAt: nullableString(source.lastSeenAt),
  };
}

function migrateRevlog(
  raw: unknown,
  notes: Record<NoteId, NoteState>,
  archive: Record<NoteId, NoteState>,
): ReviewLogEntry[] {
  if (!Array.isArray(raw)) return [];
  const byPath = new Map<string, NoteId>();
  for (const note of [...Object.values(notes), ...Object.values(archive)]) {
    byPath.set(note.path, note.id);
  }

  return raw.flatMap((value): ReviewLogEntry[] => {
    if (!isRecord(value)) return [];
    const path = stringOr(value.path, "");
    const noteId = isValidNoteId(value.noteId)
      ? value.noteId
      : byPath.get(path) ?? legacyNoteId(path);
    return [
      {
        noteId,
        path,
        timestamp: stringOr(value.timestamp, new Date().toISOString()),
        rating: numberOr(value.rating, 3) as ReviewLogEntry["rating"],
        elapsedDays: numberOr(value.elapsedDays, 0),
        scheduledDays: numberOr(value.scheduledDays, 0),
        stabilityBefore: numberOr(value.stabilityBefore, 0),
        stabilityAfter: numberOr(value.stabilityAfter, 0),
        difficultyAfter: numberOr(value.difficultyAfter, 0),
      },
    ];
  });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReviewMode(value: unknown): value is ReviewMode {
  return (
    value === "incubating" ||
    value === "rediscovery" ||
    value === "learning" ||
    value === "suspended"
  );
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = numberOr(value, fallback);
  return number > 0 ? number : fallback;
}

function normaliseIntervals(value: unknown): number[] {
  const values = Array.isArray(value)
    ? value
        .filter(
          (entry): entry is number =>
            typeof entry === "number" &&
            Number.isInteger(entry) &&
            entry > 0,
        )
    : [];
  return values.length > 0 ? values : [30, 90, 180, 365];
}
