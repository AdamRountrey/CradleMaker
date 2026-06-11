# Cradlemaker Web

Cradlemaker is a standalone Three.js app for building independently printable support cradles for physical objects. It can import an STL, orient/elevate the object, create automatic or manual cradle supports, preview the result, and export the generated support mesh.

The split-for-printing controls can preview a draft chunk layout against a selected build volume and export per-chunk STL files plus a JSON manifest. This first pass is for sizing, review, and workflow testing; watertight seam caps and keyed dovetail/puzzle connectors are still upcoming work.

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
$env:PATH = (Resolve-Path 'tools\emsdk\python\3.13.3_64bit').Path + ';' + $env:PATH
& tools\strawberry-perl\c\bin\cmake.exe --build build-wasm --target cradlemaker_wasm --config Release
```

The experimental real-Orca organic tree compile probe is:

```powershell
$env:PATH = (Resolve-Path 'tools\emsdk\python\3.13.3_64bit').Path + ';' + $env:PATH
& tools\strawberry-perl\c\bin\cmake.exe --build build-wasm --target cradlemaker_orca_support_probe --config Release
```

## GitHub Pages

The app is static and can be published directly from `cradlemaker-web/`. The repository workflow `cradlemaker-pages.yml` uploads this folder as the Pages artifact.

The bundled sample model lives in `cradlemaker-web/samples/` so the sample loader works both locally and on Pages.

## Current Limits

- Normal cradle generation uses the current Cradlemaker WASM solid cradle engine.
- Split-for-printing exports are draft triangle partitions. They are not yet watertight boolean cuts and do not yet include assembly connectors.
- Real Orca organic tree support source now compiles as a WASM probe, but it is not wired to runtime generation yet.
- Tree/organic support requests intentionally fall back to the stable solid cradle until the headless Orca `PrintObject` adapter is complete.
- Manual support clicks are point marks; painted enforcer/blocker regions are still future work.
