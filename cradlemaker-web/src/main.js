import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import createManifoldModule from "../vendor/manifold/manifold.js";
import { getSupportOptionSchema, prepareSupportJob, prewarmSupportCore } from "./wasmCore.js?v=column-bridge-1";
import { defaultOrcaSupportConfig } from "./orcaSupportOptions.js?v=organic-voxel-1";

const DEFAULT_SAMPLE_MODELS = [
  "TruckAntennaMount1.stl",
];
const BED_SIZE = 220;
const CONNECTOR_MIN_ROOF_ANGLE_DEG = 45;
const CONNECTOR_MIN_PROJECTION_MM = 0.8;
const CONNECTOR_MIN_PROJECTION_WIDTH_RATIO = 0.45;
const SPLIT_SLIVER_ASPECT_RATIO = 60;
const SPLIT_SLIVER_MAX_THICKNESS_MM = 0.16;
const SPLIT_CONNECTOR_SLIVER_MIN_EDGE_MM = 0.18;
const SPLIT_CONNECTOR_SLIVER_MAX_DISTANCE_MM = 0.9;
const DEFAULT_SUPPORT_CONFIG = defaultOrcaSupportConfig();
const MESH_COORDINATE_PRECISION = 100000;
const STABLE_SUPPORT_TYPE = "normal(auto)";
const STABLE_SUPPORT_STYLE = "default";
const INCH_TO_MM = 25.4;
const CNC_TOOL_SAFETY_MARGIN_MM = 1.5;
const CNC_MIN_FLOOR_THICKNESS_MM = 6;
const CNC_MAX_GRID_CELLS = 900000;
const ENABLE_MODEL_MANIFOLD_PREWARM = false;
let manifoldCorePromise = null;
let qaWorker = null;
let nextQaWorkerRequestId = 1;
const qaWorkerRequests = new Map();

const viewport = document.querySelector("#viewport");
const modelStatus = document.querySelector("#model-status");
const supportStatus = document.querySelector("#support-status");
const jobStatus = document.querySelector("#job-status");
const qaDashboard = document.querySelector("#qa-dashboard");

function setStartupStatus(message) {
  if (modelStatus) modelStatus.textContent = message;
  if (jobStatus) jobStatus.textContent = message;
}

setStartupStatus("Viewer module loaded; creating scene...");

const controlsEl = {
  workflowMode: document.querySelector("#workflow-mode"),
  file: document.querySelector("#model-file"),
  sampleModel: document.querySelector("#sample-model"),
  loadSample: document.querySelector("#load-sample"),
  toggleModelVisibility: document.querySelector("#toggle-model-visibility"),
  toggleGridVisibility: document.querySelector("#toggle-grid-visibility"),
  modelDisplayMode: document.querySelector("#model-display-mode"),
  orientModel: document.querySelector("#orient-model"),
  resetOrientation: document.querySelector("#reset-orientation"),
  rotationPreset: document.querySelector("#rotation-preset"),
  applyRotationPreset: document.querySelector("#apply-rotation-preset"),
  elevation: document.querySelector("#elevation"),
  supportType: document.querySelector("#support-type"),
  supportStyle: document.querySelector("#support-style"),
  supportThresholdAngle: document.querySelector("#support-threshold-angle"),
  supportCriticalRegionsOnly: document.querySelector("#support-critical-regions-only"),
  supportRemoveSmallOverhang: document.querySelector("#support-remove-small-overhang"),
  supportTopZDistance: document.querySelector("#support-top-z-distance"),
  supportObjectXYDistance: document.querySelector("#support-object-xy-distance"),
  supportEdgeClearance: document.querySelector("#support-edge-clearance"),
  supportBasePatternSpacing: document.querySelector("#support-base-pattern-spacing"),
  interfaceEnabled: document.querySelector("#interface-enabled"),
  interfaceOptions: document.querySelector("#interface-options"),
  supportInterfaceTopLayers: document.querySelector("#support-interface-top-layers"),
  supportInterfaceSpacing: document.querySelector("#support-interface-spacing"),
  foamGapEnabled: document.querySelector("#foam-gap-enabled"),
  foamGapOptions: document.querySelector("#foam-gap-options"),
  foamGapZ: document.querySelector("#foam-gap-z"),
  foamGapXY: document.querySelector("#foam-gap-xy"),
  treeSupportBranchDistance: document.querySelector("#tree-support-branch-distance"),
  treeSupportTipDiameter: document.querySelector("#tree-support-tip-diameter"),
  treeSupportBranchDiameter: document.querySelector("#tree-support-branch-diameter"),
  treeSupportBranchAngle: document.querySelector("#tree-support-branch-angle"),
  baseEnabled: document.querySelector("#base-enabled"),
  baseJoinUprights: document.querySelector("#base-join-uprights"),
  baseMargin: document.querySelector("#base-margin"),
  baseThickness: document.querySelector("#base-thickness"),
  generateSupports: document.querySelector("#generate-supports"),
  toggleManualSupport: document.querySelector("#toggle-manual-support"),
  toggleCoverage: document.querySelector("#toggle-coverage"),
  clearManual: document.querySelector("#clear-manual"),
  exportStl: document.querySelector("#export-stl"),
  exportPly: document.querySelector("#export-ply"),
  exportInterfaceStl: document.querySelector("#export-interface-stl"),
  exportInterfacePly: document.querySelector("#export-interface-ply"),
  splitPlatePreset: document.querySelector("#split-plate-preset"),
  splitBuildWidth: document.querySelector("#split-build-width"),
  splitBuildDepth: document.querySelector("#split-build-depth"),
  splitBuildHeight: document.querySelector("#split-build-height"),
  splitBuildMargin: document.querySelector("#split-build-margin"),
  splitConnectorClearance: document.querySelector("#split-connector-clearance"),
  splitConnectorSize: document.querySelector("#split-connector-size"),
  previewSplit: document.querySelector("#preview-split"),
  clearSplit: document.querySelector("#clear-split"),
  exportSplitStls: document.querySelector("#export-split-stls"),
  exportSplitManifest: document.querySelector("#export-split-manifest"),
  splitStatus: document.querySelector("#split-status"),
  jobProgress: document.querySelector("#job-progress"),
  jobProgressShell: document.querySelector("#job-progress-shell"),
  splitProgress: document.querySelector("#split-progress"),
  splitProgressShell: document.querySelector("#split-progress-shell"),
  cncBlockWidth: document.querySelector("#cnc-block-width"),
  cncBlockDepth: document.querySelector("#cnc-block-depth"),
  cncBlockHeight: document.querySelector("#cnc-block-height"),
  cncResolution: document.querySelector("#cnc-resolution"),
  cncToolStickoutIn: document.querySelector("#cnc-tool-stickout-in"),
  cncBitDiameterIn: document.querySelector("#cnc-bit-diameter-in"),
  cncToolEnd: document.querySelector("#cnc-tool-end"),
  cncClearance: document.querySelector("#cnc-clearance"),
  cncAutoLift: document.querySelector("#cnc-auto-lift"),
  cncModelLift: document.querySelector("#cnc-model-lift"),
  cncGenerate: document.querySelector("#cnc-generate"),
  cncAutoFit: document.querySelector("#cnc-auto-fit"),
  cncClear: document.querySelector("#cnc-clear"),
  cncStatus: document.querySelector("#cnc-status"),
  exportCncStl: document.querySelector("#export-cnc-stl"),
};

const outputs = {
  elevation: document.querySelector("#elevation-value"),
  supportThresholdAngle: document.querySelector("#support-threshold-angle-value"),
  supportTopZDistance: document.querySelector("#support-top-z-distance-value"),
  supportObjectXYDistance: document.querySelector("#support-object-xy-distance-value"),
  supportEdgeClearance: document.querySelector("#support-edge-clearance-value"),
  treeSupportBranchDistance: document.querySelector("#tree-support-branch-distance-value"),
  treeSupportBranchAngle: document.querySelector("#tree-support-branch-angle-value"),
  baseMargin: document.querySelector("#base-margin-value"),
  baseThickness: document.querySelector("#base-thickness-value"),
  splitBuildMargin: document.querySelector("#split-build-margin-value"),
  splitConnectorClearance: document.querySelector("#split-connector-clearance-value"),
  splitConnectorSize: document.querySelector("#split-connector-size-value"),
  cncStickout: document.querySelector("#cnc-stickout-value"),
  cncResolution: document.querySelector("#cnc-resolution-value"),
  cncBitDiameter: document.querySelector("#cnc-bit-diameter-value"),
  cncModelLift: document.querySelector("#cnc-model-lift-value"),
};

const state = {
  modelMesh: null,
  modelVisible: true,
  gridVisible: true,
  modelDisplayMode: "solid",
  sourceGeometry: null,
  supportMesh: null,
  interfaceMesh: null,
  coverage: null,
  coverageVisible: false,
  splitChunks: [],
  splitPreviewVisible: false,
  splitPlan: null,
  manualSupportMode: false,
  manualSupports: [],
  supportMarkerObjects: new Map(),
  nextManualId: 1,
  workflowMode: "print",
  cncMesh: null,
  cncQa: null,
  modelPayloadCache: null,
  modelManifoldCache: null,
  modelQaCache: null,
  modelCenterOfMassCache: null,
  modelManifoldPrewarmToken: 0,
  modelManifoldPrewarmTimer: null,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1b1d1b);
scene.up.set(0, 0, 1);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(170, -210, 155);

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
  setStartupStatus(`Startup error: WebGL renderer failed: ${error.message}`);
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
setStartupStatus("Viewer renderer created; building workspace...");

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.screenSpacePanning = false;
orbit.target.set(0, 0, 0);

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode("rotate");
transformControls.setSpace("local");
transformControls.enabled = false;
const transformHelper = typeof transformControls.getHelper === "function" ? transformControls.getHelper() : transformControls;
transformHelper.visible = false;
scene.add(transformHelper);

transformControls.addEventListener("dragging-changed", (event) => {
  orbit.enabled = !event.value;
});

transformControls.addEventListener("objectChange", () => {
  clearGeneratedSupport();
  clearCncPreview();
  invalidateModelPayloadCache();
  applyModelTransform();
  scheduleModelManifoldPrewarm();
  updateManualMarkers();
});

