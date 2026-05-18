param(
  [string]$Output = "nvr_host_upload.tar.gz"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  if (Test-Path $Output) {
    Remove-Item -LiteralPath $Output -Force
  }

  tar `
    --exclude=".git" `
    --exclude="node_modules" `
    --exclude="dist" `
    --exclude=".env" `
    --exclude="data/cameras.yaml" `
    --exclude="data/go2rtc.yaml" `
    --exclude="$Output" `
    -czf $Output .

  Write-Host "Created $Output"
  Write-Host "Upload it to the Linux host, extract under /opt/nvr_host, then run: docker compose up -d --build"
}
finally {
  Pop-Location
}
