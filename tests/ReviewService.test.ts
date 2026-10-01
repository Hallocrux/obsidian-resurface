import { describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import {
  ReviewService,
  type FsrsAdapter,
} from "../src/domain/ReviewService";
import {
  DEFAULT_SETTINGS,
  type Settings,
} from "../src/domain/types";

function makeService(settings: Partial<Settings> = {}) {
  const effective = {
    ...DEFAULT_SETTINGS,
    ...settings,
    rediscoveryLaterIntervals: settings.rediscoveryLaterIntervals ?? [30, 90, 180, 365],
  };
  const adapter: FsrsAdapter = {
    createNewCard: () => ({
      stability: 0,
      difficulty: 0,
      lastReview: null,
      state: State.New,
      reps: 0,
      lapses: 0,
    }),
    review: (card, _dueAt, rating, now) => ({
      card: {
        ...card,
        stability: 5,
        difficulty: 3,
        lastReview: now.toISOString(),
        state: State.Review,
        reps: card.reps + 1,
      },
      nextReview: new Date(now.getTime() + 7 * 86400000).toISOString(),
      logEntry: {
        timestamp: now.toISOString(),
        rating,
        elapsedDays: 1,
        scheduledDays: 7,
        stabilityBefore: card.stability,
        stabilityAfter: 5,
        difficultyAfter: 3,
      },
    }),
  };
  return {
    service: new ReviewService(() => effective, adapter),
    adapter,
    settings: effective,
  };
}

function createNote() {
  const { service } = makeService({ firstReviewJitter: 0 });
  return service.createIncubatingState(
    "00000000-0000-4000-8000-000000000001",
    "note.md",
    new Date("2026-04-21T10:00:00Z"),
  );
}

describe("ReviewService", () => {
  it("creates an incubating note due after the first review interval", () => {
    const note = createNote();
    expect(note.mode).toBe("incubating");
    expect(note.fsrs).toBeNull();
    expect(note.rediscovery?.level).toBe(0);
    expect(note.nextReview).toBe("2026-04-24T10:00:00.000Z");
  });

  it("Never suspends a triage note", () => {
    const { service } = makeService();
    const result = service.applyAction(createNote(), "never", new Date("2026-04-21T10:00:00Z"));
    expect(result.newState.mode).toBe("suspended");
    expect(result.newState.nextReview).toBeNull();
    expect(result.newState.suspendedAt).not.toBeNull();
  });

  it("Soon schedules rediscovery without increasing the Later level", () => {
    const { service } = makeService({ firstReviewJitter: 0, rediscoverySoonDays: 3 });
    const result = service.applyAction(createNote(), "soon", new Date("2026-04-21T10:00:00Z"));
    expect(result.newState.mode).toBe("rediscovery");
    expect(result.newState.rediscovery?.level).toBe(0);
    expect(result.newState.nextReview).toBe("2026-04-24T10:00:00.000Z");
  });

  it("Later follows the configured ladder and caps at the last interval", () => {
    const { service } = makeService({
      firstReviewJitter: 0,
      rediscoveryLaterIntervals: [30, 90, 180, 365],
    });
    let note = createNote();
    const actionDates = [
      "2026-04-21T10:00:00Z",
      "2026-05-21T10:00:00Z",
      "2026-08-19T10:00:00Z",
      "2027-02-15T10:00:00Z",
      "2028-02-15T10:00:00Z",
    ];
    const expectedDays = [30, 90, 180, 365, 365];
    for (let i = 0; i < actionDates.length; i++) {
      const result = service.applyAction(note, "later", new Date(actionDates[i]));
      note = result.newState;
      const elapsed =
        (new Date(note.nextReview!).getTime() - new Date(actionDates[i]).getTime()) /
        86400000;
      expect(elapsed).toBe(expectedDays[i]);
      expect(note.rediscovery?.level).toBe(i + 1);
    }
  });

  it("Learn enters learning without creating an FSRS review log", () => {
    const { service } = makeService({ firstReviewJitter: 0 });
    const result = service.applyAction(createNote(), "learn", new Date("2026-04-21T10:00:00Z"));
    expect(result.newState.mode).toBe("learning");
    expect(result.newState.rediscovery).toBeNull();
    expect(result.newState.fsrs?.state).toBe(State.New);
    expect(result.newState.nextReview).toBe("2026-04-24T10:00:00.000Z");
    expect(result.logEntry).toBeUndefined();
  });

  it("FSRS ratings are rejected before Learn and accepted after Learn", () => {
    const { service } = makeService({ firstReviewJitter: 0 });
    expect(() => service.applyAction(createNote(), "good")).toThrow(
      "FSRS ratings are only valid for learning notes",
    );
    const learning = service.applyAction(createNote(), "learn").newState;
    const result = service.applyAction(
      learning,
      "good",
      new Date("2026-04-24T10:00:00Z"),
    );
    expect(result.newState.fsrs?.reps).toBe(1);
    expect(result.logEntry?.rating).toBe(3);
  });

  it("Never is also available in learning and retains its FSRS state", () => {
    const { service } = makeService({ firstReviewJitter: 0 });
    const learning = service.applyAction(createNote(), "learn").newState;
    const result = service.applyAction(learning, "never");
    expect(result.newState.mode).toBe("suspended");
    expect(result.newState.fsrs).not.toBeNull();
    expect(result.newState.nextReview).toBeNull();
  });

  it("rejects triage actions in learning", () => {
    const { service } = makeService({ firstReviewJitter: 0 });
    const learning = service.applyAction(createNote(), "learn").newState;
    expect(() => service.applyAction(learning, "later")).toThrow(
      "Triage action later is not valid for learning notes",
    );
  });
});