const modelGroup = new THREE.Group();
const supportGroup = new THREE.Group();
const cncGroup = new THREE.Group();
const splitGroup = new THREE.Group();
const coverageGroup = new THREE.Group();
const markerGroup = new THREE.Group();
scene.add(modelGroup, supportGroup, cncGroup, splitGroup, coverageGroup, markerGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const loader = new STLLoader();

const materialModel = new THREE.MeshStandardMaterial({
  color: 0x6f91a2,
  roughness: 0.82,
  metalness: 0.02,
  transparent: false,
  opacity: 1,
  side: THREE.DoubleSide,
});

const materialSupport = new THREE.MeshStandardMaterial({
  color: 0x4fb286,
  roughness: 0.76,
  metalness: 0.02,
  transparent: false,
  opacity: 1,
  side: THREE.DoubleSide,
  flatShading: true,
});

const materialInterface = new THREE.MeshStandardMaterial({
  color: 0xd6c35a,
  roughness: 0.68,
  metalness: 0.02,
  transparent: false,
  opacity: 1,
  side: THREE.DoubleSide,
  flatShading: true,
});

const materialCncFoam = new THREE.MeshStandardMaterial({
  color: 0xd5dfc6,
  roughness: 0.92,
  metalness: 0,
  transparent: false,
  opacity: 1,
  side: THREE.DoubleSide,
  flatShading: true,
});
const materialCncUnreachable = new THREE.MeshBasicMaterial({
  color: 0xc9463a,
  transparent: true,
  opacity: 0.62,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const materialCncIntersection = new THREE.MeshBasicMaterial({
  color: 0xff4a2a,
  transparent: true,
  opacity: 0.36,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const materialMarkerManual = new THREE.MeshStandardMaterial({ color: 0xf1c453, roughness: 0.58 });
const materialCoverageSupported = new THREE.MeshBasicMaterial({
  color: 0x52d273,
  transparent: true,
  opacity: 0.38,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const materialCoverageUnsupported = new THREE.MeshBasicMaterial({
  color: 0xf05a4f,
  transparent: true,
  opacity: 0.58,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const splitPalette = [
  0x4fb286,
  0xd38b39,
  0x6f91a2,
  0xd6c35a,
  0xb86f91,
  0x8fb85b,
  0x7d74c7,
  0xc76f55,
];

scene.add(new THREE.HemisphereLight(0xf8f2e7, 0x28302d, 1.8));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(120, -160, 220);
scene.add(keyLight);

const grid = new THREE.GridHelper(BED_SIZE, 22, 0x7b8178, 0x3d423d);
grid.rotation.x = Math.PI / 2;
grid.position.z = 0.08;
scene.add(grid);

const bed = new THREE.Mesh(
  new THREE.PlaneGeometry(BED_SIZE, BED_SIZE),
  new THREE.MeshBasicMaterial({
    color: 0x262a25,
    transparent: true,
    opacity: 0.24,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
);
bed.position.z = -0.03;
bed.receiveShadow = true;
scene.add(bed);
setStartupStatus("Viewer scene ready; binding controls...");

bindControls();
void loadSampleCatalog();
updateOutputs();
updateButtons();
resetQaDashboard();
resize();
renderer.setAnimationLoop(render);
modelStatus.textContent = "Viewer ready; load or import a model";
setJobStatus("Support core will load when supports are generated.", "idle");
schedulePrintCorePrewarm();

function bindControls() {
  controlsEl.workflowMode?.addEventListener("change", () => {
    state.workflowMode = controlsEl.workflowMode.value === "cnc" ? "cnc" : "print";
    syncWorkflowPanels();
    updateButtons();
  });
  controlsEl.file.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    loadStlGeometry(loader.parse(buffer), file.name, buffer);
    controlsEl.file.value = "";
  });

  controlsEl.loadSample.addEventListener("click", () => loadSampleModel());
  controlsEl.toggleModelVisibility?.addEventListener("click", () => toggleModelVisibility());
  controlsEl.toggleGridVisibility?.addEventListener("click", () => toggleGridVisibility());
  controlsEl.modelDisplayMode?.addEventListener("change", () => applyModelDisplayMode(controlsEl.modelDisplayMode.value));
  controlsEl.orientModel.addEventListener("click", () => toggleOrientationHelper());
  controlsEl.resetOrientation.addEventListener("click", () => resetOrientation());
  controlsEl.applyRotationPreset?.addEventListener("click", () => applyRotationPreset());
  controlsEl.generateSupports.addEventListener("click", () => {
    void showWasmPending();
  });
  controlsEl.toggleManualSupport?.addEventListener("click", () => toggleManualSupportMode());
  controlsEl.toggleCoverage?.addEventListener("click", () => toggleCoverageOverlay());
  controlsEl.clearManual.addEventListener("click", () => {
    state.manualSupports = [];
    clearGeneratedSupport();
    updateManualMarkers();
  });
  controlsEl.exportStl.addEventListener("click", () => {
    exportSupportStl();
  });
  controlsEl.exportPly?.addEventListener("click", () => {
    exportSupportPly();
  });
  controlsEl.exportInterfaceStl?.addEventListener("click", () => {
    exportInterfaceStl();
  });
  controlsEl.exportInterfacePly?.addEventListener("click", () => {
    exportInterfacePly();
  });
  controlsEl.cncGenerate?.addEventListener("click", () => {
    generateCncFoamPreview().catch((error) => {
      console.error(error);
      setCncStatus(`CNC preview failed: ${error?.message || error}`, "error");
      updateButtons();
    });
  });
  controlsEl.cncAutoFit?.addEventListener("click", () => {
    autoFitCncLift().catch((error) => {
      console.error(error);
      setCncStatus(`Auto-fit failed: ${error?.message || error}`, "error");
      updateButtons();
    });
  });
  controlsEl.cncClear?.addEventListener("click", () => clearCncPreview());
  controlsEl.exportCncStl?.addEventListener("click", () => exportCncFoamStl());
  controlsEl.cncAutoLift?.addEventListener("change", () => {
    clearCncPreview();
    syncCncLiftControls();
    applyModelTransform();
    updateButtons();
  });
  controlsEl.cncToolEnd?.addEventListener("change", () => {
    clearCncPreview();
    updateButtons();
  });
  controlsEl.previewSplit?.addEventListener("click", () => {
    previewSplitPlan().catch((error) => {
      console.error(error);
      setSplitStatus(`Split preview failed: ${error?.message || error}`, "error");
      setSplitProgress(100);
      updateButtons();
    });
  });
  controlsEl.clearSplit?.addEventListener("click", () => clearSplitPreview());
  controlsEl.exportSplitStls?.addEventListener("click", () => exportSplitStls());
  controlsEl.exportSplitManifest?.addEventListener("click", () => exportSplitManifest());
  controlsEl.splitPlatePreset?.addEventListener("change", () => applySplitPlatePreset());
  controlsEl.interfaceEnabled?.addEventListener("change", () => {
    if (controlsEl.interfaceEnabled.checked && Number(controlsEl.supportInterfaceTopLayers.value) <= 0) {
      controlsEl.supportInterfaceTopLayers.value = "2";
    }
    syncOptionPanels();
    clearGeneratedSupport();
    updateButtons();
  });
  controlsEl.foamGapEnabled?.addEventListener("change", () => {
    syncOptionPanels();
    clearGeneratedSupport();
    updateButtons();
  });

  for (const input of [
    controlsEl.elevation,
    controlsEl.supportThresholdAngle,
    controlsEl.supportTopZDistance,
    controlsEl.supportObjectXYDistance,
    controlsEl.supportEdgeClearance,
    controlsEl.supportBasePatternSpacing,
    controlsEl.supportInterfaceTopLayers,
    controlsEl.supportInterfaceSpacing,
    controlsEl.foamGapZ,
    controlsEl.foamGapXY,
    controlsEl.treeSupportBranchDistance,
    controlsEl.treeSupportTipDiameter,
    controlsEl.treeSupportBranchDiameter,
    controlsEl.treeSupportBranchAngle,
    controlsEl.baseMargin,
    controlsEl.baseThickness,
    controlsEl.splitBuildWidth,
    controlsEl.splitBuildDepth,
    controlsEl.splitBuildHeight,
    controlsEl.splitBuildMargin,
    controlsEl.splitConnectorClearance,
    controlsEl.splitConnectorSize,
    controlsEl.cncBlockWidth,
    controlsEl.cncBlockDepth,
    controlsEl.cncBlockHeight,
    controlsEl.cncResolution,
    controlsEl.cncToolStickoutIn,
    controlsEl.cncBitDiameterIn,
    controlsEl.cncClearance,
    controlsEl.cncModelLift,
  ].filter(Boolean)) {
    input.addEventListener("input", () => {
      if (
        input === controlsEl.splitBuildWidth ||
        input === controlsEl.splitBuildDepth ||
        input === controlsEl.splitBuildHeight ||
        input === controlsEl.splitBuildMargin ||
        input === controlsEl.splitConnectorClearance ||
        input === controlsEl.splitConnectorSize
      ) {
        clearSplitPreview();
      } else if (
        input === controlsEl.cncBlockWidth ||
        input === controlsEl.cncBlockDepth ||
        input === controlsEl.cncBlockHeight ||
        input === controlsEl.cncResolution ||
        input === controlsEl.cncToolStickoutIn ||
        input === controlsEl.cncBitDiameterIn ||
        input === controlsEl.cncClearance ||
        input === controlsEl.cncModelLift
      ) {
        if (input === controlsEl.cncModelLift && controlsEl.cncAutoLift) {
          controlsEl.cncAutoLift.checked = false;
          syncCncLiftControls();
        }
        clearCncPreview();
      } else {
        clearGeneratedSupport();
      }
      updateOutputs();
      applyModelTransform();
      updateManualMarkers();
      updateButtons();
    });
  }

  for (const input of [
    controlsEl.supportType,
    controlsEl.supportStyle,
    controlsEl.supportCriticalRegionsOnly,
    controlsEl.supportRemoveSmallOverhang,
    controlsEl.baseEnabled,
    controlsEl.baseJoinUprights,
  ].filter(Boolean)) {
    input.addEventListener("change", () => {
      clearGeneratedSupport();
      updateButtons();
    });
  }
  syncOptionPanels();
  syncWorkflowPanels();
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", resize);
}

function schedulePrintCorePrewarm() {
  const warm = () => {
    prewarmSupportCore().catch((error) => {
      console.warn("Print support prewarm failed.", error);
    });
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(warm, { timeout: 3500 });
  } else {
    window.setTimeout(warm, 1200);
  }
}

function syncWorkflowPanels() {
  const mode = controlsEl.workflowMode?.value === "cnc" ? "cnc" : "print";
  state.workflowMode = mode;
  for (const element of document.querySelectorAll(".print-workflow")) {
    element.hidden = mode !== "print";
  }
  for (const element of document.querySelectorAll(".cnc-workflow")) {
    element.hidden = mode !== "cnc";
  }
  if (mode === "print") {
    cncGroup.visible = false;
    supportGroup.visible = true;
    coverageGroup.visible = state.coverageVisible;
  } else {
    cncGroup.visible = true;
    supportGroup.visible = false;
    splitGroup.visible = false;
    coverageGroup.visible = false;
  }
  applyModelTransform();
  syncCncLiftControls();
}

function syncCncLiftControls() {
  if (!controlsEl.cncModelLift || !controlsEl.cncAutoLift) return;
  controlsEl.cncModelLift.disabled = controlsEl.cncAutoLift.checked;
}

function syncOptionPanels() {
  if (controlsEl.interfaceOptions && controlsEl.interfaceEnabled) {
    controlsEl.interfaceOptions.hidden = !controlsEl.interfaceEnabled.checked;
  }
  if (controlsEl.foamGapOptions && controlsEl.foamGapEnabled) {
    controlsEl.foamGapOptions.hidden = !controlsEl.foamGapEnabled.checked;
  }
}

function sampleUrlForName(name) {
  return `./samples/${encodeURIComponent(name)}`;
}

function defaultSampleEntries() {
  return DEFAULT_SAMPLE_MODELS.map((name) => ({
    name,
    url: sampleUrlForName(name),
  }));
}

async function loadSampleCatalog() {
  const fallbackEntries = defaultSampleEntries();
  let entries = fallbackEntries;

  try {
    const response = await fetch("/api/samples", { cache: "no-store" });
    if (response.ok) {
      const catalog = await response.json();
      if (Array.isArray(catalog.samples) && catalog.samples.length) {
        entries = catalog.samples
          .filter((sample) => typeof sample?.name === "string" && typeof sample?.url === "string")
          .map((sample) => ({ name: sample.name, url: sample.url }));
      }
    }
  } catch {
    entries = fallbackEntries;
  }

  if (!controlsEl.sampleModel) return;
  controlsEl.sampleModel.replaceChildren();

  for (const sample of entries) {
    const option = document.createElement("option");
    option.value = sample.url;
    option.dataset.name = sample.name;
    option.textContent = sample.name.replace(/\.stl$/i, "");
    controlsEl.sampleModel.appendChild(option);
  }
}

async function loadSampleModel() {
  const selected = controlsEl.sampleModel?.selectedOptions?.[0] ?? null;
  const sampleName = selected?.dataset.name || DEFAULT_SAMPLE_MODELS[0];
  const selectedUrl = selected?.value || sampleUrlForName(sampleName);
  const encodedName = encodeURIComponent(sampleName);
  const sampleUrls = [
    selectedUrl,
    sampleUrlForName(sampleName),
    `../samples/${encodedName}`,
    `/cradlemaker-web/samples/${encodedName}`,
    `/samples/${encodedName}`,
  ].filter((url, index, urls) => urls.indexOf(url) === index);

  modelStatus.textContent = `Loading ${sampleName}...`;
  const errors = [];

  try {
    for (const sampleUrl of sampleUrls) {
      try {
        const response = await fetch(sampleUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`${sampleUrl}: HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) throw new Error(`${sampleUrl}: empty response`);

        loadStlGeometry(loader.parse(buffer), sampleName);
        return;
      } catch (error) {
        errors.push(error.message);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  modelStatus.textContent = `Could not load sample: ${errors.join("; ")}`;
}

function loadStlGeometry(geometry, label) {
  clearSceneModel();

  if (geometry.index) {
    geometry = geometry.toNonIndexed();
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  centerGeometryXY(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  state.sourceGeometry = geometry.clone();
  invalidateModelPayloadCache();
  state.modelMesh = new THREE.Mesh(geometry, materialModel);
  state.modelMesh.name = label;
  modelGroup.add(state.modelMesh);
  applyModelDisplayMode(controlsEl.modelDisplayMode?.value || state.modelDisplayMode);

  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  const defaultElevation = Math.max(12, Math.min(80, Math.round(size.z * 0.28)));
  controlsEl.elevation.value = String(defaultElevation);

  state.manualSupports = [];
  state.nextManualId = 1;

  setOrientationHelper(false);
  applyModelTransform();
  frameObject();
  updateManualMarkers();
  updateOutputs();
  updateButtons();
  scheduleModelManifoldPrewarm();
  modelStatus.textContent = `${label} loaded`;
}

function clearSceneModel() {
  modelGroup.clear();
  supportGroup.clear();
  cncGroup.clear();
  splitGroup.clear();
  coverageGroup.clear();
  markerGroup.clear();
  state.modelMesh = null;
  state.modelVisible = true;
  state.modelDisplayMode = controlsEl.modelDisplayMode?.value || "solid";
  state.sourceGeometry = null;
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.cncMesh = null;
  state.cncQa = null;
  invalidateModelPayloadCache();
  state.coverage = null;
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  state.coverageVisible = false;
  state.manualSupportMode = false;
  state.supportMarkerObjects.clear();
  setOrientationHelper(false);
  resetQaDashboard();
}

function centerGeometryXY(geometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const centerX = (box.min.x + box.max.x) / 2;
  const centerY = (box.min.y + box.max.y) / 2;
  const minZ = box.min.z;
  geometry.translate(-centerX, -centerY, -minZ);
}

function applyModelTransform() {
  if (!state.modelMesh) return;
  let changed = false;
  if (state.workflowMode === "cnc") {
    changed = applyCncModelPlacement();
  } else {
    changed = applyElevation();
  }
  if (changed) scheduleModelManifoldPrewarm();
}

function applyElevation() {
  if (!state.modelMesh) return false;
  const box = new THREE.Box3().setFromObject(state.modelMesh);
  const deltaZ = Number(controlsEl.elevation.value) - box.min.z;
  if (Math.abs(deltaZ) <= 1e-7) return false;
  state.modelMesh.position.z += deltaZ;
  state.modelMesh.updateMatrixWorld(true);
  invalidateModelPayloadCache();
  return true;
}

function applyCncModelPlacement(settings = cncSettings()) {
  if (!state.modelMesh) return false;
  state.modelMesh.updateMatrixWorld(true);
  const referenceZ = estimateCncReferenceZ(settings);
  if (!Number.isFinite(referenceZ)) return false;
  const placementOffsetMm = Number.isFinite(settings.modelPlacementOffsetMm)
    ? settings.modelPlacementOffsetMm
    : settings.modelLiftMm;
  const targetReferenceZ = settings.height + placementOffsetMm;
  const deltaZ = targetReferenceZ - referenceZ;
  if (Math.abs(deltaZ) <= 1e-7) return false;
  state.modelMesh.position.z += deltaZ;
  state.modelMesh.updateMatrixWorld(true);
  invalidateModelPayloadCache();
  return true;
}

function frameObject() {
  if (!state.modelMesh) return;
  const box = new THREE.Box3().setFromObject(state.modelMesh);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 40);
  orbit.target.set(center.x, center.y, Math.max(8, center.z * 0.45));
  camera.position.set(center.x + radius * 1.2, center.y - radius * 1.55, center.z + radius * 0.9);
  camera.near = Math.max(0.1, radius / 500);
  camera.far = Math.max(1000, radius * 20);
  camera.updateProjectionMatrix();
  orbit.update();
}

function onPointerDown(event) {
  if (!state.modelMesh || event.button !== 0) return;
  if (transformControls.enabled) return;
  if (!state.manualSupportMode) return;

  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  if (event.altKey) {
    const markerHits = raycaster.intersectObjects([...state.supportMarkerObjects.values()], false);
    if (markerHits.length) {
      const supportId = markerHits[0].object.userData.supportId;
      state.manualSupports = state.manualSupports.filter((support) => support.id !== supportId);
      updateManualMarkers();
    }
    return;
  }

  const hits = raycaster.intersectObject(state.modelMesh, false);
  if (!hits.length) return;

  const hit = hits[0];
  const localPoint = state.modelMesh.worldToLocal(hit.point.clone());
  const localNormal = hit.face.normal.clone().normalize();
  state.manualSupports.push({
    id: `manual-${state.nextManualId++}`,
    source: "manual",
    localPoint,
    localNormal,
  });
  updateManualMarkers();
}

function setPointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

async function showWasmPending() {
  if (!state.modelMesh) return;

  setJobStatus("Preparing Orca support job...", "working");
  setQaDashboard([
    { label: "Core", value: "Preparing", detail: "Packaging model", state: "working" },
    { label: "Coverage", value: "--", detail: "Waiting", state: "idle" },
    { label: "Intersections", value: "--", detail: "Waiting", state: "idle" },
    { label: "Stability", value: "--", detail: "Waiting", state: "idle" },
  ]);
  setJobProgress(4);
  supportStatus.textContent = "Checking WASM core";
  controlsEl.generateSupports.disabled = true;
  controlsEl.generateSupports.textContent = "Checking core";
  await nextFrame();

  try {
    const phaseTimings = [];
    let phaseStart = performance.now();
    const markPhase = (label) => {
      const now = performance.now();
      phaseTimings.push({ label, ms: now - phaseStart });
      phaseStart = now;
    };
    const resetPhaseTimer = () => {
      phaseStart = performance.now();
    };
    setJobProgress(12);
    resetPhaseTimer();
    const schema = await getSupportOptionSchema();
    markPhase("schema");
    setJobProgress(22);
    setJobStatus("Packaging model and support settings...", "working");
    await nextFrame();
    resetPhaseTimer();
    const job = buildSupportJobPayload();
    markPhase("package");
    const supportConfig = job.support_config;
    const cradleConfig = job.cradle_config;
    const manualCount = realizedManualSupports().length;
    setJobProgress(34);
    setJobStatus("Generating solid cradle in WASM...", "working");
    await nextFrame();
    resetPhaseTimer();
    const jobResult = await prepareSupportJob(job);
    markPhase("WASM");
    if (jobResult.tree_layer_disks?.layers?.length) {
      setJobProgress(58);
      setJobStatus("Unioning organic tree support layers...", "working");
      await nextFrame();
      resetPhaseTimer();
      const core = await loadManifoldCore();
      const treeProgress = async (progress, message) => {
        setJobProgress(58 + progress * 0.16);
        setJobStatus(message, "working");
        await nextFrame();
      };
      jobResult.support_mesh = await buildOrganicTreeLayerSupportMesh(
        core,
        jobResult.tree_layer_disks,
        jobResult.support_mesh?.cell_size_mm ?? supportConfig.contact_cell_size_mm,
        treeProgress
      );
      if (jobResult.support) jobResult.support.tree_layered_solid = true;
      markPhase("tree union");
    }
    setJobProgress(70);
    setJobStatus("Checking cradle clearance against object model...", "working");
    await nextFrame();
    let modelMeshQa = null;
    const hasInterfaceMesh = Boolean(jobResult.interface_mesh?.vertices?.length && jobResult.interface_mesh?.triangles?.length);
    const canConsiderSkippingTrim =
      !jobResult.qa?.intersects_model &&
      !Number(jobResult.qa?.clearance_violation_cells ?? 0) &&
      !hasInterfaceMesh &&
      Boolean(jobResult.support_mesh?.vertices?.length && jobResult.support_mesh?.triangles?.length);
    resetPhaseTimer();
    if (canConsiderSkippingTrim) {
      modelMeshQa = evaluateGeneratedModelIntersectionQa(jobResult.support_mesh, { phase: "pretrim" });
      markPhase("pretrim QA");
    }

    const shouldRunExactTrim = !canConsiderSkippingTrim || Boolean(modelMeshQa?.needs_exact_trim);
    setJobProgress(76);
    setJobStatus(shouldRunExactTrim ? "Trimming cradle away from object model..." : "Using generator clearance; exact trim not needed...", "working");
    await nextFrame();
    resetPhaseTimer();
    const trimmedMeshes = await trimGeneratedMeshesAgainstModel(
      jobResult.support_mesh,
      jobResult.interface_mesh,
      supportConfig,
      {
        skipExactTrim: !shouldRunExactTrim,
        skipReason: modelMeshQa?.intersects_model
          ? "generator clearance was clean and sampled hits were shallow/rare enough to treat as near-surface QA"
          : "generator clearance and sampled mesh QA found no material object intersection",
      }
    );
    markPhase(shouldRunExactTrim ? "model trim" : "trim decision");
    setJobStatus("Rendering generated cradle...", "working");
    await nextFrame();
    resetPhaseTimer();
    renderGeneratedMeshes(trimmedMeshes.support_mesh, trimmedMeshes.interface_mesh);
    markPhase("render");
    setJobProgress(88);
    setJobStatus("Building coverage overlay and QA summary...", "working");
    await nextFrame();
    resetPhaseTimer();
    renderCoverageOverlay(jobResult.coverage);
    const meshAndStabilityQaPromise = evaluateCradleMeshAndStabilityQa(trimmedMeshes.support_mesh, jobResult.coverage);
    if (!modelMeshQa || trimmedMeshes.trimmed) {
      modelMeshQa = evaluateGeneratedModelIntersectionQa(trimmedMeshes.support_mesh, { phase: "final" });
    }
    const meshAndStabilityQa = await meshAndStabilityQaPromise;
    const meshQa = meshAndStabilityQa.meshQa;
    const stabilityQa = meshAndStabilityQa.stabilityQa;
    const qaWorkerTimings = meshAndStabilityQa.worker ? meshAndStabilityQa.timings : [];
    markPhase("QA");

    modelStatus.textContent = "Support job accepted by WASM";
    const supportTriangleCount = trimmedMeshes.support_mesh?.triangle_count ?? 0;
    const interfaceTriangleCount = trimmedMeshes.interface_mesh?.triangle_count ?? 0;
    const overhangFacetCount = jobResult.support?.overhang_facets ?? 0;
    const contactCellCount = jobResult.support?.contact_cells ?? 0;
    const envelopeCellCount = jobResult.support?.envelope_cells ?? 0;
    const prunedSparseCellCount = jobResult.support?.pruned_sparse_cells ?? 0;
    const prunedSmallIslandCellCount = jobResult.support?.pruned_small_island_cells ?? 0;
    const closedGapCount = jobResult.support?.closed_gap_cells ?? 0;
    const baseCellCount = jobResult.support?.base_cells ?? 0;
    const bottomJoinCellCount = jobResult.support?.bottom_join_cells ?? 0;
    const columnMergeCellCount = jobResult.support?.column_merge_cells ?? 0;
    const columnComponentsBefore = jobResult.support?.column_components_before ?? 0;
    const columnComponentsAfter = jobResult.support?.column_components_after ?? 0;
    const interfaceCellCount = jobResult.support?.interface_cells ?? 0;
    const interfaceLayers = jobResult.support?.interface_top_layers ?? 0;
    const foamGapZ = jobResult.support?.foam_gap_z_mm ?? 0;
    const foamGapXY = jobResult.support?.foam_gap_xy_mm ?? 0;
    const foamRemovedCells = jobResult.support?.foam_gap_removed_cells ?? 0;
    const edgeClearance = jobResult.support?.edge_clearance_mm ?? 0;
    const edgeRemovedCells = jobResult.support?.edge_clearance_removed_cells ?? 0;
    const nativeManualCount = jobResult.support?.manual_points ?? 0;
    const treeMode = Boolean(jobResult.support?.tree_mode);
    const treeBranchCount = jobResult.support?.tree_branches ?? 0;
    const treeTipContactCount = jobResult.support?.tree_tip_contacts ?? 0;
    const treeLocalUprightCount = jobResult.support?.tree_local_uprights ?? 0;
    const treeWaypointBranchCount = jobResult.support?.tree_waypoint_branches ?? 0;
    const treeSlopeRerouteCount = jobResult.support?.tree_slope_reroutes ?? 0;
    const treeModelRerouteCount = jobResult.support?.tree_model_reroutes ?? 0;
    const requestedOrcaTreeMode = Boolean(jobResult.support?.requested_orca_tree_mode);
    const realOrcaTreeAvailable = Boolean(jobResult.support?.real_orca_tree_available);
    const originalOrganicTree = Boolean(jobResult.support?.original_organic_tree);
    const unsupportedCellCount = jobResult.coverage?.unsupported_cells ?? 0;
    const qa = jobResult.qa ?? {};
    const supportedDownwardPercent = Number(qa.supported_downward_percent ?? 0);
    const qaIntersectionText = qa.intersects_model
      ? `QA warning: ${Number(qa.intersection_cells ?? 0).toLocaleString()} possible model-intersection cells, max penetration ${formatStatusNumber(qa.max_penetration_mm ?? 0)} mm.`
      : "QA: no model intersections detected.";
    const qaCoverageText = `Approx. ${formatStatusNumber(supportedDownwardPercent)}% of lower/downward-facing sampled cells are supported (${Number(qa.supported_downward_cells ?? 0).toLocaleString()}/${Number(qa.downward_cells ?? 0).toLocaleString()}).`;
    const meshQaText = meshQa.sampled_cells
      ? (meshQa.unsupported_cells
          ? `Mesh QA warning: printable cradle surface reaches only ${formatStatusNumber(meshQa.supported_percent)}% of sampled underside targets (${meshQa.supported_cells.toLocaleString()}/${meshQa.sampled_cells.toLocaleString()}); max support gap ${formatStatusNumber(meshQa.max_gap_mm)} mm.`
          : `Mesh QA: printable cradle surface reaches ${formatStatusNumber(meshQa.supported_percent)}% of sampled underside targets (${meshQa.supported_cells.toLocaleString()}/${meshQa.sampled_cells.toLocaleString()}); max support gap ${formatStatusNumber(meshQa.max_gap_mm)} mm.`)
      : "Mesh QA skipped because no underside target samples were available.";
    const qaClearanceText = Number(qa.clearance_violation_cells ?? 0)
      ? `${Number(qa.clearance_violation_cells ?? 0).toLocaleString()} cells are inside the requested clearance by up to ${formatStatusNumber(qa.max_clearance_violation_mm ?? 0)} mm.`
      : "Requested clearance is respected within grid tolerance.";
    const modelMeshQaText = formatGeneratedModelIntersectionQaStatus(modelMeshQa);
    const modelTrimText = trimmedMeshes.warning
      ? `Boolean model trim warning: ${trimmedMeshes.warning}`
      : (trimmedMeshes.trimmed
          ? `Exact object boolean trim applied after generator clearance (${formatStatusNumber(trimmedMeshes.clearance?.xy_mm ?? 0)} mm XY, ${formatStatusNumber(trimmedMeshes.clearance?.z_mm ?? 0)} mm Z requested).`
          : trimmedMeshes.skipped
            ? `Exact object boolean trim skipped: ${trimmedMeshes.skip_reason}.`
            : "");
    const stabilityQaText = formatStabilityQaStatus(stabilityQa);
    const orcaTreeText = treeMode && originalOrganicTree
      ? "Generated original organic tree cradle geometry in CradleMaker; no Orca source is bundled in this path."
      : treeMode && requestedOrcaTreeMode && !realOrcaTreeAvailable
      ? "Generated experimental tree cradle geometry; exact Orca organic tree support is not linked into WASM."
      : requestedOrcaTreeMode && !realOrcaTreeAvailable
        ? "Real Orca organic tree support is not linked into WASM yet; generated the stable solid cradle fallback."
      : "";
    const treeRoutingText = treeMode
      ? `Tree routing: ${treeTipContactCount.toLocaleString()} physical tip contacts, ${treeLocalUprightCount.toLocaleString()} local uprights, ${treeWaypointBranchCount.toLocaleString()} model-avoidance waypoints, ${treeSlopeRerouteCount.toLocaleString()} slope reroutes, and ${treeModelRerouteCount.toLocaleString()} model-clearance reroutes.`
      : "";
    const runtime = jobResult._runtime ?? {};
    const wasmBuildText = runtime.wasmBuild ? `, ${runtime.wasmBuild}` : "";
    const runtimeText = ` Runtime: support generation ${runtime.worker ? "worker" : "main thread"}${wasmBuildText}${runtime.crossOriginIsolated ? ", pthread-ready page" : ", pthreads unavailable until server restart/headers are active"}.`;
    const wasmTimingText = formatWasmTimingText(jobResult.support?.timings_ms);
    const wasmOutputTimingText = formatWasmOutputTimingText(jobResult.top_level_timings_ms);
    const workerTimingText = formatWorkerTimingText(runtime.workerTimings);
    const qaWorkerTimingText = formatQaWorkerTimingText(qaWorkerTimings);
    const trimTimingText = formatTrimTimingText(trimmedMeshes.timings);
    const timingText = phaseTimings.length
      ? ` Timings: ${phaseTimings.map((phase) => `${phase.label} ${formatDurationMs(phase.ms)}`).join(", ")}.${wasmTimingText}${wasmOutputTimingText}${trimTimingText}${workerTimingText}${qaWorkerTimingText}`
      : "";
    const totalTriangleCount = supportTriangleCount + interfaceTriangleCount;
    supportStatus.textContent = totalTriangleCount
      ? `${supportTriangleCount.toLocaleString()} cradle + ${interfaceTriangleCount.toLocaleString()} interface triangles`
      : `${manualCount} manual marks`;
    updateGeneratedQaDashboard({
      supportTriangleCount,
      interfaceTriangleCount,
      supportedDownwardPercent,
      qa,
      meshQa,
      modelMeshQa,
      stabilityQa,
      unsupportedCellCount,
      splitReady: totalTriangleCount > 0,
    });
    const cradleLabel = treeMode ? "original organic tree cradle" : "solid cradle";
    const cradleArticle = cradleLabel.startsWith("original") ? "an" : "a";
    setJobStatus(
      totalTriangleCount
        ? `Generated ${cradleArticle} ${cradleLabel} from ${contactCellCount.toLocaleString()} contact cells, including ${envelopeCellCount.toLocaleString()} underside-envelope cells, ${prunedSparseCellCount.toLocaleString()} sparse side/contact cells pruned, ${prunedSmallIslandCellCount.toLocaleString()} tiny island cells removed, ${baseCellCount.toLocaleString()} footprint base cells, ${bottomJoinCellCount.toLocaleString()} bottom-join cells, ${columnMergeCellCount.toLocaleString()} safe column-merge cells, column components ${columnComponentsBefore.toLocaleString()} -> ${columnComponentsAfter.toLocaleString()}, ${closedGapCount.toLocaleString()} closed gaps, ${unsupportedCellCount.toLocaleString()} unsupported coverage cells, ${overhangFacetCount.toLocaleString()} overhang facets, ${nativeManualCount.toLocaleString()} manual enforcers, ${treeMode ? `${treeBranchCount.toLocaleString()} organic branches, ` : ""}${interfaceCellCount.toLocaleString()} soft-interface cells from ${interfaceLayers.toLocaleString()} interface layers, ${edgeRemovedCells.toLocaleString()} cells removed for a ${edgeClearance.toLocaleString()} mm support-free edge, and ${foamRemovedCells.toLocaleString()} cells removed for a ${foamGapZ.toLocaleString()} mm Z / ${foamGapXY.toLocaleString()} mm XY foam gap. ${orcaTreeText} ${treeRoutingText} ${qaIntersectionText} ${qaCoverageText} ${meshQaText} ${modelTrimText} ${modelMeshQaText} ${stabilityQaText} ${qaClearanceText} Prepared ${Object.keys(supportConfig).length}/${schema.length} Orca support settings and ${Object.keys(cradleConfig).length} cradle settings.${runtimeText}${timingText}`
        : `No support regions found. Prepared ${Object.keys(supportConfig).length}/${schema.length} Orca support settings and ${Object.keys(cradleConfig).length} cradle settings.`,
      qa.intersects_model || meshQa.unsupported_cells || modelMeshQa.needs_exact_trim || stabilityQa.severity === "error" ? "error" : "pending"
    );
    setJobProgress(100);
  } catch (error) {
    modelStatus.textContent = "CradleMaker WASM core not loaded";
    supportStatus.textContent = "Core load failed";
    setJobStatus(`WASM load failed: ${error.message}`, "error");
    setJobProgress(100);
  } finally {
    controlsEl.generateSupports.textContent = "Generate supports";
    updateButtons();
  }
}

function renderGeneratedMeshes(supportMesh, interfaceMesh) {
  supportGroup.clear();
  cncGroup.clear();
  clearSplitPreview();
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.cncMesh = null;
  state.cncQa = null;

  state.supportMesh = renderMeshPart(supportMesh, materialSupport, "Generated cradle solid");
  state.interfaceMesh = renderMeshPart(interfaceMesh, materialInterface, "Generated interface solid");
  updateButtons();
}

async function trimGeneratedMeshesAgainstModel(supportMesh, interfaceMesh, supportConfig = {}, options = {}) {
  const clearance = modelBooleanClearanceSettings(supportConfig);
  const result = {
    support_mesh: supportMesh,
    interface_mesh: interfaceMesh,
    trimmed: false,
    skipped: false,
    skip_reason: "",
    warning: "",
    clearance,
    timings: [],
  };
  if (!state.modelMesh || !supportMesh?.vertices?.length || !supportMesh?.triangles?.length) return result;
  if (options.skipExactTrim) {
    result.skipped = true;
    result.skip_reason = options.skipReason || "generator clearance was accepted";
    return result;
  }

  let core = null;
  let clearanceSolid = null;
  let trimPhaseStart = performance.now();
  const markTrimPhase = (label) => {
    const now = performance.now();
    result.timings.push({ label, ms: now - trimPhaseStart });
    trimPhaseStart = now;
  };
  try {
    core = await loadManifoldCore();
    markTrimPhase("load manifold");
    clearanceSolid = modelMeshToManifold(core);
    markTrimPhase("model solid");
    result.support_mesh = trimSupportMeshAgainstModelSolid(core, supportMesh, clearanceSolid, "generated cradle", result.timings);
    if (interfaceMesh?.vertices?.length && interfaceMesh?.triangles?.length) {
      result.interface_mesh = trimSupportMeshAgainstModelSolid(core, interfaceMesh, clearanceSolid, "generated interface", result.timings);
    }
    result.trimmed = true;
  } catch (error) {
    result.warning = error?.message || String(error);
  } finally {
    if (clearanceSolid && clearanceSolid !== state.modelManifoldCache?.solid) {
      clearanceSolid.delete?.();
    }
  }

  return result;
}

function modelBooleanClearanceSettings(supportConfig) {
  const foamEnabled = Boolean(supportConfig.foam_gap_enabled);
  const xy = Math.max(
    0,
    positiveNumber(supportConfig.support_object_xy_distance, 0),
    positiveNumber(supportConfig.support_xy_distance_overhang, 0)
  ) + (foamEnabled ? positiveNumber(supportConfig.foam_gap_xy_mm, 0) : 0);
  const z = Math.max(
    0,
    positiveNumber(supportConfig.support_top_z_distance, 0)
  ) + (foamEnabled ? positiveNumber(supportConfig.foam_gap_z_mm, 0) : 0);

  return {
    xy_mm: roundedCoordinate(xy),
    z_mm: roundedCoordinate(z),
  };
}

function trimSupportMeshAgainstModelSolid(core, mesh, modelSolid, label, timings = null) {
  let phaseStart = performance.now();
  const mark = (phase) => {
    if (!timings) return;
    const now = performance.now();
    timings.push({ label: `${label} ${phase}`, ms: now - phaseStart });
    phaseStart = now;
  };

  const sourceSolid = mesh?._sourceSolid ?? supportMeshToManifold(core, mesh, `${label} source`, { fast: true });
  delete mesh?._sourceSolid;
  mark("source solid");
  const trimmedSolid = assertManifoldOk(core.Manifold.difference([sourceSolid, modelSolid]), `${label} object difference`);
  mark("difference");
  const trimmedMesh = manifoldToSupportMesh(trimmedSolid, mesh.cell_size_mm);
  mark("extract mesh");
  sourceSolid.delete?.();
  trimmedSolid.delete?.();
  return trimmedMesh;
}

function renderMeshPart(supportMesh, material, name) {
  if (!supportMesh?.vertices?.length || !supportMesh?.triangles?.length) {
    return null;
  }

  normalizeSupportMeshArrays(supportMesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(supportMesh.vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(supportMesh.triangles, 1));
  const displayGeometry = material.flatShading ? geometry.toNonIndexed() : geometry;
  displayGeometry.computeVertexNormals();
  displayGeometry.computeBoundingBox();
  displayGeometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(displayGeometry, material);
  mesh.name = name;
  supportGroup.add(mesh);

  return supportMesh;
}

function normalizeSupportMeshArrays(mesh) {
  if (!mesh) return mesh;
  mesh.vertices = toFloat32Array(mesh.vertices);
  mesh.triangles = toUint32Array(mesh.triangles);
  mesh.vertex_count = Math.floor((mesh.vertices?.length ?? 0) / 3);
  mesh.triangle_count = Math.floor((mesh.triangles?.length ?? 0) / 3);
  return mesh;
}

function toFloat32Array(values) {
  if (values instanceof Float32Array) return values;
  return new Float32Array(values ?? []);
}

function toUint32Array(values) {
  if (values instanceof Uint32Array) return values;
  return new Uint32Array(values ?? []);
}

function renderCoverageOverlay(coverage) {
  coverageGroup.clear();
  state.coverage = coverage ?? null;

  if (!coverage?.cells?.length) {
    updateButtons();
    return;
  }

  const supportedGeometry = new THREE.BufferGeometry();
  const unsupportedGeometry = new THREE.BufferGeometry();
  const supportedVertices = [];
  const unsupportedVertices = [];
  const fallbackCellSize = Number(controlsEl.supportBasePatternSpacing.value) || 2.5;
  const cellSize = state.supportMesh?.cell_size_mm ?? fallbackCellSize;
  const half = Math.max(0.35, cellSize * 0.45);

  for (const cell of coverage.cells) {
    const [x, y, z, supported] = cell;
    const target = supported ? supportedVertices : unsupportedVertices;
    const overlayZ = z + 0.12;
    target.push(
      x - half, y - half, overlayZ,
      x + half, y - half, overlayZ,
      x + half, y + half, overlayZ,
      x - half, y - half, overlayZ,
      x + half, y + half, overlayZ,
      x - half, y + half, overlayZ
    );
  }

  if (supportedVertices.length) {
    supportedGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(supportedVertices), 3));
    coverageGroup.add(new THREE.Mesh(supportedGeometry, materialCoverageSupported));
  }

  if (unsupportedVertices.length) {
    unsupportedGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(unsupportedVertices), 3));
    coverageGroup.add(new THREE.Mesh(unsupportedGeometry, materialCoverageUnsupported));
  }

  coverageGroup.visible = state.coverageVisible;
  updateButtons();
}

async function previewSplitPlan() {
  if (!state.supportMesh) return;

  const settings = splitSettings();
  setSplitStatus("Building watertight boolean split preview...", "working");
  setSplitProgress(3);
  if (controlsEl.previewSplit) controlsEl.previewSplit.disabled = true;
  await nextFrame();

  const plan = await buildSplitPlan(state.supportMesh, settings, async (value, message) => {
    setSplitProgress(value);
    if (message) setSplitStatus(message, "working");
    await nextFrame();
  });
  plan.gapQa = evaluateDovetailGapSpanQa(plan);
  setSplitProgress(94);
  setSplitStatus("Rendering split preview...", "working");
  await nextFrame();
  renderSplitChunks(plan);
  setSplitProgress(98);
  state.splitPlan = plan;
  state.splitChunks = plan.chunks;
  state.splitPreviewVisible = true;
  supportGroup.visible = false;

  const oversizedCount = plan.chunks.filter((chunk) => !chunk.fits).length;
  const chunkText = `${plan.chunks.length.toLocaleString()} chunk${plan.chunks.length === 1 ? "" : "s"}`;
  const connectorText = `${plan.connectors.length.toLocaleString()} Z-slide dovetail connector${plan.connectors.length === 1 ? "" : "s"}`;
  const shallowCount = plan.connectors.filter((connector) => connector.shallow).length;
  const lowRoofCount = plan.connectors.filter((connector) => connector.support_free_roof === false).length;
  const shallowText = shallowCount ? ` ${shallowCount.toLocaleString()} shallow connector${shallowCount === 1 ? "" : "s"} shortened where local geometry is thin.` : "";
  const roofText = lowRoofCount ? ` ${lowRoofCount.toLocaleString()} connector roof${lowRoofCount === 1 ? " is" : "s are"} below ${CONNECTOR_MIN_ROOF_ANGLE_DEG} deg and may need print support or a smaller connector.` : "";
  const splitQaText = formatSplitQaStatus(plan.qa);
  const gapQaText = formatDovetailGapSpanQaStatus(plan.gapQa);
  if (plan.chunks.length === 1 && oversizedCount === 0 && !plan.wasOversized) {
    setSplitStatus(`Cradle fits the selected build volume as one piece (${formatDimensions(plan.sourceBounds.size)}). ${splitQaText} ${gapQaText}`, plan.qa?.intersects_model || plan.gapQa?.count ? "error" : "idle");
  } else if (oversizedCount > 0) {
    setSplitStatus(`Split made ${chunkText} with ${connectorText}, but ${oversizedCount.toLocaleString()} still exceed the usable build volume. Smaller margins or manual seam placement will be needed.${shallowText}${roofText} ${splitQaText} ${gapQaText}`, "error");
  } else {
    setSplitStatus(`Split made ${chunkText} with ${connectorText}. Boolean chunk cuts are watertight; sockets and keys use adaptive sloped roofs.${shallowText}${roofText} ${splitQaText} ${gapQaText}`, plan.qa?.intersects_model || lowRoofCount || plan.gapQa?.count ? "error" : "pending");
  }

  setSplitProgress(100);
  updateButtons();
}

function clearSplitPreview() {
  splitGroup.clear();
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  supportGroup.visible = true;
  resetProgress(controlsEl.splitProgressShell, controlsEl.splitProgress);
  setSplitStatus(state.supportMesh ? "Generate a split preview to check build-plate fit." : "Generate a cradle to check build-plate fit.", "idle");
  updateButtons();
}

function applySplitPlatePreset() {
  if (!controlsEl.splitPlatePreset) return;
  const values = controlsEl.splitPlatePreset.value.split(",").map((value) => Number(value));
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value) || value <= 0)) return;

  if (controlsEl.splitBuildWidth) controlsEl.splitBuildWidth.value = String(values[0]);
  if (controlsEl.splitBuildDepth) controlsEl.splitBuildDepth.value = String(values[1]);
  if (controlsEl.splitBuildHeight) controlsEl.splitBuildHeight.value = String(values[2]);
  clearSplitPreview();
  updateOutputs();
}

function splitSettings() {
  const width = positiveNumber(controlsEl.splitBuildWidth?.value, 220);
  const depth = positiveNumber(controlsEl.splitBuildDepth?.value, 220);
  const height = positiveNumber(controlsEl.splitBuildHeight?.value, 250);
  const margin = Math.max(0, Number(controlsEl.splitBuildMargin?.value) || 0);
  const connectorClearance = Math.max(0.05, Number(controlsEl.splitConnectorClearance?.value) || 0.3);
  const connectorSize = Math.max(2, Number(controlsEl.splitConnectorSize?.value) || 8);
  return {
    width,
    depth,
    height,
    margin,
    usableWidth: Math.max(1, width - margin * 2),
    usableDepth: Math.max(1, depth - margin * 2),
    usableHeight: Math.max(1, height - margin * 2),
    connectorsEnabled: true,
    connectorClearance,
    connectorSize,
  };
}

function splitBodyBudget(settings) {
  const connectorProjection = settings.connectorsEnabled
    ? settings.connectorSize * 1.2 + settings.connectorClearance + 0.5
    : 0;
  return {
    x: Math.max(settings.usableWidth * 0.35, settings.usableWidth - connectorProjection),
    y: Math.max(settings.usableDepth * 0.35, settings.usableDepth - connectorProjection),
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function extractHeightFieldCells(mesh, sourceBounds) {
  const vertices = mesh.vertices ?? [];
  const triangles = mesh.triangles ?? [];
  const cellSize = Math.max(0.05, mesh.cell_size_mm ?? controlsEl.supportBasePatternSpacing?.value ?? 1);
  const cells = new Map();
  const bottom = sourceBounds.min.z;

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const normal = triangleNormal(a, b, c);
    if (normal.z <= 0.8) continue;
    if (Math.max(a.z, b.z, c.z) - Math.min(a.z, b.z, c.z) > 0.001) continue;
    if (a.z <= bottom + 0.05) continue;

    const x0 = Math.min(a.x, b.x, c.x);
    const x1 = Math.max(a.x, b.x, c.x);
    const y0 = Math.min(a.y, b.y, c.y);
    const y1 = Math.max(a.y, b.y, c.y);
    if (x1 - x0 < cellSize * 0.45 || y1 - y0 < cellSize * 0.45) continue;
    if (x1 - x0 > cellSize * 1.55 || y1 - y0 > cellSize * 1.55) continue;

    const ix = Math.round((x0 - sourceBounds.min.x) / cellSize);
    const iy = Math.round((y0 - sourceBounds.min.y) / cellSize);
    const key = `${ix}:${iy}`;
    const prior = cells.get(key);
    if (!prior || a.z > prior.top) {
      cells.set(key, {
        ix,
        iy,
        x0,
        x1,
        y0,
        y1,
        bottom,
        top: a.z,
        center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2 },
      });
    }
  }

  return [...cells.values()];
}

async function buildSplitPlan(mesh, settings, progress = null) {
  return await buildManifoldSplitPlan(mesh, settings, progress);
}

async function buildManifoldSplitPlan(mesh, settings, progress = null) {
  const report = async (value, message) => {
    if (progress) await progress(value, message);
  };
  await report(7, "Loading Manifold boolean core...");
  const core = await loadManifoldCore();
  await report(12, "Preparing source cradle solid...");
  const sourceBounds = supportMeshBounds(mesh);
  const chunkBudget = splitBodyBudget(settings);
  const countX = Math.max(1, Math.ceil(sourceBounds.size.x / chunkBudget.x));
  const countY = Math.max(1, Math.ceil(sourceBounds.size.y / chunkBudget.y));
  const countZ = 1;
  const chunkSize = {
    x: sourceBounds.size.x / countX,
    y: sourceBounds.size.y / countY,
    z: sourceBounds.size.z,
  };
  if (countX === 1 && countY === 1) {
    await report(84, "Checking one-piece cradle bounds...");
    const bounds = supportMeshBounds(mesh);
    const chunks = [{
      id: "P01",
      grid: { x: 0, y: 0, z: 0 },
      box: { min: sourceBounds.min, max: sourceBounds.max },
      features: [],
      openings: [],
      mesh: cloneSupportMesh(mesh),
      bounds,
      bodyBounds: bounds,
      fits: bounds.size.x <= settings.usableWidth + 0.001 && bounds.size.y <= settings.usableDepth + 0.001 && bounds.size.z <= settings.usableHeight + 0.001,
    }];
    await report(88, "Running split QA against object model...");
    const qa = splitChunkModelQa(chunks);
    return {
      createdAt: new Date().toISOString(),
      settings,
      sourceBounds,
      grid: { x: countX, y: countY, z: countZ },
      wasOversized: false,
      chunks,
      connectors: [],
      qa,
      method: "single-piece-no-split",
      warning: "Cradle fits as one piece; preview/export uses the original generated cradle mesh without extra split booleans.",
    };
  }
  const sourceSolid = supportMeshToManifold(core, mesh, "source cradle");
  await report(18, "Preparing object clearance solid...");
  let modelClearanceSolid = null;
  let modelClearanceWarning = "";
  let modelTrimWarning = "";
  if (state.modelMesh) {
    try {
      modelClearanceSolid = modelMeshToManifold(core);
    } catch (error) {
      modelClearanceWarning = ` Object-model clearance boolean was skipped: ${error?.message || error}.`;
    }
  }
  const chunks = [];
  const epsilon = 0.05;
  const totalCells = countX * countY;
  let completedCells = 0;

  for (let iy = 0; iy < countY; iy += 1) {
    for (let ix = 0; ix < countX; ix += 1) {
      const box = {
        min: {
          x: sourceBounds.min.x + chunkSize.x * ix,
          y: sourceBounds.min.y + chunkSize.y * iy,
          z: sourceBounds.min.z - epsilon,
        },
        max: {
          x: ix === countX - 1 ? sourceBounds.max.x : sourceBounds.min.x + chunkSize.x * (ix + 1),
          y: iy === countY - 1 ? sourceBounds.max.y : sourceBounds.min.y + chunkSize.y * (iy + 1),
          z: sourceBounds.max.z + epsilon,
        },
      };
      const boxSolid = boxToManifold(core, box.min, box.max, `chunk ${ix}:${iy} box`);
      const chunkSolid = assertManifoldOk(core.Manifold.intersection(sourceSolid, boxSolid), `chunk ${ix}:${iy} intersection`);
      const chunkMesh = manifoldToSupportMesh(chunkSolid, mesh.cell_size_mm);
      boxSolid.delete?.();
      completedCells += 1;
      await report(22 + (completedCells / Math.max(1, totalCells)) * 24, `Cutting watertight chunk ${completedCells.toLocaleString()} of ${totalCells.toLocaleString()}...`);
      if (!chunkMesh.triangle_count) {
        chunkSolid.delete?.();
        continue;
      }
      const bounds = supportMeshBounds(chunkMesh);
      chunks.push({
        id: `P${String(chunks.length + 1).padStart(2, "0")}`,
        grid: { x: ix, y: iy, z: 0 },
        box,
        features: [],
        openings: [],
        mesh: chunkMesh,
        _solid: chunkSolid,
        bounds,
        bodyBounds: bounds,
        fits: bounds.size.x <= settings.usableWidth + 0.001 && bounds.size.y <= settings.usableDepth + 0.001 && bounds.size.z <= settings.usableHeight + 0.001,
      });
    }
  }

  sourceSolid.delete?.();
  await report(50, "Placing adaptive dovetail connectors...");
  const connectors = settings.connectorsEnabled ? addZSlideDovetails(chunks, sourceBounds, settings, mesh) : [];
  await report(58, "Applying connector and object-clearance booleans...");
  await applyManifoldConnectorBooleans(core, chunks, settings, mesh.cell_size_mm, modelClearanceSolid, progress);
  await report(84, "Checking split chunk bounds...");
  updateSplitChunkBounds(chunks, settings);
  await report(88, "Running split QA against object model...");
  let qa = splitChunkModelQa(chunks);
  if (qa.intersects_model && modelClearanceSolid) {
    await report(91, "Trimming QA-flagged split faces away from object model...");
    await trimQaIntersectingChunksAgainstModel(core, chunks, qa.affected_chunks, mesh.cell_size_mm, modelClearanceSolid, settings, progress);
    updateSplitChunkBounds(chunks, settings);
    qa = splitChunkModelQa(chunks);
    modelTrimWarning = " QA-flagged chunks were selectively trimmed against the object mesh and rechecked.";
  }
  if (modelClearanceSolid && modelClearanceSolid !== state.modelManifoldCache?.solid) {
    modelClearanceSolid.delete?.();
  }

  return {
    createdAt: new Date().toISOString(),
    settings,
    sourceBounds,
    grid: { x: countX, y: countY, z: countZ },
    wasOversized: sourceBounds.size.x > settings.usableWidth || sourceBounds.size.y > settings.usableDepth || sourceBounds.size.z > settings.usableHeight,
    chunks,
    connectors,
    qa,
    method: "manifold-boolean-split",
    warning: `Chunks are produced with Manifold WASM booleans: source cradle intersected with chunk boxes, male keys unioned after object-clearance trimming, and female pockets subtracted with sloped roofs.${modelTrimWarning}${modelClearanceWarning}`,
  };
}

function buildDraftSplitPlan(mesh, settings) {
  const sourceBounds = supportMeshBounds(mesh);
  const chunkBudget = splitBodyBudget(settings);
  const countX = Math.max(1, Math.ceil(sourceBounds.size.x / chunkBudget.x));
  const countY = Math.max(1, Math.ceil(sourceBounds.size.y / chunkBudget.y));
  const countZ = 1;
  const chunkSize = {
    x: sourceBounds.size.x / countX,
    y: sourceBounds.size.y / countY,
    z: sourceBounds.size.z,
  };
  const builders = new Map();
  const cells = extractHeightFieldCells(mesh, sourceBounds);

  for (let iy = 0; iy < countY; iy += 1) {
    for (let ix = 0; ix < countX; ix += 1) {
      builders.set(`${ix}:${iy}:0`, {
        ix,
        iy,
        iz: 0,
        cells: [],
        features: [],
        openings: [],
        box: {
          min: {
            x: sourceBounds.min.x + chunkSize.x * ix,
            y: sourceBounds.min.y + chunkSize.y * iy,
            z: sourceBounds.min.z,
          },
          max: {
            x: ix === countX - 1 ? sourceBounds.max.x : sourceBounds.min.x + chunkSize.x * (ix + 1),
            y: iy === countY - 1 ? sourceBounds.max.y : sourceBounds.min.y + chunkSize.y * (iy + 1),
            z: sourceBounds.max.z,
          },
        },
      });
    }
  }

  for (const cell of cells) {
    const ix = clampIndex(Math.floor((cell.center.x - sourceBounds.min.x) / Math.max(chunkSize.x, 0.0001)), countX);
    const iy = clampIndex(Math.floor((cell.center.y - sourceBounds.min.y) / Math.max(chunkSize.y, 0.0001)), countY);
    builders.get(`${ix}:${iy}:0`).cells.push(cell);
  }

  const chunks = [...builders.values()]
    .filter((builder) => builder.cells.length > 0)
    .map((builder, index) => finalizeChunk(builder, index, settings))
    .sort((a, b) => a.id.localeCompare(b.id));
  const connectors = settings.connectorsEnabled ? addZSlideDovetails(chunks, sourceBounds, settings) : [];
  rebuildConstructedChunkMeshes(chunks, settings);
  updateSplitChunkBounds(chunks, settings);

  return {
    createdAt: new Date().toISOString(),
    settings,
    sourceBounds,
    grid: { x: countX, y: countY, z: countZ },
    wasOversized: sourceBounds.size.x > settings.usableWidth || sourceBounds.size.y > settings.usableDepth || sourceBounds.size.z > settings.usableHeight,
    chunks,
    connectors,
    method: "constructed-height-field-split",
    warning: "Split chunks are reconstructed as closed height-field solids. Dovetail sockets use exact local trapezoid cuts with sloped pocket roofs plus matching sloped keys.",
  };
}

function clampIndex(index, count) {
  return Math.max(0, Math.min(count - 1, index));
}

function finalizeChunk(builder, index, settings) {
  const mesh = meshConstructedCells(builder.cells, builder.openings);
  const bounds = supportMeshBounds(mesh);
  const fits = bounds.size.x <= settings.usableWidth + 0.001 && bounds.size.y <= settings.usableDepth + 0.001 && bounds.size.z <= settings.usableHeight + 0.001;
  return {
    id: `P${String(index + 1).padStart(2, "0")}`,
    grid: { x: builder.ix, y: builder.iy, z: builder.iz },
    box: builder.box,
    cells: builder.cells,
    features: builder.features ?? [],
    openings: builder.openings ?? [],
    bodyBounds: bounds,
    mesh,
    bounds,
    fits,
  };
}

function supportMeshBounds(mesh) {
  const vertices = mesh?.vertices ?? [];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const x = vertices[index];
    const y = vertices[index + 1];
    const z = vertices[index + 2];
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  if (!Number.isFinite(min.x)) {
    min.x = 0;
    min.y = 0;
    min.z = 0;
    max.x = 0;
    max.y = 0;
    max.z = 0;
  }
  return {
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

function cloneSupportMesh(mesh) {
  const vertices = mesh?.vertices ?? [];
  const triangles = mesh?.triangles ?? [];
  return {
    ...mesh,
    vertices: vertices.slice ? vertices.slice() : [...vertices],
    triangles: triangles.slice ? triangles.slice() : [...triangles],
    triangle_count: Math.floor(triangles.length / 3),
  };
}

function addZSlideDovetails(chunks, sourceBounds, settings, sourceMesh) {
  const byGrid = new Map(chunks.map((chunk) => [`${chunk.grid.x}:${chunk.grid.y}:${chunk.grid.z}`, chunk]));
  const connectors = [];
  const modelTriangles = state.modelMesh ? modelTrianglesForQa() : [];

  for (const chunk of chunks) {
    const right = byGrid.get(`${chunk.grid.x + 1}:${chunk.grid.y}:${chunk.grid.z}`);
    if (right) {
      const connector = addZSlideDovetailPair(chunk, right, "x", sourceBounds, settings, sourceMesh, modelTriangles, connectors.length + 1);
      if (connector) connectors.push(connector);
    }
    const back = byGrid.get(`${chunk.grid.x}:${chunk.grid.y + 1}:${chunk.grid.z}`);
    if (back) {
      const connector = addZSlideDovetailPair(chunk, back, "y", sourceBounds, settings, sourceMesh, modelTriangles, connectors.length + 1);
      if (connector) connectors.push(connector);
    }
  }

  for (const chunk of chunks) {
    chunk.mesh.triangle_count = Math.floor(chunk.mesh.triangles.length / 3);
    chunk.bounds = supportMeshBounds(chunk.mesh);
    chunk.fits = chunk.bounds.size.x <= settings.usableWidth + 0.001 && chunk.bounds.size.y <= settings.usableDepth + 0.001 && chunk.bounds.size.z <= settings.usableHeight + 0.001;
  }

  return connectors;
}

function addZSlideDovetailPair(maleChunk, femaleChunk, axis, sourceBounds, settings, sourceMesh, modelTriangles, index) {
  const size = settings.connectorSize;
  const clearance = settings.connectorClearance;
  const label = `D${String(index).padStart(2, "0")}`;
  let zRange;
  let dimensions;
  let maleFootprint;
  let maleRoofFootprint;
  let socketFootprint;
  let side;

  if (axis === "x") {
    const seam = (maleChunk.box.max.x + femaleChunk.box.min.x) / 2;
    const yCenter = overlapCenter(maleChunk.bounds.min.y, maleChunk.bounds.max.y, femaleChunk.bounds.min.y, femaleChunk.bounds.max.y);
    dimensions = connectorDimensionsForZRange({ min: sourceBounds.min.z, max: sourceBounds.min.z + size }, settings);
    ({ maleFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, yCenter, dimensions, clearance));
    zRange = connectorZRange(sourceMesh, sourceBounds, settings, [maleFootprint, socketFootprint], modelTriangles);
    if (!zRange) return null;
    dimensions = connectorDimensionsForZRange(zRange, settings);
    ({ maleFootprint, maleRoofFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, yCenter, dimensions, clearance));
    zRange = connectorZRange(sourceMesh, sourceBounds, settings, [maleFootprint, socketFootprint], modelTriangles);
    if (!zRange) return null;
    dimensions = connectorDimensionsForZRange(zRange, settings);
    ({ maleFootprint, maleRoofFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, yCenter, dimensions, clearance));
    maleChunk.features.push({
      type: "tongue",
      zMin: zRange.min,
      zMax: zRange.max,
      points: maleFootprint,
      roof: roofProfile(side, maleRoofFootprint, zRange.max, dimensions.roofRise),
    });
    femaleChunk.features.push({
      type: "slot",
      side,
      zMin: zRange.min,
      zMax: zRange.max + clearance,
      roof: roofProfile(side, socketFootprint, zRange.max + clearance, dimensions.roofRise),
      points: socketFootprint,
    });
  } else {
    const seam = (maleChunk.box.max.y + femaleChunk.box.min.y) / 2;
    const xCenter = overlapCenter(maleChunk.bounds.min.x, maleChunk.bounds.max.x, femaleChunk.bounds.min.x, femaleChunk.bounds.max.x);
    dimensions = connectorDimensionsForZRange({ min: sourceBounds.min.z, max: sourceBounds.min.z + size }, settings);
    ({ maleFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, xCenter, dimensions, clearance));
    zRange = connectorZRange(sourceMesh, sourceBounds, settings, [maleFootprint, socketFootprint], modelTriangles);
    if (!zRange) return null;
    dimensions = connectorDimensionsForZRange(zRange, settings);
    ({ maleFootprint, maleRoofFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, xCenter, dimensions, clearance));
    zRange = connectorZRange(sourceMesh, sourceBounds, settings, [maleFootprint, socketFootprint], modelTriangles);
    if (!zRange) return null;
    dimensions = connectorDimensionsForZRange(zRange, settings);
    ({ maleFootprint, maleRoofFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, xCenter, dimensions, clearance));
    maleChunk.features.push({
      type: "tongue",
      zMin: zRange.min,
      zMax: zRange.max,
      points: maleFootprint,
      roof: roofProfile(side, maleRoofFootprint, zRange.max, dimensions.roofRise),
    });
    femaleChunk.features.push({
      type: "slot",
      side,
      zMin: zRange.min,
      zMax: zRange.max + clearance,
      roof: roofProfile(side, socketFootprint, zRange.max + clearance, dimensions.roofRise),
      points: socketFootprint,
    });
  }

  return {
    id: label,
    type: "split-face-z-slide-dovetail",
    axis,
    slide_axis: "z",
    male_chunk: maleChunk.id,
    female_chunk: femaleChunk.id,
    seam_mm: roundedCoordinate(zRange.seam ?? (axis === "x"
      ? (maleChunk.box.max.x + femaleChunk.box.min.x) / 2
      : (maleChunk.box.max.y + femaleChunk.box.min.y) / 2)),
    clearance_mm: clearance,
    nominal_size_mm: size,
    effective_size_mm: roundedCoordinate(dimensions.effectiveSize),
    neck_size_mm: roundedCoordinate(dimensions.neckSize),
    projection_mm: roundedCoordinate(dimensions.projection),
    footprint_bounds_mm: footprintBounds([maleFootprint, socketFootprint]),
    male_footprint_mm: maleFootprint.map(roundedPoint2d),
    male_visible_footprint_mm: (maleRoofFootprint ?? maleFootprint).map(roundedPoint2d),
    socket_footprint_mm: socketFootprint.map(roundedPoint2d),
    z_range_mm: { min: roundedCoordinate(zRange.min), max: roundedCoordinate(zRange.max) },
    height_mm: roundedCoordinate(zRange.max - zRange.min),
    shallow: Boolean(zRange.shallow),
    roof_angle_deg: roundedCoordinate(dimensions.roofAngleDeg),
    support_free_roof: dimensions.supportFreeRoof,
    local_cradle_top_mm: roundedCoordinate(zRange.localTop),
  };
}

function buildDovetailFootprints(axis, seam, center, dimensions, clearance) {
  const head = dimensions.effectiveSize;
  const neck = dimensions.neckSize;
  const projection = dimensions.projection;
  const rootInset = dimensions.rootInset;
  const socketNarrow = neck / 2 + clearance;
  const socketWide = head / 2 + clearance;
  const socketEnd = seam + projection + clearance;

  if (axis === "x") {
    const maleVisibleFootprint = [
      { x: seam, y: center - neck / 2 },
      { x: seam, y: center + neck / 2 },
      { x: seam + projection, y: center + head / 2 },
      { x: seam + projection, y: center - head / 2 },
    ];
    return {
      side: "x-min",
      maleFootprint: [
        { x: seam - rootInset, y: center - neck / 2 },
        { x: seam - rootInset, y: center + neck / 2 },
        { x: seam + projection, y: center + head / 2 },
        { x: seam + projection, y: center - head / 2 },
      ],
      maleRoofFootprint: maleVisibleFootprint,
      socketFootprint: [
        { x: seam, y: center - socketNarrow },
        { x: seam, y: center + socketNarrow },
        { x: socketEnd, y: center + socketWide },
        { x: socketEnd, y: center - socketWide },
      ],
    };
  }

  const maleVisibleFootprint = [
    { x: center - neck / 2, y: seam },
    { x: center + neck / 2, y: seam },
    { x: center + head / 2, y: seam + projection },
    { x: center - head / 2, y: seam + projection },
  ];
  return {
    side: "y-min",
    maleFootprint: [
      { x: center - neck / 2, y: seam - rootInset },
      { x: center + neck / 2, y: seam - rootInset },
      { x: center + head / 2, y: seam + projection },
      { x: center - head / 2, y: seam + projection },
    ],
    maleRoofFootprint: maleVisibleFootprint,
    socketFootprint: [
      { x: center - socketNarrow, y: seam },
      { x: center + socketNarrow, y: seam },
      { x: center + socketWide, y: socketEnd },
      { x: center - socketWide, y: socketEnd },
    ],
  };
}

function footprintBounds(footprints) {
  const points = footprints.flat();
  return manifestBounds({
    min: {
      x: Math.min(...points.map((point) => point.x)),
      y: Math.min(...points.map((point) => point.y)),
      z: 0,
    },
    max: {
      x: Math.max(...points.map((point) => point.x)),
      y: Math.max(...points.map((point) => point.y)),
      z: 0,
    },
    size: {
      x: Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)),
      y: Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)),
      z: 0,
    },
  });
}

function connectorDimensionsForZRange(zRange, settings) {
  const nominalSize = settings.connectorSize;
  const clearance = settings.connectorClearance;
  const nominalProjection = nominalSize * 1.2;
  const roofRise = connectorRoofRise(zRange, nominalSize);
  const minSlope = Math.tan(THREE.MathUtils.degToRad(CONNECTOR_MIN_ROOF_ANGLE_DEG));
  const maxSocketRun = roofRise / Math.max(minSlope, 0.0001);
  const supportFreeProjection = maxSocketRun - clearance;
  const shapeSafeProjection = Math.max(CONNECTOR_MIN_PROJECTION_MM, nominalSize * CONNECTOR_MIN_PROJECTION_WIDTH_RATIO);
  const projection = Math.min(
    nominalProjection,
    Math.max(shapeSafeProjection, supportFreeProjection)
  );
  const effectiveSize = nominalSize;
  const finalProjection = Math.max(
    shapeSafeProjection,
    Math.min(projection, effectiveSize * 1.2)
  );
  const nominalNeck = effectiveSize * 0.58;
  const maxTaperPerSide = Math.max(0.25, finalProjection * 0.35);
  const neckSize = Math.max(nominalNeck, effectiveSize - maxTaperPerSide * 2);
  const rootInset = Math.max(0.6, settings.connectorClearance + 0.5);
  const socketRun = finalProjection + clearance;
  const roofAngleDeg = THREE.MathUtils.radToDeg(Math.atan2(roofRise, Math.max(socketRun, 0.0001)));

  return {
    effectiveSize,
    neckSize,
    rootInset,
    projection: finalProjection,
    roofRise,
    roofAngleDeg,
    supportFreeRoof: roofAngleDeg >= CONNECTOR_MIN_ROOF_ANGLE_DEG - 0.25,
  };
}

function connectorZRange(sourceMesh, sourceBounds, settings, footprints, modelTriangles = []) {
  const bottom = sourceBounds.min.z;
  let localTop = connectorLocalTop(sourceMesh, footprints, settings);
  const modelBottom = connectorModelBottom(modelTriangles, footprints, settings);
  if (Number.isFinite(modelBottom)) localTop = Math.min(localTop, modelBottom);
  if (!Number.isFinite(localTop)) return null;
  const topClearance = Math.max(1.5, settings.connectorClearance + 1.2, (sourceMesh?.cell_size_mm ?? 1) * 1.5);
  const maxHeight = localTop - bottom - topClearance;
  const minHeight = Math.max(0.9, settings.connectorClearance * 2.5, (sourceMesh?.cell_size_mm ?? 1) * 0.75);
  if (maxHeight < minHeight) return null;
  const preferredHeight = Math.max(minHeight, Math.min(settings.connectorSize * 4, maxHeight * 0.45));
  const height = Math.min(maxHeight, preferredHeight);
  return {
    min: bottom,
    max: bottom + height,
    localTop,
    shallow: height < settings.connectorSize,
  };
}

function connectorModelBottom(modelTriangles, footprints, settings) {
  if (!modelTriangles.length) return Infinity;
  const spacing = Math.max(0.8, Math.min(settings.connectorSize * 0.35, 2));
  const samples = sampleFootprints(footprints, spacing);
  let bottom = Infinity;
  for (const sample of samples) {
    const z = modelLowestZAtXY(modelTriangles, sample.x, sample.y);
    if (Number.isFinite(z)) bottom = Math.min(bottom, z);
  }
  return bottom;
}

function connectorRoofRise(zRange, size) {
  const height = Math.max(0, zRange.max - zRange.min);
  const floorThickness = Math.min(0.35, height * 0.25);
  const maxRise = Math.max(0.05, height - floorThickness);
  return Math.max(0.5, Math.min(size * 0.8, height * 0.8, maxRise));
}

function roofProfile(side, points, zMax, rise) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    side,
    zMax,
    rise: Math.max(0, rise),
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

function roofZAtPoint(point, roof) {
  if (!roof || roof.rise <= 0) return roof?.zMax ?? 0;
  let t = 1;
  if (roof.side === "x-min") t = (point.x - roof.xMin) / Math.max(roof.xMax - roof.xMin, 0.0001);
  if (roof.side === "x-max") t = (roof.xMax - point.x) / Math.max(roof.xMax - roof.xMin, 0.0001);
  if (roof.side === "y-min") t = (point.y - roof.yMin) / Math.max(roof.yMax - roof.yMin, 0.0001);
  if (roof.side === "y-max") t = (roof.yMax - point.y) / Math.max(roof.yMax - roof.yMin, 0.0001);
  return roof.zMax - roof.rise + Math.max(0, Math.min(1, t)) * roof.rise;
}

function connectorLocalTop(sourceMesh, footprints, settings) {
  const spacing = Math.max(0.8, Math.min(settings.connectorSize * 0.35, sourceMesh?.cell_size_mm ?? 2));
  const samples = sampleFootprints(footprints, spacing);
  let localTop = Infinity;
  for (const sample of samples) {
    const top = supportTopAtXY(sourceMesh, sample.x, sample.y);
    if (!Number.isFinite(top)) return -Infinity;
    localTop = Math.min(localTop, top);
  }
  return localTop;
}

function sampleFootprints(footprints, spacing) {
  const samples = [];
  const seen = new Set();
  const add = (point) => {
    const x = roundedCoordinate(point.x);
    const y = roundedCoordinate(point.y);
    const key = `${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    samples.push({ x, y });
  };

  for (const footprint of footprints) {
    const polygon = normalizePolygonCcw(footprint);
    if (polygon.length < 3) continue;
    let cx = 0;
    let cy = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      add(current);
      add({ x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
      cx += current.x;
      cy += current.y;
    }
    add({ x: cx / polygon.length, y: cy / polygon.length });

    const xs = polygon.map((point) => point.x);
    const ys = polygon.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    for (let x = minX + spacing; x < maxX; x += spacing) {
      for (let y = minY + spacing; y < maxY; y += spacing) {
        if (pointInPolygon2d({ x, y }, polygon)) add({ x, y });
      }
    }
  }

  return samples;
}

function supportTopAtXY(mesh, x, y, sampler = null) {
  const vertices = sampler?.vertices ?? mesh?.vertices ?? [];
  const triangles = sampler?.triangles ?? mesh?.triangles ?? [];
  const triangleStarts = sampler ? sampler.bins.get(sampler.binKey(x, y)) ?? [] : null;
  let top = -Infinity;
  const scanCount = triangleStarts ? triangleStarts.length : Math.floor(triangles.length / 3);

  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const index = triangleStarts ? triangleStarts[scanIndex] : scanIndex * 3;
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const z = triangleZAtXY(a, b, c, x, y);
    if (Number.isFinite(z)) top = Math.max(top, z);
  }
  return top;
}

function buildSupportTopSampler(mesh, binSize, sampleCells = []) {
  const vertices = mesh?.vertices ?? [];
  const triangles = mesh?.triangles ?? [];
  const size = Math.max(0.25, Number(binSize) || 1);
  const bins = new Map();
  const binCoord = (value) => Math.floor(value / size);
  const binKeyFromCoord = (ix, iy) => `${ix}:${iy}`;
  const binKey = (x, y) => binKeyFromCoord(binCoord(x), binCoord(y));
  const targetBins = new Set();
  const targetBinCoords = [];
  for (const cell of sampleCells) {
    const ix = binCoord(cell?.[0]);
    const iy = binCoord(cell?.[1]);
    const key = binKeyFromCoord(ix, iy);
    if (targetBins.has(key)) continue;
    targetBins.add(key);
    targetBinCoords.push({ ix, iy, key });
  }
  const targetOnly = targetBins.size > 0;
  const pad = 0.00001;

  const addToBin = (key, index) => {
    const bucket = bins.get(key);
    if (bucket) bucket.push(index);
    else bins.set(key, [index]);
  };

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-9) continue;

    const minIx = binCoord(Math.min(a.x, b.x, c.x) - pad);
    const maxIx = binCoord(Math.max(a.x, b.x, c.x) + pad);
    const minIy = binCoord(Math.min(a.y, b.y, c.y) - pad);
    const maxIy = binCoord(Math.max(a.y, b.y, c.y) + pad);
    const binCount = (maxIx - minIx + 1) * (maxIy - minIy + 1);

    if (targetOnly && targetBinCoords.length < binCount) {
      for (const target of targetBinCoords) {
        if (target.ix >= minIx && target.ix <= maxIx && target.iy >= minIy && target.iy <= maxIy) {
          addToBin(target.key, index);
        }
      }
    } else {
      for (let iy = minIy; iy <= maxIy; iy += 1) {
        for (let ix = minIx; ix <= maxIx; ix += 1) {
          const key = binKeyFromCoord(ix, iy);
          if (!targetOnly || targetBins.has(key)) addToBin(key, index);
        }
      }
    }
  }

  return { vertices, triangles, bins, binKey };
}

function evaluateCradleMeshSupportQa(mesh, coverage) {
  const cells = coverage?.cells ?? [];
  const cellSize = Number(mesh?.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8;
  const tolerance = Math.max(0.12, cellSize * 0.35);
  const expectedCells = cells.filter((cell) => cell?.[3]);
  const maxSamples = meshQaSampleLimit(mesh, expectedCells.length);
  const sampleStep = expectedCells.length > maxSamples ? expectedCells.length / maxSamples : 1;
  const sampledCells = [];
  for (let sampleIndex = 0; sampleIndex < expectedCells.length; sampleIndex += sampleStep) {
    sampledCells.push(expectedCells[Math.floor(sampleIndex)]);
  }
  const sampler = buildSupportTopSampler(mesh, Math.max(0.75, cellSize), sampledCells);
  let sampled = 0;
  let supported = 0;
  let unsupported = 0;
  let maxGap = 0;
  let maxOverreach = 0;

  for (const cell of sampledCells) {
    const [x, y, targetZ] = cell;
    const meshTop = supportTopAtXY(mesh, x, y, sampler);
    if (!Number.isFinite(meshTop)) {
      sampled += 1;
      unsupported += 1;
      maxGap = Math.max(maxGap, tolerance);
      continue;
    }

    sampled += 1;
    const gap = targetZ - meshTop;
    const overreach = meshTop - targetZ;
    maxGap = Math.max(maxGap, gap);
    maxOverreach = Math.max(maxOverreach, overreach);
    if (gap <= tolerance) supported += 1;
    else unsupported += 1;
  }

  return {
    sampled_cells: sampled,
    supported_cells: supported,
    unsupported_cells: unsupported,
    supported_percent: sampled ? (supported / sampled) * 100 : 0,
    max_gap_mm: roundedCoordinate(Math.max(0, maxGap)),
    max_overreach_mm: roundedCoordinate(Math.max(0, maxOverreach)),
    tolerance_mm: roundedCoordinate(tolerance),
  };
}

function meshQaSampleLimit(mesh, targetCount) {
  const triangleCount = Math.floor((mesh?.triangles?.length ?? 0) / 3);
  if (triangleCount > 750000) return Math.min(targetCount, 6000);
  if (triangleCount > 250000) return Math.min(targetCount, 9000);
  return targetCount;
}

function evaluateCradleMeshAndStabilityQaSync(mesh, coverage, centerOfMass = estimateModelCenterOfMass()) {
  return {
    meshQa: evaluateCradleMeshSupportQa(mesh, coverage),
    stabilityQa: evaluateCradleStabilityQa(mesh, coverage, centerOfMass),
    timings: [],
    worker: false,
  };
}

async function evaluateCradleMeshAndStabilityQa(mesh, coverage) {
  const centerOfMass = estimateModelCenterOfMass();
  if (typeof Worker !== "function" || !mesh?.vertices?.length || !mesh?.triangles?.length) {
    return evaluateCradleMeshAndStabilityQaSync(mesh, coverage, centerOfMass);
  }

  try {
    return await requestQaWorker("meshAndStabilityQa", {
      mesh: {
        vertices: new Float32Array(mesh.vertices),
        triangles: new Uint32Array(mesh.triangles),
        cell_size_mm: mesh.cell_size_mm,
      },
      coverage,
      centerOfMass,
      cellSize: Number(mesh?.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8,
    });
  } catch (error) {
    console.warn("QA worker failed; falling back to main-thread QA.", error);
    return evaluateCradleMeshAndStabilityQaSync(mesh, coverage, centerOfMass);
  }
}

function ensureQaWorker() {
  if (qaWorker) return qaWorker;

  qaWorker = new Worker(new URL("./qaWorker.js?v=targeted-mesh-qa-1", import.meta.url), { type: "module" });
  qaWorker.onmessage = (event) => {
    const message = event.data ?? {};
    const request = qaWorkerRequests.get(message.id);
    if (!request) return;
    qaWorkerRequests.delete(message.id);

    if (message.type === "meshAndStabilityQaResult") {
      request.resolve({
        meshQa: message.meshQa,
        stabilityQa: message.stabilityQa,
        timings: message.timings ?? [],
        worker: true,
      });
    } else {
      request.reject(new Error(message.error || "QA worker failed"));
    }
  };
  qaWorker.onerror = (event) => {
    const error = new Error(event.message || "QA worker error");
    for (const request of qaWorkerRequests.values()) request.reject(error);
    qaWorkerRequests.clear();
    qaWorker?.terminate();
    qaWorker = null;
  };

  return qaWorker;
}

function requestQaWorker(type, payload = {}) {
  const worker = ensureQaWorker();
  const id = nextQaWorkerRequestId;
  nextQaWorkerRequestId += 1;
  const transfer = [];
  if (payload.mesh?.vertices?.buffer) transfer.push(payload.mesh.vertices.buffer);
  if (payload.mesh?.triangles?.buffer) transfer.push(payload.mesh.triangles.buffer);

  return new Promise((resolve, reject) => {
    qaWorkerRequests.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, type, ...payload }, transfer);
    } catch (error) {
      qaWorkerRequests.delete(id);
      reject(error);
    }
  });
}

function evaluateGeneratedModelIntersectionQa(mesh, options = {}) {
  const cellSize = Number(mesh?.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8;
  const phase = options.phase || "final";
  const qa = meshModelIntersectionQa(
    [{ id: "cradle", mesh }],
    {
      maxSamples: modelIntersectionQaSampleLimit(mesh, phase),
      surfaceTolerance: Math.max(0.08, cellSize * 0.28),
    }
  );
  qa.needs_exact_trim = materialIntersectionNeedsExactTrim(qa, cellSize);
  return qa;
}

function modelIntersectionQaSampleLimit(mesh, phase = "final") {
  const triangleCount = Math.floor((mesh?.triangles?.length ?? 0) / 3);
  if (triangleCount > 750000) return phase === "pretrim" ? 3500 : 5000;
  if (triangleCount > 250000) return phase === "pretrim" ? 5000 : 7000;
  return 10000;
}

function materialIntersectionNeedsExactTrim(qa, cellSize) {
  if (!qa?.intersects_model || !qa.sampled_points) return false;
  const ratio = qa.intersection_samples / qa.sampled_points;
  const penetration = Number(qa.max_penetration_mm) || 0;
  const shallowLimit = Math.max(0.6, cellSize * 0.9);
  const countLimit = Math.max(8, Math.ceil(qa.sampled_points * 0.0025));
  return penetration > shallowLimit || qa.intersection_samples >= countLimit || ratio > 0.004;
}

function formatGeneratedModelIntersectionQaStatus(qa) {
  if (!qa?.sampled_points) {
    return "Model mesh QA skipped because no cradle mesh samples were available.";
  }
  if (qa.intersects_model) {
    return `Model mesh QA warning: ${qa.intersection_samples.toLocaleString()} / ${qa.sampled_points.toLocaleString()} sampled cradle points appear inside the model, max approximate penetration ${formatStatusNumber(qa.max_penetration_mm)} mm.`;
  }
  return `Model mesh QA: no sampled cradle points are materially inside the model across ${qa.sampled_points.toLocaleString()} samples.`;
}

function evaluateCradleStabilityQa(mesh, coverage, centerOfMass = estimateModelCenterOfMass()) {
  const cells = coverage?.cells ?? [];
  const cellSize = Number(mesh?.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8;
  const supportedCells = cells
    .filter((cell) => cell?.[3])
    .map((cell) => ({ x: Number(cell[0]), y: Number(cell[1]), z: Number(cell[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
  if (!centerOfMass || supportedCells.length < 3) {
    return {
      available: false,
      severity: "idle",
      reason: supportedCells.length < 3 ? "not enough supported contact samples" : "model center of mass could not be estimated",
    };
  }

  const groundFootprint = cradleGroundFootprintSamples(mesh, cellSize);
  const hull = convexHull2d(groundFootprint.length >= 3 ? groundFootprint : supportedCells);
  if (hull.length < 3) {
    return {
      available: false,
      severity: "idle",
      reason: "cradle ground footprint is too narrow for a stability polygon",
      center_of_mass: centerOfMass.center,
      center_method: centerOfMass.method,
    };
  }

  const projection = { x: centerOfMass.center.x, y: centerOfMass.center.y };
  const inside = pointInConvexPolygon2d(projection, hull);
  const edgeDistance = distanceToPolygonEdges2d(projection, hull);
  const signedMargin = inside ? edgeDistance : -edgeDistance;
  const contactZ = median(supportedCells.map((point) => point.z));
  const heightAboveContact = Math.max(cellSize, centerOfMass.center.z - contactZ);
  const tipAngleDeg = inside ? THREE.MathUtils.radToDeg(Math.atan2(Math.max(0, signedMargin), heightAboveContact)) : 0;
  const footprintBounds = bounds2d(hull);
  const smallerSpan = Math.max(cellSize, Math.min(footprintBounds.max.x - footprintBounds.min.x, footprintBounds.max.y - footprintBounds.min.y));
  const marginRatio = signedMargin / smallerSpan;
  let severity = "ok";
  let risk = "stable";

  if (!inside) {
    severity = "error";
    risk = "outside";
  } else if (signedMargin < cellSize * 1.5 || tipAngleDeg < 5 || marginRatio < 0.04) {
    severity = "caution";
    risk = "near_edge";
  } else if (signedMargin < cellSize * 3 || tipAngleDeg < 10 || marginRatio < 0.08) {
    severity = "caution";
    risk = "modest_margin";
  }

  return {
    available: true,
    severity,
    risk,
    center_of_mass: centerOfMass.center,
    center_method: centerOfMass.method,
    confidence: centerOfMass.confidence,
    projection,
    supported_contact_samples: supportedCells.length,
    ground_contact_samples: groundFootprint.length,
    hull_points: hull.length,
    inside,
    signed_margin_mm: roundedCoordinate(signedMargin),
    edge_distance_mm: roundedCoordinate(edgeDistance),
    contact_z_mm: roundedCoordinate(contactZ),
    height_above_contact_mm: roundedCoordinate(heightAboveContact),
    tip_angle_deg: roundedCoordinate(tipAngleDeg),
    margin_ratio: roundedCoordinate(marginRatio),
  };
}

function cradleGroundFootprintSamples(mesh, cellSize) {
  const vertices = mesh?.vertices ?? [];
  if (vertices.length < 3) return [];

  let minZ = Infinity;
  for (let index = 2; index < vertices.length; index += 3) {
    minZ = Math.min(minZ, vertices[index]);
  }
  if (!Number.isFinite(minZ)) return [];

  const band = Math.max(1.5, cellSize * 1.75);
  const quant = Math.max(0.75, cellSize);
  const maxSamples = 24000;
  const samples = [];
  const seen = new Set();
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const qx = Math.round(x / quant) * quant;
    const qy = Math.round(y / quant) * quant;
    const key = `${qx}:${qy}`;
    if (seen.has(key)) return;
    seen.add(key);
    samples.push({ x: roundedCoordinate(qx), y: roundedCoordinate(qy) });
  };

  const vertexCount = Math.floor(vertices.length / 3);
  const stride = Math.max(1, Math.floor(vertexCount / maxSamples));
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += stride) {
    const offset = vertexIndex * 3;
    if (vertices[offset + 2] <= minZ + band) add(vertices[offset], vertices[offset + 1]);
  }

  return samples;
}

function formatStabilityQaStatus(qa) {
  if (!qa?.available) {
    return `Stability QA skipped: ${qa?.reason || "insufficient support data"}.`;
  }

  const methodText = qa.center_method === "volume"
    ? "closed-volume estimate"
    : "surface-area fallback";
  const centerText = `COM ${methodText} projects to (${formatStatusNumber(qa.projection.x)}, ${formatStatusNumber(qa.projection.y)}) mm`;
  const sampleText = `${qa.supported_contact_samples.toLocaleString()} supported contact samples`;
  const footprintText = qa.ground_contact_samples
    ? ` and ${qa.ground_contact_samples.toLocaleString()} ground-footprint samples`
    : "";

  if (!qa.inside) {
    return `Stability QA warning: ${centerText}, outside the cradle ground footprint by about ${formatStatusNumber(Math.abs(qa.signed_margin_mm))} mm using ${sampleText}${footprintText}. Cradle/object stability is questionable without a wider base or more support under the load.`;
  }

  const marginText = `${formatStatusNumber(qa.signed_margin_mm)} mm inside the support polygon`;
  const tipText = `estimated tip margin ${formatStatusNumber(qa.tip_angle_deg)} deg`;
  if (qa.risk === "stable") {
    return `Stability QA: ${centerText}, ${marginText}; ${tipText} using ${sampleText}${footprintText}.`;
  }
  return `Stability QA caution: ${centerText}, only ${marginText}; ${tipText} using ${sampleText}${footprintText}.`;
}

function estimateModelCenterOfMass() {
  const payload = buildMeshPayload();
  if (state.modelCenterOfMassCache?.payload === payload) {
    return state.modelCenterOfMassCache.centerOfMass;
  }

  const vertices = payload.vertices ?? [];
  const triangleCount = Math.floor(vertices.length / 9);
  if (!triangleCount) return null;

  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const point = { x: vertices[index], y: vertices[index + 1], z: vertices[index + 2] };
    bounds.min.x = Math.min(bounds.min.x, point.x);
    bounds.min.y = Math.min(bounds.min.y, point.y);
    bounds.min.z = Math.min(bounds.min.z, point.z);
    bounds.max.x = Math.max(bounds.max.x, point.x);
    bounds.max.y = Math.max(bounds.max.y, point.y);
    bounds.max.z = Math.max(bounds.max.z, point.z);
  }

  let signedVolume = 0;
  const volumeMoment = { x: 0, y: 0, z: 0 };
  let surfaceArea = 0;
  const surfaceMoment = { x: 0, y: 0, z: 0 };

  for (let index = 0; index + 8 < vertices.length; index += 9) {
    const a = { x: vertices[index], y: vertices[index + 1], z: vertices[index + 2] };
    const b = { x: vertices[index + 3], y: vertices[index + 4], z: vertices[index + 5] };
    const c = { x: vertices[index + 6], y: vertices[index + 7], z: vertices[index + 8] };
    const volume = dotPoint(a, crossPoint(b, c)) / 6;
    signedVolume += volume;
    volumeMoment.x += volume * (a.x + b.x + c.x) / 4;
    volumeMoment.y += volume * (a.y + b.y + c.y) / 4;
    volumeMoment.z += volume * (a.z + b.z + c.z) / 4;

    const area = Math.sqrt(triangleAreaSquared(a, b, c)) / 2;
    surfaceArea += area;
    surfaceMoment.x += area * (a.x + b.x + c.x) / 3;
    surfaceMoment.y += area * (a.y + b.y + c.y) / 3;
    surfaceMoment.z += area * (a.z + b.z + c.z) / 3;
  }

  const surfaceCenter = surfaceArea > 1e-9
    ? {
        x: surfaceMoment.x / surfaceArea,
        y: surfaceMoment.y / surfaceArea,
        z: surfaceMoment.z / surfaceArea,
      }
    : null;
  const volumeCenter = Math.abs(signedVolume) > 1e-6
    ? {
        x: volumeMoment.x / signedVolume,
        y: volumeMoment.y / signedVolume,
        z: volumeMoment.z / signedVolume,
      }
    : null;
  if (volumeCenter && pointInsideExpandedBounds(volumeCenter, bounds, 0.1)) {
    const span = Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z);
    const surfaceDisagreement = surfaceCenter ? Math.sqrt(pointDistanceSquared(volumeCenter, surfaceCenter)) : 0;
    const disagreementLimit = Math.max(10, span * 0.18);
    if (surfaceCenter && surfaceDisagreement > disagreementLimit && pointInsideExpandedBounds(surfaceCenter, bounds, 0.02)) {
      const centerOfMass = {
        center: roundedPoint(surfaceCenter),
        method: "surface",
        confidence: `fallback because closed-volume and surface-area estimates disagreed by ${formatStatusNumber(surfaceDisagreement)} mm`,
      };
      state.modelCenterOfMassCache = { payload, centerOfMass };
      return centerOfMass;
    }

    const centerOfMass = {
      center: roundedPoint(volumeCenter),
      method: "volume",
      confidence: "higher when the STL is watertight and consistently oriented",
    };
    state.modelCenterOfMassCache = { payload, centerOfMass };
    return centerOfMass;
  }

  if (!surfaceCenter) return null;
  const centerOfMass = {
    center: roundedPoint(surfaceCenter),
    method: "surface",
    confidence: "fallback for open, non-watertight, or inconsistently oriented STLs",
  };
  state.modelCenterOfMassCache = { payload, centerOfMass };
  return centerOfMass;
}

function pointInsideExpandedBounds(point, bounds, fraction) {
  const dx = (bounds.max.x - bounds.min.x) * fraction;
  const dy = (bounds.max.y - bounds.min.y) * fraction;
  const dz = (bounds.max.z - bounds.min.z) * fraction;
  return point.x >= bounds.min.x - dx && point.x <= bounds.max.x + dx &&
    point.y >= bounds.min.y - dy && point.y <= bounds.max.y + dy &&
    point.z >= bounds.min.z - dz && point.z <= bounds.max.z + dz;
}

function roundedPoint(point) {
  return {
    x: roundedCoordinate(point.x),
    y: roundedCoordinate(point.y),
    z: roundedCoordinate(point.z),
  };
}

function roundedPoint2d(point) {
  return {
    x: roundedCoordinate(point.x),
    y: roundedCoordinate(point.y),
  };
}

function convexHull2d(points) {
  const unique = [...new Map(points.map((point) => [`${roundedCoordinate(point.x)}:${roundedCoordinate(point.y)}`, {
    x: roundedCoordinate(point.x),
    y: roundedCoordinate(point.y),
  }])).values()];
  unique.sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;

  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross2d(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && cross2d(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function cross2d(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInConvexPolygon2d(point, polygon) {
  if (polygon.length < 3) return false;
  const tolerance = -1e-7;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (cross2d(a, b, point) < tolerance) return false;
  }
  return true;
}

function distanceToPolygonEdges2d(point, polygon) {
  let distance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, pointSegmentDistance2d(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return Number.isFinite(distance) ? distance : 0;
}

function pointSegmentDistance2d(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function bounds2d(points) {
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const point of points) {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
  }
  return { min, max };
}

function modelLowestZAtXY(triangles, x, y) {
  let bottom = Infinity;
  for (const triangle of triangles) {
    const z = triangleZAtXY(triangle.a, triangle.b, triangle.c, x, y);
    if (Number.isFinite(z)) bottom = Math.min(bottom, z);
  }
  return bottom;
}

function triangleZAtXY(a, b, c, x, y) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-9) return NaN;
  const w1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
  const w2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
  const w3 = 1 - w1 - w2;
  const tolerance = -0.00001;
  if (w1 < tolerance || w2 < tolerance || w3 < tolerance) return NaN;
  return w1 * a.z + w2 * b.z + w3 * c.z;
}

function overlapCenter(minA, maxA, minB, maxB) {
  const min = Math.max(minA, minB);
  const max = Math.min(maxA, maxB);
  if (max > min) return (min + max) / 2;
  return (minA + maxA + minB + maxB) / 4;
}

async function loadManifoldCore() {
  if (!manifoldCorePromise) {
    manifoldCorePromise = createManifoldModule({
      locateFile: (file) => new URL(`../vendor/manifold/${file}`, import.meta.url).href,
    }).then((core) => {
      core.setup();
      return core;
    });
  }
  return manifoldCorePromise;
}

async function buildOrganicTreeLayerSupportMesh(core, layerData, cellSize = undefined, progress = null) {
  const layers = (layerData?.layers ?? []).filter((layer) => Array.isArray(layer.disks) && layer.disks.length);
  if (!layers.length) throw new Error("organic tree layer data is empty");

  const layerHeight = Math.max(0.03, positiveNumber(layerData.layer_height_mm, 0.2));
  const overlap = Math.min(0.025, layerHeight * 0.2);
  const slabHeight = layerHeight + overlap * 2;
  const voxelSize = Math.max(0.42, Math.min(0.72, positiveNumber(cellSize, 0.8) * 0.72));
  const slabs = [];
  const report = async (value, message) => {
    if (progress) await progress(value, message);
  };

  for (const [layerIndex, layer] of layers.entries()) {
    const z = positiveNumber(layer.z, positiveNumber(layerData.bottom_z_mm, 0) + positiveNumber(layer.index, layerIndex) * layerHeight);
    const unioned = buildVoxelTreeLayerCrossSection(core, layer.disks, voxelSize);
    if (!unioned) continue;
    const simplified = unioned.simplify?.(0.003) ?? unioned;
    const rawSlab = simplified.extrude(slabHeight, 0, 0, [1, 1], false);
    const slab = assertManifoldOk(rawSlab.translate([0, 0, z - overlap]), `organic layer ${layer.index ?? layerIndex} slab`);
    rawSlab.delete?.();
    if (simplified !== unioned) simplified.delete?.();
    unioned.delete?.();
    slabs.push(slab);

    if (layerIndex % 12 === 0 || layerIndex + 1 === layers.length) {
      await report(
        (layerIndex + 1) / Math.max(1, layers.length) * 60,
        `Unioning organic tree layer ${layerIndex + 1} of ${layers.length}...`
      );
    }
  }

  if (!slabs.length) throw new Error("organic tree layer union produced no printable slabs");
  await report(64, "Combining organic tree layers into one solid...");
  const solid = await unionManifoldsBatched(core, slabs, 28, "organic tree support", async (value) => {
    await report(64 + value * 32, "Combining organic tree layers into one solid...");
  });
  const mesh = manifoldToSupportMesh(solid, cellSize);
  solid.delete?.();
  await report(100, "Organic tree support solid ready...");
  return mesh;
}

function buildVoxelTreeLayerCrossSection(core, disks, voxelSize) {
  const rows = new Map();
  const pad = voxelSize * 0.48;

  for (const disk of disks) {
    const x = Number(disk[0]);
    const y = Number(disk[1]);
    const radius = Number(disk[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0.02) continue;

    const effectiveRadius = radius + pad;
    const radiusSq = effectiveRadius * effectiveRadius;
    const minIx = Math.floor((x - effectiveRadius) / voxelSize);
    const maxIx = Math.floor((x + effectiveRadius) / voxelSize);
    const minIy = Math.floor((y - effectiveRadius) / voxelSize);
    const maxIy = Math.floor((y + effectiveRadius) / voxelSize);

    for (let iy = minIy; iy <= maxIy; iy += 1) {
      let row = rows.get(iy);
      if (!row) {
        row = new Set();
        rows.set(iy, row);
      }
      const cy = (iy + 0.5) * voxelSize;
      for (let ix = minIx; ix <= maxIx; ix += 1) {
        const cx = (ix + 0.5) * voxelSize;
        const dx = cx - x;
        const dy = cy - y;
        if (dx * dx + dy * dy <= radiusSq) row.add(ix);
      }
    }
  }

  const rectangles = [];
  for (const [iy, row] of rows) {
    const xs = Array.from(row).sort((left, right) => left - right);
    let start = null;
    let previous = null;
    for (const ix of xs) {
      if (start === null) {
        start = ix;
        previous = ix;
        continue;
      }
      if (ix === previous + 1) {
        previous = ix;
        continue;
      }
      rectangles.push(voxelRunCrossSection(core, start, previous, iy, voxelSize));
      start = ix;
      previous = ix;
    }
    if (start !== null) rectangles.push(voxelRunCrossSection(core, start, previous, iy, voxelSize));
  }

  return rectangles.length ? unionCrossSectionsBatched(core, rectangles, 128) : null;
}

function voxelRunCrossSection(core, startIx, endIx, iy, voxelSize) {
  const width = (endIx - startIx + 1) * voxelSize;
  const centerX = ((startIx + endIx + 1) * voxelSize) / 2;
  const centerY = (iy + 0.5) * voxelSize;
  const rectangle = core.CrossSection.square([width, voxelSize], true);
  const translated = rectangle.translate([centerX, centerY]);
  rectangle.delete?.();
  return translated;
}

function unionCrossSectionsBatched(core, crossSections, batchSize = 96) {
  let current = crossSections.filter(Boolean);
  while (current.length > 1) {
    const next = [];
    for (let index = 0; index < current.length; index += batchSize) {
      const batch = current.slice(index, index + batchSize);
      const unioned = batch.length === 1 ? batch[0] : core.CrossSection.union(batch);
      for (const item of batch) {
        if (item !== unioned) item.delete?.();
      }
      next.push(unioned);
    }
    current = next;
  }
  return current[0];
}

async function unionManifoldsBatched(core, manifolds, batchSize = 28, label = "solid", progress = null) {
  let current = manifolds.filter(Boolean);
  let pass = 0;
  while (current.length > 1) {
    const next = [];
    for (let index = 0; index < current.length; index += batchSize) {
      const batch = current.slice(index, index + batchSize);
      const unioned = batch.length === 1 ? batch[0] : assertManifoldOk(core.Manifold.union(batch), `${label} union`);
      for (const item of batch) {
        if (item !== unioned) item.delete?.();
      }
      next.push(unioned);
    }
    current = next;
    pass += 1;
    if (progress) await progress(Math.min(1, pass / 8));
    await nextFrame();
  }
  return current[0];
}

function supportMeshToManifold(core, mesh, label = "mesh", options = {}) {
  if (options.fast) {
    try {
      return supportMeshToManifoldFast(core, mesh, label);
    } catch (fastError) {
      console.warn(`${label} fast Manifold path failed; retrying with cleanup.`, fastError);
    }
  }

  const prepared = prepareSupportMeshForManifold(mesh);
  try {
    return supportMeshPreparedToManifold(core, prepared, label, true);
  } catch (error) {
    const diagnostics = manifoldEdgeDiagnostics(prepared);
    throw new Error(`${label} is not a valid manifold: ${error?.message || error}; ${diagnostics}`);
  }
}

function supportMeshToManifoldFast(core, mesh, label = "mesh") {
  const prepared = directSupportMeshForManifold(mesh);
  try {
    return supportMeshPreparedToManifold(core, prepared, label, false);
  } catch (error) {
    console.warn(`${label} direct indexed Manifold path failed; retrying with merge.`, error);
    return supportMeshPreparedToManifold(core, prepared, label, true);
  }
}

function supportMeshPreparedToManifold(core, prepared, label, mergeVertices = true) {
  const manifoldMesh = new core.Mesh({
    numProp: 3,
    vertProperties: toFloat32Array(prepared.vertices),
    triVerts: toUint32Array(prepared.triangles),
    tolerance: 0,
  });
  if (mergeVertices) manifoldMesh.merge();
  return assertManifoldOk(core.Manifold.ofMesh(manifoldMesh), label);
}

function directSupportMeshForManifold(mesh) {
  const vertices = toFloat32Array(mesh?.vertices ?? []);
  let triangles = mesh?.triangles;
  if (!triangles?.length) {
    const vertexCount = Math.floor(vertices.length / 3);
    triangles = new Uint32Array(vertexCount);
    for (let index = 0; index < vertexCount; index += 1) triangles[index] = index;
  } else {
    triangles = toUint32Array(triangles);
  }

  return { vertices, triangles };
}

function modelMeshToManifold(core) {
  const payload = buildMeshPayload();
  if (state.modelManifoldCache?.core === core && state.modelManifoldCache?.payload === payload) {
    return state.modelManifoldCache.solid;
  }

  state.modelManifoldCache?.solid?.delete?.();
  const indexed = payload.indexed_mesh;
  let solid = null;
  if (indexed?.vertices?.length && indexed?.triangles?.length) {
    try {
      solid = supportMeshPreparedToManifold(core, {
        vertices: indexed.vertices,
        triangles: indexed.triangles,
      }, "object model clearance solid", false);
    } catch (error) {
      console.warn("Indexed object model Manifold path failed; retrying with merge.", error);
    }
  }
  if (!solid) {
    const vertices = payload.vertices ?? [];
    solid = supportMeshToManifold(core, {
      vertices,
      triangle_count: Math.floor(vertices.length / 9),
    }, "object model clearance solid", { fast: true });
  }
  state.modelManifoldCache = { core, payload, solid };
  return solid;
}

function scheduleModelManifoldPrewarm() {
  if (!ENABLE_MODEL_MANIFOLD_PREWARM) return;
  if (!state.modelMesh) return;
  state.modelManifoldPrewarmToken += 1;
  const token = state.modelManifoldPrewarmToken;
  if (state.modelManifoldPrewarmTimer !== null) {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(state.modelManifoldPrewarmTimer);
    } else {
      window.clearTimeout(state.modelManifoldPrewarmTimer);
    }
    state.modelManifoldPrewarmTimer = null;
  }

  const run = () => {
    state.modelManifoldPrewarmTimer = null;
    if (!state.modelMesh || token !== state.modelManifoldPrewarmToken) return;
    const payload = buildMeshPayload();
    loadManifoldCore()
      .then((core) => {
        if (!state.modelMesh || token !== state.modelManifoldPrewarmToken) return;
        if (state.modelPayloadCache !== payload) return;
        modelMeshToManifold(core);
      })
      .catch((error) => {
        console.warn("Model boolean prewarm failed.", error);
      });
  };

  state.modelManifoldPrewarmTimer = typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(run, { timeout: 5000 })
    : window.setTimeout(run, 1500);
}

function assertManifoldOk(manifold, label) {
  const status = manifold?.status?.();
  if (status && status !== "NoError") {
    manifold.delete?.();
    throw new Error(`${label} failed Manifold validation: ${status}`);
  }
  return manifold;
}

function prepareSupportMeshForManifold(mesh) {
  const sourceVertices = mesh.vertices ?? [];
  const sourceTriangles = mesh.triangles ?? [];
  const vertices = [];
  const triangles = [];
  const vertexMap = new Map();
  const triangleSet = new Set();

  for (let index = 0; index + 2 < sourceTriangles.length; index += 3) {
    const a = appendPreparedVertex(sourceVertices, sourceTriangles[index], vertices, vertexMap);
    const b = appendPreparedVertex(sourceVertices, sourceTriangles[index + 1], vertices, vertexMap);
    const c = appendPreparedVertex(sourceVertices, sourceTriangles[index + 2], vertices, vertexMap);
    if (a === b || b === c || c === a) continue;
    const va = readSupportVertex(vertices, a);
    const vb = readSupportVertex(vertices, b);
    const vc = readSupportVertex(vertices, c);
    if (triangleAreaSquared(va, vb, vc) <= 1e-12) continue;
    const duplicateKey = [a, b, c].sort((left, right) => left - right).join(":");
    if (triangleSet.has(duplicateKey)) continue;
    triangleSet.add(duplicateKey);
    triangles.push(a, b, c);
  }

  capBoundaryLoops(vertices, triangles);
  return { vertices, triangles };
}

function appendPreparedVertex(sourceVertices, sourceIndex, vertices, vertexMap) {
  const offset = sourceIndex * 3;
  const x = roundedCoordinate(sourceVertices[offset] ?? 0);
  const y = roundedCoordinate(sourceVertices[offset + 1] ?? 0);
  const z = roundedCoordinate(sourceVertices[offset + 2] ?? 0);
  const key = `${x}:${y}:${z}`;
  const cached = vertexMap.get(key);
  if (cached !== undefined) return cached;
  const target = vertices.length / 3;
  vertices.push(x, y, z);
  vertexMap.set(key, target);
  return target;
}

function triangleAreaSquared(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const cross = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  return cross.x * cross.x + cross.y * cross.y + cross.z * cross.z;
}

function manifoldEdgeDiagnostics(mesh) {
  const triangles = mesh.triangles ?? [];
  const vertices = mesh.vertices ?? [];
  const edges = new Map();
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    for (const [a, b] of [
      [triangles[index], triangles[index + 1]],
      [triangles[index + 1], triangles[index + 2]],
      [triangles[index + 2], triangles[index]],
    ]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { count: 0, signed: 0 };
      edge.count += 1;
      edge.signed += a < b ? 1 : -1;
      edges.set(key, edge);
    }
  }
  let boundary = 0;
  let nonManifold = 0;
  let sameDirectionPairs = 0;
  const examples = [];
  for (const [key, edge] of edges) {
    if (edge.count === 1) boundary += 1;
    else if (edge.count !== 2) {
      nonManifold += 1;
      if (examples.length < 6) {
        const [aIndex, bIndex] = key.split(":").map((value) => Number(value));
        const a = readSupportVertex(vertices, aIndex);
        const b = readSupportVertex(vertices, bIndex);
        examples.push(`count ${edge.count} edge (${formatStatusNumber(a.x)},${formatStatusNumber(a.y)},${formatStatusNumber(a.z)})-(${formatStatusNumber(b.x)},${formatStatusNumber(b.y)},${formatStatusNumber(b.z)})`);
      }
    }
    else if (Math.abs(edge.signed) === 2) sameDirectionPairs += 1;
  }
  const exampleText = examples.length ? `; examples: ${examples.join("; ")}` : "";
  return `${Math.floor(triangles.length / 3).toLocaleString()} triangles, ${boundary.toLocaleString()} boundary edges, ${nonManifold.toLocaleString()} non-manifold edges, ${sameDirectionPairs.toLocaleString()} same-direction edge pairs${exampleText}`;
}

function capBoundaryLoops(vertices, triangles) {
  const edgeCounts = new Map();
  const directedEdges = [];
  for (let index = 0; index + 2 < triangles.length; index += 3) {
    for (const [a, b] of [
      [triangles[index], triangles[index + 1]],
      [triangles[index + 1], triangles[index + 2]],
      [triangles[index + 2], triangles[index]],
    ]) {
      const key = edgeKey(a, b);
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      directedEdges.push([a, b, key]);
    }
  }

  const nextByStart = new Map();
  for (const [a, b, key] of directedEdges) {
    if (edgeCounts.get(key) !== 1) continue;
    const options = nextByStart.get(a) ?? [];
    options.push(b);
    nextByStart.set(a, options);
  }

  const used = new Set();
  for (const [start, options] of nextByStart) {
    for (const firstNext of options) {
      const firstKey = `${start}:${firstNext}`;
      if (used.has(firstKey)) continue;
      const loop = [start];
      let current = start;
      let next = firstNext;
      while (next !== undefined) {
        used.add(`${current}:${next}`);
        current = next;
        if (current === start) break;
        loop.push(current);
        const candidates = nextByStart.get(current) ?? [];
        next = candidates.find((candidate) => !used.has(`${current}:${candidate}`));
      }
      if (loop.length >= 3 && current === start) appendLoopCap(vertices, triangles, loop);
    }
  }
}

function appendLoopCap(vertices, triangles, loop) {
  const center = { x: 0, y: 0, z: 0 };
  for (const index of loop) {
    center.x += vertices[index * 3];
    center.y += vertices[index * 3 + 1];
    center.z += vertices[index * 3 + 2];
  }
  center.x /= loop.length;
  center.y /= loop.length;
  center.z /= loop.length;
  const centerIndex = vertices.length / 3;
  vertices.push(roundedCoordinate(center.x), roundedCoordinate(center.y), roundedCoordinate(center.z));
  for (let index = 0; index < loop.length; index += 1) {
    const current = loop[index];
    const next = loop[(index + 1) % loop.length];
    triangles.push(centerIndex, next, current);
  }
}

function edgeKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function manifoldToSupportMesh(manifold, cellSize = undefined) {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp || 3;
  const vertices = new Float32Array(mesh.numVert * 3);
  for (let index = 0; index < mesh.numVert; index += 1) {
    vertices[index * 3] = mesh.vertProperties[index * numProp] ?? 0;
    vertices[index * 3 + 1] = mesh.vertProperties[index * numProp + 1] ?? 0;
    vertices[index * 3 + 2] = mesh.vertProperties[index * numProp + 2] ?? 0;
  }
  const triangles = new Uint32Array(mesh.triVerts);
  return {
    vertices,
    triangles,
    triangle_count: Math.floor(triangles.length / 3),
    ...(cellSize ? { cell_size_mm: cellSize } : {}),
  };
}

function boxToManifold(core, min, max, label = "box") {
  const size = {
    x: Math.max(0.001, max.x - min.x),
    y: Math.max(0.001, max.y - min.y),
    z: Math.max(0.001, max.z - min.z),
  };
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const cube = core.Manifold.cube([size.x, size.y, size.z], true);
  const translated = cube.translate([center.x, center.y, center.z]);
  cube.delete?.();
  return assertManifoldOk(translated, label);
}

async function applyManifoldConnectorBooleans(core, chunks, settings, cellSize, modelClearanceSolid = null, progress = null) {
  const report = async (value, message) => {
    if (progress) await progress(value, message);
  };
  for (const [index, chunk] of chunks.entries()) {
    const progressValue = 58 + ((index + 1) / Math.max(1, chunks.length)) * 24;
    if (!chunk.features.length) {
      chunk._solid?.delete?.();
      delete chunk._solid;
      await report(progressValue, `Checking split chunk ${index + 1} of ${chunks.length}...`);
      continue;
    }
    await report(progressValue, `Applying booleans to split chunk ${index + 1} of ${chunks.length}...`);
    const owned = [];
    let solid = chunk._solid ?? supportMeshToManifold(core, chunk.mesh, `${chunk.id} base chunk`);
    delete chunk._solid;
    owned.push(solid);

    const additions = [];
    for (const feature of chunk.features.filter((item) => item.type === "tongue")) {
      let addition = prismFeatureToManifold(core, feature, cellSize);
      owned.push(addition);
      if (modelClearanceSolid) {
        addition = assertManifoldOk(core.Manifold.difference([addition, modelClearanceSolid]), `${chunk.id} tongue object-clearance trim`);
        owned.push(addition);
      }
      additions.push(addition);
    }
    if (additions.length) {
      solid = assertManifoldOk(core.Manifold.union([solid, ...additions]), `${chunk.id} tongue union`);
      owned.push(solid);
    }

    const cutters = chunk.features
      .filter((feature) => feature.type === "slot")
      .map((feature) => slotFeatureToCutterManifold(core, feature, settings, cellSize));
    owned.push(...cutters);
    if (cutters.length) {
      solid = assertManifoldOk(core.Manifold.difference([solid, ...cutters]), `${chunk.id} slot difference`);
      owned.push(solid);
    }

    const cleaned = simplifySplitBooleanSolid(solid, settings, `${chunk.id} connector cleanup`);
    if (cleaned !== solid) owned.push(cleaned);
    solid = cleaned;
    chunk.mesh = manifoldToSupportMesh(solid, cellSize);
    chunk.bounds = supportMeshBounds(chunk.mesh);
    chunk.bodyBounds = chunk.bounds;
    for (const item of owned) item.delete?.();
  }
}

function simplifySplitBooleanSolid(solid, settings, label) {
  return solid;
}

async function trimQaIntersectingChunksAgainstModel(core, chunks, affectedChunkIds, cellSize, modelClearanceSolid, settings, progress = null) {
  if (!modelClearanceSolid || !affectedChunkIds?.length) return;
  const affected = new Set(affectedChunkIds);
  const targets = chunks.filter((chunk) => affected.has(chunk.id));
  const report = async (value, message) => {
    if (progress) await progress(value, message);
  };

  for (const [index, chunk] of targets.entries()) {
    await report(91 + ((index + 1) / Math.max(1, targets.length)) * 5, `Trimming split chunk ${chunk.id} away from object model...`);
    const solid = supportMeshToManifold(core, chunk.mesh, `${chunk.id} QA trim source`);
    const trimmed = assertManifoldOk(core.Manifold.difference([solid, modelClearanceSolid]), `${chunk.id} QA object trim`);
    const simplified = simplifySplitBooleanSolid(trimmed, settings, `${chunk.id} QA trim cleanup`);
    chunk.mesh = manifoldToSupportMesh(simplified, cellSize);
    chunk.bounds = supportMeshBounds(chunk.mesh);
    chunk.bodyBounds = chunk.bounds;
    solid.delete?.();
    trimmed.delete?.();
    if (simplified !== trimmed) simplified.delete?.();
  }
}

function prismFeatureToManifold(core, feature, cellSize) {
  const mesh = { vertices: [], triangles: [], triangle_count: 0, ...(cellSize ? { cell_size_mm: cellSize } : {}) };
  appendVerticalPrismToMesh(mesh, feature.points, feature.zMin, feature.zMax, feature.roof);
  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return supportMeshToManifold(core, mesh, `${feature.type} connector`);
}

function slotFeatureToCutterManifold(core, feature, settings, cellSize) {
  const extension = Math.max(1, settings.connectorClearance + 0.5);
  const points = extendSocketFootprint(feature.points, feature.side, extension);
  const roof = {
    ...(feature.roof ?? roofProfile(feature.side, feature.points, feature.zMax, 0)),
  };
  const mesh = { vertices: [], triangles: [], triangle_count: 0, ...(cellSize ? { cell_size_mm: cellSize } : {}) };
  appendVerticalPrismToMesh(mesh, points, feature.zMin - extension, feature.zMax, roof);
  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return supportMeshToManifold(core, mesh, `${feature.type} connector cutter`);
}

function extendSocketFootprint(points, side, extension) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const tolerance = 0.001;
  return points.map((point) => {
    if (side === "x-min" && Math.abs(point.x - minX) <= tolerance) return { ...point, x: point.x - extension };
    if (side === "x-max" && Math.abs(point.x - maxX) <= tolerance) return { ...point, x: point.x + extension };
    if (side === "y-min" && Math.abs(point.y - minY) <= tolerance) return { ...point, y: point.y - extension };
    if (side === "y-max" && Math.abs(point.y - maxY) <= tolerance) return { ...point, y: point.y + extension };
    return { ...point };
  });
}

function rebuildConstructedChunkMeshes(chunks, settings) {
  for (const chunk of chunks) {
    chunk.mesh = meshConstructedCells(chunk.cells, chunk.openings);
    for (const feature of chunk.features) {
      if (feature.type === "box") appendBoxToMesh(chunk.mesh, feature.min, feature.max);
      if (feature.type === "prism") appendVerticalPrismToMesh(chunk.mesh, feature.points, feature.zMin, feature.zMax, feature.roof);
      if (feature.type === "socket") appendSocketCavityToMesh(chunk.mesh, feature.points, feature.zMin, feature.zMax, feature.side);
    }
    chunk.mesh.triangle_count = Math.floor(chunk.mesh.triangles.length / 3);
    chunk.bodyBounds = supportMeshBounds(meshConstructedCells(chunk.cells, []));
  }
}

function meshConstructedCells(cells, openings = []) {
  if (openings.some((opening) => opening.footprint?.points?.length >= 3)) {
    return meshConstructedCellsWithExactSockets(cells, openings);
  }

  const mesh = { vertices: [], triangles: [], triangle_count: 0 };
  const prepared = [];
  const byKey = new Map();

  for (const cell of cells) {
    const socketOpening = constructedCellSocketOpening(cell, openings);
    const bottom = socketOpening ? Math.max(cell.bottom, socketOpening.zMax) : cell.bottom;
    if (cell.top <= bottom + 0.05) continue;
    const preparedCell = { ...cell, bottom, socketOpening };
    prepared.push(preparedCell);
    byKey.set(`${cell.ix}:${cell.iy}`, preparedCell);
  }

  for (const cell of prepared) {
    appendQuadToMesh(mesh, [
      { x: cell.x0, y: cell.y0, z: cell.top },
      { x: cell.x1, y: cell.y0, z: cell.top },
      { x: cell.x1, y: cell.y1, z: cell.top },
      { x: cell.x0, y: cell.y1, z: cell.top },
    ]);
    if (!cell.socketOpening) {
      appendQuadToMesh(mesh, [
        { x: cell.x0, y: cell.y1, z: cell.bottom },
        { x: cell.x1, y: cell.y1, z: cell.bottom },
        { x: cell.x1, y: cell.y0, z: cell.bottom },
        { x: cell.x0, y: cell.y0, z: cell.bottom },
      ]);
    }

    for (const neighbor of [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ]) {
      const adjacent = byKey.get(`${cell.ix + neighbor.dx}:${cell.iy + neighbor.dy}`);
      if (!adjacent) {
        appendConstructedExteriorSideQuad(mesh, neighbor.dx, neighbor.dy, cell, openings, cell.bottom, cell.top);
        continue;
      }
      appendConstructedCellSideQuad(mesh, neighbor.dx, neighbor.dy, cell, adjacent, cell.bottom, Math.min(cell.top, adjacent.bottom));
      appendConstructedCellSideQuad(mesh, neighbor.dx, neighbor.dy, cell, adjacent, Math.max(cell.bottom, adjacent.top), cell.top);
    }
  }

  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return mesh;
}

function meshConstructedCellsWithExactSockets(cells, openings) {
  const mesh = { vertices: [], triangles: [], triangle_count: 0 };

  for (const cell of cells) {
    const opening = constructedCellSocketOpening(cell, openings);
    if (!opening) {
      appendExtrudedPolygonToMesh(mesh, cellRectPolygon(cell), cell.bottom, cell.top);
      continue;
    }

    const rect = cellRectPolygon(cell);
    const socketPolygon = normalizePolygonCcw(opening.footprint.points);
    const clipped = subtractConvexPolygon(rect, socketPolygon);
    for (const piece of clipped.outside) {
      appendExtrudedPolygonToMesh(mesh, piece, cell.bottom, cell.top);
    }

    if (clipped.inside.length >= 3) {
      appendSocketUpperCellToMesh(mesh, clipped.inside, cell, opening);
    }
  }

  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return mesh;
}

function appendSocketUpperCellToMesh(mesh, polygon, cell, opening) {
  const roof = opening.roof ?? roofProfile(opening.side, opening.footprint.points, opening.zMax, 0);
  const minRoof = Math.min(...polygon.map((point) => roofZAtPoint(point, roof)));
  if (cell.top <= minRoof + 0.05) return;
  appendExtrudedPolygonToMesh(mesh, polygon, (point) => Math.min(roofZAtPoint(point, roof), cell.top - 0.05), cell.top);
}

function cellRectPolygon(cell) {
  return [
    { x: cell.x0, y: cell.y0 },
    { x: cell.x1, y: cell.y0 },
    { x: cell.x1, y: cell.y1 },
    { x: cell.x0, y: cell.y1 },
  ];
}

function constructedCellSocketOpening(cell, openings) {
  for (const opening of openings) {
    if (!opening.footprint) continue;
    if (cellIntersectsFootprint(cell, opening.footprint)) {
      return opening;
    }
  }
  return null;
}

function appendConstructedCellSideQuad(mesh, dx, dy, cell, adjacent, z0, z1) {
  if (shouldSkipSocketBoundarySide(cell, adjacent, z0, z1)) return;
  appendCellSideQuad(mesh, dx, dy, cell, z0, z1);
}

function appendConstructedExteriorSideQuad(mesh, dx, dy, cell, openings, z0, z1) {
  if (shouldSkipSocketMouthSide(cell, dx, dy, openings, z0, z1)) return;
  appendCellSideQuad(mesh, dx, dy, cell, z0, z1);
}

function shouldSkipSocketBoundarySide(cell, adjacent, z0, z1) {
  const socketOpening = adjacent?.socketOpening ?? cell?.socketOpening ?? null;
  if (!socketOpening) return false;
  return z0 < socketOpening.zMax - 0.01 && z1 <= socketOpening.zMax + 0.01;
}

function shouldSkipSocketMouthSide(cell, dx, dy, openings, z0, z1) {
  if (z0 < cell.bottom - 0.001) return false;
  for (const opening of openings) {
    if (!opening.footprint || z0 >= opening.zMax - 0.01) continue;
    if (opening.side === "x-min" && dx < 0 && sideSegmentTouchesFootprint(opening.footprint, [
      { x: cell.x0, y: cell.y0 },
      { x: cell.x0, y: cell.y1 },
    ])) return true;
    if (opening.side === "x-max" && dx > 0 && sideSegmentTouchesFootprint(opening.footprint, [
      { x: cell.x1, y: cell.y0 },
      { x: cell.x1, y: cell.y1 },
    ])) return true;
    if (opening.side === "y-min" && dy < 0 && sideSegmentTouchesFootprint(opening.footprint, [
      { x: cell.x0, y: cell.y0 },
      { x: cell.x1, y: cell.y0 },
    ])) return true;
    if (opening.side === "y-max" && dy > 0 && sideSegmentTouchesFootprint(opening.footprint, [
      { x: cell.x0, y: cell.y1 },
      { x: cell.x1, y: cell.y1 },
    ])) return true;
  }
  return false;
}

function appendCellSideQuad(mesh, dx, dy, cell, z0, z1) {
  if (z1 <= z0 + 0.05) return;
  if (dx < 0) {
    appendQuadToMesh(mesh, [
      { x: cell.x0, y: cell.y1, z: z0 },
      { x: cell.x0, y: cell.y0, z: z0 },
      { x: cell.x0, y: cell.y0, z: z1 },
      { x: cell.x0, y: cell.y1, z: z1 },
    ]);
  } else if (dx > 0) {
    appendQuadToMesh(mesh, [
      { x: cell.x1, y: cell.y0, z: z0 },
      { x: cell.x1, y: cell.y1, z: z0 },
      { x: cell.x1, y: cell.y1, z: z1 },
      { x: cell.x1, y: cell.y0, z: z1 },
    ]);
  } else if (dy < 0) {
    appendQuadToMesh(mesh, [
      { x: cell.x0, y: cell.y0, z: z0 },
      { x: cell.x1, y: cell.y0, z: z0 },
      { x: cell.x1, y: cell.y0, z: z1 },
      { x: cell.x0, y: cell.y0, z: z1 },
    ]);
  } else {
    appendQuadToMesh(mesh, [
      { x: cell.x1, y: cell.y1, z: z0 },
      { x: cell.x0, y: cell.y1, z: z0 },
      { x: cell.x0, y: cell.y1, z: z1 },
      { x: cell.x1, y: cell.y1, z: z1 },
    ]);
  }
}

function appendQuadToMesh(mesh, points) {
  const start = mesh.vertices.length / 3;
  for (const point of points) mesh.vertices.push(point.x, point.y, point.z);
  mesh.triangles.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

function appendExtrudedPolygonToMesh(mesh, polygon, bottom, top) {
  const points = normalizePolygonCcw(cleanPolygon(polygon));
  if (points.length < 3) return;
  const bottomAt = typeof bottom === "function" ? bottom : () => bottom;
  const topAt = typeof top === "function" ? top : () => top;
  const bottomZ = points.map((point) => bottomAt(point));
  const topZ = points.map((point) => topAt(point));
  if (Math.max(...topZ) <= Math.min(...bottomZ) + 0.05) return;

  const start = mesh.vertices.length / 3;
  for (let index = 0; index < points.length; index += 1) {
    mesh.vertices.push(points[index].x, points[index].y, bottomZ[index]);
  }
  for (let index = 0; index < points.length; index += 1) {
    mesh.vertices.push(points[index].x, points[index].y, topZ[index]);
  }

  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    mesh.triangles.push(start + index, start + next, start + points.length + next);
    mesh.triangles.push(start + index, start + points.length + next, start + points.length + index);
  }
  for (let index = 1; index + 1 < points.length; index += 1) {
    mesh.triangles.push(start, start + index + 1, start + index);
    mesh.triangles.push(start + points.length, start + points.length + index, start + points.length + index + 1);
  }
}

function subtractConvexPolygon(subject, clip) {
  let inside = normalizePolygonCcw(subject);
  const outside = [];
  const clippingPolygon = normalizePolygonCcw(clip);

  for (let index = 0; index < clippingPolygon.length && inside.length >= 3; index += 1) {
    const a = clippingPolygon[index];
    const b = clippingPolygon[(index + 1) % clippingPolygon.length];
    const split = splitPolygonByHalfPlane(inside, a, b);
    if (split.outside.length >= 3) outside.push(split.outside);
    inside = split.inside;
  }

  return {
    inside: cleanPolygon(inside),
    outside: outside.map(cleanPolygon).filter((piece) => piece.length >= 3),
  };
}

function splitPolygonByHalfPlane(polygon, a, b) {
  const inside = [];
  const outside = [];

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentInside = isInsideHalfPlane(current, a, b);
    const nextInside = isInsideHalfPlane(next, a, b);

    if (currentInside) inside.push(current);
    else outside.push(current);

    if (currentInside !== nextInside) {
      const intersection = lineIntersection2d(current, next, a, b);
      if (intersection) {
        inside.push(intersection);
        outside.push(intersection);
      }
    }
  }

  return {
    inside: cleanPolygon(inside),
    outside: cleanPolygon(outside),
  };
}

function isInsideHalfPlane(point, a, b) {
  return orient2d(a, b, point) >= -0.000001;
}

function lineIntersection2d(a, b, c, d) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const denominator = abx * cdy - aby * cdx;
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denominator;
  return {
    x: a.x + abx * t,
    y: a.y + aby * t,
  };
}

function cleanPolygon(polygon) {
  const cleaned = [];
  for (const point of polygon) {
    const rounded = {
      x: roundedCoordinate(point.x),
      y: roundedCoordinate(point.y),
    };
    const prior = cleaned[cleaned.length - 1];
    if (!prior || Math.hypot(prior.x - rounded.x, prior.y - rounded.y) > 0.00001) cleaned.push(rounded);
  }
  if (cleaned.length > 1) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.00001) cleaned.pop();
  }
  return removeCollinearPoints(cleaned);
}

function removeCollinearPoints(polygon) {
  if (polygon.length < 3) return polygon;
  return polygon.filter((point, index) => {
    const prev = polygon[(index + polygon.length - 1) % polygon.length];
    const next = polygon[(index + 1) % polygon.length];
    return Math.abs(orient2d(prev, point, next)) > 0.000001;
  });
}

function pointInFootprint(point, footprint) {
  if (footprint.points?.length >= 3) return pointInPolygon2d(point, footprint.points);
  return point.x >= footprint.xMin && point.x <= footprint.xMax && point.y >= footprint.yMin && point.y <= footprint.yMax;
}

function cellIntersectsFootprint(cell, footprint) {
  if (!footprint.points?.length) return pointInFootprint(cell.center, footprint);
  if (pointInPolygon2d(cell.center, footprint.points)) return true;

  const corners = [
    { x: cell.x0, y: cell.y0 },
    { x: cell.x1, y: cell.y0 },
    { x: cell.x1, y: cell.y1 },
    { x: cell.x0, y: cell.y1 },
  ];
  if (corners.some((corner) => pointInPolygon2d(corner, footprint.points))) return true;
  if (footprint.points.some((point) => point.x >= cell.x0 && point.x <= cell.x1 && point.y >= cell.y0 && point.y <= cell.y1)) return true;

  for (let index = 0; index < footprint.points.length; index += 1) {
    const a = footprint.points[index];
    const b = footprint.points[(index + 1) % footprint.points.length];
    for (let edge = 0; edge < corners.length; edge += 1) {
      const c = corners[edge];
      const d = corners[(edge + 1) % corners.length];
      if (segmentsIntersect2d(a, b, c, d)) return true;
    }
  }

  return false;
}

function sideSegmentTouchesFootprint(footprint, segment) {
  if (!footprint.points?.length) return false;
  const midpoint = {
    x: (segment[0].x + segment[1].x) / 2,
    y: (segment[0].y + segment[1].y) / 2,
  };
  if (pointInPolygon2d(midpoint, footprint.points)) return true;
  for (let index = 0; index < footprint.points.length; index += 1) {
    const a = footprint.points[index];
    const b = footprint.points[(index + 1) % footprint.points.length];
    if (segmentsIntersect2d(segment[0], segment[1], a, b)) return true;
  }
  return false;
}

function pointInPolygon2d(point, polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const a = polygon[index];
    const b = polygon[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y);
    if (!crosses) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || 1e-9) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

function segmentsIntersect2d(a, b, c, d) {
  const ab1 = orient2d(a, b, c);
  const ab2 = orient2d(a, b, d);
  const cd1 = orient2d(c, d, a);
  const cd2 = orient2d(c, d, b);
  return ab1 * ab2 <= 0 && cd1 * cd2 <= 0;
}

function orient2d(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function updateSplitChunkBounds(chunks, settings) {
  for (const chunk of chunks) {
    chunk.mesh.triangle_count = Math.floor(chunk.mesh.triangles.length / 3);
    chunk.bounds = supportMeshBounds(chunk.mesh);
    chunk.fits = chunk.bounds.size.x <= settings.usableWidth + 0.001 && chunk.bounds.size.y <= settings.usableDepth + 0.001 && chunk.bounds.size.z <= settings.usableHeight + 0.001;
  }
}

function appendBoxToMesh(mesh, min, max) {
  const lo = {
    x: Math.min(min.x, max.x),
    y: Math.min(min.y, max.y),
    z: Math.min(min.z, max.z),
  };
  const hi = {
    x: Math.max(min.x, max.x),
    y: Math.max(min.y, max.y),
    z: Math.max(min.z, max.z),
  };
  if (hi.x - lo.x <= 0.001 || hi.y - lo.y <= 0.001 || hi.z - lo.z <= 0.001) return;
  const start = mesh.vertices.length / 3;
  mesh.vertices.push(
    lo.x, lo.y, lo.z,
    hi.x, lo.y, lo.z,
    hi.x, hi.y, lo.z,
    lo.x, hi.y, lo.z,
    lo.x, lo.y, hi.z,
    hi.x, lo.y, hi.z,
    hi.x, hi.y, hi.z,
    lo.x, hi.y, hi.z
  );
  mesh.triangles.push(
    start, start + 2, start + 1,
    start, start + 3, start + 2,
    start + 4, start + 5, start + 6,
    start + 4, start + 6, start + 7,
    start, start + 1, start + 5,
    start, start + 5, start + 4,
    start + 1, start + 2, start + 6,
    start + 1, start + 6, start + 5,
    start + 2, start + 3, start + 7,
    start + 2, start + 7, start + 6,
    start + 3, start, start + 4,
    start + 3, start + 4, start + 7
  );
}

function appendVerticalPrismToMesh(mesh, points, zMin, zMax, roof = null) {
  if (points.length < 3 || zMax - zMin <= 0.001) return;
  const orderedPoints = normalizePolygonCcw(points);
  appendExtrudedPolygonToMesh(mesh, orderedPoints, zMin, roof ? (point) => roofZAtPoint(point, roof) : zMax);
}

function appendSocketCavityToMesh(mesh, points, zMin, zMax, openSide = null) {
  if (points.length < 3 || zMax - zMin <= 0.001) return;
  const orderedPoints = polygonArea2d(points) > 0 ? [...points].reverse() : points;
  const start = mesh.vertices.length / 3;
  for (const point of orderedPoints) mesh.vertices.push(point.x, point.y, zMin);
  for (const point of orderedPoints) mesh.vertices.push(point.x, point.y, zMax);
  for (let index = 0; index < orderedPoints.length; index += 1) {
    const next = (index + 1) % orderedPoints.length;
    if (isSocketOpenEdge(orderedPoints[index], orderedPoints[next], orderedPoints, openSide)) continue;
    mesh.triangles.push(start + index, start + orderedPoints.length + next, start + next);
    mesh.triangles.push(start + index, start + orderedPoints.length + index, start + orderedPoints.length + next);
  }
  for (let index = 1; index + 1 < orderedPoints.length; index += 1) {
    mesh.triangles.push(start + orderedPoints.length, start + orderedPoints.length + index + 1, start + orderedPoints.length + index);
  }
}

function isSocketOpenEdge(a, b, points, openSide) {
  if (!openSide) return false;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const tolerance = 0.001;
  if (openSide === "x-min") return Math.abs(a.x - minX) <= tolerance && Math.abs(b.x - minX) <= tolerance;
  if (openSide === "x-max") return Math.abs(a.x - maxX) <= tolerance && Math.abs(b.x - maxX) <= tolerance;
  if (openSide === "y-min") return Math.abs(a.y - minY) <= tolerance && Math.abs(b.y - minY) <= tolerance;
  if (openSide === "y-max") return Math.abs(a.y - maxY) <= tolerance && Math.abs(b.y - maxY) <= tolerance;
  return false;
}

function polygonArea2d(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - current.y * next.x;
  }
  return area / 2;
}

function normalizePolygonCcw(points) {
  const cleaned = cleanPolygon(points);
  return polygonArea2d(cleaned) < 0 ? [...cleaned].reverse() : cleaned;
}

function renderSplitChunks(plan) {
  splitGroup.clear();
  for (const [index, chunk] of plan.chunks.entries()) {
    normalizeSupportMeshArrays(chunk.mesh);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(chunk.mesh.vertices, 3));
    geometry.setIndex(new THREE.BufferAttribute(chunk.mesh.triangles, 1));
    const material = new THREE.MeshStandardMaterial({
      color: splitPalette[index % splitPalette.length],
      roughness: 0.76,
      metalness: 0.02,
      transparent: false,
      opacity: 1,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const displayGeometry = geometry.toNonIndexed();
    displayGeometry.computeVertexNormals();
    displayGeometry.computeBoundingBox();
    displayGeometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(displayGeometry, material);
    mesh.name = `${chunk.id} boolean split chunk`;
    mesh.userData = { splitChunkId: chunk.id, splitChunkIndex: index };
    splitGroup.add(mesh);
  }
  updateDebugHandle();
}

function updateDebugHandle() {
  window.__CRADLEMAKER_DEBUG__ = {
    state,
    scene,
    camera,
    renderer,
    splitGroup,
    supportGroup,
    debugPickViewport,
  };
}

function debugPickViewport(x, y) {
  const rect = renderer.domElement.getBoundingClientRect();
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 3;
  raycaster.setFromCamera({
    x: ((x - rect.left) / rect.width) * 2 - 1,
    y: -(((y - rect.top) / rect.height) * 2 - 1),
  }, camera);
  return raycaster.intersectObjects([...splitGroup.children, ...supportGroup.children, bed], true)
    .slice(0, 8)
    .map((hit) => ({
      object: hit.object?.name ?? "",
      type: hit.object?.type ?? "",
      chunk_id: hit.object?.userData?.splitChunkId ?? null,
      distance: roundedCoordinate(hit.distance),
      point: roundedPoint(hit.point),
      face_index: hit.faceIndex ?? null,
      face_normal: hit.face?.normal ? roundedPoint(hit.face.normal) : null,
      material_color: hit.object?.material?.color ? `#${hit.object.material.color.getHexString()}` : null,
    }));
}

function evaluateSplitSliverQa(plan) {
  const samples = [];
  const byChunk = new Map();
  let count = 0;
  let worst = null;

  for (const chunk of plan.chunks ?? []) {
    const mesh = chunk.mesh;
    if (!mesh?.vertices?.length || !mesh?.triangles?.length) continue;

    for (let index = 0; index + 2 < mesh.triangles.length; index += 3) {
      const tri = [
        meshVertex(mesh, mesh.triangles[index]),
        meshVertex(mesh, mesh.triangles[index + 1]),
        meshVertex(mesh, mesh.triangles[index + 2]),
      ];
      const metrics = triangleQualityMetrics(tri[0], tri[1], tri[2]);
      const centroid = triangleCentroid(tri[0], tri[1], tri[2]);
      const nearestConnector = nearestConnectorToPoint(plan.connectors, centroid, chunk.id);
      if (!isSplitSliverTriangle(metrics, nearestConnector)) continue;

      ++count;
      byChunk.set(chunk.id, (byChunk.get(chunk.id) ?? 0) + 1);
      const sample = {
        chunk_id: chunk.id,
        triangle_index: index / 3,
        aspect_ratio: roundedCoordinate(metrics.aspectRatio),
        longest_edge_mm: roundedCoordinate(metrics.longestEdge),
        thickness_mm: roundedCoordinate(metrics.altitude),
        area_mm2: roundedCoordinate(metrics.area),
        centroid: roundedPoint(centroid),
        nearest_connector: nearestConnector?.id ?? null,
        distance_to_connector_mm: nearestConnector ? roundedCoordinate(nearestConnector.distance) : null,
        vertices: tri.map(roundedPoint),
      };

      if (!worst || metrics.aspectRatio > worst.aspect_ratio) worst = sample;
      if (samples.length < 160) samples.push(sample);
    }
  }

  samples.sort((a, b) => b.aspect_ratio - a.aspect_ratio);
  const chunks = [...byChunk.entries()]
    .map(([chunk_id, sliver_count]) => ({ chunk_id, sliver_count }))
    .sort((a, b) => b.sliver_count - a.sliver_count);

  return {
    count,
    threshold_aspect_ratio: SPLIT_SLIVER_ASPECT_RATIO,
    threshold_thickness_mm: SPLIT_SLIVER_MAX_THICKNESS_MM,
    chunks,
    worst,
    samples,
  };
}

function isSplitSliverTriangle(metrics, nearestConnector = null) {
  const longSliver = metrics.aspectRatio >= SPLIT_SLIVER_ASPECT_RATIO &&
    metrics.altitude <= SPLIT_SLIVER_MAX_THICKNESS_MM &&
    metrics.longestEdge >= 1.5 &&
    metrics.area > 1e-6;
  if (longSliver) return true;

  const connectorDistance = nearestConnector?.distance;
  return Number.isFinite(connectorDistance) &&
    connectorDistance <= SPLIT_CONNECTOR_SLIVER_MAX_DISTANCE_MM &&
    metrics.aspectRatio >= SPLIT_SLIVER_ASPECT_RATIO &&
    metrics.altitude <= SPLIT_SLIVER_MAX_THICKNESS_MM &&
    metrics.longestEdge >= SPLIT_CONNECTOR_SLIVER_MIN_EDGE_MM &&
    metrics.area > 1e-9;
}

function pointDistance(a, b) {
  return Math.sqrt(pointDistanceSquared(a, b));
}

function triangleQualityMetrics(a, b, c) {
  const ab = pointDistance(a, b);
  const bc = pointDistance(b, c);
  const ca = pointDistance(c, a);
  const longestEdge = Math.max(ab, bc, ca);
  const area = triangleArea(a, b, c);
  const altitude = longestEdge > 1e-9 ? (2 * area) / longestEdge : 0;
  const aspectRatio = altitude > 1e-9 ? longestEdge / altitude : Infinity;
  return { longestEdge, area, altitude, aspectRatio };
}

function meshVertex(mesh, vertexIndex) {
  const index = vertexIndex * 3;
  return {
    x: mesh.vertices[index],
    y: mesh.vertices[index + 1],
    z: mesh.vertices[index + 2],
  };
}

function triangleArea(a, b, c) {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  return Math.hypot(
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx
  ) * 0.5;
}

function triangleCentroid(a, b, c) {
  return {
    x: (a.x + b.x + c.x) / 3,
    y: (a.y + b.y + c.y) / 3,
    z: (a.z + b.z + c.z) / 3,
  };
}

function nearestConnectorToPoint(connectors, point, chunkId) {
  let nearest = null;
  for (const connector of connectors ?? []) {
    if (connector.male_chunk !== chunkId && connector.female_chunk !== chunkId) continue;
    const bounds = connector.footprint_bounds_mm;
    if (!bounds) continue;
    const dx = point.x < bounds.min.x ? bounds.min.x - point.x : point.x > bounds.max.x ? point.x - bounds.max.x : 0;
    const dy = point.y < bounds.min.y ? bounds.min.y - point.y : point.y > bounds.max.y ? point.y - bounds.max.y : 0;
    const dz = point.z < connector.z_range_mm.min ? connector.z_range_mm.min - point.z : point.z > connector.z_range_mm.max ? point.z - connector.z_range_mm.max : 0;
    const distance = Math.hypot(dx, dy, dz);
    if (!nearest || distance < nearest.distance) nearest = { id: connector.id, distance };
  }
  return nearest;
}

function evaluateDovetailGapSpanQa(plan) {
  const samples = [];
  let count = 0;
  let worst = null;

  const chunkById = new Map((plan.chunks ?? []).map((chunk) => [chunk.id, chunk]));
  for (const connector of plan.connectors ?? []) {
    if (!Number.isFinite(connector.seam_mm)) continue;
    for (const chunkId of [connector.male_chunk, connector.female_chunk]) {
      const chunk = chunkById.get(chunkId);
      if (!chunk?.mesh) continue;

      const mesh = chunk.mesh;
      for (let index = 0; index + 2 < mesh.triangles.length; index += 3) {
        const tri = [
          meshVertex(mesh, mesh.triangles[index]),
          meshVertex(mesh, mesh.triangles[index + 1]),
          meshVertex(mesh, mesh.triangles[index + 2]),
        ];
        for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
          const span = dovetailClearanceBandEdge(connector, chunkId, a, b);
          if (!span) continue;
          ++count;
          const sample = {
            connector_id: connector.id,
            chunk_id: chunkId,
            edge_length_mm: roundedCoordinate(span.length),
            clearance_length_mm: roundedCoordinate(span.clearanceLength),
            seam_cross_mm: roundedCoordinate(span.crossDistance),
            midpoint: roundedPoint(span.midpoint),
            a: roundedPoint(a),
            b: roundedPoint(b),
          };
          if (!worst || span.clearanceLength > worst.clearance_length_mm) worst = sample;
          if (samples.length < 300) samples.push(sample);
        }
      }
    }
  }

  samples.sort((a, b) => b.clearance_length_mm - a.clearance_length_mm);
  return { count, worst, samples };
}

function dovetailClearanceBandEdge(connector, chunkId, a, b) {
  const axis = connector.axis;
  const seam = connector.seam_mm;
  const coordA = axis === "x" ? a.x : a.y;
  const coordB = axis === "x" ? b.x : b.y;
  const sideA = coordA - seam;
  const sideB = coordB - seam;

  const band = edgeClearanceBandSample(connector, a, b);
  if (!band) return null;

  const bounds = connector.footprint_bounds_mm;
  const footprintMargin = Math.max(0.8, connector.clearance_mm * 2);
  const zMargin = Math.max(0.8, connector.clearance_mm * 2);
  if (!bounds ||
    band.point.x < bounds.min.x - footprintMargin || band.point.x > bounds.max.x + footprintMargin ||
    band.point.y < bounds.min.y - footprintMargin || band.point.y > bounds.max.y + footprintMargin ||
    band.point.z < connector.z_range_mm.min - zMargin || band.point.z > connector.z_range_mm.max + zMargin) {
    return null;
  }

  const length = pointDistance(a, b);
  const crossDistance = sideA * sideB < 0 ? Math.abs(sideA) + Math.abs(sideB) : 0;
  const minLength = Math.max(0.16, (connector.clearance_mm ?? 0.3) * 0.45);
  if (length < minLength || band.clearanceLength < minLength) return null;

  return { length, crossDistance, clearanceLength: band.clearanceLength, midpoint: band.point, chunkId };
}

function edgeClearanceBandSample(connector, a, b) {
  const samples = [];
  for (const t of [0.08, 0.16, 0.25, 0.35, 0.5, 0.65, 0.75, 0.84, 0.92]) {
    const point = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    if (pointInDovetailClearanceBand(connector, point)) samples.push({ t, point });
  }
  if (!samples.length) return null;
  const length = pointDistance(a, b);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const representative = samples[Math.floor(samples.length / 2)];
  return {
    point: representative.point,
    clearanceLength: Math.max(length * Math.abs(last.t - first.t), length / 9),
  };
}

function pointInDovetailClearanceBand(connector, point) {
  const socket = connector.socket_footprint_mm ?? [];
  const male = connector.male_visible_footprint_mm ?? connector.male_footprint_mm ?? [];
  if (!pointInConvexPolygon2d(point, socket)) return false;
  if (pointInConvexPolygon2d(point, male)) return false;

  const boundaryTolerance = Math.max(0.05, Math.min(0.2, (connector.clearance_mm ?? 0.3) * 0.3));
  const socketEdgeDistance = distanceToPolygonEdges2d(point, socket);
  const maleEdgeDistance = distanceToPolygonEdges2d(point, male);
  return socketEdgeDistance > boundaryTolerance && maleEdgeDistance > boundaryTolerance;
}

function formatDovetailGapSpanQaStatus(qa) {
  if (!qa || !qa.count) return "Gap QA: no dovetail clearance-band hairs detected.";
  const worst = qa.worst;
  const detail = worst
    ? ` Worst is ${worst.chunk_id} near ${worst.connector_id}: about ${formatStatusNumber(worst.clearance_length_mm ?? worst.edge_length_mm)} mm lies in the empty connector clearance band.`
    : "";
  return `Gap QA warning: ${qa.count.toLocaleString()} dovetail clearance-band edge${qa.count === 1 ? "" : "s"} detected.${detail}`;
}

function formatDimensions(size) {
  return `${formatStatusNumber(size.x)} x ${formatStatusNumber(size.y)} x ${formatStatusNumber(size.z)} mm`;
}

function formatSplitQaStatus(qa) {
  if (!qa) return "Split QA was not run.";
  if (qa.intersects_model) {
    return `Split QA warning: ${qa.intersection_samples.toLocaleString()} / ${qa.sampled_points.toLocaleString()} sampled split points appear inside the model, max approximate penetration ${formatStatusNumber(qa.max_penetration_mm)} mm. Affected chunks: ${qa.affected_chunks.join(", ")}.`;
  }
  return `Split QA: no model intersections detected across ${qa.sampled_points.toLocaleString()} sampled split points.`;
}

function splitChunkModelQa(chunks) {
  const qaCellSize = Math.max(...(chunks ?? []).map((chunk) => Number(chunk.mesh?.cell_size_mm) || 0), 0);
  return meshModelIntersectionQa(chunks, {
    maxSamples: 7000,
    surfaceTolerance: Math.max(0.12, qaCellSize * 1.05),
  });
}

function meshModelIntersectionQa(chunks, options = {}) {
  if (!state.modelMesh || !chunks?.length) {
    return {
      intersects_model: false,
      sampled_points: 0,
      intersection_samples: 0,
      max_penetration_mm: 0,
      affected_chunks: [],
    };
  }

  const modelIndex = modelQaIndex(options);
  const samples = splitChunkQaSamples(chunks, options.maxSamples ?? 7000);
  const affected = new Set();
  let intersectionSamples = 0;
  let maxPenetration = 0;
  const surfaceTolerance = Number(options.surfaceTolerance ?? 0.12);

  for (const sample of samples) {
    if (!pointInsideModel(sample, modelIndex)) continue;
    const distance = closestModelDistance(sample, modelIndex, surfaceTolerance);
    if (distance <= surfaceTolerance) continue;
    intersectionSamples += 1;
    maxPenetration = Math.max(maxPenetration, distance);
    affected.add(sample.chunkId);
  }

  return {
    intersects_model: intersectionSamples > 0,
    sampled_points: samples.length,
    intersection_samples: intersectionSamples,
    max_penetration_mm: roundedCoordinate(maxPenetration),
    affected_chunks: [...affected].sort(),
  };
}

function modelQaIndex(options = {}) {
  const triangles = modelTrianglesForQa();
  const cache = state.modelQaCache;
  const surfaceTolerance = Number(options.surfaceTolerance ?? 0.12);
  const key = `${roundedCoordinate(surfaceTolerance)}`;
  if (cache?.indexes?.has(key)) {
    return cache.indexes.get(key);
  }
  const index = buildModelQaIndex(triangles, options);
  if (cache?.indexes) {
    cache.indexes.set(key, index);
  }
  return index;
}

function buildModelQaIndex(triangles, options = {}) {
  const bounds = {
    min: { y: Infinity, z: Infinity },
    max: { y: -Infinity, z: -Infinity },
  };
  const indexed = [];
  for (const triangle of triangles) {
    const minY = Math.min(triangle.a.y, triangle.b.y, triangle.c.y);
    const maxY = Math.max(triangle.a.y, triangle.b.y, triangle.c.y);
    const minZ = Math.min(triangle.a.z, triangle.b.z, triangle.c.z);
    const maxZ = Math.max(triangle.a.z, triangle.b.z, triangle.c.z);
    bounds.min.y = Math.min(bounds.min.y, minY);
    bounds.min.z = Math.min(bounds.min.z, minZ);
    bounds.max.y = Math.max(bounds.max.y, maxY);
    bounds.max.z = Math.max(bounds.max.z, maxZ);
    indexed.push({ ...triangle, minY, maxY, minZ, maxZ });
  }

  const spanY = Math.max(1, bounds.max.y - bounds.min.y);
  const spanZ = Math.max(1, bounds.max.z - bounds.min.z);
  const surfaceTolerance = Number(options.surfaceTolerance ?? 0.12);
  const binSize = Math.max(1.5, surfaceTolerance * 8, Math.min(spanY, spanZ) / 96);
  const binCoordY = (value) => Math.floor((value - bounds.min.y) / binSize);
  const binCoordZ = (value) => Math.floor((value - bounds.min.z) / binSize);
  const binKey = (iy, iz) => `${iy}:${iz}`;
  const bins = new Map();
  const largeTriangles = [];

  for (const triangle of indexed) {
    const minIy = binCoordY(triangle.minY);
    const maxIy = binCoordY(triangle.maxY);
    const minIz = binCoordZ(triangle.minZ);
    const maxIz = binCoordZ(triangle.maxZ);
    const binCount = (maxIy - minIy + 1) * (maxIz - minIz + 1);
    if (binCount > 96) {
      largeTriangles.push(triangle);
      continue;
    }
    for (let iz = minIz; iz <= maxIz; iz += 1) {
      for (let iy = minIy; iy <= maxIy; iy += 1) {
        const key = binKey(iy, iz);
        const bucket = bins.get(key);
        if (bucket) bucket.push(triangle);
        else bins.set(key, [triangle]);
      }
    }
  }

  return { triangles: indexed, bins, largeTriangles, bounds, binSize, binCoordY, binCoordZ, binKey };
}

function modelQaCandidatesAtYZ(point, modelIndex, radiusBins = 0) {
  const iy = modelIndex.binCoordY(point.y);
  const iz = modelIndex.binCoordZ(point.z);
  const seen = new Set();
  const candidates = [];
  for (let dz = -radiusBins; dz <= radiusBins; dz += 1) {
    for (let dy = -radiusBins; dy <= radiusBins; dy += 1) {
      const bucket = modelIndex.bins.get(modelIndex.binKey(iy + dy, iz + dz));
      if (!bucket) continue;
      for (const triangle of bucket) {
        if (seen.has(triangle)) continue;
        seen.add(triangle);
        candidates.push(triangle);
      }
    }
  }
  for (const triangle of modelIndex.largeTriangles) {
    if (seen.has(triangle)) continue;
    seen.add(triangle);
    candidates.push(triangle);
  }
  return candidates;
}

function modelTrianglesForQa() {
  const payload = buildMeshPayload();
  if (state.modelQaCache?.payload === payload) {
    return state.modelQaCache.triangles;
  }

  const vertices = payload.vertices ?? [];
  const triangles = [];
  for (let index = 0; index + 8 < vertices.length; index += 9) {
    const a = { x: vertices[index], y: vertices[index + 1], z: vertices[index + 2] };
    const b = { x: vertices[index + 3], y: vertices[index + 4], z: vertices[index + 5] };
    const c = { x: vertices[index + 6], y: vertices[index + 7], z: vertices[index + 8] };
    triangles.push({ a, b, c });
  }
  state.modelQaCache = { payload, triangles, indexes: new Map() };
  return triangles;
}

function splitChunkQaSamples(chunks, maxSamples) {
  const triangleCounts = (chunks ?? []).map((chunk) => Math.floor((chunk.mesh?.triangles?.length ?? 0) / 3));
  const totalCandidates = triangleCounts.reduce((sum, triangleCount) => sum + triangleCount * 4, 0);
  if (!totalCandidates || maxSamples <= 0) return [];

  const collectAll = totalCandidates <= maxSamples;
  const selectedCandidateIndexes = collectAll ? null : new Set();
  if (!collectAll) {
    const step = totalCandidates / maxSamples;
    for (let index = 0; index < maxSamples; index += 1) {
      selectedCandidateIndexes.add(Math.floor(index * step));
    }
  }

  const samples = [];
  let candidateIndex = 0;
  for (const chunk of chunks) {
    const vertices = chunk.mesh?.vertices ?? [];
    const triangles = chunk.mesh?.triangles ?? [];
    for (let index = 0; index + 2 < triangles.length; index += 3) {
      const baseCandidateIndex = candidateIndex;
      candidateIndex += 4;
      if (!collectAll &&
        !selectedCandidateIndexes.has(baseCandidateIndex) &&
        !selectedCandidateIndexes.has(baseCandidateIndex + 1) &&
        !selectedCandidateIndexes.has(baseCandidateIndex + 2) &&
        !selectedCandidateIndexes.has(baseCandidateIndex + 3)) {
        continue;
      }

      const a = readSupportVertex(vertices, triangles[index]);
      const b = readSupportVertex(vertices, triangles[index + 1]);
      const c = readSupportVertex(vertices, triangles[index + 2]);
      if (collectAll || selectedCandidateIndexes.has(baseCandidateIndex)) {
        samples.push({ ...a, chunkId: chunk.id });
      }
      if (collectAll || selectedCandidateIndexes.has(baseCandidateIndex + 1)) {
        samples.push({ ...b, chunkId: chunk.id });
      }
      if (collectAll || selectedCandidateIndexes.has(baseCandidateIndex + 2)) {
        samples.push({ ...c, chunkId: chunk.id });
      }
      if (collectAll || selectedCandidateIndexes.has(baseCandidateIndex + 3)) {
        samples.push({
          x: (a.x + b.x + c.x) / 3,
          y: (a.y + b.y + c.y) / 3,
          z: (a.z + b.z + c.z) / 3,
          chunkId: chunk.id,
        });
      }
    }
  }

  return samples;
}

function pointInsideModel(point, modelIndex) {
  const hits = [];
  const candidates = modelQaCandidatesAtYZ(point, modelIndex, 0);
  for (const triangle of candidates) {
    if (point.y < triangle.minY - 1e-7 || point.y > triangle.maxY + 1e-7 ||
      point.z < triangle.minZ - 1e-7 || point.z > triangle.maxZ + 1e-7) {
      continue;
    }
    const t = rayTriangleIntersectionX(point, triangle.a, triangle.b, triangle.c);
    if (Number.isFinite(t) && t > 0.000001) hits.push(roundedCoordinate(t));
  }
  hits.sort((a, b) => a - b);
  let uniqueHits = 0;
  let prior = -Infinity;
  for (const hit of hits) {
    if (Math.abs(hit - prior) <= 0.0001) continue;
    uniqueHits += 1;
    prior = hit;
  }
  return uniqueHits % 2 === 1;
}

function rayTriangleIntersectionX(origin, a, b, c) {
  const edge1 = subtractPoint(b, a);
  const edge2 = subtractPoint(c, a);
  const h = { x: 0, y: -edge2.z, z: edge2.y };
  const determinant = dotPoint(edge1, h);
  if (Math.abs(determinant) < 1e-9) return NaN;
  const f = 1 / determinant;
  const s = subtractPoint(origin, a);
  const u = f * dotPoint(s, h);
  if (u < -0.000001 || u > 1.000001) return NaN;
  const q = crossPoint(s, edge1);
  const v = f * q.x;
  if (v < -0.000001 || u + v > 1.000001) return NaN;
  const t = f * dotPoint(edge2, q);
  return t > 0.000001 ? t : NaN;
}

function closestModelDistance(point, modelIndex, surfaceTolerance = 0.12) {
  let minSquared = Infinity;
  const toleranceSquared = surfaceTolerance * surfaceTolerance;
  const maxRadiusBins = Math.max(1, Math.min(8, Math.ceil((surfaceTolerance * 6) / modelIndex.binSize)));
  for (let radiusBins = 0; radiusBins <= maxRadiusBins; radiusBins += 1) {
    const candidates = modelQaCandidatesAtYZ(point, modelIndex, radiusBins);
    for (const triangle of candidates) {
      minSquared = Math.min(minSquared, pointTriangleDistanceSquared(point, triangle.a, triangle.b, triangle.c));
    }
    if (minSquared <= toleranceSquared) break;
    if (candidates.length && radiusBins >= 2) break;
  }
  return Number.isFinite(minSquared) ? Math.sqrt(minSquared) : surfaceTolerance * 2;
}

function pointTriangleDistanceSquared(point, a, b, c) {
  const ab = subtractPoint(b, a);
  const ac = subtractPoint(c, a);
  const ap = subtractPoint(point, a);
  const d1 = dotPoint(ab, ap);
  const d2 = dotPoint(ac, ap);
  if (d1 <= 0 && d2 <= 0) return pointDistanceSquared(point, a);

  const bp = subtractPoint(point, b);
  const d3 = dotPoint(ab, bp);
  const d4 = dotPoint(ac, bp);
  if (d3 >= 0 && d4 <= d3) return pointDistanceSquared(point, b);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return pointDistanceSquared(point, addScaledPoint(a, ab, v));
  }

  const cp = subtractPoint(point, c);
  const d5 = dotPoint(ab, cp);
  const d6 = dotPoint(ac, cp);
  if (d6 >= 0 && d5 <= d6) return pointDistanceSquared(point, c);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return pointDistanceSquared(point, addScaledPoint(a, ac, w));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const bc = subtractPoint(c, b);
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return pointDistanceSquared(point, addScaledPoint(b, bc, w));
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return pointDistanceSquared(point, {
    x: a.x + ab.x * v + ac.x * w,
    y: a.y + ab.y * v + ac.y * w,
    z: a.z + ab.z * v + ac.z * w,
  });
}

function subtractPoint(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function addScaledPoint(origin, direction, scale) {
  return {
    x: origin.x + direction.x * scale,
    y: origin.y + direction.y * scale,
    z: origin.z + direction.z * scale,
  };
}

function dotPoint(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossPoint(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function pointDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

async function generateCncFoamPreview() {
  if (!state.modelMesh) return;

  setCncStatus("Sampling model for CNC foam relief...", "working");
  clearGeneratedSupport();
  clearCncPreview({ keepStatus: true });
  setCncQaDashboard([
    { label: "CNC", value: "Sampling", detail: "Reading model envelope", state: "working" },
    { label: "Reach", value: "--", detail: "Waiting", state: "idle" },
    { label: "Block", value: "--", detail: "Waiting", state: "idle" },
    { label: "Export", value: "--", detail: "Waiting", state: "idle" },
  ]);
  await nextFrame();

  const settings = cncSettings();
  const result = await buildCncFoamRelief(settings, async (message) => {
    setCncStatus(message, "working");
    await nextFrame();
  });
  renderCncFoamPreview(result);
  updateCncQaDashboard(result.qa);
  const qa = result.qa;
  const stateName = !qa.block_fits
    ? "error"
    : qa.unreachable_cells || qa.selected_tool_miss_cells
      ? "caution"
      : "ok";
  setCncStatus(
    `CNC foam relief ready: ${result.mesh.triangle_count.toLocaleString()} export triangles, ${formatStatusNumber(qa.reached_percent)}% selected-tool clearance, ${qa.unreachable_cells.toLocaleString()} cells too deep for stickout, ${qa.selected_tool_miss_cells.toLocaleString()} cells likely need a smaller finishing tool. Export remains the desired VCarve relief target.`,
    stateName
  );
  updateButtons();
}

function cncSettings() {
  const width = positiveNumber(controlsEl.cncBlockWidth?.value, 300);
  const depth = positiveNumber(controlsEl.cncBlockDepth?.value, 300);
  const height = positiveNumber(controlsEl.cncBlockHeight?.value, 76.2);
  const requestedResolution = Math.max(0.2, positiveNumber(controlsEl.cncResolution?.value, 0.5));
  const maxResolutionByCells = Math.sqrt((width * depth) / CNC_MAX_GRID_CELLS);
  const resolution = Math.max(requestedResolution, maxResolutionByCells);
  const toolStickoutMm = inchesToMm(controlsEl.cncToolStickoutIn?.value || 1);
  const bitDiameterMm = Math.max(0.5, inchesToMm(controlsEl.cncBitDiameterIn?.value || 0.25));
  const toolEnd = controlsEl.cncToolEnd?.value === "ball" ? "ball" : "flat";
  const clearanceMm = Math.max(0, positiveNumber(controlsEl.cncClearance?.value, 1));
  const autoLiftEnabled = controlsEl.cncAutoLift?.checked !== false;
  const modelLiftMm = Math.max(0, positiveNumber(controlsEl.cncModelLift?.value, 0));
  const allowedDepthMm = Math.max(0, Math.min(toolStickoutMm - CNC_TOOL_SAFETY_MARGIN_MM, height - CNC_MIN_FLOOR_THICKNESS_MM));

  return {
    width,
    depth,
    height,
    resolution,
    requestedResolution,
    toolStickoutMm,
    bitDiameterMm,
    bitRadiusMm: bitDiameterMm / 2,
    toolEnd,
    clearanceMm,
    autoLiftEnabled,
    modelLiftMm,
    modelPlacementOffsetMm: modelLiftMm,
    allowedDepthMm,
    minFloorMm: CNC_MIN_FLOOR_THICKNESS_MM,
  };
}

function estimateCncReferenceZ(settings) {
  const meshPayload = buildMeshPayload();
  const resolution = Math.max(settings.resolution, 3);
  const nx = Math.max(2, Math.ceil(settings.width / resolution));
  const ny = Math.max(2, Math.ceil(settings.depth / resolution));
  const dx = settings.width / nx;
  const dy = settings.depth / ny;
  const xMin = -settings.width / 2;
  const yMin = -settings.depth / 2;
  const undersideZ = new Float64Array(nx * ny);
  undersideZ.fill(Infinity);
  const vertices = meshPayload.vertices;
  const triangleCount = Math.floor(vertices.length / 9);

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const offset = triangleIndex * 9;
    const a = { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
    const b = { x: vertices[offset + 3], y: vertices[offset + 4], z: vertices[offset + 5] };
    const c = { x: vertices[offset + 6], y: vertices[offset + 7], z: vertices[offset + 8] };
    rasterizeTriangleUnderside(a, b, c, undersideZ, nx, ny, xMin, yMin, dx, dy);
  }

  let referenceZ = -Infinity;
  for (const z of undersideZ) {
    if (Number.isFinite(z)) referenceZ = Math.max(referenceZ, z);
  }
  if (Number.isFinite(referenceZ)) return referenceZ;
  const box = new THREE.Box3().setFromObject(state.modelMesh);
  return box.min.z;
}

async function buildCncFoamRelief(settings, report = null) {
  applyCncModelPlacement(settings);
  const meshPayload = buildMeshPayload();
  const nx = Math.max(2, Math.ceil(settings.width / settings.resolution));
  const ny = Math.max(2, Math.ceil(settings.depth / settings.resolution));
  const dx = settings.width / nx;
  const dy = settings.depth / ny;
  const xMin = -settings.width / 2;
  const yMin = -settings.depth / 2;
  const cellCount = nx * ny;
  const undersideZ = new Float64Array(cellCount);
  undersideZ.fill(Infinity);

  const vertices = meshPayload.vertices;
  const triangleCount = Math.floor(vertices.length / 9);
  const progressStride = Math.max(1, Math.floor(triangleCount / 24));
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const offset = triangleIndex * 9;
    const a = { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
    const b = { x: vertices[offset + 3], y: vertices[offset + 4], z: vertices[offset + 5] };
    const c = { x: vertices[offset + 6], y: vertices[offset + 7], z: vertices[offset + 8] };
    rasterizeTriangleUnderside(a, b, c, undersideZ, nx, ny, xMin, yMin, dx, dy);
    if (report && triangleIndex % progressStride === 0) {
      await report(`Sampling CNC relief triangle ${triangleIndex.toLocaleString()} of ${triangleCount.toLocaleString()}...`);
    }
  }

  const enclosedVoidCells = fillEnclosedCncFootprintVoids(undersideZ, nx, ny);

  let referenceZ = -Infinity;
  let footprintCells = 0;
  for (const z of undersideZ) {
    if (!Number.isFinite(z)) continue;
    referenceZ = Math.max(referenceZ, z);
    footprintCells += 1;
  }
  if (!footprintCells) throw new Error("No model footprint intersects the foam block. Increase block size or recenter the model.");

  const rawDepth = new Float64Array(cellCount);
  const reachableDepth = new Float64Array(cellCount);
  let maxRequiredDepth = 0;
  for (let index = 0; index < cellCount; index += 1) {
    if (!Number.isFinite(undersideZ[index])) continue;
    const required = Math.max(0, referenceZ - undersideZ[index] + settings.clearanceMm);
    rawDepth[index] = required;
    maxRequiredDepth = Math.max(maxRequiredDepth, required);
  }

  const effectivePlacementOffsetMm = settings.autoLiftEnabled
    ? maxRequiredDepth - settings.allowedDepthMm
    : settings.modelLiftMm;
  settings.modelPlacementOffsetMm = Math.round(effectivePlacementOffsetMm * 2) / 2;
  settings.modelLiftMm = Math.max(0, settings.modelPlacementOffsetMm);
  if (settings.autoLiftEnabled && controlsEl.cncModelLift) {
    controlsEl.cncModelLift.value = String(settings.modelLiftMm);
    updateOutputs();
    if (outputs.cncModelLift) {
      outputs.cncModelLift.textContent = `${formatStatusNumber(settings.modelPlacementOffsetMm)} mm auto offset`;
    }
  }
  applyCncModelPlacement(settings);

  let depthReachableCells = 0;
  let unreachableCells = 0;
  let liftedOutCells = 0;
  for (let index = 0; index < cellCount; index += 1) {
    if (!Number.isFinite(undersideZ[index])) continue;
    const adjusted = rawDepth[index] - settings.modelPlacementOffsetMm;
    if (adjusted > settings.allowedDepthMm) {
      unreachableCells += 1;
      continue;
    }
    if (adjusted <= 0) {
      liftedOutCells += 1;
      continue;
    }
    reachableDepth[index] = adjusted;
    depthReachableCells += 1;
  }

  if (report) await report("Preparing CNC relief surface...");
  const reliefPrep = prepareCncReliefDepth(reachableDepth, nx, ny, dx, dy, settings);
  const finalDepth = reliefPrep.depth;
  if (report) await report("Simulating selected CNC cutter against relief...");
  const toolSimulation = simulateSelectedCncTool(finalDepth, nx, ny, dx, dy, settings);
  let maxCarvedDepth = 0;
  let selectedToolMissCells = 0;
  let toolReachedCells = 0;
  let intersectionCells = 0;
  let maxIntersectionMm = 0;
  let maxSelectedToolMissMm = 0;
  const intersection = new Uint8Array(cellCount);
  const intersectionToleranceMm = Math.max(0.05, Math.min(dx, dy) * 0.5);
  for (let index = 0; index < cellCount; index += 1) {
    const carvedDepth = finalDepth[index];
    maxCarvedDepth = Math.max(maxCarvedDepth, carvedDepth);
    if (carvedDepth <= 0.001) continue;
    const selectedToolShortfall = carvedDepth - toolSimulation.depth[index];
    if (selectedToolShortfall > intersectionToleranceMm) {
      intersection[index] = 1;
      intersectionCells += 1;
      selectedToolMissCells += 1;
      maxIntersectionMm = Math.max(maxIntersectionMm, selectedToolShortfall);
      maxSelectedToolMissMm = Math.max(maxSelectedToolMissMm, selectedToolShortfall);
    } else {
      toolReachedCells += 1;
    }
  }

  if (report) await report("Building watertight CNC foam STL mesh...");
  const unreachable = new Uint8Array(cellCount);
  for (let index = 0; index < cellCount; index += 1) {
    if (!Number.isFinite(undersideZ[index])) continue;
    if (rawDepth[index] - settings.modelPlacementOffsetMm > settings.allowedDepthMm) unreachable[index] = 1;
  }

  const foamMesh = buildCncFoamBlockMesh(finalDepth, nx, ny, xMin, yMin, dx, dy, settings.height);
  const unreachableMesh = buildCncUnreachableOverlay(unreachable, nx, ny, xMin, yMin, dx, dy, settings.height + 0.35);
  const intersectionMesh = buildCncSurfaceOverlay(intersection, finalDepth, nx, ny, xMin, yMin, dx, dy, settings.height, 0.35, 3);
  const modelBounds = new THREE.Box3().setFromObject(state.modelMesh);
  const modelSize = modelBounds.getSize(new THREE.Vector3());
  const blockFits = modelSize.x + settings.clearanceMm * 2 <= settings.width && modelSize.y + settings.clearanceMm * 2 <= settings.depth;
  const qa = {
    footprint_cells: footprintCells,
    reached_cells: toolReachedCells,
    depth_reachable_cells: depthReachableCells,
    unreachable_cells: unreachableCells,
    lifted_out_cells: liftedOutCells,
    reached_percent: depthReachableCells ? (toolReachedCells / depthReachableCells) * 100 : 0,
    max_required_depth_mm: maxRequiredDepth,
    max_carved_depth_mm: maxCarvedDepth,
    reference_z_mm: referenceZ,
    model_lift_mm: settings.modelLiftMm,
    model_placement_offset_mm: settings.modelPlacementOffsetMm,
    auto_lift_enabled: settings.autoLiftEnabled,
    allowed_depth_mm: settings.allowedDepthMm,
    min_floor_mm: settings.height - maxCarvedDepth,
    block_fits: blockFits,
    tool_limited_cells: selectedToolMissCells,
    bit_limited_cells: selectedToolMissCells,
    detail_softened_cells: 0,
    selected_tool_miss_cells: selectedToolMissCells,
    max_selected_tool_miss_mm: maxSelectedToolMissMm,
    max_tool_overcut_mm: 0,
    max_detail_extra_clearance_mm: 0,
    relief_smoothing_passes: reliefPrep.smoothingPasses,
    tool_simulation_stride: toolSimulation.stride,
    tool_simulation_resolution_mm: toolSimulation.resolution,
    intersection_cells: intersectionCells,
    max_intersection_mm: maxIntersectionMm,
    intersection_tolerance_mm: intersectionToleranceMm,
    enclosed_void_cells: enclosedVoidCells,
    tool_end: settings.toolEnd,
    grid: { nx, ny, dx, dy, resolution: settings.resolution },
    settings,
  };

  return { mesh: foamMesh, unreachableMesh, intersectionMesh, qa };
}

function fillEnclosedCncFootprintVoids(undersideZ, nx, ny) {
  const visited = new Uint8Array(undersideZ.length);
  const queue = [];
  let filledCells = 0;
  const neighborOffsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];

  for (let start = 0; start < undersideZ.length; start += 1) {
    if (visited[start] || Number.isFinite(undersideZ[start])) continue;
    visited[start] = 1;
    queue.length = 0;
    queue.push(start);
    const component = [start];
    const boundaryDepths = [];
    let touchesExterior = false;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const ix = index % nx;
      const iy = Math.floor(index / nx);
      if (ix === 0 || iy === 0 || ix === nx - 1 || iy === ny - 1) touchesExterior = true;

      for (const offset of neighborOffsets) {
        const sx = ix + offset.x;
        const sy = iy + offset.y;
        if (sx < 0 || sx >= nx || sy < 0 || sy >= ny) {
          touchesExterior = true;
          continue;
        }
        const neighborIndex = sy * nx + sx;
        if (Number.isFinite(undersideZ[neighborIndex])) {
          boundaryDepths.push(undersideZ[neighborIndex]);
          continue;
        }
        if (visited[neighborIndex]) continue;
        visited[neighborIndex] = 1;
        queue.push(neighborIndex);
        component.push(neighborIndex);
      }
    }

    if (touchesExterior || !boundaryDepths.length) continue;
    const fillZ = Math.min(...boundaryDepths);
    for (const index of component) {
      undersideZ[index] = fillZ;
    }
    filledCells += component.length;
  }

  return filledCells;
}

function rasterizeTriangleUnderside(a, b, c, undersideZ, nx, ny, xMin, yMin, dx, dy) {
  const minX = Math.min(a.x, b.x, c.x);
  const maxX = Math.max(a.x, b.x, c.x);
  const minY = Math.min(a.y, b.y, c.y);
  const maxY = Math.max(a.y, b.y, c.y);
  const ix0 = clampIndex(Math.floor((minX - xMin) / dx), nx);
  const ix1 = clampIndex(Math.floor((maxX - xMin) / dx), nx);
  const iy0 = clampIndex(Math.floor((minY - yMin) / dy), ny);
  const iy1 = clampIndex(Math.floor((maxY - yMin) / dy), ny);
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-9) return;

  for (let iy = iy0; iy <= iy1; iy += 1) {
    const y = yMin + (iy + 0.5) * dy;
    for (let ix = ix0; ix <= ix1; ix += 1) {
      const x = xMin + (ix + 0.5) * dx;
      const wA = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
      const wB = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
      const wC = 1 - wA - wB;
      if (wA < -0.000001 || wB < -0.000001 || wC < -0.000001) continue;
      const z = a.z * wA + b.z * wB + c.z * wC;
      const index = iy * nx + ix;
      if (z < undersideZ[index]) undersideZ[index] = z;
    }
  }
}

function prepareCncReliefDepth(targetDepth, nx, ny, dx, dy, settings) {
  return { depth: new Float64Array(targetDepth), smoothingPasses: 0 };
}

function simulateSelectedCncTool(desiredDepth, nx, ny, dx, dy, settings) {
  const baseCellSize = Math.min(dx, dy);
  const targetSimResolution = Math.max(baseCellSize, settings.bitRadiusMm / 8);
  const stride = Math.max(1, Math.min(10, Math.round(targetSimResolution / baseCellSize)));
  const sxCount = Math.ceil(nx / stride);
  const syCount = Math.ceil(ny / stride);
  const sxSize = dx * stride;
  const sySize = dy * stride;
  const simDesired = new Float64Array(sxCount * syCount);

  for (let iy = 0; iy < ny; iy += 1) {
    const sy = Math.floor(iy / stride);
    for (let ix = 0; ix < nx; ix += 1) {
      const depth = desiredDepth[iy * nx + ix];
      if (depth <= 0) continue;
      const sx = Math.floor(ix / stride);
      const simIndex = sy * sxCount + sx;
      if (depth > simDesired[simIndex]) simDesired[simIndex] = depth;
    }
  }

  const simMachined = simulateToolOnDepthMap(simDesired, sxCount, syCount, sxSize, sySize, settings);
  const output = new Float64Array(desiredDepth.length);
  for (let iy = 0; iy < ny; iy += 1) {
    const sy = Math.min(syCount - 1, Math.floor(iy / stride));
    for (let ix = 0; ix < nx; ix += 1) {
      const sx = Math.min(sxCount - 1, Math.floor(ix / stride));
      output[iy * nx + ix] = simMachined[sy * sxCount + sx];
    }
  }

  return { depth: output, stride, resolution: Math.max(sxSize, sySize) };
}

function simulateToolOnDepthMap(desiredDepth, nx, ny, dx, dy, settings) {
  const output = new Float64Array(desiredDepth.length);
  const kernel = buildCncToolKernel(settings.bitRadiusMm, dx, dy, settings.toolEnd);

  for (let cy = 0; cy < ny; cy += 1) {
    for (let cx = 0; cx < nx; cx += 1) {
      let tipDepth = settings.allowedDepthMm;
      for (const sample of kernel) {
        const sx = cx + sample.ox;
        const sy = cy + sample.oy;
        const desired = sx < 0 || sx >= nx || sy < 0 || sy >= ny
          ? 0
          : desiredDepth[sy * nx + sx];
        tipDepth = Math.min(tipDepth, desired + sample.sag);
      }
      if (tipDepth <= 0) continue;
      for (const sample of kernel) {
        const sx = cx + sample.ox;
        const sy = cy + sample.oy;
        if (sx < 0 || sx >= nx || sy < 0 || sy >= ny) continue;
        const sampleIndex = sy * nx + sx;
        const carvedDepth = Math.max(0, Math.min(desiredDepth[sampleIndex], tipDepth - sample.sag));
        if (carvedDepth > output[sampleIndex]) output[sampleIndex] = carvedDepth;
      }
    }
  }

  return output;
}

function buildCncToolKernel(radiusMm, dx, dy, toolEnd) {
  const effectiveRadius = Math.max(0.001, radiusMm);
  const rx = Math.max(0, Math.ceil(effectiveRadius / dx));
  const ry = Math.max(0, Math.ceil(effectiveRadius / dy));
  const radiusSquared = effectiveRadius * effectiveRadius;
  const kernel = [];
  for (let oy = -ry; oy <= ry; oy += 1) {
    for (let ox = -rx; ox <= rx; ox += 1) {
      const distSquared = (ox * dx) * (ox * dx) + (oy * dy) * (oy * dy);
      if (distSquared > radiusSquared + 1e-9) continue;
      const sag = toolEnd === "ball"
        ? effectiveRadius - Math.sqrt(Math.max(0, radiusSquared - distSquared))
        : 0;
      kernel.push({ ox, oy, sag });
    }
  }
  if (!kernel.some((sample) => sample.ox === 0 && sample.oy === 0)) {
    kernel.push({ ox: 0, oy: 0, sag: 0 });
  }
  return kernel;
}

function buildCncFoamBlockMesh(depths, nx, ny, xMin, yMin, dx, dy, blockHeight) {
  const mesh = { vertices: [], triangles: [], triangle_count: 0 };
  const topIndex = [];
  const bottomIndex = [];
  const vertexDepth = (ix, iy) => {
    let depth = 0;
    for (let oy = -1; oy <= 0; oy += 1) {
      const cy = iy + oy;
      if (cy < 0 || cy >= ny) continue;
      for (let ox = -1; ox <= 0; ox += 1) {
        const cx = ix + ox;
        if (cx < 0 || cx >= nx) continue;
        depth = Math.max(depth, depths[cy * nx + cx]);
      }
    }
    return depth;
  };

  for (let iy = 0; iy <= ny; iy += 1) {
    for (let ix = 0; ix <= nx; ix += 1) {
      const x = xMin + ix * dx;
      const y = yMin + iy * dy;
      topIndex.push(pushMeshVertex(mesh, x, y, blockHeight - vertexDepth(ix, iy)));
      bottomIndex.push(pushMeshVertex(mesh, x, y, 0));
    }
  }

  const row = nx + 1;
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const a = topIndex[iy * row + ix];
      const b = topIndex[iy * row + ix + 1];
      const c = topIndex[(iy + 1) * row + ix + 1];
      const d = topIndex[(iy + 1) * row + ix];
      pushMeshTriangle(mesh, a, b, c);
      pushMeshTriangle(mesh, a, c, d);
      const ba = bottomIndex[iy * row + ix];
      const bb = bottomIndex[iy * row + ix + 1];
      const bc = bottomIndex[(iy + 1) * row + ix + 1];
      const bd = bottomIndex[(iy + 1) * row + ix];
      pushMeshTriangle(mesh, ba, bc, bb);
      pushMeshTriangle(mesh, ba, bd, bc);
    }
  }

  for (let ix = 0; ix < nx; ix += 1) {
    appendSideQuad(mesh, topIndex[ix], topIndex[ix + 1], bottomIndex[ix + 1], bottomIndex[ix]);
    const topOffset = ny * row + ix;
    appendSideQuad(mesh, topIndex[topOffset + 1], topIndex[topOffset], bottomIndex[topOffset], bottomIndex[topOffset + 1]);
  }
  for (let iy = 0; iy < ny; iy += 1) {
    const left = iy * row;
    appendSideQuad(mesh, topIndex[left + row], topIndex[left], bottomIndex[left], bottomIndex[left + row]);
    const right = iy * row + nx;
    appendSideQuad(mesh, topIndex[right], topIndex[right + row], bottomIndex[right + row], bottomIndex[right]);
  }

  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return mesh;
}

function buildCncUnreachableOverlay(unreachable, nx, ny, xMin, yMin, dx, dy, z) {
  const mesh = { vertices: [], triangles: [], triangle_count: 0 };
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      if (!unreachable[iy * nx + ix]) continue;
      const x0 = xMin + ix * dx;
      const x1 = x0 + dx;
      const y0 = yMin + iy * dy;
      const y1 = y0 + dy;
      const a = pushMeshVertex(mesh, x0, y0, z);
      const b = pushMeshVertex(mesh, x1, y0, z);
      const c = pushMeshVertex(mesh, x1, y1, z);
      const d = pushMeshVertex(mesh, x0, y1, z);
      pushMeshTriangle(mesh, a, b, c);
      pushMeshTriangle(mesh, a, c, d);
    }
  }
  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return mesh;
}

function buildCncSurfaceOverlay(mask, depths, nx, ny, xMin, yMin, dx, dy, blockHeight, zOffset = 0.25, stipple = 1) {
  const mesh = { vertices: [], triangles: [], triangle_count: 0 };
  const stride = Math.max(1, Math.floor(stipple));
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      if (!mask[iy * nx + ix]) continue;
      if (stride > 1 && (ix + iy) % stride !== 0) continue;
      const depth = Math.max(0, depths[iy * nx + ix] || 0);
      const z = blockHeight - depth + zOffset;
      const x0 = xMin + ix * dx;
      const x1 = x0 + dx;
      const y0 = yMin + iy * dy;
      const y1 = y0 + dy;
      const a = pushMeshVertex(mesh, x0, y0, z);
      const b = pushMeshVertex(mesh, x1, y0, z);
      const c = pushMeshVertex(mesh, x1, y1, z);
      const d = pushMeshVertex(mesh, x0, y1, z);
      pushMeshTriangle(mesh, a, b, c);
      pushMeshTriangle(mesh, a, c, d);
    }
  }
  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return mesh;
}

function pushMeshVertex(mesh, x, y, z) {
  const index = Math.floor(mesh.vertices.length / 3);
  mesh.vertices.push(roundedCoordinate(x), roundedCoordinate(y), roundedCoordinate(z));
  return index;
}

function pushMeshTriangle(mesh, a, b, c) {
  mesh.triangles.push(a, b, c);
}

function appendSideQuad(mesh, a, b, c, d) {
  pushMeshTriangle(mesh, a, b, c);
  pushMeshTriangle(mesh, a, c, d);
}

function renderCncFoamPreview(result) {
  cncGroup.clear();
  splitGroup.clear();
  supportGroup.clear();
  coverageGroup.clear();
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.coverage = null;
  state.coverageVisible = false;
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  state.cncMesh = result.mesh;
  state.cncQa = result.qa;
  renderMeshIntoGroup(cncGroup, result.mesh, materialCncFoam, "CNC VCarve relief target");
  renderMeshIntoGroup(cncGroup, result.unreachableMesh, materialCncUnreachable, "CNC unreachable overlay");
  renderMeshIntoGroup(cncGroup, result.intersectionMesh, materialCncIntersection, "CNC clearance risk overlay");
  cncGroup.visible = true;
  supportGroup.visible = false;
}

function renderMeshIntoGroup(group, supportMesh, material, name) {
  if (!supportMesh?.vertices?.length || !supportMesh?.triangles?.length) return null;
  normalizeSupportMeshArrays(supportMesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(supportMesh.vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(supportMesh.triangles, 1));
  const displayGeometry = material.flatShading ? geometry.toNonIndexed() : geometry;
  displayGeometry.computeVertexNormals();
  displayGeometry.computeBoundingBox();
  displayGeometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(displayGeometry, material);
  mesh.name = name;
  group.add(mesh);
  return mesh;
}

function clearCncPreview(options = {}) {
  cncGroup.clear();
  state.cncMesh = null;
  state.cncQa = null;
  if (!options.keepStatus) setCncStatus("Load a model to preview a foam relief.", "idle");
  if (state.workflowMode === "cnc") resetQaDashboard();
  updateButtons();
}

async function autoFitCncLift() {
  if (!state.modelMesh) return;
  if (controlsEl.cncAutoLift) controlsEl.cncAutoLift.checked = true;
  syncCncLiftControls();
  const settings = cncSettings();
  const existingMaxDepth = state.cncQa?.max_required_depth_mm;
  let maxRequiredDepth = existingMaxDepth;
  if (!Number.isFinite(maxRequiredDepth)) {
    setCncStatus("Sampling model to auto-fit CNC lift...", "working");
    const probe = await buildCncFoamRelief({ ...settings, modelLiftMm: 0 }, async (message) => {
      setCncStatus(message, "working");
      await nextFrame();
    });
    maxRequiredDepth = probe.qa.max_required_depth_mm;
  }
  const placementOffset = Math.round((maxRequiredDepth - settings.allowedDepthMm) * 2) / 2;
  const displayLift = Math.max(0, placementOffset);
  controlsEl.cncModelLift.value = String(Math.min(Number(controlsEl.cncModelLift.max) || 120, displayLift));
  clearCncPreview();
  settings.modelPlacementOffsetMm = placementOffset;
  settings.modelLiftMm = displayLift;
  updateOutputs();
  if (outputs.cncModelLift) {
    outputs.cncModelLift.textContent = `${formatStatusNumber(placementOffset)} mm auto offset`;
  }
  applyCncModelPlacement(settings);
  setCncStatus(`Auto-fit offset set to ${formatStatusNumber(placementOffset)} mm. Preview again to inspect contact.`, "pending");
}

function setCncStatus(message, stateName = "idle") {
  if (!controlsEl.cncStatus) return;
  controlsEl.cncStatus.textContent = message;
  controlsEl.cncStatus.dataset.state = stateName;
}

function setCncQaDashboard(items) {
  setQaDashboard(items);
}

function updateCncQaDashboard(qa) {
  setCncQaDashboard([
    {
      label: "Reach",
      value: `${formatStatusNumber(qa.reached_percent)}%`,
      detail: `${qa.reached_cells.toLocaleString()} / ${qa.depth_reachable_cells.toLocaleString()} clearance cells`,
      state: qa.reached_percent >= 95 ? "ok" : qa.reached_percent >= 70 ? "caution" : "error",
    },
    {
      label: "Depth",
      value: `${formatStatusNumber(qa.max_carved_depth_mm)} mm`,
      detail: `${formatStatusNumber(qa.allowed_depth_mm)} mm allowed, ${formatStatusNumber(qa.model_placement_offset_mm)} mm ${qa.auto_lift_enabled ? "auto" : "manual"} offset`,
      state: qa.unreachable_cells ? "caution" : "ok",
    },
    {
      label: "Unreachable",
      value: qa.unreachable_cells ? qa.unreachable_cells.toLocaleString() : "None",
      detail: `${qa.lifted_out_cells.toLocaleString()} lifted clear, ${qa.enclosed_void_cells.toLocaleString()} footprint voids filled`,
      state: qa.unreachable_cells ? "caution" : "ok",
    },
    {
      label: "Tool fit risk",
      value: qa.selected_tool_miss_cells ? qa.selected_tool_miss_cells.toLocaleString() : "None",
      detail: qa.selected_tool_miss_cells
        ? `${formatStatusNumber(qa.max_selected_tool_miss_mm)} mm max foam left high`
        : `${formatStatusNumber(qa.intersection_tolerance_mm)} mm tolerance`,
      state: qa.selected_tool_miss_cells ? "caution" : "ok",
    },
    {
      label: "Block",
      value: qa.block_fits ? "Fits" : "Too small",
      detail: `${formatStatusNumber(qa.settings.width)} x ${formatStatusNumber(qa.settings.depth)} mm`,
      state: qa.block_fits ? "ok" : "error",
    },
    {
      label: "Tool",
      value: qa.tool_end === "ball" ? "Ball nose" : "Flat end",
      detail: `${formatStatusNumber(qa.settings.bitRadiusMm)} mm radius, ${formatStatusNumber(qa.tool_simulation_resolution_mm)} mm sim grid`,
      state: "ok",
    },
  ]);
}

function buildSupportJobPayload() {
  const bbox = new THREE.Box3().setFromObject(state.modelMesh);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const mesh = buildMeshPayload();

  return {
    version: 1,
    model: {
      name: state.modelMesh.name,
      triangle_count: mesh.triangle_count,
      matrix_world: state.modelMesh.matrixWorld.toArray(),
      bounds_mm: {
        min: bbox.min.toArray(),
        max: bbox.max.toArray(),
        size: size.toArray(),
        center: center.toArray(),
      },
    },
    mesh,
    support_config: collectSupportConfig(),
    cradle_config: collectCradleConfig(),
    manual_supports: realizedManualSupports().map((support) => ({
      id: support.id,
      source: support.source,
      point: support.worldPoint.toArray(),
      normal: support.worldNormal.toArray(),
    })),
  };
}

function buildMeshPayload() {
  state.modelMesh.updateMatrixWorld(true);
  if (state.modelPayloadCache) {
    return state.modelPayloadCache;
  }

  const geometry = state.sourceGeometry ?? state.modelMesh.geometry;
  const positionAttribute = geometry.getAttribute("position");
  const vertices = positionAttribute ? new Float32Array(positionAttribute.count * 3) : new Float32Array(0);
  const indexedVertices = [];
  const indexedTriangles = positionAttribute ? new Uint32Array(positionAttribute.count) : new Uint32Array(0);
  const indexedVertexMap = new Map();
  const vertex = new THREE.Vector3();

  if (!positionAttribute) {
    state.modelPayloadCache = {
      coordinate_space: "world_mm",
      triangle_encoding: "nonindexed_triplets",
      vertex_count: 0,
      triangle_count: 0,
      vertices,
      indexed_mesh: {
        vertices: new Float32Array(0),
        triangles: new Uint32Array(0),
      },
    };
    return state.modelPayloadCache;
  }

  for (let index = 0; index < positionAttribute.count; index += 1) {
    vertex.fromBufferAttribute(positionAttribute, index).applyMatrix4(state.modelMesh.matrixWorld);
    const offset = index * 3;
    const ix = Math.round(vertex.x * MESH_COORDINATE_PRECISION);
    const iy = Math.round(vertex.y * MESH_COORDINATE_PRECISION);
    const iz = Math.round(vertex.z * MESH_COORDINATE_PRECISION);
    const x = ix / MESH_COORDINATE_PRECISION;
    const y = iy / MESH_COORDINATE_PRECISION;
    const z = iz / MESH_COORDINATE_PRECISION;
    vertices[offset] = x;
    vertices[offset + 1] = y;
    vertices[offset + 2] = z;

    const key = `${ix}:${iy}:${iz}`;
    let indexedVertex = indexedVertexMap.get(key);
    if (indexedVertex === undefined) {
      indexedVertex = indexedVertices.length / 3;
      indexedVertices.push(x, y, z);
      indexedVertexMap.set(key, indexedVertex);
    }
    indexedTriangles[index] = indexedVertex;
  }

  state.modelPayloadCache = {
    coordinate_space: "world_mm",
    triangle_encoding: "nonindexed_triplets",
    vertex_count: positionAttribute.count,
    triangle_count: Math.floor(positionAttribute.count / 3),
    vertices,
    indexed_mesh: {
      vertices: new Float32Array(indexedVertices),
      triangles: indexedTriangles,
      vertex_count: Math.floor(indexedVertices.length / 3),
      triangle_count: Math.floor(indexedTriangles.length / 3),
    },
  };
  return state.modelPayloadCache;
}

function invalidateModelPayloadCache() {
  state.modelManifoldPrewarmToken += 1;
  if (state.modelManifoldPrewarmTimer !== null) {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(state.modelManifoldPrewarmTimer);
    } else {
      window.clearTimeout(state.modelManifoldPrewarmTimer);
    }
    state.modelManifoldPrewarmTimer = null;
  }
  state.modelPayloadCache = null;
  state.modelManifoldCache?.solid?.delete?.();
  state.modelManifoldCache = null;
  state.modelQaCache = null;
  state.modelCenterOfMassCache = null;
}

function roundedCoordinate(value) {
  return Math.round(value * MESH_COORDINATE_PRECISION) / MESH_COORDINATE_PRECISION;
}

function formatStatusNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatDurationMs(ms) {
  const number = Number(ms);
  if (!Number.isFinite(number) || number < 0) return "0 ms";
  if (number < 1000) return `${Math.round(number)} ms`;
  return `${(number / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} s`;
}

function formatWasmTimingText(timings) {
  if (!timings || typeof timings !== "object") return "";
  const labels = [
    ["input_parse", "input parse"],
    ["settings_parse", "settings"],
    ["generation_total", "generate total"],
    ["grid", "grid"],
    ["model_ceiling", "ceiling"],
    ["overhang_scan", "overhangs"],
    ["lower_envelope", "envelope"],
    ["prune", "prune"],
    ["gap_clearance", "clearance"],
    ["native_qa", "native QA"],
    ["base_join", "base"],
    ["mesh", "mesh"],
    ["binary_pack", "binary pack"],
  ];
  const parts = labels
    .map(([key, label]) => [label, Number(timings[key])])
    .filter(([, value]) => Number.isFinite(value) && value > 0.05)
    .map(([label, value]) => `${label} ${formatDurationMs(value)}`);
  return parts.length ? ` WASM phases: ${parts.join(", ")}.` : "";
}

function formatWasmOutputTimingText(timings) {
  if (!timings || typeof timings !== "object") return "";
  const labels = [
    ["mesh_json", "mesh metadata"],
    ["tree_json", "tree JSON"],
    ["coverage_json", "coverage JSON"],
    ["qa_json", "QA JSON"],
  ];
  const parts = labels
    .map(([key, label]) => [label, Number(timings[key])])
    .filter(([, value]) => Number.isFinite(value) && value > 0.05)
    .map(([label, value]) => `${label} ${formatDurationMs(value)}`);
  return parts.length ? ` WASM output: ${parts.join(", ")}.` : "";
}

function formatWorkerTimingText(timings) {
  if (!Array.isArray(timings) || !timings.length) return "";
  const parts = timings
    .map((phase) => ({
      label: String(phase?.label ?? ""),
      ms: Number(phase?.ms),
    }))
    .filter((phase) => phase.label && Number.isFinite(phase.ms) && phase.ms >= 0)
    .map((phase) => `${phase.label} ${formatDurationMs(phase.ms)}`);
  return parts.length ? ` Worker phases: ${parts.join(", ")}.` : "";
}

function formatQaWorkerTimingText(timings) {
  if (!Array.isArray(timings) || !timings.length) return "";
  const parts = timings
    .map((phase) => ({
      label: String(phase?.label ?? ""),
      ms: Number(phase?.ms),
    }))
    .filter((phase) => phase.label && Number.isFinite(phase.ms) && phase.ms >= 0)
    .map((phase) => `${phase.label} ${formatDurationMs(phase.ms)}`);
  return parts.length ? ` QA worker phases: ${parts.join(", ")}.` : "";
}

function formatTrimTimingText(timings) {
  if (!Array.isArray(timings) || !timings.length) return "";
  const parts = timings
    .map((phase) => ({
      label: String(phase?.label ?? ""),
      ms: Number(phase?.ms),
    }))
    .filter((phase) => phase.label && Number.isFinite(phase.ms) && phase.ms >= 0.05)
    .map((phase) => `${phase.label} ${formatDurationMs(phase.ms)}`);
  return parts.length ? ` Trim phases: ${parts.join(", ")}.` : "";
}

function inchesToMm(value) {
  return Math.max(0, Number(value) || 0) * INCH_TO_MM;
}

function collectSupportConfig() {
  const interfaceEnabled = Boolean(controlsEl.interfaceEnabled?.checked);
  const foamGapEnabled = Boolean(controlsEl.foamGapEnabled?.checked);

  return {
    ...DEFAULT_SUPPORT_CONFIG,
    enable_support: true,
    support_interface_enabled: interfaceEnabled,
    foam_gap_enabled: foamGapEnabled,
    support_type: STABLE_SUPPORT_TYPE,
    support_style: STABLE_SUPPORT_STYLE,
    support_base_pattern: DEFAULT_SUPPORT_CONFIG.support_base_pattern ?? "default",
    support_interface_pattern: DEFAULT_SUPPORT_CONFIG.support_interface_pattern ?? "auto",
    support_threshold_angle: Number(controlsEl.supportThresholdAngle.value),
    support_threshold_overlap: DEFAULT_SUPPORT_CONFIG.support_threshold_overlap ?? "50%",
    support_on_build_plate_only: false,
    support_critical_regions_only: controlsEl.supportCriticalRegionsOnly.checked,
    support_remove_small_overhang: controlsEl.supportRemoveSmallOverhang.checked,
    support_top_z_distance: Number(controlsEl.supportTopZDistance.value),
    support_bottom_z_distance: Number(controlsEl.supportTopZDistance.value),
    support_object_xy_distance: Number(controlsEl.supportObjectXYDistance.value),
    support_edge_clearance_mm: Number(controlsEl.supportEdgeClearance.value),
    support_base_pattern_spacing: Number(controlsEl.supportBasePatternSpacing.value),
    support_interface_top_layers: interfaceEnabled ? Number(controlsEl.supportInterfaceTopLayers.value) : 0,
    support_interface_bottom_layers: 0,
    support_interface_spacing: Number(controlsEl.supportInterfaceSpacing.value),
    support_bottom_interface_spacing: DEFAULT_SUPPORT_CONFIG.support_bottom_interface_spacing ?? 0.5,
    foam_gap_z_mm: foamGapEnabled ? Number(controlsEl.foamGapZ.value) : 0,
    foam_gap_xy_mm: foamGapEnabled ? Number(controlsEl.foamGapXY.value) : 0,
    tree_support_branch_distance: Number(controlsEl.treeSupportBranchDistance.value),
    tree_support_tip_diameter: Number(controlsEl.treeSupportTipDiameter.value),
    tree_support_branch_diameter: Number(controlsEl.treeSupportBranchDiameter.value),
    tree_support_branch_angle: Number(controlsEl.treeSupportBranchAngle.value),
    tree_support_wall_count: 1,
  };
}

function collectCradleConfig() {
  return {
    base_enabled: controlsEl.baseEnabled.checked,
    join_uprights_bottom_enabled: controlsEl.baseJoinUprights.checked,
    base_margin_mm: Number(controlsEl.baseMargin.value),
    base_thickness_mm: Number(controlsEl.baseThickness.value),
  };
}

function updateManualMarkers() {
  markerGroup.clear();
  state.supportMarkerObjects.clear();

  if (!state.modelMesh) {
    updateButtons();
    return;
  }

  for (const support of realizedManualSupports()) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(2.8, 16, 8),
      materialMarkerManual
    );
    marker.position.copy(support.worldPoint);
    marker.userData.supportId = support.id;
    markerGroup.add(marker);
    state.supportMarkerObjects.set(support.id, marker);
  }

  updateButtons();
}

