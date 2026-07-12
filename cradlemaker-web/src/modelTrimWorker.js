import {
  certifyContinuousClearance,
  continuousClearanceCertificateSettings,
} from "./clearanceCertificate.js?v=continuous-clearance-3";
import {
  buildClearanceKernel,
  CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE,
  normalizeClearanceKernelMode,
} from "./clearanceKernel.js?v=clearance-kernel-1";

const MODEL_TRIM_WORKER_VERSION = "object-clearance-worker-38";
const SERIAL_MANIFOLD_URL = "../vendor/manifold/manifold.js";
const PARALLEL_MANIFOLD_URL = "../vendor/manifold-par/manifold.js";
const TARGETED_MANIFOLD_URL = "../vendor/manifold-targeted/manifold.js";
const TARGETED_MANIFOLD_BUILDS = Object.freeze({
  size: {
    moduleUrl: TARGETED_MANIFOLD_URL,
    baseUrl: "../vendor/manifold-targeted",
  },
  o3: {
    moduleUrl: "../vendor/manifold-targeted-o3/manifold.js",
    baseUrl: "../vendor/manifold-targeted-o3",
  },
  simd: {
    moduleUrl: "../vendor/manifold-targeted-simd/manifold.js",
    baseUrl: "../vendor/manifold-targeted-simd",
  },
  lto: {
    moduleUrl: "../vendor/manifold-targeted-lto/manifold.js",
    baseUrl: "../vendor/manifold-targeted-lto",
  },
});
const DEFAULT_TARGETED_MANIFOLD_BUILD = "o3";
const MAX_AUTOMATIC_GLOBAL_FALLBACK_SOURCE_FACES = 500000;
const MAX_LOCAL_WITNESS_REPAIRS = 12;
const MAX_LOCAL_WITNESS_GROUP_SIZE = 6;
const MAX_LOCAL_WITNESS_CANDIDATES = 24;
const MIN_TARGETED_STREAM_BATCH_SIZE = 250;
const MAX_TARGETED_STREAM_BATCH_SIZE = 8000;
const MANIFOLD_STATUS_NAMES = [
  "NoError",
  "NonFiniteVertex",
  "NotManifold",
  "VertexOutOfBounds",
  "PropertiesWrongLength",
  "MissingPositionProperties",
  "MergeVectorsDifferentLengths",
  "MergeIndexOutOfBounds",
  "TransformWrongLength",
  "RunIndexWrongLength",
  "FaceIDWrongLength",
  "InvalidConstruction",
  "ResultTooLarge",
  "InvalidTangents",
  "Cancelled",
];

let manifoldCorePromise = null;
let manifoldRuntime = null;
let manifoldCoreMode = "";
let cachedClearance = null;

