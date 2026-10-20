"""Локальный пересчёт значений карты материалов по таблице Менделеева и физическим законам.

Запуск из папки проекта:
    python3 scripts/recalc.py                 # только отчёт
    python3 scripts/recalc.py --apply         # цикл: исправить точно вычислимое и перепроверить
    python3 scripts/recalc.py --apply --max-iter 5
    python3 scripts/recalc.py --apply --max-iter 1 --summary-json   # один проход — так его зовёт цикл в Bench

Источники данных об элементах (обе базы читаются локально, без сети):
  - mendeleev (pip, MIT): массы, T плавления и кипения, теплоты плавления и испарения, изотопы;
  - таблица pymatgen-core (vendor/pymatgen_periodic_table.json.gz, MIT): массы, T плавления и кипения.
Где базы расходятся, значение сравнивается с диапазоном [мин; макс] по обеим.

Цикл: каждый проход прогоняет все проверки по всем семействам. С --apply исправляются только
находки с точным ответом (комбинаторика, арифметика, формулы ↔ список элементов); затем проход
повторяется, пока исправления не кончатся или не исчерпан --max-iter. Остальное — в отчёт.

Результат: data/checks/recalc_report.json, data/checks/recalc_report.md, data/derived.json.
"""
import argparse
import gzip
import json
import math
import os
import re
import warnings
from collections import Counter

warnings.filterwarnings('ignore')
try:
    from mendeleev import element as md_element  # noqa: E402
    from mendeleev.fetch import fetch_table  # noqa: E402
except ImportError:
    raise SystemExit('Нет пакета mendeleev — второй базы элементов. Установи: pip install -r requirements.txt')

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
DATA = os.path.join(ROOT, 'data')
K0 = 273.15
FILES = {'materials': 'materials.json', 'scale': 'scale.json', 'elements': 'elements.json', 'states': 'phase_states.json'}

# Константы фазовых диаграмм — не из таблицы элементов; значения по памяти (справочные диаграммы).
DIAGRAMS = {
    'Fe–C эвтектика (метастабильная, ледебурит)': 1147,
    'Fe–C эвтектика (стабильная, графит)': 1153,
    'Sn–Bi эвтектика': 139,
    'Sn–Pb эвтектика': 183,
}
# Основа сплава и изоморфные легирующие (полная растворимость в жидком и твёрдом — ликвидус может быть выше Tпл основы).
ALLOY_BASE = {
    'steel': ('Fe', ()), 'stainless': ('Fe', ('Cr',)), 'castiron': ('Fe', ()), 'al_wr': ('Al', ()),
    'cu_al': ('Cu', ('Ni',)), 'ti_al': ('Ti', ('Mo', 'Nb', 'Zr')), 'ni_super': ('Ni', ()), 'mg_al': ('Mg', ()),
    'solder': ('Sn', ()), 'mmc': ('Al', ()),
}
PURE = {'c_allo': 'C', 'fe_allo': 'Fe', 'si_forms': 'Si', 'p_allo': 'P', 'sn_allo': 'Sn'}
# Определённые соединения по семействам: проверка формулы ↔ элементы семейства и молярная масса.
COMPOUNDS = {
    'fe_ox': ['FeO', 'Fe2O3', 'Fe3O4', 'FeOOH'], 'al2o3': ['Al2O3'], 'sio2': ['SiO2'], 'tio2': ['TiO2'],
    'sic': ['SiC'], 'si3n4': ['Si3N4'], 'wc': ['WC', 'W2C'], 'bn': ['BN'],
    'perov': ['BaTiO3', 'SrTiO3', 'PbTiO3', 'PbZr0.52Ti0.48O3', 'LaMnO3'], 'zeol': ['Na12Al12Si12O48'],
    'hardmet': ['WC', 'Co'], 'intermet': ['NiTi', 'TiAl', 'Ni3Al', 'NiAl', 'Nd2Fe14B', 'SmCo5'],
}
SERIES_KIND = {'Metalloids': 'полуметалл', 'Nonmetals': 'неметалл', 'Halogens': 'неметалл', 'Noble gases': 'неметалл'}
SUB = str.maketrans('₀₁₂₃₄₅₆₇₈₉', '0123456789')


