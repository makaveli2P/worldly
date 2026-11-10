// Builds the satellite texture tiers of the globe (npm run texture).
//
// Source: EOxCloudless (Sentinel-2 cloudless mosaic) from the free EOX WMS, EPSG:4326.
// The EOX mosaic shows Antarctica and inner Greenland as flat white with some magenta specks.
// The script puts NASA Blue Marble Next Generation ice on those pixels.
//
// Outputs (in --out, default public/textures):
//   earth-<year>-<hash8>-2048.webp   first tier, WebP q70
//   earth-<year>-<hash8>-4096.webp   second tier, WebP q80 with smart subsampling
//   earth-<year>-<hash8>-8192.webp   third tier, WebP q80 (capable desktops only)
//   earth-<year>-<hash8>-4096.jpg    fallback when a WebP load fails, progressive JPEG q80
//   LICENSE.md                       the CC BY-NC-SA 4.0 notice of the texture files
// and src/globe/textureManifest.ts, the one module that names the files for the app.
// <hash8> is the start of the SHA-256 of the file, so a changed file always gets a new name
// and the 1-year immutable cache stays safe.
//
// Usage:
//   npm run texture                       fine master (8 WMS parts, 16384x8192, Lanczos down to 8192)
//   npm run texture -- --fast             2 WMS parts at 8192x4096 (fewer requests, softer)
//   npm run texture -- --cache <dir> --out <dir> --manifest <file>
//
// Downloads stay in --cache (default .cache/texture, git ignores it) and the script uses them again.
// The script waits 2 s between EOX requests. EOX limits one request to 4096 px.

import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---- settings ----

const YEAR = 2025; // EOxCloudless vintage. 2018-2025 are CC BY-NC-SA 4.0; 2016 ('s2cloudless') is CC BY 4.0.
const LAYER = `s2cloudless-${YEAR}`;
const ATTRIBUTION = `EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${YEAR})`;
const NASA_CREDIT = 'NASA Earth Observatory';
const W = 8192; // master width; the height is W / 2
const H = W / 2;
const PART = 4096; // EOX limit for one request
const POLAR_LAT = 58; // the ice blend applies only poleward of this latitude
const BMNG_URL =
  'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/bmng/bmng-topography-bathymetry/august/world.topo.bathy.200408.3x21600x10800.jpg';
const UA = 'Mozilla/5.0 (compatible; texture-build)';
const WAIT_MS = 2000;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const FAST = args.includes('--fast');
const cacheDir = resolve(arg('cache', join(ROOT, '.cache/texture')));
const outDir = resolve(arg('out', join(ROOT, 'public/textures')));
const manifestFile = resolve(arg('manifest', join(ROOT, 'src/globe/textureManifest.ts')));

sharp.cache(false);
await mkdir(cacheDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const isJpeg = (buf) => buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

/** Downloads a JPEG once into the cache. Fails when the server does not send a JPEG. */
async function download(url, file) {
  if (existsSync(file)) {
    if (!isJpeg(await readFile(file))) throw new Error(`cached file is not a JPEG: ${file} (delete it and run again)`);
    return false;
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    let reason = '';
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      const type = res.headers.get('content-type') ?? '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && type.startsWith('image/jpeg') && isJpeg(buf)) {
        await writeFile(file, buf);
        return true;
      }
      reason = `${res.status} ${type} ${buf.length} B`;
    } catch (err) {
      reason = String(err);
    }
    console.warn(`  retry ${attempt}: ${reason}`);
    await sleep(5000 * attempt);
  }
  throw new Error(`download failed (not image/jpeg): ${url}`);
}

function wmsUrl(minx, miny, maxx, maxy) {
  return (
    'https://tiles.maps.eox.at/wms?service=WMS&request=GetMap&version=1.1.1&styles=&srs=EPSG:4326' +
    `&format=image/jpeg&layers=${LAYER}&bbox=${minx},${miny},${maxx},${maxy}&width=${PART}&height=${PART}`
  );
}

// ---- 1. EOX master ----

