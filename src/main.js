import "./style.css";

const SHADERS = [
  {
    id: "goo-raymarch",
    name: "Goo Raymarch (first)",
    source: String.raw`
#define t (iTime * uTimeScale)

#define MAX_STEPS 128
#define MAX_DIST 200.0
#define SURFACE_DIST 0.01
#define PROCESSED_LIGHTS 3

struct DistanceInfo {
    float dist;
    int id;
};

float smin(float a, float b, float k) {
    float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
    return mix(b, a, h) - k * h * (1.0 - h);
}

float sdSphere(vec3 p, vec3 c, float r) {
    return length(p - c) - r;
}

DistanceInfo map(vec3 rp) {
    vec3 wp = rp;
    wp.x += sin(rp.z * 0.5 + t * 2.0) * 0.3;
    wp.z += cos(rp.x * 0.5 + t * 1.5) * 0.3;

    float wave = sin(wp.x * uWaveFreq + t * 8.0) * uPlaneWave;
    wave += sin(wp.z * uWaveFreq * 0.7 + t * 5.0) * uPlaneWave * 0.6;
    wave += sin((wp.x + wp.z) * uWaveFreq * 1.3 + t * 3.0) * uPlaneWave * 0.3;

    float plane = rp.y + rp.z * uPlaneTilt + wave;

    float b1 = sdSphere(rp, vec3(
        sin(t * 1.2) * 6.0,
        sin(t * 0.8) * uBlobHeight - 0.5,
        cos(t * 0.6) * 8.0
    ), uBlobSize);

    float b2 = sdSphere(rp, vec3(
        cos(t * 0.9) * 7.0,
        sin(t * 1.1 + 2.0) * uBlobHeight - 0.3,
        sin(t * 0.7 + 1.0) * 6.0
    ), uBlobSize * 0.8);

    float b3 = sdSphere(rp, vec3(
        sin(t * 0.7 + 4.0) * 5.0,
        sin(t * 1.3 + 1.0) * uBlobHeight - 0.2,
        cos(t * 1.1 + 3.0) * 5.0
    ), uBlobSize * 0.65);

    float d = smin(plane, b1, uGooiness);
    d = smin(d, b2, uGooiness);
    d = smin(d, b3, uGooiness);

    return DistanceInfo(d, 10);
}

DistanceInfo march(vec3 ro, vec3 rd) {
    float md = 0.0;
    DistanceInfo di = DistanceInfo(0.0, -1);
    for (int i = 0; i < MAX_STEPS; i++) {
        vec3 rp = ro + rd * md - 0.71;
        di = map(rp);
        md += di.dist;
        if (md > MAX_DIST) {
            di.id = -1;
            break;
        }
        if (di.dist < SURFACE_DIST) {
            break;
        }
    }
    return DistanceInfo(md, di.id);
}

vec3 getNormal(vec3 p) {
    float d = map(p).dist;
    vec2 e = vec2(0.01, 0.0);
    vec3 n = d - vec3(
        map(p - e.xyy).dist,
        map(p - e.yxy).dist,
        map(p - e.yyx).dist
    );
    return normalize(n);
}

struct LightOutput {
    float diffuse;
    float specular;
    float attenuation;
};

struct LightData {
    vec3 position;
    float intensity;
};

LightOutput light(vec3 ro, vec3 p, vec3 normal, LightData data) {
    vec3 lv = normalize(data.position - p);
    float diffuse = max(dot(normal, lv), 0.0);

    vec3 viewVector = normalize(p - ro);
    vec3 lr = reflect(lv, normal);
    float specular = smoothstep(0.0, 0.31, pow(max(dot(viewVector, lr), 0.0), 50.0));

    float attenuation = 0.0;
    // Keep shadow march only for the key light to reduce GPU cost.
    if (data.intensity > 0.6) {
        float sd = march(p + normal * SURFACE_DIST * 2.0, lv).dist;
        float lightDist = length(data.position - p);
        if (sd < lightDist) {
            attenuation = 0.5;
        }
    }

    return LightOutput(diffuse * data.intensity, specular * data.intensity, attenuation);
}

vec3 shade(vec3 rd, vec3 ro, DistanceInfo di) {
    if (di.id == -1) {
        return vec3(0.0);
    }

    vec3 p = ro + rd * di.dist;
    vec3 n = getNormal(p);
    vec3 lightPos = vec3(1.35, 6.00, 3.58 + sin(t * 0.5));

    LightOutput lights[3];
    lights[0] = light(ro, p, n, LightData(lightPos, 0.7));
    lights[1] = light(ro, p, n, LightData(lightPos + vec3(-18.85), 0.1));
    lights[2] = light(ro, p, n, LightData(lightPos + vec3(55.0, 0.0, 64.0), 0.5));

    vec3 ambient = vec3(uAmbientIntensity, uAmbientIntensity, uAmbientIntensity + 0.34);

    float diffuse = 0.0;
    float specular = 0.0;
    float attenuation = 0.0;
    for (int i = 0; i < PROCESSED_LIGHTS; i++) {
        diffuse += lights[i].diffuse;
        specular += lights[i].specular;
        attenuation += lights[i].attenuation;
    }

    float fresnel = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * uFresnel;
    vec3 litColor = (ambient + diffuse) * uBaseColor + specular + fresnel * uBaseColor * 0.5;
    return litColor * (1.0 - attenuation);
}

vec4 image(vec2 fragCoord, vec2 uv) {
    vec3 ro = uCameraPos;
    vec3 rd = normalize(normalize(vec3(uv.x, uv.y, 1.0)) + uViewOffset);

    DistanceInfo di = march(ro, rd);
    vec3 col = shade(rd, ro, di);

    return vec4(col, 1.0);
}

vec2 setupSpace(in vec2 f, in vec2 res) {
    return (f.xy / res.xy - 0.5) * vec2(res.x / res.y, 1.0) * 2.0;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec2 uv = setupSpace(fragCoord, iResolution.xy);
    fragColor = image(fragCoord, uv);
}
`,
    controls: [
      { id: "time", label: "Time Scale", min: 0.0, max: 3.0, step: 0.01, defaultValue: 0.18, uniform: "uTimeScale", group: "float" },
      { id: "ambient", label: "Ambient", min: 0.0, max: 1.0, step: 0.01, defaultValue: 0.0, uniform: "uAmbientIntensity", group: "float" },
      { id: "plane", label: "Plane Wave", min: 0.0, max: 0.5, step: 0.005, defaultValue: 0.27, uniform: "uPlaneWave", group: "float" },
      { id: "wave-freq", label: "Wave Freq", min: 0.1, max: 4.0, step: 0.01, defaultValue: 3.61, uniform: "uWaveFreq", group: "float" },
      { id: "plane-tilt", label: "Plane Tilt", min: -0.3, max: 0.3, step: 0.005, defaultValue: -0.3, uniform: "uPlaneTilt", group: "float" },
      { id: "gooiness", label: "Gooiness", min: 0.1, max: 4.0, step: 0.01, defaultValue: 0.93, uniform: "uGooiness", group: "float" },
      { id: "blob-size", label: "Blob Size", min: 0.0, max: 5.0, step: 0.01, defaultValue: 0.0, uniform: "uBlobSize", group: "float" },
      { id: "blob-height", label: "Blob Height", min: 0.0, max: 5.0, step: 0.01, defaultValue: 0.37, uniform: "uBlobHeight", group: "float" },
      { id: "fresnel", label: "Fresnel Glow", min: 0.0, max: 2.0, step: 0.01, defaultValue: 1.5, uniform: "uFresnel", group: "float" },
      { id: "camera-x", label: "Camera X", min: -30.0, max: 30.0, step: 0.01, defaultValue: 14.87, uniform: "uCameraPosX", group: "vec3", vector: "uCameraPos", index: 0 },
      { id: "camera-y", label: "Camera Y", min: -30.0, max: 30.0, step: 0.01, defaultValue: 17.41, uniform: "uCameraPosY", group: "vec3", vector: "uCameraPos", index: 1 },
      { id: "camera-z", label: "Camera Z", min: -40.0, max: 40.0, step: 0.01, defaultValue: -40.0, uniform: "uCameraPosZ", group: "vec3", vector: "uCameraPos", index: 2 },
      { id: "view-x", label: "View X", min: -3.0, max: 3.0, step: 0.01, defaultValue: -0.38, uniform: "uViewOffsetX", group: "vec3", vector: "uViewOffset", index: 0 },
      { id: "view-y", label: "View Y", min: -3.0, max: 3.0, step: 0.01, defaultValue: -2.04, uniform: "uViewOffsetY", group: "vec3", vector: "uViewOffset", index: 1 },
      { id: "view-z", label: "View Z", min: -3.0, max: 3.0, step: 0.01, defaultValue: -1.66, uniform: "uViewOffsetZ", group: "vec3", vector: "uViewOffset", index: 2 },
      { id: "r", label: "Color R", min: 0.0, max: 1.0, step: 0.01, defaultValue: 0.77, uniform: "uBaseColorR", group: "vec3", vector: "uBaseColor", index: 0 },
      { id: "g", label: "Color G", min: 0.0, max: 1.0, step: 0.01, defaultValue: 0.0, uniform: "uBaseColorG", group: "vec3", vector: "uBaseColor", index: 1 },
      { id: "b", label: "Color B", min: 0.0, max: 1.0, step: 0.01, defaultValue: 0.98, uniform: "uBaseColorB", group: "vec3", vector: "uBaseColor", index: 2 },
    ],
  },
  {
    id: "turbulence-sphere",
    name: "Turbulence Sphere (second)",
    source: String.raw`
void mainImage(out vec4 O, vec2 I) {
    vec3 p;
    vec3 r = normalize(vec3(I + I, 0.0) - iResolution.xyy);
    vec3 a = normalize(tan((iTime * uTimeScale) * 0.2 + vec3(0.0, 2.0, 5.0)));
    float t = 0.0;
    float v = 0.0;

    O = vec4(0.0);
    for (int step = 0; step < 60; step++) {
        float fi = float(step);
        p = t * r;
        p.z += uCameraOffset;
        p = a * dot(a, p) * 2.0 - p;
        for (int ni = 0; ni < 8; ni++) {
            float n = float(ni) + 0.7;
            p += 3.0 * sin(floor(p.zxy * n + iTime * uTimeScale * n + fi * 0.01)) / n;
        }
        v = abs(length(p) - uSphereRadius) + uDensityBias;
        O += exp(sin(t + vec4(0.0, 2.0, 3.0, 0.0))) / v;
        t += v * uDensityStep;
    }

    vec3 mapped = 1.0 - exp(-O.rgb / uToneMap);
    O = vec4(mapped * uTint, 1.0);
}
`,
    controls: [
      { id: "time", label: "Time Scale", min: 0.0, max: 3.0, step: 0.01, defaultValue: 1.0, uniform: "uTimeScale", group: "float" },
      { id: "camera", label: "Camera Z Offset", min: 0.5, max: 12.0, step: 0.05, defaultValue: 5.0, uniform: "uCameraOffset", group: "float" },
      { id: "step", label: "Density Step", min: 0.01, max: 0.4, step: 0.005, defaultValue: 0.1, uniform: "uDensityStep", group: "float" },
      { id: "bias", label: "Density Bias", min: 0.001, max: 0.2, step: 0.001, defaultValue: 0.01, uniform: "uDensityBias", group: "float" },
      { id: "radius", label: "Sphere Radius", min: 0.5, max: 4.0, step: 0.01, defaultValue: 2.0, uniform: "uSphereRadius", group: "float" },
      { id: "tonemap", label: "Tone Map", min: 20.0, max: 600.0, step: 1.0, defaultValue: 200.0, uniform: "uToneMap", group: "float" },
      { id: "color-r", label: "Color R", min: 0.0, max: 2.0, step: 0.01, defaultValue: 1.0, uniform: "uTintR", group: "vec3", vector: "uTint", index: 0 },
      { id: "color-g", label: "Color G", min: 0.0, max: 2.0, step: 0.01, defaultValue: 1.0, uniform: "uTintG", group: "vec3", vector: "uTint", index: 1 },
      { id: "color-b", label: "Color B", min: 0.0, max: 2.0, step: 0.01, defaultValue: 1.0, uniform: "uTintB", group: "vec3", vector: "uTint", index: 2 },
    ],
  },
  {
    id: "70s-melt",
    name: "70s Melt (third)",
    source: String.raw`
#ifdef GL_ES
precision mediump float;
#endif

float cosRange(float amt, float range, float minimum) {
    return (((1.0 + cos(radians(amt))) * 0.5) * range) + minimum;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    const int maxZoom = 80;
    float time = iTime * uTimeScale;
    vec2 uv = fragCoord.xy / iResolution.xy;
    vec2 p = (2.0 * fragCoord.xy - iResolution.xy) / max(iResolution.x, iResolution.y);
    float ct = cosRange(time * 5.0, 3.0, 1.1);
    float xBoost = cosRange(time * 0.2, 5.0, 5.0);
    float yBoost = cosRange(time * 0.1, 10.0, 5.0);
    float fScale = cosRange(time * 15.5, 1.25, 0.5);

    for (int i = 1; i < maxZoom; i++) {
        if (float(i) >= uZoom) {
            break;
        }
        float fi = float(i);
        vec2 newp = p;
        newp.x += 0.25 / fi * sin(fi * p.y + time * cos(ct) * 0.5 / 20.0 + 0.005 * fi) * fScale + xBoost;
        newp.y += 0.25 / fi * sin(fi * p.x + time * ct * 0.3 / 40.0 + 0.03 * float(i + 15)) * fScale + yBoost;
        p = newp;
    }

    vec3 col = vec3(
        0.5 * sin(3.0 * p.x) + 0.5,
        0.5 * sin(3.0 * p.y) + 0.5,
        sin(p.x + p.y)
    );
    col *= uBrightness;

    float vigAmt = uVignette;
    float vignette = (1.0 - vigAmt * (uv.y - 0.5) * (uv.y - 0.5))
        * (1.0 - vigAmt * (uv.x - 0.5) * (uv.x - 0.5));
    float extrusion = (col.x + col.y + col.z) / 4.0;
    extrusion *= 1.5;
    extrusion *= vignette;

    fragColor = vec4(col, extrusion);
}
`,
    controls: [
      { id: "time", label: "Time Scale", min: 0.0, max: 3.0, step: 0.01, defaultValue: 1.25, uniform: "uTimeScale", group: "float" },
      { id: "brightness", label: "Brightness", min: 0.2, max: 2.0, step: 0.01, defaultValue: 0.975, uniform: "uBrightness", group: "float" },
      { id: "vignette", label: "Vignette", min: 0.0, max: 10.0, step: 0.1, defaultValue: 5.0, uniform: "uVignette", group: "float" },
      { id: "zoom", label: "Zoom Iterations", min: 4.0, max: 79.0, step: 1.0, defaultValue: 40.0, uniform: "uZoom", group: "float" },
    ],
  },
];