# ── данные об элементах ─────────────────────────────────────────────────────────
class Elements:
    def __init__(self):
        p = os.path.join(ROOT, 'vendor', 'pymatgen_periodic_table.json.gz')
        self.pmg = json.load(gzip.open(p))
        t = fetch_table('elements')
        self.symbols = set(t.symbol)
        self.count = len(t)
        series = {r.id: r.name for r in fetch_table('series').itertuples()}
        self.series = {r.symbol: series.get(r.series_id) for r in t.itertuples()}
        iso = fetch_table('isotopes')
        st = iso[(iso.is_radioactive == False) & (iso.abundance.fillna(0) > 0)]  # noqa: E712
        self.stable_z = sorted(int(z) for z in st.atomic_number.unique())
        self._md = {}

    def md(self, s):
        if s not in self._md:
            self._md[s] = md_element(s)
        return self._md[s]

    def _num(self, v):
        try:
            v = float(str(v).split()[0])
            return v if v > 0 else None
        except (TypeError, ValueError):
            return None

    def T(self, s, what):
        """Диапазон значения по обеим базам, в °C. what: 'melt' | 'boil'."""
        e = self.md(s)
        vals = [getattr(e, 'melting_point' if what == 'melt' else 'boiling_point', None),
                self._num(self.pmg.get(s, {}).get('Melting point' if what == 'melt' else 'Boiling point'))]
        vals = [v - K0 for v in vals if v]
        return (min(vals), max(vals)) if vals else None

    def mass(self, s):
        return float(self.md(s).atomic_weight)

    def kind(self, s):
        return SERIES_KIND.get(self.series.get(s), 'металл')


# ── находки ────────────────────────────────────────────────────────────────────
def finding(fam, check, law, status, value=None, expected=None, note='', field=None, dataset=None, fix=None):
    return {'id': fam, 'check': check, 'law': law, 'status': status, 'value': value, 'expected': expected,
            'note': note, 'field': field, 'dataset': dataset, 'fix': fix}


def compare_T(fam, field, value, rng, law, dataset='states'):
    """Сравнить температуру с диапазоном баз: ±1 % по шкале Кельвина — ok, до 3 % — warn, дальше — fail."""
    lo, hi = rng
    vk, lok, hik = value + K0, lo + K0, hi + K0
    off = 0 if lok <= vk <= hik else min(abs(vk - lok), abs(vk - hik)) / ((lok + hik) / 2)
    st = 'ok' if off <= 0.01 else 'warn' if off <= 0.03 else 'fail'
    exp = round(lo) if round(lo) == round(hi) else '%d…%d' % (round(lo), round(hi))
    note = '' if st == 'ok' else 'отклонение %.1f %% от диапазона баз' % (off * 100)
    if st == 'ok' and round(lo) != round(hi):
        note = 'базы расходятся на %d °C' % round(hi - lo)
    # обе базы сходятся, а наше значение вне допуска — берём значение баз
    fix = {'value': round(lo)} if st != 'ok' and round(lo) == round(hi) else None
    if fix:
        note += '; обе базы дают %d °C — исправимо' % round(lo)
    return finding(fam, field, law, st, value, exp, note, field, dataset, fix)


def nums_in(text):
    """Целые числа из текста; «1 538» с узким пробелом — одно число."""
    out = set()
    for m in re.findall(r'−?\d{1,3}(?:[   ]\d{3})+|−?\d+', str(text or '')):
        out.add(int(re.sub(r'[   ]', '', m).replace('−', '-')))
    return out


def parse_formula(f):
    """'PbZr0.52Ti0.48O3' -> {'Pb':1,'Zr':0.52,...}; None, если встретился не элемент."""
    out = Counter()
    for sym, n in re.findall(r'([A-Z][a-z]?)(\d+(?:\.\d+)?)?', f):
        out[sym] += float(n) if n else 1.0
    return out


