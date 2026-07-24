param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot "..\assets\images\cues")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null

$cues = @(
  @{ File = "cue-charge-start.png"; Text = "CHARGE!"; Accent = [Drawing.Color]::FromArgb(255, 54, 210, 255) },
  @{ File = "cue-stance.png"; Text = "READY!"; Accent = [Drawing.Color]::FromArgb(255, 92, 196, 255) },
  @{ File = "cue-stance-overcharge.png"; Text = "MAX READY!"; Accent = [Drawing.Color]::FromArgb(255, 255, 112, 42) },
  @{ File = "cue-punch.png"; Text = "STRIKE!"; Accent = [Drawing.Color]::FromArgb(255, 88, 220, 255) },
  @{ File = "cue-punch-overcharge.png"; Text = "FULL POWER!"; Accent = [Drawing.Color]::FromArgb(255, 255, 72, 28) }
)

foreach ($cue in $cues) {
  $bitmap = New-Object Drawing.Bitmap 1280, 720, ([Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [Drawing.Graphics]::FromImage($bitmap)
  try {
    $graphics.Clear([Drawing.Color]::Transparent)
    $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $fontSize = 190
    $fontStyle = [Drawing.FontStyle]::Bold -bor [Drawing.FontStyle]::Italic
    do {
      $font = New-Object Drawing.Font "Arial", $fontSize, $fontStyle, ([Drawing.GraphicsUnit]::Pixel)
      $measured = $graphics.MeasureString($cue.Text, $font)
      if ($measured.Width -le 1080 -and $measured.Height -le 310) {
        break
      }
      $font.Dispose()
      $fontSize -= 8
    } while ($fontSize -ge 96)

    try {
      $x = (1280 - $measured.Width) / 2
      $y = (720 - $measured.Height) / 2
      $shadowBrush = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb(180, $cue.Accent))
      $whiteBrush = New-Object Drawing.SolidBrush ([Drawing.Color]::White)
      try {
        $graphics.DrawString($cue.Text, $font, $shadowBrush, $x + 10, $y + 12)
        $graphics.DrawString($cue.Text, $font, $whiteBrush, $x, $y)
      } finally {
        $shadowBrush.Dispose()
        $whiteBrush.Dispose()
      }
    } finally {
      $font.Dispose()
    }

    $destination = Join-Path $outputPath $cue.File
    $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png)
    Write-Host "generated $destination"
  } finally {
    $graphics.Dispose()
    $bitmap.Dispose()
  }
}
