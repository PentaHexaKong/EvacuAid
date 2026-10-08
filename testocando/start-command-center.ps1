$ErrorActionPreference = 'Stop'
$repoPath = Split-Path $PSScriptRoot -Parent
Push-Location $repoPath
try {
    docker compose up -d --build --wait --wait-timeout 180 dashboard
    if ($LASTEXITCODE -ne 0) { throw 'Dashboard stack startup failed' }
    Write-Host 'Command API: http://127.0.0.1:8000/v1/command/regions'
    Write-Host 'Dashboard: http://127.0.0.1:8080/command-center/'
    Write-Host 'Dashboard opens automatically; no command token required'
} finally { Pop-Location }
