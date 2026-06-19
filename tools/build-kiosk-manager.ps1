$ErrorActionPreference = "Stop"

$AppName = "NVRKioskManager"
$DisplayName = "NVR Kiosk Client Manager"
$Version = "1.0.4"
$FileVersion = "1.0.4.0"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$SourceFile = Join-Path $RepoRoot "tools\kiosk_manager.py"
$RequirementsFile = Join-Path $RepoRoot "tools\requirements-kiosk-manager.txt"
$VersionFile = Join-Path $RepoRoot "tools\kiosk-manager-version.txt"
$BuildDir = Join-Path $RepoRoot "build"
$DistDir = Join-Path $RepoRoot "dist"
$ExeName = "$AppName-$Version"
$ExePath = Join-Path $DistDir "$ExeName.exe"

function Get-PythonCommand {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) {
    return @("python")
  }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) {
    return @("py")
  }

  throw "Python was not found. Install Python 3 for Windows and try again."
}

[string[]]$PythonCommand = @(Get-PythonCommand)

function Invoke-Python {
  param(
    [string[]]$PythonArgs
  )

  if ($PythonCommand.Length -gt 1) {
    & $PythonCommand[0] $PythonCommand[1] @PythonArgs
  } else {
    & $PythonCommand[0] @PythonArgs
  }
}

Write-Host "Using Python command: $($PythonCommand -join ' ')"
Write-Host "Installing build dependencies..."
Invoke-Python -PythonArgs @("-m", "pip", "install", "-r", $RequirementsFile)

Write-Host "Writing Windows version resource..."
@"
# UTF-8
VSVersionInfo(
  ffi=FixedFileInfo(
    filevers=(1, 0, 4, 0),
    prodvers=(1, 0, 4, 0),
    mask=0x3f,
    flags=0x0,
    OS=0x40004,
    fileType=0x1,
    subtype=0x0,
    date=(0, 0)
  ),
  kids=[
    StringFileInfo([
      StringTable(
        '040904b0',
        [
          StringStruct('CompanyName', 'Roadless'),
          StringStruct('FileDescription', '$DisplayName'),
          StringStruct('FileVersion', '$FileVersion'),
          StringStruct('InternalName', '$ExeName'),
          StringStruct('OriginalFilename', '$ExeName.exe'),
          StringStruct('ProductName', '$DisplayName'),
          StringStruct('ProductVersion', '$Version')
        ]
      )
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"@ | Set-Content -Path $VersionFile -Encoding UTF8

Write-Host "Building portable EXE..."
Invoke-Python -PythonArgs @(
  "-m",
  "PyInstaller",
  "--noconfirm",
  "--clean",
  "--onefile",
  "--windowed",
  "--name",
  $ExeName,
  "--distpath",
  $DistDir,
  "--workpath",
  $BuildDir,
  "--specpath",
  $BuildDir,
  "--version-file",
  $VersionFile,
  $SourceFile
)

if (!(Test-Path $ExePath)) {
  throw "Build finished but EXE was not found: $ExePath"
}

Remove-Item -LiteralPath $VersionFile -Force -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Build completed:"
Write-Host $ExePath
