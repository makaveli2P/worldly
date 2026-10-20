// Left plate (desktop) / "Overview" tab (mobile): facts about one country,
// in numbered sections with right-aligned mono figures.

import type { CountryId, CountryInfo } from '../types';
import { h } from './dom';
import * as fmt from './format';
import { getLayout, type PanelLayout } from './layout';
import { NowBlock } from './now';

type Value = string | Node | null;
type Row = [label: string, value: Value];

export interface DetailsPanelOptions {
  onSelectCountry: (id: CountryId) => void;
  onClose: () => void;
  nameOf: (id: CountryId) => string | null;
}

export class DetailsPanel {
  private readonly layout: PanelLayout;
  private readonly body: HTMLElement;
  /** Local time and weather at the capital, under the name. */
  private readonly now = new NowBlock();

  constructor(
    root: HTMLElement,
    private readonly opts: DetailsPanelOptions,
  ) {
    this.layout = getLayout(root);
    this.body = this.layout.register('details', 'Country details', opts.onClose);
  }

  show(info: CountryInfo): void {
    this.now.show(info);
    this.body.replaceChildren(this.header(info), this.now.el, ...this.sections(info), this.footer(info));
    this.layout.setIdentity(this.compactHeader(info));
    this.layout.setOpen('details', true);
    this.body.scrollTop = 0;
  }

  hide(): void {
    this.now.hide();
    this.layout.setOpen('details', false);
    this.layout.setIdentity(null);
  }

  private flag(c: CountryInfo): HTMLElement | null {
    return c.flag
      ? h('img', { class: 'flag', src: c.flag, alt: `Flag of ${c.name}`, width: 48, height: 32, decoding: 'async' })
      : null;
  }

  private header(c: CountryInfo): HTMLElement {
    const official = c.officialName && c.officialName !== c.name ? c.officialName : null;
    const code = [c.id.startsWith('X-') ? null : c.id, c.iso2].filter(Boolean).join(' · ');
    return h(
      'header',
      { class: 'id' },
      h(
        'div',
        { class: 'id-top' },
        this.flag(c) ?? h('span'),
        h('p', { class: 'id-code mono' }, code && h('span', null, code), c.latlng && h('span', null, fmt.latLng(c.latlng))),
      ),
      h('h2', { class: 'country-name' }, c.name),
      official && h('p', { class: 'official-name' }, official),
    );
  }

  /** Mobile sheet head: flag, name and official name in one row. */
  private compactHeader(c: CountryInfo): HTMLElement {
    const official = c.officialName && c.officialName !== c.name ? c.officialName : null;
    return h(
      'div',
      { class: 'id id--compact' },
      this.flag(c),
      h(
        'div',
        null,
        h('p', { class: 'country-name', 'aria-hidden': 'true' }, c.name),
        official && h('p', { class: 'official-name', 'aria-hidden': 'true' }, official),
      ),
    );
  }

  private sections(c: CountryInfo): HTMLElement[] {
    const g = c.government;
    const e = c.economy;

    const geography: Row[] = [
      ['Capital', c.capital.length ? c.capital.join(', ') : null],
      ['Region', c.subregion ?? c.region],
      ['Area', c.area !== null ? figure(fmt.areaValue(c.area), 'km²') : null],
      ['Borders', null],
      ['Time zones', c.timezones.length ? figure(fmt.zoneRange(c.timezones)!) : null],
    ];
    const people: Row[] = [
      ['Population', c.population !== null ? figure(fmt.integer(c.population), '', c.populationYear) : null],
      ['Languages', c.languages.length ? c.languages.join(', ') : null],
      [
        'Life expectancy',
        c.demographics.lifeExpectancy !== null ? figure(c.demographics.lifeExpectancy.toFixed(1), 'yr') : null,
      ],
      ['Urban', c.demographics.urbanPopulationPct !== null ? figure(fmt.decimal1(c.demographics.urbanPopulationPct), '%') : null],
    ];
    const government: Row[] = [
      ['System', g.type ? fmt.sentenceCase(g.type) : null],
      [g.headOfStateTitle ?? 'Head of state', g.headOfState],
      [g.headOfGovernmentTitle ?? 'Head of government', g.headOfGovernment !== g.headOfState ? g.headOfGovernment : null],
      ['UN member', c.unMember === null ? null : c.unMember ? 'Yes' : 'No'],
    ];
    // "UN member: No" alone (Antarctica, Siachen) is not worth a section.
    const hasGovernment = g.type !== null || g.headOfState !== null || g.headOfGovernment !== null;
    if (!hasGovernment && c.unMember !== true) government.length = 0;
    const gdp = e.gdpUsd !== null ? fmt.usdScaled(e.gdpUsd) : null;
    const economy: Row[] = [
      ['GDP', gdp ? figure(gdp[0], gdp[1], e.gdpYear) : null],
      ['GDP per capita', e.gdpPerCapitaUsd !== null ? figure(fmt.usd(e.gdpPerCapitaUsd)) : null],
      ['HDI', e.hdi !== null ? figure(fmt.hdi(e.hdi), '', e.hdiYear) : null],
      ['Currency', currencies(c.currencies)],
      ['Calling code', c.callingCode ? figure(c.callingCode) : null],
    ];

    const out = [
      section('01', 'Geography', geography, this.borders(c.borders)),
      section('02', 'People', people),
      section('03', 'Government', government),
      section('04', 'Economy', economy),
    ];
    return out.filter((s): s is HTMLElement => s !== null);
  }

