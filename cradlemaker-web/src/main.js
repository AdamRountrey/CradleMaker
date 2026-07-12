import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { CENTER, acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import createManifoldModule from "../vendor/manifold/manifold.js";
import { getSupportOptionSchema, prepareSupportJob, prepareSupportJobInIsolatedWorker, prewarmSupportCore, resetSupportCoreRuntime } from "./wasmCore.js?v=column-taper-6";
import { defaultOrcaSupportConfig } from "./orcaSupportOptions.js?v=organic-voxel-1";
import {
  buildClearanceKernel,
  CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE,
  normalizeClearanceKernelMode,
} from "./clearanceKernel.js?v=clearance-kernel-1";
import {
  certifyContinuousClearance,
  continuousClearanceCertificateSettings,
} from "./clearanceCertificate.js?v=continuous-clearance-3";

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const DEFAULT_SAMPLE_MODELS = [
  "TruckAntennaMount1.stl",
];
const BED_SIZE = 220;
const CONNECTOR_MIN_ROOF_ANGLE_DEG = 45;
const CONNECTOR_MIN_PROJECTION_MM = 0.8;
const CONNECTOR_MIN_PROJECTION_WIDTH_RATIO = 0.45;
const CONNECTOR_PLACER_MAX_CANDIDATES = 27;
const CONNECTOR_PLACER_MIN_BODY_COVERAGE = 0.72;
const CONNECTOR_PLACER_MIN_WALL_COVERAGE = 0.62;
const CONNECTOR_PLACER_TARGET_WALL_MM = 2.0;
const SPLIT_SLIVER_ASPECT_RATIO = 60;
const SPLIT_SLIVER_MAX_THICKNESS_MM = 0.16;
const SPLIT_CONNECTOR_SLIVER_MIN_EDGE_MM = 0.18;
const SPLIT_CONNECTOR_SLIVER_MAX_DISTANCE_MM = 0.9;
const DOVETAIL_GAP_HAIR_ASPECT_RATIO = 30;
const DOVETAIL_GAP_HAIR_MAX_THICKNESS_MM = 0.35;
const DOVETAIL_GAP_HAIR_MIN_EDGE_MM = 2;
const DEFAULT_SUPPORT_CONFIG = defaultOrcaSupportConfig();
const MESH_COORDINATE_PRECISION = 100000;
const STABLE_SUPPORT_TYPE = "normal(auto)";
const STABLE_SUPPORT_STYLE = "default";
const INCH_TO_MM = 25.4;
const CNC_TOOL_SAFETY_MARGIN_MM = 1.5;
const CNC_MIN_FLOOR_THICKNESS_MM = 6;
const CNC_MAX_GRID_CELLS = 900000;
const CNC_FINGER_HOLE_SUPPORT_INSET_MM = 1;
const ENABLE_MODEL_MANIFOLD_PREWARM = false;
const ENABLE_MODEL_TRIM_WORKER_PREWARM = true;
const MODEL_TRIM_WORKER_VERSION = "object-clearance-worker-38";
const APP_BUNDLE_VERSION = "high-accuracy-targeted-36";
const DEFAULT_TARGETED_MANIFOLD_BUILD = "o3";
const DEFAULT_HIGH_ACCURACY_TARGETED_MINKOWSKI = true;
const DEFAULT_HIGH_ACCURACY_ANALYTIC_KERNEL = true;
const VOXEL_BOOLEAN_WORKER_VERSION = APP_BUNDLE_VERSION;
const ENABLE_EXPERIMENTAL_TILED_HIGH_ACCURACY_SUPPORT_GENERATION = false;
const CRADLE_RESOLUTION_PROFILES = Object.freeze({
  low: Object.freeze({ label: "Low", cellSizeMm: 1.2, gridBudgetCells: 600000 }),
  medium: Object.freeze({ label: "Medium", cellSizeMm: 0.8, gridBudgetCells: 1200000 }),
  high: Object.freeze({ label: "High", cellSizeMm: 0.5, gridBudgetCells: 2400000 }),
});
const DEFAULT_CRADLE_RESOLUTION_PROFILE = "medium";
const DEFAULT_SUPPORT_GRID_BUDGET_CELLS = CRADLE_RESOLUTION_PROFILES[DEFAULT_CRADLE_RESOLUTION_PROFILE].gridBudgetCells;
const WASM_INITIAL_MEMORY_BYTES = 536870912;
const WASM_MAXIMUM_MEMORY_BYTES = 4294967296;
const GRID_SCALAR_BYTES = 8;
const TILED_SUPPORT_WORKER_MEMORY_CANDIDATES = [
  2147483648,
  1610612736,
  1073741824,
  536870912,
];
const TILED_SUPPORT_MAX_CONCURRENCY = 2;
const TILED_SUPPORT_TARGET_CELLS = 5000000;
const TILED_SUPPORT_TILE_MAX_CELLS = 9000000;
const MEDIUM_SUPPORT_GRID_BUDGET_CELLS = 6000000;
const MEDIUM_CLEARANCE_MAX_COLUMNS = 3000000;
const MEDIUM_CLEARANCE_MAX_RECONSTRUCTED_TRIANGLES = 4000000;
const MEDIUM_VOXEL_TARGET_TILE_COUNT = 384;
const MEDIUM_VOXEL_MAX_TILE_COUNT = 900;
const MEDIUM_VOXEL_MAX_TILE_MEMORY_BUDGET_BYTES = 2684354560;
const MEDIUM_VOXEL_ESTIMATED_BYTES_PER_LOCAL_VOXEL = 4;
const WEBGPU_CLEARANCE_WORKGROUP_SIZE = 64;
const WEBGPU_CLEARANCE_MAX_JOBS_PER_PASS = 1200000;
const WEBGPU_CLEARANCE_CPU_FALLBACK_MAX_COLUMNS = 2000000;
const LARGE_MESH_NONINDEXED_DISPLAY_TRIANGLES = 250000;
const PARALLEL_MANIFOLD_PREPARE_TIMEOUT_MS = 45000;
const PARALLEL_MANIFOLD_TRIM_TIMEOUT_MS = 600000;
const SERIAL_MANIFOLD_PREPARE_TIMEOUT_MS = 240000;
const SERIAL_MANIFOLD_TRIM_TIMEOUT_MS = 600000;
const MODEL_TRIM_ESTIMATE_STORAGE_KEY = "cradlemaker.modelTrimEstimate.v3";
const MODEL_TRIM_DEBUG_SETTINGS = Object.freeze(readModelTrimDebugSettings());
const FAST_MODEL_TRIM_SETTINGS = Object.freeze({
  ...MODEL_TRIM_DEBUG_SETTINGS,
  targeted_minkowski: false,
  kernel_mode: "legacy",
  targeted_batch_size: 0,
});
let manifoldCorePromise = null;
let qaWorker = null;
let nextQaWorkerRequestId = 1;
const qaWorkerRequests = new Map();
let modelTrimWorker = null;
let modelTrimWorkerFailed = false;
let nextModelTrimWorkerRequestId = 1;
const modelTrimWorkerRequests = new Map();

window.__CRADLEMAKER_DEBUG__ = {
  appBundleVersion: APP_BUNDLE_VERSION,
  modelTrimWorkerVersion: MODEL_TRIM_WORKER_VERSION,
  modelTrim: MODEL_TRIM_DEBUG_SETTINGS,
};
document.documentElement.dataset.cradlemakerBundle = APP_BUNDLE_VERSION;
document.documentElement.dataset.cradlemakerModelTrimWorker = MODEL_TRIM_WORKER_VERSION;
document.documentElement.dataset.cradlemakerTargetedMinkowski = String(
  MODEL_TRIM_DEBUG_SETTINGS.targeted_minkowski
);
document.documentElement.dataset.cradlemakerKernelMode = MODEL_TRIM_DEBUG_SETTINGS.kernel_mode;
document.documentElement.dataset.cradlemakerTargetedBatch = String(
  MODEL_TRIM_DEBUG_SETTINGS.targeted_batch_size || 0
);
document.documentElement.dataset.cradlemakerTargetedBuild =
  MODEL_TRIM_DEBUG_SETTINGS.targeted_build;

class ParallelManifoldTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "ParallelManifoldTimeoutError";
    this.parallelManifoldTimeout = true;
    this.modelTrimTimeout = true;
  }
}

class ModelTrimTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "ModelTrimTimeoutError";
    this.modelTrimTimeout = true;
  }
}

function isModelTrimTimeoutError(error) {
  return Boolean(error?.modelTrimTimeout) ||
    error instanceof ParallelManifoldTimeoutError ||
    error instanceof ModelTrimTimeoutError;
}

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
  elevation: document.querySelector("#elevation"),
  supportType: document.querySelector("#support-type"),
  supportStyle: document.querySelector("#support-style"),
  supportThresholdAngle: document.querySelector("#support-threshold-angle"),
  supportRemoveSmallOverhang: document.querySelector("#support-remove-small-overhang"),
  supportTopZDistance: document.querySelector("#support-top-z-distance"),
  supportObjectXYDistance: document.querySelector("#support-object-xy-distance"),
  supportEdgeClearance: document.querySelector("#support-edge-clearance"),
  cradleResolutionProfiles: [...document.querySelectorAll('input[name="cradle-resolution-profile"]')],
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
  columnTaperAngle: document.querySelector("#column-taper-angle"),
  generateSupports: document.querySelector("#generate-supports"),
  generateMediumAccuracySupports: document.querySelector("#generate-medium-accuracy-supports"),
  generateHighAccuracySupports: document.querySelector("#generate-high-accuracy-supports"),
  cancelCradleGeneration: document.querySelector("#cancel-cradle-generation"),
  toggleCoverage: document.querySelector("#toggle-coverage"),
  clearManual: document.querySelector("#clear-manual"),
  supportDisplayMode: document.querySelector("#support-display-mode"),
  supportOpacity: document.querySelector("#support-opacity"),
  supportPaintMode: document.querySelector("#support-paint-mode"),
  supportBrushRadius: document.querySelector("#support-brush-radius"),
  supportBlockCutsBase: document.querySelector("#support-block-cuts-base"),
  clearPaint: document.querySelector("#clear-paint"),
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
  jobProgressDetail: document.querySelector("#job-progress-detail"),
  splitProgress: document.querySelector("#split-progress"),
  splitProgressShell: document.querySelector("#split-progress-shell"),
  resolutionPrompt: document.querySelector("#resolution-prompt"),
  resolutionPromptText: document.querySelector("#resolution-prompt-text"),
  applyResolutionSuggestion: document.querySelector("#apply-resolution-suggestion"),
  dismissResolutionSuggestion: document.querySelector("#dismiss-resolution-suggestion"),
  cncBlockWidth: document.querySelector("#cnc-block-width"),
  cncBlockDepth: document.querySelector("#cnc-block-depth"),
  cncBlockHeightCell: document.querySelector("#cnc-block-height-cell"),
  cncBlockHeight: document.querySelector("#cnc-block-height"),
  cncResolution: document.querySelector("#cnc-resolution"),
  cncToolStickoutIn: document.querySelector("#cnc-tool-stickout-in"),
  cncBitDiameterIn: document.querySelector("#cnc-bit-diameter-in"),
  cncToolEnd: document.querySelector("#cnc-tool-end"),
  cncClearanceXy: document.querySelector("#cnc-clearance-xy"),
  cncClearanceZ: document.querySelector("#cnc-clearance-z"),
  cncAutoLift: document.querySelector("#cnc-auto-lift"),
  cncModelLift: document.querySelector("#cnc-model-lift"),
  cncAutoFingerHoles: document.querySelector("#cnc-auto-finger-holes"),
  cncFingerHoleDiameter: document.querySelector("#cnc-finger-hole-diameter"),
  cncAddFingerHole: document.querySelector("#cnc-add-finger-hole"),
  cncClearFingerHoles: document.querySelector("#cnc-clear-finger-holes"),
  cncSlabsEnabled: document.querySelector("#cnc-slabs-enabled"),
  cncSlabCount: document.querySelector("#cnc-slab-count"),
  cncSlabThicknessIn: document.querySelector("#cnc-slab-thickness-in"),
  cncDowelDiameterMm: document.querySelector("#cnc-dowel-diameter-mm"),
  cncDowelClearance: document.querySelector("#cnc-dowel-clearance"),
  cncGenerate: document.querySelector("#cnc-generate"),
  cncAutoFit: document.querySelector("#cnc-auto-fit"),
  cncClear: document.querySelector("#cnc-clear"),
  cncStatus: document.querySelector("#cnc-status"),
  exportCncStl: document.querySelector("#export-cnc-stl"),
  exportCncSlabStls: document.querySelector("#export-cnc-slab-stls"),
  exportCncSlabManifest: document.querySelector("#export-cnc-slab-manifest"),
};

const outputs = {
  elevation: document.querySelector("#elevation-value"),
  supportThresholdAngle: document.querySelector("#support-threshold-angle-value"),
  supportTopZDistance: document.querySelector("#support-top-z-distance-value"),
  supportObjectXYDistance: document.querySelector("#support-object-xy-distance-value"),
  supportEdgeClearance: document.querySelector("#support-edge-clearance-value"),
  cradleResolutionProfile: document.querySelector("#cradle-resolution-profile-value"),
  treeSupportBranchDistance: document.querySelector("#tree-support-branch-distance-value"),
  treeSupportBranchAngle: document.querySelector("#tree-support-branch-angle-value"),
  baseMargin: document.querySelector("#base-margin-value"),
  baseThickness: document.querySelector("#base-thickness-value"),
  columnTaperAngle: document.querySelector("#column-taper-angle-value"),
  splitBuildMargin: document.querySelector("#split-build-margin-value"),
  splitConnectorClearance: document.querySelector("#split-connector-clearance-value"),
  splitConnectorSize: document.querySelector("#split-connector-size-value"),
  supportOpacity: document.querySelector("#support-opacity-value"),
  supportBrushRadius: document.querySelector("#support-brush-radius-value"),
  cncStickout: document.querySelector("#cnc-stickout-value"),
  cncResolution: document.querySelector("#cnc-resolution-value"),
  cncBitDiameter: document.querySelector("#cnc-bit-diameter-value"),
  cncBlockHeight: document.querySelector("#cnc-block-height-value"),
  cncModelLift: document.querySelector("#cnc-model-lift-value"),
  cncSlabThickness: document.querySelector("#cnc-slab-thickness-value"),
};

const state = {
  modelMesh: null,
  modelVisible: true,
  gridVisible: true,
  modelDisplayMode: "solid",
  sourceGeometry: null,
  supportMesh: null,
  interfaceMesh: null,
  supportDisplayMode: "solid",
  supportOpacity: 1,
  coverage: null,
  coverageVisible: false,
  splitChunks: [],
  splitPreviewVisible: false,
  splitPlan: null,
  manualSupportMode: false,
  manualSupports: [],
  supportMarkerObjects: new Map(),
  nextManualId: 1,
  supportPaintMode: "off",
  paintStrokeActive: false,
  paintStrokePointerId: null,
  paintMoveFrame: null,
  pendingPaintEvent: null,
  lastPaintWorldPoint: null,
  workflowMode: "print",
  cncMesh: null,
  cncQa: null,
  cncSlabs: [],
  cncSlabPlan: null,
  cncFingerHoles: [],
  cncFingerHoleMode: false,
  cncBusy: false,
  modelPayloadCache: null,
  modelManifoldCache: null,
  modelQaCache: null,
  modelCenterOfMassCache: null,
  modelManifoldPrewarmToken: 0,
  modelManifoldPrewarmTimer: null,
  modelTrimPrewarmToken: 0,
  modelTrimPrewarmTimer: null,
  modelTrimPrewarmPromise: null,
  modelTrimPrewarmKey: "",
  draftSupportCache: null,
  modelRevision: 0,
  generationBusy: false,
  generationToken: 0,
  resolutionSuggestion: null,
  printCradleSafety: {
    exportable: false,
    reason: "High accuracy has not been run for this cradle.",
  },
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
orbit.mouseButtons = {
  LEFT: THREE.MOUSE.ROTATE,
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.PAN,
};
orbit.target.set(0, 0, 0);

let pendingInteractiveReanchorFrame = 0;
let orientationHelperActive = false;
const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode("rotate");
transformControls.setSpace("world");
transformControls.enabled = false;
const transformHelper = typeof transformControls.getHelper === "function" ? transformControls.getHelper() : transformControls;
transformHelper.visible = false;
scene.add(transformHelper);

transformControls.addEventListener("dragging-changed", (event) => {
  orbit.enabled = !event.value;
  if (!event.value) {
    reanchorModelAfterInteractiveTransform();
  }
});

transformControls.addEventListener("objectChange", () => {
  clearGeneratedSupport();
  clearCncFingerHoleMarks();
  clearCncPreview();
  invalidateModelPayloadCache();
  reanchorModelAfterInteractiveTransform();
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
raycaster.firstHitOnly = true;
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
const cncSlabPalette = [
  0x8fb6d9,
  0x9acb8f,
  0xd8c46e,
  0xc99aa5,
  0x9b8fcb,
  0xd39a6a,
  0x7dbfb7,
  0xb7c87a,
];
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
const materialCncMarker = new THREE.MeshBasicMaterial({
  color: 0x2f66b1,
  transparent: true,
  opacity: 0.76,
  side: THREE.DoubleSide,
  depthWrite: false,
});

const materialMarkerManual = new THREE.MeshStandardMaterial({ color: 0xf1c453, roughness: 0.58 });
const materialMarkerEnforce = new THREE.MeshBasicMaterial({
  color: 0x35d56f,
  transparent: true,
  opacity: 0.72,
  side: THREE.DoubleSide,
  depthWrite: false,
});
const materialMarkerBlock = new THREE.MeshBasicMaterial({
  color: 0xff4f4a,
  transparent: true,
  opacity: 0.72,
  side: THREE.DoubleSide,
  depthWrite: false,
});
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
  controlsEl.supportDisplayMode?.addEventListener("change", () => {
    applySupportDisplayMode(controlsEl.supportDisplayMode.value);
    updateButtons();
  });
  controlsEl.supportOpacity?.addEventListener("input", () => {
    applySupportOpacity(Number(controlsEl.supportOpacity.value) / 100);
    updateOutputs();
  });
  controlsEl.supportPaintMode?.addEventListener("change", () => {
    state.supportPaintMode = controlsEl.supportPaintMode.value || "off";
    if (state.supportPaintMode !== "off") {
      state.manualSupportMode = false;
    }
    updateManualMarkers();
    updateButtons();
  });
  controlsEl.supportBrushRadius?.addEventListener("input", () => updateOutputs());
  controlsEl.clearPaint?.addEventListener("click", () => clearPaintedCoverageMarks());
  controlsEl.orientModel.addEventListener("click", () => toggleOrientationHelper());
  controlsEl.resetOrientation.addEventListener("click", () => resetOrientation());
  controlsEl.generateSupports.addEventListener("click", () => {
    preparePrintCradleGeneration();
    void showWasmPending({ accuracy: "fast" });
  });
  controlsEl.generateMediumAccuracySupports?.addEventListener("click", () => {
    preparePrintCradleGeneration();
    void showWasmPending({ accuracy: "medium" });
  });
  controlsEl.generateHighAccuracySupports?.addEventListener("click", () => {
    preparePrintCradleGeneration();
    void showWasmPending({ accuracy: "high" });
  });
  controlsEl.cancelCradleGeneration?.addEventListener("click", cancelCradleGeneration);
  controlsEl.toggleCoverage?.addEventListener("click", () => toggleCoverageOverlay());
  controlsEl.clearManual?.addEventListener("click", () => {
    state.manualSupports = state.manualSupports.filter((support) => support.source === "paint_enforce" || support.source === "paint_block");
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
  controlsEl.exportCncSlabStls?.addEventListener("click", () => exportCncSlabStls());
  controlsEl.exportCncSlabManifest?.addEventListener("click", () => exportCncSlabManifest());
  controlsEl.cncAddFingerHole?.addEventListener("click", () => {
    state.cncFingerHoleMode = !state.cncFingerHoleMode;
    renderer.domElement.style.cursor = state.cncFingerHoleMode ? "crosshair" : "";
    setCncStatus(
      state.cncFingerHoleMode
        ? "Finger-hole add mode on; click the CNC cavity margin after previewing."
        : "Finger-hole add mode off.",
      state.cncFingerHoleMode ? "pending" : "idle"
    );
    updateButtons();
  });
  controlsEl.cncClearFingerHoles?.addEventListener("click", () => {
    state.cncFingerHoles = [];
    state.cncFingerHoleMode = false;
    clearCncPreview();
    setCncStatus("Manual finger holes cleared. Preview CNC foam to rebuild.", "pending");
    updateButtons();
  });
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
      restoreOriginalCradleAfterSplitFailure();
      setSplitStatus(`Split preview failed: ${error?.message || error}`, "error");
      setSplitProgress(100);
      updateButtons();
    });
  });
  controlsEl.clearSplit?.addEventListener("click", () => clearSplitPreview());
  controlsEl.exportSplitStls?.addEventListener("click", () => exportSplitStls());
  controlsEl.exportSplitManifest?.addEventListener("click", () => exportSplitManifest());
  controlsEl.splitPlatePreset?.addEventListener("change", () => applySplitPlatePreset());
  controlsEl.applyResolutionSuggestion?.addEventListener("click", () => applyResolutionSuggestion());
  controlsEl.dismissResolutionSuggestion?.addEventListener("click", () => clearResolutionPrompt());
  for (const input of controlsEl.cradleResolutionProfiles) {
    input.addEventListener("change", () => {
      if (input.checked) applyCradleResolutionProfile(input.value);
    });
  }
  controlsEl.interfaceEnabled?.addEventListener("change", () => {
    if (controlsEl.interfaceEnabled.checked && Number(controlsEl.supportInterfaceTopLayers.value) <= 0) {
      controlsEl.supportInterfaceTopLayers.value = "2";
    }
    syncOptionPanels();
    clearGeneratedSupport();
    scheduleModelTrimWorkerPrewarm();
    updateButtons();
  });
  controlsEl.foamGapEnabled?.addEventListener("change", () => {
    syncOptionPanels();
    clearGeneratedSupport();
    scheduleModelTrimWorkerPrewarm();
    updateButtons();
  });

  for (const input of [
    controlsEl.elevation,
    controlsEl.supportThresholdAngle,
    controlsEl.supportTopZDistance,
    controlsEl.supportObjectXYDistance,
    controlsEl.supportEdgeClearance,
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
    controlsEl.columnTaperAngle,
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
    controlsEl.cncClearanceXy,
    controlsEl.cncClearanceZ,
    controlsEl.cncModelLift,
    controlsEl.cncAutoFingerHoles,
    controlsEl.cncFingerHoleDiameter,
    controlsEl.cncSlabsEnabled,
    controlsEl.cncSlabCount,
    controlsEl.cncSlabThicknessIn,
    controlsEl.cncDowelDiameterMm,
    controlsEl.cncDowelClearance,
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
        input === controlsEl.cncClearanceXy ||
        input === controlsEl.cncClearanceZ ||
        input === controlsEl.cncModelLift ||
        input === controlsEl.cncAutoFingerHoles ||
        input === controlsEl.cncFingerHoleDiameter ||
        input === controlsEl.cncSlabsEnabled ||
        input === controlsEl.cncSlabCount ||
        input === controlsEl.cncSlabThicknessIn ||
        input === controlsEl.cncDowelDiameterMm ||
        input === controlsEl.cncDowelClearance
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
      if (isPrintTrimClearanceInput(input)) scheduleModelTrimWorkerPrewarm();
      updateManualMarkers();
      updateButtons();
    });
  }

  for (const input of [
    controlsEl.supportType,
    controlsEl.supportStyle,
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
  renderer.domElement.addEventListener("pointermove", onPointerMove);
  renderer.domElement.addEventListener("pointerup", onPointerUp);
  renderer.domElement.addEventListener("pointerleave", onPointerUp);
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
  state.modelRevision += 1;
  invalidateModelPayloadCache();
  state.modelMesh = new THREE.Mesh(geometry, materialModel);
  state.modelMesh.name = label;
  buildModelBoundsTree(state.modelMesh);
  modelGroup.add(state.modelMesh);
  applyModelDisplayMode("solid");

  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  const defaultElevation = Math.max(12, Math.min(80, Math.round(size.z * 0.28)));
  controlsEl.elevation.value = String(defaultElevation);

  state.manualSupports = [];
  clearCncFingerHoleMarks();
  state.nextManualId = 1;

  setOrientationHelper(false);
  applyModelTransform();
  frameObject();
  updateManualMarkers();
  updateOutputs();
  updateButtons();
  scheduleModelManifoldPrewarm();
  scheduleModelTrimWorkerPrewarm();
  modelStatus.textContent = `${label} loaded`;
}

function clearSceneModel() {
  disposeModelBoundsTree();
  modelGroup.clear();
  clearMeshGroup(supportGroup);
  clearMeshGroup(cncGroup);
  clearMeshGroup(splitGroup);
  clearMeshGroup(coverageGroup);
  markerGroup.clear();
  state.modelMesh = null;
  state.modelRevision += 1;
  state.modelVisible = true;
  state.modelDisplayMode = "solid";
  state.sourceGeometry = null;
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.printCradleSafety = {
    exportable: false,
    reason: "High accuracy has not been run for this cradle.",
  };
  state.cncMesh = null;
  state.cncQa = null;
  state.cncSlabs = [];
  state.cncSlabPlan = null;
  clearCncFingerHoleMarks();
  invalidateModelPayloadCache();
  clearModelTrimWorkerCache();
  state.coverage = null;
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  state.coverageVisible = false;
  state.manualSupportMode = false;
  state.supportPaintMode = "off";
  state.supportMarkerObjects.clear();
  setOrientationHelper(false);
  resetQaDashboard();
}

function buildModelBoundsTree(mesh) {
  if (!mesh?.geometry?.computeBoundsTree) return;
  const startedAt = performance.now();
  try {
    mesh.geometry.computeBoundsTree({
      strategy: CENTER,
      maxLeafSize: 24,
      verbose: false,
    });
    mesh.userData.bvhBuildMs = performance.now() - startedAt;
  } catch (error) {
    console.warn("Model BVH build failed; falling back to standard raycasting.", error);
    mesh.userData.bvhBuildMs = null;
  }
}

function disposeModelBoundsTree() {
  try {
    state.modelMesh?.geometry?.disposeBoundsTree?.();
  } catch (error) {
    console.warn("Model BVH disposal failed.", error);
  }
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
  if (!state.modelMesh) return false;
  let changed = false;
  if (state.workflowMode === "cnc") {
    changed = applyCncModelPlacement();
  } else {
    changed = applyElevation();
  }
  if (changed) {
    scheduleModelManifoldPrewarm();
    scheduleModelTrimWorkerPrewarm();
  }
  return changed;
}

function reanchorModelAfterInteractiveTransform() {
  if (!state.modelMesh) return;
  const changedNow = applyModelTransform();
  if (changedNow) {
    updateManualMarkers();
    transformControls.updateMatrixWorld(true);
  }
  if (pendingInteractiveReanchorFrame) {
    cancelAnimationFrame(pendingInteractiveReanchorFrame);
  }
  pendingInteractiveReanchorFrame = requestAnimationFrame(() => {
    pendingInteractiveReanchorFrame = 0;
    const changedLater = applyModelTransform();
    if (changedLater) {
      updateManualMarkers();
      transformControls.updateMatrixWorld(true);
    }
  });
}

function applyElevation() {
  if (!state.modelMesh) return false;
  const minZ = modelWorldGeometryMinZ(state.modelMesh);
  if (!Number.isFinite(minZ)) return false;
  const deltaZ = Number(controlsEl.elevation.value) - minZ;
  if (Math.abs(deltaZ) <= 1e-7) return false;
  state.modelMesh.position.z += deltaZ;
  state.modelMesh.updateMatrixWorld(true);
  invalidateModelPayloadCache();
  return true;
}

function modelWorldGeometryMinZ(mesh) {
  if (!mesh?.geometry?.attributes?.position) return NaN;
  mesh.updateMatrixWorld(true);
  const position = mesh.geometry.attributes.position;
  const elements = mesh.matrixWorld.elements;
  let minZ = Infinity;
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const worldZ = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
    if (worldZ < minZ) minZ = worldZ;
  }
  return minZ;
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
  if (state.workflowMode === "cnc" && state.cncFingerHoleMode) {
    event.preventDefault();
    addCncFingerHoleFromEvent(event);
    return;
  }
  if (!state.manualSupportMode && state.supportPaintMode === "off") return;

  if (state.supportPaintMode === "enforce" || state.supportPaintMode === "block" || state.supportPaintMode === "erase") {
    event.preventDefault();
    state.paintStrokeActive = true;
    state.paintStrokePointerId = event.pointerId;
    state.pendingPaintEvent = null;
    state.lastPaintWorldPoint = null;
    orbit.enabled = false;
    renderer.domElement.setPointerCapture?.(event.pointerId);
    if (state.supportPaintMode === "erase") {
      erasePaintMarksFromEvent(event);
    } else {
      addSurfacePaintMarkFromEvent(event, false);
    }
    return;
  }

  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  if (event.altKey || state.supportPaintMode === "erase") {
    const markerHits = raycaster.intersectObjects([...state.supportMarkerObjects.values()], false);
    if (markerHits.length) {
      const supportId = markerHits[0].object.userData.supportId;
      state.manualSupports = state.manualSupports.filter((support) => support.id !== supportId);
      updateManualMarkers();
      clearGeneratedSupport();
    }
    return;
  }

  const hits = raycaster.intersectObject(state.modelMesh, false);
  if (!hits.length) return;

  const hit = hits[0];
  const localPoint = state.modelMesh.worldToLocal(hit.point.clone());
  const localNormal = hit.face.normal.clone().normalize();
  const support = {
    id: `manual-${state.nextManualId++}`,
    source: "manual",
    localPoint,
    localNormal,
    radiusMm: supportBrushRadiusMm(),
  };
  state.manualSupports.push(support);
  clearGeneratedSupport();
  addManualMarker(support);
  updateButtons();
}

function isPrintTrimClearanceInput(input) {
  return input === controlsEl.supportTopZDistance ||
    input === controlsEl.supportObjectXYDistance ||
    input === controlsEl.supportInterfaceTopLayers ||
    input === controlsEl.supportInterfaceSpacing ||
    input === controlsEl.foamGapZ ||
    input === controlsEl.foamGapXY;
}

function onPointerMove(event) {
  if (!state.paintStrokeActive || event.pointerId !== state.paintStrokePointerId) return;
  event.preventDefault();
  schedulePaintMove(event);
}

function onPointerUp(event) {
  if (!state.paintStrokeActive) return;
  if (state.paintStrokePointerId !== null && event.pointerId !== state.paintStrokePointerId) return;
  flushPendingPaintMove();
  state.paintStrokeActive = false;
  state.paintStrokePointerId = null;
  state.pendingPaintEvent = null;
  state.lastPaintWorldPoint = null;
  renderer.domElement.releasePointerCapture?.(event.pointerId);
  orbit.enabled = !transformControls.enabled;
}

function addCncFingerHoleFromEvent(event) {
  if (state.cncBusy) {
    setCncStatus("CNC preview is rebuilding. Please wait for it to finish before adding another finger hole.", "working");
    return false;
  }
  if (!state.modelMesh || !state.cncQa) {
    setCncStatus("Preview CNC foam first, then click near the cavity margin to add a finger hole.", "pending");
    return false;
  }
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(cncGroup.children, true);
  if (!hits.length) {
    setCncStatus("Click on or near the CNC foam surface to place a finger hole.", "pending");
    return false;
  }

  const point = hits[0].point;
  state.cncFingerHoles.push({
    id: `finger-${state.cncFingerHoles.length + 1}`,
    x: roundedCoordinate(point.x),
    y: roundedCoordinate(point.y),
  });
  state.cncFingerHoleMode = false;
  setCncStatus("Finger hole added; rebuilding CNC preview. Keep this view open and wait...", "working");
  generateCncFoamPreview({
    keepExistingPreview: true,
    initialStatus: "Finger hole added; rebuilding CNC preview. Keep this view open and wait...",
  }).catch((error) => {
    console.error(error);
    setCncStatus(`CNC preview failed after finger-hole placement: ${error?.message || error}`, "error");
    updateButtons();
  });
  updateButtons();
  return true;
}

function snapshotPaintEvent(event) {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
  };
}

function schedulePaintMove(event) {
  state.pendingPaintEvent = snapshotPaintEvent(event);
  if (state.paintMoveFrame !== null) return;
  state.paintMoveFrame = window.requestAnimationFrame(() => {
    state.paintMoveFrame = null;
    flushPendingPaintMove();
  });
}

function flushPendingPaintMove() {
  const event = state.pendingPaintEvent;
  state.pendingPaintEvent = null;
  if (!event || !state.paintStrokeActive || event.pointerId !== state.paintStrokePointerId) return;

  if (state.supportPaintMode === "erase") {
    erasePaintMarksFromEvent(event);
  } else {
    addSurfacePaintMarkFromEvent(event, true);
  }
}

function addSurfacePaintMarkFromEvent(event, skipCloseMarks = true) {
  if (!state.modelMesh || (state.supportPaintMode !== "enforce" && state.supportPaintMode !== "block")) return false;
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(state.modelMesh, false);
  if (!hits.length) return false;

  const hit = hits[0];
  const radiusMm = supportBrushRadiusMm();
  const spacingMm = Math.max(0.75, radiusMm * 0.35);
  if (skipCloseMarks && state.lastPaintWorldPoint && hit.point.distanceTo(state.lastPaintWorldPoint) < spacingMm) {
    return false;
  }

  state.lastPaintWorldPoint = hit.point.clone();
  const localPoint = state.modelMesh.worldToLocal(hit.point.clone());
  const localNormal = hit.face.normal.clone().normalize();
  const support = {
    id: `paint-${state.nextManualId++}`,
    source: state.supportPaintMode === "block" ? "paint_block" : "paint_enforce",
    localPoint,
    localNormal,
    radiusMm,
  };
  state.manualSupports.push(support);
  clearGeneratedSupport();
  addManualMarker(support);
  updateButtons();
  return true;
}

function erasePaintMarksFromEvent(event) {
  if (!state.modelMesh) return false;
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(state.modelMesh, false);
  if (!hits.length) return false;

  const brushRadiusMm = supportBrushRadiusMm();
  const center = hits[0].point;
  const before = state.manualSupports.length;
  const realized = realizedManualSupports();
  const removeIds = new Set(
    realized
      .filter((support) =>
        (support.source === "paint_enforce" || support.source === "paint_block") &&
        support.worldPoint.distanceTo(center) <= Math.max(brushRadiusMm, support.radiusMm || brushRadiusMm)
      )
      .map((support) => support.id)
  );
  if (!removeIds.size) return false;

  state.manualSupports = state.manualSupports.filter((support) => !removeIds.has(support.id));
  if (state.manualSupports.length !== before) {
    clearGeneratedSupport();
    updateManualMarkers();
    return true;
  }
  return false;
}

function setPointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function supportBrushDiameterMm() {
  return Math.max(1, Math.min(100, Number(controlsEl.supportBrushRadius?.value) || 4));
}

function supportBrushRadiusMm() {
  return supportBrushDiameterMm() * 0.5;
}

function preparePrintCradleGeneration() {
  state.supportPaintMode = "off";
  if (controlsEl.supportPaintMode) controlsEl.supportPaintMode.value = "off";
  state.paintStrokeActive = false;
  state.paintStrokePointerId = null;
  state.pendingPaintEvent = null;
  state.lastPaintWorldPoint = null;
  updateManualMarkers();
}

function markPrintCradleStale(reason) {
  state.printCradleSafety = {
    exportable: false,
    reason,
  };
  updateButtons();
}

function assertGenerationCurrent(token, revision) {
  if (token !== state.generationToken) {
    throw new Error("A newer cradle generation started; this result was discarded.");
  }
  if (revision !== state.modelRevision) {
    throw new Error("The model changed during cradle generation; please generate again.");
  }
}

function cancelCradleGeneration() {
  if (!state.generationBusy) return;
  state.generationToken += 1;
  state.generationBusy = false;
  cancelRunningModelTrimPrewarm();
  resetSupportCoreRuntime();
  markPrintCradleStale("Cradle generation was cancelled; no new output was accepted.");
  modelStatus.textContent = state.modelMesh ? "Ready" : "Load or import";
  supportStatus.textContent = "Generation cancelled";
  setJobStatus("Cradle generation cancelled.", "pending");
  setProgressDetail("The active worker was terminated; no partial result was used.");
  setJobProgress(0);
  controlsEl.generateSupports.textContent = "Generate cradle";
  if (controlsEl.generateMediumAccuracySupports) {
    controlsEl.generateMediumAccuracySupports.textContent = "Generate WebGPU clearance cradle";
  }
  if (controlsEl.generateHighAccuracySupports) {
    controlsEl.generateHighAccuracySupports.textContent = "Generate high accuracy cradle";
  }
  updateButtons();
}

