/**
 * SideBarView
 *
 * The view only chooses presentation and forwards actions to ReviewService.
 * A candidate is tracked by NoteId so a Codex/Obsidian move during review does
 * not make the current item point at the wrong file.
 */

import { ItemView, TFile, WorkspaceLeaf, Notice } from "obsidian";
import type ResurfacePlugin from "../../main";
import { CueExtractor, type Cue } from "../domain/CueExtractor";
import type {
  NoteId,
  NotePath,
  ReviewAction,
} from "../domain/types";

export const VIEW_TYPE_RESURFACE_SIDEBAR = "resurface-sidebar";

type ViewState = "initial" | "cue" | "rating" | "waitNext" | "completed";

export class SideBarView extends ItemView {
  private state: ViewState = "initial";
  private currentId: NoteId | null = null;
  private currentPath: NotePath | null = null;
  private currentCue: Cue | null = null;
  private readonly keydownHandler = (event: KeyboardEvent) => {
    const note = this.currentNote();
    if (!note) return;
    const sidebarActive = this.app.workspace.activeLeaf === this.leaf;
    const reviewTabActive = this.plugin.isReviewTabActive(note.path);
    if (!sidebarActive && !reviewTabActive) return;

    const target = event.target as HTMLElement | null;
    if (
      target?.isContentEditable ||
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.tagName === "SELECT"
    ) {
      return;
    }
    void this.handleShortcut(event);
  };

  constructor(leaf: WorkspaceLeaf, private readonly plugin: ResurfacePlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_RESURFACE_SIDEBAR;
  }

  getDisplayText() {
    return "Resurface 复习";
  }

  getIcon() {
    return "sprout";
  }

  async onOpen() {
    // The active leaf check keeps shortcuts scoped to the review pane while
    // still working when focus is on one of its buttons.
    this.registerDomEvent(document, "keydown", this.keydownHandler);
    await this.advance();
  }

  async onClose() {}

  async refresh() {
    if (
      this.state === "cue" ||
      this.state === "initial" ||
      this.state === "completed"
    ) {
      await this.advance();
    }
  }

  async advance() {
    this.plugin.session.refresh();
    const queue = this.plugin.scheduler.getTodayQueue(
      this.plugin.session.getReviewedSet(),
    );

    if (queue.length === 0) {
      const reviewedToday = this.plugin.session.reviewedCount();
      this.state = reviewedToday > 0 ? "completed" : "initial";
      this.currentId = null;
      this.currentPath = null;
      this.currentCue = null;
    } else {
      const next = queue[0];
      this.currentId = next.id;
      this.currentPath = next.path;
      this.currentCue = await this.loadCue(next.path);
      this.state = "cue";
    }

    this.render();
  }

