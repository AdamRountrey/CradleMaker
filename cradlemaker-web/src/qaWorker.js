const QA_WORKER_VERSION = "targeted-mesh-qa-1";

self.onmessage = (event) => {
  const message = event.data ?? {};
  if (message.type !== "meshAndStabilityQa") return;

  try {
    const timings = [];
    let phaseStart = performance.now();
    const mark = (label) => {
      const now = performance.now();
      timings.push({ label, ms: now - phaseStart });
      phaseStart = now;
    };

    const mesh = message.mesh ?? {};
    const coverage = message.coverage ?? {};
    const cellSize = Number(message.cellSize) || Number(mesh.cell_size_mm) || 0.8;
    const centerOfMass = message.centerOfMass ?? null;

    const meshQa = evaluateCradleMeshSupportQa(mesh, coverage, cellSize);
    mark("mesh reach QA");
    const stabilityQa = evaluateCradleStabilityQa(mesh, coverage, cellSize, centerOfMass);
    mark("stability QA");

    self.postMessage({
      id: message.id,
      type: "meshAndStabilityQaResult",
      version: QA_WORKER_VERSION,
      meshQa,
      stabilityQa,
      timings,
    });
  } catch (error) {
    self.postMessage({
      id: message.id,
      type: "error",
      error: error?.message || String(error),
    });
  }
};

function evaluateCradleMeshSupportQa(mesh, coverage, cellSize) {
  const cells = coverage?.cells ?? [];
  const tolerance = Math.max(0.12, cellSize * 0.35);
  const expectedCells = cells.filter((cell) => cell?.[3]);
  const maxSamples = meshQaSampleLimit(mesh, expectedCells.length);
  const sampleStep = expectedCells.length > maxSamples ? expectedCells.length / maxSamples : 1;
  const sampledCells = [];
  for (let sampleIndex = 0; sampleIndex < expectedCells.length; sampleIndex += sampleStep) {
    sampledCells.push(expectedCells[Math.floor(sampleIndex)]);
  }
  const sampler = buildSupportTopSampler(mesh, Math.max(0.75, cellSize), sampledCells);
  let sampled = 0;
  let supported = 0;
  let unsupported = 0;
  let maxGap = 0;
  let maxOverreach = 0;

  for (const cell of sampledCells) {
    const [x, y, targetZ] = cell;
    const meshTop = supportTopAtXY(mesh, x, y, sampler);
    if (!Number.isFinite(meshTop)) {
      sampled += 1;
      unsupported += 1;
      maxGap = Math.max(maxGap, tolerance);
      continue;
    }

    sampled += 1;
    const gap = targetZ - meshTop;
    const overreach = meshTop - targetZ;
    maxGap = Math.max(maxGap, gap);
    maxOverreach = Math.max(maxOverreach, overreach);
    if (gap <= tolerance) supported += 1;
    else unsupported += 1;
  }

  return {
    sampled_cells: sampled,
    supported_cells: supported,
    unsupported_cells: unsupported,
    supported_percent: sampled ? (supported / sampled) * 100 : 0,
    max_gap_mm: roundedCoordinate(Math.max(0, maxGap)),
    max_overreach_mm: roundedCoordinate(Math.max(0, maxOverreach)),
    tolerance_mm: roundedCoordinate(tolerance),
  };
}

