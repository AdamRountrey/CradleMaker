let context = null;

self.onmessage = (event) => {
  const message = event.data ?? {};
  try {
    if (message.type === "init") {
      context = initializeContext(message);
      self.postMessage({ type: "ready", id: message.id });
      return;
    }
    if (message.type === "tile") {
      if (!context) throw new Error("worker is not initialized");
      const result = buildVoxelTile(message.tile);
      const transfer = [];
      if (result.mesh.vertices.buffer) transfer.push(result.mesh.vertices.buffer);
      if (result.mesh.triangles.buffer) transfer.push(result.mesh.triangles.buffer);
      self.postMessage({ type: "tileResult", id: message.id, result }, transfer);
      return;
    }
    throw new Error(`unknown worker message: ${message.type}`);
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      error: error?.message || String(error),
      stack: error?.stack || "",
    });
  }
};

function initializeContext(message) {
  const bounds = message.bounds;
  const pitch = Number(message.pitch) || 1;
  const cellSize = Number(message.cellSize) || pitch;
  const nx = Math.max(1, Math.floor(Number(message.nx) || 1));
  const ny = Math.max(1, Math.floor(Number(message.ny) || 1));
  const nz = Math.max(1, Math.floor(Number(message.nz) || 1));
  const xy = Math.max(0, Number(message.clearance?.xy_mm) || 0);
  const zClearance = Math.max(0, Number(message.clearance?.z_mm) || 0);
  const safety = Math.max(0.04, pitch * 0.9);
  const effectiveXy = xy + safety;
  const effectiveZ = zClearance + safety;
  const pad = Math.max(effectiveXy, effectiveZ, pitch * 2);
  const supportMesh = {
    vertices: typedArrayView(message.supportVertices, Float32Array),
    triangles: typedArrayView(message.supportTriangles, Uint32Array),
  };
  const modelVertices = typedArrayView(message.modelVertices, Float32Array);
  const supportSampler = buildSupportTopSampler(supportMesh, Math.max(pitch, cellSize));
  const modelProjectionMesh = indexedProjectionMeshFromTriangleVertices(modelVertices);
  const modelProjectionSampler = buildSupportTopSampler(modelProjectionMesh, Math.max(0.25, Math.max(pitch, effectiveXy)));
  const modelBounds = meshBounds(modelProjectionMesh);
  const modelClearanceOffsets = voxelClearanceOffsets(effectiveXy, effectiveZ, pitch);

  return {
    bounds,
    pitch,
    cellSize,
    nx,
    ny,
    nz,
    xy,
    zClearance,
    safety,
    effectiveXy,
    effectiveZ,
    pad,
    supportMesh,
    supportSampler,
    modelProjectionMesh,
    modelProjectionSampler,
    modelBounds,
    modelClearanceOffsets,
  };
}

function typedArrayView(value, Type) {
  if (value instanceof Type) return value;
  if (value instanceof ArrayBuffer) return new Type(value);
  if (ArrayBuffer.isView(value)) return new Type(value.buffer, value.byteOffset, Math.floor(value.byteLength / Type.BYTES_PER_ELEMENT));
  return new Type(value ?? []);
}

