// Trackball input: drag rotates the globe about any axis, with inertia; wheel and pinch zoom.
// The controls only report gestures. Globe applies them.

import { Quaternion, Vector3 } from 'three';

export interface ControlEvents {
  /** Rotation in world space for this frame of drag. */
  rotate(delta: Quaternion): void;
  /** Multiplies the zoom ratio (less than 1 = closer). */
  zoom(factor: number): void;
  /** Click or tap with less than 5px of movement. */
  tap(clientX: number, clientY: number, pointerType: string): void;
  /** Mouse or pen moves over the canvas without a drag. Null when it leaves. */
  hover(clientX: number, clientY: number): void;
  leave(): void;
  dragStart(): void;
  dragEnd(): void;
  /** Any user input, so the idle timer restarts. */
  activity(): void;
  /** Radians of rotation per pixel of drag at the current zoom. */
  radiansPerPixel(): number;
}

const TAP_SLOP = 5;
const DAMPING = 0.0045; // per ms: velocity *= exp(-DAMPING * dt)

interface Tracked {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
}

export class TrackballControls {
  private readonly el: HTMLElement;
  private readonly ev: ControlEvents;
  private readonly pointers = new Map<number, Tracked>();
  private dragging = false;
  private multiTouch = false;
  private pinchDistance = 0;
  private lastMoveTime = 0;
  // Angular velocity in world space: axis * radians per ms.
  private readonly velocity = new Vector3();
  private readonly tmpAxis = new Vector3();
  private readonly tmpQuat = new Quaternion();

  constructor(el: HTMLElement, events: ControlEvents) {
    this.el = el;
    this.ev = events;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  stopInertia(): void {
    this.velocity.set(0, 0, 0);
  }

  /** Applies inertia. Returns true while the globe still moves. */
  update(dt: number): boolean {
    if (this.dragging || this.pointers.size > 0) return false;
    const speed = this.velocity.length();
    if (speed < 1e-6) return false;
    this.tmpAxis.copy(this.velocity).divideScalar(speed);
    this.ev.rotate(this.tmpQuat.setFromAxisAngle(this.tmpAxis, speed * dt));
    this.velocity.multiplyScalar(Math.exp(-DAMPING * dt));
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
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType });
    this.velocity.set(0, 0, 0);
    this.lastMoveTime = performance.now();
    if (this.pointers.size === 2) {
      this.multiTouch = true;
      this.pinchDistance = this.currentPinchDistance();
      if (!this.dragging) {
        this.dragging = true;
        this.ev.dragStart();
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
      this.ev.dragStart();
    }
    if (!this.dragging) return;

    const len = Math.hypot(dx, dy);
    if (len === 0) return;
    const angle = len * this.ev.radiansPerPixel();
    // Screen y points down, world y points up: drag right turns about +Y, drag down about +X.
    this.tmpAxis.set(dy / len, dx / len, 0);
    this.ev.rotate(this.tmpQuat.setFromAxisAngle(this.tmpAxis, angle));

    const now = performance.now();
    const dt = Math.max(1, now - this.lastMoveTime);
    this.lastMoveTime = now;
    // Smooth the velocity a little so one jittery event does not decide the throw.
    const instant = this.tmpAxis.multiplyScalar(angle / dt);
    this.velocity.lerp(instant, 0.6);
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
      if (performance.now() - this.lastMoveTime > 80 || wasMulti) this.velocity.set(0, 0, 0);
      this.ev.dragEnd();
    } else if (!wasMulti) {
      this.ev.tap(e.clientX, e.clientY, p.type);
    }
    if (e.pointerType !== 'touch') this.ev.hover(e.clientX, e.clientY);
  };

  private readonly onCancel = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      const wasDragging = this.dragging;
      this.dragging = false;
      this.multiTouch = false;
      this.velocity.set(0, 0, 0);
      if (wasDragging) this.ev.dragEnd();
    }
  };

  private readonly onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'touch' && !this.pointers.has(e.pointerId)) this.ev.leave();
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
