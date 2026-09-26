param([string]$OutputDirectory, [switch]$Source)
$ErrorActionPreference = 'Stop'
$ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ReleaseRoot = if ($OutputDirectory) { [IO.Path]::GetFullPath($OutputDirectory) } else { Join-Path $ProjectRoot 'releases' }
$Package = Get-Content -LiteralPath (Join-Path $ProjectRoot 'package.json') -Raw | ConvertFrom-Json
$Flavor = if ($Source) { "source-test" } else { "windows" }
$Name = "dwb-mcp-studio-core-$($Package.version)-$Flavor"
$Stage = Join-Path $ReleaseRoot ($Name + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
# Explicit allowlist: never copy node_modules, personal config, logs, runtime or data.
foreach ($File in @('package.json','package-lock.json','tsconfig.json','README.md','LICENSE','LICENSE-UPSTREAM-MIT','THIRD-PARTY.md','DWB MCP Studio.exe','.gitignore','.gitattributes','.prettierignore','.prettierrc.json','.editorconfig')) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot $File) -Destination $Stage
}
foreach ($Directory in @('src','scripts','docs','assets')) {
  Copy-Item -LiteralPath (Join-Path $ProjectRoot $Directory) -Destination $Stage -Recurse
}
if ($Source) { Copy-Item -LiteralPath (Join-Path $ProjectRoot '.github') -Destination $Stage -Recurse }
if (-not $Source) {
$Dist = Join-Path $Stage 'dist'
New-Item -ItemType Directory -Path $Dist | Out-Null
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'dist') -File -Filter '*.js' |
  Where-Object { $_.Name -notlike '*-test.js' -and $_.Name -ne 'test-policy.js' } |
  Copy-Item -Destination $Dist
}
$Zip = Join-Path $ReleaseRoot ($Name + '.zip')
if (Test-Path -LiteralPath $Zip) { throw "Release already exists: $Zip. Rename it or choose a new version before rebuilding." }
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $Zip -CompressionLevel Optimal
$Hasher = [System.Security.Cryptography.SHA256]::Create()
$ArchiveStream = [IO.File]::OpenRead($Zip)
try { $Hash = ([BitConverter]::ToString($Hasher.ComputeHash($ArchiveStream))).Replace('-','').ToLowerInvariant() }
finally { $ArchiveStream.Dispose(); $Hasher.Dispose() }
Set-Content -LiteralPath ($Zip + '.sha256') -Value "$Hash  $Name.zip" -Encoding ascii
Write-Output "Release: $Zip"
Write-Output "SHA256: $Hash"
