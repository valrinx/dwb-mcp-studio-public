$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$root=Split-Path -Parent $PSScriptRoot
$source=[Drawing.Image]::FromFile((Join-Path $root 'assets\n3zuui-mark.png'))
$images=@()
try {
  foreach($size in @(16,24,32,48,64,128,256)) {
    $bitmap=New-Object Drawing.Bitmap($source,$size,$size)
    $stream=New-Object IO.MemoryStream
    try {$bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png);$images+=,[pscustomobject]@{Size=$size;Bytes=$stream.ToArray()}} finally {$bitmap.Dispose();$stream.Dispose()}
  }
} finally {$source.Dispose()}
$iconPath=Join-Path $root 'assets\n3zuui.ico'
$stream=[IO.File]::Create($iconPath);$writer=New-Object IO.BinaryWriter($stream)
try {
  $writer.Write([uint16]0);$writer.Write([uint16]1);$writer.Write([uint16]$images.Count)
  $offset=6+16*$images.Count
  foreach($item in $images){
    $dimension=if($item.Size -eq 256){0}else{$item.Size}
    $writer.Write([byte]$dimension);$writer.Write([byte]$dimension);$writer.Write([uint16]0)
    $writer.Write([uint16]1);$writer.Write([uint16]32);$writer.Write([uint32]$item.Bytes.Length);$writer.Write([uint32]$offset)
    $offset+=$item.Bytes.Length
  }
  foreach($item in $images){$writer.Write([byte[]]$item.Bytes)}
} finally {$writer.Dispose();$stream.Dispose()}
$compiler=Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
& $compiler /nologo /target:winexe /platform:anycpu /reference:System.Windows.Forms.dll ('/win32icon:'+$iconPath) ('/out:'+(Join-Path $root 'DWB MCP Studio.exe')) (Join-Path $PSScriptRoot 'launcher.cs')
if($LASTEXITCODE -ne 0){throw 'N3zuui launcher compilation failed.'}
