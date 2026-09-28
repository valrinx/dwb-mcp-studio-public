$ErrorActionPreference='Stop'
$scriptDir=$PSScriptRoot
$mcpMod=Join-Path $scriptDir 'mcp-control.ps1'
$dash=Get-Content -LiteralPath (Join-Path $scriptDir 'dashboard.ps1') -Raw -Encoding UTF8
$mcpctl=Get-Content -LiteralPath $mcpMod -Raw -Encoding UTF8

function Assert-Match([string]$Text,[string]$Pattern,[string]$Msg){
  if($Text -notmatch $Pattern){throw $Msg}
}
function Window-Text([string]$Text,[string]$Anchor,[int]$Len=2000){
  $i=$Text.IndexOf($Anchor)
  if($i -lt 0){throw "Anchor not found: $Anchor"}
  return $Text.Substring($i,[Math]::Min($Len,$Text.Length-$i))
}

# 1. localhost health probe must bypass proxy autodetect (WPAD can stall the UI thread for seconds)
$probeW=Window-Text $mcpctl 'function Test-MuseAiBridge'
Assert-Match $probeW 'Proxy\s*=\s*\$null' 'RED: Test-MuseAiBridge must set Proxy=$null for localhost (proxy autodetect stalls the UI thread)'

# 2. probe timeout must be short (<= 1000ms) so a hung bridge cannot freeze the UI
$m=Select-String -InputObject $probeW -Pattern 'Timeout\s*=\s*(\d+)' | Select-Object -First 1
if(-not $m){throw 'RED: Test-MuseAiBridge must set an explicit Timeout'}
$ms=[int]$m.Matches[0].Groups[1].Value
if($ms -gt 1000){throw "RED: Test-MuseAiBridge timeout is ${ms}ms; must be <= 1000ms so a hung bridge cannot freeze the UI"}

# 3. Update-TunnelCard runs on the UI thread every 3s: it must skip the blocking
#    bridge probe entirely when MCP is known-stopped (no PIDs alive).
$cardW=Window-Text $dash 'function Update-TunnelCard'
Assert-Match $cardW 'if\(\$mcpOn\)\{Test-MuseAiBridge' 'RED: Update-TunnelCard must only call Test-MuseAiBridge when $mcpOn is true (skip the blocking probe when MCP is stopped)'

# 4. behavioral: graceful (false) and fast against a closed localhost port
. $mcpMod
$sw=[Diagnostics.Stopwatch]::StartNew()
$up=Test-MuseAiBridge 48123 'nope'
$sw.Stop()
if($up){throw 'Test-MuseAiBridge must return false when nothing listens'}
if($sw.ElapsedMilliseconds -gt 2000){throw ("Test-MuseAiBridge took {0}ms against a closed port; must be < 2000ms" -f $sw.ElapsedMilliseconds)}

Write-Output 'DASHBOARD_LAG_PASS: localhost probe bypasses proxy, short timeout, skipped when MCP stopped, graceful+fast.'
