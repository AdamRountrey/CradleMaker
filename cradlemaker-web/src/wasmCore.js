let corePromise = null;
let supportWorker = null;
let supportWorkerReady = false;
let supportWorkerFailed = false;
let nextSupportWorkerRequestId = 1;
let supportOptionSchemaPromise = null;
let supportCorePrewarmPromise = null;
const supportWorkerRequests = new Map();
const WASM_VERSION = "column-taper-7";
const SUPPORT_WORKER_VERSION = "column-taper-7";
const DEFAULT_WASM_BASENAME = "cradlemaker-core";
const PTHREAD_WASM_BASENAME = "cradlemaker-core-threaded";
const WASM_INITIAL_MEMORY_CANDIDATES = [
  536870912,
  1073741824,
  2147483648,
  3221225472,
];
const WASM_CORE_IMPORT_TIMEOUT_MS = 15000;
const WASM_CORE_INIT_TIMEOUT_MS = 12000;
const SUPPORT_WORKER_REQUEST_TIMEOUT_MS = 120000;
const ENABLE_SUPPORT_WASM_WORKER = true;
let selectedWasmInitialMemoryBytes = 0;

export async function loadCradlemakerCore() {
  if (!corePromise) {
    const basename = preferredWasmBasename();
    const wasmUrl = new URL(`./wasm/${basename}.wasm?v=${WASM_VERSION}`, import.meta.url).href;
    const jsUrl = new URL(`./wasm/${basename}.js?v=${WASM_VERSION}`, import.meta.url).href;
    recordWasmCoreDebug("load-start", { basename });
    corePromise = (async () => {
      recordWasmCoreDebug("import-start", { basename });
      const module = await withTimeout(
        import(jsUrl),
        WASM_CORE_IMPORT_TIMEOUT_MS,
        `CradleMaker WASM JS glue did not load within ${Math.round(WASM_CORE_IMPORT_TIMEOUT_MS / 1000)} seconds`
      );
      recordWasmCoreDebug("import-ready", { basename });
      return instantiateCoreWithMemoryFallback(module, { basename, wasmUrl, jsUrl });
    })()
      .catch((error) => {
        recordWasmCoreDebug("load-failed", { basename, error: error?.message || String(error) });
        corePromise = null;
        throw error;
      });
  } else {
    recordWasmCoreDebug("load-await-existing", { basename: preferredWasmBasename() });
  }

  return corePromise;
}

async function instantiateCoreWithMemoryFallback(module, { basename, wasmUrl, jsUrl }) {
  recordWasmCoreDebug("instantiate-start", { basename });
  const wasmBinary = await loadBinary(wasmUrl);
  let lastError = null;
  for (const initialMemory of wasmInitialMemoryCandidates()) {
    try {
      recordWasmCoreDebug("instantiate-attempt", { basename, initialMemory });
      const core = await withTimeout(
        module.default({
          INITIAL_MEMORY: initialMemory,
          wasmBinary,
          mainScriptUrlOrBlob: jsUrl,
          locateFile: (path) => new URL(`./wasm/${path.replace(DEFAULT_WASM_BASENAME, basename)}?v=${WASM_VERSION}`, import.meta.url).href,
        }),
        WASM_CORE_INIT_TIMEOUT_MS,
        `CradleMaker WASM core did not initialize within ${Math.round(WASM_CORE_INIT_TIMEOUT_MS / 1000)} seconds at ${formatMemoryForLog(initialMemory)} initial heap`
      );
      selectedWasmInitialMemoryBytes = initialMemory;
      recordWasmCoreDebug("instantiate-ready", { basename, initialMemory });
      return core;
    } catch (error) {
      lastError = error;
      recordWasmCoreDebug("instantiate-failed", { basename, initialMemory, error: error?.message || String(error) });
      console.warn(`CradleMaker WASM could not start with ${formatMemoryForLog(initialMemory)} initial heap; trying a smaller heap.`, error);
    }
  }
  throw lastError || new Error("CradleMaker WASM failed to start.");
}

function wasmInitialMemoryCandidates() {
  const override = globalThis.__CRADLEMAKER_WASM_MEMORY_CANDIDATES__;
  if (Array.isArray(override)) {
    const clean = override.map(Number).filter((value) => Number.isFinite(value) && value > 0);
    if (clean.length) return clean;
  }
  return WASM_INITIAL_MEMORY_CANDIDATES;
}

