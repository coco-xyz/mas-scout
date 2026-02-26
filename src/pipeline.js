#!/usr/bin/env node

/**
 * MAS Scout Pipeline Runner
 *
 * Orchestrates: Enrichment → Outreach sequence generation
 * Reads from latest watcher snapshot, saves results to data/ for dashboard consumption.
 *
 * Usage:
 *   node src/pipeline.js                        # enrich new institutions from latest diff
 *   node src/pipeline.js --all                  # enrich all institutions (full run)
 *   node src/pipeline.js --all --limit 20       # enrich first 20 institutions
 *   node src/pipeline.js --all --retry           # retry no_contacts companies
 *   node src/pipeline.js --all --force           # re-enrich all (even already enriched)
 *   node src/pipeline.js --company "Name"       # enrich a single company
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { enrich } from './enricher/index.js';
import { createSequence } from './outreach/index.js';
import { DATA_DIR } from './shared/config.js';

const ENRICHMENT_FILE = join(DATA_DIR, 'enrichment.json');
const OUTREACH_FILE = join(DATA_DIR, 'outreach.json');

// ── Snapshot helpers ──

function loadLatestSnapshot() {
  const dir = join(DATA_DIR, 'snapshots');
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  return JSON.parse(readFileSync(join(dir, files[0]), 'utf-8'));
}

function loadPreviousSnapshot() {
  const dir = join(DATA_DIR, 'snapshots');
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length < 2) return null;
  return JSON.parse(readFileSync(join(dir, files[1]), 'utf-8'));
}

// ── Persistence ──

function loadExisting(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function save(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2));
}

// ── Pipeline ──

async function enrichCompany(inst) {
  const startTime = Date.now();
  try {
    const result = await enrich({
      name: inst.name,
      website: inst.website || '',
      address: inst.address || '',
      licenseTypes: inst.licenseTypes || [],
    });

    return {
      company: inst.name,
      licenseTypes: inst.licenseTypes || [],
      status: result.contacts.length > 0 ? 'enriched' : 'no_contacts',
      contacts: result.contacts,
      companyInfo: result.companyInfo,
      enrichedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    console.error(`[pipeline] enrich failed for ${inst.name}: ${err.message}`);
    return {
      company: inst.name,
      licenseTypes: inst.licenseTypes || [],
      status: 'failed',
      contacts: [],
      companyInfo: null,
      enrichedAt: new Date().toISOString(),
      error: err.message,
      durationMs: Date.now() - startTime,
    };
  }
}

async function generateOutreach(enrichmentResult) {
  if (enrichmentResult.status !== 'enriched' || enrichmentResult.contacts.length === 0) {
    return null;
  }

  const contact = enrichmentResult.contacts[0]; // top-ranked contact
  const prospect = {
    company: {
      name: enrichmentResult.company,
      website: enrichmentResult.companyInfo?.linkedInUrl || '',
      headcount: enrichmentResult.companyInfo?.teamSize || 0,
    },
    contact: {
      name: contact.name,
      title: contact.title,
      email: contact.email || '',
    },
    licenseType: (enrichmentResult.licenseTypes || [])[0] || 'Unknown',
  };

  try {
    const result = await createSequence(prospect);
    return {
      contact: prospect.contact,
      company: enrichmentResult.company,
      licenseType: prospect.licenseType,
      confidence: result.confidence,
      requiresReview: result.requiresReview,
      sequence: result.sequence,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error(`[pipeline] outreach failed for ${enrichmentResult.company}: ${err.message}`);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const runAll = args.includes('--all');
  const singleCompany = args.includes('--company') ? args[args.indexOf('--company') + 1] : null;
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 0;

  console.log('[pipeline] MAS Scout Pipeline starting');

  const snapshot = loadLatestSnapshot();
  if (!snapshot) {
    console.error('[pipeline] No snapshot data — run watcher first');
    process.exit(1);
  }

  // Determine which companies to enrich
  let targets;
  if (singleCompany) {
    targets = snapshot.institutions.filter(i =>
      i.name.toLowerCase().includes(singleCompany.toLowerCase())
    );
    console.log(`[pipeline] Single company mode: ${targets.length} matches for "${singleCompany}"`);
  } else if (runAll) {
    targets = snapshot.institutions;
    console.log(`[pipeline] Full run: ${targets.length} institutions`);
  } else {
    // Diff mode: only new institutions
    const prev = loadPreviousSnapshot();
    if (!prev) {
      targets = snapshot.institutions;
      console.log(`[pipeline] First run (no previous snapshot): ${targets.length} institutions`);
    } else {
      const prevNames = new Set(prev.institutions.map(i => i.name));
      targets = snapshot.institutions.filter(i => !prevNames.has(i.name));
      console.log(`[pipeline] Diff mode: ${targets.length} new institutions`);
    }
  }

  // Apply limit
  if (limit > 0 && targets.length > limit) {
    console.log(`[pipeline] Limiting to ${limit} of ${targets.length}`);
    targets = targets.slice(0, limit);
  }

  if (targets.length === 0) {
    console.log('[pipeline] No new institutions to process');
    process.exit(0);
  }

  // Load existing results to append
  const existingEnrichment = loadExisting(ENRICHMENT_FILE) || { lastRun: null, results: [] };
  const existingOutreach = loadExisting(OUTREACH_FILE) || { lastRun: null, prospects: [] };

  // Index existing by company name for dedup
  const enrichedMap = new Map(existingEnrichment.results.map(r => [r.company, r]));
  const outreachMap = new Map(existingOutreach.prospects.map(p => [p.company, p]));

  console.log(`[pipeline] Existing: ${enrichedMap.size} enrichment, ${outreachMap.size} outreach records`);
  console.log(`[pipeline] Processing ${targets.length} companies...\n`);

  let enriched = 0, failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const inst = targets[i];

    // Skip already-processed companies (unless --force flag)
    const existing = enrichedMap.get(inst.name);
    if (existing && !args.includes('--force')) {
      if (existing.status === 'enriched') {
        console.log(`[pipeline] [${i + 1}/${targets.length}] Skipping (already enriched): ${inst.name}`);
        continue;
      }
      if (existing.status === 'no_contacts' && !args.includes('--retry')) {
        console.log(`[pipeline] [${i + 1}/${targets.length}] Skipping (no_contacts, use --retry): ${inst.name}`);
        continue;
      }
    }

    console.log(`[pipeline] [${i + 1}/${targets.length}] Enriching: ${inst.name}`);

    // Enrich
    const enrichResult = await enrichCompany(inst);
    enrichedMap.set(enrichResult.company, enrichResult);

    if (enrichResult.status === 'enriched') {
      enriched++;
      console.log(`  → ${enrichResult.contacts.length} contacts found (${enrichResult.durationMs}ms)`);

      // Generate outreach sequence
      const outreachResult = await generateOutreach(enrichResult);
      if (outreachResult) {
        outreachMap.set(outreachResult.company, outreachResult);
        console.log(`  → Outreach sequence created (confidence: ${outreachResult.confidence.toFixed(2)})`);
      }
    } else {
      failed++;
      console.log(`  → ${enrichResult.status}${enrichResult.error ? ': ' + enrichResult.error : ''}`);
    }

    // Save after each company (crash-safe)
    existingEnrichment.lastRun = new Date().toISOString();
    existingEnrichment.results = Array.from(enrichedMap.values());
    save(ENRICHMENT_FILE, existingEnrichment);

    existingOutreach.lastRun = new Date().toISOString();
    existingOutreach.prospects = Array.from(outreachMap.values());
    save(OUTREACH_FILE, existingOutreach);
  }

  // Cross-company dedup: flag contacts that appear in multiple companies
  const contactIndex = new Map(); // linkedInUrl or name+title → [company names]
  for (const result of enrichedMap.values()) {
    if (result.status !== 'enriched') continue;
    for (const contact of result.contacts) {
      const key = contact.linkedInUrl || `${contact.name.toLowerCase()}|${contact.title.toLowerCase()}`;
      if (!contactIndex.has(key)) contactIndex.set(key, []);
      contactIndex.get(key).push(result.company);
    }
  }

  let dupCount = 0;
  for (const [key, companies] of contactIndex) {
    if (companies.length <= 1) continue;
    dupCount++;
    console.log(`[pipeline] 跨公司重复: "${key}" 出现在 ${companies.length} 家: ${companies.join(', ')}`);
    // Mark duplicates as low_confidence (keep the first occurrence as-is)
    const keepCompany = companies[0];
    for (const companyName of companies.slice(1)) {
      const result = enrichedMap.get(companyName);
      if (!result) continue;
      for (const contact of result.contacts) {
        const contactKey = contact.linkedInUrl || `${contact.name.toLowerCase()}|${contact.title.toLowerCase()}`;
        if (contactKey === key) {
          contact.lowConfidence = true;
          contact.duplicateOf = keepCompany;
        }
      }
    }
  }

  if (dupCount > 0) {
    console.log(`[pipeline] 标记 ${dupCount} 组跨公司重复联系人`);
    // Re-save with dedup flags
    existingEnrichment.results = Array.from(enrichedMap.values());
    save(ENRICHMENT_FILE, existingEnrichment);
  }

  console.log(`\n[pipeline] Done. Enriched: ${enriched}, Failed: ${failed}`);
  console.log(`[pipeline] Results saved to:\n  ${ENRICHMENT_FILE}\n  ${OUTREACH_FILE}`);
}

main().catch(err => {
  console.error('[pipeline] Fatal error:', err);
  process.exit(1);
});