const VERTEX_SOURCE = `
attribute vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const app = document.querySelector("#app");
app.innerHTML = `
  <div class="layout">
    <aside class="panel">
      <h1>GLSL Playground</h1>
      <p class="intro">Swap shaders, tweak uniforms, edit GLSL, and compile.</p>

      <label class="field">
        <span>Shader preset</span>
        <select id="shader-select"></select>
      </label>

      <label class="field">
        <span>Performance</span>
        <select id="performance-select"></select>
      </label>

      <div id="param-controls" class="param-controls"></div>

      <div class="button-row">
        <button id="reset-params" type="button">Reset Params</button>
        <button id="compile-shader" type="button">Compile Shader</button>
        <button id="copy-settings" class="button-wide" type="button">Copy Settings JSON</button>
      </div>

      <label class="field grow">
        <span>Fragment source</span>
        <textarea id="shader-source" spellcheck="false"></textarea>
      </label>

      <p id="compile-status" class="status">Ready.</p>
    </aside>

    <main class="viewport">
      <canvas id="shader-canvas"></canvas>
      <video
        id="shader-overlay-video"
        class="shader-overlay-video"
        src="/overlay.mp4"
        autoplay
        loop
        muted
        playsinline
        preload="metadata"
      ></video>
    </main>
  </div>
