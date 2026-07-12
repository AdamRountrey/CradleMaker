import assert from "node:assert/strict";

function boxMesh(min, max) {
  const vertices = new Float32Array([
    min[0], min[1], min[2],
    max[0], min[1], min[2],
    max[0], max[1], min[2],
    min[0], max[1], min[2],
    min[0], min[1], max[2],
    max[0], min[1], max[2],
    max[0], max[1], max[2],
    min[0], max[1], max[2],
  ]);
  const triangles = new Uint32Array([
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
  ]);
  return {
    vertices,
    triangles,
    vertex_count: vertices.length / 3,
    triangle_count: triangles.length / 3,
  };
}

const messages = [];
globalThis.self = {
  crossOriginIsolated: false,
  postMessage(message) {
    messages.push(message);
  },
};

await import(`../src/modelTrimWorker.js?test=${Date.now()}`);

const modelMesh = boxMesh([-5, -5, -5], [5, 5, 5]);
const supportMesh = {
  ...boxMesh([-5, -5, -6.22], [5, 5, -5.22]),
  cell_size_mm: 0.8,
};
const expectedVertices = new Float32Array(supportMesh.vertices);
const expectedTriangles = new Uint32Array(supportMesh.triangles);

await self.onmessage({
  data: {
    id: 1,
    type: "trimGeneratedMeshes",
    modelMesh,
    supportMesh,
    interfaceMesh: null,
    clearance: { xy_mm: 0.35, z_mm: 0.2 },
    clearanceKey: "certificate-worker-test",
    preferParallelManifold: false,
  },
});

const result = messages.find((message) => message.type === "trimResult");
assert.ok(result, messages.find((message) => message.type === "error")?.error || "missing trim result");
assert.equal(result.version, "object-clearance-worker-38");
assert.equal(result.trimmed, false);
assert.equal(result.certified, true);
assert.equal(result.skipped, true);
assert.equal(result.certificate?.passed, true);
assert.equal(result.pre_certificate?.passed, true);
assert.equal(result.post_certificate, null);
assert.equal(result.repair?.strategy, "certificate_preserved_original");
assert.equal(result.clearance?.analytic_certified, true);
assert.deepEqual(result.support_mesh.vertices, expectedVertices);
assert.deepEqual(result.support_mesh.triangles, expectedTriangles);

const progress = messages
  .filter((message) => message.type === "progress")
  .map((message) => message.message);
assert.ok(progress.includes("checking continuous ellipsoidal object clearance"));
assert.ok(progress.includes("continuous ellipsoidal clearance certificate passed"));
assert.ok(!progress.includes("building bounded expanded object clearance solid"));

console.log("model trim worker certificate integration test passed");