def formulas_in(text, symbols):
    found = []
    for f in re.findall(r'\b(?:[A-Z][a-z]?\d*(?:\.\d+)?){2,}\b', str(text or '').translate(SUB)):
        if f.isupper() and not any(ch.isdigit() for ch in f):
            continue  # аббревиатура (ISO, DFT), не формула
        comp = parse_formula(f)
        if comp and all(s in symbols for s in comp) and len(comp) >= 2:
            found.append((f, comp))
    return found


# ── проверки ───────────────────────────────────────────────────────────────────
def check_combinatorics(d, E):
    out = []
    n_st = len(E.stable_z)
    scale = {r['id']: r for r in d['scale']}
    mats = {r['id']: r for r in d['materials']}
    r = scale.get('elements')
    if r:
        out.append(finding('elements', 'число элементов', 'таблица Менделеева (mendeleev)', 'ok' if r['theor'] == E.count else 'fail',
                           r['theor'], E.count, field='theor', dataset='scale',
                           fix=None if r['theor'] == E.count else {'value': E.count}))
        miss = sorted(set(range(1, max(E.stable_z) + 1)) - set(E.stable_z))
        out.append(finding('elements', 'стабильные элементы', 'изотопы без распада с природной распространённостью',
                           'ok' if r['known'] == n_st else 'fail', r['known'], n_st,
                           'Z 1–%d без Z %s' % (max(E.stable_z), ', '.join(map(str, miss))), 'known', 'scale',
                           None if r['known'] == n_st else {'value': n_st}))
    for sid, k in (('bin', 2), ('tern', 3), ('quat', 4)):
        r = scale.get(sid)
        if not r:
            continue
        m = re.search(r'C\((\d+),\s*(\d+)\)', r['theor_label'])
        n = int(m.group(1)) if m else n_st
        exp = math.comb(n_st, k)
        out.append(finding(sid, 'C(%d,%d)' % (n_st, k), 'сочетания: систем из k элементов среди стабильных',
                           'ok' if r['theor'] == exp and n == n_st else 'fail', r['theor'], exp,
                           '' if n == n_st else 'в подписи N=%d, стабильных %d' % (n, n_st), 'theor', 'scale',
                           None if r['theor'] == exp else {'value': exp}))
        lab = max(nums_in(r['theor_label']) - {n, k}, default=None)
        if lab is not None and lab != exp:
            out.append(finding(sid, 'подпись C(n,k)', 'число в подписи = расчёт', 'fail', lab, exp, field='theor_label', dataset='scale',
                               fix={'value': re.sub(r'=\s*[\d\s  ]+', '= ' + format(exp, ',').replace(',', ' '), r['theor_label'])}))
    h = mats.get('hea')
    if h:
        m = re.search(r'C\((\d+),\s*(\d+)\)', h['theor_label'])
        if m:
            exp = math.comb(int(m.group(1)), int(m.group(2)))
            metals = sum(1 for z in E.stable_z if E.kind(_sym(E, z)) == 'металл')
            out.append(finding('hea', 'C(%s,%s)' % m.groups(), 'сочетания: эквимолярные системы', 'ok' if h['theor'] == exp else 'fail',
                               h['theor'], exp, 'стабильных металлов в таблице: %d; «%s» — выбор автора выборки' % (metals, m.group(1)),
                               'theor', 'materials', None if h['theor'] == exp else {'value': exp}))
    mi = mats.get('miner')
    if mi:
        parts = [int(re.sub(r'\s', '', p)) for p in re.findall(r'(\d[\d\s ]*\d)', mi['theor_label'].split(':')[-1])][:2]
        if len(parts) == 2 and '+' in mi['theor_label']:
            exp = parts[0] + parts[1]
            out.append(finding('miner', 'сумма в подписи', 'арифметика: известные + неоткрытые', 'ok' if mi['theor'] == exp else 'fail',
                               mi['theor'], exp, '%d + %d' % tuple(parts), 'theor', 'materials',
                               None if mi['theor'] == exp else {'value': exp}))
        sm = scale.get('minerals')
        if sm:
            for f in ('theor', 'known'):
                out.append(finding('miner', 'минералы: %s в двух таблицах' % f, 'одно число — одно значение', 'ok' if sm[f] == mi[f] else 'fail',
                                   mi[f], sm[f], 'materials.miner ↔ scale.minerals', f, 'materials'))
    return out