  /** "Borders  16 +": the count opens the list of neighbours, each one a link. */
  private borders(ids: CountryId[]): HTMLElement | null {
    const named = ids
      .map((id) => ({ id, name: this.opts.nameOf(id) }))
      .filter((b): b is { id: CountryId; name: string } => b.name !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (named.length === 0) return null;
    const listId = `borders-${Math.random().toString(36).slice(2, 8)}`;
    const toggle = h(
      'button',
      { type: 'button', class: 'border-toggle', 'aria-expanded': 'false', 'aria-controls': listId },
      h('span', { class: 'num' }, String(named.length)),
      h('span', { class: 'sr-only' }, named.length === 1 ? ' neighbour, show it' : ' neighbours, show them'),
      h('span', { class: 'border-sign', 'aria-hidden': 'true' }),
    );
    const list = h(
      'dd',
      { class: 'border-list', id: listId, hidden: true },
      named.map((b) => {
        const btn = h('button', { type: 'button', class: 'text-link' }, b.name);
        btn.addEventListener('click', () => this.opts.onSelectCountry(b.id));
        return btn;
      }),
    );
    toggle.addEventListener('click', () => {
      const open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
    return h('div', { class: 'row row--borders' }, h('dt', null, 'Borders'), h('dd', null, toggle), list);
  }

  private footer(c: CountryInfo): HTMLElement {
    return h(
      'footer',
      { class: 'panel-foot' },
      h('span', null, 'Wikidata · World Bank · mledoze'),
      c.wikipedia && h('a', { href: c.wikipedia, target: '_blank', rel: 'noopener noreferrer' }, 'Wikipedia →'),
    );
  }
}

/** A mono figure with an optional grey unit and a fainter year: "1,406,585,000 2025". */
function figure(value: string, unit = '', year: number | null = null): HTMLElement {
  return h(
    'span',
    { class: 'num' },
    value,
    unit && h('span', { class: 'u' }, ` ${unit}`),
    year !== null && h('span', { class: 'yr' }, ` ${year}`),
  );
}

function currencies(list: CountryInfo['currencies']): Node | null {
  if (list.length === 0) return null;
  const wrap = h('span');
  list.forEach((c, i) => {
    if (i > 0) wrap.append(h('br'));
    wrap.append(c.name, h('span', { class: 'u mono' }, ` ${c.code}`));
  });
  return wrap;
}

function section(n: string, title: string, rows: Row[], borders: HTMLElement | null = null): HTMLElement | null {
  const items: HTMLElement[] = [];
  for (const [label, value] of rows) {
    if (label === 'Borders') {
      if (borders) items.push(borders);
      continue;
    }
    if (value === null || value === '') continue;
    items.push(h('div', { class: 'row' }, h('dt', null, label), h('dd', null, value)));
  }
  if (items.length === 0) return null;
  return h(
    'section',
    { class: 'sec' },
    h('h3', { class: 'sec-h' }, h('span', { class: 'n', 'aria-hidden': 'true' }, n), title),
    h('dl', { class: 'rows' }, items),
  );
}
