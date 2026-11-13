// @vitest-environment happy-dom
// The view host (src/view/ViewHost.ts) with fake views: no WebGL. It checks what a switch carries,
// the frame listeners, the crossfade, the boot texture and the races with the map import.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobeOptions } from '../../src/globe/Globe';
import { ViewHost, type ViewConstructor, type ViewSources } from '../../src/view/ViewHost';
import type { Insets, TextureHandover, ViewKind, ViewOptions, ViewState, WorldView } from '../../src/view/types';

const made: FakeView[] = [];

class FakeView implements WorldView {
  readonly canvas = document.createElement('canvas');
  readonly listeners = new Set<() => void>();
  readonly calls: string[] = [];
  disposed = false;
  texturesTaken = 0;
  state: ViewState = { lat: 10, lng: 20, kmPerPx: null };
  texture: TextureHandover | null = null;

  constructor(
    readonly kind: ViewKind,
    readonly opts: ViewOptions,
  ) {
    made.push(this);
    opts.container.append(this.canvas);
  }

  /** Runs one rendered frame: the view calls its frame listeners. */
  frame(): void {
    for (const cb of [...this.listeners]) cb();
  }

  onFrame(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  setSelected(id: string | null) {
    this.calls.push(`sel:${id}`);
  }
  setPreview(id: string | null) {
    this.calls.push(`preview:${id}`);
  }
  focus(ll: [number, number]) {
    this.calls.push(`focus:${ll.join(',')}`);
  }
  resetView() {
    this.calls.push('reset');
  }
  setViewportInsets(i: Insets) {
    this.calls.push(`insets:${i.left}`);
  }
  setMapStyle(s: string) {
    this.calls.push(`style:${s}`);
  }
  setTheme(t: string) {
    this.calls.push(`theme:${t}`);
  }
  focusCanvas() {
    this.canvas.tabIndex = -1;
    this.canvas.focus();
  }
  project() {
    return { x: 1, y: 2, visible: true, facing: 1 };
  }
  getView() {
    return { lat: this.state.lat, lng: this.state.lng, altitudeKm: 1000, distance: 1.2 };
  }
  rect() {
    return new DOMRect();
  }
  screenRadius() {
    return 0;
  }
  selectedAnchor(): [number, number] | null {
    return null;
  }
  getState() {
    return this.state;
  }
  takeTexture() {
    this.texturesTaken++;
    return this.texture;
  }
  dispose() {
    this.disposed = true;
    this.canvas.remove();
  }
}

const ctor = (kind: ViewKind): ViewConstructor =>
  class extends FakeView {
    constructor(opts: ViewOptions) {
      super(kind, opts);
    }
  };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let container: HTMLElement;
let opts: GlobeOptions;
const sources = (map: ViewSources['map'] = () => ctor('map')): ViewSources => ({ globe: () => ctor('globe'), map });
const flush = () => new Promise<void>((r) => queueMicrotask(r)).then(() => undefined);

beforeEach(() => {
  made.length = 0;
  container = document.createElement('div');
  document.body.append(container);
  opts = {
    container,
    features: [],
    onHover: () => {},
    onSelect: () => {},
    mapStyle: 'atlas',
    theme: 'dark',
    firstTexture: { url: '/t.avif', blob: Promise.resolve(null) },
  };
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  container.remove();
});

describe('ViewHost', () => {
  it('carries the selection, preview, insets, style, theme, state and texture to the new view', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    const globe = made[0];
    const image = {} as ImageBitmap;
    globe.state = { lat: 46, lng: 2, kmPerPx: 3.2 };
    globe.texture = { level: 1, image };
    host.setSelected('FRA');
    host.setPreview('ITA');
    host.setViewportInsets({ left: 360, right: 360, top: 56, bottom: 48 });
    host.setMapStyle('satellite');
    host.setTheme('light');
    await host.switchTo('map');
    const map = made[1];
    expect(host.kind).toBe('map');
    expect(map.opts.mapStyle).toBe('satellite');
    expect(map.opts.theme).toBe('light');
    expect(map.opts.initial).toEqual({
      state: { lat: 46, lng: 2, kmPerPx: 3.2 },
      insets: { left: 360, right: 360, top: 56, bottom: 48 },
      selected: 'FRA',
      preview: 'ITA',
      texture: { level: 1, image },
    });
    // Later calls go to the new view only.
    host.focus([46, 2]);
    expect(map.calls).toContain('focus:46,2');
    expect(globe.calls).not.toContain('focus:46,2');
  });

  it('a reset clears the selection that the next view gets', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    host.setSelected('FRA');
    host.resetView();
    await host.switchTo('map');
    expect(made[1].opts.initial?.selected).toBeNull();
  });

