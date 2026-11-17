// The satellite texture of one view: the tier loads, the fade-in of the first tier, the upgrades to
// larger tiers and the upload of a large tier at rest. The rules are in textureTiers.ts.
// The view gives the motion state each frame, and calls ensure() when the satellite style is on.

import {
  ImageBitmapLoader,
  ImageLoader,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  Texture,
  type IUniform,
  type WebGLRenderer,
} from 'three';
import type { TextureHandover } from '../view/types';
import { TEXTURE_FADE_MS, closeImage, easeInOut } from './constants';
import { TEXTURES, type TextureFile } from './textureManifest';
import { canUploadTexture, nextTextureLevel, type UploadState, type UpgradeState } from './textureTiers';

export interface SatelliteTextureOptions {
  /** Usable tiers for this device, smallest first (chooseTextureTiers). */
  tiers: TextureFile[];
  /** The first texture tier that index.html started to download (a null Blob: it did not start). */
  firstTexture?: { url: string; blob: Promise<Blob | null> };
  /** A decoded tier from the view before. It shows at once, with no fade. */
  handover?: TextureHandover;
  reducedMotion: MediaQueryList;
  /** The texture or the fade changed: update the uniforms and render. */
  onChange(): void;
}

/** The motion state that the upgrade rule needs from the view. */
export type UpgradeInput = Omit<UpgradeState, 'tiers' | 'level' | 'busy' | 'shownForMs' | 'widths'>;
/** The motion state that the upload rule needs from the view. */
export type UploadInput = Omit<UploadState, 'level'>;

export class SatelliteTexture {
  /** The tMap uniform. The view shares this object with each material that samples the texture. */
  readonly uniform: IUniform<Texture | null> = { value: null };

  private readonly renderer: WebGLRenderer;
  private readonly reducedMotion: MediaQueryList;
  private onChange: () => void = () => {};
  private texture: Texture | null = null;
  private state: 'none' | 'loading' | 'ready' = 'none';
  private texMix = 0; // 0..1 fade-in of the satellite texture
  private tiers: TextureFile[];
  private level = -1; // tier on screen
  private busy = false; // a tier is loading, or waits in pending
  // A decoded larger tier that waits for a frame at rest (canUploadTexture), because its upload blocks the main thread.
  private pending: TextureHandover | null = null;
  private shownAt = 0; // when the first tier showed
  private viaImg = typeof createImageBitmap !== 'function'; // <img> decode instead of createImageBitmap
  private firstTexture: SatelliteTextureOptions['firstTexture'] | null; // from index.html, used one time
  private kept = false; // handover() gave the image away: dispose() does not close it
  private frozen = false; // after handover(): no more loads or uploads, so the image given away stays open
  private lost = false; // the WebGL context is lost: a decoded tier waits in pending, and nothing uploads
  // The context generation: contextRestored() adds 1. A texture from an older generation has the dispose
  // listener of the three.js state before the loss, so its dispose() deletes a GL object of the lost context.
  private gen = 0;
  private texGen = 0; // the generation of this.texture
  private disposed = false;

  constructor(renderer: WebGLRenderer, opts: SatelliteTextureOptions) {
    this.renderer = renderer;
    this.reducedMotion = opts.reducedMotion;
    this.tiers = opts.tiers;
    this.firstTexture = opts.firstTexture ?? null;
    if (opts.handover) {
      const { level, image } = opts.handover;
      if (level >= this.tiers.length) {
        // A tier above the limit of this view (the 8192 tier after a loss): this view owns the image now. Close it.
        // The view loads tier 0 when it calls ensure().
        closeImage(image);
      } else {
        // The view is not built yet: no onChange call here. The view reads mix when it applies its palette.
        this.useImage(level, image);
        this.texMix = 1;
      }
    }
    this.onChange = opts.onChange;
  }

  /** The eased fade-in, 0..1. The view multiplies it by 0 when the satellite style is off. */
  get mix(): number {
    return easeInOut(this.texMix);
  }

  /** Starts the first tier if no tier loads or shows yet. Call it when the satellite style is on. */
  ensure(): void {
    if (this.state === 'none') this.loadLevel(0);
  }

