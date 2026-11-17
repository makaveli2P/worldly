// The text of a start error and of a lost WebGL context (src/main.ts). Pure functions, so the tests can drive them.

/** WebGL is blocked or lost. Chromium blocks WebGL for a site after a GPU reset, until the browser restarts. */
export const WEBGL_OFF_TEXT =
  'Your browser turned off 3D graphics for this site. This often occurs after a graphics problem. Close all browser windows. Then open the browser again.';
/** WebGL is off by an enterprise policy or a command-line switch. A browser restart does not help. */
export const WEBGL_POLICY_TEXT =
  'Your organization or your browser settings turned off 3D graphics (WebGL) in this browser. Ask your IT support team for help, or use a different browser.';
/** Any other start error. */
export const START_FAILED_TEXT = 'Could not load the map. Reload the page to try again.';

/** True when the error comes from the creation of a WebGL context (three.js WebGLRenderer). */
export function isWebGLError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /WebGL context/i.test(message);
}

/**
 * True when the reason of the browser (webglcontextcreationerror statusMessage) is a policy or a switch.
 * Chromium: "disabled by enterprise policy or commandline switch".
 */
export function isPolicyReason(reason: string | undefined): boolean {
  return /policy|command\s*line switch|commandline switch/i.test(reason ?? '');
}

/**
 * The first line of a start error. webgl2 is false when the browser cannot make a WebGL 2 context now.
 * reason is the statusMessage of the browser when it did not make the context.
 */
export function startErrorText(err: unknown, webgl2: boolean, reason?: string): string {
  if (isPolicyReason(reason)) return WEBGL_POLICY_TEXT;
  return !webgl2 || isWebGLError(err) ? WEBGL_OFF_TEXT : START_FAILED_TEXT;
}

/** A short form of the reason of the browser for the detail line: one line, at most 100 characters. */
export function shortReason(reason: string | undefined): string {
  return (reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export interface ErrorFacts {
  error: unknown;
  step: string;
  webgl2: boolean;
  /** The statusMessage of webglcontextcreationerror, if the browser gave one. */
  reason?: string;
  boot: boolean;
  userAgent: string;
}

/** The small detail line under the error text: a photo of the page is enough to find the cause. No personal data. */
export function errorDetail(f: ErrorFacts): string {
  const e = f.error instanceof Error ? f.error : new Error(String(f.error));
  const browser = f.userAgent.match(/(Edg|Chrome|Firefox|Version)\/[\d.]+/g)?.join(' ') ?? '';
  return [
    `${e.name}: ${e.message}`.slice(0, 200),
    `step: ${f.step}`,
    `webgl2: ${f.webgl2 ? 'yes' : 'no'}`,
    shortReason(f.reason) && `reason: ${shortReason(f.reason)}`,
    `boot: ${f.boot ? 'yes' : 'no'}`,
    browser,
  ]
    .filter(Boolean)
    .join(' · ');
}
