/**
 * MAS FID 抓取器
 *
 * MAS FID 是 SPA，内容通过 AJAX 加载。
 * 直接调用 /fid/custom/printpartial 获取全量 HTML 表格。
 *
 * 表头字段：
 * No. | Organisation Name | Address | Phone Number | Website |
 * Sector | Licence Type/Status | Activity/Business Type | Sub-Activity/Product
 */

import { load } from 'cheerio';
import { MAS_FID_BASE, WATCHED_CATEGORIES } from '../shared/config.js';

const PRINT_ENDPOINT = `${MAS_FID_BASE}/custom/printpartial`;

/**
 * 抓取指定类别的机构列表
 * @param {string} sector
 * @param {string} category
 * @returns {Promise<Array>}
 */
async function scrapeCategory(sector, category) {
  const params = new URLSearchParams({ sector, category });
  const url = `${PRINT_ENDPOINT}?${params}`;

  console.log(`[scraper] 抓取: ${category}`);
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'MAS-Scout/0.1 (compliance monitoring)',
      'Accept': 'text/html',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!resp.ok) {
    throw new Error(`抓取失败 ${url}: HTTP ${resp.status}`);
  }

  const html = await resp.text();
  return parsePrintTable(html);
}

/**
 * 解析 printpartial 返回的 HTML 表格
 * @param {string} html
 * @returns {Array<{name: string, address: string, phone: string, website: string, sector: string, licenseType: string, activity: string, subActivity: string}>}
 */
function parsePrintTable(html) {
  const $ = load(html);
  const institutions = [];

  $('table.fid-print-table tr').each((i, row) => {
    // 跳过表头
    if (i === 0) return;

    const cells = $(row).find('td');
    if (cells.length < 8) return;

    const name = $(cells[1]).text().trim();
    const address = $(cells[2]).text().trim();
    const phone = $(cells[3]).text().trim();
    const website = $(cells[4]).text().trim();
    const sector = $(cells[5]).text().trim();
    const licenseType = $(cells[6]).text().trim();
    const activity = $(cells[7]).text().trim();
    const subActivity = cells.length > 8 ? $(cells[8]).text().trim() : '';

    if (!name) return;

    institutions.push({
      name,
      address,
      phone,
      website,
      sector,
      licenseType,
      activity,
      subActivity,
    });
  });

  console.log(`[scraper] 解析到 ${institutions.length} 条记录`);
  return institutions;
}

/**
 * 同一公司可能因多个 activity 出现多行，合并它们
 * @param {Array} rows
 * @returns {Array}
 */
function mergeRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = row.name;
    if (map.has(key)) {
      const existing = map.get(key);
      // 合并 activity
      if (row.activity && !existing.activities.includes(row.activity)) {
        existing.activities.push(row.activity);
      }
      // 合并 licenseType
      if (row.licenseType && !existing.licenseTypes.includes(row.licenseType)) {
        existing.licenseTypes.push(row.licenseType);
      }
    } else {
      map.set(key, {
        name: row.name,
        address: row.address,
        phone: row.phone,
        website: row.website,
        sector: row.sector,
        licenseTypes: [row.licenseType].filter(Boolean),
        activities: [row.activity].filter(Boolean),
      });
    }
  }

  return [...map.values()];
}

/**
 * 抓取所有关注类别的机构
 * @returns {Promise<Array>}
 */
async function scrapeAll() {
  const allRows = [];

  for (const { sector, category } of WATCHED_CATEGORIES) {
    try {
      const rows = await scrapeCategory(sector, category);
      allRows.push(...rows);
      // 避免请求过快
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[scraper] 抓取 ${category} 失败:`, err.message);
    }
  }

  const merged = mergeRows(allRows);
  console.log(`[scraper] 总计: ${allRows.length} 行 → 合并为 ${merged.length} 家机构`);
  return merged;
}

export { scrapeAll, scrapeCategory, parsePrintTable, mergeRows };
