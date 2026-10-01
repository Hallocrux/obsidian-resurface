/**
 * VaultWatcher
 *
 * Bridges Obsidian file events to the domain identity model. The file's
 * resurface-id travels with its frontmatter, so path changes do not reset
 * review state.
 */

import { TFile, type Plugin } from "obsidian";
import type { ReviewService } from "../domain/ReviewService";
import {
  createNoteId,
  isValidNoteId,
  legacyNoteId,
  readFrontmatterNoteId,
} from "../domain/identity";
import type { StorageService } from "../domain/StorageService";
import { NOTE_ID_FRONTMATTER_KEY } from "../domain/types";

export class VaultWatcher {
  private readonly identityWrites = new Set<string>();
  private readonly recentIdentityWrites = new Map<string, number>();

  constructor(
    private readonly plugin: Plugin,
    private readonly storage: StorageService,
    private readonly review: ReviewService,
    private readonly onListMayChange: () => void,
  ) {}

  register(): void {
    const vault = this.plugin.app.vault;

    this.plugin.registerEvent(
      vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.runSafely(() => this.reconcileFile(file));
        }
      }),
    );

    this.plugin.registerEvent(
      vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          void this.runSafely(() => this.reconcileFile(file, oldPath));
        }
      }),
    );

    this.plugin.registerEvent(
      vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.storage.onDelete(file.path);
          this.onListMayChange();
        }
      }),
    );

    this.plugin.registerEvent(
      vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        if (this.identityWrites.has(file.path)) return;

        // processFrontMatter can emit modify just after its promise resolves.
        // Ignore that one self-generated event, while allowing later user
        // edits to update characterCount and retry failed identity writes.
        const writtenAt = this.recentIdentityWrites.get(file.path);
        if (writtenAt !== undefined) {
          this.recentIdentityWrites.delete(file.path);
          if (Date.now() - writtenAt < 1000) return;
        }

        void this.runSafely(() => this.reconcileFile(file));
      }),
    );
  }

  /**
   * Import the whole vault on first enable and repair identities after an
   * external editor (including Codex) rewrites frontmatter.
   */
  async backfillExistingNotes(): Promise<void> {
    const files = this.plugin.app.vault.getMarkdownFiles();
    let added = 0;
    let updated = 0;
    let assignedIds = 0;

    for (const file of files) {
      const result = await this.reconcileFile(file);
      if (result.added) added++;
      if (result.updated) updated++;
      if (result.assignedId) assignedIds++;
    }

    if (added > 0 || updated > 0 || assignedIds > 0) {
      await this.storage.save();
      console.log(
        `[Resurface] backfilled ${added} notes, updated ${updated} notes, assigned ${assignedIds} IDs`,
      );
    }
  }

  private async reconcileFile(
    file: TFile,
    legacyPath?: string,
  ): Promise<{ added: boolean; updated: boolean; assignedId: boolean }> {
    const content = await this.plugin.app.vault.cachedRead(file);
    const frontmatterId = readFrontmatterNoteId(content);
    let id = frontmatterId ?? createNoteId();
    let reconciliation = this.storage.reconcileIdentity(id, file.path, legacyPath);
    let identityWriteFailed = false;
    let identityWriteAttempted = false;

    const tryWriteIdentity = async (candidateId: string): Promise<boolean> => {
      identityWriteAttempted = true;
      if (!isValidNoteId(candidateId)) {
        identityWriteFailed = true;
        console.error("[Resurface] refused to write an invalid note ID");
        return false;
      }
      try {
        await this.writeFrontmatterId(file, candidateId);
        return true;
      } catch (error) {
        identityWriteFailed = true;
        console.error("[Resurface] failed to write note ID", error);
        return false;
      }
    };

    // A copied Markdown file can carry the original ID. Never merge two
    // active notes; assign the copied file a fresh identity instead.
    if (reconciliation.conflict) {
      id = createNoteId();
      if (!(await tryWriteIdentity(id))) {
        // Keep the state addressable while the file manager is unavailable.
        // A later modify/create pass will replace this temporary key with a
        // UUID and rebind the state and revlog entries.
        id = legacyNoteId(file.path);
      }
      reconciliation = this.storage.reconcileIdentity(id, file.path, legacyPath);
    }

    // Missing/invalid frontmatter gets a new UUID. If writing it fails, use a
    // deterministic path-backed key until a later vault event can retry.
    if (!frontmatterId && !identityWriteAttempted) {
      if (!(await tryWriteIdentity(id))) {
        const fallbackId = legacyNoteId(file.path);
        if (id !== fallbackId) {
          id = fallbackId;
          reconciliation = this.storage.reconcileIdentity(
            id,
            file.path,
            legacyPath,
          );
        }
      }
    }

    let added = false;
    let updated = false;
    if (!reconciliation.note) {
      const note = this.review.createIncubatingState(id, file.path);
      note.characterCount = content.length;
      this.storage.upsertNote(note);
      added = true;
    } else {
      const note = reconciliation.note;
      if (note.path !== file.path || note.characterCount !== content.length) {
        note.path = file.path;
        note.characterCount = content.length;
        this.storage.upsertNote(note);
        updated = true;
      }
    }

    const assignedId = frontmatterId !== id;

    if (added || updated || assignedId || identityWriteFailed) {
      this.storage.scheduleSave();
      this.onListMayChange();
    }
    return { added, updated, assignedId };
  }

  private async writeFrontmatterId(file: TFile, id: string): Promise<void> {
    if (this.identityWrites.has(file.path)) return;
    this.identityWrites.add(file.path);
    let succeeded = false;
    try {
      await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter[NOTE_ID_FRONTMATTER_KEY] = id;
      });
      succeeded = true;
    } finally {
      this.identityWrites.delete(file.path);
      if (succeeded) {
        const writtenAt = Date.now();
        this.recentIdentityWrites.set(file.path, writtenAt);
        setTimeout(() => {
          if (this.recentIdentityWrites.get(file.path) === writtenAt) {
            this.recentIdentityWrites.delete(file.path);
          }
        }, 1000);
      }
    }
  }

  private async runSafely(task: () => Promise<unknown>): Promise<void> {
    try {
      await task();
    } catch (error) {
      console.error("[Resurface] failed to reconcile note identity", error);
    }
  }
}
