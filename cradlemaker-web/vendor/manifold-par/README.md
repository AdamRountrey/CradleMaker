# Experimental Parallel Manifold Backend

This folder is reserved for an optional Manifold WASM build compiled with
`MANIFOLD_PAR=ON`.

CradleMaker will try this backend only when the browser page is cross-origin
isolated and `SharedArrayBuffer` is available. If `manifold.js` or
`manifold.wasm` are missing or fail to load, the app falls back to the vendored
serial backend in `vendor/manifold`.

Build with:

```powershell
.\cradlemaker-web\tools\build-manifold-parallel.ps1
```

The build is experimental. Upstream Manifold currently documents the published
WASM package as serial-only, so this backend must be benchmarked before it is
treated as production-ready.

This local build caps oneTBB and `PTHREAD_POOL_SIZE` to 8 workers. The cap keeps
Manifold's WASM `initTBB()` warmup from waiting for more participants than
Emscripten preallocated, which can otherwise deadlock in browsers that report a
large `navigator.hardwareConcurrency`.
