let corePromise = null;
let supportWorker = null;
let supportWorkerReady = false;
let supportWorkerFailed = false;
let nextSupportWorkerRequestId = 1;
let supportOptionSchemaPromise = null;
let supportCorePrewarmPromise = null;
const supportWorkerRequests = new Map();
const WASM_VERSION = "cradle-hires-1";
const SUPPORT_WORKER_VERSION = "cradle-hires-1";
const DEFAULT_WASM_BASENAME = "cradlemaker-core";
const PTHREAD_WASM_BASENAME = "cradlemaker-core-threaded";

export async function loadCradlemakerCore() {
  if (!corePromise) {
    const basename = preferredWasmBasename();
    const wasmUrl = new URL(`./wasm/${basename}.wasm?v=${WASM_VERSION}`, import.meta.url).href;
    const jsUrl = new URL(`./wasm/${basename}.js?v=${WASM_VERSION}`, import.meta.url).href;
    corePromise = import(jsUrl)
      .then(async (module) => module.default({
        wasmBinary: await loadBinary(wasmUrl),
        mainScriptUrlOrBlob: jsUrl,
        locateFile: (path) => new URL(`./wasm/${path.replace(DEFAULT_WASM_BASENAME, basename)}?v=${WASM_VERSION}`, import.meta.url).href,
      }));
  }

  return corePromise;
}

function preferredWasmBasename() {
  return canUsePthreadWasm() ? PTHREAD_WASM_BASENAME : DEFAULT_WASM_BASENAME;
}

export function activeWasmBasename() {
  return preferredWasmBasename();
}

function canUsePthreadWasm() {
  return Boolean(globalThis.crossOriginIsolated && typeof globalThis.SharedArrayBuffer === "function");
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
  if (canUseSupportWorker()) {
    try {
      return await prepareSupportJobInWorker(job);
    } catch (error) {
      console.warn("Support worker failed; falling back to in-page WASM.", error);
      supportWorkerFailed = true;
      terminateSupportWorker();
    }
  }

  return prepareSupportJobInPage(job);
}

async function prepareSupportJobInPage(job) {
  const core = await loadCradlemakerCore();
  const result = JSON.parse(core.prepareSupportJobJson(JSON.stringify(compactSupportJobForCore(job, { includeVertices: true }))));
  result._runtime = {
    worker: false,
    crossOriginIsolated: Boolean(globalThis.crossOriginIsolated),
    wasmBuild: activeWasmBasename(),
  };
  return result;
}

function canUseSupportWorker() {
  return typeof Worker === "function" && !supportWorkerFailed;
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
  const { workerJob, meshVertices, transfer } = prepareTransferableSupportJob(job);
  return requestSupportWorker("prepareSupportJob", { job: workerJob, meshVertices }, transfer);
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
  const worker = ensureSupportWorker();
  const id = nextSupportWorkerRequestId;
  nextSupportWorkerRequestId += 1;

  return new Promise((resolve, reject) => {
    supportWorkerRequests.set(id, { resolve, reject });
    try {
      worker.postMessage({ id, type, ...payload }, transfer);
    } catch (error) {
      supportWorkerRequests.delete(id);
      reject(error);
    }
  });
}
