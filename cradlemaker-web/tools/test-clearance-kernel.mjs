import assert from "node:assert/strict";

import createManifoldModule from "../vendor/manifold/manifold.js";
import {
  buildClearanceKernel,
  CLEARANCE_BOOLEAN_REPAIR_GUARD_MM,
  CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE,
} from "../src/clearanceKernel.js";
import {
  CLEARANCE_CERTIFICATE_AXIS_GUARD_MM,
  CLEARANCE_CERTIFICATE_NORMALIZED_GUARD,
} from "../src/clearanceCertificate.js";

const core = await createManifoldModule();
core.setup();

const clearance = { xy_mm: 0.35, z_mm: 0.2 };
const legacy = buildClearanceKernel(core, clearance, "legacy");
const circumscribed = buildClearanceKernel(
  core,
  clearance,
  CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE
);

try {
  assert.equal(legacy.metadata.mode, "legacy");
  assert.equal(legacy.metadata.continuous_clearance_guaranteed, false);
  assert.ok(legacy.metadata.safety_margin_mm > 0);
  assert.equal(legacy.metadata.axis_guard_mm, 0);

  const metadata = circumscribed.metadata;
  assert.equal(metadata.mode, "circumscribed");
  assert.equal(metadata.continuous_clearance_guaranteed, true);
  assert.equal(metadata.axis_guard_mm, CLEARANCE_CERTIFICATE_AXIS_GUARD_MM);
  assert.equal(metadata.repair_guard_mm, CLEARANCE_BOOLEAN_REPAIR_GUARD_MM);
  assert.equal(metadata.normalized_guard, CLEARANCE_CERTIFICATE_NORMALIZED_GUARD);
  assert.ok(metadata.unit_inradius > 0 && metadata.unit_inradius < 1);
  assert.ok(metadata.circumscription_scale > 1);
  assert.ok(metadata.actual_vertices > 0 && metadata.actual_triangles > 0);

  const effectiveXy = clearance.xy_mm + CLEARANCE_CERTIFICATE_AXIS_GUARD_MM;
  const effectiveZ = clearance.z_mm + CLEARANCE_CERTIFICATE_AXIS_GUARD_MM;
  const normalizedXyInradius =
    metadata.unit_inradius * metadata.scale_axis_xy_mm / effectiveXy;
  const normalizedZInradius =
    metadata.unit_inradius * metadata.scale_axis_z_mm / effectiveZ;
  const required = 1 + CLEARANCE_CERTIFICATE_NORMALIZED_GUARD;
  assert.ok(normalizedXyInradius >= required - 1e-12);
  assert.ok(normalizedZInradius >= required - 1e-12);
  assert.ok(normalizedXyInradius > required);
  assert.ok(normalizedZInradius > required);

  console.log(
    `clearance kernel tests passed (inradius ${metadata.unit_inradius.toFixed(10)}, scale ${metadata.circumscription_scale.toFixed(10)})`
  );
} finally {
  circumscribed.solid.delete();
  legacy.solid.delete();
}
