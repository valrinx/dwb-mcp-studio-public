param([switch]$UiTest,[string]$UiTestReport)
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'dpi-common.ps1')
Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
. (Join-Path $PSScriptRoot 'setup-common.ps1')
$reader=[Xml.XmlReader]::Create([IO.StringReader]::new([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'muse-ai.xaml'))))
try{$window=[Windows.Markup.XamlReader]::Load($reader)}finally{$reader.Dispose()}
function Find([string]$Name){return $window.FindName($Name)}
$script:RepoRoot=Split-Path -Parent $PSScriptRoot
$script:Node=Get-DwbNode

function Get-MuseAiBridgeConfig([string]$Root=$script:RepoRoot){
  $cfg=@{exists=$false;port=3000;path='/mcp';token=$null}
  $file=Join-Path $Root 'bridge.config.json'
  if(Test-Path -LiteralPath $file){
    try{
      $json=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
      $cfg.exists=$true
      if($json.port){$cfg.port=[int]$json.port}
      if($json.path){$cfg.path=[string]$json.path}
      if($null -ne $json.token){$cfg.token=[string]$json.token}
    }catch{}
  }
  return $cfg
}

function Test-MuseAiBridge([int]$Port,[string]$Token){
  try{
    $req=[Net.WebRequest]::Create("http://127.0.0.1:$Port/health")
    $req.Method='GET';$req.Timeout=2500
    if($Token){$req.Headers['Authorization']="Bearer $Token"}
    $resp=$req.GetResponse()
    $code=[int]$resp.StatusCode;$resp.Close()
    return $code -eq 200
  }catch{return $false}
}

function Get-MuseAiTunnelUrl([string]$Root=$script:RepoRoot){
  $file=Join-Path $Root 'tunnel.url'
  if(Test-Path -LiteralPath $file){
    $url=(Get-Content -LiteralPath $file -Raw -Encoding UTF8).Trim()
    if($url -match '^https://'){return $url}
  }
  return $null
}

function Get-MuseAiMaskedToken([string]$Token,[bool]$ConfigExists){
  if(-not $ConfigExists){return 'ยังไม่ได้ตั้งค่า — รัน npm run setup'}
  if(-not $Token){return 'ปิดไว้ — ไม่ต้องใช้ token'}
  if($Token.Length -le 8){return '••••••••'}
  return '••••'+$Token.Substring($Token.Length-4)
}

function New-MuseAiToken{
  $bytes=New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '\+','-' -replace '/','_' -replace '=','')
}

