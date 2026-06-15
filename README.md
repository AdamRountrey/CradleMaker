# CradleMaker

CradleMaker is a standalone web app for making printable support cradles for museum objects and other physical artifacts. It imports STL models, generates a solid cradle/support mesh, checks the result with QA summaries, and exports printable STL/PLY files without requiring a full slicer UI.

The app is designed around museum handling needs: predictable support surfaces, object clearance checks, optional soft-interface or foam-gap workflows, and split-for-printing tools for cradles larger than a printer bed.

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

- STL import and sample model loading.
- Three.js model viewer with grid, model visibility modes, rotation presets, and manual support marks.
- Stable normal/default cradle generation through the CradleMaker WASM support core.
- QA dashboard for support coverage, model intersections, mesh support reach, and estimated stability.
- Optional top soft-interface mesh exported separately for multi-material systems.
- Optional foam gap clearance for adding padding after printing.
- Split preview for large cradles, with per-chunk STL export and manifest export.
- Z-slide dovetail connector work for split chunks.
- GitHub Pages deployment from the static `cradlemaker-web/` folder.

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

The repository does not ship OrcaSlicer source. Any Orca-related probe scripts fetch reference sources into ignored local folders for development only.