function clearGeneratedSupport() {
  if (!state.supportMesh && !state.interfaceMesh && !state.coverage && supportGroup.children.length === 0 && splitGroup.children.length === 0 && coverageGroup.children.length === 0) {
    resetQaDashboard();
    return;
  }
  supportGroup.clear();
  splitGroup.clear();
  coverageGroup.clear();
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.coverage = null;
  state.coverageVisible = false;
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  state.manualSupportMode = false;
  supportGroup.visible = true;
  setSplitStatus("Generate a cradle to check build-plate fit.", "idle");
  resetQaDashboard();
}

function realizedManualSupports() {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(state.modelMesh.matrixWorld);
  return state.manualSupports.map((support) => {
    const worldPoint = state.modelMesh.localToWorld(support.localPoint.clone());
    const worldNormal = support.localNormal.clone().applyMatrix3(normalMatrix).normalize();
    return { ...support, worldPoint, worldNormal };
  });
}

function updateOutputs() {
  outputs.elevation.textContent = `${controlsEl.elevation.value} mm`;
  outputs.supportThresholdAngle.textContent = `${controlsEl.supportThresholdAngle.value} deg`;
  outputs.supportTopZDistance.textContent = `${controlsEl.supportTopZDistance.value} mm`;
  outputs.supportObjectXYDistance.textContent = `${controlsEl.supportObjectXYDistance.value} mm`;
  outputs.supportEdgeClearance.textContent = `${controlsEl.supportEdgeClearance.value} mm`;
  outputs.treeSupportBranchDistance.textContent = `${controlsEl.treeSupportBranchDistance.value} mm`;
  outputs.treeSupportBranchAngle.textContent = `${controlsEl.treeSupportBranchAngle.value} deg`;
  outputs.baseMargin.textContent = `${controlsEl.baseMargin.value} mm`;
  outputs.baseThickness.textContent = `${controlsEl.baseThickness.value} mm`;
  outputs.splitBuildMargin.textContent = `${controlsEl.splitBuildMargin.value} mm`;
  outputs.splitConnectorClearance.textContent = `${controlsEl.splitConnectorClearance.value} mm`;
  outputs.splitConnectorSize.textContent = `${controlsEl.splitConnectorSize.value} mm`;
  if (outputs.cncStickout && controlsEl.cncToolStickoutIn) {
    outputs.cncStickout.textContent = `${formatStatusNumber(inchesToMm(controlsEl.cncToolStickoutIn.value))} mm`;
  }
  if (outputs.cncResolution && controlsEl.cncResolution) {
    const settings = cncSettings();
    outputs.cncResolution.textContent = settings.resolution > settings.requestedResolution + 0.001
      ? `${formatStatusNumber(settings.resolution)} mm effective grid`
      : `${formatStatusNumber(settings.resolution)} mm grid`;
  }
  if (outputs.cncBitDiameter && controlsEl.cncBitDiameterIn) {
    outputs.cncBitDiameter.textContent = `${formatStatusNumber(inchesToMm(controlsEl.cncBitDiameterIn.value))} mm`;
  }
  if (outputs.cncModelLift && controlsEl.cncModelLift) {
    outputs.cncModelLift.textContent = `${formatStatusNumber(controlsEl.cncModelLift.value)} mm`;
  }
}