self.onmessage = async (event) => {
  const message = event.data ?? {};
  if (message.type === "clearModelClearanceCache") {
    releaseCachedClearance();
    self.postMessage({ id: message.id, type: "clearResult", version: MODEL_TRIM_WORKER_VERSION });
    return;
  }
  if (message.type === "prepareModelClearance") {
    await prepareModelClearance(message);
    return;
  }
  if (message.type !== "trimGeneratedMeshes") return;

  const timings = [];
  let phaseStart = performance.now();
  const mark = (label) => {
    const now = performance.now();
    timings.push({ label, ms: now - phaseStart });
    phaseStart = now;
    report(message.id, label);
  };

  let clearanceSolid = null;
  let certificateModelSolid = null;
  let certificateSupportSolid = null;
  let certificateInterfaceSolid = null;
  let targetUnionSolid = null;
  let certificate = null;
  let postCertificate = null;
  let targetedPostCertificate = null;
  let localizedWitnessRepairs = 0;
  let localizedWitnessGroups = 0;
  let localizedWitnessSkips = 0;
  let localizedWitnessFailure = "";
  let modelResult = null;
  const debug = normalizeTrimDebugSettings(message.debug);
  const owned = [];
  const releaseOwnedSolid = (solid) => {
    const index = owned.indexOf(solid);
    if (index >= 0) owned.splice(index, 1);
    solid?.delete?.();
  };
  try {
    const core = await loadManifoldCore(
      message.id,
      Boolean(message.preferParallelManifold),
      debug.targeted_minkowski,
      debug.targeted_build
    );
    mark("load manifold");

    const clearance = modelBooleanClearanceSettings(message.clearance);
    const cachedResult = getCachedClearance(message.clearanceKey);
    if (!cachedResult && message.clearanceKey && cachedClearance?.key !== message.clearanceKey) {
      releaseCachedClearance();
    }
    const certificateSettings = continuousClearanceCertificateSettings(clearance);
    if (!cachedResult && certificateSettings.supported) {
      report(message.id, "checking continuous ellipsoidal object clearance");
      let certificatePhaseStart = performance.now();
      const markCertificate = (label) => {
        const now = performance.now();
        timings.push({ label, ms: now - certificatePhaseStart });
        certificatePhaseStart = now;
      };
      certificateModelSolid = supportMeshToManifold(
        core,
        message.modelMesh,
        "object model certificate solid",
        { fast: true }
      );
      markCertificate("certificate model solid");
      certificateSupportSolid = supportMeshToManifold(
        core,
        message.supportMesh,
        "generated cradle certificate solid",
        { fast: true }
      );
      markCertificate("certificate cradle solid");
      if (message.interfaceMesh?.vertices?.length && message.interfaceMesh?.triangles?.length) {
        certificateInterfaceSolid = supportMeshToManifold(
          core,
          message.interfaceMesh,
          "generated interface certificate solid",
          { fast: true }
        );
        markCertificate("certificate interface solid");
      }
      certificate = certifyContinuousClearance(
        certificateModelSolid,
        [
          { label: "cradle", solid: certificateSupportSolid },
          { label: "interface", solid: certificateInterfaceSolid },
        ],
        clearance
      );
      timings.push(...(certificate.timings ?? []));
      delete certificate.timings;
      phaseStart = performance.now();

      if (certificate.passed) {
        report(message.id, "continuous ellipsoidal clearance certificate passed");
        certificateModelSolid.delete?.();
        certificateModelSolid = null;
        certificateSupportSolid.delete?.();
        certificateSupportSolid = null;
        certificateInterfaceSolid?.delete?.();
        certificateInterfaceSolid = null;

        report(message.id, "packing certified cradle mesh");
        const transfer = [];
        packMeshTransfer(message.supportMesh, transfer);
        packMeshTransfer(message.interfaceMesh, transfer);
        mark("pack transfer");
        self.postMessage({
          id: message.id,
          type: "trimResult",
          version: MODEL_TRIM_WORKER_VERSION,
          support_mesh: message.supportMesh,
          interface_mesh: message.interfaceMesh,
          trimmed: false,
          certified: true,
          skipped: true,
          skip_reason: certificate.reason,
          certificate,
          pre_certificate: certificate,
          post_certificate: null,
          kernel: null,
          repair: {
            strategy: "certificate_preserved_original",
            targeted_requested: debug.targeted_minkowski,
            targeted_applied: false,
          },
          clearance: {
            ...clearance,
            expanded: false,
            analytic_certified: true,
            safety_margin_mm: 0,
          },
          timings,
          runtime: manifoldRuntimeInfo(core, debug),
        }, transfer);
        return;
      }
      report(message.id, certificate.available
        ? "continuous clearance certificate failed; exact repair is required"
        : `continuous clearance certificate unavailable; exact repair is required (${certificate.reason})`);
    }
    if (!cachedResult) {
      report(message.id, expandedClearanceNeeded(clearance)
        ? "building bounded expanded object clearance solid"
        : "building object model solid");
    }

    const targetAwareRequested = !cachedResult &&
      debug.targeted_minkowski &&
      expandedClearanceNeeded(clearance);
    if (targetAwareRequested) {
      if (!certificateModelSolid) {
        report(message.id, "importing object model for target-aware repair");
        certificateModelSolid = supportMeshToManifold(
          core,
          message.modelMesh,
          "target-aware object model solid",
          { fast: true }
        );
        mark("target-aware model solid");
      }
      if (!certificateSupportSolid) {
        report(message.id, "importing cradle target for target-aware repair");
        certificateSupportSolid = supportMeshToManifold(
          core,
          message.supportMesh,
          "target-aware cradle target",
          { fast: true }
        );
        mark("target-aware cradle solid");
      }
      if (
        !certificateInterfaceSolid &&
        message.interfaceMesh?.vertices?.length &&
        message.interfaceMesh?.triangles?.length
      ) {
        certificateInterfaceSolid = supportMeshToManifold(
          core,
          message.interfaceMesh,
          "target-aware interface target",
          { fast: true }
        );
        mark("target-aware interface solid");
      }
      if (certificateSupportSolid && certificateInterfaceSolid) {
        report(message.id, "combining cradle and interface repair targets");
        targetUnionSolid = assertManifoldOk(
          core.Manifold.union([certificateSupportSolid, certificateInterfaceSolid]),
          "combined target-aware repair solid"
        );
        mark("combine repair targets");
      }
    }

    const reusableModelSolid = certificateModelSolid;
    certificateModelSolid = null;
    modelResult = cachedResult
      ? cachedResult
      : modelClearanceSolidToManifold(
          core,
          message.modelMesh,
          clearance,
          [message.supportMesh, message.interfaceMesh],
          reusableModelSolid,
          {
            kernelMode: debug.kernel_mode,
            targetedMinkowski: targetAwareRequested,
            targetSolid: targetUnionSolid || certificateSupportSolid,
            targetSolids: [
              { label: "cradle", solid: certificateSupportSolid },
              { label: "interface", solid: certificateInterfaceSolid },
            ].filter((entry) => entry.solid),
            streamBatchSize: debug.targeted_batch_size,
            onProgress: (progressMessage) => report(message.id, progressMessage),
          }
        );
    clearanceSolid = modelResult.solid;
    const targetResultSolids = Array.isArray(modelResult.target_result_solids)
      ? modelResult.target_result_solids
      : [];
    if (!cachedResult && message.clearanceKey && !modelResult.bounded) {
      releaseCachedClearance();
      cachedClearance = {
        key: message.clearanceKey,
        solid: modelResult.solid,
        expanded: modelResult.expanded,
        safety_margin_mm: modelResult.safety_margin_mm || 0,
        clearance,
      };
    } else if (!cachedResult) {
      if (clearanceSolid) owned.push(clearanceSolid);
      owned.push(...targetResultSolids);
    }
    targetUnionSolid?.delete?.();
    targetUnionSolid = null;
    if (modelResult.timings?.length) {
      timings.push(...modelResult.timings);
      phaseStart = performance.now();
      report(message.id, targetResultSolids.length
        ? "target-aware streamed remainders"
        : modelResult.expanded
          ? "model clearance solid"
          : "model solid");
    } else {
      mark(cachedResult
        ? "cached model clearance solid"
        : modelResult.expanded
          ? "model clearance solid"
          : "model solid");
    }

    let supportMesh;
    let interfaceMesh = message.interfaceMesh;
    if (targetResultSolids.length) {
      certificateSupportSolid?.delete?.();
      certificateSupportSolid = null;
      certificateInterfaceSolid?.delete?.();
      certificateInterfaceSolid = null;

      const streamedSupportSolid = targetResultSolids[0];
      if (!streamedSupportSolid) {
        throw new Error("Target-aware repair did not return a cradle remainder.");
      }
      report(message.id, "extracting streamed target-aware cradle remainder");
      supportMesh = manifoldToSupportMesh(streamedSupportSolid, message.supportMesh.cell_size_mm);
      releaseOwnedSolid(streamedSupportSolid);
      mark("extract streamed cradle");

      if (message.interfaceMesh?.vertices?.length && message.interfaceMesh?.triangles?.length) {
        const streamedInterfaceSolid = targetResultSolids[1];
        if (!streamedInterfaceSolid) {
          throw new Error("Target-aware repair did not return an interface remainder.");
        }
        report(message.id, "extracting streamed target-aware interface remainder");
        interfaceMesh = manifoldToSupportMesh(
          streamedInterfaceSolid,
          message.interfaceMesh.cell_size_mm
        );
        releaseOwnedSolid(streamedInterfaceSolid);
        mark("extract streamed interface");
      }
    } else {
      report(message.id, "trimming generated cradle mesh");
      const reusableSupportSolid = certificateSupportSolid;
      certificateSupportSolid = null;
      supportMesh = trimSupportMeshAgainstModelSolid(
        core,
        message.supportMesh,
        clearanceSolid,
        "generated cradle",
        timings,
        reusableSupportSolid
      );
      mark("trim cradle");

      const reusableInterfaceSolid = certificateInterfaceSolid;
      certificateInterfaceSolid = null;
      interfaceMesh = message.interfaceMesh?.vertices?.length && message.interfaceMesh?.triangles?.length
        ? trimSupportMeshAgainstModelSolid(
          core,
          message.interfaceMesh,
          clearanceSolid,
          "generated interface",
          timings,
          reusableInterfaceSolid
        )
        : message.interfaceMesh;
      if (interfaceMesh !== message.interfaceMesh) mark("trim interface");
    }

    if (certificateSettings.supported) {
      report(message.id, "checking final continuous ellipsoidal clearance");
      postCertificate = certifyRepairedMeshesContinuousClearance(
        core,
        message.modelMesh,
        supportMesh,
        interfaceMesh,
        clearance,
        timings
      );
      phaseStart = performance.now();
      report(message.id, postCertificate.passed
        ? "final continuous ellipsoidal clearance certificate passed"
        : `final continuous ellipsoidal clearance certificate did not pass (${postCertificate.reason})`);
    }

    if (
      modelResult.targeted &&
      debug.kernel_mode === CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE &&
      certificateSettings.supported &&
      !postCertificate?.passed &&
      postCertificate?.targets?.some((target) => !target?.passed && target?.witness)
    ) {
      try {
        report(message.id, "repairing localized continuous-clearance witness");
        const localized = repairLocalizedCertificateWitnesses(
          core,
          message.modelMesh,
          supportMesh,
          interfaceMesh,
          clearance,
          postCertificate,
          debug.kernel_mode,
          timings,
          (progressMessage) => report(message.id, progressMessage)
        );
        if (localized) {
          localizedWitnessRepairs = localized.attempts || 0;
          localizedWitnessGroups = localized.groups || 0;
          localizedWitnessSkips = localized.skipped || 0;
          if (localized.certificate) postCertificate = localized.certificate;
          if (localized.support_mesh) {
            supportMesh = localized.support_mesh;
            interfaceMesh = localized.interface_mesh;
            report(message.id, "checking exported localized repair clearance");
            postCertificate = certifyRepairedMeshesContinuousClearance(
              core,
              message.modelMesh,
              supportMesh,
              interfaceMesh,
              clearance,
              timings,
              "localized repair "
            );
            phaseStart = performance.now();
          }
          report(message.id, postCertificate?.passed
            ? `localized continuous-clearance repair passed after ${localizedWitnessRepairs} witness patch${localizedWitnessRepairs === 1 ? "" : "es"} in ${localizedWitnessGroups} group${localizedWitnessGroups === 1 ? "" : "s"}`
            : `localized continuous-clearance repair did not pass (${describeCertificateFailure(postCertificate)})`);
        }
      } catch (error) {
        localizedWitnessFailure = error?.message || String(error);
        report(
          message.id,
          `localized continuous-clearance repair was unavailable (${localizedWitnessFailure})`
        );
      }
    }

    const guardedTargetFallback = modelResult.targeted &&
      debug.kernel_mode === CIRCUMSCRIBED_CLEARANCE_KERNEL_MODE &&
      certificateSettings.supported &&
      !postCertificate?.passed;
    if (guardedTargetFallback) {
      targetedPostCertificate = postCertificate;
      const targetedFailureReason = describeCertificateFailure(targetedPostCertificate);
      const localizedFailureSummary = localizedWitnessRepairs > 0
        ? `; localized repair attempted ${localizedWitnessRepairs} patch${localizedWitnessRepairs === 1 ? "" : "es"} in ${localizedWitnessGroups} group${localizedWitnessGroups === 1 ? "" : "s"}`
        : localizedWitnessFailure
          ? `; localized repair was unavailable: ${localizedWitnessFailure}`
          : "";
      const targetedResult = modelResult;
      if (
        Number(targetedResult.source_face_count || 0) >
        MAX_AUTOMATIC_GLOBAL_FALLBACK_SOURCE_FACES
      ) {
        throw new Error(
          `Target-aware repair was not certified (${targetedFailureReason}${localizedFailureSummary}); automatic bounded-global fallback was skipped for ${Number(targetedResult.source_face_count || 0).toLocaleString()} source faces.`
        );
      }
      report(
        message.id,
        `target-aware repair was not certified (${targetedFailureReason}); releasing targeted geometry before bounded global fallback`
      );

      // The target-restricted clearance solid is the largest live object in
      // this path. Release it before constructing the global oracle so the
      // allocator can reuse its pages instead of holding both representations.
      const ownedIndex = owned.indexOf(clearanceSolid);
      if (ownedIndex >= 0) owned.splice(ownedIndex, 1);
      clearanceSolid?.delete?.();
      clearanceSolid = null;
      targetUnionSolid?.delete?.();
      targetUnionSolid = null;

      const fallbackResult = modelClearanceSolidToManifold(
        core,
        message.modelMesh,
        clearance,
        [message.supportMesh, message.interfaceMesh],
        null,
        {
          kernelMode: debug.kernel_mode,
          targetedMinkowski: false,
          onProgress: (progressMessage) => report(message.id, progressMessage),
        }
      );
      clearanceSolid = fallbackResult.solid;
      owned.push(clearanceSolid);
      timings.push(...(fallbackResult.timings ?? []).map((timing) => ({
        ...timing,
        label: `global fallback ${timing.label}`,
      })));
      modelResult = {
        ...fallbackResult,
        targeted_requested: true,
        targeted_fallback_reason: targetedFailureReason,
        targeted_source_face_count: targetedResult.source_face_count ?? 0,
        targeted_aabb_candidate_face_count: targetedResult.aabb_candidate_face_count ?? 0,
        targeted_candidate_face_count: targetedResult.candidate_face_count ?? 0,
      };

      report(message.id, "trimming generated cradle mesh with global fallback");
      supportMesh = trimSupportMeshAgainstModelSolid(
        core,
        message.supportMesh,
        clearanceSolid,
        "global fallback cradle",
        timings
      );
      interfaceMesh = message.interfaceMesh?.vertices?.length && message.interfaceMesh?.triangles?.length
        ? trimSupportMeshAgainstModelSolid(
            core,
            message.interfaceMesh,
            clearanceSolid,
            "global fallback interface",
            timings
          )
        : message.interfaceMesh;
      report(message.id, "checking final continuous ellipsoidal clearance after global fallback");
      postCertificate = certifyRepairedMeshesContinuousClearance(
        core,
        message.modelMesh,
        supportMesh,
        interfaceMesh,
        clearance,
        timings,
        "global fallback "
      );
      phaseStart = performance.now();
    }

    report(message.id, "packing trimmed cradle mesh");
    const transfer = [];
    packMeshTransfer(supportMesh, transfer);
    packMeshTransfer(interfaceMesh, transfer);
    mark("pack transfer");
    self.postMessage({
      id: message.id,
      type: "trimResult",
      version: MODEL_TRIM_WORKER_VERSION,
      support_mesh: supportMesh,
      interface_mesh: interfaceMesh,
      trimmed: true,
      certified: false,
      skipped: false,
      skip_reason: "",
      certificate,
      pre_certificate: certificate,
      post_certificate: postCertificate,
      targeted_post_certificate: targetedPostCertificate,
      kernel: modelResult.kernel ?? null,
      repair: {
        strategy: modelResult.expanded
          ? modelResult.targeted
            ? "targeted_minkowski"
            : "bounded_global_minkowski"
          : "exact_model_difference",
        targeted_requested: Boolean(targetAwareRequested || modelResult.targeted_requested),
        targeted_applied: Boolean(modelResult.targeted),
        targeted_fallback_reason: modelResult.targeted_fallback_reason || "",
        source_faces: modelResult.targeted_source_face_count ?? modelResult.source_face_count ?? 0,
        aabb_candidate_faces: modelResult.targeted_aabb_candidate_face_count ?? modelResult.aabb_candidate_face_count ?? 0,
        candidate_faces: modelResult.targeted_candidate_face_count ?? modelResult.candidate_face_count ?? 0,
        candidate_ratio: modelResult.candidate_ratio ?? 0,
        localized_witness_repairs: localizedWitnessRepairs,
        localized_witness_groups: localizedWitnessGroups,
        localized_witness_skips: localizedWitnessSkips,
        stream_batch_size_requested: modelResult.stream_batch_size_requested || 0,
        stream_batch_attempts: modelResult.streaming_batches?.length || 0,
        stream_successful_batches: (modelResult.streaming_batches ?? [])
          .filter((batch) => batch.status === "NoError").length,
        stream_retried_batches: (modelResult.streaming_batches ?? [])
          .filter((batch) => batch.status !== "NoError").length,
        stream_peak_wasm_memory_bytes: modelResult.stream_peak_wasm_memory_bytes || 0,
        streaming_batches: modelResult.streaming_batches ?? [],
      },
      clearance: {
        ...clearance,
        expanded: modelResult.expanded,
        analytic_certified: Boolean(postCertificate?.passed),
        safety_margin_mm: modelResult.safety_margin_mm || 0,
      },
      timings,
      runtime: manifoldRuntimeInfo(core, debug),
    }, transfer);
  } catch (error) {
    self.postMessage({
      id: message.id,
      type: "error",
      error: `${MODEL_TRIM_WORKER_VERSION}: ${error?.message || String(error)}`,
      timings,
    });
  } finally {
    certificateModelSolid?.delete?.();
    certificateSupportSolid?.delete?.();
    certificateInterfaceSolid?.delete?.();
    targetUnionSolid?.delete?.();
    for (const solid of owned) solid?.delete?.();
  }
};

