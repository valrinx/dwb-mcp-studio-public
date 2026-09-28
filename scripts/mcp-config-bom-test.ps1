$ErrorActionPreference='Stop'
$scriptDir=$PSScriptRoot
$script:RepoRoot=$scriptDir
. (Join-Path $scriptDir 'mcp-control.ps1')

$tmp=Join-Path ([IO.Path]::GetTempPath()) ('dwb-bom-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try{
  # node (bridge-config.mjs) uses strict JSON.parse: a UTF-8 BOM makes it throw,
  # which kills both the bridge and the tunnel on start. PowerShell 5.1
  # Set-Content -Encoding UTF8 writes a BOM, so writers must be BOM-less.
  '{"port": 3123, "path": "/mcp", "token": "oldtok"}' | Set-Content (Join-Path $tmp 'bridge.config.json') -Encoding UTF8
  $new=Reset-MuseAiToken $tmp
  if($new -eq 'oldtok'){throw 'Reset-MuseAiToken must rotate the token'}
  $bytes=[IO.File]::ReadAllBytes((Join-Path $tmp 'bridge.config.json'))
  if($bytes.Count -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF){
    throw 'RED: Reset-MuseAiToken wrote a UTF-8 BOM; node JSON.parse rejects it and the bridge/tunnel die on start'
  }
  $text=[Text.Encoding]::UTF8.GetString($bytes).Trim()
  if(-not $text.StartsWith('{')){throw 'bridge.config.json must start with { (no BOM, no garbage)'}
  $null=$text | ConvertFrom-Json  # still valid JSON for PowerShell readers
  # self-heal: a BOM-poisoned config from an older version must be repaired, not choke
  [IO.File]::WriteAllBytes((Join-Path $tmp 'bridge.config.json'), (@(0xEF,0xBB,0xBF)+$bytes))
  $new2=Reset-MuseAiToken $tmp
  $bytes2=[IO.File]::ReadAllBytes((Join-Path $tmp 'bridge.config.json'))
  if($bytes2[0] -eq 0xEF -and $bytes2[1] -eq 0xBB -and $bytes2[2] -eq 0xBF){
    throw 'RED: Reset-MuseAiToken must strip a pre-existing BOM (self-heal)'
  }
  if($new2 -eq $new){throw 'token must rotate again'}
  # pid file: keep BOM-less too for consistency
  Save-McpPids 1234 5678 $tmp
  $pb=[IO.File]::ReadAllBytes((Get-McpPidFile $tmp))
  if($pb[0] -eq 0xEF -and $pb[1] -eq 0xBB -and $pb[2] -eq 0xBF){throw 'RED: Save-McpPids wrote a UTF-8 BOM'}
}finally{
  if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}
}
Write-Output 'MCP_CONFIG_BOM_PASS: token rotation writes BOM-less UTF-8 JSON; self-heals BOM-poisoned configs; pid file BOM-less.'
