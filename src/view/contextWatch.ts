// The WebGL context loss of one view (the globe or the flat map), and its recovery.
// A GPU reset or too little GPU memory can make the browser take the context away. The view then stops its
// frame loop and keeps its state. three.js makes its GPU objects again when the browser restores the context,
// and the view starts its loop again. If the browser does not restore the context in RESTORE_WAIT_MS,
// main.ts shows a message (GL_LOST_EVENT). Chromium can block WebGL for the site after a loss that the
// page does not handle, until the browser restarts: thus the view always asks for the restore.

import type { ViewKind } from './types';

/** The time to wait for the restore before the page shows the message. */
export const RESTORE_WAIT_MS = 4000;
/** On window: the context of the active view is lost, and the browser did not restore it. detail: { view: ViewKind }. */
export const GL_LOST_EVENT = 'worldly:gl-lost';
/** On window: the view that sent GL_LOST_EVENT draws again, or it is gone. */
export const GL_OK_EVENT = 'worldly:gl-ok';

let lostInPage = false;

/** True after a real context loss in this page. The page then does not load the 8192 tier again. */
export function contextLostInPage(): boolean {
  return lostInPage;
}

export interface ContextWatchHandlers {
  /** Stop the frame loop and the texture uploads. Keep the state. */
  lost(): void;
  /** three.js made its GPU state again. Start the frame loop and render. */
  restored(): void;
}

export class ContextWatch {
  /** True from the loss to the restore. The view does not render in this time. */
  lost = false;
  private timer = 0;
  private told = false; // this watch sent GL_LOST_EVENT
  private stopped = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: ViewKind,
    private readonly handlers: ContextWatchHandlers,
  ) {
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
  }

  /**
   * Removes the listeners. Call it in dispose() before forceContextLoss(): the forced loss of a view
   * that goes away then starts no recovery and no message. If this view sent the message, the message goes.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    clearTimeout(this.timer);
    this.timer = 0;
    this.clearMessage();
  }

  private readonly onLost = (e: Event): void => {
    // Without preventDefault() the browser does not restore the context.
    e.preventDefault();
    if (this.stopped || this.lost) return;
    this.lost = true;
    lostInPage = true;
    console.warn(`[worldly] WebGL context lost (${this.view})`);
    this.handlers.lost();
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      if (this.stopped || !this.lost) return;
      this.told = true;
      window.dispatchEvent(new CustomEvent(GL_LOST_EVENT, { detail: { view: this.view } }));
    }, RESTORE_WAIT_MS);
  };

  private readonly onRestored = (): void => {
    if (this.stopped || !this.lost) return;
    this.lost = false;
    clearTimeout(this.timer);
    this.timer = 0;
    console.warn(`[worldly] WebGL context restored (${this.view})`);
    this.handlers.restored();
    this.clearMessage();
  };

  private clearMessage(): void {
    if (!this.told) return;
    this.told = false;
    window.dispatchEvent(new Event(GL_OK_EVENT));
  }
}
