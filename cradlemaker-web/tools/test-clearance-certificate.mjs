import assert from "node:assert/strict";

import createManifoldModule from "../vendor/manifold/manifold.js";
import {
  CLEARANCE_CERTIFICATE_AXIS_GUARD_MM,
  CLEARANCE_CERTIFICATE_NORMALIZED_GUARD,
  certifyContinuousClearance,
  continuousClearanceCertificateSettings,
} from "../src/clearanceCertificate.js";

const core = await createManifoldModule();
core.setup();

const clearance = { xy_mm: 0.35, z_mm: 0.2 };
const model = core.Manifold.cube([10, 10, 10], true);

function slabBelow(gapMm) {
  const slab = core.Manifold.cube([10, 10, 1], true);
  const translated = slab.translate([0, 0, -5 - gapMm - 0.5]);
  slab.delete();
  return translated;
}

function slabBeside(gapMm) {
  const slab = core.Manifold.cube([1, 10, 10], true);
  const translated = slab.translate([5 + gapMm + 0.5, 0, 0]);
  slab.delete();
  return translated;
}

function certify(targets, settings = clearance) {
  return certifyContinuousClearance(
    model,
    targets.map((solid, index) => ({ label: `target-${index + 1}`, solid })),
    settings
  );
}

const settings = continuousClearanceCertificateSettings(clearance);
assert.equal(settings.supported, true);
assert.equal(settings.effective_xy_mm, clearance.xy_mm + CLEARANCE_CERTIFICATE_AXIS_GUARD_MM);
assert.equal(settings.effective_z_mm, clearance.z_mm + CLEARANCE_CERTIFICATE_AXIS_GUARD_MM);
assert.equal(settings.search_length, 1 + CLEARANCE_CERTIFICATE_NORMALIZED_GUARD);

const clearZ = slabBelow(0.22);
const clearZResult = certify([clearZ]);
assert.equal(clearZResult.available, true);
assert.equal(clearZResult.passed, true);
assert.equal(clearZResult.targets[0].passed, true);

const closeZ = slabBelow(0.19);
const closeZResult = certify([closeZ]);
assert.equal(closeZResult.available, true);
assert.equal(closeZResult.passed, false);
assert.ok(closeZResult.normalized_gap_lower_bound < 1);

const clearXy = slabBeside(0.37);
const clearXyResult = certify([clearXy]);
assert.equal(clearXyResult.passed, true);

const closeXy = slabBeside(0.34);
const closeXyResult = certify([closeXy]);
assert.equal(closeXyResult.passed, false);

const intersecting = slabBelow(-0.05);
const intersectionResult = certify([intersecting]);
assert.equal(intersectionResult.passed, false);
assert.equal(intersectionResult.normalized_gap_lower_bound, 0);

const contained = core.Manifold.cube([1, 1, 1], true);
const containmentResult = certify([contained]);
assert.equal(containmentResult.passed, false);
assert.equal(containmentResult.normalized_gap_lower_bound, 0);

const mixedResult = certify([clearZ, closeXy]);
assert.equal(mixedResult.passed, false);
assert.equal(mixedResult.targets.length, 2);
assert.equal(mixedResult.targets[0].passed, true);
assert.equal(mixedResult.targets[1].passed, false);

const degenerateSettings = continuousClearanceCertificateSettings({ xy_mm: 0.35, z_mm: 0 });
assert.equal(degenerateSettings.supported, false);
const degenerateResult = certify([clearZ], { xy_mm: 0.35, z_mm: 0 });
assert.equal(degenerateResult.attempted, false);
assert.equal(degenerateResult.passed, false);

for (const solid of [clearZ, closeZ, clearXy, closeXy, intersecting, contained, model]) {
  solid.delete();
}

console.log("clearance certificate tests passed");
