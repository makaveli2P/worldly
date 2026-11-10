import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEXTURES, TEXTURE_ATTRIBUTION, TEXTURE_YEAR } from '../../src/globe/textureManifest';
import { splitAttribution } from '../../src/ui/credit';

const root = join(import.meta.dirname, '../..');

describe('texture manifest', () => {
  it('names files with the year, a content hash and the width, and the files exist with that size', () => {
    for (const t of Object.values(TEXTURES)) {
      expect(t.url).toMatch(new RegExp(`^/textures/earth-${TEXTURE_YEAR}-[0-9a-f]{8}-${t.width}\\.(webp|jpg)$`));
      expect(statSync(join(root, 'public', t.url)).size).toBe(t.bytes);
    }
  });

  it('has WebP tiers of 2048, 4096 and 8192 and a 4096 JPEG fallback', () => {
    expect([TEXTURES.s.width, TEXTURES.m.width, TEXTURES.l.width]).toEqual([2048, 4096, 8192]);
    expect(TEXTURES.s.url.endsWith('.webp') && TEXTURES.m.url.endsWith('.webp') && TEXTURES.l.url.endsWith('.webp')).toBe(true);
    expect(TEXTURES.fallback).toMatchObject({ width: 4096 });
    expect(TEXTURES.fallback.url.endsWith('.jpg')).toBe(true);
  });

  it('keeps the EOX attribution word for word, also in the licence notice', () => {
    expect(TEXTURE_ATTRIBUTION).toBe(
      `EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data ${TEXTURE_YEAR})`,
    );
    const licence = readFileSync(join(root, 'public/textures/LICENSE.md'), 'utf8');
    expect(licence).toContain(TEXTURE_ATTRIBUTION);
    expect(licence).toContain('https://creativecommons.org/licenses/by-nc-sa/4.0/');
    expect(licence).toContain('NASA Earth Observatory');
    expect(licence).toMatch(/modified/i);
  });
});

describe('splitAttribution', () => {
  it('splits at the URL, and the parts join to the same text', () => {
    const parts = splitAttribution(TEXTURE_ATTRIBUTION);
    expect(parts[1]).toBe('https://cloudless.eox.at');
    expect(parts.join('')).toBe(TEXTURE_ATTRIBUTION);
  });

  it('gives the whole text when it has no URL', () => {
    expect(splitAttribution('NASA Earth Observatory')).toEqual(['NASA Earth Observatory', '', '']);
  });
});
