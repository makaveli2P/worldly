// Bottom instrument bar: LAT / LON / ALT / SEL in mono. update() runs every frame,
// so it writes to the DOM only when a value string changes. On the flat map, SCL (the map scale) takes the place of ALT.
// The same bar holds the satellite imagery credit (src/ui/credit.ts), so the two never overlap.

import { creditElement } from './credit';
import { h } from './dom';

export interface ReadoutView {
  lat: number;
  lng: number;
  altitudeKm: number;
  /** The map scale 1:d. When it is set, the third value is SCL in place of ALT. */
  scaleDenominator?: number;
}

const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

/** A map scale as "1:<n>", with 2 significant digits and K or M: 4.2e7 gives "1:42M", 8.5e5 gives "1:850K". */
export function formatScale(d: number): string {
  if (!(d > 0) || !Number.isFinite(d)) return '1:—';
  const r = Math.round(d);
  if (r < 1e3) return `1:${r}`;
  const k = Number((d / 1e3).toPrecision(2));
  if (k < 1e3) return `1:${k}K`;
  return `1:${Number((d / 1e6).toPrecision(2))}M`;
}

function hemi(v: number, pos: string, neg: string): string {
  // "-0.00" reads badly: round first, then pick the hemisphere.
  const r = Math.round(v * 100) / 100;
  return `${Math.abs(r).toFixed(2)}° ${r < 0 ? neg : pos}`;
}

export class Readout {
  readonly el: HTMLElement;
  private readonly values: HTMLElement[];
  private readonly last: string[] = ['', '', '', ''];
  // The name of the third value: ALT on the globe, SCL on the map.
  private readonly thirdName = document.createTextNode('ALT ');
  private lastThird = 'ALT ';

  constructor() {
    const names = ['LAT', 'LON', 'ALT', 'SEL'];
    this.values = names.map(() => h('b'));
    // The values are decorative: they change every frame, and the selection has its own landmarks.
    // The credit is not decorative, so only the values are aria-hidden.
    this.el = h(
      'footer',
      { class: 'readout' },
      h(
        'div',
        { class: 'readout-values', 'aria-hidden': 'true' },
        names.map((n, i) => h('span', null, i === 2 ? this.thirdName : `${n} `, this.values[i])),
      ),
      creditElement(),
    );
    this.update({ lat: 0, lng: 0, altitudeKm: 0 }, null);
  }

  update(view: ReadoutView, selectedId: string | null): void {
    const alt = Math.round(view.altitudeKm / 10) * 10;
    const scale = view.scaleDenominator;
    const third = scale !== undefined ? 'SCL ' : 'ALT ';
    if (third !== this.lastThird) {
      this.lastThird = third;
      this.thirdName.data = third;
    }
    const next = [
      hemi(view.lat, 'N', 'S'),
      hemi(((((view.lng + 180) % 360) + 360) % 360) - 180, 'E', 'W'),
      scale !== undefined ? formatScale(scale) : `${km.format(alt)} km`,
      selectedId ?? '—',
    ];
    for (let i = 0; i < next.length; i++) {
      if (next[i] === this.last[i]) continue;
      this.last[i] = next[i];
      this.values[i].textContent = next[i];
    }
  }
}
