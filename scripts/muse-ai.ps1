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
. (Join-Path $PSScriptRoot 'mcp-control.ps1')

function Get-MuseAiMaskedToken([string]$Token,[bool]$ConfigExists){
  if(-not $ConfigExists){return 'ยังไม่ได้ตั้งค่า — รัน npm run setup'}
  if(-not $Token){return 'ปิดไว้ — ไม่ต้องใช้ token'}
  if($Token.Length -le 8){return '••••••••'}
  return '••••'+$Token.Substring($Token.Length-4)
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
    (Find 'TunnelUrl').Text='ยังไม่ได้เปิด tunnel — กด "Start MCP" บน dashboard หลัก'
    (Find 'TunnelUrl').Foreground='#8D98A3'
  }
  (Find 'TokenState').Text=Get-MuseAiMaskedToken $cfg.token $cfg.exists
  if(-not $running){(Find 'ActionStatus').Text='Bridge ยังไม่ทำงาน — กด "Start MCP" บน dashboard หลัก'}
}

(Find 'Refresh').Add_Click({Update-MuseAiStatus;(Find 'ActionStatus').Text='รีเฟรชสถานะแล้ว'})
(Find 'CopyForMuse').Add_Click({
  $cfg=Get-MuseAiBridgeConfig
  $tunnel=Get-MuseAiTunnelUrl
  if($tunnel){$endpoint=$tunnel+$cfg.path}
  else{$endpoint="http://127.0.0.1:$($cfg.port)$($cfg.path)"}
  [Windows.Clipboard]::SetText((Build-MuseAiMessage $endpoint $cfg.token))
  (Find 'ActionStatus').Text=if($tunnel){'คัดลอกข้อความสำหรับ Muse แล้ว — วางในแชทใหม่ได้เลย'}else{'คัดลอก endpoint ภายในเครื่อง — ใช้ได้เฉพาะบนเครื่องนี้ เปิด tunnel ก่อนเพื่อเชื่อมจากที่อื่น'}
})

if($UiTest){
  foreach($name in @('BrandTitle','Refresh','BridgeStatusCard','BridgeDot','BridgeStateLabel','BridgeEndpoint','TunnelUrl','TokenState','CopyForMuse','FlowCard','SetupCard','SecurityCard','ActionStatus','MainScroll')){
    if(-not (Find $name)){throw "Muse AI is missing control: $name"}
  }
  if((Find 'CopyForMuse') -isnot [Windows.Controls.Button] -or (Find 'Refresh') -isnot [Windows.Controls.Button]){throw 'Muse AI action buttons are missing.'}
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
    if(Find 'StartStopMcp'){throw 'Muse AI must not have its own Start/Stop MCP button; use the main dashboard button.'}
    $realCfg=Get-MuseAiBridgeConfig
    if($realCfg.token -and (Find 'TokenState').Text.Contains($realCfg.token)){throw 'Full token leaked into UI text'}
  }finally{
    try{Stop-MuseAiMcp -Root $tmp}catch{}
    if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}
  }
  if($UiTestReport){[IO.File]::WriteAllText($UiTestReport,'PASS: Muse AI UI behavior: controls=14; mcp-start-stop=main-dashboard-button; token=rotated-on-start-and-stop; procs=hidden+pid-tracked; bridge-config=read; health-probe=graceful; token=masked; tunnel-url=read; copy-message=complete; status-render=no-throw')}
  $window.Close()
}else{Update-MuseAiStatus;$null=$window.ShowDialog()}
