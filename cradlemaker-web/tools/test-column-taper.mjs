import assert from "node:assert/strict";
import fs from "node:fs";

import createCradlemakerCore from "../src/wasm/cradlemaker-core.js";

const wasmBinary = fs.readFileSync(new URL("../src/wasm/cradlemaker-core.wasm", import.meta.url));
const core = await createCradlemakerCore({ wasmBinary });

function horizontalPlate(x0, x1, y0, y1, z) {
  return [
    x0, y0, z, x1, y0, z, x1, y1, z,
    x0, y0, z, x1, y1, z, x0, y1, z,
  ];
}

function verticalWall(x, y0, y1, z0, z1) {
  return [
    x, y0, z0, x, y1, z0, x, y1, z1,
    x, y0, z0, x, y1, z1, x, y0, z1,
  ];
}

function ribPairJob(heightMm, taperAngleDeg, baseMarginMm = 0) {
  const vertices = [
    ...horizontalPlate(-8, -3, -4, 4, heightMm),
    ...horizontalPlate(3, 8, -4, 4, heightMm),
  ];
  return {
    version: 1,
    mesh: {
      coordinate_space: "world_mm",
      triangle_encoding: "nonindexed_triplets",
      vertex_count: vertices.length / 3,
      triangle_count: vertices.length / 9,
      vertices,
    },
    support_config: {
      enable_support: true,
      support_threshold_angle: 30,
      support_remove_small_overhang: false,
      support_top_z_distance: 0.2,
      support_object_xy_distance: 0,
      support_base_pattern_spacing: 0.5,
    },
    cradle_config: {
      base_enabled: true,
      join_uprights_bottom_enabled: true,
      base_margin_mm: baseMarginMm,
      base_thickness_mm: 3,
      column_taper_enabled: taperAngleDeg > 0,
      column_taper_angle_deg: taperAngleDeg,
      max_contact_grid_cells: 1_200_000,
    },
    manual_supports: [],
  };
}

function generate(heightMm, taperAngleDeg) {
  return JSON.parse(core.prepareSupportJobJson(JSON.stringify(ribPairJob(heightMm, taperAngleDeg))));
}

function wallClearanceJob(taperAngleDeg) {
  const vertices = [
    ...horizontalPlate(-4, 0, -3, 3, 100),
    ...verticalWall(0.4, -3, 3, 20, 70),
  ];
  return {
    ...ribPairJob(100, taperAngleDeg),
    mesh: {
      coordinate_space: "world_mm",
      triangle_encoding: "nonindexed_triplets",
      vertex_count: vertices.length / 3,
      triangle_count: vertices.length / 9,
      vertices,
    },
  };
}

function maxSupportZAtVerticalPlane(result, planeX, minY, maxY) {
  const vertices = result.support_mesh?.vertices ?? [];
  const triangles = result.support_mesh?.triangles ?? [];
  const epsilon = 1e-7;
  let maxZ = -Infinity;

  function vertex(index) {
    return {
      x: Number(vertices[index * 3]),
      y: Number(vertices[index * 3 + 1]),
      z: Number(vertices[index * 3 + 2]),
    };
  }

  function record(point) {
    if (point.y >= minY - epsilon && point.y <= maxY + epsilon) {
      maxZ = Math.max(maxZ, point.z);
    }
  }

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const points = [vertex(triangles[index]), vertex(triangles[index + 1]), vertex(triangles[index + 2])];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = points[edge];
      const b = points[(edge + 1) % 3];
      const da = a.x - planeX;
      const db = b.x - planeX;
      if (Math.abs(da) <= epsilon) record(a);
      if (Math.abs(db) <= epsilon) record(b);
      if (da * db >= -epsilon || Math.abs(b.x - a.x) <= epsilon) continue;
      const t = (planeX - a.x) / (b.x - a.x);
      record({
        x: planeX,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      });
    }
  }

  return Number.isFinite(maxZ) ? maxZ : 0;
}

function maxVertexZInCenterGap(result) {
  const vertices = result.support_mesh?.vertices ?? [];
  let maxZ = 0;
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const x = Number(vertices[index]);
    const y = Number(vertices[index + 1]);
    const z = Number(vertices[index + 2]);
    if (Math.abs(x) <= 0.75 && Math.abs(y) <= 3.5) maxZ = Math.max(maxZ, z);
  }
  return maxZ;
}

