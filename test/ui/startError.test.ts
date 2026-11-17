// The text of a start error and of a lost WebGL context (src/startError.ts).

import { describe, expect, it } from 'vitest';
import {
  START_FAILED_TEXT,
  WEBGL_OFF_TEXT,
  WEBGL_POLICY_TEXT,
  errorDetail,
  isPolicyReason,
  isWebGLError,
  shortReason,
  startErrorText,
} from '../../src/startError';

const contextError = new Error('THREE.WebGLRenderer: Error creating WebGL context.');

describe('startErrorText', () => {
  it('tells the user to restart the browser when the WebGL context cannot be made', () => {
    expect(isWebGLError(contextError)).toBe(true);
    expect(startErrorText(contextError, true)).toBe(WEBGL_OFF_TEXT);
    expect(startErrorText(new Error('THREE.WebGLRenderer: Error creating WebGL context with your selected attributes.'), true)).toBe(
      WEBGL_OFF_TEXT,
    );
  });

  it('tells the user to restart the browser when there is no WebGL 2 now, for any error', () => {
    expect(startErrorText(new Error('/data/world.json: 500'), false)).toBe(WEBGL_OFF_TEXT);
  });

  it('keeps the general text for other errors', () => {
    expect(isWebGLError(new Error('/data/world.json: 500'))).toBe(false);
    expect(startErrorText(new Error('/data/world.json: 500'), true)).toBe(START_FAILED_TEXT);
    expect(startErrorText('a string', true)).toBe(START_FAILED_TEXT);
    expect(START_FAILED_TEXT).toBe('Could not load the map. Reload the page to try again.');
  });

  it('tells the user to ask IT when a policy or a switch turned WebGL off', () => {
    const policy = ' disabled by enterprise policy or commandline switch';
    expect(isPolicyReason(policy)).toBe(true);
    expect(startErrorText(contextError, false, policy)).toBe(WEBGL_POLICY_TEXT);
    expect(WEBGL_POLICY_TEXT).not.toMatch(/Close all browser windows/);
    // A block after a GPU reset: the restart text stays.
    expect(isPolicyReason('Web page caused context loss and was blocked')).toBe(false);
    expect(startErrorText(contextError, false, 'Web page caused context loss and was blocked')).toBe(WEBGL_OFF_TEXT);
    expect(startErrorText(contextError, false, '')).toBe(WEBGL_OFF_TEXT);
  });

  it('keeps the WebGL text short and with the action', () => {
    expect(WEBGL_OFF_TEXT).toMatch(/turned off 3D graphics/);
    expect(WEBGL_OFF_TEXT).toMatch(/Close all browser windows/);
    expect(WEBGL_OFF_TEXT.length).toBeLessThan(180);
  });
});

describe('errorDetail', () => {
  it('gives the error, the step, WebGL 2, the boot script and the browser', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0';
    expect(errorDetail({ error: contextError, step: 'view (globe)', webgl2: false, boot: true, userAgent: ua })).toBe(
      'Error: THREE.WebGLRenderer: Error creating WebGL context. · step: view (globe) · webgl2: no · boot: yes · Chrome/155.0.0.0 Edg/155.0.0.0',
    );
  });

  it('gives the reason of the browser in a short form', () => {
    expect(
      errorDetail({
        error: contextError,
        step: 'view (globe)',
        webgl2: false,
        reason: '  disabled by enterprise policy or commandline switch',
        boot: true,
        userAgent: 'Chrome/156.0.8078.4',
      }),
    ).toBe(
      'Error: THREE.WebGLRenderer: Error creating WebGL context. · step: view (globe) · webgl2: no · reason: disabled by enterprise policy or commandline switch · boot: yes · Chrome/156.0.8078.4',
    );
    expect(shortReason('a\n  b')).toBe('a b');
    expect(shortReason('x'.repeat(300))).toHaveLength(100);
    expect(shortReason(undefined)).toBe('');
  });

  it('accepts a value that is not an Error, and an unknown browser', () => {
    expect(errorDetail({ error: 'x', step: 'data', webgl2: true, boot: false, userAgent: '' })).toBe(
      'Error: x · step: data · webgl2: yes · boot: no',
    );
  });
});