function estimateSupportGridMemory(job, budgetOverride = null) {
  const bounds = job?.model?.bounds_mm ?? {};
  const size = bounds.size ?? [];
  const supportConfig = job?.support_config ?? {};
  const cradleConfig = job?.cradle_config ?? {};
  const requestedCellSize = Math.max(0.001, Number(supportConfig.contact_cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8);
  const taperAngleDeg = cradleConfig.column_taper_enabled === false
    ? 0
    : Math.max(0, Math.min(12, Number(cradleConfig.column_taper_angle_deg) || 0));
  const baseTop = cradleConfig.base_enabled === false ? 0 : Math.max(0, Number(cradleConfig.base_thickness_mm) || 0);
  const modelMaxZ = Number(bounds.max?.[2]);
  const taperRise = Math.max(0, (Number.isFinite(modelMaxZ) ? modelMaxZ : Number(size[2]) || 0) - baseTop);
  const taperReach = taperAngleDeg > 0
    ? taperRise * Math.tan(taperAngleDeg * Math.PI / 180)
    : 0;
  const taperGridReserve = taperReach > 0
    ? Math.ceil(taperReach / requestedCellSize) * requestedCellSize
    : 0;
  const margin =
    Math.max(0, Number(supportConfig.xy_distance_mm) || 0) +
    Math.max(0, Number(cradleConfig.base_margin_mm) || 0) +
    taperGridReserve +
    requestedCellSize;
  const width = Math.max(requestedCellSize, Number(size[0]) + margin * 2);
  const depth = Math.max(requestedCellSize, Number(size[1]) + margin * 2);
  const requestedCols = Math.max(1, Math.ceil(width / requestedCellSize));
  const requestedRows = Math.max(1, Math.ceil(depth / requestedCellSize));
  const requestedCells = requestedCols * requestedRows;
  const budget = Math.max(1, Number(budgetOverride ?? cradleConfig.max_contact_grid_cells ?? DEFAULT_SUPPORT_GRID_BUDGET_CELLS) || DEFAULT_SUPPORT_GRID_BUDGET_CELLS);
  let effectiveCellSize = requestedCellSize;
  if (requestedCells > budget) {
    effectiveCellSize = Math.sqrt(Math.max(1, width * depth) / budget);
  }
  const effectiveCols = Math.max(1, Math.ceil(width / effectiveCellSize));
  const effectiveRows = Math.max(1, Math.ceil(depth / effectiveCellSize));
  const effectiveCells = effectiveCols * effectiveRows;
  const triangleCount = Math.max(0, Number(job?.mesh?.triangle_count ?? job?.model?.triangle_count) || 0);
  const workerCount = estimateSupportWorkerCount(triangleCount, effectiveCells);
  const persistentGridBytes = effectiveCells * GRID_SCALAR_BYTES * 3;
  const temporaryGridBytes = effectiveCells * GRID_SCALAR_BYTES * Math.max(workerCount, workerCount * 2);
  const peakGridBytes = persistentGridBytes + temporaryGridBytes;
  const estimatedPeakBytes = Math.ceil(peakGridBytes * 1.25);
  return {
    budget,
    requestedCellSize,
    taperReach,
    taperGridReserve,
    effectiveCellSize,
    requestedCols,
    requestedRows,
    effectiveCols,
    effectiveRows,
    requestedCells,
    effectiveCells,
    triangleCount,
    workerCount,
    persistentGridBytes,
    temporaryGridBytes,
    peakGridBytes,
    estimatedPeakBytes,
    heapInitialBytes: WASM_INITIAL_MEMORY_BYTES,
    heapMaximumBytes: WASM_MAXIMUM_MEMORY_BYTES,
  };
}

function estimateSupportWorkerCount(triangleCount, gridCellCount) {
  if (!globalThis.crossOriginIsolated || triangleCount < 8000) return 1;
  const hardware = Math.max(1, Number(navigator.hardwareConcurrency) || 1);
  const byWork = Math.max(1, Math.floor(triangleCount / 8000));
  let byMemory = 8;
  if (gridCellCount >= 16000000) byMemory = 2;
  else if (gridCellCount >= 10000000) byMemory = 3;
  else if (gridCellCount >= 6000000) byMemory = 4;
  return Math.min(hardware, byWork, byMemory, 8);
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024 * 1024) return `${formatStatusNumber(value / (1024 * 1024 * 1024))} GB`;
  if (value >= 1024 * 1024) return `${formatStatusNumber(value / (1024 * 1024))} MB`;
  if (value >= 1024) return `${formatStatusNumber(value / 1024)} KB`;
  return `${formatStatusNumber(value)} B`;
}

function formatGridMemoryEstimate(plan, prefix = "Grid memory estimate") {
  if (!plan) return "";
  const effectiveText = Math.abs(plan.effectiveCellSize - plan.requestedCellSize) > 0.001
    ? `${formatStatusNumber(plan.effectiveCellSize)} mm effective from ${formatStatusNumber(plan.requestedCellSize)} mm requested`
    : `${formatStatusNumber(plan.effectiveCellSize)} mm`;
  const taperReserveText = plan.taperGridReserve > 0
    ? `, ${formatStatusNumber(plan.taperGridReserve)} mm taper/base perimeter reserve`
    : "";
  return `${prefix}: ${plan.effectiveCells.toLocaleString()} cells (${plan.effectiveCols.toLocaleString()} x ${plan.effectiveRows.toLocaleString()}) at ${effectiveText}${taperReserveText}, ${plan.workerCount} WASM worker${plan.workerCount === 1 ? "" : "s"}, about ${formatBytes(plan.estimatedPeakBytes)} peak grid memory inside a ${formatBytes(plan.heapMaximumBytes)} max WASM heap.`;
}

async function prepareSupportJobWithGridRetry(job, options = {}) {
  const accuracyMode = options.accuracyMode || "fast";
  if (accuracyMode !== "medium" && accuracyMode !== "high") {
    return await prepareSupportJob(job);
  }

  const requestedBudget = Number(job?.cradle_config?.max_contact_grid_cells) || (accuracyMode === "medium" ? MEDIUM_SUPPORT_GRID_BUDGET_CELLS : DEFAULT_SUPPORT_GRID_BUDGET_CELLS);
  const requestedPlan = estimateSupportGridMemory(job, requestedBudget);
  if (
    accuracyMode === "high" &&
    ENABLE_EXPERIMENTAL_TILED_HIGH_ACCURACY_SUPPORT_GENERATION &&
    shouldUseTiledSupportGeneration(job, requestedPlan, accuracyMode)
  ) {
    return await prepareTiledSupportJob(job, {
      ...options,
      accuracyMode,
      memoryPlan: requestedPlan,
    });
  }

  if (accuracyMode === "high") {
    return await prepareSupportJob(job);
  }

  const budgets = [requestedBudget, MEDIUM_SUPPORT_GRID_BUDGET_CELLS, 4000000]
    .filter((budget, index, list) => Number.isFinite(budget) && budget > 0 && list.indexOf(budget) === index);
  let lastError = null;

  for (let index = 0; index < budgets.length; index += 1) {
    const budget = budgets[index];
    const retryJob = {
      ...job,
      cradle_config: {
        ...(job.cradle_config ?? {}),
        max_contact_grid_cells: budget,
      },
    };

    try {
      const memoryPlan = estimateSupportGridMemory(retryJob, budget);
      await options.onAttempt?.(formatGridMemoryEstimate(memoryPlan, "Trying medium grid"));
      const result = await prepareSupportJob(retryJob);
      result._grid_memory_estimate = memoryPlan;
      if (index > 0) {
        result._medium_grid_retry_warning = `Medium accuracy grid was retried at a safer ${Math.round(budget).toLocaleString()}-cell budget after the larger grid exhausted the WASM runtime. ${formatGridMemoryEstimate(memoryPlan, "Retried grid estimate")}`;
        await options.onRetry?.(result._medium_grid_retry_warning);
      }
      return result;
    } catch (error) {
      lastError = error;
      if (!isRecoverableWasmAbort(error) || index === budgets.length - 1) break;
      resetSupportCoreRuntime();
      await options.onRetry?.(
        `Medium accuracy grid at ${Math.round(budget).toLocaleString()} cells exhausted the WASM runtime; retrying with a safer grid budget...`
      );
    }
  }

  resetSupportCoreRuntime();
  throw lastError || new Error("Medium accuracy cradle generation failed.");
}

function reusableDraftSupportJobResult(job, accuracyMode) {
  if (accuracyMode !== "high") return null;
  const cache = state.draftSupportCache;
  if (!cache || cache.key !== draftSupportJobKey(job)) return null;
  return cloneSupportJobResult(cache.result);
}

function cacheDraftSupportJobResult(job, accuracyMode, result) {
  if (accuracyMode === "medium") return;
  if (!result?.support_mesh?.vertices?.length || !result?.support_mesh?.triangles?.length) return;
  state.draftSupportCache = {
    key: draftSupportJobKey(job),
    result: cloneSupportJobResult(result),
  };
}

function draftSupportJobKey(job) {
  return JSON.stringify(stableCacheValue({
    modelRevision: state.modelRevision,
    model: job?.model ?? null,
    supportConfig: job?.support_config ?? null,
    cradleConfig: job?.cradle_config ?? null,
    manualSupports: job?.manual_supports ?? [],
  }));
}

function cloneSupportJobResult(result) {
  if (typeof globalThis.structuredClone === "function") {
    try {
      return globalThis.structuredClone(result);
    } catch {
      // Fall through for older browser/WASM objects that structuredClone rejects.
    }
  }
  return cloneCacheValue(result);
}

function cloneCacheValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value)) {
    return value.slice ? value.slice() : new value.constructor(value);
  }
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (Array.isArray(value)) return value.map(cloneCacheValue);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneCacheValue(entry)]));
}

function stableCacheValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value)) return Array.from(value);
  if (Array.isArray(value)) return value.map(stableCacheValue);
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableCacheValue(value[key])])
  );
}

function shouldUseTiledSupportGeneration(job, memoryPlan, accuracyMode) {
  if (typeof Worker !== "function") return false;
  if (accuracyMode !== "medium" && accuracyMode !== "high") return false;
  const requestedCells = Number(memoryPlan?.requestedCells) || 0;
  const triangleCount = Number(memoryPlan?.triangleCount) || 0;
  return requestedCells > 10000000 && triangleCount > 0;
}

async function prepareTiledSupportJob(job, options = {}) {
  const memoryPlan = options.memoryPlan ?? estimateSupportGridMemory(job, job?.cradle_config?.max_contact_grid_cells);
  const tiles = buildSupportGenerationTiles(job, memoryPlan);
  if (tiles.length <= 1) return await prepareSupportJob(job);

  const concurrency = Math.max(1, Math.min(tiles.length, TILED_SUPPORT_MAX_CONCURRENCY));
  await options.onAttempt?.(
    `Running tiled ${options.accuracyMode || "medium"} support generation: ${tiles.length.toLocaleString()} independent WASM tile${tiles.length === 1 ? "" : "s"} at ${formatStatusNumber(memoryPlan.requestedCellSize)} mm requested resolution (${concurrency} concurrent).`
  );

  const startedAt = performance.now();
  const pieces = [];
  let completed = 0;
  let nextTileIndex = 0;
  const workerTimings = [];

  const runNext = async () => {
    while (nextTileIndex < tiles.length) {
      const tile = tiles[nextTileIndex];
      nextTileIndex += 1;
      const tileJob = buildSupportTileJob(job, tile);
      if (!tileJob) {
        completed += 1;
        continue;
      }
      const result = await prepareSupportJobInIsolatedWorker(tileJob, {
        timeoutMs: 240000,
        initialMemoryCandidates: TILED_SUPPORT_WORKER_MEMORY_CANDIDATES,
      });
      pieces.push({
        tile,
        result: cropSupportTileResult(result, tile, memoryPlan.requestedCellSize),
      });
      if (result?._runtime?.workerTimings?.length) workerTimings.push(...result._runtime.workerTimings);
      completed += 1;
      await options.onAttempt?.(
        `Completed tiled support generation ${completed.toLocaleString()} / ${tiles.length.toLocaleString()} (${tile.id}).`
      );
    }
  };

  await Promise.all(Array.from({ length: concurrency }, runNext));
  if (!pieces.length) throw new Error("Tiled support generation produced no support tiles.");

  const merged = mergeTiledSupportResults(pieces, job, tiles, memoryPlan);
  merged._grid_memory_estimate = {
    ...memoryPlan,
    tiled: true,
    tile_count: tiles.length,
    tile_worker_concurrency: concurrency,
  };
  merged._runtime = {
    ...(merged._runtime ?? {}),
    worker: true,
    isolatedTiledWorkers: true,
    tileCount: tiles.length,
    tileWorkerConcurrency: concurrency,
    workerTimings,
    tiledMs: performance.now() - startedAt,
  };
  merged._medium_grid_retry_warning = `Used ${tiles.length.toLocaleString()} independent WASM support-generation tiles to keep the requested ${formatStatusNumber(memoryPlan.requestedCellSize)} mm cradle grid out of the single-WASM 4 GB heap limit.`;
  await options.onRetry?.(merged._medium_grid_retry_warning);
  return merged;
}

function buildSupportGenerationTiles(job, memoryPlan) {
  const domain = supportGridDomain(job);
  const requestedCells = Math.max(1, Number(memoryPlan?.requestedCells) || 1);
  const targetCells = TILED_SUPPORT_TARGET_CELLS;
  const tileCount = Math.max(2, Math.ceil(requestedCells / targetCells));
  const aspect = Math.max(0.2, Math.min(5, domain.width / Math.max(domain.depth, 0.0001)));
  const xTiles = Math.max(1, Math.ceil(Math.sqrt(tileCount * aspect)));
  const yTiles = Math.max(1, Math.ceil(tileCount / xTiles));
  const halo = Math.max(
    24,
    Number(job?.support_config?.xy_distance_mm) || 0,
    Number(job?.cradle_config?.base_margin_mm) || 0,
    Number(memoryPlan?.requestedCellSize ?? 0.8) * 10
  );
  const tiles = [];
  const tileWidth = domain.width / xTiles;
  const tileDepth = domain.depth / yTiles;
  for (let yIndex = 0; yIndex < yTiles; yIndex += 1) {
    for (let xIndex = 0; xIndex < xTiles; xIndex += 1) {
      const core = {
        minX: domain.minX + xIndex * tileWidth,
        maxX: xIndex === xTiles - 1 ? domain.maxX : domain.minX + (xIndex + 1) * tileWidth,
        minY: domain.minY + yIndex * tileDepth,
        maxY: yIndex === yTiles - 1 ? domain.maxY : domain.minY + (yIndex + 1) * tileDepth,
      };
      const haloBounds = {
        minX: core.minX - halo,
        maxX: core.maxX + halo,
        minY: core.minY - halo,
        maxY: core.maxY + halo,
      };
      const requestedCols = Math.max(1, Math.ceil((core.maxX - core.minX) / memoryPlan.requestedCellSize));
      const requestedRows = Math.max(1, Math.ceil((core.maxY - core.minY) / memoryPlan.requestedCellSize));
      tiles.push({
        id: `T${xIndex + 1}-${yIndex + 1}`,
        xIndex,
        yIndex,
        core,
        halo: haloBounds,
        requestedCells: requestedCols * requestedRows,
      });
    }
  }
  return tiles;
}

function supportGridDomain(job) {
  const bounds = job?.model?.bounds_mm ?? {};
  const min = bounds.min ?? [0, 0, 0];
  const max = bounds.max ?? [0, 0, 0];
  const supportConfig = job?.support_config ?? {};
  const cradleConfig = job?.cradle_config ?? {};
  const cellSize = Math.max(0.001, Number(supportConfig.contact_cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8);
  const margin = Math.max(0, Number(supportConfig.xy_distance_mm) || 0) +
    Math.max(0, Number(cradleConfig.base_margin_mm) || 0) +
    cellSize;
  const minX = Number(min[0]) - margin;
  const minY = Number(min[1]) - margin;
  const maxX = Number(max[0]) + margin;
  const maxY = Number(max[1]) + margin;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(cellSize, maxX - minX),
    depth: Math.max(cellSize, maxY - minY),
  };
}

function buildSupportTileJob(job, tile) {
  const source = job?.mesh?.vertices ?? new Float32Array(0);
  const out = [];
  for (let index = 0; index + 8 < source.length; index += 9) {
    const minX = Math.min(source[index], source[index + 3], source[index + 6]);
    const maxX = Math.max(source[index], source[index + 3], source[index + 6]);
    const minY = Math.min(source[index + 1], source[index + 4], source[index + 7]);
    const maxY = Math.max(source[index + 1], source[index + 4], source[index + 7]);
    if (maxX < tile.halo.minX || minX > tile.halo.maxX || maxY < tile.halo.minY || minY > tile.halo.maxY) continue;
    for (let offset = 0; offset < 9; offset += 1) out.push(source[index + offset]);
  }
  if (!out.length) return null;
  const vertices = new Float32Array(out);
  const tileCells = Math.max(1200000, Math.min(TILED_SUPPORT_TILE_MAX_CELLS, Math.ceil(tile.requestedCells * 1.8)));
  return {
    ...job,
    mesh: {
      ...job.mesh,
      vertices,
      vertex_count: Math.floor(vertices.length / 3),
      triangle_count: Math.floor(vertices.length / 9),
      indexed_mesh: undefined,
    },
    manual_supports: (job.manual_supports ?? []).filter((support) =>
      support?.point?.[0] >= tile.halo.minX &&
      support?.point?.[0] <= tile.halo.maxX &&
      support?.point?.[1] >= tile.halo.minY &&
      support?.point?.[1] <= tile.halo.maxY
    ),
    cradle_config: {
      ...(job.cradle_config ?? {}),
      max_contact_grid_cells: tileCells,
    },
  };
}

function cropSupportTileResult(result, tile, cellSize) {
  return {
    ...result,
    support_mesh: cropSupportMeshToTileCore(result.support_mesh, tile.core, cellSize),
    interface_mesh: cropSupportMeshToTileCore(result.interface_mesh, tile.core, cellSize),
    coverage: cropCoverageToTileCore(result.coverage, tile.core),
  };
}

function cropSupportMeshToTileCore(mesh, core, cellSize) {
  if (!mesh?.vertices?.length || !mesh?.triangles?.length) return null;
  const vertices = [];
  const triangles = [];
  for (let index = 0; index + 2 < mesh.triangles.length; index += 3) {
    const a = readSupportVertex(mesh.vertices, mesh.triangles[index]);
    const b = readSupportVertex(mesh.vertices, mesh.triangles[index + 1]);
    const c = readSupportVertex(mesh.vertices, mesh.triangles[index + 2]);
    const cx = (a.x + b.x + c.x) / 3;
    const cy = (a.y + b.y + c.y) / 3;
    if (cx < core.minX || cx > core.maxX || cy < core.minY || cy > core.maxY) continue;
    const base = vertices.length / 3;
    vertices.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    triangles.push(base, base + 1, base + 2);
  }
  return {
    vertices: new Float32Array(vertices),
    triangles: new Uint32Array(triangles),
    vertex_count: Math.floor(vertices.length / 3),
    triangle_count: Math.floor(triangles.length / 3),
    cell_size_mm: cellSize,
  };
}

function cropCoverageToTileCore(coverage, core) {
  const cells = (coverage?.cells ?? []).filter((cell) =>
    Number(cell?.[0]) >= core.minX &&
    Number(cell?.[0]) <= core.maxX &&
    Number(cell?.[1]) >= core.minY &&
    Number(cell?.[1]) <= core.maxY
  );
  return {
    supported_cells: cells.filter((cell) => Boolean(cell?.[3])).length,
    unsupported_cells: cells.filter((cell) => !cell?.[3]).length,
    cells,
  };
}

function mergeTiledSupportResults(pieces, job, tiles, memoryPlan) {
  const results = pieces.map((piece) => piece.result).filter(Boolean);
  const supportMesh = mergeSupportMeshPieces(results.map((result) => result.support_mesh), memoryPlan.requestedCellSize);
  const interfaceMesh = mergeSupportMeshPieces(results.map((result) => result.interface_mesh), memoryPlan.requestedCellSize);
  const coverage = mergeTiledCoverage(results.map((result) => result.coverage));
  const support = mergeTiledSupportStats(results.map((result) => result.support), memoryPlan, tiles);
  const qa = mergeTiledQa(results.map((result) => result.qa));
  return {
    ...results[0],
    status: "support_mesh_generated",
    message: "Generated with independent tiled WASM support workers.",
    support,
    qa,
    coverage,
    support_mesh: supportMesh,
    interface_mesh: interfaceMesh,
    tree_layer_disks: { layers: [] },
  };
}

