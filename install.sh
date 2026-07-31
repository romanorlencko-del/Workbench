#!/usr/bin/env bash
# Bench — установка на macOS/Linux: проверка Python + ярлык (Linux).
set -e
dir="$(cd "$(dirname "$0")" && pwd)"
echo "Bench — установка"

# 1) проверка Python 3
if command -v python3 >/dev/null 2>&1; then PY=python3
elif command -v python >/dev/null 2>&1; then PY=python
else
  echo "Python 3 не найден. Установите его: https://www.python.org/downloads/"
  exit 1
fi
ver="$("$PY" -c 'import sys;print("%d.%d" % sys.version_info[:2])')"
echo "Найден Python $ver ($PY)"

# 2) сделать запускалку исполняемой
chmod +x "$dir/run.sh" 2>/dev/null || true

# 3) ярлык приложения на Linux (freedesktop)
if [ -d "$HOME/.local/share" ]; then
  apps="$HOME/.local/share/applications"
  mkdir -p "$apps"
  cat > "$apps/workbench.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Bench
Comment=Конструктор конвейеров
Exec=$PY "$dir/serve.py"
Path=$dir
Terminal=true
Categories=Development;
EOF
  echo "Ярлык создан: $apps/workbench.desktop"
fi

echo ""
echo "Готово. Запуск:  ./run.sh    (или  $PY serve.py )"
echo "Откроется http://localhost:8791"
