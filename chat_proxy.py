#!/usr/bin/env python3
"""chat_proxy.py — эгресс-прокси движка для чата Bench.

Зачем: облачные LLM-API (OpenAI/Anthropic/совместимые) не пускают браузер
напрямую (CORS). Браузер шлёт запрос сюда, на localhost; прокси форвардит его
на настоящего провайдера (адрес — в заголовке X-Upstream-Url) уже server-side,
без CORS, и возвращает ответ с CORS-заголовками. Ключ идёт браузер→localhost→
провайдер, третьим лицам не уходит.

Безопасность: к прокси пускаем только наш конструктор — по списку разрешённых
Origin (ALLOWED_ORIGINS; serve.py подставляет свой порт). Форвардим только на
http/https (иначе urllib открыл бы file:/// и отдал локальный файл). Мост
/bridge/* принимает лишь application/json — поэтому «простой» кросс-доменный
POST со стороннего сайта (text/plain, без preflight) туда не пролезет, а
preflight отсекается тем же списком Origin.

Только стандартная библиотека, без зависимостей. Слушает 127.0.0.1.
Запуск:  py chat_proxy.py            (Windows)
         python3 chat_proxy.py       (WSL / Linux, рядом с движком)
Порт:    переменная TESTER_PROXY_PORT (по умолчанию 8792).
Ключ:    браузер шлёт Authorization; либо заголовок X-Api-Key-Env — тогда
         прокси берёт ключ из своей переменной окружения с этим именем.
"""
import os
import json
import threading
import urllib.parse
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("TESTER_PROXY_PORT", "8792"))
TIMEOUT = float(os.environ.get("TESTER_PROXY_TIMEOUT", "180"))
MAX_BODY = 8 * 1024 * 1024            # потолок входящего тела (иначе память съедят)
MAX_RESPONSE = 32 * 1024 * 1024       # потолок ответа провайдера (X-Upstream-Url под контролем клиента)
ALLOW_HEADERS = "Content-Type, Authorization, X-Upstream-Url, X-Api-Key-Env, anthropic-version"
# кого пускаем. serve.py перезаписывает под свой реальный порт при старте
ALLOWED_ORIGINS = {"http://localhost:8791", "http://127.0.0.1:8791"}

# ── мост «приложение → конструктор» ─────────────────────────────────────────
# Cursor / Claude / Antigravity (через MCP-сервер, шаг 3) кладут операции правки
# плана на /bridge/ops; браузер-конструктор опрашивает /bridge/pull и применяет
# их. Обратно браузер шлёт текущий план на /bridge/plan, чтобы приложение видело
# актуальную карту (/bridge/plan GET). Состояние живёт в памяти процесса.
#
# Стройка ездит тем же мостом, но в другую сторону: конструктор кладёт ЗАДАНИЕ на
# блок (/bridge/task), приложение забирает его инструментом get_task, а отчёт шлёт
# обратно обычной операцией {"build":[…]} на /bridge/ops. Задание живёт до отчёта:
# приложение может перечитать его посреди работы.
#
# ПРОЕКТ В КАЖДОМ СООБЩЕНИИ. Проектов у человека несколько, а id блоков в них
# совпадают (agent_3 есть почти везде) — поэтому неподписанная операция может
# молча лечь не в тот план. Мост знает, какой проект сейчас открыт (его называет
# сам конструктор, присылая план), и операцию с ЧУЖИМ проектом отбивает 409, а
# неподписанную штампует текущим. Браузер потом проверяет ещё раз — две линии
# защиты, потому что вкладок может быть две и гонки настоящие.
_BRIDGE_MAX = 500
_TASK_MAX = 40
_bridge_lock = threading.Lock()
_bridge_ops = []                 # очередь операций: приложение → браузер
_bridge_plan = {"json": None, "project": None}   # последний план + чей он
_bridge_tasks = {}               # выданные задания: id блока → задание (порядок выдачи)


def _pid(v):
    """id проекта из чего угодно: строка, {'id':...} или None."""
    if isinstance(v, dict):
        v = v.get("id")
    return str(v) if v else None