function mergeTiledCoverage(coverages) {
  const cells = [];
  const seen = new Set();
  let supported = 0;
  let unsupported = 0;
  for (const coverage of coverages) {
    supported += Number(coverage?.supported_cells) || 0;
    unsupported += Number(coverage?.unsupported_cells) || 0;
    for (const cell of coverage?.cells ?? []) {
      const key = `${Math.round(Number(cell[0]) * 1000)}:${Math.round(Number(cell[1]) * 1000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cells.length < 30000) cells.push(cell);
    }
  }
  return { supported_cells: supported, unsupported_cells: unsupported, cells };
}

function mergeTiledSupportStats(statsList, memoryPlan, tiles) {
  const out = {};
  const sumKeys = [
    "overhang_facets", "contact_cells", "envelope_cells", "pruned_sparse_cells",
    "pruned_small_island_cells", "closed_gap_cells", "base_cells", "bottom_join_cells",
    "column_taper_cells", "column_taper_seed_cells", "column_taper_added_volume_mm3", "column_components_before", "column_components_after",
    "interface_cells", "edge_clearance_removed_cells",
    "foam_gap_removed_cells", "manual_points", "manual_blocker_points",
    "manual_blocker_removed_cells", "tree_branches", "tree_tip_contacts",
    "tree_local_uprights", "tree_waypoint_branches", "tree_slope_reroutes", "tree_model_reroutes"
  ];
  for (const stats of statsList) {
    for (const key of sumKeys) out[key] = (out[key] ?? 0) + (Number(stats?.[key]) || 0);
  }
  out.column_taper_max_top_mm = Math.max(
    0,
    ...statsList.map((stats) => Number(stats?.column_taper_max_top_mm) || 0)
  );
  out.column_taper_step_drop_mm = Math.max(
    0,
    ...statsList.map((stats) => Number(stats?.column_taper_step_drop_mm) || 0)
  );
  out.column_taper_max_seed_rise_mm = Math.max(
    0,
    ...statsList.map((stats) => Number(stats?.column_taper_max_seed_rise_mm) || 0)
  );
  out.column_taper_max_theoretical_reach_mm = Math.max(
    0,
    ...statsList.map((stats) => Number(stats?.column_taper_max_theoretical_reach_mm) || 0)
  );
  out.column_taper_side_guard_mm = Math.max(
    0,
    ...statsList.map((stats) => Number(stats?.column_taper_side_guard_mm) || 0)
  );
  out.column_taper_grid_reserve_mm = Math.max(
    0,
    ...statsList.map((stats) => Number(stats?.column_taper_grid_reserve_mm) || 0)
  );
  const first = statsList.find(Boolean) ?? {};
  Object.assign(out, {
    ...first,
    ...out,
    effective_contact_cell_size_mm: memoryPlan.requestedCellSize,
    grid_cols: memoryPlan.requestedCols,
    grid_rows: memoryPlan.requestedRows,
    max_contact_grid_cells: memoryPlan.requestedCells,
    tiled_support_generation: true,
    tile_count: tiles.length,
  });
  return out;
}

function mergeTiledQa(qas) {
  const out = {};
  const sumKeys = ["intersection_cells", "downward_cells", "supported_downward_cells", "unsupported_downward_cells"];
  for (const qa of qas) {
    for (const key of sumKeys) out[key] = (out[key] ?? 0) + (Number(qa?.[key]) || 0);
    out.max_penetration_mm = Math.max(Number(out.max_penetration_mm) || 0, Number(qa?.max_penetration_mm) || 0);
    out.intersects_model = Boolean(out.intersects_model || qa?.intersects_model);
  }
  out.supported_downward_percent = out.downward_cells
    ? 100 * (Number(out.supported_downward_cells) || 0) / out.downward_cells
    : 0;
  return out;
}

function isRecoverableWasmAbort(error) {
  const message = error?.message || String(error || "");
  return /Aborted|RuntimeError|memory|out of memory|worker terminated/i.test(message);
}

async function showWasmPending(options = {}) {
  if (!state.modelMesh) return;
  if (state.generationBusy) {
    setJobStatus("Cradle generation is already running; please wait for it to finish.", "working");
    return;
  }
  const accuracyMode = options.accuracy || "fast";
  const highAccuracy = accuracyMode === "high";
  const mediumAccuracy = accuracyMode === "medium";
  const generationToken = state.generationToken + 1;
  const generationRevision = state.modelRevision;
  state.generationToken = generationToken;
  state.generationBusy = true;
  markPrintCradleStale("A new cradle generation is running; existing output should be treated as stale.");
  const activeButton = highAccuracy
    ? controlsEl.generateHighAccuracySupports
    : mediumAccuracy
      ? controlsEl.generateMediumAccuracySupports
      : controlsEl.generateSupports;
  const accuracyLabel = highAccuracy ? "high-accuracy" : mediumAccuracy ? "medium-accuracy" : "fast";

  setJobStatus(`Preparing ${accuracyLabel} Orca support job...`, "working");
  clearResolutionPrompt();
  setQaDashboard([
    { label: "Core", value: "Preparing", detail: "Packaging model", state: "working" },
    { label: "Coverage", value: "--", detail: "Waiting", state: "idle" },
    { label: "Intersections", value: "--", detail: "Waiting", state: "idle" },
    { label: "Stability", value: "--", detail: "Waiting", state: "idle" },
  ]);
  setJobProgress(4);
  supportStatus.textContent = "Checking WASM core";
  controlsEl.generateSupports.disabled = true;
  if (controlsEl.generateMediumAccuracySupports) controlsEl.generateMediumAccuracySupports.disabled = true;
  if (controlsEl.generateHighAccuracySupports) controlsEl.generateHighAccuracySupports.disabled = true;
  if (controlsEl.cancelCradleGeneration) {
    controlsEl.cancelCradleGeneration.hidden = false;
    controlsEl.cancelCradleGeneration.disabled = false;
  }
  if (activeButton) activeButton.textContent = "Checking core";
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
    assertGenerationCurrent(generationToken, generationRevision);
    markPhase("schema");
    setJobProgress(22);
    setJobStatus("Packaging model and support settings...", "working");
    await nextFrame();
    resetPhaseTimer();
    const job = buildSupportJobPayload({ accuracyMode });
    markPhase("package");
    const supportConfig = job.support_config;
    const cradleConfig = job.cradle_config;
    let generationRetryWarning = "";
    let gridMemoryEstimate = estimateSupportGridMemory(job, cradleConfig.max_contact_grid_cells);
    if (mediumAccuracy || highAccuracy) {
      setProgressDetail(formatGridMemoryEstimate(gridMemoryEstimate, `${mediumAccuracy ? "Medium" : "High accuracy"} grid estimate`));
    }
    const modelTrimClearance = modelBooleanClearanceSettings(supportConfig);
    const modelTrimDebug = highAccuracy
      ? MODEL_TRIM_DEBUG_SETTINGS
      : FAST_MODEL_TRIM_SETTINGS;
    let preferParallelManifold = highAccuracy &&
      !modelTrimDebug.targeted_minkowski &&
      shouldUseParallelManifoldForTrim();
    let preparedModelTrimPromise = null;
    if (
      highAccuracy &&
      canUseModelTrimWorker() &&
      (preferParallelManifold || expandedClearanceNeeded(modelTrimClearance))
    ) {
      cancelRunningModelTrimPrewarm();
    }
    if (
      highAccuracy &&
      canUseModelTrimWorker() &&
      !preferParallelManifold &&
      !modelTrimDebug.targeted_minkowski &&
      !expandedClearanceNeeded(modelTrimClearance)
    ) {
      preparedModelTrimPromise = getOrStartModelTrimWorkerPrewarm(modelTrimClearance, false)
        .catch((error) => {
          console.warn("High-accuracy model trim prewarm failed; trim will build the clearance solid on demand.", error);
          return null;
        });
    }
    const manualCount = realizedManualSupports().length;
    setJobProgress(34);
    resetPhaseTimer();
    let jobResult = reusableDraftSupportJobResult(job, accuracyMode);
    if (jobResult) {
      setJobStatus("Reusing matching draft cradle for high-accuracy trim...", "working");
      setProgressDetail("Draft cradle settings match the current model and controls; skipping WASM regeneration.");
      markPhase("reuse draft cradle");
      await nextFrame();
    } else {
      setJobStatus("Generating solid cradle in WASM...", "working");
      await nextFrame();
      jobResult = await prepareSupportJobWithGridRetry(job, {
        accuracyMode,
        onAttempt: async (message) => {
          setProgressDetail(message);
          await nextFrame();
        },
        onRetry: async (message) => {
          generationRetryWarning = message;
          setProgressDetail(message);
          setJobStatus(message, "working");
          await nextFrame();
        },
      });
      assertGenerationCurrent(generationToken, generationRevision);
      cacheDraftSupportJobResult(job, accuracyMode, jobResult);
      markPhase("WASM");
    }
    gridMemoryEstimate = jobResult._grid_memory_estimate ?? gridMemoryEstimate;
    if (jobResult.tree_layer_disks?.layers?.length && !jobResult._tree_union_complete) {
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
      assertGenerationCurrent(generationToken, generationRevision);
      if (jobResult.support) jobResult.support.tree_layered_solid = true;
      jobResult._tree_union_complete = true;
      markPhase("tree union");
    }
    cacheDraftSupportJobResult(job, accuracyMode, jobResult);
    setJobProgress(70);
    setJobStatus("Checking cradle clearance against object model...", "working");
    await nextFrame();
    let modelMeshQa = null;
    const hasInterfaceMesh = Boolean(jobResult.interface_mesh?.vertices?.length && jobResult.interface_mesh?.triangles?.length);
    const hasSupportMesh = Boolean(jobResult.support_mesh?.vertices?.length && jobResult.support_mesh?.triangles?.length);
    const canRunPretrimQa =
      !jobResult.qa?.intersects_model &&
      !Number(jobResult.qa?.clearance_violation_cells ?? 0) &&
      !hasInterfaceMesh &&
      hasSupportMesh;
    resetPhaseTimer();
    if (canRunPretrimQa) {
      modelMeshQa = evaluateGeneratedModelIntersectionQa(jobResult.support_mesh, { phase: "pretrim" });
      markPhase("pretrim QA");
    }

    const trimGateQa = hasSupportMesh
      ? evaluateExactTrimGateQa(jobResult.support_mesh, modelTrimClearance, {
          phase: highAccuracy ? "high" : mediumAccuracy ? "medium" : "fast",
        })
      : null;
    if (trimGateQa?.sampled_points) markPhase("BVH trim gate");
    let voxelClearanceQa = null;
    if (mediumAccuracy && hasSupportMesh) {
      setJobProgress(74);
      setJobStatus("Building medium interval-clearance cradle mesh...", "working");
      await nextFrame();
      resetPhaseTimer();
      const voxelResult = await buildVoxelBooleanCradleMesh(jobResult.support_mesh, modelTrimClearance, {
        phase: "medium",
        onProgress: async (progress, message) => {
          setJobProgress(74 + progress * 6);
          setJobStatus(message, "working");
          await nextFrame();
        },
      });
      assertGenerationCurrent(generationToken, generationRevision);
      jobResult.support_mesh = voxelResult.mesh;
      voxelClearanceQa = voxelResult.qa;
      modelMeshQa = null;
      setJobProgress(80);
      setJobStatus("Checking medium interval-clearance cradle mesh...", "working");
      await nextFrame();
      const surfaceVoxelClearanceQa = await evaluateVoxelClearanceQa(jobResult.support_mesh, modelTrimClearance, {
        onProgress: async (progress, message) => {
          setJobProgress(80 + progress * 4);
          setJobStatus(message, "working");
          await nextFrame();
        },
      });
      voxelClearanceQa = {
        ...voxelClearanceQa,
        surface_qa: surfaceVoxelClearanceQa,
        surface_inside_samples: surfaceVoxelClearanceQa.inside_samples,
        surface_clearance_violation_samples: surfaceVoxelClearanceQa.clearance_violation_samples,
        surface_min_distance_mm: surfaceVoxelClearanceQa.min_distance_mm,
      };
      markPhase("interval clearance mesh");
    }
    const shouldRunExactTrim = highAccuracy
      ? hasSupportMesh
      : mediumAccuracy
        ? false
        : Boolean(
          hasSupportMesh &&
          (!canRunPretrimQa || modelMeshQa?.needs_exact_trim)
        );
    const trimSkipReason = !hasSupportMesh
      ? "no generated cradle mesh was available for exact object trimming"
      : highAccuracy
        ? "no high-accuracy trim was requested"
        : mediumAccuracy
          ? "medium mode replaced the generator mesh with an interval-column clearance cradle; exact Manifold trim was not requested"
        : modelMeshQa?.intersects_model
          ? "sampled mesh QA found a possible object intersection but it did not require exact trim"
          : "fast mode kept the generator clearance because sampled mesh QA found no material object intersection";
    setJobProgress(76);
    setJobStatus(
      shouldRunExactTrim
        ? "Verifying object clearance and repairing if needed..."
        : mediumAccuracy && hasSupportMesh
          ? "Using medium interval-clearance cradle; exact object trim was not requested..."
        : hasSupportMesh
          ? "Using generator clearance; exact object trim not needed in fast mode..."
          : "No cradle mesh available for object trim...",
      "working"
    );
    await nextFrame();
    // Parallel Manifold is tested in the real trim request. A separate prepare
    // request can time out before the trim gets a fair chance to use it.
    const trimProgressTracker = shouldRunExactTrim
      ? createHighAccuracyTrimProgressTracker({
          startProgress: 76,
          endProgress: 87,
          clearance: modelTrimClearance,
          supportMesh: jobResult.support_mesh,
          preferParallelManifold,
          debug: modelTrimDebug,
          preparedClearanceKey: preparedModelTrimPromise ? state.modelTrimPrewarmKey : "",
        })
      : null;
    trimProgressTracker?.update(preparedModelTrimPromise
      ? "waiting for object clearance precompute"
      : "starting exact object clearance trim");
    const preparedModelTrim = shouldRunExactTrim && preparedModelTrimPromise
      ? await preparedModelTrimPromise
      : null;
    if (preparedModelTrim) trimProgressTracker?.update("cached model clearance solid");
    resetPhaseTimer();
    let trimmedMeshes = null;
    let exactTrimCompleted = false;
    try {
      trimmedMeshes = await trimGeneratedMeshesAgainstModel(
        jobResult.support_mesh,
        jobResult.interface_mesh,
        supportConfig,
        {
          skipExactTrim: !shouldRunExactTrim,
          skipReason: trimSkipReason,
          preparedClearanceKey: preparedModelTrim?.clearanceKey || "",
          preferParallelManifold,
          debug: modelTrimDebug,
          requireExactTrim: highAccuracy,
          onProgress: async (message) => {
            trimProgressTracker?.update(message);
            setJobStatus(`High accuracy object clearance: ${trimProgressTracker?.statusText(message) || `${message}...`}`, "working");
            await nextFrame();
          },
        }
      );
      assertGenerationCurrent(generationToken, generationRevision);
      exactTrimCompleted = shouldRunExactTrim
        ? Boolean(trimmedMeshes.trimmed || trimmedMeshes.certified || trimmedMeshes.certificate?.passed)
        : true;
      recordModelTrimEstimate(modelTrimClearance, preferParallelManifold, trimmedMeshes.timings);
    } finally {
      trimProgressTracker?.finish(exactTrimCompleted);
    }
    if (preparedModelTrim?.timings?.length) {
      trimmedMeshes.timings = [
        ...preparedModelTrim.timings.map((phase) => ({
          ...phase,
          label: `prepare ${phase.label}`,
        })),
        ...(trimmedMeshes.timings ?? []),
      ];
    }
    markPhase(shouldRunExactTrim ? "model trim" : "trim decision");
    setJobStatus("Rendering generated cradle...", "working");
    await nextFrame();
    assertGenerationCurrent(generationToken, generationRevision);
    resetPhaseTimer();
    renderGeneratedMeshes(trimmedMeshes.support_mesh, trimmedMeshes.interface_mesh);
    markPhase("render");
    setJobProgress(88);
    setJobStatus("Building coverage overlay and QA summary...", "working");
    await nextFrame();
    resetPhaseTimer();
    renderCoverageOverlay(jobResult.coverage);
    const meshAndStabilityQaPromise = evaluateCradleMeshAndStabilityQa(trimmedMeshes.support_mesh, jobResult.coverage);
    if (!modelMeshQa || trimmedMeshes.trimmed || trimmedMeshes.certified || trimmedMeshes.certificate?.passed) {
      try {
        modelMeshQa = evaluateGeneratedModelIntersectionQa(trimmedMeshes.support_mesh, { phase: "final" });
      } catch (error) {
        console.warn("Model intersection QA failed after cradle generation.", error);
        modelMeshQa = failedModelIntersectionQa(error);
      }
    }
    state.printCradleSafety = printCradleSafetyForGeneration({
      highAccuracy,
      mediumAccuracy,
      hasSupportMesh,
      trimmedMeshes,
      modelMeshQa,
      meshQa: null,
      voxelClearanceQa,
    });
    let meshAndStabilityQa;
    try {
      meshAndStabilityQa = await meshAndStabilityQaPromise;
    } catch (error) {
      console.warn("Cradle mesh/stability QA failed after cradle generation.", error);
      meshAndStabilityQa = {
        meshQa: failedMeshReachQa(error),
        stabilityQa: failedStabilityQa(error),
        timings: [],
        worker: false,
      };
    }
    let meshQa = meshAndStabilityQa.meshQa;
    if (mediumAccuracy) meshQa = adjustMediumIntervalMeshReachQa(meshQa, voxelClearanceQa);
    const stabilityQa = meshAndStabilityQa.stabilityQa;
    state.printCradleSafety = printCradleSafetyForGeneration({
      highAccuracy,
      mediumAccuracy,
      hasSupportMesh,
      trimmedMeshes,
      modelMeshQa,
      meshQa,
      voxelClearanceQa,
    });
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
    const columnTaperCellCount = jobResult.support?.column_taper_cells ?? 0;
    const columnTaperSeedCellCount = jobResult.support?.column_taper_seed_cells ?? 0;
    const columnTaperAngleDeg = Number(jobResult.support?.column_taper_angle_deg) || 0;
    const columnTaperStepDropMm = Number(jobResult.support?.column_taper_step_drop_mm) || 0;
    const columnTaperMaxReachMm = Number(jobResult.support?.column_taper_max_theoretical_reach_mm) || 0;
    const columnTaperSideGuardMm = Number(jobResult.support?.column_taper_side_guard_mm) || 0;
    const columnTaperGridReserveMm = Number(jobResult.support?.column_taper_grid_reserve_mm) || 0;
    const columnTaperAddedVolumeCm3 = (Number(jobResult.support?.column_taper_added_volume_mm3) || 0) / 1000;
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
    const nativeBlockerCount = jobResult.support?.manual_blocker_points ?? 0;
    const nativeBlockerRemovedCells = jobResult.support?.manual_blocker_removed_cells ?? 0;
    const treeMode = Boolean(jobResult.support?.tree_mode);
    const treeBranchCount = jobResult.support?.tree_branches ?? 0;
    const treeTipContactCount = jobResult.support?.tree_tip_contacts ?? 0;
    const treeLocalUprightCount = jobResult.support?.tree_local_uprights ?? 0;
    const treeWaypointBranchCount = jobResult.support?.tree_waypoint_branches ?? 0;
    const treeSlopeRerouteCount = jobResult.support?.tree_slope_reroutes ?? 0;
    const treeModelRerouteCount = jobResult.support?.tree_model_reroutes ?? 0;
    const requestedCellSize = Number(jobResult.support?.contact_cell_size_mm ?? supportConfig.contact_cell_size_mm ?? 0);
    const effectiveCellSize = Number(jobResult.support?.effective_contact_cell_size_mm ?? jobResult.support_mesh?.cell_size_mm ?? requestedCellSize);
    const gridCols = Number(jobResult.support?.grid_cols ?? 0);
    const gridRows = Number(jobResult.support?.grid_rows ?? 0);
    const resolutionText = Number.isFinite(effectiveCellSize) && effectiveCellSize > 0
      ? (Math.abs(effectiveCellSize - requestedCellSize) > 0.01
          ? ` Effective cradle resolution ${formatStatusNumber(effectiveCellSize)} mm (requested ${formatStatusNumber(requestedCellSize)} mm) over ${gridCols.toLocaleString()} x ${gridRows.toLocaleString()} cells.`
          : ` Cradle resolution ${formatStatusNumber(effectiveCellSize)} mm over ${gridCols.toLocaleString()} x ${gridRows.toLocaleString()} cells.`)
      : "";
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
    const meshQaText = meshQa.failed
      ? `Mesh QA warning: ${meshQa.reason || "mesh support reach QA could not complete"}.`
      : meshQa.sampled_cells
      ? (meshQa.clearance_adjusted
          ? `Mesh QA: interval clearance surface is intentionally below sampled underside targets; max clearance gap ${formatStatusNumber(meshQa.max_gap_mm)} mm is within the medium tolerance ${formatStatusNumber(meshQa.clearance_adjusted_tolerance_mm)} mm.`
          : meshQa.unsupported_cells
          ? `Mesh QA warning: printable cradle surface reaches only ${formatStatusNumber(meshQa.supported_percent)}% of sampled underside targets (${meshQa.supported_cells.toLocaleString()}/${meshQa.sampled_cells.toLocaleString()}); max support gap ${formatStatusNumber(meshQa.max_gap_mm)} mm.`
          : `Mesh QA: printable cradle surface reaches ${formatStatusNumber(meshQa.supported_percent)}% of sampled underside targets (${meshQa.supported_cells.toLocaleString()}/${meshQa.sampled_cells.toLocaleString()}); max support gap ${formatStatusNumber(meshQa.max_gap_mm)} mm.`)
      : "Mesh QA skipped because no underside target samples were available.";
    const qaClearanceText = Number(qa.clearance_violation_cells ?? 0)
      ? `${Number(qa.clearance_violation_cells ?? 0).toLocaleString()} cells are inside the requested clearance by up to ${formatStatusNumber(qa.max_clearance_violation_mm ?? 0)} mm.`
      : "Requested clearance is respected within grid tolerance.";
    const modelMeshQaText = formatGeneratedModelIntersectionQaStatus(modelMeshQa);
    const trimGateQaText = formatExactTrimGateQaStatus(trimGateQa);
    const voxelClearanceQaText = formatVoxelClearanceQaStatus(voxelClearanceQa);
    const trimClearanceText = `${formatStatusNumber(trimmedMeshes.clearance?.xy_mm ?? 0)} mm XY, ${formatStatusNumber(trimmedMeshes.clearance?.z_mm ?? 0)} mm Z requested`;
    const trimSafetyText = Number(trimmedMeshes.clearance?.safety_margin_mm ?? 0) > 0
      ? ` with ${formatStatusNumber(trimmedMeshes.clearance.safety_margin_mm)} mm conservative offset safety margin`
      : "";
    const certificatePassed = Boolean(trimmedMeshes.certified || trimmedMeshes.certificate?.passed);
    const postCertificatePassed = Boolean(trimmedMeshes.post_certificate?.passed);
    const highAccuracyVerified = Boolean(trimmedMeshes.trimmed || certificatePassed);
    const certificateGuardText = Number(trimmedMeshes.certificate?.axis_guard_mm ?? 0) > 0
      ? ` with ${formatStatusNumber(trimmedMeshes.certificate.axis_guard_mm)} mm numerical axis guard`
      : "";
    const finalCertificateText = trimmedMeshes.post_certificate?.attempted
      ? postCertificatePassed
        ? " Final continuous ellipsoidal clearance certificate passed."
        : ` Final continuous clearance diagnostic did not certify the repair (${trimmedMeshes.post_certificate.reason || "unknown reason"}).`
      : "";
    const kernelText = trimmedMeshes.kernel?.mode === CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE
      ? ` Corrected circumscribed kernel used ${trimmedMeshes.kernel.actual_triangles?.toLocaleString?.() || trimmedMeshes.kernel.actual_triangles || 0} faces at ${formatStatusNumber(trimmedMeshes.kernel.circumscription_scale)}x radial scale.`
      : "";
    const candidateText = trimmedMeshes.repair?.targeted_applied
      ? ` Target filtering retained ${Number(trimmedMeshes.repair.candidate_faces || 0).toLocaleString()} of ${Number(trimmedMeshes.repair.source_faces || 0).toLocaleString()} bounded model faces after ${Number(trimmedMeshes.repair.aabb_candidate_faces || trimmedMeshes.repair.candidate_faces || 0).toLocaleString()} AABB candidates.`
      : "";
    const targetedFallbackText = trimmedMeshes.repair?.targeted_requested &&
      !trimmedMeshes.repair?.targeted_applied &&
      trimmedMeshes.repair?.targeted_fallback_reason
      ? ` Target-aware repair fell back because ${trimmedMeshes.repair.targeted_fallback_reason}.`
      : "";
    const modelTrimText = trimmedMeshes.warning
      ? `Boolean model trim warning: ${trimmedMeshes.warning}`
      : certificatePassed
        ? `Continuous ellipsoidal object clearance certified (${trimClearanceText}${certificateGuardText}); the matching draft mesh was preserved unchanged.`
      : (trimmedMeshes.trimmed
          ? (trimmedMeshes.repair?.targeted_applied
              ? `Target-aware expanded object-clearance repair applied (${trimClearanceText}).${candidateText}${kernelText}${finalCertificateText}`
              : trimmedMeshes.clearance?.expanded
                ? `Expanded object-clearance boolean trim applied after generator clearance (${trimClearanceText}${trimSafetyText}).${targetedFallbackText}${kernelText}${finalCertificateText}`
                : `Exact object boolean trim applied after generator clearance (${trimClearanceText}; no expanded clearance volume was needed).${finalCertificateText}`)
          : trimmedMeshes.skipped
            ? `Exact object boolean trim skipped: ${trimmedMeshes.skip_reason}.`
            : "");
    const manifoldTrimRuntimeText = trimmedMeshes.runtime?.build
      ? ` Manifold trim runtime: ${trimmedMeshes.runtime.build}${trimmedMeshes.runtime.selected_parallel ? "." : trimmedMeshes.runtime.load_error ? `; parallel backend unavailable (${trimmedMeshes.runtime.load_error}) so exact trim used the serial worker backend.` : "; exact trim is isolated in a worker but this Manifold build is not internally parallel."}`
      : "";
    const generationAccuracyText = highAccuracy
      ? (certificatePassed
          ? " High accuracy mode proved continuous ellipsoidal object clearance without changing the draft; sampled BVH proximity remains diagnostic only."
          : postCertificatePassed
          ? " High accuracy mode repaired and then proved continuous ellipsoidal object clearance; sampled BVH proximity remains diagnostic only."
          : highAccuracyVerified
          ? (trimmedMeshes.kernel?.mode === CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE
              ? " High accuracy mode ran the corrected-kernel repair, but the final continuous certificate remained diagnostic and did not pass."
              : " High accuracy mode ran object-clearance boolean trimming; the final continuous certificate remains diagnostic while the legacy kernel is the default.")
          : " High accuracy object-clearance verification did not complete because no cradle mesh was available.")
      : mediumAccuracy
        ? " Medium accuracy generated a WebGPU/interval clearance cradle by subtracting inflated model/lift-lock intervals; exact object-clearance boolean trimming was not run."
      : " Fast mode used generator clearance with sampled mesh QA; run high accuracy before final printing.";
    const generationRetryText = generationRetryWarning ? ` ${generationRetryWarning}` : "";
    const gridMemoryText = gridMemoryEstimate
      ? ` ${formatGridMemoryEstimate(gridMemoryEstimate, "Grid memory estimate")}`
      : "";
    const printSafetyText = state.printCradleSafety.exportable
      ? ` Print export gate: ready for final STL/PLY export (${state.printCradleSafety.reason})`
      : ` Print export warning: ${state.printCradleSafety.reason} Export will ask for confirmation.`;
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
    const wasmHeapText = runtime.wasmInitialMemoryBytes
      ? `, ${formatBytes(runtime.wasmInitialMemoryBytes)} initial WASM heap`
      : "";
    const runtimeText = ` Runtime: support generation ${runtime.worker ? "worker" : "main thread"}${wasmBuildText}${wasmHeapText}${runtime.crossOriginIsolated ? ", pthread-ready page" : ", pthreads unavailable until server restart/headers are active"}.`;
    const wasmTimingText = formatWasmTimingText(jobResult.support?.timings_ms);
    const wasmOutputTimingText = formatWasmOutputTimingText(jobResult.top_level_timings_ms);
    const workerTimingText = formatWorkerTimingText(runtime.workerTimings);
    const qaWorkerTimingText = formatQaWorkerTimingText(qaWorkerTimings);
    const trimTimingText = formatTrimTimingText(trimmedMeshes.timings);
    const timingText = phaseTimings.length
      ? ` Timings: ${phaseTimings.map((phase) => `${phase.label} ${formatDurationMs(phase.ms)}`).join(", ")}.${wasmTimingText}${wasmOutputTimingText}${trimTimingText}${workerTimingText}${qaWorkerTimingText}`
      : "";
    const totalTriangleCount = supportTriangleCount + interfaceTriangleCount;
    const resolutionRecommendation = resolutionAdjustmentRecommendation({
      accuracyMode,
      requestedCellSize,
      effectiveCellSize,
      gridCols,
      gridRows,
      gridBudgetCells: Number(jobResult.support?.max_contact_grid_cells ?? cradleConfig.max_contact_grid_cells ?? 0),
      totalTriangleCount,
      contactCellCount,
      envelopeCellCount,
      prunedSparseCellCount,
      overhangFacetCount,
      meshQa,
      supportedDownwardPercent,
    });
    supportStatus.textContent = totalTriangleCount
      ? `${supportTriangleCount.toLocaleString()} cradle + ${interfaceTriangleCount.toLocaleString()} interface triangles`
      : `${manualCount} coverage marks`;
    updateGeneratedQaDashboard({
      supportTriangleCount,
      interfaceTriangleCount,
      supportedDownwardPercent,
      qa,
      meshQa,
      modelMeshQa,
      stabilityQa,
      resolutionRecommendation,
      effectiveCellSize,
      gridCols,
      gridRows,
      unsupportedCellCount,
      splitReady: totalTriangleCount > 0,
    });
    showResolutionPrompt(resolutionRecommendation);
    const cradleLabel = treeMode ? "original organic tree cradle" : "solid cradle";
    const cradleArticle = cradleLabel.startsWith("original") ? "an" : "a";
    setJobStatus(
      totalTriangleCount
        ? `Generated ${cradleArticle} ${cradleLabel} from ${contactCellCount.toLocaleString()} contact cells, including ${envelopeCellCount.toLocaleString()} underside-envelope cells, ${prunedSparseCellCount.toLocaleString()} sparse side/contact cells pruned, ${prunedSmallIslandCellCount.toLocaleString()} tiny island cells removed, ${baseCellCount.toLocaleString()} footprint base cells, ${bottomJoinCellCount.toLocaleString()} bottom-join cells, ${columnTaperCellCount.toLocaleString()} tapered structural cells from ${columnTaperSeedCellCount.toLocaleString()} contact-boundary seeds at ${columnTaperAngleDeg.toFixed(1)} deg (${columnTaperStepDropMm.toFixed(2)} mm lower per outward grid step, up to ${columnTaperMaxReachMm.toFixed(2)} mm theoretical base reach, ${columnTaperGridReserveMm.toFixed(2)} mm perimeter reserved for taper plus base, ${columnTaperSideGuardMm.toFixed(2)} mm conservative side guard, ${columnTaperAddedVolumeCm3.toFixed(2)} cm3 added), column components ${columnComponentsBefore.toLocaleString()} -> ${columnComponentsAfter.toLocaleString()}, ${closedGapCount.toLocaleString()} closed gaps, ${unsupportedCellCount.toLocaleString()} unsupported coverage cells, ${overhangFacetCount.toLocaleString()} overhang facets, ${nativeManualCount.toLocaleString()} manual/enforce marks, ${nativeBlockerCount.toLocaleString()} no-support marks removing ${nativeBlockerRemovedCells.toLocaleString()} cells, ${treeMode ? `${treeBranchCount.toLocaleString()} organic branches, ` : ""}${interfaceCellCount.toLocaleString()} soft-interface cells from ${interfaceLayers.toLocaleString()} interface layers, ${edgeRemovedCells.toLocaleString()} cells removed for a ${edgeClearance.toLocaleString()} mm support-free edge, and ${foamRemovedCells.toLocaleString()} cells removed for a ${foamGapZ.toLocaleString()} mm Z / ${foamGapXY.toLocaleString()} mm XY foam gap.${resolutionText} ${orcaTreeText} ${treeRoutingText} ${qaIntersectionText} ${qaCoverageText} ${meshQaText} ${modelTrimText}${generationAccuracyText}${generationRetryText}${manifoldTrimRuntimeText} ${trimGateQaText} ${voxelClearanceQaText} ${modelMeshQaText} ${stabilityQaText} ${qaClearanceText} ${printSafetyText} Prepared ${Object.keys(supportConfig).length}/${schema.length} Orca support settings and ${Object.keys(cradleConfig).length} cradle settings.${gridMemoryText}${runtimeText}${timingText}`
        : `No support regions found. Prepared ${Object.keys(supportConfig).length}/${schema.length} Orca support settings and ${Object.keys(cradleConfig).length} cradle settings.`,
      qa.intersects_model || meshQa.unsupported_cells || modelMeshQa.needs_exact_trim || meshQa.failed || modelMeshQa.failed || stabilityQa.severity === "error" || (highAccuracy && !state.printCradleSafety.exportable) ? "error" : "pending"
    );
    setJobProgress(100);
  } catch (error) {
    if (generationToken !== state.generationToken) return;
    console.error("Cradle generation failed.", error);
    if (isRecoverableWasmAbort(error)) resetSupportCoreRuntime();
    if (generationToken === state.generationToken) {
      markPrintCradleStale(`Last cradle generation failed: ${error.message || error}`);
    }
    modelStatus.textContent = "Cradle generation failed";
    supportStatus.textContent = "Generation failed";
    setJobStatus(`Cradle generation failed: ${error.message}`, "error");
    setProgressDetail(`Generation stopped before completion: ${error.message || error}`);
    setJobProgress(0);
  } finally {
    if (generationToken === state.generationToken) {
      state.generationBusy = false;
      controlsEl.generateSupports.textContent = "Generate cradle";
      if (controlsEl.generateMediumAccuracySupports) {
        controlsEl.generateMediumAccuracySupports.textContent = "Generate WebGPU clearance cradle";
      }
      if (controlsEl.generateHighAccuracySupports) {
        controlsEl.generateHighAccuracySupports.textContent = "Generate high accuracy cradle";
      }
      updateButtons();
    }
  }
}

function renderGeneratedMeshes(supportMesh, interfaceMesh) {
  clearMeshGroup(supportGroup);
  clearMeshGroup(cncGroup);
  clearSplitPreview();
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.printCradleSafety = {
    exportable: false,
    reason: "Generation is still being verified.",
  };
  state.cncMesh = null;
  state.cncQa = null;

  applySupportMaterialOpacity();
  state.supportMesh = renderMeshPart(supportMesh, materialSupport, "Generated cradle solid");
  state.interfaceMesh = renderMeshPart(interfaceMesh, materialInterface, "Generated interface solid");
  supportGroup.visible = state.supportDisplayMode !== "hidden";
  updateButtons();
}

function createHighAccuracyTrimProgressTracker({
  startProgress = 76,
  endProgress = 87,
  clearance = {},
  supportMesh = null,
  preferParallelManifold = false,
  debug = MODEL_TRIM_DEBUG_SETTINGS,
  preparedClearanceKey = "",
} = {}) {
  const startedAt = performance.now();
  const estimateHadHistory = Boolean(readModelTrimEstimate(
    modelTrimClearanceKey(null, clearance, preferParallelManifold, debug)
  ));
  const clearanceEstimateSource = estimateHadHistory ? "previous run" : "rough estimate";
  const stages = {
    start: { label: "Starting high accuracy clearance", from: 0.00, to: 0.05, estimateMs: 2500 },
    wait: { label: "Finishing object clearance precompute", from: 0.05, to: 0.74, estimateMs: modelTrimEstimateMs(clearance, preferParallelManifold, supportMesh, debug), estimateSource: clearanceEstimateSource },
    load: { label: "Loading Manifold", from: 0.05, to: 0.10, estimateMs: 4500 },
    certificate: { label: "Checking continuous object clearance", from: 0.10, to: 0.22, estimateMs: 1500 },
    filter: { label: "Filtering model faces near the cradle", from: 0.22, to: 0.34, estimateMs: 1200 },
    clearance: {
      label: debug?.targeted_minkowski
        ? "Applying streamed object clearance"
        : "Building expanded object clearance solid",
      from: 0.34,
      to: 0.74,
      estimateMs: modelTrimEstimateMs(clearance, preferParallelManifold, supportMesh, debug),
      estimateSource: clearanceEstimateSource,
    },
    cached: { label: "Using cached object clearance solid", from: 0.70, to: 0.76, estimateMs: 600 },
    trim: { label: "Trimming cradle mesh", from: 0.74, to: 0.90, estimateMs: trimMeshEstimateMs(supportMesh) },
    finalCertificate: { label: "Certifying repaired clearance", from: 0.90, to: 0.97, estimateMs: trimMeshEstimateMs(supportMesh) },
    witnessRepair: { label: "Repairing localized clearance witnesses", from: 0.92, to: 0.985, estimateMs: 0 },
    pack: { label: "Packing trimmed mesh", from: 0.97, to: 0.99, estimateMs: 1200 },
    done: { label: "High accuracy clearance complete", from: 0.99, to: 1.00, estimateMs: 200 },
  };
  let stageName = preparedClearanceKey ? "wait" : "start";
  let stageStartedAt = startedAt;
  let lastMessage = "";
  let lastProgressValue = startProgress;
  let reportedStageFraction = 0;
  let projectedStageDurationMs = 0;
  let active = true;

  const setStage = (nextStageName, message = "") => {
    if (!stages[nextStageName] || stageName === nextStageName) return;
    stageName = nextStageName;
    stageStartedAt = performance.now();
    reportedStageFraction = 0;
    projectedStageDurationMs = 0;
    lastMessage = message || lastMessage;
    tick();
  };

  const messageToStage = (message = "") => {
    const text = String(message).toLowerCase();
    if (text.includes("cached model clearance solid")) return "cached";
    if (text.includes("localized") && (text.includes("witness") || text.includes("repair clearance"))) return "witnessRepair";
    if (text.includes("final continuous") || text.includes("after global fallback")) return "finalCertificate";
    if (text.includes("filtering model faces") || text.includes("target aabb")) return "filter";
    if (text.includes("building target-aware clearance") || text.includes("streaming target-aware")) return "clearance";
    if (text.includes("certificate") || text.includes("continuous ellipsoidal")) return "certificate";
    if (text.includes("precomputing") || text.includes("expanded object clearance") || text.includes("building object model solid")) return "clearance";
    if (text.includes("loading") || text.includes("instantiating") || text.includes("setting up") || text.includes("ready")) return "load";
    if (text.includes("trimming generated cradle") || text.includes("generated cradle")) return "trim";
    if (text.includes("packing") || text.includes("pack transfer")) return "pack";
    if (text.includes("waiting for object clearance precompute")) return "wait";
    if (text.includes("serial fallback")) return "load";
    return stageName;
  };

  const tick = () => {
    if (!active) return;
    const stage = stages[stageName] || stages.start;
    const elapsed = performance.now() - stageStartedAt;
    const estimate = Math.max(1000, Number(stage.estimateMs) || 0);
    const timeFraction = estimate > 0 ? Math.min(0.965, elapsed / estimate) : 0.35;
    const fraction = reportedStageFraction > 0
      ? Math.min(0.965, reportedStageFraction)
      : timeFraction;
    const overall = stage.from + (stage.to - stage.from) * fraction;
    const targetProgress = startProgress + (endProgress - startProgress) * overall;
    lastProgressValue = Math.max(lastProgressValue, Math.min(endProgress - 0.15, targetProgress));
    setProgress(controlsEl.jobProgressShell, controlsEl.jobProgress, lastProgressValue);
    const observedRateEstimate = stageName === "clearance" && projectedStageDurationMs > elapsed
      ? projectedStageDurationMs
      : 0;
    setProgressDetail(progressDetailText(
      stage,
      elapsed,
      observedRateEstimate || estimate,
      lastMessage,
      observedRateEstimate ? "observed stream rate" : (stage.estimateSource || "rough estimate")
    ));
  };

  const timer = window.setInterval(tick, 1000);
  tick();

  return {
    update(message = "") {
      lastMessage = String(message || "");
      setStage(messageToStage(lastMessage), lastMessage);
      const streamedMatch = lastMessage.match(
        /(\d[\d,]*) of (\d[\d,]*) candidate faces/i
      );
      if (streamedMatch) {
        const completed = Number(streamedMatch[1].replaceAll(",", ""));
        const total = Number(streamedMatch[2].replaceAll(",", ""));
        if (Number.isFinite(completed) && Number.isFinite(total) && total > 0) {
          reportedStageFraction = Math.max(0, Math.min(1, completed / total));
          if (reportedStageFraction >= 0.05 && reportedStageFraction < 1) {
            const elapsed = Math.max(1, performance.now() - stageStartedAt);
            projectedStageDurationMs = Math.max(elapsed, elapsed / reportedStageFraction);
          }
        }
      }
      tick();
    },
    statusText(message = "") {
      const stage = stages[messageToStage(message)] || stages[stageName] || stages.start;
      return progressStatusText(stage);
    },
    finish(completed = true) {
      if (!active) return;
      active = false;
      window.clearInterval(timer);
      if (completed) {
        setProgress(controlsEl.jobProgressShell, controlsEl.jobProgress, endProgress);
        setProgressDetail("High accuracy object-clearance verification complete.");
      } else {
        setProgressDetail("High accuracy object-clearance verification stopped before completion.");
      }
    },
  };
}

function progressStatusText(stage) {
  return `${stage.label}...`;
}

function progressDetailText(stage, elapsedMs, estimateMs, message = "", estimateSource = "rough estimate") {
  const prefix = message ? `${humanizeProgressMessage(message)}. ` : "";
  if (stage === undefined) return prefix;
  const elapsed = formatCompactDuration(elapsedMs);
  if (estimateMs > 1500) {
    const remaining = Math.max(0, estimateMs - elapsedMs);
    const confidence = estimateSource === "previous run"
      ? "based on previous run"
      : estimateSource === "observed stream rate"
        ? "from current stream rate"
        : "rough estimate";
    const estimateLabel = estimateSource === "previous run"
      ? "previous-run estimate"
      : estimateSource === "observed stream rate"
        ? "current stream-rate estimate"
        : "rough estimate";
    return remaining > 0
      ? `${prefix}${stage.label}: elapsed ${elapsed}, about ${formatCompactDuration(remaining)} remaining (${confidence}).`
      : `${prefix}${stage.label}: elapsed ${elapsed}; still working beyond the ${estimateLabel}.`;
  }
  return `${prefix}${stage.label}: elapsed ${elapsed}.`;
}

function humanizeProgressMessage(message = "") {
  const text = String(message || "").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setProgressDetail(message = "") {
  if (!controlsEl.jobProgressDetail) return;
  controlsEl.jobProgressDetail.textContent = message;
}

function formatCompactDuration(ms) {
  const seconds = Math.max(0, Math.round(Number(ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function modelTrimEstimateMs(
  clearance = {},
  preferParallelManifold = false,
  supportMesh = null,
  debug = MODEL_TRIM_DEBUG_SETTINGS
) {
  const key = modelTrimClearanceKey(null, clearance, preferParallelManifold, debug);
  const stored = readModelTrimEstimate(key);
  if (stored?.clearance_ms > 500) return stored.clearance_ms;
  if (stored?.total_ms > 1000) return Math.max(1000, stored.total_ms * 0.92);

  const modelTriangles = currentModelTriangleCount();
  const supportTriangles = Math.floor((supportMesh?.triangles?.length ?? 0) / 3);
  const complexity = Math.max(modelTriangles, modelTriangles * Math.max(1, Math.log10(Math.max(10, supportTriangles))));
  if (complexity > 600000) return 180000;
  if (complexity > 250000) return 120000;
  if (complexity > 100000) return 75000;
  if (complexity > 35000) return 35000;
  return 18000;
}

function trimMeshEstimateMs(supportMesh = null) {
  const triangles = Math.floor((supportMesh?.triangles?.length ?? 0) / 3);
  if (triangles > 1000000) return 12000;
  if (triangles > 400000) return 8000;
  if (triangles > 100000) return 4500;
  return 2500;
}

function currentModelTriangleCount() {
  const cached = state.modelPayloadCache?.indexed_mesh?.triangle_count;
  if (Number.isFinite(Number(cached)) && Number(cached) > 0) return Number(cached);
  const geometry = state.modelMesh?.geometry;
  if (!geometry) return 0;
  if (geometry.index) return Math.floor(geometry.index.count / 3);
  return Math.floor((geometry.attributes?.position?.count ?? 0) / 3);
}

function recordModelTrimEstimate(
  clearance = {},
  preferParallelManifold = false,
  timings = [],
  debug = MODEL_TRIM_DEBUG_SETTINGS
) {
  if (!Array.isArray(timings) || !timings.length) return;
  const key = modelTrimClearanceKey(null, clearance, preferParallelManifold, debug);
  const clearanceMs = debug?.targeted_minkowski
    ? sumTimingLabels(timings, [
        "clip object model",
        "target AABB candidate filter",
        "target distance candidate filter",
        "targeted cradle streaming subtraction",
        "targeted interface streaming subtraction",
      ])
    : sumTimingLabels(timings, ["model clearance solid", "model solid"]);
  const totalMs = Math.max(
    sumTimingLabels(timings, ["worker trim round trip"]),
    timings.reduce((sum, phase) => sum + Math.max(0, Number(phase?.ms) || 0), 0)
  );
  if (totalMs < 500) return;
  const history = readModelTrimEstimateStore();
  history[key] = {
    clearance_ms: clearanceMs > 500 ? Math.round(clearanceMs) : Math.round(totalMs * 0.85),
    total_ms: Math.round(totalMs),
    updated_at: Date.now(),
  };
  const entries = Object.entries(history)
    .sort((a, b) => Number(b[1]?.updated_at ?? 0) - Number(a[1]?.updated_at ?? 0))
    .slice(0, 40);
  writeModelTrimEstimateStore(Object.fromEntries(entries));
}

function sumTimingLabels(timings, labels) {
  return timings.reduce((sum, phase) => {
    const label = String(phase?.label ?? "");
    return labels.some((needle) => label.includes(needle))
      ? sum + Math.max(0, Number(phase?.ms) || 0)
      : sum;
  }, 0);
}

function readModelTrimEstimate(key) {
  const history = readModelTrimEstimateStore();
  return history[key] ?? null;
}

function readModelTrimEstimateStore() {
  try {
    return JSON.parse(window.localStorage.getItem(MODEL_TRIM_ESTIMATE_STORAGE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeModelTrimEstimateStore(history) {
  try {
    window.localStorage.setItem(MODEL_TRIM_ESTIMATE_STORAGE_KEY, JSON.stringify(history));
  } catch {
    // Estimate history is only a UI nicety.
  }
}

async function trimGeneratedMeshesAgainstModel(supportMesh, interfaceMesh, supportConfig = {}, options = {}) {
  const clearance = modelBooleanClearanceSettings(supportConfig);
  const result = {
    support_mesh: supportMesh,
    interface_mesh: interfaceMesh,
    trimmed: false,
    certified: false,
    certificate: null,
    pre_certificate: null,
    post_certificate: null,
    kernel: null,
    repair: null,
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

  if (!canUseModelTrimWorker() && options.requireExactTrim) {
    throw new Error(
      "High accuracy requires the isolated model-trim worker. The worker is unavailable, and the UI-blocking in-page Manifold fallback was not started. Reload the page to recreate the worker."
    );
  }

  if (canUseModelTrimWorker()) {
    try {
      const workerResult = await trimGeneratedMeshesAgainstModelInWorker(
        supportMesh,
        interfaceMesh,
        clearance,
        options
      );
      if (options.debug?.targeted_minkowski) terminateModelTrimWorker();
      return workerResult;
    } catch (error) {
      if (isModelTrimTimeoutError(error)) {
        terminateModelTrimWorker();
        throw error;
      }
      if (options.preferParallelManifold) {
        console.warn("Parallel model trim worker failed; retrying with the serial worker backend.", error);
        terminateModelTrimWorker();
        try {
          const serialResult = await trimGeneratedMeshesAgainstModelInWorker(
            supportMesh,
            interfaceMesh,
            clearance,
            {
              ...options,
              preferParallelManifold: false,
              preparedClearanceKey: "",
              onProgress: async (message) => {
                options.onProgress?.(`serial fallback ${message}`);
              },
            }
          );
          serialResult.warning = `Parallel Manifold trim failed; serial worker exact trim was used instead (${error?.message || error}).`;
          return serialResult;
        } catch (serialError) {
          if (isModelTrimTimeoutError(serialError)) {
            terminateModelTrimWorker();
            throw serialError;
          }
          console.warn("Serial model trim worker also failed; falling back to in-page Manifold trim.", serialError);
          error = serialError;
        }
      }
      if (options.requireExactTrim) {
        console.error("High-accuracy model trim worker failed; in-page fallback suppressed.", error);
        terminateModelTrimWorker();
        throw new Error(
          `High accuracy model-trim worker failed; the UI-blocking in-page Manifold fallback was not started (${error?.message || error}). Reload and retry to create a fresh worker.`
        );
      }
      console.warn("Model trim worker failed; falling back to in-page Manifold trim.", error);
      modelTrimWorkerFailed = true;
      terminateModelTrimWorker();
      result.warning = `Model trim worker failed; in-page exact trim was used instead (${error?.message || error}).`;
    }
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
    await options.onProgress?.("loading in-page Manifold fallback");
    core = await loadManifoldCore();
    markTrimPhase("load manifold");
    await options.onProgress?.(expandedClearanceNeeded(clearance)
      ? "building bounded expanded object clearance solid"
      : "building object model solid");
    const clearanceResult = modelClearanceSolidToManifold(
      core,
      clearance,
      [supportMesh, interfaceMesh],
      options.debug?.kernel_mode
    );
    clearanceSolid = clearanceResult.solid;
    result.kernel = clearanceResult.kernel ?? null;
    result.repair = {
      strategy: clearanceResult.expanded
        ? "bounded_global_minkowski"
        : "exact_model_difference",
      targeted_requested: Boolean(options.debug?.targeted_minkowski),
      targeted_applied: false,
      targeted_fallback_reason: options.debug?.targeted_minkowski
        ? "target-aware repair is unavailable in the in-page fallback"
        : "",
    };
    result.clearance = {
      ...clearance,
      expanded: clearanceResult.expanded,
      analytic_certified: false,
      safety_margin_mm: clearanceResult.safety_margin_mm || 0,
    };
    markTrimPhase(clearanceResult.expanded ? "model clearance solid" : "model solid");
    await options.onProgress?.("trimming generated cradle mesh");
    result.support_mesh = trimSupportMeshAgainstModelSolid(core, supportMesh, clearanceSolid, "generated cradle", result.timings);
    if (interfaceMesh?.vertices?.length && interfaceMesh?.triangles?.length) {
      await options.onProgress?.("trimming generated interface mesh");
      result.interface_mesh = trimSupportMeshAgainstModelSolid(core, interfaceMesh, clearanceSolid, "generated interface", result.timings);
    }
    if (continuousClearanceCertificateSettings(clearance).supported) {
      await options.onProgress?.("checking final continuous ellipsoidal clearance in-page");
      result.post_certificate = certifyInPageRepairedMeshesContinuousClearance(
        core,
        result.support_mesh,
        result.interface_mesh,
        clearance,
        result.timings
      );
      result.clearance.analytic_certified = Boolean(result.post_certificate?.passed);
    }
    result.trimmed = true;
  } catch (error) {
    if (options.requireExactTrim) throw error;
    result.warning = error?.message || String(error);
  } finally {
    if (clearanceSolid && clearanceSolid !== state.modelManifoldCache?.solid) {
      clearanceSolid.delete?.();
    }
  }

  return result;
}

function canUseModelTrimWorker() {
  return typeof Worker === "function" && !modelTrimWorkerFailed;
}

function readModelTrimDebugSettings() {
  return {
    targeted_minkowski: queryFlagEnabled(
      "targeted-minkowski",
      DEFAULT_HIGH_ACCURACY_TARGETED_MINKOWSKI
    ),
    kernel_mode: queryFlagEnabled(
      "analytic-kernel",
      DEFAULT_HIGH_ACCURACY_ANALYTIC_KERNEL
    )
      ? CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE
      : "legacy",
    targeted_batch_size: queryBoundedInteger("targeted-batch", 250, 8000),
    targeted_build: queryAllowedValue(
      "targeted-build",
      ["size", "o3", "simd", "lto"],
      DEFAULT_TARGETED_MANIFOLD_BUILD
    ),
    post_repair_analytic: true,
  };
}

function queryAllowedValue(name, allowed, fallback) {
  const value = String(
    new URLSearchParams(window.location.search).get(name) || ""
  ).trim().toLowerCase();
  return allowed.includes(value) ? value : fallback;
}

function queryBoundedInteger(name, minimum, maximum) {
  const value = Number.parseInt(
    new URLSearchParams(window.location.search).get(name) || "",
    10
  );
  return Number.isFinite(value) && value > 0
    ? Math.max(minimum, Math.min(maximum, value))
    : 0;
}

function queryFlagEnabled(name, fallback = false) {
  const value = new URLSearchParams(window.location.search).get(name);
  if (value === null) return Boolean(fallback);
  const mode = (value || "").trim().toLowerCase();
  if (
    mode === "1" || mode === "true" || mode === "on" ||
    mode === "debug" || mode === "force"
  ) return true;
  if (
    mode === "0" || mode === "false" || mode === "off" ||
    mode === "disable" || mode === "disabled" || mode === "legacy"
  ) return false;
  return Boolean(fallback);
}

function shouldUseParallelManifoldForTrim() {
  if (MODEL_TRIM_DEBUG_SETTINGS.targeted_minkowski) return false;
  const value = new URLSearchParams(window.location.search).get("manifold-par");
  const mode = (value || "").trim().toLowerCase();
  if (!mode || mode === "0" || mode === "false" || mode === "off") return false;
  const requested = mode === "1" || mode === "true" || mode === "on" || mode === "debug" || mode === "force";
  return requested && Boolean(window.crossOriginIsolated) && typeof SharedArrayBuffer === "function";
}

function ensureModelTrimWorker() {
  if (modelTrimWorker) return modelTrimWorker;

  modelTrimWorker = new Worker(new URL(`./modelTrimWorker.js?v=${MODEL_TRIM_WORKER_VERSION}`, import.meta.url), { type: "module" });
  modelTrimWorker.onmessage = (event) => {
    const message = event.data ?? {};
    const request = modelTrimWorkerRequests.get(message.id);
    if (!request) return;

    if (message.type === "progress") {
      request.lastProgressAt = performance.now();
      request.onProgress?.(message.message || "working");
      return;
    }

    modelTrimWorkerRequests.delete(message.id);
    if (request.timeoutId) window.clearTimeout(request.timeoutId);
    if (message.type === "clearResult") {
      request.resolve({ cleared: true, timings: message.timings ?? [] });
    } else if (message.type === "prepareResult") {
      request.resolve({
        clearanceKey: message.clearanceKey,
        clearance: message.clearance,
        timings: message.timings ?? [],
        runtime: message.runtime ?? null,
        worker: true,
      });
    } else if (message.type === "trimResult") {
      request.resolve({
        support_mesh: message.support_mesh,
        interface_mesh: message.interface_mesh,
        trimmed: message.trimmed === undefined ? true : Boolean(message.trimmed),
        certified: Boolean(message.certified || message.certificate?.passed),
        certificate: message.certificate ?? null,
        pre_certificate: message.pre_certificate ?? message.certificate ?? null,
        post_certificate: message.post_certificate ?? null,
        targeted_post_certificate: message.targeted_post_certificate ?? null,
        kernel: message.kernel ?? null,
        repair: message.repair ?? null,
        skipped: Boolean(message.skipped),
        skip_reason: message.skip_reason || "",
        warning: "",
        clearance: message.clearance,
        timings: message.timings ?? [],
        runtime: message.runtime ?? null,
        worker: true,
      });
    } else {
      request.reject(new Error(message.error || "Model trim worker failed"));
    }
  };
  modelTrimWorker.onerror = (event) => {
    const error = new Error(event.message || "Model trim worker error");
    for (const request of modelTrimWorkerRequests.values()) {
      if (request.timeoutId) window.clearTimeout(request.timeoutId);
      request.reject(error);
    }
    modelTrimWorkerRequests.clear();
    modelTrimWorkerFailed = true;
    terminateModelTrimWorker();
  };

  return modelTrimWorker;
}

function terminateModelTrimWorker() {
  modelTrimWorker?.terminate();
  modelTrimWorker = null;
  for (const request of modelTrimWorkerRequests.values()) {
    if (request.timeoutId) window.clearTimeout(request.timeoutId);
    request.reject(new Error("Model trim worker terminated"));
  }
  modelTrimWorkerRequests.clear();
}

function cancelRunningModelTrimPrewarm() {
  state.modelTrimPrewarmToken += 1;
  state.modelTrimPrewarmPromise = null;
  state.modelTrimPrewarmKey = "";
  cancelModelTrimWorkerPrewarm();
  if (modelTrimWorkerRequests.size > 0) {
    terminateModelTrimWorker();
  }
}

function trimGeneratedMeshesAgainstModelInWorker(supportMesh, interfaceMesh, clearance, options = {}) {
  const startedAt = performance.now();
  const { payload, transfer } = buildModelTrimWorkerPayload(
    supportMesh,
    interfaceMesh,
    clearance,
    options.preparedClearanceKey,
    Boolean(options.preferParallelManifold),
    options.debug || MODEL_TRIM_DEBUG_SETTINGS
  );
  const payloadMs = performance.now() - startedAt;
  const postedAt = performance.now();
  return requestModelTrimWorker("trimGeneratedMeshes", payload, transfer, options.onProgress)
    .then((result) => ({
      ...result,
      timings: [
        { label: "main trim payload clone", ms: payloadMs },
        { label: "worker trim round trip", ms: performance.now() - postedAt },
        ...(result.timings ?? []),
      ],
    }));
}

function prepareModelTrimWorkerClearance(clearance, preferParallelManifold = false) {
  const startedAt = performance.now();
  const transfer = [];
  const workerModelMesh = cloneTransferModelMesh(transfer);
  const clearanceKey = modelTrimClearanceKey(
    workerModelMesh,
    clearance,
    preferParallelManifold,
    MODEL_TRIM_DEBUG_SETTINGS
  );
  const payloadMs = performance.now() - startedAt;
  const postedAt = performance.now();
  return requestModelTrimWorker(
    "prepareModelClearance",
    {
      modelMesh: workerModelMesh,
      clearance,
      clearanceKey,
      preferParallelManifold,
      debug: MODEL_TRIM_DEBUG_SETTINGS,
    },
    transfer,
    null
  ).then((result) => ({
    ...result,
    timings: [
      { label: "main prepare payload clone", ms: payloadMs },
      { label: "worker prepare round trip", ms: performance.now() - postedAt },
      ...(result.timings ?? []),
    ],
  }));
}

function getOrStartModelTrimWorkerPrewarm(clearance, preferParallelManifold = false) {
  if (!state.modelMesh || !canUseModelTrimWorker()) return null;
  if (MODEL_TRIM_DEBUG_SETTINGS.targeted_minkowski) return null;
  if (expandedClearanceNeeded(clearance)) return null;
  cancelModelTrimWorkerPrewarm();
  const clearanceKey = modelTrimClearanceKey(
    null,
    clearance,
    preferParallelManifold,
    MODEL_TRIM_DEBUG_SETTINGS
  );
  if (state.modelTrimPrewarmKey === clearanceKey && state.modelTrimPrewarmPromise) {
    return state.modelTrimPrewarmPromise;
  }
  state.modelTrimPrewarmToken += 1;
  state.modelTrimPrewarmKey = clearanceKey;
  state.modelTrimPrewarmPromise = prepareModelTrimWorkerClearance(clearance, preferParallelManifold)
    .catch((error) => {
      state.modelTrimPrewarmKey = "";
      state.modelTrimPrewarmPromise = null;
      throw error;
    });
  return state.modelTrimPrewarmPromise;
}

function clearModelTrimWorkerCache() {
  state.modelTrimPrewarmToken += 1;
  state.modelTrimPrewarmPromise = null;
  state.modelTrimPrewarmKey = "";
  cancelModelTrimWorkerPrewarm();
  if (!modelTrimWorker) return;
  requestModelTrimWorker("clearModelClearanceCache").catch((error) => {
    console.warn("Model trim cache clear failed.", error);
  });
}

function cancelModelTrimWorkerPrewarm() {
  if (state.modelTrimPrewarmTimer === null) return;
  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(state.modelTrimPrewarmTimer);
  } else {
    window.clearTimeout(state.modelTrimPrewarmTimer);
  }
  state.modelTrimPrewarmTimer = null;
}

function scheduleModelTrimWorkerPrewarm(clearance = currentModelBooleanClearanceSettings()) {
  if (!ENABLE_MODEL_TRIM_WORKER_PREWARM || !state.modelMesh || !canUseModelTrimWorker()) return null;
  if (MODEL_TRIM_DEBUG_SETTINGS.targeted_minkowski) return null;
  if (shouldUseParallelManifoldForTrim()) return null;
  if (expandedClearanceNeeded(clearance)) {
    state.modelTrimPrewarmToken += 1;
    cancelModelTrimWorkerPrewarm();
    return null;
  }
  const token = state.modelTrimPrewarmToken + 1;
  state.modelTrimPrewarmToken = token;
  cancelModelTrimWorkerPrewarm();

  const run = () => {
    state.modelTrimPrewarmTimer = null;
    if (!state.modelMesh || token !== state.modelTrimPrewarmToken || !canUseModelTrimWorker()) return;
    const predictedKey = modelTrimClearanceKey(
      null,
      clearance,
      false,
      MODEL_TRIM_DEBUG_SETTINGS
    );
    if (state.modelTrimPrewarmKey === predictedKey && state.modelTrimPrewarmPromise) return;
    state.modelTrimPrewarmKey = predictedKey;
    state.modelTrimPrewarmPromise = prepareModelTrimWorkerClearance(clearance, false)
      .catch((error) => {
        if (token === state.modelTrimPrewarmToken) {
          state.modelTrimPrewarmKey = "";
          state.modelTrimPrewarmPromise = null;
        }
        console.warn("Model trim worker prewarm failed.", error);
        return null;
      });
  };

  state.modelTrimPrewarmTimer = typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback(run, { timeout: 3000 })
    : window.setTimeout(run, 900);
  return state.modelTrimPrewarmPromise;
}

function currentModelBooleanClearanceSettings() {
  return modelBooleanClearanceSettings(collectSupportConfig());
}

function requestModelTrimWorker(type, payload = {}, transfer = [], onProgress = null) {
  const worker = ensureModelTrimWorker();
  const id = nextModelTrimWorkerRequestId;
  nextModelTrimWorkerRequestId += 1;

  return new Promise((resolve, reject) => {
    const preferParallel = Boolean(payload.preferParallelManifold);
    const timeoutMs = preferParallel
      ? (type === "prepareModelClearance" ? PARALLEL_MANIFOLD_PREPARE_TIMEOUT_MS : PARALLEL_MANIFOLD_TRIM_TIMEOUT_MS)
      : (type === "prepareModelClearance" ? SERIAL_MANIFOLD_PREPARE_TIMEOUT_MS : SERIAL_MANIFOLD_TRIM_TIMEOUT_MS);
    const request = {
      resolve,
      reject,
      onProgress,
      timeoutId: null,
      lastProgressAt: performance.now(),
    };
    request.timeoutId = window.setTimeout(() => {
      if (!modelTrimWorkerRequests.has(id)) return;
      modelTrimWorkerRequests.delete(id);
      const ErrorType = preferParallel ? ParallelManifoldTimeoutError : ModelTrimTimeoutError;
      request.reject(new ErrorType(
        `${preferParallel ? "Parallel Manifold" : "Model trim"} worker did not complete ${type} within ${Math.round(timeoutMs / 1000)} seconds`
      ));
      terminateModelTrimWorker();
    }, timeoutMs);
    modelTrimWorkerRequests.set(id, request);
    try {
      worker.postMessage({ id, type, ...payload }, transfer);
    } catch (error) {
      modelTrimWorkerRequests.delete(id);
      if (request.timeoutId) window.clearTimeout(request.timeoutId);
      reject(error);
    }
  });
}

function buildModelTrimWorkerPayload(
  supportMesh,
  interfaceMesh,
  clearance,
  preparedClearanceKey = "",
  preferParallelManifold = false,
  debug = MODEL_TRIM_DEBUG_SETTINGS
) {
  const transfer = [];
  const workerSupportMesh = cloneTransferMesh(supportMesh, transfer);
  const workerInterfaceMesh = cloneTransferMesh(interfaceMesh, transfer);
  const workerModelMesh = preparedClearanceKey ? null : cloneTransferModelMesh(transfer);
  const normalizedDebug = {
    targeted_minkowski: Boolean(debug?.targeted_minkowski),
    kernel_mode: normalizeClearanceKernelMode(debug?.kernel_mode),
    targeted_batch_size: Math.max(0, Number(debug?.targeted_batch_size) || 0),
    targeted_build: String(
      debug?.targeted_build || DEFAULT_TARGETED_MANIFOLD_BUILD
    ),
    post_repair_analytic: true,
  };
  const clearanceKey = preparedClearanceKey || modelTrimClearanceKey(
    workerModelMesh,
    clearance,
    preferParallelManifold,
    normalizedDebug
  );
  return {
    payload: {
      supportMesh: workerSupportMesh,
      interfaceMesh: workerInterfaceMesh,
      modelMesh: workerModelMesh,
      clearance,
      clearanceKey,
      preferParallelManifold,
      debug: normalizedDebug,
    },
    transfer,
  };
}

function modelTrimClearanceKey(
  modelMesh,
  clearance = {},
  preferParallelManifold = false,
  debug = MODEL_TRIM_DEBUG_SETTINGS
) {
  const modelName = state.modelMesh?.name || "model";
  const cachedPayload = modelMesh || state.modelPayloadCache || (state.modelMesh ? buildMeshPayload() : null);
  const vertexCount = modelMesh?.vertex_count ?? cachedPayload?.indexed_mesh?.vertex_count ?? 0;
  const triangleCount = modelMesh?.triangle_count ?? cachedPayload?.indexed_mesh?.triangle_count ?? 0;
  const xy = Math.round((Number(clearance?.xy_mm) || 0) * 1000);
  const z = Math.round((Number(clearance?.z_mm) || 0) * 1000);
  const position = state.modelMesh?.position;
  const rotation = state.modelMesh?.rotation;
  const transformKey = [
    position?.x ?? 0,
    position?.y ?? 0,
    position?.z ?? 0,
    rotation?.x ?? 0,
    rotation?.y ?? 0,
    rotation?.z ?? 0,
  ].map((value) => Math.round(value * 100000)).join(":");
  const backend = debug?.targeted_minkowski
    ? "targeted-serial"
    : preferParallelManifold
      ? "parallel"
      : "serial";
  const kernelMode = normalizeClearanceKernelMode(debug?.kernel_mode);
  const targetedBatchSize = Math.max(0, Number(debug?.targeted_batch_size) || 0);
  const targetedBuild = String(
    debug?.targeted_build || DEFAULT_TARGETED_MANIFOLD_BUILD
  );
  return `${state.modelRevision}:${modelName}:${vertexCount}:${triangleCount}:${xy}:${z}:${transformKey}:${backend}:${kernelMode}:build-${targetedBuild}:batch-${targetedBatchSize}:${MODEL_TRIM_WORKER_VERSION}`;
}

function cloneTransferMesh(mesh, transfer) {
  if (!mesh?.vertices?.length || !mesh?.triangles?.length) return mesh;
  const vertices = mesh.vertices instanceof Float32Array
    ? new Float32Array(mesh.vertices)
    : new Float32Array(mesh.vertices ?? []);
  const triangles = mesh.triangles instanceof Uint32Array
    ? new Uint32Array(mesh.triangles)
    : new Uint32Array(mesh.triangles ?? []);
  transfer.push(vertices.buffer, triangles.buffer);
  return {
    ...mesh,
    vertices,
    triangles,
    vertex_count: Math.floor(vertices.length / 3),
    triangle_count: Math.floor(triangles.length / 3),
  };
}

function cloneTransferModelMesh(transfer) {
  const payload = buildMeshPayload();
  const indexed = payload.indexed_mesh ?? {};
  const vertices = indexed.vertices instanceof Float32Array
    ? new Float32Array(indexed.vertices)
    : new Float32Array(indexed.vertices ?? []);
  const triangles = indexed.triangles instanceof Uint32Array
    ? new Uint32Array(indexed.triangles)
    : new Uint32Array(indexed.triangles ?? []);
  transfer.push(vertices.buffer, triangles.buffer);
  return {
    vertices,
    triangles,
    vertex_count: Math.floor(vertices.length / 3),
    triangle_count: Math.floor(triangles.length / 3),
  };
}

function modelClearanceSolidToManifold(
  core,
  clearance = {},
  clipMeshes = [],
  kernelMode = "legacy"
) {
  const exactSolid = modelMeshToManifold(core);
  const xy = Math.max(0, Number(clearance?.xy_mm) || 0);
  const z = Math.max(0, Number(clearance?.z_mm) || 0);
  const maxClearance = Math.max(xy, z);
  if (maxClearance <= 0.001) {
    return { solid: exactSolid, expanded: false };
  }

  let kernel = null;
  let clipSolid = null;
  let boundedSolid = null;
  try {
    const kernelResult = buildClearanceKernel(core, clearance, kernelMode);
    kernel = kernelResult.solid;
    const kernelMetadata = kernelResult.metadata;
    const clipBounds = clearanceClipBoundsForMeshes(
      clipMeshes,
      kernelMetadata.extent_xy_mm,
      kernelMetadata.extent_z_mm
    );
    if (!clipBounds) {
      throw new Error("Expanded object-clearance trim requires generated cradle bounds.");
    }
    clipSolid = boxToManifold(core, clipBounds.min, clipBounds.max, "object clearance clip bounds");
    boundedSolid = assertManifoldOk(
      core.Manifold.intersection(exactSolid, clipSolid),
      "bounded object model clearance source"
    );
    const clearanceSolid = assertManifoldOk(
      boundedSolid.minkowskiSum(kernel),
      "bounded object model expanded clearance solid"
    );
    return {
      solid: clearanceSolid,
      expanded: true,
      bounded: true,
      safety_margin_mm: kernelMetadata.safety_margin_mm || 0,
      kernel: kernelMetadata,
    };
  } finally {
    kernel?.delete?.();
    boundedSolid?.delete?.();
    clipSolid?.delete?.();
  }
}

function clearanceClipBoundsForMeshes(meshes, xyPadding = 0, zPadding = 0) {
  const candidates = (Array.isArray(meshes) ? meshes : [meshes])
    .filter((mesh) => mesh?.vertices?.length);
  if (!candidates.length) return null;

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let cellPadding = 0.25;
  for (const mesh of candidates) {
    const bounds = supportMeshBounds(mesh);
    min.x = Math.min(min.x, bounds.min.x);
    min.y = Math.min(min.y, bounds.min.y);
    min.z = Math.min(min.z, bounds.min.z);
    max.x = Math.max(max.x, bounds.max.x);
    max.y = Math.max(max.y, bounds.max.y);
    max.z = Math.max(max.z, bounds.max.z);
    cellPadding = Math.max(cellPadding, Number(mesh.cell_size_mm) || 0);
  }
  const padXy = Math.max(0, Number(xyPadding) || 0) + cellPadding;
  const padZ = Math.max(0, Number(zPadding) || 0) + cellPadding;
  return {
    min: { x: min.x - padXy, y: min.y - padXy, z: min.z - padZ },
    max: { x: max.x + padXy, y: max.y + padXy, z: max.z + padZ },
  };
}

function expandedClearanceNeeded(clearance = {}) {
  return Math.max(Number(clearance?.xy_mm) || 0, Number(clearance?.z_mm) || 0) > 0.001;
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

function certifyInPageRepairedMeshesContinuousClearance(
  core,
  supportMesh,
  interfaceMesh,
  clearance,
  timings = []
) {
  let supportSolid = null;
  let interfaceSolid = null;
  const measure = (label, operation) => {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      timings.push({ label, ms: performance.now() - startedAt });
    }
  };

  try {
    const modelSolid = modelMeshToManifold(core);
    supportSolid = measure(
      "in-page final certificate cradle solid",
      () => supportMeshToManifold(core, supportMesh, "in-page final certificate cradle", { fast: true })
    );
    if (interfaceMesh?.vertices?.length && interfaceMesh?.triangles?.length) {
      interfaceSolid = measure(
        "in-page final certificate interface solid",
        () => supportMeshToManifold(core, interfaceMesh, "in-page final certificate interface", { fast: true })
      );
    }
    const certificate = certifyContinuousClearance(
      modelSolid,
      [
        { label: "cradle", solid: supportSolid },
        { label: "interface", solid: interfaceSolid },
      ],
      clearance
    );
    timings.push(...(certificate.timings ?? []).map((timing) => ({
      ...timing,
      label: `in-page final ${timing.label}`,
    })));
    delete certificate.timings;
    return certificate;
  } catch (error) {
    const unavailable = certifyContinuousClearance(null, [], clearance);
    unavailable.reason = error?.message || String(error);
    return unavailable;
  } finally {
    interfaceSolid?.delete?.();
    supportSolid?.delete?.();
  }
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

function printCradleSafetyForGeneration({ highAccuracy, mediumAccuracy, hasSupportMesh, trimmedMeshes, modelMeshQa, meshQa, voxelClearanceQa }) {
  if (!hasSupportMesh || !trimmedMeshes?.support_mesh?.vertices?.length || !trimmedMeshes?.support_mesh?.triangles?.length) {
    return {
      exportable: false,
      reason: "No cradle mesh is available.",
    };
  }

  if (!highAccuracy) {
    if (mediumAccuracy && voxelClearanceQa?.available) {
      return {
        exportable: false,
        reason: voxelClearanceQa.removed_voxels
          ? "Medium interval clearance generated a modified cradle mesh, but high accuracy exact boolean has not been run."
          : "Medium interval clearance generated a cradle mesh, but high accuracy exact boolean has not been run.",
      };
    }
    return {
      exportable: false,
      reason: "High accuracy has not been run for this cradle.",
    };
  }

  const certificatePassed = Boolean(trimmedMeshes.certified || trimmedMeshes.certificate?.passed);
  if (!trimmedMeshes.trimmed && !certificatePassed) {
    return {
      exportable: false,
      reason: "High accuracy did not complete an object-clearance trim or certificate.",
    };
  }

  const clearance = trimmedMeshes.clearance ?? {};
  const requestedClearance = Math.max(Number(clearance.xy_mm) || 0, Number(clearance.z_mm) || 0);
  if (requestedClearance > 0.001 && !clearance.expanded && !certificatePassed) {
    return {
      exportable: false,
      reason: "High accuracy removed model intersections but did not preserve the requested clearance offset.",
    };
  }

  if (modelMeshQa?.intersects_model) {
    return {
      exportable: false,
      reason: "Post-trim model QA still found sampled cradle points inside the model.",
    };
  }

  if (modelMeshQa?.failed || modelMeshQa?.available === false) {
    return {
      exportable: false,
      reason: modelMeshQa?.reason || "Post-trim model-intersection QA did not complete.",
    };
  }

  if (meshQa?.failed) {
    return {
      exportable: false,
      reason: meshQa.reason || "Cradle support-reach QA did not complete.",
    };
  }

  if (Number(meshQa?.unsupported_cells ?? 0) > 0) {
    return {
      exportable: false,
      reason: "Cradle mesh QA found unsupported underside targets after generation.",
    };
  }

  return {
    exportable: true,
    reason: certificatePassed
      ? "High accuracy continuous ellipsoidal clearance certificate passed."
      : "High accuracy object-clearance boolean trim completed.",
  };
}

function renderMeshPart(supportMesh, material, name) {
  if (!supportMesh?.vertices?.length || !supportMesh?.triangles?.length) {
    return null;
  }

  normalizeSupportMeshArrays(supportMesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(supportMesh.vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(supportMesh.triangles, 1));
  const displayGeometry = shouldUseNonIndexedDisplay(supportMesh, material) ? geometry.toNonIndexed() : geometry;
  if (displayGeometry !== geometry) geometry.dispose();
  displayGeometry.computeVertexNormals();
  displayGeometry.computeBoundingBox();
  displayGeometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(displayGeometry, material);
  mesh.name = name;
  supportGroup.add(mesh);

  return supportMesh;
}

function shouldUseNonIndexedDisplay(supportMesh, material) {
  const triangleCount = Number(supportMesh?.triangle_count) || Math.floor((supportMesh?.triangles?.length ?? 0) / 3);
  return Boolean(material?.flatShading && triangleCount <= LARGE_MESH_NONINDEXED_DISPLAY_TRIANGLES);
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
  clearMeshGroup(coverageGroup);
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

  state.coverageVisible = true;
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
  const renderedSplitMeshes = splitGroup.children.filter((child) => child?.isMesh && child.visible !== false).length;
  if (!renderedSplitMeshes) {
    restoreOriginalCradleAfterSplitFailure();
    throw new Error("split preview produced no visible chunk meshes");
  }
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
    const advisoryText = `${shallowText}${roofText}`;
    setSplitStatus(`Split made ${chunkText} with ${connectorText}. Boolean chunk cuts are watertight; sockets and keys use adaptive sloped roofs.${advisoryText} ${splitQaText} ${gapQaText}`, plan.qa?.intersects_model ? "error" : "pending");
  }

  setSplitProgress(100);
  updateButtons();
}

function clearSplitPreview() {
  clearMeshGroup(splitGroup);
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  supportGroup.visible = true;
  resetProgress(controlsEl.splitProgressShell, controlsEl.splitProgress);
  setSplitStatus(state.supportMesh ? "Generate a split preview to check build-plate fit." : "Generate a cradle to check build-plate fit.", "idle");
  updateButtons();
}

function restoreOriginalCradleAfterSplitFailure() {
  clearMeshGroup(splitGroup);
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  supportGroup.visible = state.supportDisplayMode !== "hidden";
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
  const sourceTopSampler = sourceMesh
    ? buildSupportTopSampler(sourceMesh, Math.max(0.75, sourceMesh.cell_size_mm ?? 1))
    : null;

  for (const chunk of chunks) {
    const right = byGrid.get(`${chunk.grid.x + 1}:${chunk.grid.y}:${chunk.grid.z}`);
    if (right) {
      const connector = addZSlideDovetailPair(chunk, right, "x", sourceBounds, settings, sourceMesh, modelTriangles, connectors.length + 1, sourceTopSampler, connectors);
      if (connector) connectors.push(connector);
    }
    const back = byGrid.get(`${chunk.grid.x}:${chunk.grid.y + 1}:${chunk.grid.z}`);
    if (back) {
      const connector = addZSlideDovetailPair(chunk, back, "y", sourceBounds, settings, sourceMesh, modelTriangles, connectors.length + 1, sourceTopSampler, connectors);
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

function addZSlideDovetailPair(maleChunk, femaleChunk, axis, sourceBounds, settings, sourceMesh, modelTriangles, index, sourceTopSampler = null, existingConnectors = []) {
  const size = settings.connectorSize;
  const clearance = settings.connectorClearance;
  const label = `D${String(index).padStart(2, "0")}`;
  let placement;

  if (axis === "x") {
    const seam = (maleChunk.box.max.x + femaleChunk.box.min.x) / 2;
    placement = chooseDovetailPlacement({
      axis,
      seam,
      overlapMin: Math.max(maleChunk.bounds.min.y, femaleChunk.bounds.min.y),
      overlapMax: Math.min(maleChunk.bounds.max.y, femaleChunk.bounds.max.y),
      fallbackCenter: overlapCenter(maleChunk.bounds.min.y, maleChunk.bounds.max.y, femaleChunk.bounds.min.y, femaleChunk.bounds.max.y),
      sourceBounds,
      settings,
      sourceMesh,
      modelTriangles,
      sourceTopSampler,
      existingConnectors,
    });
  } else {
    const seam = (maleChunk.box.max.y + femaleChunk.box.min.y) / 2;
    placement = chooseDovetailPlacement({
      axis,
      seam,
      overlapMin: Math.max(maleChunk.bounds.min.x, femaleChunk.bounds.min.x),
      overlapMax: Math.min(maleChunk.bounds.max.x, femaleChunk.bounds.max.x),
      fallbackCenter: overlapCenter(maleChunk.bounds.min.x, maleChunk.bounds.max.x, femaleChunk.bounds.min.x, femaleChunk.bounds.max.x),
      sourceBounds,
      settings,
      sourceMesh,
      modelTriangles,
      sourceTopSampler,
      existingConnectors,
    });
  }

  if (!placement) return null;

  const {
    center,
    zRange,
    dimensions,
    maleFootprint,
    maleRoofFootprint,
    socketFootprint,
    side,
    stats,
  } = placement;

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
    center_mm: roundedCoordinate(center),
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
    placement_score: roundedCoordinate(stats.score),
    placement_body_coverage: roundedCoordinate(stats.bodyCoverage),
    placement_wall_coverage: roundedCoordinate(stats.wallCoverage),
  };
}

function chooseDovetailPlacement({
  axis,
  seam,
  overlapMin,
  overlapMax,
  fallbackCenter,
  sourceBounds,
  settings,
  sourceMesh,
  modelTriangles,
  sourceTopSampler,
  existingConnectors = [],
}) {
  const candidates = dovetailCandidateCenters(overlapMin, overlapMax, fallbackCenter, settings, sourceMesh);
  let best = null;

  for (const center of candidates) {
    const candidate = buildDovetailPlacementAtCenter({
      axis,
      seam,
      center,
      sourceBounds,
      settings,
      sourceMesh,
      modelTriangles,
      sourceTopSampler,
      existingConnectors,
      fallbackCenter,
    });
    if (!candidate) continue;
    if (!Number.isFinite(candidate.stats.score)) continue;
    if (!best || candidate.stats.score > best.stats.score) best = candidate;
  }

  if (!best) return null;
  if (sourceMesh &&
    (best.stats.bodyCoverage < CONNECTOR_PLACER_MIN_BODY_COVERAGE ||
      best.stats.wallCoverage < CONNECTOR_PLACER_MIN_WALL_COVERAGE)) {
    return null;
  }
  return best;
}

function dovetailCandidateCenters(overlapMin, overlapMax, fallbackCenter, settings, sourceMesh) {
  const cellSize = Number(sourceMesh?.cell_size_mm) || 1;
  const wallMargin = Math.max(CONNECTOR_PLACER_TARGET_WALL_MM, settings.connectorSize * 0.3, cellSize * 3);
  const usableMin = overlapMin + settings.connectorSize / 2 + settings.connectorClearance + wallMargin;
  const usableMax = overlapMax - settings.connectorSize / 2 - settings.connectorClearance - wallMargin;
  const min = usableMin <= usableMax ? usableMin : overlapMin;
  const max = usableMin <= usableMax ? usableMax : overlapMax;
  const span = Math.max(0, max - min);
  const step = Math.max(settings.connectorSize * 0.45, cellSize * 8, 1);
  const count = Math.max(1, Math.min(CONNECTOR_PLACER_MAX_CANDIDATES, Math.floor(span / step) + 1));
  const centers = new Set();
  const add = (value) => {
    if (!Number.isFinite(value)) return;
    centers.add(String(roundedCoordinate(Math.max(min, Math.min(max, value)))));
  };

  add(fallbackCenter);
  add((min + max) / 2);
  add(min + span * 0.25);
  add(min + span * 0.75);
  if (count === 1) {
    add((min + max) / 2);
  } else {
    for (let index = 0; index < count; index += 1) {
      add(min + (span * index) / (count - 1));
    }
  }

  return [...centers].map((value) => Number(value));
}

function buildDovetailPlacementAtCenter({
  axis,
  seam,
  center,
  sourceBounds,
  settings,
  sourceMesh,
  modelTriangles,
  sourceTopSampler,
  existingConnectors,
  fallbackCenter,
}) {
  let dimensions = connectorDimensionsForZRange({ min: sourceBounds.min.z, max: sourceBounds.min.z + settings.connectorSize }, settings);
  let maleFootprint;
  let maleRoofFootprint;
  let socketFootprint;
  let side;
  let zRange;

  for (let pass = 0; pass < 3; pass += 1) {
    ({ maleFootprint, maleRoofFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, center, dimensions, settings.connectorClearance));
    zRange = connectorZRange(sourceMesh, sourceBounds, settings, [maleFootprint, socketFootprint], modelTriangles, sourceTopSampler);
    if (!zRange) return null;
    zRange.seam = seam;
    dimensions = connectorDimensionsForZRange(zRange, settings);
  }

  ({ maleFootprint, maleRoofFootprint, socketFootprint, side } = buildDovetailFootprints(axis, seam, center, dimensions, settings.connectorClearance));
  const stats = scoreDovetailPlacement({
    axis,
    seam,
    center,
    fallbackCenter,
    maleFootprint,
    maleRoofFootprint,
    socketFootprint,
    side,
    zRange,
    dimensions,
    sourceMesh,
    sourceTopSampler,
    settings,
    existingConnectors,
  });

  return {
    center,
    zRange,
    dimensions,
    maleFootprint,
    maleRoofFootprint,
    socketFootprint,
    side,
    stats,
  };
}

function scoreDovetailPlacement({
  axis,
  seam,
  center,
  fallbackCenter,
  maleRoofFootprint,
  socketFootprint,
  maleFootprint,
  zRange,
  dimensions,
  sourceMesh,
  sourceTopSampler,
  settings,
  existingConnectors,
}) {
  const collisionPenalty = dovetailConnectorCollisionPenalty(
    [maleFootprint, socketFootprint],
    zRange,
    existingConnectors,
    settings
  );
  if (!Number.isFinite(collisionPenalty)) {
    return {
      score: -Infinity,
      bodyCoverage: 0,
      wallCoverage: 0,
      collision: true,
    };
  }

  if (!sourceMesh) {
    return {
      score: 1 - collisionPenalty,
      bodyCoverage: 1,
      wallCoverage: 1,
      collision: false,
    };
  }

  const cellSize = Number(sourceMesh.cell_size_mm) || 1;
  const sampleSpacing = Math.max(cellSize * 1.5, Math.min(settings.connectorSize * 0.18, 1.25));
  const minSolidTop = zRange.max + Math.max(0.08, settings.connectorClearance * 0.35);
  const bodyCoverage = supportCoverageForSamples(
    sourceMesh,
    sampleFootprints([maleRoofFootprint, socketFootprint], sampleSpacing),
    minSolidTop,
    sourceTopSampler
  );
  const wallSamples = dovetailSocketGuardSamples(socketFootprint, axis, settings, cellSize, sampleSpacing);
  const wallCoverage = supportCoverageForSamples(sourceMesh, wallSamples, minSolidTop, sourceTopSampler);
  const height = Math.max(0, zRange.max - zRange.min);
  const nearbyPenalty = nearbyConnectorPenalty(axis, seam, center, existingConnectors, settings);
  const fallbackPenalty = Math.abs(center - fallbackCenter) * 0.025;
  const roofBonus = dimensions.supportFreeRoof ? 8 : -8;
  const score =
    bodyCoverage * 90 +
    wallCoverage * 170 +
    Math.min(35, height * 3) +
    roofBonus -
    nearbyPenalty -
    fallbackPenalty -
    collisionPenalty;

  return {
    score,
    bodyCoverage,
    wallCoverage,
    collision: false,
    guardSamples: wallSamples.length,
  };
}

function dovetailConnectorCollisionPenalty(candidatePolygons, zRange, connectors, settings) {
  const clearance = Math.max(0.2, settings.connectorClearance ?? 0.3);
  const candidateBounds = footprintBounds(candidatePolygons);
  let penalty = 0;

  for (const connector of connectors ?? []) {
    if (!connector?.footprint_bounds_mm) continue;
    const z = connector.z_range_mm;
    if (z && (z.max < zRange.min - clearance || z.min > zRange.max + clearance)) continue;
    if (!bounds2dOverlap(candidateBounds, connector.footprint_bounds_mm, clearance)) continue;

    const existingPolygons = connectorFootprintPolygons(connector);
    for (const candidate of candidatePolygons) {
      for (const existing of existingPolygons) {
        if (polygonsOverlap2d(candidate, existing)) return Infinity;
        const distance = polygonDistance2d(candidate, existing);
        const minGap = Math.max(clearance * 2, 0.8);
        if (distance < minGap) penalty += (minGap - distance) * 80;
      }
    }
  }

  return penalty;
}

function connectorFootprintPolygons(connector) {
  return [
    connector.male_footprint_mm,
    connector.socket_footprint_mm,
  ].filter((polygon) => Array.isArray(polygon) && polygon.length >= 3);
}

function bounds2dOverlap(a, b, margin = 0) {
  if (!a || !b) return false;
  return a.max.x + margin >= b.min.x &&
    a.min.x - margin <= b.max.x &&
    a.max.y + margin >= b.min.y &&
    a.min.y - margin <= b.max.y;
}

function polygonsOverlap2d(a, b) {
  if (!a?.length || !b?.length) return false;
  if (a.some((point) => pointInPolygon2d(point, b))) return true;
  if (b.some((point) => pointInPolygon2d(point, a))) return true;
  for (let aIndex = 0; aIndex < a.length; aIndex += 1) {
    const a0 = a[aIndex];
    const a1 = a[(aIndex + 1) % a.length];
    for (let bIndex = 0; bIndex < b.length; bIndex += 1) {
      const b0 = b[bIndex];
      const b1 = b[(bIndex + 1) % b.length];
      if (segmentsIntersect2d(a0, a1, b0, b1)) return true;
    }
  }
  return false;
}

function polygonDistance2d(a, b) {
  let distance = Infinity;
  for (const point of a) distance = Math.min(distance, distanceToPolygonEdges2d(point, b));
  for (const point of b) distance = Math.min(distance, distanceToPolygonEdges2d(point, a));
  return distance;
}

function supportCoverageForSamples(mesh, samples, minTop, sampler = null) {
  if (!samples.length) return 0;
  let covered = 0;
  for (const sample of samples) {
    const top = supportTopAtXY(mesh, sample.x, sample.y, sampler);
    if (Number.isFinite(top) && top >= minTop) covered += 1;
  }
  return covered / samples.length;
}

function dovetailSocketGuardSamples(socketFootprint, axis, settings, cellSize, spacing) {
  const xs = socketFootprint.map((point) => point.x);
  const ys = socketFootprint.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const wall = Math.max(CONNECTOR_PLACER_TARGET_WALL_MM, settings.connectorClearance * 2.5, cellSize * 3);
  const samples = [];
  const addLine = (a, b) => {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(2, Math.ceil(length / Math.max(spacing, 0.25)));
    for (let index = 0; index <= count; index += 1) {
      const t = index / count;
      samples.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
      });
    }
  };

  if (axis === "x") {
    addLine({ x: maxX + wall, y: minY }, { x: maxX + wall, y: maxY });
    addLine({ x: minX + wall, y: minY - wall }, { x: maxX, y: minY - wall });
    addLine({ x: minX + wall, y: maxY + wall }, { x: maxX, y: maxY + wall });
  } else {
    addLine({ x: minX, y: maxY + wall }, { x: maxX, y: maxY + wall });
    addLine({ x: minX - wall, y: minY + wall }, { x: minX - wall, y: maxY });
    addLine({ x: maxX + wall, y: minY + wall }, { x: maxX + wall, y: maxY });
  }

  return samples;
}

function nearbyConnectorPenalty(axis, seam, center, connectors, settings) {
  const current = connectorAnchorPoint({ axis, seam_mm: seam, center_mm: center });
  const minDistance = settings.connectorSize * 1.6;
  let penalty = 0;
  for (const connector of connectors ?? []) {
    const other = connectorAnchorPoint(connector);
    if (!other) continue;
    const distance = Math.hypot(current.x - other.x, current.y - other.y);
    if (distance < minDistance) penalty += (minDistance - distance) * 8;
  }
  return penalty;
}

function connectorAnchorPoint(connector) {
  if (!connector || !Number.isFinite(connector.seam_mm) || !Number.isFinite(connector.center_mm)) return null;
  return connector.axis === "x"
    ? { x: connector.seam_mm, y: connector.center_mm }
    : { x: connector.center_mm, y: connector.seam_mm };
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

function connectorZRange(sourceMesh, sourceBounds, settings, footprints, modelTriangles = [], sourceTopSampler = null) {
  const bottom = sourceBounds.min.z;
  let localTop = connectorLocalTop(sourceMesh, footprints, settings, sourceTopSampler);
  const modelBottom = connectorModelBottom(modelTriangles, footprints, settings);
  if (Number.isFinite(modelBottom)) localTop = Math.min(localTop, modelBottom);
  if (!Number.isFinite(localTop)) return null;
  const topClearance = Math.max(1.5, settings.connectorClearance + 1.2, (sourceMesh?.cell_size_mm ?? 1) * 1.5);
  const maxHeight = localTop - bottom - topClearance;
  const minHeight = Math.max(0.9, settings.connectorClearance * 2.5, (sourceMesh?.cell_size_mm ?? 1) * 0.75);
  if (maxHeight < minHeight) return null;
  const preferredHeight = Math.max(minHeight, Math.min(settings.connectorSize * 4, Math.max(settings.connectorSize, maxHeight)));
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

function connectorLocalTop(sourceMesh, footprints, settings, sampler = null) {
  const spacing = Math.max(0.8, Math.min(settings.connectorSize * 0.35, sourceMesh?.cell_size_mm ?? 2));
  const samples = sampleFootprints(footprints, spacing);
  const tops = [];
  for (const sample of samples) {
    const top = supportTopAtXY(sourceMesh, sample.x, sample.y, sampler);
    if (Number.isFinite(top)) tops.push(top);
  }
  if (!tops.length) return -Infinity;

  tops.sort((a, b) => a - b);
  const coverage = tops.length / Math.max(1, samples.length);
  if (coverage < 0.35) return -Infinity;

  const lowOutlierTrim = Math.max(0, Math.min(tops.length - 1, Math.floor(tops.length * 0.2)));
  const robustIndex = Math.max(lowOutlierTrim, Math.min(tops.length - 1, Math.floor(tops.length * 0.35)));
  const robustTop = tops[robustIndex];
  const medianTop = tops[Math.floor(tops.length / 2)];
  return Math.min(medianTop, Math.max(robustTop, medianTop - settings.connectorSize * 0.75));
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

function supportZIntervalsAtXY(mesh, x, y, sampler = null) {
  const vertices = sampler?.vertices ?? mesh?.vertices ?? [];
  const triangles = sampler?.triangles ?? mesh?.triangles ?? [];
  const triangleStarts = sampler ? sampler.bins.get(sampler.binKey(x, y)) ?? [] : null;
  const hits = [];
  const scanCount = triangleStarts ? triangleStarts.length : Math.floor(triangles.length / 3);

  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const index = triangleStarts ? triangleStarts[scanIndex] : scanIndex * 3;
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const z = triangleZAtXY(a, b, c, x, y);
    if (Number.isFinite(z)) hits.push(roundedCoordinate(z));
  }
  if (!hits.length) return [];
  hits.sort((a, b) => a - b);

  const unique = [];
  for (const hit of hits) {
    if (unique.length && Math.abs(hit - unique[unique.length - 1]) <= 0.0001) continue;
    unique.push(hit);
  }

  const intervals = [];
  for (let index = 0; index + 1 < unique.length; index += 2) {
    if (unique[index + 1] > unique[index] + 0.0001) intervals.push([unique[index], unique[index + 1]]);
  }
  return intervals;
}

function zInsideIntervals(z, intervals) {
  for (const interval of intervals) {
    if (z >= interval[0] - 0.0001 && z <= interval[1] + 0.0001) return true;
  }
  return false;
}

function zVoxelOverlapsIntervals(z, pitch, intervals) {
  const half = Math.max(0.0001, Number(pitch) || 0) * 0.5;
  const minZ = z - half;
  const maxZ = z + half;
  for (const interval of intervals) {
    if (maxZ >= interval[0] - 0.0001 && minZ <= interval[1] + 0.0001) return true;
  }
  return false;
}

function indexedProjectionMeshFromTriangleVertices(vertices) {
  const source = vertices instanceof Float32Array ? vertices : new Float32Array(vertices ?? []);
  const vertexCount = Math.floor(source.length / 3);
  const triangles = new Uint32Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) triangles[index] = index;
  return {
    vertices: source,
    triangles,
    triangle_count: Math.floor(vertexCount / 3),
  };
}

function voxelClearanceOffsets(effectiveXy, effectiveZ, pitch) {
  const radius = Math.max(0, Number(effectiveXy) || 0);
  const zInflate = Math.max(0, Number(effectiveZ) || 0);
  const offsets = [{ dx: 0, dy: 0, zInflate, distance: 0 }];
  if (radius <= 0.0001) return offsets;

  const spacing = radius < pitch
    ? radius
    : Math.max(Math.max(0.2, pitch), radius / 4);
  const steps = Math.max(1, Math.ceil(radius / Math.max(0.0001, spacing)));
  const seen = new Set(["0:0"]);
  for (let oy = -steps; oy <= steps; oy += 1) {
    for (let ox = -steps; ox <= steps; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      const dx = ox * spacing;
      const dy = oy * spacing;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius + 0.0001) continue;
      const key = `${roundedCoordinate(dx)}:${roundedCoordinate(dy)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offsets.push({ dx, dy, zInflate, distance });
    }
  }
  offsets.sort((a, b) => a.distance - b.distance);
  return offsets;
}

function modelClearanceIntervalsAtXY(mesh, sampler, x, y, offsets, cache) {
  const expanded = [];
  for (const offset of offsets) {
    const sx = x + offset.dx;
    const sy = y + offset.dy;
    const key = `${Math.round(sx * 1000)}:${Math.round(sy * 1000)}`;
    let intervals = cache.get(key);
    if (!intervals) {
      intervals = supportZIntervalsAtXY(mesh, sx, sy, sampler);
      cache.set(key, intervals);
    }
    for (const interval of intervals) {
      expanded.push([
        interval[0] - offset.zInflate,
        interval[1] + offset.zInflate,
      ]);
    }
  }
  return mergeZIntervals(expanded);
}

function mergeZIntervals(intervals) {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const interval of intervals) {
    if (!merged.length || interval[0] > merged[merged.length - 1][1] + 0.0001) {
      merged.push([interval[0], interval[1]]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], interval[1]);
    }
  }
  return merged;
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