function updateButtons() {
  const hasModel = Boolean(state.modelMesh);
  const supportCount = state.manualSupports.length;
  const generatedSupportTriangles = state.supportMesh?.triangle_count ?? 0;
  const generatedInterfaceTriangles = state.interfaceMesh?.triangle_count ?? 0;
  const generatedCncTriangles = state.cncMesh?.triangle_count ?? 0;
  if (controlsEl.toggleModelVisibility) {
    controlsEl.toggleModelVisibility.disabled = !hasModel;
    controlsEl.toggleModelVisibility.textContent = state.modelVisible ? "Hide model" : "Show model";
  }
  if (controlsEl.toggleGridVisibility) {
    controlsEl.toggleGridVisibility.textContent = state.gridVisible ? "Hide grid" : "Show grid";
  }
  if (controlsEl.modelDisplayMode) {
    controlsEl.modelDisplayMode.disabled = !hasModel;
    if (controlsEl.modelDisplayMode.value !== state.modelDisplayMode) {
      controlsEl.modelDisplayMode.value = state.modelDisplayMode;
    }
  }
  controlsEl.orientModel.disabled = !hasModel;
  controlsEl.resetOrientation.disabled = !hasModel;
  if (controlsEl.applyRotationPreset) {
    controlsEl.applyRotationPreset.disabled = !hasModel;
  }
  if (controlsEl.toggleManualSupport) {
    controlsEl.toggleManualSupport.disabled = !hasModel;
    controlsEl.toggleManualSupport.textContent = state.manualSupportMode ? "Manual marks on" : "Manual marks off";
    controlsEl.toggleManualSupport.setAttribute("aria-pressed", state.manualSupportMode ? "true" : "false");
    controlsEl.toggleManualSupport.dataset.active = state.manualSupportMode ? "true" : "false";
  }
  controlsEl.generateSupports.disabled = !hasModel;
  if (controlsEl.cncGenerate) controlsEl.cncGenerate.disabled = !hasModel;
  if (controlsEl.cncAutoFit) controlsEl.cncAutoFit.disabled = !hasModel;
  if (controlsEl.cncClear) controlsEl.cncClear.disabled = generatedCncTriangles === 0;
  if (controlsEl.toggleCoverage) {
    controlsEl.toggleCoverage.disabled = !state.coverage?.cells?.length;
    controlsEl.toggleCoverage.textContent = state.coverageVisible ? "Hide coverage" : "Show coverage";
  }
  controlsEl.clearManual.disabled = !state.manualSupports.length;
  controlsEl.exportStl.disabled = generatedSupportTriangles === 0;
  if (controlsEl.exportPly) controlsEl.exportPly.disabled = generatedSupportTriangles === 0;
  if (controlsEl.exportInterfaceStl) controlsEl.exportInterfaceStl.disabled = generatedInterfaceTriangles === 0;
  if (controlsEl.exportInterfacePly) controlsEl.exportInterfacePly.disabled = generatedInterfaceTriangles === 0;
  if (controlsEl.exportCncStl) controlsEl.exportCncStl.disabled = generatedCncTriangles === 0;
  if (controlsEl.previewSplit) controlsEl.previewSplit.disabled = generatedSupportTriangles === 0;
  if (controlsEl.clearSplit) controlsEl.clearSplit.disabled = !state.splitPreviewVisible;
  if (controlsEl.exportSplitStls) controlsEl.exportSplitStls.disabled = !state.splitChunks.length;
  if (controlsEl.exportSplitManifest) controlsEl.exportSplitManifest.disabled = !state.splitChunks.length;
  const totalGeneratedTriangles = generatedSupportTriangles + generatedInterfaceTriangles;
  if (state.workflowMode === "cnc") {
    supportStatus.textContent = generatedCncTriangles
      ? `${generatedCncTriangles.toLocaleString()} CNC foam relief triangles`
      : "CNC foam relief not generated";
  } else {
    supportStatus.textContent = totalGeneratedTriangles
      ? `${generatedSupportTriangles.toLocaleString()} cradle + ${generatedInterfaceTriangles.toLocaleString()} interface triangles`
      : `${supportCount} manual marks`;
  }
}

