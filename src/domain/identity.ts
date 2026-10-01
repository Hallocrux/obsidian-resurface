import type { NoteId, NotePath } from "./types";
import { NOTE_ID_FRONTMATTER_KEY } from "./types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only UUID v4 values are accepted from user-authored frontmatter. */
export function isValidNoteId(value: unknown): value is NoteId {
  return typeof value === "string" && UUID_PATTERN.test(value.trim());
}

/** Generate a durable ID without introducing another runtime dependency. */
export function createNoteId(): NoteId {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  // Obsidian versions without randomUUID still have a cryptographically
  // random source. Keep this fallback local so tests can run in older DOM
  // environments too.
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
      12,
      16,
    )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // This branch is only a last-resort compatibility fallback. It still has
  // UUID shape, and a later modify/backfill pass can replace it if needed.
  const random = Math.random().toString(16).slice(2).padEnd(12, "0");
  const time = Date.now().toString(16).padStart(12, "0");
  return `${time.slice(0, 8)}-${time.slice(8)}-4${random.slice(
    0,
    3,
  )}-8${random.slice(3, 6)}-${random.slice(6, 12)}${time.slice(0, 6)}`;
}

/**
 * A deterministic temporary identity used while migrating path-keyed v1
 * state. It never gets written to frontmatter; the watcher replaces it with
 * the real UUID as soon as the file is reconciled.
 */
export function legacyNoteId(path: NotePath): NoteId {
  return `legacy:${path}`;
}

/** Read the managed ID from a Markdown document without rewriting its YAML. */
export function readFrontmatterNoteId(content: string): NoteId | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;

  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(
      new RegExp(`^\\s*${NOTE_ID_FRONTMATTER_KEY}\\s*:\\s*(.*?)\\s*$`),
    );
    if (!field) continue;
    const value = field[1].replace(/^['"]|['"]$/g, "");
    return isValidNoteId(value) ? value : null;
  }
  return null;
}
