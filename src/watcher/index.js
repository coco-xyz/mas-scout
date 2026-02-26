#!/usr/bin/env node

/**
 * MAS Scout Watcher — 主入口
 *
 * 用法:
 *   node src/watcher/index.js          # 完整运行：抓取 + diff + 保存 + 报告
 *   node src/watcher/index.js --diff-only  # 仅对比上次快照（不抓取）
 */

import { scrapeAll } from './scraper.js';
import { saveSnapshot, loadLatestSnapshot, diffSnapshots } from './snapshot.js';
import { generateMarkdownReport, generateTextSummary } from './report.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../shared/config.js';

async function main() {
  const startTime = Date.now();
  console.log('[watcher] MAS Scout Watcher 启动');
  console.log(`[watcher] 时间: ${new Date().toISOString()}`);

  // 1. 抓取当前 FID 数据
  console.log('\n[watcher] === Step 1: 抓取 MAS FID ===');
  const institutions = await scrapeAll();
  console.log(`[watcher] 抓取完成: ${institutions.length} 家机构`);

  if (institutions.length === 0) {
    console.error('[watcher] 未抓取到任何机构，可能是网站变更或网络问题');
    process.exit(1);
  }

  // 2. 加载上次快照
  console.log('\n[watcher] === Step 2: 加载上次快照 ===');
  const previous = loadLatestSnapshot();

  // 3. 保存当前快照
  console.log('\n[watcher] === Step 3: 保存当前快照 ===');
  saveSnapshot(institutions);

  // 4. Diff
  console.log('\n[watcher] === Step 4: 比对变化 ===');
  let diff;
  if (previous) {
    diff = diffSnapshots(institutions, previous.institutions);
    console.log(`[watcher] 新增: ${diff.added.length} 家, 移除: ${diff.removed.length} 家`);
  } else {
    console.log('[watcher] 首次运行，无历史快照可比对');
    diff = { added: institutions, removed: [] };
  }

  // 5. 生成报告
  console.log('\n[watcher] === Step 5: 生成报告 ===');
  const reportDir = join(DATA_DIR, 'reports');
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }

  const date = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportDir, `report-${date}.md`);
  const report = generateMarkdownReport(diff, {
    timestamp: new Date().toISOString(),
    count: institutions.length,
  });
  writeFileSync(reportPath, report);
  console.log(`[watcher] 报告已保存: ${reportPath}`);

  // 6. 输出摘要
  const summary = generateTextSummary(diff);
  console.log('\n[watcher] === 摘要 ===');
  console.log(summary);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[watcher] 完成，耗时 ${elapsed}s`);

  // 返回结果供调用者使用
  return { institutions, diff, summary, report };
}

main().catch(err => {
  console.error('[watcher] 致命错误:', err);
  process.exit(1);
});
