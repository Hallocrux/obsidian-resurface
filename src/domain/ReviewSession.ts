/**
 * ReviewSession
 *
 * 内存中的"今日复习进度"跟踪。
 * 不持久化——过日边界自动失效、Obsidian 重启会重置。
 *
 * 作用：记录"本次会话已复习过的笔记"，让 Scheduler 不重复推荐同一条。
 * 同时提供进度信息（已复习 N / 总 M）给 UI。
 */

import type { NoteId } from "./types";
import { formatDateKey } from "../utils/date";

export class ReviewSession {
  private reviewed: Set<NoteId> = new Set();
  private dateKey: string;

  constructor(
    private getBoundaryHour: () => number,
    initialDate: Date = new Date(),
  ) {
    this.dateKey = formatDateKey(initialDate, this.getBoundaryHour());
  }

  /** 在每次使用前调用，若跨日则自动清空 */
  refresh(now: Date = new Date()): void {
    const nowKey = formatDateKey(now, this.getBoundaryHour());
    if (nowKey !== this.dateKey) {
      this.reviewed.clear();
      this.dateKey = nowKey;
    }
  }

  markCompleted(id: NoteId): void {
    this.reviewed.add(id);
  }

  getReviewedSet(): Set<NoteId> {
    return this.reviewed;
  }

  reviewedCount(): number {
    return this.reviewed.size;
  }
}
