"""Мини-клиент MCP для mcp_server.py Bench (stdio).

Пример: python3 mcp_call.py get_plan apply_ops ops.json sleep 5 get_plan
Нужны запущенный serve.py и открытый конструктор с включённым «Сопряжением».
"""
import json, os, subprocess, sys, time
SERVER = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "mcp_server.py"))
srv = subprocess.Popen([sys.executable, SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                       env=dict(os.environ, TESTER_ENGINE_URL=os.environ.get('TESTER_ENGINE_URL', 'http://127.0.0.1:8792'), NO_PROXY='127.0.0.1,localhost'),
                       text=True, encoding='utf-8')
rid = 0
def rpc(method, params=None):
    global rid; rid += 1
    srv.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params or {}}, ensure_ascii=False) + '\n'); srv.stdin.flush()
    return json.loads(srv.stdout.readline())
rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'claude-code', 'version': '1'}})
args = sys.argv[1:]
i = 0
while i < len(args):
    tool = args[i]; i += 1
    if tool == 'sleep':
        time.sleep(float(args[i])); i += 1; continue
    a = {}
    if i < len(args) and args[i].endswith('.json'):
        a = json.load(open(args[i])); i += 1
    r = rpc('tools/call', {'name': tool, 'arguments': a})
    res = r.get('result') or r
    print('=== %s%s' % (tool, ' (ERROR)' if res.get('isError') else ''))
    for c in res.get('content', []): print(c.get('text'))
srv.stdin.close(); srv.wait(timeout=5)
