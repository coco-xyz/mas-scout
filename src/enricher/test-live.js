/**
 * 实时测试 — 抓几个真实 MAS 持牌公司的联系人
 */

import { enrichWithBrowser } from './scraper.js';
import { rankContacts } from './index.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Pick a few companies from the real snapshot
const snapshotDir = join(__dirname, '..', '..', 'data', 'snapshots');
import { readdirSync } from 'fs';
const files = readdirSync(snapshotDir).filter(f => f.endsWith('.json')).sort().reverse();
const snapshot = JSON.parse(readFileSync(join(snapshotDir, files[0]), 'utf-8'));

// Pick 3 diverse companies
const testCompanies = [
  snapshot.institutions.find(i => i.name.includes('HASHKEY')),
  snapshot.institutions.find(i => i.name.includes('INDEPENDENT RESERVE')),
  snapshot.institutions.find(i => i.licenseTypes?.includes('Major Payment Institution') && i.website),
].filter(Boolean).slice(0, 3);

// If couldn't find those specific ones, pick random with websites
while (testCompanies.length < 3) {
  const withWebsite = snapshot.institutions.filter(i => i.website && !testCompanies.includes(i));
  const pick = withWebsite[Math.floor(Math.random() * withWebsite.length)];
  if (pick) testCompanies.push(pick);
}

console.log('=== 测试 Enricher ===\n');

for (const company of testCompanies) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`公司: ${company.name}`);
  console.log(`牌照: ${company.licenseTypes?.join(', ')}`);
  console.log(`网站: ${company.website || '无'}`);
  console.log('');

  try {
    const result = await enrichWithBrowser(company);
    const ranked = rankContacts(result.contacts);

    console.log(`LinkedIn 公司页: ${result.linkedInUrl || '未找到'}`);
    console.log(`公司描述: ${result.companyInfo.description?.slice(0, 100) || '无'}`);
    console.log(`联系人 (${ranked.length}):`);
    for (const c of ranked.slice(0, 5)) {
      console.log(`  - ${c.name} | ${c.title} | ${c.linkedInUrl || 'no URL'} [${c.source}]`);
    }
  } catch (err) {
    console.error(`  错误: ${err.message}`);
  }

  console.log('');
}

process.exit(0);