function recordWasmCoreDebug(stage, detail = {}) {
  try {
    const target = globalThis.__CRADLEMAKER_WASM_DEBUG__ ??= [];
    target.push({ stage, detail, at: Date.now(), worker: typeof globalThis.window === "undefined" });
    if (target.length > 50) target.splice(0, target.length - 50);
    globalThis.document?.documentElement?.setAttribute?.("data-cradlemaker-wasm-stage", stage);
    if (detail.basename) globalThis.document?.documentElement?.setAttribute?.("data-cradlemaker-wasm-basename", detail.basename);
    if (detail.initialMemory) globalThis.document?.documentElement?.setAttribute?.("data-cradlemaker-wasm-initial-memory", String(detail.initialMemory));
    if (detail.error) globalThis.document?.documentElement?.setAttribute?.("data-cradlemaker-wasm-error", detail.error);
  } catch {
    // Debug breadcrumbs must never affect generation.
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

function formatMemoryForLog(bytes) {
  const gb = Number(bytes) / (1024 * 1024 * 1024);
  return `${gb.toFixed(gb >= 1 ? 1 : 2)} GB`;
}

function preferredWasmBasename() {
  return canUsePthreadWasm() ? PTHREAD_WASM_BASENAME : DEFAULT_WASM_BASENAME;
}

export function activeWasmBasename() {
  return preferredWasmBasename();
}

export function activeWasmInitialMemoryBytes() {
  return selectedWasmInitialMemoryBytes || wasmInitialMemoryCandidates()[0];
}

function canUsePthreadWasm() {
  return false;
}

function loadBinary(url) {
  return fetchBinary(url).catch(() => xhrBinary(url));
}

async function fetchBinary(url) {
  if (typeof fetch !== "function") throw new Error("fetch unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Failed to load WASM binary (${response.status})`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

function xhrBinary(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", url, true);
    request.responseType = "arraybuffer";
    request.timeout = 15000;
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(new Uint8Array(request.response));
      } else {
        reject(new Error(`Failed to load WASM binary (${request.status})`));
      }
    };
    request.onerror = () => reject(new Error("Failed to load WASM binary"));
    request.ontimeout = () => reject(new Error("Timed out loading WASM binary"));
    request.send();
  });
}

export async function getSupportOptionSchema() {
  if (!supportOptionSchemaPromise) {
    supportOptionSchemaPromise = getSupportOptionSchemaUncached();
  }
  return supportOptionSchemaPromise;
}

async function getSupportOptionSchemaUncached() {
  if (canUseSupportWorker()) {
    try {
      return await requestSupportWorker("supportOptionSchema");
    } catch (error) {
      console.warn("Support worker schema load failed; falling back to in-page WASM.", error);
      supportWorkerFailed = true;
      terminateSupportWorker();
    }
  }

  const core = await loadCradlemakerCore();
  return JSON.parse(core.supportOptionSchemaJson());
}

export async function prewarmSupportCore() {
  if (!supportCorePrewarmPromise) {
    supportCorePrewarmPromise = getSupportOptionSchema()
      .then(() => true)
      .catch((error) => {
        console.warn("Support core prewarm failed.", error);
        return false;
      });
  }
  return supportCorePrewarmPromise;
}

export async function prepareSupportJob(job) {
  recordWasmCoreDebug("prepare-start", { canUseWorker: canUseSupportWorker() });
  if (canUseSupportWorker()) {
    try {
      recordWasmCoreDebug("prepare-worker-request");
      return await prepareSupportJobInWorker(job);
    } catch (error) {
      recordWasmCoreDebug("prepare-worker-failed", { error: error?.message || String(error) });
      console.warn("Support worker failed; falling back to in-page WASM.", error);
      supportWorkerFailed = true;
      terminateSupportWorker();
      if (isWasmRuntimeAbort(error)) throw error;
    }
  }

  recordWasmCoreDebug("prepare-in-page");
  return prepareSupportJobInPage(job);
}

export function resetSupportCoreRuntime() {
  terminateSupportWorker();
  supportWorkerFailed = false;
  supportWorkerReady = false;
  supportCorePrewarmPromise = null;
  supportOptionSchemaPromise = null;
  corePromise = null;
}

