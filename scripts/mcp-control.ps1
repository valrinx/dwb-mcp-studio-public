# mcp-control.ps1 - shared Muse AI MCP control (bridge + cloudflared tunnel).
# Dot-sourced by dashboard.ps1 and muse-ai.ps1; uses the caller's
# $script:RepoRoot (repo root) and $script:Node (node.exe path).

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
    $req.Method='GET';$req.Timeout=800
    $req.Proxy=$null  # localhost must never go through proxy autodetect (WPAD stalls the UI thread)
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

function New-MuseAiToken{
  $bytes=New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ([Convert]::ToBase64String($bytes) -replace '\+','-' -replace '/','_' -replace '=','')
}

function Reset-MuseAiToken([string]$Root=$script:RepoRoot){
  $file=Join-Path $Root 'bridge.config.json'
  if(-not (Test-Path -LiteralPath $file)){throw 'ยังไม่ได้ตั้งค่า bridge — เปิด Setup อีกครั้ง หรือรัน npm run setup'}
  $json=Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
  $newToken=New-MuseAiToken
  $json.token=$newToken
  # BOM-less UTF-8: node JSON.parse (bridge-config.mjs) throws on a BOM, which kills
  # the bridge and tunnel processes on start. PS 5.1 Set-Content -Encoding UTF8 writes a BOM.
  [IO.File]::WriteAllText($file, ($json | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding $false))
  return $newToken
}

function Get-McpPidFile([string]$Root=$script:RepoRoot){return Join-Path $Root 'mcp.pids.json'}

function Save-McpPids([int]$BridgePid,[int]$TunnelPid,[string]$Root=$script:RepoRoot){
  [IO.File]::WriteAllText((Get-McpPidFile $Root), (@{bridge=$BridgePid;tunnel=$TunnelPid} | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
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
  return (Test-McpProcessAlive ([int]$p.bridge)) -and (Test-McpProcessAlive ([int]$p.tunnel))
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

function Assert-McpPrerequisites([string]$Root=$script:RepoRoot){
  # Fail fast with an actionable message instead of silently starting node
  # processes that die instantly (their stderr is hidden by design).
  $sdk=Join-Path $Root 'node_modules\@modelcontextprotocol\sdk\package.json'
  if(-not (Test-Path -LiteralPath $sdk -PathType Leaf)){throw 'ยังไม่ได้ติดตั้ง dependencies — รัน npm install ในโฟลเดอร์โปรเจคก่อน'}
  $dist=Join-Path $Root 'dist\index.js'
  if(-not (Test-Path -LiteralPath $dist -PathType Leaf)){throw 'ยังไม่ได้ build — รัน npm run build ในโฟลเดอร์โปรเจคก่อน'}
  $tunnel=Join-Path $Root 'bin\cloudflared.exe'
  if(-not (Test-Path -LiteralPath $tunnel -PathType Leaf)){throw 'ยังไม่มี cloudflared สำหรับเปิด tunnel — เปิด PowerShell ในโฟลเดอร์โปรแกรมแล้วรัน npm run setup จากนั้นกด Start MCP อีกครั้ง'}
}

function Start-MuseAiMcp([string]$Root=$script:RepoRoot){
  Assert-McpPrerequisites $Root
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
