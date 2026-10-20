"""Проверить, что датасеты воспроизводятся из сырых ответов агентов.

Запуск из папки проекта: python3 scripts/check_repro.py
Пересобирает phase_states и applications скриптами сборки во временную папку и
сравнивает с data/. Расхождение значит, что правку внесли в датасет мимо скрипта
сборки, и следующая пересборка её молча откатит. Код выхода 1 при расхождении.
"""
import glob, json, os, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILDS = [('scripts/build_states.py', 'data/raw', 'phase_states.json'),
          ('scripts/build_apps.py', 'data/raw_apps', 'applications.json')]


def main():
    families = {r['id'] for r in json.load(open(os.path.join(HERE, 'data/materials.json'), encoding='utf-8'))}
    bad = 0
    with tempfile.TemporaryDirectory() as tmp:
        for script, raw, name in BUILDS:
            got = set()
            for f in sorted(glob.glob(os.path.join(HERE, raw, 'batch*.json'))):
                got |= {r['id'] for r in json.load(open(f, encoding='utf-8'))}
            if got != families:
                bad += 1
                print('ERR %s: партии не совпадают с семействами — нет %s, лишние %s'
                      % (raw, sorted(families - got), sorted(got - families)))
            out = os.path.join(tmp, name)
            subprocess.run([sys.executable, os.path.join(HERE, script), os.path.join(HERE, raw), out],
                           check=True, cwd=HERE, stdout=subprocess.DEVNULL)
            new = {r['id']: r for r in json.load(open(out, encoding='utf-8'))}
            old = {r['id']: r for r in json.load(open(os.path.join(HERE, 'data', name), encoding='utf-8'))}
            diffs = ['%s.%s: в data %r, сборка даёт %r' % (i, k, old[i].get(k), new.get(i, {}).get(k))
                     for i in old for k in old[i] if old[i].get(k) != new.get(i, {}).get(k)]
            diffs += ['%s: есть только в сборке' % i for i in sorted(set(new) - set(old))]
            bad += len(diffs)
            print('%s %-18s строк %d, расхождений %d' % ('ok ' if not diffs else 'ERR', name, len(old), len(diffs)))
            for x in diffs[:20]:
                print('    ' + x)
    print('итог: %s' % ('датасеты воспроизводятся из data/raw*' if not bad else 'расхождений %d' % bad))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
