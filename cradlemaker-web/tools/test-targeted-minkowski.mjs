import assert from "node:assert/strict";

import { certifyContinuousClearance } from "../src/clearanceCertificate.js";

const requestedProfile = process.argv
  .find((argument) => argument.startsWith("--profile="))
  ?.slice("--profile=".length) || "size";
const profileDirectories = {
  size: "manifold-targeted",
  o3: "manifold-targeted-o3",
  simd: "manifold-targeted-simd",
  lto: "manifold-targeted-lto",
};
assert.ok(
  Object.hasOwn(profileDirectories, requestedProfile),
  `unsupported targeted Manifold profile: ${requestedProfile}`
);
const moduleUrl = new URL(
  `../vendor/${profileDirectories[requestedProfile]}/manifold.js`,
  import.meta.url
);
const { default: createManifoldModule } = await import(moduleUrl.href);

const core = await createManifoldModule();
core.setup();

assert.equal(typeof core.Manifold.prototype.minkowskiSumTargeted, "function");
assert.equal(typeof core.Manifold.prototype.minkowskiSubtractTargeted, "function");
assert.equal(typeof core.Manifold.prototype.minkowskiTargetAabbCandidateCount, "function");
assert.equal(typeof core.Manifold.prototype.minkowskiTargetCandidateCount, "function");
assert.equal(typeof core.Manifold.prototype.minGapDetails, "function");
assert.equal(typeof core.Manifold.prototype.minGapDetailsMany, "function");

function translatedCube(size, offset) {
  const cube = core.Manifold.cube(size, true);
  const translated = cube.translate(offset);
  cube.delete();
  return translated;
}

function makeLModel() {
  const horizontal = core.Manifold.cube([10, 2, 2], true);
  const vertical = translatedCube([2, 8, 2], [-4, 3, 0]);
  const model = core.Manifold.union([horizontal, vertical]);
  horizontal.delete();
  vertical.delete();
  return model;
}

function assertTargetEquivalent(label, model, kernel, target, initialBatchSize = 0) {
  const globalSweep = model.minkowskiSum(kernel);
  const targetedSweep = model.minkowskiSumTargeted(kernel, target);
  const progressUpdates = [];
  const streamedResult = model.minkowskiSubtractTargeted(
    kernel,
    target,
    (
      completedFaces,
      totalFaces,
      batchSize,
      statusCode,
      hullUnionMs,
      targetDifferenceMs,
      remainingTargetTriangles
    ) => {
      progressUpdates.push({
        completedFaces,
        totalFaces,
        batchSize,
        statusCode,
        hullUnionMs,
        targetDifferenceMs,
        remainingTargetTriangles,
      });
    },
    initialBatchSize
  );
  assert.equal(globalSweep.status(), "NoError", `${label}: global sweep failed`);
  assert.equal(targetedSweep.status(), "NoError", `${label}: targeted sweep failed`);
  assert.equal(streamedResult.status(), "NoError", `${label}: streamed subtraction failed`);

  const globalResult = target.subtract(globalSweep);
  const targetedResult = target.subtract(targetedSweep);
  const globalOnly = globalResult.subtract(targetedResult);
  const targetedOnly = targetedResult.subtract(globalResult);
  const globalOnlyStreamed = globalResult.subtract(streamedResult);
  const streamedOnlyGlobal = streamedResult.subtract(globalResult);

  try {
    assert.equal(globalResult.status(), "NoError", `${label}: global Boolean failed`);
    assert.equal(targetedResult.status(), "NoError", `${label}: targeted Boolean failed`);
    assert.equal(globalOnly.status(), "NoError", `${label}: forward difference failed`);
    assert.equal(targetedOnly.status(), "NoError", `${label}: reverse difference failed`);
    assert.equal(globalOnlyStreamed.status(), "NoError", `${label}: global/streamed difference failed`);
    assert.equal(streamedOnlyGlobal.status(), "NoError", `${label}: streamed/global difference failed`);

    const targetVolume = Math.max(1, Math.abs(target.volume()));
    const volumeTolerance = targetVolume * 1e-8;
    const symmetricDifferenceVolume =
      Math.abs(globalOnly.volume()) + Math.abs(targetedOnly.volume());
    const streamedDifferenceVolume =
      Math.abs(globalOnlyStreamed.volume()) + Math.abs(streamedOnlyGlobal.volume());
    assert.ok(
      symmetricDifferenceVolume <= volumeTolerance,
      `${label}: target-restricted results differ by ${symmetricDifferenceVolume} mm^3`
    );
    assert.ok(
      streamedDifferenceVolume <= volumeTolerance,
      `${label}: streamed result differs by ${streamedDifferenceVolume} mm^3`
    );
    if (!streamedResult.isEmpty()) {
      assert.ok(progressUpdates.length > 0, `${label}: no streaming progress was reported`);
      assert.equal(
        progressUpdates.at(-1)?.statusCode,
        0,
        `${label}: final streaming progress reported an error`
      );
      for (const update of progressUpdates.filter((item) => item.batchSize > 0)) {
        assert.ok(Number.isFinite(update.hullUnionMs) && update.hullUnionMs >= 0);
        assert.ok(
          Number.isFinite(update.targetDifferenceMs) && update.targetDifferenceMs >= 0
        );
        assert.ok(
          Number.isInteger(update.remainingTargetTriangles) &&
          update.remainingTargetTriangles >= 0
        );
      }
    }
  } finally {
    streamedOnlyGlobal.delete();
    globalOnlyStreamed.delete();
    targetedOnly.delete();
    globalOnly.delete();
    targetedResult.delete();
    globalResult.delete();
    streamedResult.delete();
    targetedSweep.delete();
    globalSweep.delete();
  }
  return progressUpdates;
}

