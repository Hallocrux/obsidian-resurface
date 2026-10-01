import { describe, expect, it } from "vitest";
import type { Plugin } from "obsidian";
import { State } from "ts-fsrs";
import { StorageService } from "../src/domain/StorageService";

function legacyNote(overrides: Record<string, unknown> = {}) {
  return {
    stability: 0,
    difficulty: 0,
    lastReview: null,
    nextReview: "2026-04-24T10:00:00.000Z",
    state: State.New,
    reps: 0,
    lapses: 0,
    excluded: false,
    excludedAt: null,
    lastSnapshotLength: 0,
    lastSnapshotHash: "",
    lastEditTriggerAt: null,
    characterCount: 100,
    addedAt: "2026-04-21T10:00:00.000Z",
    ...overrides,
  };
}

describe("StorageService schema migration", () => {
  it("migrates path-keyed v1 states and revlogs to v2 identities", async () => {
    let saved: unknown = null;
    const plugin = {
      loadData: async () => ({
        version: 1,
        settings: { dailyLimit: 15 },
        notes: {
          "new.md": legacyNote(),
          "learned.md": legacyNote({
            lastReview: "2026-04-20T10:00:00.000Z",
            state: "Review",
            stability: 4,
            difficulty: 3,
            reps: 2,
          }),
          "never.md": legacyNote({
            excluded: true,
            excludedAt: "2026-04-21T11:00:00.000Z",
          }),
        },
        archive: {},
        revlog: [
          {
            path: "learned.md",
            timestamp: "2026-04-20T10:00:00.000Z",
            rating: 3,
            elapsedDays: 2,
            scheduledDays: 4,
            stabilityBefore: 2,
            stabilityAfter: 4,
            difficultyAfter: 3,
          },
        ],
        stats: {},
        fsrsParams: null,
      }),
      saveData: async (value: unknown) => {
        saved = value;
      },
    } as unknown as Plugin;

    const storage = new StorageService(plugin);
    await storage.load();

    expect(storage.data.version).toBe(2);
    expect(storage.data.settings).not.toHaveProperty("dailyLimit");
    expect(storage.getNoteByPath("new.md")?.mode).toBe("incubating");
    expect(storage.getNoteByPath("learned.md")?.mode).toBe("learning");
    expect(storage.getNoteByPath("learned.md")?.fsrs?.stability).toBe(4);
    expect(storage.getNoteByPath("learned.md")?.fsrs?.state).toBe(State.Review);
    expect(storage.getNoteByPath("never.md")?.mode).toBe("suspended");
    expect(storage.getNoteByPath("never.md")?.nextReview).toBeNull();
    expect(storage.data.revlog[0].noteId).toBe("legacy:learned.md");

    const learnedId = "00000000-0000-4000-8000-000000000005";
    storage.reconcileIdentity(learnedId, "learned.md");
    expect(storage.data.revlog[0].noteId).toBe(learnedId);
    expect(saved).not.toBeNull();
  });

  it("rebinds a migrated path state to a frontmatter ID without resetting it", async () => {
    const plugin = {
      loadData: async () => ({ version: 2, notes: {}, archive: {}, revlog: [] }),
      saveData: async () => undefined,
    } as unknown as Plugin;
    const storage = new StorageService(plugin);
    await storage.load();

    const note = {
      id: "legacy:old.md",
      path: "old.md",
      mode: "rediscovery" as const,
      addedAt: "2026-04-01T00:00:00.000Z",
      nextReview: "2026-05-01T00:00:00.000Z",
      rediscovery: { level: 2, lastSeenAt: "2026-04-01T00:00:00.000Z" },
      fsrs: null,
      suspendedAt: null,
      characterCount: 200,
      lastSnapshotLength: 0,
      lastSnapshotHash: "",
      lastEditTriggerAt: null,
    };
    storage.upsertNote(note);

    const id = "00000000-0000-4000-8000-000000000002";
    const result = storage.reconcileIdentity(id, "new.md", "old.md");
    expect(result.conflict).toBe(false);
    expect(result.note?.id).toBe(id);
    expect(result.note?.path).toBe("new.md");
    expect(result.note?.rediscovery?.level).toBe(2);
    expect(storage.getNoteByPath("old.md")).toBeUndefined();
    expect(storage.getNoteById(id)).toBe(result.note);
  });

  it("rejects an active duplicate ID instead of merging notes", async () => {
    const plugin = {
      loadData: async () => ({ version: 2, notes: {}, archive: {}, revlog: [] }),
      saveData: async () => undefined,
    } as unknown as Plugin;
    const storage = new StorageService(plugin);
    await storage.load();

    const note = {
      id: "00000000-0000-4000-8000-000000000003",
      path: "first.md",
      mode: "incubating" as const,
      addedAt: "2026-04-01T00:00:00.000Z",
      nextReview: "2026-05-01T00:00:00.000Z",
      rediscovery: { level: 0, lastSeenAt: null },
      fsrs: null,
      suspendedAt: null,
      characterCount: 100,
      lastSnapshotLength: 0,
      lastSnapshotHash: "",
      lastEditTriggerAt: null,
    };
    storage.upsertNote(note);
    const result = storage.reconcileIdentity(note.id, "copy.md");
    expect(result.conflict).toBe(true);
    expect(result.note).toBeNull();
    expect(storage.getNoteByPath("first.md")).toBe(note);
  });

  it("accepts a rename when the frontmatter ID and old path agree", async () => {
    const plugin = {
      loadData: async () => ({ version: 2, notes: {}, archive: {}, revlog: [] }),
      saveData: async () => undefined,
    } as unknown as Plugin;
    const storage = new StorageService(plugin);
    await storage.load();

    const id = "00000000-0000-4000-8000-000000000004";
    const note = {
      id,
      path: "old.md",
      mode: "learning" as const,
      addedAt: "2026-04-01T00:00:00.000Z",
      nextReview: "2026-05-01T00:00:00.000Z",
      rediscovery: null,
      fsrs: {
        stability: 4,
        difficulty: 3,
        lastReview: "2026-04-01T00:00:00.000Z",
        state: State.Review,
        reps: 2,
        lapses: 0,
      },
      suspendedAt: null,
      characterCount: 200,
      lastSnapshotLength: 0,
      lastSnapshotHash: "",
      lastEditTriggerAt: null,
    };
    storage.upsertNote(note);

    const result = storage.reconcileIdentity(id, "new.md", "old.md");
    expect(result.conflict).toBe(false);
    expect(result.note?.id).toBe(id);
    expect(result.note?.path).toBe("new.md");
    expect(result.note?.fsrs?.stability).toBe(4);
    expect(storage.getNoteByPath("old.md")).toBeUndefined();
  });
});
