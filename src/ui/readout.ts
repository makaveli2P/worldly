// Bottom instrument bar: LAT / LON / ALT / SEL in mono. update() runs every frame,
// so it writes to the DOM only when a value string changes.

import { h } from './dom';

export interface ReadoutView {
  lat: number;
  lng: number;
  altitudeKm: number;
}

const km = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

function hemi(v: number, pos: string, neg: string): string {
  // "-0.00" reads badly: round first, then pick the hemisphere.
  const r = Math.round(v * 100) / 100;
  return `${Math.abs(r).toFixed(2)}° ${r < 0 ? neg : pos}`;
}

export class Readout {
  readonly el: HTMLElement;
  private readonly values: HTMLElement[];
  private readonly last: string[] = ['', '', '', ''];

  constructor() {
    const names = ['LAT', 'LON', 'ALT', 'SEL'];
    this.values = names.map(() => h('b'));
    // Decorative: it changes every frame, and the selection has its own landmarks.
    this.el = h(
      'footer',
      { class: 'readout', 'aria-hidden': 'true' },
      names.map((n, i) => h('span', null, `${n} `, this.values[i])),
    );
    this.update({ lat: 0, lng: 0, altitudeKm: 0 }, null);
  }

  update(view: ReadoutView, selectedId: string | null): void {
    const alt = Math.round(view.altitudeKm / 10) * 10;
    const next = [
      hemi(view.lat, 'N', 'S'),
      hemi(((((view.lng + 180) % 360) + 360) % 360) - 180, 'E', 'W'),
      `${km.format(alt)} km`,
      selectedId ?? '—',
    ];
    for (let i = 0; i < next.length; i++) {
      if (next[i] === this.last[i]) continue;
      this.last[i] = next[i];
      this.values[i].textContent = next[i];
    }
  }
}
