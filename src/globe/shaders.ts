// GLSL for the globe. All colours stay in sRGB: the renderer does no colour conversion.

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

export const oceanVertex = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const oceanFragment = /* glsl */ `
  uniform vec3 uColor;
  varying vec3 vNormal;
  ${lighting}
  void main() {
    gl_FragColor = vec4(uColor * shade(normalize(vNormal)), 1.0);
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
  uniform vec3 uLand;
  uniform vec3 uWall;
  uniform float uBaseRadius;
  uniform float uLift;
  uniform float uOffset;

  float lift;
  vec3 capColor;
  vec3 wallColor;

  void resolveSlot() {
    lift = 0.0;
    capColor = uLand;
    wallColor = uWall;
    for (int i = 0; i < ${SLOTS}; i++) {
      if (abs(countryIndex - uSlotIndex[i]) < 0.5 && uSlotAmount[i] > lift) {
        lift = uSlotAmount[i];
        capColor = mix(uLand, uSlotCap[i], lift);
        wallColor = mix(uWall, uSlotWall[i], lift);
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
  varying vec3 vCap;
  varying vec3 vWall;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  void main() {
    resolveSlot();
    vec4 mv = placeVertex();
    vKind = kind;
    vCap = capColor;
    vWall = wallColor;
    vViewPos = mv.xyz;
    vNormal = normalize(normalMatrix * position);
    gl_Position = projectionMatrix * mv;
  }
`;

export const landFragment = /* glsl */ `
  flat varying float vKind;
  varying vec3 vCap;
  varying vec3 vWall;
  varying vec3 vViewPos;
  varying vec3 vNormal;
  ${lighting}
  void main() {
    if (vKind > 0.5) {
      gl_FragColor = vec4(vCap * shade(normalize(vNormal)), 1.0);
    } else {
      // Walls: flat normal from screen-space derivatives, turned to face the camera.
      vec3 n = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
      if (dot(n, vViewPos) > 0.0) n = -n;
      gl_FragColor = vec4(vWall * shade(n), 1.0);
    }
  }
`;

export const lineVertex = /* glsl */ `
  ${landVertexHead}
  void main() {
    resolveSlot();
    gl_Position = projectionMatrix * placeVertex();
  }
`;

export const lineFragment = /* glsl */ `
  uniform vec3 uColor;
  void main() {
    gl_FragColor = vec4(uColor, 1.0);
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

export const compositeFragment = /* glsl */ `
  uniform sampler2D tSharp;
  uniform sampler2D tBlur;
  uniform float uAmount;
  uniform vec3 uPaper;
  varying vec2 vUv;
  void main() {
    vec3 sharp = texture2D(tSharp, vUv).rgb;
    vec3 blur = texture2D(tBlur, vUv).rgb;
    vec3 c = mix(sharp, blur, uAmount);
    float g = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(c, vec3(g), 0.35 * uAmount);   // desaturate
    c = mix(c, uPaper, 0.22 * uAmount);    // recede toward the paper
    gl_FragColor = vec4(c, 1.0);
  }
`;