function adjustMediumIntervalMeshReachQa(meshQa, voxelClearanceQa) {
  if (!meshQa || meshQa.failed || !voxelClearanceQa?.available) return meshQa;
  if (voxelClearanceQa.method !== "interval-column-boolean") return meshQa;
  const maxGap = Number(meshQa.max_gap_mm ?? 0);
  const tolerance = Math.max(
    Number(meshQa.tolerance_mm ?? 0),
    Number(voxelClearanceQa.effective_z_mm ?? 0) + Number(voxelClearanceQa.voxel_size_mm ?? 0) * 0.25
  );
  if (!Number.isFinite(maxGap) || !Number.isFinite(tolerance) || maxGap > tolerance + 0.0001) return meshQa;
  return {
    ...meshQa,
    unsupported_cells_before_clearance_adjustment: Number(meshQa.unsupported_cells ?? 0),
    supported_percent_before_clearance_adjustment: Number(meshQa.supported_percent ?? 0),
    unsupported_cells: 0,
    supported_cells: Number(meshQa.sampled_cells ?? meshQa.supported_cells ?? 0),
    supported_percent: meshQa.sampled_cells ? 100 : Number(meshQa.supported_percent ?? 0),
    clearance_adjusted: true,
    clearance_adjusted_tolerance_mm: roundedCoordinate(tolerance),
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

function qaFailureReason(error, fallback) {
  const message = error?.message || String(error || "");
  return message ? `${fallback}: ${message}` : fallback;
}

function failedModelIntersectionQa(error) {
  return {
    available: false,
    failed: true,
    reason: qaFailureReason(error, "model intersection QA could not complete"),
    sampled_points: 0,
    intersection_samples: 0,
    intersects_model: false,
    max_penetration_mm: 0,
    needs_exact_trim: true,
  };
}

function failedMeshReachQa(error) {
  return {
    available: false,
    failed: true,
    reason: qaFailureReason(error, "mesh support reach QA could not complete"),
    sampled_cells: 0,
    supported_cells: 0,
    unsupported_cells: 0,
    supported_percent: 0,
    max_gap_mm: 0,
    max_overreach_mm: 0,
    tolerance_mm: 0,
  };
}

function failedStabilityQa(error) {
  return {
    available: false,
    failed: true,
    severity: "caution",
    reason: qaFailureReason(error, "stability QA could not complete"),
  };
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
  if (qa?.failed) {
    return `Model mesh QA warning: ${qa.reason || "model intersection QA could not complete"}.`;
  }
  if (!qa?.sampled_points) {
    return "Model mesh QA skipped because no cradle mesh samples were available.";
  }
  if (qa.intersects_model) {
    return `Model mesh QA warning: ${qa.intersection_samples.toLocaleString()} / ${qa.sampled_points.toLocaleString()} sampled cradle points appear inside the model, max approximate penetration ${formatStatusNumber(qa.max_penetration_mm)} mm.`;
  }
  return `Model mesh QA: no sampled cradle points are materially inside the model across ${qa.sampled_points.toLocaleString()} samples.`;
}

function evaluateExactTrimGateQa(mesh, clearance = {}, options = {}) {
  const cellSize = Number(mesh?.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8;
  if (!state.modelMesh?.geometry?.boundsTree || !mesh?.vertices?.length || !mesh?.triangles?.length) {
    return {
      available: false,
      reason: state.modelMesh?.geometry?.boundsTree ? "no generated cradle mesh samples were available" : "model BVH is unavailable",
      sampled_points: 0,
      near_clearance_samples: 0,
      needs_exact_trim: true,
    };
  }

  const xy = Math.max(0, Number(clearance?.xy_mm) || 0);
  const z = Math.max(0, Number(clearance?.z_mm) || 0);
  const clearanceRadius = Math.max(xy, z);
  const tolerance = Math.max(0.12, cellSize * 0.35);
  const threshold = clearanceRadius + tolerance;
  const samples = splitChunkQaSamples(
    [{ id: "cradle", mesh }],
    exactTrimGateSampleLimit(mesh, options.phase || "high")
  );
  if (!samples.length) {
    return {
      available: false,
      reason: "no generated cradle mesh samples were available",
      sampled_points: 0,
      near_clearance_samples: 0,
      needs_exact_trim: true,
    };
  }

  const modelIndex = modelQaIndex({ surfaceTolerance: tolerance });
  let nearSamples = 0;
  let minDistance = Infinity;
  for (const sample of samples) {
    const distance = closestModelDistance(sample, modelIndex, tolerance);
    minDistance = Math.min(minDistance, distance);
    if (distance <= threshold) nearSamples += 1;
  }

  return {
    available: true,
    method: "bvh",
    sampled_points: samples.length,
    near_clearance_samples: nearSamples,
    near_clearance_percent: roundedCoordinate((nearSamples / samples.length) * 100),
    min_distance_mm: roundedCoordinate(Number.isFinite(minDistance) ? minDistance : 0),
    threshold_mm: roundedCoordinate(threshold),
    clearance_xy_mm: roundedCoordinate(xy),
    clearance_z_mm: roundedCoordinate(z),
    tolerance_mm: roundedCoordinate(tolerance),
    needs_exact_trim: nearSamples > 0,
  };
}

function exactTrimGateSampleLimit(mesh, phase = "high") {
  const triangleCount = Math.floor((mesh?.triangles?.length ?? 0) / 3);
  if (triangleCount > 750000) return phase === "high" ? 9000 : 5000;
  if (triangleCount > 250000) return phase === "high" ? 12000 : 7000;
  return phase === "high" ? 16000 : 10000;
}

function formatExactTrimGateQaStatus(qa) {
  if (!qa) return "BVH trim gate skipped because no cradle mesh was available.";
  if (!qa.available) {
    return `BVH trim gate unavailable (${qa.reason || "unknown reason"}); exact object trim was kept.`;
  }
  if (qa.needs_exact_trim) {
    return `BVH trim diagnostic: ${qa.near_clearance_samples.toLocaleString()} / ${qa.sampled_points.toLocaleString()} sampled cradle points are within the requested clearance band; nearest sampled distance ${formatStatusNumber(qa.min_distance_mm)} mm.`;
  }
  return `BVH trim diagnostic: ${qa.sampled_points.toLocaleString()} sampled cradle points were outside the requested clearance band; nearest sampled distance ${formatStatusNumber(qa.min_distance_mm)} mm, gate threshold ${formatStatusNumber(qa.threshold_mm)} mm. Exact trim still ran in high accuracy mode.`;
}

async function buildVoxelBooleanCradleMesh(mesh, clearance = {}, options = {}) {
  const bounds = supportMeshBounds(mesh);
  if (!Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) {
    return {
      mesh,
      qa: {
        available: false,
        reason: "source cradle bounds were unavailable",
        sampled_voxels: 0,
        inside_samples: 0,
        clearance_violation_samples: 0,
      },
    };
  }

  const cellSize = Number(mesh.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8;
  const requestedPitch = mediumClearanceVoxelSize(cellSize, clearance);
  let pitch = requestedPitch;
  const width = Math.max(pitch, bounds.max.x - bounds.min.x);
  const depth = Math.max(pitch, bounds.max.y - bounds.min.y);
  const requestedColumns = Math.max(1, Math.ceil(width / pitch) * Math.ceil(depth / pitch));
  if (requestedColumns > MEDIUM_CLEARANCE_MAX_COLUMNS) {
    pitch = Math.max(pitch, Math.sqrt((width * depth) / MEDIUM_CLEARANCE_MAX_COLUMNS));
  }
  const nx = Math.max(1, Math.ceil(width / pitch));
  const ny = Math.max(1, Math.ceil(depth / pitch));
  const effectiveColumns = nx * ny;
  const resolutionAdjusted = Math.abs(pitch - requestedPitch) > 0.001;

  const xy = Math.max(0, Number(clearance.xy_mm) || 0);
  const zClearance = Math.max(0, Number(clearance.z_mm) || 0);
  const safety = Math.max(0.04, pitch * 0.9);
  const effectiveXy = xy + safety;
  const effectiveZ = zClearance + safety;
  const pad = Math.max(effectiveXy, effectiveZ, pitch * 2);
  const sampler = buildSupportTopSampler(mesh, Math.max(pitch, cellSize), []);
  const modelPayload = buildMeshPayload();
  const modelProjectionMesh = indexedProjectionMeshFromTriangleVertices(modelPayload.vertices ?? []);
  const modelProjectionSampler = buildSupportTopSampler(modelProjectionMesh, Math.max(0.25, Math.max(pitch, effectiveXy)));
  const modelBounds = supportMeshBounds(modelProjectionMesh);
  const modelClearanceOffsets = voxelClearanceOffsets(effectiveXy, effectiveZ, pitch);
  const modelIntervalCache = new Map();
  let webGpuClearance = null;
  try {
    webGpuClearance = await buildWebGpuClearanceField({
      bounds,
      pitch,
      nx,
      ny,
      effectiveXy,
      effectiveZ,
      pad,
      modelProjectionMesh,
      modelProjectionSampler,
      modelBounds,
      modelClearanceOffsets,
      onProgress: async (progress, message) => {
        await options.onProgress?.(progress * 0.35, message);
      },
    });
  } catch (error) {
    console.warn("WebGPU clearance field failed; falling back to CPU interval clearance.", error);
    webGpuClearance = {
      available: false,
      reason: error?.message || String(error),
    };
  }
  if (!webGpuClearance?.available && nx * ny > WEBGPU_CLEARANCE_CPU_FALLBACK_MAX_COLUMNS) {
    throw new Error(
      `Medium WebGPU clearance is not available for this ${nx.toLocaleString()} x ${ny.toLocaleString()} column field (${webGpuClearance?.reason || "unknown reason"}). CradleMaker did not run the slow CPU fallback for this large model.`
    );
  }
  const columnIntervals = new Array(nx * ny);
  let activeColumns = 0;
  let sourceUnits = 0;
  let keptUnits = 0;
  let removedUnits = 0;
  let liftLockRemovedUnits = 0;
  let insideSamples = 0;
  let clearanceSamples = 0;
  let minDistance = Infinity;

  for (let iy = 0; iy < ny; iy += 1) {
    const y = bounds.min.y + (iy + 0.5) * pitch;
    for (let ix = 0; ix < nx; ix += 1) {
      const x = bounds.min.x + (ix + 0.5) * pitch;
      const columnIndex = iy * nx + ix;
      const sourceIntervals = supportZIntervalsAtXY(mesh, x, y, sampler);
      const sourceTop = sourceIntervals.length ? sourceIntervals[sourceIntervals.length - 1][1] : -Infinity;
      if (!Number.isFinite(sourceTop) || sourceTop <= bounds.min.z + pitch * 0.2) continue;
      activeColumns += 1;
      const nearModelXY =
        x >= modelBounds.min.x - pad && x <= modelBounds.max.x + pad &&
        y >= modelBounds.min.y - pad && y <= modelBounds.max.y + pad;
      const gpuFirstBlockZ = webGpuClearance?.firstBlockZ?.[columnIndex];
      const useGpuFirstBlock = Number.isFinite(gpuFirstBlockZ);
      const modelIntervals = !useGpuFirstBlock && nearModelXY
        ? modelClearanceIntervalsAtXY(
            modelProjectionMesh,
            modelProjectionSampler,
            x,
            y,
            modelClearanceOffsets,
            modelIntervalCache
          )
        : [];
      const firstBlockZ = useGpuFirstBlock
        ? gpuFirstBlockZ
        : modelIntervals.length ? modelIntervals[0][0] : Infinity;
      const clippedIntervals = clipIntervalsBelow(sourceIntervals, firstBlockZ - 0.0001);
      const sourceLength = zIntervalLength(sourceIntervals);
      const keptLength = zIntervalLength(clippedIntervals);
      sourceUnits += Math.ceil(sourceLength / pitch);
      keptUnits += Math.ceil(keptLength / pitch);
      const removedLength = Math.max(0, sourceLength - keptLength);
      if (removedLength > 0) {
        removedUnits += Math.ceil(removedLength / pitch);
        liftLockRemovedUnits += Math.ceil(removedLength / pitch);
        minDistance = Math.min(minDistance, 0);
        if (useGpuFirstBlock || modelIntervals.length) clearanceSamples += 1;
      }
      if (clippedIntervals.length) {
        columnIntervals[columnIndex] = clippedIntervals;
      }
    }

    if (iy > 0 && iy % 12 === 0) {
      await options.onProgress?.(
        0.35 + (iy / ny) * 0.65,
        `Running medium interval clearance (${iy.toLocaleString()} / ${ny.toLocaleString()} rows, ${keptUnits.toLocaleString()} vertical units kept)...`
      );
      await nextFrame();
    }
  }

  const booleanMesh = intervalColumnsToSupportMesh({
    bounds,
    pitch,
    nx,
    ny,
    columns: columnIntervals,
    cellSize,
    maxTriangles: MEDIUM_CLEARANCE_MAX_RECONSTRUCTED_TRIANGLES,
  });
  await options.onProgress?.(1, "Medium interval clearance mesh complete");

  return {
    mesh: booleanMesh,
    qa: {
      available: true,
      method: "interval-column-boolean",
      accelerator: webGpuClearance?.available ? "webgpu-clearance-field" : "cpu-interval",
      webgpu: webGpuClearance
        ? {
            available: Boolean(webGpuClearance.available),
            reason: webGpuClearance.reason || "",
            jobs: Number(webGpuClearance.jobs || 0),
            passes: Number(webGpuClearance.passes || 0),
          }
        : { available: false, reason: "WebGPU clearance was not attempted" },
      sampled_voxels: sourceUnits,
      source_voxels: sourceUnits,
      kept_voxels: keptUnits,
      removed_voxels: removedUnits,
      lift_lock_removed_voxels: liftLockRemovedUnits,
      sampled_columns: activeColumns,
      requested_columns: requestedColumns,
      effective_columns: effectiveColumns,
      max_columns: MEDIUM_CLEARANCE_MAX_COLUMNS,
      grid_voxels: nx * ny,
      grid: { nx, ny, nz: 0 },
      inside_samples: insideSamples,
      clearance_violation_samples: clearanceSamples,
      voxel_size_mm: roundedCoordinate(pitch),
      requested_pitch_mm: roundedCoordinate(requestedPitch),
      resolution_adjusted: resolutionAdjusted,
      tolerance_mm: roundedCoordinate(safety),
      requested_xy_mm: roundedCoordinate(xy),
      requested_z_mm: roundedCoordinate(zClearance),
      effective_xy_mm: roundedCoordinate(effectiveXy),
      effective_z_mm: roundedCoordinate(effectiveZ),
      min_distance_mm: roundedCoordinate(Number.isFinite(minDistance) ? minDistance : 0),
      triangle_count: booleanMesh.triangle_count,
    },
  };
}

function clipIntervalsBelow(intervals, ceiling) {
  if (!Number.isFinite(ceiling)) return intervals.map((interval) => [interval[0], interval[1]]);
  const clipped = [];
  for (const interval of intervals) {
    const min = Number(interval[0]);
    const max = Math.min(Number(interval[1]), ceiling);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min + 0.0001) {
      clipped.push([roundedCoordinate(min), roundedCoordinate(max)]);
    }
  }
  return clipped;
}

async function buildWebGpuClearanceField({
  bounds,
  pitch,
  nx,
  ny,
  effectiveXy,
  effectiveZ,
  pad,
  modelProjectionMesh,
  modelProjectionSampler,
  modelBounds,
  modelClearanceOffsets,
  onProgress = null,
}) {
  if (!globalThis.navigator?.gpu) {
    return { available: false, reason: "WebGPU is not available in this browser" };
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return { available: false, reason: "WebGPU adapter is not available" };
  }
  const device = await adapter.requestDevice();
  const triangleCount = Math.floor((modelProjectionMesh?.triangles?.length ?? 0) / 3);
  if (!triangleCount) {
    return { available: false, reason: "no model triangles were available for WebGPU clearance" };
  }

  await onProgress?.(0, "Preparing WebGPU clearance field...");
  const vertexBufferData = modelProjectionMesh.vertices instanceof Float32Array
    ? modelProjectionMesh.vertices
    : new Float32Array(modelProjectionMesh.vertices ?? []);
  const outputCount = Math.max(1, nx * ny);
  const limits = adapter.limits ?? {};
  const maxStorageBufferBindingSize = Number(limits.maxStorageBufferBindingSize) || 128 * 1024 * 1024;
  if (vertexBufferData.byteLength > maxStorageBufferBindingSize) {
    return {
      available: false,
      reason: `model vertex buffer ${formatBytes(vertexBufferData.byteLength)} exceeds this WebGPU adapter's ${formatBytes(maxStorageBufferBindingSize)} storage-buffer limit`,
    };
  }
  if (outputCount * Uint32Array.BYTES_PER_ELEMENT > maxStorageBufferBindingSize) {
    return {
      available: false,
      reason: `clearance field ${formatBytes(outputCount * Uint32Array.BYTES_PER_ELEMENT)} exceeds this WebGPU adapter's ${formatBytes(maxStorageBufferBindingSize)} storage-buffer limit`,
    };
  }
  const encodedInfinity = 0xffffffff;
  const encodedFirstZ = new Uint32Array(outputCount);
  encodedFirstZ.fill(encodedInfinity);
  const zOrigin = Math.min(bounds.min.z, modelBounds.min.z) - Math.max(effectiveZ, pitch * 2) - 1;
  const zScale = 1000;

  const vertexBuffer = device.createBuffer({
    size: alignGpuBufferSize(vertexBufferData.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(vertexBuffer, 0, vertexBufferData);
  const outputBuffer = device.createBuffer({
    size: alignGpuBufferSize(encodedFirstZ.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(outputBuffer, 0, encodedFirstZ);
  const paramsBuffer = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const shader = device.createShaderModule({
    label: "CradleMaker medium clearance field",
    code: `
struct Query {
  sx: f32,
  sy: f32,
  zInflate: f32,
  pad: f32,
};
struct Meta {
  column: u32,
  triStart: u32,
};
struct Params {
  jobCount: u32,
  zOrigin: f32,
  zScale: f32,
  epsilon: f32,
};
@group(0) @binding(0) var<storage, read> vertices: array<f32>;
@group(0) @binding(1) var<storage, read> queries: array<Query>;
@group(0) @binding(2) var<storage, read> meta: array<Meta>;
@group(0) @binding(3) var<storage, read_write> firstZ: array<atomic<u32>>;
@group(0) @binding(4) var<uniform> params: Params;

fn vertexAt(vertexIndex: u32) -> vec3f {
  let offset = vertexIndex * 3u;
  return vec3f(vertices[offset], vertices[offset + 1u], vertices[offset + 2u]);
}

@compute @workgroup_size(${WEBGPU_CLEARANCE_WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) globalId: vec3u) {
  let jobIndex = globalId.x;
  if (jobIndex >= params.jobCount) {
    return;
  }
  let query = queries[jobIndex];
  let jobMeta = meta[jobIndex];
  let a = vertexAt(jobMeta.triStart);
  let b = vertexAt(jobMeta.triStart + 1u);
  let c = vertexAt(jobMeta.triStart + 2u);
  let denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (abs(denominator) < 0.000000001) {
    return;
  }
  let u = ((b.y - c.y) * (query.sx - c.x) + (c.x - b.x) * (query.sy - c.y)) / denominator;
  let v = ((c.y - a.y) * (query.sx - c.x) + (a.x - c.x) * (query.sy - c.y)) / denominator;
  let w = 1.0 - u - v;
  if (u < -params.epsilon || v < -params.epsilon || w < -params.epsilon) {
    return;
  }
  let z = a.z * u + b.z * v + c.z * w - query.zInflate;
  let encodedFloat = clamp(round((z - params.zOrigin) * params.zScale), 0.0, 4294967294.0);
  atomicMin(&firstZ[jobMeta.column], u32(encodedFloat));
}
`,
  });
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
    ],
  });
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
    compute: { module: shader, entryPoint: "main" },
  });

  let jobs = [];
  let meta = [];
  let totalJobs = 0;
  let passes = 0;
  const flushJobs = async (forceMessage = "") => {
    const jobCount = Math.floor(meta.length / 2);
    if (!jobCount) return;
    const queryData = new Float32Array(jobs);
    const metaData = new Uint32Array(meta);
    const queryBuffer = device.createBuffer({
      size: alignGpuBufferSize(queryData.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const metaBuffer = device.createBuffer({
      size: alignGpuBufferSize(metaData.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(queryBuffer, 0, queryData);
    device.queue.writeBuffer(metaBuffer, 0, metaData);
    device.queue.writeBuffer(paramsBuffer, 0, new Uint32Array([jobCount]).buffer);
    device.queue.writeBuffer(paramsBuffer, 4, new Float32Array([zOrigin, zScale, 0.000001]));
    const bindGroup = device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: queryBuffer } },
        { binding: 2, resource: { buffer: metaBuffer } },
        { binding: 3, resource: { buffer: outputBuffer } },
        { binding: 4, resource: { buffer: paramsBuffer } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(jobCount / WEBGPU_CLEARANCE_WORKGROUP_SIZE));
    pass.end();
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    queryBuffer.destroy?.();
    metaBuffer.destroy?.();
    passes += 1;
    totalJobs += jobCount;
    jobs = [];
    meta = [];
    if (forceMessage) await onProgress?.(Math.min(0.95, passes / Math.max(1, passes + 2)), forceMessage);
  };

  const addJob = (column, sx, sy, zInflate, triStart) => {
    jobs.push(sx, sy, zInflate, 0);
    meta.push(column, triStart);
  };

  const totalRows = Math.max(1, ny);
  for (let iy = 0; iy < ny; iy += 1) {
    const y = bounds.min.y + (iy + 0.5) * pitch;
    for (let ix = 0; ix < nx; ix += 1) {
      const x = bounds.min.x + (ix + 0.5) * pitch;
      if (
        x < modelBounds.min.x - pad || x > modelBounds.max.x + pad ||
        y < modelBounds.min.y - pad || y > modelBounds.max.y + pad
      ) {
        continue;
      }
      const column = iy * nx + ix;
      for (const offset of modelClearanceOffsets) {
        const sx = x + offset.dx;
        const sy = y + offset.dy;
        const triangleStarts = modelProjectionSampler.bins.get(modelProjectionSampler.binKey(sx, sy)) ?? [];
        for (const triStart of triangleStarts) {
          addJob(column, sx, sy, offset.zInflate, triStart);
          if (meta.length / 2 >= WEBGPU_CLEARANCE_MAX_JOBS_PER_PASS) {
            await flushJobs(`Running WebGPU clearance field (${iy.toLocaleString()} / ${totalRows.toLocaleString()} rows, ${totalJobs.toLocaleString()} triangle tests submitted)...`);
          }
        }
      }
    }
    if (iy > 0 && iy % 24 === 0) {
      await onProgress?.(Math.min(0.9, iy / totalRows), `Preparing WebGPU clearance field (${iy.toLocaleString()} / ${totalRows.toLocaleString()} rows)...`);
      await nextFrame();
    }
  }
  await flushJobs("Finishing WebGPU clearance field...");

  const readBuffer = device.createBuffer({
    size: alignGpuBufferSize(encodedFirstZ.byteLength),
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyBufferToBuffer(outputBuffer, 0, readBuffer, 0, encodedFirstZ.byteLength);
  device.queue.submit([encoder.finish()]);
  await readBuffer.mapAsync(GPUMapMode.READ);
  const encoded = new Uint32Array(readBuffer.getMappedRange().slice(0));
  readBuffer.unmap();
  vertexBuffer.destroy?.();
  outputBuffer.destroy?.();
  paramsBuffer.destroy?.();
  device.destroy?.();

  const firstBlockZ = new Float32Array(outputCount);
  firstBlockZ.fill(Infinity);
  let blockedColumns = 0;
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] === encodedInfinity) continue;
    firstBlockZ[index] = zOrigin + encoded[index] / zScale;
    blockedColumns += 1;
  }

  return {
    available: true,
    method: "webgpu-first-block-z",
    firstBlockZ,
    jobs: totalJobs,
    passes,
    blocked_columns: blockedColumns,
    pitch_mm: pitch,
    effective_xy_mm: effectiveXy,
    effective_z_mm: effectiveZ,
  };
}

function alignGpuBufferSize(size) {
  return Math.max(4, Math.ceil(Math.max(0, Number(size) || 0) / 4) * 4);
}

function zIntervalLength(intervals) {
  let length = 0;
  for (const interval of intervals ?? []) {
    const min = Number(interval[0]);
    const max = Number(interval[1]);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) length += max - min;
  }
  return length;
}

function subtractZIntervals(interval, blockers) {
  let remaining = [[interval[0], interval[1]]];
  for (const blocker of blockers ?? []) {
    const b0 = Number(blocker[0]);
    const b1 = Number(blocker[1]);
    if (!Number.isFinite(b0) || !Number.isFinite(b1) || b1 <= b0) continue;
    const next = [];
    for (const segment of remaining) {
      const s0 = segment[0];
      const s1 = segment[1];
      if (b1 <= s0 + 0.0001 || b0 >= s1 - 0.0001) {
        next.push(segment);
        continue;
      }
      if (b0 > s0 + 0.0001) next.push([s0, Math.min(b0, s1)]);
      if (b1 < s1 - 0.0001) next.push([Math.max(b1, s0), s1]);
    }
    remaining = next;
    if (!remaining.length) break;
  }
  return remaining.filter((segment) => segment[1] > segment[0] + 0.0001);
}

function intervalColumnsToSupportMesh({ bounds, pitch, nx, ny, columns, cellSize, maxTriangles = Infinity }) {
  const intervalsAt = (ix, iy) =>
    ix >= 0 && ix < nx && iy >= 0 && iy < ny
      ? columns[iy * nx + ix] ?? []
      : [];
  let quadCount = 0;
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const intervals = intervalsAt(ix, iy);
      if (!intervals.length) continue;
      for (const interval of intervals) {
        quadCount += 2;
        quadCount += subtractZIntervals(interval, intervalsAt(ix - 1, iy)).length;
        quadCount += subtractZIntervals(interval, intervalsAt(ix + 1, iy)).length;
        quadCount += subtractZIntervals(interval, intervalsAt(ix, iy - 1)).length;
        quadCount += subtractZIntervals(interval, intervalsAt(ix, iy + 1)).length;
      }
    }
  }

  const triangleCount = quadCount * 2;
  if (triangleCount > maxTriangles) {
    throw new Error(
      `Medium clearance mesh would reconstruct ${triangleCount.toLocaleString()} triangles, above the ${Math.round(maxTriangles).toLocaleString()} triangle browser safety limit. Use a coarser cradle resolution or high accuracy exact trimming for this model.`
    );
  }

  const vertices = new Float32Array(quadCount * 12);
  const triangles = new Uint32Array(quadCount * 6);
  let vertexValueOffset = 0;
  let triangleValueOffset = 0;
  let vertexIndex = 0;
  const addVertex = (x, y, z) => {
    const index = vertexIndex;
    vertices[vertexValueOffset] = roundedCoordinate(x);
    vertices[vertexValueOffset + 1] = roundedCoordinate(y);
    vertices[vertexValueOffset + 2] = roundedCoordinate(z);
    vertexValueOffset += 3;
    vertexIndex += 1;
    return index;
  };
  const addQuad = (a, b, c, d) => {
    triangles[triangleValueOffset] = a;
    triangles[triangleValueOffset + 1] = b;
    triangles[triangleValueOffset + 2] = c;
    triangles[triangleValueOffset + 3] = a;
    triangles[triangleValueOffset + 4] = c;
    triangles[triangleValueOffset + 5] = d;
    triangleValueOffset += 6;
  };
  const x0For = (ix) => bounds.min.x + ix * pitch;
  const y0For = (iy) => bounds.min.y + iy * pitch;
  const x1For = (ix) => Math.min(bounds.max.x, bounds.min.x + (ix + 1) * pitch);
  const y1For = (iy) => Math.min(bounds.max.y, bounds.min.y + (iy + 1) * pitch);
  const addHorizontalFace = (x0, x1, y0, y1, z, top) => {
    if (top) {
      addQuad(addVertex(x0, y0, z), addVertex(x1, y0, z), addVertex(x1, y1, z), addVertex(x0, y1, z));
    } else {
      addQuad(addVertex(x0, y0, z), addVertex(x0, y1, z), addVertex(x1, y1, z), addVertex(x1, y0, z));
    }
  };
  const addSideFace = (x0, x1, y0, y1, z0, z1, face) => {
    if (face === "-x") {
      addQuad(addVertex(x0, y0, z0), addVertex(x0, y0, z1), addVertex(x0, y1, z1), addVertex(x0, y1, z0));
    } else if (face === "+x") {
      addQuad(addVertex(x1, y0, z0), addVertex(x1, y1, z0), addVertex(x1, y1, z1), addVertex(x1, y0, z1));
    } else if (face === "-y") {
      addQuad(addVertex(x0, y0, z0), addVertex(x1, y0, z0), addVertex(x1, y0, z1), addVertex(x0, y0, z1));
    } else if (face === "+y") {
      addQuad(addVertex(x0, y1, z0), addVertex(x0, y1, z1), addVertex(x1, y1, z1), addVertex(x1, y1, z0));
    }
  };

  for (let iy = 0; iy < ny; iy += 1) {
    const y0 = y0For(iy);
    const y1 = y1For(iy);
    for (let ix = 0; ix < nx; ix += 1) {
      const intervals = intervalsAt(ix, iy);
      if (!intervals.length) continue;
      const x0 = x0For(ix);
      const x1 = x1For(ix);
      for (const interval of intervals) {
        const z0 = interval[0];
        const z1 = interval[1];
        addHorizontalFace(x0, x1, y0, y1, z0, false);
        addHorizontalFace(x0, x1, y0, y1, z1, true);
        for (const segment of subtractZIntervals(interval, intervalsAt(ix - 1, iy))) {
          addSideFace(x0, x1, y0, y1, segment[0], segment[1], "-x");
        }
        for (const segment of subtractZIntervals(interval, intervalsAt(ix + 1, iy))) {
          addSideFace(x0, x1, y0, y1, segment[0], segment[1], "+x");
        }
        for (const segment of subtractZIntervals(interval, intervalsAt(ix, iy - 1))) {
          addSideFace(x0, x1, y0, y1, segment[0], segment[1], "-y");
        }
        for (const segment of subtractZIntervals(interval, intervalsAt(ix, iy + 1))) {
          addSideFace(x0, x1, y0, y1, segment[0], segment[1], "+y");
        }
      }
    }
  }

  return {
    vertices,
    triangles,
    triangle_count: Math.floor(triangleValueOffset / 3),
    cell_size_mm: cellSize,
  };
}

function canUseIndependentVoxelBooleanWorkers() {
  return typeof Worker === "function";
}

async function buildVoxelBooleanCradleMeshWithIndependentWorkers(mesh, clearance = {}, options = {}) {
  const bounds = options.bounds ?? supportMeshBounds(mesh);
  const cellSize = Number(options.cellSize) || Number(mesh.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8;
  const requestedPitch = Number(options.requestedPitch) || mediumClearanceVoxelSize(cellSize, clearance);
  const pitch = Number(options.pitch) || requestedPitch;
  const nx = Math.max(1, Math.floor(Number(options.nx) || 1));
  const ny = Math.max(1, Math.floor(Number(options.ny) || 1));
  const nz = Math.max(1, Math.floor(Number(options.nz) || 1));
  const gridVoxels = Math.max(1, Number(options.gridVoxels) || nx * ny * nz);
  const modelPayload = buildMeshPayload();
  const modelVertices = modelPayload.vertices ?? new Float32Array(0);
  const workerCount = independentVoxelWorkerCount(mesh, modelVertices, { nx, ny, nz });
  if (workerCount <= 0) throw new Error("independent voxel workers are unavailable");
  const tasks = independentVoxelTileTasks({ nx, ny, nz, workerCount });
  const tileShape = independentVoxelTileShape({ nx, ny, nz, workerCount });
  const localTileVoxels = Math.max(1, tileShape.localCols) * Math.max(1, tileShape.localRows) * Math.max(1, nz);
  const tileMemoryBudgetBytes = mediumVoxelLocalVoxelBudget({ nx, ny, nz }) * MEDIUM_VOXEL_ESTIMATED_BYTES_PER_LOCAL_VOXEL;
  if (tasks.length > MEDIUM_VOXEL_MAX_TILE_COUNT) {
    throw new Error(
      `Medium accuracy aborted: voxel clearance would require ${tasks.length.toLocaleString()} worker tiles at ${formatStatusNumber(pitch)} mm pitch. Increase voxel pitch or use high accuracy for this model.`
    );
  }
  const workerInputs = {
    bounds,
    pitch,
    cellSize,
    nx,
    ny,
    nz,
    clearance: {
      xy_mm: Math.max(0, Number(clearance.xy_mm) || 0),
      z_mm: Math.max(0, Number(clearance.z_mm) || 0),
    },
    supportVertices: mesh.vertices,
    supportTriangles: mesh.triangles,
    modelVertices,
  };
  await options.onProgress?.(
    0,
    `Starting medium voxel boolean across ${workerCount} independent worker${workerCount === 1 ? "" : "s"} and ${tasks.length.toLocaleString()} tile${tasks.length === 1 ? "" : "s"} (${tileShape.coreCols.toLocaleString()} x ${tileShape.coreRows.toLocaleString()} core XY, ${localTileVoxels.toLocaleString()} local voxels/tile, ${formatBytes(tileMemoryBudgetBytes)} calculated budget)...`
  );
  await nextFrame();

  const workers = [];
  try {
    for (let index = 0; index < workerCount; index += 1) {
      workers.push(await createIndependentVoxelWorker(workerInputs, index));
    }

    const pieces = [];
    const qa = {
      source_voxels: 0,
      kept_voxels: 0,
      removed_voxels: 0,
      lift_lock_removed_voxels: 0,
      sampled_columns: 0,
      inside_samples: 0,
      clearance_violation_samples: 0,
      min_distance_mm: Infinity,
    };
    let nextTaskIndex = 0;
    let completedTasks = 0;
    const runWorker = async (slot) => {
      while (nextTaskIndex < tasks.length) {
        const task = tasks[nextTaskIndex];
        nextTaskIndex += 1;
        const result = await slot.requestTile(task);
        if (result?.mesh?.vertices?.length && result?.mesh?.triangles?.length) {
          pieces.push(result.mesh);
        }
        accumulateIndependentVoxelQa(qa, result?.qa);
        completedTasks += 1;
        if (completedTasks === 1 || completedTasks === tasks.length || completedTasks % Math.max(1, Math.floor(tasks.length / 20)) === 0) {
          await options.onProgress?.(
            completedTasks / tasks.length,
            `Running medium voxel boolean (${completedTasks.toLocaleString()} / ${tasks.length.toLocaleString()} tiles, ${qa.kept_voxels.toLocaleString()} voxels kept)...`
          );
          await nextFrame();
        }
      }
    };

    await Promise.all(workers.map(runWorker));
    const booleanMesh = mergeSupportMeshPieces(pieces, cellSize);
    await options.onProgress?.(1, "Medium voxel boolean mesh complete");

    return {
      mesh: booleanMesh,
      qa: {
        available: true,
        method: "voxel-boolean",
        worker_mode: "independent-tiled-workers",
        worker_count: workerCount,
        tile_count: tasks.length,
        sampled_voxels: qa.source_voxels,
        source_voxels: qa.source_voxels,
        kept_voxels: qa.kept_voxels,
        removed_voxels: qa.removed_voxels,
        lift_lock_removed_voxels: qa.lift_lock_removed_voxels,
        sampled_columns: qa.sampled_columns,
        grid_voxels: gridVoxels,
        grid: { nx, ny, nz },
        inside_samples: qa.inside_samples,
        clearance_violation_samples: qa.clearance_violation_samples,
        voxel_size_mm: roundedCoordinate(pitch),
        requested_pitch_mm: roundedCoordinate(requestedPitch),
        tolerance_mm: roundedCoordinate(Math.max(0.04, pitch * 0.9)),
        requested_xy_mm: roundedCoordinate(workerInputs.clearance.xy_mm),
        requested_z_mm: roundedCoordinate(workerInputs.clearance.z_mm),
        effective_xy_mm: roundedCoordinate(workerInputs.clearance.xy_mm + Math.max(0.04, pitch * 0.9)),
        effective_z_mm: roundedCoordinate(workerInputs.clearance.z_mm + Math.max(0.04, pitch * 0.9)),
        min_distance_mm: roundedCoordinate(Number.isFinite(qa.min_distance_mm) ? qa.min_distance_mm : 0),
        triangle_count: booleanMesh.triangle_count,
      },
    };
  } finally {
    for (const slot of workers) slot.terminate();
  }
}

function independentVoxelWorkerCount(mesh, modelVertices, grid) {
  if (typeof Worker !== "function") return 0;
  const hardware = Math.max(1, Number(navigator.hardwareConcurrency) || 1);
  const inputBytes =
    Number(mesh?.vertices?.byteLength || 0) +
    Number(mesh?.triangles?.byteLength || 0) +
    Number(modelVertices?.byteLength || 0);
  const gridVoxels = Math.max(1, Number(grid.nx) * Number(grid.ny) * Number(grid.nz));
  let count = Math.min(4, Math.max(1, Math.floor(hardware / 2)));
  const localTileVoxels = estimatedIndependentVoxelTileVoxels(grid);
  if (inputBytes > 300 * 1024 * 1024) count = Math.min(count, 2);
  if (localTileVoxels > mediumVoxelLocalVoxelBudget(grid) * 0.75) count = Math.min(count, 2);
  if (gridVoxels < 1000000) count = Math.min(count, 2);
  return Math.max(1, Math.min(count, Number(grid.ny) || 1));
}

function estimatedIndependentVoxelTileVoxels({ nx, ny, nz }) {
  const shape = independentVoxelTileShape({ nx, ny, nz, workerCount: 4 });
  return Math.max(1, shape.localCols) * Math.max(1, shape.localRows) * Math.max(1, Number(nz) || 1);
}

function mediumVoxelLocalVoxelBudget(grid = {}) {
  const maxBudget = Math.max(1, Math.floor(MEDIUM_VOXEL_MAX_TILE_MEMORY_BUDGET_BYTES / MEDIUM_VOXEL_ESTIMATED_BYTES_PER_LOCAL_VOXEL));
  const totalVoxels = Math.max(1, Number(grid.nx) || 1) *
    Math.max(1, Number(grid.ny) || 1) *
    Math.max(1, Number(grid.nz) || 1);
  const targetBudget = Math.ceil((totalVoxels / MEDIUM_VOXEL_TARGET_TILE_COUNT) * 1.15);
  return Math.max(1, Math.min(maxBudget, targetBudget));
}

function independentVoxelPlanFits(grid, maxTileCount) {
  const shape = independentVoxelTileShape({ ...grid, workerCount: 4 });
  const localVoxels = Math.max(1, shape.localCols) * Math.max(1, shape.localRows) * Math.max(1, Number(grid.nz) || 1);
  const tileCount = Math.ceil(Math.max(1, Number(grid.nx) || 1) / shape.coreCols) *
    Math.ceil(Math.max(1, Number(grid.ny) || 1) / shape.coreRows);
  return !shape.impossible && localVoxels <= mediumVoxelLocalVoxelBudget(grid) && tileCount <= maxTileCount;
}

function independentVoxelTileShape({ nx, ny, nz, workerCount }) {
  const safeNx = Math.max(1, Number(nx) || 1);
  const safeNy = Math.max(1, Number(ny) || 1);
  const safeNz = Math.max(1, Number(nz) || 1);
  const haloCols = 1;
  const haloRows = 1;
  const maxLocalColumns = Math.max(1, Math.floor(mediumVoxelLocalVoxelBudget({ nx: safeNx, ny: safeNy, nz: safeNz }) / safeNz));
  const minLocalCols = Math.min(safeNx, 1 + haloCols * 2);
  const minLocalRows = Math.min(safeNy, 1 + haloRows * 2);
  if (minLocalCols * minLocalRows > maxLocalColumns) {
    return {
      coreCols: 1,
      coreRows: 1,
      haloCols,
      haloRows,
      localCols: minLocalCols,
      localRows: minLocalRows,
      impossible: true,
    };
  }

  const aspect = Math.max(0.05, Math.min(20, safeNx / safeNy));
  const idealLocalCols = Math.max(minLocalCols, Math.min(safeNx, Math.floor(Math.sqrt(maxLocalColumns * aspect))));
  let best = null;
  const consider = (candidateCols) => {
    const localCols = Math.max(minLocalCols, Math.min(safeNx, Math.floor(candidateCols)));
    if (!Number.isFinite(localCols) || localCols < minLocalCols) return;
    const localRows = Math.max(minLocalRows, Math.min(safeNy, Math.floor(maxLocalColumns / localCols)));
    if (localCols * localRows > maxLocalColumns) return;
    const coreCols = safeNx <= localCols ? safeNx : Math.max(1, localCols - haloCols * 2);
    const coreRows = safeNy <= localRows ? safeNy : Math.max(1, localRows - haloRows * 2);
    const tileCount = Math.ceil(safeNx / coreCols) * Math.ceil(safeNy / coreRows);
    const coreArea = coreCols * coreRows;
    const localAspect = localCols / Math.max(1, localRows);
    const aspectPenalty = Math.abs(Math.log(localAspect / aspect));
    const score = coreArea - tileCount * 0.01 - aspectPenalty;
    if (!best || score > best.score) {
      best = { coreCols, coreRows, haloCols, haloRows, localCols, localRows, score, impossible: false };
    }
  };

  consider(safeNx);
  consider(Math.floor(maxLocalColumns / safeNy));
  for (let delta = -96; delta <= 96; delta += 1) {
    consider(idealLocalCols + delta);
  }
  if (!best) {
    best = {
      coreCols: 1,
      coreRows: 1,
      haloCols,
      haloRows,
      localCols: minLocalCols,
      localRows: minLocalRows,
      impossible: false,
    };
  }
  return {
    coreCols: best.coreCols,
    coreRows: best.coreRows,
    haloCols: best.haloCols,
    haloRows: best.haloRows,
    localCols: best.localCols,
    localRows: best.localRows,
    impossible: false,
  };
}

function independentVoxelTileTasks({ nx, ny, nz, workerCount }) {
  const shape = independentVoxelTileShape({ nx, ny, nz, workerCount });
  const tasks = [];
  for (let rowStart = 0; rowStart < ny; rowStart += shape.coreRows) {
    for (let colStart = 0; colStart < nx; colStart += shape.coreCols) {
      tasks.push({
        colStart,
        colEnd: Math.min(nx, colStart + shape.coreCols),
        rowStart,
        rowEnd: Math.min(ny, rowStart + shape.coreRows),
        haloCols: shape.haloCols,
        haloRows: shape.haloRows,
      });
    }
  }
  return tasks;
}

function createIndependentVoxelWorker(input, workerIndex) {
  const worker = new Worker(new URL(`./voxelBooleanWorker.js?v=${VOXEL_BOOLEAN_WORKER_VERSION}`, import.meta.url), { type: "module" });
  let nextId = 1;
  const pending = new Map();
  const readyId = nextId;
  nextId += 1;

  worker.onmessage = (event) => {
    const message = event.data ?? {};
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.type === "ready") {
      request.resolve();
    } else if (message.type === "tileResult") {
      request.resolve(message.result);
    } else {
      const error = new Error(message.error || "independent voxel worker failed");
      error.stack = message.stack || error.stack;
      request.reject(error);
    }
  };

  worker.onerror = (event) => {
    const error = new Error(event.message || "independent voxel worker error");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  const ready = new Promise((resolve, reject) => {
    pending.set(readyId, { resolve, reject });
    const supportVertices = new Float32Array(input.supportVertices);
    const supportTriangles = new Uint32Array(input.supportTriangles);
    const modelVertices = new Float32Array(input.modelVertices);
    worker.postMessage({
      type: "init",
      id: readyId,
      workerIndex,
      bounds: input.bounds,
      pitch: input.pitch,
      cellSize: input.cellSize,
      nx: input.nx,
      ny: input.ny,
      nz: input.nz,
      clearance: input.clearance,
      supportVertices,
      supportTriangles,
      modelVertices,
    }, [supportVertices.buffer, supportTriangles.buffer, modelVertices.buffer]);
  });

  return ready.then(() => ({
    requestTile(tile) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ type: "tile", id, tile });
      });
    },
    terminate() {
      worker.terminate();
      for (const request of pending.values()) request.reject(new Error("independent voxel worker terminated"));
      pending.clear();
    },
  }));
}

