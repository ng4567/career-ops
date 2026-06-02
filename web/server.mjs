#!/usr/bin/env node

import crypto from 'crypto';
import { existsSync } from 'fs';
import { join, normalize } from 'path';
import express from 'express';
import multer from 'multer';
import { config } from './config.mjs';
import { evaluateJob } from './evaluator.mjs';
import { scanPortals } from './scanner.mjs';
import { generateResumePdf } from './pdf.mjs';
import {
  paths,
  ensureDirs,
  readCv,
  writeCv,
  readProfile,
  writeProfile,
  readProfileText,
  writeProfileText,
  readPortals,
  writePortals,
  nextReportNumber,
  slugify,
  writeReport,
  appendApplication,
  listApplications,
} from './storage.mjs';
import { detectAts } from './scanner.mjs';
import { suggestCompanies, validateUrls } from './company-finder.mjs';
import { discoverJobs } from './web-discovery.mjs';
import { themeFonts, themeStyles } from './themes.mjs';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const app = express();
app.set('etag', false);

// Single-user local app: never let the browser cache the page or API responses,
// so code and data are always fresh after a restart.
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/login', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Me — Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Plus+Jakarta+Sans:wght@800&display=swap" rel="stylesheet">
<style>
* { box-sizing: border-box; }
body {
  font-family: 'Inter', system-ui, -apple-system, Segoe UI, Arial, sans-serif;
  margin: 0; min-height: 100vh; display: grid; place-items: center; color: #1e1b3a;
  background:
    radial-gradient(1000px 500px at 100% -10%, #ddd6fe 0%, transparent 55%),
    radial-gradient(900px 450px at -10% 0%, #fbcfe8 0%, transparent 50%),
    linear-gradient(180deg, #eef2ff 0%, #faf5ff 100%);
}
.card {
  background: #fff; border: 1px solid #e5e7f0; border-radius: 18px;
  padding: 34px 32px; width: 340px; text-align: center;
  box-shadow: 0 10px 30px -12px rgba(31,27,58,.25);
}
.logo {
  width: 52px; height: 52px; border-radius: 14px; margin: 0 auto 14px;
  display: grid; place-items: center; font-size: 27px; color: #fff;
  background: linear-gradient(135deg, #6d28d9 0%, #ec4899 100%);
}
.name {
  font-family: 'Plus Jakarta Sans', sans-serif; font-weight: 800; font-size: 26px; margin: 0 0 4px;
  background: linear-gradient(135deg, #6d28d9 0%, #ec4899 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.tag { color: #6b7280; font-size: 13px; margin: 0 0 20px; }
input {
  width: 100%; padding: 11px 13px; font: inherit; border: 1px solid #e5e7f0;
  border-radius: 11px; background: #fbfbfe; margin-bottom: 12px;
}
input:focus { outline: none; border-color: #6d28d9; box-shadow: 0 0 0 4px rgba(109,40,217,.25); background:#fff; }
button {
  width: 100%; padding: 11px 18px; font: inherit; font-weight: 600; color: #fff; cursor: pointer;
  border: none; border-radius: 11px;
  background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%);
}
button:hover { filter: brightness(1.06); }
</style>
</head>
<body>
<form class="card" method="post" action="/login">
  <div class="logo">💼</div>
  <p class="name">Job Me</p>
  <p class="tag">Sign in to your job-search co-pilot</p>
  <input name="password" type="password" placeholder="Password" autofocus>
  <button type="submit">Sign in</button>
</form>
</body>
</html>`);
});

app.post('/login', (req, res) => {
  if (!config.sessionPassword || req.body.password !== config.sessionPassword) {
    res.status(401).type('text').send('Unauthorized');
    return;
  }
  res.setHeader('Set-Cookie', `career_ops_session=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/`);
  res.redirect('/');
});

app.post('/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'career_ops_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.redirect('/login');
});

app.use((req, res, next) => {
  if (!config.sessionPassword) return next();
  if (req.path === '/login') return next();
  const provided = req.header('x-career-ops-password');
  if (provided === config.sessionPassword || cookieValue(req, 'career_ops_session') === sessionToken()) return next();
  // API calls must get a clean 401 (a browser fetch sends Accept: */*, which
  // would otherwise be treated as an HTML navigation and redirected to /login).
  if (req.path.startsWith('/api/')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.redirect('/login');
});

app.get('/', (_req, res) => {
  res.type('html').send(renderHomePage());
});

app.get('/api/config/status', (_req, res) => {
  res.json({
    storage: 'local-files',
    azureOpenAI: Boolean(config.azure.openAiEndpoint && config.azure.openAiDeployment),
    authMode: config.azure.openAiApiKey ? 'api-key' : 'entra-keyless',
    authEnabled: Boolean(config.sessionPassword),
  });
});

app.get('/api/profile', async (_req, res, next) => {
  try {
    res.json(await readProfile());
  } catch (err) {
    next(err);
  }
});

app.put('/api/profile', async (req, res, next) => {
  try {
    const { fullName, email, locations, location, targetRoles = [] } = req.body;
    // Accept an array of locations, or fall back to a single legacy location field.
    const locs = Array.isArray(locations) ? locations : (location ? [location] : []);
    const profile = await writeProfile({ fullName, email, locations: locs, targetRoles });
    res.json(profile);
  } catch (err) {
    next(err);
  }
});

// Full profile as raw YAML — exposes every field that drives evaluation and
// scanning (archetypes, narrative, superpowers, proof points, compensation).
app.get('/api/profile/raw', async (_req, res, next) => {
  try {
    res.json({ yaml: await readProfileText() });
  } catch (err) {
    next(err);
  }
});

app.put('/api/profile/raw', async (req, res, next) => {
  try {
    const profile = await writeProfileText(req.body?.yaml);
    res.json({ ok: true, profile });
  } catch (err) {
    if (err.status === 400) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

app.post('/api/resumes', upload.single('resume'), async (req, res, next) => {
  try {
    const file = req.file;
    const markdown = req.body?.canonicalMarkdown
      || (file && isTextLike(file.mimetype) ? file.buffer.toString('utf-8') : '');

    if (!markdown.trim()) {
      res.status(400).json({ error: 'Provide canonicalMarkdown or upload a text/markdown resume. PDF/DOCX parsing is not implemented yet.' });
      return;
    }

    // A new upload overwrites cv.md — there is only one resume for one person.
    await writeCv(markdown);
    res.status(201).json({ ok: true, length: markdown.length });
  } catch (err) {
    next(err);
  }
});

app.get('/api/resumes/current', async (_req, res, next) => {
  try {
    const markdown = await readCv();
    res.json(markdown == null ? null : { canonicalMarkdown: markdown });
  } catch (err) {
    next(err);
  }
});

app.post('/api/evaluations', async (req, res, next) => {
  try {
    const { company, title, url, description } = req.body;
    if (!title || !description) {
      res.status(400).json({ error: 'title and description are required' });
      return;
    }

    const [profile, resumeMarkdown] = await Promise.all([readProfile(), readCv()]);
    if (!profile) {
      res.status(400).json({ error: 'Save a profile before evaluating jobs' });
      return;
    }
    if (!resumeMarkdown) {
      res.status(400).json({ error: 'Upload a resume before evaluating jobs' });
      return;
    }

    const evaluation = await evaluateJob({
      profile,
      resumeMarkdown,
      job: { company, title, url, description },
    });

    const date = new Date().toISOString().slice(0, 10);
    const num = await nextReportNumber();
    const slug = slugify(company || title);
    const reportName = await writeReport({ num, slug, date, content: evaluation.reportMarkdown });

    const pdfName = `cv-${slug}-${date}.pdf`;
    await generateResumePdf({ resumeMarkdown, jobTitle: title, company, outputName: pdfName });

    await appendApplication({
      num,
      date,
      company: company || 'Unknown',
      role: title,
      score: evaluation.score,
      pdfName,
      reportName,
      note: url || '',
    });

    res.status(201).json({
      num,
      date,
      company: company || 'Unknown',
      role: title,
      score: evaluation.score,
      reportName,
      pdfName,
    });
  } catch (err) {
    next(err);
  }
});

app.get('/api/evaluations', async (_req, res, next) => {
  try {
    res.json(await listApplications());
  } catch (err) {
    next(err);
  }
});

// ── Tracked companies (portals.yml management) ───────────────────────────────

function companyView(entry) {
  return {
    name: entry.name,
    careers_url: entry.careers_url,
    ats: detectAts(entry)?.ats || null,
    enabled: entry.enabled !== false,
  };
}

app.get('/api/companies', async (_req, res, next) => {
  try {
    const portals = await readPortals();
    res.json(portals.tracked_companies.map(companyView));
  } catch (err) {
    next(err);
  }
});

// Add companies from pasted careers URLs (validated against the live ATS board).
app.post('/api/companies', async (req, res, next) => {
  try {
    const urls = req.body?.urls || (req.body?.url ? [req.body.url] : []);
    if (!Array.isArray(urls) || urls.length === 0) {
      res.status(400).json({ error: 'Provide one or more careers URLs' });
      return;
    }
    const { added, failed } = await validateUrls(urls);
    const portals = await readPortals();
    const existing = new Set(portals.tracked_companies.map(c => c.careers_url));
    const newlyAdded = [];
    for (const entry of added) {
      if (existing.has(entry.careers_url)) continue;
      existing.add(entry.careers_url);
      const { ats, openings, ...stored } = entry;
      portals.tracked_companies.push(stored);
      newlyAdded.push(entry);
    }
    await writePortals(portals);
    res.json({ added: newlyAdded.map(companyView), openings: newlyAdded.map(e => e.openings), failed });
  } catch (err) {
    next(err);
  }
});

app.post('/api/companies/remove', async (req, res, next) => {
  try {
    const { careers_url, name } = req.body || {};
    const portals = await readPortals();
    portals.tracked_companies = portals.tracked_companies.filter(c =>
      careers_url ? c.careers_url !== careers_url : c.name !== name);
    await writePortals(portals);
    res.json({ ok: true, remaining: portals.tracked_companies.length });
  } catch (err) {
    next(err);
  }
});

// Suggest companies for the candidate's resume + target roles, validated live.
app.post('/api/companies/suggest', async (_req, res, next) => {
  try {
    const [cv, profile] = await Promise.all([readCv(), readProfile()]);
    const targetRoles = profile?.target_roles?.primary || [];
    if (!cv && targetRoles.length === 0) {
      res.status(400).json({ error: 'Save a resume or target roles first so suggestions can match your field' });
      return;
    }
    const result = await suggestCompanies({ cv, targetRoles });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Derive scan filters from the saved profile so discovered jobs match the
// candidate's target roles and locations instead of generic portal keywords.
async function scanFiltersFromProfile() {
  const profile = await readProfile();
  const primary = profile?.target_roles?.primary || [];
  // Include archetype names as fallback role keywords so customizing the richer
  // profile (not just the basic target roles) actually broadens the scan.
  const archetypes = (profile?.target_roles?.archetypes || [])
    .map(a => (typeof a === 'string' ? a : a?.name))
    .filter(Boolean);
  const roleKeywords = [...new Set([...primary, ...archetypes].map(s => String(s).trim()).filter(Boolean))];
  const locations = profile?.candidate?.locations
    || (profile?.candidate?.location ? [profile.candidate.location] : []);
  return { roleKeywords, locations };
}

app.get('/api/scan', async (req, res, next) => {
  try {
    const company = typeof req.query.company === 'string' ? req.query.company : undefined;
    const { roleKeywords, locations } = await scanFiltersFromProfile();
    res.json(await scanPortals({ company, roleKeywords, locations }));
  } catch (err) {
    if (err.code === 'NO_PORTALS') {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

app.get('/api/scan/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const company = typeof req.query.company === 'string' ? req.query.company : undefined;

  try {
    const { roleKeywords, locations } = await scanFiltersFromProfile();
    const result = await scanPortals({ company, onProgress: send, roleKeywords, locations });
    send({ type: 'done', ...result });
  } catch (err) {
    send({ type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

app.get('/api/discover/stream', async (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  let closed = false;
  res.on('close', () => { closed = true; });

  try {
    const result = await discoverJobs({ onProgress: (e) => { if (!closed) send(e); } });
    send({ type: 'done', ...result });
  } catch (err) {
    send({ type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

app.get('/api/files/report/:name', (req, res) => {
  serveFile(res, paths.reportsDir, req.params.name, 'text/markdown; charset=utf-8');
});

app.get('/api/files/pdf/:name', (req, res) => {
  serveFile(res, paths.outputDir, req.params.name, 'application/pdf');
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

await ensureDirs();

app.listen(config.port, () => {
  console.log(`career-ops web listening on port ${config.port}`);
});

function serveFile(res, baseDir, name, contentType) {
  const safe = normalize(name).replace(/^([.][.][/\\])+/, '');
  const filePath = join(baseDir, safe);
  if (!filePath.startsWith(baseDir) || !existsSync(filePath)) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.type(contentType).sendFile(filePath);
}

function isTextLike(contentType = '') {
  return contentType.startsWith('text/') || contentType.includes('markdown') || contentType.includes('json');
}

function sessionToken() {
  return crypto.createHash('sha256').update(config.sessionPassword || '').digest('hex');
}

function cookieValue(req, name) {
  const cookie = req.header('cookie');
  if (!cookie) return null;
  const pairs = cookie.split(';').map(part => part.trim().split('='));
  const found = pairs.find(([key]) => key === name);
  return found ? found.slice(1).join('=') : null;
}

function renderHomePage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Job Me</title>
${themeFonts()}
<style>
${themeStyles()}
</style>
</head>
<body>
<div class="wrap">
<header class="hero">
  <div class="brand">
    <span class="logo">💼</span>
    <span class="name">Job Me</span>
  </div>
  <p class="tagline">Your personal job-search co-pilot — profile, discovery, and AI evaluations in one place.</p>
</header>

<section>
  <h2><span class="badge">👤</span> Profile &amp; Resume</h2>
  <p class="sub">Everything about you. Edit the boxes below and save — your details are stored locally in <code>cv.md</code> and <code>config/profile.yml</code>.</p>

  <div class="block">
    <p class="block-title">Basics</p>
    <div class="row">
      <div><label>Full name</label><input id="fullName"></div>
      <div><label>Email</label><input id="email"></div>
    </div>
    <label>Locations <span class="muted">(one per line — filters scanned jobs; add "Remote" to include remote roles)</span></label>
    <textarea id="locations" placeholder="New York City&#10;Remote"></textarea>
    <label>Target roles <span class="muted">(one per line — matched against job <strong>titles</strong>, e.g. "Teacher", "Attorney", "Finance Analyst")</span></label>
    <textarea id="targetRoles" placeholder="Teacher&#10;Immigration Attorney&#10;Finance Analyst"></textarea>
    <button onclick="saveProfile()">Save profile</button>
    <p class="sub" style="margin-top:8px">Quick save preserves your full profile below, but normalizes YAML comments/formatting.</p>
  </div>

  <div class="block">
    <p class="block-title">Full profile (advanced)</p>
    <p class="sub">The complete <code>config/profile.yml</code> — archetypes, narrative, superpowers, proof points, compensation, location policy. <strong>These fields drive the AI evaluation and the job scan.</strong> Edit the YAML and save. (Archetype names are also used as fallback scan keywords.)</p>
    <label>profile.yml</label>
    <textarea id="profileYaml" spellcheck="false" style="min-height:340px; font-family: ui-monospace, 'SFMono-Regular', Consolas, monospace; font-size: 12.5px;" placeholder="candidate:&#10;  full_name: ..."></textarea>
    <div class="btn-row">
      <button onclick="saveFullProfile()">Save full profile</button>
      <button class="ghost" onclick="loadFullProfile()">Reload from disk</button>
    </div>
    <div id="profileYamlStatus" class="muted"></div>
  </div>

  <div class="block">
    <p class="block-title">Resume</p>
    <p class="sub">Paste your canonical resume as markdown. Saving overwrites <code>cv.md</code>.</p>
    <label>Resume markdown</label>
    <textarea id="resumeMarkdown" placeholder="# Your Name&#10;&#10;## Experience"></textarea>
    <button onclick="saveResume()">Save resume</button>
  </div>
</section>

<section>
  <h2><span class="badge">🔎</span> Find Jobs</h2>
  <p class="sub">Track employers, scan their boards, and search the open web — all in one place. The scanner reads <strong>Greenhouse, Ashby &amp; Lever</strong> boards.</p>

  <div class="block">
    <p class="block-title">Companies to track</p>
    <p class="sub">Paste careers-page URLs, or let the assistant suggest employers from your resume (each is checked against the live board before it appears).</p>
    <label>Add by careers URL <span class="muted">(one per line — e.g. https://jobs.lever.co/acme)</span></label>
    <textarea id="companyUrls" placeholder="https://job-boards.greenhouse.io/acme&#10;https://jobs.ashbyhq.com/acme"></textarea>
    <div class="btn-row">
      <button onclick="addCompanies()">Add companies</button>
      <button id="suggestButton" class="ghost" onclick="suggestCompanies()">Suggest from my resume</button>
    </div>
    <div id="companyStatus" class="muted"></div>
    <div id="suggestResults"></div>
  </div>

  <div class="block">
    <p class="block-title">Tracked companies</p>
    <div id="companyList" class="muted">None yet.</div>
  </div>

  <div class="block">
    <p class="block-title">Scan tracked portals</p>
    <p class="sub">Scans your tracked companies for postings matching your target roles and locations.</p>
    <label>Filter by company <span class="muted">(optional)</span></label><input id="scanCompany" placeholder="e.g. Anthropic">
    <div class="btn-row"><button id="scanButton" onclick="scanPortals()">Scan portals</button></div>
    <div id="scanStatus" class="muted"></div>
    <div id="scanResults"></div>
  </div>

  <div class="block">
    <p class="block-title">Search the web</p>
    <p class="sub">Goes beyond tracked companies and searches the open web for live postings. Slower (~2-4 min) but finds employers the portal scan can't reach.</p>
    <div class="btn-row"><button id="discoverButton" onclick="discoverWeb()">Search the web</button></div>
    <div id="discoverStatus" class="muted"></div>
    <div id="discoverResults"></div>
  </div>
</section>

<section>
  <h2><span class="badge">🎯</span> Evaluate &amp; Results</h2>
  <p class="sub">Paste any posting — Workday, LinkedIn, a company page, anywhere — to get a tailored CV/PDF, an AI report, and a tracker entry. Past evaluations show below.</p>

  <div class="block">
    <p class="block-title">Evaluate a job</p>
    <div class="row">
      <div><label>Company</label><input id="company"></div>
      <div><label>Title</label><input id="title"></div>
    </div>
    <label>URL</label><input id="url">
    <label>Job description</label>
    <textarea id="description" placeholder="Paste the job description here"></textarea>
    <div class="btn-row"><button onclick="evaluateJob()">Evaluate &amp; generate PDF</button></div>
  </div>

  <div class="block">
    <p class="block-title">Results</p>
    <div class="btn-row">
      <button class="ghost" onclick="loadEvaluations()">Refresh evaluations</button>
      <button class="ghost" onclick="loadProfile()">Load saved profile</button>
    </div>
    <pre id="output">Ready.</pre>
  </div>
</section>

<p class="foot">Single-user app · data stored locally in career-ops files (cv.md, config/profile.yml, reports/, data/applications.md, output/).</p>
</div>

<script>
async function request(path, options = {}) {
  const response = await fetch(path, options);
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(typeof body === 'string' ? body : body.error || response.statusText);
  return body;
}

function show(value) {
  document.getElementById('output').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

async function loadProfile() {
  try {
    const profile = await request('/api/profile');
    if (profile && profile.candidate) {
      document.getElementById('fullName').value = profile.candidate.full_name || '';
      document.getElementById('email').value = profile.candidate.email || '';
      const locs = profile.candidate.locations || (profile.candidate.location ? [profile.candidate.location] : []);
      document.getElementById('locations').value = locs.join('\\n');
      document.getElementById('targetRoles').value = (profile.target_roles && profile.target_roles.primary || []).join('\\n');
    }
    show(profile);
  } catch (err) {
    show(err.message);
  }
}

async function saveProfile() {
  try {
    const targetRoles = document.getElementById('targetRoles').value.split('\\n').map(v => v.trim()).filter(Boolean);
    const locations = document.getElementById('locations').value.split('\\n').map(v => v.trim()).filter(Boolean);
    const profile = await request('/api/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: document.getElementById('fullName').value,
        email: document.getElementById('email').value,
        locations,
        targetRoles,
      }),
    });
    show(profile);
  } catch (err) {
    show(err.message);
  }
}

async function loadFullProfile() {
  const status = document.getElementById('profileYamlStatus');
  try {
    const res = await request('/api/profile/raw');
    document.getElementById('profileYaml').value = (res && res.yaml) || '';
    status.textContent = 'Loaded config/profile.yml.';
  } catch (err) {
    status.textContent = err.message;
  }
}

async function saveFullProfile() {
  const status = document.getElementById('profileYamlStatus');
  status.textContent = 'Saving...';
  try {
    await request('/api/profile/raw', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml: document.getElementById('profileYaml').value }),
    });
    status.textContent = 'Saved. Your full profile now drives evaluations and scans.';
    await loadProfile();
  } catch (err) {
    status.textContent = 'Not saved — ' + err.message;
  }
}

async function saveResume() {  try {
    const form = new FormData();
    form.append('canonicalMarkdown', document.getElementById('resumeMarkdown').value);
    const result = await request('/api/resumes', { method: 'POST', body: form });
    show(result);
  } catch (err) {
    show(err.message);
  }
}

async function evaluateJob() {
  try {
    show('Evaluating. This can take a while...');
    const result = await request('/api/evaluations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company: document.getElementById('company').value,
        title: document.getElementById('title').value,
        url: document.getElementById('url').value,
        description: document.getElementById('description').value,
      }),
    });
    show(result);
  } catch (err) {
    show(err.message);
  }
}

async function loadCurrentResume() {
  try {
    const current = await request('/api/resumes/current');
    if (current && current.canonicalMarkdown) {
      document.getElementById('resumeMarkdown').value = current.canonicalMarkdown;
    }
  } catch (err) {
    /* no saved resume yet — leave the field empty */
  }
}

async function init() {
  await loadProfile();
  await loadFullProfile();
  await loadCurrentResume();
  await loadCompanies();
  show('Loaded saved profile, resume and tracked companies (if any).');
}

window.addEventListener('DOMContentLoaded', init);

let trackedCompanies = [];
let companySuggestions = [];

function renderCompanies() {
  const el = document.getElementById('companyList');
  if (trackedCompanies.length === 0) { el.innerHTML = 'None yet.'; return; }
  el.innerHTML = trackedCompanies.map((c, i) =>
    '<div class="job"><strong>' + escapeHtml(c.name) + '</strong> ' +
    '<span class="muted">' + escapeHtml(c.ats || '?') + '</span> ' +
    '<button onclick="removeCompany(' + i + ')">remove</button></div>'
  ).join('');
}

async function loadCompanies() {
  try { trackedCompanies = await request('/api/companies'); renderCompanies(); } catch (err) { /* none yet */ }
}

async function removeCompany(i) {
  const c = trackedCompanies[i];
  if (!c) return;
  try {
    await request('/api/companies/remove', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ careers_url: c.careers_url }),
    });
    await loadCompanies();
  } catch (err) { document.getElementById('companyStatus').textContent = err.message; }
}

async function addCompanies() {
  const status = document.getElementById('companyStatus');
  const urls = document.getElementById('companyUrls').value.split('\\n').map(s => s.trim()).filter(Boolean);
  if (urls.length === 0) { status.textContent = 'Paste at least one careers URL.'; return; }
  status.textContent = 'Validating against live boards...';
  try {
    const res = await request('/api/companies', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    status.textContent = 'Added ' + res.added.length + '.' +
      (res.failed.length ? ' Skipped ' + res.failed.length + ': ' + res.failed.map(f => f.error).join('; ') : '');
    document.getElementById('companyUrls').value = '';
    await loadCompanies();
  } catch (err) { status.textContent = err.message; }
}

async function suggestCompanies() {
  const status = document.getElementById('companyStatus');
  const btn = document.getElementById('suggestButton');
  const out = document.getElementById('suggestResults');
  btn.disabled = true;
  out.innerHTML = '';
  status.textContent = 'Asking the assistant and checking live boards (can take ~30s)...';
  try {
    const res = await request('/api/companies/suggest', { method: 'POST' });
    companySuggestions = res.validated || [];
    if (companySuggestions.length === 0) {
      status.textContent = 'No live Greenhouse/Ashby/Lever boards matched your field. Add companies by URL, or use "Evaluate a job" for any posting.';
    } else {
      status.textContent = 'Found ' + companySuggestions.length + ' live employers (from ' + res.suggested + ' suggestions). Review and add:';
      renderSuggestions();
    }
  } catch (err) { status.textContent = err.message; }
  finally { btn.disabled = false; }
}

function renderSuggestions() {
  const out = document.getElementById('suggestResults');
  out.innerHTML = '<button onclick="addSuggested()">Add all ' + companySuggestions.length + '</button>' +
    companySuggestions.map(s =>
      '<div class="job"><strong>' + escapeHtml(s.name) + '</strong> ' +
      '<span class="muted">' + escapeHtml(s.ats) + ' · ' + s.openings + ' open</span></div>'
    ).join('');
}

async function addSuggested() {
  const status = document.getElementById('companyStatus');
  const urls = companySuggestions.map(s => s.careers_url);
  if (urls.length === 0) return;
  status.textContent = 'Adding ' + urls.length + ' companies...';
  try {
    const res = await request('/api/companies', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ urls }),
    });
    status.textContent = 'Added ' + res.added.length + ' companies.';
    document.getElementById('suggestResults').innerHTML = '';
    companySuggestions = [];
    await loadCompanies();
  } catch (err) { status.textContent = err.message; }
}

async function loadEvaluations() {
  try {
    const rows = await request('/api/evaluations');
    show(rows.map(row => ({
      ...row,
      report_url: row.reportName ? '/api/files/report/' + row.reportName : null,
    })));
  } catch (err) {
    show(err.message);
  }
}

let scannedJobs = [];
let discoveredJobs = [];

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function scanPortals() {
  const status = document.getElementById('scanStatus');
  const results = document.getElementById('scanResults');
  const button = document.getElementById('scanButton');
  results.innerHTML = '';
  scannedJobs = [];
  button.disabled = true;

  const company = document.getElementById('scanCompany').value.trim();
  const query = company ? ('?company=' + encodeURIComponent(company)) : '';
  const started = Date.now();
  const log = [];
  let total = 0;

  status.innerHTML = '<strong>Connecting...</strong>';
  const source = new EventSource('/api/scan/stream' + query);

  const tick = setInterval(() => {
    if (total > 0) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      const done = log.length;
      status.innerHTML = '<strong>Scanning ' + done + '/' + total + ' companies</strong> · ' + elapsed + 's elapsed' +
        '<div class="scanlog">' + log.slice(-8).map(escapeHtml).join('<br>') + '</div>';
    }
  }, 200);

  function finish() {
    clearInterval(tick);
    source.close();
    button.disabled = false;
  }

  source.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    if (data.type === 'start') {
      total = data.total;
      status.innerHTML = '<strong>Scanning ' + total + ' companies...</strong>';
    } else if (data.type === 'company') {
      log.push(data.error
        ? '✗ ' + data.name + ' — ' + data.error
        : '✓ ' + data.name + ' (' + data.found + ' postings)');
    } else if (data.type === 'done') {
      finish();
      scannedJobs = data.jobs || [];
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      const diag = 'Saw ' + (data.totalSeen || 0) + ' postings · ' + (data.matchedRole || 0) +
        ' matched your roles · ' + data.found + ' also matched your locations.';
      status.innerHTML = '<strong>Done.</strong> Scanned ' + data.scanned + ' companies in ' + elapsed +
        's. ' + diag +
        (data.errors && data.errors.length ? ' (' + data.errors.length + ' had errors)' : '') +
        (data.found === 0 ? '<div class="muted">No matches. Broaden your target roles or locations, add more companies, or use "Evaluate a job" for a specific posting.</div>' : '');
      renderScanResults();
    } else if (data.type === 'error') {
      finish();
      status.textContent = '';
      results.innerHTML = '<p class="muted">' + escapeHtml(data.error) + '</p>';
    }
  };

  source.onerror = () => {
    finish();
    if (scannedJobs.length === 0) {
      status.innerHTML = '<span class="muted">Scan connection lost. Try again.</span>';
    }
  };
}

function renderScanResults() {
  const results = document.getElementById('scanResults');
  if (scannedJobs.length === 0) {
    results.innerHTML = '<p class="muted">No matching jobs. Adjust title_filter keywords in portals.yml.</p>';
    return;
  }
  results.innerHTML = scannedJobs.map((job, i) =>
    '<div class="job">' +
      '<h3>' + escapeHtml(job.title) + '</h3>' +
      '<div class="meta">' + escapeHtml(job.company) + (job.location ? ' — ' + escapeHtml(job.location) : '') +
        ' · <a href="' + escapeHtml(job.url) + '" target="_blank" rel="noopener">posting</a></div>' +
      '<button onclick="generateForJob(' + i + ', this)">Generate CV + evaluation</button>' +
      '<div class="result" id="job-result-' + i + '"></div>' +
    '</div>'
  ).join('');
}

async function generateForJob(index, button) {
  const job = scannedJobs[index];
  const out = document.getElementById('job-result-' + index);
  if (!job) return;
  await runGenerate(job, out, button);
}

async function runGenerate(job, out, button) {
  button.disabled = true;
  out.textContent = 'Generating (AI evaluation + tailored PDF)...';
  try {
    const result = await request('/api/evaluations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        company: job.company,
        title: job.title,
        url: job.url,
        description: job.description || '',
      }),
    });
    out.innerHTML = 'Score <strong>' + escapeHtml(result.score) + '/5</strong> · ' +
      '<a href="/api/files/report/' + encodeURIComponent(result.reportName) + '" target="_blank" rel="noopener">report</a> · ' +
      '<a href="/api/files/pdf/' + encodeURIComponent(result.pdfName) + '" target="_blank" rel="noopener">CV PDF</a>';
    loadEvaluations();
  } catch (err) {
    out.textContent = 'Error: ' + err.message;
  } finally {
    button.disabled = false;
  }
}

function renderWebResults() {
  const results = document.getElementById('discoverResults');
  if (discoveredJobs.length === 0) {
    results.innerHTML = '<p class="muted">No postings found. Try broader target roles or add "Remote" to your locations.</p>';
    return;
  }
  results.innerHTML = discoveredJobs.map((job, i) =>
    '<div class="job">' +
      '<h3>' + escapeHtml(job.title) + '</h3>' +
      '<div class="meta">' + escapeHtml(job.company) + (job.location ? ' — ' + escapeHtml(job.location) : '') +
        ' · <a href="' + escapeHtml(job.url) + '" target="_blank" rel="noopener">posting</a></div>' +
      '<button onclick="generateForWeb(' + i + ', this)">Generate CV + evaluation</button>' +
      '<div class="result" id="web-result-' + i + '"></div>' +
    '</div>'
  ).join('');
}

async function generateForWeb(index, button) {
  const job = discoveredJobs[index];
  const out = document.getElementById('web-result-' + index);
  if (!job) return;
  await runGenerate(job, out, button);
}

function discoverWeb() {
  const status = document.getElementById('discoverStatus');
  const results = document.getElementById('discoverResults');
  const button = document.getElementById('discoverButton');
  results.innerHTML = '';
  discoveredJobs = [];
  button.disabled = true;

  const started = Date.now();
  const log = [];
  status.innerHTML = '<strong>Starting web search...</strong> (this takes 2-4 minutes)';
  const source = new EventSource('/api/discover/stream');

  const tick = setInterval(() => {
    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    status.innerHTML = '<strong>Searching the web...</strong> · ' + elapsed + 's elapsed' +
      (log.length ? '<div class="scanlog">' + log.slice(-8).map(escapeHtml).join('<br>') + '</div>' : '');
  }, 500);

  function finish() {
    clearInterval(tick);
    source.close();
    button.disabled = false;
  }

  source.onmessage = (e) => {
    let data;
    try { data = JSON.parse(e.data); } catch { return; }

    if (data.type === 'start') {
      log.push('Looking for: ' + (data.roles || []).join(', '));
    } else if (data.type === 'tool') {
      const verb = data.tool === 'web_fetch' ? 'Reading' : 'Searching';
      log.push(verb + ': ' + (data.detail || '').slice(0, 70));
    } else if (data.type === 'thinking') {
      if (data.text) log.push('• ' + data.text.slice(0, 70));
    } else if (data.type === 'done') {
      finish();
      discoveredJobs = data.jobs || [];
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      status.innerHTML = '<strong>Done.</strong> Found ' + data.found + ' postings across the web in ' + elapsed + 's.' +
        (data.found === 0 ? '<div class="muted">Try broader roles, or use "Evaluate a job" for a specific posting.</div>' : '');
      renderWebResults();
    } else if (data.type === 'error') {
      finish();
      status.innerHTML = '<span class="muted">' + escapeHtml(data.error) + '</span>';
    }
  };

  source.onerror = () => {
    finish();
    if (discoveredJobs.length === 0) {
      status.innerHTML = '<span class="muted">Web search connection lost. Try again.</span>';
    }
  };
}
</script>
</body>
</html>`;
}
