# Workbench — установка на Windows: проверка Python + ярлык на рабочем столе.
# Запуск:  правый клик → «Выполнить с помощью PowerShell», либо  py -3 -m ... ; либо:
#          powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
Write-Host "Workbench — установка" -ForegroundColor Cyan

# 1) проверка Python 3
$py = $null
foreach ($c in 'py', 'python') { if (Get-Command $c -ErrorAction SilentlyContinue) { $py = $c; break } }
if (-not $py) {
  Write-Host "Python 3 не найден. Установите с https://www.python.org/downloads/" -ForegroundColor Red
  Write-Host "(галочка 'Add Python to PATH'), затем запустите install.ps1 снова." -ForegroundColor Red
  exit 1
}
$ver = & $py -c "import sys;print('%d.%d' % sys.version_info[:2])"
Write-Host "Найден Python $ver ($py)" -ForegroundColor Green

# 2) ярлык на рабочем столе
try {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnk = Join-Path $desktop 'Workbench.lnk'
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = (Get-Command $py).Source
  $s.Arguments = 'serve.py'
  $s.WorkingDirectory = $dir
  $s.IconLocation = "$env:SystemRoot\System32\shell32.dll,13"
  $s.Description = 'Workbench — конструктор конвейеров'
  $s.Save()
  Write-Host "Ярлык создан: $lnk" -ForegroundColor Green
} catch {
  Write-Host "Ярлык создать не удалось ($($_.Exception.Message)). Не страшно — есть run.bat." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Готово. Запуск: двойной клик по ярлыку «Workbench», либо run.bat, либо:" -ForegroundColor Green
Write-Host "    $py serve.py"
Write-Host "Откроется http://localhost:8791"
