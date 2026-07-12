export const CLEARANCE_CERTIFICATE_AXIS_GUARD_MM = 0.001;
export const CLEARANCE_CERTIFICATE_NORMALIZED_GUARD = 0.0001;
const CLEARANCE_CERTIFICATE_MIN_AXIS_MM = 0.001;
const CLEARANCE_CERTIFICATE_RETURN_TOLERANCE = 1e-9;

export function measureCenteredMeshInradius(mesh) {
  if (!mesh || typeof mesh !== "object") {
    throw new TypeError("centered inradius requires a Manifold mesh object");
  }

  const vertices = mesh.vertProperties;
  const triangles = mesh.triVerts;
  if (!isIndexableArray(vertices)) {
    throw new TypeError("mesh.vertProperties must be an array or typed array");
  }
  if (!isIndexableArray(triangles)) {
    throw new TypeError("mesh.triVerts must be an array or typed array");
  }

  const numProp = mesh.numProp ?? 3;
  if (!Number.isSafeInteger(numProp) || numProp < 3) {
    throw new RangeError("mesh.numProp must be an integer of at least 3");
  }
  if (vertices.length % numProp !== 0) {
    throw new RangeError("mesh.vertProperties length must be divisible by mesh.numProp");
  }
  if (triangles.length % 3 !== 0) {
    throw new RangeError("mesh.triVerts length must be divisible by 3");
  }

  const vertexCount = vertices.length / numProp;
  const triangleCount = triangles.length / 3;
  if (vertexCount < 4) {
    throw new RangeError("a closed convex mesh requires at least four vertices");
  }
  if (triangleCount < 4) {
    throw new RangeError("a closed convex mesh requires at least four triangles");
  }
  validateMeshCount(mesh.numVert, vertexCount, "numVert");
  validateMeshCount(mesh.numTri, triangleCount, "numTri");

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    const offset = vertex * numProp;
    for (let axis = 0; axis < 3; axis += 1) {
      if (!Number.isFinite(vertices[offset + axis])) {
        throw new RangeError(`mesh vertex ${vertex} has a non-finite position`);
      }
    }
  }

  let inradius = Infinity;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const offset = triangle * 3;
    const a = triangles[offset];
    const b = triangles[offset + 1];
    const c = triangles[offset + 2];
    if (!isVertexIndex(a, vertexCount) ||
        !isVertexIndex(b, vertexCount) ||
        !isVertexIndex(c, vertexCount)) {
      throw new RangeError(`mesh triangle ${triangle} has an invalid vertex index`);
    }

    const distance = facePlaneDistanceFromOrigin(vertices, numProp, a, b, c, triangle);
    inradius = Math.min(inradius, distance);
  }

  if (!Number.isFinite(inradius) || inradius <= 0) {
    throw new RangeError("centered mesh inradius must be finite and positive");
  }
  return inradius;
}

function facePlaneDistanceFromOrigin(vertices, stride, aIndex, bIndex, cIndex, triangle) {
  const aOffset = aIndex * stride;
  const bOffset = bIndex * stride;
  const cOffset = cIndex * stride;
  const raw = [
    vertices[aOffset], vertices[aOffset + 1], vertices[aOffset + 2],
    vertices[bOffset], vertices[bOffset + 1], vertices[bOffset + 2],
    vertices[cOffset], vertices[cOffset + 1], vertices[cOffset + 2],
  ];
  const coordinateScale = Math.max(...raw.map(Math.abs));
  if (!(coordinateScale > 0) || !Number.isFinite(coordinateScale)) {
    throw new RangeError(`mesh triangle ${triangle} is degenerate`);
  }

  const [ax, ay, az, bx, by, bz, cx, cy, cz] = raw.map((value) => value / coordinateScale);
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const abScale = Math.max(Math.abs(abx), Math.abs(aby), Math.abs(abz));
  const acScale = Math.max(Math.abs(acx), Math.abs(acy), Math.abs(acz));
  if (!(abScale > 0) || !(acScale > 0)) {
    throw new RangeError(`mesh triangle ${triangle} is degenerate`);
  }

  const nx = (aby / abScale) * (acz / acScale) - (abz / abScale) * (acy / acScale);
  const ny = (abz / abScale) * (acx / acScale) - (abx / abScale) * (acz / acScale);
  const nz = (abx / abScale) * (acy / acScale) - (aby / abScale) * (acx / acScale);
  const normalLength = Math.hypot(nx, ny, nz);
  if (!(normalLength > 0) || !Number.isFinite(normalLength)) {
    throw new RangeError(`mesh triangle ${triangle} is degenerate`);
  }

  const scaledDistance = Math.abs(nx * ax + ny * ay + nz * az) / normalLength;
  const distance = scaledDistance * coordinateScale;
  if (!(distance > 0) || !Number.isFinite(distance)) {
    throw new RangeError(`mesh triangle ${triangle} has no finite positive distance from the origin`);
  }
  return distance;
}

