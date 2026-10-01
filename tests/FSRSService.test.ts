/**
 * FSRS Adapter tests. These verify our translation layer, not ts-fsrs itself.
 */

import { describe, it, expect } from "vitest";
import { FSRSService } from "../src/domain/FSRSService";
import type { StorageService } from "../src/domain/StorageService";
import { DEFAULT_SETTINGS } from "../src/domain/types";
import { State } from "ts-fsrs";

function makeService() {
  const storage = {
    data: {
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
        firstUseDate: "",
      },
      fsrsParams: null,
      version: 2,
    },
  } as unknown as StorageService;
  return { fsrs: new FSRSService(storage), storage };
}

describe("FSRSService", () => {
  it("createNewCard 产生新卡片", () => {
    const { fsrs } = makeService();
    const card = fsrs.createNewCard();

    expect(card.state).toBe(State.New);
    expect(card.reps).toBe(0);
    expect(card.lastReview).toBeNull();
  });

  it("Good 评分后 reps 增加并返回可持久化日志", () => {
    const { fsrs } = makeService();
    const now = new Date("2026-04-21T10:00:00Z");
    const result = fsrs.review(
      fsrs.createNewCard(),
      new Date("2026-04-24T10:00:00Z"),
      3,
      now,
    );

    expect(result.card.reps).toBeGreaterThan(0);
    expect(result.logEntry.rating).toBe(3);
    expect(result.nextReview).toMatch(/Z$/);
  });

  it("Again 评分后 lapses 不会倒退", () => {
    const { fsrs } = makeService();
    const start = new Date("2026-04-21T10:00:00Z");
    let card = fsrs.createNewCard();
    let due = new Date("2026-04-24T10:00:00Z");

    let result = fsrs.review(card, due, 3, start);
    card = result.card;
    due = new Date(result.nextReview);
    result = fsrs.review(card, due, 3, new Date("2026-04-30T10:00:00Z"));
    card = result.card;
    due = new Date(result.nextReview);
    const beforeLapses = card.lapses;

    result = fsrs.review(
      card,
      due,
      1,
      new Date("2026-05-20T10:00:00Z"),
    );
    expect(result.card.lapses).toBeGreaterThanOrEqual(beforeLapses);
  });

  it("retrievability 对新卡返回 null，对已评分卡返回概率", () => {
    const { fsrs } = makeService();
    const now = new Date("2026-04-21T10:00:00Z");
    const newNote = {
      id: "note-1",
      path: "note.md",
      mode: "learning" as const,
      addedAt: now.toISOString(),
      nextReview: new Date("2026-04-24T10:00:00Z").toISOString(),
      rediscovery: null,
      fsrs: fsrs.createNewCard(),
      suspendedAt: null,
      characterCount: 100,
      lastSnapshotLength: 0,
      lastSnapshotHash: "",
      lastEditTriggerAt: null,
    };
    expect(fsrs.retrievability(newNote, now)).toBeNull();

    const result = fsrs.review(
      newNote.fsrs!,
      new Date(newNote.nextReview!),
      3,
      now,
    );
    const reviewed = { ...newNote, fsrs: result.card, nextReview: result.nextReview };
    const retrievability = fsrs.retrievability(
      reviewed,
      new Date("2026-04-30T10:00:00Z"),
    );
    expect(retrievability).not.toBeNull();
    expect(retrievability!).toBeGreaterThan(0);
    expect(retrievability!).toBeLessThanOrEqual(1);
  });
});