async function prepareModelClearance(message) {
  const timings = [];
  const debug = normalizeTrimDebugSettings(message.debug);
  let phaseStart = performance.now();
  const mark = (label) => {
    const now = performance.now();
    timings.push({ label, ms: now - phaseStart });
    phaseStart = now;
    report(message.id, label);
  };

  let modelResult = null;
  try {
    const core = await loadManifoldCore(
      message.id,
      Boolean(message.preferParallelManifold),
      debug.targeted_minkowski,
      debug.targeted_build
    );
    mark("load manifold");
    const clearance = modelBooleanClearanceSettings(message.clearance);
    if (expandedClearanceNeeded(clearance)) {
      throw new Error("Expanded object clearance cannot be precomputed without generated cradle bounds.");
    }
    const existing = getCachedClearance(message.clearanceKey);
    if (existing) {
      mark("cached model clearance solid");
    } else {
      report(message.id, expandedClearanceNeeded(clearance)
        ? "precomputing expanded object clearance solid"
        : "precomputing object model solid");
      modelResult = modelClearanceSolidToManifold(core, message.modelMesh, clearance);
      timings.push(...(modelResult.timings ?? []));
      phaseStart = performance.now();
      report(message.id, modelResult.expanded ? "model clearance solid" : "model solid");
      releaseCachedClearance();
      cachedClearance = {
        key: message.clearanceKey,
        solid: modelResult.solid,
        expanded: modelResult.expanded,
        safety_margin_mm: modelResult.safety_margin_mm || 0,
        clearance,
      };
      modelResult = null;
    }
    self.postMessage({
      id: message.id,
      type: "prepareResult",
      version: MODEL_TRIM_WORKER_VERSION,
      clearanceKey: message.clearanceKey,
      clearance: {
        ...clearance,
        expanded: cachedClearance?.expanded ?? existing?.expanded ?? false,
        safety_margin_mm: cachedClearance?.safety_margin_mm ?? existing?.safety_margin_mm ?? 0,
      },
      timings,
      runtime: manifoldRuntimeInfo(core, debug),
    });
  } catch (error) {
    modelResult?.solid?.delete?.();
    self.postMessage({
      id: message.id,
      type: "error",
      error: error?.message || String(error),
      timings,
    });
  }
}

function getCachedClearance(key) {
  if (!key || !cachedClearance || cachedClearance.key !== key) return null;
  return {
    solid: cachedClearance.solid,
    expanded: cachedClearance.expanded,
    safety_margin_mm: cachedClearance.safety_margin_mm || 0,
    clearance: cachedClearance.clearance,
  };
}

function releaseCachedClearance() {
  cachedClearance?.solid?.delete?.();
  cachedClearance = null;
}

function report(id, message) {
  self.postMessage({ id, type: "progress", message });
}