  private async loadCue(path: NotePath): Promise<Cue> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      return { title: path, tldr: "(笔记不存在)" };
    }
    const content = await this.app.vault.read(file);
    return CueExtractor.extract(path, content, this.plugin.storage.data.settings);
  }

  private currentNote() {
    const byId = this.currentId
      ? this.plugin.storage.getNoteById(this.currentId)
      : undefined;
    if (byId) return byId;

    // A Codex rewrite can temporarily replace the ID while restoring deleted
    // frontmatter. Recover the same path-backed state for the in-progress UI.
    const recovered = this.currentPath
      ? this.plugin.storage.getNoteByPath(this.currentPath)
      : undefined;
    if (recovered) this.currentId = recovered.id;
    return recovered;
  }

  private async expandContent() {
    const note = this.currentNote();
    if (!note) return;
    await this.plugin.openReviewTab(note.path);
    this.state = "rating";
    this.render();
  }

  private async submitAction(action: ReviewAction) {
    const note = this.currentNote();
    const id = note?.id;
    if (!id || !note) return;

    try {
      const { newState, logEntry } = this.plugin.review.applyAction(note, action);
      this.plugin.storage.upsertNote(newState);
      if (logEntry) {
        this.plugin.storage.appendRevlog({
          ...logEntry,
          noteId: id,
          path: note.path,
        });
      }
      this.plugin.storage.data.stats.totalReviews++;
      this.plugin.updateStreakIfNeeded();
      this.plugin.session.markCompleted(id);
      await this.plugin.storage.save();

      if (this.plugin.storage.data.settings.autoAdvance) {
        await this.advance();
      } else {
        this.state = "waitNext";
        this.render();
      }
      this.plugin.refreshBadge();
    } catch (error) {
      console.error("[Resurface] review action failed", error);
      new Notice("无法记录这次复习操作");
    }
  }

  private async handleShortcut(event: KeyboardEvent): Promise<void> {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const digit = Number(event.key);
    if (![1, 2, 3, 4].includes(digit)) return;

    const note = this.currentNote();
    if (!note) return;

    let action: ReviewAction;
    if (note.mode === "learning") {
      if (this.state !== "rating") return;
      action = (["again", "hard", "good", "easy"] as const)[digit - 1];
    } else if (this.state === "cue" || this.state === "rating") {
      action = (["never", "later", "soon", "learn"] as const)[digit - 1];
    } else {
      return;
    }
    event.preventDefault();
    await this.submitAction(action);
  }

  // ─── 渲染 ──────────────────────────

  private render() {
    const container = this.contentEl;
    container.empty();
    container.addClass("resurface-root");

    switch (this.state) {
      case "initial":
        this.renderInitial(container);
        break;
      case "cue":
        this.renderCue(container);
        break;
      case "rating":
        this.renderRating(container);
        break;
      case "waitNext":
        this.renderWaitNext(container);
        break;
      case "completed":
        this.renderCompleted(container);
        break;
    }
  }

  private renderInitial(container: HTMLElement) {
    const box = container.createDiv({ cls: "resurface-empty" });
    box.createDiv({ text: "🌱", cls: "emoji" });

    const activeNotes = Object.values(this.plugin.storage.data.notes).filter(
      (note) => note.mode !== "suspended",
    );
    if (activeNotes.length === 0) {
      box.createEl("p", { text: "还没有笔记进入复活池" });
      box.createEl("p", {
        text: "等你写下第一条笔记 3 天后，它就会来这里重新找你",
        cls: "setting-item-description",
      });
    } else {
      box.createEl("p", { text: "今天没有笔记等着被唤醒" });
      box.createEl("p", {
        text: "继续你的工作吧",
        cls: "setting-item-description",
      });
    }

    this.appendStats(container);
  }

  private renderCue(container: HTMLElement) {
    if (!this.currentCue) return;
    this.appendProgress(container);

    const box = container.createDiv({ cls: "resurface-cue" });
    box.createEl("h3", { text: this.currentCue.title });
    box.createEl("blockquote", { text: this.currentCue.tldr });

    const expandBtn = box.createEl("button", {
      text: "展开正文",
      cls: "resurface-primary-btn",
    });
    expandBtn.onclick = () => void this.expandContent();

    const note = this.currentNote();
    if (note?.mode === "learning") {
      this.renderNeverButton(box);
    } else {
      this.renderTriageActions(box);
    }
  }

  private renderRating(container: HTMLElement) {
    if (!this.currentCue) return;
    this.appendProgress(container);

    const box = container.createDiv({ cls: "resurface-cue" });
    box.createEl("h3", { text: this.currentCue.title });
    box.createEl("blockquote", { text: this.currentCue.tldr });

    const note = this.currentNote();
    if (note?.mode === "learning") {
      this.renderLearningActions(box);
    } else {
      this.renderTriageActions(box);
    }
  }

  private renderTriageActions(container: HTMLElement) {
    const row = container.createDiv({ cls: "resurface-rating-row" });
    this.addActionButton(row, "Later", "resurface-rating-btn", "later");
    this.addActionButton(row, "Soon", "resurface-rating-btn", "soon");
    this.addActionButton(row, "Learn", "resurface-rating-btn good", "learn");
    this.renderNeverButton(container);
  }

  private renderLearningActions(container: HTMLElement) {
    const mode = this.plugin.storage.data.settings.ratingMode;
    const row = container.createDiv({ cls: "resurface-rating-row" });

    if (mode === "2-button") {
      this.addActionButton(
        row,
        "不会",
        "resurface-rating-btn again",
        "again",
      );
      this.addActionButton(row, "会", "resurface-rating-btn good", "good");
    } else {
      this.addActionButton(row, "Again", "resurface-rating-btn again", "again");
      this.addActionButton(row, "Hard", "resurface-rating-btn", "hard");
      this.addActionButton(row, "Good", "resurface-rating-btn good", "good");
      this.addActionButton(row, "Easy", "resurface-rating-btn", "easy");
    }
    this.renderNeverButton(container);
  }

  private renderNeverButton(container: HTMLElement) {
    this.addActionButton(
      container,
      "Never",
      "resurface-secondary-btn",
      "never",
    );
  }

  private addActionButton(
    container: HTMLElement,
    text: string,
    cls: string,
    action: ReviewAction,
  ) {
    const button = container.createEl("button", { text, cls });
    button.onclick = () => void this.submitAction(action);
  }

  private renderWaitNext(container: HTMLElement) {
    if (!this.currentCue) return;
    this.appendProgress(container);

    const box = container.createDiv({ cls: "resurface-cue" });
    box.createEl("h3", { text: this.currentCue.title });
    box.createEl("blockquote", { text: this.currentCue.tldr });
    box.createEl("p", {
      text: "已记录。可以继续编辑这条笔记，或者进入下一条。",
      cls: "setting-item-description",
    });

    const nextBtn = box.createEl("button", {
      text: "进入下一条 →",
      cls: "resurface-primary-btn",
    });
    nextBtn.onclick = () => void this.advance();
  }

  private renderCompleted(container: HTMLElement) {
    const box = container.createDiv({ cls: "resurface-empty" });
    box.createDiv({ text: "🌱", cls: "emoji" });
    const count = this.plugin.session.reviewedCount();
    box.createEl("p", {
      text: `今日的 ${count} 条笔记都在你这里重新活了一次`,
    });
    this.appendStats(container);
  }

  private appendProgress(container: HTMLElement) {
    const done = this.plugin.session.reviewedCount();
    const remaining = this.plugin.scheduler.countDueToday(
      this.plugin.session.getReviewedSet(),
    );
    const total = done + remaining;
    if (total === 0) return;
    container.createDiv({
      cls: "resurface-progress",
      text: `🌱 ${done + 1}/${total}`,
    });
  }

  private appendStats(container: HTMLElement) {
    const settings = this.plugin.storage.data.settings;
    const stats = this.plugin.storage.data.stats;
    const poolSize = Object.values(this.plugin.storage.data.notes).filter(
      (note) => note.mode !== "suspended",
    ).length;

    const statsBox = container.createDiv({ cls: "resurface-stats" });
    if (settings.showStreak && stats.streakDays > 0) {
      statsBox.createSpan({
        cls: "line",
        text: `连续 ${stats.streakDays} 天陪伴笔记`,
      });
    }
    if (stats.totalReviews > 0) {
      statsBox.createSpan({
        cls: "line",
        text: `累计复习 ${stats.totalReviews} 次`,
      });
    }
    statsBox.createSpan({
      cls: "line",
      text: `复活池里有 ${poolSize} 条笔记`,
    });
  }
}
