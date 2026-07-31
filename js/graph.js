/* graph.js — модель графа: узлы, связи, проверка, план выполнения.
   Никакого DOM здесь нет. */

window.Graph = (function () {

  /* Модели объявляются один раз на проект; агенты ссылаются на слот
     (primary / heavy), а не хранят endpoint у себя. Сменил модель в одном
     месте — поменялась у всех агентов. */
  const MODELS = () => ({
    primary: {
      label: 'Основная', provider: 'openai-compatible',
      base_url: 'https://api.gonka24.com/v1', model: 'qwen3-235b',
      api_key_env: 'GONKA_API_KEY',
      context_tokens: 160000,      // нижняя граница заявленных 160–200к
      max_output_tokens: 16384,    // жёсткий потолок ответа у этого шлюза
    },
    heavy: {
      label: 'Тяжёлая', provider: 'openai-compatible',
      base_url: '', model: 'glm-5.2',
      api_key_env: 'GLM_API_KEY',
      context_tokens: 1000000,
      max_output_tokens: 32768,
    },
  });

  const META = () => ({
    description: '', workdir: '', max_parallel: 4, log_level: 'info',
    stage: 'plan',                 // план / подключения — влияет только на строгость проверки
    input_reserve_tokens: 8000,    // запас под ответ и служебные поля
    models: MODELS(),
  });

  const state = {
    version: 1,
    name: 'Новый конвейер',
    meta: META(),
    nodes: [],
    edges: [],
    seq: 1,
  };

  /* Слот модели, которым реально пользуется агент. */
  function modelOf(node) {
    if (node.type !== 'agent') return null;
    if (node.params.provider !== 'project') {
      return { label: 'свой endpoint', model: node.params.model, base_url: node.params.base_url,
               api_key_env: node.params.api_key_env, context_tokens: null, max_output_tokens: null };
    }
    return state.meta.models[node.params.model_ref || 'primary'] || null;
  }

  const T = () => window.BLOCKS.TYPES;
  /* Точка входа объявляется флагом у типа блока, а не списком типов здесь.
     Раньше «Вход данных» был вписан в graph.js по имени в трёх местах, и любой
     новый самозапускающийся блок («Ремонт») молча выпадал из очереди. */
  const entryType = n => { const d = T()[n.type]; return !!(d && d.entry); };

  /* Хост из адреса: «https://billing.internal/v1/charges» → «billing.internal»,
     «api.stripe.com:443» → «api.stripe.com». Если адрес не похож на сетевой
     (путь, канал, имя файла) — возвращаем null и молчим: не всякое поле-адрес
     означает выход в сеть. */
  function hostOf(v) {
    const s = String(v == null ? '' : v).trim();
    let m = s.match(/^[a-z][a-z0-9+.-]*:\/\/([^/\s:?#]+)/i);
    if (m) return m[1].toLowerCase();
    m = s.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?(?:[/\s]|$)/i);
    return m ? m[1].toLowerCase() : null;
  }

  /* ── базовые операции ───────────────────────────────── */

  function newId(prefix) { return prefix + '_' + (state.seq++).toString(36) + Math.random().toString(36).slice(2, 5); }

  function addNode(type, x, y, params) {
    const def = T()[type];
    if (!def) throw new Error('неизвестный тип блока: ' + type);
    const n = {
      id: newId(type), type, name: def.label,
      x: Math.round(x), y: Math.round(y),
      enabled: true,
      params: Object.assign(window.BLOCKS.defaults(type), params || {}),
      notes: '',
    };
    state.nodes.push(n);
    return n;
  }

  function getNode(id) { return state.nodes.find(n => n.id === id) || null; }

  function removeNode(id) {
    state.nodes = state.nodes.filter(n => n.id !== id);
    state.edges = state.edges.filter(e => e.from.node !== id && e.to.node !== id);
  }

  function canConnect(from, to) {
    if (!from || !to) return 'нет порта';
    if (from.node === to.node) return 'нельзя связать блок сам с собой';
    const fp = window.BLOCKS.findPort(getNode(from.node), 'out', from.port);
    const tp = window.BLOCKS.findPort(getNode(to.node), 'in', to.port);
    if (!fp || !tp) return 'порт не найден';
    if (fp.kind !== tp.kind) return fp.kind === 'data' ? 'знания подключаются в порт «знания»' : 'несовместимые порты';
    if (state.edges.some(e => e.from.node === from.node && e.from.port === from.port &&
                              e.to.node === to.node && e.to.port === to.port)) return 'такая связь уже есть';
    return null;
  }

  function addEdge(from, to) {
    const err = canConnect(from, to);
    if (err) return { error: err };
    const tp = window.BLOCKS.findPort(getNode(to.node), 'in', to.port);
    // одиночный вход — новая связь вытесняет старую
    if (!tp.multi) state.edges = state.edges.filter(e => !(e.to.node === to.node && e.to.port === to.port));
    const e = { id: newId('e'), from: { ...from }, to: { ...to }, kind: tp.kind };
    state.edges.push(e);
    return { edge: e };
  }

  function removeEdge(id) { state.edges = state.edges.filter(e => e.id !== id); }

  /* Порты могут исчезнуть при правке параметров (варианты «Выбора») —
     убираем связи, которым больше некуда цепляться. */
  function pruneEdges() {
    state.edges = state.edges.filter(e => {
      const a = getNode(e.from.node), b = getNode(e.to.node);
      return a && b && window.BLOCKS.findPort(a, 'out', e.from.port) && window.BLOCKS.findPort(b, 'in', e.to.port);
    });
  }

  function edgesOf(nodeId) { return state.edges.filter(e => e.from.node === nodeId || e.to.node === nodeId); }

  /* Обратная связь цикла: всё, что входит в порт loop_back */
  const isBackEdge = e => e.to.port === 'loop_back';

  function targets(nodeId, port) {
    return state.edges.filter(e => e.from.node === nodeId && e.from.port === port && !isBackEdge(e)).map(e => e.to.node);
  }

  function incoming(nodeId, kind) {
    return state.edges.filter(e => e.to.node === nodeId && (!kind || e.kind === kind));
  }

  /* ── план выполнения ────────────────────────────────── */
  /* Дерево шагов: [{id, depth, tag, repeat}] — обратные рёбра цикла не разворачиваются. */
  function plan() {
    const steps = [];
    const visited = new Set();
    /* branches[id] = путь ветвлений до блока, элементы «узел|порт».
       Нужен, чтобы отличать взаимоисключающие ветки от одновременных. */
    const branches = {};

    /* Блоки без flow-портов (базы знаний, контекст, заметки) в потоке не
       участвуют вообще — их не ищем ни среди корней, ни среди недостижимых. */
    const inFlow = n => window.BLOCKS.portsOf(n, 'in').concat(window.BLOCKS.portsOf(n, 'out'))
      .some(p => p.kind === 'flow');

    /* Корни = «Старт» и самопитающийся «Вход данных» — та же логика, что isEntry
       в validate(). Иначе, если в графе есть «Старт», ветка от «Входа данных»
       молча выпадала из очереди/прогона и объявлялась недостижимой. */
    const noInFlow = n => !state.edges.some(e => e.to.node === n.id && e.kind === 'flow' && !isBackEdge(e));
    let roots = state.nodes.filter(n => n.type === 'start' || (entryType(n) && noInFlow(n)));
    if (!roots.length) roots = state.nodes.filter(n => inFlow(n) && noInFlow(n));

    function walk(id, depth, tag, branch) {
      const node = getNode(id);
      if (!node) return;
      if (visited.has(id)) { steps.push({ id, depth, tag, repeat: true }); return; }
      visited.add(id);
      steps.push({ id, depth, tag });
      branches[id] = branch;

      if (node.type === 'loop') {
        targets(id, 'body').forEach(t => walk(t, depth + 1, 'тело цикла', branch));
        targets(id, 'done').forEach(t => walk(t, depth, 'после цикла', branch));
      } else if (node.type === 'condition') {
        targets(id, 'true').forEach(t => walk(t, depth + 1, 'если да', branch.concat(id + '|true')));
        targets(id, 'false').forEach(t => walk(t, depth + 1, 'если нет', branch.concat(id + '|false')));
      } else if (node.type === 'queue') {
        const tag2 = node.params.mode === 'parallel'
          ? `параллельно ×${node.params.concurrency || 1}`
          : 'последовательно';
        targets(id, 'out').forEach(t => walk(t, depth + 1, tag2, branch));
      } else if (node.type === 'choice') {
        // «один вариант» — ветки исключают друг друга; «несколько галочек» — нет
        const excl = node.params.mode === 'single';
        for (const p of window.BLOCKS.portsOf(node, 'out'))
          targets(id, p.id).forEach(t => walk(t, depth + 1, 'если отмечено: ' + p.label,
            excl ? branch.concat(id + '|' + p.id) : branch));
      } else {
        for (const p of window.BLOCKS.portsOf(node, 'out')) {
          if (p.kind !== 'flow') continue;
          targets(id, p.id).forEach(t => walk(t, depth, '', branch));
        }
      }
    }

    roots.forEach(r => walk(r.id, 0, '', []));
    const orphans = state.nodes.filter(n => !visited.has(n.id) && inFlow(n));
    return { steps, orphans, branches };
  }

  /* ── проверка ───────────────────────────────────────── */
  /* Параметры, которые заполняются, когда пишется бэкенд, а не когда рисуется план. */
  const WIRING_KEYS = ['base_url', 'uri', 'api_key_env', 'repo'];

  function validate() {
    const issues = [];
    /* kind:'wiring' — про подключения. На стадии «план» такие замечания
       становятся списком дел, а не ошибками: бэкенд пишется в конце. */
    const add = (level, text, node, kind) => issues.push({ level, text, node: node || null, kind: kind || 'structure' });

    if (!state.nodes.length) { add('warn', 'Конвейер пуст — добавь блок «Старт».'); return issues; }
    /* Точка входа — «Старт» либо «Вход данных», который никто не питает:
       у него своё расписание (интервал, реальное время, событие), он и есть начало. */
    const isEntry = n => n.type === 'start' ||
      (entryType(n) && !state.edges.some(e => e.kind === 'flow' && e.to.node === n.id));
    if (!state.nodes.some(isEntry))
      add('warn', 'Нет точки входа: добавь блок «Старт» или «Вход данных» со своим расписанием.');

    /* Ошибку объявили маршрутом, а провод никуда не ведёт — сбойный элемент
       просто исчезнет. Замечание про подключения (kind:'wiring'), а не ошибка:
       изолятор может рисоваться следующим шагом. */
    const wired = (n, port) => state.edges.some(e => e.from.node === n.id && e.from.port === port);
    state.nodes.forEach(n => {
      if (!n.params || n.params.on_error !== 'route') return;
      if (!wired(n, 'err'))
        add('warn', `«${n.name}»: ошибка уводится по проводу, но провод никуда не ведёт — сбойный элемент потеряется.`, n.id, 'wiring');
    });

    /* Проверки развязки. Брокер без подписчика — это не буфер, а тупик, куда
       молча уходят сообщения; брокер без изолятора теряет всё, что исчерпало
       попытки; «Ремонт», указывающий на несуществующий изолятор, не запустится. */
    state.nodes.forEach(n => {
      /* Контур указан по имени — значит опечатка обязана быть видна: иначе
         блок молча окажется вне всякого контура, то есть без перезапуска. */
      const u = String((n.params || {}).unit || '').trim();
      if (u && !state.nodes.some(d => d.type === 'unit' && String((d.params || {}).name || '').trim() === u))
        add('warn', `«${n.name}»: единицы развёртывания «${u}» нет в плане — проверь имя.`, n.id, 'wiring');

      /* Выход наружу должен быть разрешён сетевой политикой контура. Какие
         параметры считаются адресом, объявляет ТИП флагом egress — graph.js
         не знает их имён. Внутренние связи не проверяем: в системе с брокером
         направление ребра не равно направлению вызова (потребитель сам идёт
         к шине), и правила вышли бы задом наперёд. */
      if (u) {
        const own = state.nodes.find(d => d.type === 'unit' && String((d.params || {}).name || '').trim() === u);
        if (own && (own.params || {}).network !== 'open') {
          const allowed = ((own.params || {}).egress_external || []).map(hostOf).filter(Boolean);
          for (const f of window.BLOCKS.visibleParams(n.type, n.params)) {
            if (!f.egress) continue;
            const h = hostOf(n.params[f.key]);
            if (h && allowed.indexOf(h) < 0)
              add('warn', `«${n.name}»: ходит на ${h}, а контуру «${u}» это не разрешено — добавь адрес в «Куда пускаем наружу».`, n.id, 'wiring');
          }
        }
      }

      /* Прямая связь между контурами, минуя буфер, — это синхронный вызов
         чужого сервиса: контур знает о существовании соседа и падает вместе с
         ним. Ровно то, против чего заводился брокер. */
      for (const e of state.edges) {
        if (e.kind !== 'flow' || e.from.node !== n.id) continue;
        if (e.from.port === 'err' || e.from.port === 'dlq') continue;
        const b = getNode(e.to.node);
        if (!b || isBuffer(n) || isBuffer(b)) continue;
        const ub = unitOf(b);
        if (!u || !ub || u === ub) continue;
        /* Жёсткая связь между контурами РАЗНЫХ владельцев — это уже не только
           техника: чинить её придётся через договорённость, а не правкой. */
        const oa = ownerOfUnit(u), ob = ownerOfUnit(ub);
        add('warn', `«${n.name}» (${u}) напрямую вызывает «${b.name}» (${ub}) — контуры связаны жёстко, сбой одного остановит другой. Между ними просится брокер.` +
          (oa && ob && oa !== ob ? ` И отвечают за них разные: ${oa} ↔ ${ob} — такую связь не починить в одиночку.` : ''), n.id, 'wiring');
      }

      /* Блок, не приписанный ни к одному контуру, нечем развернуть и нечем
         перезапустить. Спрашиваем, только когда контуры в плане вообще есть. */
      if (!u && state.nodes.some(d => d.type === 'unit') &&
          ((T()[n.type] || {}).params || []).some(f => f.key === 'unit'))
        add('info', `«${n.name}»: не назначен ни в один контур — его нечем развернуть и нечем перезапустить.`, n.id, 'wiring');

      /* ── нефункциональные требования: арифметика, а не декларация ──────
         Объявленная нагрузка обязана сходиться с числами схемы, иначе реплики
         и лимиты остаются выдуманными. */
      const rps = Number((n.params || {}).rps) || 0;
      if (rps > 0) {
        const peak = Number(n.params.peak_factor) || 1;
        const one = Number(n.params.rps_one) || 0;
        const own = u && state.nodes.find(d => d.type === 'unit' && String((d.params || {}).name || '').trim() === u);
        if (own) {
          const reps = Number((own.params || {}).replicas) || 1;
          if (one > 0) {
            const need = Math.ceil((rps * peak) / one);
            if (need > reps)
              add('warn', `«${n.name}»: нужно ${need} реплик (${rps.toFixed(3)} шт/с ×${peak.toFixed(3)} на пике при ${one.toFixed(3)} на реплику), а в контуре «${u}» их ${reps}.`, n.id);
          }
          /* Нагрузку объявили, а наблюдать её нечем — проверить после постройки,
             что требование выполнено, будет невозможно. */
          if (!((own.params || {}).metrics || []).length)
            add('info', `«${n.name}»: нагрузка объявлена, но у контура «${u}» нет метрик — подтвердить её после постройки будет нечем.`, n.id, 'wiring');
        }

        /* Узкое место: ниже по течению требование меньше, чем сверху. Очередь
           будет расти, пока не упрётся в срок хранения. Порты ошибки и изолятора
           не считаем — там поток заведомо другой. */
        for (const e of state.edges) {
          if (e.kind !== 'flow' || e.from.node !== n.id) continue;
          if (e.from.port === 'err' || e.from.port === 'dlq') continue;
          const b = getNode(e.to.node);
          const rb = Number((b && b.params || {}).rps) || 0;
          if (rb > 0 && rb < rps)
            add('warn', `«${n.name}» отдаёт ${rps.toFixed(3)} шт/с, а «${b.name}» рассчитан на ${rb.toFixed(3)} — узкое место.`, n.id);
        }
      }

      /* Шаг дольше невидимости сообщения: брокер решит, что потребитель умер,
         и отдаст тот же элемент второму. Получим двойную обработку — ровно то,
         от чего защищались идемпотентностью, но уже штатно, а не при сбое. */
      const lat = Number((n.params || {}).latency_ms) || 0;
      if (lat > 0) {
        for (const e of state.edges) {
          if (e.kind !== 'flow' || e.to.node !== n.id) continue;
          const a = getNode(e.from.node);
          if (!a || a.type !== 'broker' || (a.params || {}).ack !== 'manual') continue;
          const vis = Number((a.params || {}).visibility_s) || 0;
          if (vis > 0 && lat / 1000 > vis)
            add('warn', `«${n.name}»: шаг занимает ${(lat / 1000).toFixed(3)} с, а «${a.name}» отдаёт сообщение другому через ${vis.toFixed(3)} с — будет двойная обработка.`, n.id);
        }
      }

      /* Публикация в шину без outbox: между записью в базу и публикацией есть
         окно, в котором падение оставит запись без события. Идемпотентность
         потребителя это НЕ лечит — лечить нечего, события просто нет. */
      if ((n.params || {}).publish_mode !== undefined &&
          state.edges.some(e => e.kind === 'flow' && e.from.node === n.id &&
                                (getNode(e.to.node) || {}).type === 'broker')) {
        if (n.params.publish_mode === 'none')
          add('info', `«${n.name}»: публикует в шину, но способ публикации не выбран.`, n.id, 'wiring');
        else if (n.params.publish_mode === 'direct')
          add('info', `«${n.name}»: публикует сразу после записи — падение между ними оставит запись без события. Надёжнее outbox.`, n.id, 'wiring');
      }

      if (n.type === 'broker') {
        if (!wired(n, 'out'))
          add('warn', `«${n.name}»: на тему никто не подписан — сообщения некому забирать.`, n.id, 'wiring');
        if (!wired(n, 'dlq'))
          add('warn', `«${n.name}»: изолятор не подключён — после ${n.params.max_attempts || '?'} попыток сообщение потеряется.`, n.id, 'wiring');
      }
      if (n.type === 'unit') {
        const nm = String((n.params || {}).name || '').trim();
        if (nm && !state.nodes.some(m => String((m.params || {}).unit || '').trim() === nm))
          add('info', `«${n.name}»: в контуре нет ни одного блока — некого разворачивать.`, n.id, 'wiring');
        /* Контур без мониторинга — слепая зона: сбой внутри него виден только
           по косвенным признакам, а «лечение» нечем подтвердить. */
        const to = String((n.params || {}).logs_to || '').trim();
        if (!to)
          add('info', `«${n.name}»: логи никуда не пишутся — сбой внутри контура будет не виден.`, n.id, 'wiring');
        else if (!state.nodes.some(d => d.type === 'monitor' && String((d.params || {}).name || '').trim() === to))
          add('warn', `«${n.name}»: системы мониторинга «${to}» нет в плане — проверь имя.`, n.id, 'wiring');

        /* Логи говорят, ЧТО случилось; владелец — кому с этим идти. Мониторинг
           без ответственного даёт тревоги, которые некому разбирать. */
        if (!String((n.params || {}).owner || '').trim())
          add('info', `«${n.name}»: не сказано, кто отвечает за контур — случись сбой, звать некого.`, n.id, 'wiring');

        /* Зависимости запуска — тоже ссылки по имени, значит опечатка молча
           отменит ожидание, и контур поднимется раньше того, чего ждал. */
        for (const dep of ((n.params || {}).depends_on || [])) {
          const d = String(dep || '').trim();
          if (!d) continue;
          if (d === nm) { add('warn', `«${n.name}»: контур ждёт сам себя — он не поднимется.`, n.id, 'wiring'); continue; }
          if (!state.nodes.some(u => u.type === 'unit' && String((u.params || {}).name || '').trim() === d))
            add('warn', `«${n.name}»: ждёт контур «${d}», которого нет в плане — проверь имя.`, n.id, 'wiring');
        }

        /* Проверка живости стучится в порт, которого сервис не объявил: либо
           забыли порт в списке, либо проверка смотрит не туда. */
        const ports = (n.params || {}).ports || [];
        const hp = (n.params || {}).health_port;
        if (ports.length && hp && (n.params.health === 'http' || n.params.health === 'tcp')
            && !ports.some(p => Number(p && p.port) === Number(hp)))
          add('info', `«${n.name}»: живость проверяется на порту ${hp}, а среди портов сервиса его нет.`, n.id, 'wiring');

        /* Разрешение, которым никто не пользуется, — открытая дверь без нужды.
           Со временем таких накапливается больше, чем живых. */
        for (const a of ((n.params || {}).egress_external || [])) {
          const h = hostOf(a);
          if (!h) continue;
          const used = state.nodes.some(m => String((m.params || {}).unit || '').trim() === nm &&
            window.BLOCKS.visibleParams(m.type, m.params).some(f => f.egress && hostOf(m.params[f.key]) === h));
          if (!used)
            add('info', `«${n.name}»: разрешён выход на ${h}, но никто из контура туда не ходит.`, n.id, 'wiring');
        }
      }
      if (n.type === 'monitor') {
        const nm = String((n.params || {}).name || '').trim();
        if (nm && !state.nodes.some(u => u.type === 'unit' && String((u.params || {}).logs_to || '').trim() === nm))
          add('info', `«${n.name}»: в эту систему никто не пишет — ни один контур на неё не ссылается.`, n.id, 'wiring');
      }
      if (n.type === 'repair') {
        const src = String((n.params || {}).source || '').trim();
        if (!src) return;                                     // пустое поле ловит проверка required
        const known = state.nodes.some(d => d.type === 'dlq' && String((d.params || {}).name || '').trim() === src);
        if (!known)
          add('warn', `«${n.name}»: изолятора «${src}» нет в плане — проверь имя.`, n.id, 'wiring');
      }
    });

    /* Кольцевая зависимость контуров: каждый ждёт соседа, система не поднимется
       никогда. По одному узлу это не видно — нужен отдельный проход по всему
       графу зависимостей, поэтому не внутри цикла выше. */
    const unitBy = new Map();
    for (const u of state.nodes) {
      if (u.type !== 'unit') continue;
      const nm = String((u.params || {}).name || '').trim();
      if (nm && !unitBy.has(nm)) unitBy.set(nm, u);
    }
    const mark = {}, path = [];
    const ring = nm => {
      mark[nm] = 1; path.push(nm);
      for (const dep of ((unitBy.get(nm).params || {}).depends_on || [])) {
        const d = String(dep || '').trim();
        if (!unitBy.has(d) || d === nm) continue;
        if (mark[d] === 1) {
          const loop = path.slice(path.indexOf(d)).concat(d).join(' → ');
          /* НЕ kind:'wiring': то понижается до списка дел на стадии плана, а
             кольцо — не «ещё не подключено», а «подключено неверно». Как и
             цикл без блока «Цикл», это ошибка замысла. */
          add('err', `Кольцевая зависимость контуров: ${loop}. Ни один из них не дождётся запуска.`,
              unitBy.get(d).id);
        } else if (!mark[d]) ring(d);
      }
      path.pop(); mark[nm] = 2;
    };
    for (const nm of unitBy.keys()) if (!mark[nm]) ring(nm);

    for (const n of state.nodes) {
      for (const f of window.BLOCKS.visibleParams(n.type, n.params)) {
        const v = n.params[f.key];
        if (f.required && (v === undefined || v === null || String(v).trim() === ''))
          add('err', `«${n.name}»: не заполнен обязательный параметр «${f.label}».`, n.id,
              WIRING_KEYS.includes(f.key) ? 'wiring' : 'structure');
      }

      for (const p of window.BLOCKS.portsOf(n, 'in')) {
        if (p.kind !== 'flow') continue;
        if (n.type === 'start' || entryType(n)) continue;   // блок-точка входа может и сам начинать цепочку
        if (p.id === 'loop_back') {
          if (!state.edges.some(e => e.to.node === n.id && e.to.port === 'loop_back'))
            add('warn', `«${n.name}»: цикл не замкнут — в порт «виток» ничего не возвращается.`, n.id);
          continue;
        }
        if (!state.edges.some(e => e.to.node === n.id && e.to.port === p.id))
          add('warn', `«${n.name}»: вход «${p.label}» не подключён.`, n.id);
      }

      if (window.BLOCKS.portsOf(n, 'out').some(p => p.kind === 'flow') && n.type !== 'output') {
        const hasOut = state.edges.some(e => e.from.node === n.id && e.kind === 'flow');
        if (!hasOut) add('info', `«${n.name}»: выход никуда не ведёт.`, n.id);
      }

      if (n.type === 'agent') {
        const m = modelOf(n);
        if (!m) add('err', `«${n.name}»: выбран несуществующий слот модели.`, n.id);
        else {
          if (!String(m.base_url || '').trim())
            add('err', `«${n.name}»: у модели «${m.label}» не задан Base URL — вызов некуда отправлять.`, n.id, 'wiring');
          if (m.max_output_tokens && n.params.max_tokens > m.max_output_tokens)
            add('err', `«${n.name}»: max_tokens ${n.params.max_tokens} больше потолка ответа модели «${m.label}» (${m.max_output_tokens}). Шлюз вернёт ошибку.`, n.id);
        }
      }

      /* Комментарий спрашиваем только у блоков, которые что-то ДЕЛАЮТ. Блок без
         портов вовсе — описатель (заметка, единица развёртывания, мониторинг):
         он не шаг конвейера, и «что он делает» исчерпывающе сказано полями.
         Раньше тут стояло исключение по имени «note», поэтому каждый новый
         описатель снова начинал требовать комментарий. */
      const descriptor = !window.BLOCKS.portsOf(n, 'in').length && !window.BLOCKS.portsOf(n, 'out').length;
      if (!descriptor && !String(n.notes || '').trim())
        add('info', `«${n.name}»: нет комментария — не написано, что блок делает.`, n.id);

      if (n.type === 'kb' && !state.edges.some(e => e.from.node === n.id))
        add('info', `«${n.name}»: база знаний не подключена ни к одному блоку.`, n.id);

      if (n.type === 'loop' && !targets(n.id, 'body').length)
        add('err', `«${n.name}»: у цикла пустое тело.`, n.id);
    }

    /* Длинная синхронная цепочка: отказ любого звена останавливает всю. Это не
       ошибка замысла, а мера хрупкости — поэтому info, и с указанием, где
       именно напрашивается буфер. */
    const chain = syncChain();
    if (chain.length >= SYNC_LIMIT) {
      const names = chain.map(id => (getNode(id) || {}).name || id).join(' → ');
      add('info', `Синхронная цепочка из ${chain.length} блоков без буфера: ${names}. Отказ любого остановит всю — между ними просится брокер.`, chain[0], 'wiring');
    }

    /* цикл без блока «Цикл» = граф не сходится */
    for (const c of findCycles()) {
      const names = c.map(id => (getNode(id) || {}).name || id).join(' → ');
      add('err', `Замкнутый контур без блока «Цикл»: ${names}. Замкни его через порт «виток».`, c[0]);
    }

    const { orphans, branches } = plan();

    /* Блоки во взаимоисключающих ветках (разные порты одного «Выбора»
       в режиме «один вариант» или разные ветки «Условия») одновременно
       не выполняются — перезаписью переменной это не считается. */
    const exclusive = (a, b) => (branches[a] || []).some(x =>
      (branches[b] || []).some(y => y !== x && y.split('|')[0] === x.split('|')[0]));

    /* Переменные вывода собираем и с узлов, и со строк списков: у группы
       экспертов пятьдесят строк могут молча перезатереть друг друга. */
    const vars = {};
    const push = (v, node, label) => { if (v) (vars[v] = vars[v] || []).push({ node, label }); };
    for (const n of state.nodes) {
      push(n.params.output_var, n, n.name);
      for (const f of (T()[n.type].params || [])) {
        if (f.type !== 'list') continue;
        for (const it of (n.params[f.key] || [])) push(it.output_var, n, `${n.name} → ${it.role || 'без роли'}`);
      }
    }
    for (const [v, owners] of Object.entries(vars)) {
      if (owners.length < 2) continue;
      const clash = owners.filter(a => owners.some(b => a !== b && !exclusive(a.node.id, b.node.id)));
      if (clash.length > 1)
        add('warn', `Переменная «${v}» перезаписывается: ${clash.map(o => o.label).join(', ')}.`);
    }

    /* ── стык контрактов ───────────────────────────────────
       Потребитель называет, что берёт, производители — куда пишут. Сверяем это
       ПРИ ПРОЕКТИРОВАНИИ: иначе «не стыкуется» вскрывается только на сборке,
       когда каждый блок по отдельности сделан правильно, по своему заданию.
       Дрейф в Стройке ловит, что контракт ИЗМЕНИЛСЯ, а не что он не сходится. */
    const upstreamOf = id => {
      const seen = new Set(), stack = [id];
      while (stack.length) {
        const cur = stack.pop();
        for (const e of state.edges) {
          if (e.kind !== 'flow' || e.to.node !== cur || seen.has(e.from.node)) continue;
          seen.add(e.from.node); stack.push(e.from.node);
        }
      }
      return seen;
    };
    /* Пишущий «ctx.order» покрывает и чтение «ctx.order.id» — иначе любая
       ссылка на вложенное поле выглядела бы как ссылка в пустоту. */
    const producersOf = v => {
      const out = [];
      for (const [key, owners] of Object.entries(vars))
        if (key === v || v.startsWith(key + '.') || v.startsWith(key + '[')) out.push(...owners);
      return out;
    };
    /* ── словарь предметной области ────────────────────────
       Схема знает, что «ctx.order» кто-то пишет, а кто-то читает, но не знает,
       ЧТО ВНУТРИ. Пока формы нет, каждый блок строится по своему заданию, и два
       исполнителя честно придумывают две разные формы одного заказа: расходится
       не связь, а смысл. Сущность объявляет форму один раз на всех.
       Реестр ищем по типу, как у единиц развёртывания: это описатель-справочник,
       а не шаг конвейера. */
    const entities = state.nodes.filter(n => n.type === 'entity');
    const entByKey = new Map();
    const carriers = [];                       // {v, node, fields} — переменная → сущность
    for (const n of entities) {
      const p = n.params || {};
      const key = String(p.key || '').trim();
      if (!key) add('err', `«${n.name}»: не сказано, как сущность зовут в коде.`, n.id);
      else if (entByKey.has(key))
        add('err', `Сущность «${key}» объявлена дважды: «${entByKey.get(key).name}» и «${n.name}».`, n.id);
      else entByKey.set(key, n);

      const fields = (p.fields || []).filter(f => f && String(f.name || '').trim());
      if (!fields.length)
        add('info', `«${n.name}»: поля не перечислены — форма не объявлена, каждый исполнитель придумает свою.`, n.id);
      const named = new Set();
      for (const f of fields) {
        const fn = String(f.name).trim();
        if (named.has(fn)) add('err', `«${n.name}»: поле «${fn}» перечислено дважды.`, n.id);
        named.add(fn);
      }
      const idf = String(p.id_field || '').trim();
      if (idf && fields.length && !named.has(idf))
        add('err', `«${n.name}»: опознаётся по «${idf}», но такого поля у неё нет.`, n.id);

      const vs = (p.vars || []).map(v => String(v).trim()).filter(Boolean);
      if (!vs.length)
        add('info', `«${n.name}»: не сказано, в каких переменных живёт — сверить со схемой нечем.`, n.id);
      else if (!vs.some(v => producersOf(v).length))
        add('info', `«${n.name}»: ни одну из её переменных никто не пишет — словарь оторван от схемы.`, n.id);
      for (const v of vs) carriers.push({ v, node: n, fields: named });
    }
    /* Ссылки между сущностями и хозяин данных — вторым проходом, по готовому
       реестру: сущность вправе ссылаться на объявленную ниже по холсту. */
    for (const n of entities) {
      for (const f of ((n.params || {}).fields || [])) {
        if (!f) continue;
        const r = String(f.ref || '').trim();
        if (f.kind === 'ref' && !r)
          add('err', `«${n.name}»: поле «${f.name || '?'}» — ссылка, но не сказано, на какую сущность.`, n.id);
        else if (r && !entByKey.has(r))
          add('err', `«${n.name}»: поле «${f.name || '?'}» ссылается на сущность «${r}», а её в плане нет.`, n.id);
      }
      const own = String((n.params || {}).owner || '').trim();
      if (own && !state.nodes.some(u => u.type === 'unit' && String((u.params || {}).name || '').trim() === own))
        add('warn', `«${n.name}»: хозяин «${own}» — такой единицы развёртывания в плане нет.`, n.id, 'wiring');
    }
    for (let i = 0; i < carriers.length; i++)
      for (let j = i + 1; j < carriers.length; j++)
        if (carriers[i].v === carriers[j].v && carriers[i].node !== carriers[j].node)
          add('err', `Переменную «${carriers[i].v}» объявили своей две сущности: «${carriers[i].node.name}» и «${carriers[j].node.name}» — читатель не знает, какой формы ждать.`, carriers[j].node.id);

    /* ── окружения ─────────────────────────────────────────
       Копий плана на каждое окружение нет намеренно: три копии разойдутся через
       неделю. План один, в полях блоков стоят значения БАЗОВОГО окружения, а
       отличия перечислены на самих блоках — рядом с тем, что меняют.
       Проверяем не наличие записи, а её ИСПОЛНИМОСТЬ: такой параметр у типа
       есть, значение годится по его типу. Иначе это записка на полях. */
    /* Годится ли значение отличия параметру. Одна на два места: отличия живут
       и на блоке, и на узоре — правило обязано быть одним. */
    const envValueProblem = (f, sv) => {
      if (f.type === 'number' && !Number.isFinite(Number(sv))) return `«${sv}» не число`;
      if (f.type === 'select' && !(f.options || []).some(o => o[0] === sv))
        return `«${sv}» не из вариантов (${(f.options || []).map(o => o[0]).join(', ')})`;
      if (f.type === 'bool' && sv !== 'true' && sv !== 'false')
        return `«${sv}»; у переключателя годятся только true или false`;
      return null;
    };
    const envs = state.nodes.filter(n => n.type === 'env');
    const envByName = new Map();
    for (const n of envs) {
      const nm = String((n.params || {}).name || '').trim();
      if (!nm) continue;                       // пустое имя ловит общая проверка required
      if (envByName.has(nm))
        add('err', `Окружение «${nm}» объявлено дважды: «${envByName.get(nm).name}» и «${n.name}».`, n.id);
      else envByName.set(nm, n);
    }
    const bases = envs.filter(n => (n.params || {}).base);
    if (envs.length && !bases.length)
      add('warn', 'Ни одно окружение не помечено базовым — непонятно, чьи значения стоят в полях блоков.');
    if (bases.length > 1)
      add('err', `Базовыми помечены несколько окружений (${bases.map(b => `«${b.name}»`).join(', ')}) — значения в полях могут принадлежать только одному.`, bases[1].id);
    const baseName = bases.length === 1 ? String((bases[0].params || {}).name || '').trim() : '';

    const envUsed = new Set();
    for (const n of state.nodes) {
      /* У «Узора» поле называется так же, но означает другое: отличие для РОЛИ,
         общее на все повторы. Его проверяет свой разбор ниже — здесь ключи
         сверялись бы с параметрами самого узора и всегда не находились. */
      if (n.type === 'pattern') continue;
      const rows = (n.params || {}).env_over || [];
      if (!rows.length) continue;
      const defs = T()[n.type].params || [];
      const seen = new Set();
      for (const r of rows) {
        const e = String((r || {}).env || '').trim();
        const k = String((r || {}).key || '').trim();
        if (!e || !k) {
          add('err', `«${n.name}»: в отличиях по окружениям не сказано, ${!e ? 'какое окружение' : 'какой параметр'}.`, n.id);
          continue;
        }
        envUsed.add(e);
        if (envs.length && !envByName.has(e))
          add('warn', `«${n.name}»: отличие для окружения «${e}», а такого окружения в плане нет.`, n.id, 'wiring');
        if (baseName && e === baseName)
          add('info', `«${n.name}»: отличие для базового окружения «${e}» — его значения и так стоят прямо в полях.`, n.id);
        const pair = JSON.stringify([e, k]);
        if (seen.has(pair)) add('err', `«${n.name}»: для «${e}» параметр «${k}» задан дважды.`, n.id);
        seen.add(pair);

        const f = defs.find(d => d.key === k);
        if (!f) {
          add('err', `«${n.name}»: отличие ссылается на параметр «${k}», а у блоков этого типа такого параметра нет.`, n.id);
          continue;
        }
        const sv = String((r || {}).value == null ? '' : r.value).trim();
        if (!sv) { add('err', `«${n.name}»: «${f.label}» в «${e}» — значение не задано.`, n.id); continue; }
        const bad = envValueProblem(f, sv);
        if (bad) add('err', `«${n.name}»: «${f.label}» в «${e}» — ${bad}.`, n.id);
      }
    }
    for (const [nm, node] of envByName)
      if (nm !== baseName && !envUsed.has(nm))
        add('info', `«${node.name}»: ни один блок в нём ничем не отличается — либо так и есть, либо отличия не записаны.`, node.id);

    /* ── узоры: повторяющиеся куски схемы ──────────────────
       Пять одинаковых воркеров — это одна задача, построенная пять раз. Пока
       схема не говорит, что они одинаковы, исполнитель пишет пять реализаций,
       а правка доходит до одной. Размножать блоки умеет дублирование; здесь
       УЧЁТ: кто чей повтор и где копии разошлись. */
    const patterns = state.nodes.filter(n => n.type === 'pattern');
    const patByName = new Map();
    for (const n of patterns) {
      const nm = String((n.params || {}).name || '').trim();
      if (!nm) continue;                       // пустое имя ловит проверка required
      if (patByName.has(nm))
        add('err', `Узор «${nm}» объявлен дважды: «${patByName.get(nm).name}» и «${n.name}».`, n.id);
      else patByName.set(nm, n);
    }
    const inst = new Map();                    // узор → роль → повтор → узел
    for (const n of state.nodes) {
      const p = n.params || {};
      const pn = String(p.pattern || '').trim();
      if (!pn) continue;
      if (patterns.length && !patByName.has(pn))
        add('warn', `«${n.name}»: узора «${pn}» нет в плане — проверь имя.`, n.id, 'wiring');
      const role = String(p.pattern_role || '').trim(), cas = String(p.pattern_case || '').trim();
      if (!role || !cas) continue;             // пустые ловит проверка required
      if (!inst.has(pn)) inst.set(pn, new Map());
      const byRole = inst.get(pn);
      if (!byRole.has(role)) byRole.set(role, new Map());
      const byCase = byRole.get(role);
      if (byCase.has(cas))
        add('err', `«${n.name}»: в узоре «${pn}» роль «${role}» повтора «${cas}» уже занята блоком «${byCase.get(cas).name}».`, n.id);
      else byCase.set(cas, n);
    }
    for (const [nm, node] of patByName)
      if (!inst.has(nm)) add('info', `«${node.name}»: на этот узор не ссылается ни один блок.`, node.id);

    /* Отличия по окружениям, объявленные НА УЗОРЕ: одна строка на все повторы.
       Проверяем так же строго, как блочные, плюс то, чего у блочных нет, —
       что роль существует и что параметр есть у блоков ИМЕННО ЭТОЙ роли. */
    const patEnv = new Map();                  // «узор|окружение|роль|параметр» → строка
    for (const [nm, pnode] of patByName) {
      const byRole = inst.get(nm);
      const seen = new Set();
      for (const r of ((pnode.params || {}).env_over || [])) {
        const e = String((r || {}).env || '').trim();
        const role = String((r || {}).role || '').trim();
        const k = String((r || {}).key || '').trim();
        if (!e || !role || !k) {
          add('err', `«${pnode.name}»: в отличиях по окружениям не сказано, ${!e ? 'какое окружение' : !role ? 'у какой роли' : 'какой параметр'}.`, pnode.id);
          continue;
        }
        const pair = JSON.stringify([e, role, k]);
        if (seen.has(pair)) add('err', `«${pnode.name}»: для «${e}» у роли «${role}» параметр «${k}» задан дважды.`, pnode.id);
        seen.add(pair);
        if (envs.length && !envByName.has(e))
          add('warn', `«${pnode.name}»: отличие для окружения «${e}», а такого окружения в плане нет.`, pnode.id, 'wiring');
        if (baseName && e === baseName)
          add('info', `«${pnode.name}»: отличие для базового окружения «${e}» — его значения и так стоят прямо в полях.`, pnode.id);
        const some = byRole && byRole.get(role) && [...byRole.get(role).values()][0];
        if (!some) {
          add('err', `«${pnode.name}»: отличие для роли «${role}», а блоков с такой ролью в узоре нет.`, pnode.id);
          continue;
        }
        const f = (T()[some.type].params || []).find(d => d.key === k);
        if (!f) {
          add('err', `«${pnode.name}»: отличие ссылается на параметр «${k}», а у роли «${role}» (${some.type}) такого параметра нет.`, pnode.id);
          continue;
        }
        const sv = String((r || {}).value == null ? '' : r.value).trim();
        if (!sv) { add('err', `«${pnode.name}»: «${f.label}» у роли «${role}» в «${e}» — значение не задано.`, pnode.id); continue; }
        const bad = envValueProblem(f, sv);
        if (bad) add('err', `«${pnode.name}»: «${f.label}» у роли «${role}» в «${e}» — ${bad}.`, pnode.id);
        patEnv.set(`${nm}|${e}|${role}|${k}`, { label: f.label, value: sv, node: pnode });
      }
    }
    /* Одно и то же отличие объявлено и на узоре, и в блоке. Не ошибка — так
       выражается исключение из общего правила, — но сказать надо: иначе при
       сборке два источника правды на одно значение. */
    for (const n of state.nodes) {
      const p = n.params || {};
      const pn = String(p.pattern || '').trim(), role = String(p.pattern_role || '').trim();
      if (!pn || !role) continue;
      for (const r of (p.env_over || [])) {
        const key = `${pn}|${String((r || {}).env || '').trim()}|${role}|${String((r || {}).key || '').trim()}`;
        const from = patEnv.get(key);
        if (from)
          add('info', `«${n.name}»: отличие «${from.label}» для «${String(r.env).trim()}» задано и у узора «${pn}» (${from.value}), и здесь (${String(r.value).trim()}) — при сборке берётся значение блока, оно точнее.`, n.id);
      }
    }

    /* ФОРМА повтора — набор его связей, выраженный через РОЛИ, а не через id.
       Сравнение параметров ловит расхождение ВНУТРИ блока, но пропущенный или
       лишний ШАГ не ловит вовсе: роли на месте, поля совпадают, а кусок собран
       иначе — и это самая частая порча копипастом.
       Конец связи внутри повтора называем ролью, конец снаружи — ТИПОМ блока:
       по id сравнивать нельзя, повторы законно ходят к разным соседям, а тип
       говорит ровно то, что нужно, — «эта роль отдаёт в брокер». */
    const shapeOf = (pn, cas) => {
      const roleAt = id => {
        const x = getNode(id), p = (x || {}).params || {};
        return x && String(p.pattern || '').trim() === pn && String(p.pattern_case || '').trim() === cas
          ? String(p.pattern_role || '').trim() : '';
      };
      const side = id => {
        const r = roleAt(id);
        if (r) return { key: 'роль:' + r, label: `«${r}»` };
        const x = getNode(id), d = x && T()[x.type];
        return { key: 'тип:' + ((x || {}).type || '?'), label: (d && d.label) || ((x || {}).type || '?') };
      };
      const map = new Map();
      for (const e of state.edges) {
        if (e.kind !== 'flow') continue;
        const a = roleAt(e.from.node), b = roleAt(e.to.node);
        if (!a && !b) continue;                  // связь мимо этого повтора
        const f = side(e.from.node), t = side(e.to.node);
        const key = `${f.key}|${e.from.port}→${t.key}|${e.to.port}`;
        if (map.has(key)) continue;
        const port = e.from.port === 'out' ? '' : ` (по «${e.from.port}»)`;
        map.set(key, { label: `${f.label}${port} → ${t.label}`, node: a ? e.from.node : e.to.node });
      }
      return map;
    };

    /* Значение в одну строчку. Список записей (порты, тревоги, отличия по
       окружениям) не разворачиваем: «[object Object]» не сказал бы ничего,
       а количество хотя бы показывает, где разошлось. */
    const brief = v => {
      if (Array.isArray(v))
        return v.some(x => x && typeof x === 'object') ? `записей: ${v.length}`
             : (v.length ? v.join(',') : '—');
      const s = String(v === undefined || v === '' ? '—' : v);
      return s.length > 24 ? s.slice(0, 24) + '…' : s;
    };
    for (const [pn, byRole] of inst) {
      const pnode = patByName.get(pn);
      const varies = new Set((((pnode || {}).params || {}).varies || []).map(v => String(v).trim()).filter(Boolean));
      const cases = new Set();
      for (const byCase of byRole.values()) for (const c of byCase.keys()) cases.add(c);
      if (cases.size < 2) {
        if (pnode) add('info', `«${pnode.name}»: повтор всего один («${[...cases][0]}») — узор пока ничего не экономит.`, pnode.id);
        continue;
      }
      /* Форму сравниваем с ПЕРВЫМ повтором, а не всех со всеми: попарно вышло бы
         N² сообщений об одном и том же расхождении. */
      const caseList = [...cases];
      const rep = {};                            // повтор → любой его блок, куда повесить замечание
      for (const byCase of byRole.values())
        for (const [c, node] of byCase) if (!rep[c]) rep[c] = node.id;
      const shapeChecked = !((pnode || {}).params || {}).shape_varies;
      const base0 = shapeChecked ? shapeOf(pn, caseList[0]) : new Map();
      for (const c of (shapeChecked ? caseList.slice(1) : [])) {
        const cur = shapeOf(pn, c);
        for (const [k, v] of base0)
          if (!cur.has(k))
            add('warn', `Узор «${pn}»: в повторе «${caseList[0]}» есть связь ${v.label}, а в «${c}» её нет — повторы собраны по-разному.`, rep[c] || v.node);
        for (const [k, v] of cur)
          if (!base0.has(k))
            add('warn', `Узор «${pn}»: в повторе «${c}» есть лишняя связь ${v.label}, которой нет в «${caseList[0]}» — повторы собраны по-разному.`, v.node);
      }

      for (const [role, byCase] of byRole) {
        const missing = [...cases].filter(c => !byCase.has(c));
        const some = [...byCase.values()][0];
        if (missing.length)
          add('warn', `Узор «${pn}»: роли «${role}» нет в ${missing.map(c => `«${c}»`).join(', ')}, хотя в остальных повторах она есть.`, some.id);

        const nodes = [...byCase.entries()];
        if (nodes.length < 2) continue;
        const types = new Set(nodes.map(e => e[1].type));
        if (types.size > 1) {
          add('err', `Узор «${pn}», роль «${role}»: повторы сделаны разными блоками (${[...types].join(', ')}) — это уже не один узор.`, some.id);
          continue;
        }
        /* Сравниваем ВСЕ параметры, кроме объявленных отличающимися. Осознанное
           отличие должно быть записано у узора — иначе его не отличить от
           правки, которую забыли донести до копии. */
        const n0 = nodes[0][1], c0 = nodes[0][0], diffs = [];
        for (const f of (T()[n0.type].params || [])) {
          if (f.key === 'pattern' || f.key === 'pattern_role' || f.key === 'pattern_case') continue;
          if (varies.has(f.key)) continue;

          /* Отличия по окружениям сравниваем не блобом, а ПОСТРОЧНО. Иначе
             любой повтор со своим адресом в dev делал весь список «разным», и
             приходилось вносить env_over в varies — то есть выключать сверку
             отличий целиком. Теперь: у ключа, объявленного отличающимся,
             сверяем только НАЛИЧИЕ строки (забыть её у одного повтора — дыра),
             у остальных — ещё и значение. */
          if (f.key === 'env_over') {
            /* Основа — отличия, объявленные у УЗОРА для этой роли: они есть у
               каждого повтора по определению. Своё у блока их перебивает. */
            const patRows = new Map();
            for (const r of ((((pnode || {}).params) || {}).env_over || [])) {
              const ev = String((r || {}).env || '').trim(), k = String((r || {}).key || '').trim();
              if (ev && k && String((r || {}).role || '').trim() === role)
                patRows.set(ev + '|' + k, String((r || {}).value == null ? '' : r.value).trim());
            }
            const rowsOf = nd => {
              const m = new Map(patRows);
              for (const r of (nd.params.env_over || [])) {
                const ev = String((r || {}).env || '').trim(), k = String((r || {}).key || '').trim();
                if (ev && k) m.set(ev + '|' + k, String((r || {}).value == null ? '' : r.value).trim());
              }
              return m;
            };
            const maps = nodes.map(en => [en[0], rowsOf(en[1])]);
            const allKeys = new Set();
            for (const m of maps) for (const k of m[1].keys()) allKeys.add(k);
            for (const k of allKeys) {
              const ev = k.slice(0, k.indexOf('|')), pk = k.slice(k.indexOf('|') + 1);
              const fd = (T()[n0.type].params || []).find(d => d.key === pk);
              const lbl = (fd && fd.label) || pk;
              const missing = maps.filter(m => !m[1].has(k)).map(m => m[0]);
              if (missing.length) {
                diffs.push(`отличие «${lbl}» для «${ev}» есть не у всех (нет в ${missing.map(c => `«${c}»`).join(', ')})`);
                continue;
              }
              /* Значение законно своё у каждого повтора, если ключ объявлен
                 отличающимся — или если у узора есть общая строка: тогда
                 блочная это записанное исключение, о нём уже сказано отдельно. */
              if (varies.has(pk) || patRows.has(k)) continue;
              const vals = new Set(maps.map(m => m[1].get(k)));
              if (vals.size > 1)
                diffs.push(`отличие «${lbl}» для «${ev}» разное (${maps.map(m => `${m[0]}: ${brief(m[1].get(k))}`).join(' · ')})`);
            }
            continue;
          }
          const val = x => JSON.stringify(x === undefined ? null : x);
          const base = val(n0.params[f.key]);
          const off = nodes.filter(e => val(e[1].params[f.key]) !== base);
          if (!off.length) continue;
          /* У списка значения в строку не влезают, а «записей: 2 · записей: 2»
             выглядит как «одинаково» при разном составе. Честнее назвать поле. */
          diffs.push(f.type === 'list'
            ? `${f.label} (состав разный: ${[c0].concat(off.map(e => e[0])).join(', ')})`
            : `${f.label} (${c0}: ${brief(n0.params[f.key])} · ` +
              off.map(e => `${e[0]}: ${brief(e[1].params[f.key])}`).join(' · ') + ')');
        }
        if (diffs.length)
          add('warn', `Узор «${pn}», роль «${role}»: повторы разошлись — ${diffs.slice(0, 5).join('; ')}` +
              (diffs.length > 5 ? ` и ещё ${diffs.length - 5}` : '') +
              '. Осознанное отличие внеси в «что отличается» у узора; если оно не осознанное — правку донесли не до всех копий.', some.id);
      }
    }

    /* ── решения ───────────────────────────────────────────
       План отвечает на «что», заметка блока — на «что он делает»; на «почему не
       проще» не отвечает никто, и лишний на вид брокер выкидывают «для
       простоты». Привязка — к тому, что в плане уже названо: контур, узор,
       сущность или id блока. Иначе решение висит в воздухе и в задания не
       попадёт вовсе. */
    const decisions = state.nodes.filter(n => n.type === 'decision');
    const decByTitle = new Map();
    for (const n of decisions) {
      const t = String((n.params || {}).title || '').trim();
      if (!t) continue;                        // пустое ловит проверка required
      if (decByTitle.has(t))
        add('err', `Решение «${t}» записано дважды: «${decByTitle.get(t).name}» и «${n.name}».`, n.id);
      else decByTitle.set(t, n);
    }
    for (const n of decisions) {
      const p = n.params || {};
      const targets = (p.affects || []).map(a => String(a).trim()).filter(Boolean);
      if (!targets.length)
        add('info', `«${n.name}»: решение ни к чему не привязано — в задания исполнителям оно не попадёт.`, n.id);
      for (const a of targets) {
        const known =
          state.nodes.some(u => u.type === 'unit' && String((u.params || {}).name || '').trim() === a) ||
          patByName.has(a) || entByKey.has(a) || state.nodes.some(x => x.id === a);
        if (!known)
          add('warn', `«${n.name}»: непонятно, к чему относится «${a}» — это не контур, не узор, не сущность и не id блока.`, n.id, 'wiring');
      }
      if (p.status === 'superseded') {
        const by = String(p.superseded_by || '').trim();
        if (by && !decByTitle.has(by))
          add('warn', `«${n.name}»: заменено решением «${by}», а такого решения в плане нет.`, n.id, 'wiring');
      }
      /* Одним замечанием, а не тремя: пустой ADR — одна беда, а не три. */
      const gaps = [];
      if (!String(p.rejected || '').trim()) gaps.push('что отвергли');
      if (!String(p.costs || '').trim()) gaps.push('чем платим');
      if (!String(p.revisit || '').trim()) gaps.push('что заставит пересмотреть');
      if (gaps.length && p.status !== 'dropped')
        add('info', `«${n.name}»: не записано — ${gaps.join(', ')}. Без отвергнутого решение обсудят заново, без условия пересмотра оно станет догмой.`, n.id);
    }

    /* Какие поля называют входную переменную, объявляет ТИП флагом reads —
       у «Задания» это «Входные переменные», у «Обработки» «Что берём», у
       «Выхода данных» «Что отправляем». graph.js их имён не знает. */
    for (const n of state.nodes) {
      const refs = [];
      for (const f of window.BLOCKS.visibleParams(n.type, n.params)) {
        if (!f.reads) continue;
        const val = n.params[f.key];
        for (const part of (Array.isArray(val) ? val : [val]))
          refs.push(String(part == null ? '' : part).trim());
      }
      const raw = refs.filter(Boolean).join(' ');
      if (!raw) continue;
      const up = upstreamOf(n.id);
      /* Берём только то, что похоже на ссылку (есть точка) — поле может быть
         заполнено прозой или шаблоном, и разбирать их на слова значило бы шуметь. */
      for (const v of raw.split(/[,;\s]+/).filter(t => t.indexOf('.') > 0)) {
        const owners = producersOf(v);
        if (!owners.length)
          add('warn', `«${n.name}»: берёт «${v}», но эту переменную никто не пишет.`, n.id, 'wiring');
        else if (!owners.some(o => up.has(o.node.id)))
          add('warn', `«${n.name}»: берёт «${v}», но пишет её ${owners.map(o => `«${o.label}»`).join(', ')} — не выше по потоку, к моменту чтения переменной ещё нет.`, n.id, 'wiring');

        /* Если переменную объявила сущность — сверяем ПЕРВЫЙ уровень пути.
           Глубже не лезем намеренно: словарь на стадии плана редко расписан до
           третьего уровня, и «нет такого поля» на вложенном пути был бы шум.
           Не 'wiring': стадия «план» гасит подключения до списка дел, а тут
           автор уже объявил форму — значит расхождение с ней это ошибка, а не
           недописанность. */
        const car = carriers.filter(c => v.startsWith(c.v + '.'))
                            .sort((a, b) => b.v.length - a.v.length)[0];
        if (car && car.fields.size) {
          const rest = v.slice(car.v.length + 1).split(/[.[]/)[0];
          if (rest && !car.fields.has(rest))
            add('warn', `«${n.name}»: берёт «${v}», но поля «${rest}» у сущности «${car.node.name}» нет.`, n.id);
        }
      }
    }

    for (const o of orphans) add('warn', `«${o.name}»: недостижим от точки входа.`, o.id);

    // на стадии «план» подключения — это список дел на потом, а не ошибки
    if ((state.meta.stage || 'plan') === 'plan')
      for (const i of issues) if (i.kind === 'wiring') i.level = 'todo';

    return issues;
  }

  /* DFS-поиск контуров по flow-рёбрам без обратных рёбер цикла */
  /* ── измерение структуры ─────────────────────────────────
     Всё считается по уже существующему графу: ни одной новой сущности в модели.
     Баллов и оценок тут нет намеренно — по баллу нечего чинить. Считаем то, из
     чего сразу видно действие: где связь жёсткая и как далеко уедет отказ. */
  const isBuffer = n => { const d = n && T()[n.type]; return !!(d && d.buffer); };
  const unitOf = n => String(((n || {}).params || {}).unit || '').trim();
  /* Кто отвечает за контур с таким именем. Владелец объявлен на контуре, а
     блок его НАСЛЕДУЕТ — своего поля у блока нет намеренно: контур падает и
     перезапускается целиком, значит и звать по нему надо одного. */
  const ownerOfUnit = nm => {
    const u = nm && state.nodes.find(x => x.type === 'unit' && String((x.params || {}).name || '').trim() === nm);
    return u ? String((u.params || {}).owner || '').trim() : '';
  };
  const SYNC_LIMIT = 4;          // с какой длины синхронная цепочка становится поводом

  /* Самая длинная цепочка блоков, соединённых НАПРЯМУЮ, без буфера между ними.
     Это радиус поражения: настолько далеко уедет отказ одного блока, прежде чем
     упрётся во что-то, что умеет копить. */
  function syncChain() {
    const next = {};
    for (const e of state.edges) {
      if (e.kind !== 'flow' || e.from.port === 'err' || e.from.port === 'dlq') continue;
      const a = getNode(e.from.node), b = getNode(e.to.node);
      if (!a || !b || isBuffer(a) || isBuffer(b)) continue;
      (next[a.id] = next[a.id] || []).push(b.id);
    }
    let best = [];
    const walk = (id, path) => {
      if (path.indexOf(id) >= 0) return;          // цикл — дальше не идём
      const p = path.concat(id);
      if (p.length > best.length) best = p;
      for (const v of (next[id] || [])) walk(v, p);
    };
    for (const n of state.nodes) if (!isBuffer(n)) walk(n.id, []);
    return best;
  }

  /* Числовая сводка. Отдаётся наружу, чтобы её можно было показать где угодно. */
  function quality() {
    const flow = state.edges.filter(e => e.kind === 'flow');
    const pairs = new Set();
    let cross = 0, hard = 0, crossOwner = 0;
    for (const e of flow) {
      const a = getNode(e.from.node), b = getNode(e.to.node);
      if (!a || !b) continue;
      const ua = unitOf(a), ub = unitOf(b);
      if (!ua || !ub || ua === ub) continue;
      cross++;
      pairs.add([ua, ub].sort().join(' ↔ '));
      if (isBuffer(a) || isBuffer(b)) continue;
      hard++;
      /* Жёсткая связь через границу ответственности дороже обычной: её нельзя
         развязать правкой, только договорённостью. */
      const oa = ownerOfUnit(ua), ob = ownerOfUnit(ub);
      if (oa && ob && oa !== ob) crossOwner++;
    }
    const deployable = n => ((T()[n.type] || {}).params || []).some(f => f.key === 'unit');
    return {
      blocks: state.nodes.length,
      edges: flow.length,
      units: state.nodes.filter(n => n.type === 'unit').length,
      crossUnit: cross,                                   // связей между контурами
      hardLinks: hard,                                    // из них жёстких, минуя буфер
      crossOwner,                                         // из жёстких — через границу ответственности
      unitPairs: pairs.size,                              // сколько пар контуров знают друг о друге
      syncDepth: syncChain().length,                      // радиус поражения
      unassigned: state.nodes.filter(n => deployable(n) && !unitOf(n)).length,
    };
  }

  function findCycles() {
    const adj = {};
    for (const e of state.edges) {
      if (e.kind !== 'flow' || isBackEdge(e)) continue;
      /* Возврат в блок, который сам ограничивает переотправку (брокер:
         max_attempts → изолятор), — не цикл, а повторная доставка. Рвать его
         блоком «Цикл» бессмысленно: счётчик попыток уже внутри. Ограничитель
         объявляет ТИП флагом bounded, чтобы graph.js не знал имён блоков. */
      const to = getNode(e.to.node), d = to && T()[to.type];
      if (d && d.bounded) continue;
      (adj[e.from.node] = adj[e.from.node] || []).push(e.to.node);
    }
    const color = {}, stack = [], cycles = [];
    function dfs(u) {
      color[u] = 1; stack.push(u);
      for (const v of (adj[u] || [])) {
        if (color[v] === 1) cycles.push(stack.slice(stack.indexOf(v)));
        else if (!color[v]) dfs(v);
      }
      stack.pop(); color[u] = 2;
    }
    for (const n of state.nodes) if (!color[n.id]) dfs(n.id);
    return cycles;
  }

  /* ── сериализация ───────────────────────────────────── */
  function toJSON() {
    return {
      version: state.version, name: state.name, meta: state.meta,
      nodes: state.nodes, edges: state.edges, seq: state.seq,
    };
  }

  function fromJSON(data) {
    if (!data || !Array.isArray(data.nodes)) throw new Error('файл не похож на конвейер Bench');
    state.version = data.version || 1;
    state.name = data.name || 'Конвейер';
    const m = data.meta || {};
    state.meta = Object.assign(META(), m);
    state.meta.models = {
      primary: Object.assign(MODELS().primary, (m.models || {}).primary || {}),
      heavy: Object.assign(MODELS().heavy, (m.models || {}).heavy || {}),
    };
    /* Импорт — граница внешних данных (кнопка «Импорт», планы от ИИ). Приводим
       узлы к рабочей форме: без params другие модули падают на when(); без id
       на него не сослаться. Кривые рёбра (без from/to) отбрасываем, а не роняем
       весь импорт. */
    state.nodes = data.nodes.filter(n => n && n.id && T()[n.type]).map(n => {
      const def = T()[n.type];
      return {
        ...n,                       // свои поля узла (collapsed и пр.) не теряем
        id: n.id, type: n.type,
        name: n.name || def.label,
        x: Number.isFinite(n.x) ? n.x : 0,
        y: Number.isFinite(n.y) ? n.y : 0,
        enabled: n.enabled !== false,
        params: (n.params && typeof n.params === 'object') ? n.params : {},
        notes: typeof n.notes === 'string' ? n.notes : '',
      };
    });
    state.edges = (data.edges || []).filter(e =>
      e && e.from && e.to &&
      state.nodes.some(n => n.id === e.from.node) && state.nodes.some(n => n.id === e.to.node));
    state.seq = data.seq || state.nodes.length + 1;
  }

  function clear() {
    state.name = 'Новый конвейер'; state.nodes = []; state.edges = []; state.seq = 1;
    state.meta = META();
  }

  return {
    state, newId, addNode, getNode, removeNode, addEdge, removeEdge, pruneEdges, edgesOf, modelOf,
    canConnect, targets, incoming, isBackEdge, plan, validate, quality, toJSON, fromJSON, clear,
  };
})();