function accumulateIndependentVoxelQa(total, qa) {
  if (!qa) return;
  total.source_voxels += Number(qa.source_voxels) || 0;
  total.kept_voxels += Number(qa.kept_voxels) || 0;
  total.removed_voxels += Number(qa.removed_voxels) || 0;
  total.lift_lock_removed_voxels += Number(qa.lift_lock_removed_voxels) || 0;
  total.sampled_columns += Number(qa.sampled_columns) || 0;
  total.inside_samples += Number(qa.inside_samples) || 0;
  total.clearance_violation_samples += Number(qa.clearance_violation_samples) || 0;
  const distance = Number(qa.min_distance_mm);
  if (Number.isFinite(distance)) total.min_distance_mm = Math.min(total.min_distance_mm, distance);
}

function mergeSupportMeshPieces(pieces, cellSize) {
  const valid = (pieces ?? []).filter((piece) => piece?.vertices?.length && piece?.triangles?.length);
  const totalVertexValues = valid.reduce((sum, piece) => sum + piece.vertices.length, 0);
  const totalTriangleValues = valid.reduce((sum, piece) => sum + piece.triangles.length, 0);
  const vertices = new Float32Array(totalVertexValues);
  const triangles = new Uint32Array(totalTriangleValues);
  let vertexValueOffset = 0;
  let triangleValueOffset = 0;
  let vertexOffset = 0;
  for (const piece of valid) {
    vertices.set(piece.vertices, vertexValueOffset);
    for (let index = 0; index < piece.triangles.length; index += 1) {
      triangles[triangleValueOffset + index] = piece.triangles[index] + vertexOffset;
    }
    vertexValueOffset += piece.vertices.length;
    triangleValueOffset += piece.triangles.length;
    vertexOffset += Math.floor(piece.vertices.length / 3);
  }
  return {
    vertices,
    triangles,
    triangle_count: Math.floor(triangles.length / 3),
    cell_size_mm: cellSize,
  };
}

