import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const DATA_DIR = join(ROOT, 'data');

// MAS FID 基础 URL
const MAS_FID_BASE = 'https://eservices.mas.gov.sg/fid';

// 我们关注的牌照类别
const WATCHED_CATEGORIES = [
  { sector: 'Capital Markets', category: 'Capital Markets Services Licensee' },
  { sector: 'Payments', category: 'Major Payment Institution' },
  { sector: 'Payments', category: 'Standard Payment Institution' },
];

export { ROOT, DATA_DIR, MAS_FID_BASE, WATCHED_CATEGORIES };
