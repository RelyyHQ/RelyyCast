[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Yes,
  [switch]$KeepApp,
  [switch]$KeepRegistry,
  [switch]$KeepData,
  [switch]$RemoveCloudflareConfig,
  [switch]$KeepCloudflareConfig,
  [switch]$RemoveCloudflaredHome,
  [switch]$KeepCloudflaredHome
)

<#
uninstall-relyycast.ps1 - remove RelyyCast from Windows

Examples:
  powershell -ExecutionPolicy Bypass -File .\scripts\installers\windows\uninstall-relyycast.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\installers\windows\uninstall-relyycast.ps1 -DryRun -Yes
  powershell -ExecutionPolicy Bypass -File .\scripts\installers\windows\uninstall-relyycast.ps1 -Yes -KeepApp -KeepRegistry -KeepData -RemoveCloudflareConfig -RemoveCloudflaredHome

Flags:
  -DryRun                 Print actions without deleting anything.
  -Yes                    Skip interactive confirmation prompts.
  -KeepApp                Keep installed app files/shortcuts.
  -KeepRegistry           Keep uninstall/install registry entries.
  -KeepData               Keep RelyyCast user data.
  -RemoveCloudflareConfig Remove local app Cloudflare config under relyycast\cloudflare.
  -KeepCloudflareConfig   Keep local app Cloudflare config under relyycast\cloudflare.
  -RemoveCloudflaredHome  Remove global cloudflared credentials directories.
  -KeepCloudflaredHome    Keep global cloudflared credentials directories (default).
#>

$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  Write-Error "This uninstaller is for Windows only."
  exit 1
}

function Write-Log {
  param([string]$Message)
  Write-Host "[uninstall] $Message"
}

function Test-IsAdmin {
  try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
  }
}

function Prompt-YesNo {
  param(
    [string]$Question,
    [bool]$DefaultYes = $false
  )

  $suffix = if ($DefaultYes) { "[Y/n]" } else { "[y/N]" }
  $reply = Read-Host "$Question $suffix"
  if ([string]::IsNullOrWhiteSpace($reply)) {
    return $DefaultYes
  }
  return $reply -match "^(?i:y|yes)$"
}

function Invoke-Action {
  param(
    [string]$Description,
    [scriptblock]$Action
  )

  if ($DryRun) {
    Write-Host "[dry-run] $Description"
    return
  }

  & $Action
}

function Remove-PathSafe {
  param([string]$Path)

  if ([string]::IsNullOrWhiteSpace($Path)) {
    return
  }

  if (Test-Path -LiteralPath $Path) {
    Invoke-Action -Description "Remove-Item -Recurse -Force '$Path'" -Action {
      Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Log "removed: $Path"
  } else {
    Write-Log "not found: $Path"
  }
}

function Remove-ChildrenExcept {
  param(
    [string]$Root,
    [string]$KeepChildName
  )

  if (-not (Test-Path -LiteralPath $Root)) {
    Write-Log "not found: $Root"
    return
  }

  $keepPath = Join-Path $Root $KeepChildName
  if (-not (Test-Path -LiteralPath $keepPath)) {
    Remove-PathSafe -Path $Root
    return
  }

  Get-ChildItem -LiteralPath $Root -Force -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Name -ieq $KeepChildName) {
      return
    }
    Remove-PathSafe -Path $_.FullName
  }

  Write-Log "kept: $keepPath"
}