function normalizeTrimDebugSettings(debug = {}) {
  const requestedBatchSize = Math.floor(Number(debug?.targeted_batch_size) || 0);
  return {
    targeted_minkowski: Boolean(debug?.targeted_minkowski),
    kernel_mode: normalizeClearanceKernelMode(debug?.kernel_mode),
    targeted_batch_size: requestedBatchSize > 0
      ? Math.max(
          MIN_TARGETED_STREAM_BATCH_SIZE,
          Math.min(MAX_TARGETED_STREAM_BATCH_SIZE, requestedBatchSize)
        )
      : 0,
    targeted_build: normalizeTargetedBuild(debug?.targeted_build),
  };
}

function normalizeTargetedBuild(value) {
  const normalized = String(value || DEFAULT_TARGETED_MANIFOLD_BUILD)
    .trim()
    .toLowerCase();
  return Object.hasOwn(TARGETED_MANIFOLD_BUILDS, normalized)
    ? normalized
    : DEFAULT_TARGETED_MANIFOLD_BUILD;
}

function describeCertificateFailure(certificate) {
  const reason = certificate?.reason || "final certificate did not pass";
  const gap = Number(certificate?.normalized_gap_lower_bound);
  const required = Number(certificate?.search_length);
  if (!Number.isFinite(gap) || !Number.isFinite(required)) return reason;
  const deficit = Math.max(0, required - gap);
  const failedTarget = (certificate?.targets ?? []).find(
    (target) => !target?.passed && target?.witness
  );
  const witness = failedTarget?.witness;
  const modelPoint = witness?.model_face_centroid_mm;
  const targetPoint = witness?.target_face_centroid_mm;
  const formatPoint = (point) => Array.isArray(point) && point.length >= 3
    ? point.slice(0, 3).map((value) => Number(value).toFixed(3)).join(", ")
    : "";
  const witnessText = witness
    ? `; closest ${failedTarget.label || "target"} witness uses model face ${witness.model_face} near (${formatPoint(modelPoint)}) mm and target face ${witness.target_face} near (${formatPoint(targetPoint)}) mm`
    : "";
  return `${reason}; normalized gap ${gap.toFixed(6)} versus ${required.toFixed(6)} required (deficit ${deficit.toFixed(6)})${witnessText}`;
}

async function loadManifoldCore(
  id = null,
  preferParallelManifold = false,
  preferTargetedManifold = false,
  targetedBuild = DEFAULT_TARGETED_MANIFOLD_BUILD
) {
  const normalizedTargetedBuild = normalizeTargetedBuild(targetedBuild);
  const requestedMode = preferTargetedManifold
    ? `targeted:${normalizedTargetedBuild}`
    : preferParallelManifold && canUseParallelManifold()
      ? "parallel"
      : "serial";
  if (manifoldCorePromise && manifoldCoreMode !== requestedMode) {
    releaseCachedClearance();
    manifoldCorePromise = null;
    manifoldRuntime = null;
    manifoldCoreMode = "";
  }

  if (!manifoldCorePromise) {
    manifoldCoreMode = requestedMode;
    manifoldCorePromise = loadPreferredManifoldModule(id, requestedMode).then(({ createManifoldModule, baseUrl, runtime }) => {
      manifoldRuntime = runtime;
      report(id, `instantiating ${runtime.build}`);
      return createManifoldModule({
        locateFile: (file) => new URL(
          `${baseUrl}/${file}?v=${MODEL_TRIM_WORKER_VERSION}`,
          import.meta.url
        ).href,
      });
    }).then((core) => {
      report(id, `setting up ${manifoldRuntime?.build || "Manifold"}`);
      core.setup();
      report(id, `${manifoldRuntime?.build || "Manifold"} ready`);
      return core;
    });
  }
  return manifoldCorePromise;
}

async function loadPreferredManifoldModule(id = null, requestedMode = "serial") {
  const preferParallelManifold = requestedMode === "parallel";
  if (requestedMode.startsWith("targeted:")) {
    const targetedBuild = normalizeTargetedBuild(requestedMode.split(":")[1]);
    const targetedConfig = TARGETED_MANIFOLD_BUILDS[targetedBuild];
    try {
      report(id, `loading target-aware serial Manifold ${targetedBuild} WASM module`);
      const targeted = await import(
        `${targetedConfig.moduleUrl}?v=${MODEL_TRIM_WORKER_VERSION}`
      );
      return {
        createManifoldModule: targeted.default,
        baseUrl: targetedConfig.baseUrl,
        runtime: {
          preferred_parallel: false,
          selected_parallel: false,
          parallel_available: canUseParallelManifold(),
          targeted_requested: true,
          selected_targeted: true,
          targeted_build: targetedBuild,
          build: `target-aware serial Manifold ${targetedBuild} WASM (8bffb52)`,
          cross_origin_isolated: Boolean(self.crossOriginIsolated),
          shared_array_buffer: typeof SharedArrayBuffer === "function",
          load_error: "",
        },
      };
    } catch (error) {
      report(id, `target-aware Manifold failed to load; using global serial backend (${error?.message || error})`);
      const serial = await import(`${SERIAL_MANIFOLD_URL}?v=${MODEL_TRIM_WORKER_VERSION}`);
      return {
        createManifoldModule: serial.default,
        baseUrl: "../vendor/manifold",
        runtime: {
          preferred_parallel: false,
          selected_parallel: false,
          parallel_available: canUseParallelManifold(),
          targeted_requested: true,
          selected_targeted: false,
          targeted_build: targetedBuild,
          build: "vendored serial Manifold WASM",
          cross_origin_isolated: Boolean(self.crossOriginIsolated),
          shared_array_buffer: typeof SharedArrayBuffer === "function",
          load_error: error?.message || String(error),
        },
      };
    }
  }

  if (preferParallelManifold && !canUseParallelManifold()) {
    const reason = workerParallelUnavailableReason();
    report(id, `parallel Manifold unavailable in trim worker; using serial backend (${reason})`);
    const serial = await import(`${SERIAL_MANIFOLD_URL}?v=${MODEL_TRIM_WORKER_VERSION}`);
    return {
      createManifoldModule: serial.default,
      baseUrl: "../vendor/manifold",
      runtime: {
        preferred_parallel: true,
        selected_parallel: false,
        parallel_available: false,
        targeted_requested: false,
        selected_targeted: false,
        build: "vendored serial Manifold WASM",
        cross_origin_isolated: Boolean(self.crossOriginIsolated),
        shared_array_buffer: typeof SharedArrayBuffer === "function",
        load_error: reason,
      },
    };
  }

  if (preferParallelManifold) {
    try {
      report(id, "loading parallel Manifold WASM module");
      const parallel = await import(`${PARALLEL_MANIFOLD_URL}?v=${MODEL_TRIM_WORKER_VERSION}`);
      return {
        createManifoldModule: parallel.default,
        baseUrl: "../vendor/manifold-par",
        runtime: {
          preferred_parallel: true,
          selected_parallel: true,
          parallel_available: true,
          targeted_requested: false,
          selected_targeted: false,
          build: "parallel Manifold WASM",
          cross_origin_isolated: Boolean(self.crossOriginIsolated),
          shared_array_buffer: typeof SharedArrayBuffer === "function",
          load_error: "",
        },
      };
    } catch (error) {
      report(id, `parallel Manifold failed to load; using serial backend (${error?.message || error})`);
      const serial = await import(`${SERIAL_MANIFOLD_URL}?v=${MODEL_TRIM_WORKER_VERSION}`);
      return {
        createManifoldModule: serial.default,
        baseUrl: "../vendor/manifold",
        runtime: {
          preferred_parallel: true,
          selected_parallel: false,
          parallel_available: true,
          targeted_requested: false,
          selected_targeted: false,
          build: "vendored serial Manifold WASM",
          cross_origin_isolated: Boolean(self.crossOriginIsolated),
          shared_array_buffer: typeof SharedArrayBuffer === "function",
          load_error: error?.message || String(error),
        },
      };
    }
  }

  report(id, "loading serial Manifold WASM module");
  const serial = await import(`${SERIAL_MANIFOLD_URL}?v=${MODEL_TRIM_WORKER_VERSION}`);
  return {
    createManifoldModule: serial.default,
    baseUrl: "../vendor/manifold",
    runtime: {
      preferred_parallel: false,
      selected_parallel: false,
      parallel_available: canUseParallelManifold(),
      targeted_requested: false,
      selected_targeted: false,
      build: "vendored serial Manifold WASM",
      cross_origin_isolated: Boolean(self.crossOriginIsolated),
      shared_array_buffer: typeof SharedArrayBuffer === "function",
      load_error: "",
    },
  };
}

