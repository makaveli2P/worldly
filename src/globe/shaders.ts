// GLSL for the globe. All colours stay in sRGB: the renderer does no colour conversion,
// and the satellite texture is sampled as raw sRGB values (NoColorSpace) for the same reason.

export const SLOTS = 4;

const lighting = /* glsl */ `
  // Soft, even light from the upper left, plus a sky/ground term.
  float shade(vec3 n) {
    vec3 L = normalize(vec3(-0.45, 0.6, 0.66));
    float diff = max(dot(n, L), 0.0);
    float hemi = 0.5 + 0.5 * n.y;
    return 0.87 + 0.1 * diff + 0.04 * hemi;
  }
`;

// Equirectangular lookup by direction. The u derivative comes from whichever of two
// parametrisations has no seam at this pixel, so the mip level stays right at the antimeridian.
const earth = /* glsl */ `
  uniform sampler2D tMap;
  vec3 sampleEarth(vec3 d) {
    float lon = atan(d.x, d.z);
    float lat = asin(clamp(d.y, -1.0, 1.0));
    vec2 uv = vec2(lon * 0.15915494 + 0.5, lat * 0.31830989 + 0.5);
    float u2 = fract(uv.x + 0.5);
    vec2 dx = vec2(dFdx(uv.x), dFdx(uv.y));
    vec2 dy = vec2(dFdy(uv.x), dFdy(uv.y));
    float dx2 = dFdx(u2);
    float dy2 = dFdy(u2);
    if (abs(dx2) + abs(dy2) < abs(dx.x) + abs(dy.x)) {
      dx.x = dx2;
      dy.x = dy2;
    }
    return textureGrad(tMap, uv, dx, dy).rgb;
  }
  // Satellite grade: darker toward the limb, a little lift in the mid tones.
  vec3 gradeEarth(vec3 c, float facing) {
    c *= 0.72 + 0.28 * pow(facing, 0.6);
    return pow(max(c, vec3(0.0)), vec3(0.92)) * 1.08;
  }
`;

