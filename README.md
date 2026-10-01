# 🌱 Resurface

**🌐 Language**: **English** · [中文](./README.zh-CN.md)

> Spaced rediscovery for Obsidian, where your notes are the review unit.

An Obsidian plugin for reviewing what you've written. Notes enter a
rediscovery queue automatically — no flashcards, no pre-processing. You decide
at review time whether a note should disappear, return occasionally, or enter
real FSRS learning.

## Why another SRS plugin?

Existing SRS tools (Anki, RemNote, Obsidian-spaced-repetition) assume you'll **hand-craft flashcards**. That workflow conflicts with Zettelkasten / atomic notes.

Resurface takes the opposite path:

|  | Anki-style | Resurface |
|---|---|---|
| Review unit | Crafted flashcards | **Notes themselves** |
| Card creation overhead | Write them yourself | None |
| During review | Reveal answer, rate | Read note, rate, **and edit it** |
| Management | Pre-organize into decks | Decide at review time |

## Core features

- **Two-stage review** — rediscovery first, FSRS-6 only after you choose Learn
- **Triage at review time** — Never, Later, Soon, or Learn
- **Configurable rediscovery ladder** — Soon by default in 3 days; Later defaults to 30 → 90 → 180 → 365 days
- **Stable note identity** — `resurface-id` frontmatter survives Codex/Obsidian moves and rewrites
- **No daily cap** — every due note is available, ordered by oldest due time
- **Fast-forward command** — "快进一天" pulls future reviews one day closer without touching already-due notes
- **Auto-enroll** — existing and new markdown notes join the pool, first appearance in 3 ± 1 days
- **Allowed paths** — whitelist specific folders (recursive, multi-select)
- **Short-note filter** — notes under 50 characters (configurable) don't enter the pool
- **Quiet UI** — no push notifications; only a subtle ribbon badge and a single notice on startup
- **Edit while reviewing** — the main pane opens the real note; edit it, add links, let it grow

## Installation

> ⚠️ MVP stage — not yet submitted to the Obsidian Community Plugins directory.

### Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from [Releases](../../releases)
2. Put them in `.obsidian/plugins/obsidian-resurface/` inside your vault
3. Enable **Resurface** in Obsidian → Settings → Community plugins

### Build from source

```bash
git clone https://github.com/ahscuml/obsidian-resurface.git
cd obsidian-resurface
npm install
npm run build
```

The build output is auto-deployed to the vault configured in `.env.local` via `VAULT_PATH`.

## Usage

1. **After enabling** — Resurface scans your existing markdown notes and adds them to the pool (first review in 3 ± 1 days)
2. **When you open Obsidian** — a brief notice appears: `🌱 N notes want to see you again today`. The ribbon 🌱 icon shows the count.
3. **Click the ribbon** — the right sidebar opens with the first note's title + TLDR
4. **Click "Expand"** — the main pane opens the note (reuses a single "review tab", not a new one each time)
5. **Choose a triage action** — Never, Later, Soon, or Learn. The first three do not invoke FSRS.
6. **After Learn, rate the note** — Again / Hard / Good / Easy are handled by FSRS.
7. **Click "Next"** — proceed to the next due note. The note stays open so you can edit it.

The first vault scan adds a `resurface-id` UUID to Markdown files that do not
already have one. Scheduling metadata remains in `data.json`; review actions
do not rewrite the note body.

## TLDR extraction

The cue face shows **title + TLDR**. TLDR is extracted with this fallback chain:

1. frontmatter `tldr` field
2. `> [!tldr]` callout
3. `## TLDR` or `## Summary` heading's first paragraph
4. first paragraph of the note
5. first 200 characters

No need to change your writing habits — the better you author TLDRs, the better the cues.

## Settings

**Basic**: first appearance delay · Soon interval · rating buttons (2 or 4) · auto-advance · allowed paths

**Advanced**: desired retention · first-review jitter · Later interval ladder · TLDR field name · min characters · streak toggle

## Design philosophy

- **Notes = review units** — no separate card system
- **Capture first, decide later** — rediscovery is a value decision; FSRS is a memory decision
- **Quiet by default** — no pushes, just passive visual hints
- **Decide at review time** — no need to pre-tag or pre-configure
- **Notes are alive** — reviewing them can grow them

## Documentation

- [Product Design (Chinese)](./docs/产品设计文档.md)
- [Technical Architecture (Chinese)](./docs/技术架构文档.md)
- [Learning Science Research (Chinese)](./research/) — 4 original research reports on forgetting curves, SRS algorithms, retrieval practice, and learning strategies
- [CHANGELOG](./CHANGELOG.md)

## Roadmap

- [x] **v0.1.0 MVP** — rediscovery triage + FSRS learning + stable note identity
- [ ] **M1** — edits affect scheduling (large edit → Stability × 0.5) · JOL calibration feedback
- [ ] **M2** — excluded-notes management UI · note stabilization period
- [ ] **M3** — local FSRS parameter re-optimization · data dashboard
- [ ] **M4** — i18n · sync conflict handling · large-vault performance

## Tech stack

- **TypeScript** · **Obsidian Plugin API** · **Native DOM** (no React/Vue)
- [**ts-fsrs**](https://github.com/open-spaced-repetition/ts-fsrs) 4.7.1 · MIT
- **esbuild** build · **Vitest** for pure-function tests (60 tests)

## Acknowledgments

The algorithmic and scientific foundations of this plugin:

- [FSRS](https://github.com/open-spaced-repetition) by Jarrett Ye and the open-spaced-repetition community
- [Robert & Elizabeth Bjork](https://bjorklab.psych.ucla.edu/)'s work on desirable difficulty
- Henry Roediger & Jeffrey Karpicke's retrieval practice research
- Piotr Woźniak and the SuperMemo team's decades of foundational work

## License

[MIT](./LICENSE)