function setJobStatus(message, stateName = "idle") {
  jobStatus.textContent = message;
  jobStatus.dataset.state = stateName;
}

function resetQaDashboard() {
  setQaDashboard([
    { label: "Model", value: "Ready", detail: "Load or import", state: "idle" },
    { label: "Coverage", value: "--", detail: "Generate cradle", state: "idle" },
    { label: "Intersections", value: "--", detail: "Generate cradle", state: "idle" },
    { label: "Stability", value: "--", detail: "Generate cradle", state: "idle" },
  ]);
}

function setQaDashboard(items) {
  if (!qaDashboard) return;
  qaDashboard.replaceChildren();

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "qa-card";
    card.dataset.state = item.state || "idle";

    const label = document.createElement("div");
    label.className = "qa-label";
    label.textContent = item.label;

    const value = document.createElement("div");
    value.className = "qa-value";
    value.textContent = item.value;

    const detail = document.createElement("div");
    detail.className = "qa-detail";
    detail.textContent = item.detail || "";

    card.append(label, value, detail);
    qaDashboard.appendChild(card);
  }
}

function updateGeneratedQaDashboard(summary) {
  const coverageState = Number(summary.supportedDownwardPercent) >= 99.5 && Number(summary.unsupportedCellCount) === 0
    ? "ok"
    : Number(summary.supportedDownwardPercent) >= 95
      ? "caution"
      : "error";
  const meshState = summary.meshQa?.unsupported_cells ? "error" : "ok";
  const gridIntersectionCount = Number(summary.qa?.intersection_cells ?? 0);
  const meshIntersectionCount = Number(summary.modelMeshQa?.intersection_samples ?? 0);
  const intersectionCount = gridIntersectionCount + meshIntersectionCount;
  const maxPenetration = Math.max(
    Number(summary.qa?.max_penetration_mm ?? 0),
    Number(summary.modelMeshQa?.max_penetration_mm ?? 0)
  );
  const intersectionState = intersectionCount ? "error" : "ok";
  const stabilityState = summary.stabilityQa?.severity === "error"
    ? "error"
    : summary.stabilityQa?.severity === "caution"
      ? "caution"
      : "ok";
  const stabilityValue = stabilityDashboardValue(summary.stabilityQa);
  const stabilityDetail = stabilityDashboardDetail(summary.stabilityQa);
  const totalTriangles = Number(summary.supportTriangleCount ?? 0) + Number(summary.interfaceTriangleCount ?? 0);

  setQaDashboard([
    {
      label: "Coverage",
      value: `${formatStatusNumber(summary.supportedDownwardPercent)}%`,
      detail: `${Number(summary.qa?.supported_downward_cells ?? 0).toLocaleString()} / ${Number(summary.qa?.downward_cells ?? 0).toLocaleString()} cells`,
      state: coverageState,
    },
    {
      label: "Mesh",
      value: summary.meshQa?.unsupported_cells ? "Gap" : "Solid",
      detail: `${formatStatusNumber(summary.meshQa?.max_gap_mm ?? 0)} mm max gap`,
      state: meshState,
    },
    {
      label: "Intersections",
      value: intersectionCount ? intersectionCount.toLocaleString() : "None",
      detail: `${formatStatusNumber(maxPenetration)} mm penetration`,
      state: intersectionState,
    },
    {
      label: "Stability",
      value: stabilityValue,
      detail: stabilityDetail,
      state: stabilityState,
    },
    {
      label: "Cradle",
      value: totalTriangles ? `${totalTriangles.toLocaleString()}` : "None",
      detail: "triangles",
      state: totalTriangles ? "ok" : "idle",
    },
    {
      label: "Split",
      value: summary.splitReady ? "Ready" : "--",
      detail: "Preview chunks",
      state: summary.splitReady ? "pending" : "idle",
    },
  ]);
}

