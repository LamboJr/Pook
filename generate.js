#!/usr/bin/env node
// ─────────────────────────────────────────────────────────
//  Memories Generator
//  Liest alle Bilder aus ./memories/ und schreibt die
//  Karten automatisch in index.html
// ─────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');

const MEMORIES_DIR = path.join(__dirname, 'memories');
const INDEX_FILE   = path.join(__dirname, 'index.html');
const IMG_EXTS     = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

// ── Hilfsfunktionen ───────────────────────────────────────

function toTitle(filename) {
  return path.basename(filename, path.extname(filename))
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function toDate(filepath) {
  const mtime = fs.statSync(filepath).mtime;
  return mtime.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

// ── Bilder einlesen ───────────────────────────────────────

if (!fs.existsSync(MEMORIES_DIR)) {
  fs.mkdirSync(MEMORIES_DIR);
  console.log('📁  memories/ Ordner erstellt.');
}

const images = fs.readdirSync(MEMORIES_DIR)
  .filter(f => IMG_EXTS.has(path.extname(f).toLowerCase()))
  .sort((a, b) => {
    // Sortierung nach Änderungsdatum (älteste zuerst)
    const ta = fs.statSync(path.join(MEMORIES_DIR, a)).mtime;
    const tb = fs.statSync(path.join(MEMORIES_DIR, b)).mtime;
    return ta - tb;
  });

if (images.length === 0) {
  console.log('⚠️  Keine Bilder in memories/ gefunden.');
  process.exit(0);
}

// ── HTML generieren ───────────────────────────────────────

const cards = images.map(img => {
  const title = toTitle(img);
  const date  = toDate(path.join(MEMORIES_DIR, img));
  return `    <div class="mem-card">
      <div class="mem-photo">
        <img src="memories/${img}" alt="${title}">
      </div>
      <div class="mem-body">
        <span class="mem-date">${date}</span>
        <h3 class="mem-title">${title}</h3>
        <p class="mem-text">Erinnerung hinzufügen…</p>
      </div>
    </div>`;
}).join('\n');

// ── In index.html einfügen ────────────────────────────────

let html = fs.readFileSync(INDEX_FILE, 'utf8');

const START = '<!-- MEMORIES_START -->';
const END   = '<!-- MEMORIES_END -->';

if (!html.includes(START) || !html.includes(END)) {
  console.error('❌  Marker nicht in index.html gefunden.');
  process.exit(1);
}

html = html.replace(
  new RegExp(`${START}[\\s\\S]*?${END}`),
  `${START}\n${cards}\n    ${END}`
);

fs.writeFileSync(INDEX_FILE, html, 'utf8');
console.log(`✅  ${images.length} Bild(er) eingebunden:\n   ${images.join('\n   ')}`);
