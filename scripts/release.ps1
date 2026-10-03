param([string]$OutputDirectory, [switch]$Source)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ReleaseRoot = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $ProjectRoot 'releases' }
$Package = Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
$Flavor = if ($Source) { "source-test" } else { "windows" }
$Name = "n3zuui-studio-$($Package.version)-$Flavor"
$Zip = Join-Path $ReleaseRoot ($Name + '.zip')
if (Test-Path -LiteralPath $Zip) { throw "Release already exists: $Zip. Rename it or choose a new version before rebuilding." }
& node (Join-Path $PSScriptRoot 'distribution-check.mjs')
if ($LASTEXITCODE -ne 0) { throw 'N3zuui distribution boundary check failed.' }
$Manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'distribution-files.json') -Raw | ConvertFrom-Json
$Stage = Join-Path $ReleaseRoot ($Name + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
try {
  $Files = @($Manifest.files | Where-Object { $Source -or -not $_.StartsWith('.github/') })
  if (-not $Source) { $Files += 'N3zuui Studio.exe' }
  foreach ($File in $Files) {
    $Destination = Join-Path $Stage $File
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $ProjectRoot $File) -Destination $Destination
  }
  if (-not $Source) {
    $Dist = Join-Path $Stage 'dist'
    New-Item -ItemType Directory -Path $Dist | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'dist') -File -Filter '*.js' |
      Where-Object { $_.Name -notlike '*-test.js' -and $_.Name -ne 'test-policy.js' } |
      Copy-Item -Destination $Dist
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $Stage,
    $Zip,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )
} finally {
  if (Test-Path -LiteralPath $Stage) {
    $ResolvedRelease = [IO.Path]::GetFullPath($ReleaseRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $ResolvedStage = [IO.Path]::GetFullPath($Stage)
    if (-not $ResolvedStage.StartsWith($ResolvedRelease, [StringComparison]::OrdinalIgnoreCase)) { throw 'Refusing to remove a staging folder outside the release directory.' }
    Remove-Item -LiteralPath $ResolvedStage -Recurse -Force
  }
}
$Hasher = [System.Security.Cryptography.SHA256]::Create()
$ArchiveStream = [IO.File]::OpenRead($Zip)
try { $Hash = ([BitConverter]::ToString($Hasher.ComputeHash($ArchiveStream))).Replace('-','').ToLowerInvariant() }
finally { $ArchiveStream.Dispose(); $Hasher.Dispose() }
Set-Content -LiteralPath ($Zip + '.sha256') -Value "$Hash  $Name.zip" -Encoding ascii
Write-Output "Release: $Zip"
Write-Output "SHA256: $Hash"