function canUseParallelManifold() {
  return Boolean(self.crossOriginIsolated) && typeof SharedArrayBuffer === "function";
}

function workerParallelUnavailableReason() {
  const reasons = [];
  if (!self.crossOriginIsolated) reasons.push("worker is not cross-origin isolated");
  if (typeof SharedArrayBuffer !== "function") reasons.push("SharedArrayBuffer is unavailable");
  return reasons.length ? reasons.join("; ") : "unknown worker pthread gate";
}

function manifoldRuntimeInfo(core, debug = {}) {
  const hasThreadApi = Boolean(core?.setNumThreads || core?.setThreadCount || core?.setNumWorkers);
  const targetedApi = Boolean(
    core?.Manifold?.prototype?.minkowskiSubtractTargeted &&
    core?.Manifold?.prototype?.minkowskiTargetCandidateCount
  );
  return {
    parallel: hasThreadApi,
    selected_parallel: Boolean(manifoldRuntime?.selected_parallel),
    preferred_parallel: Boolean(manifoldRuntime?.preferred_parallel),
    parallel_available: Boolean(manifoldRuntime?.parallel_available),
    targeted_requested: Boolean(debug?.targeted_minkowski || manifoldRuntime?.targeted_requested),
    targeted_build: manifoldRuntime?.targeted_build || normalizeTargetedBuild(debug?.targeted_build),
    selected_targeted: Boolean(manifoldRuntime?.selected_targeted && targetedApi),
    targeted_api: targetedApi,
    multi_witness_api: typeof core?.Manifold?.prototype?.minGapDetailsMany === "function",
    wasm_memory_bytes: manifoldWasmMemoryBytes(core),
    thread_api: hasThreadApi,
    cross_origin_isolated: Boolean(self.crossOriginIsolated),
    shared_array_buffer: typeof SharedArrayBuffer === "function",
    build: manifoldRuntime?.build || (hasThreadApi ? "thread-capable Manifold WASM" : "vendored serial Manifold WASM"),
    load_error: manifoldRuntime?.load_error || "",
  };
}

function modelBooleanClearanceSettings(clearance = {}) {
  return {
    xy_mm: Math.max(0, Number(clearance?.xy_mm) || 0),
    z_mm: Math.max(0, Number(clearance?.z_mm) || 0),
  };
}

function expandedClearanceNeeded(clearance = {}) {
  return Math.max(Number(clearance?.xy_mm) || 0, Number(clearance?.z_mm) || 0) > 0.001;
}

function modelClearanceSolidToManifold(
  core,
  modelMesh,
  clearance = {},
  clipMeshes = [],
  exactSolidOverride = null,
  options = {}
) {
  const timings = [];
  const streamingBatches = [];
  let streamPeakWasmMemoryBytes = manifoldWasmMemoryBytes(core);
  const measure = (label, operation) => {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      timings.push({ label, ms: performance.now() - startedAt });
    }
  };
  const exactSolid = exactSolidOverride || measure(
    "model solid",
    () => supportMeshToManifold(
      core,
      modelMesh,
      "object model clearance solid",
      { fast: true }
    )
  );
  const xy = Math.max(0, Number(clearance?.xy_mm) || 0);
  const z = Math.max(0, Number(clearance?.z_mm) || 0);
  const maxClearance = Math.max(xy, z);
  if (maxClearance <= 0.001) {
    return {
      solid: exactSolid,
      expanded: false,
      targeted: false,
      targeted_requested: false,
      target_result_solids: [],
      timings,
      kernel: null,
    };
  }

  let kernel = null;
  let clipSolid = null;
  let boundedSolid = null;
  try {
    const kernelResult = measure(
      "clearance kernel",
      () => buildClearanceKernel(core, clearance, options.kernelMode)
    );
    kernel = kernelResult.solid;
    const kernelMetadata = kernelResult.metadata;
    const clipBounds = clearanceClipBoundsForMeshes(
      clipMeshes,
      kernelMetadata.extent_xy_mm,
      kernelMetadata.extent_z_mm
    );
    if (!clipBounds) {
      throw new Error("Expanded object-clearance trim requires generated cradle bounds.");
    }
    clipSolid = measure(
      "clearance clip solid",
      () => boxToManifold(core, clipBounds.min, clipBounds.max, "object clearance clip bounds")
    );
    boundedSolid = measure(
      "clip object model",
      () => assertManifoldOk(
        core.Manifold.intersection(exactSolid, clipSolid),
        "bounded object model clearance source"
      )
    );
    const sourceFaceCount = Number(boundedSolid.numTri?.()) || 0;
    const targetedRequested = Boolean(options.targetedMinkowski);
    let targeted = false;
    let targetedFallbackReason = "";
    let aabbCandidateFaceCount = 0;
    let candidateFaceCount = 0;
    let clearanceSolid = null;
    let targetResultSolids = [];

    if (targetedRequested) {
      const targetSolid = options.targetSolid;
      const targetEntries = (Array.isArray(options.targetSolids) ? options.targetSolids : [])
        .filter((entry) => entry?.solid);
      const targetedApiAvailable = Boolean(
        targetSolid &&
        targetEntries.length &&
        typeof boundedSolid.minkowskiSubtractTargeted === "function" &&
        typeof boundedSolid.minkowskiTargetCandidateCount === "function"
      );
      if (!targetedApiAvailable) {
        targetedFallbackReason = !targetSolid || !targetEntries.length
          ? "no target solid was available"
          : "target-aware Manifold API is unavailable";
        options.onProgress?.(`target-aware repair unavailable; using bounded global fallback (${targetedFallbackReason})`);
      } else {
        try {
          options.onProgress?.("filtering model faces against cradle target AABBs and kernel distance");
          aabbCandidateFaceCount = typeof boundedSolid.minkowskiTargetAabbCandidateCount === "function"
            ? Number(measure(
              "target AABB candidate filter",
              () => boundedSolid.minkowskiTargetAabbCandidateCount(kernel, targetSolid)
            )) || 0
            : sourceFaceCount;
          candidateFaceCount = Number(measure(
            "target distance candidate filter",
            () => boundedSolid.minkowskiTargetCandidateCount(kernel, targetSolid)
          )) || 0;
          options.onProgress?.(
            `streaming target-aware subtraction from ${candidateFaceCount} of ${sourceFaceCount} model faces after ${aabbCandidateFaceCount} AABB candidates`
          );
          for (let index = 0; index < targetEntries.length; index += 1) {
            const entry = targetEntries[index];
            options.onProgress?.(
              `streaming target-aware subtraction for ${entry.label} (${index + 1} of ${targetEntries.length})`
            );
            let streamAttempt = 0;
            let successfulStreamBatch = 0;
            let previousProgressAt = performance.now();
            let prepared = false;
            const streamedResult = measure(
              `targeted ${entry.label} streaming subtraction`,
              () => assertManifoldOk(
                boundedSolid.minkowskiSubtractTargeted(
                  kernel,
                  entry.solid,
                  (
                    completed,
                    total,
                    batchSize,
                    statusCode,
                    hullUnionMs = 0,
                    targetDifferenceMs = 0,
                    remainingTargetTriangles = 0
                  ) => {
                    const progressAt = performance.now();
                    const callbackIntervalMs = progressAt - previousProgressAt;
                    previousProgressAt = progressAt;
                    const wasmMemoryBytes = manifoldWasmMemoryBytes(core);
                    streamPeakWasmMemoryBytes = Math.max(
                      streamPeakWasmMemoryBytes,
                      wasmMemoryBytes
                    );
                    const status = MANIFOLD_STATUS_NAMES[Number(statusCode)] ||
                      `status ${statusCode}`;
                    if (!batchSize && Number(completed) === 0) {
                      if (!prepared) {
                        timings.push({
                          label: `targeted ${entry.label} stream candidate preparation`,
                          ms: callbackIntervalMs,
                        });
                        prepared = true;
                      }
                      options.onProgress?.(
                        `prepared ${Number(total).toLocaleString()} candidate faces for adaptive target-aware streaming with ${formatWorkerMemory(wasmMemoryBytes)} allocated`
                      );
                    } else if (Number(batchSize) > 0) {
                      streamAttempt += 1;
                      if (status === "NoError") successfulStreamBatch += 1;
                      const batch = {
                        target: entry.label,
                        attempt: streamAttempt,
                        successful_batch: status === "NoError"
                          ? successfulStreamBatch
                          : 0,
                        completed_faces: Number(completed) || 0,
                        total_faces: Number(total) || 0,
                        batch_size: Number(batchSize) || 0,
                        status_code: Number(statusCode) || 0,
                        status,
                        hull_union_ms: Number(hullUnionMs) || 0,
                        target_difference_ms: Number(targetDifferenceMs) || 0,
                        callback_interval_ms: callbackIntervalMs,
                        remaining_target_triangles:
                          Number(remainingTargetTriangles) || 0,
                        wasm_memory_bytes: wasmMemoryBytes,
                      };
                      streamingBatches.push(batch);
                      timings.push(
                        {
                          label: `targeted ${entry.label} stream attempt ${streamAttempt} hull union`,
                          ms: batch.hull_union_ms,
                        },
                        {
                          label: `targeted ${entry.label} stream attempt ${streamAttempt} target difference`,
                          ms: batch.target_difference_ms,
                        }
                      );
                      if (status === "NoError") {
                        options.onProgress?.(
                          `streamed ${batch.completed_faces.toLocaleString()} of ${batch.total_faces.toLocaleString()} candidate faces using a ${batch.batch_size.toLocaleString()}-face batch in ${formatWorkerMilliseconds(batch.hull_union_ms + batch.target_difference_ms)} (${formatWorkerMilliseconds(batch.hull_union_ms)} hulls, ${formatWorkerMilliseconds(batch.target_difference_ms)} difference; ${formatWorkerMemory(batch.wasm_memory_bytes)})`
                        );
                      } else {
                        options.onProgress?.(
                          `streamed batch of ${batch.batch_size.toLocaleString()} faces returned ${status} after ${batch.completed_faces.toLocaleString()} of ${batch.total_faces.toLocaleString()} candidate faces; retrying smaller batches when possible (${formatWorkerMemory(batch.wasm_memory_bytes)})`
                        );
                      }
                    }
                  },
                  options.streamBatchSize || 0
                ),
                `target-aware ${entry.label} remainder`
              )
            );
            targetResultSolids.push(streamedResult);
          }
          targeted = true;
        } catch (error) {
          for (const solid of targetResultSolids) solid?.delete?.();
          targetResultSolids = [];
          targetedFallbackReason = error?.message || String(error);
          options.onProgress?.(
            `target-aware repair failed; using bounded global fallback (${targetedFallbackReason})`
          );
        }
      }
    }

    if (
      !clearanceSolid &&
      !targetResultSolids.length &&
      targetedRequested &&
      targetedFallbackReason &&
      sourceFaceCount > MAX_AUTOMATIC_GLOBAL_FALLBACK_SOURCE_FACES
    ) {
      throw new Error(
        `Target-aware repair failed (${targetedFallbackReason}); automatic bounded-global fallback was skipped for ${sourceFaceCount.toLocaleString()} source faces.`
      );
    }

    if (!clearanceSolid && !targetResultSolids.length) {
      options.onProgress?.("building bounded global expanded object clearance solid");
      clearanceSolid = measure(
        "global Minkowski hulls and union",
        () => assertManifoldOk(
          boundedSolid.minkowskiSum(kernel),
          "bounded object model expanded clearance solid"
        )
      );
    }

    return {
      solid: clearanceSolid,
      target_result_solids: targetResultSolids,
      expanded: true,
      bounded: true,
      targeted,
      targeted_requested: targetedRequested,
      targeted_fallback_reason: targetedFallbackReason,
      source_face_count: sourceFaceCount,
      aabb_candidate_face_count: aabbCandidateFaceCount,
      candidate_face_count: candidateFaceCount,
      candidate_ratio: sourceFaceCount > 0 ? candidateFaceCount / sourceFaceCount : 0,
      safety_margin_mm: kernelMetadata.safety_margin_mm || 0,
      kernel: kernelMetadata,
      stream_batch_size_requested: Math.max(0, Number(options.streamBatchSize) || 0),
      stream_peak_wasm_memory_bytes: streamPeakWasmMemoryBytes,
      streaming_batches: streamingBatches,
      timings,
    };
  } finally {
    kernel?.delete?.();
    boundedSolid?.delete?.();
    clipSolid?.delete?.();
    exactSolid.delete?.();
  }
}

