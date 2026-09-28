$ErrorActionPreference='Stop'
$scriptDir=$PSScriptRoot
$dash=Get-Content -LiteralPath (Join-Path $scriptDir 'dashboard.ps1') -Raw -Encoding UTF8
$museai=Get-Content -LiteralPath (Join-Path $scriptDir 'muse-ai.ps1') -Raw -Encoding UTF8
$mcpMod=Join-Path $scriptDir 'mcp-control.ps1'
if(-not (Test-Path -LiteralPath $mcpMod)){throw 'RED: scripts/mcp-control.ps1 is missing - extract the shared MCP control module first.'}
$mcpctl=Get-Content -LiteralPath $mcpMod -Raw -Encoding UTF8

function Assert-Contains([string]$Text,[string]$Needle,[string]$Msg){
  if($Text -notmatch [regex]::Escape($Needle)){throw $Msg}
}
function Assert-NotContains([string]$Text,[string]$Needle,[string]$Msg){
  if($Text -match [regex]::Escape($Needle)){throw $Msg}
}
function Window-Text([string]$Text,[string]$Anchor,[int]$Len=1500){
  $i=$Text.IndexOf($Anchor)
  if($i -lt 0){throw "Anchor not found: $Anchor"}
  return $Text.Substring($i,[Math]::Min($Len,$Text.Length-$i))
}

foreach($fn in @('function Start-MuseAiMcp','function Stop-MuseAiMcp','function Test-McpRunning','function Reset-MuseAiToken','function Get-MuseAiTunnelUrl','function Get-MuseAiBridgeConfig','function Test-MuseAiBridge','function Start-McpProcess')){
  Assert-Contains $mcpctl $fn "mcp-control.ps1 must define $fn"
}
foreach($fn in @('function Start-MuseAiMcp','function Stop-MuseAiMcp','function Test-McpRunning','function Reset-MuseAiToken')){
  Assert-NotContains $museai $fn "muse-ai.ps1 must not redefine $fn (single source: mcp-control.ps1)"
}
Assert-Contains $dash "mcp-control.ps1" 'dashboard.ps1 must dot-source mcp-control.ps1'
Assert-Contains $museai "mcp-control.ps1" 'muse-ai.ps1 must dot-source mcp-control.ps1'

$startW=Window-Text $dash "(Find 'StartMcp').Add_Click({"
Assert-Contains $startW 'Start-MuseAiMcp' 'dashboard StartMcp must call Start-MuseAiMcp'
Assert-NotContains $startW 'Start-DwbTunnel' 'dashboard StartMcp must not call legacy Start-DwbTunnel'
$stopW=Window-Text $dash "(Find 'StopMcp').Add_Click({"
Assert-Contains $stopW 'Stop-MuseAiMcp' 'dashboard StopMcp must call Stop-MuseAiMcp'
Assert-NotContains $stopW 'Stop-DwbTunnel' 'dashboard StopMcp must not call legacy Stop-DwbTunnel'

$cardW=Window-Text $dash 'function Update-TunnelCard' 2200
Assert-Contains $cardW 'Test-McpRunning' 'Update-TunnelCard must reflect Muse AI MCP state via Test-McpRunning'
Assert-Contains $cardW 'Get-MuseAiTunnelUrl' 'Update-TunnelCard must show the Muse AI tunnel URL'

. $mcpMod
$tmp=Join-Path ([IO.Path]::GetTempPath()) ('dwb-dash-mcp-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try{
  if(Test-McpRunning $tmp){throw 'Test-McpRunning must be false with no pid file'}
  Save-McpPids 0 0 $tmp
  if(-not (Get-McpPids $tmp)){throw 'Get-McpPids must read back saved PIDs'}
  if(Test-McpRunning $tmp){throw 'Test-McpRunning must be false when tracked PIDs are dead'}
  Clear-McpPids $tmp
  if(Test-Path -LiteralPath (Get-McpPidFile $tmp)){throw 'Clear-McpPids must remove the pid file'}
  $t1=New-MuseAiToken; $t2=New-MuseAiToken
  if($t1 -notmatch '^[A-Za-z0-9_-]{43}$'){throw 'New-MuseAiToken must be 43-char base64url'}
  if($t1 -eq $t2){throw 'New-MuseAiToken must be unique'}
  '{"port": 3123, "path": "/mcp", "token": "oldtok"}' | Set-Content (Join-Path $tmp 'bridge.config.json') -Encoding UTF8
  $cfg=Get-MuseAiBridgeConfig $tmp
  if($cfg.port -ne 3123 -or $cfg.path -ne '/mcp'){throw 'Get-MuseAiBridgeConfig must read port/path'}
  $new=Reset-MuseAiToken $tmp
  if($new -eq 'oldtok' -or $new -notmatch '^[A-Za-z0-9_-]{43}$'){throw 'Reset-MuseAiToken must rotate the token'}
  if((Get-MuseAiBridgeConfig $tmp).port -ne 3123){throw 'Reset-MuseAiToken must preserve port/path'}
  'https://xyz.trycloudflare.com' | Set-Content (Join-Path $tmp 'tunnel.url') -Encoding UTF8
  if((Get-MuseAiTunnelUrl $tmp) -ne 'https://xyz.trycloudflare.com'){throw 'Get-MuseAiTunnelUrl must read tunnel.url'}
  if(Test-MuseAiBridge 3123 'oldtok'){throw 'Test-MuseAiBridge must be graceful (false) when nothing listens'}
}finally{
  if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}
}
Write-Output 'DASHBOARD_MCP_PASS: dashboard Start/Stop wired to Muse AI MCP; mcp-control.ps1 single-sourced; token rotation, pid tracking, tunnel.url, graceful health probe verified.'
