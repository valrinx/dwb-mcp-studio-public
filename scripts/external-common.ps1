. (Join-Path $PSScriptRoot 'setup-common.ps1')

function Get-DwbExternalPaths {
  $app = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $root = Join-Path $app 'external'
  return [pscustomobject]@{
    App=$app; Root=$root
    WorkerRoot=(Join-Path $root 'desktop-commander')
    Worker=(Join-Path $root 'desktop-commander\node_modules\@wonderwhy-er\desktop-commander\dist\index.js')
    TunnelRoot=(Join-Path $root 'tunnel-client')
    Tunnel=(Join-Path $root 'tunnel-client\tunnel-client.exe')
  }
}
function Assert-DwbExternalPath([string]$Path) {
  $root = (Get-DwbExternalPaths).Root
  $full = [IO.Path]::GetFullPath($Path)
  if ($full -ne $root -and -not $full.StartsWith($root + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'External installation must stay inside this DWB folder.' }
  $current=$full
  while ($current.Length -ge $root.Length) {
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'The external folder cannot use junctions or symbolic links.' }
    }
    if ($current -eq $root) { break }
    $current=Split-Path -Parent $current
  }
}
function Get-DwbManagedWorkerState {
  $paths=Get-DwbExternalPaths
  try { Assert-DwbExternalPath $paths.Worker; return Get-DwbWorkerState $paths.Worker }
  catch { return [pscustomobject]@{Ready=$false;Message=$_.Exception.Message;Entry=$paths.Worker} }
}
function Backup-DwbInvalidWorker([string]$WorkerRoot) {
  $paths=Get-DwbExternalPaths
  $expected=[IO.Path]::GetFullPath($paths.WorkerRoot)
  $full=[IO.Path]::GetFullPath($WorkerRoot)
  if ($full -ne $expected) { throw 'Only the managed Desktop Commander folder can be backed up.' }
  if (-not (Test-Path -LiteralPath $full)) { return $null }
  Assert-DwbExternalPath $full
  $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
  do { $backup=Join-Path $paths.Root ('desktop-commander.backup-'+$stamp+'-'+[Guid]::NewGuid().ToString('N').Substring(0,8)) } while (Test-Path -LiteralPath $backup)
  Move-Item -LiteralPath $full -Destination $backup
  return $backup
}
function Assert-DwbWorkerStagePath([string]$Stage) {
  $stageRoot=[IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'dwb-mcp-studio'))
  $full=[IO.Path]::GetFullPath($Stage)
  if (-not $full.StartsWith($stageRoot+'\',[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Parent $full) -ne $stageRoot -or (Split-Path -Leaf $full) -notmatch '^\.install-worker-[a-f0-9]{32}$') { throw 'Unexpected worker install stage path.' }
}
function New-DwbWorkerInstallStage {
  $stageRoot=[IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) 'dwb-mcp-studio'))
  $null=New-Item -ItemType Directory -Path $stageRoot -Force
  do { $stage=Join-Path $stageRoot ('.install-worker-'+[Guid]::NewGuid().ToString('N')) } while (Test-Path -LiteralPath $stage)
  Assert-DwbWorkerStagePath $stage
  $null=New-Item -ItemType Directory -Path $stage
  return $stage
}
function Get-DwbManagedTunnelState {
  $paths=Get-DwbExternalPaths
  try {
    Assert-DwbExternalPath $paths.Tunnel
    if (-not (Test-Path -LiteralPath $paths.Tunnel -PathType Leaf)) { throw 'Tunnel client is not installed in this DWB folder.' }
    $info=New-Object Diagnostics.ProcessStartInfo
    $info.FileName=$paths.Tunnel; $info.Arguments='--version'
    $info.UseShellExecute=$false; $info.CreateNoWindow=$true
    $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
    $process=[Diagnostics.Process]::Start($info)
    try {
      $output=$process.StandardOutput.ReadToEndAsync(); $errors=$process.StandardError.ReadToEndAsync()
      if (-not $process.WaitForExit(5000)) { $process.Kill(); throw 'Tunnel version check timed out.' }
      $version=$output.GetAwaiter().GetResult().Trim()
      if ($process.ExitCode -ne 0 -or $version -notmatch '^0\.0\.11(?:\+|\s|$)') { throw 'This DWB version requires tunnel-client 0.0.11.' }
      return [pscustomobject]@{Ready=$true;Version=$version;Entry=$paths.Tunnel;Message='Ready'}
    } finally { $process.Dispose() }
  } catch { return [pscustomobject]@{Ready=$false;Entry=$paths.Tunnel;Message=$_.Exception.Message} }
}
function Get-DwbTunnelDownload {
  $arch=if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  switch ($arch.ToUpperInvariant()) {
    'AMD64' { $platform='amd64'; $hash='eb912c86c6ccde90cda805cb17009507176a656725cf86c36fabe1901a12e29b' }
    'ARM64' { $platform='arm64'; $hash='38f015a720404c8ccd5976a0d6aed18d931899697eaf208548b5eb3d0f6e8592' }
    default { throw 'This installer supports Windows x64 and ARM64 only.' }
  }
  return [pscustomobject]@{Url="https://github.com/openai/tunnel-client/releases/download/v0.0.11/tunnel-client-v0.0.11-windows-$platform.zip";Sha256=$hash}
}
function Expand-DwbTunnelArchive([string]$Archive,[string]$Destination,[string]$Sha256) {
  Assert-DwbExternalPath $Destination
  if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash -ine $Sha256) { throw 'Tunnel download checksum did not match. Please retry installation.' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    foreach ($entry in $zip.Entries) {
      $target=[IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
      if (-not $target.StartsWith($Destination.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase) -or $entry.FullName -match ':') { throw 'Unexpected path in tunnel archive.' }
    }
  } finally { $zip.Dispose() }
  Expand-Archive -LiteralPath $Archive -DestinationPath $Destination
}
function Install-DwbExternal {
  $paths=Get-DwbExternalPaths
  Assert-DwbExternalPath $paths.Root
  $null=New-Item -ItemType Directory -Path $paths.Root -Force
  $lock=[IO.File]::Open((Join-Path $paths.Root 'install.lock'),'OpenOrCreate','ReadWrite','None')
  try {
    $machine=Get-DwbMachineState
    if (-not $machine.NodeReady -or -not $machine.NpmReady) { throw 'Install Node.js 22.16 or later with npm first.' }
    if (-not (Get-DwbManagedWorkerState).Ready) {
      if (Test-Path -LiteralPath $paths.WorkerRoot) { Backup-DwbInvalidWorker $paths.WorkerRoot | Write-Output }
      $stage=New-DwbWorkerInstallStage
      try {
        # Explicit registry/version; no dependency is copied from another application.
        Invoke-DwbNode $machine.Node @($machine.Npm,'install','--prefix',$stage,'--save-exact','--no-audit','--no-fund','--registry=https://registry.npmjs.org','@wonderwhy-er/desktop-commander@0.2.50') $paths.App | Write-Output
        $worker=Get-DwbWorkerState (Join-Path $stage 'node_modules\@wonderwhy-er\desktop-commander\dist\index.js')
        if (-not $worker.Ready) { throw $worker.Message }
        Assert-DwbWorkerStagePath $stage; Assert-DwbExternalPath $paths.WorkerRoot
        Move-Item -LiteralPath $stage -Destination $paths.WorkerRoot
      } finally {
        if (Test-Path -LiteralPath $stage) { Assert-DwbWorkerStagePath $stage; Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }
      }
    }
    if (-not (Get-DwbManagedTunnelState).Ready) {
      if (Test-Path -LiteralPath $paths.TunnelRoot) { throw 'Tunnel installation is incomplete or unsupported. Rename external/tunnel-client to keep a backup, then retry.' }
      $download=Get-DwbTunnelDownload
      $stage=Join-Path $paths.Root ('.install-tunnel-'+[Guid]::NewGuid().ToString('N'))
      Assert-DwbExternalPath $stage
      $null=New-Item -ItemType Directory -Path $stage
      $archive=Join-Path $stage 'download.zip'
      $ProgressPreference='SilentlyContinue'
      [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      Invoke-WebRequest -UseBasicParsing -Uri $download.Url -OutFile $archive -TimeoutSec 180
      $unpacked=Join-Path $stage 'package'
      Expand-DwbTunnelArchive $archive $unpacked $download.Sha256
      Assert-DwbExternalPath $unpacked; Assert-DwbExternalPath $paths.TunnelRoot
      Move-Item -LiteralPath $unpacked -Destination $paths.TunnelRoot
      # Remove only our verified, uniquely named scratch directory.
      Assert-DwbExternalPath $stage
      if ((Split-Path -Leaf $stage) -notmatch '^\.install-tunnel-[a-f0-9]{32}$') { throw 'Unexpected scratch directory.' }
      Remove-Item -LiteralPath $stage -Recurse -Force
      if (-not (Get-DwbManagedTunnelState).Ready) { throw 'Downloaded tunnel-client did not pass its version check.' }
    }
  } finally { $lock.Dispose() }
}
