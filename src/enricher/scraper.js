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
 * Check if a DDG result (title + snippet) mentions the target company.
 * Extracts keywords from the company name and checks for partial matches.
 * "HASHKEY CAPITAL" → checks for "hashkey" in the result text.
 *
 * To avoid false positives from contact names (e.g., "Ariana Lobo" matching
 * "Ariana Investment"), the check strips the contact's name from the text
 * before matching.
 */
function resultMentionsCompany(title, snippet, companyName) {
  // Extract the contact name from SERP title (first part before separator)
  const contactName = title.replace(/\s*[\|–-]\s*LinkedIn\s*$/i, '').split(/\s*[\|–-]\s*/)[0]?.trim()?.toLowerCase() || '';

  // Remove the contact name from the text to avoid name↔company collisions
  let text = `${title} ${snippet}`.toLowerCase();
  if (contactName.length >= 3) {
    // Remove each word of the contact name individually
    for (const namePart of contactName.split(/\s+/)) {
      if (namePart.length >= 3) {
        text = text.replaceAll(namePart, ' ');
      }
    }
  }

  const clean = normalizeCompanyName(companyName).toLowerCase();

  // Extract significant keywords (skip short/generic words)
  const skipWords = new Set(['pte', 'ltd', 'the', 'and', 'of', 'for', 'group', 'holdings', 'services', 'technology', 'global', 'international', 'asia', 'pacific', 'capital', 'management', 'financial', 'digital', 'asset']);
  const keywords = clean.split(/\s+/).filter(w => w.length >= 3 && !skipWords.has(w));

  // Need at least one significant keyword to match
  if (keywords.length === 0) {
    // All words are generic — check the full cleaned name instead
    return text.includes(clean);
  }

  // Check if the most distinctive keyword (longest) appears in the text
  const sorted = keywords.sort((a, b) => b.length - a.length);
  return sorted.some(kw => text.includes(kw));
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

    // DDG result container — try selectors in order, fallback if empty
    let resultEls = document.querySelectorAll('[data-testid="result"]');
    if (!resultEls.length) resultEls = document.querySelectorAll('.react-results--main article');
    if (!resultEls.length) resultEls = document.querySelectorAll('li[data-layout="organic"]');

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
    if (!resultMentionsCompany(r.title, r.snippet, companyName)) continue;

    const parsed = parseLinkedInResult(r.title, r.snippet, companyName);
    if (!parsed) continue;
    // Verify employer matches target company (filters Apollo→JPMorgan mismatches)
    if (!verifyContactCompany(parsed, companyName)) {
      console.log(`[enricher/scraper] 跳过 ${parsed.name} — employer "${parsed.employer}" 不匹配 "${companyName}"`);
      continue;
    }
    contacts.push({
      name: parsed.name,
      title: parsed.title,
      linkedInUrl: r.url.split('?')[0],
      source: 'ddg-serp',
    });
  }

  // If no compliance-specific results, search broader management
  if (contacts.length === 0) {
    const broadQuery = `${clean} director OR head OR chief OR VP site:linkedin.com/in`;
    await delay(SEARCH_DELAY);
    const broadResults = await webSearch(page, broadQuery);

    for (const r of broadResults) {
      if (!r.url.includes('linkedin.com/in/')) continue;
      if (!resultMentionsCompany(r.title, r.snippet, companyName)) continue;

      const parsed = parseLinkedInResult(r.title, r.snippet, companyName);
      if (!parsed) continue;
      if (!verifyContactCompany(parsed, companyName)) {
        console.log(`[enricher/scraper] 跳过 ${parsed.name} — employer "${parsed.employer}" 不匹配 "${companyName}"`);
        continue;
      }
      contacts.push({
        name: parsed.name,
        title: parsed.title,
        linkedInUrl: r.url.split('?')[0],
        source: 'ddg-serp-broad',
      });
    }
  }

  return contacts;
}