function stabilityDashboardValue(qa) {
  if (!qa?.available) return "Skipped";
  if (!qa.inside) return "Outside";
  if (qa.risk === "stable") return "Stable";
  return "Edge";
}

function stabilityDashboardDetail(qa) {
  if (!qa?.available) return qa?.reason || "No COM estimate";
  if (!qa.inside) return `${formatStatusNumber(Math.abs(qa.signed_margin_mm))} mm outside`;
  return `${formatStatusNumber(qa.signed_margin_mm)} mm margin, ${formatStatusNumber(qa.tip_angle_deg)} deg`;
}

function setSplitStatus(message, stateName = "idle") {
  if (!controlsEl.splitStatus) return;
  controlsEl.splitStatus.textContent = message;
  controlsEl.splitStatus.dataset.state = stateName;
}

function setJobProgress(value) {
  setProgress(controlsEl.jobProgressShell, controlsEl.jobProgress, value);
}

function setSplitProgress(value) {
  setProgress(controlsEl.splitProgressShell, controlsEl.splitProgress, value);
}

function setProgress(shell, progress, value) {
  if (!shell || !progress) return;
  shell.hidden = false;
  const normalized = Math.max(0, Math.min(100, Number(value) || 0));
  progress.value = normalized;
  progress.setAttribute("value", String(normalized));
}

