#!/usr/bin/env python3
"""mcp_server.py - MCP-сервер конструктора Tester.

Приложения-MCP-клиенты (Cursor, Claude Desktop, Antigravity) подключаются сюда
по stdio и вызывают инструменты правки плана. Инструменты не трогают браузер
напрямую - кладут операции на движок (chat_proxy.py, /bridge/ops), а браузер-
конструктор их опрашивает и применяет. Текущую карту читаем с /bridge/plan.

Вторая половина работы - СТРОЙКА: человек выдаёт задание на блок в конструкторе,
приложение забирает его через get_task, пишет код у себя и отчитывается через
report_build. План при этом не меняется: стройка - отдельный слой данных.

Только стандартная библиотека. Транспорт - построчный JSON-RPC 2.0 (stdio):
одно JSON-сообщение на строку, ответ - тоже строкой.

Адрес движка - переменная TESTER_ENGINE_URL (по умолчанию http://127.0.0.1:8792).
Запуск обычно делает сам MCP-клиент из своего конфига; вручную:
  TESTER_ENGINE_URL=http://127.0.0.1:8792 py -3.12 mcp_server.py
"""
import os
import sys
import json
import urllib.request
import urllib.error

ENGINE = os.environ.get("TESTER_ENGINE_URL", "http://127.0.0.1:8792").rstrip("/")
TIMEOUT = float(os.environ.get("TESTER_MCP_TIMEOUT", "15"))
SERVER_NAME = "tester-constructor"
SERVER_VERSION = "0.2.0"
DEFAULT_PROTOCOL = "2025-06-18"


# Какой проект мост считает открытым. Узнаём из get_plan/get_task и подписываем
# ЭТИМ id каждую операцию: id блоков в разных проектах совпадают (agent_3 есть
# почти везде), и неподписанная правка молча легла бы не в ту схему.
_state = {"project": None}


class BridgeError(Exception):
    """Движок отказал осмысленно (например, проект сменился) — текст покажем модели."""


# ── связь с движком ───────────────────────────────────────────────────────────
def _engine(method, path, body=None):
    url = ENGINE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            raw = r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", "replace")
        try:
            raise BridgeError(json.loads(body_txt).get("error") or body_txt)
        except (ValueError, AttributeError):
            raise BridgeError(body_txt or ("HTTP %s" % e.code))
    return json.loads(raw) if raw else {}


def _remember(project):
    if isinstance(project, dict) and project.get("id"):
        _state["project"] = project["id"]
    return _state["project"]


def _push_ops(ops):
    body = dict(ops)
    if _state["project"]:
        body["project"] = _state["project"]
    res = _engine("POST", "/bridge/ops", body)
    return "операции отправлены в конструктор (в очереди: %s)" % res.get("pending", "?")


def _digest_plan(plan, project=None):
    if not plan:
        return ("План ещё не получен от конструктора. Открой Bench в браузере "
                "и включи «Сопряжение» (кнопка ✦ ИИ → секция MCP).")
    nodes = plan.get("nodes") or []
    edges = plan.get("edges") or []
    name = plan.get("name") or "без имени"
    rev = (plan.get("meta") or {}).get("rev")
    head = 'План "%s"%s: %d блоков, %d связей' % (
        name, (" rev %s" % rev) if rev is not None else "", len(nodes), len(edges))
    lines = [head]
    if isinstance(project, dict) and project.get("id"):
        lines.append("Проект: %s — правки и отчёты уйдут именно в него; "
                     "если человек откроет другой проект, движок их отобьёт." % project["id"])
    for n in nodes:
        lines.append("- %s (%s): %s" % (n.get("id"), n.get("type"), n.get("name") or ""))
    if edges:
        lines.append("Связи:")
        for e in edges:
            fr = e.get("from") or {}
            to = e.get("to") or {}
            lines.append("- %s → %s" % (fr.get("node"), to.get("node")))
    return "\n".join(lines)


def _tasks_text(tasks, tid=None):
    """Доска заданий -> текст для исполнителя. Одно задание отдаём целиком,
    несколько - списком плюс первое целиком: пусть сразу есть с чего начать."""
    if tid:
        one = [t for t in tasks if str(t.get("id")) == str(tid)]
        if not one:
            have = ", ".join(str(t.get("id")) for t in tasks)
            return "Задания на блок %s нет. Открытые задания: %s" % (tid, have or "ни одного")
        return one[0].get("text") or ""
    if not tasks:
        return ("Открытых заданий нет. Их выдаёт человек в конструкторе: режим «Стройка» -> "
                "выбрать блок -> «Выдать задание». Проверь, что включено «Сопряжение» (кнопка ✦ ИИ).")
    if len(tasks) == 1:
        return tasks[0].get("text") or ""
    lines = ["Открытых заданий: %d (в порядке выдачи). Бери по одному; "
             "get_task(id=\"...\") пришлёт нужное целиком." % len(tasks)]
    for t in tasks:
        lines.append("- %s%s" % (t.get("id"), (" · " + t["node"]) if t.get("node") else ""))
    lines += ["", "Первое задание целиком:", tasks[0].get("text") or ""]
    return "\n".join(lines)


