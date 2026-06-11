import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { getSupportOptionSchema, prepareSupportJob } from "./wasmCore.js?v=orca-wasm-42";
import { defaultOrcaSupportConfig } from "./orcaSupportOptions.js?v=orca-wasm-42";

const SAMPLE_MODEL = "TruckAntennaMount1.stl";
const SAMPLE_MODEL_URLS = [
  `./samples/${SAMPLE_MODEL}`,
  `../samples/${SAMPLE_MODEL}`,
  `/samples/${SAMPLE_MODEL}`,
];
const BED_SIZE = 220;
const DEFAULT_SUPPORT_CONFIG = defaultOrcaSupportConfig();
const MESH_COORDINATE_PRECISION = 100000;

const viewport = document.querySelector("#viewport");
const modelStatus = document.querySelector("#model-status");
const supportStatus = document.querySelector("#support-status");
const jobStatus = document.querySelector("#job-status");

function setStartupStatus(message) {
  if (modelStatus) modelStatus.textContent = message;
  if (jobStatus) jobStatus.textContent = message;
}

setStartupStatus("Viewer module loaded; creating scene...");

const controlsEl = {
  file: document.querySelector("#model-file"),
  loadSample: document.querySelector("#load-sample"),
  toggleModelVisibility: document.querySelector("#toggle-model-visibility"),
  orientModel: document.querySelector("#orient-model"),
  resetOrientation: document.querySelector("#reset-orientation"),
  elevation: document.querySelector("#elevation"),
  enableSupport: document.querySelector("#enable-support"),
  supportType: document.querySelector("#support-type"),
  supportStyle: document.querySelector("#support-style"),
  supportBasePattern: document.querySelector("#support-base-pattern"),
  supportInterfacePattern: document.querySelector("#support-interface-pattern"),
  supportThresholdAngle: document.querySelector("#support-threshold-angle"),
  supportThresholdOverlap: document.querySelector("#support-threshold-overlap"),
  supportOnBuildPlateOnly: document.querySelector("#support-on-build-plate-only"),
  supportCriticalRegionsOnly: document.querySelector("#support-critical-regions-only"),
  supportRemoveSmallOverhang: document.querySelector("#support-remove-small-overhang"),
  supportTopZDistance: document.querySelector("#support-top-z-distance"),
  supportBottomZDistance: document.querySelector("#support-bottom-z-distance"),
  supportObjectXYDistance: document.querySelector("#support-object-xy-distance"),
  supportEdgeClearance: document.querySelector("#support-edge-clearance"),
  supportBasePatternSpacing: document.querySelector("#support-base-pattern-spacing"),
  interfaceEnabled: document.querySelector("#interface-enabled"),
  interfaceOptions: document.querySelector("#interface-options"),
  supportInterfaceTopLayers: document.querySelector("#support-interface-top-layers"),
  supportInterfaceBottomLayers: document.querySelector("#support-interface-bottom-layers"),
  supportInterfaceSpacing: document.querySelector("#support-interface-spacing"),
  supportBottomInterfaceSpacing: document.querySelector("#support-bottom-interface-spacing"),
  foamGapEnabled: document.querySelector("#foam-gap-enabled"),
  foamGapOptions: document.querySelector("#foam-gap-options"),
  foamGapZ: document.querySelector("#foam-gap-z"),
  foamGapXY: document.querySelector("#foam-gap-xy"),
  treeSupportBranchDistance: document.querySelector("#tree-support-branch-distance"),
  treeSupportTipDiameter: document.querySelector("#tree-support-tip-diameter"),
  treeSupportBranchDiameter: document.querySelector("#tree-support-branch-diameter"),
  treeSupportBranchAngle: document.querySelector("#tree-support-branch-angle"),
  treeSupportWallCount: document.querySelector("#tree-support-wall-count"),
  baseEnabled: document.querySelector("#base-enabled"),
  baseMargin: document.querySelector("#base-margin"),
  baseThickness: document.querySelector("#base-thickness"),
  generateSupports: document.querySelector("#generate-supports"),
  toggleCoverage: document.querySelector("#toggle-coverage"),
  clearManual: document.querySelector("#clear-manual"),
  exportStl: document.querySelector("#export-stl"),
  exportPly: document.querySelector("#export-ply"),
  exportInterfaceStl: document.querySelector("#export-interface-stl"),
  exportInterfacePly: document.querySelector("#export-interface-ply"),
  splitBuildWidth: document.querySelector("#split-build-width"),
  splitBuildDepth: document.querySelector("#split-build-depth"),
  splitBuildHeight: document.querySelector("#split-build-height"),
  splitBuildMargin: document.querySelector("#split-build-margin"),
  splitConnectorsEnabled: document.querySelector("#split-connectors-enabled"),
  splitConnectorClearance: document.querySelector("#split-connector-clearance"),
  splitConnectorSize: document.querySelector("#split-connector-size"),
  previewSplit: document.querySelector("#preview-split"),
  clearSplit: document.querySelector("#clear-split"),
  exportSplitStls: document.querySelector("#export-split-stls"),
  exportSplitManifest: document.querySelector("#export-split-manifest"),
  splitStatus: document.querySelector("#split-status"),
};

