#!/usr/bin/env python3
"""serve.py — единый запуск Bench: статика + сохранение планов + прокси движка.

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
Рядом, отдельным файлом projects/<id>.build.json, лежит состояние стройки: что
из плана уже построено в реальном коде. План остаётся переносимым замыслом,
стройка привязана к конкретному чекауту — поэтому файла два, а не один.
Секреты (ключи API) сюда НЕ попадают — их в плане нет, только имя env-переменной.
Только стандартная библиотека, без зависимостей.
"""
import os
import re
import sys
import json
import uuid
import time
import socket
import string
import functools
import collections
import threading
import subprocess
import urllib.parse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

import chat_proxy   # лежит в той же папке

# Обычный запуск: статика и папка проектов лежат рядом со скриптом. Сборка
# PyInstaller (--onefile): статика распакована во временный _MEIPASS, но планы
# надо писать РЯДОМ с .exe, а не во временную папку, иначе они пропадут.
if getattr(sys, "frozen", False):
    ROOT = sys._MEIPASS                               # распакованная статика (index.html, css, js)
    BASE = os.path.dirname(sys.executable)            # рядом с .exe — сюда пишем планы
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
BUILD_SUFFIX = ".build.json"                    # состояние стройки — соседний файл того же проекта
CHECK_SUFFIX = ".checklist.json"                # отметки чек-листа — тоже рядом, но НЕ в плане:
#                                                 готовый проект выгружается без чек-листа


def _safe_path(pid, suffix):
    """Безопасный путь projects/<pid><suffix> или None, если id не проходит проверку/выходит из папки."""
    if not pid or not ID_RE.fullmatch(pid) or pid.upper() in WIN_RESERVED:
        return None
    path = os.path.join(PROJECTS_DIR, pid + suffix)
    # защита от обхода каталога: итоговый файл обязан лежать прямо внутри PROJECTS_DIR
    if os.path.dirname(os.path.abspath(path)) != os.path.abspath(PROJECTS_DIR):
        return None
    return path


def _project_path(pid):
    return _safe_path(pid, ".json")


def _build_path(pid):
    # точка в id запрещена регуляркой, поэтому planом нельзя перезаписать стройку и наоборот
    return _safe_path(pid, BUILD_SUFFIX)


def _check_path(pid):
    return _safe_path(pid, CHECK_SUFFIX)


MARKER = ".bench-project.json"     # метка в папке сборки: чья она
ERRORS = collections.deque(maxlen=50)   # последние отказы движка — доктору в браузер


def _note_error(where, msg):
    ERRORS.append("%s · %s: %s" % (time.strftime("%H:%M:%S"), where, str(msg)[:300]))


def _rev_of(plan):
    """meta.rev как целое, иначе None. Булев True тоже число — его не берём."""
    try:
        r = (plan.get("meta") or {}).get("rev")
    except AttributeError:
        return None
    if isinstance(r, bool) or not isinstance(r, (int, float)):
        return None
    return int(r)


def _slug(name):
    """Имя проекта -> имя папки. Кириллицу оставляем: Windows и Linux её держат,
       а человеку читать свои же папки. Режем только то, что ломает путь."""
    out = []
    for ch in (name or "").strip():
        if ch in '\\/:*?"<>|':
            continue
        out.append("-" if ch in " \t" else ch)
    s = "".join(out).strip(" .-")[:64] or "proekt"
    return "_" + s if s.upper() in WIN_RESERVED else s


def _is_dir(path):
    return bool(path) and os.path.isdir(path)


def _inside(root, path):
    """path лежит внутри root (или сам root). Пишем только туда, что человек выбрал."""
    try:
        r = os.path.abspath(root)
        p = os.path.abspath(path)
        return p == r or p.startswith(r + os.sep)
    except (OSError, ValueError):
        return False


def _read_marker(folder):
    try:
        with open(os.path.join(folder, MARKER), "r", encoding="utf-8") as f:
            got = json.load(f)
        return got.get("project_id") if isinstance(got, dict) else None
    except (OSError, ValueError):
        return None


