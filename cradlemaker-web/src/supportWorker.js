import { activeWasmBasename, activeWasmInitialMemoryBytes, loadCradlemakerCore } from "./wasmCore.js?v=column-taper-7";

self.postMessage({ type: "ready" });

self.onmessage = async (event) => {
  const message = event.data ?? {};

  try {
    if (Array.isArray(message.initialMemoryCandidates)) {
      self.__CRADLEMAKER_WASM_MEMORY_CANDIDATES__ = message.initialMemoryCandidates
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0);
    }
    const core = await loadCradlemakerCore();
    if (message.type === "supportOptionSchema") {
      self.postMessage({
        id: message.id,
        type: "schema",
        schema: JSON.parse(core.supportOptionSchemaJson()),
        runtime: {
          worker: true,
          crossOriginIsolated: Boolean(self.crossOriginIsolated),
          wasmBuild: activeWasmBasename(),
          wasmInitialMemoryBytes: activeWasmInitialMemoryBytes(),
        },
      });
      return;
    }

    if (message.type !== "prepareSupportJob") return;

    const workerTimings = [];
    let phaseStart = performance.now();
    const markPhase = (label) => {
      const now = performance.now();
      workerTimings.push({ label, ms: now - phaseStart });
      phaseStart = now;
    };

    const useBufferedInput = message.meshVertices instanceof Float32Array &&
      typeof core.prepareSupportJobBufferedInputBinaryJson === "function" &&
      typeof core.allocateInputVertices === "function" &&
      typeof core.inputVerticesView === "function";
    if (useBufferedInput) {
      core.allocateInputVertices(message.meshVertices.length);
      core.inputVerticesView().set(message.meshVertices);
      markPhase("copy input");
    }
    const jobForCore = message.job;
    if (!useBufferedInput && message.meshVertices instanceof Float32Array && !jobForCore?.mesh?.vertices) {
      jobForCore.mesh.vertices = Array.from(message.meshVertices);
      markPhase("restore json input");
    }
    const useBinaryMeshResult = typeof core.prepareSupportJobBinaryJson === "function" &&
      typeof core.lastSupportVerticesView === "function";
    const resultJson = useBufferedInput
      ? core.prepareSupportJobBufferedInputBinaryJson(JSON.stringify(jobForCore))
      : useBinaryMeshResult
      ? core.prepareSupportJobBinaryJson(JSON.stringify(jobForCore))
      : core.prepareSupportJobJson(JSON.stringify(jobForCore));
    markPhase("core json");
    const result = JSON.parse(resultJson);
    markPhase("parse json");
    const transfer = [];
    if (useBinaryMeshResult) hydrateBinaryResultMeshes(core, result, transfer);
    else packResultMeshes(result, transfer);
    markPhase("pack transfer");
    self.postMessage({
      id: message.id,
      type: "result",
      result,
      runtime: {
        worker: true,
        crossOriginIsolated: Boolean(self.crossOriginIsolated),
        wasmBuild: activeWasmBasename(),
        wasmInitialMemoryBytes: activeWasmInitialMemoryBytes(),
        workerTimings,
      },
    }, transfer);
  } catch (error) {
    self.postMessage({
      id: message.id,
      type: "error",
      error: error?.message || String(error),
    });
  }
};

function hydrateBinaryResultMeshes(core, result, transfer) {
  hydrateBinaryMesh(
    result?.support_mesh,
    core.lastSupportVerticesView(),
    core.lastSupportTrianglesView(),
    transfer
  );
  hydrateBinaryMesh(
    result?.interface_mesh,
    core.lastInterfaceVerticesView(),
    core.lastInterfaceTrianglesView(),
    transfer
  );
}

function hydrateBinaryMesh(mesh, verticesView, trianglesView, transfer) {
  if (!mesh) return;
  mesh.vertices = new Float32Array(verticesView);
  mesh.triangles = new Uint32Array(trianglesView);
  mesh.vertex_count = Math.floor(mesh.vertices.length / 3);
  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  transfer.push(mesh.vertices.buffer, mesh.triangles.buffer);
}

function packResultMeshes(result, transfer) {
  packMesh(result?.support_mesh, transfer);
  packMesh(result?.interface_mesh, transfer);
}

function packMesh(mesh, transfer) {
  if (!mesh || !mesh.vertices || !mesh.triangles) return;
  mesh.vertices = mesh.vertices instanceof Float32Array
    ? mesh.vertices
    : new Float32Array(mesh.vertices);
  mesh.triangles = mesh.triangles instanceof Uint32Array
    ? mesh.triangles
    : new Uint32Array(mesh.triangles);
  mesh.vertex_count = Math.floor(mesh.vertices.length / 3);
  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
  transfer.push(mesh.vertices.buffer, mesh.triangles.buffer);
}