function manifoldWasmMemoryBytes(core) {
  const byteLength = Number(
    core?.getWasmMemorySize?.() ||
    core?.HEAP8?.buffer?.byteLength ||
    core?.HEAPU8?.buffer?.byteLength ||
    core?.wasmMemory?.buffer?.byteLength ||
    0
  );
  return Number.isFinite(byteLength) && byteLength > 0 ? byteLength : 0;
}

function formatWorkerMilliseconds(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  return milliseconds >= 1000
    ? `${(milliseconds / 1000).toFixed(milliseconds >= 10000 ? 1 : 2)}s`
    : `${Math.round(milliseconds)}ms`;
}

function formatWorkerMemory(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  return size > 0 ? `${(size / (1024 ** 3)).toFixed(2)} GB WASM` : "unknown WASM memory";
}

function clearanceClipBoundsForMeshes(meshes, xyPadding = 0, zPadding = 0) {
  const candidates = (Array.isArray(meshes) ? meshes : [meshes])
    .filter((mesh) => mesh?.vertices?.length);
  if (!candidates.length) return null;

  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  let cellPadding = 0.25;
  for (const mesh of candidates) {
    const bounds = supportMeshBounds(mesh);
    min.x = Math.min(min.x, bounds.min.x);
    min.y = Math.min(min.y, bounds.min.y);
    min.z = Math.min(min.z, bounds.min.z);
    max.x = Math.max(max.x, bounds.max.x);
    max.y = Math.max(max.y, bounds.max.y);
    max.z = Math.max(max.z, bounds.max.z);
    cellPadding = Math.max(cellPadding, Number(mesh.cell_size_mm) || 0);
  }
  const padXy = Math.max(0, Number(xyPadding) || 0) + cellPadding;
  const padZ = Math.max(0, Number(zPadding) || 0) + cellPadding;
  return {
    min: { x: min.x - padXy, y: min.y - padXy, z: min.z - padZ },
    max: { x: max.x + padXy, y: max.y + padXy, z: max.z + padZ },
  };
}