function buildVoxelTile(tile) {
  const {
    bounds,
    pitch,
    cellSize,
    nx,
    ny,
    nz,
    safety,
    effectiveXy,
    effectiveZ,
    pad,
    supportMesh,
    supportSampler,
    modelProjectionMesh,
    modelProjectionSampler,
    modelBounds,
    modelClearanceOffsets,
  } = context;
  const colStart = Math.max(0, Math.floor(Number(tile.colStart) || 0));
  const colEnd = Math.min(nx, Math.max(colStart, Math.floor(Number(tile.colEnd) || nx)));
  const haloCols = Math.max(1, Math.floor(Number(tile.haloCols) || 1));
  const rowStart = Math.max(0, Math.floor(Number(tile.rowStart) || 0));
  const rowEnd = Math.min(ny, Math.max(rowStart, Math.floor(Number(tile.rowEnd) || rowStart)));
  const haloRows = Math.max(1, Math.floor(Number(tile.haloRows) || 1));
  const scanColStart = Math.max(0, colStart - haloCols);
  const scanColEnd = Math.min(nx, colEnd + haloCols);
  const scanRowStart = Math.max(0, rowStart - haloRows);
  const scanRowEnd = Math.min(ny, rowEnd + haloRows);
  const localCols = Math.max(0, scanColEnd - scanColStart);
  const localRows = Math.max(0, scanRowEnd - scanRowStart);
  const localVoxelCount = Math.max(1, localCols * localRows * nz);
  const occupied = new Uint8Array(localVoxelCount);
  const linearIndex = (ix, iy, iz) => ((iz * localRows) + (iy - scanRowStart)) * localCols + (ix - scanColStart);
  const occupiedAt = (ix, iy, iz) =>
    ix >= scanColStart && ix < scanColEnd &&
    iy >= scanRowStart && iy < scanRowEnd &&
    iz >= 0 && iz < nz &&
    occupied[linearIndex(ix, iy, iz)] === 1;

  let activeColumns = 0;
  let sourceVoxels = 0;
  let keptVoxels = 0;
  let removedVoxels = 0;
  let liftLockRemovedVoxels = 0;
  let insideSamples = 0;
  let clearanceSamples = 0;
  let minDistance = Infinity;
  const modelIntervalCache = new Map();

  for (let iy = scanRowStart; iy < scanRowEnd; iy += 1) {
    const y = bounds.min.y + (iy + 0.5) * pitch;
    for (let ix = scanColStart; ix < scanColEnd; ix += 1) {
      const x = bounds.min.x + (ix + 0.5) * pitch;
      const sourceIntervals = supportZIntervalsAtXY(supportMesh, x, y, supportSampler);
      const sourceTop = sourceIntervals.length ? sourceIntervals[sourceIntervals.length - 1][1] : -Infinity;
      if (!Number.isFinite(sourceTop) || sourceTop <= bounds.min.z + pitch * 0.2) continue;
      const coreColumn = ix >= colStart && ix < colEnd && iy >= rowStart && iy < rowEnd;
      if (coreColumn) activeColumns += 1;
      const zMax = Math.min(nz - 1, Math.floor((sourceTop - bounds.min.z) / pitch));
      const nearModelXY =
        x >= modelBounds.min.x - pad && x <= modelBounds.max.x + pad &&
        y >= modelBounds.min.y - pad && y <= modelBounds.max.y + pad;
      const modelIntervals = nearModelXY
        ? modelClearanceIntervalsAtXY(
            modelProjectionMesh,
            modelProjectionSampler,
            x,
            y,
            modelClearanceOffsets,
            modelIntervalCache
          )
        : [];
      const firstBlockZ = modelIntervals.length ? modelIntervals[0][0] : Infinity;

      for (let iz = 0; iz <= zMax; iz += 1) {
        const z = bounds.min.z + (iz + 0.5) * pitch;
        if (z > sourceTop + pitch * 0.5) continue;
        const coreVoxel = coreColumn;
        const sourceVoxel = zInsideIntervals(z, sourceIntervals);
        if (!sourceVoxel) continue;
        if (coreVoxel) sourceVoxels += 1;
        const directForbidden = zInsideIntervals(z, modelIntervals);
        const liftBlocked = z >= firstBlockZ - 0.0001;

        if (directForbidden || liftBlocked) {
          if (coreVoxel) {
            removedVoxels += 1;
            if (directForbidden) {
              clearanceSamples += 1;
              minDistance = 0;
            } else {
              liftLockRemovedVoxels += 1;
              minDistance = Math.min(minDistance, Math.max(0, firstBlockZ - z));
            }
          }
        } else {
          occupied[linearIndex(ix, iy, iz)] = 1;
          if (coreVoxel) keptVoxels += 1;
        }
      }
    }
  }

  const mesh = voxelOccupancyToSupportMesh({
    bounds,
    pitch,
    scanColStart,
    scanRowStart,
    localCols,
    localRows,
    colStart,
    colEnd,
    rowStart,
    rowEnd,
    nz,
    occupied,
    occupiedAt,
    cellSize,
  });

  return {
    mesh,
    qa: {
      source_voxels: sourceVoxels,
      kept_voxels: keptVoxels,
      removed_voxels: removedVoxels,
      lift_lock_removed_voxels: liftLockRemovedVoxels,
      sampled_columns: activeColumns,
      inside_samples: insideSamples,
      clearance_violation_samples: clearanceSamples,
      min_distance_mm: Number.isFinite(minDistance) ? minDistance : 0,
    },
  };
}

