/**
 * FSRS Adapter.
 *
 * This module is the only place that knows about ts-fsrs cards. ReviewService
 * talks to it through FsrsAdapter and therefore does not need to know the
 * library's Card representation.
 */

import {
  FSRS,
  generatorParameters,
  createEmptyCard,
  Rating as TsFsrsRating,
  type Card,
} from "ts-fsrs";
import type { StorageService } from "./StorageService";
import type {
  FsrsCardState,
  NoteState,
  Rating,
} from "./types";
import type { FsrsAdapter, FsrsReviewResult } from "./ReviewService";

export class FSRSService implements FsrsAdapter {
  private fsrs!: FSRS;

  constructor(private readonly storage: StorageService) {
    this.rebuildInstance();
  }

  /** 设置变更后重建 FSRS 实例（因为 requestRetention 影响调度） */
  rebuildInstance(): void {
    const settings = this.storage.data.settings;
    const w = this.storage.data.fsrsParams?.w;
    this.fsrs = new FSRS(
      generatorParameters({
        ...(w ? { w } : {}),
        request_retention: settings.desiredRetention,
        enable_fuzz: true,
      }),
    );
  }

  createNewCard(): FsrsCardState {
    const card = createEmptyCard();
    return {
      stability: card.stability,
      difficulty: card.difficulty,
      lastReview: card.last_review?.toISOString() ?? null,
      state: card.state,
      reps: card.reps,
      lapses: card.lapses,
    };
  }

  review(
    card: FsrsCardState,
    dueAt: Date | null,
    rating: Rating,
    now: Date,
  ): FsrsReviewResult {
    const scheduling = this.fsrs.repeat(this.toCard(card, dueAt, now), now);
    const result = scheduling[rating];
    const newCard = result.card as Card;

    return {
      card: {
        stability: newCard.stability,
        difficulty: newCard.difficulty,
        lastReview: newCard.last_review?.toISOString() ?? now.toISOString(),
        state: newCard.state,
        reps: newCard.reps,
        lapses: newCard.lapses,
      },
      nextReview: toDate(newCard.due).toISOString(),
      logEntry: {
        timestamp: now.toISOString(),
        rating,
        elapsedDays: newCard.elapsed_days,
        scheduledDays: newCard.scheduled_days,
        stabilityBefore: card.stability,
        stabilityAfter: newCard.stability,
        difficultyAfter: newCard.difficulty,
      },
    };
  }

  /** Compatibility helper for callers that need R but not queue ordering. */
  retrievability(note: NoteState, now: Date = new Date()): number | null {
    if (!note.fsrs || !note.nextReview || !note.fsrs.lastReview) return null;
    const value = this.fsrs.get_retrievability(
      this.toCard(note.fsrs, new Date(note.nextReview), now),
      now,
      false,
    );
    return typeof value === "number" ? value : null;
  }

  private toCard(
    card: FsrsCardState,
    dueAt: Date | null,
    now: Date,
  ): Card {
    const empty = createEmptyCard(now);
    return {
      ...empty,
      due: dueAt ?? now,
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: 0,
      scheduled_days: 0,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.lastReview ? new Date(card.lastReview) : undefined,
    };
  }
}

function toDate(value: Date | number | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Rating 转换（我们的 1-4 和 ts-fsrs 的枚举一致） */
export function toTsFsrsRating(r: Rating): TsFsrsRating {
  return r as unknown as TsFsrsRating;
}
