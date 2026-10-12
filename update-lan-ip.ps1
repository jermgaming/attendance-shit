
# Updates PUBLIC_URL in .env to the address students should use,
# then restarts the app.
# Prefers the Windows Mobile Hotspot adapter when active;
# otherwise, falls back to the interface with the default route.

$ErrorActionPreference = 'Stop'

$ip = $null

# 1. Find the active Mobile Hotspot adapter
$hotspotAdapters = Get-NetAdapter -ErrorAction SilentlyContinue |
    Where-Object {
        $_.InterfaceDescription -match 'Wi-Fi Direct Virtual Adapter|Hosted Network' -and
        $_.Status -eq 'Up'
    }

foreach ($adapter in $hotspotAdapters) {
    $candidate = Get-NetIPAddress `
        -AddressFamily IPv4 `
        -InterfaceIndex $adapter.InterfaceIndex `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notmatch '^(169\.254\.|127\.)'
        } |
        Select-Object -First 1 -ExpandProperty IPAddress

    if ($candidate) {
        $ip = $candidate
        break
    }
}

# 2. Fall back to the interface with the default route
if (-not $ip) {
    $route = Get-NetRoute `
        -DestinationPrefix '0.0.0.0/0' `
        -ErrorAction SilentlyContinue |
        Where-Object { $_.State -eq 'Alive' } |
        Sort-Object RouteMetric |
        Select-Object -First 1

    if (-not $route) {
        throw 'No active default route found.'
    }

    $ip = Get-NetIPAddress `
        -AddressFamily IPv4 `
        -InterfaceIndex $route.InterfaceIndex `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notmatch '^(169\.254\.|127\.)'
        } |
        Select-Object -First 1 -ExpandProperty IPAddress

    if (-not $ip) {
        throw 'No usable IPv4 address found on the active interface.'
    }
}

# 3. Update PUBLIC_URL in .env
$envFile = Join-Path $PSScriptRoot '.env'

if (-not (Test-Path $envFile)) {
    throw ".env file not found: $envFile"
}

$content = Get-Content $envFile -Raw
$newUrl = "http://${ip}:3000"

if ($content -match '(?m)^PUBLIC_URL=.*$') {
    $content = $content -replace '(?m)^PUBLIC_URL=.*$', "PUBLIC_URL=$newUrl"
} else {
    $content = $content.TrimEnd() + "`r`nPUBLIC_URL=$newUrl`r`n"
}

Set-Content -Path $envFile -Value $content -NoNewline

# 4. Restart the app to apply the updated environment variable
Set-Location $PSScriptRoot

docker compose up -d --force-recreate app

if ($LASTEXITCODE -ne 0) {
    throw 'Failed to start the app using Docker Compose.'
}

Write-Output ""
Write-Output "PUBLIC_URL updated to: $newUrl"
Write-Output "Share this URL with the students."
