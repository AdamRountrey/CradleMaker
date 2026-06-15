let corePromise = null;

export async function loadCradlemakerCore() {
  if (!corePromise) {
    const wasmUrl = new URL("./wasm/cradlemaker-core.wasm?v=organic-voxel-1", import.meta.url).href;
    corePromise = import("./wasm/cradlemaker-core.js?v=organic-voxel-1")
      .then(async (module) => module.default({
        wasmBinary: await loadBinary(wasmUrl),
        locateFile: (path) => new URL(`./wasm/${path}?v=organic-voxel-1`, import.meta.url).href,
      }));
  }

  return corePromise;
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
  const core = await loadCradlemakerCore();
  return JSON.parse(core.supportOptionSchemaJson());
}

export async function prepareSupportJob(job) {
  const core = await loadCradlemakerCore();
  return JSON.parse(core.prepareSupportJobJson(JSON.stringify(job)));
}