# ── инструменты ────────────────────────────────────────────────────────────────
TOOLS = [
    {
        "name": "get_plan",
        "description": ("Показать текущий план конструктора: блоки (id, тип, имя) и связи. "
                        "Зови ПЕРЕД правками, чтобы знать реальные id блоков."),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "add_block",
        "description": ("Добавить блок в план. type обязателен (напр. start, source, agent, expert, "
                        "task, condition, loop, merge). id - временное имя для ссылок в connect "
                        "(конструктор выдаст свой реальный id)."),
        "inputSchema": {
            "type": "object",
            "properties": {
                "type": {"type": "string", "description": "тип блока"},
                "name": {"type": "string", "description": "имя блока"},
                "notes": {"type": "string", "description": "заметка/инструкция блока"},
                "id": {"type": "string", "description": "временный id для ссылок в connect"},
                "params": {"type": "object", "description": "параметры блока"},
            },
            "required": ["type"],
        },
    },
    {
        "name": "connect",
        "description": "Соединить два блока: from → to. Можно 'узел' или 'узел:порт', порт подставится сам.",
        "inputSchema": {
            "type": "object",
            "properties": {"from": {"type": "string"}, "to": {"type": "string"}},
            "required": ["from", "to"],
        },
    },
    {
        "name": "patch_block",
        "description": "Изменить существующий блок по id: имя, заметку, вкл/выкл, параметры.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "name": {"type": "string"},
                "notes": {"type": "string"},
                "enabled": {"type": "boolean"},
                "params": {"type": "object"},
            },
            "required": ["id"],
        },
    },
    {
        "name": "delete_block",
        "description": "Удалить блок по id.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
    },
    {
        "name": "layout",
        "description": "Разложить схему по слоям (когда блоки наезжают друг на друга/лежат некрасиво).",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_task",
        "description": ("Взять ЗАДАНИЕ на постройку блока, выданное человеком в конструкторе: что "
                        "построить, что придёт на вход, какой контракт обязан быть на выходе, куда "
                        "писать и чем проверять. Зови в начале работы над кодом. Без id вернёт список "
                        "открытых заданий."),
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string", "description": "id блока; без него - все открытые задания"}},
        },
    },
    {
        "name": "report_build",
        "description": ("Отчитаться о работе по блоку: конструктор поставит состояние, допишет пути к "
                        "файлам, запишет в журнал и снимет задание с доски. ПЛАН не меняется - для правки "
                        "замысла есть patch_block. spec_rev верни из задания как есть: по ней конструктор "
                        "поймёт, что план успел уйти вперёд, и пометит блок протухшим, а не готовым."),
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string", "description": "id блока из задания"},
                "status": {"type": "string", "enum": ["done", "wip", "failed", "todo"],
                           "description": "done - построено и проверено; failed - не вышло; wip - ещё в работе"},
                "files": {"type": "array", "items": {"type": "string"},
                          "description": "файлы, которые написал/правил - допишутся к путям блока"},
                "checks": {"type": "string",
                           "description": "команды проверки, по одной в строке"},
                "checks_ok": {"type": "boolean",
                              "description": "результат ПРОГОНА проверок: true - все зелёные, false - есть красная. "
                                             "Без него 'done' остаётся словом, а не подтверждённым фактом"},
                "checks_out": {"type": "string",
                               "description": "хвост вывода упавшей проверки - нужен, чтобы разобраться без повторного прогона"},
                "note": {"type": "string", "description": "что сделал/на чём встал - строкой в журнал блока"},
                "owner": {"type": "string", "description": "кто делал (cursor, claude, имя)"},
                "spec_rev": {"type": "string", "description": "печать плана из задания, как есть"},
            },
            "required": ["id", "status"],
        },
    },
    {
        "name": "apply_ops",
        "description": ("Пакетно применить операции одним объектом {add,edges,patch,del,layout} - "
                        "тот же формат, что понимает конструктор."),
        "inputSchema": {
            "type": "object",
            "properties": {
                "add": {"type": "array"},
                "edges": {"type": "array"},
                "patch": {"type": "array"},
                "del": {"type": "array"},
                "layout": {"type": "boolean"},
            },
        },
    },
]