def _sym(E, z):
    if not hasattr(E, '_z2s'):
        E._z2s = {int(r.atomic_number): r.symbol for r in fetch_table('elements').itertuples()}
    return E._z2s[z]


def check_ordering(d):
    out = []
    for ds in ('materials', 'scale'):
        for r in d[ds]:
            v = [r.get(k) for k in ('used', 'known', 'theor')]
            pairs = [(a, b) for a, b in ((v[0], v[1]), (v[1], v[2]), (v[0], v[2])) if a is not None and b is not None]
            if pairs:
                bad = [p for p in pairs if p[0] > p[1]]
                out.append(finding(r['id'], 'применяется ≤ известно ≤ теоретически', 'подмножество не больше множества',
                                   'fail' if bad else 'ok', '/'.join('—' if x is None else str(x) for x in v), None,
                                   '; '.join('%s > %s' % p for p in bad), dataset=ds))
    return out


def check_elements(d, E):
    out = []
    known = {r['symbol'] for r in d['elements']}
    for r in d['elements']:
        s = r['symbol']
        if s not in E.symbols:
            out.append(finding(s, 'символ', 'таблица Менделеева', 'fail', s, None, 'нет такого элемента', 'symbol', 'elements'))
            continue
        exp = E.kind(s)
        out.append(finding(s, 'тип элемента', 'серия в таблице (%s)' % E.series.get(s), 'ok' if r['kind'] == exp else 'fail',
                           r['kind'], exp, field='kind', dataset='elements', fix=None if r['kind'] == exp else {'value': exp}))
    for m in d['materials']:
        miss = [s for s in str(m['elements']).split(';') if s not in known]
        if miss:
            out.append(finding(m['id'], 'элементы в справочнике', 'каждый символ семейства — в справочнике элементов', 'fail',
                               ';'.join(miss), None, 'добавить в справочник: ' + ', '.join(miss), 'elements', 'materials'))
    return out


def check_formulas(d, E):
    """Закон постоянства состава: элементы формул ⊆ элементы семейства; молярная масса и массовые доли."""
    out, derived = [], {}
    for m in d['materials']:
        els = str(m['elements']).split(';')
        forms = [(f, parse_formula(f), True) for f in COMPOUNDS.get(m['id'], [])]
        for fld in ('name', 'known_label', 'used_label'):
            forms += [(f, c, False) for f, c in formulas_in(m.get(fld), E.symbols)]
        seen = set()
        for f, comp, member in forms:
            if f in seen:
                continue
            seen.add(f)
            miss = [s for s in comp if s not in els]
            M = sum(E.mass(s) * n for s, n in comp.items())
            w = {s: round(E.mass(s) * n / M * 100, 2) for s, n in comp.items()}
            if member or not miss:
                derived.setdefault(m['id'], []).append({'formula': f, 'molar_mass': round(M, 3), 'mass_pct': w})
            if miss and not member:
                out.append(finding(m['id'], 'формула %s в подписи' % f, 'элементы формулы ⊆ элементы семейства', 'warn', m['elements'],
                                   None, 'упомянута в подписи; если это член семейства — добавить %s в элементы' % ', '.join(miss)))
            elif miss:
                out.append(finding(m['id'], 'формула %s' % f, 'элементы формулы ⊆ элементы семейства', 'fail', m['elements'],
                                   m['elements'] + ';' + ';'.join(miss), 'в формуле есть %s, в списке элементов нет' % ', '.join(miss),
                                   'elements', 'materials', {'value': m['elements'] + ';' + ';'.join(miss)}))
            else:
                out.append(finding(m['id'], 'M(%s)' % f, 'молярная масса по атомным массам', 'calc', round(M, 3), None,
                                   ', '.join('%s %.2f %%' % kv for kv in w.items())))
    return out, derived


