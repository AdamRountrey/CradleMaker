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

function lPrismMesh(zMin, zMax) {
  const footprint = [
    [-5, -5],
    [5, -5],
    [5, -3],
    [-3, -3],
    [-3, 5],
    [-5, 5],
  ];
  const vertices = new Float32Array([
    ...footprint.flatMap(([x, y]) => [x, y, zMin]),
    ...footprint.flatMap(([x, y]) => [x, y, zMax]),
  ]);
  const triangles = [
    0, 3, 1, 1, 3, 2, 0, 5, 3, 3, 5, 4,
    6, 7, 9, 7, 8, 9, 6, 9, 11, 9, 10, 11,
  ];
  for (let index = 0; index < footprint.length; index += 1) {
    const next = (index + 1) % footprint.length;
    triangles.push(index, next, next + 6, index, next + 6, index + 6);
  }
  return {
    vertices,
    triangles: new Uint32Array(triangles),
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

const workerModule = await import(`../src/modelTrimWorker.js?targeted-test=${Date.now()}`);

const repeatedWitness = {
  target_face_centroid_mm: [10, 20, 30],
};
const distinctWitness = {
  target_face_centroid_mm: [15, 20, 30],
};
const overlappingWitness = {
  target_face_centroid_mm: [12, 20, 30],
};
const failedTarget = {
  label: "cradle",
  witness: repeatedWitness,
  witnesses: [
    repeatedWitness,
    { ...repeatedWitness },
    overlappingWitness,
    distinctWitness,
  ],
};
assert.deepEqual(
  workerModule.selectLocalizedWitnessGroup(failedTarget, 6),
  [repeatedWitness, distinctWitness]
);
assert.deepEqual(
  workerModule.selectLocalizedWitnessGroup(failedTarget, 6),
  [repeatedWitness, distinctWitness],
  "a new certificate pass must be allowed to revisit the same target cells"
);
assert.deepEqual(
  workerModule.selectLocalizedWitnessGroup(failedTarget, 1),
  [repeatedWitness]
);

await self.onmessage({
  data: {
    id: 1,
    type: "trimGeneratedMeshes",
    modelMesh: lPrismMesh(-5, 5),
    supportMesh: {
      ...boxMesh([-4.5, -4.5, -2], [-1.5, -1.5, 2]),
      cell_size_mm: 0.4,
    },
    interfaceMesh: {
      ...boxMesh([4.9, -4.8, -2], [6, -3.2, 2]),
      cell_size_mm: 0.4,
    },
    clearance: { xy_mm: 0.35, z_mm: 0.2 },
    clearanceKey: "targeted-worker-test",
    preferParallelManifold: false,
    debug: {
      targeted_minkowski: true,
      kernel_mode: "circumscribed",
      targeted_batch_size: 500,
    },
  },
});

const result = messages.find((message) => message.type === "trimResult");
assert.ok(result, messages.find((message) => message.type === "error")?.error || "missing trim result");
assert.equal(result.version, "object-clearance-worker-38");
assert.equal(result.trimmed, true);
assert.equal(result.pre_certificate?.passed, false);
assert.equal(result.kernel?.mode, "circumscribed");
assert.equal(result.kernel?.continuous_clearance_guaranteed, true);
assert.ok(result.kernel?.unit_inradius > 0 && result.kernel?.unit_inradius < 1);
assert.ok(result.kernel?.circumscription_scale > 1);
assert.equal(result.repair?.targeted_requested, true);
assert.equal(result.repair?.strategy, "targeted_minkowski");
assert.equal(result.repair?.targeted_applied, true);
assert.ok(result.repair?.source_faces > 0);
assert.ok(result.repair?.aabb_candidate_faces > 0);
assert.ok(result.repair?.candidate_faces > 0);
assert.ok(result.repair?.candidate_faces <= result.repair?.aabb_candidate_faces);
assert.ok(result.repair?.candidate_faces <= result.repair?.source_faces);
assert.equal(result.runtime?.targeted_api, true);
assert.equal(result.runtime?.multi_witness_api, true);
assert.equal(result.runtime?.selected_targeted, true);
assert.equal(result.runtime?.targeted_build, "o3");
assert.ok(result.runtime?.wasm_memory_bytes >= 16 * 1024 * 1024);
assert.equal(result.repair?.stream_batch_size_requested, 500);
assert.ok(result.repair?.stream_batch_attempts > 0);
assert.equal(result.repair?.stream_retried_batches, 0);
assert.equal(
  result.repair?.stream_successful_batches,
  result.repair?.stream_batch_attempts
);
assert.ok(result.repair?.stream_peak_wasm_memory_bytes >= 16 * 1024 * 1024);
for (const batch of result.repair?.streaming_batches ?? []) {
  assert.equal(batch.status, "NoError");
  assert.ok(Number.isFinite(batch.hull_union_ms) && batch.hull_union_ms >= 0);
  assert.ok(
    Number.isFinite(batch.target_difference_ms) && batch.target_difference_ms >= 0
  );
  assert.ok(batch.wasm_memory_bytes >= 16 * 1024 * 1024);
  assert.ok(Number.isInteger(batch.remaining_target_triangles));
}
assert.equal(result.post_certificate?.available, true);
assert.equal(result.post_certificate?.passed, true, result.post_certificate?.reason);
assert.ok(result.support_mesh?.triangles?.length > 0);
assert.ok(Array.from(result.support_mesh.vertices).every(Number.isFinite));
assert.ok(result.interface_mesh?.triangles?.length > 0);
assert.ok(Array.from(result.interface_mesh.vertices).every(Number.isFinite));

const progress = messages
  .filter((message) => message.type === "progress")
  .map((message) => message.message);
assert.ok(progress.some((message) => message.includes("filtering model faces")));
assert.ok(progress.some((message) => message.includes("streaming target-aware subtraction for cradle")));
assert.ok(progress.some((message) => message.includes("streaming target-aware subtraction for interface")));
assert.ok(
  progress.some((message) => message.includes("candidate faces for adaptive target-aware streaming")),
  progress.join("\n")
);
assert.ok(
  progress.some((message) => message.includes("candidate faces using a") && message.includes("-face batch")),
  progress.join("\n")
);
assert.ok(progress.includes("final continuous ellipsoidal clearance certificate passed"));
assert.ok(result.timings.some((timing) => timing.label === "targeted cradle streaming subtraction"));
assert.ok(result.timings.some((timing) => timing.label === "targeted interface streaming subtraction"));

console.log(
  `model trim worker targeted test passed (${result.repair.candidate_faces}/${result.repair.aabb_candidate_faces}/${result.repair.source_faces} distance/AABB/source faces)`
);
