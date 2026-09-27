$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'runtime-upgrade.ps1')
$project=Split-Path -Parent $PSScriptRoot
$testRoot=Join-Path $project ('logs\runtime-upgrade-'+[Guid]::NewGuid().ToString('N'))
$legacy=Join-Path $testRoot 'legacy install'
$null=New-Item -ItemType Directory -Path $legacy -Force
Copy-Item -LiteralPath (Join-Path $project 'dist') -Destination $legacy -Recurse
$legacyPackage=Join-Path $legacy 'package.json'
$env:DWB_DATA_DIR=Join-Path $testRoot 'user data'
$env:DWB_CONFIG_FILE=Join-Path $env:DWB_DATA_DIR 'config.json'
$null=New-Item -ItemType Directory -Path $env:DWB_DATA_DIR -Force
$worker=Join-Path $legacy 'external\desktop-commander\node_modules\@wonderwhy-er\desktop-commander\dist\index.js'
[IO.File]::WriteAllText($env:DWB_CONFIG_FILE,(@{workerEntry=$worker}|ConvertTo-Json))
$before=(Get-FileHash -LiteralPath $env:DWB_CONFIG_FILE).Hash
$fixture=@'
import {createServer} from 'node:net';
import {writeFileSync} from 'node:fs';
import {brokerEndpoint} from './broker-protocol.js';
const started=Date.now();
const modern=process.argv.includes('modern-busy');
createServer(socket=>{let buffer='';socket.on('data',chunk=>{
buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);
const broker={brokerPid:process.pid,attachedSessions:0,activeWorkers:Date.now()-started<1200?1:0,startingWorkers:0,stoppingWorkers:0,queueDepth:0,inFlightCalls:0,...(modern?{runtime:{version:'fixture'}}:{})};
socket.write(JSON.stringify(m.method==='prepare_upgrade'?{id:m.id,ok:false,error:{message:'DWB_UPGRADE_BUSY: fixture background process'}}:{id:m.id,ok:true,result:{broker}})+'\n');
}})}).listen(brokerEndpoint(),()=>writeFileSync(process.env.DWB_DATA_DIR+'/ready','ready'));
'@
[IO.File]::WriteAllText((Join-Path $legacy 'dist\broker-server.js'),$fixture)
$node=Get-DwbNode
foreach($packageName in @('dwb-mcp-studio-core','n3zuui-mcp-studio-core')){
  [IO.File]::WriteAllText($legacyPackage,(ConvertTo-Json @{name=$packageName;version='0.1.0-beta.9';type='module'} -Compress))
  foreach($mode in @('legacy','modern-busy')){
  $ready=Join-Path $env:DWB_DATA_DIR 'ready'
  if(Test-Path -LiteralPath $ready){Remove-Item -LiteralPath $ready}
  $arguments=(ConvertTo-DwbArgument (Join-Path $legacy 'dist\broker-server.js'))+' '+$mode
  $child=Start-Process $node -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardError (Join-Path $testRoot ($mode+'.err'))
  $null=$child.Handle
  try{
    for($i=0;$i -lt 100 -and -not(Test-Path -LiteralPath $ready);$i++){Start-Sleep -Milliseconds 50}
    if(-not(Test-Path -LiteralPath $ready)){throw 'Fixture failed to start'}
    if($mode -eq 'legacy'){
      Stop-DwbRuntimeForSetup $node
      $child.Refresh()
      if(-not $child.HasExited){throw 'Empty verified legacy broker was not retired'}
    }else{
      $rejected=$false
      try{Stop-DwbRuntimeForSetup $node}catch{if($_.Exception.Message -notmatch 'DWB_UPGRADE_BUSY'){throw};$rejected=$true}
      $child.Refresh()
      if(-not $rejected -or $child.HasExited){throw 'Busy runtime must remain alive'}
    }
    if((Get-FileHash -LiteralPath $env:DWB_CONFIG_FILE).Hash -ne $before){throw 'Runtime preflight changed saved configuration'}
  }finally{$child.Refresh();if(-not $child.HasExited){$child.Kill();$child.WaitForExit()};$child.Dispose()}
  }
}
Write-Output 'RUNTIME_UPGRADE_PASS: verified empty legacy process retired, busy runtime retained, saved configuration unchanged.'
