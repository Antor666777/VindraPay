param(
    [ValidateSet("windows", "linux")]
    [string]$Target = "linux",

    [ValidateSet("amd64", "arm64")]
    [string]$Arch = "amd64"
)

$ErrorActionPreference = "Stop"

$appName = "vindrapay-go"
$outDir = Join-Path $PSScriptRoot "..\bin"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$ext = if ($Target -eq "windows") { ".exe" } else { "" }
$outFile = Join-Path $outDir "$appName-$Target-$Arch$ext"

Write-Host "Building $appName for $Target/$Arch..." -ForegroundColor Cyan

$env:CGO_ENABLED = "0"
$env:GOOS = $Target
$env:GOARCH = $Arch

try {
    go build -trimpath -ldflags "-s -w" -o $outFile (Join-Path $PSScriptRoot "..\cmd\api")
} finally {
    Remove-Item Env:CGO_ENABLED, Env:GOOS, Env:GOARCH -ErrorAction SilentlyContinue
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "Build succeeded: $outFile" -ForegroundColor Green
} else {
    Write-Error "Build failed"
}