def check_pure(d, E):
    out = []
    st = {r['id']: r for r in d['states']}
    for fam, s in PURE.items():
        r = st.get(fam)
        if not r:
            continue
        melt, boil = E.T(s, 'melt'), E.T(s, 'boil')
        if s == 'C':  # при 1 атм графит возгоняется; базы дают условные T «плавления/кипения»
            rng = (min(x for x in (melt, boil) if x)[0], max(x for x in (melt, boil) if x)[1])
            if r.get('decomp_C') is not None:
                out.append(compare_T(fam, 'decomp_C', r['decomp_C'], rng, 'C: возгонка между T плавления и кипения по базам'))
            continue
        if melt and r.get('melt_low_C') is not None:
            out.append(compare_T(fam, 'melt_low_C', r['melt_low_C'], melt, '%s: T плавления (обе базы)' % s))
        if melt and r.get('melt_high_C') is not None and r['melt_high_C'] != r.get('melt_low_C'):
            out.append(compare_T(fam, 'melt_high_C', r['melt_high_C'], melt, '%s: T плавления (обе базы)' % s))
        if boil and r.get('boil_C') is not None:
            out.append(compare_T(fam, 'boil_C', r['boil_C'], boil, '%s: T кипения (обе базы)' % s))
        if not melt:
            out.append(finding(fam, 'melt_low_C', '%s: T плавления' % s, 'info', r.get('melt_low_C'), None, 'в базах нет значения'))
    return out


def check_alloys(d, E):
    out = []
    st = {r['id']: r for r in d['states']}
    mats = {r['id']: r for r in d['materials']}
    for fam, (base, iso) in ALLOY_BASE.items():
        r = st.get(fam)
        if not r:
            continue
        tm, tb = E.T(base, 'melt'), E.T(base, 'boil')
        lo, hi = r.get('melt_low_C'), r.get('melt_high_C')
        if r.get('boil_C') is not None and tb and fam != 'mmc':
            out.append(compare_T(fam, 'boil_C', r['boil_C'], tb, 'кипение основы %s (обе базы)' % base))
        if fam == 'mmc' and hi is not None:
            out.append(compare_T(fam, 'melt_high_C', hi, tm, 'ликвидус Al-матрицы ≤ Tпл чистого Al'))
            continue
        if lo is not None and tm:
            ok = lo + K0 < (tm[1] + K0) * 1.005
            out.append(finding(fam, 'солидус < Tпл основы', 'легирование понижает солидус (%s %.0f °C)' % (base, tm[1]),
                               'ok' if ok else 'fail', lo, '< %.0f' % tm[1], field='melt_low_C', dataset='states'))
        if hi is not None and tm:
            iso_in = [s for s in iso if s in str(mats[fam]['elements']).split(';')]
            if hi + K0 <= (tm[1] + K0) * 1.005:
                note = 'в пределах округления' if hi > tm[1] else ''
                out.append(finding(fam, 'ликвидус ≤ Tпл основы', 'кривая ликвидуса эвтектических систем ниже Tпл основы',
                                   'ok', hi, '≤ %.0f' % tm[1], note, 'melt_high_C', 'states'))
            elif iso_in:
                top = max(E.T(s, 'melt')[1] for s in iso_in)
                out.append(finding(fam, 'ликвидус ≤ Tпл основы', 'изоморфная система с %s: ликвидус между Tпл компонентов' % '/'.join(iso_in),
                                   'ok' if hi <= top else 'fail', hi, '%.0f…%.0f' % (tm[1], top), field='melt_high_C', dataset='states'))
            else:
                out.append(finding(fam, 'ликвидус ≤ Tпл основы', 'кривая ликвидуса ниже Tпл основы', 'warn', hi, '≤ %.0f' % tm[1],
                                   'выше Tпл чистой основы без изоморфного легирования', 'melt_high_C', 'states'))
    c = st.get('castiron')
    if c and c.get('melt_low_C') is not None:
        a, b = DIAGRAMS['Fe–C эвтектика (метастабильная, ледебурит)'], DIAGRAMS['Fe–C эвтектика (стабильная, графит)']
        lo = c['melt_low_C']
        s = 'ok' if a - 3 <= lo <= b + 3 else 'warn'
        out.append(finding('castiron', 'солидус = эвтектика Fe–C', 'диаграмма Fe–C: %d…%d °C (константа по памяти)' % (a, b), s, lo, '%d…%d' % (a, b),
                           '' if s == 'ok' else 'ниже эвтектики на %d °C; Si и P сдвигают её, но тогда это не двойная система' % (a - lo),
                           'melt_low_C', 'states'))
    sd = st.get('solder')
    if sd and sd.get('melt_low_C') is not None:
        e = DIAGRAMS['Sn–Bi эвтектика']
        out.append(finding('solder', 'нижняя граница = эвтектика Sn–Bi', 'диаграмма Sn–Bi: %d °C (константа по памяти)' % e,
                           'ok' if abs(sd['melt_low_C'] - e) <= 2 else 'warn', sd['melt_low_C'], e, field='melt_low_C', dataset='states'))
    return out