const outputs = {
  elevation: document.querySelector("#elevation-value"),
  supportThresholdAngle: document.querySelector("#support-threshold-angle-value"),
  supportTopZDistance: document.querySelector("#support-top-z-distance-value"),
  supportBottomZDistance: document.querySelector("#support-bottom-z-distance-value"),
  supportObjectXYDistance: document.querySelector("#support-object-xy-distance-value"),
  supportEdgeClearance: document.querySelector("#support-edge-clearance-value"),
  treeSupportBranchDistance: document.querySelector("#tree-support-branch-distance-value"),
  treeSupportBranchAngle: document.querySelector("#tree-support-branch-angle-value"),
  baseMargin: document.querySelector("#base-margin-value"),
  baseThickness: document.querySelector("#base-thickness-value"),
  splitBuildMargin: document.querySelector("#split-build-margin-value"),
  splitConnectorClearance: document.querySelector("#split-connector-clearance-value"),
  splitConnectorSize: document.querySelector("#split-connector-size-value"),
};

const state = {
  modelMesh: null,
  modelVisible: true,
  sourceGeometry: null,
  supportMesh: null,
  interfaceMesh: null,
  coverage: null,
  coverageVisible: false,
  splitChunks: [],
  splitPreviewVisible: false,
  splitPlan: null,
  manualSupports: [],
  supportMarkerObjects: new Map(),
  nextManualId: 1,
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
  applyElevation();
  updateManualMarkers();
});