  it('moves the frame listeners: the overlay subscribes one time', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    const cb = vi.fn();
    host.onFrame(cb);
    const globe = made[0];
    expect(globe.listeners.size).toBe(1);
    globe.frame();
    expect(cb).toHaveBeenCalledTimes(1);
    await host.switchTo('map');
    const map = made[1];
    expect(globe.listeners.size).toBe(0);
    globe.frame();
    expect(cb).toHaveBeenCalledTimes(1);
    map.frame();
    expect(cb).toHaveBeenCalledTimes(2);
    // After the first frame only the dispatcher of the host stays on the view.
    expect(map.listeners.size).toBe(1);
  });

  it('a failed listener does not stop the others', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const cb = vi.fn();
    host.onFrame(() => {
      throw new Error('boom');
    });
    host.onFrame(cb);
    made[0].frame();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('fades the new view in on its first frame, then disposes the old view', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    await host.switchTo('map');
    const [globe, map] = made;
    expect(map.canvas.style.opacity).toBe('0');
    vi.advanceTimersByTime(1000);
    // No frame yet: the old view stays.
    expect(globe.disposed).toBe(false);
    map.frame();
    expect(map.canvas.style.opacity).toBe('1');
    expect(globe.disposed).toBe(false);
    vi.advanceTimersByTime(199);
    expect(globe.disposed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(globe.disposed).toBe(true);
    expect(container.querySelectorAll('canvas').length).toBe(1);
  });

  it('gives the boot texture only to the first view', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    expect(made[0].opts.firstTexture).toBe(opts.firstTexture);
    await host.switchTo('map');
    expect(made[1].opts.firstTexture).toBeUndefined();
    await host.switchTo('globe');
    expect(made[2].opts.firstTexture).toBeUndefined();
  });

  it('takes the texture only when the map module is in', async () => {
    const d = deferred<ViewConstructor>();
    const host = await ViewHost.create('globe', opts, sources(() => d.promise));
    const globe = made[0];
    const done = host.switchTo('map');
    await flush();
    expect(globe.texturesTaken).toBe(0);
    d.resolve(ctor('map'));
    await done;
    expect(globe.texturesTaken).toBe(1);
    expect(made.length).toBe(2);
  });

  it('a second toggle during the import wins, with no leaked view', async () => {
    const d = deferred<ViewConstructor>();
    const host = await ViewHost.create('globe', opts, sources(() => d.promise));
    const globe = made[0];
    const first = host.switchTo('map');
    const second = host.switchTo('globe');
    d.resolve(ctor('map'));
    await Promise.all([first, second]);
    expect(made.length).toBe(1);
    expect(host.kind).toBe('globe');
    expect(globe.texturesTaken).toBe(0);
    expect(globe.disposed).toBe(false);
  });

  it('map, globe, map during the import makes one map', async () => {
    const d = deferred<ViewConstructor>();
    const host = await ViewHost.create('globe', opts, sources(() => d.promise));
    const calls = [host.switchTo('map'), host.switchTo('globe'), host.switchTo('map')];
    d.resolve(ctor('map'));
    await Promise.all(calls);
    expect(made.map((v) => v.kind)).toEqual(['globe', 'map']);
    expect(host.kind).toBe('map');
    made[1].frame();
    vi.advanceTimersByTime(200);
    expect(made[0].disposed).toBe(true);
    expect(made[1].disposed).toBe(false);
  });

  it('a toggle during the crossfade disposes the old view at once', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    await host.switchTo('map');
    const [globe, map] = made;
    map.frame();
    expect(globe.disposed).toBe(false);
    await host.switchTo('globe');
    expect(globe.disposed).toBe(true);
    const globe2 = made[2];
    expect(host.kind).toBe('globe');
    expect(map.disposed).toBe(false);
    globe2.frame();
    vi.advanceTimersByTime(200);
    expect(map.disposed).toBe(true);
    expect(made.filter((v) => !v.disposed)).toEqual([globe2]);
  });

  it('moves the keyboard focus to the new canvas', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    host.focusCanvas();
    expect(document.activeElement).toBe(made[0].canvas);
    await host.switchTo('map');
    expect(document.activeElement).toBe(made[1].canvas);
  });

  it('shows the globe when the map does not load', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const host = await ViewHost.create('map', opts, sources(() => Promise.reject(new Error('offline'))));
    expect(host.kind).toBe('globe');
    expect(made[0].opts.firstTexture).toBe(opts.firstTexture);
    // The result tells the caller to set the toggle back to the globe.
    expect(await host.switchTo('map')).toBe('globe');
    expect(host.kind).toBe('globe');
    expect(made.length).toBe(1);
    warn.mockRestore();
  });

  it('gives the kind on screen as the result of a switch', async () => {
    const d = deferred<ViewConstructor>();
    const host = await ViewHost.create('globe', opts, sources(() => d.promise));
    const first = host.switchTo('map');
    const second = host.switchTo('map');
    d.resolve(ctor('map'));
    // The first call lost to the second: null, so the caller does not set the toggle from it.
    expect(await first).toBe(null);
    expect(await second).toBe('map');
    expect(await host.switchTo('map')).toBe('map');
  });

  it('gives the old kind when the new view fails to start', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const Broken = class {
      constructor() {
        throw new Error('no WebGL');
      }
    } as unknown as ViewConstructor;
    const host = await ViewHost.create('globe', opts, sources(() => Broken));
    expect(await host.switchTo('map')).toBe('globe');
    expect(host.kind).toBe('globe');
    error.mockRestore();
  });

  it('a switch during a focus flight gives the new view the end of the flight and its focus point', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    host.setSelected('JPN');
    made[0].state = { lat: 36, lng: 138, kmPerPx: 2, focus: [36, 138] };
    await host.switchTo('map');
    expect(made[1].opts.initial?.state).toEqual({ lat: 36, lng: 138, kmPerPx: 2, focus: [36, 138] });
    expect(made[1].opts.initial?.selected).toBe('JPN');
  });

  it('forwards surface and groundScale with defaults for the globe', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    expect(host.surface()).toBeNull();
    expect(host.groundScale(60)).toBe(1);
  });

  it('dispose removes every view', async () => {
    const host = await ViewHost.create('globe', opts, sources());
    await host.switchTo('map');
    host.dispose();
    expect(made.every((v) => v.disposed)).toBe(true);
  });
});