function Remove-RegistryKeySafe {
  param([string]$RegistryPath)

  if (Test-Path -LiteralPath $RegistryPath) {
    Invoke-Action -Description "Remove-Item -Recurse -Force '$RegistryPath'" -Action {
      Remove-Item -LiteralPath $RegistryPath -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Log "removed registry key: $RegistryPath"
  } else {
    Write-Log "registry key not found: $RegistryPath"
  }
}

function Print-Plan {
  param(
    [bool]$DoRemoveApp,
    [bool]$DoRemoveRegistry,
    [bool]$DoRemoveData,
    [bool]$DoRemoveCloudflareAppConfig,
    [bool]$DoRemoveGlobalCloudflared
  )

  Write-Host ""
  Write-Host "Planned actions:"
  if ($DoRemoveApp) {
    Write-Host "- Remove app files and shortcuts"
  } else {
    Write-Host "- Keep app files and shortcuts"
  }

  if ($DoRemoveRegistry) {
    Write-Host "- Remove installer/uninstall registry keys"
  } else {
    Write-Host "- Keep installer/uninstall registry keys"
  }

  if ($DoRemoveData) {
    if ($DoRemoveCloudflareAppConfig) {
      Write-Host "- Remove all RelyyCast user data"
    } else {
      Write-Host "- Remove RelyyCast user data but keep app cloudflare config"
    }
  } else {
    Write-Host "- Keep RelyyCast user data"
    if ($DoRemoveCloudflareAppConfig) {
      Write-Host "- Remove only app cloudflare config under relyycast\cloudflare"
    }
  }

  if ($DoRemoveGlobalCloudflared) {
    Write-Host "- Remove global cloudflared credentials directories"
  } else {
    Write-Host "- Keep global cloudflared credentials directories"
  }
  Write-Host ""
}

$removeApp = -not $KeepApp
$removeRegistry = -not $KeepRegistry
$removeUserData = -not $KeepData
$removeCloudflareAppConfig = $true
$removeGlobalCloudflared = $false

if ($KeepData) {
  $removeUserData = $false
  $removeCloudflareAppConfig = $false
}
if ($RemoveCloudflareConfig) { $removeCloudflareAppConfig = $true }
if ($KeepCloudflareConfig) { $removeCloudflareAppConfig = $false }
if ($RemoveCloudflaredHome) { $removeGlobalCloudflared = $true }
if ($KeepCloudflaredHome) { $removeGlobalCloudflared = $false }

$installDirCandidates = @()
$regInstallKeyCandidates = @(
  "HKLM:\Software\RelyyCast",
  "HKLM:\Software\WOW6432Node\RelyyCast"
)

foreach ($regPath in $regInstallKeyCandidates) {
  try {
    $value = (Get-ItemProperty -LiteralPath $regPath -Name "InstallDir" -ErrorAction Stop).InstallDir
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      $installDirCandidates += $value
    }
  } catch {
    # ignore
  }
}

if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
  $installDirCandidates += (Join-Path $env:ProgramFiles "RelyyCast")
}
if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) {
  $installDirCandidates += (Join-Path ${env:ProgramFiles(x86)} "RelyyCast")
}

$installDirs = $installDirCandidates | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

