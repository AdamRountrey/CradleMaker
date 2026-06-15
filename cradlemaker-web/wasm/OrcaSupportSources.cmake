# Source manifest for the deliberately small Orca-derived support core.
#
# Keep this list explicit. The point of Cradlemaker WASM is to import only the
# support-generation boundary we need, not the monolithic libslic3r target.
# These are upstream Orca support-generation files. Cradle solidification remains
# Cradlemaker-owned code, not a dependency on the old modified Orca checkout.

set(CRADLEMAKER_ORCA_SUPPORT_SOURCE_CANDIDATES
    "${ORCA_LIBSLIC3R_DIR}/PrintObject.cpp"
    "${ORCA_LIBSLIC3R_DIR}/PrintObjectSlice.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/SupportCommon.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/SupportMaterial.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/TreeModelVolumes.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/TreeSupport.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/TreeSupport3D.cpp"
)