function supportMeshBounds(mesh) {
  const vertices = mesh?.vertices ?? [];
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let index = 0; index + 2 < vertices.length; index += 3) {
    min.x = Math.min(min.x, vertices[index]);
    min.y = Math.min(min.y, vertices[index + 1]);
    min.z = Math.min(min.z, vertices[index + 2]);
    max.x = Math.max(max.x, vertices[index]);
    max.y = Math.max(max.y, vertices[index + 1]);
    max.z = Math.max(max.z, vertices[index + 2]);
  }
  return {
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

function boxToManifold(core, min, max, label = "box") {
  const size = {
    x: Math.max(0.001, max.x - min.x),
    y: Math.max(0.001, max.y - min.y),
    z: Math.max(0.001, max.z - min.z),
  };
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  const cube = core.Manifold.cube([size.x, size.y, size.z], true);
  const translated = cube.translate([center.x, center.y, center.z]);
  cube.delete?.();
  return assertManifoldOk(translated, label);
}

function repairLocalizedCertificateWitnesses(
  core,
  modelMesh,
  supportMesh,
  interfaceMesh,
  clearance,
  initialCertificate,
  kernelMode,
  timings = [],
  onProgress = null
) {
  let modelSolid = null;
  let supportSolid = null;
  let interfaceSolid = null;
  let kernel = null;
  let certificate = initialCertificate;
  let attempts = 0;
  let skipped = 0;
  const skippedReasons = [];
  const measure = (label, operation) => {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      timings.push({ label, ms: performance.now() - startedAt });
    }
  };

  try {
    modelSolid = measure(
      "localized repair model solid",
      () => supportMeshToManifold(core, modelMesh, "localized repair object model", { fast: true })
    );
    supportSolid = measure(
      "localized repair cradle solid",
      () => supportMeshToManifold(core, supportMesh, "localized repair cradle", { fast: true })
    );
    if (interfaceMesh?.vertices?.length && interfaceMesh?.triangles?.length) {
      interfaceSolid = measure(
        "localized repair interface solid",
        () => supportMeshToManifold(core, interfaceMesh, "localized repair interface", { fast: true })
      );
    }
    const kernelResult = measure(
      "localized repair clearance kernel",
      () => buildClearanceKernel(core, clearance, kernelMode)
    );
    kernel = kernelResult.solid;

    let group = 0;
    while (attempts < MAX_LOCAL_WITNESS_REPAIRS) {
      const failedTarget = (certificate?.targets ?? []).find(
        (target) => !target?.passed && target?.witness
      );
      if (!failedTarget) break;
      const repairingInterface = failedTarget.label === "interface";
      let targetSolid = repairingInterface ? interfaceSolid : supportSolid;
      const targetMesh = repairingInterface ? interfaceMesh : supportMesh;
      if (!targetSolid) break;
      const remainingBudget = MAX_LOCAL_WITNESS_REPAIRS - attempts;
      const groupLimit = Math.min(MAX_LOCAL_WITNESS_GROUP_SIZE, remainingBudget);
      const groupWitnesses = selectLocalizedWitnessGroup(failedTarget, groupLimit, {
        cell_size_mm: targetMesh?.cell_size_mm,
        kernel_metadata: kernelResult.metadata,
      });
      if (!groupWitnesses.length) break;
      group += 1;
      const witnessCandidateCount = Array.isArray(failedTarget.witnesses) &&
          failedTarget.witnesses.length
        ? failedTarget.witnesses.length
        : 1;
      onProgress?.(
        `selected ${groupWitnesses.length} non-overlapping localized ${failedTarget.label || "cradle"} witness${groupWitnesses.length === 1 ? "" : "es"} from ${witnessCandidateCount} candidate cell${witnessCandidateCount === 1 ? "" : "s"} for group ${group}`
      );

      let validPatchCount = 0;
      const skippedBeforeGroup = skipped;
      for (let index = 0; index < groupWitnesses.length; index += 1) {
        const witness = groupWitnesses[index];
        const patchNumber = attempts + validPatchCount + 1;
        const bounds = localizedWitnessBounds(
          witness,
          targetMesh?.cell_size_mm,
          kernelResult.metadata
        );
        let repairBox = null;
        let localTarget = null;
        let localClearance = null;
        let repairedTarget = null;
        try {
          repairBox = boxToManifold(
            core,
            bounds.min,
            bounds.max,
            `localized ${failedTarget.label || "cradle"} repair bounds`
          );
          localTarget = measure(
            `localized repair ${patchNumber} target clip`,
            () => assertManifoldOk(
              core.Manifold.intersection(targetSolid, repairBox),
              `localized ${failedTarget.label || "cradle"} target`
            )
          );
          if (localTarget.isEmpty()) {
            throw new Error("the localized witness target was empty");
          }
          const candidateCount = Number(measure(
            `localized repair ${patchNumber} candidate filter`,
            () => modelSolid.minkowskiTargetCandidateCount(kernel, localTarget)
          )) || 0;
          if (candidateCount <= 0) {
            throw new Error("no model faces were retained near the clearance witness");
          }
          onProgress?.(
            `building localized ${failedTarget.label || "cradle"} witness group ${group} patch ${index + 1} of ${groupWitnesses.length} (${patchNumber} of ${MAX_LOCAL_WITNESS_REPAIRS} total) with ${candidateCount.toLocaleString()} model faces`
          );
          localClearance = measure(
            `localized repair ${patchNumber} Minkowski`,
            () => assertManifoldOk(
              modelSolid.minkowskiSumTargeted(kernel, localTarget),
              `localized ${failedTarget.label || "cradle"} clearance`
            )
          );
          localTarget.delete();
          localTarget = null;
          repairBox.delete();
          repairBox = null;
          onProgress?.(
            `applying localized ${failedTarget.label || "cradle"} witness group ${group} patch ${index + 1} of ${groupWitnesses.length}`
          );
          repairedTarget = measure(
            `localized repair ${patchNumber} target difference`,
            () => assertManifoldOk(
              core.Manifold.difference([targetSolid, localClearance]),
              `localized ${failedTarget.label || "cradle"} difference`
            )
          );

          const previousTarget = targetSolid;
          targetSolid = repairedTarget;
          repairedTarget = null;
          if (repairingInterface) interfaceSolid = targetSolid;
          else supportSolid = targetSolid;
          validPatchCount += 1;
          previousTarget.delete();
        } catch (error) {
          const reason = error?.message || String(error);
          skipped += 1;
          skippedReasons.push(reason);
          onProgress?.(
            `skipping localized ${failedTarget.label || "cradle"} witness group ${group} patch ${index + 1} of ${groupWitnesses.length} (${reason})`
          );
        } finally {
          repairedTarget?.delete?.();
          localClearance?.delete?.();
          localTarget?.delete?.();
          repairBox?.delete?.();
        }
      }

      if (!validPatchCount) {
        throw new Error(
          `localized witness group ${group} produced no valid patches${skippedReasons.length ? ` (${skippedReasons[skippedReasons.length - 1]})` : ""}`
        );
      }
      attempts += validPatchCount;
      const groupSkipped = skipped - skippedBeforeGroup;
      onProgress?.(
        `applied localized ${failedTarget.label || "cradle"} witness group ${group} with ${validPatchCount} sequential patch${validPatchCount === 1 ? "" : "es"}${groupSkipped ? ` and ${groupSkipped} skipped candidate${groupSkipped === 1 ? "" : "s"}` : ""}; checking one group certificate`
      );

      certificate = measure(
        `localized repair group ${group} native certificate`,
        () => certifyContinuousClearance(
          modelSolid,
          [
            { label: "cradle", solid: supportSolid },
            { label: "interface", solid: interfaceSolid },
          ],
          clearance,
          localizedCertificateWitnessOptions(clearance, supportMesh, interfaceMesh)
        )
      );
      timings.push(...(certificate.timings ?? []).map((timing) => ({
        ...timing,
        label: `localized repair group ${group} ${timing.label}`,
      })));
      delete certificate.timings;
      onProgress?.(certificate.passed
        ? `localized clearance witness group ${group} certified after ${attempts} total patches`
        : `localized clearance witness group ${group} left normalized gap ${Number(certificate.normalized_gap_lower_bound || 0).toFixed(6)} after ${attempts} total patches`);
      if (certificate.passed) break;
    }

    if (!attempts) return null;
    if (!certificate?.passed) {
      return { attempts, groups: group, skipped, skipped_reasons: skippedReasons, certificate };
    }
    return {
      attempts,
      groups: group,
      skipped,
      skipped_reasons: skippedReasons,
      certificate,
      support_mesh: manifoldToSupportMesh(supportSolid, supportMesh.cell_size_mm),
      interface_mesh: interfaceSolid
        ? manifoldToSupportMesh(interfaceSolid, interfaceMesh?.cell_size_mm)
        : interfaceMesh,
    };
  } finally {
    kernel?.delete?.();
    interfaceSolid?.delete?.();
    supportSolid?.delete?.();
    modelSolid?.delete?.();
  }
}

function localizedWitnessBounds(witness, cellSize, kernelMetadata = {}) {
  const points = [
    witness?.model_face_centroid_mm,
    witness?.target_face_centroid_mm,
  ].filter((point) => Array.isArray(point) && point.length >= 3 &&
    point.slice(0, 3).every((value) => Number.isFinite(Number(value))));
  if (!points.length) throw new Error("the clearance witness had no finite coordinates");

  const cellPadding = Math.max(0.25, Number(cellSize) || 0) * 2;
  const padXy = Math.max(
    2,
    cellPadding,
    (Number(kernelMetadata.extent_xy_mm) || 0) * 4
  );
  const padZ = Math.max(
    2,
    cellPadding,
    (Number(kernelMetadata.extent_z_mm) || 0) * 4
  );
  const axisValues = (axis) => points.map((point) => Number(point[axis]));
  const x = axisValues(0);
  const y = axisValues(1);
  const z = axisValues(2);
  return {
    min: {
      x: Math.min(...x) - padXy,
      y: Math.min(...y) - padXy,
      z: Math.min(...z) - padZ,
    },
    max: {
      x: Math.max(...x) + padXy,
      y: Math.max(...y) + padXy,
      z: Math.max(...z) + padZ,
    },
  };
}

function localizedWitnessKey(label, witness) {
  const point = witness?.target_face_centroid_mm;
  if (!Array.isArray(point) || point.length < 3 ||
      !point.slice(0, 3).every((value) => Number.isFinite(Number(value)))) {
    return "";
  }
  return [
    label || "cradle",
    ...point.slice(0, 3).map((value) => Number(value).toFixed(3)),
  ].join(":");
}