function evaluateCradleStabilityQa(mesh, coverage, cellSize, centerOfMass) {
  const cells = coverage?.cells ?? [];
  const supportedCells = cells
    .filter((cell) => cell?.[3])
    .map((cell) => ({ x: Number(cell[0]), y: Number(cell[1]), z: Number(cell[2]) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));

  if (!centerOfMass || supportedCells.length < 3) {
    return {
      available: false,
      severity: "idle",
      reason: supportedCells.length < 3 ? "not enough supported contact samples" : "model center of mass could not be estimated",
    };
  }

  const groundFootprint = cradleGroundFootprintSamples(mesh, cellSize);
  const hull = convexHull2d(groundFootprint.length >= 3 ? groundFootprint : supportedCells);
  if (hull.length < 3) {
    return {
      available: false,
      severity: "idle",
      reason: "cradle ground footprint is too narrow for a stability polygon",
      center_of_mass: centerOfMass.center,
      center_method: centerOfMass.method,
    };
  }

  const projection = { x: centerOfMass.center.x, y: centerOfMass.center.y };
  const inside = pointInConvexPolygon2d(projection, hull);
  const edgeDistance = distanceToPolygonEdges2d(projection, hull);
  const signedMargin = inside ? edgeDistance : -edgeDistance;
  const contactZ = median(supportedCells.map((point) => point.z));
  const heightAboveContact = Math.max(cellSize, centerOfMass.center.z - contactZ);
  const tipAngleDeg = inside ? (Math.atan2(Math.max(0, signedMargin), heightAboveContact) * 180) / Math.PI : 0;
  const footprintBounds = bounds2d(hull);
  const smallerSpan = Math.max(cellSize, Math.min(footprintBounds.max.x - footprintBounds.min.x, footprintBounds.max.y - footprintBounds.min.y));
  const marginRatio = signedMargin / smallerSpan;
  let severity = "ok";
  let risk = "stable";

  if (!inside) {
    severity = "error";
    risk = "outside";
  } else if (signedMargin < cellSize * 1.5 || tipAngleDeg < 5 || marginRatio < 0.04) {
    severity = "caution";
    risk = "near_edge";
  } else if (signedMargin < cellSize * 3 || tipAngleDeg < 10 || marginRatio < 0.08) {
    severity = "caution";
    risk = "modest_margin";
  }

  return {
    available: true,
    severity,
    risk,
    center_of_mass: centerOfMass.center,
    center_method: centerOfMass.method,
    confidence: centerOfMass.confidence,
    projection,
    supported_contact_samples: supportedCells.length,
    ground_contact_samples: groundFootprint.length,
    hull_points: hull.length,
    inside,
    signed_margin_mm: roundedCoordinate(signedMargin),
    edge_distance_mm: roundedCoordinate(edgeDistance),
    contact_z_mm: roundedCoordinate(contactZ),
    height_above_contact_mm: roundedCoordinate(heightAboveContact),
    tip_angle_deg: roundedCoordinate(tipAngleDeg),
    margin_ratio: roundedCoordinate(marginRatio),
  };
}

function buildSupportTopSampler(mesh, binSize, sampleCells = []) {
  const vertices = mesh?.vertices ?? [];
  const triangles = mesh?.triangles ?? [];
  const size = Math.max(0.25, Number(binSize) || 1);
  const bins = new Map();
  const binCoord = (value) => Math.floor(value / size);
  const binKeyFromCoord = (ix, iy) => `${ix}:${iy}`;
  const binKey = (x, y) => binKeyFromCoord(binCoord(x), binCoord(y));
  const targetBins = new Set();
  const targetBinCoords = [];
  for (const cell of sampleCells) {
    const ix = binCoord(cell?.[0]);
    const iy = binCoord(cell?.[1]);
    const key = binKeyFromCoord(ix, iy);
    if (targetBins.has(key)) continue;
    targetBins.add(key);
    targetBinCoords.push({ ix, iy, key });
  }
  const targetOnly = targetBins.size > 0;
  const pad = 0.00001;

  const addToBin = (key, index) => {
    const bucket = bins.get(key);
    if (bucket) bucket.push(index);
    else bins.set(key, [index]);
  };

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
    const binCount = (maxIx - minIx + 1) * (maxIy - minIy + 1);

    if (targetOnly && targetBinCoords.length < binCount) {
      for (const target of targetBinCoords) {
        if (target.ix >= minIx && target.ix <= maxIx && target.iy >= minIy && target.iy <= maxIy) {
          addToBin(target.key, index);
        }
      }
    } else {
      for (let iy = minIy; iy <= maxIy; iy += 1) {
        for (let ix = minIx; ix <= maxIx; ix += 1) {
          const key = binKeyFromCoord(ix, iy);
          if (!targetOnly || targetBins.has(key)) addToBin(key, index);
        }
      }
    }
  }

  return { vertices, triangles, bins, binKey };
}