// Fine: 4 x 2 parts of 90° x 90° give 16384 x 8192 px. The downsample to 8192 removes one generation of JPEG loss.
// Fast: 2 parts of 180° x 180° give 8192 x 4096 px directly.
const span = FAST ? 180 : 90;
const cols = 360 / span;
const rows = 180 / span;
const parts = [];
for (let r = 0; r < rows; r++) {
  for (let c = 0; c < cols; c++) {
    const minx = -180 + c * span;
    const maxy = 90 - r * span;
    const file = join(cacheDir, `eox-${LAYER}-${span}-${r}-${c}.jpg`);
    console.log(`EOX part ${r * cols + c + 1}/${rows * cols}: lon ${minx}..${minx + span}, lat ${maxy - span}..${maxy}`);
    const fetched = await download(wmsUrl(minx, maxy - span, minx + span, maxy), file);
    parts.push({ input: file, left: c * PART, top: r * PART });
    if (fetched) await sleep(WAIT_MS); // be polite to the free service
  }
}
const fullW = cols * PART;
const fullH = rows * PART;
let eoxImage = sharp({ create: { width: fullW, height: fullH, channels: 3, background: '#000' }, limitInputPixels: false })
  .composite(parts)
  .removeAlpha();
if (fullW !== W) {
  // Composite first, then resize: sharp would otherwise resize before the composite.
  const big = await eoxImage.raw().toBuffer();
  eoxImage = sharp(big, { raw: { width: fullW, height: fullH, channels: 3 }, limitInputPixels: false }).resize(W, H, { kernel: 'lanczos3' });
}
const eox = await eoxImage.raw().toBuffer();
if (eox.length !== W * H * 3) throw new Error(`EOX master has ${eox.length} bytes, expected ${W * H * 3}`);

// ---- 2. Blue Marble NG ice ----

const bmFile = join(cacheDir, 'bmng-200408-21600.jpg');
console.log('Blue Marble NG (August 2004)');
await download(BMNG_URL, bmFile);
const bm = await sharp(bmFile, { limitInputPixels: false }).resize(W, H, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();

// Poleward of POLAR_LAT, EOX pixels that are flat white, or the magenta specks on Antarctica,
// take the Blue Marble pixel. A pure latitude cut would leave a line, because the two oceans differ in colour.
const mask = Buffer.alloc(W * H);
const polarRows = Math.round(((90 - POLAR_LAT) / 180) * H);
let masked = 0;
for (let y = 0; y < H; y++) {
  if (y > polarRows && y < H - polarRows) continue;
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const r = eox[i];
    const g = eox[i + 1];
    const b = eox[i + 2];
    const white = Math.min(r, g, b) >= 235;
    const magenta = r > 180 && b > 180 && g < r - 40;
    if (white || magenta) {
      mask[y * W + x] = 255;
      masked++;
    }
  }
}
// sharp returns 3 channels after blur() on a 1-channel raw input; extractChannel(0) keeps one.
const soft = await sharp(mask, { raw: { width: W, height: H, channels: 1 } }).blur(3).extractChannel(0).raw().toBuffer();
if (soft.length !== W * H) throw new Error(`the ice mask has ${soft.length / (W * H)} channels`);
console.log(`ice mask: ${masked} px (${((100 * masked) / (W * H)).toFixed(2)}% of the image)`);
const blended = Buffer.alloc(W * H * 3);
for (let p = 0; p < W * H; p++) {
  const a = soft[p] / 255;
  for (let k = 0; k < 3; k++) blended[p * 3 + k] = Math.round(eox[p * 3 + k] * (1 - a) + bm[p * 3 + k] * a);
}
const master = await sharp(blended, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 1 }).toBuffer();
await writeFile(join(cacheDir, `master-${LAYER}-${FAST ? 'fast' : 'fine'}-${W}.png`), master);

// ---- 3. Encodes ----

