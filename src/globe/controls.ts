// Drag input: drag turns the view (lat/lng, north up), with inertia; wheel and pinch zoom.
// The controls only report gestures. Globe applies them.

export interface ControlEvents {
  /**
   * Turn for this frame of drag or inertia, in radians of arc at the view centre.
   * dx is to the right and dy is down: the surface moves with the pointer.
   */
  turn(dx: number, dy: number): void;
  /** Multiplies the zoom ratio (less than 1 = closer). */
  zoom(factor: number): void;
  /**
   * Click or tap with less than 5px of movement. The controls hold it for TAP_DELAY ms,
   * so a second quick tap turns the pair into a doubleTap and this never fires.
   */
  tap(clientX: number, clientY: number, pointerType: string): void;
  /** Two taps within DOUBLE_MS and DOUBLE_SLOP px. */
  doubleTap(clientX: number, clientY: number, pointerType: string): void;
  /** Mouse or pen moves over the canvas without a drag. Null when it leaves. */
  hover(clientX: number, clientY: number): void;
  leave(): void;
  /** A drag starts. clientX, clientY is the pointer-down point of the drag. */
  dragStart(clientX: number, clientY: number): void;
  dragEnd(): void;
  /** Any user input, so the idle timer restarts. */
  activity(): void;
  /** Radians of arc per pixel of drag at the current zoom. */
  radiansPerPixel(): number;
}

const TAP_SLOP = 5;
const DOUBLE_MS = 300; // max time between the two taps of a double tap
// ms that a single tap waits for a possible second tap. It equals DOUBLE_MS, so a single tap
// never fires inside the double-tap window (no select-then-reset flash).
const TAP_DELAY = DOUBLE_MS;
const NATIVE_DOUBLE_MS = 800; // a native dblclick later than this after the last tap is not ours
const DOUBLE_SLOP = 30; // max px between the two taps of a double tap
const DAMPING = 0.0045; // per ms: velocity *= exp(-DAMPING * dt)

interface Tracked {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
}

export class GlobeControls {
  private readonly el: HTMLElement;
  private readonly ev: ControlEvents;
  private readonly pointers = new Map<number, Tracked>();
  private dragging = false;
  private multiTouch = false;
  private pinchDistance = 0;
  private lastMoveTime = 0;
  // Turn velocity in radians per ms: vx to the right, vy down.
  private vx = 0;
  private vy = 0;
  // The last tap: a candidate first half of a double tap, or the end of one (consumed).
  private lastTap: { x: number; y: number; time: number; consumed: boolean } | null = null;
  private pendingTap = 0; // timer of the held single tap

