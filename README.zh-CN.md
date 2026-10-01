# 🌱 Resurface

**🌐 语言**: [English](./README.md) · **中文**

> 让你在 Obsidian 里写过的笔记，按科学的节奏重新找到你。

一个“先重新发现、再决定是否真正学习”的 Obsidian 插件。笔记写完即入池，无需制卡；系统先把它们带回你面前，由你决定丢弃、偶尔重见，还是进入 FSRS。

## 为什么再做一个复习插件

已有的 SRS 工具（Anki / RemNote / Obsidian-spaced-repetition）的核心假设是"**人造卡片**"—— 你需要专门花时间把知识打包成问答卡。这和 Zettelkasten / atomic notes 的工作流天然割裂。

Resurface 走相反路径：

|  | Anki 范式 | Resurface |
|---|---|---|
| 复习单元 | 人造卡片 | **笔记本身** |
| 制卡工作量 | 需要专门造卡 | 零 |
| 复习时能做什么 | 看答案 + 打分 | 看笔记 + 打分 + **可编辑** |
| 管理方式 | 提前分 deck | 复习现场决定排除 |

## 核心特性

- **两阶段复习**：先 rediscovery，明确选择 Learn 后才进入 FSRS-6
- **复习现场分流**：Never / Later / Soon / Learn
- **可配置复活阶梯**：Soon 默认 3 天；Later 默认 30 → 90 → 180 → 365 天
- **稳定笔记 ID**：`resurface-id` 写入 frontmatter，Codex/Obsidian 移动后仍保留状态
- **无每日上限**：所有到期笔记都可出现，按最早到期时间排序
- **快进一天**：命令面板中执行后，未来复习时间整体提前一天，今天已到期的笔记不变
- **笔记自动入池**：已有和新建的 markdown 笔记都会进入复活池，首次出现默认 3 天 ± 1 天
- **白名单路径**：只复习指定目录下的笔记（递归 + 多选）
- **短笔记过滤**：字符数 < 50 的笔记默认不进池
- **扁平 + 克制的 UI**：不推送、不打扰，只在你打开 Obsidian 时安静提示
- **复习时编辑笔记**：主区打开真笔记 · 可修改 · 可加链接 · 笔记是活的

## 安装

> ⚠️ 目前处于 MVP 阶段，尚未提交到 Obsidian 社区插件市场。

### 手动安装

1. 从 [Releases](../../releases) 下载最新版本的 `main.js`、`manifest.json`、`styles.css`
2. 放到你 vault 的 `.obsidian/plugins/obsidian-resurface/` 目录下
3. Obsidian → 设置 → 社区插件 → 已安装插件 → 启用 Resurface

### 从源码构建

```bash
git clone <this-repo>
cd obsidian-resurface
npm install
npm run build
```

构建产物会自动部署到 `.env.local` 里 `VAULT_PATH` 指定的 vault 中。

## 使用

1. **启用后**：Resurface 会扫描 vault 里所有现有 markdown，加入复活池（3 天 ± 1 天后开始出现）
2. **每次打开 Obsidian**：顶部出现 `🌱 今天有 N 条笔记想重新见你` 提示 + ribbon 🌱 角标显示数字
3. **点 ribbon 图标**：右侧栏打开复习面板，显示第一条笔记的标题 + TLDR
4. **点"展开正文"**：主区打开真正的笔记内容（复用一个"复习专用 tab"）
5. **选择分流动作**：Never、Later、Soon 或 Learn；前三者不会调用 FSRS
6. **Learn 后评分**：Again / Hard / Good / Easy 由 FSRS 调度
7. **点"进入下一条"**：切到下一条到期笔记；主区仍可继续编辑真笔记

首次扫描 vault 时，插件会为缺少 ID 的 Markdown 写入 `resurface-id` UUID。
复习调度数据仍保存在 `data.json`，复习不会反复改写正文。

## TLDR 提取

卡片正面默认展示 **标题 + TLDR**。TLDR 按以下优先级提取：

1. frontmatter 的 `tldr` 字段
2. `> [!tldr]` callout
3. `## TLDR` 或 `## 摘要` 区块下的第一段
4. 笔记第一段
5. 笔记开头 200 字

无需改动写作习惯——越用心写 TLDR，cue 质量越高。

## 设置项

**基础**：首次出现间隔 · Soon 间隔 · 评分档数 · 自动进入下一条 · 复习目录（白名单）

**高级**：期望保留率 · 间隔抖动 · Later 阶梯 · TLDR 字段名 · 最小字符数 · streak 开关

## 设计哲学

- **笔记 = 复习单元**：不造卡片，笔记本身就是最小单元
- **先捕获，后决策**：复活解决“值得再次看吗”，FSRS 解决“如何记住”
- **不打扰**：被动视觉提示，不推送
- **复习现场决策**：不需要提前配置/打标签
- **笔记是活的**：复习时可编辑，笔记会生长

## 文档

- [产品设计文档](./docs/产品设计文档.md)
- [技术架构文档](./docs/技术架构文档.md)
- [学习科学调研](./research/)（4 份一手文献综述）
- [CHANGELOG](./CHANGELOG.md)

## 路线图

- [x] **v0.1.0 MVP**：复活分流 + FSRS 学习 + 稳定笔记 ID
- [ ] **M1**：编辑影响调度（大改笔记 → Stability × 0.5）· JOL 校准反馈
- [ ] **M2**：排除列表管理 UI · 笔记稳定期
- [ ] **M3**：FSRS 参数本地优化 · 数据面板
- [ ] **M4**：多语言 · 同步冲突处理 · 大 vault 性能优化

## 技术栈

- **TypeScript** · **Obsidian Plugin API** · **原生 DOM**（无 React/Vue）
- [**ts-fsrs**](https://github.com/open-spaced-repetition/ts-fsrs) 4.7.1 · MIT
- **esbuild** 打包 · **Vitest** 纯函数测试（60 tests）

## 致谢

算法与证据基础：
- [FSRS](https://github.com/open-spaced-repetition) · 叶峻峣（Jarrett Ye）及 open-spaced-repetition 社区
- [Robert & Elizabeth Bjork](https://bjorklab.psych.ucla.edu/) 的 desirable difficulty 理论
- Henry Roediger & Jeffrey Karpicke 的 retrieval practice 研究
- Piotr Woźniak 及 SuperMemo 团队的数十年奠基工作

## 许可证

[MIT](./LICENSE)
