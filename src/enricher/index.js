/**
 * MAS Scout Enricher — 联系人与公司情报
 *
 * 输入：新获牌公司名称
 * 输出：决策层联系人 + 公司背景
 *
 * 职责：
 * 1. 用公司名在 Apollo.io / LinkedIn 搜索合规相关职位
 * 2. 优先级排序：CCO > MLRO > Head of Compliance > VP > Director
 * 3. 补全公司信息：员工数、融资阶段、技术栈、近期新闻
 *
 * TODO: Lucy 实现
 */

/**
 * 通过 Apollo.io 搜索公司联系人
 * @param {string} companyName
 * @returns {Promise<Array<{name: string, title: string, email: string, linkedInUrl: string, priority: number}>>}
 */
async function searchContacts(companyName) {
  // TODO: Apollo.io API 集成
  // API docs: https://apolloio.github.io/apollo-api-docs/
  console.log(`[enricher] 搜索联系人: ${companyName}`);
  return [];
}

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
 * 补全公司背景信息
 * @param {string} companyName
 * @param {string} website
 * @returns {Promise<{headcount: number, fundingStage: string, techStack: string[], recentNews: string[]}>}
 */
async function enrichCompany(companyName, website) {
  // TODO: 多源数据补全
  console.log(`[enricher] 补全公司信息: ${companyName}`);
  return {
    headcount: 0,
    fundingStage: 'unknown',
    techStack: [],
    recentNews: [],
  };
}

/**
 * 完整的 enrich 流程
 * @param {{ name: string, website: string }} company
 * @returns {Promise<{ contacts: Array, companyInfo: object }>}
 */
async function enrich(company) {
  const [contacts, companyInfo] = await Promise.all([
    searchContacts(company.name),
    enrichCompany(company.name, company.website),
  ]);

  return {
    contacts: rankContacts(contacts),
    companyInfo,
  };
}

export { enrich, searchContacts, rankContacts, enrichCompany };