function resetProgress(shell, progress) {
  if (!shell || !progress) return;
  progress.value = 0;
  progress.setAttribute("value", "0");
  shell.hidden = true;
}

function nextFrame() {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    window.requestAnimationFrame(finish);
    window.setTimeout(finish, 50);
  });
}

function toggleModelVisibility() {
  if (!state.modelMesh) return;
  applyModelDisplayMode(state.modelVisible ? "hidden" : "solid");
  updateButtons();
}

function toggleGridVisibility() {
  state.gridVisible = !state.gridVisible;
  grid.visible = state.gridVisible;
  updateButtons();
}

function applyModelDisplayMode(mode) {
  const normalized = ["solid", "ghost", "hidden"].includes(mode) ? mode : "solid";
  state.modelDisplayMode = normalized;
  state.modelVisible = normalized !== "hidden";

  if (controlsEl.modelDisplayMode && controlsEl.modelDisplayMode.value !== normalized) {
    controlsEl.modelDisplayMode.value = normalized;
  }

  materialModel.transparent = normalized === "ghost";
  materialModel.opacity = normalized === "ghost" ? 0.36 : 1;
  materialModel.depthWrite = normalized !== "ghost";
  materialModel.depthTest = true;
  materialModel.side = normalized === "solid" ? THREE.FrontSide : THREE.DoubleSide;
  materialModel.needsUpdate = true;

  if (state.modelMesh) {
    state.modelMesh.visible = state.modelVisible;
    state.modelMesh.renderOrder = normalized === "ghost" ? 3 : 0;
  }

  updateButtons();
}