function isWasmRuntimeAbort(error) {
  const message = error?.message || String(error || "");
  return /Aborted|RuntimeError|memory|out of memory|worker terminated/i.test(message);
}

async function prepareSupportJobInPage(job) {
  const core = await loadCradlemakerCore();
  const vertices = job?.mesh?.vertices;
  const canUseBufferedInput = vertices &&
    typeof core.prepareSupportJobBufferedInputBinaryJson === "function" &&
    typeof core.allocateInputVertices === "function" &&
    typeof core.inputVerticesView === "function";
  const canUseBinaryResult = typeof core.prepareSupportJobBinaryJson === "function" &&
    typeof core.lastSupportVerticesView === "function";

  let result;
  if (canUseBufferedInput) {
    const meshVertices = vertices instanceof Float32Array
      ? vertices
      : new Float32Array(vertices);
    core.allocateInputVertices(meshVertices.length);
    core.inputVerticesView().set(meshVertices);
    result = JSON.parse(core.prepareSupportJobBufferedInputBinaryJson(JSON.stringify(compactSupportJobForCore(job, {
      includeVertices: false,
      binaryInput: "transferable_float32",
    }))));
  } else if (canUseBinaryResult) {
    result = JSON.parse(core.prepareSupportJobBinaryJson(JSON.stringify(compactSupportJobForCore(job, { includeVertices: true }))));
  } else {
    result = JSON.parse(core.prepareSupportJobJson(JSON.stringify(compactSupportJobForCore(job, { includeVertices: true }))));
  }
  if (canUseBinaryResult) hydrateBinaryResultMeshesInPage(core, result);
  result._runtime = {
    worker: false,
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    wasmBuild: activeWasmBasename(),
    wasmInitialMemoryBytes: activeWasmInitialMemoryBytes(),
  };
  return result;
}

function hydrateBinaryResultMeshesInPage(core, result) {
  hydrateBinaryMeshInPage(
    result?.support_mesh,
    core.lastSupportVerticesView(),
    core.lastSupportTrianglesView(),
  );
  hydrateBinaryMeshInPage(
    result?.interface_mesh,
    core.lastInterfaceVerticesView(),
    core.lastInterfaceTrianglesView(),
  );
}

function hydrateBinaryMeshInPage(mesh, verticesView, trianglesView) {
  if (!mesh) return;
  mesh.vertices = new Float32Array(verticesView);
  mesh.triangles = new Uint32Array(trianglesView);
  mesh.vertex_count = Math.floor(mesh.vertices.length / 3);
  mesh.triangle_count = Math.floor(mesh.triangles.length / 3);
}

function canUseSupportWorker() {
  return ENABLE_SUPPORT_WASM_WORKER && typeof Worker === "function" && !supportWorkerFailed;
}

function ensureSupportWorker() {
  if (supportWorker) return supportWorker;

  supportWorker = new Worker(new URL(`./supportWorker.js?v=${SUPPORT_WORKER_VERSION}`, import.meta.url), { type: "module" });
  supportWorker.onmessage = (event) => {
    const message = event.data ?? {};
    if (message.type === "ready") {
      supportWorkerReady = true;
      return;
    }

    const request = supportWorkerRequests.get(message.id);
    if (!request) return;
    supportWorkerRequests.delete(message.id);

    if (message.type === "schema") {
      request.resolve(message.schema);
    } else if (message.type === "result") {
      request.resolve({
        ...message.result,
        _runtime: {
          ...(message.runtime ?? {}),
          worker: true,
          crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
          wasmBuild: message.runtime?.wasmBuild ?? activeWasmBasename(),
        },
      });
    } else {
      request.reject(new Error(message.error || "Support worker failed"));
    }
  };
  supportWorker.onerror = (event) => {
    const error = new Error(event.message || "Support worker error");
    for (const request of supportWorkerRequests.values()) request.reject(error);
    supportWorkerRequests.clear();
    supportWorkerFailed = true;
    terminateSupportWorker();
  };

  return supportWorker;
}

function terminateSupportWorker() {
  supportWorker?.terminate();
  supportWorker = null;
  supportWorkerReady = false;
  for (const request of supportWorkerRequests.values()) {
    request.reject(new Error("Support worker terminated"));
  }
  supportWorkerRequests.clear();
}