const modelGroup = new THREE.Group();
const supportGroup = new THREE.Group();
const splitGroup = new THREE.Group();
const coverageGroup = new THREE.Group();
const markerGroup = new THREE.Group();
scene.add(modelGroup, supportGroup, splitGroup, coverageGroup, markerGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const loader = new STLLoader();

const materialModel = new THREE.MeshStandardMaterial({
  color: 0x6f91a2,
  roughness: 0.82,
  metalness: 0.02,
  transparent: true,
  opacity: 0.72,
  side: THREE.DoubleSide,
});

const materialSupport = new THREE.MeshStandardMaterial({
  color: 0x4fb286,
  roughness: 0.76,
  metalness: 0.02,
  transparent: true,
  opacity: 0.86,
  side: THREE.DoubleSide,
});

const materialInterface = new THREE.MeshStandardMaterial({
  color: 0xd6c35a,
  roughness: 0.68,
  metalness: 0.02,
  transparent: true,
  opacity: 0.9,
  side: THREE.DoubleSide,
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
updateOutputs();
updateButtons();
resize();
renderer.setAnimationLoop(render);
modelStatus.textContent = "Viewer ready; load or import a model";
setJobStatus("Support core will load when supports are generated.", "idle");

function bindControls() {
  controlsEl.file.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const buffer = await file.arrayBuffer();
    loadStlGeometry(loader.parse(buffer), file.name, buffer);
    controlsEl.file.value = "";
  });

  controlsEl.loadSample.addEventListener("click", () => loadSampleModel());
  controlsEl.toggleModelVisibility?.addEventListener("click", () => toggleModelVisibility());
  controlsEl.orientModel.addEventListener("click", () => toggleOrientationHelper());
  controlsEl.resetOrientation.addEventListener("click", () => resetOrientation());
  controlsEl.generateSupports.addEventListener("click", () => {
    void showWasmPending();
  });
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
  controlsEl.previewSplit?.addEventListener("click", () => previewSplitPlan());
  controlsEl.clearSplit?.addEventListener("click", () => clearSplitPreview());
  controlsEl.exportSplitStls?.addEventListener("click", () => exportSplitStls());
  controlsEl.exportSplitManifest?.addEventListener("click", () => exportSplitManifest());
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
    controlsEl.supportThresholdOverlap,
    controlsEl.supportTopZDistance,
    controlsEl.supportBottomZDistance,
    controlsEl.supportObjectXYDistance,
    controlsEl.supportEdgeClearance,
    controlsEl.supportBasePatternSpacing,
    controlsEl.supportInterfaceTopLayers,
    controlsEl.supportInterfaceBottomLayers,
    controlsEl.supportInterfaceSpacing,
    controlsEl.supportBottomInterfaceSpacing,
    controlsEl.foamGapZ,
    controlsEl.foamGapXY,
    controlsEl.treeSupportBranchDistance,
    controlsEl.treeSupportTipDiameter,
    controlsEl.treeSupportBranchDiameter,
    controlsEl.treeSupportBranchAngle,
    controlsEl.treeSupportWallCount,
    controlsEl.baseMargin,
    controlsEl.baseThickness,
    controlsEl.splitBuildWidth,
    controlsEl.splitBuildDepth,
    controlsEl.splitBuildHeight,
    controlsEl.splitBuildMargin,
    controlsEl.splitConnectorsEnabled,
    controlsEl.splitConnectorClearance,
    controlsEl.splitConnectorSize,
  ]) {
    input.addEventListener("input", () => {
      if (
        input === controlsEl.splitBuildWidth ||
        input === controlsEl.splitBuildDepth ||
        input === controlsEl.splitBuildHeight ||
        input === controlsEl.splitBuildMargin ||
        input === controlsEl.splitConnectorsEnabled ||
        input === controlsEl.splitConnectorClearance ||
        input === controlsEl.splitConnectorSize
      ) {
        clearSplitPreview();
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
    controlsEl.enableSupport,
    controlsEl.supportType,
    controlsEl.supportStyle,
    controlsEl.supportBasePattern,
    controlsEl.supportInterfacePattern,
    controlsEl.supportOnBuildPlateOnly,
    controlsEl.supportCriticalRegionsOnly,
    controlsEl.supportRemoveSmallOverhang,
    controlsEl.baseEnabled,
  ]) {
    input.addEventListener("change", () => {
      clearGeneratedSupport();
      updateButtons();
    });
  }
  syncOptionPanels();
  renderer.domElement.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("resize", resize);
}

function syncOptionPanels() {
  if (controlsEl.interfaceOptions && controlsEl.interfaceEnabled) {
    controlsEl.interfaceOptions.hidden = !controlsEl.interfaceEnabled.checked;
  }
  if (controlsEl.foamGapOptions && controlsEl.foamGapEnabled) {
    controlsEl.foamGapOptions.hidden = !controlsEl.foamGapEnabled.checked;
  }
}

async function loadSampleModel() {
  modelStatus.textContent = "Loading sample model...";
  const errors = [];

  try {
    for (const sampleUrl of SAMPLE_MODEL_URLS) {
      try {
        const response = await fetch(sampleUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`${sampleUrl}: HTTP ${response.status}`);

        const buffer = await response.arrayBuffer();
        if (!buffer.byteLength) throw new Error(`${sampleUrl}: empty response`);

        loadStlGeometry(loader.parse(buffer), SAMPLE_MODEL);
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

  geometry = geometry.toNonIndexed();
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  centerGeometryXY(geometry);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  state.sourceGeometry = geometry.clone();
  state.modelMesh = new THREE.Mesh(geometry, materialModel);
  state.modelMesh.name = label;
  state.modelVisible = true;
  state.modelMesh.visible = true;
  modelGroup.add(state.modelMesh);

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
  modelStatus.textContent = `${label} loaded`;
}

function clearSceneModel() {
  modelGroup.clear();
  supportGroup.clear();
  coverageGroup.clear();
  markerGroup.clear();
  state.modelMesh = null;
  state.modelVisible = true;
  state.sourceGeometry = null;
  state.supportMesh = null;
  state.interfaceMesh = null;
  state.coverage = null;
  state.coverageVisible = false;
  state.supportMarkerObjects.clear();
  setOrientationHelper(false);
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
  applyElevation();
}

function applyElevation() {
  if (!state.modelMesh) return;
  const box = new THREE.Box3().setFromObject(state.modelMesh);
  state.modelMesh.position.z += Number(controlsEl.elevation.value) - box.min.z;
  state.modelMesh.updateMatrixWorld(true);
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
  supportStatus.textContent = "Checking WASM core";
  controlsEl.generateSupports.disabled = true;
  controlsEl.generateSupports.textContent = "Checking core";

  try {
    const schema = await getSupportOptionSchema();
    const job = buildSupportJobPayload();
    const supportConfig = job.support_config;
    const cradleConfig = job.cradle_config;
    const manualCount = realizedManualSupports().length;
    const jobResult = await prepareSupportJob(job);
    renderGeneratedMeshes(jobResult.support_mesh, jobResult.interface_mesh);
    renderCoverageOverlay(jobResult.coverage);

    modelStatus.textContent = "Support job accepted by WASM";
    const supportTriangleCount = jobResult.support_mesh?.triangle_count ?? 0;
    const interfaceTriangleCount = jobResult.interface_mesh?.triangle_count ?? 0;
    const overhangFacetCount = jobResult.support?.overhang_facets ?? 0;
    const contactCellCount = jobResult.support?.contact_cells ?? 0;
    const envelopeCellCount = jobResult.support?.envelope_cells ?? 0;
    const prunedSparseCellCount = jobResult.support?.pruned_sparse_cells ?? 0;
    const prunedSmallIslandCellCount = jobResult.support?.pruned_small_island_cells ?? 0;
    const closedGapCount = jobResult.support?.closed_gap_cells ?? 0;
    const baseCellCount = jobResult.support?.base_cells ?? 0;
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
    const requestedOrcaTreeMode = Boolean(jobResult.support?.requested_orca_tree_mode);
    const realOrcaTreeAvailable = Boolean(jobResult.support?.real_orca_tree_available);
    const unsupportedCellCount = jobResult.coverage?.unsupported_cells ?? 0;
    const qa = jobResult.qa ?? {};
    const supportedDownwardPercent = Number(qa.supported_downward_percent ?? 0);
    const qaIntersectionText = qa.intersects_model
      ? `QA warning: ${Number(qa.intersection_cells ?? 0).toLocaleString()} possible model-intersection cells, max penetration ${formatStatusNumber(qa.max_penetration_mm ?? 0)} mm.`
      : "QA: no model intersections detected.";
    const qaCoverageText = `Approx. ${formatStatusNumber(supportedDownwardPercent)}% of lower/downward-facing sampled cells are supported (${Number(qa.supported_downward_cells ?? 0).toLocaleString()}/${Number(qa.downward_cells ?? 0).toLocaleString()}).`;
    const qaClearanceText = Number(qa.clearance_violation_cells ?? 0)
      ? `${Number(qa.clearance_violation_cells ?? 0).toLocaleString()} cells are inside the requested clearance by up to ${formatStatusNumber(qa.max_clearance_violation_mm ?? 0)} mm.`
      : "Requested clearance is respected within grid tolerance.";
    const orcaTreeText = requestedOrcaTreeMode && !realOrcaTreeAvailable
      ? "Real Orca organic tree support is not linked into WASM yet; generated the stable solid cradle fallback."
      : "";
    const totalTriangleCount = supportTriangleCount + interfaceTriangleCount;
    supportStatus.textContent = totalTriangleCount
      ? `${supportTriangleCount.toLocaleString()} cradle + ${interfaceTriangleCount.toLocaleString()} interface triangles`
      : `${manualCount} manual marks`;
    setJobStatus(
      totalTriangleCount
        ? `Generated a solid cradle from ${contactCellCount.toLocaleString()} contact cells, including ${envelopeCellCount.toLocaleString()} underside-envelope cells, ${prunedSparseCellCount.toLocaleString()} sparse side/contact cells pruned, ${prunedSmallIslandCellCount.toLocaleString()} tiny island cells removed, ${baseCellCount.toLocaleString()} footprint base cells, ${closedGapCount.toLocaleString()} closed gaps, ${unsupportedCellCount.toLocaleString()} unsupported coverage cells, ${overhangFacetCount.toLocaleString()} overhang facets, ${nativeManualCount.toLocaleString()} manual enforcers, ${treeMode ? `${treeBranchCount.toLocaleString()} organic display branches, ` : ""}${interfaceCellCount.toLocaleString()} soft-interface cells from ${interfaceLayers.toLocaleString()} interface layers, ${edgeRemovedCells.toLocaleString()} cells removed for a ${edgeClearance.toLocaleString()} mm support-free edge, and ${foamRemovedCells.toLocaleString()} cells removed for a ${foamGapZ.toLocaleString()} mm Z / ${foamGapXY.toLocaleString()} mm XY foam gap. ${orcaTreeText} ${qaIntersectionText} ${qaCoverageText} ${qaClearanceText} Prepared ${Object.keys(supportConfig).length}/${schema.length} Orca support settings and ${Object.keys(cradleConfig).length} cradle settings.`
        : `No support regions found. Prepared ${Object.keys(supportConfig).length}/${schema.length} Orca support settings and ${Object.keys(cradleConfig).length} cradle settings.`,
      qa.intersects_model ? "error" : "pending"
    );
  } catch (error) {
    modelStatus.textContent = "Cradlemaker WASM core not loaded";
    supportStatus.textContent = "Core load failed";
    setJobStatus(`WASM load failed: ${error.message}`, "error");
  } finally {
    controlsEl.generateSupports.textContent = "Generate supports";
    updateButtons();
  }
}

function renderGeneratedMeshes(supportMesh, interfaceMesh) {
  supportGroup.clear();
  clearSplitPreview();
  state.supportMesh = null;
  state.interfaceMesh = null;

  state.supportMesh = renderMeshPart(supportMesh, materialSupport, "Generated cradle solid");
  state.interfaceMesh = renderMeshPart(interfaceMesh, materialInterface, "Generated interface solid");
  updateButtons();
}

function renderMeshPart(supportMesh, material, name) {
  if (!supportMesh?.vertices?.length || !supportMesh?.triangles?.length) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(supportMesh.vertices), 3));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(supportMesh.triangles), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  supportGroup.add(mesh);

  return supportMesh;
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

function previewSplitPlan() {
  if (!state.supportMesh) return;

  const settings = splitSettings();
  const plan = buildDraftSplitPlan(state.supportMesh, settings);
  renderSplitChunks(plan);
  state.splitPlan = plan;
  state.splitChunks = plan.chunks;
  state.splitPreviewVisible = true;
  supportGroup.visible = false;

  const oversizedCount = plan.chunks.filter((chunk) => !chunk.fits).length;
  const chunkText = `${plan.chunks.length.toLocaleString()} chunk${plan.chunks.length === 1 ? "" : "s"}`;
  const connectorText = `${plan.connectors.length.toLocaleString()} Z-slide dovetail connector${plan.connectors.length === 1 ? "" : "s"}`;
  if (plan.chunks.length === 1 && oversizedCount === 0 && !plan.wasOversized) {
    setSplitStatus(`Cradle fits the selected build volume as one piece (${formatDimensions(plan.sourceBounds.size)}).`, "idle");
  } else if (oversizedCount > 0) {
    setSplitStatus(`Draft split made ${chunkText} with ${connectorText}, but ${oversizedCount.toLocaleString()} still exceed the usable build volume. Smaller margins or manual seam/capping support will be needed.`, "error");
  } else {
    setSplitStatus(`Draft split made ${chunkText} with ${connectorText}. Seam caps and hidden boolean-cut sockets are still future work.`, "pending");
  }

  updateButtons();
}

function clearSplitPreview() {
  splitGroup.clear();
  state.splitChunks = [];
  state.splitPlan = null;
  state.splitPreviewVisible = false;
  supportGroup.visible = true;
  setSplitStatus(state.supportMesh ? "Generate a split preview to check build-plate fit." : "Generate a cradle to check build-plate fit.", "idle");
  updateButtons();
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
    connectorsEnabled: controlsEl.splitConnectorsEnabled?.checked ?? true,
    connectorClearance,
    connectorSize,
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function buildDraftSplitPlan(mesh, settings) {
  const sourceBounds = supportMeshBounds(mesh);
  const countX = Math.max(1, Math.ceil(sourceBounds.size.x / settings.usableWidth));
  const countY = Math.max(1, Math.ceil(sourceBounds.size.y / settings.usableDepth));
  const countZ = Math.max(1, Math.ceil(sourceBounds.size.z / settings.usableHeight));
  const chunkSize = {
    x: sourceBounds.size.x / countX,
    y: sourceBounds.size.y / countY,
    z: sourceBounds.size.z / countZ,
  };
  const builders = new Map();
  const vertices = mesh.vertices ?? [];
  const triangles = mesh.triangles ?? [];

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const ia = triangles[index];
    const ib = triangles[index + 1];
    const ic = triangles[index + 2];
    const a = readSupportVertex(vertices, ia);
    const b = readSupportVertex(vertices, ib);
    const c = readSupportVertex(vertices, ic);
    const centroid = {
      x: (a.x + b.x + c.x) / 3,
      y: (a.y + b.y + c.y) / 3,
      z: (a.z + b.z + c.z) / 3,
    };
    const ix = clampIndex(Math.floor((centroid.x - sourceBounds.min.x) / Math.max(chunkSize.x, 0.0001)), countX);
    const iy = clampIndex(Math.floor((centroid.y - sourceBounds.min.y) / Math.max(chunkSize.y, 0.0001)), countY);
    const iz = clampIndex(Math.floor((centroid.z - sourceBounds.min.z) / Math.max(chunkSize.z, 0.0001)), countZ);
    const key = `${ix}:${iy}:${iz}`;
    let builder = builders.get(key);
    if (!builder) {
      builder = { ix, iy, iz, vertices: [], triangles: [], vertexMap: new Map() };
      builders.set(key, builder);
    }
    appendTriangleToChunk(builder, vertices, ia, ib, ic);
  }

  const chunks = [...builders.values()]
    .map((builder, index) => finalizeChunk(builder, index, settings))
    .sort((a, b) => a.id.localeCompare(b.id));
  const connectors = settings.connectorsEnabled ? addZSlideDovetails(chunks, sourceBounds, settings) : [];

  return {
    createdAt: new Date().toISOString(),
    settings,
    sourceBounds,
    grid: { x: countX, y: countY, z: countZ },
    wasOversized: sourceBounds.size.x > settings.usableWidth || sourceBounds.size.y > settings.usableDepth || sourceBounds.size.z > settings.usableHeight,
    chunks,
    connectors,
    method: "draft-centroid-partition",
    warning: "Draft split partitions existing mesh triangles. Seam caps and boolean-cut watertightness are not implemented yet. Z-slide dovetails are additive external connector hardware.",
  };
}

function clampIndex(index, count) {
  return Math.max(0, Math.min(count - 1, index));
}

function appendTriangleToChunk(builder, sourceVertices, ia, ib, ic) {
  const a = appendVertexToChunk(builder, sourceVertices, ia);
  const b = appendVertexToChunk(builder, sourceVertices, ib);
  const c = appendVertexToChunk(builder, sourceVertices, ic);
  builder.triangles.push(a, b, c);
}

function appendVertexToChunk(builder, sourceVertices, sourceIndex) {
  const cached = builder.vertexMap.get(sourceIndex);
  if (cached !== undefined) return cached;
  const offset = sourceIndex * 3;
  const targetIndex = builder.vertices.length / 3;
  builder.vertices.push(sourceVertices[offset] ?? 0, sourceVertices[offset + 1] ?? 0, sourceVertices[offset + 2] ?? 0);
  builder.vertexMap.set(sourceIndex, targetIndex);
  return targetIndex;
}

function finalizeChunk(builder, index, settings) {
  const mesh = {
    vertices: builder.vertices,
    triangles: builder.triangles,
    triangle_count: Math.floor(builder.triangles.length / 3),
  };
  const bounds = supportMeshBounds(mesh);
  const fits = bounds.size.x <= settings.usableWidth + 0.001 && bounds.size.y <= settings.usableDepth + 0.001 && bounds.size.z <= settings.usableHeight + 0.001;
  return {
    id: `P${String(index + 1).padStart(2, "0")}`,
    grid: { x: builder.ix, y: builder.iy, z: builder.iz },
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

function addZSlideDovetails(chunks, sourceBounds, settings) {
  const byGrid = new Map(chunks.map((chunk) => [`${chunk.grid.x}:${chunk.grid.y}:${chunk.grid.z}`, chunk]));
  const connectors = [];
  const zRange = connectorZRange(sourceBounds, settings);
  if (!zRange) return connectors;

  for (const chunk of chunks) {
    const right = byGrid.get(`${chunk.grid.x + 1}:${chunk.grid.y}:${chunk.grid.z}`);
    if (right) {
      connectors.push(addZSlideDovetailPair(chunk, right, "x", sourceBounds, settings, zRange, connectors.length + 1));
    }
    const back = byGrid.get(`${chunk.grid.x}:${chunk.grid.y + 1}:${chunk.grid.z}`);
    if (back) {
      connectors.push(addZSlideDovetailPair(chunk, back, "y", sourceBounds, settings, zRange, connectors.length + 1));
    }
  }

  for (const chunk of chunks) {
    chunk.mesh.triangle_count = Math.floor(chunk.mesh.triangles.length / 3);
    chunk.bounds = supportMeshBounds(chunk.mesh);
    chunk.fits = chunk.bounds.size.x <= settings.usableWidth + 0.001 && chunk.bounds.size.y <= settings.usableDepth + 0.001 && chunk.bounds.size.z <= settings.usableHeight + 0.001;
  }

  return connectors;
}

function connectorZRange(sourceBounds, settings) {
  const minHeight = Math.max(6, settings.connectorSize * 1.35);
  const bottom = sourceBounds.min.z + 1;
  const maxTop = sourceBounds.max.z - 2;
  const preferredHeight = Math.max(minHeight, Math.min(55, sourceBounds.size.z * 0.62));
  const top = Math.min(maxTop, bottom + preferredHeight);
  if (top - bottom < minHeight) return null;
  return { min: bottom, max: top };
}

function addZSlideDovetailPair(maleChunk, femaleChunk, axis, sourceBounds, settings, zRange, index) {
  const size = settings.connectorSize;
  const clearance = settings.connectorClearance;
  const wall = Math.max(1.2, size * 0.24);
  const head = size;
  const neck = size * 0.58;
  const projection = size * 1.35;
  const anchor = size * 0.8;
  const label = `D${String(index).padStart(2, "0")}`;

  if (axis === "x") {
    const seam = (maleChunk.bounds.max.x + femaleChunk.bounds.min.x) / 2;
    const pairMaxY = Math.max(maleChunk.bounds.max.y, femaleChunk.bounds.max.y);
    const pairDepth = Math.max(maleChunk.bounds.size.y, femaleChunk.bounds.size.y);
    const yBase = pairMaxY - Math.min(anchor * 0.65, Math.max(0, pairDepth * 0.08));
    const yTip = pairMaxY + projection;
    const yBack = yTip + clearance + wall;
    appendBoxToMesh(maleChunk.mesh, { x: seam - anchor, y: yBase - anchor, z: zRange.min }, { x: seam, y: yTip, z: zRange.max });
    appendVerticalPrismToMesh(maleChunk.mesh, [
      { x: seam - neck / 2, y: yBase },
      { x: seam + neck / 2, y: yBase },
      { x: seam + head / 2, y: yTip },
      { x: seam - head / 2, y: yTip },
    ], zRange.min, zRange.max);
    appendBoxToMesh(femaleChunk.mesh, { x: seam, y: yBase - anchor, z: zRange.min }, { x: seam + anchor, y: yBack, z: zRange.max });
    appendBoxToMesh(femaleChunk.mesh, { x: seam - head / 2 - clearance - wall, y: yBase - clearance, z: zRange.min }, { x: seam - head / 2 - clearance, y: yBack, z: zRange.max });
    appendBoxToMesh(femaleChunk.mesh, { x: seam + head / 2 + clearance, y: yBase - clearance, z: zRange.min }, { x: seam + head / 2 + clearance + wall, y: yBack, z: zRange.max });
    appendBoxToMesh(femaleChunk.mesh, { x: seam - head / 2 - clearance - wall, y: yTip + clearance, z: zRange.min }, { x: seam + head / 2 + clearance + wall, y: yBack, z: zRange.max });
  } else {
    const seam = (maleChunk.bounds.max.y + femaleChunk.bounds.min.y) / 2;
    const pairMaxX = Math.max(maleChunk.bounds.max.x, femaleChunk.bounds.max.x);
    const pairWidth = Math.max(maleChunk.bounds.size.x, femaleChunk.bounds.size.x);
    const xBase = pairMaxX - Math.min(anchor * 0.65, Math.max(0, pairWidth * 0.08));
    const xTip = pairMaxX + projection;
    const xBack = xTip + clearance + wall;
    appendBoxToMesh(maleChunk.mesh, { x: xBase - anchor, y: seam - anchor, z: zRange.min }, { x: xTip, y: seam, z: zRange.max });
    appendVerticalPrismToMesh(maleChunk.mesh, [
      { x: xBase, y: seam - neck / 2 },
      { x: xBase, y: seam + neck / 2 },
      { x: xTip, y: seam + head / 2 },
      { x: xTip, y: seam - head / 2 },
    ], zRange.min, zRange.max);
    appendBoxToMesh(femaleChunk.mesh, { x: xBase - anchor, y: seam, z: zRange.min }, { x: xBack, y: seam + anchor, z: zRange.max });
    appendBoxToMesh(femaleChunk.mesh, { x: xBase - clearance, y: seam - head / 2 - clearance - wall, z: zRange.min }, { x: xBack, y: seam - head / 2 - clearance, z: zRange.max });
    appendBoxToMesh(femaleChunk.mesh, { x: xBase - clearance, y: seam + head / 2 + clearance, z: zRange.min }, { x: xBack, y: seam + head / 2 + clearance + wall, z: zRange.max });
    appendBoxToMesh(femaleChunk.mesh, { x: xTip + clearance, y: seam - head / 2 - clearance - wall, z: zRange.min }, { x: xBack, y: seam + head / 2 + clearance + wall, z: zRange.max });
  }

  return {
    id: label,
    type: "external-z-slide-dovetail",
    axis,
    slide_axis: "z",
    male_chunk: maleChunk.id,
    female_chunk: femaleChunk.id,
    clearance_mm: clearance,
    nominal_size_mm: size,
    z_range_mm: { min: roundedCoordinate(zRange.min), max: roundedCoordinate(zRange.max) },
  };
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

function appendVerticalPrismToMesh(mesh, points, zMin, zMax) {
  if (points.length < 3 || zMax - zMin <= 0.001) return;
  const start = mesh.vertices.length / 3;
  for (const point of points) mesh.vertices.push(point.x, point.y, zMin);
  for (const point of points) mesh.vertices.push(point.x, point.y, zMax);
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

function renderSplitChunks(plan) {
  splitGroup.clear();
  for (const [index, chunk] of plan.chunks.entries()) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(chunk.mesh.vertices), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(chunk.mesh.triangles), 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const material = new THREE.MeshStandardMaterial({
      color: splitPalette[index % splitPalette.length],
      roughness: 0.76,
      metalness: 0.02,
      transparent: true,
      opacity: chunk.fits ? 0.9 : 0.62,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${chunk.id} draft split chunk`;
    splitGroup.add(mesh);
  }
}

function formatDimensions(size) {
  return `${formatStatusNumber(size.x)} x ${formatStatusNumber(size.y)} x ${formatStatusNumber(size.z)} mm`;
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
  const geometry = state.sourceGeometry ?? state.modelMesh.geometry;
  const positionAttribute = geometry.getAttribute("position");
  const vertices = [];
  const vertex = new THREE.Vector3();

  if (!positionAttribute) {
    return {
      coordinate_space: "world_mm",
      triangle_encoding: "nonindexed_triplets",
      vertex_count: 0,
      triangle_count: 0,
      vertices,
    };
  }

  for (let index = 0; index < positionAttribute.count; index += 1) {
    vertex.fromBufferAttribute(positionAttribute, index).applyMatrix4(state.modelMesh.matrixWorld);
    vertices.push(
      roundedCoordinate(vertex.x),
      roundedCoordinate(vertex.y),
      roundedCoordinate(vertex.z)
    );
  }

  return {
    coordinate_space: "world_mm",
    triangle_encoding: "nonindexed_triplets",
    vertex_count: positionAttribute.count,
    triangle_count: Math.floor(positionAttribute.count / 3),
    vertices,
  };
}

function roundedCoordinate(value) {
  return Math.round(value * MESH_COORDINATE_PRECISION) / MESH_COORDINATE_PRECISION;
}

function formatStatusNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function collectSupportConfig() {
  const interfaceEnabled = Boolean(controlsEl.interfaceEnabled?.checked);
  const foamGapEnabled = Boolean(controlsEl.foamGapEnabled?.checked);

  return {
    ...DEFAULT_SUPPORT_CONFIG,
    enable_support: controlsEl.enableSupport.checked,
    support_interface_enabled: interfaceEnabled,
    foam_gap_enabled: foamGapEnabled,
    support_type: controlsEl.supportType.value,
    support_style: controlsEl.supportStyle.value,
    support_base_pattern: controlsEl.supportBasePattern.value,
    support_interface_pattern: controlsEl.supportInterfacePattern.value,
    support_threshold_angle: Number(controlsEl.supportThresholdAngle.value),
    support_threshold_overlap: controlsEl.supportThresholdOverlap.value,
    support_on_build_plate_only: controlsEl.supportOnBuildPlateOnly.checked,
    support_critical_regions_only: controlsEl.supportCriticalRegionsOnly.checked,
    support_remove_small_overhang: controlsEl.supportRemoveSmallOverhang.checked,
    support_top_z_distance: Number(controlsEl.supportTopZDistance.value),
    support_bottom_z_distance: Number(controlsEl.supportBottomZDistance.value),
    support_object_xy_distance: Number(controlsEl.supportObjectXYDistance.value),
    support_edge_clearance_mm: Number(controlsEl.supportEdgeClearance.value),
    support_base_pattern_spacing: Number(controlsEl.supportBasePatternSpacing.value),
    support_interface_top_layers: interfaceEnabled ? Number(controlsEl.supportInterfaceTopLayers.value) : 0,
    support_interface_bottom_layers: Number(controlsEl.supportInterfaceBottomLayers.value),
    support_interface_spacing: Number(controlsEl.supportInterfaceSpacing.value),
    support_bottom_interface_spacing: Number(controlsEl.supportBottomInterfaceSpacing.value),
    foam_gap_z_mm: foamGapEnabled ? Number(controlsEl.foamGapZ.value) : 0,
    foam_gap_xy_mm: foamGapEnabled ? Number(controlsEl.foamGapXY.value) : 0,
    tree_support_branch_distance: Number(controlsEl.treeSupportBranchDistance.value),
    tree_support_tip_diameter: Number(controlsEl.treeSupportTipDiameter.value),
    tree_support_branch_diameter: Number(controlsEl.treeSupportBranchDiameter.value),
    tree_support_branch_angle: Number(controlsEl.treeSupportBranchAngle.value),
    tree_support_wall_count: Number(controlsEl.treeSupportWallCount.value),
  };
}

function collectCradleConfig() {
  return {
    base_enabled: controlsEl.baseEnabled.checked,
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
  if (!state.supportMesh && !state.interfaceMesh && !state.coverage && supportGroup.children.length === 0 && splitGroup.children.length === 0 && coverageGroup.children.length === 0) return;
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
  supportGroup.visible = true;
  setSplitStatus("Generate a cradle to check build-plate fit.", "idle");
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
  outputs.supportBottomZDistance.textContent = `${controlsEl.supportBottomZDistance.value} mm`;
  outputs.supportObjectXYDistance.textContent = `${controlsEl.supportObjectXYDistance.value} mm`;
  outputs.supportEdgeClearance.textContent = `${controlsEl.supportEdgeClearance.value} mm`;
  outputs.treeSupportBranchDistance.textContent = `${controlsEl.treeSupportBranchDistance.value} mm`;
  outputs.treeSupportBranchAngle.textContent = `${controlsEl.treeSupportBranchAngle.value} deg`;
  outputs.baseMargin.textContent = `${controlsEl.baseMargin.value} mm`;
  outputs.baseThickness.textContent = `${controlsEl.baseThickness.value} mm`;
  outputs.splitBuildMargin.textContent = `${controlsEl.splitBuildMargin.value} mm`;
  outputs.splitConnectorClearance.textContent = `${controlsEl.splitConnectorClearance.value} mm`;
  outputs.splitConnectorSize.textContent = `${controlsEl.splitConnectorSize.value} mm`;
}

function updateButtons() {
  const hasModel = Boolean(state.modelMesh);
  const supportCount = state.manualSupports.length;
  const generatedSupportTriangles = state.supportMesh?.triangle_count ?? 0;
  const generatedInterfaceTriangles = state.interfaceMesh?.triangle_count ?? 0;
  if (controlsEl.toggleModelVisibility) {
    controlsEl.toggleModelVisibility.disabled = !hasModel;
    controlsEl.toggleModelVisibility.textContent = state.modelVisible ? "Hide model" : "Show model";
  }
  controlsEl.orientModel.disabled = !hasModel;
  controlsEl.resetOrientation.disabled = !hasModel;
  controlsEl.generateSupports.disabled = !hasModel;
  if (controlsEl.toggleCoverage) {
    controlsEl.toggleCoverage.disabled = !state.coverage?.cells?.length;
    controlsEl.toggleCoverage.textContent = state.coverageVisible ? "Hide coverage" : "Show coverage";
  }
  controlsEl.clearManual.disabled = !state.manualSupports.length;
  controlsEl.exportStl.disabled = generatedSupportTriangles === 0;
  if (controlsEl.exportPly) controlsEl.exportPly.disabled = generatedSupportTriangles === 0;
  if (controlsEl.exportInterfaceStl) controlsEl.exportInterfaceStl.disabled = generatedInterfaceTriangles === 0;
  if (controlsEl.exportInterfacePly) controlsEl.exportInterfacePly.disabled = generatedInterfaceTriangles === 0;
  if (controlsEl.previewSplit) controlsEl.previewSplit.disabled = generatedSupportTriangles === 0;
  if (controlsEl.clearSplit) controlsEl.clearSplit.disabled = !state.splitPreviewVisible;
  if (controlsEl.exportSplitStls) controlsEl.exportSplitStls.disabled = !state.splitChunks.length;
  if (controlsEl.exportSplitManifest) controlsEl.exportSplitManifest.disabled = !state.splitChunks.length;
  const totalGeneratedTriangles = generatedSupportTriangles + generatedInterfaceTriangles;
  supportStatus.textContent = totalGeneratedTriangles
    ? `${generatedSupportTriangles.toLocaleString()} cradle + ${generatedInterfaceTriangles.toLocaleString()} interface triangles`
    : `${supportCount} manual marks`;
}

function setJobStatus(message, stateName = "idle") {
  jobStatus.textContent = message;
  jobStatus.dataset.state = stateName;
}

function setSplitStatus(message, stateName = "idle") {
  if (!controlsEl.splitStatus) return;
  controlsEl.splitStatus.textContent = message;
  controlsEl.splitStatus.dataset.state = stateName;
}

function toggleModelVisibility() {
  if (!state.modelMesh) return;
  state.modelVisible = !state.modelVisible;
  state.modelMesh.visible = state.modelVisible;
  updateButtons();
}

function toggleCoverageOverlay() {
  if (!state.coverage?.cells?.length) return;
  state.coverageVisible = !state.coverageVisible;
  coverageGroup.visible = state.coverageVisible;
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
  applyElevation();
  updateManualMarkers();
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

function exportSplitStls() {
  if (!state.splitChunks.length) return;

  const chunks = [...state.splitChunks];
  setSplitStatus(`Preparing ${chunks.length.toLocaleString()} chunk STL download${chunks.length === 1 ? "" : "s"}...`, "working");
  for (const [index, chunk] of chunks.entries()) {
    window.setTimeout(() => {
      const stl = supportMeshToAsciiStl(chunk.mesh, `cradlemaker_${chunk.id.toLowerCase()}`);
      downloadTextFile(stl, supportExportName(`cradle-${chunk.id.toLowerCase()}`, "stl"), "model/stl");
      if (index === chunks.length - 1) {
        setSplitStatus(`Exported ${chunks.length.toLocaleString()} draft chunk STL${chunks.length === 1 ? "" : "s"}.`, "pending");
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
      type: "external-z-slide-dovetail",
      clearance_mm: plan.settings.connectorClearance,
      nominal_size_mm: plan.settings.connectorSize,
      count: plan.connectors.length,
    },
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
      "Replace draft centroid partition with watertight boolean cuts.",
      "Add keyed dovetail or puzzle connectors outside protected model-contact surfaces.",
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
