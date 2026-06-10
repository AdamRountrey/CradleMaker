# Source manifest for the deliberately small Orca-derived support core.
#
# Keep this list explicit. The point of Cradlemaker WASM is to import only the
# support-generation boundary we need, not the monolithic libslic3r target.
# These files are not compiled yet; they are the next import set as dependencies
# are isolated behind cradlemaker_support_core.

set(CRADLEMAKER_ORCA_SUPPORT_SOURCE_CANDIDATES
    "${ORCA_LIBSLIC3R_DIR}/PrintObject.cpp"
    "${ORCA_LIBSLIC3R_DIR}/PrintObjectSlice.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/SupportCommon.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/SupportMaterial.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/TreeModelVolumes.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/TreeSupport.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Support/TreeSupport3D.cpp"
    "${ORCA_LIBSLIC3R_DIR}/Cradle/CradleSupport.cpp"
)