`;

const shaderSelect = document.querySelector("#shader-select");
const performanceSelect = document.querySelector("#performance-select");
const controlsRoot = document.querySelector("#param-controls");
const sourceEditor = document.querySelector("#shader-source");
const compileButton = document.querySelector("#compile-shader");
const resetButton = document.querySelector("#reset-params");
const copySettingsButton = document.querySelector("#copy-settings");
const statusNode = document.querySelector("#compile-status");
const canvas = document.querySelector("#shader-canvas");
const overlayVideo = document.querySelector("#shader-overlay-video");
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: "low-power",
});

if (!gl) {
  throw new Error("WebGL is required for this playground.");
}

const fullScreenQuad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, fullScreenQuad);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1,
  ]),
  gl.STATIC_DRAW,
);

const sourceState = new Map(SHADERS.map((shader) => [shader.id, shader.source]));
const uniformState = new Map(
  SHADERS.map((shader) => [
    shader.id,
    Object.fromEntries(shader.controls.map((control) => [control.uniform, control.defaultValue])),
  ]),
);

let activeShaderId = SHADERS[0].id;
let frame = 0;
let startTime = performance.now();
let pointerDown = false;
const mouse = { x: 0, y: 0, clickX: 0, clickY: 0 };
let canvasPixelRatio = 1;
let lastRenderAt = 0;
let hiddenStartedAt = null;

const PERFORMANCE_PRESETS = {
  eco: {
    label: "Eco (24 FPS, 50%)",
    fps: 24,
    maxDevicePixelRatio: 1.0,
    resolutionScale: 0.5,
  },
  balanced: {
    label: "Balanced (30 FPS, 67%)",
    fps: 30,
    maxDevicePixelRatio: 1.25,
    resolutionScale: 0.67,
  },
  high: {
    label: "High (60 FPS, 100%)",
    fps: 60,
    maxDevicePixelRatio: 2.0,
    resolutionScale: 1.0,
  },
};
let activePerformancePresetId = "high";
let activePerformancePreset = PERFORMANCE_PRESETS[activePerformancePresetId];

let programState = {
  program: null,
  attributeLocation: -1,
  baseUniforms: null,
  controlUniformLocations: new Map(),
  vectorUniformLocations: new Map(),
};

const SETTINGS_STORAGE_KEY = "sip-shop-shader:settings:v1";
const SETTINGS_STORAGE_VERSION = 1;

function getDefaultUniformValues(shader) {
  return Object.fromEntries(shader.controls.map((control) => [control.uniform, control.defaultValue]));
}

function createSerializableState() {
  sourceState.set(activeShaderId, sourceEditor.value);
  const serializedUniformState = Object.fromEntries(
    SHADERS.map((shader) => [
      shader.id,
      { ...(uniformState.get(shader.id) ?? getDefaultUniformValues(shader)) },
    ]),
  );

  return {
    version: SETTINGS_STORAGE_VERSION,
    activeShaderId,
    activePerformancePresetId,
    sourceState: Object.fromEntries(sourceState),
    uniformState: serializedUniformState,
  };
}

function persistState() {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(createSerializableState()));
  } catch {
    // Ignore storage quota and private mode failures.
  }
}

function hydrateStateFromStorage() {
  let rawState;
  try {
    rawState = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return;
  }

  if (!rawState) {
    return;
  }

  let parsedState;
  try {
    parsedState = JSON.parse(rawState);
  } catch {
    return;
  }

  if (!parsedState || typeof parsedState !== "object") {
    return;
  }

  const shaderIds = new Set(SHADERS.map((shader) => shader.id));
  if (typeof parsedState.activeShaderId === "string" && shaderIds.has(parsedState.activeShaderId)) {
    activeShaderId = parsedState.activeShaderId;
  }

  if (
    typeof parsedState.activePerformancePresetId === "string"
    && parsedState.activePerformancePresetId in PERFORMANCE_PRESETS
  ) {
    activePerformancePresetId = parsedState.activePerformancePresetId;
    activePerformancePreset = PERFORMANCE_PRESETS[activePerformancePresetId];
  }

  const savedSources = parsedState.sourceState;
  if (savedSources && typeof savedSources === "object") {
    SHADERS.forEach((shader) => {
      const savedSource = savedSources[shader.id];
      if (typeof savedSource === "string") {
        sourceState.set(shader.id, savedSource);
      }
    });
  }

  const savedUniforms = parsedState.uniformState;
  SHADERS.forEach((shader) => {
    const mergedUniforms = getDefaultUniformValues(shader);
    const shaderSavedUniforms = savedUniforms?.[shader.id];
    if (shaderSavedUniforms && typeof shaderSavedUniforms === "object") {
      shader.controls.forEach((control) => {
        const savedValue = shaderSavedUniforms[control.uniform];
        if (typeof savedValue === "number" && Number.isFinite(savedValue)) {
          mergedUniforms[control.uniform] = savedValue;
        }
      });
    }
    uniformState.set(shader.id, mergedUniforms);
  });
}

function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }

  return new Promise((resolve, reject) => {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "true");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    helper.style.pointerEvents = "none";
    document.body.appendChild(helper);
    helper.focus();
    helper.select();

    try {
      const copied = document.execCommand("copy");
      if (copied) {
        resolve();
      } else {
        reject(new Error("Copy command failed"));
      }
    } catch (error) {
      reject(error);
    } finally {
      document.body.removeChild(helper);
    }
  });
}

function destroyActiveProgram() {
  if (programState.program) {
    gl.deleteProgram(programState.program);
  }
  programState = {
    program: null,
    attributeLocation: -1,
    baseUniforms: null,
    controlUniformLocations: new Map(),
    vectorUniformLocations: new Map(),
  };
}

function getActiveShader() {
  return SHADERS.find((shader) => shader.id === activeShaderId);
}

function setStatus(message, type = "idle") {
  statusNode.textContent = message;
  statusNode.classList.remove("error", "success");
  if (type === "error") {
    statusNode.classList.add("error");
  } else if (type === "success") {
    statusNode.classList.add("success");
  }
}

function formatValue(value) {
  if (Math.abs(value) >= 100 || Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(3).replace(/\.?0+$/, "");
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function updateMousePosition(event) {
  const rect = canvas.getBoundingClientRect();
  mouse.x = (event.clientX - rect.left) * canvasPixelRatio;
  mouse.y = (rect.height - (event.clientY - rect.top)) * canvasPixelRatio;
}

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = true;
  updateMousePosition(event);
  mouse.clickX = mouse.x;
  mouse.clickY = mouse.y;
});

canvas.addEventListener("pointermove", (event) => {
  updateMousePosition(event);
});

canvas.addEventListener("pointerup", () => {
  pointerDown = false;
});

canvas.addEventListener("pointerleave", () => {
  pointerDown = false;
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    overlayVideo?.pause();
    hiddenStartedAt = performance.now();
    return;
  }
  overlayVideo?.play().catch(() => {});
  if (hiddenStartedAt !== null) {
    startTime += performance.now() - hiddenStartedAt;
    hiddenStartedAt = null;
  }
  lastRenderAt = 0;
});

overlayVideo?.play().catch(() => {});

function createShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function createProgram(vertexSource, fragmentSource) {
  const vertexShader = createShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function getControlDeclarations(shader) {
  const floatUniforms = shader.controls
    .filter((control) => control.group === "float")
    .map((control) => `uniform float ${control.uniform};`);

  const vectorUniformSet = new Set(
    shader.controls
      .filter((control) => control.group === "vec3" && control.vector)
      .map((control) => control.vector),
  );
  const vectorUniforms = Array.from(vectorUniformSet).map((uniform) => `uniform vec3 ${uniform};`);

  return [...floatUniforms, ...vectorUniforms].join("\n");
}

function buildFragmentSource(shader, userSource) {
  return `
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform float iFrame;
${getControlDeclarations(shader)}
${userSource}
void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;
}

