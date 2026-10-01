import { describe, it, expect } from "vitest";
import { Scheduler } from "../src/domain/Scheduler";
import type { StorageService } from "../src/domain/StorageService";
import { DEFAULT_SETTINGS, type NoteState } from "../src/domain/types";
import { State } from "ts-fsrs";

function makeNote(
  id: string,
  path: string,
  partial: Partial<NoteState> = {},
): NoteState {
  return {
    id,
    path,
    mode: "rediscovery",
    addedAt: "2026-04-15T00:00:00Z",
    nextReview: "2026-04-21T00:00:00Z",
    rediscovery: { level: 0, lastSeenAt: null },
    fsrs: null,
    suspendedAt: null,
    characterCount: 500,
    lastSnapshotLength: 100,
    lastSnapshotHash: "abc",
    lastEditTriggerAt: null,
    ...partial,
  };
}

function makeEnv(notes: Record<string, NoteState>) {
  const storage = {
    data: {
      settings: {
        ...DEFAULT_SETTINGS,
        rediscoveryLaterIntervals: [...DEFAULT_SETTINGS.rediscoveryLaterIntervals],
      },
      notes,
      archive: {},
      revlog: [],
      stats: {
        totalReviews: 0,
        streakDays: 0,
        lastReviewDate: "",
        firstUseDate: "",
      },
      fsrsParams: null,
      version: 2,
    },
  } as unknown as StorageService;
  return { storage, scheduler: new Scheduler(storage) };
}

describe("Scheduler", () => {
  const now = new Date("2026-04-21T15:00:00Z");

  it("suspended notes do not appear", () => {
    const { scheduler } = makeEnv({
      a: makeNote("id-a", "a.md"),
      b: makeNote("id-b", "b.md", { mode: "suspended", nextReview: null }),
    });
    const queue = scheduler.getTodayQueue(new Set(), now);
    expect(queue.map((q) => q.path)).toEqual(["a.md"]);
  });

  it("orders all due notes by due time, then path", () => {
    const { scheduler } = makeEnv({
      a: makeNote("id-a", "a.md", { nextReview: "2026-04-21T04:00:00Z" }),
      b: makeNote("id-b", "b.md", { nextReview: "2026-04-20T04:00:00Z" }),
      c: makeNote("id-c", "c.md", { nextReview: "2026-04-21T04:00:00Z" }),
    });
    const queue = scheduler.getTodayQueue(new Set(), now);
    expect(queue.map((q) => q.path)).toEqual(["b.md", "a.md", "c.md"]);
  });

  it("includes both triage and learning stages", () => {
    const { scheduler } = makeEnv({
      triage: makeNote("id-triage", "triage.md"),
      learning: makeNote("id-learning", "learning.md", {
        mode: "learning",
        rediscovery: null,
        fsrs: {
          stability: 5,
          difficulty: 3,
          lastReview: "2026-04-18T10:00:00Z",
          state: State.Review,
          reps: 1,
          lapses: 0,
        },
      }),
    });
    const queue = scheduler.getTodayQueue(new Set(), now);
    expect(queue.map((q) => q.stage).sort()).toEqual(["learning", "triage"]);
  });

  it("includes a learning card that is due again on the same day", () => {
    const { scheduler } = makeEnv({
      today: makeNote("id-today", "today.md", {
        mode: "learning",
        nextReview: "2026-04-21T14:00:00Z",
        rediscovery: null,
        fsrs: {
          stability: 5,
          difficulty: 3,
          lastReview: "2026-04-21T10:00:00Z",
          state: State.Review,
          reps: 1,
          lapses: 0,
        },
      }),
      yesterday: makeNote("id-yesterday", "yesterday.md", {
        mode: "learning",
        rediscovery: null,
        fsrs: {
          stability: 5,
          difficulty: 3,
          lastReview: "2026-04-20T10:00:00Z",
          state: State.Review,
          reps: 1,
          lapses: 0,
        },
      }),
    });
    expect(scheduler.getTodayQueue(new Set(), now).map((q) => q.path)).toEqual([
      "yesterday.md",
      "today.md",
    ]);
  });

  it("future notes do not appear", () => {
    const { scheduler } = makeEnv({
      future: makeNote("id-future", "future.md", {
        nextReview: "2026-04-25T00:00:00Z",
      }),
      due: makeNote("id-due", "due.md"),
    });
    expect(scheduler.getTodayQueue(new Set(), now).map((q) => q.path)).toEqual([
      "due.md",
    ]);
  });

  it("session IDs prevent the same note from appearing twice", () => {
    const { scheduler } = makeEnv({
      a: makeNote("id-a", "a.md"),
      b: makeNote("id-b", "b.md"),
    });
    expect(scheduler.getTodayQueue(new Set(["id-a"]), now).map((q) => q.path)).toEqual([
      "b.md",
    ]);
  });

  it("has no daily cap", () => {
    const notes: Record<string, NoteState> = {};
    for (let i = 0; i < 30; i++) {
      const id = `id-${i}`;
      notes[id] = makeNote(id, `n${i}.md`);
    }
    const { scheduler } = makeEnv(notes);
    expect(scheduler.getTodayQueue(new Set(), now)).toHaveLength(30);
    expect(scheduler.countDueToday(new Set(), now)).toBe(30);
  });

  it("filters by allowed paths", () => {
    const { scheduler, storage } = makeEnv({
      a: makeNote("id-a", "Zettels/a.md"),
      b: makeNote("id-b", "Zettels/sub/b.md"),
      c: makeNote("id-c", "Inbox/c.md"),
    });
    storage.data.settings.allowedPaths = ["Zettels/"];
    expect(scheduler.getTodayQueue(new Set(), now).map((q) => q.path).sort()).toEqual([
      "Zettels/a.md",
      "Zettels/sub/b.md",
    ]);
  });

  it("filters short notes but keeps unknown character counts", () => {
    const { scheduler, storage } = makeEnv({
      short: makeNote("id-short", "short.md", { characterCount: 30 }),
      long: makeNote("id-long", "long.md", { characterCount: 200 }),
      unknown: makeNote("id-unknown", "unknown.md", { characterCount: -1 }),
    });
    storage.data.settings.minCharacters = 50;
    expect(scheduler.getTodayQueue(new Set(), now).map((q) => q.path).sort()).toEqual([
      "long.md",
      "unknown.md",
    ]);
  });
});
