$ErrorActionPreference='Stop'
$report=Join-Path $env:TEMP ('dwb-muse-ai-test-'+[guid]::NewGuid().ToString('N')+'.txt')
try{
  & powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'muse-ai.ps1') -UiTest -UiTestReport $report
  if($LASTEXITCODE -ne 0){throw "Muse AI UI test process failed ($LASTEXITCODE)"}
  if(-not (Test-Path -LiteralPath $report)){throw 'Muse AI UI did not produce its control verification report.'}
  $result=Get-Content -LiteralPath $report -Raw -Encoding UTF8
  $expected='PASS: Muse AI UI behavior: controls=16; bridge-config=read; health-probe=graceful; token=masked; tunnel-url=read; copy-message=complete; status-render=no-throw'
  if($result.Trim() -ne $expected){throw "Expected '$expected'; got '$result'"}
  Write-Output 'MUSE_AI_UI_PASS: Muse AI screen controls, bridge.config.json reading, graceful bridge health probe, token masking, tunnel.url reading, copy-for-Muse message, and status rendering verified.'
}finally{
  if(Test-Path -LiteralPath $report){Remove-Item -LiteralPath $report -Force}
}