def check_thermo(d, E):
    """Правило Трутона (ΔS исп ≈ 85–110 Дж/(моль·К) у металлов) и правило Ричардса (ΔS пл ≈ R … 1,5R)."""
    out = []
    st = {r['id']: r for r in d['states']}
    pairs = [(f, s) for f, s in PURE.items() if s in ('Fe', 'Si', 'Sn')] + [(f, b) for f, (b, _) in ALLOY_BASE.items() if f != 'mmc']
    seen = set()
    for fam, s in pairs:
        r = st.get(fam)
        if not r:
            continue
        e = E.md(s)
        tb = r.get('boil_C')
        if tb is not None and e.evaporation_heat and (s, tb) not in seen:
            seen.add((s, tb))
            dS = e.evaporation_heat * 1000 / (tb + K0)
            tb_est = e.evaporation_heat * 1000 / 100.0 - K0
            status = 'ok' if 80 <= dS <= 125 else 'warn'
            out.append(finding(fam, 'правило Трутона (%s)' % s, 'ΔH исп / T кип ≈ 80–125 Дж/(моль·К) для металлов', status,
                               round(dS, 1), '80…125', 'T кип по Трутону при 100 Дж/(моль·К): ≈%d °C' % round(tb_est), 'boil_C', 'states'))
        tm = r.get('melt_high_C') if fam in PURE else None
        if tm is not None and e.fusion_heat:
            dS = e.fusion_heat * 1000 / (tm + K0)
            metal = E.kind(s) == 'металл'
            status = ('ok' if 6 <= dS <= 14 else 'warn') if metal else 'info'
            out.append(finding(fam, 'правило Ричардса (%s)' % s, 'ΔH пл / T пл ≈ R…1,7R (8–14 Дж/(моль·К)) для металлов', status,
                               round(dS, 1), '6…14' if metal else None,
                               '' if metal else 'ковалентный кристалл: правило не применимо (ожидаемо выше)', 'melt_high_C', 'states'))
    return out