function isIndexableArray(value) {
  return Array.isArray(value) ||
    (ArrayBuffer.isView(value) && typeof value.length === "number");
}

function isVertexIndex(value, vertexCount) {
  return Number.isSafeInteger(value) && value >= 0 && value < vertexCount;
}

function validateMeshCount(value, expected, name) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value !== expected) {
    throw new RangeError(`mesh.${name} does not match its array data`);
  }
}

export function continuousClearanceCertificateSettings(clearance = {}) {
  const requestedXy = Math.max(0, Number(clearance?.xy_mm) || 0);
  const requestedZ = Math.max(0, Number(clearance?.z_mm) || 0);
  const expanded = Math.max(requestedXy, requestedZ) > CLEARANCE_CERTIFICATE_MIN_AXIS_MM;
  const supported = expanded &&
    requestedXy > CLEARANCE_CERTIFICATE_MIN_AXIS_MM &&
    requestedZ > CLEARANCE_CERTIFICATE_MIN_AXIS_MM;
  const effectiveXy = requestedXy + CLEARANCE_CERTIFICATE_AXIS_GUARD_MM;
  const effectiveZ = requestedZ + CLEARANCE_CERTIFICATE_AXIS_GUARD_MM;

  return {
    supported,
    reason: supported
      ? ""
      : expanded
        ? "continuous ellipsoid certification requires positive XY and Z clearance axes"
        : "expanded clearance certification is not required",
    metric: "continuous-ellipsoid",
    requested_xy_mm: requestedXy,
    requested_z_mm: requestedZ,
    axis_guard_mm: CLEARANCE_CERTIFICATE_AXIS_GUARD_MM,
    effective_xy_mm: effectiveXy,
    effective_z_mm: effectiveZ,
    normalized_guard: CLEARANCE_CERTIFICATE_NORMALIZED_GUARD,
    search_length: 1 + CLEARANCE_CERTIFICATE_NORMALIZED_GUARD,
    scale: supported
      ? [1 / effectiveXy, 1 / effectiveXy, 1 / effectiveZ]
      : null,
  };
}

