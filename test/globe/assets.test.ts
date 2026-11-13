import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { worldFeatures, type WorldTopology } from '../../src/data/precompute';
import { worldAssets } from '../../src/globe/assets';
import { SMALL_CAP } from '../../src/globe/constants';

const world = JSON.parse(readFileSync(join(import.meta.dirname, '../../public/data/world.json'), 'utf8')) as WorldTopology;
const features = worldFeatures(world);

describe('worldAssets', () => {
  it('builds one time per feature array', () => {
    const a = worldAssets(features);
    expect(worldAssets(features)).toBe(a);
    // A new array is a new world.
    expect(worldAssets(features.slice())).not.toBe(a);
  });

  it('maps ids to indices and finds the small countries', () => {
    const a = worldAssets(features);
    const vat = a.idToIndex.get('VAT')!;
    expect(features[vat].id).toBe('VAT');
    expect(a.smallCountries).toContain(vat);
    expect(a.capRadius[vat]).toBeLessThan(SMALL_CAP);
    expect(a.smallCountries).not.toContain(a.idToIndex.get('RUS'));
  });
});