const encodes = [
  { key: 's', width: 2048, ext: 'webp', enc: (s) => s.webp({ quality: 70, effort: 6 }) },
  { key: 'm', width: 4096, ext: 'webp', enc: (s) => s.webp({ quality: 80, effort: 6, smartSubsample: true }) },
  { key: 'l', width: 8192, ext: 'webp', enc: (s) => s.webp({ quality: 80, effort: 6 }) },
  { key: 'fallback', width: 4096, ext: 'jpg', enc: (s) => s.jpeg({ quality: 80, mozjpeg: true, progressive: true }) },
];
const written = {};
for (const e of encodes) {
  const base = e.width === W ? sharp(master) : sharp(master).resize(e.width, e.width / 2, { kernel: 'lanczos3' });
  const buf = await e.enc(base).toBuffer();
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 8);
  const name = `earth-${YEAR}-${hash}-${e.width}.${e.ext}`;
  await writeFile(join(outDir, name), buf);
  written[e.key] = { url: `/textures/${name}`, width: e.width, bytes: buf.length };
  console.log(`${name.padEnd(36)} ${String(buf.length).padStart(9)} B`);
}

// Remove texture files of earlier builds (only names this script makes).
const keep = new Set(Object.values(written).map((t) => t.url.replace('/textures/', '')));
for (const f of await readdir(outDir)) {
  if (/^earth-\d{4}-[0-9a-f]{8}-\d+\.(webp|jpg)$/.test(f) && !keep.has(f)) {
    await rm(join(outDir, f));
    console.log(`removed ${f}`);
  }
}

// ---- 4. Manifest module and licence ----

const manifest = `// Generated by scripts/build-texture.mjs (npm run texture). Do not edit.
// The satellite texture tiers. Each name holds a content hash, so the files can be cached as immutable.

export interface TextureFile {
  url: string;
  width: number;
  bytes: number;
}

export const TEXTURE_YEAR = ${YEAR};

/** s: first tier, m: second tier, l: third tier (capable desktops), fallback: JPEG for a failed WebP load. */
export const TEXTURES: { s: TextureFile; m: TextureFile; l: TextureFile; fallback: TextureFile } = ${JSON.stringify(written, null, 2)};

/** The attribution that the EOX licence requires, word for word. */
export const TEXTURE_ATTRIBUTION = ${JSON.stringify(ATTRIBUTION)};
`;
await writeFile(manifestFile, manifest);

const licence = `# Satellite texture licence

The files \`earth-*.webp\` and \`earth-*.jpg\` in this folder are licensed under the
**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International** licence (CC BY-NC-SA 4.0):
https://creativecommons.org/licenses/by-nc-sa/4.0/

This licence applies only to the texture files. It does not apply to the source code of Worldly.

## Attribution

- ${ATTRIBUTION}
- Polar ice: NASA Blue Marble Next Generation (August 2004, topography and bathymetry), credit: ${NASA_CREDIT}.
  NASA imagery is generally not subject to copyright in the United States.

## Changes to the source imagery

The texture files are a modified version of the source imagery. \`scripts/build-texture.mjs\` makes them:

1. It requests the EOX WMS layer \`${LAYER}\` (EPSG:4326) in parts of 4096 x 4096 px and stitches the parts.
2. It resamples the result to 8192 x 4096 px (Lanczos 3).
3. Poleward of ${POLAR_LAT}°, it replaces flat white and magenta EOX pixels with Blue Marble Next Generation pixels, with a 3 px feather.
4. It resizes the result to 2048, 4096 and 8192 px wide and compresses it as WebP and JPEG.

## Conditions (summary, not legal advice)

- Non-commercial use only. The EOX terms count a personal hobby project as non-commercial.
  A site with ads, paid features or other income needs other imagery (for example the CC BY 4.0
  EOxCloudless 2016 layer \`s2cloudless\`) or a commercial licence from EOX.
- ShareAlike: if you change these files and share the result, use the same licence.
- Show the attribution above wherever the imagery shows, also on screenshots and videos.

## No warranties

The licensors give the imagery "as is", with no warranties of any kind. See section 5 of the licence:
https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.en

## Look

The polar blend uses Blue Marble ice only where the EOX mosaic shows land ice. The Arctic Ocean has
no sea ice in the result: the North Pole shows open, dark ocean.

Source terms: https://cloudless.eox.at/license-non-commercial
`;
await writeFile(join(outDir, 'LICENSE.md'), licence);
console.log(`wrote ${manifestFile} and ${join(outDir, 'LICENSE.md')}`);
