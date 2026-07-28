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
    let roots = state.nodes.filter(n => n.type === 'start' || (n.type === 'input' && noInFlow(n)));
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
      (n.type === 'input' && !state.edges.some(e => e.kind === 'flow' && e.to.node === n.id));
    if (!state.nodes.some(isEntry))
      add('warn', 'Нет точки входа: добавь блок «Старт» или «Вход данных» со своим расписанием.');

    for (const n of state.nodes) {
      for (const f of window.BLOCKS.visibleParams(n.type, n.params)) {
        const v = n.params[f.key];
        if (f.required && (v === undefined || v === null || String(v).trim() === ''))
          add('err', `«${n.name}»: не заполнен обязательный параметр «${f.label}».`, n.id,
              WIRING_KEYS.includes(f.key) ? 'wiring' : 'structure');
      }

      for (const p of window.BLOCKS.portsOf(n, 'in')) {
        if (p.kind !== 'flow') continue;
        if (n.type === 'start' || n.type === 'input') continue;   // «Вход данных» может и сам начинать цепочку
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

      if (n.type !== 'note' && !String(n.notes || '').trim())
        add('info', `«${n.name}»: нет комментария — не написано, что блок делает.`, n.id);

      if (n.type === 'kb' && !state.edges.some(e => e.from.node === n.id))
        add('info', `«${n.name}»: база знаний не подключена ни к одному блоку.`, n.id);

      if (n.type === 'loop' && !targets(n.id, 'body').length)
        add('err', `«${n.name}»: у цикла пустое тело.`, n.id);
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

    for (const o of orphans) add('warn', `«${o.name}»: недостижим от точки входа.`, o.id);

    // на стадии «план» подключения — это список дел на потом, а не ошибки
    if ((state.meta.stage || 'plan') === 'plan')
      for (const i of issues) if (i.kind === 'wiring') i.level = 'todo';

    return issues;
  }

  /* DFS-поиск контуров по flow-рёбрам без обратных рёбер цикла */
  function findCycles() {
    const adj = {};
    for (const e of state.edges) {
      if (e.kind !== 'flow' || isBackEdge(e)) continue;
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
    if (!data || !Array.isArray(data.nodes)) throw new Error('файл не похож на конвейер Workbench');
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
    canConnect, targets, incoming, isBackEdge, plan, validate, toJSON, fromJSON, clear,
  };
})();
