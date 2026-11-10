// Files that the build makes from public/data, so the page does less work and loads fewer bytes at start.
// vite.config.ts writes them to /data/ (and the dev server makes them on request).
//
//   /data/labels.json          label sites and picker flags, from world.json (see src/overlay/labelPoints.ts)
//   /data/countries-lite.json  only the fields of countries.json that the first frame needs
//
// The two files come from the same public/data files in the same build, so they stay in step.

import { geoArea } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import { computeLabelSites, packLabelSites, type LabelsFile } from '../overlay/labelPoints';
import type { CountryFeature, CountryId, CountryInfo } from '../types';

export type WorldTopology = Topology<{ countries: GeometryCollection<{ id: CountryId; name: string }> }>;

/** The country shapes of world.json that the globe draws. */
export function worldFeatures(topo: WorldTopology): CountryFeature[] {
  const out: CountryFeature[] = [];
  for (const f of feature(topo, topo.objects.countries).features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    out.push({ id: f.properties.id, name: f.properties.name, geometry: g });
  }
  return out;
}

export function buildLabelsFile(topo: WorldTopology): LabelsFile {
  const features = worldFeatures(topo);
  return {
    v: 1,
    arcs: topo.arcs.length,
    sites: packLabelSites(computeLabelSites(features)),
    // A reversed ring winding makes geoContains give the complement (see src/globe/picker.ts).
    inverted: features.filter((f) => geoArea(f.geometry) > 2 * Math.PI).map((f) => f.id),
  };
}

/** The fields that the globe labels, the search and the tooltip use. The panels need the full file. */
export const LITE_FIELDS = ['id', 'name', 'capital', 'capitalLatLng', 'latlng', 'area', 'population'] as const;

export type LiteCountryInfo = Pick<CountryInfo, (typeof LITE_FIELDS)[number]>;

export function liteCountries(all: Record<CountryId, CountryInfo>): Record<CountryId, LiteCountryInfo> {
  const out: Record<CountryId, LiteCountryInfo> = {};
  for (const [id, info] of Object.entries(all)) {
    const lite: Record<string, unknown> = {};
    for (const k of LITE_FIELDS) if (info[k] !== undefined) lite[k] = info[k];
    out[id] = lite as unknown as LiteCountryInfo;
  }
  return out;
}
