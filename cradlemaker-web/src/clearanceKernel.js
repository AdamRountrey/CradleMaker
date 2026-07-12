import {
  CLEARANCE_CERTIFICATE_AXIS_GUARD_MM,
  CLEARANCE_CERTIFICATE_NORMALIZED_GUARD,
  measureCenteredMeshInradius,
} from "./clearanceCertificate.js";

export const LEGACY_CLEARANCE_KERNEL_MODE = "legacy";
export const CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE = "circumscribed";
export const CLEARANCE_BOOLEAN_REPAIR_GUARD_MM = 0.001;

export function normalizeClearanceKernelMode(mode) {
  return mode === CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE
    ? CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE
    : LEGACY_CLEARANCE_KERNEL_MODE;
}

export function clearanceKernelSegments(clearanceMm) {
  if (clearanceMm >= 3) return 18;
  if (clearanceMm >= 1) return 14;
  return 10;
}

export function clearanceKernelSafetyMargin(clearanceMm) {
  if (clearanceMm <= 0.001) return 0;
  return Math.max(0.015, Math.min(0.08, clearanceMm * 0.04));
}

export function buildClearanceKernel(core, clearance = {}, requestedMode = "legacy") {
  const mode = normalizeClearanceKernelMode(requestedMode);
  const requestedXy = Math.max(0, Number(clearance?.xy_mm) || 0);
  const requestedZ = Math.max(0, Number(clearance?.z_mm) || 0);
  const maxClearance = Math.max(requestedXy, requestedZ);
  const segments = clearanceKernelSegments(maxClearance);
  const unitSphere = core.Manifold.sphere(1, segments);
  let kernel = null;

  try {
    const unitMesh = unitSphere.getMesh();
    const unitInradius = measureCenteredMeshInradius(unitMesh);
    const circumscribed = mode === CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE;
    const safetyMargin = circumscribed ? 0 : clearanceKernelSafetyMargin(maxClearance);
    const axisGuard = circumscribed ? CLEARANCE_CERTIFICATE_AXIS_GUARD_MM : 0;
    const repairGuard = circumscribed ? CLEARANCE_BOOLEAN_REPAIR_GUARD_MM : 0;
    const circumscriptionScale = circumscribed ? 1 / unitInradius : 1;
    const certificateSearchScale = circumscribed
      ? 1 + CLEARANCE_CERTIFICATE_NORMALIZED_GUARD
      : 1;
    const minimumAxis = 0.001;
    const baseXy = Math.max(
      (requestedXy + safetyMargin + axisGuard) * certificateSearchScale + repairGuard,
      minimumAxis
    );
    const baseZ = Math.max(
      (requestedZ + safetyMargin + axisGuard) * certificateSearchScale + repairGuard,
      minimumAxis
    );
    const scaleXy = baseXy * circumscriptionScale;
    const scaleZ = baseZ * circumscriptionScale;
    kernel = unitSphere.scale([scaleXy, scaleXy, scaleZ]);

    const bounds = kernel.boundingBox();
    const extentX = Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0]));
    const extentY = Math.max(Math.abs(bounds.min[1]), Math.abs(bounds.max[1]));
    const extentZ = Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2]));
    return {
      solid: kernel,
      metadata: {
        mode,
        requested_segments: segments,
        actual_vertices: Number(unitMesh.numVert) || 0,
        actual_triangles: Number(unitMesh.numTri) || 0,
        unit_inradius: unitInradius,
        circumscription_scale: circumscriptionScale,
        axis_guard_mm: axisGuard,
        repair_guard_mm: repairGuard,
        normalized_guard: circumscribed ? CLEARANCE_CERTIFICATE_NORMALIZED_GUARD : 0,
        certificate_search_scale: certificateSearchScale,
        safety_margin_mm: safetyMargin,
        requested_xy_mm: requestedXy,
        requested_z_mm: requestedZ,
        base_axis_xy_mm: baseXy,
        base_axis_z_mm: baseZ,
        scale_axis_xy_mm: scaleXy,
        scale_axis_z_mm: scaleZ,
        extent_xy_mm: Math.max(extentX, extentY),
        extent_z_mm: extentZ,
        continuous_clearance_guaranteed: circumscribed &&
          requestedXy > minimumAxis && requestedZ > minimumAxis,
      },
    };
  } catch (error) {
    kernel?.delete?.();
    throw error;
  } finally {
    unitSphere.delete?.();
  }
}
