$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing

$root=Split-Path -Parent $PSScriptRoot
$assets=Join-Path $root 'assets'
$selectedPrismSource=Join-Path $assets 'n3zuui-prism-generated.png'

function New-Brush([Drawing.RectangleF]$Rect,[Drawing.Color]$Start,[Drawing.Color]$End) {
  return [System.Drawing.Drawing2D.LinearGradientBrush]::new($Rect,$Start,$End,0)
}

function Save-Png([string]$Path,[int]$Width,[int]$Height,[scriptblock]$Draw) {
  $bitmap=[Drawing.Bitmap]::new($Width,$Height,[Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint=[System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    & $Draw $graphics $Width $Height
    $bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose();$bitmap.Dispose()
  }
}

function Draw-PrismMark($g,[float]$Scale,[float]$OffsetX,[float]$OffsetY) {
  $state=$g.Save()
  try {
    $g.Transform=[Drawing.Drawing2D.Matrix]::new($Scale,0,0,$Scale,$OffsetX,$OffsetY)
    $nRect=[Drawing.RectangleF]::new(150,150,520,700)
    $threeRect=[Drawing.RectangleF]::new(560,150,350,700)
    $bodyRect=[Drawing.RectangleF]::new(150,150,760,700)
    $nBrush=New-Brush $nRect ([Drawing.Color]::FromArgb(238,4,44,74)) ([Drawing.Color]::FromArgb(238,12,18,48))
    $threeBrush=New-Brush $threeRect ([Drawing.Color]::FromArgb(238,22,15,56)) ([Drawing.Color]::FromArgb(238,52,12,86))
    $nEdge=New-Brush $nRect ([Drawing.Color]::FromArgb(255,0,239,255)) ([Drawing.Color]::FromArgb(255,52,155,255))
    $threeEdge=New-Brush $threeRect ([Drawing.Color]::FromArgb(255,80,160,255)) ([Drawing.Color]::FromArgb(255,180,84,255))
    $nGlow=New-Brush $nRect ([Drawing.Color]::FromArgb(74,0,239,255)) ([Drawing.Color]::FromArgb(74,52,155,255))
    $threeGlow=New-Brush $threeRect ([Drawing.Color]::FromArgb(74,80,160,255)) ([Drawing.Color]::FromArgb(74,180,84,255))
    $connectorGlow=New-Brush $bodyRect ([Drawing.Color]::FromArgb(74,0,239,255)) ([Drawing.Color]::FromArgb(74,180,84,255))
    $whiteSolid=[Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(240,235,251,255))

    $nPath=[Drawing.Drawing2D.GraphicsPath]::new()
    $nPath.StartFigure()
    $nPath.AddLine(175,780,175,210)
    $nPath.AddLine(300,210,500,485)
    $nPath.AddLine(500,210,610,210)
    $nPath.AddLine(610,780,490,780)
    $nPath.AddLine(300,520,300,780)
    $nPath.CloseFigure()

    $threePath=[Drawing.Drawing2D.GraphicsPath]::new()
    $threePath.StartFigure()
    $threePath.AddLine(595,210,755,210)
    $threePath.AddBezier(755,210,815,210,850,240,850,295)
    $threePath.AddLine(850,295,850,325)
    $threePath.AddBezier(850,325,850,375,822,410,785,430)
    $threePath.AddBezier(785,430,822,450,850,485,850,535)
    $threePath.AddLine(850,535,850,695)
    $threePath.AddBezier(850,695,850,750,815,780,755,780)
    $threePath.AddLine(755,780,595,780)
    $threePath.AddLine(595,780,595,650)
    $threePath.AddLine(595,650,730,650)
    $threePath.AddBezier(770,615,770,638,752,650,730,650)
    $threePath.AddLine(730,505,770,540)
    $threePath.AddBezier(770,540,770,518,752,505,730,505)
    $threePath.AddLine(730,505,650,505)
    $threePath.AddLine(650,505,650,385)
    $threePath.AddLine(650,385,730,385)
    $threePath.AddBezier(730,385,752,385,770,372,770,350)
    $threePath.AddLine(770,350,770,345)
    $threePath.AddBezier(770,345,770,323,752,315,730,315)
    $threePath.AddLine(730,315,595,315)
    $threePath.CloseFigure()

    foreach($pathAndBrush in @(@($nPath,$nBrush,$nGlow,$nEdge),@($threePath,$threeBrush,$threeGlow,$threeEdge))) {
      $path=$pathAndBrush[0]; $fill=$pathAndBrush[1]; $glow=$pathAndBrush[2]; $edgeBrush=$pathAndBrush[3]
      $g.FillPath($fill,$path)
      $wide=[Drawing.Pen]::new($glow,38); $wide.LineJoin=[Drawing.Drawing2D.LineJoin]::Round
      $g.DrawPath($wide,$path); $wide.Dispose()
      $edge=[Drawing.Pen]::new($edgeBrush,10); $edge.LineJoin=[Drawing.Drawing2D.LineJoin]::Round
      $g.DrawPath($edge,$path); $edge.Dispose()
    }

    $connector=[Drawing.Drawing2D.GraphicsPath]::new()
    $connector.StartFigure(); $connector.AddLine(492,485,650,485)
    $connectorPen=[Drawing.Pen]::new($connectorGlow,18); $connectorPen.StartCap=[Drawing.Drawing2D.LineCap]::Round; $connectorPen.EndCap=[Drawing.Drawing2D.LineCap]::Round
    $g.DrawPath($connectorPen,$connector); $connectorPen.Dispose()
    $g.FillEllipse($whiteSolid,552,462,46,46)
    $g.FillEllipse($whiteSolid,770,454,32,32)

    $nPath.Dispose();$threePath.Dispose();$connector.Dispose();$whiteSolid.Dispose();$connectorGlow.Dispose();$threeGlow.Dispose();$nGlow.Dispose();$threeEdge.Dispose();$nEdge.Dispose();$threeBrush.Dispose();$nBrush.Dispose()
  } finally {
    $g.Restore($state)
  }
}

$cyan=[Drawing.Color]::FromArgb(255,169,245,255)
$violet=[Drawing.Color]::FromArgb(255,185,167,255)
$white=[Drawing.Color]::FromArgb(255,234,251,255)
$fontFamily='Bahnschrift SemiBold'

$markPath=Join-Path $assets 'n3zuui-mark.png'
if(Test-Path -LiteralPath $selectedPrismSource) {
  Copy-Item -LiteralPath $selectedPrismSource -Destination $markPath -Force
} else {
  Save-Png $markPath 1024 1024 {
    param($g,$w,$h)
    Draw-PrismMark $g 1 0 0
  }.GetNewClosure()
}

Save-Png (Join-Path $assets 'n3zuui-logo.png') 1280 420 {
  param($g,$w,$h)
  Draw-PrismMark $g 0.38 22 4
  $wordFont=[Drawing.Font]::new($fontFamily,160,[Drawing.FontStyle]::Regular,[Drawing.GraphicsUnit]::Pixel)
  $wordRect=[Drawing.RectangleF]::new(410,104,800,220)
  $wordBrush=New-Brush $wordRect $white ([Drawing.Color]::FromArgb(255,0,239,255))
  $format=[Drawing.StringFormat]::GenericTypographic
  $format.Alignment=[Drawing.StringAlignment]::Center
  $format.LineAlignment=[Drawing.StringAlignment]::Center
  $g.DrawString('N3zuui',$wordFont,$wordBrush,$wordRect,$format)
  $wordBrush.Dispose();$wordFont.Dispose()
}.GetNewClosure()

Write-Output 'BRAND_ASSETS_PASS: generated the luminous N3zuui neon mark and wordmark PNG assets from deterministic vector geometry.'