def _pick_dir_native(start):
    """Нативный проводник. Отдельным процессом, а не в потоке сервера: tkinter
       в рабочем потоке ведёт себя непредсказуемо, а упавший диалог не должен
       уронить движок. Нет графической сессии (Docker, ssh) — честно говорим."""
    code = (
        "import sys\n"
        "try:\n"
        "    import tkinter as tk\n"
        "    from tkinter import filedialog\n"
        "except Exception:\n"
        "    print('@@NOGUI@@'); sys.exit(0)\n"
        "try:\n"
        "    r = tk.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
        "    p = filedialog.askdirectory(title='Папка, в которой будут собираться проекты',\n"
        "                                initialdir=sys.argv[1] or None, mustexist=False)\n"
        "    r.destroy()\n"
        "except Exception:\n"
        "    print('@@NOGUI@@'); sys.exit(0)\n"
        "print('@@PATH@@' + (p or ''))\n"
    )
    try:
        res = subprocess.run([sys.executable, "-c", code, start or ""],
                             capture_output=True, text=True, timeout=300)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, "диалог не открылся: %s" % e
    out = (res.stdout or "").strip().splitlines()
    tail = out[-1] if out else ""
    if tail.startswith("@@NOGUI@@"):
        return None, "nogui"
    if tail.startswith("@@PATH@@"):
        return tail[len("@@PATH@@"):].strip(), None
    return None, "диалог вернул неожиданное: %s" % (tail[:120] or "пусто")


AUTOSTART_NAME = "Bench.vbs" if os.name == "nt" else "bench.desktop"


def _autostart_dir():
    """Папка автозагрузки текущего пользователя. Прав администратора не нужно,
       и человек может удалить файл руками — это и будет выключением."""
    if os.name == "nt":
        base = os.environ.get("APPDATA")
        return os.path.join(base, "Microsoft", "Windows", "Start Menu", "Programs", "Startup") if base else None
    if sys.platform.startswith("linux"):
        return os.path.join(os.path.expanduser("~"), ".config", "autostart")
    return None                                    # macOS и прочее — честно скажем «не умею»


def _autostart_file():
    d = _autostart_dir()
    return os.path.join(d, AUTOSTART_NAME) if d else None


def _run_command():
    """Чем поднимать движок. Путь берём у самих себя, а не угадываем: копий
       конструктора на машине может быть несколько (исходник, канон, .exe).
       На Windows зовём pythonw — иначе при каждом входе висело бы чёрное окно."""
    if getattr(sys, "frozen", False):
        return [sys.executable], os.path.dirname(sys.executable)
    exe = sys.executable
    if os.name == "nt":
        w = os.path.join(os.path.dirname(exe), "pythonw.exe")
        if os.path.exists(w):
            exe = w
    here = os.path.abspath(__file__)
    return [exe, here], os.path.dirname(here)


def _autostart_state():
    path, (cmd, cwd) = _autostart_file(), _run_command()
    on, open_browser = bool(path and os.path.exists(path)), False
    if on:
        txt = ""
        for enc in ("utf-16", "utf-8-sig"):        # .vbs пишем в utf-16, .desktop в utf-8
            try:
                with open(path, "r", encoding=enc) as f:
                    txt = f.read()
                break
            except (OSError, UnicodeError):
                continue
        open_browser = ('"TESTER_OPEN") = "1"' in txt) or ("TESTER_OPEN=1" in txt)
    return {"supported": bool(path), "on": on, "path": path, "dir": _autostart_dir(),
            "command": " ".join(cmd), "cwd": cwd, "open_browser": open_browser,
            "frozen": bool(getattr(sys, "frozen", False))}


def _autostart_write(open_browser):
    """Кладём запускатель в автозагрузку. На Windows это .vbs, а не .cmd: .cmd
       на секунду показал бы консольное окно при каждом входе в систему."""
    path = _autostart_file()
    if not path:
        return None, "автозапуск умеем только на Windows и Linux"
    cmd, cwd = _run_command()
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.name == "nt":
            # в VBS кавычка внутри строки удваивается: получаем "путь" "аргумент"
            run_arg = '"%s"' % " ".join('""%s""' % c for c in cmd)
            body = ("' Автозапуск Bench. Файл создан самим движком: кнопка «✦ ИИ» -> «Движок».\n"
                    "' Удалить можно прямо отсюда — автозапуск на этом и выключится.\n"
                    'Set s = CreateObject("WScript.Shell")\n'
                    # .Item(...) явно: присваивание через скобки VBScript трактует неоднозначно
                    's.Environment("Process").Item("TESTER_OPEN") = "%s"\n'
                    's.CurrentDirectory = "%s"\n'
                    "s.Run %s, 0, False\n" % ("1" if open_browser else "0", cwd, run_arg))
            # ТОЛЬКО UTF-16LE. От UTF-8 BOM движок скриптов падает на первом же
            # символе («недопустимый символ», строка 1) — и падает МОЛЧА, потому
            # что при входе в систему консоли нет. Проверено вживую.
            with open(path, "w", encoding="utf-16") as f:
                f.write(body)
        else:
            body = ("[Desktop Entry]\nType=Application\nName=Bench\n"
                    "Comment=Конструктор конвейеров\n"
                    "Exec=env TESTER_OPEN=%s %s\nX-GNOME-Autostart-enabled=true\n"
                    % ("1" if open_browser else "0", " ".join(cmd)))
            with open(path, "w", encoding="utf-8") as f:
                f.write(body)
        return path, None
    except OSError as e:
        return None, str(e)


