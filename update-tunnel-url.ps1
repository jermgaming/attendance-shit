# Finds the URL of the running cloudflared quick tunnel and points PUBLIC_URL at it,
# so the projector QR uses the tunnel. Run this after starting the tunnel.
$ErrorActionPreference = 'Stop'

$proc = Get-CimInstance Win32_Process |
    Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -match 'tunnel --url' } |
    Select-Object -First 1
if (-not $proc) {
    throw 'cloudflared is not running. Start it with: npx cloudflared tunnel --url http://localhost:3000'
}

$ports = Get-NetTCPConnection -OwningProcess $proc.ProcessId -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty LocalPort -Unique
if (-not $ports) { throw 'cloudflared is running but nothing is listening. Wait a moment and retry.' }

$url = $null
foreach ($p in $ports) {
    try {
        $metrics = (Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 "http://127.0.0.1:$p/metrics").Content
        if ($metrics -match 'userHostname="(https://[^"]+)"') { $url = $Matches[1]; break }
    } catch { }
}
if (-not $url) { throw 'Could not read the tunnel URL from cloudflared. The tunnel may still be connecting.' }

$envFile = Join-Path $PSScriptRoot '.env'
$content = Get-Content $envFile -Raw
if ($content -match '(?m)^PUBLIC_URL=.*$') {
    $content = $content -replace '(?m)^PUBLIC_URL=.*$', "PUBLIC_URL=$url"
} else {
    $content += "`nPUBLIC_URL=$url`n"
}
Set-Content -Path $envFile -Value $content -NoNewline

Set-Location $PSScriptRoot
docker compose up -d app
Write-Output "PUBLIC_URL set to $url - refresh the projector page and share the QR."
