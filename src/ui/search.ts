// Country search: a combobox in the top right. "/" focuses it. A keyboard path to every country.

import type { CountryId } from '../types';
import { h } from './dom';

const MAX_RESULTS = 8;

interface Entry {
  id: CountryId;
  name: string;
  key: string; // folded name
}

export interface CountrySearchOptions {
  countries: { id: CountryId; name: string }[];
  onSelect: (id: CountryId) => void;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export class CountrySearch {
  readonly el: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private readonly entries: Entry[];
  private results: Entry[] = [];
  private active = -1;

  constructor(
    root: HTMLElement,
    private readonly opts: CountrySearchOptions,
  ) {
    this.entries = opts.countries
      .map((c) => ({ id: c.id, name: c.name, key: fold(c.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    this.input = h('input', {
      class: 'search-input',
      type: 'text',
      placeholder: 'Search countries',
      'aria-label': 'Search countries',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': 'false',
      'aria-controls': 'search-list',
      autocomplete: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
    });
    this.list = h('ul', { class: 'search-list', id: 'search-list', role: 'listbox', 'aria-label': 'Countries' });
    const key = h('kbd', { class: 'search-key', 'aria-hidden': 'true' }, '/');
    this.el = h('div', { class: 'search' }, this.input, key, this.list);
    // Before the panels, so the Tab order is search, then panels.
    root.insertBefore(this.el, root.querySelector('.panels'));

    this.input.addEventListener('input', () => this.update());
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => this.close());
    // mousedown, not click: the input must not lose focus before the choice is made.
    this.list.addEventListener('mousedown', (e) => e.preventDefault());
    this.list.addEventListener('click', (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (li) this.choose(li.dataset.id!);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      e.preventDefault();
      this.input.focus();
    });
  }

  private update(): void {
    const q = fold(this.input.value);
    if (!q) {
      this.results = [];
    } else {
      const starts: Entry[] = [];
      const words: Entry[] = [];
      const inside: Entry[] = [];
      for (const e of this.entries) {
        if (e.key.startsWith(q) || e.id.toLowerCase() === q) starts.push(e);
        else if (e.key.includes(` ${q}`)) words.push(e);
        else if (e.key.includes(q)) inside.push(e);
      }
      this.results = [...starts, ...words, ...inside].slice(0, MAX_RESULTS);
    }
    this.active = this.results.length ? 0 : -1;
    this.render();
  }

  private render(): void {
    const items = this.results.map((e, i) =>
      h(
        'li',
        { id: `search-opt-${i}`, role: 'option', 'data-id': e.id, 'aria-selected': String(i === this.active) },
        e.name,
      ),
    );
    if (this.input.value.trim() && !items.length) {
      items.push(h('li', { class: 'search-empty', role: 'option', 'aria-disabled': 'true' }, 'No match'));
    }
    this.list.replaceChildren(...items);
    const open = items.length > 0;
    this.el.toggleAttribute('data-open', open);
    this.input.setAttribute('aria-expanded', String(open));
    if (this.active >= 0) this.input.setAttribute('aria-activedescendant', `search-opt-${this.active}`);
    else this.input.removeAttribute('aria-activedescendant');
  }

  private onKey(e: KeyboardEvent): void {
    const n = this.results.length;
    if (e.key === 'ArrowDown' && n) {
      e.preventDefault();
      this.active = (this.active + 1) % n;
      this.render();
    } else if (e.key === 'ArrowUp' && n) {
      e.preventDefault();
      this.active = (this.active - 1 + n) % n;
      this.render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = this.results[Math.max(0, this.active)];
      if (pick) this.choose(pick.id);
    } else if (e.key === 'Escape') {
      // First Esc clears the search. With an empty field, Esc goes on to close the panels.
      if (this.input.value) {
        e.stopPropagation();
        this.input.value = '';
        this.update();
      } else {
        this.input.blur();
      }
    }
  }

  private choose(id: CountryId): void {
    this.input.value = '';
    this.close();
    this.opts.onSelect(id);
  }

  private close(): void {
    this.results = [];
    this.active = -1;
    this.render();
  }
}
