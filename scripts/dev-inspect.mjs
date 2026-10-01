/**
 * 开发辅助：查看复习状态
 * 打印每条笔记的 rediscovery / FSRS 状态
 *
 * 用法：node scripts/dev-inspect.mjs [筛选 keyword]
 */

import { readFile } from "node:fs/promises";
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

const keyword = process.argv[2] ?? "";

const raw = await readFile(DATA_FILE, "utf-8");
const data = JSON.parse(raw);

// 总览
const now = new Date();
let total = 0;
let suspended = 0;
let reviewed = 0;
let due = 0;
for (const [, n] of Object.entries(data.notes)) {
  total++;
  if (n.mode === "suspended") suspended++;
  if ((n.fsrs?.reps ?? 0) > 0) reviewed++;
  if (
    n.mode !== "suspended" &&
    n.nextReview &&
    new Date(n.nextReview) <= now
  ) {
    due++;
  }
}

console.log(`\n📊 复活池概览`);
console.log(`  总计:       ${total}`);
console.log(`  suspended:  ${suspended}`);
console.log(`  有过复习:   ${reviewed}`);
console.log(`  当前到期:   ${due}`);
console.log(`  累计复习:   ${data.stats.totalReviews} 次`);
console.log(`  连续天数:   ${data.stats.streakDays}`);

// 笔记列表
console.log(`\n📝 笔记状态${keyword ? `（筛选 "${keyword}"）` : "（仅显示已复习过的）"}\n`);

const filtered = Object.entries(data.notes)
  .filter(([, n]) => {
    if (keyword) return n.path.includes(keyword);
    return (
      (n.fsrs?.reps ?? 0) > 0 ||
      (n.mode !== "suspended" &&
        n.nextReview &&
        new Date(n.nextReview) <= now)
    );
  })
  .sort(([, a], [, b]) => {
    const aTime = a.nextReview ? new Date(a.nextReview).getTime() : Infinity;
    const bTime = b.nextReview ? new Date(b.nextReview).getTime() : Infinity;
    return aTime - bTime;
  });

if (filtered.length === 0) {
  console.log("  （无匹配）");
} else {
  const PAD = 45;
  console.log(
    "  " +
      "path".padEnd(PAD) +
      "  mode          reps  S       next_review         susp",
  );
  console.log("  " + "─".repeat(PAD + 45));
  for (const [, n] of filtered) {
    const path = n.path;
    const shortPath = path.length > PAD - 1
      ? "…" + path.slice(-(PAD - 2))
      : path.padEnd(PAD);
    const next = n.nextReview ? new Date(n.nextReview) : null;
    const nextStr = next
      ? next.toISOString().replace("T", " ").slice(0, 16)
      : "-";
    const daysFromNow = next
      ? Math.round((next.getTime() - now.getTime()) / (24 * 3600 * 1000))
      : null;
    const nextLabel =
      daysFromNow === null
        ? nextStr
        : daysFromNow <= 0
          ? `${nextStr} ⚡已到期`
          : `${nextStr} (+${daysFromNow}d)`;
    const card = n.fsrs ?? {};
    console.log(
      "  " +
        shortPath.padEnd(PAD) +
        "  " +
        String(n.mode).padEnd(13) +
        " " +
        String(card.reps ?? 0).padEnd(5) +
        " " +
        Number(card.stability ?? 0).toFixed(2).padEnd(7) +
        " " +
        nextLabel +
        " " +
        (n.mode === "suspended" ? "✗" : ""),
    );
  }
}

console.log("");
