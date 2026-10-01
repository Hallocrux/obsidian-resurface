# ADR 0001: Stable note identity in frontmatter

## Status

Accepted

## Context

Resurface stores scheduling state outside Markdown, while the Markdown files
are frequently edited and moved by Obsidian and Codex. A file path is not
stable enough to identify a note: a rename or move can otherwise detach the
review state from the document.

## Decision

Each Markdown note managed by Resurface receives a UUID v4 in the
`resurface-id` frontmatter field. `data.json` stores active and archived note
records by this NoteId and keeps the current path as a locator. File events
reconcile the frontmatter ID with the stored record; a duplicate ID never
merges two active files.

The plugin uses Obsidian's frontmatter processing API so it adds or repairs
only the managed field. The first vault scan assigns IDs to existing Markdown
files. Review scheduling metadata remains in `data.json`, not in Markdown.

## Consequences

- Rename and move operations preserve review state even when performed by
  external tools.
- A first install writes one managed field to existing Markdown files.
- Missing, invalid, or conflicting IDs need a repair path and retry behavior.
- The v2 storage schema must migrate path-keyed v1 records before the first
  frontmatter reconciliation pass.