function getReadableShaderError(error, source) {
  const lines = source.split("\n");
  const sample = lines
    .slice(0, 25)
    .map((line, index) => `${String(index + 1).padStart(3, " ")} | ${line}`)
    .join("\n");
  return `${error.message}\n\nSource preview:\n${escapeHtml(sample)}`;
}

function compileActiveShader() {
  const shader = getActiveShader();
  const userSource = sourceState.get(shader.id) ?? shader.source;
  const fragmentSource = buildFragmentSource(shader, userSource);

  try {
    const program = createProgram(VERTEX_SOURCE, fragmentSource);

    if (programState.program) {
      gl.deleteProgram(programState.program);
    }

    const attributeLocation = gl.getAttribLocation(program, "aPosition");
    const baseUniforms = {
      iResolution: gl.getUniformLocation(program, "iResolution"),
      iTime: gl.getUniformLocation(program, "iTime"),
      iMouse: gl.getUniformLocation(program, "iMouse"),
      iFrame: gl.getUniformLocation(program, "iFrame"),
    };

    const controlUniformLocations = new Map();
    shader.controls.forEach((control) => {
      if (control.group === "float") {
        controlUniformLocations.set(control.uniform, gl.getUniformLocation(program, control.uniform));
      }
    });

    const vectorUniformLocations = new Map();
    shader.controls.forEach((control) => {
      if (control.group === "vec3" && control.vector && !vectorUniformLocations.has(control.vector)) {
        vectorUniformLocations.set(control.vector, gl.getUniformLocation(program, control.vector));
      }
    });

    programState = {
      program,
      attributeLocation,
      baseUniforms,
      controlUniformLocations,
      vectorUniformLocations,
    };

    setStatus(`Compiled: ${shader.name}`, "success");
  } catch (error) {
    setStatus("Compile failed. Check shader log below.", "error");
    statusNode.innerHTML = `<strong>Compile failed</strong><br/><pre>${getReadableShaderError(error, fragmentSource)}</pre>`;
  }
}