  constructor(el: HTMLElement, events: ControlEvents) {
    this.el = el;
    this.ev = events;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('mousedown', this.onMouseDown);
    el.addEventListener('dblclick', this.onDblClick);
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  stopInertia(): void {
    this.vx = 0;
    this.vy = 0;
  }

  /** Drops a held single tap, so it never fires. */
  cancelPendingTap(): void {
    clearTimeout(this.pendingTap);
    this.pendingTap = 0;
  }

  /** Applies inertia. Returns true while the globe still moves. */
  update(dt: number): boolean {
    if (this.dragging || this.pointers.size > 0) return false;
    if (Math.hypot(this.vx, this.vy) < 1e-6) return false;
    this.ev.turn(this.vx * dt, this.vy * dt);
    const decay = Math.exp(-DAMPING * dt);
    this.vx *= decay;
    this.vy *= decay;
    return true;
  }

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('mousedown', this.onMouseDown);
    el.removeEventListener('dblclick', this.onDblClick);
    this.cancelPendingTap();
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType });
    this.stopInertia();
    this.lastMoveTime = performance.now();
    if (this.pointers.size === 2) {
      this.multiTouch = true;
      this.pinchDistance = this.currentPinchDistance();
      if (!this.dragging) {
        this.dragging = true;
        this.ev.dragStart(e.clientX, e.clientY);
      }
    }
    this.ev.activity();
  };

  private readonly onMove = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    // A plain hover is not activity: only a drag pauses the idle spin.
    if (p) this.ev.activity();
    if (!p) {
      if (e.pointerType !== 'touch') this.ev.hover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.pointers.size >= 2) {
      const d = this.currentPinchDistance();
      if (this.pinchDistance > 0 && d > 0) this.ev.zoom(this.pinchDistance / d);
      this.pinchDistance = d;
      return;
    }
    if (this.multiTouch) return; // one finger left after a pinch: wait for release

    if (!this.dragging && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) >= TAP_SLOP) {
      this.dragging = true;
      this.lastTap = null; // a drag ends any double-tap sequence
      this.ev.dragStart(p.startX, p.startY);
    }
    if (!this.dragging) return;
    if (dx === 0 && dy === 0) return;

    const k = this.ev.radiansPerPixel();
    const ax = dx * k;
    const ay = dy * k;
    this.ev.turn(ax, ay);

    const now = performance.now();
    const dt = Math.max(1, now - this.lastMoveTime);
    this.lastMoveTime = now;
    // Smooth the velocity a little so one jittery event does not decide the throw.
    this.vx += (ax / dt - this.vx) * 0.6;
    this.vy += (ay / dt - this.vy) * 0.6;
  };

  private readonly onUp = (e: PointerEvent) => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
    this.ev.activity();

    if (this.pointers.size > 0) return;
    const wasDragging = this.dragging;
    const wasMulti = this.multiTouch;
    this.dragging = false;
    this.multiTouch = false;
    if (wasDragging) {
      // A pause before release means no throw.
      if (performance.now() - this.lastMoveTime > 80 || wasMulti) this.stopInertia();
      this.ev.dragEnd();
    } else if (!wasMulti) {
      this.onTap(e.clientX, e.clientY, p.type);
    } else {
      this.lastTap = null;
    }
    if (e.pointerType !== 'touch') this.ev.hover(e.clientX, e.clientY);
  };

  private readonly onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      const wasDragging = this.dragging;
      this.dragging = false;
      this.multiTouch = false;
      this.stopInertia();
      if (wasDragging) this.ev.dragEnd();
    }
  };

  private readonly onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && !this.pointers.has(e.pointerId)) this.ev.leave();
  };

  private onTap(x: number, y: number, type: string): void {
    const now = performance.now();
    const last = this.lastTap;
    const quick = last !== null && now - last.time <= DOUBLE_MS && Math.hypot(x - last.x, y - last.y) <= DOUBLE_SLOP;
    if (quick && last.consumed) {
      // A third quick tap after a double tap: ignore it, so a triple click does not select.
      last.time = now;
      return;
    }
    if (quick) {
      this.cancelPendingTap();
      this.lastTap = { x, y, time: now, consumed: true };
      this.ev.doubleTap(x, y, type);
      return;
    }
    this.cancelPendingTap();
    this.lastTap = { x, y, time: now, consumed: false };
    this.pendingTap = window.setTimeout(() => {
      this.pendingTap = 0;
      this.ev.tap(x, y, type);
    }, TAP_DELAY);
  }

  // A double click must not select text next to the canvas.
  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.detail > 1) e.preventDefault();
  };

  // The OS double-click interval (about 500 ms on macOS) can be longer than DOUBLE_MS. Then the
  // second click arrives as a new single tap. The native dblclick turns that pair into a doubleTap.
  private readonly onDblClick = (e: MouseEvent) => {
    e.preventDefault();
    const last = this.lastTap;
    if (last === null || last.consumed) return; // onTap already reported this pair as a doubleTap.
    if (performance.now() - last.time > NATIVE_DOUBLE_MS) return;
    this.cancelPendingTap();
    last.consumed = true;
    this.ev.doubleTap(e.clientX, e.clientY, 'mouse');
  };

  private readonly onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.ev.activity();
    // Pixel deltas from trackpads, line deltas from some mice.
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const speed = e.ctrlKey ? 0.01 : 0.0015; // ctrlKey = trackpad pinch
    this.ev.zoom(Math.exp(Math.max(-100, Math.min(100, e.deltaY * scale)) * speed));
  };

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
