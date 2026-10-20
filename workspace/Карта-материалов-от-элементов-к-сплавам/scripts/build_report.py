"""Стройка в Bench: выдать задание на блок, забрать его по MCP, прогнать проверки, отчитаться.

Запуск из папки проекта: python3 scripts/build_report.py bench/build_spec.json [id ...]
Нужны: serve.py, конструктор в браузере с включённым «Сопряжением» и порт управления
браузером (POST /eval) — им выдаётся задание, как кнопкой «Выдать задание».
Без порта управления (CONTROL='') задания выдаёт человек, а скрипт только отчитывается.
Спецификация: [{id, files, checks:[команда...], note, status?}]; проверки идут из этой папки.
"""
import json, os, re, subprocess, sys, time, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVER = os.path.normpath(os.path.join(HERE, '..', '..', 'mcp_server.py'))
CONTROL = os.environ.get('BENCH_CONTROL', 'http://127.0.0.1:8799/eval')

srv = subprocess.Popen([sys.executable, SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
                       encoding='utf-8', env=dict(os.environ, NO_PROXY='127.0.0.1,localhost'))
rid = 0


def rpc(method, params=None):
    global rid
    rid += 1
    srv.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params or {}},
                               ensure_ascii=False) + '\n')
    srv.stdin.flush()
    return json.loads(srv.stdout.readline())


def tool(name, args=None):
    res = rpc('tools/call', {'name': name, 'arguments': args or {}}).get('result') or {}
    return '\n'.join(c.get('text', '') for c in res.get('content', []))


def issue(node_id):
    if not CONTROL:
        return
    req = urllib.request.Request(CONTROL, data=('window.App.issueOrder(%s)' % json.dumps(node_id)).encode(),
                                 method='POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    opener.open(req, timeout=10).read()


def run_checks(cmds):
    outs, ok = [], True
    for c in cmds:
        p = subprocess.run(c, shell=True, cwd=HERE, capture_output=True, text=True)
        outs.append('$ %s → %d\n%s%s' % (c, p.returncode, p.stdout[-600:], p.stderr[-600:]))
        ok = ok and p.returncode == 0
    return ok, '\n'.join(outs)


def main():
    spec = json.load(open(sys.argv[1], encoding='utf-8'))
    only = set(sys.argv[2:])
    rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'claude-code', 'version': '1'}})
    tool('get_plan')                                  # подписать мост проектом
    for s in spec:
        if only and s['id'] not in only:
            continue
        issue(s['id'])
        time.sleep(0.4)
        task = tool('get_task', {'id': s['id']})
        m = re.search(r'spec_rev="([^"]+)"', task)
        if not m:
            print('!! %s: задания нет на доске — %s' % (s['id'], task[:120]))
            continue
        rep = {'id': s['id'], 'status': s.get('status', 'done'), 'files': s.get('files', []),
               'note': s['note'], 'owner': 'claude', 'spec_rev': m.group(1)}
        if s.get('checks'):
            ok, out = run_checks(s['checks'])
            rep.update(checks='\n'.join(s['checks']), checks_ok=ok)
            if not ok:
                rep['status'] = 'failed'
                rep['checks_out'] = out[-1500:]
        print('%-16s %-7s %s' % (s['id'], rep['status'], {True: 'проверки зелёные', False: 'ПРОВЕРКИ КРАСНЫЕ'}.get(rep.get('checks_ok'), 'без проверок')))
        tool('report_build', rep)
        time.sleep(1.8)                               # конструктор забирает отчёт опросом ~1.5 с
    srv.stdin.close()
    srv.wait(timeout=5)


if __name__ == '__main__':
    main()