function prepareSupportJobInWorker(job) {
  recordWasmCoreDebug("prepare-transfer-start");
  const { workerJob, meshVertices, transfer } = prepareTransferableSupportJob(job);
  recordWasmCoreDebug("prepare-transfer-ready", {
    vertexValues: meshVertices?.length ?? 0,
    transferBytes: transfer.reduce((sum, item) => sum + (item?.byteLength ?? 0), 0),
  });
  return requestSupportWorker("prepareSupportJob", { job: workerJob, meshVertices }, transfer);
}

export function prepareSupportJobInIsolatedWorker(job, options = {}) {
  const timeoutMs = Math.max(30000, Number(options.timeoutMs) || SUPPORT_WORKER_REQUEST_TIMEOUT_MS);
  const worker = new Worker(new URL(`./supportWorker.js?v=${SUPPORT_WORKER_VERSION}`, import.meta.url), { type: "module" });
  const { workerJob, meshVertices, transfer } = prepareTransferableSupportJob(job);
  const id = 1;
  const initialMemoryCandidates = Array.isArray(options.initialMemoryCandidates)
    ? options.initialMemoryCandidates.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : null;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error(`Isolated support worker did not respond within ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);

    worker.onmessage = (event) => {
      const message = event.data ?? {};
      if (message.type === "ready") return;
      if (message.id !== id) return;
      if (message.type === "result") {
        finish(resolve, {
          ...message.result,
          _runtime: {
            ...(message.runtime ?? {}),
            worker: true,
            isolatedWorker: true,
            crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
            wasmBuild: message.runtime?.wasmBuild ?? activeWasmBasename(),
          },
        });
      } else {
        finish(reject, new Error(message.error || "Isolated support worker failed"));
      }
    };
    worker.onerror = (event) => {
      finish(reject, new Error(event.message || "Isolated support worker error"));
    };

    worker.postMessage({ type: "prepareSupportJob", id, job: workerJob, meshVertices, initialMemoryCandidates }, transfer);
  });
}

function prepareTransferableSupportJob(job) {
  const vertices = job?.mesh?.vertices;
  if (!vertices) {
    return { workerJob: compactSupportJobForCore(job, { includeVertices: false }), meshVertices: null, transfer: [] };
  }

  const meshVertices = vertices instanceof Float32Array
    ? new Float32Array(vertices)
    : new Float32Array(vertices);
  const workerJob = compactSupportJobForCore(job, {
    includeVertices: false,
    binaryInput: "transferable_float32",
  });
  return { workerJob, meshVertices, transfer: [meshVertices.buffer] };
}

function compactSupportJobForCore(job, options = {}) {
  const includeVertices = Boolean(options.includeVertices);
  const mesh = job?.mesh ?? {};
  const compactMesh = {
    coordinate_space: mesh.coordinate_space,
    triangle_encoding: mesh.triangle_encoding,
    vertex_count: mesh.vertex_count,
    triangle_count: mesh.triangle_count,
  };

  if (options.binaryInput) {
    compactMesh.vertices = null;
    compactMesh.binary_input = options.binaryInput;
  } else if (includeVertices) {
    compactMesh.vertices = Array.from(mesh.vertices ?? []);
  } else {
    compactMesh.vertices = null;
  }

  return {
    version: job?.version ?? 1,
    mesh: compactMesh,
    support_config: job?.support_config ?? {},
    cradle_config: job?.cradle_config ?? {},
    manual_supports: job?.manual_supports ?? [],
  };
}

function requestSupportWorker(type, payload = {}, transfer = []) {
  recordWasmCoreDebug("support-worker-request-start", { type });
  const worker = ensureSupportWorker();
  const id = nextSupportWorkerRequestId;
  nextSupportWorkerRequestId += 1;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      supportWorkerRequests.delete(id);
      reject(new Error(`Support worker ${type} did not respond within ${Math.round(SUPPORT_WORKER_REQUEST_TIMEOUT_MS / 1000)} seconds`));
    }, SUPPORT_WORKER_REQUEST_TIMEOUT_MS);
    supportWorkerRequests.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    try {
      worker.postMessage({ id, type, ...payload }, transfer);
      recordWasmCoreDebug("support-worker-posted", { type, id });
    } catch (error) {
      supportWorkerRequests.delete(id);
      clearTimeout(timer);
      reject(error);
    }
  });
}