def call_tool(name, args):
    args = args or {}
    if name == "get_plan":
        res = _engine("GET", "/bridge/plan")
        _remember(res.get("project"))
        return _digest_plan(res.get("plan"), res.get("project"))
    if name == "add_block":
        if not args.get("type"):
            return "нужен type блока"
        block = {"type": args["type"]}
        for k in ("id", "name", "notes", "params"):
            if args.get(k) is not None:
                block[k] = args[k]
        return _push_ops({"add": [block]})
    if name == "connect":
        if not args.get("from") or not args.get("to"):
            return "нужны from и to"
        return _push_ops({"edges": [[args["from"], args["to"]]]})
    if name == "patch_block":
        if not args.get("id"):
            return "нужен id"
        patch = {"id": args["id"]}
        for k in ("name", "notes", "enabled", "params"):
            if args.get(k) is not None:
                patch[k] = args[k]
        return _push_ops({"patch": [patch]})
    if name == "delete_block":
        if not args.get("id"):
            return "нужен id"
        return _push_ops({"del": [args["id"]]})
    if name == "layout":
        return _push_ops({"layout": True})
    if name == "get_task":
        res = _engine("GET", "/bridge/task")
        _remember(res.get("project"))
        return _tasks_text(res.get("tasks") or [], args.get("id"))
    if name == "report_build":
        if not args.get("id"):
            return "нужен id блока"
        # Отчёт обязан знать свой проект: без подписи он ляжет в тот план, который
        # сейчас открыт, а id блоков в проектах совпадают. Если проект ещё не знаем -
        # берём его из задания на этот блок.
        if not _state["project"]:
            try:
                _remember((_engine("GET", "/bridge/task") or {}).get("project"))
            except Exception:
                pass
        rep = {"id": args["id"]}
        for k in ("status", "files", "checks", "note", "owner", "spec_rev"):
            if args.get(k) is not None:
                rep[k] = args[k]
        _push_ops({"build": [rep]})
        return ("отчёт по блоку %s отправлен%s - конструктор применит его при ближайшем опросе (~1.5 с). "
                "Открыт ли Bench в браузере и включено ли «Сопряжение»?"
                % (args["id"], (" (проект %s)" % _state["project"]) if _state["project"] else ""))
    if name == "apply_ops":
        ops = {k: args[k] for k in ("add", "edges", "patch", "del", "layout") if k in args}
        if not ops:
            return "пустой набор операций"
        return _push_ops(ops)
    raise KeyError("неизвестный инструмент: %s" % name)


# ── JSON-RPC / MCP ─────────────────────────────────────────────────────────────
def _send(msg):
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def _result(rid, result):
    _send({"jsonrpc": "2.0", "id": rid, "result": result})


def _error(rid, code, message):
    _send({"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}})


def handle(msg):
    method = msg.get("method")
    rid = msg.get("id")

    if method == "initialize":
        proto = (msg.get("params") or {}).get("protocolVersion") or DEFAULT_PROTOCOL
        _result(rid, {
            "protocolVersion": proto,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
        })
    elif method in ("notifications/initialized", "initialized"):
        pass  # уведомление - ответа нет
    elif method == "ping":
        _result(rid, {})
    elif method == "tools/list":
        _result(rid, {"tools": TOOLS})
    elif method == "tools/call":
        params = msg.get("params") or {}
        try:
            text = call_tool(params.get("name"), params.get("arguments"))
            _result(rid, {"content": [{"type": "text", "text": str(text)}]})
        except BridgeError as e:
            _result(rid, {"content": [{"type": "text", "text": "конструктор отказал: %s" % e}], "isError": True})
        except urllib.error.URLError as e:
            _result(rid, {"content": [{"type": "text",
                     "text": "движок недоступен (%s). Запущен ли Bench и его прокси? %s" % (ENGINE, e)}],
                     "isError": True})
        except Exception as e:
            _result(rid, {"content": [{"type": "text", "text": "ошибка инструмента: %s" % e}], "isError": True})
    elif rid is not None:
        _error(rid, -32601, "метод не поддерживается: %s" % method)
    # прочие уведомления (rid отсутствует) молча игнорируем


def main():
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        try:
            handle(msg)
        except Exception as e:
            rid = msg.get("id") if isinstance(msg, dict) else None
            if rid is not None:
                _error(rid, -32603, "внутренняя ошибка: %s" % e)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