function supportTopAtXY(mesh, x, y, sampler = null) {
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

function meshQaSampleLimit(mesh, targetCount) {
  const triangleCount = Math.floor((mesh?.triangles?.length ?? 0) / 3);
  if (triangleCount > 750000) return Math.min(targetCount, 6000);
  if (triangleCount > 250000) return Math.min(targetCount, 9000);
  return targetCount;
}

function cradleGroundFootprintSamples(mesh, cellSize) {
  const vertices = mesh?.vertices ?? [];
  if (vertices.length < 3) return [];

  let minZ = Infinity;
  for (let index = 2; index < vertices.length; index += 3) {
    minZ = Math.min(minZ, vertices[index]);
  }
  if (!Number.isFinite(minZ)) return [];

  const band = Math.max(1.5, cellSize * 1.75);
  const quant = Math.max(0.75, cellSize);
  const maxSamples = 24000;
  const samples = [];
  const seen = new Set();
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const qx = Math.round(x / quant) * quant;
    const qy = Math.round(y / quant) * quant;
    const key = `${qx}:${qy}`;
    if (seen.has(key)) return;
    seen.add(key);
    samples.push({ x: roundedCoordinate(qx), y: roundedCoordinate(qy) });
  };

  const vertexCount = Math.floor(vertices.length / 3);
  const stride = Math.max(1, Math.floor(vertexCount / maxSamples));
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += stride) {
    const offset = vertexIndex * 3;
    if (vertices[offset + 2] <= minZ + band) add(vertices[offset], vertices[offset + 1]);
  }

  return samples;
}

function readSupportVertex(vertices, index) {
  const offset = index * 3;
  return {
    x: vertices[offset] ?? 0,
    y: vertices[offset + 1] ?? 0,
    z: vertices[offset + 2] ?? 0,
  };
}

function triangleZAtXY(a, b, c, x, y) {
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-9) return NaN;
  const w1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
  const w2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
  const w3 = 1 - w1 - w2;
  const tolerance = -0.00001;
  if (w1 < tolerance || w2 < tolerance || w3 < tolerance) return NaN;
  return w1 * a.z + w2 * b.z + w3 * c.z;
}

function convexHull2d(points) {
  const unique = [...new Map(points.map((point) => [`${roundedCoordinate(point.x)}:${roundedCoordinate(point.y)}`, {
    x: roundedCoordinate(point.x),
    y: roundedCoordinate(point.y),
  }])).values()];
  unique.sort((a, b) => a.x - b.x || a.y - b.y);
  if (unique.length <= 2) return unique;

  const lower = [];
  for (const point of unique) {
    while (lower.length >= 2 && cross2d(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  const upper = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    while (upper.length >= 2 && cross2d(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function cross2d(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInConvexPolygon2d(point, polygon) {
  if (polygon.length < 3) return false;
  const tolerance = -1e-7;
  for (let index = 0; index < polygon.length; index += 1) {
    const a = polygon[index];
    const b = polygon[(index + 1) % polygon.length];
    if (cross2d(a, b, point) < tolerance) return false;
  }
  return true;
}

function distanceToPolygonEdges2d(point, polygon) {
  let distance = Infinity;
  for (let index = 0; index < polygon.length; index += 1) {
    distance = Math.min(distance, pointSegmentDistance2d(point, polygon[index], polygon[(index + 1) % polygon.length]));
  }
  return Number.isFinite(distance) ? distance : 0;
}

function pointSegmentDistance2d(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function bounds2d(points) {
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const point of points) {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
  }
  return { min, max };
}

function roundedCoordinate(value) {
  return Math.round(value * 100000) / 100000;
}