function createControlRow(shader, control, values) {
  const row = document.createElement("label");
  row.className = "control-row";

  const label = document.createElement("span");
  label.className = "control-label";
  label.textContent = control.label;

  const valueNode = document.createElement("span");
  valueNode.className = "control-value";
  valueNode.textContent = formatValue(values[control.uniform]);

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(control.min);
  slider.max = String(control.max);
  slider.step = String(control.step);
  slider.value = String(values[control.uniform]);

  slider.addEventListener("input", () => {
    const nextValue = Number(slider.value);
    values[control.uniform] = nextValue;
    valueNode.textContent = formatValue(nextValue);
    persistState();
  });

  row.append(label, valueNode, slider);
  return row;
}

function renderControls() {
  const shader = getActiveShader();
  const values = uniformState.get(shader.id);
  controlsRoot.innerHTML = "";
  shader.controls.forEach((control) => {
    controlsRoot.appendChild(createControlRow(shader, control, values));
  });
}

function resetActiveParams() {
  const shader = getActiveShader();
  const values = uniformState.get(shader.id);
  shader.controls.forEach((control) => {
    values[control.uniform] = control.defaultValue;
  });
  renderControls();
  persistState();
}

function applyPerformancePreset(presetId) {
  if (!PERFORMANCE_PRESETS[presetId]) {
    return;
  }
  activePerformancePresetId = presetId;
  activePerformancePreset = PERFORMANCE_PRESETS[presetId];
  lastRenderAt = 0;
  resizeCanvas();
  persistState();
}

