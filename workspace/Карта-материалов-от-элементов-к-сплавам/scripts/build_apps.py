"""Свести ответы агентов о применении в data/applications.json.

Запуск из папки проекта: python3 scripts/build_apps.py data/raw_apps data/applications.json
Правки поверх ответов агентов — по памяти; у исправленной строки conf = «по памяти».
"""
import json, glob, sys

VOCAB = ('Металлургия;Машиностроение;Автомобилестроение;Авиация и космос;Энергетика;Электроника;'
         'Электротехника;Строительство;Химия и катализ;Медицина;Инструмент;Оборона;Нефтегаз;Судостроение;'
         'Оптика;Ювелирное дело;Упаковка и быт;Экология и очистка;Сельское хозяйство;Наука').split(';')
KEYS = ['id', 'tech_name', 'tech_name_en', 'designations', 'industries', 'applications', 'note', 'conf', 'source']

src, out = sys.argv[1], sys.argv[2]
rows = []
for f in sorted(glob.glob(src + '/batch*.json')):
    rows += json.load(open(f))
by = {r['id']: r for r in rows}


def fix(i, **kw):
    by[i].update(kw)
    by[i]['conf'] = 'по памяти'


# ГОСТ 4404 пришёл из примера в промпте и поиском не подтверждён
fix('c_allo', designations=by['c_allo']['designations'].replace('ГОСТ 4404 (сажа газовая); ', ''))
# цемент общего назначения — строительство; тампонажные цементы для скважин — отдельный ГОСТ 1581
fix('cement', industries='Строительство')
# Al–SiC: теплоотводы электроники, авиакосмические и автомобильные детали; медицина — не профиль
fix('mmc', industries='Электроника;Авиация и космос;Автомобилестроение;Электротехника')
# ПОИ не подтверждён и не подходит к составу семейства (в нём нет индия)
fix('solder', designations=by['solder']['designations'].replace('; ПОИ (обозначение не подтверждено поиском)', ''))

res = []
for r in rows:
    r = by[r['id']]
    inds = [s.strip() for s in str(r.get('industries', '')).split(';') if s.strip()]
    bad = [s for s in inds if s not in VOCAB]
    assert not bad, (r['id'], bad)
    r['industries'] = ';'.join(inds)
    r['source'] = r.get('source') or ''
    res.append({k: r.get(k, '') for k in KEYS})
json.dump(res, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(res), 'rows')
