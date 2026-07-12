param(
  [string]$SourceDir = "",
  [string]$BuildDir = "",
  [string]$OutputDir = "",
  [ValidateSet("size", "o3", "simd", "lto")]
  [string]$OptimizationProfile = "size",
  [switch]$SkipPatch
)

$ErrorActionPreference = "Stop"

$WebRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $WebRoot "..")
$DefaultSource = Join-Path $WebRoot ".work\manifold-src"
$BuildProfileSuffix = "-$OptimizationProfile"
$OutputProfileSuffix = if ($OptimizationProfile -eq "size") { "" } else { "-$OptimizationProfile" }
$DefaultBuild = Join-Path $WebRoot ".work\manifold-targeted-build$BuildProfileSuffix"
$DefaultOutput = Join-Path $WebRoot "vendor\manifold-targeted$OutputProfileSuffix"
$PatchPath = Join-Path $PSScriptRoot "patches\manifold-targeted-minkowski.patch"
$ExpectedCommit = "8bffb521010a9852c2270a0ffbb3d3e225c3beab"

if (-not $SourceDir) { $SourceDir = $DefaultSource }
if (-not $BuildDir) { $BuildDir = $DefaultBuild }
if (-not $OutputDir) { $OutputDir = $DefaultOutput }

if (-not (Test-Path (Join-Path $SourceDir "CMakeLists.txt"))) {
  throw "Pinned Manifold source was not found at $SourceDir"
}
$ActualCommit = (git -C $SourceDir rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $ActualCommit -ne $ExpectedCommit) {
  throw "Expected Manifold commit $ExpectedCommit, found $ActualCommit"
}

if (-not $SkipPatch) {
  $SavedErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  git -C $SourceDir apply --check $PatchPath 2>$null
  $CanApplyPatch = $LASTEXITCODE -eq 0
  $ErrorActionPreference = $SavedErrorActionPreference
  if ($CanApplyPatch) {
    git -C $SourceDir apply $PatchPath
    if ($LASTEXITCODE -ne 0) { throw "Failed to apply targeted Minkowski patch." }
  } else {
    $ErrorActionPreference = "Continue"
    git -C $SourceDir apply --reverse --check $PatchPath 2>$null
    $PatchAlreadyApplied = $LASTEXITCODE -eq 0
    $ErrorActionPreference = $SavedErrorActionPreference
    if (-not $PatchAlreadyApplied) {
      throw "Targeted Minkowski patch is neither cleanly applicable nor already applied."
    }
  }
}

