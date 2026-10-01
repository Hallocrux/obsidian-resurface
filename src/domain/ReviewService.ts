import { addDaysWithJitter } from "../utils/date";
import type {
  FsrsCardState,
  ISOTimestamp,
  LearningAction,
  NoteId,
  NotePath,
  NoteState,
  Rating,
  ReviewLogEntry,
  ReviewAction,
  Settings,
  TriageAction,
} from "./types";

export interface FsrsReviewResult {
  card: FsrsCardState;
  nextReview: ISOTimestamp;
  logEntry: Omit<ReviewLogEntry, "noteId" | "path">;
}

/** The seam between the review state machine and the ts-fsrs Adapter. */
export interface FsrsAdapter {
  createNewCard(): FsrsCardState;
  review(
    card: FsrsCardState,
    dueAt: Date | null,
    rating: Rating,
    now: Date,
  ): FsrsReviewResult;
}

export interface ReviewTransition {
  newState: NoteState;
  logEntry?: Omit<ReviewLogEntry, "noteId" | "path">;
}

/**
 * Domain state machine for the two-stage review flow.
 *
 * This module has no Obsidian dependency. It owns all invariants between
 * triage and FSRS, while the caller owns persistence and side effects.
 */
export class ReviewService {
  constructor(
    private readonly getSettings: () => Settings,
    private readonly fsrs: FsrsAdapter,
  ) {}

  createIncubatingState(
    id: NoteId,
    path: NotePath,
    now: Date = new Date(),
  ): NoteState {
    const settings = this.getSettings();
    const nextReview = addDaysWithJitter(
      now,
      settings.firstReviewDays,
      settings.firstReviewJitter,
    );

    return {
      id,
      path,
      mode: "incubating",
      addedAt: now.toISOString(),
      nextReview: nextReview.toISOString(),
      rediscovery: { level: 0, lastSeenAt: null },
      fsrs: null,
      suspendedAt: null,
      characterCount: -1,
      lastSnapshotLength: 0,
      lastSnapshotHash: "",
      lastEditTriggerAt: null,
    };
  }

  applyAction(
    note: NoteState,
    action: ReviewAction,
    now: Date = new Date(),
  ): ReviewTransition {
    if (note.mode === "suspended") {
      throw new Error("Cannot review a suspended note");
    }

    if (action === "never") {
      return {
        newState: {
          ...note,
          mode: "suspended",
          nextReview: null,
          suspendedAt: now.toISOString(),
        },
      };
    }

    if (isLearningRatingAction(action)) {
      return this.applyLearningRating(
        note,
        learningActionToRating(action),
        now,
      );
    }

    if (note.mode !== "incubating" && note.mode !== "rediscovery") {
      throw new Error(
        `Triage action ${action} is not valid for ${note.mode} notes`,
      );
    }

    switch (action) {
      case "soon":
        return this.applySoon(note, now);
      case "later":
        return this.applyLater(note, now);
      case "learn":
        return this.applyLearn(note, now);
      default:
        return assertNever(action);
    }
  }

  private applySoon(note: NoteState, now: Date): ReviewTransition {
    const days = positiveOrDefault(this.getSettings().rediscoverySoonDays, 3);
    return {
      newState: {
        ...note,
        mode: "rediscovery",
        nextReview: addDays(now, days).toISOString(),
        rediscovery: {
          level: note.rediscovery?.level ?? 0,
          lastSeenAt: now.toISOString(),
        },
        suspendedAt: null,
        fsrs: null,
      },
    };
  }

  private applyLater(note: NoteState, now: Date): ReviewTransition {
    const intervals = normaliseIntervals(
      this.getSettings().rediscoveryLaterIntervals,
    );
    const currentLevel = Math.max(0, note.rediscovery?.level ?? 0);
    const interval = intervals[Math.min(currentLevel, intervals.length - 1)];
    return {
      newState: {
        ...note,
        mode: "rediscovery",
        nextReview: addDays(now, interval).toISOString(),
        rediscovery: {
          level: currentLevel + 1,
          lastSeenAt: now.toISOString(),
        },
        suspendedAt: null,
        fsrs: null,
      },
    };
  }

  private applyLearn(note: NoteState, now: Date): ReviewTransition {
    const firstLearningDays = positiveOrDefault(
      this.getSettings().firstReviewDays,
      3,
    );
    return {
      newState: {
        ...note,
        mode: "learning",
        nextReview: addDays(now, firstLearningDays).toISOString(),
        rediscovery: null,
        fsrs: this.fsrs.createNewCard(),
        suspendedAt: null,
      },
    };
  }

  private applyLearningRating(
    note: NoteState,
    rating: Rating,
    now: Date,
  ): ReviewTransition {
    if (note.mode !== "learning" || !note.fsrs) {
      throw new Error("FSRS ratings are only valid for learning notes");
    }

    const result = this.fsrs.review(
      note.fsrs,
      note.nextReview ? new Date(note.nextReview) : null,
      rating,
      now,
    );

    return {
      newState: {
        ...note,
        mode: "learning",
        nextReview: result.nextReview,
        fsrs: result.card,
        suspendedAt: null,
      },
      logEntry: result.logEntry,
    };
  }
}

function addDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function positiveOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normaliseIntervals(values: number[] | undefined): number[] {
  const valid = (values ?? [])
    .filter((value) => Number.isInteger(value) && value > 0);
  return valid.length > 0 ? valid : [30, 90, 180, 365];
}

function isLearningRatingAction(
  action: ReviewAction,
): action is Exclude<LearningAction, "never"> {
  return (
    action === "again" ||
    action === "hard" ||
    action === "good" ||
    action === "easy"
  );
}

function learningActionToRating(
  action: Exclude<LearningAction, "never">,
): Rating {
  const ratings: Record<Exclude<LearningAction, "never">, Rating> = {
    again: 1,
    hard: 2,
    good: 3,
    easy: 4,
  };
  return ratings[action];
}

function assertNever(value: never): never {
  throw new Error(`Unhandled review action: ${String(value)}`);
}

// Keep these aliases visible to readers of generated declaration output.
export type { LearningAction, TriageAction };