function toggleCoverageOverlay() {
  if (!state.coverage?.cells?.length) return;
  state.coverageVisible = !state.coverageVisible;
  coverageGroup.visible = state.coverageVisible;
  updateButtons();
}

function toggleManualSupportMode() {
  if (!state.modelMesh) return;
  state.manualSupportMode = !state.manualSupportMode;
  modelStatus.textContent = state.manualSupportMode
    ? "Manual mark mode on; click the object to add marks, Alt-click a mark to remove it"
    : "Manual mark mode off";
  updateButtons();
}

function toggleOrientationHelper() {
  setOrientationHelper(!transformControls.enabled);
}

function setOrientationHelper(enabled) {
  transformControls.enabled = enabled;
  transformHelper.visible = enabled;

  if (enabled && state.modelMesh) {
    transformControls.attach(state.modelMesh);
    controlsEl.orientModel.textContent = "Done rotating";
    modelStatus.textContent = "Rotate helper active";
  } else {
    transformControls.detach();
    controlsEl.orientModel.textContent = "Rotate helper";
  }
}

function resetOrientation() {
  if (!state.modelMesh) return;
  state.modelMesh.rotation.set(0, 0, 0);
  clearGeneratedSupport();
  applyElevation();
  updateManualMarkers();
  modelStatus.textContent = "Rotation reset";
}

function applyRotationPreset() {
  if (!state.modelMesh || !controlsEl.rotationPreset) return;
  const angles = controlsEl.rotationPreset.value.split(",").map((value) => Number(value));
  if (angles.length !== 3 || angles.some((value) => !Number.isFinite(value))) return;

  state.modelMesh.rotation.set(
    THREE.MathUtils.degToRad(angles[0]),
    THREE.MathUtils.degToRad(angles[1]),
    THREE.MathUtils.degToRad(angles[2])
  );
  clearGeneratedSupport();
  applyElevation();
  updateManualMarkers();
  modelStatus.textContent = `Applied rotation ${angles.join(" / ")} degrees`;
}

function resize() {
  const { width, height } = viewport.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function render() {
  orbit.update();
  renderer.render(scene, camera);
}


function exportSupportStl() {
  if (!state.supportMesh) return;

  const stl = supportMeshToAsciiStl(state.supportMesh, "cradlemaker_support");
  downloadTextFile(stl, supportExportName("cradle", "stl"), "model/stl");
}

function exportSupportPly() {
  if (!state.supportMesh) return;

  const ply = supportMeshToAsciiPly(state.supportMesh);
  downloadTextFile(ply, supportExportName("cradle", "ply"), "model/ply");
}

function exportInterfaceStl() {
  if (!state.interfaceMesh) return;

  const stl = supportMeshToAsciiStl(state.interfaceMesh, "cradlemaker_interface");
  downloadTextFile(stl, supportExportName("interface", "stl"), "model/stl");
}

function exportInterfacePly() {
  if (!state.interfaceMesh) return;

  const ply = supportMeshToAsciiPly(state.interfaceMesh);
  downloadTextFile(ply, supportExportName("interface", "ply"), "model/ply");
}

function exportCncFoamStl() {
  if (!state.cncMesh) return;

  const stl = supportMeshToAsciiStl(state.cncMesh, "cradlemaker_cnc_foam_relief");
  downloadTextFile(stl, supportExportName("cnc-foam-relief", "stl"), "model/stl");
}

function exportSplitStls() {
  if (!state.splitChunks.length) return;

  const chunks = [...state.splitChunks];
  setSplitStatus(`Preparing ${chunks.length.toLocaleString()} chunk STL download${chunks.length === 1 ? "" : "s"}...`, "working");
  for (const [index, chunk] of chunks.entries()) {
    window.setTimeout(() => {
      const stl = supportMeshToAsciiStl(chunk.mesh, `cradlemaker_${chunk.id.toLowerCase()}`);
      downloadTextFile(stl, supportExportName(`cradle-${chunk.id.toLowerCase()}`, "stl"), "model/stl");
      if (index === chunks.length - 1) {
        setSplitStatus(`Exported ${chunks.length.toLocaleString()} split chunk STL${chunks.length === 1 ? "" : "s"}.`, "pending");
      }
    }, index * 180);
  }
}

function exportSplitManifest() {
  if (!state.splitPlan) return;

  const manifest = splitManifest();
  downloadTextFile(JSON.stringify(manifest, null, 2), supportExportName("split-manifest", "json"), "application/json");
}

function splitManifest() {
  const plan = state.splitPlan;
  const modelName = state.modelMesh?.name || "model";
  return {
    version: 1,
    created_at: new Date().toISOString(),
    model: modelName,
    method: plan.method,
    warning: plan.warning,
    build_volume_mm: {
      width: plan.settings.width,
      depth: plan.settings.depth,
      height: plan.settings.height,
      margin: plan.settings.margin,
      usable_width: plan.settings.usableWidth,
      usable_depth: plan.settings.usableDepth,
      usable_height: plan.settings.usableHeight,
    },
    connector_settings: {
      enabled: plan.settings.connectorsEnabled,
      type: "split-face-z-slide-dovetail",
      clearance_mm: plan.settings.connectorClearance,
      nominal_size_mm: plan.settings.connectorSize,
      minimum_support_free_roof_angle_deg: CONNECTOR_MIN_ROOF_ANGLE_DEG,
      count: plan.connectors.length,
      shallow_count: plan.connectors.filter((connector) => connector.shallow).length,
      below_minimum_roof_angle_count: plan.connectors.filter((connector) => connector.support_free_roof === false).length,
    },
    qa: plan.qa,
    dovetail_gap_qa: plan.gapQa,
    source_bounds_mm: manifestBounds(plan.sourceBounds),
    grid: plan.grid,
    connectors: plan.connectors,
    chunks: plan.chunks.map((chunk) => ({
      id: chunk.id,
      filename: supportExportName(`cradle-${chunk.id.toLowerCase()}`, "stl"),
      grid: chunk.grid,
      fits_build_volume: chunk.fits,
      bounds_mm: manifestBounds(chunk.bounds),
      triangle_count: chunk.mesh.triangle_count,
      vertex_count: Math.floor(chunk.mesh.vertices.length / 3),
    })),
    next_steps: [
      "Add optional seam placement controls outside protected model-contact surfaces.",
      "Add engraved/raised chunk labels and assembly direction marks.",
    ],
  };
}

function manifestBounds(bounds) {
  return {
    min: { x: roundedCoordinate(bounds.min.x), y: roundedCoordinate(bounds.min.y), z: roundedCoordinate(bounds.min.z) },
    max: { x: roundedCoordinate(bounds.max.x), y: roundedCoordinate(bounds.max.y), z: roundedCoordinate(bounds.max.z) },
    size: { x: roundedCoordinate(bounds.size.x), y: roundedCoordinate(bounds.size.y), z: roundedCoordinate(bounds.size.z) },
  };
}

function supportExportName(partName, extension) {
  const modelName = state.modelMesh?.name?.replace(/\.[^.]+$/, "") || "model";
  return `${modelName}-${partName}.${extension}`;
}

function downloadTextFile(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function supportMeshToAsciiStl(supportMesh, name) {
  const vertices = supportMesh.vertices;
  const triangles = supportMesh.triangles;
  const lines = [`solid ${name}`];

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const normal = triangleNormal(a, b, c);
    lines.push(`  facet normal ${formatStlNumber(normal.x)} ${formatStlNumber(normal.y)} ${formatStlNumber(normal.z)}`);
    lines.push("    outer loop");
    lines.push(`      vertex ${formatStlNumber(a.x)} ${formatStlNumber(a.y)} ${formatStlNumber(a.z)}`);
    lines.push(`      vertex ${formatStlNumber(b.x)} ${formatStlNumber(b.y)} ${formatStlNumber(b.z)}`);
    lines.push(`      vertex ${formatStlNumber(c.x)} ${formatStlNumber(c.y)} ${formatStlNumber(c.z)}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }

  lines.push(`endsolid ${name}`);
  return `${lines.join("\n")}\n`;
}

function supportMeshToAsciiPly(supportMesh) {
  const vertices = supportMesh.vertices;
  const triangles = supportMesh.triangles;
  const vertexCount = Math.floor(vertices.length / 3);
  const faceCount = Math.floor(triangles.length / 3);
  const lines = [
    "ply",
    "format ascii 1.0",
    `element vertex ${vertexCount}`,
    "property float x",
    "property float y",
    "property float z",
    `element face ${faceCount}`,
    "property list uchar int vertex_indices",
    "end_header",
  ];

  for (let index = 0; index + 2 < vertices.length; index += 3) {
    lines.push(`${formatStlNumber(vertices[index])} ${formatStlNumber(vertices[index + 1])} ${formatStlNumber(vertices[index + 2])}`);
  }

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    lines.push(`3 ${triangles[index]} ${triangles[index + 1]} ${triangles[index + 2]}`);
  }

  return `${lines.join("\n")}\n`;
}

function readSupportVertex(vertices, index) {
  const offset = index * 3;
  return {
    x: vertices[offset] ?? 0,
    y: vertices[offset + 1] ?? 0,
    z: vertices[offset + 2] ?? 0,
  };
}

function triangleNormal(a, b, c) {
  const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
  const normal = {
    x: ab.y * ac.z - ab.z * ac.y,
    y: ab.z * ac.x - ab.x * ac.z,
    z: ab.x * ac.y - ab.y * ac.x,
  };
  const normalLength = Math.hypot(normal.x, normal.y, normal.z) || 1;
  return {
    x: normal.x / normalLength,
    y: normal.y / normalLength,
    z: normal.z / normalLength,
  };
}

function formatStlNumber(value) {
  return Number.isFinite(value) ? value.toPrecision(7) : "0";
}
