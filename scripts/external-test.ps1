$ErrorActionPreference='Stop'
Import-Module Microsoft.PowerShell.Security
$project=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$test=Join-Path $project ('logs\external-test-'+[Guid]::NewGuid().ToString('N').Substring(0,8))
$scripts=Join-Path $test 'app with spaces\scripts'
$null=New-Item -ItemType Directory -Path $scripts -Force
foreach($file in @('external-common.ps1','setup-common.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $scripts }
. (Join-Path $scripts 'external-common.ps1')
function Assert([bool]$Value,[string]$Message) { if(-not $Value){throw $Message} }
$paths=Get-DwbExternalPaths
Assert (-not (Get-DwbManagedTunnelState).Ready) 'Empty app must not discover another app tunnel.'
Assert (-not (Get-DwbManagedWorkerState).Ready) 'Empty app must not discover another app worker.'
$stage=New-DwbWorkerInstallStage
try {
  Assert ((Test-Path -LiteralPath $stage -PathType Container)) 'Worker install stage was not created.'
  Assert ($stage.Length -lt 220) 'Worker install stage is not short enough for Windows child processes.'
  Assert ((Split-Path -Leaf $stage) -match '^\.install-worker-[a-f0-9]{32}$') 'Worker install stage name is not restricted.'
} finally {
  if(Test-Path -LiteralPath $stage){ Remove-Item -LiteralPath $stage -Recurse -Force }
}
$null=New-Item -ItemType Directory -Path $paths.Root -Force
$null=New-Item -ItemType Directory -Path $paths.WorkerRoot -Force
$sentinel=Join-Path $paths.WorkerRoot 'old-install.txt'
[IO.File]::WriteAllText($sentinel,'preserve this backup')
$backup=Backup-DwbInvalidWorker $paths.WorkerRoot
Assert ($backup -and -not(Test-Path -LiteralPath $paths.WorkerRoot)) 'Invalid worker folder was not moved out of the install path.'
Assert ((Test-Path -LiteralPath (Join-Path $backup 'old-install.txt'))) 'Invalid worker folder was not preserved in the backup.'
Assert ((Split-Path -Leaf $backup) -match '^desktop-commander\.backup-[0-9]{8}-[0-9]{6}-[a-f0-9]{8}$') 'Worker backup name is not collision-resistant and recognizable.'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=Join-Path $test 'fixture.zip'
$zip=[IO.Compression.ZipFile]::Open($archive,'Create')
try { $writer=New-Object IO.StreamWriter($zip.CreateEntry('tunnel-client.exe').Open()); try{$writer.Write('original DWB archive fixture')}finally{$writer.Dispose()} }finally{$zip.Dispose()}
$destination=Join-Path $paths.Root '.fixture'
$failed=$false
try { Expand-DwbTunnelArchive $archive $destination ('0'*64) }catch{$failed=$true}
Assert ($failed -and -not(Test-Path -LiteralPath $destination)) 'Bad checksum must fail before extraction.'
$hash=(Get-FileHash -LiteralPath $archive).Hash
Expand-DwbTunnelArchive $archive $destination $hash
Assert (Test-Path -LiteralPath (Join-Path $destination 'tunnel-client.exe')) 'Verified archive not extracted.'
$bad=Join-Path $test 'escape.zip'
$zip=[IO.Compression.ZipFile]::Open($bad,'Create')
try { $null=$zip.CreateEntry('../escaped.txt') }finally{$zip.Dispose()}
$failed=$false
try { Expand-DwbTunnelArchive $bad (Join-Path $paths.Root '.escape') (Get-FileHash -LiteralPath $bad).Hash }catch{$failed=$true}
Assert ($failed -and -not(Test-Path -LiteralPath (Join-Path $paths.Root 'escaped.txt'))) 'Archive path traversal accepted.'
$failed=$false
try { Assert-DwbExternalPath $test }catch{$failed=$true}
Assert $failed 'Path outside app accepted.'
Write-Output 'EXTERNAL_TEST_PASS: owned paths only, no global discovery, checksum before extraction, archive traversal rejection.'
