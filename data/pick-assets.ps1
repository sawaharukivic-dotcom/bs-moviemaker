param(
  [Parameter(Mandatory=$true)][string]$Dir,
  [string]$Title = 'Select files (multiple OK)',
  [string]$Filter = 'Images|*.jpg;*.jpeg;*.png;*.webp'
)
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.OpenFileDialog
$f.Multiselect = $true
$f.Filter = $Filter
$f.Title = $Title
if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  New-Item -ItemType Directory -Force $Dir | Out-Null
  foreach ($p in $f.FileNames) {
    Copy-Item $p $Dir -Force
    'copied: ' + (Split-Path $p -Leaf)
  }
} else {
  'cancelled'
}