export function certifyContinuousClearance(
  modelSolid,
  targets,
  clearance = {},
  options = {}
) {
  const settings = continuousClearanceCertificateSettings(clearance);
  const witnessRequest = continuousClearanceWitnessRequest(options);
  const certificate = {
    attempted: false,
    available: false,
    passed: false,
    reason: settings.reason,
    metric: settings.metric,
    requested_xy_mm: settings.requested_xy_mm,
    requested_z_mm: settings.requested_z_mm,
    axis_guard_mm: settings.axis_guard_mm,
    effective_xy_mm: settings.effective_xy_mm,
    effective_z_mm: settings.effective_z_mm,
    normalized_guard: settings.normalized_guard,
    search_length: settings.search_length,
    normalized_gap_lower_bound: 0,
    targets: [],
    timings: [],
  };
  if (!settings.supported) return certificate;

  const candidates = (Array.isArray(targets) ? targets : [targets])
    .filter((target) => target?.solid);
  certificate.attempted = true;
  if (!modelSolid || typeof modelSolid.minGap !== "function") {
    certificate.reason = "this Manifold build does not expose the public minGap API";
    return certificate;
  }
  if (!candidates.length) {
    certificate.reason = "no cradle or interface solid was available to certify";
    return certificate;
  }

  let modelScaled = null;
  const scaledTargets = [];
  const measure = (label, operation) => {
    const startedAt = performance.now();
    const value = operation();
    certificate.timings.push({ label, ms: performance.now() - startedAt });
    return value;
  };

  try {
    modelScaled = measure("certificate scale model", () => modelSolid.scale(settings.scale));
    let minimumGap = settings.search_length;
    let passed = true;
    for (const target of candidates) {
      const label = String(target.label || "target");
      const scaled = measure(`certificate scale ${label}`, () => target.solid.scale(settings.scale));
      scaledTargets.push(scaled);
      const gap = measure(`certificate ${label} min gap`, () => modelScaled.minGap(scaled, settings.search_length));
      const targetPassed = Number.isFinite(gap) &&
        gap >= settings.search_length - CLEARANCE_CERTIFICATE_RETURN_TOLERANCE;
      minimumGap = Math.min(minimumGap, Number.isFinite(gap) ? gap : 0);
      passed = passed && targetPassed;
      const witnesses = [];
      if (!targetPassed && witnessRequest.max_witnesses > 1 &&
          typeof modelScaled.minGapDetailsMany === "function") {
        const details = measure(
          `certificate ${label} min gap witnesses`,
          () => modelScaled.minGapDetailsMany(
            scaled,
            settings.search_length,
            witnessRequest.max_witnesses,
            witnessRequest.target_cell_size_normalized
          )
        );
        for (let offset = 0;
          Array.isArray(details) && offset + 8 < details.length &&
          witnesses.length < witnessRequest.max_witnesses;
          offset += 9) {
          const witness = continuousClearanceWitnessFromDetails(details, offset, settings);
          if (witness) witnesses.push(witness);
        }
      }
      if (!targetPassed && !witnesses.length &&
          typeof modelScaled.minGapDetails === "function") {
        const details = measure(
          `certificate ${label} min gap witness`,
          () => modelScaled.minGapDetails(scaled, settings.search_length)
        );
        const witness = continuousClearanceWitnessFromDetails(details, 0, settings);
        if (witness) witnesses.push(witness);
      }
      certificate.targets.push({
        label,
        passed: targetPassed,
        normalized_gap_lower_bound: Number.isFinite(gap) ? gap : 0,
        ...(witnesses.length ? {
          witness: witnesses[0],
          witnesses,
        } : {}),
      });
    }

    certificate.available = true;
    certificate.passed = passed;
    certificate.normalized_gap_lower_bound = minimumGap;
    certificate.reason = passed
      ? "continuous ellipsoidal clearance certified"
      : "one or more target solids entered the guarded continuous clearance region";
  } catch (error) {
    certificate.reason = error?.message || String(error);
  } finally {
    for (const solid of scaledTargets) solid?.delete?.();
    modelScaled?.delete?.();
  }

  return certificate;
}

function continuousClearanceWitnessRequest(options = {}) {
  const requestedMax = Math.floor(Number(options?.max_witnesses) || 1);
  const requestedCell = options?.witness_target_cell_size_normalized;
  const targetCell = Array.isArray(requestedCell) && requestedCell.length >= 3
    ? requestedCell.slice(0, 3).map((value) => {
        const size = Number(value);
        return Number.isFinite(size) && size > 0 ? size : 1;
      })
    : [1, 1, 1];
  return {
    max_witnesses: Math.max(1, Math.min(64, requestedMax)),
    target_cell_size_normalized: targetCell,
  };
}

function continuousClearanceWitnessFromDetails(details, offset, settings) {
  if (!Array.isArray(details) || offset < 0 || offset + 8 >= details.length ||
      Number(details[offset + 1]) < 0 || Number(details[offset + 2]) < 0) {
    return null;
  }
  const toMillimetres = (coordinateOffset) => [
    Number(details[coordinateOffset]) / settings.scale[0],
    Number(details[coordinateOffset + 1]) / settings.scale[1],
    Number(details[coordinateOffset + 2]) / settings.scale[2],
  ];
  const modelPoint = toMillimetres(offset + 3);
  const targetPoint = toMillimetres(offset + 6);
  if (![Number(details[offset]), ...modelPoint, ...targetPoint].every(Number.isFinite)) {
    return null;
  }
  return {
    normalized_gap: Number(details[offset]),
    model_face: Number(details[offset + 1]),
    target_face: Number(details[offset + 2]),
    model_face_centroid_mm: modelPoint,
    target_face_centroid_mm: targetPoint,
  };
}
