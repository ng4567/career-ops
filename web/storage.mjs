import { mkdir, readFile, readdir, writeFile, appendFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

// All user data lives in the existing career-ops local file layout. For a
// one-person app this is the source of truth — no database, no blob storage.
// Uploading a new resume overwrites cv.md.
//
// CAREER_OPS_DATA_DIR lets the writable data live outside the code directory
// (e.g. an Azure Files volume at /data in a container) so it survives restarts.
// Defaults to the repo root for local development.
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.CAREER_OPS_DATA_DIR
  ? resolve(process.env.CAREER_OPS_DATA_DIR)
  : ROOT;

export const paths = {
  root: ROOT,
  dataDir: DATA_DIR,
  cv: join(DATA_DIR, 'cv.md'),
  profile: join(DATA_DIR, 'config', 'profile.yml'),
  // Shipped with the repo (always under ROOT, even when data lives elsewhere) so
  // first-time users can see the full schema to customize.
  profileExample: join(ROOT, 'config', 'profile.example.yml'),
  applications: join(DATA_DIR, 'data', 'applications.md'),
  portals: join(DATA_DIR, 'portals.yml'),
  reportsDir: join(DATA_DIR, 'reports'),
  outputDir: join(DATA_DIR, 'output'),
};

const APPLICATIONS_HEADER = `# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
`;

export async function ensureDirs() {
  await mkdir(join(DATA_DIR, 'config'), { recursive: true });
  await mkdir(join(DATA_DIR, 'data'), { recursive: true });
  await mkdir(paths.reportsDir, { recursive: true });
  await mkdir(paths.outputDir, { recursive: true });
}

// ── Resume (cv.md) ──────────────────────────────────────────────────

export async function readCv() {
  if (!existsSync(paths.cv)) return null;
  return readFile(paths.cv, 'utf-8');
}

export async function writeCv(markdown) {
  await writeFile(paths.cv, markdown, 'utf-8');
  return markdown;
}

// ── Profile (config/profile.yml) ────────────────────────────────────

export async function readProfile() {
  if (!existsSync(paths.profile)) return null;
  try {
    return yaml.load(await readFile(paths.profile, 'utf-8')) || null;
  } catch {
    return null;
  }
}

export async function writeProfile({ fullName, email, locations = [], targetRoles = [] }) {
  const cleanLocations = (Array.isArray(locations) ? locations : [locations])
    .map(v => String(v || '').trim())
    .filter(Boolean);
  // Merge into the existing profile (read fresh from disk) so the basic form
  // never destroys the rich fields — archetypes, narrative, compensation, etc.
  const existing = (await readProfile()) || {};
  const profile = {
    ...existing,
    candidate: {
      ...(existing.candidate || {}),
      full_name: fullName || '',
      email: email || '',
      locations: cleanLocations,
      // Joined form kept for compatibility with career-ops modes that read a single location.
      location: cleanLocations.join(', '),
    },
    target_roles: {
      ...(existing.target_roles || {}),
      primary: targetRoles,
    },
  };
  await writeFile(paths.profile, yaml.dump(profile), 'utf-8');
  return profile;
}

// ── Full profile editing (raw YAML) ─────────────────────────────────
// The basic form above only touches a handful of fields. To let users
// customize everything that drives evaluation and scanning (archetypes,
// narrative, superpowers, proof points, compensation), expose the raw YAML.

const MAX_PROFILE_BYTES = 256 * 1024;

export async function readProfileText() {
  if (existsSync(paths.profile)) return readFile(paths.profile, 'utf-8');
  // No saved profile yet — return the shipped example so the editor shows the
  // full schema for the user to fill in, instead of an empty box.
  if (existsSync(paths.profileExample)) return readFile(paths.profileExample, 'utf-8');
  return '';
}

export async function writeProfileText(text) {
  if (typeof text !== 'string') {
    throw badRequest('Profile YAML must be a string');
  }
  if (Buffer.byteLength(text, 'utf-8') > MAX_PROFILE_BYTES) {
    throw badRequest('Profile YAML is too large (max 256KB)');
  }
  let parsed;
  try {
    parsed = yaml.load(text);
  } catch (err) {
    throw badRequest(`Invalid YAML: ${err.message}`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw badRequest('Profile must be a YAML mapping of key: value pairs');
  }
  try {
    JSON.stringify(parsed);
  } catch {
    throw badRequest('Profile YAML contains unsupported structures (e.g. cycles)');
  }
  // Write the text verbatim so comments and formatting survive.
  await writeFile(paths.profile, text, 'utf-8');
  return parsed;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// ── Portals / tracked companies (portals.yml) ───────────────────────

export async function readPortals() {
  if (!existsSync(paths.portals)) return { tracked_companies: [], title_filter: {} };
  try {
    const data = yaml.load(await readFile(paths.portals, 'utf-8')) || {};
    if (!Array.isArray(data.tracked_companies)) data.tracked_companies = [];
    return data;
  } catch {
    return { tracked_companies: [], title_filter: {} };
  }
}

export async function writePortals(portals) {
  await writeFile(paths.portals, yaml.dump(portals), 'utf-8');
  return portals;
}

// ── Reports + tracker ───────────────────────────────────────────────
export async function nextReportNumber() {
  if (!existsSync(paths.reportsDir)) return 1;
  const files = await readdir(paths.reportsDir);
  const nums = files
    .map(f => f.match(/^(\d{3})-/))
    .filter(Boolean)
    .map(m => parseInt(m[1], 10));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function slugify(value) {
  return String(value || 'company')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'company';
}

export async function writeReport({ num, slug, date, content }) {
  const filename = `${String(num).padStart(3, '0')}-${slug}-${date}.md`;
  await writeFile(join(paths.reportsDir, filename), content, 'utf-8');
  return filename;
}

export async function appendApplication({ num, date, company, role, score, pdfName, reportName, note }) {
  if (!existsSync(paths.applications)) {
    await writeFile(paths.applications, APPLICATIONS_HEADER, 'utf-8');
  }
  const scoreCell = score == null ? 'N/A' : `${score}/5`;
  const pdfCell = pdfName ? '✅' : '❌';
  const reportCell = `[${num}](reports/${reportName})`;
  const row = `| ${num} | ${date} | ${escapeCell(company)} | ${escapeCell(role)} | ${scoreCell} | Evaluated | ${pdfCell} | ${reportCell} | ${escapeCell(note || '')} |\n`;
  await appendFile(paths.applications, row, 'utf-8');
}

export async function listApplications() {
  if (!existsSync(paths.applications)) return [];
  const text = await readFile(paths.applications, 'utf-8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 10) continue;
    const num = parseInt(parts[1], 10);
    if (Number.isNaN(num)) continue;
    const reportMatch = parts[8].match(/\(reports\/([^)]+)\)/);
    rows.push({
      num,
      date: parts[2],
      company: parts[3],
      role: parts[4],
      score: parts[5],
      status: parts[6],
      pdf: parts[7],
      reportName: reportMatch ? reportMatch[1] : null,
      notes: parts[9] || '',
    });
  }
  return rows.sort((a, b) => b.num - a.num);
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}