  /** The fade-in and the tier upgrades for one frame. Returns true when the view must render. */
  tick(now: number, dt: number, s: { satellite: boolean; upgrade: UpgradeInput }): boolean {
    let render = false;
    if (this.state === 'ready' && this.texMix < 1) {
      this.texMix = this.reducedMotion.matches ? 1 : Math.min(1, this.texMix + dt / TEXTURE_FADE_MS);
      this.onChange();
      render = true;
    }
    this.maybeUpgrade(now, s.satellite, s.upgrade);
    return render;
  }

  /**
   * A larger tier goes to the GPU only in a frame at rest: its upload is a main-thread task.
   * Call it after the camera step of the frame, when the view knows if the camera still moves.
   */
  upload(s: UploadInput): void {
    if (this.frozen || this.lost) return;
    const pending = this.pending;
    if (pending && canUploadTexture({ ...s, level: pending.level })) {
      this.pending = null;
      this.useImage(pending.level, pending.image);
    }
  }

  /**
   * Gives the image on screen to the next view. This texture keeps it on the GPU until dispose(), but
   * dispose() does not close it. A decoded tier that waits for its upload is closed: the next view loads it again.
   * After the call, this texture loads and uploads nothing more, and it closes a decode that arrives late.
   * Thus a late tier cannot replace the texture and close the image that the next view holds.
   */
  handover(): TextureHandover | null {
    this.frozen = true;
    closeImage(this.pending?.image);
    this.pending = null;
    // A lost context: this view keeps the image and closes it in dispose(). The next view loads tier 0.
    if (!this.texture || this.level < 0 || this.kept || this.lost) return null;
    this.kept = true;
    return { level: this.level, image: this.texture.image as ImageBitmap | HTMLImageElement };
  }

  /** The WebGL context is lost. Loads continue, but each decoded tier waits for the restore. */
  contextLost(): void {
    this.lost = true;
  }