function voxelOccupancyToSupportMesh({ bounds, pitch, scanColStart, scanRowStart, localCols, localRows, colStart, colEnd, rowStart, rowEnd, nz, occupied, occupiedAt, cellSize }) {
  const vertices = [];
  const triangles = [];
  const addVertex = (x, y, z) => {
    const index = vertices.length / 3;
    vertices.push(roundedCoordinate(x), roundedCoordinate(y), roundedCoordinate(z));
    return index;
  };
  const addQuad = (a, b, c, d) => {
    triangles.push(a, b, c, a, c, d);
  };
  const addFace = (ix, iy, iz, face) => {
    const x0 = bounds.min.x + ix * pitch;
    const y0 = bounds.min.y + iy * pitch;
    const z0 = bounds.min.z + iz * pitch;
    const x1 = x0 + pitch;
    const y1 = y0 + pitch;
    const z1 = z0 + pitch;
    if (face === "-x") {
      addQuad(addVertex(x0, y0, z0), addVertex(x0, y0, z1), addVertex(x0, y1, z1), addVertex(x0, y1, z0));
    } else if (face === "+x") {
      addQuad(addVertex(x1, y0, z0), addVertex(x1, y1, z0), addVertex(x1, y1, z1), addVertex(x1, y0, z1));
    } else if (face === "-y") {
      addQuad(addVertex(x0, y0, z0), addVertex(x1, y0, z0), addVertex(x1, y0, z1), addVertex(x0, y0, z1));
    } else if (face === "+y") {
      addQuad(addVertex(x0, y1, z0), addVertex(x0, y1, z1), addVertex(x1, y1, z1), addVertex(x1, y1, z0));
    } else if (face === "-z") {
      addQuad(addVertex(x0, y0, z0), addVertex(x0, y1, z0), addVertex(x1, y1, z0), addVertex(x1, y0, z0));
    } else if (face === "+z") {
      addQuad(addVertex(x0, y0, z1), addVertex(x1, y0, z1), addVertex(x1, y1, z1), addVertex(x0, y1, z1));
    }
  };

  for (let iz = 0; iz < nz; iz += 1) {
    for (let localIy = 0; localIy < localRows; localIy += 1) {
      const iy = scanRowStart + localIy;
      if (iy < rowStart || iy >= rowEnd) continue;
      const rowBase = (iz * localRows + localIy) * localCols;
      for (let localIx = 0; localIx < localCols; localIx += 1) {
        const ix = scanColStart + localIx;
        if (ix < colStart || ix >= colEnd) continue;
        if (occupied[rowBase + localIx] !== 1) continue;
        if (!occupiedAt(ix - 1, iy, iz)) addFace(ix, iy, iz, "-x");
        if (!occupiedAt(ix + 1, iy, iz)) addFace(ix, iy, iz, "+x");
        if (!occupiedAt(ix, iy - 1, iz)) addFace(ix, iy, iz, "-y");
        if (!occupiedAt(ix, iy + 1, iz)) addFace(ix, iy, iz, "+y");
        if (!occupiedAt(ix, iy, iz - 1)) addFace(ix, iy, iz, "-z");
        if (!occupiedAt(ix, iy, iz + 1)) addFace(ix, iy, iz, "+z");
      }
    }
  }

  return {
    vertices: new Float32Array(vertices),
    triangles: new Uint32Array(triangles),
    triangle_count: Math.floor(triangles.length / 3),
    cell_size_mm: cellSize,
  };
}

