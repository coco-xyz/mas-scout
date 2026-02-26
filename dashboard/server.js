/**
 * MAS Scout Dashboard — 轻量 HTTP 服务
 * 提供数据 API + 静态页面
 */

import { createServer } from 'http';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const PORT = process.env.DASHBOARD_PORT || 3900;

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

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

function loadAllSnapshots() {
  const dir = join(DATA_DIR, 'snapshots');
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter(f => f.startsWith('snapshot-') && f.endsWith('.json'))
    .sort()
    .reverse()
    .map(f => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      return { filename: f, timestamp: data.timestamp, count: data.count };
    });
}

function loadLatestReport() {
  const dir = join(DATA_DIR, 'reports');
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .reverse();

  if (files.length === 0) return null;
  return readFileSync(join(dir, files[0]), 'utf-8');
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // API routes
  if (path === '/api/institutions') {
    const snapshot = loadLatestSnapshot();
    if (!snapshot) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No snapshot data' }));
    }

    const q = url.searchParams.get('q')?.toLowerCase() || '';
    const license = url.searchParams.get('license') || '';

    let institutions = snapshot.institutions;

    if (q) {
      institutions = institutions.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.address?.toLowerCase().includes(q) ||
        i.activities?.some(a => a.toLowerCase().includes(q))
      );
    }

    if (license) {
      institutions = institutions.filter(i =>
        i.licenseTypes?.some(lt => lt.includes(license))
      );
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      timestamp: snapshot.timestamp,
      total: snapshot.count,
      filtered: institutions.length,
      institutions,
    }));
  }

  if (path === '/api/stats') {
    const snapshot = loadLatestSnapshot();
    if (!snapshot) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No data' }));
    }

    const types = {};
    const sectors = {};
    for (const inst of snapshot.institutions) {
      for (const lt of inst.licenseTypes || []) {
        types[lt] = (types[lt] || 0) + 1;
      }
      if (inst.sector) {
        sectors[inst.sector] = (sectors[inst.sector] || 0) + 1;
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      timestamp: snapshot.timestamp,
      total: snapshot.count,
      licenseTypes: types,
      sectors,
      snapshots: loadAllSnapshots(),
    }));
  }

  if (path === '/api/report') {
    const report = loadLatestReport();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ report: report || 'No report available.' }));
  }

  // Enrichment pipeline — mock data for now
  if (path === '/api/enrichment') {
    const snapshot = loadLatestSnapshot();
    if (!snapshot) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No data' }));
    }

    const statuses = ['enriched', 'pending', 'failed', 'skipped'];
    const titles = ['Chief Compliance Officer', 'MLRO', 'Head of Compliance', 'VP Compliance', 'Compliance Director'];
    const enrichment = snapshot.institutions.slice(0, 80).map((inst, i) => {
      const status = statuses[i % 7 === 0 ? 2 : i % 5 === 0 ? 3 : i < 30 ? 0 : 1];
      const contacts = status === 'enriched' ? [
        { name: `Contact ${i + 1}A`, title: titles[i % titles.length], email: `contact${i}a@example.com`, linkedInUrl: `https://linkedin.com/in/contact${i}a` },
        ...(i % 3 === 0 ? [{ name: `Contact ${i + 1}B`, title: titles[(i + 2) % titles.length], email: `contact${i}b@example.com`, linkedInUrl: `https://linkedin.com/in/contact${i}b` }] : []),
      ] : [];

      return {
        company: inst.name,
        licenseTypes: inst.licenseTypes,
        status,
        contacts,
        companyInfo: status === 'enriched' ? {
          headcount: 20 + (i * 7) % 500,
          website: inst.website || null,
        } : null,
        enrichedAt: status === 'enriched' ? new Date(Date.now() - i * 3600000).toISOString() : null,
      };
    });

    const counts = { enriched: 0, pending: 0, failed: 0, skipped: 0 };
    for (const e of enrichment) counts[e.status]++;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ enrichment, counts, total: enrichment.length }));
  }

  // Outreach pipeline — mock data for now
  if (path === '/api/outreach') {
    const channels = ['email', 'linkedin_connect', 'linkedin_message', 'email'];
    const days = [1, 3, 7, 10];
    const stepStatuses = ['sent', 'ready', 'pending_review', 'draft'];

    const prospects = [];
    for (let i = 0; i < 25; i++) {
      const confidence = 0.4 + (i * 0.025);
      const requiresReview = confidence < 0.7;
      const sequenceProgress = i < 8 ? 4 : i < 15 ? 2 : 1;

      prospects.push({
        id: i + 1,
        contact: { name: `Contact ${i + 1}`, title: ['CCO', 'MLRO', 'Head of Compliance', 'VP Compliance'][i % 4], email: `contact${i + 1}@example.com` },
        company: `Company ${String.fromCharCode(65 + (i % 26))} Pte. Ltd.`,
        licenseType: ['Capital Markets Services Licensee', 'Major Payment Institution', 'Standard Payment Institution'][i % 3],
        confidence: Math.min(confidence, 1),
        requiresReview,
        sequence: channels.map((ch, si) => ({
          channel: ch,
          day: days[si],
          status: si < sequenceProgress ? (requiresReview ? 'pending_review' : stepStatuses[si % stepStatuses.length]) : 'draft',
        })),
        createdAt: new Date(Date.now() - i * 86400000).toISOString(),
      });
    }

    const summary = { total: prospects.length, sent: 0, ready: 0, pending_review: 0, draft: 0 };
    for (const p of prospects) {
      for (const s of p.sequence) summary[s.status] = (summary[s.status] || 0) + 1;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ prospects, summary }));
  }

  // Static files
  let filePath = path === '/' ? '/index.html' : path;
  filePath = join(__dirname, filePath);

  if (!existsSync(filePath)) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';

  res.writeHead(200, { 'Content-Type': mime });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  console.log(`[dashboard] MAS Scout Dashboard running on http://localhost:${PORT}`);
});
