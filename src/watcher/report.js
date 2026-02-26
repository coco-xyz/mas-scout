/**
 * 日报生成 — 将 diff 结果格式化为可读报告
 */

/**
 * 生成 Markdown 格式的日报
 * @param {{ added: Array, removed: Array }} diff
 * @param {{ timestamp: string, count: number }} meta
 * @returns {string}
 */
function generateMarkdownReport(diff, meta) {
  const lines = [];
  const date = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  lines.push(`# MAS Scout 日报 — ${date}`);
  lines.push('');
  lines.push(`总计监控机构：${meta.count} 家`);
  lines.push(`新增：${diff.added.length} 家 | 移除：${diff.removed.length} 家`);
  lines.push('');

  if (diff.added.length > 0) {
    lines.push('## 🆕 新增牌照持有者');
    lines.push('');
    for (const inst of diff.added) {
      lines.push(`### ${inst.name}`);
      lines.push(`- **牌照类型：** ${inst.licenseType}`);
      if (inst.address) lines.push(`- **地址：** ${inst.address}`);
      if (inst.website) lines.push(`- **网站：** ${inst.website}`);
      if (inst.phone) lines.push(`- **电话：** ${inst.phone}`);
      if (inst.detailUrl) lines.push(`- **FID 链接：** ${inst.detailUrl}`);
      lines.push('');
    }
  }

  if (diff.removed.length > 0) {
    lines.push('## ❌ 移除的机构');
    lines.push('');
    for (const inst of diff.removed) {
      lines.push(`- ${inst.name} (${inst.licenseType})`);
    }
    lines.push('');
  }

  if (diff.added.length === 0 && diff.removed.length === 0) {
    lines.push('> 今日无变化。');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 生成纯文本摘要（用于消息推送）
 * @param {{ added: Array, removed: Array }} diff
 * @returns {string}
 */
function generateTextSummary(diff) {
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return 'MAS Scout: 今日无新增牌照。';
  }

  const parts = [];
  if (diff.added.length > 0) {
    parts.push(`新增 ${diff.added.length} 家牌照持有者：`);
    for (const inst of diff.added) {
      parts.push(`  • ${inst.name} (${inst.licenseType})`);
    }
  }
  if (diff.removed.length > 0) {
    parts.push(`移除 ${diff.removed.length} 家：`);
    for (const inst of diff.removed) {
      parts.push(`  • ${inst.name}`);
    }
  }

  return `MAS Scout 日报\n${parts.join('\n')}`;
}

export { generateMarkdownReport, generateTextSummary };