function voxelOccupancyToSupportMesh({ bounds, pitch, nx, ny, nz, occupied, occupiedAt, cellSize }) {
  const vertices = [];
  const triangles = [];
  const addVertex = (x, y, z) => {
    const index = vertices.length / 3;
    vertices.push(roundedCoordinate(x), roundedCoordinate(y), roundedCoordinate(z));
    return index;
  };
  const addQuad = (a, b, c, d) => {
    triangles.push(a, b, c, a, c, d);
  };
  const addFace = (ix, iy, iz, face) => {
    const x0 = bounds.min.x + ix * pitch;
    const y0 = bounds.min.y + iy * pitch;
    const z0 = bounds.min.z + iz * pitch;
    const x1 = x0 + pitch;
    const y1 = y0 + pitch;
    const z1 = z0 + pitch;
    if (face === "-x") {
      addQuad(addVertex(x0, y0, z0), addVertex(x0, y0, z1), addVertex(x0, y1, z1), addVertex(x0, y1, z0));
    } else if (face === "+x") {
      addQuad(addVertex(x1, y0, z0), addVertex(x1, y1, z0), addVertex(x1, y1, z1), addVertex(x1, y0, z1));
    } else if (face === "-y") {
      addQuad(addVertex(x0, y0, z0), addVertex(x1, y0, z0), addVertex(x1, y0, z1), addVertex(x0, y0, z1));
    } else if (face === "+y") {
      addQuad(addVertex(x0, y1, z0), addVertex(x0, y1, z1), addVertex(x1, y1, z1), addVertex(x1, y1, z0));
    } else if (face === "-z") {
      addQuad(addVertex(x0, y0, z0), addVertex(x0, y1, z0), addVertex(x1, y1, z0), addVertex(x1, y0, z0));
    } else if (face === "+z") {
      addQuad(addVertex(x0, y0, z1), addVertex(x1, y0, z1), addVertex(x1, y1, z1), addVertex(x0, y1, z1));
    }
  };

  for (const key of occupied) {
    const iz = Math.floor(key / (nx * ny));
    const rem = key - iz * nx * ny;
    const iy = Math.floor(rem / nx);
    const ix = rem - iy * nx;
    if (!occupiedAt(ix - 1, iy, iz)) addFace(ix, iy, iz, "-x");
    if (!occupiedAt(ix + 1, iy, iz)) addFace(ix, iy, iz, "+x");
    if (!occupiedAt(ix, iy - 1, iz)) addFace(ix, iy, iz, "-y");
    if (!occupiedAt(ix, iy + 1, iz)) addFace(ix, iy, iz, "+y");
    if (!occupiedAt(ix, iy, iz - 1)) addFace(ix, iy, iz, "-z");
    if (!occupiedAt(ix, iy, iz + 1)) addFace(ix, iy, iz, "+z");
  }

  return {
    vertices: new Float32Array(vertices),
    triangles: new Uint32Array(triangles),
    triangle_count: Math.floor(triangles.length / 3),
    cell_size_mm: cellSize,
  };
}

async function evaluateVoxelClearanceQa(mesh, clearance = {}, options = {}) {
  if (!state.modelMesh || !mesh?.vertices?.length || !mesh?.triangles?.length) {
    return {
      available: false,
      reason: state.modelMesh ? "no generated cradle mesh was available" : "no model mesh was available",
      sampled_voxels: 0,
      inside_samples: 0,
      clearance_violation_samples: 0,
    };
  }

  const cellSize = Number(mesh.cell_size_mm) || Number(controlsEl.supportBasePatternSpacing?.value) || 0.8;
  const voxelSize = mediumClearanceVoxelSize(cellSize, clearance);
  const samples = voxelizedSupportSurfaceSamples(mesh, voxelSize, mediumVoxelSampleLimit(mesh));
  if (!samples.length) {
    return {
      available: false,
      reason: "no voxel surface samples were available",
      sampled_voxels: 0,
      inside_samples: 0,
      clearance_violation_samples: 0,
      voxel_size_mm: roundedCoordinate(voxelSize),
    };
  }

  const modelIndex = modelQaIndex({ surfaceTolerance: Math.max(0.08, voxelSize * 0.5) });
  const xy = Math.max(0, Number(clearance.xy_mm) || 0);
  const z = Math.max(0, Number(clearance.z_mm) || 0);
  const voxelTolerance = Math.max(0.04, voxelSize * 0.55);
  const effectiveXy = Math.max(0, xy - voxelTolerance);
  const effectiveZ = Math.max(0, z - voxelTolerance);
  let insideSamples = 0;
  let violationSamples = 0;
  let nearSamples = 0;
  let minDistance = Infinity;
  let minClearanceMetric = Infinity;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const inside = pointInsideModel(sample, modelIndex);
    if (inside) insideSamples += 1;
    const closest = closestModelVector(sample, modelIndex, voxelTolerance);
    minDistance = Math.min(minDistance, closest.distance);
    const clearanceMetric = anisotropicClearanceMetric(closest.delta, effectiveXy, effectiveZ);
    minClearanceMetric = Math.min(minClearanceMetric, clearanceMetric);
    if (clearanceMetric <= 1) violationSamples += 1;
    else if (clearanceMetric <= 1.35) nearSamples += 1;

    if (index > 0 && index % 4000 === 0) {
      await options.onProgress?.(
        index / samples.length,
        `Running medium voxel clearance QA (${index.toLocaleString()} / ${samples.length.toLocaleString()} samples)...`
      );
      await nextFrame();
    }
  }

  await options.onProgress?.(1, "Medium voxel clearance QA complete");
  return {
    available: true,
    method: "voxel-bvh",
    sampled_voxels: samples.length,
    voxel_size_mm: roundedCoordinate(voxelSize),
    tolerance_mm: roundedCoordinate(voxelTolerance),
    requested_xy_mm: roundedCoordinate(xy),
    requested_z_mm: roundedCoordinate(z),
    effective_xy_mm: roundedCoordinate(effectiveXy),
    effective_z_mm: roundedCoordinate(effectiveZ),
    inside_samples: insideSamples,
    clearance_violation_samples: violationSamples,
    near_clearance_samples: nearSamples,
    min_distance_mm: roundedCoordinate(Number.isFinite(minDistance) ? minDistance : 0),
    min_clearance_metric: roundedCoordinate(Number.isFinite(minClearanceMetric) ? minClearanceMetric : 0),
  };
}

function mediumClearanceVoxelSize(cellSize, clearance = {}) {
  const base = Math.max(0.05, Number(cellSize) || 0.8);
  return base;
}

function mediumVoxelSampleLimit(mesh) {
  const triangleCount = Math.floor((mesh?.triangles?.length ?? 0) / 3);
  if (triangleCount > 750000) return 90000;
  if (triangleCount > 250000) return 70000;
  return 50000;
}

function voxelizedSupportSurfaceSamples(mesh, voxelSize, maxSamples) {
  const vertices = mesh?.vertices ?? [];
  const triangles = mesh?.triangles ?? [];
  const triangleCount = Math.floor(triangles.length / 3);
  if (!triangleCount || !vertices.length || maxSamples <= 0) return [];

  const samples = [];
  const occupied = new Set();
  const triangleStep = Math.max(1, Math.ceil(triangleCount / Math.max(1, Math.floor(maxSamples / 8))));
  const addSample = (point) => {
    if (samples.length >= maxSamples) return;
    const key = `${Math.floor(point.x / voxelSize)}:${Math.floor(point.y / voxelSize)}:${Math.floor(point.z / voxelSize)}`;
    if (occupied.has(key)) return;
    occupied.add(key);
    samples.push({ x: point.x, y: point.y, z: point.z, chunkId: "cradle" });
  };

  for (let tri = 0; tri < triangleCount && samples.length < maxSamples; tri += triangleStep) {
    const index = tri * 3;
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const maxEdge = Math.max(
      supportSamplePointDistance(a, b),
      supportSamplePointDistance(b, c),
      supportSamplePointDistance(c, a)
    );
    const steps = Math.max(1, Math.min(5, Math.ceil(maxEdge / Math.max(0.001, voxelSize * 2))));
    for (let uStep = 0; uStep <= steps && samples.length < maxSamples; uStep += 1) {
      for (let vStep = 0; vStep <= steps - uStep && samples.length < maxSamples; vStep += 1) {
        const u = uStep / steps;
        const v = vStep / steps;
        const w = 1 - u - v;
        addSample({
          x: a.x * w + b.x * u + c.x * v,
          y: a.y * w + b.y * u + c.y * v,
          z: a.z * w + b.z * u + c.z * v,
        });
      }
    }
  }

  return samples;
}

function supportSamplePointDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function closestModelVector(point, modelIndex, surfaceTolerance = 0.12) {
  if (modelIndex?.type === "bvh") {
    modelIndex.localPoint
      .set(point.x, point.y, point.z)
      .applyMatrix4(modelIndex.inverseMatrix);
    const closest = modelIndex.mesh.geometry.boundsTree.closestPointToPoint(
      modelIndex.localPoint,
      modelIndex.closestTarget
    );
    if (closest?.point) {
      modelIndex.closestWorldPoint
        .copy(closest.point)
        .applyMatrix4(modelIndex.matrixWorld);
      const target = modelIndex.closestWorldPoint;
      const delta = {
        x: point.x - target.x,
        y: point.y - target.y,
        z: point.z - target.z,
      };
      return {
        delta,
        distance: Math.sqrt(delta.x * delta.x + delta.y * delta.y + delta.z * delta.z),
      };
    }
  }

  return {
    delta: { x: surfaceTolerance * 2, y: 0, z: 0 },
    distance: closestModelDistance(point, modelIndex, surfaceTolerance),
  };
}

function anisotropicClearanceMetric(delta, xy, z) {
  const dx = delta?.x ?? 0;
  const dy = delta?.y ?? 0;
  const dz = delta?.z ?? 0;
  if (xy <= 0.001 && z <= 0.001) return Infinity;
  const xyTerm = xy > 0.001 ? ((dx * dx + dy * dy) / (xy * xy)) : (dx * dx + dy * dy > 0.000001 ? Infinity : 0);
  const zTerm = z > 0.001 ? ((dz * dz) / (z * z)) : (Math.abs(dz) > 0.000001 ? Infinity : 0);
  return Math.sqrt(xyTerm + zTerm);
}

