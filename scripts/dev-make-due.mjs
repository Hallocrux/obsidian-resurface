/**
 * 开发辅助：把 data.json 里前 N 条笔记的 nextReview 设为过去（立即到期）。
 * 仅用于 MVP 人工测试，正式版本不会有这个脚本。
 *
 * 用法：node scripts/dev-make-due.mjs [count=5]
 *
 * 会自动：
 *   - 避开 suspended 笔记
 *   - 避开已经到期的笔记（避免重复）
 *   - 如果设置了 allowedPaths，只挑白名单下的笔记
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const VAULT_PATH =
  "/Users/liyixin/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Vault";
const DATA_FILE = join(
  VAULT_PATH,
  ".obsidian",
  "plugins",
  "obsidian-resurface",
  "data.json",
);

const count = parseInt(process.argv[2] ?? "5", 10);

const raw = await readFile(DATA_FILE, "utf-8");
const data = JSON.parse(raw);

const now = new Date();
const yesterday = new Date();
yesterday.setDate(yesterday.getDate() - 1);
const yesterdayIso = yesterday.toISOString();

const allowedPaths = data.settings.allowedPaths ?? [];
const isAllowed = (p) => {
  if (allowedPaths.length === 0) return true;
  return allowedPaths.some((rule) => {
    const prefix = rule.replace(/\/+$/, "");
    if (prefix === "") return true;
    return p === prefix || p.startsWith(prefix + "/");
  });
};

const candidates = Object.entries(data.notes)
  .filter(([, n]) => {
    if (n.mode === "suspended") return false;
    if (new Date(n.nextReview) <= now) return false; // 已经到期的跳过
    if (!isAllowed(n.path)) return false;
    return true;
  })
  .map(([id, note]) => ({ id, path: note.path }))
  .slice(0, count);

if (candidates.length === 0) {
  console.log("找不到符合条件的笔记（suspended/已到期/不在白名单内）");
  process.exit(0);
}

for (const { id } of candidates) {
  data.notes[id].nextReview = yesterdayIso;
}

await writeFile(DATA_FILE, JSON.stringify(data, null, 2));

console.log(`\n已把 ${candidates.length} 条笔记的 nextReview 改到昨天，立即到期：\n`);
for (const { path } of candidates) console.log("  -", path);
console.log(
  "\n⚠️ Cmd+P → 'Reload app without saving' 让插件重读 data.json",
);