/**
 * Parse LinkedIn SERP result to extract name, title, and employer company
 * Common formats:
 *   "Jane Chen - CCO - ABC Pte Ltd | LinkedIn"
 *   "Jane Chen – Chief Compliance Officer – ABC | LinkedIn"
 *   "Jane Chen | LinkedIn" (title in snippet)
 *
 * @param {string} title
 * @param {string} snippet
 * @param {string} companyName
 * @returns {{name: string, title: string, employer: string|null}|null}
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
  let employer = null;
  if (parts.length >= 3) {
    // Format: "Name - Title - Company"
    jobTitle = parts[1].trim();
    employer = parts[2].trim();
  } else if (parts.length === 2) {
    jobTitle = parts[1].trim();
  }

  // If title looks like company name rather than job title, check snippet
  if (!jobTitle || jobTitle.toLowerCase().includes(companyName.toLowerCase().slice(0, 10))) {
    // Extract from snippet
    const snippetTitle = extractTitleFromSnippet(snippet);
    if (snippetTitle) jobTitle = snippetTitle;
  }

  // Try to extract employer from snippet if not found in title
  if (!employer) {
    employer = extractEmployerFromSnippet(snippet);
  }

  // Skip if no useful title found
  if (!jobTitle) jobTitle = 'Unknown Title';

  return { name, title: jobTitle, employer };
}

/**
 * Extract employer company name from SERP snippet
 * LinkedIn snippets often contain "... at CompanyName" or "CompanyName · ..."
 */
function extractEmployerFromSnippet(snippet) {
  if (!snippet) return null;

  // "Title at Company" pattern
  const atMatch = snippet.match(/(?:at|@)\s+([A-Z][^.·,]+?)(?:\s*[.·,]|$)/i);
  if (atMatch) return atMatch[1].trim();

  // "Company · Title" or "Company | Title" pattern
  const dotMatch = snippet.match(/^([A-Z][^·|]+?)\s*[·|]\s*/);
  if (dotMatch) return dotMatch[1].trim();

  return null;
}

/**
 * Verify that a parsed contact's employer matches the target company.
 * Returns true if employer is unknown (benefit of the doubt) or matches.
 */
