import { describe, expect, it } from "vitest";
import {
  createNoteId,
  isValidNoteId,
  legacyNoteId,
  readFrontmatterNoteId,
} from "../src/domain/identity";

describe("note identity", () => {
  it("generates and validates UUID v4 IDs", () => {
    const id = createNoteId();
    expect(isValidNoteId(id)).toBe(true);
  });

  it("reads the managed ID without confusing user frontmatter", () => {
    const content = `---\ntldr: hello\nresurface-id: 00000000-0000-4000-8000-000000000001\n---\n\n# Note`;
    expect(readFrontmatterNoteId(content)).toBe(
      "00000000-0000-4000-8000-000000000001",
    );
    expect(readFrontmatterNoteId("---\nid: user-id\n---\nbody")).toBeNull();
  });

  it("rejects malformed IDs and supports deterministic legacy identity", () => {
    expect(readFrontmatterNoteId("---\nresurface-id: not-an-id\n---\n")).toBeNull();
    expect(legacyNoteId("folder/note.md")).toBe("legacy:folder/note.md");
    expect(isValidNoteId("legacy:folder/note.md")).toBe(false);
  });
});