function Reset-MuseAiToken([string]$Root=$script:RepoRoot){
  $file=Join-Path $Root 'bridge.config.json'
  if(-not (Test-Path -LiteralPath $file)){throw 'ยังไม่ได้ตั้งค่า — รัน npm install ก่อน'}
  $json=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $newToken=New-MuseAiToken
  $json.token=$newToken
  ($json | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $file -Encoding UTF8
  return $newToken
}

function Get-McpPidFile([string]$Root=$script:RepoRoot){return Join-Path $Root 'mcp.pids.json'}

function Save-McpPids([int]$BridgePid,[int]$TunnelPid,[string]$Root=$script:RepoRoot){
  (@{bridge=$BridgePid;tunnel=$TunnelPid} | ConvertTo-Json) | Set-Content -LiteralPath (Get-McpPidFile $Root) -Encoding UTF8
}

function Get-McpPids([string]$Root=$script:RepoRoot){
  $f=Get-McpPidFile $Root
  if(Test-Path -LiteralPath $f){try{return Get-Content -LiteralPath $f -Raw -Encoding UTF8 | ConvertFrom-Json}catch{}}
  return $null
}

function Clear-McpPids([string]$Root=$script:RepoRoot){
  $f=Get-McpPidFile $Root
  if(Test-Path -LiteralPath $f){Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue}
}

function Test-McpProcessAlive([int]$Id){
  if(-not $Id){return $false}
  try{$null=Get-Process -Id $Id -ErrorAction Stop;return $true}catch{return $false}
}

function Test-McpRunning([string]$Root=$script:RepoRoot){
  $p=Get-McpPids $Root
  if(-not $p){return $false}
  return (Test-McpProcessAlive ([int]$p.bridge)) -or (Test-McpProcessAlive ([int]$p.tunnel))
}

function Start-McpProcess([string]$ScriptRelPath,[string]$Root=$script:RepoRoot){
  if(-not $script:Node){throw 'ไม่พบ Node.js — รันตั้งค่าเครื่องก่อน'}
  $proc=Start-Process -FilePath $script:Node -ArgumentList $ScriptRelPath -WorkingDirectory $Root -WindowStyle Hidden -PassThru
  return $proc.Id
}

function Stop-StrayMcpProcesses{
  foreach($proc in (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue)){
    if($proc.CommandLine -match 'stdio-http-bridge\.mjs' -or $proc.CommandLine -match '[\s\\/]tunnel\.mjs'){
      try{Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop}catch{}
    }
  }
}

function Stop-MuseAiMcpProcesses([string]$Root=$script:RepoRoot){
  Stop-StrayMcpProcesses
  $p=Get-McpPids $Root
  if($p){
    foreach($id in @($p.bridge,$p.tunnel)){if($id){try{Stop-Process -Id ([int]$id) -Force -ErrorAction Stop}catch{}}}
    Clear-McpPids $Root
  }
}

function Start-MuseAiMcp([string]$Root=$script:RepoRoot){
  Stop-MuseAiMcpProcesses $Root
  $null=Reset-MuseAiToken $Root
  $bridgePid=Start-McpProcess 'scripts/stdio-http-bridge.mjs' $Root
  $tunnelPid=Start-McpProcess 'scripts/tunnel.mjs' $Root
  Save-McpPids $bridgePid $tunnelPid $Root
}

function Stop-MuseAiMcp([string]$Root=$script:RepoRoot){
  Stop-MuseAiMcpProcesses $Root
  try{Reset-MuseAiToken $Root | Out-Null}catch{}
}

$script:McpWatchdog=$null
$script:McpWatchdogTries=0
function Start-MuseAiWatchdog{
  Stop-MuseAiWatchdog
  $script:McpWatchdogTries=0
  $t=New-Object Windows.Threading.DispatcherTimer
  $t.Interval=[TimeSpan]::FromSeconds(2)
  $t.Add_Tick({
    $script:McpWatchdogTries++
    Update-MuseAiStatus
    $cfg=Get-MuseAiBridgeConfig
    $ready=(Test-MuseAiBridge $cfg.port $cfg.token) -and [bool](Get-MuseAiTunnelUrl)
    if($ready -or $script:McpWatchdogTries -ge 30 -or -not (Test-McpRunning)){
      Stop-MuseAiWatchdog
      if($ready){(Find 'ActionStatus').Text='MCP พร้อมใช้งาน — กดคัดลอกข้อความสำหรับ Muse ได้เลย'}
      elseif(Test-McpRunning){(Find 'ActionStatus').Text='เริ่มบางส่วนไม่สำเร็จ — กดรีเฟรชเพื่อดูสถานะ'}
      Update-MuseAiStatus
    }
  })
  $t.Start()
  $script:McpWatchdog=$t
}
function Stop-MuseAiWatchdog{
  if($script:McpWatchdog){$script:McpWatchdog.Stop();$script:McpWatchdog=$null}
}

function Build-MuseAiMessage([string]$Endpoint,[string]$Token){
  $lines=@(
    'เชื่อมต่อกับ N3zuui Studio ของฉันผ่าน MCP remote bridge:',
    '',
    "MCP endpoint (Streamable HTTP): $Endpoint",
    "Authorization: Bearer $Token",
    '',
    'ส่ง POST ไปที่ endpoint พร้อม header Authorization ทุกครั้ง — จะเรียก tools ของ Studio ได้ทันที'
  )
  return ($lines -join "`r`n")
}

function Set-MuseAiDot([string]$Color){
  $brush=New-Object Windows.Media.SolidColorBrush ([Windows.Media.ColorConverter]::ConvertFromString($Color))
  (Find 'BridgeDot').Fill=$brush
}

function Update-MuseAiStatus{
  $cfg=Get-MuseAiBridgeConfig
  $endpoint="http://127.0.0.1:$($cfg.port)$($cfg.path)"
  (Find 'BridgeEndpoint').Text=$endpoint
  $running=Test-MuseAiBridge $cfg.port $cfg.token
  (Find 'BridgeStateLabel').Text=if($running){'Bridge ทำงานอยู่'}else{'Bridge ยังไม่ทำงาน'}
  if($running){Set-MuseAiDot '#63D7B4'}else{Set-MuseAiDot '#EDB77D'}
  $tunnel=Get-MuseAiTunnelUrl
  if($tunnel){
    (Find 'TunnelUrl').Text=$tunnel
    (Find 'TunnelUrl').Foreground='#A9F5FF'
  }else{
    (Find 'TunnelUrl').Text='ยังไม่ได้เปิด tunnel — กด "▶ เริ่ม MCP"'
    (Find 'TunnelUrl').Foreground='#8D98A3'
  }
  (Find 'TokenState').Text=Get-MuseAiMaskedToken $cfg.token $cfg.exists
  (Find 'StartStopMcp').Content=if(Test-McpRunning){'■ หยุด MCP'}else{'▶ เริ่ม MCP'}
  if(-not $running){(Find 'ActionStatus').Text='Bridge ยังไม่ทำงาน — กด "▶ เริ่ม MCP"'}
}

(Find 'Refresh').Add_Click({Update-MuseAiStatus;(Find 'ActionStatus').Text='รีเฟรชสถานะแล้ว'})
(Find 'StartStopMcp').Add_Click({
  try{
    if(Test-McpRunning){
      Stop-MuseAiMcp
      Stop-MuseAiWatchdog
      Update-MuseAiStatus
      (Find 'ActionStatus').Text='หยุด MCP แล้ว — token ถูกเปลี่ยนใหม่'
    }else{
      Start-MuseAiMcp
      Update-MuseAiStatus
      (Find 'ActionStatus').Text='กำลังเริ่ม MCP เบื้องหลัง…'
      Start-MuseAiWatchdog
    }
  }catch{(Find 'ActionStatus').Text=$_.Exception.Message}
})
(Find 'CopyForMuse').Add_Click({
  $cfg=Get-MuseAiBridgeConfig
  $tunnel=Get-MuseAiTunnelUrl
  if($tunnel){$endpoint=$tunnel+$cfg.path}
  else{$endpoint="http://127.0.0.1:$($cfg.port)$($cfg.path)"}
  [Windows.Clipboard]::SetText((Build-MuseAiMessage $endpoint $cfg.token))
  (Find 'ActionStatus').Text=if($tunnel){'คัดลอกข้อความสำหรับ Muse แล้ว — วางในแชทใหม่ได้เลย'}else{'คัดลอก endpoint ภายในเครื่อง — ใช้ได้เฉพาะบนเครื่องนี้ เปิด tunnel ก่อนเพื่อเชื่อมจากที่อื่น'}
})

if($UiTest){
  foreach($name in @('BrandTitle','Refresh','BridgeStatusCard','BridgeDot','BridgeStateLabel','BridgeEndpoint','TunnelUrl','TokenState','StartStopMcp','CopyForMuse','FlowCard','SetupCard','SecurityCard','ActionStatus','MainScroll')){
    if(-not (Find $name)){throw "Muse AI is missing control: $name"}
  }
  if((Find 'StartStopMcp') -isnot [Windows.Controls.Button] -or (Find 'CopyForMuse') -isnot [Windows.Controls.Button] -or (Find 'Refresh') -isnot [Windows.Controls.Button]){throw 'Muse AI action buttons are missing.'}
  if((Find 'StartBridge') -or (Find 'StartTunnel')){throw 'Muse AI must use a single Start/Stop MCP button, not separate bridge/tunnel buttons.'}
  if((Find 'BridgeDot') -isnot [Windows.Shapes.Ellipse]){throw 'Muse AI bridge status dot is missing.'}
  $tok1=New-MuseAiToken
  $tok2=New-MuseAiToken
  if($tok1 -notmatch '^[A-Za-z0-9_-]{43}$'){throw 'Muse AI token must be 43-char base64url'}
  if($tok1 -eq $tok2){throw 'Muse AI token generator must produce unique tokens'}
  $tmp=Join-Path ([IO.Path]::GetTempPath()) ('dwb-muse-ai-test-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try{
    '{"port": 3123, "path": "/mcp", "token": "abc123token456"}' | Set-Content (Join-Path $tmp 'bridge.config.json') -Encoding UTF8
    $cfg=Get-MuseAiBridgeConfig $tmp
    if($cfg.port -ne 3123 -or $cfg.path -ne '/mcp' -or $cfg.token -ne 'abc123token456' -or -not $cfg.exists){throw 'Muse AI could not read bridge.config.json'}
    $rotated=Reset-MuseAiToken $tmp
    if($rotated -eq 'abc123token456'){throw 'Muse AI must rotate the bearer token on start/stop'}
    if($rotated -notmatch '^[A-Za-z0-9_-]{43}$'){throw 'Rotated token has wrong format'}
    $cfg2=Get-MuseAiBridgeConfig $tmp
    if($cfg2.token -ne $rotated -or $cfg2.port -ne 3123 -or $cfg2.path -ne '/mcp'){throw 'Token rotation must persist port/path and update the token'}
    try{Reset-MuseAiToken (Join-Path $tmp 'nope-dir') | Out-Null; throw 'should-have-thrown'}catch{if($_.Exception.Message -eq 'should-have-thrown'){throw 'Reset-MuseAiToken must throw when bridge.config.json is missing'}}
    if(Test-MuseAiBridge 3123 'abc123token456'){throw 'Health probe should report stopped when nothing listens on the port'}
    $masked=Get-MuseAiMaskedToken 'abc123token456' $true
    if($masked -eq 'abc123token456'){throw 'Token must be masked in the UI'}
    if($masked.Length -ge 'abc123token456'.Length){throw 'Masked token must hide most of the token'}
    if((Get-MuseAiMaskedToken $null $false) -notmatch 'npm run setup'){throw 'Missing bridge config should prompt npm run setup'}
    'https://abc123.trycloudflare.com' | Set-Content (Join-Path $tmp 'tunnel.url') -Encoding UTF8
    if((Get-MuseAiTunnelUrl $tmp) -ne 'https://abc123.trycloudflare.com'){throw 'Muse AI could not read tunnel.url'}
    $msg=Build-MuseAiMessage 'https://abc123.trycloudflare.com/mcp' 'abc123token456'
    if($msg -notmatch 'https://abc123\.trycloudflare\.com/mcp' -or $msg -notmatch 'Bearer abc123token456'){throw 'Copy-for-Muse message is missing the endpoint or token'}
    if(-not (Test-McpProcessAlive $PID)){throw 'Current process should be reported alive'}
    if(Test-McpProcessAlive -1){throw 'Impossible PID should be reported dead'}
    if(Test-McpRunning $tmp){throw 'MCP should report stopped with no pid file'}
    New-Item -ItemType Directory -Path (Join-Path $tmp 'scripts') | Out-Null
    'setTimeout(()=>{},15000)' | Set-Content (Join-Path $tmp 'scripts\dummy.mjs') -Encoding UTF8
    if(-not $script:Node){throw 'Node.js is required for the background-process test'}
    $dpid=Start-McpProcess 'scripts/dummy.mjs' $tmp
    if(-not (Test-McpProcessAlive $dpid)){throw 'Hidden background process did not start'}
    Save-McpPids $dpid 0 $tmp
    if(-not (Test-McpRunning $tmp)){throw 'MCP should report running after Start-McpProcess + Save-McpPids'}
    Stop-MuseAiMcp -Root $tmp
    Start-Sleep -Milliseconds 800
    if(Test-McpRunning $tmp){throw 'MCP should report stopped after Stop-MuseAiMcp'}
    if(Test-Path -LiteralPath (Get-McpPidFile $tmp)){throw 'Pid file must be removed on stop'}
    $cfg3=Get-MuseAiBridgeConfig $tmp
    if($cfg3.token -eq $rotated){throw 'Stop must rotate the token too'}
    Update-MuseAiStatus
    if((Find 'BridgeEndpoint').Text -notmatch '127\.0\.0\.1'){throw 'Bridge endpoint was not rendered'}
    if((Find 'StartStopMcp').Content -notmatch 'เริ่ม MCP'){throw 'Toggle button should offer Start MCP when stopped'}
    $realCfg=Get-MuseAiBridgeConfig
    if($realCfg.token -and (Find 'TokenState').Text.Contains($realCfg.token)){throw 'Full token leaked into UI text'}
  }finally{
    try{Stop-MuseAiMcp -Root $tmp}catch{}
    if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}
  }
  if($UiTestReport){[IO.File]::WriteAllText($UiTestReport,'PASS: Muse AI UI behavior: controls=15; one-button-mcp=start/stop; token=rotated-on-start-and-stop; procs=hidden+pid-tracked; bridge-config=read; health-probe=graceful; token=masked; tunnel-url=read; copy-message=complete; status-render=no-throw')}
  $window.Close()
}else{Update-MuseAiStatus;$null=$window.ShowDialog()}
