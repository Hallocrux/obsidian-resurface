/**
 * SettingsTab
 *
 * 基础设置 + rediscovery/FSRS 调度设置。所有调度数据仍保存在插件
 * data.json，Markdown 只保存 resurface-id。
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type ResurfacePlugin from "../../main";
import { FolderSuggestModal } from "./FolderSuggestModal";
import { normalizePathRule } from "../domain/pathFilter";

export class ResurfaceSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ResurfacePlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Resurface 设置" });

    const settings = this.plugin.storage.data.settings;

    // ─── 基础层 ──────────────────────────
    containerEl.createEl("h3", { text: "基础" });

    new Setting(containerEl)
      .setName("首次出现间隔")
      .setDesc("新笔记写完多少天后第一次回到复活池")
      .addSlider((slider) =>
        slider
          .setLimits(1, 14, 1)
          .setValue(settings.firstReviewDays)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.firstReviewDays = v;
            await this.plugin.storage.save();
          }),
      );

    new Setting(containerEl)
      .setName("Soon 间隔")
      .setDesc("选择 Soon 后，多少天后再次看到这条笔记")
      .addSlider((slider) =>
        slider
          .setLimits(1, 30, 1)
          .setValue(settings.rediscoverySoonDays)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.rediscoverySoonDays = v;
            await this.plugin.storage.save();
          }),
      );

    new Setting(containerEl)
      .setName("评分档数")
      .setDesc("两档更简单，四档更精确")
      .addDropdown((dd) =>
        dd
          .addOption("2-button", "2 档（会 / 不会）")
          .addOption("4-button", "4 档（Again / Hard / Good / Easy）")
          .setValue(settings.ratingMode)
          .onChange(async (v) => {
            settings.ratingMode = v as "2-button" | "4-button";
            await this.plugin.storage.save();
            this.plugin.refreshSideBar();
          }),
      );

    new Setting(containerEl)
      .setName("评分后自动进入下一条")
      .setDesc("关闭则评分后停留在当前笔记，方便编辑")
      .addToggle((tg) =>
        tg.setValue(settings.autoAdvance).onChange(async (v) => {
          settings.autoAdvance = v;
          await this.plugin.storage.save();
        }),
      );

    // ─── 复习目录白名单 ──────────────────────────
    this.renderAllowedPaths(containerEl);

    // ─── 高级层 ──────────────────────────
    const advDetails = containerEl.createEl("details");
    advDetails.createEl("summary", { text: "高级设置" });

    new Setting(advDetails)
      .setName("期望保留率（desired retention）")
      .setDesc("复习时希望还记得的概率。数值越高，复习越频繁。默认 0.9")
      .addSlider((slider) =>
        slider
          .setLimits(0.8, 0.97, 0.01)
          .setValue(settings.desiredRetention)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.desiredRetention = v;
            await this.plugin.storage.save();
            this.plugin.fsrs.rebuildInstance();
          }),
      );

    new Setting(advDetails)
      .setName("首次间隔随机抖动")
      .setDesc("让同日写的笔记错开到期")
      .addSlider((slider) =>
        slider
          .setLimits(0, 3, 1)
          .setValue(settings.firstReviewJitter)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.firstReviewJitter = v;
            await this.plugin.storage.save();
          }),
      );

    new Setting(advDetails)
      .setName("Later 间隔阶梯")
      .setDesc("以天为单位，用逗号分隔；默认 30, 90, 180, 365")
      .addText((text) =>
        text
          .setValue(settings.rediscoveryLaterIntervals.join(", "))
          .onChange(async (value) => {
            const intervals = value
              .split(",")
              .map((part) => part.trim())
              .filter((part) => /^\d+$/.test(part))
              .map((part) => Number(part))
              .filter((part) => Number.isInteger(part) && part > 0);
            if (intervals.length === 0) return;
            settings.rediscoveryLaterIntervals = intervals;
            await this.plugin.storage.save();
          }),
      );

    new Setting(advDetails)
      .setName("TLDR 字段名")
      .setDesc("读取 frontmatter 里的哪个字段作为摘要")
      .addText((t) =>
        t.setValue(settings.tldrFieldName).onChange(async (v) => {
          settings.tldrFieldName = v.trim() || "tldr";
          await this.plugin.storage.save();
        }),
      );

    new Setting(advDetails)
      .setName("TLDR 最大显示字符数")
      .setDesc("侧栏展示 TLDR 时的统一上限；超过会截断加省略号")
      .addSlider((slider) =>
        slider
          .setLimits(50, 500, 10)
          .setValue(settings.tldrFallbackLength)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.tldrFallbackLength = v;
            await this.plugin.storage.save();
          }),
      );

    new Setting(advDetails)
      .setName("显示连续复习天数")
      .setDesc("关闭后侧栏空状态不显示 streak")
      .addToggle((tg) =>
        tg.setValue(settings.showStreak).onChange(async (v) => {
          settings.showStreak = v;
          await this.plugin.storage.save();
          this.plugin.refreshSideBar();
        }),
      );

    new Setting(advDetails)
      .setName("最小字符数")
      .setDesc(
        "字符数低于此值的笔记不进入复习池（含 frontmatter）。设为 0 = 不过滤。",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 500, 10)
          .setValue(settings.minCharacters)
          .setDynamicTooltip()
          .onChange(async (v) => {
            settings.minCharacters = v;
            await this.plugin.storage.save();
            this.plugin.refreshBadge();
            void this.plugin.refreshSideBar();
          }),
      );

    // 编辑正文不会在 v0.1 改变调度；调度元数据只保存在 data.json。
    advDetails.createEl("p", {
      text: "笔记编辑不会在当前版本改变复习时间。排除列表管理和 FSRS 参数优化将在后续版本提供。",
      cls: "setting-item-description",
    });
  }

  // ─── 复习目录白名单 ──────────────────────────

  private renderAllowedPaths(containerEl: HTMLElement): void {
    const settings = this.plugin.storage.data.settings;

    const section = new Setting(containerEl)
      .setName("复习目录")
      .setDesc(
        "只有这些目录下的笔记会进入复习池（递归包含子目录）。留空 = 所有笔记都进入复习池。",
      );

    section.addButton((btn) =>
      btn.setButtonText("+ 添加目录").onClick(() => {
        new FolderSuggestModal(
          this.app,
          async (folder) => {
            const normalized = normalizePathRule(folder.path);
            if (!settings.allowedPaths.includes(normalized)) {
              settings.allowedPaths.push(normalized);
              await this.plugin.storage.save();
              this.display(); // 重新渲染设置页
              this.plugin.refreshBadge();
              void this.plugin.refreshSideBar();
            }
          },
          settings.allowedPaths,
        ).open();
      }),
    );

    // 已选目录列表（每个一行 tag，带 × 删除）
    if (settings.allowedPaths.length === 0) {
      const empty = containerEl.createDiv({ cls: "resurface-path-empty" });
      empty.setText("（当前未限制目录，全部笔记都进入复习池）");
    } else {
      const list = containerEl.createDiv({ cls: "resurface-path-list" });
      for (const path of settings.allowedPaths) {
        const tag = list.createSpan({ cls: "resurface-path-tag" });
        // 显示时去掉末尾 /，让视觉更干净；内部仍保留带 / 的规范化形式
        const displayPath =
          path === "/" || path === ""
            ? "/ (整个 vault)"
            : path.replace(/\/+$/, "");
        tag.createSpan({
          cls: "resurface-path-tag-text",
          text: displayPath,
        });
        const rm = tag.createSpan({
          cls: "resurface-path-tag-remove",
          text: "×",
        });
        rm.setAttr("aria-label", `移除 ${path}`);
        rm.onclick = async () => {
          settings.allowedPaths = settings.allowedPaths.filter(
            (p) => p !== path,
          );
          await this.plugin.storage.save();
          this.display();
          this.plugin.refreshBadge();
          void this.plugin.refreshSideBar();
        };
      }
    }
  }
}
