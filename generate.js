#!/usr/bin/env node
// ─────────────────────────────────────────────────────────
//  Memories Generator
//  Liest alle Bilder aus ./memories/ und schreibt die
//  Karten automatisch in index.html
// ─────────────────────────────────────────────────────────
const fs   = require('fs');
const path = require('path');
const https = require('https');

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

// Parses EXIF from a JPEG buffer.
// Returns { date, lat, lon } — any field may be null.
function parseExif(data) {
  let result = { date: null, lat: null, lon: null };
  try {
    let i = 2;
    while (i < data.length - 4) {
      const marker = data.readUInt16BE(i);
      const length = data.readUInt16BE(i + 2);
      if (marker === 0xFFE1 && data.slice(i+4, i+8).toString() === 'Exif') {
        const tiff = data.slice(i + 10);
        const be   = tiff.slice(0,2).toString() === 'MM';
        const rd16 = o => be ? tiff.readUInt16BE(o) : tiff.readUInt16LE(o);
        const rd32 = o => be ? tiff.readUInt32BE(o) : tiff.readUInt32LE(o);
        const ifd0 = rd32(4), cnt0 = rd16(ifd0);

        let exifIFD = null, gpsIFD = null;
        for (let j = 0; j < cnt0; j++) {
          const e = ifd0 + 2 + j * 12;
          const tag = rd16(e);
          if (tag === 0x8769) exifIFD = rd32(e + 8);
          if (tag === 0x8825) gpsIFD  = rd32(e + 8);
        }

        // DateTimeOriginal from Exif SubIFD
        if (exifIFD) {
          const ecnt = rd16(exifIFD);
          for (let j = 0; j < ecnt; j++) {
            const e = exifIFD + 2 + j * 12;
            if (rd16(e) === 0x9003) {
              const off = rd32(e + 8);
              const ds  = tiff.slice(off, off + 19).toString();
              const [y,m,d] = [+ds.slice(0,4), +ds.slice(5,7), +ds.slice(8,10)];
              if (y > 1900) result.date = `${d}. ${MONTHS[m-1]} ${y}`;
              break;
            }
          }
        }

        // GPS
        if (gpsIFD) {
          const gcnt = rd16(gpsIFD);
          const tags = {};
          for (let j = 0; j < gcnt; j++) {
            const e = gpsIFD + 2 + j * 12;
            tags[rd16(e)] = e;
          }
          function rat3(valOff) {
            const off = rd32(valOff);
            const deg = rd32(off)    / rd32(off+4);
            const min = rd32(off+8)  / rd32(off+12);
            const sec = rd32(off+16) / rd32(off+20);
            return deg + min/60 + sec/3600;
          }
          if (tags[1] && tags[2] && tags[3] && tags[4]) {
            const latRef = String.fromCharCode(tiff[tags[1]+8]);
            const lonRef = String.fromCharCode(tiff[tags[3]+8]);
            let lat = rat3(tags[2]+8);
            let lon = rat3(tags[4]+8);
            if (latRef === 'S') lat = -lat;
            if (lonRef === 'W') lon = -lon;
            result.lat = lat;
            result.lon = lon;
          }
        }
        break;
      }
      i += 2 + length;
    }
  } catch {}
  return result;
}

function toDate(filepath) {
  // 1. EXIF DateTimeOriginal
  try {
    const exif = parseExif(fs.readFileSync(filepath));
    if (exif.date) return exif.date;
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

function fetchLocation(lat, lon) {
  return new Promise(resolve => {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
    const req = https.get(url, { headers: { 'User-Agent': 'GeschenkApp/1.0' } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const addr = JSON.parse(body).address || {};
          const city = addr.city || addr.town || addr.village || addr.municipality;
          const country = addr.country;
          resolve(city && country ? `${city}, ${country}` : city || country || null);
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => { req.destroy(); resolve(null); });
  });
}

// ── Bilder einlesen ───────────────────────────────────────

if (!fs.existsSync(MEMORIES_DIR)) {
  fs.mkdirSync(MEMORIES_DIR);
  console.log('📁  memories/ Ordner erstellt.');
}

const images = fs.readdirSync(MEMORIES_DIR)
  .filter(f => IMG_EXTS.has(path.extname(f).toLowerCase()))
  .sort((a, b) => {
    const ta = fs.statSync(path.join(MEMORIES_DIR, a)).mtime;
    const tb = fs.statSync(path.join(MEMORIES_DIR, b)).mtime;
    return ta - tb;
  });

if (images.length === 0) {
  console.log('⚠️  Keine Bilder in memories/ gefunden.');
  process.exit(0);
}

// ── HTML generieren (async für Geocoding) ─────────────────

async function main() {
  const cards = await Promise.all(images.map(async img => {
    const fp    = path.join(MEMORIES_DIR, img);
    const title = toTitle(img);
    const date  = toDate(fp);

    let loc = null;
    try {
      const exif = parseExif(fs.readFileSync(fp));
      if (exif.lat !== null && exif.lon !== null) {
        loc = await fetchLocation(exif.lat, exif.lon);
      }
    } catch {}

    const locHTML = loc ? `\n        <span class="mem-location">${loc}</span>` : '';
    return `    <div class="mem-card">
      <div class="mem-photo">
        <img src="memories/${img}" alt="${title}">
      </div>
      <div class="mem-body">
        <div class="mem-meta"><span class="mem-date">${date}</span>${locHTML}</div>
        <h3 class="mem-title">${title}</h3>
        <p class="mem-text">Erinnerung hinzufügen…</p>
      </div>
    </div>`;
  }));

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
    `${START}\n${cards.join('\n')}\n    ${END}`
  );

  fs.writeFileSync(INDEX_FILE, html, 'utf8');
  console.log(`✅  ${images.length} Bild(er) eingebunden:\n   ${images.join('\n   ')}`);
}

main().catch(err => { console.error(err); process.exit(1); });
