# Called after dependencies/build succeed, before changing saved configuration.
. (Join-Path $PSScriptRoot 'tunnel-common.ps1')
function Stop-DwbRuntimeForSetup([string]$Node) {
  $appRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  function Snapshot { return (Invoke-DwbNode $Node @((Join-Path $PSScriptRoot 'runtime-control.mjs'),'status') $appRoot | ConvertFrom-Json) }
  $snapshot=Snapshot
  if($snapshot.state -eq 'stopped'){return}
  if($snapshot.state -ne 'running'){throw 'Cannot inspect the running broker. Finish its work and stop it before updating; saved configuration has not changed.'}
  if(Get-DwbTunnelProcess){throw 'MCP is connected. Finish current work, press Stop MCP, then run Setup again. Your Tunnel ID and saved key will be kept.'}
  if($snapshot.broker.runtime){
    $result=Invoke-DwbNode $Node @((Join-Path $PSScriptRoot 'runtime-control.mjs'),'prepare') $appRoot | ConvertFrom-Json
    if($result.state -ne 'running'){throw ('Cannot update yet: '+$result.error)}
  }else{
    # beta.9/11 cannot drain atomically. Only retire a detached, empty legacy broker.
    # Never terminate a warm worker or a process whose install cannot be verified.
    $saved=Get-Content -LiteralPath (Get-DwbConfigPath) -Raw -Encoding UTF8 | ConvertFrom-Json
    $suffix='\external\desktop-commander\node_modules\@wonderwhy-er\desktop-commander\dist\index.js'
    $entry=([string]$saved.workerEntry).Replace('/','\')
    if(-not $entry.EndsWith($suffix,[StringComparison]::OrdinalIgnoreCase)){throw 'Cannot verify the legacy installation. Finish its work and restart Windows once before updating.'}
    $previous=$entry.Substring(0,$entry.Length-$suffix.Length)
    $package=Get-Content -LiteralPath (Join-Path $previous 'package.json') -Raw | ConvertFrom-Json
    if($package.name -notin @('dwb-mcp-studio-core','n3zuui-mcp-studio-core')){throw 'The running installation is not a public N3zuui core.'}
    $brokerScript=Join-Path $previous 'dist\broker-server.js'
    $runtimePid=[int]$snapshot.broker.brokerPid
    $process=Get-Process -Id $runtimePid -ErrorAction Stop
    $null=$process.Handle
    $command=(Get-CimInstance Win32_Process -Filter "ProcessId=$runtimePid").CommandLine
    if([IO.Path]::GetFileName($process.Path) -ne 'node.exe' -or $command.Replace('/','\') -notmatch ('(?i)(?:"|\s)'+[regex]::Escape($brokerScript)+'(?:"|\s|$)')){throw 'Cannot verify the legacy broker process; it was left running.'}
    $deadline=[DateTime]::UtcNow.AddSeconds(75)
    do {
      $snapshot=Snapshot
      if($snapshot.state -eq 'stopped'){return}
      if($snapshot.state -ne 'running' -or $snapshot.broker.brokerPid -ne $runtimePid){throw 'Runtime changed during update; retry Setup.'}
      $broker=$snapshot.broker
      $idle=$broker.attachedSessions -eq 0 -and $broker.activeWorkers -eq 0 -and $broker.startingWorkers -eq 0 -and $broker.stoppingWorkers -eq 0 -and $broker.queueDepth -eq 0 -and $broker.inFlightCalls -eq 0
      if($idle){
        if(Get-DwbTunnelProcess){throw 'MCP reconnected during update; stop it and retry.'}
        $process.Refresh()
        if(-not $process.HasExited){$process.Kill();$process.WaitForExit()}
        break
      }
      if([DateTime]::UtcNow -ge $deadline){throw 'The old broker still has connections or workers. Finish processes/searches in the old version, Stop MCP and retry Setup. Nothing was reset.'}
      Start-Sleep -Milliseconds 500
    }while($true)
  }
  for($attempt=0;$attempt -lt 40;$attempt++){
    if((Snapshot).state -eq 'stopped'){return}
    Start-Sleep -Milliseconds 250
  }
  throw 'Broker is still stopping. Wait for it to finish, then run Setup again.'
}
