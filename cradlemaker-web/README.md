# CradleMaker Web

CradleMaker is a standalone Three.js app for building independently printable support cradles and CNC foam cradles for physical objects. It can import an STL, orient/elevate the object with an interactive rotation helper, create automatic cradle supports, paint support enforcer/blocker regions on the model surface, preview the result, and export generated meshes.

Large models use a browser-side mesh BVH for faster picking, painting, model-intersection QA, and CNC foam relief sampling.

The split-for-printing controls can preview a chunk layout against a selected build volume and export per-chunk STL files plus a JSON manifest. Split chunks are produced with Manifold WASM booleans so cut faces are planar, printable solids instead of cell-by-cell walls. The current connector pass adds split-face Z-slide dovetail hardware with boolean-cut trapezoid sockets, sloped pocket/key roofs for support-free printing, adjustable clearance, and adjustable size.

The CNC Foam workflow previews a single-sided 3-axis relief for carving a cradle from an Ethafoam block. It supports separate XY/Z cavity clearance, auto-fit model lift, manual lift override, flat-end or ball-nose tool QA, margin finger holes, and optional multi-slab foam workflows. Single-block mode uses the block height field and exports one watertight STL block/relief for VCarve import. Slab mode uses slab count and slab thickness to define total foam height, then exports one local-coordinate STL per slab plus a JSON manifest with stack order and through-slab dowel alignment holes.

## Run

Serve the repository root and open `cradlemaker-web/`.

```powershell
node cradlemaker-web/server.mjs
```

If the Windows `node` app alias is unavailable, use any Python 3 install from the repository root:

```powershell
python -m http.server 5177 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:5177/cradlemaker-web/
```

## Build Native Core

The checked-in app includes the current WebAssembly support core under `src/wasm/`. Rebuild it from the repository root with:

```powershell
cmd /c cradlemaker-web\wasm\build-wasm.bat
```

The experimental real-Orca organic tree compile probe is:

```powershell
.\cradlemaker-web\wasm\fetch-orca-support-sources.ps1
$env:PATH = (Resolve-Path 'tools\emsdk\python\3.13.3_64bit').Path + ';' + $env:PATH
& tools\strawberry-perl\c\bin\cmake.exe --build build-wasm --target cradlemaker_orca_support_probe --config Release
```

The fetch script sparse-checks out upstream OrcaSlicer support sources into the ignored local cache `orca-upstream/OrcaSlicer`. The web app does not commit or ship that source tree.

## GitHub Pages

The app is static and can be published directly from `cradlemaker-web/`. The repository workflow `cradlemaker-pages.yml` uploads this folder as the Pages artifact.

The bundled sample model lives in `cradlemaker-web/samples/` so the sample loader works both locally and on Pages.

## Terms of Use

CradleMaker is source-available under the repository-level CradleMaker Terms of Use. Personal and non-commercial use is permitted; commercial use is prohibited without prior written permission from copyright holder Adam Rountrey. Third-party components retain their own license terms.

## Current Limits

- Normal cradle generation uses the current CradleMaker WASM solid cradle engine.
- Split-for-printing exports use Manifold WASM booleans for chunk cuts and connector sockets, with a height-field fallback if the generated cradle mesh is rejected as non-manifold.
- CNC foam export creates STL relief/components for VCarve; it applies flat-end or ball-nose tool QA, supports finger-hole access pockets, and can export multi-slab foam jobs with dowel alignment holes. It does not generate ShopBot toolpaths.
- Real Orca organic tree support is being isolated as an optional WASM probe. The clean web checkout does not include upstream Orca sources; fetch them locally with `cradlemaker-web\wasm\fetch-orca-support-sources.ps1` before working on the probe.
- Tree/organic support experiments are kept in the codebase, but the UI currently exposes only the stable `Normal auto` / `Default (Grid/Organic)` cradle workflow.
- Painted support enforcer/blocker regions are available in print mode. Coverage paint is a surface mask; regenerate supports after painting to apply it.
