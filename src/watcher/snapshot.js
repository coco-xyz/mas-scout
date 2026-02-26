/**
 * 快照管理 — 存储和比对 FID 数据
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../shared/config.js';

const SNAPSHOT_DIR = join(DATA_DIR, 'snapshots');

/**
 * 确保快照目录存在
 */
function ensureDir() {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

/**
 * 保存快照
 * @param {Array} institutions
 * @returns {string} 快照文件路径
 */
function saveSnapshot(institutions) {
  ensureDir();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `snapshot-${ts}.json`;
  const filepath = join(SNAPSHOT_DIR, filename);

  const data = {
    timestamp: new Date().toISOString(),
    count: institutions.length,
    institutions,
  };

  writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`[snapshot] 已保存: ${filename} (${institutions.length} 家机构)`);
  return filepath;
}

/**
 * 加载最近一次快照
 * @returns {{ timestamp: string, count: number, institutions: Array } | null}
 */
function loadLatestSnapshot() {
  ensureDir();
  const files = readdirSync(SNAPSHOT_DIR)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  const filepath = join(SNAPSHOT_DIR, files[0]);
  const data = JSON.parse(readFileSync(filepath, 'utf-8'));
  console.log(`[snapshot] 加载上次快照: ${files[0]} (${data.count} 家机构)`);
  return data;
}

/**
 * Diff 两个快照，找出新增机构
 * @param {Array} current - 当前抓取结果
 * @param {Array} previous - 上次快照
 * @returns {{ added: Array, removed: Array }}
 */
function diffSnapshots(current, previous) {
  const prevNames = new Set(previous.map(i => i.name));
  const currNames = new Set(current.map(i => i.name));

  const added = current.filter(i => !prevNames.has(i.name));
  const removed = previous.filter(i => !currNames.has(i.name));

  return { added, removed };
}

export { saveSnapshot, loadLatestSnapshot, diffSnapshots };
