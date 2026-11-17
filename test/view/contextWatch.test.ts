// @vitest-environment happy-dom
// The context loss and the restore of one view (src/view/contextWatch.ts), with events on a plain canvas.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextWatch, GL_LOST_EVENT, GL_OK_EVENT, RESTORE_WAIT_MS, contextLostInPage } from '../../src/view/contextWatch';

const lose = (c: HTMLCanvasElement): Event => {
  const e = new Event('webglcontextlost', { cancelable: true });
  c.dispatchEvent(e);
  return e;
};
const restore = (c: HTMLCanvasElement) => c.dispatchEvent(new Event('webglcontextrestored'));

describe('ContextWatch', () => {
  let canvas: HTMLCanvasElement;
  let calls: string[];
  let messages: string[];
  const onLost = () => messages.push('lost');
  const onOk = () => messages.push('ok');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    canvas = document.createElement('canvas');
    calls = [];
    messages = [];
    window.addEventListener(GL_LOST_EVENT, onLost);
    window.addEventListener(GL_OK_EVENT, onOk);
  });
  afterEach(() => {
    window.removeEventListener(GL_LOST_EVENT, onLost);
    window.removeEventListener(GL_OK_EVENT, onOk);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const make = () => new ContextWatch(canvas, 'globe', { lost: () => calls.push('lost'), restored: () => calls.push('restored') });

  it('asks the browser for a restore, stops the view, and starts it again on the restore', () => {
    const w = make();
    const e = lose(canvas);
    expect(e.defaultPrevented).toBe(true);
    expect(w.lost).toBe(true);
    expect(calls).toEqual(['lost']);
    expect(contextLostInPage()).toBe(true);
    vi.advanceTimersByTime(1000);
    restore(canvas);
    expect(w.lost).toBe(false);
    expect(calls).toEqual(['lost', 'restored']);
    // A restore in time: no message.
    vi.advanceTimersByTime(RESTORE_WAIT_MS * 2);
    expect(messages).toEqual([]);
  });

  it('sends the message when the restore does not come, and removes it after a late restore', () => {
    make();
    lose(canvas);
    vi.advanceTimersByTime(RESTORE_WAIT_MS - 1);
    expect(messages).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(messages).toEqual(['lost']);
    restore(canvas);
    expect(messages).toEqual(['lost', 'ok']);
  });

  it('ignores the forced loss after stop() (dispose of a view at a switch)', () => {
    const w = make();
    w.stop();
    lose(canvas);
    restore(canvas);
    vi.advanceTimersByTime(RESTORE_WAIT_MS * 2);
    expect(calls).toEqual([]);
    expect(messages).toEqual([]);
  });

  it('sends no message for a view that goes before the wait ends (the old view of a switch)', () => {
    const w = make();
    lose(canvas);
    vi.advanceTimersByTime(200);
    w.stop();
    vi.advanceTimersByTime(RESTORE_WAIT_MS * 2);
    expect(messages).toEqual([]);
  });

  it('removes its message when the lost view goes', () => {
    const w = make();
    lose(canvas);
    vi.advanceTimersByTime(RESTORE_WAIT_MS);
    w.stop();
    expect(messages).toEqual(['lost', 'ok']);
  });

  it('a second loss event before the restore does not stop the view twice', () => {
    make();
    lose(canvas);
    lose(canvas);
    expect(calls).toEqual(['lost']);
  });
});
