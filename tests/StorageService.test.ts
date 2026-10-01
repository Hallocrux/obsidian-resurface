import { describe, expect, it } from "vitest";
import type { Plugin } from "obsidian";
import { StorageService } from "../src/domain/StorageService";
import { createDefaultData, type NoteState } from "../src/domain/types";

function makeNote(
  id: string,
  path: string,
  nextReview: string | null,
  mode: NoteState["mode"] = "incubating",
): NoteState {
  return {
    id,
    path,
    mode,
    addedAt: "2026-04-20T10:00:00.000Z",
    nextReview,
    rediscovery: mode === "learning" ? null : { level: 0, lastSeenAt: null },
    fsrs: null,
    suspendedAt: mode === "suspended" ? "2026-04-20T10:00:00.000Z" : null,
    characterCount: 100,
    lastSnapshotLength: 0,
    lastSnapshotHash: "",
    lastEditTriggerAt: null,
  };
}

describe("StorageService fast-forward", () => {
  it("moves only future active reviews one day earlier", () => {
    const storage = new StorageService({} as Plugin);
    storage.data = createDefaultData();
    storage.data.notes = {
      future: makeNote("future", "future.md", "2026-04-24T10:00:00.000Z"),
      tomorrow: makeNote(
        "tomorrow",
        "tomorrow.md",
        "2026-04-22T18:00:00.000Z",
        "learning",
      ),
      today: makeNote("today", "today.md", "2026-04-21T10:00:00.000Z"),
      suspended: makeNote(
        "suspended",
        "suspended.md",
        "2026-04-24T10:00:00.000Z",
        "suspended",
      ),
    };

    const changed = storage.advanceFutureReviewsByOneDay(
      new Date("2026-04-21T12:00:00.000Z"),
    );

    expect(changed).toBe(2);
    expect(storage.data.notes.future.nextReview).toBe(
      "2026-04-23T10:00:00.000Z",
    );
    expect(storage.data.notes.tomorrow.nextReview).toBe(
      "2026-04-21T18:00:00.000Z",
    );
    expect(storage.data.notes.today.nextReview).toBe(
      "2026-04-21T10:00:00.000Z",
    );
    expect(storage.data.notes.suspended.nextReview).toBe(
      "2026-04-24T10:00:00.000Z",
    );
  });
});
