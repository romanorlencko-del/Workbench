#!/usr/bin/env python3
"""serve.py — единый запуск Workbench: статика + сохранение планов + прокси движка.

Поднимает статический сервер конструктора (порт TESTER_PORT, по умолчанию 8791),
принимает автосохранение планов на диск (папка projects/, эндпоинты /api/*) и
авто-стартует эгресс-прокси chat_proxy.py в фоновом потоке (порт
TESTER_PROXY_PORT, по умолчанию 8792). Одна команда — всё сразу:

    py serve.py            (Windows)
    python3 serve.py       (WSL / Linux)

Безопасность: по умолчанию слушаем ТОЛЬКО 127.0.0.1 (эта машина). Чтобы открыть
доступ по сети — переменная TESTER_BIND (например 0.0.0.0), тогда сервер громко
предупредит: читать/менять/удалять планы сможет любой в этой сети.

Планы пишутся браузером в projects/<id>.json на каждом автосейве, поэтому ручные
правки в дашборде переживают перезагрузку и не требуют отдельного «Экспорта».
Секреты (ключи API) сюда НЕ попадают — их в плане нет, только имя env-переменной.
Только стандартная библиотека, без зависимостей.
"""
import os
import re
import sys
import json
import uuid
import functools
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import chat_proxy   # лежит в той же папке

# Обычный запуск: статика и папка проектов лежат рядом со скриптом. Сборка
# PyInstaller (--onefile): статика распакована во временный _MEIPASS, но планы
# надо писать РЯДОМ с .exe, а не во временную папку, иначе они пропадут.
if getattr(sys, "frozen", False):
    ROOT = sys._MEIPASS                               # распакованная статика (index.html, css, js)
    BASE = os.path.dirname(sys.executable)            # рядом с Workbench.exe — сюда пишем планы
else:
    ROOT = os.path.dirname(os.path.abspath(__file__))
    BASE = ROOT
PORT = int(os.environ.get("TESTER_PORT", "8791"))
BIND = os.environ.get("TESTER_BIND", "127.0.0.1")     # по умолчанию — только эта машина
PROJECTS_DIR = os.path.join(BASE, "projects")
ID_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")     # id проекта: p_ + base36; строго, без путевых символов
# зарезервированные имена устройств Windows — негодны как имена файлов
WIN_RESERVED = ({"CON", "PRN", "AUX", "NUL"}
                | {"COM%d" % i for i in range(1, 10)}
                | {"LPT%d" % i for i in range(1, 10)})
MAX_BODY = 8 * 1024 * 1024                      # потолок на план — 8 МБ, чтобы не раздуть память


def _project_path(pid):
    """Безопасный путь projects/<pid>.json или None, если id не проходит проверку/выходит из папки."""
    if not pid or not ID_RE.fullmatch(pid) or pid.upper() in WIN_RESERVED:
        return None
    path = os.path.join(PROJECTS_DIR, pid + ".json")
    # защита от обхода каталога: итоговый файл обязан лежать прямо внутри PROJECTS_DIR
    if os.path.dirname(os.path.abspath(path)) != os.path.abspath(PROJECTS_DIR):
        return None
    return path