  /**
   * The WebGL context is back. Call it after three.js made its state again (its listener runs first).
   * A new Texture object on the same image takes the place of the texture on screen, and three.js
   * uploads it at the next render: the image stays open until a larger tier replaces it. The old object
   * does not get dispose(): three.js discarded its GL objects on the loss. maxTiers is the new tier count
   * (a page with a loss gets no 8192 tier). If the tier on screen is too large now, the texture goes,
   * and tier 0 loads again (from the browser cache) and fades in. The upgrades then stop at the new limit.
   */
  contextRestored(maxTiers: number): void {
    this.lost = false;
    this.gen++;
    if (this.disposed || this.frozen) return;
    if (this.tiers.length > maxTiers) {
      this.tiers = this.tiers.slice(0, Math.max(1, maxTiers));
      if (this.pending && this.pending.level >= this.tiers.length) {
        closeImage(this.pending.image);
        this.pending = null;
        this.busy = false;
      }
    }
    if (!this.texture) return;
    if (this.level < this.tiers.length) {
      this.texture = this.makeTexture(this.texture.image as ImageBitmap | HTMLImageElement);
      this.texGen = this.gen;
      this.uniform.value = this.texture;
      this.onChange();
      return;
    }
    const old = this.texture;
    this.texture = null;
    this.uniform.value = null;
    // No dispose(): the texture is from before the restore (disposeTexture).
    if (!this.kept) closeImage(old.image);
    this.kept = false;
    this.level = -1;
    this.texMix = 0;
    this.state = 'none';
    this.onChange();
    this.loadLevel(0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposeTexture(this.texture, this.texGen);
    if (!this.kept) closeImage(this.texture?.image);
    closeImage(this.pending?.image);
    this.pending = null;
  }

  /**
   * Loads one texture tier. Tier 0 fades in; a larger tier replaces the texture on screen with no fade.
   * createImageBitmap decodes off the main thread. index.html starts the download of tier 0 (firstTexture).
   * Every path uploads with flipY = false (ImageBitmap uploads ignore flipY); the shader flips v instead.
   */
  private loadLevel(level: number, url = this.tiers[level]?.url, viaImg = this.viaImg): void {
    if (!url || this.disposed || this.frozen) return;
    this.busy = true;
    if (level === 0) this.state = 'loading';
    const done = (image: ImageBitmap | HTMLImageElement) => this.onDecoded(level, image);
    const fail = (err: unknown) => this.textureFailed(level, url, viaImg, err);
    const first = this.firstTexture;
    this.firstTexture = null;
    if (first && first.url === url && !viaImg) {
      // The same decode as ImageBitmapLoader. With no Blob, or on an error, load the file again as usual.
      first.blob
        .then((blob) => {
          if (!blob) throw new Error('no preloaded texture');
          return createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        })
        .then(done, () => this.loadLevel(level, url, viaImg));
      return;
    }
    if (viaImg) new ImageLoader().setCrossOrigin('anonymous').load(url, done, undefined, fail);
    else new ImageBitmapLoader().load(url, done, undefined, fail);
  }

  /**
   * Tier 0 goes to the GPU at once. A larger tier waits in pending; upload() sends it at rest.
   * While the context is lost, each tier waits in pending. A tier above the limit (after a loss) goes.
   */
  private onDecoded(level: number, image: ImageBitmap | HTMLImageElement): void {
    if (this.disposed || this.frozen || level >= this.tiers.length) {
      this.busy = false;
      closeImage(image);
      return;
    }
    if (level <= 0 && !this.lost) {
      this.useImage(level, image);
      return;
    }
    closeImage(this.pending?.image);
    this.pending = { level, image };
  }

  private useImage(level: number, image: ImageBitmap | HTMLImageElement): void {
    this.busy = false;
    if (this.disposed) {
      closeImage(image);
      return;
    }
    const tex = this.makeTexture(image);
    this.renderer.initTexture(tex);
    const old = this.texture;
    const oldGen = this.texGen;
    this.texture = tex;
    this.texGen = this.gen;
    this.level = level;
    this.uniform.value = tex;
    if (old) {
      this.disposeTexture(old, oldGen);
      // An image given away (handover) belongs to the next view: do not close it.
      if (!this.kept) closeImage(old.image);
    }
    this.kept = false; // the new texture is this view's own
    if (this.state !== 'ready') {
      this.state = 'ready';
      this.shownAt = performance.now();
      if (this.reducedMotion.matches) this.texMix = 1;
    }
    this.onChange();
  }

  private makeTexture(image: ImageBitmap | HTMLImageElement): Texture {
    const tex = new Texture(image);
    tex.flipY = false;
    tex.colorSpace = NoColorSpace; // raw sRGB values, like every other colour here
    tex.wrapS = RepeatWrapping;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    tex.needsUpdate = true;
    return tex;
  }

  /** Frees the GL objects of a texture of generation texGen. */
  private disposeTexture(tex: Texture | null, texGen: number): void {
    // A texture from before a restore: three.js discarded its GL objects on the loss. Its dispose() would
    // delete them on the new context ("object does not belong to this context"). Only drop the reference.
    if (tex && texGen === this.gen) tex.dispose();
  }

  private textureFailed(level: number, url: string, viaImg: boolean, err: unknown): void {
    this.busy = false;
    if (this.disposed || this.frozen) return;
    if (!viaImg) {
      // createImageBitmap failed (an old browser, or options it does not know): use <img> from now on.
      this.viaImg = true;
      this.loadLevel(level, url, true);
      return;
    }
    console.warn('[worldly] satellite texture failed', url, err);
    if (level === 0 && url !== TEXTURES.fallback.url) {
      // No WebP: the JPEG fallback takes the place of all tiers.
      this.tiers = [TEXTURES.fallback];
      this.loadLevel(0, TEXTURES.fallback.url, true);
    } else if (level === 0) {
      this.state = 'none';
    } else {
      // A larger tier failed: keep the texture on screen and stop the upgrades.
      this.tiers = this.tiers.slice(0, level);
    }
  }

  /** Loads the next tier when the view needs more texels and the view is at rest (see textureTiers.ts). */
  private maybeUpgrade(now: number, satellite: boolean, s: UpgradeInput): void {
    if (this.frozen || this.lost || this.busy || this.state !== 'ready' || this.level + 1 >= this.tiers.length) return;
    if (!satellite) return;
    const next = nextTextureLevel({
      ...s,
      tiers: this.tiers.length,
      level: this.level,
      busy: this.busy,
      shownForMs: now - this.shownAt,
      widths: this.tiers.map((t) => t.width),
    });
    if (next > 0) this.loadLevel(next);
  }
}
