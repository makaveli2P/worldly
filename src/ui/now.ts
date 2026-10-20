// "Now" block of the details plate: the local time and the current weather at the capital.
// The clock starts at once from the country's zone list. The Open-Meteo response then gives the
// IANA zone (DST-correct) and the weather. If the weather fails, the block shows the time only.

import type { CountryInfo } from '../types';
import { capitalTimeZone, clockFace, guessOffset, msToNextMinute, type Zone } from '../now/clock';
import { cachedWeather, getCurrentWeather, knownTimeZone, type CurrentWeather } from '../now/weather';
import { weatherText } from '../now/wmo';
import { h } from './dom';

type WeatherState = { kind: 'loading' } | { kind: 'ready'; w: CurrentWeather } | { kind: 'failed' };

interface Place {
  key: string; // country id: the cache key
  city: string | null;
  lat: number | null;
  lng: number | null;
}

export class NowBlock {
  /** The block. DetailsPanel puts it under the name. It is hidden when there is nothing to show. */
  readonly el: HTMLElement;
  private readonly place: HTMLElement;
  private readonly time: HTMLTimeElement;
  private readonly day: HTMLElement;
  private readonly offset: HTMLElement;
  private readonly weather: HTMLElement;

  private current: Place | null = null;
  private zone: Zone | null = null;
  private state: WeatherState = { kind: 'loading' };
  private timer: number | null = null;
  private abort: AbortController | null = null;

  constructor() {
    this.place = h('span', { class: 'now-place' });
    this.time = h('time', { class: 'now-fig num' });
    this.day = h('span');
    this.offset = h('span', { class: 'num' });
    this.weather = h('div', { class: 'now-cell now-wx' });
    this.el = h(
      'section',
      { class: 'sec now', hidden: true },
      h('h3', { class: 'sec-h now-h' }, h('span', null, 'Now'), this.place),
      h(
        'div',
        { class: 'now-grid' },
        h(
          'div',
          { class: 'now-cell now-clock' },
          this.time,
          h('p', { class: 'now-sub' }, this.day),
          h('p', { class: 'now-meta' }, this.offset),
        ),
        this.weather,
      ),
    );
    document.addEventListener('visibilitychange', () => {
      // Background tabs throttle timers: catch up when the tab shows again.
      if (document.visibilityState === 'visible' && this.current) this.tick();
    });
  }

  /** Shows the block for a country and starts the clock. Returns false when the block has nothing to show. */
  show(info: CountryInfo): boolean {
    const point = info.capitalLatLng ?? info.latlng;
    const place: Place = {
      key: info.id,
      city: info.capital[0] ?? null,
      lat: point ? point[0] : null,
      lng: point ? point[1] : null,
    };
    const same = this.current?.key === place.key;
    this.stop();
    this.current = place;

    const iana = knownTimeZone(place.key) ?? capitalTimeZone(place.key, place.city, info.timezones);
    const guess = guessOffset(info.timezones, place.lng);
    if (!same || !this.zone) this.zone = iana ? { timeZone: iana, offsetMinutes: guess ?? 0 } : guess !== null ? { timeZone: null, offsetMinutes: guess } : null;

    this.place.textContent = place.city ? `in ${place.city}` : 'local time';
    this.el.setAttribute('aria-label', place.city ? `Now in ${place.city}` : 'Now, local time');

    const hit = cachedWeather(place.key);
    if (hit) this.state = { kind: 'ready', w: hit };
    else if (!same || this.state.kind !== 'ready') this.state = place.lat !== null ? { kind: 'loading' } : { kind: 'failed' };
    if (!hit && place.lat !== null) this.load(place);

    this.render();
    this.schedule();
    return !this.el.hidden;
  }

  /** Stops the clock and any request in flight. Call it when the panel closes. */
  hide(): void {
    this.stop();
    this.current = null;
  }

  private stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
  }

  private load(place: Place): void {
    const ctrl = new AbortController();
    this.abort = ctrl;
    getCurrentWeather(place.key, place.lat!, place.lng!, ctrl.signal).then(
      (w) => {
        if (ctrl.signal.aborted || this.current?.key !== place.key) return;
        this.abort = null;
        this.zone = { timeZone: w.timeZone, offsetMinutes: Math.round(w.utcOffsetSeconds / 60) };
        this.state = { kind: 'ready', w };
        this.render();
      },
      () => {
        if (ctrl.signal.aborted || this.current?.key !== place.key) return;
        this.abort = null;
        // Keep weather that is already on screen (a refresh failed); else show the time only.
        if (this.state.kind !== 'ready') this.state = { kind: 'failed' };
        this.render();
      },
    );
  }

  /** Re-renders on each whole minute. The weather refreshes when the cache entry expires. */
  private schedule(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.tick(), msToNextMinute(Date.now()) + 50);
  }

  private tick(): void {
    const place = this.current;
    if (!place) return;
    if (place.lat !== null && !this.abort && !cachedWeather(place.key)) this.load(place);
    this.renderClock();
    this.schedule();
  }

  private render(): void {
    const hasClock = this.zone !== null;
    const s = this.state;
    // Nothing known yet and nothing coming: hide the block.
    this.el.hidden = !hasClock && s.kind === 'failed';
    this.el.toggleAttribute('data-no-weather', s.kind === 'failed');
    this.renderClock();
    this.renderWeather();
  }

  private renderClock(): void {
    const cell = this.time.parentElement!;
    if (!this.zone) {
      cell.toggleAttribute('data-loading', true);
      this.time.textContent = '--:--';
      this.day.textContent = '';
      this.offset.textContent = '';
      return;
    }
    cell.toggleAttribute('data-loading', false);
    const face = clockFace(new Date(), this.zone);
    this.time.textContent = face.time;
    this.day.textContent = `${face.weekday}, ${face.date}`;
    this.time.dateTime = face.time;
    this.offset.textContent = face.offset;
  }

  private renderWeather(): void {
    const s = this.state;
    if (s.kind === 'failed') {
      this.weather.replaceChildren();
      return;
    }
    if (s.kind === 'loading') {
      this.weather.replaceChildren(
        h('span', { class: 'sk sk--fig', 'aria-hidden': 'true' }),
        h('span', { class: 'sk sk--sub', 'aria-hidden': 'true' }),
        h('span', { class: 'sr-only' }, 'Loading the weather'),
      );
      return;
    }
    const w = s.w;
    const text = weatherText(w.code, w.isDay);
    this.weather.replaceChildren(
      h(
        'p',
        { class: 'now-fig num' },
        degrees(w.tempC),
        h('span', { class: 'now-unit' }, '°C'),
        h('span', { class: 'now-alt' }, ` ${degrees(toF(w.tempC))}°F`),
      ),
      h('p', { class: 'now-sub now-cond' }, text ?? 'Current weather'),
      h(
        'p',
        { class: 'now-meta' },
        h('span', null, 'Feels ', h('span', { class: 'num' }, `${degrees(w.feelsC)}°`)),
        h('span', null, 'Wind ', h('span', { class: 'num' }, String(Math.round(w.windKmh))), h('span', { class: 'u' }, ' km/h')),
      ),
    );
  }
}

/** 21.6 -> "22"; -3.2 -> "−3"; -0.4 -> "0". */
function degrees(c: number): string {
  const r = Math.round(c);
  return r < 0 ? `−${-r}` : String(r === 0 ? 0 : r);
}

function toF(c: number): number {
  return (c * 9) / 5 + 32;
}
