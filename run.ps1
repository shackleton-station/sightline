<#
.SYNOPSIS
  Runs the web app locally on Windows: http://localhost:5173

.DESCRIPTION
  Default: the Vite dev server only. It forwards /api, /tiles and /media to the live site, so the
  whole app (3D view, typed-question box, demo video) works with no keys and no cloud access
  (docs/SETUP.md, steps 3 and 5).

  -Local also starts the local server stack (web/scripts/dev-server.sh: web server :8080, events
  worker :8081, plans :8082, co-pilot :8083) in a second window through Git Bash, and points the
  app at it. Only needed when changing web/server/, plans/, copilot/ or events-worker/. It calls
  Google Cloud as you (run `gcloud auth login` first) unless -FakeModel is given.

.PARAMETER Local
  Also run the local server stack and forward the app to it instead of the live site.

.PARAMETER FakeModel
  With -Local: a scripted stand-in answers instead of Claude, no account needed. Plans stay in
  memory and Scout's voice is off, so nothing calls Google Cloud.

.EXAMPLE
  .\run.ps1
.EXAMPLE
  .\run.ps1 -Local -FakeModel
#>
param(
  [switch]$Local,
  [switch]$FakeModel
)

$ErrorActionPreference = 'Stop'
$web = Join-Path $PSScriptRoot 'web'

# Node 20.19+ (CI uses 22).
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js is not installed. Install Node 22 from https://nodejs.org and run this again.'
}
$nodeVersion = [version]((node --version).TrimStart('v'))
if ($nodeVersion -lt [version]'20.19.0') {
  Write-Error "Node $nodeVersion is too old: need 20.19 or newer (CI uses 22)."
}

# Stop leftover dev servers from an earlier run (a closed window or a crash can leave node holding
# the ports, and Vite then quietly moves to 5174). Only node processes are stopped, never anything else.
function Stop-StaleDevServers([int[]]$ports) {
  $pids = Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($p in $pids) {
    $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -eq 'node') {
      Write-Host "Stopping leftover node (PID $p) on port(s) $($ports -join ', ')"
      taskkill /PID $p /T /F | Out-Null
    } elseif ($proc) {
      Write-Warning "Port in use by $($proc.ProcessName) (PID $p); not stopping it."
    }
  }
}
$ports = @(5173)
if ($Local) { $ports += 8080, 8081, 8082, 8083 }
Stop-StaleDevServers $ports

Push-Location $web
try {
  # Install dependencies when they are missing or package-lock.json changed since the last install.
  $stamp = Join-Path $web 'node_modules\.package-lock.json'
  $lock = Join-Path $web 'package-lock.json'
  if (-not (Test-Path $stamp) -or (Get-Item $lock).LastWriteTime -gt (Get-Item $stamp).LastWriteTime) {
    Write-Host 'Installing web dependencies (npm ci)...'
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
  }

  if ($Local) {
    $bash = Get-Command bash -ErrorAction SilentlyContinue
    if (-not $bash) { Write-Error '-Local needs Git Bash (bash on PATH) to run web/scripts/dev-server.sh.' }

    $envPrefix = ''
    if ($FakeModel) { $envPrefix = 'FAKE_MODEL=on PLANS_DATABASE= VOICE=off ' }
    elseif (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
      Write-Error '-Local without -FakeModel calls Google Cloud as you: install gcloud and run `gcloud auth login`, or add -FakeModel.'
    }

    Write-Host 'Starting the local server stack in a new window (:8080-8083)...'
    $server = Start-Process -FilePath $bash.Source -WorkingDirectory $web -PassThru `
      -ArgumentList '-c', "${envPrefix}npm run dev:server; echo; read -p 'Server stopped. Press Enter to close.'"
    $env:BACKEND = 'http://localhost:8080'
  }

  Write-Host 'Starting the app on http://localhost:5173 (Ctrl+C to stop)'
  npm run dev
}
finally {
  if ($server -and -not $server.HasExited) {
    Write-Host 'Stopping the local server stack...'
    # /T stops the whole tree (bash, npm, tsx watchers); without it they keep the ports busy.
    taskkill /PID $server.Id /T /F | Out-Null
  }
  Remove-Item Env:BACKEND -ErrorAction SilentlyContinue
  Pop-Location
  # Anything Ctrl+C left behind (npm on Windows can orphan the vite/tsx child).
  Stop-StaleDevServers $ports
}