function applyUniforms() {
  const shader = getActiveShader();
  const values = uniformState.get(shader.id);

  shader.controls.forEach((control) => {
    if (control.group === "float") {
      const location = programState.controlUniformLocations.get(control.uniform);
      if (location) {
        gl.uniform1f(location, values[control.uniform]);
      }
    }
  });

  const vec3Buckets = new Map();
  shader.controls.forEach((control) => {
    if (control.group === "vec3" && control.vector !== undefined && control.index !== undefined) {
      const current = vec3Buckets.get(control.vector) ?? [0, 0, 0];
      current[control.index] = values[control.uniform];
      vec3Buckets.set(control.vector, current);
    }
  });

  vec3Buckets.forEach((vector, uniformName) => {
    const location = programState.vectorUniformLocations.get(uniformName);
    if (location) {
      gl.uniform3f(location, vector[0], vector[1], vector[2]);
    }
  });
}

function resizeCanvas() {
  const devicePixelRatio = window.devicePixelRatio || 1;
  const limitedDpr = Math.min(devicePixelRatio, activePerformancePreset.maxDevicePixelRatio);
  const renderPixelRatio = Math.max(0.2, limitedDpr * activePerformancePreset.resolutionScale);
  const width = Math.max(1, Math.floor(canvas.clientWidth * renderPixelRatio));
  const height = Math.max(1, Math.floor(canvas.clientHeight * renderPixelRatio));
  canvasPixelRatio = renderPixelRatio;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, canvas.width, canvas.height);
}

