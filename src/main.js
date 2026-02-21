import "./style.css";

const SHADER = {
  id: "goo-raymarch",
  name: "Goo Raymarch",
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
    { id: "time", uniform: "uTimeScale", defaultValue: 0.18, group: "float" },
    { id: "ambient", uniform: "uAmbientIntensity", defaultValue: 0.34, group: "float" },
    { id: "plane", uniform: "uPlaneWave", defaultValue: 0.11, group: "float" },
    { id: "wave-freq", uniform: "uWaveFreq", defaultValue: 3.54, group: "float" },
    { id: "plane-tilt", uniform: "uPlaneTilt", defaultValue: -0.225, group: "float" },
    { id: "gooiness", uniform: "uGooiness", defaultValue: 0.5, group: "float" },
    { id: "blob-size", uniform: "uBlobSize", defaultValue: 2.36, group: "float" },
    { id: "blob-height", uniform: "uBlobHeight", defaultValue: 0.12, group: "float" },
    { id: "fresnel", uniform: "uFresnel", defaultValue: 0.41, group: "float" },
    { id: "camera-x", uniform: "uCameraPosX", defaultValue: 2.84, group: "vec3", vector: "uCameraPos", index: 0 },
    { id: "camera-y", uniform: "uCameraPosY", defaultValue: 18.29, group: "vec3", vector: "uCameraPos", index: 1 },
    { id: "camera-z", uniform: "uCameraPosZ", defaultValue: 16.49, group: "vec3", vector: "uCameraPos", index: 2 },
    { id: "view-x", uniform: "uViewOffsetX", defaultValue: -0.24, group: "vec3", vector: "uViewOffset", index: 0 },
    { id: "view-y", uniform: "uViewOffsetY", defaultValue: -2.04, group: "vec3", vector: "uViewOffset", index: 1 },
    { id: "view-z", uniform: "uViewOffsetZ", defaultValue: -1.07, group: "vec3", vector: "uViewOffset", index: 2 },
    { id: "r", uniform: "uBaseColorR", defaultValue: 0.51, group: "vec3", vector: "uBaseColor", index: 0 },
    { id: "g", uniform: "uBaseColorG", defaultValue: 0, group: "vec3", vector: "uBaseColor", index: 1 },
    { id: "b", uniform: "uBaseColorB", defaultValue: 0.98, group: "vec3", vector: "uBaseColor", index: 2 },
  ],
};

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

      <label class="field">
        <span>Performance</span>
        <select id="performance-select"></select>
      </label>

      <label class="field grow">
        <span>Fragment source</span>
        <textarea id="shader-source" spellcheck="false" readonly></textarea>
      </label>

      <div class="button-row">
        <button id="copy-shader" class="button-wide" type="button">Copy Shader Source</button>
      </div>

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

const performanceSelect = document.querySelector("#performance-select");
const sourceEditor = document.querySelector("#shader-source");
const copyShaderButton = document.querySelector("#copy-shader");
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

const uniformValues = Object.fromEntries(
  SHADER.controls.map((control) => [control.uniform, control.defaultValue]),
);

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
let activePerformancePresetId = "balanced";
let activePerformancePreset = PERFORMANCE_PRESETS[activePerformancePresetId];

let programState = {
  program: null,
  attributeLocation: -1,
  baseUniforms: null,
  controlUniformLocations: new Map(),
  vectorUniformLocations: new Map(),
};

function setStatus(message, type = "idle") {
  statusNode.textContent = message;
  statusNode.classList.remove("error", "success");
  if (type === "error") {
    statusNode.classList.add("error");
  } else if (type === "success") {
    statusNode.classList.add("success");
  }
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

function getControlDeclarations() {
  const floatUniforms = SHADER.controls
    .filter((control) => control.group === "float")
    .map((control) => `uniform float ${control.uniform};`);

  const vectorUniformSet = new Set(
    SHADER.controls
      .filter((control) => control.group === "vec3" && control.vector)
      .map((control) => control.vector),
  );
  const vectorUniforms = Array.from(vectorUniformSet).map((uniform) => `uniform vec3 ${uniform};`);

  return [...floatUniforms, ...vectorUniforms].join("\n");
}

function buildFragmentSource(userSource) {
  return `
precision highp float;
uniform vec3 iResolution;
uniform float iTime;
uniform vec4 iMouse;
uniform float iFrame;
${getControlDeclarations()}
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

function compileShader() {
  const fragmentSource = buildFragmentSource(SHADER.source);

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
    SHADER.controls.forEach((control) => {
      if (control.group === "float") {
        controlUniformLocations.set(control.uniform, gl.getUniformLocation(program, control.uniform));
      }
    });

    const vectorUniformLocations = new Map();
    SHADER.controls.forEach((control) => {
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

    setStatus(`Compiled: ${SHADER.name}`, "success");
  } catch (error) {
    setStatus("Compile failed. Check shader log below.", "error");
    statusNode.innerHTML = `<strong>Compile failed</strong><br/><pre>${getReadableShaderError(error, fragmentSource)}</pre>`;
  }
}

function applyPerformancePreset(presetId) {
  if (!PERFORMANCE_PRESETS[presetId]) {
    return;
  }
  activePerformancePresetId = presetId;
  activePerformancePreset = PERFORMANCE_PRESETS[presetId];
  lastRenderAt = 0;
  resizeCanvas();
}

function applyUniforms() {
  SHADER.controls.forEach((control) => {
    if (control.group === "float") {
      const location = programState.controlUniformLocations.get(control.uniform);
      if (location) {
        gl.uniform1f(location, uniformValues[control.uniform]);
      }
    }
  });

  const vec3Buckets = new Map();
  SHADER.controls.forEach((control) => {
    if (control.group === "vec3" && control.vector !== undefined && control.index !== undefined) {
      const current = vec3Buckets.get(control.vector) ?? [0, 0, 0];
      current[control.index] = uniformValues[control.uniform];
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

Object.entries(PERFORMANCE_PRESETS).forEach(([id, preset]) => {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = preset.label;
  performanceSelect.appendChild(option);
});

performanceSelect.value = activePerformancePresetId;
sourceEditor.value = SHADER.source.trim();
compileShader();
requestAnimationFrame(render);

performanceSelect.addEventListener("change", () => {
  applyPerformancePreset(performanceSelect.value);
});

copyShaderButton.addEventListener("click", async () => {
  try {
    await copyTextToClipboard(SHADER.source.trim());
    setStatus("Shader source copied to clipboard.", "success");
  } catch {
    window.prompt("Clipboard blocked. Copy shader source:", SHADER.source.trim());
    setStatus("Clipboard blocked. Opened source in prompt.", "error");
  }
});