$startMenuDirs = @(
  (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\RelyyCast"),
  (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\RelyyCast")
) | Select-Object -Unique

$desktopShortcuts = @(
  (Join-Path $env:PUBLIC "Desktop\RelyyCast.lnk"),
  (Join-Path $env:USERPROFILE "Desktop\RelyyCast.lnk")
) | Select-Object -Unique

$registryKeys = @(
  "HKLM:\Software\RelyyCast",
  "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RelyyCast",
  "HKLM:\Software\WOW6432Node\RelyyCast",
  "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\RelyyCast",
  "HKCU:\Software\RelyyCast",
  "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\RelyyCast"
)

$appDataRoot = Join-Path $env:APPDATA "relyycast"
$localAppDataRoot = Join-Path $env:LOCALAPPDATA "relyycast"
$appCloudflareDirs = @(
  (Join-Path $appDataRoot "cloudflare"),
  (Join-Path $localAppDataRoot "cloudflare")
) | Select-Object -Unique

$additionalUserDataDirs = @(
  (Join-Path $env:APPDATA "com.relyycast.app"),
  (Join-Path $env:LOCALAPPDATA "com.relyycast.app")
) | Select-Object -Unique

$globalCloudflaredDirs = @(
  (Join-Path $env:USERPROFILE ".cloudflared"),
  (Join-Path $env:APPDATA "cloudflared"),
  (Join-Path $env:LOCALAPPDATA "cloudflared")
) | Select-Object -Unique

Write-Log "detected install dirs: $($installDirs -join ', ')"
Write-Log "user profile: $env:USERPROFILE"

if (-not $Yes) {
  Print-Plan -DoRemoveApp $removeApp -DoRemoveRegistry $removeRegistry -DoRemoveData $removeUserData -DoRemoveCloudflareAppConfig $removeCloudflareAppConfig -DoRemoveGlobalCloudflared $removeGlobalCloudflared
  if (-not (Prompt-YesNo -Question "Continue?" -DefaultYes $true)) {
    Write-Log "cancelled"
    exit 0
  }

  $removeApp = Prompt-YesNo -Question "Remove app files and shortcuts?" -DefaultYes $removeApp
  $removeRegistry = Prompt-YesNo -Question "Remove installer/uninstall registry keys?" -DefaultYes $removeRegistry
  $removeUserData = Prompt-YesNo -Question "Remove RelyyCast user data under AppData?" -DefaultYes $removeUserData
  $removeCloudflareAppConfig = Prompt-YesNo -Question "Remove app cloudflare config (relyycast\cloudflare)?" -DefaultYes $removeCloudflareAppConfig
  $removeGlobalCloudflared = Prompt-YesNo -Question "Remove global cloudflared credentials dirs?" -DefaultYes $removeGlobalCloudflared

  Print-Plan -DoRemoveApp $removeApp -DoRemoveRegistry $removeRegistry -DoRemoveData $removeUserData -DoRemoveCloudflareAppConfig $removeCloudflareAppConfig -DoRemoveGlobalCloudflared $removeGlobalCloudflared
  if (-not (Prompt-YesNo -Question "Run uninstall with these choices?" -DefaultYes $true)) {
    Write-Log "cancelled"
    exit 0
  }
}

$needsAdmin = $removeApp -or $removeRegistry
if (-not $DryRun -and $needsAdmin -and -not (Test-IsAdmin)) {
  Write-Error "Administrator permissions are required for selected actions. Re-run PowerShell as Administrator."
  exit 1
}

Write-Log "Stopping RelyyCast-related processes..."
$processNames = @("relyycast-win_x64", "mediamtx", "cloudflared")
foreach ($name in $processNames) {
  $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
  foreach ($proc in $procs) {
    Invoke-Action -Description "Stop-Process -Id $($proc.Id) -Force" -Action {
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Log "stopped process: $name ($($proc.Id))"
  }
}

if ($removeApp) {
  Write-Log "Removing app files and shortcuts..."
  foreach ($dir in $installDirs) {
    Remove-PathSafe -Path $dir
  }
  foreach ($path in $startMenuDirs) {
    Remove-PathSafe -Path $path
  }
  foreach ($path in $desktopShortcuts) {
    Remove-PathSafe -Path $path
  }
} else {
  Write-Log "Keeping app files and shortcuts."
}

if ($removeRegistry) {
  Write-Log "Removing registry keys..."
  foreach ($key in $registryKeys) {
    Remove-RegistryKeySafe -RegistryPath $key
  }
} else {
  Write-Log "Keeping registry keys."
}

if ($removeUserData) {
  Write-Log "Removing user data..."
  if ($removeCloudflareAppConfig) {
    Remove-PathSafe -Path $appDataRoot
    Remove-PathSafe -Path $localAppDataRoot
  } else {
    Remove-ChildrenExcept -Root $appDataRoot -KeepChildName "cloudflare"
    Remove-ChildrenExcept -Root $localAppDataRoot -KeepChildName "cloudflare"
  }

  foreach ($dir in $additionalUserDataDirs) {
    Remove-PathSafe -Path $dir
  }
} elseif ($removeCloudflareAppConfig) {
  Write-Log "Removing only app cloudflare config..."
  foreach ($dir in $appCloudflareDirs) {
    Remove-PathSafe -Path $dir
  }
} else {
  Write-Log "Keeping user data."
}

if ($removeGlobalCloudflared) {
  Write-Log "Removing global cloudflared credentials directories..."
  foreach ($dir in $globalCloudflaredDirs) {
    Remove-PathSafe -Path $dir
  }
} else {
  Write-Log "Keeping global cloudflared credentials directories."
}

Write-Log "Uninstall complete."
