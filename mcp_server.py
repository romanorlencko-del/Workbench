#!/usr/bin/env python3
"""mcp_server.py - MCP-сервер конструктора Tester.

Приложения-MCP-клиенты (Cursor, Claude Desktop, Antigravity) подключаются сюда
по stdio и вызывают инструменты правки плана. Инструменты не трогают браузер
напрямую - кладут операции на движок (chat_proxy.py, /bridge/ops), а браузер-
конструктор их опрашивает и применяет. Текущую карту читаем с /bridge/plan.

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
SERVER_VERSION = "0.1.0"
DEFAULT_PROTOCOL = "2025-06-18"


# ── связь с движком ───────────────────────────────────────────────────────────
def _engine(method, path, body=None):
    url = ENGINE + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def _push_ops(ops):
    res = _engine("POST", "/bridge/ops", ops)
    return "операции отправлены в конструктор (в очереди: %s)" % res.get("pending", "?")


def _digest_plan(plan):
    if not plan:
        return ("План ещё не получен от конструктора. Открой Workbench в браузере "
                "и включи «Сопряжение» (кнопка ✦ ИИ → секция MCP).")
    nodes = plan.get("nodes") or []
    edges = plan.get("edges") or []
    name = plan.get("name") or "без имени"
    rev = (plan.get("meta") or {}).get("rev")
    head = 'План "%s"%s: %d блоков, %d связей' % (
        name, (" rev %s" % rev) if rev is not None else "", len(nodes), len(edges))
    lines = [head]
    for n in nodes:
        lines.append("- %s (%s): %s" % (n.get("id"), n.get("type"), n.get("name") or ""))
    if edges:
        lines.append("Связи:")
        for e in edges:
            fr = e.get("from") or {}
            to = e.get("to") or {}
            lines.append("- %s → %s" % (fr.get("node"), to.get("node")))
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
        return _digest_plan(_engine("GET", "/bridge/plan").get("plan"))
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
        except urllib.error.HTTPError as e:
            # движок ответил, но с ошибкой — это НЕ «не запущен» (HTTPError ⊂ URLError, ловим первым)
            _result(rid, {"content": [{"type": "text",
                     "text": "движок ответил ошибкой %s: %s" % (e.code, e.reason)}], "isError": True})
        except urllib.error.URLError as e:
            _result(rid, {"content": [{"type": "text",
                     "text": "движок недоступен (%s). Запущен ли Workbench и его прокси? %s" % (ENGINE, e)}],
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
