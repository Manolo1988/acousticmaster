let products = [];
let currentData = null;
let coverageVisible = [];

const demoPayload = {
  room: { length: 20, width: 10, height: 8 },
  listener: { frontMargin: 1.2, rearMargin: 0.8, sideMargin: 0.7, earHeight: 1.2 },
  targets: { minSpl: 95, maxUniformity: 8, minHeadroom: 3 },
  models: ["V8PRO", "V10PRO", "MBS4641", "MBS4441", "CXD-60B"],
};

async function loadProducts() {
  const response = await fetch("/api/products");
  const data = await response.json();
  products = data.products || [];
}

function setLoading(isLoading, title = "仿真计算中") {
  document.getElementById("loadingTitle").textContent = title;
  document.getElementById("loadingOverlay").classList.toggle("hidden", !isLoading);
}

function setStatus(message, ok = true) {
  const node = document.getElementById("statusLine");
  node.className = `status-line ${ok ? "ok" : "warn"}`;
  node.textContent = message;
}

function normalizePayload(payload = {}) {
  if (payload.room && payload.listener && payload.targets) return payload;
  return {
    room: {
      length: Number(payload.length || payload.roomLength || 20),
      width: Number(payload.width || payload.roomWidth || 10),
      height: Number(payload.height || payload.roomHeight || payload.installHeight || 3),
    },
    listener: {
      frontMargin: Number(payload.frontMargin || 1.2),
      rearMargin: Number(payload.rearMargin || 0.8),
      sideMargin: Number(payload.sideMargin || 0.7),
      earHeight: Number(payload.earHeight || 1.2),
    },
    targets: {
      minSpl: Number(payload.minSpl || 95),
      maxUniformity: Number(payload.maxUniformity || 8),
      minHeadroom: Number(payload.minHeadroom || 3),
    },
    models: payload.models || extractSpeakerModels(payload.items || payload.equipment || []),
    geometry: payload.geometry || null,
  };
}

function extractSpeakerModels(items) {
  const models = new Set();
  for (const item of items) {
    const category = `${item.category || item.type || item["设备分类"] || ""}`;
    if (category.includes("音箱") || category.toLowerCase().includes("speaker")) {
      const model = item.model || item["型号规格"] || item["型号"] || item.spec;
      if (model) models.add(String(model).trim());
    }
  }
  return [...models];
}

async function simulate(payload) {
  setLoading(true);
  setStatus("正在调用声学仿真接口。");
  try {
    const request = normalizePayload(payload);
    if (!request.models || request.models.length === 0) {
      request.models = demoPayload.models;
    }
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "仿真失败");
    renderResult(data);
    window.parent?.postMessage({ type: "TOP_SOUND_SIMULATION_DONE", summary: data.best }, "*");
  } catch (error) {
    setStatus(error.message, false);
    window.parent?.postMessage({ type: "TOP_SOUND_SIMULATION_ERROR", error: error.message }, "*");
  } finally {
    setLoading(false);
  }
}

function renderResult(data) {
  currentData = data;
  coverageVisible = data.best.speakers.map(() => true);
  updateSummary(data);
  updateSpeakerTable();
  drawPlot();
  const room = data.config.room;
  document.getElementById("simSubtitle").textContent = `房间 ${room.length_m.toFixed(1)} m × ${room.width_m.toFixed(1)} m × ${room.height_m.toFixed(1)} m`;
  setStatus(`${data.best.feasible ? "当前方案满足筛选指标" : "当前方案未完全达标"}：${data.best.reason}`, data.best.feasible);
}

function updateSummary(data) {
  const best = data.best;
  document.getElementById("simTitle").textContent = `${best.model} ×${best.speakerCount}`;
  document.getElementById("simCost").textContent = `${best.totalCost.toFixed(0)} 元`;
  document.getElementById("simArea").textContent = `${data.config.room.area_m2.toFixed(1)} m²`;
  document.getElementById("simSpl").textContent = `${best.minSpl.toFixed(1)} / ${best.avgSpl.toFixed(1)} / ${best.maxSpl.toFixed(1)}`;
  document.getElementById("simUniformity").textContent = `${best.nonuniformity.toFixed(1)} dB`;
}