const untapered = generate(120, 0);
const tapered = generate(120, 3);
const shortTapered = generate(30, 3);
const wallClearance = JSON.parse(core.prepareSupportJobJson(JSON.stringify(wallClearanceJob(6))));
const untaperedBase = JSON.parse(core.prepareSupportJobJson(JSON.stringify(ribPairJob(120, 0, 1))));
const taperedBase = JSON.parse(core.prepareSupportJobJson(JSON.stringify(ribPairJob(120, 3, 1))));
const lowResolutionJob = ribPairJob(120, 3);
lowResolutionJob.support_config.support_base_pattern_spacing = 1.2;
lowResolutionJob.cradle_config.max_contact_grid_cells = 600_000;
const lowResolution = JSON.parse(core.prepareSupportJobJson(JSON.stringify(lowResolutionJob)));

assert.equal(untapered.status, "support_mesh_generated");
assert.equal(tapered.status, "support_mesh_generated");
assert.equal(shortTapered.status, "support_mesh_generated");
assert.equal(wallClearance.status, "support_mesh_generated");
assert.equal(untaperedBase.status, "support_mesh_generated");
assert.equal(taperedBase.status, "support_mesh_generated");
assert.equal(lowResolution.status, "support_mesh_generated");
assert.equal(lowResolution.support.contact_cell_size_mm, 1.2);
assert.equal(lowResolution.support.max_contact_grid_cells, 600_000);

assert.equal(untapered.support.column_taper_cells, 0);
assert.equal(untapered.support.column_taper_angle_deg, 0);
assert.equal(untapered.support.column_taper_side_guard_mm, 0);
assert.ok(tapered.support.column_taper_cells > 0);
assert.ok(tapered.support.column_taper_seed_cells > 0);
assert.ok(tapered.support.column_taper_seed_cells < tapered.support.contact_cells);
assert.equal(tapered.support.column_taper_angle_deg, 3);
assert.equal(tapered.support.column_taper_side_guard_mm, 0.2);
assert.ok(tapered.support.column_taper_added_volume_mm3 > 0);
assert.ok(tapered.support.column_taper_step_drop_mm > 9);
assert.ok(tapered.support.column_taper_step_drop_mm < 10);
assert.ok(tapered.support.column_taper_max_theoretical_reach_mm > 6);
assert.ok(tapered.support.column_taper_max_theoretical_reach_mm < 7);

const untaperedGapTop = maxVertexZInCenterGap(untapered);
const taperedGapTop = maxVertexZInCenterGap(tapered);
assert.ok(untaperedGapTop <= 3.5, `untapered center gap unexpectedly reached ${untaperedGapTop} mm`);
assert.ok(taperedGapTop > 35, `taper did not structurally join the tall rib gap (${taperedGapTop} mm)`);
assert.ok(taperedGapTop < 90, `taper recreated a near-full-height rib-gap wall (${taperedGapTop} mm)`);

assert.ok(shortTapered.support.column_taper_cells < tapered.support.column_taper_cells);
assert.ok(
  shortTapered.support.column_taper_max_theoretical_reach_mm <
    tapered.support.column_taper_max_theoretical_reach_mm
);
assert.equal(tapered.support.contact_cells, untapered.support.contact_cells);
assert.equal(tapered.qa.unsupported_downward_cells, 0);
assert.equal(tapered.qa.intersection_cells, 0);

const wallPlaneTop = maxSupportZAtVerticalPlane(wallClearance, 0.4, -2.75, 2.75);
const outerBaseApronTop = maxSupportZAtVerticalPlane(taperedBase, 14.75, -3.5, 3.5);
assert.ok(wallClearance.support.column_taper_cells > 0);
assert.ok(wallPlaneTop > 3.1, `taper did not reach the vertical-wall test plane (${wallPlaneTop} mm)`);
assert.ok(
  wallPlaneTop < 19.8,
  `taper side rose through the vertical obstacle at z=${wallPlaneTop} mm`
);
assert.ok(
  taperedBase.support.base_cells > untaperedBase.support.base_cells,
  `taper footprint was not included in the base (${taperedBase.support.base_cells} <= ${untaperedBase.support.base_cells})`
);
assert.ok(taperedBase.support.column_taper_grid_reserve_mm >= 6.5);
assert.ok(
  outerBaseApronTop <= 3.05,
  `taper corner leaked a triangular ramp into the flat base apron (z=${outerBaseApronTop} mm)`
);

console.log(
  `column taper tests passed (gap ${untaperedGapTop.toFixed(2)} -> ${taperedGapTop.toFixed(2)} mm, ` +
  `${tapered.support.column_taper_cells} tapered cells, ` +
  `${(tapered.support.column_taper_added_volume_mm3 / 1000).toFixed(2)} cm3 added, ` +
  `guarded wall top ${wallPlaneTop.toFixed(2)} mm, ` +
  `base cells ${untaperedBase.support.base_cells} -> ${taperedBase.support.base_cells}, ` +
  `outer apron top ${outerBaseApronTop.toFixed(2)} mm)`
);
