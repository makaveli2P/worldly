// Builds the PNG app icons from public/favicon.svg (npm run icons).
//
// Outputs (in public/):
//   apple-touch-icon.png   180x180, for the home screen of iOS
//   icon-192.png           192x192, for site.webmanifest
//   icon-512.png           512x512, for site.webmanifest and install screens
//
// iOS fills a transparent pixel with black. So the script puts the globe mark on the paper colour
// of the light theme, with a margin of 1/8 of the size on each side.

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const PAPER = '#E6E6E1'; // the light paper token (src/theme.ts)

const svg = await readFile(join(PUBLIC, 'favicon.svg'));
for (const [name, size] of [
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  const mark = Math.round(size * 0.75);
  const pad = Math.round((size - mark) / 2);
  const globe = await sharp(svg, { density: Math.ceil((72 * mark) / 32) })
    .resize(mark, mark)
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 3, background: PAPER } })
    .composite([{ input: globe, top: pad, left: pad }])
    .png({ compressionLevel: 9, palette: true })
    .toFile(join(PUBLIC, name));
  console.log(`public/${name} ${size}x${size}`);
}