function buildSupportTopSampler(mesh, binSize) {
  const vertices = mesh.vertices ?? [];
  const triangles = mesh.triangles ?? [];
  const size = Math.max(0.25, Number(binSize) || 1);
  const bins = new Map();
  const binCoord = (value) => Math.floor(value / size);
  const binKeyFromCoord = (ix, iy) => `${ix}:${iy}`;
  const binKey = (x, y) => binKeyFromCoord(binCoord(x), binCoord(y));
  const addToBin = (key, index) => {
    const bucket = bins.get(key);
    if (bucket) bucket.push(index);
    else bins.set(key, [index]);
  };
  const pad = 0.00001;

  for (let index = 0; index + 2 < triangles.length; index += 3) {
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-9) continue;
    const minIx = binCoord(Math.min(a.x, b.x, c.x) - pad);
    const maxIx = binCoord(Math.max(a.x, b.x, c.x) + pad);
    const minIy = binCoord(Math.min(a.y, b.y, c.y) - pad);
    const maxIy = binCoord(Math.max(a.y, b.y, c.y) + pad);
    for (let iy = minIy; iy <= maxIy; iy += 1) {
      for (let ix = minIx; ix <= maxIx; ix += 1) {
        addToBin(binKeyFromCoord(ix, iy), index);
      }
    }
  }

  return { vertices, triangles, bins, binKey };
}

function supportTopAtXY(mesh, x, y, sampler) {
  const vertices = sampler?.vertices ?? mesh?.vertices ?? [];
  const triangles = sampler?.triangles ?? mesh?.triangles ?? [];
  const triangleStarts = sampler ? sampler.bins.get(sampler.binKey(x, y)) ?? [] : null;
  let top = -Infinity;
  const scanCount = triangleStarts ? triangleStarts.length : Math.floor(triangles.length / 3);

  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const index = triangleStarts ? triangleStarts[scanIndex] : scanIndex * 3;
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const z = triangleZAtXY(a, b, c, x, y);
    if (Number.isFinite(z)) top = Math.max(top, z);
  }
  return top;
}

function supportZIntervalsAtXY(mesh, x, y, sampler) {
  const vertices = sampler?.vertices ?? mesh?.vertices ?? [];
  const triangles = sampler?.triangles ?? mesh?.triangles ?? [];
  const triangleStarts = sampler ? sampler.bins.get(sampler.binKey(x, y)) ?? [] : null;
  const hits = [];
  const scanCount = triangleStarts ? triangleStarts.length : Math.floor(triangles.length / 3);

  for (let scanIndex = 0; scanIndex < scanCount; scanIndex += 1) {
    const index = triangleStarts ? triangleStarts[scanIndex] : scanIndex * 3;
    const a = readSupportVertex(vertices, triangles[index]);
    const b = readSupportVertex(vertices, triangles[index + 1]);
    const c = readSupportVertex(vertices, triangles[index + 2]);
    const z = triangleZAtXY(a, b, c, x, y);
    if (Number.isFinite(z)) hits.push(roundedCoordinate(z));
  }
  if (!hits.length) return [];
  hits.sort((a, b) => a - b);

  const unique = [];
  for (const hit of hits) {
    if (unique.length && Math.abs(hit - unique[unique.length - 1]) <= 0.0001) continue;
    unique.push(hit);
  }

  const intervals = [];
  for (let index = 0; index + 1 < unique.length; index += 2) {
    if (unique[index + 1] > unique[index] + 0.0001) intervals.push([unique[index], unique[index + 1]]);
  }
  return intervals;
}

function zInsideIntervals(z, intervals) {
  for (const interval of intervals) {
    if (z >= interval[0] - 0.0001 && z <= interval[1] + 0.0001) return true;
  }
  return false;
}

function zVoxelOverlapsIntervals(z, pitch, intervals) {
  const half = Math.max(0.0001, Number(pitch) || 0) * 0.5;
  const minZ = z - half;
  const maxZ = z + half;
  for (const interval of intervals) {
    if (maxZ >= interval[0] - 0.0001 && minZ <= interval[1] + 0.0001) return true;
  }
  return false;
}

function indexedProjectionMeshFromTriangleVertices(vertices) {
  const source = vertices instanceof Float32Array ? vertices : new Float32Array(vertices ?? []);
  const vertexCount = Math.floor(source.length / 3);
  const triangles = new Uint32Array(vertexCount);
  for (let index = 0; index < vertexCount; index += 1) triangles[index] = index;
  return {
    vertices: source,
    triangles,
    triangle_count: Math.floor(vertexCount / 3),
  };
}

