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