const model = makeLModel();
const kernel = core.Manifold.sphere(0.5, 12);
const anisotropicSphere = core.Manifold.sphere(1, 12);
const anisotropicKernel = anisotropicSphere.scale([0.5, 0.5, 0.15]);
anisotropicSphere.delete();
const nearTarget = translatedCube([2, 4, 3], [5.5, 0, 0]);
const containedTarget = translatedCube([1, 1, 1], [0, 0, 0]);
const enclosingTarget = translatedCube([30, 30, 30], [0, 0, 0]);
const farTarget = translatedCube([2, 2, 2], [30, 0, 0]);
const diagonalTarget = translatedCube([0.2, 0.2, 0.2], [5.4, 1.4, 1.2]);

try {
  const witnessCertificate = certifyContinuousClearance(
    model,
    [{ label: "near target", solid: nearTarget }],
    { xy_mm: 0.5, z_mm: 0.5 }
  );
  assert.equal(witnessCertificate.passed, false);
  assert.ok(witnessCertificate.targets[0]?.witness, "failed certificate omitted its face witness");
  assert.equal(witnessCertificate.targets[0].witness.model_face_centroid_mm.length, 3);
  assert.equal(witnessCertificate.targets[0].witness.target_face_centroid_mm.length, 3);

  const separatedModelParts = [
    translatedCube([2, 2, 2], [-12, 0, 0]),
    translatedCube([2, 2, 2], [0, 0, 0]),
    translatedCube([2, 2, 2], [12, 0, 0]),
  ];
  const separatedTargetParts = [
    translatedCube([2, 2, 1], [-12, 0, 1.75]),
    translatedCube([2, 2, 1], [0, 0, 1.6]),
    translatedCube([2, 2, 1], [12, 0, 1.9]),
  ];
  const separatedModel = core.Manifold.union(separatedModelParts);
  const separatedTarget = core.Manifold.union(separatedTargetParts);
  for (const solid of [...separatedModelParts, ...separatedTargetParts]) solid.delete();
  try {
    const details = separatedModel.minGapDetailsMany(separatedTarget, 1, 6, [10, 10, 10]);
    const repeatedDetails = separatedModel.minGapDetailsMany(
      separatedTarget, 1, 6, [10, 10, 10]
    );
    assert.deepEqual(repeatedDetails, details, "multi-witness query was not deterministic");
    assert.equal(details.length, 27, "three separated targets should produce three witnesses");
    const records = Array.from({ length: details.length / 9 }, (_, index) =>
      details.slice(index * 9, index * 9 + 9)
    );
    assert.deepEqual(
      records.map((record) => Number(record[0].toFixed(6))),
      [0.1, 0.25, 0.4]
    );
    assert.ok(records.every((record) => record[1] >= 0 && record[2] >= 0));
    assert.equal(
      separatedModel.minGapDetailsMany(separatedTarget, 1, 2, [10, 10, 10]).length,
      18,
      "maxResults did not cap the witness count"
    );
    assert.equal(
      separatedModel.minGapDetailsMany(separatedTarget, 1, 6, [30, 30, 30]).length,
      9,
      "target cell size did not cluster nearby witnesses"
    );
    assert.deepEqual(
      separatedModel.minGapDetailsMany(separatedTarget, 1, 0, [10, 10, 10]),
      []
    );

    const certificateScale = [1 / 0.501, 1 / 0.501, 1 / 0.501];
    const scaledSeparatedModel = separatedModel.scale(certificateScale);
    const scaledSeparatedTarget = separatedTarget.scale(certificateScale);
    try {
      const scaledDetails = scaledSeparatedModel.minGapDetailsMany(
        scaledSeparatedTarget, 1.0001, 6, [15, 15, 15]
      );
      assert.equal(scaledDetails.length, 27, JSON.stringify(scaledDetails));
    } finally {
      scaledSeparatedTarget.delete();
      scaledSeparatedModel.delete();
    }

    const multiWitnessCertificate = certifyContinuousClearance(
      separatedModel,
      [{ label: "separated target", solid: separatedTarget }],
      { xy_mm: 0.5, z_mm: 0.5 },
      { max_witnesses: 6, witness_target_cell_size_normalized: [15, 15, 15] }
    );
    assert.equal(multiWitnessCertificate.passed, false);
    assert.equal(
      multiWitnessCertificate.targets[0].witnesses.length,
      3,
      JSON.stringify(multiWitnessCertificate.targets[0].witnesses)
    );
    assert.deepEqual(
      multiWitnessCertificate.targets[0].witness,
      multiWitnessCertificate.targets[0].witnesses[0]
    );

    const groupedRepairKernel = core.Manifold.cube([1.02, 1.02, 1.02], true);
    let groupedRepair = separatedTarget;
    let ownsGroupedRepair = false;
    try {
      for (const witness of multiWitnessCertificate.targets[0].witnesses) {
        const repairBox = translatedCube(
          [8, 8, 8],
          witness.target_face_centroid_mm
        );
        const localTarget = core.Manifold.intersection(groupedRepair, repairBox);
        repairBox.delete();
        try {
          assert.equal(localTarget.status(), "NoError");
          assert.equal(localTarget.isEmpty(), false);
          const localClearance = separatedModel.minkowskiSumTargeted(
            groupedRepairKernel,
            localTarget
          );
          try {
            assert.equal(localClearance.status(), "NoError");
            const nextRepair = groupedRepair.subtract(localClearance);
            assert.equal(nextRepair.status(), "NoError");
            if (ownsGroupedRepair) groupedRepair.delete();
            groupedRepair = nextRepair;
            ownsGroupedRepair = true;
          } finally {
            localClearance.delete();
          }
        } finally {
          localTarget.delete();
        }
      }
      const groupedCertificate = certifyContinuousClearance(
        separatedModel,
        [{ label: "grouped repair", solid: groupedRepair }],
        { xy_mm: 0.5, z_mm: 0.5 }
      );
      assert.equal(groupedCertificate.passed, true, groupedCertificate.reason);
    } finally {
      if (ownsGroupedRepair) groupedRepair.delete();
      groupedRepairKernel.delete();
    }
  } finally {
    separatedTarget.delete();
    separatedModel.delete();
  }

  const deepContainmentModel = core.Manifold.cube([20, 20, 20], true);
  const deepContainedTarget = core.Manifold.cube([1, 1, 1], true);
  try {
    const containmentCertificate = certifyContinuousClearance(
      deepContainmentModel,
      [{ label: "deep contained target", solid: deepContainedTarget }],
      { xy_mm: 0.2, z_mm: 0.2 },
      { max_witnesses: 6, witness_target_cell_size_normalized: [5, 5, 5] }
    );
    assert.equal(containmentCertificate.passed, false);
    assert.equal(containmentCertificate.normalized_gap_lower_bound, 0);
  } finally {
    deepContainedTarget.delete();
    deepContainmentModel.delete();
  }

  const nearAabbCandidates = model.minkowskiTargetAabbCandidateCount(kernel, nearTarget);
  const nearCandidates = model.minkowskiTargetCandidateCount(kernel, nearTarget);
  assert.ok(nearCandidates > 0, "near target should retain source faces");
  assert.ok(
    nearCandidates <= nearAabbCandidates,
    `distance filter increased candidates ${nearAabbCandidates} -> ${nearCandidates}`
  );
  assert.ok(
    nearCandidates < model.numTri(),
    `near target retained all ${model.numTri()} source faces`
  );
  assert.equal(
    model.minkowskiTargetCandidateCount(kernel, farTarget),
    0,
    "far target should retain no swept source faces"
  );
  assert.equal(
    model.minkowskiTargetAabbCandidateCount(kernel, farTarget),
    0,
    "far target should have no AABB candidates"
  );
  assert.equal(
    model.minkowskiTargetCandidateCount(kernel, enclosingTarget),
    model.numTri(),
    "a target enclosing every swept hull must retain every source face"
  );
  const nonFiniteBatchResult = model.minkowskiSubtractTargeted(
    kernel,
    farTarget,
    null,
    Number.POSITIVE_INFINITY
  );
  try {
    assert.equal(
      nonFiniteBatchResult.status(),
      "NoError",
      "non-finite direct batch input was not normalized"
    );
  } finally {
    nonFiniteBatchResult.delete();
  }

  const diagonalAabbCandidates = model.minkowskiTargetAabbCandidateCount(
    anisotropicKernel,
    diagonalTarget
  );
  const diagonalCandidates = model.minkowskiTargetCandidateCount(
    anisotropicKernel,
    diagonalTarget
  );
  assert.ok(diagonalAabbCandidates > 0, "diagonal target should overlap swept AABBs");
  assert.ok(
    diagonalCandidates < diagonalAabbCandidates,
    `distance filter did not reject diagonal candidates (${diagonalCandidates}/${diagonalAabbCandidates})`
  );

  assertTargetEquivalent("near target", model, kernel, nearTarget);
  assertTargetEquivalent("target contained in model", model, kernel, containedTarget);
  assertTargetEquivalent("sweeps contained in target", model, kernel, enclosingTarget);
  assertTargetEquivalent("far target", model, kernel, farTarget);
  assertTargetEquivalent("anisotropic diagonal rejection", model, anisotropicKernel, diagonalTarget);

  const multiBatchBase = makeLModel();
  const multiBatchModel = multiBatchBase.refine(16);
  const multiBatchKernel = core.Manifold.cube([0.2, 0.2, 0.2], true);
  const multiBatchTarget = translatedCube([30, 30, 30], [0, 0, 0]);
  multiBatchBase.delete();
  try {
    const multiBatchCandidates = multiBatchModel.minkowskiTargetCandidateCount(
      multiBatchKernel,
      multiBatchTarget
    );
    assert.ok(
      multiBatchCandidates > 8000,
      `multi-batch fixture retained only ${multiBatchCandidates} faces`
    );
    const multiBatchProgress = assertTargetEquivalent(
      "multi-batch refined nonconvex target",
      multiBatchModel,
      multiBatchKernel,
      multiBatchTarget,
      6000
    );
    assert.ok(
      multiBatchProgress.some((update) => update.completedFaces > 8000),
      "multi-batch fixture did not report progress beyond the first batch"
    );
    assert.equal(
      multiBatchProgress.find((update) =>
        update.statusCode === 0 && update.batchSize > 0
      )?.batchSize,
      6000,
      "explicit initial stream batch size was not applied"
    );
  } finally {
    multiBatchTarget.delete();
    multiBatchKernel.delete();
    multiBatchModel.delete();
  }

  console.log(
    `targeted Minkowski ${requestedProfile} tests passed (${nearCandidates}/${nearAabbCandidates}/${model.numTri()} near distance/AABB/source faces retained)`
  );
} finally {
  diagonalTarget.delete();
  farTarget.delete();
  enclosingTarget.delete();
  containedTarget.delete();
  nearTarget.delete();
  anisotropicKernel.delete();
  kernel.delete();
  model.delete();
}