def _autostart_remove():
    path = _autostart_file()
    if not path:
        return "автозапуск здесь не поддержан"
    try:
        os.remove(path)
    except FileNotFoundError:
        pass                                       # уже выключен — это не ошибка
    except OSError as e:
        return str(e)
    return None


class Handler(SimpleHTTPRequestHandler):
    """Статика как раньше + /api для сохранения планов на диск."""

    timeout = 30   # зависшее соединение не держит поток вечно

    def _json(self, code, obj):
        if code >= 400:      # свои же отказы копим для доктора, а не только отвечаем ими
            _note_error(self.path.split("?", 1)[0], (obj or {}).get("error") or code)
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _tail(self, prefix):
        # /api/<что-то>/<id>[?...] → голый id
        return self.path.split(prefix, 1)[1].split("?", 1)[0].strip("/")

    @staticmethod
    def _read_json(path):
        """(объект, mtime) или None. Отсутствие файла — норма (стройки может не быть),
           а вот битый/нечитаемый пропускаем НЕ молча: иначе проект «исчезает» без следа."""
        if not path:
            return None
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f), os.path.getmtime(path)
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as e:
            print("warn: пропускаю нечитаемый файл %s: %s" % (os.path.basename(path), e),
                  file=sys.stderr)
            return None

    def _state(self):
        """Все планы с диска (+ состояние стройки рядом) — браузер подхватывает их при загрузке."""
        out = []
        try:
            names = sorted(os.listdir(PROJECTS_DIR))
        except OSError:
            names = []
        for fn in names:
            if not fn.endswith(".json") or fn.endswith(BUILD_SUFFIX) or fn.endswith(CHECK_SUFFIX):
                continue                        # стройка и чек-лист — не планы: приедут сбоку, со своим планом
            got = self._read_json(os.path.join(PROJECTS_DIR, fn))
            if not got or not isinstance(got[0], dict):
                continue
            pid = fn[:-5]
            item = {"id": pid, "name": got[0].get("name"), "mtime": got[1], "plan": got[0]}
            build = self._read_json(_build_path(pid))
            if build and isinstance(build[0], dict):
                item["build"], item["buildMtime"] = build[0], build[1]
            check = self._read_json(_check_path(pid))
            if check and isinstance(check[0], dict):
                item["checklist"], item["checklistMtime"] = check[0], check[1]
            out.append(item)
        self._json(200, {"projects": out})

    def _put(self, path, ok, complaint):
        """Общая запись JSON: тело → проверка формы → атомарная замена файла."""
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
            data = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeDecodeError, RecursionError) as e:
            return self._json(400, {"error": "не JSON: %s" % e})
        if not ok(data):
            return self._json(400, {"error": complaint})
        # защита от затирания более свежей копии: браузер шлёт X-Prev-Mtime (что он видел
        # при загрузке); если на диске уже новее — не пишем, отдаём 409 + свежее на слияние
        prev = self.headers.get("X-Prev-Mtime")
        if prev:
            try:
                prev_ms = float(prev)
            except ValueError:
                prev_ms = None
            if prev_ms is not None and os.path.exists(path) and os.path.getmtime(path) > prev_ms + 0.001:
                fresh = self._read_json(path)
                if fresh:
                    return self._json(409, {"error": "на диске более свежая версия",
                                            "mtime": fresh[1], "data": fresh[0]})
                # свежую прочитать не смогли — падаем в обычную запись
        # Второй рубеж — РЕВИЗИЯ. Метка времени защищает лишь того, кто файл уже
        # видел: вкладка со старой копией в localStorage приходит с ВЕРНОЙ меткой
        # (её проставил подхват при загрузке) и честно затирает более новый план.
        # Ревизия назад не ходит — поэтому откат ловится и там, где метка совпала.
        rev = _rev_of(data)
        if rev is not None and os.path.exists(path):
            fresh = self._read_json(path)
            disk_rev = _rev_of(fresh[0]) if fresh else None
            if disk_rev is not None and disk_rev > rev:
                _note_error("откат плана отбит", "%s: ревизия %s < %s на диске"
                            % (os.path.basename(path), rev, disk_rev))
                return self._json(409, {"error": "на диске более поздняя ревизия плана: %s (у вас %s)"
                                                 % (disk_rev, rev),
                                        "mtime": fresh[1], "data": fresh[0]})
        os.makedirs(PROJECTS_DIR, exist_ok=True)
        tmp = "%s.%s.tmp" % (path, uuid.uuid4().hex)   # уникальный tmp: две вкладки не бьют друг друга
        try:
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)  # человеко-/git-читаемо
            os.replace(tmp, path)               # атомарная замена — файл не бьётся при сбое
        except OSError as e:
            try:
                os.remove(tmp)                  # не оставляем мусор от неудачной записи
            except OSError:
                pass
            return self._json(500, {"error": "не записалось: %s" % e})
        self._json(200, {"ok": True, "mtime": os.path.getmtime(path)})

    def _save(self):
        self._put(_project_path(self._tail("/api/project/")),
                  lambda d: isinstance(d, dict) and isinstance(d.get("nodes"), list),
                  "не похоже на план Bench (нет массива nodes)")

    def _save_build(self):
        # у стройки nodes — объект (id узла → запись), у плана массив: перепутать нельзя
        self._put(_build_path(self._tail("/api/build/")),
                  lambda d: isinstance(d, dict) and isinstance(d.get("nodes"), dict),
                  "не похоже на состояние стройки (нет объекта nodes)")

    def _save_check(self):
        # у чек-листа items — объект (id пункта → отметка): с планом и стройкой не спутать
        self._put(_check_path(self._tail("/api/checklist/")),
                  lambda d: isinstance(d, dict) and isinstance(d.get("items"), dict),
                  "не похоже на отметки чек-листа (нет объекта items)")

    def _delete(self):
        pid = self._tail("/api/project/")
        plan = _project_path(pid)
        if not plan:
            return self._json(400, {"error": "плохой id проекта"})
        for p in (plan, _build_path(pid), _check_path(pid)):      # стройка уходит вместе с планом, иначе воскреснет чужой
            try:
                os.remove(p)
            except FileNotFoundError:
                pass
            except OSError as e:
                return self._json(500, {"error": "не удалилось: %s" % e})
        self._json(200, {"ok": True})

    # ── папка сборок: где проекты превращаются в код ────────────────────────
    def _body(self, limit=1 << 20):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None
        if n <= 0 or n > limit:
            return None
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except (OSError, ValueError, UnicodeDecodeError):
            return None

    def _q(self, key):
        got = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get(key)
        return (got or [""])[0]

    def _fs(self):
        """Обзор дерева для выбора корня. Пустой путь: на Windows — список дисков,
           иначе — домашняя папка. Читаем только имена подпапок, файлы не отдаём."""
        path = self._q("path")
        if not path:
            if os.name == "nt":
                drives = ["%s:\\" % d for d in string.ascii_uppercase if os.path.exists("%s:\\" % d)]
                return self._json(200, {"path": "", "parent": None,
                                        "dirs": [{"name": d, "path": d} for d in drives]})
            path = os.path.expanduser("~")
        path = os.path.abspath(path)
        if not _is_dir(path):
            return self._json(404, {"error": "нет такой папки"})
        try:
            dirs = [{"name": n, "path": os.path.join(path, n)}
                    for n in sorted(os.listdir(path), key=lambda s: s.lower())
                    if not n.startswith(".") and os.path.isdir(os.path.join(path, n))]
        except OSError as e:
            return self._json(403, {"error": "папка не читается: %s" % e})
        parent = os.path.dirname(path)
        self._json(200, {"path": path, "parent": None if parent == path else parent, "dirs": dirs})

    def _workspace(self):
        """Что уже лежит в корне сборок и чьё оно (по метке в папке)."""
        root = self._q("root")
        if not _is_dir(root):
            return self._json(404, {"error": "корень не найден", "root": root})
        root = os.path.abspath(root)
        try:
            folders = [{"name": n, "path": os.path.join(root, n),
                        "project_id": _read_marker(os.path.join(root, n))}
                       for n in sorted(os.listdir(root), key=lambda s: s.lower())
                       if not n.startswith(".") and os.path.isdir(os.path.join(root, n))]
        except OSError as e:
            return self._json(403, {"error": "корень не читается: %s" % e})
        self._json(200, {"root": root, "folders": folders})

    def _workspace_sync(self):
        """Разложить проекты по папкам внутри корня: существующие узнать, недостающие
           создать. Узнаём в два захода — сперва по метке (переживает переименование
           проекта), потом по имени папки. Подобранной папке метку тоже ставим."""
        data = self._body()
        if not isinstance(data, dict):
            return self._json(400, {"error": "ожидаю {root, projects:[{id,name}]}"})
        root = data.get("root")
        if not _is_dir(root):
            return self._json(404, {"error": "корень не найден", "root": root})
        root = os.path.abspath(root)
        projects = [p for p in (data.get("projects") or [])
                    if isinstance(p, dict) and p.get("id") and ID_RE.fullmatch(str(p["id"]))]
        by_marker, by_name = {}, {}
        try:
            for n in os.listdir(root):
                full = os.path.join(root, n)
                if not os.path.isdir(full):
                    continue
                by_name[n.lower()] = full
                pid = _read_marker(full)
                if pid:
                    by_marker[pid] = full
        except OSError as e:
            return self._json(403, {"error": "корень не читается: %s" % e})
        mapping, created, adopted, failed = {}, [], [], []
        for p in projects:
            pid, nm = str(p["id"]), p.get("name") or ""
            folder, fresh = by_marker.get(pid) or by_name.get(_slug(nm).lower()), False
            if not folder:
                folder = os.path.join(root, _slug(nm))
                try:
                    os.makedirs(folder, exist_ok=True)
                    fresh = True
                except OSError as e:
                    failed.append({"id": pid, "error": str(e)})
                    continue
            if not _inside(root, folder):        # писать соглашаемся только внутрь выбранного корня
                failed.append({"id": pid, "error": "папка вне корня"})
                continue
            try:
                with open(os.path.join(folder, MARKER), "w", encoding="utf-8") as f:
                    json.dump({"project_id": pid, "name": nm}, f, ensure_ascii=False, indent=2)
            except OSError:
                pass                              # метка — удобство, а не условие работы
            mapping[pid] = folder
            (created if fresh else adopted).append({"id": pid, "path": folder})
        self._json(200, {"root": root, "map": mapping,
                         "created": created, "adopted": adopted, "failed": failed})

    def _pickdir(self):
        path, err = _pick_dir_native((self._body() or {}).get("start") or "")
        if err == "nogui":
            return self._json(501, {"error": "nogui",
                                    "hint": "у движка нет графической сессии — выбери папку обзором или впиши путь"})
        if err:
            return self._json(500, {"error": err})
        self._json(200, {"path": path or "", "cancelled": not path})

    def _doctor(self):
        """Сводка о движке для доктора в браузере: пишется ли диск, жив ли прокси,
           что на мосту и на что движок ругался. Раньше всё это жило в stderr
           того окна, где запущен движок, и до человека не доходило."""
        writable, probe = False, os.path.join(PROJECTS_DIR, ".write-probe")
        try:
            os.makedirs(PROJECTS_DIR, exist_ok=True)
            with open(probe, "w", encoding="utf-8") as f:
                f.write("ok")
            os.remove(probe)
            writable = True
        except OSError as e:
            _note_error("папка планов", e)
        try:
            count = len([n for n in os.listdir(PROJECTS_DIR)
                         if n.endswith(".json") and not n.endswith(BUILD_SUFFIX)])
        except OSError:
            count = 0
        # живость прокси меряем сокетом, а не состоянием модуля: поток мог умереть,
        # а переменные остаться на месте и врать, что всё хорошо
        alive = False
        try:
            with socket.create_connection(("127.0.0.1", chat_proxy.PORT), 0.4):
                alive = True
        except OSError:
            pass
        try:
            bridge = chat_proxy.bridge_stats()
        except Exception as e:                      # noqa: BLE001 — доктор не должен падать сам
            bridge = {"error": str(e)}
        self._json(200, {
            "ok": True,
            "python": sys.version.split()[0],
            "platform": sys.platform,
            "projects": {"dir": PROJECTS_DIR, "writable": writable, "count": count},
            "proxy": {"port": chat_proxy.PORT, "alive": alive},
            "bridge": bridge,
            "errors": list(ERRORS),
        })

    def _autostart_get(self):
        self._json(200, _autostart_state())

    def _autostart_post(self):
        data = self._body() or {}
        if data.get("on"):
            path, err = _autostart_write(bool(data.get("open_browser")))
            if err:
                return self._json(500, {"error": "не включилось: %s" % err})
        else:
            err = _autostart_remove()
            if err:
                return self._json(500, {"error": "не выключилось: %s" % err})
        self._json(200, _autostart_state())

    def _restart(self):
        """Поднять свежий процесс и уйти. Нужно после обновления кода: иначе
           движок держит старую версию до ручного перезапуска. Новый процесс
           ждёт освобождения порта — старый отпускает его, только когда умрёт."""
        cmd, cwd = _run_command()
        self._json(200, {"ok": True, "command": " ".join(cmd)})
        try:
            self.wfile.flush()                     # ответ должен уйти ДО нашей смерти
        except OSError:
            pass

        def go():
            time.sleep(0.4)
            env = dict(os.environ, TESTER_WAIT_PORT="1")
            kw = {"cwd": cwd, "env": env, "close_fds": True}
            if os.name == "nt":
                kw["creationflags"] = 0x00000008 | 0x00000200   # DETACHED_PROCESS | NEW_PROCESS_GROUP
            else:
                kw["start_new_session"] = True
            try:
                subprocess.Popen(cmd, **kw)
            except OSError as e:
                _note_error("перезапуск", e)
                return
            os._exit(0)

        threading.Thread(target=go, name="restart", daemon=True).start()

    def do_GET(self):
        head = self.path.split("?", 1)[0]
        if head == "/api/state":
            return self._state()
        if head == "/api/doctor":
            return self._doctor()
        if head == "/api/autostart":
            return self._autostart_get()
        if head == "/api/fs":
            return self._fs()
        if head == "/api/workspace":
            return self._workspace()
        return super().do_GET()

    def do_POST(self):
        head = self.path.split("?", 1)[0]
        if head == "/api/autostart":
            return self._autostart_post()
        if head == "/api/restart":
            return self._restart()
        if head == "/api/workspace":
            return self._workspace_sync()
        if head == "/api/pickdir":
            return self._pickdir()
        self._json(404, {"error": "нет такого пути"})

    def do_PUT(self):
        if self.path.startswith("/api/project/"):
            return self._save()
        if self.path.startswith("/api/build/"):
            return self._save_build()
        if self.path.startswith("/api/checklist/"):
            return self._save_check()
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
    handler = functools.partial(Handler, directory=ROOT)
    # при перезапуске из интерфейса порт ещё держит умирающий предшественник —
    # тогда ждём его, а не сдаёмся с советом про «другую копию»
    tries = 24 if os.environ.get("TESTER_WAIT_PORT") == "1" else 1
    httpd = None
    for i in range(tries):
        try:
            httpd = ThreadingHTTPServer((BIND, PORT), handler)
            break
        except OSError as e:
            if i < tries - 1:
                time.sleep(0.5)
                continue
            print("Не удалось занять %s:%d — %s" % (BIND, PORT, e), file=sys.stderr)
            print("Похоже, порт уже занят (другая копия Bench?). Закройте её или задайте "
                  "другой порт:  TESTER_PORT=8890 py serve.py", file=sys.stderr)
            sys.exit(1)

    # прокси поднимаем ПОСЛЕ основного порта: при перезапуске оба освобождаются
    # не одновременно, а так к моменту старта прокси предшественник уже мёртв
    threading.Thread(target=chat_proxy.run, name="chat-proxy", daemon=True).start()

    if BIND not in ("127.0.0.1", "localhost"):
        print("ВНИМАНИЕ: сервер слушает %s — доступен из сети. Любой в этой сети сможет "
              "читать, менять и удалять ваши планы." % BIND, file=sys.stderr)
    shown = "localhost" if BIND in ("127.0.0.1", "localhost") else BIND
    print("Bench: http://%s:%d   (планы в %s/, + прокси движка на :%d)"
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
