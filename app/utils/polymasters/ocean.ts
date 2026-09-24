import { Geometry, Mesh, Shader } from 'pixi.js'

const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`

// Perspective sea plane: every pixel is projected back onto the water surface, animated
// with layered swells + value noise, lit by the sun (fresnel sky reflection, sun glitter
// path, crest foam) and faded into haze at the horizon.
const fragment = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;
uniform float uTime;
uniform float uCamX;
uniform vec2 uSize;
uniform float uD0;
uniform float uSunX;
uniform float uDim;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float waves(vec2 p, float t, float detail) {
  float h = 0.0;
  h += sin(p.x * 0.012 + p.y * 0.004 + t * 1.1) * 0.55;
  h += sin(p.x * 0.021 - p.y * 0.009 - t * 1.5) * 0.35;
  h += sin(p.x * 0.043 + p.y * 0.017 + t * 2.1) * 0.2 * detail;
  h += (noise(p * vec2(0.03, 0.05) + vec2(t * 0.5, t * 0.25)) - 0.5) * 0.7 * detail;
  h += (noise(p * vec2(0.08, 0.12) - vec2(t * 0.9, 0.0)) - 0.5) * 0.3 * detail;
  return h;
}

void main() {
  float py = max(vUV.y * uSize.y, 0.75);
  float px = vUV.x * uSize.x;
  float z = uD0 / py;
  vec2 P = vec2((px - uSize.x * 0.5) * z + uCamX, z * uD0 * 2.5);
  float detail = clamp(1.4 - z * 0.08, 0.15, 1.0);
  float t = uTime;
  float e = 2.0 * z;
  float h = waves(P, t, detail);
  float hx = (waves(P + vec2(e, 0.0), t, detail) - h) / e;
  float hz = (waves(P + vec2(0.0, e), t, detail) - h) / e;
  vec3 n = normalize(vec3(-hx * 26.0, 1.0, -hz * 26.0));

  float depth = clamp(vUV.y, 0.0, 1.0);
  vec3 horizon = vec3(0.56, 0.80, 0.93);
  vec3 mid = vec3(0.09, 0.52, 0.78);
  vec3 deep = vec3(0.02, 0.23, 0.45);
  vec3 col = mix(horizon, mid, smoothstep(0.0, 0.25, depth));
  col = mix(col, deep, smoothstep(0.2, 1.0, depth));

  // light from the upper right sun
  vec3 L = normalize(vec3(0.35, 0.8, -0.45));
  float diff = dot(n, L);
  col *= 0.86 + diff * 0.22;

  // fresnel sky reflection, stronger far away
  float fres = pow(1.0 - clamp(n.y, 0.0, 1.0), 2.0) * 3.0 + (1.0 - depth) * 0.35;
  col = mix(col, vec3(0.78, 0.9, 1.0), clamp(fres, 0.0, 0.6));

  // sun glitter path
  float column = exp(-pow((px - uSunX) / (uSize.x * (0.05 + depth * 0.18)), 2.0));
  float glint = pow(clamp(0.5 + hx * -22.0 + hz * 8.0, 0.0, 1.0), 14.0);
  col += vec3(1.0, 0.93, 0.75) * glint * column * (0.4 + depth * 0.8);
  // scattered sparkles everywhere
  float sp = pow(clamp(h * 0.6 + 0.5, 0.0, 1.0), 18.0) * detail;
  col += vec3(1.0) * sp * 0.55;

  // crest foam streaks near the viewer
  float foam = smoothstep(0.62, 0.95, h + (noise(P * 0.06 + t) - 0.5) * 0.4) * smoothstep(0.25, 0.9, depth);
  col = mix(col, vec3(0.92, 0.97, 1.0), foam * 0.45);

  // horizon haze
  col = mix(col, vec3(0.93, 0.9, 0.84), smoothstep(0.08, 0.0, depth) * 0.75);
  col *= uDim;
  finalColor = vec4(col, 1.0);
}
`

export class Ocean {
  mesh: Mesh<Geometry, Shader>
  private uniforms: {
    uTime: number
    uCamX: number
    uSize: Float32Array
    uD0: number
    uSunX: number
    uDim: number
  }

  constructor() {
    const geometry = new Geometry({
      attributes: {
        aPosition: [0, 0, 1, 0, 1, 1, 0, 1],
        aUV: [0, 0, 1, 0, 1, 1, 0, 1]
      },
      indexBuffer: [0, 1, 2, 0, 2, 3]
    })
    const shader = Shader.from({
      gl: { vertex, fragment },
      resources: {
        oceanUniforms: {
          uTime: { value: 0, type: 'f32' },
          uCamX: { value: 0, type: 'f32' },
          uSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uD0: { value: 250, type: 'f32' },
          uSunX: { value: 0, type: 'f32' },
          uDim: { value: 1, type: 'f32' }
        }
      }
    })
    this.mesh = new Mesh({ geometry, shader })
    this.uniforms = shader.resources.oceanUniforms.uniforms
  }

  layout(width: number, height: number, d0: number) {
    this.mesh.scale.set(width, height)
    this.uniforms.uSize[0] = width
    this.uniforms.uSize[1] = height
    this.uniforms.uD0 = d0
  }

  update(time: number, camX: number, sunX: number, dim = 1) {
    this.uniforms.uTime = time
    this.uniforms.uCamX = camX
    this.uniforms.uSunX = sunX
    this.uniforms.uDim = dim
  }
}
