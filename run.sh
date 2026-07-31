#!/usr/bin/env bash
# Bench — запуск (нужен Python 3).
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 serve.py
elif command -v python >/dev/null 2>&1; then
  exec python serve.py
else
  echo "Python 3 не найден. Установите его: https://www.python.org/downloads/"
  exit 1
fi