function render(now) {
  requestAnimationFrame(render);
  if (!programState.program) {
    return;
  }
  if (document.hidden) {
    return;
  }
  const frameBudgetMs = 1000 / activePerformancePreset.fps;
  if (lastRenderAt !== 0 && now - lastRenderAt < frameBudgetMs) {
    return;
  }
  lastRenderAt = now;

  resizeCanvas();
  gl.useProgram(programState.program);

  gl.bindBuffer(gl.ARRAY_BUFFER, fullScreenQuad);
  gl.enableVertexAttribArray(programState.attributeLocation);
  gl.vertexAttribPointer(programState.attributeLocation, 2, gl.FLOAT, false, 0, 0);

  const time = (now - startTime) * 0.001;
  gl.uniform3f(programState.baseUniforms.iResolution, canvas.width, canvas.height, 1.0);
  gl.uniform1f(programState.baseUniforms.iTime, time);
  gl.uniform4f(
    programState.baseUniforms.iMouse,
    mouse.x,
    mouse.y,
    pointerDown ? mouse.clickX : -mouse.clickX,
    pointerDown ? mouse.clickY : -mouse.clickY,
  );
  gl.uniform1f(programState.baseUniforms.iFrame, frame++);

  applyUniforms();
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

SHADERS.forEach((shader) => {
  const option = document.createElement("option");
  option.value = shader.id;
  option.textContent = shader.name;
  shaderSelect.appendChild(option);
});

Object.entries(PERFORMANCE_PRESETS).forEach(([id, preset]) => {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = preset.label;
  performanceSelect.appendChild(option);
});

hydrateStateFromStorage();
shaderSelect.value = activeShaderId;
performanceSelect.value = activePerformancePresetId;
sourceEditor.value = sourceState.get(activeShaderId) ?? "";
renderControls();
compileActiveShader();
requestAnimationFrame(render);
persistState();

shaderSelect.addEventListener("change", () => {
  sourceState.set(activeShaderId, sourceEditor.value);
  destroyActiveProgram();
  activeShaderId = shaderSelect.value;
  sourceEditor.value = sourceState.get(activeShaderId) ?? "";
  frame = 0;
  startTime = performance.now();
  renderControls();
  compileActiveShader();
  persistState();
});

performanceSelect.addEventListener("change", () => {
  applyPerformancePreset(performanceSelect.value);
});

sourceEditor.addEventListener("input", () => {
  sourceState.set(activeShaderId, sourceEditor.value);
  persistState();
});

sourceEditor.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    compileActiveShader();
  }
});

compileButton.addEventListener("click", () => {
  compileActiveShader();
});

resetButton.addEventListener("click", () => {
  resetActiveParams();
});

copySettingsButton.addEventListener("click", async () => {
  const settingsJson = JSON.stringify(createSerializableState(), null, 2);
  try {
    await copyTextToClipboard(settingsJson);
    setStatus("Settings JSON copied to clipboard.", "success");
  } catch {
    window.prompt("Clipboard blocked. Copy settings JSON:", settingsJson);
    setStatus("Clipboard blocked. Opened JSON in prompt.", "error");
  }
});