function verifyContactCompany(parsed, targetCompanyName) {
  if (!parsed.employer) return true; // no employer info — allow through

  const employer = parsed.employer.toLowerCase();
  const target = normalizeCompanyName(targetCompanyName).toLowerCase();

  // Extract significant keywords from target
  const skipWords = new Set(['pte', 'ltd', 'the', 'and', 'of', 'for', 'group', 'holdings', 'services', 'technology', 'global', 'international', 'asia', 'pacific', 'capital', 'management', 'financial', 'digital', 'asset']);
  const keywords = target.split(/\s+/).filter(w => w.length >= 3 && !skipWords.has(w));

  if (keywords.length === 0) {
    return employer.includes(target);
  }

  // Check if employer contains the distinctive keyword
  const sorted = keywords.sort((a, b) => b.length - a.length);
  return sorted.some(kw => employer.includes(kw));
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
 * Scrape LinkedIn company page for public metadata (no login required).
 * Extracts JSON-LD structured data + DOM fallbacks for:
 * - description, industry, followers count, logo URL, website, headcount
 *
 * @param {object} page - Playwright page
 * @param {string} linkedInUrl - LinkedIn company page URL
 * @returns {Promise<object|null>} Metadata object or null on failure
 */
async function scrapeLinkedInCompanyPage(page, linkedInUrl) {
  if (!linkedInUrl) return null;

  try {
    // Normalize URL — ensure we hit the main company page
    const url = linkedInUrl.split('?')[0].replace(/\/+$/, '') + '/';
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Check for login wall
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint') || currentUrl.includes('/authwall')) {
      console.log('[enricher/scraper] LinkedIn authwall — skipping metadata scrape');
      return null;
    }

    // Wait a moment for JS to render
    await delay(2000);

    const metadata = await page.evaluate(() => {
      const result = {
        description: null,
        industry: null,
        followers: null,
        logoUrl: null,
        website: null,
        headcount: null,
        specialties: null,
      };

      // 1. Try JSON-LD (most reliable source)
      const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of jsonLdScripts) {
        try {
          const data = JSON.parse(script.textContent);
          // LinkedIn uses Organization or Corporation type
          if (data['@type'] === 'Organization' || data['@type'] === 'Corporation') {
            result.description = data.description || result.description;
            result.industry = data.industry || result.industry;
            result.website = data.url || result.website;
            result.logoUrl = data.logo?.url || data.logo || result.logoUrl;
            if (data.numberOfEmployees) {
              result.headcount = data.numberOfEmployees.value || data.numberOfEmployees;
            }
          }
        } catch { /* ignore parse errors */ }
      }

      // 2. DOM fallbacks for data not in JSON-LD
      // Followers count — typically in a span near the top
      if (!result.followers) {
        const allText = document.body?.innerText || '';
        const followersMatch = allText.match(/([\d,]+)\s+followers/i);
        if (followersMatch) {
          result.followers = parseInt(followersMatch[1].replace(/,/g, ''), 10);
        }
      }

      // Industry — from meta tag or page text
      if (!result.industry) {
        const metaDesc = document.querySelector('meta[property="og:description"]');
        if (metaDesc?.content) {
          // og:description often contains "Industry · Location · Followers"
          const parts = metaDesc.content.split('·').map(p => p.trim());
          if (parts.length >= 1) result.industry = parts[0];
        }
      }

      // Logo — from og:image
      if (!result.logoUrl) {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (ogImage?.content) result.logoUrl = ogImage.content;
      }

      // Headcount — from page text (e.g., "1,001-5,000 employees")
      if (!result.headcount) {
        const allText = document.body?.innerText || '';
        const empMatch = allText.match(/([\d,]+-[\d,]+)\s+employees/i) || allText.match(/([\d,]+)\s+employees/i);
        if (empMatch) result.headcount = empMatch[1];
      }

      return result;
    });

    // Filter out empty values
    const cleaned = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== null && value !== undefined && value !== '') {
        cleaned[key] = value;
      }
    }

    if (Object.keys(cleaned).length === 0) return null;

    console.log(`[enricher/scraper] LinkedIn metadata: ${Object.keys(cleaned).join(', ')}`);
    return cleaned;
  } catch (err) {
    console.log(`[enricher/scraper] LinkedIn metadata scrape failed: ${err.message}`);
    return null;
  }
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

    // 2. Scrape LinkedIn company page metadata (no login needed)
    let linkedInMeta = null;
    if (linkedInUrl) {
      linkedInMeta = await scrapeLinkedInCompanyPage(page, linkedInUrl);
      await delay(SEARCH_DELAY);
    }

    // 3. Find compliance contacts
    const contacts = await findComplianceContacts(page, company.name);
    console.log(`[enricher/scraper] 找到 ${contacts.length} 个联系人`);
    await delay(SEARCH_DELAY);

    // 4. Scrape company website
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

    // Merge companyInfo: LinkedIn metadata takes priority, then website info
    const companyInfo = {
      description: linkedInMeta?.description || websiteInfo.description || null,
      industry: linkedInMeta?.industry || null,
      followers: linkedInMeta?.followers || null,
      headcount: linkedInMeta?.headcount || null,
      logoUrl: linkedInMeta?.logoUrl || null,
      specialties: linkedInMeta?.specialties || null,
      linkedInUrl,
      teamSize: websiteInfo.teamMembers?.length || 0,
    };

    // Remove null fields for cleaner output
    for (const key of Object.keys(companyInfo)) {
      if (companyInfo[key] === null || companyInfo[key] === undefined) {
        delete companyInfo[key];
      }
    }

    return {
      contacts: uniqueContacts,
      companyInfo,
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
  scrapeLinkedInCompanyPage,
  parseLinkedInResult,
  extractEmployerFromSnippet,
  verifyContactCompany,
  normalizeCompanyName,
  resultMentionsCompany,
  connect,
  webSearch,
};
