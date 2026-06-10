# Cradlemaker WASM Port

Cradlemaker should not run the OrcaSlicer application. The target is a browser app backed by a small WebAssembly support core extracted from Orca/libslic3r.

## Boundary

The browser owns:

- STL/PLY file selection and preview display.
- Three.js orbit, transform controls, manual support painting/marking, and preview rendering.
- Calling the WASM support core with mesh bytes, transform, support settings, and manual support data.

The WASM core owns:

- Model import into `libslic3r` mesh/model structures.
- Orca-derived FDM support generation.
- Conversion of generated support layers to independently printable cradle solids.
- STL/PLY bytes for preview/export.

## First Native Extraction

`src/libslic3r/Cradle/CradleSupport.*` now contains the GUI-independent cradle solidification logic previously embedded in `Plater.cpp`:

- `support_layer_regions`
- `accumulated_support_slices`
- `slices_to_slab_mesh`
- `build_support_solid`

The next native step is to create a small support-core entry point that:

1. Builds an Orca `Model`/`PrintObject` from the uploaded mesh.
2. Applies the support settings and manual support enforcer/blocker data.
3. Runs Orca/libslic3r support generation.
4. Passes the generated `SupportLayer` list to `Cradle::accumulated_support_slices`.
5. Returns a binary STL/PLY buffer generated from `Cradle::build_support_solid`.

## Tooling

Emscripten is installed locally under `tools/emsdk`.

The first bridge module is:

- `cradlemaker-web/wasm/CradlemakerCore.cpp`
- `cradlemaker-web/wasm/OrcaSupportBridge.cpp`
- `cradlemaker-web/src/wasmCore.js`

Build it with:

```powershell
cmd /c cradlemaker-web\wasm\build-wasm.bat
```

This currently exports `coreStatus()`, `coreVersion()`, `supportOptionSchemaJson()`, `supportCorePlanJson()`, and `prepareSupportJobJson()` through embind. The stable fallback path generates the high-resolution solid cradle in WASM. Tree / Organic requests are intentionally not faked; until Orca's real tree engine is linked into this target, those requests return the solid cradle fallback and report that real Orca tree support is pending.

The web UI now collects support settings using Orca `PrintConfig` keys and enum values instead of Cradlemaker-only names. The bridge also exposes `supportOptionSchemaJson()` so the browser/native contract is explicit while the real support-generation entry point is being ported.

Current web-side support keys:

- `enable_support`
- `support_type`
- `support_style`
- `support_base_pattern`
- `support_interface_pattern`
- `support_threshold_angle`
- `support_threshold_overlap`
- `support_on_build_plate_only`
- `support_critical_regions_only`
- `support_remove_small_overhang`
- `support_top_z_distance`
- `support_bottom_z_distance`
- `support_object_xy_distance`
- `support_base_pattern_spacing`
- `support_interface_top_layers`
- `support_interface_bottom_layers`
- `support_interface_spacing`
- `support_bottom_interface_spacing`
- `tree_support_branch_distance`
- `tree_support_tip_diameter`
- `tree_support_branch_diameter`
- `tree_support_branch_angle`
- `tree_support_wall_count`

The later full CMake build direction is:

```powershell
emcmake cmake -S . -B build-wasm -DSLIC3R_GUI=OFF -DCRADLEMAKER_WASM=ON
cmake --build build-wasm --target cradlemaker_wasm
```

The exact target can be added after the support-core entry point is isolated enough to build without wxWidgets, device code, or full OrcaSlicer GUI dependencies.

## Organic Tree Probe

`cradlemaker_orca_support_probe` is an experimental compile-only target for the real Orca support files. It is intentionally excluded from the default `cradlemaker_wasm` build, so the web app stays stable while the native port is being isolated.

Build it with:

```powershell
$env:PATH = (Resolve-Path 'tools\emsdk\python\3.13.3_64bit').Path + ';' + $env:PATH
& tools\strawberry-perl\c\bin\cmake.exe --build build-wasm --target cradlemaker_orca_support_probe --config Release
```

Current status: the source set for Orca normal/tree/organic support compiles under Emscripten as object files. The probe currently depends on Orca geometry headers, Boost, Eigen, libigl, libnest2d, TBB headers, and temporary desktop dependency include roots for Cereal, generated OpenSSL config, and OCCT headers pulled indirectly through `Model.hpp`.

The probe is not runtime support generation yet. Real organic tree support becomes available only after the app can create a headless `Print` / `PrintObject`, initialize Orca config, generate object layers, invoke `TreeSupport::generate()`, and convert `SupportLayer` polygons into cradle solids.

## Current Real Orca Port Boundary

`OrcaSupportBridge.cpp` names the real extraction boundary. The WASM target must next construct a headless `Slic3r::Print` / `Slic3r::PrintObject` from the uploaded mesh, configure Orca support settings, call:

- `Slic3r::PrintObject::generate_support_material`
- `Slic3r::PrintObject::_generate_support_material`
- `Slic3r::TreeSupport::generate`
- `Slic3r::generate_tree_support_3D`
- `Slic3r::TreeSupport3D::generate_support_areas`

Then it should pass `PrintObject::support_layers()` into `Slic3r::Cradle::accumulated_support_slices` and `Slic3r::Cradle::build_support_solid`.