def check_consistency(d):
    out = []
    for r in d['states']:
        fam = r['id']
        lo, hi, b, dc = (r.get(k) for k in ('melt_low_C', 'melt_high_C', 'boil_C', 'decomp_C'))
        for k in ('melt_low_C', 'melt_high_C', 'boil_C', 'decomp_C'):
            if r.get(k) is not None and r[k] < -K0:
                out.append(finding(fam, k, 'температура не ниже абсолютного нуля', 'fail', r[k], '≥ −273', field=k, dataset='states'))
        if lo is not None and hi is not None:
            out.append(finding(fam, 'солидус ≤ ликвидус', 'нижняя граница плавления не выше верхней', 'ok' if lo <= hi else 'fail',
                               '%s…%s' % (lo, hi), None, field='melt_low_C', dataset='states'))
        if hi is not None and b is not None:
            out.append(finding(fam, 'ликвидус < кипение', 'жидкость существует между плавлением и кипением', 'ok' if hi < b else 'fail',
                               '%s / %s' % (hi, b), None, field='boil_C', dataset='states'))
        if r.get('liquid_exists') is False and (lo is not None or hi is not None):
            out.append(finding(fam, 'нет жидкости ⇒ нет плавления', 'без жидкой фазы T плавления не определена', 'fail',
                               '%s…%s' % (lo, hi), 'null', field='melt_low_C', dataset='states'))
        if r.get('liquid_exists') and lo is None and hi is None:
            out.append(finding(fam, 'жидкость есть ⇒ есть плавление', 'жидкая фаза при 1 атм требует T плавления', 'warn',
                               None, 'число', field='melt_low_C', dataset='states'))
        if lo is not None:
            exp = 'твёрдое' if lo > 25 else ('газ' if b is not None and b < 25 else 'жидкое')
            got = str(r.get('state_25C'))
            ok = got.startswith(exp)
            out.append(finding(fam, 'состояние при 25 °C', 'T пл > 25 °C ⇒ твёрдое; T пл < 25 °C < T кип ⇒ жидкое',
                               'ok' if ok else 'info', got, exp, '' if ok else 'семейство: у части членов T пл ниже 25 °C',
                               'state_25C', 'states'))
        text = nums_in(r.get('heating_path'))
        miss = [v for v in (lo, hi, b, dc) if v is not None and int(round(v)) not in text]
        out.append(finding(fam, 'числа в тексте пути', 'подпись совпадает с полями', 'warn' if miss else 'ok',
                           ', '.join(map(str, miss)) or '—', None, 'в «heating_path» нет: ' + ', '.join(map(str, miss)) if miss else '',
                           'heating_path', 'states'))
    return out


# ── цикл ───────────────────────────────────────────────────────────────────────
def load():
    d, fmt = {}, {}
    for k, f in FILES.items():
        p = os.path.join(DATA, f)
        raw = open(p, encoding='utf-8').read()
        d[k] = json.loads(raw)
        fmt[k] = 1 if raw.startswith('[\n {') else 0
    return d, fmt


def run_checks(d, E):
    out = []
    out += check_combinatorics(d, E)
    out += check_ordering(d)
    out += check_elements(d, E)
    f, derived = check_formulas(d, E)
    out += f
    out += check_pure(d, E)
    out += check_alloys(d, E)
    out += check_thermo(d, E)
    out += check_consistency(d)
    return out, derived


