/**
 * MAS Scout Enricher — 联系人与公司情报
 *
 * 输入：新获牌公司名称
 * 输出：决策层联系人 + 公司背景
 */

const APOLLO_BASE = 'https://api.apollo.io/v1';
const APOLLO_API_KEY = process.env.APOLLO_API_KEY || '';

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

/**
 * 通过 Apollo.io 搜索公司联系人
 * @param {string} companyName
 * @returns {Promise<Array<{name: string, title: string, email: string, linkedInUrl: string}>>}
 */
async function searchContacts(companyName) {
  console.log(`[enricher] 搜索联系人: ${companyName}`);

  if (!APOLLO_API_KEY) {
    console.log('[enricher] Apollo API key 未配置，使用 mock 数据');
    return MOCK_CONTACTS[companyName] || MOCK_CONTACTS._default;
  }

  const res = await fetch(`${APOLLO_BASE}/mixed_people/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': APOLLO_API_KEY,
    },
    body: JSON.stringify({
      q_organization_name: companyName,
      person_titles: COMPLIANCE_TITLES,
      page: 1,
      per_page: 10,
    }),
  });

  if (!res.ok) {
    console.error(`[enricher] Apollo API error: ${res.status}`);
    return MOCK_CONTACTS._default;
  }

  const data = await res.json();
  return (data.people || []).map(p => ({
    name: p.name || `${p.first_name} ${p.last_name}`,
    title: p.title || '',
    email: p.email || '',
    linkedInUrl: p.linkedin_url || '',
  }));
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

const MOCK_COMPANY_INFO = {
  _default: {
    headcount: 85,
    fundingStage: 'Series A',
    techStack: ['Python', 'AWS', 'PostgreSQL'],
    recentNews: ['Obtained MAS CMS license in Feb 2026'],
  },
};

/**
 * 补全公司背景信息
 * @param {string} companyName
 * @param {string} website
 * @returns {Promise<{headcount: number, fundingStage: string, techStack: string[], recentNews: string[]}>}
 */
async function enrichCompany(companyName, website) {
  console.log(`[enricher] 补全公司信息: ${companyName}`);

  if (!APOLLO_API_KEY) {
    console.log('[enricher] Apollo API key 未配置，使用 mock 数据');
    return MOCK_COMPANY_INFO[companyName] || MOCK_COMPANY_INFO._default;
  }

  // Try domain-based enrichment
  const domain = website?.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (domain) {
    const domainRes = await fetch(`${APOLLO_BASE}/organizations/enrich?domain=${encodeURIComponent(domain)}`, {
      headers: { 'X-Api-Key': APOLLO_API_KEY },
    });

    if (domainRes.ok) {
      const org = (await domainRes.json()).organization || {};
      return {
        headcount: org.estimated_num_employees || 0,
        fundingStage: org.latest_funding_stage || 'unknown',
        techStack: org.technologies || [],
        recentNews: org.news_articles?.slice(0, 3).map(a => a.title) || [],
      };
    }
  }

  // Fallback: search by name
  const searchRes = await fetch(`${APOLLO_BASE}/mixed_companies/search`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': APOLLO_API_KEY,
    },
    body: JSON.stringify({
      q_organization_name: companyName,
      page: 1,
      per_page: 1,
    }),
  });

  if (searchRes.ok) {
    const orgs = (await searchRes.json()).organizations || [];
    if (orgs.length > 0) {
      const org = orgs[0];
      return {
        headcount: org.estimated_num_employees || 0,
        fundingStage: org.latest_funding_stage || 'unknown',
        techStack: org.technologies || [],
        recentNews: [],
      };
    }
  }

  return MOCK_COMPANY_INFO._default;
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

export { enrich, searchContacts, rankContacts, enrichCompany, MOCK_CONTACTS, MOCK_COMPANY_INFO };
