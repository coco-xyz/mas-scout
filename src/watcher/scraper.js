/**
 * MAS FID 抓取器
 *
 * 策略：用 print 视图（?count=0）一次拉全量机构列表，
 * 然后按 category 过滤。避免分页爬取。
 */

import { load } from 'cheerio';
import { MAS_FID_BASE, WATCHED_CATEGORIES } from '../shared/config.js';

/**
 * 抓取指定类别的机构列表
 * @param {string} sector
 * @param {string} category
 * @returns {Promise<Array<{name: string, detailUrl: string, fid: string, licenseType: string, address: string, website: string, phone: string}>>}
 */
async function scrapeCategory(sector, category) {
  const params = new URLSearchParams({ sector, category });
  const url = `${MAS_FID_BASE}/institution/print?${params}`;

  console.log(`[scraper] 抓取: ${category}`);
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'MAS-Scout/0.1 (compliance monitoring)',
      'Accept': 'text/html',
    },
  });

  if (!resp.ok) {
    throw new Error(`抓取失败 ${url}: HTTP ${resp.status}`);
  }

  const html = await resp.text();
  return parseInstitutionList(html, category);
}

/**
 * 解析机构列表 HTML
 */
function parseInstitutionList(html, licenseType) {
  const $ = load(html);
  const institutions = [];

  // FID 列表页每个机构是一个 card / row
  // print 视图通常是表格或简洁列表
  // 根据调研结果，每个机构有名称、地址、电话、网站等字段

  // 尝试多种选择器适配 MAS FID 的 HTML 结构
  const selectors = [
    '.institution-item',
    '.search-result-item',
    '.result-item',
    'table tbody tr',
    '.entity-info',
  ];

  // 通用 approach：找所有包含 /fid/institution/detail/ 链接的容器
  $('a[href*="/fid/institution/detail/"]').each((_, el) => {
    const $link = $(el);
    const href = $link.attr('href') || '';
    const name = $link.text().trim();

    if (!name || !href) return;

    // 从 URL 提取 FID（数字 ID）
    const fidMatch = href.match(/\/detail\/(\d+)-/);
    const fid = fidMatch ? fidMatch[1] : '';

    // 向上找容器获取其他字段
    const $container = $link.closest('div, tr, li, section').first();
    const containerText = $container.text();

    // 提取地址（通常包含 SINGAPORE 或邮编）
    const addressMatch = containerText.match(/(\d+[^]*?SINGAPORE\s*\d{6})/i);
    const address = addressMatch ? addressMatch[1].replace(/\s+/g, ' ').trim() : '';

    // 提取网站
    const websiteLink = $container.find('a[href^="http"]').not($link).first();
    const website = websiteLink.attr('href') || '';

    // 提取电话
    const phoneMatch = containerText.match(/(?:\+65\s?)?(\d{8})/);
    const phone = phoneMatch ? phoneMatch[0] : '';

    institutions.push({
      name,
      fid,
      detailUrl: href.startsWith('http') ? href : `${MAS_FID_BASE}${href.replace('/fid', '')}`,
      licenseType,
      address,
      website,
      phone,
    });
  });

  console.log(`[scraper] ${licenseType}: 找到 ${institutions.length} 家机构`);
  return institutions;
}

/**
 * 抓取所有关注类别的机构
 * @returns {Promise<Array>}
 */
async function scrapeAll() {
  const allInstitutions = [];

  for (const { sector, category } of WATCHED_CATEGORIES) {
    try {
      const list = await scrapeCategory(sector, category);
      allInstitutions.push(...list);
      // 避免请求过快
      await new Promise(r => setTimeout(r, 2000));
    } catch (err) {
      console.error(`[scraper] 抓取 ${category} 失败:`, err.message);
    }
  }

  // 按 FID 去重（同一机构可能持有多个牌照）
  const seen = new Map();
  for (const inst of allInstitutions) {
    const key = inst.fid || inst.name;
    if (seen.has(key)) {
      // 合并牌照类型
      const existing = seen.get(key);
      if (!existing.licenseType.includes(inst.licenseType)) {
        existing.licenseType += `, ${inst.licenseType}`;
      }
    } else {
      seen.set(key, { ...inst });
    }
  }

  return [...seen.values()];
}

export { scrapeAll, scrapeCategory, parseInstitutionList };