def apply_fixes(d, findings):
    applied = []
    for x in findings:
        if not x.get('fix') or x['status'] == 'ok':
            continue
        ds, key = x['dataset'], ('symbol' if x['dataset'] == 'elements' else 'id')
        for r in d[ds]:
            if r[key] == x['id'] and r.get(x['field']) != x['fix']['value']:
                old, new = r.get(x['field']), x['fix']['value']
                applied.append({'dataset': ds, 'id': x['id'], 'field': x['field'], 'old': old, 'new': new, 'check': x['check']})
                r[x['field']] = new
                if ds == 'states' and isinstance(old, (int, float)) and 'heating_path' in r:  # то же число в тексте пути
                    r['heating_path'] = re.sub(r'(?<!\d)%d(?!\d)' % old, str(new), r['heating_path'])
    return applied


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--apply', action='store_true', help='исправлять точно вычислимое и повторять проход')
    ap.add_argument('--max-iter', type=int, default=3)
    ap.add_argument('--summary-json', action='store_true', help='последней строкой — итог в JSON (для условия цикла в Bench)')
    ap.add_argument('--strict', action='store_true', help='код выхода 1, если в последнем проходе остались fail или warn')
    a = ap.parse_args()
    E = Elements()
    d, fmt = load()
    iterations, all_applied = [], []
    for i in range(1, a.max_iter + 1):
        findings, derived = run_checks(d, E)
        c = Counter(x['status'] for x in findings)
        it = {'pass': i, 'counts': dict(c)}
        fixes = apply_fixes(d, findings) if a.apply else []
        it['applied'] = len(fixes)
        iterations.append(it)
        all_applied += fixes
        print('проход %d: %s; исправлено %d' % (i, ', '.join('%s %d' % kv for kv in sorted(c.items())), len(fixes)))
        if not fixes:
            break
    if all_applied:
        for k in {x['dataset'] for x in all_applied}:
            json.dump(d[k], open(os.path.join(DATA, FILES[k]), 'w', encoding='utf-8'), ensure_ascii=False, indent=fmt[k])
    os.makedirs(os.path.join(DATA, 'checks'), exist_ok=True)
    report = {'sources': {'mendeleev': __import__('mendeleev').__version__, 'pymatgen_table': 'pymatgen-core 2026.10.16',
                          'diagram_constants': DIAGRAMS},
              'stable_elements': len(E.stable_z), 'iterations': iterations, 'applied': all_applied,
              'findings': [{k: v for k, v in x.items() if k != 'fix'} | {'fixable': bool(x.get('fix'))} for x in findings]}
    json.dump(report, open(os.path.join(DATA, 'checks', 'recalc_report.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(derived, open(os.path.join(DATA, 'derived.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    write_md(report)
    if a.summary_json:
        last = iterations[-1]
        print(json.dumps({'passes': len(iterations), 'counts': last['counts'], 'applied': len(all_applied)}, ensure_ascii=False))
    if a.strict and (iterations[-1]['counts'].get('fail') or iterations[-1]['counts'].get('warn')):
        raise SystemExit(1)
    return report


def write_md(rep):
    L = ['# Пересчёт значений карты материалов', '',
         'Источники: mendeleev %s, таблица pymatgen-core; константы диаграмм — по памяти. Стабильных элементов: %d.' % (
             rep['sources']['mendeleev'], rep['stable_elements']), '']
    for it in rep['iterations']:
        L.append('- Проход %d: %s; исправлено %d' % (it['pass'], ', '.join('%s %d' % kv for kv in sorted(it['counts'].items())), it['applied']))
    if rep['applied']:
        L += ['', '## Исправлено автоматически', '', '| Набор | id | Поле | Было | Стало | Проверка |', '| --- | --- | --- | --- | --- | --- |']
        L += ['| %s | %s | %s | %s | %s | %s |' % (x['dataset'], x['id'], x['field'], x['old'], x['new'], x['check']) for x in rep['applied']]
    for st, title in (('fail', 'Ошибки'), ('warn', 'Предупреждения'), ('info', 'К сведению')):
        rows = [x for x in rep['findings'] if x['status'] == st]
        if rows:
            L += ['', '## %s (%d)' % (title, len(rows)), '', '| id | Проверка | Закон или источник | Значение | Ожидается | Пояснение |', '| --- | --- | --- | --- | --- | --- |']
            L += ['| %s | %s | %s | %s | %s | %s |' % (x['id'], x['check'], x['law'], x['value'], x['expected'] if x['expected'] is not None else '', x['note']) for x in rows]
    calc = [x for x in rep['findings'] if x['status'] == 'calc']
    if calc:
        L += ['', '## Рассчитано (%d)' % len(calc), '', '| id | Величина | г/моль | Массовые доли |', '| --- | --- | --- | --- |']
        L += ['| %s | %s | %s | %s |' % (x['id'], x['check'], x['value'], x['note']) for x in calc]
    open(os.path.join(DATA, 'checks', 'recalc_report.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')


if __name__ == '__main__':
    main()
