import express from 'express';
import fs from 'node:fs';
import db from '../db.js';
import { tierName } from '../licenses.js';

const router = express.Router();
const LIMIT = Number(process.env.DOWNLOAD_LIMIT || 5);

function load(token) {
  return db
    .prepare(
      `SELECT l.*, p.title, p.bpm, p.music_key, a.file_path, a.file_name
       FROM licenses l
       JOIN products p ON p.id = l.product_id
       JOIN assets a ON a.id = l.asset_id
       WHERE l.token = ?`,
    )
    .get(token);
}

function problem(res, heading, detail) {
  res.status(410).send(page(`
    <h1>${heading}</h1>
    <p class="muted">${detail}</p>
    <p class="muted">Email ${escapeHtml(process.env.PRODUCER_EMAIL || 'the producer')} and they'll sort you out.</p>
  `));
}

router.get('/:token', (req, res) => {
  const l = load(req.params.token);
  if (!l) return problem(res, 'Link not found', 'This download link is not one of ours, or it has been removed.');
  if (new Date(l.expires_at) < new Date()) {
    return problem(res, 'Link expired', `This link stopped working on ${l.expires_at.slice(0, 10)}.`);
  }

  const specs = [l.bpm ? `${l.bpm} BPM` : null, l.music_key, tierName(l.tier)].filter(Boolean).join(' · ');
  const left = Math.max(0, LIMIT - l.downloads);

  res.send(page(`
    <p class="eyebrow">Your download</p>
    <h1>${escapeHtml(l.title)}</h1>
    <p class="muted">${escapeHtml(specs)}</p>

    <div class="stack">
      <a class="btn primary" href="/d/${l.token}/file">Download files</a>
      <a class="btn" href="/d/${l.token}/license">Download licence agreement (PDF)</a>
    </div>

    <dl>
      <dt>Licence</dt><dd>${escapeHtml(l.license_code)}</dd>
      <dt>Licensed to</dt><dd>${escapeHtml(l.buyer_name || l.buyer_email || 'you')}</dd>
      <dt>Link expires</dt><dd>${l.expires_at.slice(0, 10)}</dd>
      <dt>Downloads left</dt><dd>${left} of ${LIMIT}</dd>
    </dl>

    <p class="muted small">Save both files somewhere safe. Distributors, PROs and content-ID disputes will ask for the licence agreement.</p>
  `));
});

router.get('/:token/file', (req, res) => {
  const l = load(req.params.token);
  if (!l) return problem(res, 'Link not found', 'This download link is not one of ours.');
  if (new Date(l.expires_at) < new Date()) return problem(res, 'Link expired', 'Ask the producer for a fresh link.');
  if (l.downloads >= LIMIT) return problem(res, 'Download limit reached', `This link allowed ${LIMIT} downloads.`);
  if (!fs.existsSync(l.file_path)) return problem(res, 'File missing', 'The file is not on the server right now.');

  db.prepare('UPDATE licenses SET downloads = downloads + 1 WHERE id = ?').run(l.id);
  res.download(l.file_path, l.file_name);
});

router.get('/:token/license', (req, res) => {
  const l = load(req.params.token);
  if (!l || !l.pdf_path || !fs.existsSync(l.pdf_path)) {
    return problem(res, 'Agreement not ready', 'The licence PDF is still generating. Try again in a minute.');
  }
  res.download(l.pdf_path, `${l.license_code}-license.pdf`);
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Download</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  :root { --ink:#141210; --muted:#6f655c; --line:#e2dad1; --paper:#faf7f3; --accent:#141210; }
  * { box-sizing:border-box }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 Archivo, system-ui, sans-serif;
         display:flex; justify-content:center; padding:48px 20px; }
  main { width:100%; max-width:520px }
  h1 { font-size:30px; font-weight:600; margin:.1em 0 .25em; letter-spacing:-.01em }
  .eyebrow { color:var(--muted); font-size:13px; margin:0 }
  .muted { color:var(--muted) }
  .small { font-size:13px }
  .stack { display:flex; flex-direction:column; gap:10px; margin:28px 0 }
  .btn { display:block; text-align:center; padding:13px 18px; border-radius:8px; text-decoration:none;
         border:1px solid var(--line); color:var(--ink); background:#fff; font-weight:500 }
  .btn.primary { background:var(--accent); color:#faf7f3; border-color:var(--accent) }
  .btn:focus-visible { outline:3px solid #e8a33d; outline-offset:2px }
  dl { display:grid; grid-template-columns:auto 1fr; gap:6px 18px; margin:0; padding-top:20px;
       border-top:1px solid var(--line); font-size:14px }
  dt { color:var(--muted) } dd { margin:0 }
</style></head><body><main>${inner}</main></body></html>`;
}

export default router;
