/**
 * MAS Scout Enricher — 联系人与公司情报
 *
 * 输入：新获牌公司名称
 * 输出：决策层联系人 + 公司背景
 *
 * 优先使用 browser-based scraping（Google SERP + 公司网站），
 * CDP 不可用时 fallback 到 mock 数据。
 */

import { enrichWithBrowser } from './scraper.js';

const COMPLIANCE_TITLES = [
  'Chief Compliance Officer',
  'CCO',
  'MLRO',
  'Money Laundering Reporting Officer',
  'Head of Compliance',
  'VP Compliance',
  'Vice President Compliance',
  'Director of Compliance',
  'Compliance Director',
];

const MOCK_CONTACTS = {
  _default: [
    { name: 'Jane Chen', title: 'Chief Compliance Officer', email: 'jane.chen@example.com', linkedInUrl: 'https://linkedin.com/in/janechen' },
    { name: 'Ahmad Razak', title: 'MLRO', email: 'ahmad.r@example.com', linkedInUrl: 'https://linkedin.com/in/ahmadrazak' },
    { name: 'Sarah Tan', title: 'Head of Compliance', email: 'sarah.t@example.com', linkedInUrl: 'https://linkedin.com/in/sarahtan' },
  ],
};

const MOCK_COMPANY_INFO = {
  _default: {
    headcount: 85,
    fundingStage: 'Series A',
    techStack: ['Python', 'AWS', 'PostgreSQL'],
    recentNews: ['Obtained MAS CMS license in Feb 2026'],
  },
};

/**
 * 对联系人按决策层优先级排序
 * @param {Array} contacts
 * @returns {Array}
 */
function rankContacts(contacts) {
  const titlePriority = {
    'Chief Compliance Officer': 1,
    'CCO': 1,
    'MLRO': 2,
    'Money Laundering Reporting Officer': 2,
    'Head of Compliance': 3,
    'VP Compliance': 4,
    'Vice President Compliance': 4,
    'Director of Compliance': 5,
    'Compliance Director': 5,
  };

  return contacts
    .map(c => {
      const priority = Object.entries(titlePriority)
        .find(([key]) => c.title?.toLowerCase().includes(key.toLowerCase()));
      return { ...c, priority: priority ? priority[1] : 99 };
    })
    .sort((a, b) => a.priority - b.priority);
}

/**
 * 通过浏览器搜索公司联系人（Google SERP + 公司网站）
 * @param {string} companyName
 * @returns {Promise<Array>}
 */
async function searchContacts(companyName) {
  console.log(`[enricher] 搜索联系人: ${companyName}`);
  // Browser-based search is handled in enrich() flow
  // This function provides mock fallback for direct calls
  return MOCK_CONTACTS[companyName] || MOCK_CONTACTS._default;
}

/**
 * 补全公司背景信息
 * @param {string} companyName
 * @param {string} website
 * @returns {Promise<object>}
 */
async function enrichCompany(companyName, website) {
  console.log(`[enricher] 补全公司信息: ${companyName}`);
  // Browser-based enrichment is handled in enrich() flow
  return MOCK_COMPANY_INFO[companyName] || MOCK_COMPANY_INFO._default;
}

/**
 * 完整的 enrich 流程
 * 优先使用浏览器抓取，CDP 连接失败时 fallback 到 mock
 *
 * @param {{ name: string, website: string, address?: string, licenseTypes?: string[] }} company
 * @returns {Promise<{ contacts: Array, companyInfo: object }>}
 */
async function enrich(company) {
  try {
    console.log(`[enricher] 尝试浏览器抓取: ${company.name}`);
    const result = await enrichWithBrowser(company);
    const contactCount = result.contacts.length;

    if (contactCount > 0) {
      console.log(`[enricher] 浏览器抓取成功: ${contactCount} 个联系人`);
    } else {
      console.log('[enricher] 浏览器抓取无联系人结果');
    }

    return {
      contacts: rankContacts(result.contacts),
      companyInfo: result.companyInfo,
    };
  } catch (err) {
    console.log(`[enricher] 浏览器不可用 (${err.message})`);
    return {
      contacts: [],
      companyInfo: null,
    };
  }
}

export { enrich, searchContacts, rankContacts, enrichCompany, MOCK_CONTACTS, MOCK_COMPANY_INFO };
