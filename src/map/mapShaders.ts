// GLSL for the flat map. The slot lookup, the light and the satellite grade are the chunks of the globe
// (src/globe/shaders.ts), so both views give the same colours. Positions are Mercator world units
// (x = lng in radians, y = Mercator y); the orthographic camera looks along -z.

import { earthSample, gradeEarth, lighting, slotHead } from '../globe/shaders';

// The satellite texture is equirectangular: v follows the latitude, not the Mercator y.
// u is continuous across the copies of the world, and the texture repeats in u, so the map needs no seam trick.
const mapSample = /* glsl */ `
  ${earthSample}
  vec3 sampleMap(vec2 w) {
    float lat = atan(sinh(w.y));
    return texture2D(tMap, vec2(w.x * 0.15915494 + 0.5, 0.5 - lat * 0.31830989)).rgb;
  }
`;

export const mapOceanVertex = /* glsl */ `
  varying vec2 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xy;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

export const mapOceanFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTex;        // 0 = flat fill, 1 = satellite texture
  varying vec2 vWorld;
  ${lighting}
  ${mapSample}
  ${gradeEarth}
  void main() {
    vec3 c = uColor * shade(vec3(0.0, 0.0, 1.0));
    c = mix(c, gradeEarth(sampleMap(vWorld), 1.0), uTex);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// The raise moves a cap up the screen by uLiftWorld (LIFT_PX in world units) and toward the camera,
// so the walls on the south edge of a raised country show as a side face.
const mapPlace = /* glsl */ `
  uniform float uLiftWorld;
  vec4 placeVertex(float z) {
    vec2 p = position.xy;
    p.y += kind * lift * uLiftWorld;
    return modelViewMatrix * vec4(p, kind * lift * 0.5 + z, 1.0);
  }
`;

export const mapLandVertex = /* glsl */ `
  ${slotHead}
  ${mapPlace}
  flat varying float vKind;
  varying float vLift;
  varying vec3 vCap;
  varying vec3 vWall;
  varying vec2 vWorld;
  varying vec3 vViewPos;
  void main() {
    resolveSlot();
    vec4 mv = placeVertex(0.0);
    vKind = kind;
    vLift = lift;
    vCap = capColor;
    vWall = wallColor;
    vWorld = position.xy; // the unlifted point: a raised cap shows the imagery of its own ground
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

export const mapLandFragment = /* glsl */ `
  uniform float uTex;        // satellite texture on raised caps, 0..1
  uniform float uSatellite;  // 1 = land at rest is not drawn (the ocean plane carries the imagery)
  flat varying float vKind;
  varying float vLift;
  varying vec3 vCap;
  varying vec3 vWall;
  varying vec2 vWorld;
  varying vec3 vViewPos;
  ${lighting}
  ${mapSample}
  ${gradeEarth}
  void main() {
    if (uSatellite > 0.5 && vLift < 0.002) discard;
    // Derivatives first, outside the branch on the kind.
    vec3 wn = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
    vec3 tex = sampleMap(vWorld);
    if (vKind > 0.5) {
      vec3 c = vCap * shade(vec3(0.0, 0.0, 1.0));
      vec3 sat = pow(max(gradeEarth(tex, 1.0), vec3(0.0)), vec3(0.95)) * 1.06;
      gl_FragColor = vec4(mix(c, sat, uTex), 1.0);
    } else {
      // Walls: flat normal from screen-space derivatives, turned to face the camera (+z).
      if (wn.z < 0.0) wn = -wn;
      float l = 0.66 + 0.34 * max(dot(wn, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
      gl_FragColor = vec4(vWall * l, 1.0);
    }
  }
`;

export const mapLineVertex = /* glsl */ `
  ${slotHead}
  ${mapPlace}
  uniform float uAlpha;
  uniform vec2 uNudge; // screen offset in NDC, to draw a line more than 1px wide
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    resolveSlot();
    vColor = lineColor;
    vAlpha = mix(uAlpha, 1.0, lift);
    gl_Position = projectionMatrix * placeVertex(0.001);
    gl_Position.xy += uNudge * gl_Position.w;
  }
`;