function formatVoxelClearanceQaStatus(qa) {
  if (!qa) return "Medium voxel clearance QA was not run.";
  if (!qa.available) return `Medium voxel clearance QA unavailable (${qa.reason || "unknown reason"}).`;
  if (qa.method === "interval-column-boolean") {
    const pitchText = qa.requested_pitch_mm && Math.abs(qa.requested_pitch_mm - qa.voxel_size_mm) > 0.001
      ? `${formatStatusNumber(qa.voxel_size_mm)} mm effective pitch (requested ${formatStatusNumber(qa.requested_pitch_mm)} mm)`
      : `${formatStatusNumber(qa.voxel_size_mm)} mm pitch`;
    const grid = qa.grid ? ` over ${qa.grid.nx.toLocaleString()} x ${qa.grid.ny.toLocaleString()} XY columns` : "";
    const webGpu = qa.webgpu ?? {};
    const acceleratorText = webGpu.available
      ? ` WebGPU clearance field ran ${Number(webGpu.jobs ?? 0).toLocaleString()} triangle tests in ${Number(webGpu.passes ?? 0).toLocaleString()} pass${Number(webGpu.passes ?? 0) === 1 ? "" : "es"}.`
      : ` WebGPU clearance field was not used${webGpu.reason ? ` (${webGpu.reason})` : ""}; CPU interval clearance was used.`;
    const adjustedText = qa.resolution_adjusted
      ? ` Medium clearance pitch was coarsened from ${formatStatusNumber(qa.requested_pitch_mm)} mm to ${formatStatusNumber(qa.voxel_size_mm)} mm to keep the WebGPU field under ${Number(qa.max_columns ?? 0).toLocaleString()} columns (${Number(qa.requested_columns ?? 0).toLocaleString()} requested, ${Number(qa.effective_columns ?? 0).toLocaleString()} used).`
      : "";
    const liftLockRemoved = Number(qa.lift_lock_removed_voxels) || 0;
    const liftLockText = liftLockRemoved
      ? `, including about ${liftLockRemoved.toLocaleString()} vertical units removed to preserve straight-up object removal`
      : "";
    const surfaceQa = qa.surface_qa;
    const surfaceQaText = surfaceQa?.available
      ? surfaceQa.inside_samples || surfaceQa.clearance_violation_samples
        ? ` Surface QA warning: ${surfaceQa.inside_samples.toLocaleString()} sampled surface points are inside the model and ${surfaceQa.clearance_violation_samples.toLocaleString()} are inside the conservative clearance band; nearest sampled distance ${formatStatusNumber(surfaceQa.min_distance_mm)} mm.`
        : ` Surface QA: no sampled cradle points were inside the model or conservative clearance band; nearest sampled distance ${formatStatusNumber(surfaceQa.min_distance_mm)} mm.`
      : "";
    return `Medium interval clearance: sampled ${qa.sampled_columns.toLocaleString()} source cradle columns at ${pitchText}${grid}, removed about ${qa.removed_voxels.toLocaleString()} model-clearance/lift-lock vertical units${liftLockText}, kept about ${qa.kept_voxels.toLocaleString()} vertical units, and reconstructed ${Number(qa.triangle_count ?? 0).toLocaleString()} triangles.${adjustedText}${acceleratorText}${surfaceQaText}`;
  }
  if (qa.method === "voxel-boolean") {
    const pitchText = qa.requested_pitch_mm && Math.abs(qa.requested_pitch_mm - qa.voxel_size_mm) > 0.001
      ? `${formatStatusNumber(qa.voxel_size_mm)} mm effective pitch (requested ${formatStatusNumber(qa.requested_pitch_mm)} mm)`
      : `${formatStatusNumber(qa.voxel_size_mm)} mm pitch`;
    const grid = qa.grid ? ` on a ${qa.grid.nx.toLocaleString()} x ${qa.grid.ny.toLocaleString()} x ${qa.grid.nz.toLocaleString()} sparse grid` : "";
    const liftLockRemoved = Number(qa.lift_lock_removed_voxels) || 0;
    const liftLockText = liftLockRemoved
      ? `, including ${liftLockRemoved.toLocaleString()} upper voxels removed to preserve straight-up object removal`
      : "";
    const surfaceQa = qa.surface_qa;
    const surfaceQaText = surfaceQa?.available
      ? surfaceQa.inside_samples || surfaceQa.clearance_violation_samples
        ? ` Surface QA warning: ${surfaceQa.inside_samples.toLocaleString()} sampled surface points are inside the model and ${surfaceQa.clearance_violation_samples.toLocaleString()} are inside the conservative clearance band; nearest sampled distance ${formatStatusNumber(surfaceQa.min_distance_mm)} mm.`
        : ` Surface QA: no sampled cradle points were inside the model or conservative clearance band; nearest sampled distance ${formatStatusNumber(surfaceQa.min_distance_mm)} mm.`
      : "";
    return `Medium voxel boolean: voxelized ${qa.source_voxels.toLocaleString()} source cradle voxels at ${pitchText}${grid}, subtracted ${qa.removed_voxels.toLocaleString()} model-clearance/lift-lock voxels${liftLockText}, kept ${qa.kept_voxels.toLocaleString()} voxels, and reconstructed ${Number(qa.triangle_count ?? 0).toLocaleString()} triangles.${surfaceQaText}`;
  }
  const sampleText = `${qa.sampled_voxels.toLocaleString()} voxelized surface samples at ${formatStatusNumber(qa.voxel_size_mm)} mm pitch`;
  if (qa.inside_samples || qa.clearance_violation_samples) {
    return `Medium voxel clearance QA warning: ${qa.inside_samples.toLocaleString()} samples inside the model and ${qa.clearance_violation_samples.toLocaleString()} samples inside the conservative clearance band across ${sampleText}; nearest sampled distance ${formatStatusNumber(qa.min_distance_mm)} mm.`;
  }
  return `Medium voxel clearance QA: no sampled cradle points were inside the model or conservative clearance band across ${sampleText}; nearest sampled distance ${formatStatusNumber(qa.min_distance_mm)} mm.`;
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
    clearMeshGroup(splitGroup);
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
    appBundleVersion: APP_BUNDLE_VERSION,
    modelTrimWorkerVersion: MODEL_TRIM_WORKER_VERSION,
    modelTrim: MODEL_TRIM_DEBUG_SETTINGS,
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
    const bounds = expandedDovetailQaBounds(connector);
    if (!bounds) continue;
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
        if (!triangleOverlapsBounds(tri, bounds)) continue;
        const metrics = triangleQualityMetrics(tri[0], tri[1], tri[2]);
        if (!isDovetailGapHairTriangle(metrics)) continue;
        for (const [a, b] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]]) {
          if (!edgeOverlapsBounds(a, b, bounds)) continue;
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

function isDovetailGapHairTriangle(metrics) {
  return metrics.aspectRatio >= DOVETAIL_GAP_HAIR_ASPECT_RATIO &&
    metrics.altitude <= DOVETAIL_GAP_HAIR_MAX_THICKNESS_MM &&
    metrics.longestEdge >= DOVETAIL_GAP_HAIR_MIN_EDGE_MM &&
    metrics.area > 1e-8;
}

function expandedDovetailQaBounds(connector) {
  const bounds = connector.footprint_bounds_mm;
  if (!bounds) return null;
  const margin = Math.max(0.8, (connector.clearance_mm ?? 0.3) * 2);
  const zMargin = Math.max(0.8, (connector.clearance_mm ?? 0.3) * 2);
  return {
    min: {
      x: bounds.min.x - margin,
      y: bounds.min.y - margin,
      z: connector.z_range_mm.min - zMargin,
    },
    max: {
      x: bounds.max.x + margin,
      y: bounds.max.y + margin,
      z: connector.z_range_mm.max + zMargin,
    },
  };
}

function triangleOverlapsBounds(triangle, bounds) {
  const min = {
    x: Math.min(triangle[0].x, triangle[1].x, triangle[2].x),
    y: Math.min(triangle[0].y, triangle[1].y, triangle[2].y),
    z: Math.min(triangle[0].z, triangle[1].z, triangle[2].z),
  };
  const max = {
    x: Math.max(triangle[0].x, triangle[1].x, triangle[2].x),
    y: Math.max(triangle[0].y, triangle[1].y, triangle[2].y),
    z: Math.max(triangle[0].z, triangle[1].z, triangle[2].z),
  };
  return max.x >= bounds.min.x && min.x <= bounds.max.x &&
    max.y >= bounds.min.y && min.y <= bounds.max.y &&
    max.z >= bounds.min.z && min.z <= bounds.max.z;
}

function edgeOverlapsBounds(a, b, bounds) {
  return Math.max(a.x, b.x) >= bounds.min.x && Math.min(a.x, b.x) <= bounds.max.x &&
    Math.max(a.y, b.y) >= bounds.min.y && Math.min(a.y, b.y) <= bounds.max.y &&
    Math.max(a.z, b.z) >= bounds.min.z && Math.min(a.z, b.z) <= bounds.max.z;
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

  const endpointAInBand = pointInDovetailClearanceBand(connector, a);
  const endpointBInBand = pointInDovetailClearanceBand(connector, b);
  if (!endpointAInBand && !endpointBInBand && !band.crossesBand) return null;

  const length = pointDistance(a, b);
  const crossDistance = sideA * sideB < 0 ? Math.abs(sideA) + Math.abs(sideB) : 0;
  const minLength = Math.max(0.5, (connector.clearance_mm ?? 0.3) * 1.4);
  if (length < minLength || band.clearanceLength < minLength) return null;

  return { length, crossDistance, clearanceLength: band.clearanceLength, midpoint: band.point, chunkId };
}

function edgeClearanceBandSample(connector, a, b) {
  const samples = [];
  let previousInBand = null;
  let crossesBand = false;
  for (const t of [0.08, 0.16, 0.25, 0.35, 0.5, 0.65, 0.75, 0.84, 0.92]) {
    const point = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    const inBand = pointInDovetailClearanceBand(connector, point);
    if (previousInBand !== null && previousInBand !== inBand) crossesBand = true;
    previousInBand = inBand;
    if (inBand) samples.push({ t, point });
  }
  if (!samples.length) return null;
  const length = pointDistance(a, b);
  const first = samples[0];
  const last = samples[samples.length - 1];
  const representative = samples[Math.floor(samples.length / 2)];
  return {
    point: representative.point,
    clearanceLength: Math.max(length * Math.abs(last.t - first.t), length / 9),
    crossesBand,
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
  return `Gap QA advisory: ${qa.count.toLocaleString()} possible dovetail clearance-band hair${qa.count === 1 ? "" : "s"} detected.${detail}`;
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
  if (state.modelMesh?.geometry?.boundsTree) {
    state.modelMesh.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(state.modelMesh);
    const raycaster = new THREE.Raycaster();
    raycaster.firstHitOnly = false;
    raycaster.near = 0;
    return {
      type: "bvh",
      mesh: state.modelMesh,
      bounds,
      raycaster,
      rayOrigin: new THREE.Vector3(),
      rayDirection: new THREE.Vector3(1, 0, 0),
      localRay: new THREE.Ray(),
      localRayDirection: new THREE.Vector3(),
      localPoint: new THREE.Vector3(),
      closestTarget: { point: new THREE.Vector3() },
      closestWorldPoint: new THREE.Vector3(),
      inverseMatrix: state.modelMesh.matrixWorld.clone().invert(),
      matrixWorld: state.modelMesh.matrixWorld.clone(),
      legacyIndex: null,
      legacyOptions: options,
    };
  }

  return legacyModelQaIndex(options);
}

function legacyModelQaIndex(options = {}) {
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
  if (modelIndex?.type === "bvh") {
    return pointInsideModelBvh(point, modelIndex);
  }

  return pointInsideModelLegacy(point, modelIndex);
}

function pointInsideModelLegacy(point, modelIndex) {
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

function pointInsideModelBvh(point, modelIndex) {
  if (point.x > modelIndex.bounds.max.x + 0.0001 ||
    point.y < modelIndex.bounds.min.y - 0.0001 ||
    point.y > modelIndex.bounds.max.y + 0.0001 ||
    point.z < modelIndex.bounds.min.z - 0.0001 ||
    point.z > modelIndex.bounds.max.z + 0.0001) {
    return false;
  }

  const far = modelIndex.bounds.max.x - point.x + 1;
  if (far <= 0.0001) return false;
  modelIndex.rayOrigin.set(point.x + 0.000001, point.y, point.z);
  modelIndex.localPoint
    .copy(modelIndex.rayOrigin)
    .applyMatrix4(modelIndex.inverseMatrix);
  modelIndex.localRayDirection
    .copy(modelIndex.rayDirection)
    .transformDirection(modelIndex.inverseMatrix);
  modelIndex.localRay.origin.copy(modelIndex.localPoint);
  modelIndex.localRay.direction.copy(modelIndex.localRayDirection);

  const hits = modelIndex.mesh.geometry.boundsTree
    .raycast(modelIndex.localRay, THREE.DoubleSide, 0, far)
    .map((hit) => roundedCoordinate(hit.distance))
    .sort((a, b) => a - b);
  let uniqueHits = 0;
  let prior = -Infinity;
  for (const hit of hits) {
    if (Math.abs(hit - prior) <= 0.0001) continue;
    uniqueHits += 1;
    prior = hit;
  }
  if (uniqueHits % 2 !== 1) return false;

  modelIndex.legacyIndex ??= legacyModelQaIndex(modelIndex.legacyOptions);
  return pointInsideModelLegacy(point, modelIndex.legacyIndex);
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
  if (modelIndex?.type === "bvh") {
    return closestModelDistanceBvh(point, modelIndex, surfaceTolerance);
  }

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

function closestModelDistanceBvh(point, modelIndex, surfaceTolerance = 0.12) {
  modelIndex.localPoint
    .set(point.x, point.y, point.z)
    .applyMatrix4(modelIndex.inverseMatrix);
  const closest = modelIndex.mesh.geometry.boundsTree.closestPointToPoint(
    modelIndex.localPoint,
    modelIndex.closestTarget
  );
  if (!closest?.point) return surfaceTolerance * 2;
  modelIndex.closestWorldPoint
    .copy(closest.point)
    .applyMatrix4(modelIndex.matrixWorld);
  return modelIndex.closestWorldPoint.distanceTo(modelIndex.rayOrigin.set(point.x, point.y, point.z));
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

async function generateCncFoamPreview(options = {}) {
  if (!state.modelMesh) return;

  state.cncBusy = true;
  renderer.domElement.style.cursor = "wait";
  updateButtons();

  try {
    setCncStatus(options.initialStatus || "Sampling model for CNC foam relief...", "working");
    clearGeneratedSupport();
    if (!options.keepExistingPreview) {
      clearCncPreview({ keepStatus: true });
      setCncQaDashboard([
        { label: "CNC", value: "Sampling", detail: "Reading model envelope", state: "working" },
        { label: "Reach", value: "--", detail: "Waiting", state: "idle" },
        { label: "Block", value: "--", detail: "Waiting", state: "idle" },
        { label: "Export", value: "--", detail: "Waiting", state: "idle" },
      ]);
    } else {
      setCncQaDashboard([
        { label: "CNC", value: "Rebuilding", detail: "Keeping current preview visible", state: "working" },
        { label: "Finger holes", value: "Updating", detail: "Please wait", state: "working" },
        { label: "Export", value: "--", detail: "Will refresh when done", state: "idle" },
      ]);
    }
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
      : qa.unreachable_cells || qa.selected_tool_miss_cells || (qa.slab_count && !qa.dowel_valid)
        ? "caution"
        : "ok";
    const slabIslandText = qa.slab_count
      ? ` ${qa.slab_island_dowels_added.toLocaleString()} island dowels added; ${qa.slab_islands_omitted.toLocaleString()} unalignable islands omitted.`
      : "";
    setCncStatus(
      `CNC foam relief ready: ${result.mesh.triangle_count.toLocaleString()} export triangles, ${formatStatusNumber(qa.reached_percent)}% selected-tool clearance, ${qa.unreachable_cells.toLocaleString()} cells too deep for stickout, ${qa.selected_tool_miss_cells.toLocaleString()} cells likely need a smaller finishing tool, ${qa.finger_holes.toLocaleString()} finger holes, and ${qa.slab_count.toLocaleString()} slab exports.${slabIslandText}${qa.dowel_warning ? ` ${qa.dowel_warning}` : ""} Export remains the desired VCarve relief target.`,
      stateName
    );
  } finally {
    state.cncBusy = false;
    renderer.domElement.style.cursor = state.cncFingerHoleMode ? "crosshair" : "";
    updateButtons();
  }
}

function cncSettings() {
  const width = positiveNumber(controlsEl.cncBlockWidth?.value, 300);
  const depth = positiveNumber(controlsEl.cncBlockDepth?.value, 300);
  const blockHeightMm = positiveNumber(controlsEl.cncBlockHeight?.value, 76.2);
  const slabsEnabled = Boolean(controlsEl.cncSlabsEnabled?.checked);
  const slabCount = Math.max(1, Math.min(24, Math.round(positiveNumber(controlsEl.cncSlabCount?.value, 3))));
  const slabThicknessMm = Math.max(inchesToMm(0.5), Math.min(inchesToMm(2), inchesToMm(controlsEl.cncSlabThicknessIn?.value || 1)));
  const height = slabsEnabled ? slabThicknessMm * slabCount : blockHeightMm;
  const requestedResolution = Math.max(0.2, positiveNumber(controlsEl.cncResolution?.value, 0.5));
  const maxResolutionByCells = Math.sqrt((width * depth) / CNC_MAX_GRID_CELLS);
  const resolution = Math.max(requestedResolution, maxResolutionByCells);
  const toolStickoutMm = inchesToMm(controlsEl.cncToolStickoutIn?.value || 1);
  const bitDiameterMm = Math.max(0.5, inchesToMm(controlsEl.cncBitDiameterIn?.value || 0.25));
  const toolEnd = controlsEl.cncToolEnd?.value === "ball" ? "ball" : "flat";
  const clearanceXyMm = Math.max(0, positiveNumber(controlsEl.cncClearanceXy?.value, 1));
  const clearanceZMm = Math.max(0, positiveNumber(controlsEl.cncClearanceZ?.value, 1));
  const autoLiftEnabled = controlsEl.cncAutoLift?.checked !== false;
  const modelLiftMm = Math.max(0, positiveNumber(controlsEl.cncModelLift?.value, 0));
  const fingerHoleDiameterMm = Math.max(8, positiveNumber(controlsEl.cncFingerHoleDiameter?.value, 30));
  const dowelDiameterMm = Math.max(1, positiveNumber(controlsEl.cncDowelDiameterMm?.value, 6.35));
  const dowelClearanceMm = Math.max(0, positiveNumber(controlsEl.cncDowelClearance?.value, 0.25));
  const perSetupAllowedDepthMm = Math.max(0, toolStickoutMm - CNC_TOOL_SAFETY_MARGIN_MM);
  const slabCanThroughCut = slabsEnabled && toolStickoutMm + 1e-6 >= slabThicknessMm;
  const singleSetupAllowedDepthMm = Math.max(0, Math.min(perSetupAllowedDepthMm, height - CNC_MIN_FLOOR_THICKNESS_MM));
  const slabStackAllowedDepthMm = Math.max(0, height - CNC_MIN_FLOOR_THICKNESS_MM);
  const allowedDepthMm = slabCanThroughCut ? slabStackAllowedDepthMm : singleSetupAllowedDepthMm;

  return {
    width,
    depth,
    height,
    blockHeightMm,
    resolution,
    requestedResolution,
    toolStickoutMm,
    bitDiameterMm,
    bitRadiusMm: bitDiameterMm / 2,
    toolEnd,
    clearanceMm: clearanceZMm,
    clearanceXyMm,
    clearanceZMm,
    autoLiftEnabled,
    modelLiftMm,
    modelPlacementOffsetMm: modelLiftMm,
    allowedDepthMm,
    perSetupAllowedDepthMm,
    slabCanThroughCut,
    minFloorMm: CNC_MIN_FLOOR_THICKNESS_MM,
    autoFingerHoles: Boolean(controlsEl.cncAutoFingerHoles?.checked),
    fingerHoleDiameterMm,
    fingerHoleRadiusMm: fingerHoleDiameterMm / 2,
    manualFingerHoles: [...state.cncFingerHoles],
    slabsEnabled,
    slabCount,
    slabThicknessMm,
    dowelDiameterMm,
    dowelClearanceMm,
    dowelRadiusMm: dowelDiameterMm / 2 + dowelClearanceMm,
  };
}

function estimateCncReferenceZ(settings) {
  const resolution = Math.max(settings.resolution, 3);
  const nx = Math.max(2, Math.ceil(settings.width / resolution));
  const ny = Math.max(2, Math.ceil(settings.depth / resolution));
  const dx = settings.width / nx;
  const dy = settings.depth / ny;
  const xMin = -settings.width / 2;
  const yMin = -settings.depth / 2;
  const undersideZ = new Float64Array(nx * ny);
  undersideZ.fill(Infinity);

  if (!fillCncUndersideWithBvh(undersideZ, nx, ny, xMin, yMin, dx, dy)) {
    const meshPayload = buildMeshPayload();
    const vertices = meshPayload.vertices;
    const triangleCount = Math.floor(vertices.length / 9);

    for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
      const offset = triangleIndex * 9;
      const a = { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
      const b = { x: vertices[offset + 3], y: vertices[offset + 4], z: vertices[offset + 5] };
      const c = { x: vertices[offset + 6], y: vertices[offset + 7], z: vertices[offset + 8] };
      rasterizeTriangleUnderside(a, b, c, undersideZ, nx, ny, xMin, yMin, dx, dy);
    }
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
  const nx = Math.max(2, Math.ceil(settings.width / settings.resolution));
  const ny = Math.max(2, Math.ceil(settings.depth / settings.resolution));
  const dx = settings.width / nx;
  const dy = settings.depth / ny;
  const xMin = -settings.width / 2;
  const yMin = -settings.depth / 2;
  const cellCount = nx * ny;
  const undersideZ = new Float64Array(cellCount);
  undersideZ.fill(Infinity);

  const bvhSampled = await fillCncUndersideWithBvhAsync(undersideZ, nx, ny, xMin, yMin, dx, dy, report);
  if (!bvhSampled) {
    const meshPayload = buildMeshPayload();
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
  }

  const enclosedVoidCells = fillEnclosedCncFootprintVoids(undersideZ, nx, ny);
  const xyClearanceCells = applyCncXyClearance(undersideZ, nx, ny, dx, dy, settings.clearanceXyMm);

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
    const required = Math.max(0, referenceZ - undersideZ[index] + settings.clearanceZMm);
    rawDepth[index] = required;
    maxRequiredDepth = Math.max(maxRequiredDepth, required);
  }

  const effectivePlacementOffsetMm = settings.autoLiftEnabled
    ? Math.max(0, maxRequiredDepth - settings.allowedDepthMm)
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
  const preFingerHoleDepth = new Float64Array(finalDepth);
  const fingerHolePlan = applyCncFingerHoles(finalDepth, preFingerHoleDepth, nx, ny, xMin, yMin, dx, dy, settings);
  const dowelPlan = settings.slabsEnabled
    ? planCncDowelHoles(finalDepth, nx, ny, xMin, yMin, dx, dy, settings, fingerHolePlan.holes)
    : { holes: [], valid: true, warning: "" };
  if (report) await report("Simulating selected CNC cutter against relief...");
  const toolSimulation = simulateSelectedCncTool(finalDepth, nx, ny, dx, dy, settings);
  let maxCarvedDepth = 0;
  let selectedToolMissCells = 0;
  let toolReachedCells = 0;
  let toolTestCells = 0;
  let intersectionCells = 0;
  let maxIntersectionMm = 0;
  let maxSelectedToolMissMm = 0;
  const intersection = new Uint8Array(cellCount);
  const intersectionToleranceMm = Math.max(0.05, Math.min(dx, dy) * 0.5);
  for (let index = 0; index < cellCount; index += 1) {
    const carvedDepth = finalDepth[index];
    maxCarvedDepth = Math.max(maxCarvedDepth, carvedDepth);
    if (carvedDepth <= 0.001) continue;
    toolTestCells += 1;
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
  const slabPlan = settings.slabsEnabled
    ? buildCncSlabPlan(finalDepth, nx, ny, xMin, yMin, dx, dy, settings, dowelPlan.holes)
    : null;
  const unreachableMesh = buildCncUnreachableOverlay(unreachable, nx, ny, xMin, yMin, dx, dy, settings.height + 0.35);
  const intersectionMesh = buildCncSurfaceOverlay(intersection, finalDepth, nx, ny, xMin, yMin, dx, dy, settings.height, 0.35, 3);
  const modelBounds = new THREE.Box3().setFromObject(state.modelMesh);
  const modelSize = modelBounds.getSize(new THREE.Vector3());
  const blockFits = modelSize.x + settings.clearanceXyMm * 2 <= settings.width && modelSize.y + settings.clearanceXyMm * 2 <= settings.depth;
  const qa = {
    footprint_cells: footprintCells,
    reached_cells: toolReachedCells,
    depth_reachable_cells: toolTestCells,
    sampled_clearance_cells: depthReachableCells,
    unreachable_cells: unreachableCells,
    lifted_out_cells: liftedOutCells,
    reached_percent: toolTestCells ? (toolReachedCells / toolTestCells) * 100 : 0,
    max_required_depth_mm: maxRequiredDepth,
    max_carved_depth_mm: maxCarvedDepth,
    reference_z_mm: referenceZ,
    model_lift_mm: settings.modelLiftMm,
    model_placement_offset_mm: settings.modelPlacementOffsetMm,
    auto_lift_enabled: settings.autoLiftEnabled,
    allowed_depth_mm: settings.allowedDepthMm,
    per_setup_allowed_depth_mm: settings.perSetupAllowedDepthMm,
    slab_can_through_cut: settings.slabCanThroughCut,
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
    xy_clearance_cells: xyClearanceCells,
    clearance_xy_mm: settings.clearanceXyMm,
    clearance_z_mm: settings.clearanceZMm,
    finger_holes: fingerHolePlan.holes.length,
    manual_finger_holes: fingerHolePlan.manualCount,
    auto_finger_holes: fingerHolePlan.autoCount,
    finger_hole_carved_cells: fingerHolePlan.carvedCells,
    finger_hole_candidates: fingerHolePlan.candidateCount,
    dowel_holes: slabPlan?.dowelHoles?.length ?? dowelPlan.holes.length,
    dowel_valid: dowelPlan.valid && (slabPlan?.islandDowelValid ?? true),
    dowel_warning: [dowelPlan.warning, slabPlan?.islandWarning].filter(Boolean).join(" "),
    slab_count: slabPlan?.slabs?.length ?? 0,
    slab_through_cut_count: slabPlan?.throughCutCount ?? 0,
    slab_min_wall_mm: slabPlan?.minWallMm ?? null,
    slab_island_components: slabPlan?.islandComponentCount ?? 0,
    slab_island_dowels_added: slabPlan?.islandDowelsAdded ?? 0,
    slab_islands_omitted: slabPlan?.culledIslandCount ?? 0,
    slab_island_cells_omitted: slabPlan?.culledIslandCells ?? 0,
    tool_end: settings.toolEnd,
    grid: { nx, ny, dx, dy, resolution: settings.resolution },
    settings,
  };

  return { mesh: foamMesh, unreachableMesh, intersectionMesh, qa, slabPlan, fingerHolePlan };
}

async function fillCncUndersideWithBvhAsync(undersideZ, nx, ny, xMin, yMin, dx, dy, report = null) {
  const sampler = createCncBvhEnvelopeSampler();
  if (!sampler) return false;
  const progressStride = Math.max(1, Math.floor(ny / 24));
  for (let iy = 0; iy < ny; iy += 1) {
    sampler.sampleRow(undersideZ, nx, iy, xMin, yMin, dx, dy);
    if (report && iy % progressStride === 0) {
      await report(`Sampling CNC relief with BVH row ${iy.toLocaleString()} of ${ny.toLocaleString()}...`);
    }
  }
  return true;
}

function fillCncUndersideWithBvh(undersideZ, nx, ny, xMin, yMin, dx, dy) {
  const sampler = createCncBvhEnvelopeSampler();
  if (!sampler) return false;
  for (let iy = 0; iy < ny; iy += 1) {
    sampler.sampleRow(undersideZ, nx, iy, xMin, yMin, dx, dy);
  }
  return true;
}

function createCncBvhEnvelopeSampler() {
  if (!state.modelMesh?.geometry?.boundsTree) return null;
  state.modelMesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(state.modelMesh);
  if (bounds.isEmpty()) return null;
  const inverseMatrix = state.modelMesh.matrixWorld.clone().invert();
  const matrixWorld = state.modelMesh.matrixWorld.clone();
  const ray = new THREE.Ray();
  const localOrigin = new THREE.Vector3();
  const localDirection = new THREE.Vector3(0, 0, -1).transformDirection(inverseMatrix);
  const worldPoint = new THREE.Vector3();
  const zStart = bounds.max.z + 5;
  const far = Math.max(1, bounds.max.z - bounds.min.z + 10);
  const margin = 0.0001;

  return {
    sampleRow(undersideZ, nx, iy, xMin, yMin, dx, dy) {
      const y = yMin + (iy + 0.5) * dy;
      if (y < bounds.min.y - margin || y > bounds.max.y + margin) return;
      const ixStart = Math.max(0, Math.floor((bounds.min.x - margin - xMin) / dx));
      const ixEnd = Math.min(nx - 1, Math.ceil((bounds.max.x + margin - xMin) / dx));
      for (let ix = ixStart; ix <= ixEnd; ix += 1) {
        const x = xMin + (ix + 0.5) * dx;
        if (x < bounds.min.x - margin || x > bounds.max.x + margin) continue;
        localOrigin.set(x, y, zStart).applyMatrix4(inverseMatrix);
        ray.origin.copy(localOrigin);
        ray.direction.copy(localDirection);
        const hits = state.modelMesh.geometry.boundsTree.raycast(ray, THREE.DoubleSide, 0, far);
        let minZ = Infinity;
        for (const hit of hits) {
          worldPoint.copy(hit.point).applyMatrix4(matrixWorld);
          if (worldPoint.z < minZ) minZ = worldPoint.z;
        }
        if (Number.isFinite(minZ)) undersideZ[iy * nx + ix] = minZ;
      }
    },
  };
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

function applyCncXyClearance(undersideZ, nx, ny, dx, dy, clearanceMm) {
  const radius = Math.max(0, clearanceMm || 0);
  if (radius <= 0.001) return 0;
  const source = new Float64Array(undersideZ);
  const rx = Math.ceil(radius / dx);
  const ry = Math.ceil(radius / dy);
  const radiusSquared = radius * radius;
  let expandedCells = 0;

  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const z = source[iy * nx + ix];
      if (!Number.isFinite(z)) continue;
      for (let oy = -ry; oy <= ry; oy += 1) {
        const sy = iy + oy;
        if (sy < 0 || sy >= ny) continue;
        for (let ox = -rx; ox <= rx; ox += 1) {
          const sx = ix + ox;
          if (sx < 0 || sx >= nx) continue;
          const distSquared = (ox * dx) * (ox * dx) + (oy * dy) * (oy * dy);
          if (distSquared > radiusSquared + 1e-9) continue;
          const targetIndex = sy * nx + sx;
          if (!Number.isFinite(undersideZ[targetIndex])) expandedCells += 1;
          if (!Number.isFinite(undersideZ[targetIndex]) || z < undersideZ[targetIndex]) undersideZ[targetIndex] = z;
        }
      }
    }
  }

  return expandedCells;
}

function applyCncFingerHoles(depths, cavityDepths, nx, ny, xMin, yMin, dx, dy, settings) {
  const candidates = cncCavityBoundaryCandidates(cavityDepths, nx, ny, xMin, yMin, dx, dy, settings);
  const holes = [];
  const radius = Math.max(4, settings.fingerHoleRadiusMm || 15);

  for (const manual of settings.manualFingerHoles ?? []) {
    const snapped = snapCncFingerHoleToCandidate(manual, candidates, radius);
    if (snapped && !cncPointNearAny(snapped, holes, radius * 1.4)) holes.push({ ...snapped, source: "manual" });
  }

  let autoCount = 0;
  if (settings.autoFingerHoles) {
    for (const hole of chooseAutoCncFingerHoles(candidates, holes, radius)) {
      if (cncPointNearAny(hole, holes, radius * 1.4)) continue;
      holes.push({ ...hole, source: "auto" });
      autoCount += 1;
    }
  }

  let carvedCells = 0;
  for (const hole of holes) carvedCells += carveCncFingerHole(depths, cavityDepths, nx, ny, xMin, yMin, dx, dy, hole, radius);
  return {
    holes,
    candidateCount: candidates.length,
    manualCount: holes.filter((hole) => hole.source === "manual").length,
    autoCount,
    carvedCells,
  };
}

function cncCavityBoundaryCandidates(depths, nx, ny, xMin, yMin, dx, dy, settings) {
  const candidates = [];
  const xMax = xMin + nx * dx;
  const yMax = yMin + ny * dy;
  const minEdgeMargin = Math.max((settings.fingerHoleRadiusMm ?? 15) + 4, (settings.bitRadiusMm ?? 0) + 2);
  const neighborOffsets = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }];

  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const depth = depths[iy * nx + ix];
      if (depth <= 0.001) continue;
      let outwardX = 0;
      let outwardY = 0;
      let isBoundary = false;
      for (const offset of neighborOffsets) {
        const sx = ix + offset.x;
        const sy = iy + offset.y;
        const neighborDepth = sx < 0 || sx >= nx || sy < 0 || sy >= ny ? 0 : depths[sy * nx + sx];
        if (neighborDepth <= 0.001) {
          isBoundary = true;
          outwardX += offset.x;
          outwardY += offset.y;
        }
      }
      if (!isBoundary) continue;
      const x = xMin + (ix + 0.5) * dx;
      const y = yMin + (iy + 0.5) * dy;
      const edgeMargin = Math.min(x - xMin, xMax - x, y - yMin, yMax - y);
      if (edgeMargin < minEdgeMargin) continue;
      const normalLength = Math.hypot(outwardX, outwardY) || 1;
      const shallowScore = Math.max(0, (settings.allowedDepthMm ?? 0) - depth);
      candidates.push({
        x,
        y,
        ix,
        iy,
        depth,
        normalX: outwardX / normalLength,
        normalY: outwardY / normalLength,
        edgeMargin,
        score: edgeMargin * 0.7 + shallowScore * 0.35 - depth * 0.12,
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function snapCncFingerHoleToCandidate(point, candidates, radius) {
  if (!candidates.length || !point) return null;
  let best = null;
  let bestDistance = Infinity;
  const maxDistance = Math.max(20, radius * 4);
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best && bestDistance <= maxDistance ? best : null;
}

function chooseAutoCncFingerHoles(candidates, existing, radius) {
  const available = candidates.filter((candidate) => !cncPointNearAny(candidate, existing, radius * 1.4));
  if (available.length < 2) return available.slice(0, 2);
  const first = available[0];
  let second = null;
  let secondScore = -Infinity;
  for (const candidate of available.slice(1)) {
    const distance = Math.hypot(candidate.x - first.x, candidate.y - first.y);
    if (distance < radius * 3) continue;
    const normalOpposition = -(candidate.normalX * first.normalX + candidate.normalY * first.normalY);
    const score = candidate.score + distance * 0.5 + normalOpposition * radius * 4;
    if (score > secondScore) {
      secondScore = score;
      second = candidate;
    }
  }
  return second ? [first, second] : available.slice(0, 2);
}

function carveCncFingerHole(depths, cavityDepths, nx, ny, xMin, yMin, dx, dy, hole, radius) {
  const ix0 = Math.max(0, Math.floor((hole.x - radius - xMin) / dx));
  const ix1 = Math.min(nx - 1, Math.ceil((hole.x + radius - xMin) / dx));
  const iy0 = Math.max(0, Math.floor((hole.y - radius - yMin) / dy));
  const iy1 = Math.min(ny - 1, Math.ceil((hole.y + radius - yMin) / dy));
  const radiusSquared = radius * radius;
  const seamTolerance = Math.max(dx, dy) * 0.75;
  const throatWidth = Math.max(CNC_FINGER_HOLE_SUPPORT_INSET_MM, Math.min(dx, dy) * 2.5);
  const throatHalfWidth = Math.max(radius * 0.22, Math.min(dx, dy) * 2);
  const throatDepth = Math.max(hole.depth || 0, radius * 0.55);
  let carvedCells = 0;
  for (let iy = iy0; iy <= iy1; iy += 1) {
    const cy = yMin + (iy + 0.5) * dy;
    for (let ix = ix0; ix <= ix1; ix += 1) {
      const index = iy * nx + ix;
      const cx = xMin + (ix + 0.5) * dx;
      const relX = cx - hole.x;
      const relY = cy - hole.y;
      const outwardDistance = relX * hole.normalX + relY * hole.normalY;
      const isCavityCell = cavityDepths[index] > 0.001;
      const inwardLimit = isCavityCell ? CNC_FINGER_HOLE_SUPPORT_INSET_MM : seamTolerance;
      if (outwardDistance < -inwardLimit) continue;
      const distSquared = relX * relX + relY * relY;
      if (distSquared > radiusSquared) continue;
      const tangentDistance = Math.abs(relX * -hole.normalY + relY * hole.normalX);
      const scallopDepth = Math.sqrt(Math.max(0, radiusSquared - distSquared));
      const opensToCavity = outwardDistance >= -CNC_FINGER_HOLE_SUPPORT_INSET_MM &&
        outwardDistance <= throatWidth &&
        tangentDistance <= throatHalfWidth;
      const targetDepth = opensToCavity ? Math.max(scallopDepth, throatDepth) : scallopDepth;
      const before = depths[index];
      depths[index] = Math.max(before, targetDepth);
      if (depths[index] > before + 0.001) carvedCells += 1;
    }
  }
  return carvedCells;
}

function cncPointNearAny(point, points, distance) {
  return points.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < distance);
}

function planCncDowelHoles(depths, nx, ny, xMin, yMin, dx, dy, settings, fingerHoles) {
  const candidates = cncCavityBoundaryCandidates(depths, nx, ny, xMin, yMin, dx, dy, {
    ...settings,
    fingerHoleRadiusMm: Math.max(settings.dowelRadiusMm + 4, settings.fingerHoleRadiusMm),
  });
  const holes = [];
  const offset = Math.max(settings.dowelRadiusMm + 8, settings.clearanceXyMm + settings.dowelRadiusMm + 5);
  const xMax = xMin + nx * dx;
  const yMax = yMin + ny * dy;
  const minEdge = settings.dowelRadiusMm + 6;

  for (const candidate of candidates) {
    const x = candidate.x + candidate.normalX * offset;
    const y = candidate.y + candidate.normalY * offset;
    if (x < xMin + minEdge || x > xMax - minEdge || y < yMin + minEdge || y > yMax - minEdge) continue;
    const ix = Math.floor((x - xMin) / dx);
    const iy = Math.floor((y - yMin) / dy);
    if (ix < 0 || ix >= nx || iy < 0 || iy >= ny) continue;
    if (depths[iy * nx + ix] > 0.001) continue;
    if (cncPointNearAny({ x, y }, fingerHoles, settings.dowelRadiusMm + settings.fingerHoleRadiusMm + 6)) continue;
    const hole = { x, y, radiusMm: settings.dowelRadiusMm, score: candidate.score };
    if (cncPointNearAny(hole, holes, settings.dowelRadiusMm * 5)) continue;
    holes.push(hole);
    if (holes.length >= 12) break;
  }

  const selected = chooseNonCollinearCncPoints(holes, 3);
  return {
    holes: selected,
    valid: selected.length >= 3,
    warning: selected.length >= 3 ? "" : "Could not safely place three dowel holes; increase block size or reduce cavity/clearance.",
  };
}

function chooseNonCollinearCncPoints(candidates, count) {
  if (candidates.length <= count) return candidates;
  const first = candidates[0];
  let second = candidates[1];
  let bestDistance = -Infinity;
  for (const candidate of candidates.slice(1)) {
    const distance = Math.hypot(candidate.x - first.x, candidate.y - first.y);
    if (distance > bestDistance) {
      bestDistance = distance;
      second = candidate;
    }
  }
  let third = null;
  let bestArea = -Infinity;
  for (const candidate of candidates) {
    if (candidate === first || candidate === second) continue;
    const area = Math.abs((second.x - first.x) * (candidate.y - first.y) - (second.y - first.y) * (candidate.x - first.x));
    if (area > bestArea) {
      bestArea = area;
      third = candidate;
    }
  }
  return [first, second, third].filter(Boolean).slice(0, count);
}

function computeCncSlabRawHeights(depths, nx, ny, slabHeight, topDepth) {
  const heights = new Float64Array(nx * ny);
  for (let index = 0; index < heights.length; index += 1) {
    heights[index] = slabHeight - Math.max(0, Math.min(slabHeight, depths[index] - topDepth));
  }
  return heights;
}

function findCncSlabComponents(heights, nx, ny, epsilon = 0.001) {
  const labels = new Int32Array(nx * ny);
  labels.fill(-1);
  const components = [];
  const queue = [];
  for (let start = 0; start < heights.length; start += 1) {
    if (heights[start] <= epsilon || labels[start] !== -1) continue;
    const componentId = components.length;
    const cells = [];
    labels[start] = componentId;
    queue.length = 0;
    queue.push(start);
    while (queue.length) {
      const index = queue.pop();
      cells.push(index);
      const ix = index % nx;
      const iy = Math.floor(index / nx);
      const neighbors = [
        ix > 0 ? index - 1 : -1,
        ix < nx - 1 ? index + 1 : -1,
        iy > 0 ? index - nx : -1,
        iy < ny - 1 ? index + nx : -1,
      ];
      for (const neighbor of neighbors) {
        if (neighbor < 0 || labels[neighbor] !== -1 || heights[neighbor] <= epsilon) continue;
        labels[neighbor] = componentId;
        queue.push(neighbor);
      }
    }
    components.push({ id: componentId, cells });
  }
  return { labels, components };
}

function planCncSlabIslandDowels(heights, nx, ny, xMin, yMin, dx, dy, settings, plannedDowels, slabId) {
  const { labels, components } = findCncSlabComponents(heights, nx, ny);
  const culledMask = new Uint8Array(nx * ny);
  let addedDowels = 0;
  let culledComponents = 0;
  let culledCells = 0;
  const minComponentCells = Math.max(4, Math.ceil((Math.PI * settings.dowelRadiusMm * settings.dowelRadiusMm * 2.5) / Math.max(0.001, dx * dy)));

  for (const component of components) {
    const existing = plannedDowels.filter((hole) => cncDowelFitsSlabComponent(hole, labels, component.id, nx, ny, xMin, yMin, dx, dy, settings));
    if (existing.length >= 2) continue;

    const needed = 2 - existing.length;
    const candidates = cncIslandDowelCandidates(component, labels, nx, ny, xMin, yMin, dx, dy, settings, plannedDowels);
    const added = chooseCncIslandDowels(existing, candidates, needed, settings);
    for (const hole of added) {
      plannedDowels.push({ ...hole, source: "island", slabId, componentId: component.id });
      addedDowels += 1;
    }

    if (existing.length + added.length >= 2) continue;
    culledComponents += 1;
    culledCells += component.cells.length;
    for (const cell of component.cells) culledMask[cell] = 1;
    if (component.cells.length >= minComponentCells) {
      console.warn(`CNC slab ${slabId} island ${component.id} omitted because it cannot fit two dowel holes.`);
    }
  }

  return {
    componentCount: components.length,
    addedDowels,
    culledComponents,
    culledCells,
    culledMask: culledComponents ? culledMask : null,
  };
}

function cncIslandDowelCandidates(component, labels, nx, ny, xMin, yMin, dx, dy, settings, plannedDowels) {
  const candidates = [];
  const sampleStride = Math.max(1, Math.floor(component.cells.length / 600));
  for (let cellIndex = 0; cellIndex < component.cells.length; cellIndex += sampleStride) {
    const index = component.cells[cellIndex];
    const ix = index % nx;
    const iy = Math.floor(index / nx);
    const x = xMin + (ix + 0.5) * dx;
    const y = yMin + (iy + 0.5) * dy;
    const hole = { x, y, radiusMm: settings.dowelRadiusMm };
    if (!cncDowelFitsSlabComponent(hole, labels, component.id, nx, ny, xMin, yMin, dx, dy, settings)) continue;
    if (cncPointNearAny(hole, plannedDowels, Math.max(settings.dowelRadiusMm * 4, settings.dowelRadiusMm + 8))) continue;
    candidates.push(hole);
  }
  return candidates;
}

function chooseCncIslandDowels(existing, candidates, needed, settings) {
  if (needed <= 0 || !candidates.length) return [];
  const minSeparation = Math.max(settings.dowelRadiusMm * 4, settings.dowelRadiusMm + 10);
  if (existing.length === 1) {
    let best = null;
    let bestDistance = -Infinity;
    for (const candidate of candidates) {
      const distance = Math.hypot(candidate.x - existing[0].x, candidate.y - existing[0].y);
      if (distance >= minSeparation && distance > bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best ? [best] : [];
  }

  let bestPair = [];
  let bestDistance = -Infinity;
  for (let a = 0; a < candidates.length; a += 1) {
    for (let b = a + 1; b < candidates.length; b += 1) {
      const distance = Math.hypot(candidates[a].x - candidates[b].x, candidates[a].y - candidates[b].y);
      if (distance >= minSeparation && distance > bestDistance) {
        bestPair = [candidates[a], candidates[b]];
        bestDistance = distance;
      }
    }
  }
  return bestPair.slice(0, needed);
}

function cncDowelFitsSlabComponent(hole, labels, componentId, nx, ny, xMin, yMin, dx, dy, settings) {
  const ix = Math.floor((hole.x - xMin) / dx);
  const iy = Math.floor((hole.y - yMin) / dy);
  if (ix < 0 || ix >= nx || iy < 0 || iy >= ny) return false;
  if (labels[iy * nx + ix] !== componentId) return false;
  const wallMm = Math.max(1.5, Math.min(4, settings.dowelRadiusMm * 0.45));
  const fitRadius = hole.radiusMm + wallMm;
  const rx = Math.ceil(fitRadius / dx);
  const ry = Math.ceil(fitRadius / dy);
  const radiusSquared = fitRadius * fitRadius;
  for (let oy = -ry; oy <= ry; oy += 1) {
    const sy = iy + oy;
    if (sy < 0 || sy >= ny) return false;
    for (let ox = -rx; ox <= rx; ox += 1) {
      const sx = ix + ox;
      if (sx < 0 || sx >= nx) return false;
      const distSquared = (ox * dx) * (ox * dx) + (oy * dy) * (oy * dy);
      if (distSquared > radiusSquared) continue;
      if (labels[sy * nx + sx] !== componentId) return false;
    }
  }
  return true;
}

function buildCncSlabPlan(depths, nx, ny, xMin, yMin, dx, dy, settings, dowelHoles) {
  const slabs = [];
  const slabThickness = Math.max(1, settings.slabThicknessMm);
  const slabCount = Math.max(1, Math.round(settings.slabCount || Math.ceil(settings.height / slabThickness)));
  const plannedDowels = dowelHoles.map((hole) => ({ ...hole, source: hole.source || "stack" }));
  const slabIslandPlans = [];
  let islandComponentCount = 0;
  let islandDowelsAdded = 0;
  let culledIslandCount = 0;
  let culledIslandCells = 0;
  let throughCutCount = 0;
  let minWallMm = Infinity;

  for (let index = 0; index < slabCount; index += 1) {
    const topDepth = index * slabThickness;
    const bottomDepth = Math.min(settings.height, (index + 1) * slabThickness);
    const thickness = bottomDepth - topDepth;
    const heights = computeCncSlabRawHeights(depths, nx, ny, thickness, topDepth);
    const componentPlan = planCncSlabIslandDowels(
      heights,
      nx,
      ny,
      xMin,
      yMin,
      dx,
      dy,
      settings,
      plannedDowels,
      `S${String(index + 1).padStart(2, "0")}`
    );
    slabIslandPlans[index] = componentPlan;
    islandComponentCount += componentPlan.componentCount;
    islandDowelsAdded += componentPlan.addedDowels;
    culledIslandCount += componentPlan.culledComponents;
    culledIslandCells += componentPlan.culledCells;
  }

  for (const hole of plannedDowels) {
    minWallMm = Math.min(
      minWallMm,
      hole.x - xMin - hole.radiusMm,
      xMin + settings.width - hole.x - hole.radiusMm,
      hole.y - yMin - hole.radiusMm,
      yMin + settings.depth - hole.y - hole.radiusMm
    );
  }

  for (let index = 0; index < slabCount; index += 1) {
    const topDepth = index * slabThickness;
    const bottomDepth = Math.min(settings.height, (index + 1) * slabThickness);
    const thickness = bottomDepth - topDepth;
    const globalBottom = settings.height - bottomDepth;
    const mesh = buildCncSlabMesh(
      depths,
      nx,
      ny,
      xMin,
      yMin,
      dx,
      dy,
      thickness,
      topDepth,
      bottomDepth,
      plannedDowels,
      slabIslandPlans[index]?.culledMask ?? null
    );
    if (mesh.through_cut_cells) throughCutCount += 1;
    slabs.push({
      id: `S${String(index + 1).padStart(2, "0")}`,
      mesh,
      top_depth_mm: roundedCoordinate(topDepth),
      bottom_depth_mm: roundedCoordinate(bottomDepth),
      thickness_mm: roundedCoordinate(thickness),
      global_bottom_mm: roundedCoordinate(globalBottom),
      through_cut_cells: mesh.through_cut_cells ?? 0,
      island_components: slabIslandPlans[index]?.componentCount ?? 0,
      culled_island_components: slabIslandPlans[index]?.culledComponents ?? 0,
      culled_island_cells: slabIslandPlans[index]?.culledCells ?? 0,
    });
  }

  return {
    slabs,
    dowelHoles: plannedDowels,
    throughCutCount,
    minWallMm: Number.isFinite(minWallMm) ? roundedCoordinate(minWallMm) : null,
    islandComponentCount,
    islandDowelsAdded,
    culledIslandCount,
    culledIslandCells,
    islandDowelValid: culledIslandCount === 0,
    islandWarning: culledIslandCount
      ? `${culledIslandCount.toLocaleString()} CNC slab island${culledIslandCount === 1 ? "" : "s"} could not fit two dowels and ${culledIslandCount === 1 ? "was" : "were"} omitted.`
      : "",
    settings: {
      slab_count: slabCount,
      slab_thickness_mm: roundedCoordinate(settings.slabThicknessMm),
      dowel_diameter_mm: roundedCoordinate(settings.dowelDiameterMm),
      dowel_clearance_mm: roundedCoordinate(settings.dowelClearanceMm),
    },
  };
}

function buildCncSlabMesh(depths, nx, ny, xMin, yMin, dx, dy, slabHeight, topDepth, bottomDepth, dowelHoles, culledMask = null) {
  const mesh = { vertices: [], triangles: [], triangle_count: 0, through_cut_cells: 0, culled_island_cells: 0 };
  const heights = new Float64Array(nx * ny);
  const epsilon = 0.001;

  for (let iy = 0; iy < ny; iy += 1) {
    const y = yMin + (iy + 0.5) * dy;
    for (let ix = 0; ix < nx; ix += 1) {
      const cellIndex = iy * nx + ix;
      if (culledMask?.[cellIndex]) {
        mesh.culled_island_cells += 1;
        heights[cellIndex] = 0;
        continue;
      }
      const x = xMin + (ix + 0.5) * dx;
      let height = slabHeight - Math.max(0, Math.min(slabHeight, depths[cellIndex] - topDepth));
      for (const hole of dowelHoles) {
        if (Math.hypot(x - hole.x, y - hole.y) <= hole.radiusMm) {
          height = 0;
          break;
        }
      }
      if (height <= epsilon) {
        if (depths[cellIndex] >= bottomDepth - epsilon) mesh.through_cut_cells += 1;
        height = 0;
      }
      heights[cellIndex] = height;
    }
  }

  const cellHeight = (ix, iy) => (ix < 0 || ix >= nx || iy < 0 || iy >= ny ? 0 : heights[iy * nx + ix]);
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const height = heights[iy * nx + ix];
      if (height <= epsilon) continue;
      const x0 = xMin + ix * dx;
      const x1 = x0 + dx;
      const y0 = yMin + iy * dy;
      const y1 = y0 + dy;
      appendQuadCoords(mesh, x0, y0, height, x1, y0, height, x1, y1, height, x0, y1, height);
      appendQuadCoords(mesh, x0, y0, 0, x0, y1, 0, x1, y1, 0, x1, y0, 0);

      const left = cellHeight(ix - 1, iy);
      const right = cellHeight(ix + 1, iy);
      const down = cellHeight(ix, iy - 1);
      const up = cellHeight(ix, iy + 1);
      if (left < height - epsilon) appendQuadCoords(mesh, x0, y1, left, x0, y0, left, x0, y0, height, x0, y1, height);
      if (right < height - epsilon) appendQuadCoords(mesh, x1, y0, right, x1, y1, right, x1, y1, height, x1, y0, height);
      if (down < height - epsilon) appendQuadCoords(mesh, x0, y0, down, x1, y0, down, x1, y0, height, x0, y0, height);
      if (up < height - epsilon) appendQuadCoords(mesh, x1, y1, up, x0, y1, up, x0, y1, height, x1, y1, height);
    }
  }

  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  return mesh;
}

function appendQuadCoords(mesh, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  const a = pushMeshVertex(mesh, ax, ay, az);
  const b = pushMeshVertex(mesh, bx, by, bz);
  const c = pushMeshVertex(mesh, cx, cy, cz);
  const d = pushMeshVertex(mesh, dx, dy, dz);
  appendSideQuad(mesh, a, b, c, d);
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

function cncSlabMaterial(index) {
  return new THREE.MeshStandardMaterial({
    color: cncSlabPalette[index % cncSlabPalette.length],
    roughness: 0.88,
    metalness: 0,
    transparent: true,
    opacity: 0.58,
    side: THREE.DoubleSide,
    flatShading: true,
    depthWrite: false,
  });
}

function renderCncFoamPreview(result) {
  clearMeshGroup(cncGroup);
  clearMeshGroup(splitGroup);
  clearMeshGroup(supportGroup);
  clearMeshGroup(coverageGroup);
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.printCradleSafety = {
    exportable: false,
    reason: "High accuracy has not been run for this cradle.",
  };
  state.coverage = null;
  state.coverageVisible = false;
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  state.cncMesh = result.mesh;
  state.cncQa = result.qa;
  state.cncSlabPlan = result.slabPlan ?? null;
  state.cncSlabs = result.slabPlan?.slabs ?? [];
  if (state.cncSlabs.length) {
    for (const [index, slab] of state.cncSlabs.entries()) {
      const slabMesh = renderMeshIntoGroup(cncGroup, slab.mesh, cncSlabMaterial(index), `CNC foam slab ${slab.id}`);
      if (slabMesh) slabMesh.position.z = slab.global_bottom_mm;
    }
  } else {
    renderMeshIntoGroup(cncGroup, result.mesh, materialCncFoam, "CNC VCarve relief target");
  }
  renderMeshIntoGroup(cncGroup, result.unreachableMesh, materialCncUnreachable, "CNC unreachable overlay");
  renderMeshIntoGroup(cncGroup, result.intersectionMesh, materialCncIntersection, "CNC clearance risk overlay");
  renderCncPlanMarkers(result.fingerHolePlan?.holes ?? [], result.slabPlan?.dowelHoles ?? [], result.qa?.settings?.height ?? 0);
  cncGroup.visible = true;
  supportGroup.visible = false;
}

function renderCncPlanMarkers(fingerHoles, dowelHoles, blockHeight) {
  for (const hole of fingerHoles) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.5, (hole.radiusMm ?? 15) * 0.85), Math.max(1, hole.radiusMm ?? 15), 36),
      materialCncMarker
    );
    ring.position.set(hole.x, hole.y, blockHeight + 1.2);
    ring.name = `CNC ${hole.source || "planned"} finger hole`;
    cncGroup.add(ring);
  }
  for (const hole of dowelHoles) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.5, (hole.radiusMm ?? 3) * 0.75), Math.max(1, hole.radiusMm ?? 3), 28),
      materialCncMarker
    );
    ring.position.set(hole.x, hole.y, blockHeight + 2.0);
    ring.name = "CNC dowel alignment hole";
    cncGroup.add(ring);
  }
}

function renderMeshIntoGroup(group, supportMesh, material, name) {
  if (!supportMesh?.vertices?.length || !supportMesh?.triangles?.length) return null;
  normalizeSupportMeshArrays(supportMesh);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(supportMesh.vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(supportMesh.triangles, 1));
  const displayGeometry = shouldUseNonIndexedDisplay(supportMesh, material) ? geometry.toNonIndexed() : geometry;
  if (displayGeometry !== geometry) geometry.dispose();
  displayGeometry.computeVertexNormals();
  displayGeometry.computeBoundingBox();
  displayGeometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(displayGeometry, material);
  mesh.name = name;
  group.add(mesh);
  return mesh;
}

function clearCncPreview(options = {}) {
  clearMeshGroup(cncGroup);
  state.cncMesh = null;
  state.cncQa = null;
  state.cncSlabs = [];
  state.cncSlabPlan = null;
  if (!options.keepStatus) setCncStatus("Load a model to preview a foam relief.", "idle");
  if (state.workflowMode === "cnc") resetQaDashboard();
  updateButtons();
}

