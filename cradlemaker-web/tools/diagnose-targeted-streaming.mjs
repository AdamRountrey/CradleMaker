import createManifoldModule from "../vendor/manifold-targeted/manifold.js";
import {
  CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE,
  buildClearanceKernel,
} from "../src/clearanceKernel.js";
import { certifyContinuousClearance } from "../src/clearanceCertificate.js";

const core = await createManifoldModule();
core.setup();

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

const clearance = { xy_mm: 0.35, z_mm: 0.2 };
const coarseModel = makeLModel();
const model = coarseModel.refine(32);
const coarseTarget = core.Manifold.cube([30, 30, 30], true);
const target = coarseTarget.refine(64);
const kernelResult = buildClearanceKernel(
  core,
  clearance,
  CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE
);
const kernel = kernelResult.solid;
coarseModel.delete();
coarseTarget.delete();

try {
  const aabbCandidates = model.minkowskiTargetAabbCandidateCount(kernel, target);
  const candidates = model.minkowskiTargetCandidateCount(kernel, target);
  console.log(JSON.stringify({
    model_faces: model.numTri(),
    target_faces: target.numTri(),
    aabb_candidates: aabbCandidates,
    candidates,
    kernel: kernelResult.metadata,
  }, null, 2));

  const startedAt = performance.now();
  const result = model.minkowskiSubtractTargeted(
    kernel,
    target,
    (completed, total, batchSize, status) => {
      if (batchSize || completed === total) {
        console.log(JSON.stringify({ completed, total, batchSize, status }));
      }
    }
  );
  try {
    const elapsed_ms = performance.now() - startedAt;
    const certificate = certifyContinuousClearance(
      model,
      [{ label: "streamed target", solid: result }],
      clearance
    );
    console.log(JSON.stringify({
      status: result.status(),
      elapsed_ms,
      result_faces: result.numTri(),
      certificate,
    }, null, 2));
    if (!certificate.passed) process.exitCode = 1;
  } finally {
    result.delete();
  }
} finally {
  kernel.delete();
  target.delete();
  model.delete();
}
