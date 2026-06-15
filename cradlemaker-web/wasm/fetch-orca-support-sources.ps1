param(
    [string] $Ref = "main",
    [string] $Destination = ""
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptRoot "..\..")

if ([string]::IsNullOrWhiteSpace($Destination)) {
    $Destination = Join-Path $repoRoot "orca-upstream\OrcaSlicer"
}

$repoUrl = "https://github.com/OrcaSlicer/OrcaSlicer.git"
$sparsePaths = @(
    "src/libslic3r",
    "src/admesh",
    "src/clipper",
    "src/glu-libtess",
    "src/miniz_extension",
    "src/qhull",
    "src/semver"
)

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required to fetch OrcaSlicer support sources."
}

$destinationParent = Split-Path -Parent $Destination
if (-not (Test-Path $destinationParent)) {
    New-Item -ItemType Directory -Force -Path $destinationParent | Out-Null
}

if (Test-Path (Join-Path $Destination ".git")) {
    git -C $Destination fetch --depth 1 origin $Ref
} else {
    git clone --filter=blob:none --no-checkout $repoUrl $Destination
    git -C $Destination sparse-checkout init --cone
    git -C $Destination sparse-checkout set $sparsePaths
    git -C $Destination fetch --depth 1 origin $Ref
}

git -C $Destination checkout FETCH_HEAD
git -C $Destination sparse-checkout set $sparsePaths

$libslic3r = Join-Path $Destination "src\libslic3r"
if (-not (Test-Path (Join-Path $libslic3r "Support\TreeSupport3D.cpp"))) {
    throw "Fetch completed, but TreeSupport3D.cpp was not found under $libslic3r."
}

Write-Host "Orca support sources ready:"
Write-Host "  $libslic3r"
Write-Host ""
Write-Host "Configure the optional probe with:"
Write-Host "  -DORCA_LIBSLIC3R_DIR=`"$libslic3r`""