export function selectLocalizedWitnessGroup(failedTarget, limit, options = {}) {
  const groupLimit = Math.max(0, Math.floor(Number(limit) || 0));
  if (!groupLimit) return [];
  const availableWitnesses = Array.isArray(failedTarget?.witnesses) &&
      failedTarget.witnesses.length
    ? failedTarget.witnesses
    : [failedTarget?.witness];
  const groupWitnesses = [];
  const groupWitnessKeys = new Set();
  const groupBounds = [];
  for (const witness of availableWitnesses) {
    const witnessKey = localizedWitnessKey(failedTarget?.label, witness);
    if (!witnessKey || groupWitnessKeys.has(witnessKey)) continue;
    const bounds = localizedWitnessBounds(
      witness,
      options.cell_size_mm,
      options.kernel_metadata
    );
    if (groupBounds.some((existing) => localizedWitnessBoundsOverlap(existing, bounds))) {
      continue;
    }
    groupWitnessKeys.add(witnessKey);
    groupWitnesses.push(witness);
    groupBounds.push(bounds);
    if (groupWitnesses.length >= groupLimit) break;
  }
  return groupWitnesses;
}

function localizedWitnessBoundsOverlap(left, right) {
  return ["x", "y", "z"].every(
    (axis) => left.min[axis] <= right.max[axis] && right.min[axis] <= left.max[axis]
  );
}

function localizedCertificateWitnessOptions(clearance, ...meshes) {
  const settings = continuousClearanceCertificateSettings(clearance);
  const cellSize = Math.max(
    0,
    ...meshes.map((mesh) => Number(mesh?.cell_size_mm) || 0)
  );
  const repairRadiusMm = Math.max(2, Math.max(0.25, cellSize) * 2);
  return {
    max_witnesses: MAX_LOCAL_WITNESS_CANDIDATES,
    witness_target_cell_size_normalized: [
      Math.max(1, repairRadiusMm / settings.effective_xy_mm),
      Math.max(1, repairRadiusMm / settings.effective_xy_mm),
      Math.max(1, repairRadiusMm / settings.effective_z_mm),
    ],
  };
}

function certifyRepairedMeshesContinuousClearance(
  core,
  modelMesh,
  supportMesh,
  interfaceMesh,
  clearance,
  timings = [],
  labelPrefix = ""
) {
  let modelSolid = null;
  let supportSolid = null;
  let interfaceSolid = null;
  const measure = (label, operation) => {
    const startedAt = performance.now();
    try {
      return operation();
    } finally {
      timings.push({ label: `${labelPrefix}${label}`, ms: performance.now() - startedAt });
    }
  };

  try {
    if (!modelMesh?.vertices?.length || !modelMesh?.triangles?.length) {
      const unavailable = certifyContinuousClearance(null, [], clearance);
      unavailable.reason = "the original model mesh was unavailable for final certification";
      return unavailable;
    }
    modelSolid = measure(
      "final certificate model solid",
      () => supportMeshToManifold(core, modelMesh, "final certificate object model", { fast: true })
    );
    supportSolid = measure(
      "final certificate cradle solid",
      () => supportMeshToManifold(core, supportMesh, "final certificate cradle", { fast: true })
    );
    if (interfaceMesh?.vertices?.length && interfaceMesh?.triangles?.length) {
      interfaceSolid = measure(
        "final certificate interface solid",
        () => supportMeshToManifold(core, interfaceMesh, "final certificate interface", { fast: true })
      );
    }
    const certificate = certifyContinuousClearance(
      modelSolid,
      [
        { label: "cradle", solid: supportSolid },
        { label: "interface", solid: interfaceSolid },
      ],
      clearance,
      localizedCertificateWitnessOptions(clearance, supportMesh, interfaceMesh)
    );
    timings.push(...(certificate.timings ?? []).map((timing) => ({
      ...timing,
      label: `${labelPrefix}final ${timing.label}`,
    })));
    delete certificate.timings;
    return certificate;
  } catch (error) {
    const unavailable = certifyContinuousClearance(null, [], clearance);
    unavailable.reason = error?.message || String(error);
    return unavailable;
  } finally {
    interfaceSolid?.delete?.();
    supportSolid?.delete?.();
    modelSolid?.delete?.();
  }
}

function trimSupportMeshAgainstModelSolid(core, mesh, modelSolid, label, timings = null, sourceSolidOverride = null) {
  let phaseStart = performance.now();
  const mark = (phase) => {
    if (!timings) return;
    const now = performance.now();
    timings.push({ label: `${label} ${phase}`, ms: now - phaseStart });
    phaseStart = now;
  };

  const sourceSolid = sourceSolidOverride || supportMeshToManifold(core, mesh, `${label} source`, { fast: true });
  let trimmedSolid = null;
  try {
    mark("source solid");
    trimmedSolid = assertManifoldOk(
      core.Manifold.difference([sourceSolid, modelSolid]),
      `${label} object difference`
    );
    mark("difference");
    const trimmedMesh = manifoldToSupportMesh(trimmedSolid, mesh.cell_size_mm);
    mark("extract mesh");
    return trimmedMesh;
  } finally {
    sourceSolid.delete?.();
    trimmedSolid?.delete?.();
  }
}

function supportMeshToManifold(core, mesh, label = "mesh", options = {}) {
  if (options.fast) {
    try {
      return supportMeshToManifoldFast(core, mesh, label);
    } catch {
      // Fall through to merged path below.
    }
  }

  const prepared = directSupportMeshForManifold(mesh);
  return supportMeshPreparedToManifold(core, prepared, label, true);
}

function supportMeshToManifoldFast(core, mesh, label = "mesh") {
  const prepared = directSupportMeshForManifold(mesh);
  try {
    return supportMeshPreparedToManifold(core, prepared, label, false);
  } catch {
    return supportMeshPreparedToManifold(core, prepared, label, true);
  }
}

function supportMeshPreparedToManifold(core, prepared, label, mergeVertices = true) {
  const manifoldMesh = new core.Mesh({
    numProp: 3,
    vertProperties: toFloat32Array(prepared.vertices),
    triVerts: toUint32Array(prepared.triangles),
    tolerance: 0,
  });
  if (mergeVertices) manifoldMesh.merge();
  return assertManifoldOk(core.Manifold.ofMesh(manifoldMesh), label);
}

function directSupportMeshForManifold(mesh) {
  const vertices = toFloat32Array(mesh?.vertices ?? []);
  let triangles = mesh?.triangles;
  if (!triangles?.length) {
    const vertexCount = Math.floor(vertices.length / 3);
    triangles = new Uint32Array(vertexCount);
    for (let index = 0; index < vertexCount; index += 1) triangles[index] = index;
  } else {
    triangles = toUint32Array(triangles);
  }

  return { vertices, triangles };
}

function manifoldToSupportMesh(manifold, cellSize = undefined) {
  const mesh = manifold.getMesh();
  const numProp = mesh.numProp || 3;
  const vertices = new Float32Array(mesh.numVert * 3);
  for (let index = 0; index < mesh.numVert; index += 1) {
    vertices[index * 3] = mesh.vertProperties[index * numProp] ?? 0;
    vertices[index * 3 + 1] = mesh.vertProperties[index * numProp + 1] ?? 0;
    vertices[index * 3 + 2] = mesh.vertProperties[index * numProp + 2] ?? 0;
  }
  const triangles = new Uint32Array(mesh.triVerts);
  return {
    vertices,
    triangles,
    vertex_count: Math.floor(vertices.length / 3),
    triangle_count: Math.floor(triangles.length / 3),
    ...(cellSize ? { cell_size_mm: cellSize } : {}),
  };
}

function assertManifoldOk(manifold, label) {
  const status = manifold?.status?.();
  if (status && status !== "NoError") {
    manifold.delete?.();
    throw new Error(`${label} failed Manifold validation: ${status}`);
  }
  return manifold;
}

function toFloat32Array(value) {
  return value instanceof Float32Array ? value : new Float32Array(value ?? []);
}

function toUint32Array(value) {
  return value instanceof Uint32Array ? value : new Uint32Array(value ?? []);
}

function packMeshTransfer(mesh, transfer) {
  if (!mesh?.vertices?.buffer || !mesh?.triangles?.buffer) return;
  transfer.push(mesh.vertices.buffer, mesh.triangles.buffer);
}
