// The raise slots: up to SLOTS countries rise (hover, preview, selection) and fall back.
// The animator owns the slot state and the slot uniforms. Each view owns its slot meshes and reads slots[i].index.

import { Vector3, type IUniform } from 'three';
import type { GlobePalette } from '../theme';
import { BLUR_MS, LIFT, RAISE_MS, easeInOut, rgb } from './constants';
import { SLOTS } from './shaders';

export interface SlotState {
  index: number; // country index, -1 = free
  t: number; // linear progress 0..1
  kind: 'sel' | 'hover' | null;
}

export interface SlotUniforms {
  uSlotIndex: IUniform<number[]>;
  uSlotAmount: IUniform<number[]>;
  uSlotCap: IUniform<Vector3[]>;
  uSlotWall: IUniform<Vector3[]>;
  uSlotLine: IUniform<Vector3[]>;
}

export class SlotAnimator {
  readonly slots: SlotState[] = Array.from({ length: SLOTS }, () => ({ index: -1, t: 0, kind: null }));
  readonly uniforms: SlotUniforms = {
    uSlotIndex: { value: new Array(SLOTS).fill(-1) },
    uSlotAmount: { value: new Array(SLOTS).fill(0) },
    uSlotCap: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
    uSlotWall: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
    uSlotLine: { value: Array.from({ length: SLOTS }, () => new Vector3()) },
  };
  /** Linear progress 0..1 of the blur of the rest of the world. */
  blurT = 0;

  /** Moves each slot one frame toward the wanted state. Returns true when something changed. */
  step(dt: number, reduced: boolean, want: Map<number, 'sel' | 'hover'>, p: GlobePalette): boolean {
    // Give each wanted country a slot: its own, a free one, or the lowest fading one.
    for (const [index] of want) {
      if (this.slots.some((s) => s.index === index)) continue;
      const free = this.slots
        .filter((s) => !want.has(s.index))
        .sort((a, b) => (a.index < 0 ? -1 : b.index < 0 ? 1 : a.t - b.t))[0];
      if (free) {
        free.index = index;
        free.t = 0;
      }
    }

    let changed = false;
    const step = reduced ? 1 : dt / RAISE_MS;
    const u = this.uniforms;
    this.slots.forEach((s, i) => {
      if (s.index < 0) return;
      const kind = want.get(s.index);
      if (kind) s.kind = kind; // a fading slot keeps the colours it had
      if (s.kind === 'sel') {
        u.uSlotCap.value[i].copy(rgb(p.selectedCap));
        u.uSlotWall.value[i].copy(rgb(p.selectedWall));
        u.uSlotLine.value[i].copy(rgb(p.selectedLine));
      } else if (s.kind === 'hover') {
        u.uSlotCap.value[i].copy(rgb(p.hoverCap));
        u.uSlotWall.value[i].copy(rgb(p.hoverWall));
        u.uSlotLine.value[i].copy(rgb(p.hoverLine));
      }
      const target = kind ? 1 : 0;
      if (s.t !== target) {
        s.t = target > s.t ? Math.min(1, s.t + step) : Math.max(0, s.t - step);
        changed = true;
      }
      if (s.t === 0 && !kind) {
        s.index = -1;
        s.kind = null;
      }
      u.uSlotIndex.value[i] = s.index;
      u.uSlotAmount.value[i] = s.index < 0 ? 0 : easeInOut(s.t);
    });

    const blurTarget = want.size ? 1 : 0;
    if (this.blurT !== blurTarget) {
      const b = reduced ? 1 : dt / BLUR_MS;
      this.blurT = blurTarget > this.blurT ? Math.min(1, this.blurT + b) : Math.max(0, this.blurT - b);
      changed = true;
    }
    return changed;
  }

  /** The raise amount 0..1 of each slot, with its country index, for pickWithSlop. */
  amounts(): { index: number; amount: number }[] {
    return this.slots.map((s, i) => ({ index: s.index, amount: this.uniforms.uSlotAmount.value[i] }));
  }

  /** Current raise of a country in earth radii (0..LIFT). 0 for a country with no slot. */
  liftAt(index: number): number {
    if (index < 0) return 0;
    const i = this.slots.findIndex((s) => s.index === index);
    return i < 0 ? 0 : this.uniforms.uSlotAmount.value[i] * LIFT;
  }
}
