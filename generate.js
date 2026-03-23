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

const MONTHS = ['Januar','Februar','März','April','Mai','Juni',
                'Juli','August','September','Oktober','November','Dezember'];

function toDate(filepath) {
  // 1. Try EXIF DateTimeOriginal
  try {
    const data = fs.readFileSync(filepath);
    let i = 2;
    while (i < data.length - 4) {
      const marker = data.readUInt16BE(i);
      const length = data.readUInt16BE(i + 2);
      if (marker === 0xFFE1 && data.slice(i+4, i+8).toString() === 'Exif') {
        const tiff = data.slice(i + 10);
        const be   = tiff.slice(0,2).toString() === 'MM';
        const rd16 = o => be ? tiff.readUInt16BE(o) : tiff.readUInt16LE(o);
        const rd32 = o => be ? tiff.readUInt32BE(o) : tiff.readUInt32LE(o);
        const ifd  = rd32(4), cnt = rd16(ifd);
        for (let j = 0; j < cnt; j++) {
          const e   = ifd + 2 + j * 12;
          const tag = rd16(e);
          if (tag === 0x9003 || tag === 0x0132) {
            const off = rd32(e + 8);
            const ds  = tiff.slice(off, off + 19).toString();
            const [y,m,d] = [+ds.slice(0,4), +ds.slice(5,7), +ds.slice(8,10)];
            return `${d}. ${MONTHS[m-1]} ${y}`;
          }
        }
      }
      i += 2 + length;
    }
  } catch {}

  // 2. macOS Spotlight fallback (mdls)
  try {
    const { execSync } = require('child_process');
    const out   = execSync(`mdls -name kMDItemContentCreationDate "${filepath}"`, { encoding: 'utf8' });
    const match = out.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [,y,m,d] = match;
      return `${+d}. ${MONTHS[+m-1]} ${+y}`;
    }
  } catch {}

  // 3. File modification date
  const mtime = fs.statSync(filepath).mtime;
  return `${mtime.getDate()}. ${MONTHS[mtime.getMonth()]} ${mtime.getFullYear()}`;
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