function updateSpeakerTable() {
  const speakers = currentData.best.speakers;
  document.getElementById("speakerTable").innerHTML = speakers.map((speaker, index) => `
    <tr class="${coverageVisible[index] ? "" : "muted-row"}">
      <td><button class="eye-button speaker-eye ${coverageVisible[index] ? "visible" : ""}" data-index="${index}" type="button"></button></td>
      <td>${speaker.role}</td>
      <td>${speaker.model}</td>
      <td>${formatVec(speaker.position)}</td>
      <td>${formatVec(speaker.aim)}</td>
      <td>${speaker.gainDb.toFixed(1)} dB</td>
    </tr>
  `).join("");
  document.querySelectorAll(".speaker-eye").forEach((button) => {
    button.addEventListener("click", () => {
      coverageVisible[Number(button.dataset.index)] = !coverageVisible[Number(button.dataset.index)];
      updateSpeakerTable();
      drawPlot();
    });
  });
  updateToggleAllButton();
}

function updateToggleAllButton() {
  const anyVisible = coverageVisible.some(Boolean);
  const button = document.getElementById("toggleAllCoverage");
  button.classList.toggle("visible", anyVisible);
  button.title = anyVisible ? "隐藏全部辐射范围" : "显示全部辐射范围";
}

function formatVec(vec) {
  return `(${vec.map((value) => Number(value).toFixed(2)).join(", ")})`;
}

function unit(vec) {
  const norm = Math.sqrt(vec.reduce((sum, value) => sum + value * value, 0));
  return norm < 1e-12 ? vec.slice() : vec.map((value) => value / norm);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function roomMesh(config) {
  const lx = config.room.length_m;
  const ly = config.room.width_m;
  const lz = config.room.height_m;
  const vertices = [[0, 0, 0], [lx, 0, 0], [lx, ly, 0], [0, ly, 0], [0, 0, lz], [lx, 0, lz], [lx, ly, lz], [0, ly, lz]];
  const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]];
  return { type: "mesh3d", name: "Room", x: vertices.map((p) => p[0]), y: vertices.map((p) => p[1]), z: vertices.map((p) => p[2]), i: faces.map((f) => f[0]), j: faces.map((f) => f[1]), k: faces.map((f) => f[2]), color: "#64748b", opacity: 0.16, hoverinfo: "skip" };
}

function coverageTrace(speaker, color, config) {
  const pos = speaker.position;
  const forward = unit(speaker.aim.map((value, axis) => value - pos[axis]));
  let right = cross(forward, [0, 0, 1]);
  if (Math.sqrt(right.reduce((sum, value) => sum + value * value, 0)) < 1e-12) right = [1, 0, 0];
  right = unit(right);
  const vertical = unit(cross(right, forward));
  const length = Math.min(Math.max(config.room.length_m, config.room.width_m) * 0.28, 8);
  const base = pos.map((value, axis) => value + forward[axis] * length);
  const product = products.find((item) => item.model === speaker.model) || { coverageH: 90, coverageV: 60 };
  const radiusH = length * Math.tan((product.coverageH / 2) * Math.PI / 180);
  const radiusV = length * Math.tan((product.coverageV / 2) * Math.PI / 180);
  const vertices = [pos];
  for (let idx = 0; idx < 36; idx += 1) {
    const theta = (idx / 36) * Math.PI * 2;
    vertices.push([
      base[0] + right[0] * Math.cos(theta) * radiusH + vertical[0] * Math.sin(theta) * radiusV,
      base[1] + right[1] * Math.cos(theta) * radiusH + vertical[1] * Math.sin(theta) * radiusV,
      base[2] + right[2] * Math.cos(theta) * radiusH + vertical[2] * Math.sin(theta) * radiusV,
    ]);
  }
  const i = [], j = [], k = [];
  for (let idx = 1; idx < vertices.length; idx += 1) {
    i.push(0); j.push(idx); k.push(idx === vertices.length - 1 ? 1 : idx + 1);
  }
  return { type: "mesh3d", name: `${speaker.model} coverage`, x: vertices.map((p) => p[0]), y: vertices.map((p) => p[1]), z: vertices.map((p) => p[2]), i, j, k, color, opacity: 0.14, hovertemplate: `${speaker.model} 覆盖范围<extra></extra>` };
}

