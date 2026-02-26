/**
 * Browser-based enrichment scraper
 *
 * Uses DuckDuckGo SERP to find:
 * 1. Company LinkedIn page
 * 2. Compliance officers' LinkedIn profiles
 * 3. Company website team/about pages
 *
 * Connects to existing Chrome via CDP (port 9222).
 * No paid APIs, no LinkedIn login required.
 */

import { chromium } from 'playwright-core';

const CDP_PORT = process.env.CDP_PORT || 9222;
const SEARCH_DELAY = 3000; // ms between searches to avoid rate limits

// Legal suffixes to strip from company names for better search results
const LEGAL_SUFFIXES = /\s*\b(PTE\.?\s*LTD\.?|PRIVATE\s+LIMITED|LIMITED|LTD\.?|INC\.?|CORP\.?|LLC|L\.?P\.?|S\.?A\.?|GMBH|PTY\.?\s*LTD\.?|CO\.?\s*LTD\.?)\s*\.?\s*$/i;

/**
 * Normalize company name for search — remove legal suffixes and clean up
 * "HASHKEY DIGITAL ASSET GROUP PTE. LTD." → "HASHKEY DIGITAL ASSET GROUP"
 */
function normalizeCompanyName(name) {
  return name.replace(LEGAL_SUFFIXES, '').replace(/\s*\(SINGAPORE\)\s*/i, ' ').trim();
}

/**
 * Connect to existing Chrome via CDP
 * @returns {Promise<{browser: object, context: object}>}
 */
async function connect() {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const contexts = browser.contexts();
  const context = contexts[0] || await browser.newContext();
  return { browser, context };
}

/**
 * Search DuckDuckGo and extract results
 * (Google blocks cloud IPs with CAPTCHA; DDG works reliably)
 *
 * @param {object} page - Playwright page
 * @param {string} query
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
async function webSearch(page, query) {
  const url = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

  // Wait for results
  await page.waitForSelector('[data-testid="result"], .react-results--main article, .result', { timeout: 10000 }).catch(() => {});
  // Extra wait for JS rendering
  await delay(2000);

  const results = await page.evaluate(() => {
    const items = [];

    // DDG result container — use a single authoritative selector to avoid duplicates
    const resultEls = document.querySelectorAll('[data-testid="result"]')
      || document.querySelectorAll('.react-results--main article')
      || document.querySelectorAll('li[data-layout="organic"]');

    for (const el of resultEls) {
      // Use data-testid selectors for the actual external links (not DDG internal links)
      const titleLinkEl = el.querySelector('a[data-testid="result-title-a"]');
      const urlLinkEl = el.querySelector('a[data-testid="result-extras-url-link"]');
      const linkEl = titleLinkEl || urlLinkEl || el.querySelector('a[href^="http"]');

      const titleEl = el.querySelector('h2, [data-testid="result-title"]');
      const snippetEl = el.querySelector('[data-result="snippet"], span.kY2IgmnCmOGjharHErah, .result__snippet');

      if (!linkEl) continue;

      const href = linkEl.getAttribute('href');
      // Skip DDG internal links and relative URLs
      if (!href || !href.startsWith('http') || href.includes('duckduckgo.com')) continue;

      items.push({
        title: titleEl?.textContent?.trim() || '',
        url: href,
        snippet: snippetEl?.textContent?.trim() || '',
      });
    }
    return items;
  });

  return results;
}

/**
 * Search for company LinkedIn page
 * @param {object} page
 * @param {string} companyName
 * @returns {Promise<string|null>} LinkedIn company URL
 */
async function findCompanyLinkedIn(page, companyName) {
  const clean = normalizeCompanyName(companyName);

  // Try without quotes first — more results on DDG
  const query = `${clean} site:linkedin.com/company Singapore`;
  const results = await webSearch(page, query);

  for (const r of results) {
    if (r.url.includes('linkedin.com/company/')) {
      return r.url;
    }
  }
  return null;
}

/**
 * Search for compliance contacts via Google SERP
 * @param {object} page
 * @param {string} companyName
 * @returns {Promise<Array<{name: string, title: string, linkedInUrl: string}>>}
 */
async function findComplianceContacts(page, companyName) {
  const contacts = [];
  const clean = normalizeCompanyName(companyName);

  // Search for compliance officers — use unquoted name for broader DDG results
  const query = `${clean} compliance OR CCO OR MLRO OR AML site:linkedin.com/in`;
  const results = await webSearch(page, query);

  for (const r of results) {
    if (!r.url.includes('linkedin.com/in/')) continue;

    const parsed = parseLinkedInResult(r.title, r.snippet, companyName);
    if (parsed) {
      contacts.push({
        name: parsed.name,
        title: parsed.title,
        linkedInUrl: r.url.split('?')[0],
        source: 'ddg-serp',
      });
    }
  }

  // If no compliance-specific results, search broader management
  if (contacts.length === 0) {
    const broadQuery = `${clean} director OR head OR chief OR VP site:linkedin.com/in`;
    await delay(SEARCH_DELAY);
    const broadResults = await webSearch(page, broadQuery);

    for (const r of broadResults) {
      if (!r.url.includes('linkedin.com/in/')) continue;
      const parsed = parseLinkedInResult(r.title, r.snippet, companyName);
      if (parsed) {
        contacts.push({
          name: parsed.name,
          title: parsed.title,
          linkedInUrl: r.url.split('?')[0],
          source: 'ddg-serp-broad',
        });
      }
    }
  }

  return contacts;
}

/**
 * Parse LinkedIn SERP result to extract name and title
 * Common formats:
 *   "Jane Chen - CCO - ABC Pte Ltd | LinkedIn"
 *   "Jane Chen – Chief Compliance Officer – ABC | LinkedIn"
 *   "Jane Chen | LinkedIn" (title in snippet)
 *
 * @param {string} title
 * @param {string} snippet
 * @param {string} companyName
 * @returns {{name: string, title: string}|null}
 */
