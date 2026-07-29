/* inspector.js — правая панель: форма параметров строится из схемы блока.
   Ничего не знает про конкретные типы блоков. */

window.Inspector = (function () {

  let $body, $badge, onChange = () => {};
  let current = null;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function field(f, val) {
    const id = 'f_' + f.key;
    const req = f.required ? '<b class="req">*</b>' : '';
    const ph = esc(f.placeholder || '');
    let input;
    switch (f.type) {
      case 'textarea':
        input = `<textarea id="${id}" data-key="${f.key}" rows="4" placeholder="${ph}">${esc(val)}</textarea>`; break;
      case 'code':
        input = `<textarea id="${id}" data-key="${f.key}" class="code" rows="5" spellcheck="false" placeholder="${ph}">${esc(val)}</textarea>`; break;
      case 'number':
        input = `<input id="${id}" data-key="${f.key}" type="number" value="${esc(val)}" step="${f.step != null ? f.step : 1}"
                  ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''}>`; break;
      case 'select':
        input = `<select id="${id}" data-key="${f.key}">${(f.options || []).map(([v, l]) =>
          `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`; break;
      case 'bool':
        return `<label class="fld row" for="${id}"><input id="${id}" data-key="${f.key}" type="checkbox" ${val ? 'checked' : ''}>
                <span class="lbl">${esc(f.label)}</span></label>`;
      case 'list':
        return listField(f, Array.isArray(val) ? val : []);
      case 'tags':
        input = `<input id="${id}" data-key="${f.key}" value="${esc(Array.isArray(val) ? val.join(', ') : val)}" placeholder="${ph}">
                 <span class="hint micro">через запятую</span>`; break;
      default:
        input = `<input id="${id}" data-key="${f.key}" value="${esc(val)}" placeholder="${ph}" spellcheck="false">`;
    }
    return `<div class="fld"><label class="lbl" for="${id}">${esc(f.label)}${req}</label>${input}</div>`;
  }

  /* ── редактор списков (type:'list') ─────────────────────
     Строка = запись, форма справа правит выбранную. Вкладка «сырой JSON»
     нужна не для красоты: полсотни записей вставляют пачкой, а не набивают. */
  const listSel = {};   // key → индекс выбранной строки
  const listRaw = {};   // key → показывать сырой JSON

  function listField(f, items) {
    const key = f.key;
    const sel = Math.min(listSel[key] || 0, Math.max(0, items.length - 1));
    listSel[key] = sel;
    const raw = !!listRaw[key];

    const head = `<div class="sep">
        <span class="micro">${esc(f.label)} · ${items.length}</span>
        <span class="list-tabs">
          <button class="list-tab ${raw ? '' : 'on'}" data-list-tab="${key}" data-raw="0">список</button>
          <button class="list-tab ${raw ? 'on' : ''}" data-list-tab="${key}" data-raw="1">сырой JSON</button>
        </span></div>`;

    if (raw) {
      return head + `<div class="fld">
        <textarea class="code" data-list-raw="${key}" rows="14" spellcheck="false">${esc(JSON.stringify(items, null, 2))}</textarea>
        <span class="hint micro">вставь массив записей и уведи фокус — состав заменится целиком</span></div>`;
    }

    const rows = items.map((it, i) => {
      const label = f.itemLabel ? f.itemLabel(it) : (it.role || `запись ${i + 1}`);
      const badge = f.itemBadge ? f.itemBadge(it) : '';
      return `<div class="list-row ${i === sel ? 'on' : ''}" data-list-pick="${key}" data-idx="${i}">
          <span class="list-dot ${esc(badge || 'inherit')}"></span>
          <span class="list-name">${esc(label)}</span>
        </div>`;
    }).join('') || '<div class="list-empty micro">пусто</div>';

    const cur = items[sel];
    /* Поля записи прячутся по when() так же, как поля блока: у поля-ссылки
       спрашиваем, на какую сущность, а у остальных восьми видов — нет. */
    const detail = cur ? (f.item || []).filter(sub => !sub.when || sub.when(cur)).map(sub => {
      const v = cur[sub.key] !== undefined ? cur[sub.key] : '';
      return field(Object.assign({}, sub, { key: `${key}#${sel}#${sub.key}` }), v);
    }).join('') : '<p class="insp-desc">Добавь запись, чтобы настроить её.</p>';

    return head + `<div class="list-wrap">
      <div class="list-master">
        ${rows}
        <button class="list-add" data-list-add="${key}">+ добавить</button>
      </div>
      <div class="list-detail">
        ${detail}
        ${cur ? `<div class="list-ops">
          <button class="tb" data-list-dup="${key}">Дублировать</button>
          <button class="tb danger" data-list-del="${key}">Удалить</button>
        </div>` : ''}
      </div>
    </div>`;
  }

  /* ── стройка: слой «что уже построено», виден только в режиме стройки ──
     Правки отсюда НЕ идут в план: ни в историю Ctrl+Z, ни в экспорт, ни в бриф. */
  const buildMode = () => document.getElementById('app').classList.contains('mode-build');

  const tsShort = ts => new Date(ts).toLocaleString('ru-RU',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  /* Протух — говорим ЧТО именно разъехалось: правка самого блока и правка
     контракта у соседа сверху лечатся по-разному, и общее «устарел» бесполезно. */
  function driftNote(node) {
    const d = window.Build.drift(node.id);
    if (!d.stale) return '';
    const names = d.deps.map(id => (window.Graph.getNode(id) || {}).name || id);
    const why = [
      d.self ? 'правили сам блок' : '',
      names.length ? 'сменился контракт входа: ' + names.map(n => '«' + n + '»').join(', ') : '',
    ].filter(Boolean).join('; ');
    return `<div class="bdrift-note">
        <span><b>⟳ план ушёл вперёд</b><br>${esc(why)}.
          ${d.at ? 'Отмечено по плану от ' + esc(tsShort(d.at)) + '.' : ''}</span>
        <button class="tb" data-act="build-accept" title="Код перечитан и нынешнему плану соответствует">Принял</button>
      </div>`;
  }

  /* «Кто делает» в Стройке и «Кто отвечает» в плане — разные вещи: первое про
     того, кто пишет код сейчас, второе про того, кто держит кусок системы
     дальше. Не подставляем одно в другое, только показываем рядом. */
  function planOwner(node) {
    const u = String(((node || {}).params || {}).unit || '').trim();
    if (!u) return '';
    const unit = window.Graph.state.nodes.find(x => x.type === 'unit' &&
      String((x.params || {}).name || '').trim() === u);
    const owner = unit ? String((unit.params || {}).owner || '').trim() : '';
    return owner ? `<span class="hint micro">за контур «${esc(u)}» в плане отвечает ${esc(owner)}</span>` : '';
  }

  function buildBlock(node) {
    if (!buildMode() || !window.Build) return '';
    const rec = window.Build.get(node.id);
    const opts = window.Build.STATUSES.map(([v, l]) =>
      `<option value="${v}" ${v === rec.status ? 'selected' : ''}>${esc(l)}</option>`).join('');
    const when = rec.updatedAt
      ? 'отмечено ' + new Date(rec.updatedAt).toLocaleString('ru-RU')
      : 'ещё не отмечалось';
    const log = rec.log.length
      ? rec.log.map(e => `<div class="blog-row"><span class="blog-ts">${esc(tsShort(e.ts))}</span><span>${esc(e.text)}</span></div>`).join('')
      : '<div class="blog-row blog-empty">пока пусто</div>';
    return `<div class="sep"><span class="micro">стройка</span>
        <span class="bpill bstat-${rec.status}">${esc(window.Build.label(rec.status))}</span></div>
      ${driftNote(node)}
      <div class="fld"><label class="lbl" for="build-status">Состояние</label>
        <select id="build-status" data-build-key="status">${opts}</select>
        <span class="hint micro">${esc(when)}</span></div>
      <div class="fld"><label class="lbl" for="build-target">Куда пишем</label>
        <textarea id="build-target" data-build-key="target" rows="2" spellcheck="false"
          placeholder="src/auth/login.py&#10;tests/test_login.py">${esc(rec.target.join('\n'))}</textarea>
        <span class="hint micro">по одному пути в строке — файлы и папки в репозитории</span></div>
      <div class="fld"><label class="lbl" for="build-checks">Чем проверять</label>
        <textarea id="build-checks" data-build-key="checks" rows="2" spellcheck="false"
          placeholder="pytest tests/test_login.py&#10;ruff check src/auth">${esc(rec.checks)}</textarea>
        <span class="hint micro ${rec.checks_ok === false ? 'bad' : rec.checks_ok === true ? 'ok' : ''}">${esc(
          rec.checks_ok === true ? 'зелёные · ' + tsShort(rec.checks_at)
          : rec.checks_ok === false ? 'КРАСНЫЕ · ' + tsShort(rec.checks_at)
          : 'по одной команде в строке · ещё не прогонялись')}</span>
        ${rec.checks_ok === false && rec.checks_out
          ? `<pre class="checks-out">${esc(rec.checks_out.slice(-600))}</pre>` : ''}</div>
      <div class="fld"><label class="lbl" for="build-owner">Кто делает</label>
        <input id="build-owner" data-build-key="owner" value="${esc(rec.owner)}" spellcheck="false"
          placeholder="я · cursor · claude">
        ${planOwner(node)}</div>
      <div class="bops">
        <button class="tb primary" data-act="build-order"
          title="Собрать ТЗ по этому блоку: что построить, что на входе, что обязано получиться">📋 Выдать задание</button>
        <span class="hint micro">срез плана вокруг блока — в буфер и приложению через мост</span>
      </div>
      <div class="sep"><span class="micro">журнал</span></div>
      <div class="blog">${log}</div>
      <div class="fld bnote">
        <input id="build-note" placeholder="что произошло…" spellcheck="false">
        <button class="tb" data-act="build-note" title="Добавить запись (Enter)">Записать</button>
      </div>`;
  }

  function renderNode(node) {
    const d = window.BLOCKS.TYPES[node.type];
    const fields = window.BLOCKS.visibleParams(node.type, node.params)
      .map(f => field(f, node.params[f.key] !== undefined ? node.params[f.key] : '')).join('');
    $badge.innerHTML = `<span class="dot" style="--c:${d.color}"></span>${esc(d.label)}`;
    $body.innerHTML = `
      <div class="insp-title" style="--c:${d.color}">
        <span class="insp-icon">${esc(d.icon)}</span>
        <input class="name-input" id="node-name" value="${esc(node.name)}" spellcheck="false">
      </div>
      <p class="insp-desc">${esc(d.desc)}</p>
      ${buildBlock(node)}
      <div class="fld row"><label class="lbl" for="node-on">Активен</label>
        <input id="node-on" type="checkbox" data-node-flag="enabled" ${node.enabled !== false ? 'checked' : ''}></div>
      <div class="sep"><span class="micro">параметры</span></div>
      ${fields}
      <div class="sep"><span class="micro">заметка</span></div>
      <div class="fld"><textarea id="node-notes" rows="2" placeholder="для чего этот блок…">${esc(node.notes || '')}</textarea></div>
      <div class="insp-foot">
        <code class="idbox" title="id блока">${esc(node.id)}</code>
        <button class="tb danger" data-act="del-node">Удалить блок</button>
      </div>`;
  }

  /* Один слот модели. Ключи пишутся как models.<slot>.<поле>. */
  function modelForm(slot, m) {
    const used = window.Graph.state.nodes.filter(n =>
      n.type === 'agent' && n.params.provider === 'project' && (n.params.model_ref || 'primary') === slot).length;
    const f = (key, label, type, extra) =>
      `<div class="fld"><label class="lbl">${esc(label)}</label>
        <input data-meta="models.${slot}.${key}" type="${type || 'text'}" ${extra || ''} value="${esc(m[key])}" spellcheck="false"></div>`;
    return `<div class="modelcard ${slot}">
      <div class="modelcard-head">
        <b>${esc(m.label)}</b>
        <span class="chip">${used} агент(ов)</span>
      </div>
      ${f('model', 'Модель', 'text')}
      ${f('base_url', 'Base URL', 'text')}
      ${f('api_key_env', 'Ключ из переменной окружения', 'text')}
      <div class="model-2col">
        ${f('context_tokens', 'Контекст, токенов', 'number', 'min="1" step="1"')}
        ${f('max_output_tokens', 'Потолок ответа', 'number', 'min="1" step="1"')}
      </div>
    </div>`;
  }

  function renderMeta() {
    const s = window.Graph.state;
    $badge.innerHTML = '<span class="dot" style="--c:#f5a524"></span>Конвейер';
    $body.innerHTML = `
      <div class="insp-title" style="--c:#f5a524"><span class="insp-icon">◇</span>
        <input class="name-input" id="meta-name" value="${esc(s.name)}" spellcheck="false"></div>
      <p class="insp-desc">Выбери блок на холсте, чтобы настроить его. Здесь — общие настройки конвейера.</p>
      <div class="sep"><span class="micro">конвейер</span></div>
      <div class="fld"><label class="lbl" for="meta-desc">Описание</label>
        <textarea id="meta-desc" data-meta="description" rows="3">${esc(s.meta.description)}</textarea></div>
      <div class="fld"><label class="lbl" for="meta-workdir">Рабочая папка</label>
        <input id="meta-workdir" data-meta="workdir" value="${esc(s.meta.workdir)}" spellcheck="false"></div>
      <div class="fld"><label class="lbl" for="meta-par">Глобальный лимит параллельности</label>
        <input id="meta-par" data-meta="max_parallel" type="number" min="1" step="1" value="${esc(s.meta.max_parallel)}"></div>
      <div class="fld"><label class="lbl" for="meta-stage">Стадия</label>
        <select id="meta-stage" data-meta="stage">
          <option value="plan" ${(s.meta.stage || 'plan') === 'plan' ? 'selected' : ''}>план — проверяем только структуру</option>
          <option value="wiring" ${s.meta.stage === 'wiring' ? 'selected' : ''}>подключения — проверяем всё</option>
        </select></div>
      <div class="fld"><label class="lbl" for="meta-log">Уровень логов</label>
        <select id="meta-log" data-meta="log_level">
          ${['debug', 'info', 'warn', 'error'].map(v => `<option ${v === s.meta.log_level ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
      <div class="sep"><span class="micro">модели проекта</span></div>
      <p class="insp-desc">Агент по умолчанию берёт модель отсюда, а не хранит endpoint у себя.
        Поменял здесь — поменялось у всех агентов сразу.</p>
      ${modelForm('primary', s.meta.models.primary)}
      ${modelForm('heavy', s.meta.models.heavy)}
      <div class="fld"><label class="lbl" for="meta-reserve">Запас контекста под ответ, токенов</label>
        <input id="meta-reserve" data-meta="input_reserve_tokens" type="number" min="0" step="1" value="${esc(s.meta.input_reserve_tokens)}"></div>

      <div class="sep"><span class="micro">статистика</span></div>
      <div class="stats">
        <div><b>${s.nodes.length}</b><span class="micro">блоков</span></div>
        <div><b>${s.edges.filter(e => e.kind === 'flow').length}</b><span class="micro">связей</span></div>
        <div><b>${s.edges.filter(e => e.kind === 'data').length}</b><span class="micro">знаний</span></div>
      </div>`;
  }

  function show(ids) {
    current = (ids && ids.length === 1) ? window.Graph.getNode(ids[0]) : null;
    if (current) renderNode(current);
    else if (ids && ids.length > 1) {
      $badge.innerHTML = `<span class="dot" style="--c:#8b7cf6"></span>${ids.length} блока(ов)`;
      $body.innerHTML = `<p class="insp-desc">Выделено ${ids.length}. Тяни мышью — переместятся вместе.
        <br><b>Ctrl+D</b> — дублировать, <b>Del</b> — удалить.</p>`;
    } else renderMeta();
  }

  const coerce = (f, el) => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (f && f.type === 'number') v = v === '' ? '' : Number(v);
    if (f && f.type === 'tags') v = String(v).split(',').map(s => s.trim()).filter(Boolean);
    return v;
  };

  /* Поле внутри списка приходит ключом «список#индекс#поле». */
  function commitListField(el) {
    const [key, idxRaw, sub] = el.dataset.key.split('#');
    const parent = (window.BLOCKS.TYPES[current.type].params || []).find(p => p.key === key);
    if (!parent) return;
    const idx = +idxRaw;
    const items = current.params[key] || (current.params[key] = []);
    if (!items[idx]) return;
    const f = (parent.item || []).find(p => p.key === sub);
    items[idx][sub] = coerce(f, el);

    // выбор вида записи открывает и закрывает соседние поля — как у блока
    if (f && (f.type === 'select' || f.type === 'bool') &&
        (parent.item || []).some(p => p.when)) { renderNode(current); onChange('param'); return; }

    // подпись строки в списке обновляем на месте, чтобы не терять фокус
    const row = $body.querySelector(`[data-list-pick="${key}"][data-idx="${idx}"]`);
    if (row) {
      row.querySelector('.list-name').textContent = parent.itemLabel ? parent.itemLabel(items[idx]) : (items[idx].role || '');
      if (parent.itemBadge) row.querySelector('.list-dot').className = 'list-dot ' + (parent.itemBadge(items[idx]) || 'inherit');
    }
    onChange('param');
  }

  function commitField(el) {
    const key = el.dataset.key;
    if (!key || !current) return;
    if (key.includes('#')) return commitListField(el);
    const f = (window.BLOCKS.TYPES[current.type].params || []).find(p => p.key === key);
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (f && f.type === 'number') v = v === '' ? '' : Number(v);
    if (f && f.type === 'tags') v = String(v).split(',').map(s => s.trim()).filter(Boolean);
    current.params[key] = v;
    // поля с when() могут появиться/исчезнуть
    if (f && (f.type === 'select' || f.type === 'bool')) renderNode(current);
    onChange('param');
  }

  function init(opts) {
    onChange = opts.onChange || onChange;
    $body = document.getElementById('insp-body');
    $badge = document.getElementById('insp-badge');

    $body.addEventListener('input', e => {
      const el = e.target;
      if (el.id === 'node-name' && current) { current.name = el.value; onChange('rename'); return; }
      if (el.id === 'node-notes' && current) { current.notes = el.value; onChange('notes'); return; }
      if (el.id === 'meta-name') { window.Graph.state.name = el.value; document.getElementById('pipeline-name').value = el.value; onChange('meta'); return; }
      if (el.dataset.meta) {
        const v = el.type === 'number' ? Number(el.value) : el.value;
        const path = el.dataset.meta.split('.');            // models.primary.model
        let t = window.Graph.state.meta;
        while (path.length > 1) t = t[path.shift()];
        t[path[0]] = v;
        onChange('meta'); return;
      }
      if (el.dataset.nodeFlag && current) { current.enabled = el.checked; onChange('flag'); return; }
      commitField(el);
    });

    $body.addEventListener('change', e => {
      /* стройка отдельно от плана: своё хранилище, onChange не зовём — план не менялся */
      if (e.target.dataset.buildKey && current) {
        const k = e.target.dataset.buildKey;
        const v = k === 'target' ? e.target.value.split('\n').map(s => s.trim()).filter(Boolean)
                                 : e.target.value;
        window.Build.set(current.id, { [k]: v });
        return renderNode(current);
      }
      if (e.target.dataset.key) commitField(e.target);
      if (e.target.dataset.nodeFlag && current) { current.enabled = e.target.checked; onChange('flag'); }
    });

    /* запись в журнал стройки: кнопкой или Enter в поле */
    const addNote = () => {
      const inp = document.getElementById('build-note');
      if (!inp || !current) return;
      window.Build.note(current.id, inp.value);
      renderNode(current);
    };
    $body.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'build-note') { e.preventDefault(); addNote(); }
    });

    $body.addEventListener('click', e => {
      if (e.target.dataset.act === 'build-note') return addNote();
      if (e.target.dataset.act === 'build-accept' && current) {
        window.Build.accept(current.id);
        return renderNode(current);
      }
      if (e.target.dataset.act === 'build-order' && current) return window.App.issueOrder(current.id);
      if (e.target.dataset.act === 'del-node' && current) {
        window.Editor.select(current.id); window.Editor.deleteSelection();
        return;
      }
      if (!current) return;
      const t = e.target.closest('[data-list-pick],[data-list-add],[data-list-dup],[data-list-del],[data-list-tab]');
      if (!t) return;
      const d = t.dataset;

      if (d.listTab) { listRaw[d.listTab] = d.raw === '1'; return renderNode(current); }
      if (d.listPick !== undefined && d.listPick !== '') { listSel[d.listPick] = +d.idx; return renderNode(current); }

      const key = d.listAdd || d.listDup || d.listDel;
      const parent = (window.BLOCKS.TYPES[current.type].params || []).find(p => p.key === key);
      if (!parent) return;
      const items = current.params[key] || (current.params[key] = []);
      const sel = listSel[key] || 0;

      if (d.listAdd) {
        const blank = {};
        for (const s of (parent.item || [])) blank[s.key] = s.default !== undefined ? s.default : '';
        items.push(blank); listSel[key] = items.length - 1;
      }
      if (d.listDup && items[sel]) { items.splice(sel + 1, 0, JSON.parse(JSON.stringify(items[sel]))); listSel[key] = sel + 1; }
      if (d.listDel && items[sel]) { items.splice(sel, 1); listSel[key] = Math.max(0, sel - 1); }

      renderNode(current); onChange('list');
    });

    /* сырой JSON: заменяем состав целиком, но только если он разобрался */
    $body.addEventListener('change', e => {
      const key = e.target.dataset.listRaw;
      if (!key || !current) return;
      try {
        const parsed = JSON.parse(e.target.value);
        if (!Array.isArray(parsed)) throw new Error('ожидается массив записей');
        current.params[key] = parsed;
        listSel[key] = 0;
        e.target.classList.remove('bad');
        renderNode(current); onChange('list');
      } catch (err) {
        e.target.classList.add('bad');
        window.App.toast('JSON не разобран: ' + err.message, 'err');
      }
    });

    /* Tab внутри кода не должен уводить фокус */
    $body.addEventListener('keydown', e => {
      if (e.key === 'Tab' && e.target.classList.contains('code')) {
        e.preventDefault();
        const t = e.target, s = t.selectionStart;
        t.value = t.value.slice(0, s) + '  ' + t.value.slice(t.selectionEnd);
        t.selectionStart = t.selectionEnd = s + 2;
        commitField(t);
      }
    });
  }

  return { init, show, get current() { return current; } };
})();