function splFieldTrace(data) {
  const best = data.best;
  return {
    type: "surface",
    name: "SPL",
    x: data.grid.xs,
    y: data.grid.ys,
    z: data.grid.ys.map(() => data.grid.xs.map(() => data.config.listener_area.ear_height_m)),
    surfacecolor: data.grid.field,
    colorscale: "Turbo",
    cmin: Math.max(80, best.minSpl - 1),
    cmax: best.maxSpl + 1,
    opacity: 0.9,
    colorbar: { title: { text: "SPL dB", font: { color: "#d8dee9" } }, tickfont: { color: "#d8dee9" }, x: -0.08, xanchor: "right" },
    hovertemplate: "SPL=%{surfacecolor:.1f} dB<extra></extra>",
  };
}

function drawPlot() {
  if (!currentData) return;
  const data = currentData;
  const traces = [
    roomMesh(data.config),
    splFieldTrace(data),
    {
      type: "scatter3d",
      name: "Listeners",
      mode: "markers",
      x: data.receivers.map((p) => p[0]),
      y: data.receivers.map((p) => p[1]),
      z: data.receivers.map((p) => p[2]),
      marker: { size: 4, color: "#d8dee9", line: { color: "#38bdf8", width: 0.6 } },
      hovertemplate: "听音测点<extra></extra>",
    },
  ];
  const colors = ["#00d5ff", "#ffb000", "#22c55e", "#f472b6", "#a78bfa", "#fb7185", "#2dd4bf", "#facc15"];
  data.best.speakers.forEach((speaker, index) => {
    const color = colors[index % colors.length];
    if (coverageVisible[index]) traces.push(coverageTrace(speaker, color, data.config));
    traces.push({ type: "scatter3d", name: speaker.model, mode: "markers+text", x: [speaker.position[0]], y: [speaker.position[1]], z: [speaker.position[2]], text: [speaker.model], textposition: "top center", marker: { size: 8, color, symbol: "diamond", line: { color: "white", width: 1 } } });
  });
  Plotly.react("plot3d", traces, {
    paper_bgcolor: "#111722",
    plot_bgcolor: "#111722",
    font: { color: "#d8dee9" },
    margin: { l: 0, r: 0, t: 8, b: 0 },
    scene: {
      bgcolor: "#111722",
      aspectmode: "data",
      xaxis: { title: "X m", backgroundcolor: "rgba(15,23,42,0.75)", gridcolor: "rgba(148,163,184,0.18)" },
      yaxis: { title: "Y m", backgroundcolor: "rgba(15,23,42,0.75)", gridcolor: "rgba(148,163,184,0.18)" },
      zaxis: { title: "Z m", backgroundcolor: "rgba(15,23,42,0.75)", gridcolor: "rgba(148,163,184,0.18)" },
      camera: { eye: { x: 1.45, y: -1.75, z: 1.15 }, center: { x: 0, y: 0, z: -0.08 } },
    },
    legend: { bgcolor: "rgba(8,11,16,0.62)" },
  }, { displaylogo: false, responsive: true });
}

async function init() {
  await loadProducts();
  document.getElementById("demoButton").addEventListener("click", () => simulate(demoPayload));
  document.getElementById("toggleAllCoverage").addEventListener("click", () => {
    const shouldShow = coverageVisible.some((visible) => !visible);
    coverageVisible = coverageVisible.map(() => shouldShow);
    updateSpeakerTable();
    drawPlot();
  });
  window.addEventListener("message", (event) => {
    const message = event.data || {};
    if (message.type === "TOP_SOUND_SIMULATE") simulate(message.payload || {});
  });
  simulate(demoPayload);
}

init().catch((error) => setStatus(error.message, false));
