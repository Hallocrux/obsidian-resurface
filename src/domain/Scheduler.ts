/**
 * Scheduler
 *
 * Returns every due note. There is intentionally no daily budget: rediscovery
 * and learning are both attention queues, ordered by the oldest due time.
 */

import type { StorageService } from "./StorageService";
import type {
  NoteId,
  NotePath,
  NoteState,
  ReviewMode,
} from "./types";
import { isPathAllowed } from "./pathFilter";

export type ReviewStage = "triage" | "learning";

export interface QueuedNote {
  id: NoteId;
  path: NotePath;
  note: NoteState;
  mode: ReviewMode;
  stage: ReviewStage;
  dueAt: string;
}

export class Scheduler {
  constructor(private readonly storage: StorageService) {}

  /** 取所有到期的、当前 session 尚未处理的笔记。 */
  getTodayQueue(
    alreadyReviewedIds: Set<NoteId>,
    now: Date = new Date(),
  ): QueuedNote[] {
    const candidates: QueuedNote[] = [];

    for (const note of Object.values(this.storage.data.notes)) {
      if (alreadyReviewedIds.has(note.id)) continue;
      if (!isPathAllowed(note.path, this.storage.data.settings.allowedPaths)) {
        continue;
      }
      if (note.mode === "suspended") continue;
      if (this.tooShort(note, this.storage.data.settings.minCharacters)) {
        continue;
      }
      if (!note.nextReview) continue;

      const dueAt = new Date(note.nextReview);
      if (Number.isNaN(dueAt.getTime()) || dueAt > now) continue;

      candidates.push({
        id: note.id,
        path: note.path,
        note,
        mode: note.mode,
        stage: note.mode === "learning" ? "learning" : "triage",
        dueAt: note.nextReview,
      });
    }

    candidates.sort((a, b) => {
      const dueDifference =
        new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
      return dueDifference || a.path.localeCompare(b.path);
    });
    return candidates;
  }

  countDueToday(
    alreadyReviewedIds: Set<NoteId>,
    now: Date = new Date(),
  ): number {
    return this.getTodayQueue(alreadyReviewedIds, now).length;
  }

  private tooShort(note: NoteState, minChars: number): boolean {
    if (minChars <= 0) return false;
    if (note.characterCount < 0) return false;
    return note.characterCount < minChars;
  }
}
