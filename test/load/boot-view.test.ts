// The view preference at boot: index.html sets html[data-view] before first paint, with no new request,
// and the flat map loads only through import(), so a globe visitor does not download it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const indexHtml = read('index.html');
const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const firstScript = scripts[0];

describe('index.html boot script', () => {
  it('reads worldly:view in the same try block as the other preferences', () => {
    const tryBlock = firstScript.match(/try\s*\{([\s\S]*?)\}\s*catch/)?.[1] ?? '';
    expect(tryBlock).toContain("localStorage.getItem('worldly:view')");
    expect(tryBlock).toContain("localStorage.getItem('worldly:style')");
  });

  it('sets data-view with the globe as the default', () => {
    expect(firstScript).toMatch(/d\.dataset\.view = v === 'map' \? 'map' : 'globe';/);
  });

  it('starts no request in the preference script', () => {
    expect(firstScript).not.toMatch(/fetch\(|import\(|<link/);
  });

  it('the data script reads no view preference', () => {
    expect(scripts[1]).not.toContain('worldly:view');
  });
});

describe('the map chunk', () => {
  const files = ['src/main.ts', 'src/view/ViewHost.ts'];

  it.each(files)('%s reaches src/map only through import()', (file) => {
    const src = read(file);
    const staticImports = [...src.matchAll(/^\s*(?:import|export)\b[^;]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const spec of staticImports) expect(spec).not.toMatch(/(^|\/)map(\/|$)/);
  });

  it('ViewHost loads ../map with a dynamic import', () => {
    expect(read('src/view/ViewHost.ts')).toMatch(/import\('\.\.\/map'\)/);
  });

  it('main.ts starts the map chunk early when data-view is map', () => {
    expect(read('src/main.ts')).toMatch(/dataset\.view === 'map'\) void loadMap\(\)/);
  });

  it('no module of the main chunk imports src/map statically', () => {
    // Walk the static value imports from src/main.ts. An import() and an "import type" do not count.
    const seen = new Set<string>();
    const resolve = (from: string, spec: string): string | null => {
      if (!spec.startsWith('.')) return null; // a package
      const base = join(dirname(from), spec);
      for (const f of [base, `${base}.ts`, join(base, 'index.ts')]) if (existsSync(join(root, f)) && f.endsWith('.ts')) return f;
      return null;
    };
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = read(file);
      for (const m of src.matchAll(/^\s*(import|export)\s+(?!type\b)([^;]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
        const names = m[2].match(/^\{([^}]*)\}$/)?.[1];
        // "import { type A, type B } from" brings in no value.
        if (names !== undefined && names.split(',').every((n) => !n.trim() || /^type\s/.test(n.trim()))) continue;
        const next = resolve(file, m[3]);
        if (next) walk(next);
      }
      for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
        const next = resolve(file, m[1]);
        if (next) walk(next);
      }
    };
    walk('src/main.ts');
    expect(seen.has('src/globe/Globe.ts')).toBe(true);
    expect(seen.has('src/view/ViewHost.ts')).toBe(true);
    expect([...seen].filter((f) => f.startsWith('src/map/'))).toEqual([]);
  });
});