function clearCncFingerHoleMarks() {
  state.cncFingerHoles = [];
  state.cncFingerHoleMode = false;
  if (renderer?.domElement && !state.cncBusy) renderer.domElement.style.cursor = "";
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
  const placementOffset = Math.max(0, Math.round((maxRequiredDepth - settings.allowedDepthMm) * 2) / 2);
  const displayLift = placementOffset;
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
      detail: qa.settings.slabsEnabled
        ? `${formatStatusNumber(qa.allowed_depth_mm)} mm stack allowed, ${formatStatusNumber(qa.per_setup_allowed_depth_mm)} mm per slab reach`
        : `${formatStatusNumber(qa.allowed_depth_mm)} mm allowed, ${formatStatusNumber(qa.model_placement_offset_mm)} mm ${qa.auto_lift_enabled ? "auto" : "manual"} offset`,
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
    {
      label: "Clearance",
      value: `${formatStatusNumber(qa.clearance_xy_mm)} / ${formatStatusNumber(qa.clearance_z_mm)} mm`,
      detail: `${qa.xy_clearance_cells.toLocaleString()} XY-expanded cells`,
      state: "ok",
    },
    {
      label: "Finger holes",
      value: qa.finger_holes ? qa.finger_holes.toLocaleString() : "None",
      detail: `${qa.auto_finger_holes.toLocaleString()} auto, ${qa.manual_finger_holes.toLocaleString()} manual`,
      state: qa.settings.autoFingerHoles && qa.finger_holes < 2 ? "caution" : "ok",
    },
    {
      label: "Slabs",
      value: qa.slab_count ? qa.slab_count.toLocaleString() : "Off",
      detail: qa.slab_count
        ? `${qa.dowel_holes.toLocaleString()} dowels (${qa.slab_island_dowels_added.toLocaleString()} island), ${qa.slab_islands_omitted.toLocaleString()} islands omitted`
        : "Single relief STL",
      state: qa.slab_count && (!qa.dowel_valid || !qa.slab_can_through_cut) ? "caution" : "ok",
    },
  ]);
}

function buildSupportJobPayload(options = {}) {
  const bbox = new THREE.Box3().setFromObject(state.modelMesh);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const mesh = buildMeshPayload();
  const accuracyMode = options.accuracyMode || "fast";

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
    cradle_config: collectCradleConfig({ accuracyMode }),
    manual_supports: realizedManualSupports().map((support) => ({
      id: support.id,
      source: support.source,
      point: support.worldPoint.toArray(),
      normal: support.worldNormal.toArray(),
      radius: support.radiusMm ?? supportBrushRadiusMm(),
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
  state.modelRevision += 1;
  state.draftSupportCache = null;
  state.modelManifoldPrewarmToken += 1;
  state.modelTrimPrewarmToken += 1;
  if (state.modelManifoldPrewarmTimer !== null) {
    if (typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(state.modelManifoldPrewarmTimer);
    } else {
      window.clearTimeout(state.modelManifoldPrewarmTimer);
    }
    state.modelManifoldPrewarmTimer = null;
  }
  cancelModelTrimWorkerPrewarm();
  state.modelTrimPrewarmPromise = null;
  state.modelTrimPrewarmKey = "";
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
    .filter((phase) =>
      phase.label &&
      Number.isFinite(phase.ms) &&
      (phase.ms >= 0.05 || phase.label === "cached model clearance solid")
    )
    .map((phase) => `${phase.label} ${formatDurationMs(phase.ms)}`);
  return parts.length ? ` Trim phases: ${parts.join(", ")}.` : "";
}

function inchesToMm(value) {
  return Math.max(0, Number(value) || 0) * INCH_TO_MM;
}

function collectSupportConfig() {
  const interfaceEnabled = Boolean(controlsEl.interfaceEnabled?.checked);
  const foamGapEnabled = Boolean(controlsEl.foamGapEnabled?.checked);
  const resolutionProfile = selectedCradleResolutionProfile();

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
    support_critical_regions_only: false,
    support_remove_small_overhang: controlsEl.supportRemoveSmallOverhang.checked,
    support_top_z_distance: Number(controlsEl.supportTopZDistance.value),
    support_bottom_z_distance: Number(controlsEl.supportTopZDistance.value),
    support_object_xy_distance: Number(controlsEl.supportObjectXYDistance.value),
    support_edge_clearance_mm: Number(controlsEl.supportEdgeClearance.value),
    support_base_pattern_spacing: resolutionProfile.cellSizeMm,
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

function collectCradleConfig(options = {}) {
  const accuracyMode = options.accuracyMode || "fast";
  const resolutionProfile = selectedCradleResolutionProfile();
  const config = {
    base_enabled: controlsEl.baseEnabled.checked,
    join_uprights_bottom_enabled: controlsEl.baseJoinUprights.checked,
    support_blocker_cuts_base: Boolean(controlsEl.supportBlockCutsBase?.checked),
    base_margin_mm: Number(controlsEl.baseMargin.value),
    base_thickness_mm: Number(controlsEl.baseThickness.value),
    column_taper_enabled: Number(controlsEl.columnTaperAngle.value) > 0,
    column_taper_angle_deg: Number(controlsEl.columnTaperAngle.value),
    max_contact_grid_cells: resolutionProfile.gridBudgetCells,
  };
  if (accuracyMode === "medium") {
    config.max_contact_grid_cells = Math.max(config.max_contact_grid_cells, MEDIUM_SUPPORT_GRID_BUDGET_CELLS);
  }
  return config;
}

function selectedCradleResolutionProfileKey() {
  const selected = controlsEl.cradleResolutionProfiles.find((input) => input.checked)?.value;
  return CRADLE_RESOLUTION_PROFILES[selected] ? selected : DEFAULT_CRADLE_RESOLUTION_PROFILE;
}

function selectedCradleResolutionProfile() {
  return CRADLE_RESOLUTION_PROFILES[selectedCradleResolutionProfileKey()];
}

function nextFinerCradleResolutionProfileKey(profileKey = selectedCradleResolutionProfileKey()) {
  if (profileKey === "low") return "medium";
  if (profileKey === "medium") return "high";
  return null;
}

function applyCradleResolutionProfile(profileKey) {
  const resolvedKey = CRADLE_RESOLUTION_PROFILES[profileKey]
    ? profileKey
    : DEFAULT_CRADLE_RESOLUTION_PROFILE;
  const profile = CRADLE_RESOLUTION_PROFILES[resolvedKey];
  for (const input of controlsEl.cradleResolutionProfiles) {
    input.checked = input.value === resolvedKey;
  }
  controlsEl.supportBasePatternSpacing.value = String(profile.cellSizeMm);
  clearGeneratedSupport();
  clearResolutionPrompt();
  updateOutputs();
  updateButtons();
}

function formatGridBudget(cellCount) {
  const cells = Math.max(0, Number(cellCount) || 0);
  if (cells >= 1000000) return `${formatStatusNumber(cells / 1000000)}M`;
  if (cells >= 1000) return `${formatStatusNumber(cells / 1000)}K`;
  return Math.round(cells).toLocaleString();
}

function updateManualMarkers() {
  markerGroup.clear();
  state.supportMarkerObjects.clear();

  if (!state.modelMesh) {
    updateButtons();
    return;
  }

  for (const support of realizedManualSupports()) {
    addRealizedManualMarker(support);
  }

  updateButtons();
}

function addManualMarker(support) {
  if (!state.modelMesh || !support) return;
  addRealizedManualMarker(realizedManualSupport(support));
}

function addRealizedManualMarker(support) {
  const isPaintEnforce = support.source === "paint_enforce";
  const isPaintBlock = support.source === "paint_block";
  const markerMaterial = isPaintBlock ? materialMarkerBlock : isPaintEnforce ? materialMarkerEnforce : materialMarkerManual;
  const markerRadius = isPaintBlock || isPaintEnforce
    ? Math.max(0.5, support.radiusMm || supportBrushRadiusMm())
    : 2.8;
  const markerGeometry = isPaintBlock || isPaintEnforce
    ? new THREE.CircleGeometry(markerRadius, 32)
    : new THREE.SphereGeometry(markerRadius, 18, 10);
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  if (isPaintBlock || isPaintEnforce) {
    marker.position.copy(support.worldPoint).addScaledVector(support.worldNormal, 0.16);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), support.worldNormal.clone().normalize());
    marker.renderOrder = 12;
    marker.visible = state.supportPaintMode !== "off";
  } else {
    marker.position.copy(support.worldPoint);
  }
  marker.userData.supportId = support.id;
  markerGroup.add(marker);
  state.supportMarkerObjects.set(support.id, marker);
}

function clearGeneratedSupport() {
  state.printCradleSafety = {
    exportable: false,
    reason: "High accuracy has not been run for this cradle.",
  };
  if (!state.supportMesh && !state.interfaceMesh && !state.coverage && supportGroup.children.length === 0 && splitGroup.children.length === 0 && coverageGroup.children.length === 0) {
    resetQaDashboard();
    return;
  }
  clearMeshGroup(supportGroup);
  clearMeshGroup(splitGroup);
  clearMeshGroup(coverageGroup);
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

function clearMeshGroup(group) {
  if (!group) return;
  group.traverse((object) => {
    if (object?.geometry && typeof object.geometry.dispose === "function") {
      object.geometry.dispose();
    }
  });
  group.clear();
}

function realizedManualSupports() {
  return state.manualSupports.map((support) => realizedManualSupport(support));
}

function realizedManualSupport(support) {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(state.modelMesh.matrixWorld);
  const worldPoint = state.modelMesh.localToWorld(support.localPoint.clone());
  const worldNormal = support.localNormal.clone().applyMatrix3(normalMatrix).normalize();
  return { ...support, worldPoint, worldNormal };
}

function updateOutputs() {
  outputs.elevation.textContent = `${controlsEl.elevation.value} mm`;
  outputs.supportThresholdAngle.textContent = `${controlsEl.supportThresholdAngle.value} deg`;
  outputs.supportTopZDistance.textContent = `${controlsEl.supportTopZDistance.value} mm`;
  outputs.supportObjectXYDistance.textContent = `${controlsEl.supportObjectXYDistance.value} mm`;
  outputs.supportEdgeClearance.textContent = `${controlsEl.supportEdgeClearance.value} mm`;
  if (outputs.cradleResolutionProfile) {
    const profile = selectedCradleResolutionProfile();
    outputs.cradleResolutionProfile.textContent = `${profile.label}: ${formatStatusNumber(profile.cellSizeMm)} mm target, ${formatGridBudget(profile.gridBudgetCells)}-cell limit`;
  }
  if (outputs.supportOpacity && controlsEl.supportOpacity) {
    outputs.supportOpacity.textContent = `${Math.round(Number(controlsEl.supportOpacity.value) || 100)}%`;
  }
  if (outputs.supportBrushRadius && controlsEl.supportBrushRadius) {
    outputs.supportBrushRadius.textContent = `${formatStatusNumber(supportBrushDiameterMm())} mm diameter`;
  }
  outputs.treeSupportBranchDistance.textContent = `${controlsEl.treeSupportBranchDistance.value} mm`;
  outputs.treeSupportBranchAngle.textContent = `${controlsEl.treeSupportBranchAngle.value} deg`;
  outputs.baseMargin.textContent = `${controlsEl.baseMargin.value} mm`;
  outputs.baseThickness.textContent = `${controlsEl.baseThickness.value} mm`;
  outputs.columnTaperAngle.textContent = `${controlsEl.columnTaperAngle.value} deg`;
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
  if (outputs.cncBlockHeight && controlsEl.cncSlabsEnabled && controlsEl.cncSlabCount && controlsEl.cncSlabThicknessIn) {
    const slabsEnabled = Boolean(controlsEl.cncSlabsEnabled.checked);
    if (slabsEnabled) {
      const slabCount = Math.max(1, Math.round(positiveNumber(controlsEl.cncSlabCount.value, 3)));
      const slabThicknessMm = inchesToMm(controlsEl.cncSlabThicknessIn.value || 1);
      outputs.cncBlockHeight.textContent = `Overridden by slabs: ${formatStatusNumber(slabThicknessMm * slabCount)} mm`;
    } else {
      outputs.cncBlockHeight.textContent = "Used when slabs are off";
    }
  }
  if (outputs.cncModelLift && controlsEl.cncModelLift) {
    outputs.cncModelLift.textContent = `${formatStatusNumber(controlsEl.cncModelLift.value)} mm`;
  }
  if (outputs.cncSlabThickness && controlsEl.cncSlabCount && controlsEl.cncSlabThicknessIn) {
    const slabCount = Math.max(1, Math.round(positiveNumber(controlsEl.cncSlabCount.value, 3)));
    const slabThicknessMm = inchesToMm(controlsEl.cncSlabThicknessIn.value || 1);
    outputs.cncSlabThickness.textContent = `${formatStatusNumber(slabThicknessMm)} mm each, ${formatStatusNumber(slabThicknessMm * slabCount)} mm total`;
  }
}

function updateButtons() {
  const hasModel = Boolean(state.modelMesh);
  const supportCount = state.manualSupports.length;
  const generatedSupportTriangles = state.supportMesh?.triangle_count ?? 0;
  const generatedInterfaceTriangles = state.interfaceMesh?.triangle_count ?? 0;
  const generatedCncTriangles = state.cncMesh?.triangle_count ?? 0;
  const generatedCncSlabs = state.cncSlabs?.length ?? 0;
  const cncBusy = Boolean(state.cncBusy);
  const printBusy = Boolean(state.generationBusy);
  const cncSlabsEnabled = Boolean(controlsEl.cncSlabsEnabled?.checked);
  const printExportable = Boolean(state.printCradleSafety?.exportable);
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
  if (controlsEl.cncBlockHeight) {
    controlsEl.cncBlockHeight.disabled = cncBusy || cncSlabsEnabled;
  }
  if (controlsEl.cncBlockHeightCell) {
    const blockHeightOverridden = cncSlabsEnabled;
    controlsEl.cncBlockHeightCell.classList.toggle("is-disabled", cncBusy || blockHeightOverridden);
    controlsEl.cncBlockHeightCell.title = blockHeightOverridden
      ? "Use multiple slabs sets total foam height from slab count and slab thickness."
      : "";
  }
  if (controlsEl.supportDisplayMode) {
    controlsEl.supportDisplayMode.disabled = generatedSupportTriangles === 0 && generatedInterfaceTriangles === 0;
    if (controlsEl.supportDisplayMode.value !== state.supportDisplayMode) {
      controlsEl.supportDisplayMode.value = state.supportDisplayMode;
    }
  }
  if (controlsEl.supportOpacity) {
    controlsEl.supportOpacity.disabled = generatedSupportTriangles === 0 && generatedInterfaceTriangles === 0;
  }
  if (controlsEl.supportPaintMode) {
    controlsEl.supportPaintMode.disabled = !hasModel;
    if (controlsEl.supportPaintMode.value !== state.supportPaintMode) {
      controlsEl.supportPaintMode.value = state.supportPaintMode;
    }
  }
  if (controlsEl.supportBrushRadius) {
    controlsEl.supportBrushRadius.disabled = !hasModel;
  }
  if (controlsEl.supportBlockCutsBase) {
    controlsEl.supportBlockCutsBase.disabled = !hasModel;
  }
  if (controlsEl.clearPaint) {
    controlsEl.clearPaint.disabled = !state.manualSupports.some((support) => support.source === "paint_enforce" || support.source === "paint_block");
  }
  controlsEl.orientModel.disabled = !hasModel || printBusy;
  controlsEl.resetOrientation.disabled = !hasModel || printBusy;
  controlsEl.generateSupports.disabled = !hasModel || printBusy;
  if (controlsEl.generateMediumAccuracySupports) controlsEl.generateMediumAccuracySupports.disabled = !hasModel || printBusy;
  if (controlsEl.generateHighAccuracySupports) controlsEl.generateHighAccuracySupports.disabled = !hasModel || printBusy;
  if (controlsEl.cancelCradleGeneration) {
    controlsEl.cancelCradleGeneration.hidden = !state.generationBusy;
    controlsEl.cancelCradleGeneration.disabled = !state.generationBusy;
  }
  if (controlsEl.cncGenerate) controlsEl.cncGenerate.disabled = !hasModel || cncBusy;
  if (controlsEl.cncAutoFit) controlsEl.cncAutoFit.disabled = !hasModel || cncBusy;
  if (controlsEl.cncClear) controlsEl.cncClear.disabled = generatedCncTriangles === 0 || cncBusy;
  if (controlsEl.cncAddFingerHole) {
    controlsEl.cncAddFingerHole.disabled = !hasModel || !state.cncQa?.finger_hole_candidates || cncBusy;
    controlsEl.cncAddFingerHole.textContent = state.cncFingerHoleMode ? "Stop adding" : "Add finger hole";
  }
  if (controlsEl.cncClearFingerHoles) controlsEl.cncClearFingerHoles.disabled = !state.cncFingerHoles.length || cncBusy;
  if (controlsEl.toggleCoverage) {
    controlsEl.toggleCoverage.disabled = !state.coverage?.cells?.length;
    controlsEl.toggleCoverage.textContent = state.coverageVisible ? "Hide coverage" : "Show coverage";
  }
  if (controlsEl.clearManual) {
    controlsEl.clearManual.disabled = !state.manualSupports.some((support) => support.source === "manual");
  }
  controlsEl.exportStl.disabled = generatedSupportTriangles === 0 || printBusy;
  controlsEl.exportStl.title = generatedSupportTriangles && !printExportable ? `${state.printCradleSafety.reason} Export will ask for confirmation.` : "";
  if (controlsEl.exportPly) {
    controlsEl.exportPly.disabled = generatedSupportTriangles === 0 || printBusy;
    controlsEl.exportPly.title = generatedSupportTriangles && !printExportable ? `${state.printCradleSafety.reason} Export will ask for confirmation.` : "";
  }
  if (controlsEl.exportInterfaceStl) {
    controlsEl.exportInterfaceStl.disabled = generatedInterfaceTriangles === 0 || printBusy;
    controlsEl.exportInterfaceStl.title = generatedInterfaceTriangles && !printExportable ? `${state.printCradleSafety.reason} Export will ask for confirmation.` : "";
  }
  if (controlsEl.exportInterfacePly) {
    controlsEl.exportInterfacePly.disabled = generatedInterfaceTriangles === 0 || printBusy;
    controlsEl.exportInterfacePly.title = generatedInterfaceTriangles && !printExportable ? `${state.printCradleSafety.reason} Export will ask for confirmation.` : "";
  }
  if (controlsEl.exportCncStl) controlsEl.exportCncStl.disabled = generatedCncTriangles === 0 || cncBusy;
  if (controlsEl.exportCncSlabStls) controlsEl.exportCncSlabStls.disabled = generatedCncSlabs === 0 || cncBusy;
  if (controlsEl.exportCncSlabManifest) controlsEl.exportCncSlabManifest.disabled = !state.cncSlabPlan || cncBusy;
  if (controlsEl.previewSplit) controlsEl.previewSplit.disabled = generatedSupportTriangles === 0 || printBusy;
  if (controlsEl.clearSplit) controlsEl.clearSplit.disabled = !state.splitPreviewVisible || printBusy;
  if (controlsEl.exportSplitStls) {
    controlsEl.exportSplitStls.disabled = !state.splitChunks.length || printBusy;
    controlsEl.exportSplitStls.title = state.splitChunks.length && !printExportable ? `${state.printCradleSafety.reason} Export will ask for confirmation.` : "";
  }
  if (controlsEl.exportSplitManifest) controlsEl.exportSplitManifest.disabled = !state.splitChunks.length || printBusy;
  const totalGeneratedTriangles = generatedSupportTriangles + generatedInterfaceTriangles;
  if (state.workflowMode === "cnc") {
    supportStatus.textContent = generatedCncTriangles
      ? `${generatedCncTriangles.toLocaleString()} CNC foam relief triangles${generatedCncSlabs ? `, ${generatedCncSlabs.toLocaleString()} slab STLs ready` : ""}`
      : "CNC foam relief not generated";
  } else {
    supportStatus.textContent = totalGeneratedTriangles
      ? `${generatedSupportTriangles.toLocaleString()} cradle + ${generatedInterfaceTriangles.toLocaleString()} interface triangles`
      : `${supportCount} coverage marks`;
  }
}

function setJobStatus(message, stateName = "idle") {
  jobStatus.textContent = message;
  jobStatus.dataset.state = stateName;
}

function resetQaDashboard() {
  clearResolutionPrompt();
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
  const meshState = summary.meshQa?.failed
    ? "caution"
    : summary.meshQa?.unsupported_cells
      ? "error"
      : "ok";
  const gridIntersectionCount = Number(summary.qa?.intersection_cells ?? 0);
  const meshIntersectionCount = Number(summary.modelMeshQa?.intersection_samples ?? 0);
  const intersectionCount = gridIntersectionCount + meshIntersectionCount;
  const maxPenetration = Math.max(
    Number(summary.qa?.max_penetration_mm ?? 0),
    Number(summary.modelMeshQa?.max_penetration_mm ?? 0)
  );
  const intersectionState = summary.modelMeshQa?.failed
    ? "caution"
    : intersectionCount
      ? "error"
      : "ok";
  const stabilityState = summary.stabilityQa?.severity === "error"
    ? "error"
    : summary.stabilityQa?.severity === "caution"
      ? "caution"
      : "ok";
  const resolutionRecommendation = summary.resolutionRecommendation ?? null;
  const resolutionState = resolutionRecommendation
    ? (resolutionRecommendation.severity === "error" ? "error" : "caution")
    : "ok";
  const resolutionValue = resolutionRecommendation
    ? "Adjust"
    : `${formatStatusNumber(summary.effectiveCellSize ?? 0)} mm`;
  const resolutionDetail = resolutionRecommendation
    ? resolutionRecommendation.cardDetail
    : `${Number(summary.gridCols ?? 0).toLocaleString()} x ${Number(summary.gridRows ?? 0).toLocaleString()} cells`;
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
      value: summary.meshQa?.failed ? "QA failed" : summary.meshQa?.unsupported_cells ? "Gap" : "Solid",
      detail: summary.meshQa?.failed
        ? summary.meshQa.reason || "mesh QA could not complete"
        : `${formatStatusNumber(summary.meshQa?.max_gap_mm ?? 0)} mm max gap`,
      state: meshState,
    },
    {
      label: "Intersections",
      value: summary.modelMeshQa?.failed ? "QA failed" : intersectionCount ? intersectionCount.toLocaleString() : "None",
      detail: summary.modelMeshQa?.failed
        ? summary.modelMeshQa.reason || "intersection QA could not complete"
        : `${formatStatusNumber(maxPenetration)} mm penetration`,
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
      label: "Resolution",
      value: resolutionValue,
      detail: resolutionDetail,
      state: resolutionState,
    },
    {
      label: "Split",
      value: summary.splitReady ? "Ready" : "--",
      detail: "Preview chunks",
      state: summary.splitReady ? "pending" : "idle",
    },
  ]);
}

function resolutionAdjustmentRecommendation({
  accuracyMode,
  requestedCellSize,
  effectiveCellSize,
  gridCols,
  gridRows,
  gridBudgetCells,
  totalTriangleCount,
  contactCellCount,
  envelopeCellCount,
  prunedSparseCellCount,
  overhangFacetCount,
  meshQa,
  supportedDownwardPercent,
}) {
  const requested = Number(requestedCellSize);
  const effective = Number(effectiveCellSize);
  if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(effective) || effective <= 0) return null;

  const nextProfileKey = nextFinerCradleResolutionProfileKey();
  const nextProfile = nextProfileKey ? CRADLE_RESOLUTION_PROFILES[nextProfileKey] : null;
  if (effective > requested + 0.01) {
    const renderedCells = Number(gridCols ?? 0) * Number(gridRows ?? 0);
    const requestedCells =
      renderedCells > 0 && Number.isFinite(renderedCells)
        ? Math.round(renderedCells * Math.pow(effective / requested, 2))
        : 0;
    const requestedCellText =
      requestedCells > 0
        ? ` The requested resolution would be about ${requestedCells.toLocaleString()} cells for this model.`
        : "";
    const budget = Number(gridBudgetCells);
    const budgetText = Number.isFinite(budget) && budget > 0
      ? `${Math.round(budget).toLocaleString()}-cell grid budget`
      : "current grid limit";
    const modeText = accuracyMode === "medium"
      ? "Medium accuracy"
      : accuracyMode === "high"
        ? "High accuracy"
        : "Fast";
    return {
      type: "auto-coarsened",
      severity: "caution",
      suggestedProfile: nextProfileKey,
      cardDetail: `${formatStatusNumber(effective)} mm effective`,
      message: `${modeText}: the requested ${formatStatusNumber(requested)} mm cradle resolution exceeded the ${budgetText}, so CradleMaker used ${formatStatusNumber(effective)} mm over ${Number(gridCols ?? 0).toLocaleString()} x ${Number(gridRows ?? 0).toLocaleString()} cells.${requestedCellText}${nextProfile ? ` Switch to ${nextProfile.label} for a finer target and a larger grid budget.` : " High is already selected; the grid remains memory-bounded."}`,
      applyLabel: nextProfile ? `Use ${nextProfile.label}` : null,
    };
  }

  const contactCount = Number(contactCellCount ?? 0);
  const envelopeCount = Number(envelopeCellCount ?? 0);
  const triangleCount = Number(totalTriangleCount ?? 0);
  const overhangCount = Number(overhangFacetCount ?? 0);
  const contactRatio = envelopeCount > 0 ? contactCount / envelopeCount : 1;
  const thinFeatureMiss =
    (triangleCount === 0 && (envelopeCount > 0 || overhangCount > 0)) ||
    (envelopeCount >= 25 && contactCount <= Math.max(4, envelopeCount * 0.08));

  if (thinFeatureMiss) {
    return {
      type: "thin-feature-miss",
      severity: triangleCount === 0 ? "error" : "caution",
      suggestedProfile: nextProfileKey,
      cardDetail: nextProfile ? `Thin features? Try ${nextProfile.label}` : "Thin-feature warning",
      message: `Very little cradle was produced from the sampled underside (${contactCount.toLocaleString()} contact cells from ${envelopeCount.toLocaleString()} candidate cells). The model may have thin parts that the ${formatStatusNumber(requested)} mm cradle grid is missing.${nextProfile ? ` Switch to ${nextProfile.label} and regenerate supports.` : " High resolution is already selected."}`,
      applyLabel: nextProfile ? `Use ${nextProfile.label}` : null,
    };
  }

  const sparseRatio = envelopeCellCount > 0 ? prunedSparseCellCount / envelopeCellCount : 0;
  const meshGap = Number(meshQa?.max_gap_mm ?? 0);
  const unsupportedMeshCells = Number(meshQa?.unsupported_cells ?? 0);
  const supportedPercent = Number(supportedDownwardPercent ?? 100);
  const likelyCoarse =
    sparseRatio > 0.18 ||
    contactRatio < 0.35 ||
    unsupportedMeshCells > 0 ||
    supportedPercent < 99.5 ||
    meshGap > Math.max(0.4, requested * 0.8);

  if (!likelyCoarse) return null;

  return {
    type: "too-coarse",
    severity: unsupportedMeshCells || supportedPercent < 95 ? "error" : "caution",
    suggestedProfile: nextProfileKey,
    cardDetail: nextProfile ? `Try ${nextProfile.label}` : "High-resolution warning",
    message: `This cradle may be undersampling thin features at ${formatStatusNumber(requested)} mm resolution.${nextProfile ? ` Switch to ${nextProfile.label} and regenerate supports.` : " High resolution is already selected."}`,
    applyLabel: nextProfile ? `Use ${nextProfile.label}` : null,
  };
}

function showResolutionPrompt(recommendation) {
  state.resolutionSuggestion = recommendation ?? null;
  if (!controlsEl.resolutionPrompt || !controlsEl.resolutionPromptText) return;
  if (!recommendation) {
    clearResolutionPrompt();
    return;
  }
  controlsEl.resolutionPrompt.hidden = false;
  controlsEl.resolutionPromptText.textContent = recommendation.message;
  if (controlsEl.applyResolutionSuggestion) {
    controlsEl.applyResolutionSuggestion.hidden = !recommendation.suggestedProfile;
    controlsEl.applyResolutionSuggestion.textContent = recommendation.applyLabel || "Apply suggested resolution";
  }
}

function clearResolutionPrompt() {
  state.resolutionSuggestion = null;
  if (controlsEl.resolutionPrompt) controlsEl.resolutionPrompt.hidden = true;
  if (controlsEl.resolutionPromptText) controlsEl.resolutionPromptText.textContent = "";
  if (controlsEl.applyResolutionSuggestion) controlsEl.applyResolutionSuggestion.hidden = true;
}

function applyResolutionSuggestion() {
  const suggestion = state.resolutionSuggestion;
  if (!suggestion?.suggestedProfile) return;
  applyCradleResolutionProfile(suggestion.suggestedProfile);
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
  if (Number(value) >= 100) {
    window.setTimeout(() => resetProgress(controlsEl.jobProgressShell, controlsEl.jobProgress), 250);
  }
}

function setSplitProgress(value) {
  setProgress(controlsEl.splitProgressShell, controlsEl.splitProgress, value);
  if (Number(value) >= 100) {
    window.setTimeout(() => resetProgress(controlsEl.splitProgressShell, controlsEl.splitProgress), 250);
  }
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
  if (progress === controlsEl.jobProgress) setProgressDetail("");
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

function applySupportDisplayMode(mode) {
  const normalized = ["solid", "ghost", "hidden"].includes(mode) ? mode : "solid";
  state.supportDisplayMode = normalized;
  if (controlsEl.supportDisplayMode && controlsEl.supportDisplayMode.value !== normalized) {
    controlsEl.supportDisplayMode.value = normalized;
  }
  supportGroup.visible = normalized !== "hidden";
  applySupportMaterialOpacity();
}

function applySupportOpacity(opacity) {
  state.supportOpacity = Math.max(0.1, Math.min(1, Number(opacity) || 1));
  applySupportMaterialOpacity();
}

function applySupportMaterialOpacity() {
  const ghost = state.supportDisplayMode === "ghost";
  const opacity = ghost ? Math.min(state.supportOpacity, 0.42) : state.supportOpacity;
  for (const material of [materialSupport, materialInterface]) {
    material.transparent = opacity < 0.995 || ghost;
    material.opacity = opacity;
    material.depthWrite = opacity >= 0.995 && !ghost;
    material.needsUpdate = true;
  }
}

function toggleCoverageOverlay() {
  if (!state.coverage?.cells?.length) return;
  state.coverageVisible = !state.coverageVisible;
  coverageGroup.visible = state.coverageVisible;
  updateButtons();
}

function clearPaintedCoverageMarks() {
  state.manualSupports = state.manualSupports.filter((support) => support.source !== "paint_enforce" && support.source !== "paint_block");
  clearGeneratedSupport();
  updateManualMarkers();
}

function toggleManualSupportMode() {
  if (!state.modelMesh) return;
  state.manualSupportMode = !state.manualSupportMode;
  if (state.manualSupportMode) {
    state.supportPaintMode = "off";
  }
  modelStatus.textContent = state.manualSupportMode
    ? "Manual mark mode on; click the object to add marks, Alt-click a mark to remove it"
    : "Manual mark mode off";
  updateButtons();
}

function toggleOrientationHelper() {
  setOrientationHelper(!orientationHelperActive);
}

function setOrientationHelper(enabled) {
  orientationHelperActive = Boolean(enabled && state.modelMesh);
  transformControls.enabled = enabled;
  transformHelper.visible = orientationHelperActive;

  if (orientationHelperActive) {
    transformControls.setSpace("world");
    transformControls.attach(state.modelMesh);
    controlsEl.orientModel.textContent = "Done rotating";
    modelStatus.textContent = "Rotate helper active; rings stay aligned to global XYZ axes";
  } else {
    orientationHelperActive = false;
    transformControls.detach();
    transformControls.enabled = false;
    transformHelper.visible = false;
    controlsEl.orientModel.textContent = "Rotate helper";
  }
}

function resetOrientation() {
  if (!state.modelMesh) return;
  state.modelMesh.rotation.set(0, 0, 0);
  clearGeneratedSupport();
  clearCncFingerHoleMarks();
  clearCncPreview();
  applyElevation();
  updateManualMarkers();
  modelStatus.textContent = "Rotation reset";
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
  if (!confirmPrintCradleExportIfNeeded()) return;

  const stl = supportMeshToAsciiStl(state.supportMesh, "cradlemaker_support");
  downloadTextFile(stl, supportExportName("cradle", "stl"), "model/stl");
}

function exportSupportPly() {
  if (!state.supportMesh) return;
  if (!confirmPrintCradleExportIfNeeded()) return;

  const ply = supportMeshToAsciiPly(state.supportMesh);
  downloadTextFile(ply, supportExportName("cradle", "ply"), "model/ply");
}

function exportInterfaceStl() {
  if (!state.interfaceMesh) return;
  if (!confirmPrintCradleExportIfNeeded()) return;

  const stl = supportMeshToAsciiStl(state.interfaceMesh, "cradlemaker_interface");
  downloadTextFile(stl, supportExportName("interface", "stl"), "model/stl");
}

function exportInterfacePly() {
  if (!state.interfaceMesh) return;
  if (!confirmPrintCradleExportIfNeeded()) return;

  const ply = supportMeshToAsciiPly(state.interfaceMesh);
  downloadTextFile(ply, supportExportName("interface", "ply"), "model/ply");
}

function confirmPrintCradleExportIfNeeded() {
  if (state.printCradleSafety?.exportable) return true;
  const reason = state.printCradleSafety?.reason || "High accuracy has not been run for this cradle.";
  const confirmed = window.confirm(
    `Warning: ${reason}\n\nHigh accuracy checks are recommended before final printing to reduce the risk of model intersections or missed clearance.\n\nExport anyway?`
  );
  setJobStatus(
    confirmed
      ? `Print export continued after warning: ${reason}`
      : `Print export canceled: ${reason}`,
    confirmed ? "pending" : "error"
  );
  return confirmed;
}

function confirmSplitExportIfNeeded() {
  const plan = state.splitPlan;
  if (!plan) return true;
  const warnings = [];
  if (plan.qa?.intersects_model) {
    warnings.push(formatSplitQaStatus(plan.qa));
  }
  if (Number(plan.gapQa?.count ?? 0) > 0) {
    warnings.push(formatDovetailGapSpanQaStatus(plan.gapQa));
  }
  const oversizedCount = (plan.chunks ?? []).filter((chunk) => !chunk.fits).length;
  if (oversizedCount) {
    warnings.push(`${oversizedCount.toLocaleString()} split chunk${oversizedCount === 1 ? "" : "s"} exceed the selected build volume.`);
  }
  if (!warnings.length) return true;
  const confirmed = window.confirm(
    `Warning: split QA found possible issues:\n\n${warnings.join("\n\n")}\n\nExport split chunks anyway?`
  );
  setSplitStatus(
    confirmed
      ? `Split export continued after warning: ${warnings[0]}`
      : `Split export canceled: ${warnings[0]}`,
    confirmed ? "pending" : "error"
  );
  return confirmed;
}

function exportCncFoamStl() {
  if (!state.cncMesh) return;

  const stl = supportMeshToAsciiStl(state.cncMesh, "cradlemaker_cnc_foam_relief");
  downloadTextFile(stl, supportExportName("cnc-foam-relief", "stl"), "model/stl");
}

function exportCncSlabStls() {
  if (!state.cncSlabs?.length) return;
  const slabs = [...state.cncSlabs];
  setCncStatus(`Preparing ${slabs.length.toLocaleString()} CNC slab STL download${slabs.length === 1 ? "" : "s"}...`, "working");
  for (const [index, slab] of slabs.entries()) {
    window.setTimeout(() => {
      const stl = supportMeshToAsciiStl(slab.mesh, `cradlemaker_cnc_foam_${slab.id.toLowerCase()}`);
      downloadTextFile(stl, supportExportName(`cnc-foam-${slab.id.toLowerCase()}`, "stl"), "model/stl");
      if (index === slabs.length - 1) {
        setCncStatus(`Exported ${slabs.length.toLocaleString()} CNC slab STL${slabs.length === 1 ? "" : "s"}.`, "pending");
      }
    }, index * 180);
  }
}

function exportCncSlabManifest() {
  if (!state.cncSlabPlan) return;
  downloadTextFile(JSON.stringify(cncSlabManifest(), null, 2), supportExportName("cnc-slab-manifest", "json"), "application/json");
}

function cncSlabManifest() {
  const plan = state.cncSlabPlan;
  const qa = state.cncQa ?? {};
  return {
    version: 1,
    created_at: new Date().toISOString(),
    model: state.modelMesh?.name || "model",
    coordinate_mode: "local_slab_stl_with_manifest_offsets",
    block_mm: {
      width: qa.settings?.width,
      depth: qa.settings?.depth,
      height: qa.settings?.height,
    },
    clearance_mm: {
      xy: qa.clearance_xy_mm,
      z: qa.clearance_z_mm,
    },
    slab_settings: plan.settings,
    dowel_holes: (plan.dowelHoles ?? []).map((hole, index) => ({
      id: `D${index + 1}`,
      x_mm: roundedCoordinate(hole.x),
      y_mm: roundedCoordinate(hole.y),
      radius_mm: roundedCoordinate(hole.radiusMm),
      diameter_mm: roundedCoordinate(hole.radiusMm * 2),
      source: hole.source || "stack",
      island_slab_id: hole.slabId || null,
      island_component_id: Number.isFinite(hole.componentId) ? hole.componentId : null,
    })),
    qa: {
      slab_count: qa.slab_count,
      slab_through_cut_count: qa.slab_through_cut_count,
      dowel_valid: qa.dowel_valid,
      dowel_warning: qa.dowel_warning,
      min_wall_mm: qa.slab_min_wall_mm,
      slab_island_components: qa.slab_island_components,
      slab_island_dowels_added: qa.slab_island_dowels_added,
      slab_islands_omitted: qa.slab_islands_omitted,
      slab_island_cells_omitted: qa.slab_island_cells_omitted,
    },
    slabs: (plan.slabs ?? []).map((slab) => ({
      id: slab.id,
      filename_hint: supportExportName(`cnc-foam-${slab.id.toLowerCase()}`, "stl"),
      local_z_min_mm: 0,
      local_z_max_mm: slab.thickness_mm,
      stack_global_bottom_mm: slab.global_bottom_mm,
      top_depth_from_stack_top_mm: slab.top_depth_mm,
      bottom_depth_from_stack_top_mm: slab.bottom_depth_mm,
      through_cut_cells: slab.through_cut_cells,
      island_components: slab.island_components,
      culled_island_components: slab.culled_island_components,
      culled_island_cells: slab.culled_island_cells,
      triangle_count: slab.mesh?.triangle_count ?? 0,
    })),
  };
}

function exportSplitStls() {
  if (!state.splitChunks.length) return;
  if (!confirmPrintCradleExportIfNeeded()) return;
  if (!confirmSplitExportIfNeeded()) return;

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
