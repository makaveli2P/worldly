// Right panel (desktop) / "Overview" tab (mobile): facts about one country.

import type { CountryId, CountryInfo } from '../types';
import { h } from './dom';
import * as fmt from './format';
import { getLayout, type PanelLayout } from './layout';

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

  constructor(
    root: HTMLElement,
    private readonly opts: DetailsPanelOptions,
  ) {
    this.layout = getLayout(root);
    this.body = this.layout.register('details', 'Country details', opts.onClose);
  }

  show(info: CountryInfo): void {
    this.body.replaceChildren(this.header(info), ...this.sections(info), this.footer(info));
    this.layout.setOpen('details', true);
    this.body.scrollTop = 0;
  }

  hide(): void {
    this.layout.setOpen('details', false);
  }

  private header(c: CountryInfo): HTMLElement {
    const flag = c.flag
      ? h('img', { class: 'flag', src: c.flag, alt: `Flag of ${c.name}`, width: 48, decoding: 'async' })
      : null;
    const official = c.officialName && c.officialName !== c.name ? c.officialName : null;
    return h(
      'header',
      { class: 'details-head' },
      flag,
      h('h2', { class: 'country-name' }, c.name),
      official && h('p', { class: 'official-name' }, official),
    );
  }

  private sections(c: CountryInfo): HTMLElement[] {
    const g = c.government;
    const e = c.economy;
    const withYear = (v: string, year: number | null) => (year ? `${v} (${year})` : v);

    const geography: Row[] = [
      ['Capital', c.capital.length ? c.capital.join(', ') : null],
      ['Region', [c.region, c.subregion].filter(Boolean).join(' · ') || null],
      ['Area', c.area !== null ? fmt.area(c.area) : null],
      ['Borders', this.borders(c.borders)],
      ['Time zones', fmt.timezones(c.timezones)],
    ];
    const people: Row[] = [
      ['Population', c.population !== null ? withYear(fmt.compactNumber(c.population), c.populationYear) : null],
      ['Languages', c.languages.length ? c.languages.join(', ') : null],
      [
        'Life expectancy',
        c.demographics.lifeExpectancy !== null ? `${fmt.decimal1(c.demographics.lifeExpectancy)} years` : null,
      ],
      [
        'Urban',
        c.demographics.urbanPopulationPct !== null ? `${fmt.decimal1(c.demographics.urbanPopulationPct)}%` : null,
      ],
    ];
    const government: Row[] = [
      ['Type', g.type ? fmt.sentenceCase(g.type) : null],
      ['Head of state', person(g.headOfState, g.headOfStateTitle)],
      ['Head of government', person(g.headOfGovernment, g.headOfGovernmentTitle)],
      ['UN member', c.unMember === null ? null : c.unMember ? 'Yes' : 'No'],
    ];
    // "UN member: No" alone (Antarctica, Siachen) is not worth a section.
    const hasGovernment = g.type !== null || g.headOfState !== null || g.headOfGovernment !== null;
    if (!hasGovernment && c.unMember !== true) government.length = 0;
    const economy: Row[] = [
      ['GDP', e.gdpUsd !== null ? withYear(fmt.compactUsd(e.gdpUsd), e.gdpYear) : null],
      ['GDP per capita', e.gdpPerCapitaUsd !== null ? fmt.usd(e.gdpPerCapitaUsd) : null],
      ['HDI', e.hdi !== null ? withYear(fmt.hdi(e.hdi), e.hdiYear) : null],
      ['Currency', currencies(c.currencies)],
      ['Calling code', c.callingCode],
    ];

    return [
      section('Geography', geography),
      section('People', people),
      section('Government', government),
      section('Economy', economy),
    ].filter((s): s is HTMLElement => s !== null);
  }

  private borders(ids: CountryId[]): Node | null {
    const named = ids
      .map((id) => ({ id, name: this.opts.nameOf(id) }))
      .filter((b): b is { id: CountryId; name: string } => b.name !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (named.length === 0) return null;
    const wrap = h('span', { class: 'borders' });
    named.forEach((b, i) => {
      const btn = h('button', { type: 'button', class: 'text-link' }, b.name);
      btn.addEventListener('click', () => this.opts.onSelectCountry(b.id));
      // Keep each comma on the line of its name; break only at the space after it.
      wrap.append(h('span', { class: 'border-item' }, btn, i < named.length - 1 ? ',' : ''));
      if (i < named.length - 1) wrap.append(' ');
    });
    return wrap;
  }

  private footer(c: CountryInfo): HTMLElement {
    return h(
      'footer',
      { class: 'panel-foot' },
      h('span', null, 'Data: Wikidata, World Bank, mledoze/countries'),
      c.wikipedia &&
        h('a', { href: c.wikipedia, target: '_blank', rel: 'noopener noreferrer' }, 'Wikipedia'),
    );
  }
}

function person(name: string | null, title: string | null): Node | null {
  if (!name) return null;
  return h('span', { class: 'person' }, h('span', null, name), title && h('span', { class: 'sub' }, title));
}

function currencies(list: CountryInfo['currencies']): string | null {
  if (list.length === 0) return null;
  return list
    .map((c) => {
      const extra = [c.symbol, c.code].filter(Boolean).join(', ');
      return extra ? `${c.name} (${extra})` : c.name;
    })
    .join('; ');
}

function section(title: string, rows: Row[]): HTMLElement | null {
  const present = rows.filter((r): r is [string, string | Node] => r[1] !== null && r[1] !== '');
  if (present.length === 0) return null;
  return h(
    'section',
    { class: 'facts' },
    h('h3', null, title),
    h('dl', null, present.map(([label, value]) => h('div', { class: 'row' }, h('dt', null, label), h('dd', null, value)))),
  );
}