export const oceanVertex = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vDir;
  varying vec3 vViewPos;
  void main() {
    vDir = normalize(position);
    vNormal = normalize(normalMatrix * position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

export const oceanFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTex;        // 0 = flat fill, 1 = satellite texture
  varying vec3 vNormal;
  varying vec3 vDir;
  varying vec3 vViewPos;
  ${lighting}
  ${earth}
  void main() {
    vec3 n = normalize(vNormal);
    float facing = clamp(dot(n, normalize(-vViewPos)), 0.0, 1.0);
    vec3 tex = sampleEarth(normalize(vDir));
    vec3 c = uColor * shade(n) * (0.92 + 0.08 * sqrt(facing));
    c = mix(c, gradeEarth(tex, facing), uTex);
    gl_FragColor = vec4(c, 1.0);
  }
`;

// Shared by the land mesh and the border lines.
const landVertexHead = /* glsl */ `
  attribute float countryIndex;
  attribute float kind;
  uniform float uSlotIndex[${SLOTS}];
  uniform float uSlotAmount[${SLOTS}];
  uniform vec3 uSlotCap[${SLOTS}];
  uniform vec3 uSlotWall[${SLOTS}];
  uniform vec3 uSlotLine[${SLOTS}];
  uniform vec3 uLand;
  uniform vec3 uWall;
  uniform vec3 uColor;
  uniform float uBaseRadius;
  uniform float uLift;
  uniform float uOffset;

  float lift;
  vec3 capColor;
  vec3 wallColor;
  vec3 lineColor;

  void resolveSlot() {
    lift = 0.0;
    capColor = uLand;
    wallColor = uWall;
    lineColor = uColor;
    for (int i = 0; i < ${SLOTS}; i++) {
      if (abs(countryIndex - uSlotIndex[i]) < 0.5 && uSlotAmount[i] > lift) {
        lift = uSlotAmount[i];
        capColor = mix(uLand, uSlotCap[i], lift);
        wallColor = mix(uWall, uSlotWall[i], lift);
        lineColor = mix(uColor, uSlotLine[i], lift);
      }
    }
  }

  vec4 placeVertex() {
    float r = uBaseRadius + kind * lift * uLift + uOffset;
    return modelViewMatrix * vec4(position * r, 1.0);
  }
`;

export const landVertex = /* glsl */ `
  ${landVertexHead}
  flat varying float vKind;
  varying float vLift;
  varying vec3 vCap;
  varying vec3 vWall;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec3 vDir;
  void main() {
    resolveSlot();
    vec4 mv = placeVertex();
    vKind = kind;
    vLift = lift;
    vCap = capColor;
    vWall = wallColor;
    vViewPos = mv.xyz;
    vNormal = normalize(normalMatrix * position);
    vDir = position;
    gl_Position = projectionMatrix * mv;
  }
`;

export const landFragment = /* glsl */ `
  uniform float uTex;        // satellite texture on raised caps, 0..1
  uniform float uSatellite;  // 1 = land at rest is not drawn (the ocean sphere carries the imagery)
  flat varying float vKind;
  varying float vLift;
  varying vec3 vCap;
  varying vec3 vWall;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  varying vec3 vDir;
  ${lighting}
  ${earth}
  void main() {
    if (uSatellite > 0.5 && vLift < 0.002) discard;
    // Derivatives first, outside the branch on the kind.
    vec3 wn = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
    vec3 tex = sampleEarth(normalize(vDir));
    vec3 n = normalize(vNormal);
    if (vKind > 0.5) {
      vec3 c = vCap * shade(n);
      float facing = clamp(dot(n, normalize(-vViewPos)), 0.0, 1.0);
      vec3 sat = pow(max(gradeEarth(tex, facing), vec3(0.0)), vec3(0.95)) * 1.06;
      gl_FragColor = vec4(mix(c, sat, uTex), 1.0);
    } else {
      // Walls: flat normal from screen-space derivatives, turned to face the camera.
      if (dot(wn, vViewPos) > 0.0) wn = -wn;
      float l = 0.66 + 0.34 * max(dot(wn, normalize(vec3(-0.5, 0.7, 0.6))), 0.0);
      gl_FragColor = vec4(vWall * l, 1.0);
    }
  }
`;

export const lineVertex = /* glsl */ `
  ${landVertexHead}
  uniform float uAlpha;
  uniform vec2 uNudge; // screen offset in NDC, to draw a line more than 1px wide
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    resolveSlot();
    vColor = lineColor;
    vAlpha = mix(uAlpha, 1.0, lift);
    gl_Position = projectionMatrix * placeVertex();
    gl_Position.xy += uNudge * gl_Position.w;
  }
`;

export const lineFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    gl_FragColor = vec4(vColor, vAlpha);
  }
`;

export const plainLineVertex = /* glsl */ `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const plainLineFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlpha;
  void main() {
    gl_FragColor = vec4(uColor, uAlpha);
  }
`;

export const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// 9-tap separable gaussian (linear-sampling weights). uLod reads a mip level of a larger input.
export const blurFragment = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uStep;
  uniform float uLod;
  varying vec2 vUv;
  void main() {
    vec4 c = textureLod(tInput, vUv, uLod) * 0.2270270270;
    c += textureLod(tInput, vUv + uStep * 1.3846153846, uLod) * 0.3162162162;
    c += textureLod(tInput, vUv - uStep * 1.3846153846, uLod) * 0.3162162162;
    c += textureLod(tInput, vUv + uStep * 3.2307692308, uLod) * 0.0702702703;
    c += textureLod(tInput, vUv - uStep * 3.2307692308, uLod) * 0.0702702703;
    gl_FragColor = c;
  }
`;

// The scene target is cleared to transparent black, so its colours are premultiplied and
// alpha marks the globe. Only globe pixels get the dim treatment; the paper stays as it is.
export const compositeFragment = /* glsl */ `
  uniform sampler2D tSharp;
  uniform sampler2D tBlur;
  uniform float uAmount;
  uniform vec3 uPaper;
  uniform vec3 uRecede;
  uniform float uRecedeAmount;
  uniform float uDesaturate;
  varying vec2 vUv;
  void main() {
    // Coverage comes from the sharp pass, so the globe edge stays hard; only the colour is blurred.
    vec4 s = texture2D(tSharp, vUv);
    vec4 b = texture2D(tBlur, vUv);
    float a = clamp(s.a, 0.0, 1.0);
    vec3 sc = s.a > 0.001 ? s.rgb / s.a : vec3(0.0);
    vec3 bc = b.a > 0.001 ? b.rgb / b.a : sc;
    vec3 rgb = mix(sc, bc, uAmount);
    float g = dot(rgb, vec3(0.299, 0.587, 0.114));
    rgb = mix(rgb, vec3(g), uDesaturate * uAmount);
    rgb = mix(rgb, uRecede, uRecedeAmount * uAmount);
    gl_FragColor = vec4(mix(uPaper, rgb, a), 1.0);
  }
`;

// The 1px outline of the globe: a flat ring at the silhouette, facing the camera.
export const limbVertex = /* glsl */ `
  attribute float side; // 0 = inner edge, 1 = outer edge
  uniform float uRadius;
  uniform float uWidth;
  uniform float uZ;
  void main() {
    float r = uRadius + (side - 0.5) * uWidth;
    gl_Position = projectionMatrix * viewMatrix * vec4(position.xy * r, uZ, 1.0);
  }
`;