class Proxy(BaseHTTPRequestHandler):

    timeout = 30   # зависшее соединение не держит поток вечно

    def _cors(self):
        # ACAO отдаём ТОЛЬКО разрешённым origin'ам — чужой сайт ответ не прочитает
        origin = self.headers.get("Origin", "")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", ALLOW_HEADERS)
        self.send_header("Access-Control-Max-Age", "600")

    def _json(self, code, obj):
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(obj).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _read_body(self):
        """Тело с потолком. None — тела нет; False — плохой Content-Length или превышен размер."""
        try:
            length = int(self.headers.get("Content-Length", "0") or 0)
        except ValueError:
            return False
        if length < 0 or length > MAX_BODY:
            return False
        return self.rfile.read(length) if length else None

    def _forward(self):
        """Переслать текущий запрос (GET/POST) на X-Upstream-Url. True — ответ
        записан; False — заголовка нет, пусть решает вызывающий."""
        upstream = (self.headers.get("X-Upstream-Url") or "").strip()
        if not upstream:
            return False
        # только http/https — иначе urllib честно откроет file:/// и отдаст локальный файл
        if urllib.parse.urlparse(upstream).scheme not in ("http", "https"):
            self._json(400, {"error": "X-Upstream-Url: разрешены только http/https"})
            return True

        payload = self._read_body()
        if payload is False:
            self._json(413, {"error": "тело слишком большое"})
            return True

        # авторизация: сперва проброс Authorization, иначе ключ из окружения прокси
        auth = self.headers.get("Authorization")
        if not auth:
            env = self.headers.get("X-Api-Key-Env")
            if env and os.environ.get(env):
                auth = "Bearer " + os.environ[env]

        headers = {}
        ct = self.headers.get("Content-Type")
        if ct:
            headers["Content-Type"] = ct
        if auth:
            headers["Authorization"] = auth
        av = self.headers.get("anthropic-version")
        if av:
            headers["anthropic-version"] = av

        req = urllib.request.Request(upstream, data=payload, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                body, status = r.read(MAX_RESPONSE), r.status
                rct = r.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            body, status = e.read(MAX_RESPONSE), e.code
            rct = e.headers.get("Content-Type", "application/json")
        except Exception as e:
            self._json(502, {"error": "не достучались до провайдера: %s" % e, "upstream": upstream})
            return True

        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", rct)
        self.end_headers()
        self.wfile.write(body)
        return True

    def _body_json(self):
        raw = self._read_body()
        if raw is False:
            return False
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return False  # тело было, но не JSON

    def _bridge_get(self):
        if self.path.startswith("/bridge/pull"):
            with _bridge_lock:
                ops = _bridge_ops[:]
                del _bridge_ops[:]
            return self._json(200, {"ops": ops})
        if self.path.startswith("/bridge/plan"):
            with _bridge_lock:
                plan, project = _bridge_plan["json"], _bridge_plan["project"]
            return self._json(200, {"plan": plan, "project": project})
        if self.path.startswith("/bridge/task"):
            # не вычищаем: исполнитель имеет право перечитать задание в середине работы.
            # Чужие проекты не показываем вовсе — нельзя взять работу не из той схемы.
            with _bridge_lock:
                project = _bridge_plan["project"]
                cur = _pid(project)
                tasks = [t for t in _bridge_tasks.values()
                         if not cur or not _pid(t.get("project")) or _pid(t.get("project")) == cur]
            return self._json(200, {"tasks": tasks, "project": project})
        self._json(404, {"error": "unknown bridge route", "path": self.path})

    def _bridge_post(self):
        # мост принимает только application/json: «простой» кросс-доменный POST
        # (text/plain, без preflight) со стороннего сайта так внутрь не пролезет
        ct = (self.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
        if ct != "application/json":
            return self._json(415, {"error": "мост принимает только application/json"})
        body = self._body_json()
        if body is False:
            return self._json(400, {"error": "тело не JSON или слишком большое"})
        if self.path.startswith("/bridge/ops"):
            if not isinstance(body, (dict, list)):
                return self._json(400, {"error": "нужен объект операций или список"})
            items = body if isinstance(body, list) else (body.get("ops") if "ops" in body else [body])
            claim = _pid(body.get("project")) if isinstance(body, dict) else None
            with _bridge_lock:
                project = _bridge_plan["project"]
                cur = _pid(project)
                if not cur:
                    return self._json(409, {"error": "конструктор ещё не представился: открой Bench "
                                                     "и включи «Сопряжение», тогда мост узнает проект"})
                if claim and claim != cur:
                    return self._json(409, {
                        "error": "операция для другого проекта — в конструкторе сейчас открыт «%s» (%s), "
                                 "а операция помечена %s. Перечитай план (get_plan) и повтори."
                                 % ((project or {}).get("name", "?"), cur, claim),
                        "current": project, "claimed": claim})
                # каждый элемент проверяем отдельно: список операций тоже несёт
                # подписи, и пропустить его целиком по одной внешней — та же дыра
                for it in items:
                    if not isinstance(it, dict):
                        continue
                    own = _pid(it.get("project"))
                    if own and own != cur:
                        return self._json(409, {
                            "error": "в пачке операция для другого проекта (%s), открыт %s — ничего не приняли"
                                     % (own, cur), "current": project})
                # неподписанные штампуем текущим: у браузера будет чем их проверить
                for it in items:
                    if isinstance(it, dict) and not _pid(it.get("project")):
                        it["project"] = cur
                _bridge_ops.extend(items)
                del _bridge_ops[:-_BRIDGE_MAX]  # не растём бесконечно, держим хвост
                pending = len(_bridge_ops)
            return self._json(200, {"ok": True, "queued": len(items), "pending": pending, "project": cur})
        if self.path.startswith("/bridge/plan"):
            # {project:{id,name,rev}, plan:{...}} — или голый план от старого клиента
            with _bridge_lock:
                if isinstance(body, dict) and "plan" in body:
                    _bridge_plan["json"] = body.get("plan")
                    _bridge_plan["project"] = body.get("project")
                else:
                    _bridge_plan["json"] = body
            return self._json(200, {"ok": True})
        if self.path.startswith("/bridge/task"):
            if not isinstance(body, dict) or not body.get("id"):
                return self._json(400, {"error": "нужен объект задания с id блока"})
            tid = str(body["id"])
            with _bridge_lock:
                cur = _pid(_bridge_plan["project"])
                claim = _pid(body.get("project"))
                if cur and claim and claim != cur:
                    return self._json(409, {"error": "задание для другого проекта", "current": _bridge_plan["project"]})
                if body.get("done"):
                    _bridge_tasks.pop(tid, None)          # отчёт пришёл — снимаем с доски
                else:
                    _bridge_tasks.pop(tid, None)          # перевыдача встаёт в конец очереди
                    _bridge_tasks[tid] = body
                    for old in list(_bridge_tasks)[:-_TASK_MAX]:
                        del _bridge_tasks[old]
                pending = len(_bridge_tasks)
            return self._json(200, {"ok": True, "pending": pending})
        self._json(404, {"error": "unknown bridge route", "path": self.path})

    def do_GET(self):
        if self.path.startswith("/bridge/"):
            return self._bridge_get()
        # с X-Upstream-Url — форвард (например GET /models); без него — health-check
        if not self._forward():
            self._json(200, {"ok": True, "proxy": "tester", "port": PORT})

    def do_POST(self):
        if self.path.startswith("/bridge/"):
            return self._bridge_post()
        if not self._forward():
            self._json(400, {"error": "нет заголовка X-Upstream-Url"})

    def log_message(self, *a):
        pass  # тихий лог


def run(port=None):
    """Поднять прокси (блокирующе). Зовётся из __main__ и из serve.py в фоне-потоке."""
    p = port or PORT
    bind = os.environ.get("TESTER_PROXY_BIND", "127.0.0.1")   # в Docker = 0.0.0.0 (доступ с хоста через маппинг)
    srv = ThreadingHTTPServer((bind, p), Proxy)
    print("tester chat-proxy: http://%s:%d  (форвард на X-Upstream-Url, +CORS)" % (bind, p))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    run()