function parseLinkedInResult(title, snippet, companyName) {
  // Remove " | LinkedIn" suffix
  let clean = title.replace(/\s*[\|–-]\s*LinkedIn\s*$/i, '').trim();

  // Split by common separators: " - ", " – ", " | "
  const parts = clean.split(/\s*[\|–-]\s*/);

  if (parts.length === 0) return null;

  const name = parts[0].trim();
  if (!name || name.length > 60) return null;

  // Try to find title from parts
  let jobTitle = '';
  if (parts.length >= 2) {
    jobTitle = parts[1].trim();
  }

  // If title looks like company name rather than job title, check snippet
  if (!jobTitle || jobTitle.toLowerCase().includes(companyName.toLowerCase().slice(0, 10))) {
    // Extract from snippet
    const snippetTitle = extractTitleFromSnippet(snippet);
    if (snippetTitle) jobTitle = snippetTitle;
  }

  // Skip if no useful title found
  if (!jobTitle) jobTitle = 'Unknown Title';

  return { name, title: jobTitle };
}

/**
 * Extract job title from SERP snippet text
 */
function extractTitleFromSnippet(snippet) {
  if (!snippet) return null;

  // Common patterns in LinkedIn SERP snippets
  const patterns = [
    /(?:^|\.\s+)([A-Z][^.]*?(?:compliance|CCO|MLRO|AML|officer|director|head|chief|VP|manager)[^.]*?)(?:\.|$)/i,
    /(?:title|position|role)[\s:]+([^.]+)/i,
  ];

  for (const pat of patterns) {
    const match = snippet.match(pat);
    if (match) return match[1].trim();
  }
  return null;
}

/**
 * Scrape company website About/Team page for additional info
 * @param {object} page
 * @param {string} websiteUrl
 * @returns {Promise<{description: string, teamMembers: Array}>}
 */
async function scrapeCompanyWebsite(page, websiteUrl) {
  if (!websiteUrl) return { description: '', teamMembers: [] };

  const result = { description: '', teamMembers: [] };

  try {
    const baseUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Get meta description or first paragraph
    result.description = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="description"]');
      if (meta?.content) return meta.content;

      const firstP = document.querySelector('main p, article p, .content p, p');
      return firstP?.textContent?.trim()?.slice(0, 300) || '';
    });

    // Try to find About/Team page link
    const aboutLink = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a'));
      for (const link of links) {
        const text = link.textContent?.toLowerCase() || '';
        const href = link.href || '';
        if (text.match(/\b(team|about|leadership|people|management)\b/) && href) {
          return href;
        }
      }
      return null;
    });

    if (aboutLink) {
      await page.goto(aboutLink, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // Extract team member names and titles
      result.teamMembers = await page.evaluate(() => {
        const members = [];
        // Common patterns for team listings
        const cards = document.querySelectorAll(
          '[class*="team"] [class*="card"], [class*="member"], [class*="person"], [class*="staff"]'
        );

        for (const card of cards) {
          const nameEl = card.querySelector('h2, h3, h4, [class*="name"], strong');
          const titleEl = card.querySelector('p, [class*="title"], [class*="role"], [class*="position"], span');
          if (nameEl) {
            members.push({
              name: nameEl.textContent?.trim() || '',
              title: titleEl?.textContent?.trim() || '',
            });
          }
        }
        return members.slice(0, 20);
      });
    }
  } catch (err) {
    console.log(`[enricher/scraper] 公司网站抓取失败: ${err.message}`);
  }

  return result;
}

/**
 * Full browser-based enrichment for a company
 * @param {{ name: string, website: string, address: string, licenseTypes: string[] }} company
 * @returns {Promise<{ contacts: Array, companyInfo: object, linkedInUrl: string|null }>}
 */
async function enrichWithBrowser(company) {
  console.log(`[enricher/scraper] 开始 enrich: ${company.name}`);

  let browser, context, page;
  try {
    ({ browser, context } = await connect());
    page = await context.newPage();

    // 1. Find LinkedIn company page
    const linkedInUrl = await findCompanyLinkedIn(page, company.name);
    console.log(`[enricher/scraper] LinkedIn: ${linkedInUrl || 'not found'}`);
    await delay(SEARCH_DELAY);

    // 2. Find compliance contacts
    const contacts = await findComplianceContacts(page, company.name);
    console.log(`[enricher/scraper] 找到 ${contacts.length} 个联系人`);
    await delay(SEARCH_DELAY);

    // 3. Scrape company website
    const websiteInfo = await scrapeCompanyWebsite(page, company.website);

    // Merge website team members as additional contacts (lower priority)
    const websiteContacts = (websiteInfo.teamMembers || [])
      .filter(m => m.title?.toLowerCase().match(/compliance|cco|mlro|aml|risk|legal/))
      .map(m => ({
        name: m.name,
        title: m.title,
        linkedInUrl: '',
        source: 'company-website',
      }));

    const allContacts = [...contacts, ...websiteContacts];

    // De-duplicate by name similarity
    const seen = new Set();
    const uniqueContacts = allContacts.filter(c => {
      const key = c.name.toLowerCase().replace(/\s+/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      contacts: uniqueContacts,
      companyInfo: {
        description: websiteInfo.description,
        linkedInUrl,
        teamSize: websiteInfo.teamMembers?.length || 0,
      },
      linkedInUrl,
    };
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export {
  enrichWithBrowser,
  findCompanyLinkedIn,
  findComplianceContacts,
  scrapeCompanyWebsite,
  parseLinkedInResult,
  normalizeCompanyName,
  connect,
  webSearch,
};
