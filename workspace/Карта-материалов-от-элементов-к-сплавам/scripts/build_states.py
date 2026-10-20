"""Свести ответы агентов в data/phase_states.json.

Запуск из папки проекта: python3 scripts/build_states.py data/raw data/phase_states.json
Правки поверх ответов агентов (ov) — значения по памяти; conf показывает, откуда число.
"""
import json, glob, sys
src = sys.argv[1]; out = sys.argv[2]
rows = []
for f in sorted(glob.glob(src + '/batch*.json')):
    rows += json.load(open(f))
by = {r['id']: r for r in rows}
MEM = 'по памяти'
def ov(i, **kw):
    r = by[i]
    for k, v in kw.items(): r[k] = v
    if kw.get('conf') is None and any(k in kw for k in ('melt_low_C','melt_high_C','boil_C','decomp_C')):
        r['conf'] = MEM
# batch 2: numbers from reference knowledge (pages could not be opened)
ov('al2o3', melt_low_C=2072, melt_high_C=2072, boil_C=2977, decomp_C=None, liquid_exists=True,
   heating_path='γ/θ-Al₂O₃ → α-Al₂O₃ (корунд, ≈1100–1200 °C) → жидкое (2072 °C) → газ (≈2977 °C)',
   note='Числа для корунда (α-Al₂O₃); переходные полиморфы необратимо переходят в корунд при нагреве.', source=None)
ov('sio2', melt_low_C=1713, melt_high_C=1713, boil_C=2950, decomp_C=None, liquid_exists=True,
   heating_path='α-кварц → β-кварц (573 °C) → тридимит (≈870 °C) → кристобалит (≈1470 °C) → жидкое (1713 °C) → газ (≈2950 °C)',
   note='Плавление указано для кристобалита; кварц при быстром нагреве плавится около 1670 °C.', source=None)
ov('tio2', melt_low_C=1843, melt_high_C=1843, boil_C=2972, decomp_C=None, liquid_exists=True,
   heating_path='анатаз/брукит → рутил (≈600–700 °C) → жидкое (1843 °C) → газ (≈2972 °C)',
   note='Плавление для рутила; анатаз и брукит до плавления не доживают.', source=None)
ov('sic', melt_low_C=None, melt_high_C=None, boil_C=None, decomp_C=2730, liquid_exists=False,
   heating_path='твёрдое → разложение на Si (пар) и графит (≈2730 °C; по источникам 2700–2830 °C)',
   note='Жидкой фазы при 1 атм нет; источники дают 2700–2830 °C, взято ≈2730 °C.', source=None)
ov('si3n4', melt_low_C=None, melt_high_C=None, boil_C=None, decomp_C=1900, liquid_exists=False,
   heating_path='α → β-Si₃N₄ (≈1400–1600 °C) → разложение на Si и N₂ (≈1900 °C)',
   note='Не плавится при 1 атм; разлагается около 1900 °C.', source=None)
# кипение WC (≈6000 °C) только в тексте: число растягивало шкалу графика вдвое
ov('wc', melt_low_C=2785, melt_high_C=2870, boil_C=None, decomp_C=None, liquid_exists=True,
   heating_path='твёрдое → жидкое (W₂C ≈2785 °C, WC ≈2870 °C, инконгруэнтно) → газ (≈6000 °C, оценка)',
   note='WC плавится инконгруэнтно; оценки 2785–2870 °C, кипение ≈6000 °C — порядок величины.', source=None)
# corrections
ov('p_allo', melt_high_C=44, conf=None)
by['p_allo']['note'] = 'Плавление и кипение — белый P; красный P при 1 атм возгоняется ≈416 °C (плавится ≈590 °C лишь под давлением).'
ov('fe_allo', boil_C=2862, conf=None); by['fe_allo']['heating_path'] = by['fe_allo']['heating_path'].replace('2861', '2862')
ov('steel', boil_C=2862, conf=None); by['steel']['heating_path'] = 'твёрдое → двухфазная зона (≈1370–1540 °C) → жидкое → газ (≈2862 °C, основа Fe)'
# разбор пересчёта: солидус двойной системы — эвтектика Fe–C (1147 °C метастабильная, 1153 °C стабильная), не 1140
ov('castiron', melt_low_C=1147, melt_high_C=1250, conf=None)
by['castiron']['heating_path'] = 'твёрдое → эвтектика (≈1147–1153 °C) → двухфазная зона → жидкое (ликвидус до ≈1250 °C) → газ (≈2862 °C, основа Fe)'
by['castiron']['note'] = 'Солидус — эвтектика Fe–C (1147 °C с цементитом, 1153 °C с графитом); Si и P её сдвигают. Ликвидус доэвтектических серых чугунов до ≈1250 °C (по памяти).'
# из цикла пересчёта (обе базы элементов сходятся): кипение Al 2519 °C, у агента было 2470
ov('al_wr', boil_C=2519, conf=None); by['al_wr']['heating_path'] = by['al_wr']['heating_path'].replace('2470', '2519')
ov('stainless', melt_high_C=1510, conf=None)
by['stainless']['heating_path'] = 'твёрдое → двухфазная зона (≈1375–1510 °C) → жидкое → газ (≈2862 °C, основа Fe)'
by['stainless']['note'] = '304/316 ≈1375–1455 °C (сниппет); ферритная 430 до ≈1510 °C (по памяти).'
ov('miner', melt_high_C=3350, conf=None)
by['miner']['heating_path'] = 'от жидкого при 25 °C (самородная ртуть, −39 °C) до плавления ≈3350 °C (торианит ThO₂)'
by['miner']['note'] = 'Почти все минералы твёрдые при 25 °C; диапазон — от самородной ртути до торианита (ThO₂, по памяти).'
ov('hea', melt_low_C=1280, melt_high_C=1340, boil_C=None, liquid_exists=True)
by['hea']['heating_path'] = 'твёрдое (ГЦК) → двухфазная зона (≈1280–1340 °C, сплав Кантора) → жидкое'
by['hea']['note'] = 'Числа для CoCrFeMnNi (сплав Кантора), по памяти; тугоплавкие ВЭС плавятся намного выше.'
ov('cfrp', melt_low_C=None, melt_high_C=None, decomp_C=300, liquid_exists=False, conf=None)
by['cfrp']['note'] = 'Стеклование эпоксидной матрицы ≈120–200 °C — не плавление; смола разлагается ≈300–450 °C, волокно остаётся.'
by['cement']['note'] = 'Затвердевший камень разлагается с ≈100 °C; частичное плавление — у клинкера в печи (≈1250–1450 °C).'
by['glass']['note'] = 'Аморфное: вместо плавления — стеклование (≈520–570 °C) и размягчение (≈720 °C), натрий-кальциевое стекло.'
by['cu_al']['note'] = (by['cu_al'].get('note') or '') + ' × при 907 °C — кипение цинка из латуней.'
# confidence + source labels
out_rows = []
for r in rows:
    r = by[r['id']]
    if r.get('conf') != MEM:
        r['conf'] = 'сниппет поиска' if r.get('source') else MEM
    r['source'] = r.get('source') or 'по памяти (Claude)'
    out_rows.append({k: r.get(k) for k in ['id','state_25C','melt_low_C','melt_high_C','boil_C','decomp_C','liquid_exists','heating_path','note','conf','source']})
json.dump(out_rows, open(out, 'w'), ensure_ascii=False, indent=1)
print(len(out_rows))
for r in out_rows: print(r['id'], r['melt_low_C'], r['melt_high_C'], r['boil_C'], r['decomp_C'], r['conf'])
