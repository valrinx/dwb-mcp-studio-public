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
    (Find 'TunnelUrl').Text='ยังไม่ได้เปิด tunnel — กด "เริ่ม Tunnel"'
    (Find 'TunnelUrl').Foreground='#8D98A3'
  }
  (Find 'TokenState').Text=Get-MuseAiMaskedToken $cfg.token $cfg.exists
  if(-not $running){(Find 'ActionStatus').Text='Bridge ยังไม่ทำงาน — กด "เริ่ม Bridge" หรือรัน npm run bridge'}
}

(Find 'Refresh').Add_Click({Update-MuseAiStatus;(Find 'ActionStatus').Text='รีเฟรชสถานะแล้ว'})
(Find 'StartBridge').Add_Click({
  try{
    if(-not $script:Node){throw 'ไม่พบ Node.js — รันตั้งค่าเครื่องก่อน'}
    Start-Process -FilePath $script:Node -ArgumentList (Join-Path 'scripts' 'stdio-http-bridge.mjs') -WorkingDirectory $script:RepoRoot -WindowStyle Minimized
    (Find 'ActionStatus').Text='เริ่ม Bridge แล้ว — กดรีเฟรชเพื่อตรวจสอบสถานะ'
  }catch{(Find 'ActionStatus').Text=$_.Exception.Message}
})
(Find 'StartTunnel').Add_Click({
  try{
    if(-not $script:Node){throw 'ไม่พบ Node.js — รันตั้งค่าเครื่องก่อน'}
    Start-Process -FilePath $script:Node -ArgumentList (Join-Path 'scripts' 'tunnel.mjs') -WorkingDirectory $script:RepoRoot -WindowStyle Minimized
    (Find 'ActionStatus').Text='เริ่ม Tunnel แล้ว — รอสักครู่แล้วกดรีเฟรชเพื่อดู URL'
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
  foreach($name in @('BrandTitle','Refresh','BridgeStatusCard','BridgeDot','BridgeStateLabel','BridgeEndpoint','TunnelUrl','TokenState','StartBridge','StartTunnel','CopyForMuse','FlowCard','SetupCard','SecurityCard','ActionStatus','MainScroll')){
    if(-not (Find $name)){throw "Muse AI is missing control: $name"}
  }
  if((Find 'StartBridge') -isnot [Windows.Controls.Button] -or (Find 'StartTunnel') -isnot [Windows.Controls.Button] -or (Find 'CopyForMuse') -isnot [Windows.Controls.Button] -or (Find 'Refresh') -isnot [Windows.Controls.Button]){throw 'Muse AI action buttons are missing.'}
  if((Find 'BridgeDot') -isnot [Windows.Shapes.Ellipse]){throw 'Muse AI bridge status dot is missing.'}
  $tmp=Join-Path ([IO.Path]::GetTempPath()) ('dwb-muse-ai-test-'+[guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp | Out-Null
  try{
    '{"port": 3123, "path": "/mcp", "token": "abc123token456"}' | Set-Content (Join-Path $tmp 'bridge.config.json') -Encoding UTF8
    $cfg=Get-MuseAiBridgeConfig $tmp
    if($cfg.port -ne 3123 -or $cfg.path -ne '/mcp' -or $cfg.token -ne 'abc123token456' -or -not $cfg.exists){throw 'Muse AI could not read bridge.config.json'}
    if(Test-MuseAiBridge 3123 'abc123token456'){throw 'Health probe should report stopped when nothing listens on the port'}
    $masked=Get-MuseAiMaskedToken 'abc123token456' $true
    if($masked -eq 'abc123token456'){throw 'Token must be masked in the UI'}
    if($masked.Length -ge 'abc123token456'.Length){throw 'Masked token must hide most of the token'}
    if((Get-MuseAiMaskedToken $null $false) -notmatch 'npm run setup'){throw 'Missing bridge config should prompt npm run setup'}
    'https://abc123.trycloudflare.com' | Set-Content (Join-Path $tmp 'tunnel.url') -Encoding UTF8
    if((Get-MuseAiTunnelUrl $tmp) -ne 'https://abc123.trycloudflare.com'){throw 'Muse AI could not read tunnel.url'}
    $msg=Build-MuseAiMessage 'https://abc123.trycloudflare.com/mcp' 'abc123token456'
    if($msg -notmatch 'https://abc123\.trycloudflare\.com/mcp' -or $msg -notmatch 'Bearer abc123token456'){throw 'Copy-for-Muse message is missing the endpoint or token'}
    Update-MuseAiStatus
    if((Find 'BridgeEndpoint').Text -notmatch '127\.0\.0\.1'){throw 'Bridge endpoint was not rendered'}
    $realCfg=Get-MuseAiBridgeConfig
    if($realCfg.token -and (Find 'TokenState').Text.Contains($realCfg.token)){throw 'Full token leaked into UI text'}
  }finally{
    if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}
  }
  if($UiTestReport){[IO.File]::WriteAllText($UiTestReport,'PASS: Muse AI UI behavior: controls=16; bridge-config=read; health-probe=graceful; token=masked; tunnel-url=read; copy-message=complete; status-render=no-throw')}
  $window.Close()
}else{Update-MuseAiStatus;$null=$window.ShowDialog()}
