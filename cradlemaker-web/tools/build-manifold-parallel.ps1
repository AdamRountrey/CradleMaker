param(
  [string]$SourceDir = "",
  [string]$BuildDir = "",
  [int]$ThreadPoolSize = 8,
  [switch]$SkipClone
)

$ErrorActionPreference = "Stop"

$WebRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $WebRoot "..")
$DefaultSource = Join-Path $WebRoot ".work\manifold-src"
$DefaultBuild = Join-Path $WebRoot ".work\manifold-par-build-tbb8-local"
$OutputDir = Join-Path $WebRoot "vendor\manifold-par"

if (-not $SourceDir) { $SourceDir = $DefaultSource }
if (-not $BuildDir) { $BuildDir = $DefaultBuild }

$EmsdkEnv = Join-Path $RepoRoot "tools\emsdk\emsdk_env.bat"
if (-not (Test-Path $EmsdkEnv)) {
  throw "Emscripten SDK not found at $EmsdkEnv"
}
$CmakeBin = Join-Path $RepoRoot "tools\strawberry-perl\c\bin"
$CmakeExe = Join-Path $CmakeBin "cmake.exe"
if (-not (Test-Path $CmakeExe)) {
  throw "Bundled CMake not found at $CmakeBin"
}
$EmcmakeExe = Join-Path $RepoRoot "tools\emsdk\upstream\emscripten\emcmake.exe"
if (-not (Test-Path $EmcmakeExe)) {
  throw "emcmake not found at $EmcmakeExe"
}

New-Item -ItemType Directory -Force -Path (Split-Path $SourceDir) | Out-Null
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if (-not (Test-Path (Join-Path $SourceDir "CMakeLists.txt"))) {
  if ($SkipClone) {
    throw "Manifold source was not found at $SourceDir"
  }
  git clone --depth 1 --recurse-submodules https://github.com/elalish/manifold.git $SourceDir
}

if ($ThreadPoolSize -lt 2 -or $ThreadPoolSize -gt 16) {
  throw "ThreadPoolSize must be between 2 and 16."
}

$CMakeLists = Join-Path $SourceDir "CMakeLists.txt"
$CMakeText = Get-Content -LiteralPath $CMakeLists -Raw
$CMakeText = $CMakeText -replace "add_link_options\(-sPTHREAD_POOL_SIZE=\d+\)", "add_link_options(-sPTHREAD_POOL_SIZE=$ThreadPoolSize)"
Set-Content -LiteralPath $CMakeLists -Value $CMakeText -NoNewline

$BindingsCpp = Join-Path $SourceDir "bindings\wasm\bindings.cpp"
$BindingsText = Get-Content -LiteralPath $BindingsCpp -Raw
if ($BindingsText -notmatch "max_allowed_parallelism") {
  $BindingsText = $BindingsText -replace "#include <tbb/parallel_for\.h>\r?\n\r?\n#include <atomic>", "#include <tbb/global_control.h>`r`n#include <tbb/parallel_for.h>`r`n`r`n#include <algorithm>`r`n#include <atomic>"
  $BindingsText = $BindingsText.Replace(
    "  int num_threads = tbb::this_task_arena::max_concurrency();",
    "  static tbb::global_control max_threads(`r`n      tbb::global_control::max_allowed_parallelism, $ThreadPoolSize);`r`n  int num_threads = std::min(tbb::this_task_arena::max_concurrency(), $ThreadPoolSize);"
  )
} else {
  $BindingsText = [regex]::Replace($BindingsText, "max_allowed_parallelism,\s*\d+\)", "max_allowed_parallelism, $ThreadPoolSize)")
  $BindingsText = [regex]::Replace($BindingsText, "max_concurrency\(\),\s*\d+\)", "max_concurrency(), $ThreadPoolSize)")
}
Set-Content -LiteralPath $BindingsCpp -Value $BindingsText -NoNewline

$FetchContentArgs = @()
$ExistingTbbSource = Join-Path $WebRoot ".work\manifold-par-build\_deps\tbb-src"
if (Test-Path (Join-Path $ExistingTbbSource "CMakeLists.txt")) {
  $FetchContentArgs += "-DFETCHCONTENT_SOURCE_DIR_TBB=`"$ExistingTbbSource`""
}
$FetchContentText = $FetchContentArgs -join " "

$Configure = @(
  "call `"$EmsdkEnv`"",
  "set PATH=$CmakeBin;%PATH%",
  "`"$EmcmakeExe`" `"$CmakeExe`" -G `"MinGW Makefiles`" -S `"$SourceDir`" -B `"$BuildDir`" -DCMAKE_BUILD_TYPE=MinSizeRel -DMANIFOLD_JSBIND=ON -DMANIFOLD_PAR=ON -DMANIFOLD_USE_BUILTIN_TBB=ON -DMANIFOLD_TEST=OFF -DBUILD_SHARED_LIBS=OFF $FetchContentText"
) -join " && "
cmd.exe /d /s /c $Configure
if ($LASTEXITCODE -ne 0) {
  throw "Parallel Manifold configure failed with exit code $LASTEXITCODE."
}

$BuildOutputDir = Join-Path $BuildDir "bindings\wasm"
foreach ($Generated in @("manifold.js", "manifold.wasm")) {
  $GeneratedPath = Join-Path $BuildOutputDir $Generated
  if (Test-Path $GeneratedPath) {
    Remove-Item -LiteralPath $GeneratedPath -Force
  }
}

$Build = @(
  "call `"$EmsdkEnv`"",
  "set PATH=$CmakeBin;%PATH%",
  "`"$CmakeExe`" --build `"$BuildDir`" --target manifoldjs --config Release"
) -join " && "
cmd.exe /d /s /c $Build
if ($LASTEXITCODE -ne 0) {
  throw "Parallel Manifold build failed with exit code $LASTEXITCODE."
}

$Candidates = @(
  (Join-Path $BuildDir "bindings\wasm"),
  (Join-Path $SourceDir "bindings\wasm")
)

$BuiltJs = $null
$BuiltWasm = $null
foreach ($Candidate in $Candidates) {
  $Js = Join-Path $Candidate "manifold.js"
  $Wasm = Join-Path $Candidate "manifold.wasm"
  if ((Test-Path $Js) -and (Test-Path $Wasm)) {
    $BuiltJs = $Js
    $BuiltWasm = $Wasm
    break
  }
}

if (-not $BuiltJs -or -not $BuiltWasm) {
  throw "Build completed, but manifold.js/manifold.wasm were not found in expected locations."
}

Copy-Item -LiteralPath $BuiltJs -Destination (Join-Path $OutputDir "manifold.js") -Force
Copy-Item -LiteralPath $BuiltWasm -Destination (Join-Path $OutputDir "manifold.wasm") -Force

$License = Join-Path $SourceDir "LICENSE"
if (Test-Path $License) {
  Copy-Item -LiteralPath $License -Destination (Join-Path $OutputDir "LICENSE") -Force
}

Write-Host "Parallel Manifold candidate copied to $OutputDir"