class Handler(SimpleHTTPRequestHandler):
    """Статика как раньше + /api для сохранения планов на диск."""

    timeout = 30   # зависшее соединение не держит поток вечно

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _pid_path(self):
        # /api/project/<id>[?...] → безопасный путь или None
        tail = self.path.split("/api/project/", 1)[1]
        return _project_path(tail.split("?", 1)[0].strip("/"))

    def _state(self):
        """Все планы с диска — браузер подхватывает их при загрузке."""
        out = []
        try:
            names = sorted(os.listdir(PROJECTS_DIR))
        except OSError:
            names = []
        for fn in names:
            if not fn.endswith(".json"):
                continue
            path = os.path.join(PROJECTS_DIR, fn)
            try:
                with open(path, "r", encoding="utf-8") as f:
                    plan = json.load(f)
                mtime = os.path.getmtime(path)
            except (OSError, ValueError) as e:
                # битый/нечитаемый файл пропускаем, но НЕ молча — иначе проект «исчезает» без следа
                print("warn: пропускаю нечитаемый проект %s: %s" % (fn, e), file=sys.stderr)
                continue
            if isinstance(plan, dict):
                out.append({"id": fn[:-5], "name": plan.get("name"), "mtime": mtime, "plan": plan})
        self._json(200, {"projects": out})

    def _save(self):
        path = self._pid_path()
        if not path:
            return self._json(400, {"error": "плохой id проекта"})
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            return self._json(400, {"error": "плохой Content-Length"})
        if length <= 0 or length > MAX_BODY:
            return self._json(400, {"error": "пустое или слишком большое тело"})
        raw = self.rfile.read(length)
        try:
            plan = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError, RecursionError) as e:
            return self._json(400, {"error": "не JSON: %s" % e})
        if not isinstance(plan, dict) or not isinstance(plan.get("nodes"), list):
            return self._json(400, {"error": "не похоже на план Workbench (нет массива nodes)"})
        # защита от затирания более свежей копии: браузер шлёт X-Prev-Mtime (что он видел
        # при загрузке); если на диске уже новее — не пишем, отдаём 409 + свежий план на слияние
        prev = self.headers.get("X-Prev-Mtime")
        if prev:
            try:
                prev_ms = float(prev)
            except ValueError:
                prev_ms = None
            if prev_ms is not None and os.path.exists(path) and os.path.getmtime(path) > prev_ms + 0.001:
                try:
                    with open(path, "r", encoding="utf-8") as f:
                        disk = json.load(f)
                    return self._json(409, {"error": "на диске более свежая версия",
                                            "mtime": os.path.getmtime(path), "plan": disk})
                except (OSError, ValueError):
                    pass   # свежую прочитать не смогли — падаем в обычную запись
        os.makedirs(PROJECTS_DIR, exist_ok=True)
        tmp = "%s.%s.tmp" % (path, uuid.uuid4().hex)   # уникальный tmp: два таба не бьют друг друга
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(plan, f, ensure_ascii=False, indent=2)  # человеко-/git-читаемо
            os.replace(tmp, path)               # атомарная замена — файл не бьётся при сбое
        except OSError as e:
            try:
                os.remove(tmp)
            except OSError:
                pass
            return self._json(500, {"error": "не записалось: %s" % e})
        self._json(200, {"ok": True, "mtime": os.path.getmtime(path)})

    def _delete(self):
        path = self._pid_path()
        if not path:
            return self._json(400, {"error": "плохой id проекта"})
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
        except OSError as e:
            return self._json(500, {"error": "не удалилось: %s" % e})
        self._json(200, {"ok": True})

    def do_GET(self):
        if self.path.split("?", 1)[0] == "/api/state":
            return self._state()
        return super().do_GET()

    def do_PUT(self):
        if self.path.startswith("/api/project/"):
            return self._save()
        self._json(404, {"error": "нет такого пути"})

    def do_DELETE(self):
        if self.path.startswith("/api/project/"):
            return self._delete()
        self._json(404, {"error": "нет такого пути"})

    def log_message(self, *a):
        pass  # тихий лог, как у прокси


def main():
    os.makedirs(PROJECTS_DIR, exist_ok=True)

    # прокси движка должен пускать к себе только наш конструктор — по Origin.
    # serve.py знает порт статики, поэтому подставляет разрешённые origin'ы в прокси.
    allowed = os.environ.get("TESTER_ALLOWED_ORIGINS")   # для Docker/нестандартного хоста
    chat_proxy.ALLOWED_ORIGINS = ({o.strip() for o in allowed.split(",") if o.strip()} if allowed
                                  else {"http://localhost:%d" % PORT, "http://127.0.0.1:%d" % PORT})
    # прокси — в демон-потоке: гаснет вместе с конструктором
    threading.Thread(target=chat_proxy.run, name="chat-proxy", daemon=True).start()

    handler = functools.partial(Handler, directory=ROOT)
    try:
        httpd = ThreadingHTTPServer((BIND, PORT), handler)
    except OSError as e:
        print("Не удалось занять %s:%d — %s" % (BIND, PORT, e), file=sys.stderr)
        print("Похоже, порт уже занят (другая копия Workbench?). Закройте её или задайте "
              "другой порт:  TESTER_PORT=8890 py serve.py", file=sys.stderr)
        sys.exit(1)

    if BIND not in ("127.0.0.1", "localhost"):
        print("ВНИМАНИЕ: сервер слушает %s — доступен из сети. Любой в этой сети сможет "
              "читать, менять и удалять ваши планы." % BIND, file=sys.stderr)
    shown = "localhost" if BIND in ("127.0.0.1", "localhost") else BIND
    print("Workbench: http://%s:%d   (планы в %s/, + прокси движка на :%d)"
          % (shown, PORT, os.path.basename(PROJECTS_DIR), chat_proxy.PORT))
    # авто-открыть браузер (для установщика/двойного клика); TESTER_OPEN=0 отключает
    if os.environ.get("TESTER_OPEN", "1") != "0":
        import webbrowser
        threading.Timer(1.0, lambda: webbrowser.open("http://%s:%d" % (shown, PORT))).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
