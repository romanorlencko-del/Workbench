"""Сверить датасеты со словарём данных плана Bench (блоки-сущности).

Запуск из папки проекта: python3 scripts/check_entities.py [путь к плану]
По умолчанию план ищется по метке .bench-project.json: ../../projects/<project_id>.json.
Каждая сущность плана (entity) описывает поля строки датасета: тип, обязательность,
допустимые значения, ссылки на другие сущности. Код выхода 1, если есть нарушения.
"""
import json, os, sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# сущность плана → датасет; у отчёта пересчёта строки лежат под ключом findings
DATASETS = {
    'element': ('data/elements.json', None),
    'family': ('data/materials.json', None),
    'scale_layer': ('data/scale.json', None),
    'phase_state': ('data/phase_states.json', None),
    'application': ('data/applications.json', None),
    'check_finding': ('data/checks/recalc_report.json', 'findings'),
}
VOCAB_MARK = 'только из словаря:'


def plan_path():
    if len(sys.argv) > 1:
        return sys.argv[1]
    mark = json.load(open(os.path.join(HERE, '.bench-project.json'), encoding='utf-8'))
    path = os.path.join(HERE, '..', '..', 'projects', mark['project_id'] + '.json')
    if not os.path.isfile(path):
        raise SystemExit('План %s не найден рядом с Bench (%s). Передай путь к плану аргументом.'
                         % (mark['project_id'], os.path.normpath(path)))
    return path


def as_list(v):
    if isinstance(v, list):
        return [str(x).strip() for x in v]
    return [s.strip() for s in str(v).split(';') if s.strip()]


def check_value(f, v, ids):
    """Нарушение одного поля строкой, либо None."""
    empty = v is None or v == '' or v == []
    if empty:
        return 'пусто, а поле обязательное' if f.get('required') else None
    kind = f.get('kind')
    if kind == 'number' and (isinstance(v, bool) or not isinstance(v, (int, float))):
        return 'не число: %r' % (v,)
    if kind == 'bool' and not isinstance(v, bool):
        return 'не да/нет: %r' % (v,)
    if kind == 'string' and not isinstance(v, (str, int, float)):
        return 'не строка: %r' % (v,)
    if kind == 'enum' and str(v) not in [str(x) for x in f.get('values') or []]:
        return '«%s» вне списка %s' % (v, f.get('values'))
    if kind == 'ref' and str(v) not in ids.get(f.get('ref'), set()):
        return '«%s» нет среди %s' % (v, f.get('ref'))
    if kind == 'list':
        items = as_list(v)
        note = f.get('note') or ''
        if f['name'] == 'elements':
            bad = [x for x in items if x not in ids.get('element', set())]
            if bad:
                return 'нет в справочнике элементов: %s' % ', '.join(bad)
        if VOCAB_MARK in note:
            vocab = as_list(note.split(VOCAB_MARK, 1)[1])
            bad = [x for x in items if x not in vocab]
            if bad:
                return 'вне словаря: %s' % ', '.join(bad)
    return None


def main():
    plan = json.load(open(plan_path(), encoding='utf-8'))
    entities = [n for n in plan['nodes'] if n.get('type') == 'entity']
    rows, ids = {}, {}
    for n in entities:
        p = n['params']
        path, sub = DATASETS[p['key']]
        data = json.load(open(os.path.join(HERE, path), encoding='utf-8'))
        rows[p['key']] = data[sub] if sub else data
        ids[p['key']] = {str(r.get(p.get('id_field') or 'id')) for r in rows[p['key']]}
    errors = 0
    for n in entities:
        p = n['params']
        key, idf = p['key'], p.get('id_field') or 'id'
        data, bad = rows[key], []
        names = {f['name'] for f in p['fields']}
        if key != 'check_finding':          # находки повторяют id семейства по разным проверкам
            seen = [str(r.get(idf)) for r in data]
            bad += ['повтор %s: %s' % (idf, i) for i in sorted({i for i in seen if seen.count(i) > 1})]
        for r in data:
            extra = sorted(set(r) - names)
            if extra:
                bad.append('%s: поля вне словаря: %s' % (r.get(idf), ', '.join(extra)))
            for f in p['fields']:
                err = check_value(f, r.get(f['name']), ids)
                if err:
                    bad.append('%s.%s: %s' % (r.get(idf), f['name'], err))
        errors += len(bad)
        print('%s %-14s %-42s строк %3d, полей %2d%s' % ('ok ' if not bad else 'ERR', key, n['name'], len(data),
                                                     len(p['fields']), '' if not bad else ', нарушений %d' % len(bad)))
        for b in bad[:20]:
            print('    ' + b)
    print('итог: %s' % ('словарь данных соблюдён' if not errors else 'нарушений %d' % errors))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
