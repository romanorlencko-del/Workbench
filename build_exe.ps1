# Локальная сборка Windows .exe (нужен pip и интернет для установки pyinstaller).
# Результат: dist\Workbench.exe — самодостаточный, Python пользователю не нужен.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

Write-Host "Ставлю PyInstaller (если ещё нет)…" -ForegroundColor Cyan
py -m pip install --upgrade pyinstaller

Write-Host "Собираю Workbench.exe…" -ForegroundColor Cyan
py -m PyInstaller --noconfirm --onefile --name Workbench `
  --hidden-import chat_proxy `
  --add-data "index.html;." `
  --add-data "AI_GUIDE.md;." `
  --add-data "css;css" `
  --add-data "js;js" `
  serve.py

Write-Host ""
Write-Host "Готово: dist\Workbench.exe" -ForegroundColor Green
Write-Host "Положите .exe куда угодно и запустите — планы сохранятся в папку projects\ рядом с ним."