function meshBounds(mesh) {
  const vertices = mesh?.vertices ?? [];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    const x = vertices[index];
    const y = vertices[index + 1];
    const z = vertices[index + 2];
    min.x = Math.min(min.x, x);
    min.y = Math.min(min.y, y);
    min.z = Math.min(min.z, z);
    max.x = Math.max(max.x, x);
    max.y = Math.max(max.y, y);
    max.z = Math.max(max.z, z);
  }
  if (!Number.isFinite(min.x)) {
    min.x = 0;
    min.y = 0;
    min.z = 0;
    max.x = 0;
    max.y = 0;
    max.z = 0;
  }
  return { min, max };
}

function voxelClearanceOffsets(effectiveXy, effectiveZ, pitch) {
  const radius = Math.max(0, Number(effectiveXy) || 0);
  const zInflate = Math.max(0, Number(effectiveZ) || 0);
  const offsets = [{ dx: 0, dy: 0, zInflate, distance: 0 }];
  if (radius <= 0.0001) return offsets;

  const spacing = radius < pitch
    ? radius
    : Math.max(Math.max(0.2, pitch), radius / 4);
  const steps = Math.max(1, Math.ceil(radius / Math.max(0.0001, spacing)));
  const seen = new Set(["0:0"]);
  for (let oy = -steps; oy <= steps; oy += 1) {
    for (let ox = -steps; ox <= steps; ox += 1) {
      if (ox === 0 && oy === 0) continue;
      const dx = ox * spacing;
      const dy = oy * spacing;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance > radius + 0.0001) continue;
      const key = `${roundedCoordinate(dx)}:${roundedCoordinate(dy)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offsets.push({ dx, dy, zInflate, distance });
    }
  }
  offsets.sort((a, b) => a.distance - b.distance);
  return offsets;
}

function modelClearanceIntervalsAtXY(mesh, sampler, x, y, offsets, cache) {
  const expanded = [];
  for (const offset of offsets) {
    const sx = x + offset.dx;
    const sy = y + offset.dy;
    const key = `${Math.round(sx * 1000)}:${Math.round(sy * 1000)}`;
    let intervals = cache.get(key);
    if (!intervals) {
      intervals = supportZIntervalsAtXY(mesh, sx, sy, sampler);
      cache.set(key, intervals);
    }
    for (const interval of intervals) {
      expanded.push([
        interval[0] - offset.zInflate,
        interval[1] + offset.zInflate,
      ]);
    }
  }
  return mergeZIntervals(expanded);
}

function mergeZIntervals(intervals) {
  if (!intervals.length) return [];
  intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const interval of intervals) {
    if (!merged.length || interval[0] > merged[merged.length - 1][1] + 0.0001) {
      merged.push([interval[0], interval[1]]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], interval[1]);
    }
  }
  return merged;
}

function triangleZAtXY(a, b, c, x, y) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-9) return NaN;
  const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
  const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
  const w = 1 - u - v;
  if (u < -0.000001 || v < -0.000001 || w < -0.000001) return NaN;
  return a.z * u + b.z * v + c.z * w;
}

function buildModelIndex(vertices, searchRadius) {
  const triangles = [];
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (let index = 0; index + 8 < vertices.length; index += 9) {
    const a = { x: vertices[index], y: vertices[index + 1], z: vertices[index + 2] };
    const b = { x: vertices[index + 3], y: vertices[index + 4], z: vertices[index + 5] };
    const c = { x: vertices[index + 6], y: vertices[index + 7], z: vertices[index + 8] };
    const triangle = {
      a,
      b,
      c,
      minY: Math.min(a.y, b.y, c.y),
      maxY: Math.max(a.y, b.y, c.y),
      minZ: Math.min(a.z, b.z, c.z),
      maxZ: Math.max(a.z, b.z, c.z),
    };
    bounds.min.x = Math.min(bounds.min.x, a.x, b.x, c.x);
    bounds.min.y = Math.min(bounds.min.y, a.y, b.y, c.y);
    bounds.min.z = Math.min(bounds.min.z, a.z, b.z, c.z);
    bounds.max.x = Math.max(bounds.max.x, a.x, b.x, c.x);
    bounds.max.y = Math.max(bounds.max.y, a.y, b.y, c.y);
    bounds.max.z = Math.max(bounds.max.z, a.z, b.z, c.z);
    triangles.push(triangle);
  }
  return buildSpatialIndexFromTriangles(triangles, bounds, searchRadius);
}

function buildSpatialIndexFromTriangles(triangles, bounds, searchRadius) {
  if (!Number.isFinite(bounds.min.x)) {
    bounds.min = { x: 0, y: 0, z: 0 };
    bounds.max = { x: 0, y: 0, z: 0 };
  }
  const spanY = Math.max(1, bounds.max.y - bounds.min.y);
  const spanZ = Math.max(1, bounds.max.z - bounds.min.z);
  const binSize = Math.max(1.5, searchRadius * 2, Math.min(spanY, spanZ) / 128);
  const binCoordY = (value) => Math.floor((value - bounds.min.y) / binSize);
  const binCoordZ = (value) => Math.floor((value - bounds.min.z) / binSize);
  const binKey = (iy, iz) => `${iy}:${iz}`;
  const bins = new Map();
  const largeTriangles = [];

  for (const triangle of triangles) {
    const minIy = binCoordY(triangle.minY);
    const maxIy = binCoordY(triangle.maxY);
    const minIz = binCoordZ(triangle.minZ);
    const maxIz = binCoordZ(triangle.maxZ);
    const binCount = (maxIy - minIy + 1) * (maxIz - minIz + 1);
    if (binCount > 160) {
      largeTriangles.push(triangle);
      continue;
    }
    for (let iz = minIz; iz <= maxIz; iz += 1) {
      for (let iy = minIy; iy <= maxIy; iy += 1) {
        const key = binKey(iy, iz);
        const bucket = bins.get(key);
        if (bucket) bucket.push(triangle);
        else bins.set(key, [triangle]);
      }
    }
  }

  return { triangles, bins, largeTriangles, bounds, binSize, binCoordY, binCoordZ, binKey };
}

function modelCandidatesAtYZ(point, modelIndex, radiusBins = 0) {
  const iy = modelIndex.binCoordY(point.y);
  const iz = modelIndex.binCoordZ(point.z);
  const seen = new Set();
  const candidates = [];
  for (let dz = -radiusBins; dz <= radiusBins; dz += 1) {
    for (let dy = -radiusBins; dy <= radiusBins; dy += 1) {
      const bucket = modelIndex.bins.get(modelIndex.binKey(iy + dy, iz + dz));
      if (!bucket) continue;
      for (const triangle of bucket) {
        if (seen.has(triangle)) continue;
        seen.add(triangle);
        candidates.push(triangle);
      }
    }
  }
  for (const triangle of modelIndex.largeTriangles) {
    if (seen.has(triangle)) continue;
    seen.add(triangle);
    candidates.push(triangle);
  }
  return candidates;
}

function closestModelVector(point, modelIndex, searchRadius) {
  let minSquared = Infinity;
  let closestPoint = null;
  const maxRadiusBins = Math.max(1, Math.min(10, Math.ceil((searchRadius * 2) / modelIndex.binSize) + 1));
  for (let radiusBins = 0; radiusBins <= maxRadiusBins; radiusBins += 1) {
    const candidates = modelCandidatesAtYZ(point, modelIndex, radiusBins);
    for (const triangle of candidates) {
      const closest = closestPointOnTriangle(point, triangle.a, triangle.b, triangle.c);
      const squared = pointDistanceSquared(point, closest);
      if (squared < minSquared) {
        minSquared = squared;
        closestPoint = closest;
      }
    }
    if (minSquared <= searchRadius * searchRadius) break;
    if (candidates.length && radiusBins >= 2) break;
  }
  if (!closestPoint) {
    return { delta: { x: searchRadius * 2, y: 0, z: 0 }, distance: searchRadius * 2 };
  }
  const delta = {
    x: point.x - closestPoint.x,
    y: point.y - closestPoint.y,
    z: point.z - closestPoint.z,
  };
  return { delta, distance: Math.sqrt(minSquared) };
}

function closestPointOnTriangle(point, a, b, c) {
  const ab = subtractPoint(b, a);
  const ac = subtractPoint(c, a);
  const ap = subtractPoint(point, a);
  const d1 = dotPoint(ab, ap);
  const d2 = dotPoint(ac, ap);
  if (d1 <= 0 && d2 <= 0) return a;
  const bp = subtractPoint(point, b);
  const d3 = dotPoint(ab, bp);
  const d4 = dotPoint(ac, bp);
  if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { x: a.x + ab.x * v, y: a.y + ab.y * v, z: a.z + ab.z * v };
  }
  const cp = subtractPoint(point, c);
  const d5 = dotPoint(ab, cp);
  const d6 = dotPoint(ac, cp);
  if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { x: a.x + ac.x * w, y: a.y + ac.y * w, z: a.z + ac.z * w };
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const bc = subtractPoint(c, b);
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { x: b.x + bc.x * w, y: b.y + bc.y * w, z: b.z + bc.z * w };
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return {
    x: a.x + ab.x * v + ac.x * w,
    y: a.y + ab.y * v + ac.y * w,
    z: a.z + ab.z * v + ac.z * w,
  };
}

function pointInsideModel(point, modelIndex) {
  if (point.x > modelIndex.bounds.max.x + 0.0001 ||
    point.y < modelIndex.bounds.min.y - 0.0001 ||
    point.y > modelIndex.bounds.max.y + 0.0001 ||
    point.z < modelIndex.bounds.min.z - 0.0001 ||
    point.z > modelIndex.bounds.max.z + 0.0001) {
    return false;
  }
  const hits = [];
  const candidates = modelCandidatesAtYZ(point, modelIndex, 0);
  for (const triangle of candidates) {
    if (point.y < triangle.minY - 1e-7 || point.y > triangle.maxY + 1e-7 ||
      point.z < triangle.minZ - 1e-7 || point.z > triangle.maxZ + 1e-7) {
      continue;
    }
    const t = rayTriangleIntersectionX(point, triangle.a, triangle.b, triangle.c);
    if (Number.isFinite(t) && t > 0.000001) hits.push(roundedCoordinate(t));
  }
  hits.sort((a, b) => a - b);
  let uniqueHits = 0;
  let prior = -Infinity;
  for (const hit of hits) {
    if (Math.abs(hit - prior) <= 0.0001) continue;
    uniqueHits += 1;
    prior = hit;
  }
  return uniqueHits % 2 === 1;
}

function rayTriangleIntersectionX(origin, a, b, c) {
  const edge1 = subtractPoint(b, a);
  const edge2 = subtractPoint(c, a);
  const h = { x: 0, y: -edge2.z, z: edge2.y };
  const determinant = dotPoint(edge1, h);
  if (Math.abs(determinant) < 1e-9) return NaN;
  const f = 1 / determinant;
  const s = subtractPoint(origin, a);
  const u = f * dotPoint(s, h);
  if (u < -0.000001 || u > 1.000001) return NaN;
  const q = crossPoint(s, edge1);
  const v = f * q.x;
  if (v < -0.000001 || u + v > 1.000001) return NaN;
  const t = f * dotPoint(edge2, q);
  return t > 0.000001 ? t : NaN;
}

function anisotropicClearanceMetric(delta, xy, z) {
  const dx = delta?.x ?? 0;
  const dy = delta?.y ?? 0;
  const dz = delta?.z ?? 0;
  if (xy <= 0.001 && z <= 0.001) return Infinity;
  const xyTerm = xy > 0.001 ? ((dx * dx + dy * dy) / (xy * xy)) : (dx * dx + dy * dy > 0.000001 ? Infinity : 0);
  const zTerm = z > 0.001 ? ((dz * dz) / (z * z)) : (Math.abs(dz) > 0.000001 ? Infinity : 0);
  return Math.sqrt(xyTerm + zTerm);
}

function readSupportVertex(vertices, index) {
  const offset = index * 3;
  return { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
}

function subtractPoint(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function crossPoint(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dotPoint(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function pointDistanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function roundedCoordinate(value) {
  return Math.round(value * 100000) / 100000;
}
