param(
  [string]$Repo = $(if ($env:DEVROOST_REPO) { $env:DEVROOST_REPO } else { "Devroost-org/devroost" }),
  [string]$Version = $(if ($env:DEVROOST_VERSION) { $env:DEVROOST_VERSION } else { "latest" }),
  [string]$InstallDir = $(if ($env:DEVROOST_INSTALL_DIR) { $env:DEVROOST_INSTALL_DIR } else { "$HOME\\.devroost\\bin" })
)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 24+ is required. Install Node.js and retry."
}

if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
  throw "Podman is required. Install Podman and retry."
}

$nodeVersionRaw = & node -p "process.versions.node"
$nodeMajor = [int]($nodeVersionRaw.Split('.')[0])
if ($nodeMajor -lt 24) {
  throw "Node.js 24+ is required. Current version: $nodeVersionRaw"
}

try {
  & podman info *> $null
} catch {
  Write-Warning "Podman is installed but not currently reachable."
  Write-Warning "Run 'devroost start' after installation; Devroost will auto-start Podman Machine on macOS/Windows."
}

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  "AMD64" { "x64" }
  "ARM64" { "arm64" }
  default { throw "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
}

$asset = "devroost-windows-$arch.zip"
if ($Version -eq "latest") {
  $url = "https://github.com/$Repo/releases/latest/download/$asset"
} else {
  $url = "https://github.com/$Repo/releases/download/$Version/$asset"
}

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("devroost-install-" + [guid]::NewGuid().ToString("N"))
$stagedStacks = $null

try {
  New-Item -ItemType Directory -Path $tmp | Out-Null
  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

  $zip = Join-Path $tmp "devroost.zip"
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $zip
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $archiveStacks = Join-Path $tmp "stacks"
  if (-not (Test-Path $archiveStacks -PathType Container)) {
    throw "Release archive is missing required stack assets"
  }

  $stagedStacks = Join-Path $InstallDir (".devroost-stacks-new-" + [guid]::NewGuid().ToString("N"))
  Copy-Item -Path $archiveStacks -Destination $stagedStacks -Recurse
  Copy-Item -Path (Join-Path $tmp "devroost.cmd") -Destination (Join-Path $InstallDir "devroost.cmd") -Force
  Copy-Item -Path (Join-Path $tmp "devroost.mjs") -Destination (Join-Path $InstallDir "devroost.mjs") -Force
  $installedStacks = Join-Path $InstallDir "stacks"
  if (Test-Path $installedStacks) {
    Remove-Item -Path $installedStacks -Recurse -Force
  }
  Move-Item -Path $stagedStacks -Destination $installedStacks
  $stagedStacks = $null
  $installedExamples = Join-Path $InstallDir "examples"
  if (Test-Path $installedExamples) {
    Remove-Item -Path $installedExamples -Recurse -Force
  }

  $pathUser = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($pathUser -notlike "*$InstallDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$pathUser;$InstallDir", "User")
    Write-Host "Added $InstallDir to user PATH"
  }

  Write-Host "Installed Devroost to $InstallDir\\devroost.cmd"
  Write-Host "Open a new terminal and run: devroost --help"
}
finally {
  if ($stagedStacks -and (Test-Path $stagedStacks)) {
    Remove-Item -Path $stagedStacks -Recurse -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $tmp) {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
