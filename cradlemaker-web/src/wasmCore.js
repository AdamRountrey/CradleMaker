let corePromise = null;

export async function loadCradlemakerCore() {
  if (!corePromise) {
    corePromise = import("./wasm/cradlemaker-core.js?v=orca-wasm-40")
      .then((module) => module.default({
        locateFile: (path) => `./src/wasm/${path}?v=orca-wasm-40`,
      }));
  }

  return corePromise;
}

export async function getSupportOptionSchema() {
  const core = await loadCradlemakerCore();
  return JSON.parse(core.supportOptionSchemaJson());
}

export async function prepareSupportJob(job) {
  const core = await loadCradlemakerCore();
  return JSON.parse(core.prepareSupportJobJson(JSON.stringify(job)));
}
