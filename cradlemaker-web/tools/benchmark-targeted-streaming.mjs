import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const PROFILE_DIRECTORIES = {
  size: "manifold-targeted",
  o3: "manifold-targeted-o3",
  simd: "manifold-targeted-simd",
  lto: "manifold-targeted-lto",
};

function option(name, fallback = "") {
  return process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3) ?? fallback;
}

function positiveIntegerOption(name, fallback) {
  const value = Math.floor(Number(option(name, fallback)));
  assert.ok(Number.isInteger(value) && value > 0, `--${name} must be a positive integer`);
  return value;
}

function listOption(name, fallback) {
  const values = option(name, fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  assert.ok(values.length > 0, `--${name} must not be empty`);
  return values;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summarizeBatch(results) {
  const wallTimes = results.map((result) => result.wall_ms);
  const hullTimes = results.map((result) => result.hull_union_ms);
  const differenceTimes = results.map((result) => result.target_difference_ms);
  return {
    measured_runs: results.length,
    median_wall_ms: percentile(wallTimes, 0.5),
    p95_wall_ms: percentile(wallTimes, 0.95),
    median_hull_union_ms: percentile(hullTimes, 0.5),
    median_target_difference_ms: percentile(differenceTimes, 0.5),
    maximum_wasm_capacity_bytes: Math.max(
      ...results.map((result) => result.peak_wasm_memory_bytes)
    ),
  };
}

const profiles = listOption("profiles", option("profile", "size"));
for (const profile of profiles) {
  assert.ok(Object.hasOwn(PROFILE_DIRECTORIES, profile), `unsupported profile: ${profile}`);
}
const batches = listOption("batches", "4000,6000,8000").map((value) => {
  const batch = Math.floor(Number(value));
  assert.ok(batch >= 250 && batch <= 8000, `batch size ${value} is outside 250..8000`);
  return batch;
});
const refine = positiveIntegerOption("refine", 32);
const runs = positiveIntegerOption("runs", 1);
const warmups = Math.max(0, Math.floor(Number(option("warmups", 0)) || 0));
const countOnly = process.argv.includes("--count-only");

function translatedCube(core, size, offset) {
  const cube = core.Manifold.cube(size, true);
  const translated = cube.translate(offset);
  cube.delete();
  return translated;
}

function makeLModel(core) {
  const horizontal = core.Manifold.cube([10, 2, 2], true);
  const vertical = translatedCube(core, [2, 8, 2], [-4, 3, 0]);
  const model = core.Manifold.union([horizontal, vertical]);
  horizontal.delete();
  vertical.delete();
  return model;
}

function makeFixture(core) {
  const base = makeLModel(core);
  const model = base.refine(refine);
  base.delete();
  return {
    model,
    kernel: core.Manifold.cube([0.2, 0.2, 0.2], true),
    target: translatedCube(core, [30, 30, 30], [0, 0, 0]),
  };
}

function canonicalMeshHash(solid) {
  const mesh = solid.getMesh();
  const floatBytes = new ArrayBuffer(4);
  const view = new DataView(floatBytes);
  const floatKey = (value) => {
    view.setFloat32(0, value, true);
    return view.getUint32(0, true).toString(16).padStart(8, "0");
  };
  const vertexKey = (vertex) => {
    const offset = vertex * mesh.numProp;
    return `${floatKey(mesh.vertProperties[offset])}${floatKey(mesh.vertProperties[offset + 1])}${floatKey(mesh.vertProperties[offset + 2])}`;
  };
  const triangles = [];
  for (let index = 0; index < mesh.triVerts.length; index += 3) {
    triangles.push([
      vertexKey(mesh.triVerts[index]),
      vertexKey(mesh.triVerts[index + 1]),
      vertexKey(mesh.triVerts[index + 2]),
    ].sort().join(""));
  }
  triangles.sort();
  const hash = createHash("sha256");
  for (const triangle of triangles) hash.update(triangle);
  return hash.digest("hex");
}

function exactSymmetricDifference(reference, candidate) {
  const startedAt = performance.now();
  const referenceOnly = reference.subtract(candidate);
  const candidateOnly = candidate.subtract(reference);
  try {
    assert.equal(referenceOnly.status(), "NoError", "reference/candidate difference failed");
    assert.equal(candidateOnly.status(), "NoError", "candidate/reference difference failed");
    return {
      volume: Math.abs(referenceOnly.volume()) + Math.abs(candidateOnly.volume()),
      ms: performance.now() - startedAt,
    };
  } finally {
    candidateOnly.delete();
    referenceOnly.delete();
  }
}

function runStream(core, model, kernel, target, batchSize) {
  const progress = [];
  const startedAt = performance.now();
  const result = model.minkowskiSubtractTargeted(
    kernel,
    target,
    (
      completedFaces,
      totalFaces,
      attemptedBatchSize,
      statusCode,
      hullUnionMs,
      targetDifferenceMs,
      remainingTargetTriangles
    ) => {
      progress.push({
        completed_faces: completedFaces,
        total_faces: totalFaces,
        batch_size: attemptedBatchSize,
        status_code: statusCode,
        hull_union_ms: hullUnionMs,
        target_difference_ms: targetDifferenceMs,
        remaining_target_triangles: remainingTargetTriangles,
        wasm_memory_bytes: Number(core.getWasmMemorySize?.()) || 0,
      });
    },
    batchSize
  );
  const wallMs = performance.now() - startedAt;
  assert.equal(result.status(), "NoError", `stream failed for batch ${batchSize}`);
  const attempts = progress.filter((update) => update.batch_size > 0);
  const successful = attempts.filter((update) => update.status_code === 0);
  return {
    result,
    metrics: {
      batch_size: batchSize,
      wall_ms: wallMs,
      hull_union_ms: attempts.reduce((total, update) => total + update.hull_union_ms, 0),
      target_difference_ms: attempts.reduce(
        (total, update) => total + update.target_difference_ms,
        0
      ),
      attempts: attempts.length,
      successful_batches: successful.length,
      retries: attempts.length - successful.length,
      peak_wasm_memory_bytes: Math.max(
        Number(core.getWasmMemorySize?.()) || 0,
        ...progress.map((update) => update.wasm_memory_bytes)
      ),
      remaining_target_triangles: successful.at(-1)?.remaining_target_triangles ?? null,
      output_triangles: result.numTri(),
      output_volume: result.volume(),
    },
  };
}

const report = {
  fixture: "refined nonconvex L inside enclosing target",
  refine,
  batches,
  runs,
  warmups,
  wasm_memory_note:
    "WASM memory is allocated linear-memory capacity, not live usage, and does not shrink within a profile process.",
  profiles: [],
};

for (const profile of profiles) {
  const moduleUrl = new URL(
    `../vendor/${PROFILE_DIRECTORIES[profile]}/manifold.js`,
    import.meta.url
  );
  const { default: createManifoldModule } = await import(moduleUrl.href);
  const core = await createManifoldModule();
  core.setup();
  const fixture = makeFixture(core);
  let reference = null;
  let referenceHash = "";
  try {
    const sourceFaces = fixture.model.numTri();
    const candidateFaces = fixture.model.minkowskiTargetCandidateCount(
      fixture.kernel,
      fixture.target
    );
    const profileReport = {
      profile,
      source_faces: sourceFaces,
      candidate_faces: candidateFaces,
      initial_wasm_memory_bytes: Number(core.getWasmMemorySize?.()) || 0,
      results: [],
    };
    report.profiles.push(profileReport);
    console.log(`${profile}: ${candidateFaces.toLocaleString()} candidates from ${sourceFaces.toLocaleString()} source faces`);
    if (countOnly) continue;

    for (const batchSize of batches) {
      for (let warmup = 0; warmup < warmups; warmup += 1) {
        const warmupRun = runStream(
          core,
          fixture.model,
          fixture.kernel,
          fixture.target,
          batchSize
        );
        warmupRun.result.delete();
      }
      for (let run = 1; run <= runs; run += 1) {
        const streamed = runStream(
          core,
          fixture.model,
          fixture.kernel,
          fixture.target,
          batchSize
        );
        const hashStartedAt = performance.now();
        const hash = canonicalMeshHash(streamed.result);
        const hashMs = performance.now() - hashStartedAt;
        let symmetricDifferenceVolume = 0;
        let verificationMs = 0;
        if (!reference) {
          reference = streamed.result;
          referenceHash = hash;
        } else if (hash !== referenceHash) {
          const difference = exactSymmetricDifference(reference, streamed.result);
          symmetricDifferenceVolume = difference.volume;
          verificationMs = difference.ms;
          const tolerance = Math.max(1, Math.abs(fixture.target.volume())) * 1e-8;
          assert.ok(
            symmetricDifferenceVolume <= tolerance,
            `${profile} batch ${batchSize} differs from the reference by ${symmetricDifferenceVolume} mm^3`
          );
        }
        const resultReport = {
          run,
          ...streamed.metrics,
          canonical_mesh_hash: hash,
          matches_reference_hash: hash === referenceHash,
          symmetric_difference_volume: symmetricDifferenceVolume,
          verification_ms: verificationMs,
          mesh_hash_ms: hashMs,
        };
        profileReport.results.push(resultReport);
        console.log(
          `${profile} batch ${batchSize} run ${run}: ${streamed.metrics.wall_ms.toFixed(1)} ms ` +
          `(${streamed.metrics.hull_union_ms.toFixed(1)} hull, ` +
          `${streamed.metrics.target_difference_ms.toFixed(1)} difference), ` +
          `${streamed.metrics.retries} retries, ` +
          `${(streamed.metrics.peak_wasm_memory_bytes / 1048576).toFixed(1)} MiB peak`
        );
        if (streamed.result !== reference) streamed.result.delete();
      }
    }
    profileReport.summary_by_batch = Object.fromEntries(
      batches.map((batchSize) => [
        batchSize,
        summarizeBatch(
          profileReport.results.filter((result) => result.batch_size === batchSize)
        ),
      ])
    );
  } finally {
    reference?.delete?.();
    fixture.target.delete();
    fixture.kernel.delete();
    fixture.model.delete();
  }
}

console.log("TARGETED_STREAM_BENCHMARK_JSON");
console.log(JSON.stringify(report, null, 2));
