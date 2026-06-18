# CradleMaker

CradleMaker is a standalone web app for making printable support cradles for museum objects and other physical artifacts. It imports STL models, generates a solid cradle/support mesh, checks the result with QA summaries, and exports printable STL/PLY files without requiring a full slicer UI.

The app is designed around museum handling needs: predictable support surfaces, object clearance checks, optional soft-interface or foam-gap workflows, split-for-printing tools for cradles larger than a printer bed, and CNC foam relief previews for subtractive Ethafoam cradles.

## Try It

GitHub Pages:

```text
https://adamrountrey.github.io/CradleMaker/cradlemaker-web/
```

Local development:

```powershell
node cradlemaker-web/server.mjs
```

Then open:

```text
http://127.0.0.1:5177/cradlemaker-web/
```

## Current Features

- STL import and bundled sample model loading.
- Three.js model viewer with grid, model visibility modes, rotation presets, and surface-painted support enforcer/blocker regions.
- Stable normal/default cradle generation through the CradleMaker WASM support core.
- QA dashboard for support coverage, model intersections, mesh support reach, and estimated stability.
- BVH-accelerated model picking, paint interaction, model-intersection QA, and CNC foam relief sampling.
- Optional top soft-interface mesh exported separately for multi-material systems.
- Optional foam gap clearance for adding padding after printing.
- Split preview for large cradles, with per-chunk STL export and manifest export.
- Z-slide dovetail connector work for split chunks.
- CNC foam workflow for ShopBot/VCarve-style top-side relief carving from foam blocks.
- GitHub Pages deployment from the static `cradlemaker-web/` folder.

## Terms of Use

CradleMaker is source-available under the [CradleMaker Terms of Use](TERMS_OF_USE.md). Personal and non-commercial use is permitted; commercial use is prohibited without prior written permission from copyright holder Adam Rountrey.

Because the terms restrict commercial use and derivative redistribution, this project should not be described as OSI-approved open source. Third-party components retain their own license terms; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Project Layout

```text
cradlemaker-web/
  index.html              Web app shell
  src/                    Three.js UI, options, WASM loader, styles
  src/wasm/               Built CradleMaker WASM support core
  wasm/                   C++ support core source and build scripts
  samples/                Sample STL files for testing
  vendor/                 Browser-side vendored dependencies
.github/workflows/        GitHub Pages deployment workflow
```

## Notes

Organic/tree support experiments are kept in the codebase for future work, but the current UI intentionally exposes only the stable `Normal auto` / `Default (Grid/Organic)` cradle workflow.

The CNC foam workflow exports a 3D STL relief/block for VCarve import. It auto-fits model lift by default when the carve is too deep, with a manual lift override when needed, and limits the cavity surface with a flat-end or ball-nose cutter envelope so the preview does not show details the chosen tool cannot reach. It does not generate ShopBot toolpaths.

Painted support enforcer/blocker regions are available in print mode. Coverage paint is a surface mask; regenerate supports after painting to apply it.

The repository does not ship OrcaSlicer source. Any Orca-related probe scripts fetch reference sources into ignored local folders for development only.