$EmsdkEnv = Join-Path $RepoRoot "tools\emsdk\emsdk_env.bat"
$CmakeBin = Join-Path $RepoRoot "tools\strawberry-perl\c\bin"
$CmakeExe = Join-Path $CmakeBin "cmake.exe"
$EmcmakeExe = Join-Path $RepoRoot "tools\emsdk\upstream\emscripten\emcmake.exe"
foreach ($Required in @($EmsdkEnv, $CmakeExe, $EmcmakeExe)) {
  if (-not (Test-Path $Required)) { throw "Required build tool not found at $Required" }
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$EmccTemp = Join-Path $WebRoot ".work\emcc-targeted$BuildProfileSuffix"
New-Item -ItemType Directory -Force -Path (Join-Path $EmccTemp "emscripten_temp") | Out-Null

# Python 3.13 creates random Windows temp folders with restrictive ACLs that
# are inaccessible to the unelevated sandbox token. Debug mode uses this fixed,
# workspace-local Emscripten temp folder instead.
$Environment = @(
  "set `"EMCC_TEMP_DIR=$EmccTemp`"",
  "set `"EMCC_DEBUG=1`"",
  "call `"$EmsdkEnv`"",
  "set PATH=$CmakeBin;%PATH%"
)

$BuildType = if ($OptimizationProfile -eq "size") { "MinSizeRel" } else { "Release" }
$ConfigureArgs = @(
  "-G `"MinGW Makefiles`"",
  "-S `"$SourceDir`"",
  "-B `"$BuildDir`"",
  "-DCMAKE_BUILD_TYPE=$BuildType",
  "-DMANIFOLD_JSBIND=ON",
  "-DMANIFOLD_PAR=OFF",
  "-DMANIFOLD_TEST=OFF",
  "-DBUILD_SHARED_LIBS=OFF"
)
if ($OptimizationProfile -in @("simd", "lto")) {
  $ConfigureArgs += "-DCMAKE_CXX_FLAGS=-msimd128"
}
if ($OptimizationProfile -eq "lto") {
  $ConfigureArgs += "-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON"
}
$ConfigureCommand = "`"$EmcmakeExe`" `"$CmakeExe`" " + ($ConfigureArgs -join " ")
$Configure = $Environment + @($ConfigureCommand)
cmd.exe /d /s /c ($Configure -join " && ")
if ($LASTEXITCODE -ne 0) {
  throw "Targeted Manifold configure failed with exit code $LASTEXITCODE."
}

$Build = $Environment + @(
  "`"$CmakeExe`" --build `"$BuildDir`" --target manifoldjs --config Release"
)
cmd.exe /d /s /c ($Build -join " && ")
if ($LASTEXITCODE -ne 0) {
  throw "Targeted Manifold build failed with exit code $LASTEXITCODE."
}

$BuildOutputDir = Join-Path $BuildDir "bindings\wasm"
$BuiltJs = Join-Path $BuildOutputDir "manifold.js"
$BuiltWasm = Join-Path $BuildOutputDir "manifold.wasm"
if (-not (Test-Path $BuiltJs) -or -not (Test-Path $BuiltWasm)) {
  throw "Build completed, but manifold.js/manifold.wasm were not found."
}

Copy-Item -LiteralPath $BuiltJs -Destination (Join-Path $OutputDir "manifold.js") -Force
Copy-Item -LiteralPath $BuiltWasm -Destination (Join-Path $OutputDir "manifold.wasm") -Force
$License = Join-Path $SourceDir "LICENSE"
if (Test-Path $License) {
  Copy-Item -LiteralPath $License -Destination (Join-Path $OutputDir "LICENSE") -Force
}

$CompileFlagsPath = Join-Path $BuildDir "src\CMakeFiles\manifold.dir\flags.make"
$LinkCommandPath = Join-Path $BuildDir "bindings\wasm\CMakeFiles\manifoldjs.dir\link.txt"
$CompileFlags = if (Test-Path $CompileFlagsPath) {
  ((Get-Content -LiteralPath $CompileFlagsPath) |
    Where-Object { $_ -like "CXX_FLAGS =*" } |
    Select-Object -First 1) -replace "^CXX_FLAGS =\s*", ""
} else { "" }
$LinkCommand = if (Test-Path $LinkCommandPath) {
  (Get-Content -LiteralPath $LinkCommandPath -Raw).Trim()
} else { "" }
$LinkOptions = @(
  [regex]::Matches($LinkCommand, '(?<!\S)-{1,2}[^\s]+') |
    ForEach-Object { $_.Value }
)
$EmscriptenVersionPath = Join-Path $RepoRoot "tools\emsdk\upstream\emscripten\emscripten-version.txt"
$EmscriptenVersion = if (Test-Path $EmscriptenVersionPath) {
  (Get-Content -LiteralPath $EmscriptenVersionPath -Raw).Trim().Trim('"')
} else { "unknown" }
$CmakeVersion = (& $CmakeExe --version | Select-Object -First 1) -replace '^cmake version\s+', ''
$OutputJs = Join-Path $OutputDir "manifold.js"
$OutputWasm = Join-Path $OutputDir "manifold.wasm"

@{
  profile = $OptimizationProfile
  build_type = $BuildType
  simd = $OptimizationProfile -in @("simd", "lto")
  lto = $OptimizationProfile -eq "lto"
  manifold_commit = $ActualCommit
  emscripten_version = $EmscriptenVersion
  cmake_version = $CmakeVersion
  effective_compile_flags = $CompileFlags
  effective_link_options = $LinkOptions
  source_patch_sha256 = (Get-FileHash -LiteralPath $PatchPath -Algorithm SHA256).Hash.ToLowerInvariant()
  javascript_sha256 = (Get-FileHash -LiteralPath $OutputJs -Algorithm SHA256).Hash.ToLowerInvariant()
  wasm_sha256 = (Get-FileHash -LiteralPath $OutputWasm -Algorithm SHA256).Hash.ToLowerInvariant()
  javascript_bytes = (Get-Item -LiteralPath $OutputJs).Length
  wasm_bytes = (Get-Item -LiteralPath $OutputWasm).Length
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir "build-profile.json")

Write-Host "Target-aware serial Manifold $OptimizationProfile bundle copied to $OutputDir"
