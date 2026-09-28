$ErrorActionPreference='Stop'
$scriptDir=$PSScriptRoot
$script:RepoRoot=$scriptDir
. (Join-Path $scriptDir 'mcp-control.ps1')

# Start-MuseAiMcp must fail fast with a clear, actionable message when the
# machine is missing prerequisites — not start dead node processes silently.
$fn=Get-Command Assert-McpPrerequisites -ErrorAction SilentlyContinue
if(-not $fn){throw 'RED: mcp-control.ps1 must define Assert-McpPrerequisites (fail fast with a clear message instead of silently starting dead processes)'}

$tmp=Join-Path ([IO.Path]::GetTempPath()) ('dwb-preflight-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try{
  try{Assert-McpPrerequisites $tmp; throw 'should-have-thrown'}catch{
    if($_.Exception.Message -eq 'should-have-thrown'){throw 'RED: Assert-McpPrerequisites must throw when node_modules is missing'}
    if($_.Exception.Message -notmatch 'npm install'){throw "RED: missing-dependency error must tell the user to run npm install; got: $($_.Exception.Message)"}
  }
  $sdkDir=Join-Path $tmp 'node_modules\@modelcontextprotocol\sdk'
  New-Item -ItemType Directory -Path $sdkDir -Force | Out-Null
  '{}' | Set-Content (Join-Path $sdkDir 'package.json') -Encoding UTF8
  try{Assert-McpPrerequisites $tmp; throw 'should-have-thrown'}catch{
    if($_.Exception.Message -eq 'should-have-thrown'){throw 'RED: Assert-McpPrerequisites must throw when dist/ is not built'}
    if($_.Exception.Message -notmatch 'npm run build'){throw "RED: missing-build error must tell the user to run npm run build; got: $($_.Exception.Message)"}
  }
  $distDir=Join-Path $tmp 'dist'
  New-Item -ItemType Directory -Path $distDir -Force | Out-Null
  '// built' | Set-Content (Join-Path $distDir 'index.js') -Encoding UTF8
  Assert-McpPrerequisites $tmp  # must not throw when everything is present
}finally{
  if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue}
}
Write-Output 'MCP_PREFLIGHT_PASS: Start-MuseAiMcp prerequisites fail fast with actionable messages (npm install / npm run build).'
