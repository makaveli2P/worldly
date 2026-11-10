// Polls GET /api/breaking every 5 minutes while the page is visible, and every 15 minutes while it is
// hidden (so that the title badge can show a new alert). A failed poll keeps the last good list and writes
// nothing to the UI or the console. After 3 failures in a row it polls every 15 minutes.

import type { BreakingAlert } from '../types';
import { REFRESH_ON_SHOW_MS, nextPollDelay, parseBreakingResponse } from './alerts-model';

const TIMEOUT_MS = 8000;

export interface BreakingFeedOptions {
  /** Called after each good poll, also with [] on a quiet day. Not called on a failure. */
  onAlerts: (alerts: BreakingAlert[]) => void;
  /** Replaces the network fetch (the DEV mock). Resolves to the response body. */
  source?: (signal: AbortSignal) => Promise<unknown>;
  url?: string;
}

/** Starts the poll at once. Returns a stop function. */
export function startBreakingFeed(opts: BreakingFeedOptions): () => void {
  const url = opts.url ?? '/api/breaking';
  const source =
    opts.source ??
    (async (signal: AbortSignal) => {
      const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      return res.json() as Promise<unknown>;
    });

  let timer = 0;
  let failures = 0;
  let lastPoll = -Infinity;
  let inflight: AbortController | null = null;
  let stopped = false;

  const schedule = (): void => {
    clearTimeout(timer);
    timer = 0;
    if (stopped) return;
    timer = window.setTimeout(poll, nextPollDelay(failures, Math.random(), document.visibilityState === 'hidden'));
  };

  async function poll(): Promise<void> {
    if (stopped || inflight) return;
    const ctrl = new AbortController();
    inflight = ctrl;
    lastPoll = performance.now();
    const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let alerts: BreakingAlert[] | null = null;
    try {
      alerts = parseBreakingResponse(await source(ctrl.signal));
    } catch {
      // Network error, timeout, non-2xx or bad JSON: keep the last good list, stay quiet.
    } finally {
      clearTimeout(t);
      inflight = null;
    }
    failures = alerts ? 0 : failures + 1;
    schedule();
    if (!alerts || stopped) return;
    // The UI callback runs outside the try: a UI error is not a network failure, and it must not be silent.
    try {
      opts.onAlerts(alerts);
    } catch (err) {
      queueMicrotask(() => {
        throw err;
      });
    }
  }

  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      // A visible-rate timer becomes a hidden-rate timer.
      schedule();
    } else if (performance.now() - lastPoll > REFRESH_ON_SHOW_MS) {
      void poll();
    } else {
      schedule();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  void poll();

  return () => {
    stopped = true;
    clearTimeout(timer);
    inflight?.abort();
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
