/* blocks.js — реестр типов блоков.
   Это и есть «структура проекта»: тип блока = его порты + схема параметров.
   Добавить новый блок = добавить объект в TYPES. Форма параметров и карточка
   на холсте строятся из схемы автоматически. */

window.BLOCKS = (function () {

  const CATEGORIES = [
    { id: 'flow', label: 'Поток',  hint: 'старт, ветвления, циклы, очередь' },
    { id: 'work', label: 'Работа', hint: 'задания, агенты, скрипты' },
    { id: 'data', label: 'Данные', hint: 'знания и преобразования' },
    { id: 'io',   label: 'Выход',  hint: 'результаты и заметки' },
  ];

  /* Порт: {id, label, kind}
     kind:'flow' — порядок выполнения (сплошная линия)
     kind:'data' — привязка данных/знаний (пунктир)          */
  const IN  = (id, label, kind, multi) => ({ id, label, kind: kind || 'flow', multi: !!multi });
  const OUT = IN;

  const TYPES = {

    /* ── ПОТОК ───────────────────────────────────────────── */
    start: {
      label: 'Старт', category: 'flow', color: '#f5a524', icon: '▶',
      desc: 'Точка входа конвейера и способ его запуска.',
      inputs: [], outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'trigger', label: 'Триггер', type: 'select', default: 'manual',
          options: [['upload','пользователь загружает'],['manual','вручную'],['schedule','по расписанию'],['webhook','webhook'],['watch','по событию файла']] },
        { key: 'cron', label: 'Расписание (cron)', type: 'text', placeholder: '0 */4 * * *', when: n => n.trigger === 'schedule' },
        { key: 'accept', label: 'Что принимаем', type: 'text', default: '.zip, .tar.gz, папка, git-URL',
          when: n => n.trigger === 'upload', required: true },
        { key: 'max_size_mb', label: 'Максимальный размер, МБ', type: 'number', default: 500, min: 1, step: 1, when: n => n.trigger === 'upload' },
        { key: 'unpack', label: 'Распаковывать архив', type: 'bool', default: true, when: n => n.trigger === 'upload' },
        { key: 'dest', label: 'Куда положить', type: 'text', default: 'work\\project', when: n => n.trigger === 'upload', required: true },
        { key: 'output_var', label: 'Путь записать в', type: 'text', default: 'ctx.project_path', when: n => n.trigger === 'upload' },
        { key: 'payload', label: 'Начальный контекст (JSON)', type: 'code', default: '{}', when: n => n.trigger !== 'upload' },
      ],
      summary: p => ({ upload: p.accept || 'загрузка от пользователя', manual: 'запуск вручную',
                       schedule: p.cron || 'по расписанию', webhook: 'по webhook', watch: 'по событию' })[p.trigger] || '',
    },

    source: {
      label: 'Источник проекта', category: 'flow', color: '#22d3ee', icon: '⇩',
      desc: 'Как проект попадает в анализатор: загрузка архива на сервер, мини-приложение у пользователя, папка прямо из браузера или клон репозитория.',
      inputs: [IN('in', 'вход', 'flow', true)],
      /* Порт «код» — единая точка доступа к исходникам для агентов.
         Как он обслуживается, зависит от режима: на сервере читаем файлы
         напрямую, у пользователя — через мини-приложение-шлюз. Агенту всё
         равно, он просто цепляется к порту. */
      outputs: [OUT('out', 'дальше'), OUT('code', 'доступ к коду', 'data')],
      params: [
        { key: 'mode', label: 'Способ', type: 'select', default: 'upload',
          options: [['upload','пользователь загружает на сервер'],['local_agent','мини-приложение у пользователя'],
                    ['browser','папка прямо из браузера — File System Access API'],['git','клонировать репозиторий']] },

        { key: 'accept', label: 'Что принимаем', type: 'text', default: '.zip, .tar.gz, .rar, папка',
          when: n => n.mode === 'upload', required: true },
        { key: 'max_size_mb', label: 'Максимальный размер, МБ', type: 'number', default: 500, min: 1, step: 1, when: n => n.mode === 'upload' },
        { key: 'unpack', label: 'Распаковывать архив', type: 'bool', default: true, when: n => n.mode === 'upload' },
        { key: 'dest', label: 'Куда положить на сервере', type: 'text', default: 'work\\project',
          when: n => n.mode === 'upload', required: true },

        { key: 'repo', label: 'Репозиторий', type: 'text', placeholder: 'https://github.com/…', when: n => n.mode === 'git', required: true },
        { key: 'branch', label: 'Ветка', type: 'text', default: 'main', when: n => n.mode === 'git' },

        { key: 'platforms', label: 'Сборки мини-приложения', type: 'tags', default: ['windows','macos','linux'], when: n => n.mode === 'local_agent' },
        { key: 'pairing', label: 'Привязка к аккаунту', type: 'select', default: 'device_code',
          options: [['device_code','код устройства'],['token','токен из кабинета'],['qr','QR-код']], when: n => n.mode === 'local_agent' },
        { key: 'transport', label: 'Канал связи с сервером', type: 'select', default: 'websocket',
          options: [['websocket','WebSocket — двусторонний, прогресс идёт потоком'],['https','HTTPS long-poll']], when: n => n.mode === 'local_agent' },
        { key: 'send', label: 'Что уезжает сразу, при сканировании', type: 'tags',
          default: ['graph','manifests','file_tree','metrics'], when: n => n.mode === 'local_agent' || n.mode === 'browser' },
        { key: 'access', label: 'Как агенты читают код', type: 'select', default: 'on_demand',
          options: [['prefetch','забрать заранее всё, что понадобится, — клиент может отвалиться'],
                    ['on_demand','по запросу, через клиента — приложение или вкладку'],
                    ['stream_once','выгрузить весь код на сервер'],['none','код недоступен, только граф']],
          when: n => n.mode === 'local_agent' || n.mode === 'browser' },
        { key: 'max_fragment_kb', label: 'Максимальный фрагмент, КБ', type: 'number', default: 256, min: 1, step: 1,
          when: n => n.mode === 'local_agent' && n.access === 'on_demand' },
        { key: 'watch', label: 'Следить за изменениями и досылать', type: 'bool', default: true, when: n => n.mode === 'local_agent' },

        /* File System Access API есть только в Chromium. В Safari и Firefox его нет,
           а на маке Safari стоит по умолчанию — значит у третьего входа обязан быть
           откат, иначе часть пользователей упрётся в белый экран. */
        { key: 'remember_folder', label: 'Помнить папку в профиле аккаунта', type: 'bool', default: true,
          when: n => n.mode === 'browser' },
        { key: 'fallback', label: 'Если браузер не поддерживает', type: 'select', default: 'upload',
          options: [['upload','предложить загрузку архива'],['local_agent','предложить мини-приложение'],['block','сказать, что режим недоступен']],
          when: n => n.mode === 'browser' },

        /* Приватность — одинаковая для всех способов входа. Эти три поля стояли
           только у мини-приложения, и архив, загруженный на сервер, приезжал
           вместе с .env и ключами и оставался лежать бессрочно. */
        { key: 'deny_paths', label: 'Не читаем и не храним никогда', type: 'tags',
          default: ['.env','*.pem','*.key','id_rsa*','*.p12','*.pfx','secrets/*','credentials*','*.keystore'],
          when: n => n.access !== 'none' },
        { key: 'retention', label: 'Что делаем с кодом после прогона', type: 'select', default: 'no_store',
          options: [['no_store','удалить сразу после прогона'],['cache','держать в кеше'],['store','хранить копию']],
          when: n => n.access !== 'none' },
        { key: 'cache_ttl_s', label: 'Время жизни кеша, с', type: 'number', default: 900.000, step: 0.001,
          when: n => n.retention === 'cache' && n.access !== 'none' },
        { key: 'audit_log', label: 'Журнал: кто какой файл открыл', type: 'bool', default: true,
          when: n => n.access !== 'none' },

        /* Ключ, удалённый из рабочего дерева, остаётся в коммитах и продолжает
           работать — поэтому история нужна поиску секретов. Она приезжает
           отдельно от рабочего дерева и в граф знаний не разбирается. */
        { key: 'git_history', label: 'История репозитория', type: 'select', default: 'full',
          options: [['off','не брать'],['meta','метаданные коммитов — кто, когда, какие файлы'],
                    ['full','полностью — нужна поиску секретов']] },
        { key: 'history_depth', label: 'Глубина, коммитов (0 — вся)', type: 'number', default: 0, min: 0, step: 1,
          when: n => n.git_history !== 'off' },

        { key: 'exclude', label: 'Исключить', type: 'tags', default: ['node_modules','dist','build','venv','__pycache__'] },
        { key: 'output_var', label: 'Путь / дескриптор в', type: 'text', default: 'ctx.project_path' },
      ],
      summary: p => ({
        upload: 'на сервер: ' + (p.accept || ''),
        local_agent: 'шлюз · ' + ({ on_demand: 'код по запросу', stream_once: 'код выгружается целиком', none: 'только граф' }[p.access] || ''),
        git: p.repo || 'клон репозитория',
      })[p.mode] || '',
    },

    condition: {
      label: 'Условие', category: 'flow', color: '#facc15', icon: '◇',
      desc: 'Ветвление по выражению над контекстом.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('true', 'да'), OUT('false', 'нет')],
      params: [
        { key: 'expression', label: 'Выражение', type: 'code', required: true, default: 'ctx.score >= 0.750' },
        { key: 'note', label: 'Пояснение', type: 'text' },
      ],
      summary: p => p.expression || '—',
    },

    loop: {
      label: 'Цикл', category: 'flow', color: '#fb923c', icon: '↻',
      desc: 'Закольцованный участок: тело цикла возвращает управление во вход «виток».',
      inputs: [IN('in', 'вход', 'flow', true), IN('loop_back', 'виток', 'flow', true)],
      outputs: [OUT('body', 'тело'), OUT('done', 'после')],
      params: [
        { key: 'mode', label: 'Режим', type: 'select', default: 'foreach',
          options: [['foreach','по элементам'],['while','пока условие'],['repeat','N раз']] },
        { key: 'items_var', label: 'Переменная-список', type: 'text', default: 'ctx.items', when: n => n.mode === 'foreach' },
        { key: 'condition', label: 'Условие продолжения', type: 'code', when: n => n.mode === 'while' },
        { key: 'max_iterations', label: 'Максимум витков', type: 'number', default: 10, min: 1, step: 1, required: true },
        { key: 'delay_s', label: 'Пауза между витками, с', type: 'number', default: 0.000, step: 0.001 },
        { key: 'break_on_error', label: 'Прерывать при ошибке', type: 'bool', default: true },
      ],
      summary: p => ({ foreach: `по ${p.items_var || 'списку'}`, while: p.condition || 'пока условие', repeat: `${p.max_iterations} раз` })[p.mode] || '',
    },

    queue: {
      label: 'Очередь', category: 'flow', color: '#a3e635', icon: '≡',
      desc: 'Правила выполнения ветвей ниже: порядок, параллельность, повторы.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('out', 'задачи')],
      params: [
        { key: 'mode', label: 'Режим', type: 'select', default: 'sequential',
          options: [['sequential','последовательно'],['parallel','параллельно']] },
        { key: 'concurrency', label: 'Одновременно', type: 'number', default: 4, min: 1, step: 1, when: n => n.mode === 'parallel' },
        { key: 'order', label: 'Порядок выборки', type: 'select', default: 'fifo',
          options: [['fifo','FIFO'],['lifo','LIFO'],['priority','по приоритету']] },
        { key: 'priority', label: 'Приоритет', type: 'number', default: 0, step: 1 },
        { key: 'retry', label: 'Повторы при ошибке', type: 'number', default: 1, min: 0, step: 1 },
        { key: 'backoff_s', label: 'Backoff, с', type: 'number', default: 1.500, step: 0.001 },
        { key: 'rate_limit', label: 'Лимит, задач/мин', type: 'number', default: 0, min: 0, step: 1 },
        { key: 'dedupe', label: 'Отбрасывать дубли', type: 'bool', default: false },
        { key: 'on_error', label: 'При ошибке', type: 'select', default: 'stop',
          options: [['stop','остановить'],['skip','пропустить'],['requeue','вернуть в очередь']] },
      ],
      summary: p => (p.mode === 'parallel' ? `параллельно ×${p.concurrency}` : 'последовательно') + ` · ${p.order}`,
    },

    merge: {
      label: 'Слияние', category: 'flow', color: '#94a3b8', icon: '⋔',
      desc: 'Сводит несколько ветвей в одну.',
      inputs: [IN('in', 'ветви', 'flow', true)],
      outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'strategy', label: 'Стратегия', type: 'select', default: 'all',
          options: [['all','ждать все'],['any','любую'],['first','первую пришедшую']] },
        { key: 'timeout_s', label: 'Таймаут, с', type: 'number', default: 60.000, step: 0.001 },
        { key: 'output_var', label: 'Записать в', type: 'text', default: 'ctx.merged' },
      ],
      summary: p => ({ all:'ждать все ветви', any:'любая ветвь', first:'первая ветвь' })[p.strategy] || '',
    },

    choice: {
      label: 'Выбор пользователя', category: 'flow', color: '#f472b6', icon: '☑',
      desc: 'Пауза: пользователь отмечает галочками, что запускать. На каждый вариант — свой выход, порты появляются сами из списка вариантов.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: p => topOptions(p).map(o => OUT(o.key, o.label)).concat([OUT('none', 'ничего не выбрано')]),
      params: [
        { key: 'title', label: 'Заголовок для пользователя', type: 'text', default: 'Что проверяем?', required: true },
        /* Если выбор делается по данным — показываем эти данные рядом с вопросом.
           Иначе пользователь подтверждает вслепую. */
        { key: 'show_var', label: 'Показать перед выбором', type: 'text', placeholder: 'ctx.profile_card' },
        { key: 'mode', label: 'Режим', type: 'select', default: 'multi',
          options: [['multi','несколько галочек'],['single','один вариант']] },
        { key: 'options', label: 'Варианты: «ключ = подпись», отступ — подпункт, [free] / [paid] — тариф',
          type: 'textarea', required: true,
          default: 'bugs = Поиск багов\n  bugs_low = Низкая критичность [free]\n  bugs_high = Критичные баги [paid]' },
        { key: 'allow_select_all', label: 'Кнопка «выбрать всё» — полная ревизия', type: 'bool', default: true },
        { key: 'defaults', label: 'Отмечено по умолчанию', type: 'tags', default: ['bugs'] },
        { key: 'timeout_s', label: 'Ждать ответа, с', type: 'number', default: 600.000, step: 0.001 },
        { key: 'on_timeout', label: 'Если не ответили', type: 'select', default: 'defaults',
          options: [['defaults','взять отмеченное по умолчанию'],['none','ничего не запускать'],['fail','остановить']] },
        { key: 'output_var', label: 'Выбор записать в', type: 'text', default: 'ctx.selected' },
      ],
      summary: p => {
        const all = parseOptions(p.options);
        if (!all.length) return 'варианты не заданы';
        // считаем листья: у пункта с подпунктами тариф задаётся подпунктами
        const leaves = all.filter(o => o.level === 1 || !all.some(x => x.parent === o.key));
        const paid = leaves.filter(o => o.tier === 'paid').length;
        return `${topOptions(p).length} пунктов · ${leaves.length - paid} беспл. / ${paid} платн.`;
      },
    },

    direction: {
      label: 'Направление анализа', category: 'flow', color: '#d946ef', icon: '⊟',
      desc: 'Карточка одного пункта меню. Раскладывает направление на подпункты и раздаёт их экспертам — по порту на каждый подпункт.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: p => parseOptions(p.items).filter(o => o.level === 0).map(o => OUT(o.key, o.label)),
      params: [
        { key: 'title', label: 'Направление', type: 'text', default: 'Баги', required: true },
        { key: 'items', label: 'Подпункты: «ключ = подпись», по порту на каждый', type: 'textarea', required: true,
          default: 'logic = Логика\nerrors = Обработка ошибок' },
        { key: 'run', label: 'Что запускаем', type: 'select', default: 'all',
          options: [['all','все подпункты направления'],['selected','только отмеченные пользователем']] },
        { key: 'concurrency', label: 'Экспертов одновременно', type: 'number', default: 6, min: 1, step: 1 },
        { key: 'on_error', label: 'Если эксперт упал', type: 'select', default: 'skip',
          options: [['skip','пропустить его находки'],['retry','повторить'],['stop','остановить направление']] },
        { key: 'output_var', label: 'Запись о раздаче в', type: 'text', default: 'ctx.direction' },
      ],
      summary: p => `${parseOptions(p.items).filter(o => o.level === 0).length} подпунктов · ` +
                    (p.run === 'all' ? 'запускаем все' : 'только отмеченные'),
    },

    /* ── РАБОТА ──────────────────────────────────────────── */
    task: {
      label: 'Задание', category: 'work', color: '#8b7cf6', icon: '▤',
      desc: 'Единица работы с текстовой инструкцией.',
      inputs: [IN('in', 'вход', 'flow', true), IN('kb', 'знания', 'data', true)],
      outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'instruction', label: 'Инструкция', type: 'textarea', required: true, placeholder: 'что нужно сделать…' },
        { key: 'inputs', label: 'Входные переменные', type: 'tags', placeholder: 'ctx.symbol' },
        { key: 'output_var', label: 'Записать в', type: 'text', default: 'ctx.result' },
        { key: 'timeout_s', label: 'Таймаут, с', type: 'number', default: 120.000, step: 0.001 },
        { key: 'on_error', label: 'При ошибке', type: 'select', default: 'fail',
          options: [['fail','остановить'],['continue','продолжить'],['retry','повторить']] },
      ],
      summary: p => (p.instruction || '').split('\n')[0] || '—',
    },

    agent: {
      label: 'Агент (API)', category: 'work', color: '#6ea8ff', icon: '◆',
      desc: 'LLM-агент, вызывается по HTTP API. Базы знаний подключаются в порт «знания»; при включённом «входе карты» граф связей приходит отдельным data-портом «карта».',
      inputs: p => {
        const base = [IN('in', 'вход', 'flow', true), IN('kb', 'знания', 'data', true)];
        return p.graph_in ? base.concat([IN('graph', 'карта', 'data', true)]) : base;
      },
      outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'provider', label: 'Провайдер', type: 'select', default: 'project',
          options: [['project','модель проекта'],['openai-compatible','OpenAI-совместимый'],['anthropic','Anthropic'],['ollama','Ollama'],['custom','свой HTTP']] },
        { key: 'base_url', label: 'Base URL', type: 'text', required: true, default: 'https://api.openai.com/v1',
          when: n => n.provider !== 'project' },
        { key: 'model', label: 'Модель', type: 'text', required: true, placeholder: 'gpt-4o-mini',
          when: n => n.provider !== 'project' },
        { key: 'api_key_env', label: 'Ключ из переменной окружения', type: 'text', default: 'OPENAI_API_KEY',
          when: n => n.provider !== 'project' },
        { key: 'model_ref', label: 'Какая модель проекта', type: 'select', default: 'primary',
          options: [['primary','основная — дешевле, контекст меньше'],['heavy','тяжёлая — большой контекст']],
          when: n => n.provider === 'project' },
        { key: 'system_prompt', label: 'System prompt', type: 'textarea' },
        { key: 'prompt', label: 'Prompt', type: 'textarea', required: true, placeholder: 'Проанализируй {{ctx.symbol}}…' },
        { key: 'temperature', label: 'Temperature', type: 'number', default: 0.200, step: 0.001, min: 0, max: 2 },
        { key: 'max_tokens', label: 'Max tokens (ответ)', type: 'number', default: 4096, step: 1, min: 1 },
        { key: 'tools', label: 'Инструменты', type: 'tags', placeholder: 'web_search' },
        { key: 'graph_in', label: 'Вход «карта»: принимать граф связей отдельным data-портом', type: 'bool', default: false },
        { key: 'output_var', label: 'Записать в', type: 'text', default: 'ctx.answer' },
        { key: 'retry', label: 'Повторы', type: 'number', default: 2, min: 0, step: 1 },
        { key: 'timeout_s', label: 'Таймаут, с', type: 'number', default: 180.000, step: 0.001 },
        { key: 'stream', label: 'Стриминг', type: 'bool', default: false },
      ],
      summary: p => {
        if (p.provider !== 'project') return p.model || 'модель не задана';
        const m = window.Graph && window.Graph.state.meta.models &&
                  window.Graph.state.meta.models[p.model_ref || 'primary'];
        return m ? `${m.model || 'модель не задана'} · ${m.label}` : 'модель проекта';
      },
    },

    expert: {
      label: 'Эксперт', category: 'work', color: '#a78bfa', icon: '◈',
      desc: 'Агент с узкой специализацией. Работает по своему чек-листу, возвращает находки в общей схеме. Критичность не выставляет — это делает отдельный агент градации.',
      inputs: [IN('in', 'вход', 'flow', true), IN('kb', 'контекст', 'data', true)],
      outputs: [OUT('out', 'находки')],
      params: [
        { key: 'role', label: 'Направление', type: 'text', required: true, placeholder: 'логика' },
        { key: 'checklist', label: 'Чек-лист: по пункту на строку', type: 'textarea', required: true,
          placeholder: 'что именно ищем — по одному признаку в строке' },
        { key: 'scope', label: 'Где ищет', type: 'select', default: 'graph_then_code',
          options: [['graph_then_code','сначала спросить граф, потом читать код'],['code','только код'],['graph','только граф']] },
        { key: 'ignores', label: 'Что не трогает', type: 'tags', default: ['стиль','форматирование','именование'] },
        { key: 'scenario_required', label: 'Требовать сценарий отказа', type: 'bool', default: true },
        { key: 'evidence_required', label: 'Требовать доказательство из кода', type: 'bool', default: true },
        { key: 'sets_severity', label: 'Выставляет критичность сам', type: 'bool', default: false },
        { key: 'model_ref', label: 'Модель проекта', type: 'select', default: 'primary',
          options: [['primary','основная'],['heavy','тяжёлая']] },
        { key: 'temperature', label: 'Temperature', type: 'number', default: 0.000, step: 0.001, min: 0, max: 2 },
        { key: 'max_tokens', label: 'Потолок ответа', type: 'number', default: 8192, min: 1, step: 1 },
        { key: 'retry', label: 'Повторы', type: 'number', default: 2, min: 0, step: 1 },
        { key: 'timeout_s', label: 'Таймаут, с', type: 'number', default: 600.000, step: 0.001 },
        { key: 'output_var', label: 'Находки в', type: 'text', default: 'ctx.findings_expert' },
      ],
      summary: p => {
        const n = String(p.checklist || '').split('\n').filter(s => s.trim()).length;
        return `${p.role || 'направление не задано'} · ${n} п. чек-листа`;
      },
    },

    expert_group: {
      label: 'Группа экспертов', category: 'work', color: '#a78bfa', icon: '◈',
      desc: 'Одна карточка на всё направление. Эксперты — строки состава, а не отдельные блоки: у них одинаковые входы и выходы, отличаются только поля. Порта на эксперта нет, разветвление происходит внутри.',
      inputs: [IN('in', 'вход', 'flow', true), IN('kb', 'контекст', 'data', true)],
      outputs: [OUT('out', 'находки')],
      params: [
        { key: 'title', label: 'Направление группы', type: 'text', required: true, default: 'Баги' },

        { key: 'model_ref', label: 'Модель по умолчанию', type: 'select', default: 'primary',
          options: [['primary','основная'],['heavy','тяжёлая']] },
        { key: 'temperature', label: 'Температура', type: 'number', default: 0.000, step: 0.001, min: 0, max: 2 },
        { key: 'max_tokens', label: 'Потолок ответа', type: 'number', default: 8192, min: 1, step: 1 },
        { key: 'timeout_s', label: 'Таймаут, с', type: 'number', default: 600.000, step: 0.001 },
        { key: 'retry', label: 'Повторы', type: 'number', default: 2, min: 0, step: 1 },
        { key: 'scope', label: 'Где ищут по умолчанию', type: 'select', default: 'graph_then_code',
          options: [['graph_then_code','сначала граф, потом код'],['code','только код'],['graph','только граф']] },
        { key: 'tools', label: 'Инструменты — общие для всех строк', type: 'tags', default: ['graph_query','code_read'] },
        { key: 'concurrency', label: 'Одновременно', type: 'number', default: 6, min: 1, step: 1 },
        { key: 'on_error', label: 'Если эксперт упал', type: 'select', default: 'mark',
          options: [['mark','пропустить, но пометить направление неполным'],['skip','пропустить молча'],
                    ['retry','повторить'],['stop','остановить группу']] },
        { key: 'rules', label: 'Правила направления — общие для всех строк', type: 'textarea',
          placeholder: 'что запрещено утверждать, без чего находка не выдаётся' },
        { key: 'ignores', label: 'Что не трогают', type: 'tags', default: ['стиль','форматирование','именование'] },
        { key: 'scenario_required', label: 'Требовать сценарий отказа', type: 'bool', default: true },
        { key: 'evidence_required', label: 'Требовать доказательство из кода', type: 'bool', default: true },
        { key: 'sets_severity', label: 'Выставляют критичность сами', type: 'bool', default: false },

        { key: 'experts', label: 'Состав', type: 'list', required: true, default: [],
          itemLabel: it => it.role || 'без роли',
          itemBadge: it => it.scope || '',
          item: [
            { key: 'role', label: 'Роль', type: 'text', required: true, placeholder: 'логика' },
            { key: 'checklist', label: 'Чек-лист: по пункту на строку', type: 'textarea', required: true },
            { key: 'method', label: 'Метод: в каком порядке искать и что считать доказанным', type: 'textarea',
              placeholder: 'по шагу на строку' },
            { key: 'scope', label: 'Где ищет', type: 'select', default: '',
              options: [['','как у группы'],['graph_then_code','сначала граф, потом код'],['code','только код'],['graph','только граф']] },
            { key: 'model_ref', label: 'Модель', type: 'select', default: '',
              options: [['','как у группы'],['primary','основная'],['heavy','тяжёлая']] },
            { key: 'tools', label: 'Инструменты', type: 'tags', placeholder: 'graph_query' },
            { key: 'output_var', label: 'Переменная вывода', type: 'text', required: true },
          ] },

        { key: 'output_var', label: 'Свод группы в', type: 'text', default: 'ctx.findings_group' },
      ],
      summary: p => `${p.title || '—'} · ${(p.experts || []).length} экспертов`,
      chips: p => {
        const by = {}, def = p.scope || 'graph_then_code';
        for (const e of (p.experts || [])) { const s = e.scope || def; by[s] = (by[s] || 0) + 1; }
        const name = { graph: 'граф', code: 'код', graph_then_code: 'граф→код' };
        return Object.entries(by).map(([k, n]) => `${name[k] || k} ${n}`);
      },
      preview: p => {
        const roles = (p.experts || []).map(e => e.role).filter(Boolean);
        return roles.slice(0, 3).join(' · ') + (roles.length > 3 ? `  +${roles.length - 3}` : '');
      },
    },

    script: {
      label: 'Скрипт', category: 'work', color: '#fb7185', icon: '>_',
      desc: 'Системный скрипт: PowerShell / bash / python / node. Порт «знания» — если скрипт работает по графу проекта, а не по файлам.',
      inputs: [IN('in', 'вход', 'flow', true), IN('kb', 'знания', 'data', true)],
      outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'runtime', label: 'Среда', type: 'select', default: 'powershell',
          options: [['powershell','PowerShell'],['bash','bash'],['python','python'],['cmd','cmd'],['node','node']] },
        { key: 'code', label: 'Код', type: 'code', required: true, default: 'Write-Output "ok"' },
        { key: 'cwd', label: 'Рабочая папка', type: 'text', placeholder: 'C:\\path\\to\\project' },
        { key: 'env', label: 'Переменные окружения', type: 'textarea', placeholder: 'KEY=VALUE\nKEY2=VALUE2' },
        { key: 'timeout_s', label: 'Таймаут, с', type: 'number', default: 60.000, step: 0.001 },
        { key: 'output_var', label: 'Записать stdout в', type: 'text', default: 'ctx.stdout' },
        { key: 'on_error', label: 'При ошибке', type: 'select', default: 'fail',
          options: [['fail','остановить'],['continue','продолжить'],['retry','повторить']] },
      ],
      summary: p => `${p.runtime} · ${(p.code || '').split('\n')[0].slice(0, 28)}`,
    },

    /* ── ДАННЫЕ ──────────────────────────────────────────── */
    kb: {
      label: 'База знаний', category: 'data', color: '#2dd4bf', icon: '▦',
      desc: 'Источник знаний. Подключается пунктиром в порт «знания» задания или агента.',
      inputs: [], outputs: [OUT('data', 'знания', 'data')],
      params: [
        { key: 'kind', label: 'Тип', type: 'select', default: 'folder',
          options: [['folder','папка'],['files','файлы'],['sqlite','SQLite'],['vector','векторный индекс'],['url','URL'],['api','API']] },
        { key: 'source', label: 'Источник', type: 'text', required: true, placeholder: 'C:\\docs  |  https://…' },
        { key: 'glob', label: 'Маска файлов', type: 'text', default: '**/*.md', when: n => n.kind === 'folder' },
        { key: 'embed_model', label: 'Модель эмбеддингов', type: 'text', placeholder: 'text-embedding-3-small' },
        { key: 'top_k', label: 'Top-K', type: 'number', default: 5, min: 1, step: 1 },
        { key: 'chunk_size', label: 'Размер чанка', type: 'number', default: 800, min: 64, step: 1 },
        { key: 'chunk_overlap', label: 'Перекрытие', type: 'number', default: 120, min: 0, step: 1 },
        { key: 'refresh', label: 'Обновление', type: 'select', default: 'on_start',
          options: [['manual','вручную'],['on_start','при старте'],['interval','по интервалу']] },
        { key: 'interval_min', label: 'Интервал, мин', type: 'number', default: 60, min: 1, step: 1, when: n => n.refresh === 'interval' },
      ],
      summary: p => p.source || 'источник не задан',
    },

    codegraph: {
      label: 'Граф знаний', category: 'data', color: '#38bdf8', icon: '⁘',
      desc: 'Строит граф проекта из AST: файлы, модули, классы, функции, вызовы, импорты, модели БД, эндпоинты. Дальнейшие агенты не читают проект целиком, а спрашивают граф запросом.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('out', 'дальше'), OUT('graph', 'граф', 'data')],
      params: [
        { key: 'builder', label: 'Чем строим', type: 'select', default: 'tree-sitter',
          options: [['tree-sitter','tree-sitter — мультиязычный AST'],['codegraphcontext','CodeGraphContext (MCP, Neo4j)'],
                    ['native','парсер под язык проекта'],['custom','свой индексатор']] },
        { key: 'source', label: 'Что индексируем', type: 'text', default: '{{ctx.project_path}}', required: true },
        { key: 'where', label: 'Где идёт разбор', type: 'select', default: 'auto',
          options: [['auto','по способу подключения проекта'],['client','на машине пользователя — код не уезжает'],['server','на нашем сервере']] },
        { key: 'languages', label: 'Языки', type: 'tags', default: ['auto'] },
        { key: 'extract', label: 'Что извлекаем', type: 'tags',
          default: ['files','modules','classes','functions','calls','imports','db_models','endpoints','configs','env_vars'] },
        { key: 'storage', label: 'Где храним', type: 'select', default: 'neo4j',
          options: [['neo4j','Neo4j — запросы на Cypher'],['sqlite','SQLite'],['json','JSON-файл']] },
        { key: 'uri', label: 'Подключение', type: 'text', default: 'bolt://localhost:7687',
          when: n => n.storage !== 'json' },
        { key: 'path', label: 'Файл графа', type: 'text', default: 'work\\graph.json', when: n => n.storage === 'json' },
        { key: 'exclude', label: 'Исключить', type: 'tags',
          default: ['node_modules','.git','dist','build','venv','__pycache__','vendor'] },
        { key: 'incremental', label: 'Инкрементально — только изменённое', type: 'bool', default: true },
        { key: 'max_files', label: 'Потолок файлов', type: 'number', default: 20000, min: 1, step: 1 },
        { key: 'summarize', label: 'Семантический слой: резюме модулей агентом', type: 'bool', default: false },
        { key: 'output_var', label: 'Дескриптор графа в', type: 'text', default: 'ctx.graph' },
      ],
      summary: p => `${p.builder} → ${p.storage}`,
    },

    context: {
      label: 'Контекст проекта', category: 'data', color: '#818cf8', icon: '⊕',
      desc: 'Собирает граф, доступ к коду и базы знаний в один пучок и отдаёт его агентам одним портом. Одна точка подключения вместо связи от каждого источника к каждому агенту.',
      inputs: [IN('in', 'источники', 'data', true)],
      outputs: [OUT('out', 'контекст', 'data')],
      params: [
        { key: 'budget_tokens', label: 'Потолок контекста на агента, токенов', type: 'number', default: 60000, min: 1000, step: 1 },
        { key: 'budget_by_writing', label: 'Поправлять потолок на письменность проекта', type: 'bool', default: true },
        { key: 'reply_lang', label: 'Язык ответов экспертов', type: 'text', default: '{{ctx.reply_lang}}' },
        { key: 'quote_original', label: 'Цитаты из кода не переводить', type: 'bool', default: true },
        { key: 'priority', label: 'Что подмешиваем первым', type: 'tags', default: ['graph','manifests','code'] },
        { key: 'fetch', label: 'Как достаём код', type: 'select', default: 'on_demand',
          options: [['on_demand','по запросу агента'],['prefetch','заранее, по подсказке графа']] },
        { key: 'cache', label: 'Кешировать собранный контекст', type: 'bool', default: true },
      ],
      summary: p => `${(p.priority || []).join(' → ')} · ${p.budget_tokens} ток.`,
    },

    transform: {
      label: 'Преобразование', category: 'data', color: '#c084fc', icon: 'ƒ',
      desc: 'Переложить/посчитать данные в контексте между шагами.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'language', label: 'Язык', type: 'select', default: 'expression',
          options: [['expression','выражение'],['python','python'],['js','javascript']] },
        { key: 'code', label: 'Код', type: 'code', required: true, default: 'ctx.items = ctx.answer.split("\\n")' },
        { key: 'output_var', label: 'Записать в', type: 'text', default: 'ctx.items' },
      ],
      summary: p => (p.code || '').split('\n')[0] || '—',
    },

    /* ── ВЫХОД ───────────────────────────────────────────── */
    output: {
      label: 'Результат', category: 'io', color: '#4ade80', icon: '◼',
      desc: 'Куда положить итог конвейера.',
      inputs: [IN('in', 'вход', 'flow', true)], outputs: [],
      params: [
        { key: 'target', label: 'Назначение', type: 'select', default: 'file',
          options: [['file','файл'],['console','консоль'],['webhook','webhook'],['variable','переменная'],['telegram','telegram']] },
        { key: 'path', label: 'Путь / URL', type: 'text', placeholder: 'out\\result.json' },
        { key: 'format', label: 'Формат', type: 'select', default: 'json',
          options: [['json','JSON'],['text','текст'],['markdown','Markdown'],['csv','CSV']] },
        { key: 'append', label: 'Дописывать', type: 'bool', default: false },
      ],
      summary: p => `${p.target}${p.path ? ' → ' + p.path : ''}`,
    },

    store: {
      label: 'Хранилище', category: 'io', color: '#10b981', icon: '▣',
      desc: 'Складывает у нас всё, что дал прогон, независимо от тарифа: находки, а на шаге приёма — карточку самого проекта. Гейт стоит дальше, на выдаче: храним полностью, отдаём частично. Накопленное — наша база знаний для следующих прогонов.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('out', 'дальше'), OUT('data', 'записанное', 'data')],
      params: [
        /* Что именно кладём. Один и тот же блок пишет и находки, и карточку
           проекта — исполнителю надо знать форму записи. */
        { key: 'writes', label: 'Что записываем', type: 'tags', default: ['находки'] },
        { key: 'dataset', label: 'Набор данных', type: 'text', default: 'findings', required: true },
        /* Копим чужие проекты — значит по умолчанию обезличиваем: имена и пути
           хешируем, исходники в базу знаний не уезжают. */
        { key: 'anonymize', label: 'Обезличивать: хеши вместо имён и путей', type: 'bool', default: true },
        { key: 'target', label: 'Где храним', type: 'select', default: 'postgres',
          options: [['postgres','PostgreSQL'],['s3','S3 / объектное хранилище'],['sqlite','SQLite'],['neo4j','рядом с графом, в Neo4j']] },
        { key: 'uri', label: 'Подключение', type: 'text', default: 'postgres://localhost/findings' },
        { key: 'keep', label: 'Срок хранения', type: 'select', default: 'forever',
          options: [['forever','бессрочно'],['days','N дней'],['until_paid','до оплаты, потом бессрочно']] },
        { key: 'keep_days', label: 'Сколько дней', type: 'number', default: 365, min: 1, step: 1, when: n => n.keep === 'days' },
        { key: 'dedupe_key', label: 'Ключ дедупликации', type: 'text', default: 'project_id + file + rule + code_hash' },
        { key: 'versioning', label: 'Хранить историю прогонов', type: 'bool', default: true },
        { key: 'redact_secrets', label: 'Вырезать секреты перед сохранением', type: 'bool', default: true },
        { key: 'store_snippets', label: 'Хранить фрагменты кода вместе с находкой', type: 'bool', default: false },
        { key: 'output_var', label: 'Идентификатор прогона в', type: 'text', default: 'ctx.run_id' },
      ],
      summary: p => `${(p.writes || []).join(', ') || '—'} → ${p.target} · ` +
                    `${({ forever: 'бессрочно', days: p.keep_days + ' дн.', until_paid: 'до оплаты → бессрочно' })[p.keep] || ''}`,
    },

    paywall: {
      label: 'Гейт выдачи', category: 'io', color: '#eab308', icon: '$',
      desc: 'Делит готовые находки на бесплатную часть, витрину («нашли N критичных») и платную. Ничего не пересчитывает — только решает, что показать.',
      inputs: [IN('in', 'вход', 'flow', true), IN('findings', 'находки', 'data', true)],
      outputs: [OUT('free', 'отдать сразу'), OUT('preview', 'витрина'), OUT('paid', 'после оплаты')],
      params: [
        { key: 'source_of_truth', label: 'Откуда берём разметку тарифа', type: 'select', default: 'menu',
          options: [['menu','метки [free]/[paid] из блока выбора'],['list','свой список ниже']] },
        { key: 'free_items', label: 'Бесплатные пункты', type: 'tags',
          default: [], when: n => n.source_of_truth === 'list' },
        { key: 'free_severity', label: 'Бесплатные уровни критичности', type: 'tags', default: ['info','low'] },
        { key: 'preview_shows', label: 'Что видно в витрине без оплаты', type: 'tags',
          default: ['количество','критичность','категория','имя файла'] },
        { key: 'preview_hides', label: 'Что скрыто до оплаты', type: 'tags',
          default: ['строка','фрагмент кода','сценарий отказа','способ эксплуатации','патч'] },
        { key: 'provider', label: 'Приём оплаты', type: 'select', default: 'stripe',
          options: [['stripe','Stripe'],['yookassa','ЮKassa'],['crypto','крипта'],['manual','вручную / счёт']] },
        { key: 'price_model', label: 'Модель', type: 'select', default: 'one_off',
          options: [['one_off','разовый отчёт'],['subscription','подписка'],['per_finding','за находку']] },
        { key: 'wait_s', label: 'Ждать оплаты, с', type: 'number', default: 86400.000, step: 0.001 },
        { key: 'access_after_pay', label: 'Доступ после оплаты', type: 'select', default: 'forever',
          options: [['forever','бессрочно'],['period','на период'],['single','однократная выгрузка']] },
        { key: 'output_var', label: 'Статус оплаты в', type: 'text', default: 'ctx.payment' },
      ],
      summary: p => p.source_of_truth === 'list'
        ? `бесплатно: ${(p.free_items || []).join(', ') || '—'}`
        : 'тариф по меткам из меню',
    },

    progress: {
      label: 'Прогресс', category: 'io', color: '#a78bfa', icon: '◴',
      desc: 'Экран хода работы у пользователя: этапы, проценты, текущий файл. Держится, пока идёт длинная стадия.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'title', label: 'Заголовок', type: 'text', default: 'Сканирование проекта', required: true },
        { key: 'show', label: 'Что показываем', type: 'tags',
          default: ['этапы','проценты','текущий файл','счётчик файлов','расчётное время','ошибки'] },
        /* Расчётное время честнее всего берётся из истории прогонов: сколько
           заняли проекты того же размера и языка. Пока базы нет — по числу файлов. */
        { key: 'eta_from', label: 'Откуда расчётное время', type: 'select', default: 'history',
          options: [['history','из истории прогонов — похожие проекты'],['files','по числу файлов'],['off','не показывать']] },
        { key: 'events_from', label: 'Источник событий', type: 'text', default: 'ctx.scan_events' },
        { key: 'update_ms', label: 'Частота обновления, мс', type: 'number', default: 500, min: 50, step: 1 },
        { key: 'cancellable', label: 'Можно отменить', type: 'bool', default: true },
        { key: 'on_cancel', label: 'При отмене', type: 'select', default: 'stop',
          options: [['stop','остановить конвейер'],['background','доделать в фоне']] },
      ],
      summary: p => p.title || '',
    },

    note: {
      label: 'Заметка', category: 'io', color: '#64748b', icon: '✎',
      desc: 'Комментарий на холсте. В выполнении не участвует.',
      inputs: [], outputs: [],
      params: [{ key: 'text', label: 'Текст', type: 'textarea', default: 'Заметка…' }],
      summary: p => (p.text || '').split('\n')[0],
    },

    /* ── УНИВЕРСАЛЬНЫЕ: вход · обработка · выход ─────────────
       Остальные блоки писались под разбор кодовых проектов, и их заводские
       значения — примеры оттуда (work\project, .env/*.pem, история git).
       Эта тройка предметной области не знает: почти все поля БЕЗ default,
       только подсказка-плейсхолдер. Пустая карточка честнее чужой:
       и человек, и ИИ видят, что заполнить, и не тащат мусор из другого проекта. */

    input: {
      label: 'Вход данных', category: 'flow', color: '#22d3ee', icon: '⤓',
      desc: 'УНИВЕРСАЛЬНЫЙ вход: откуда берутся данные — API, вебхук, поток, файл, база, лента, ручной ввод. Предметной области не знает: годится для новостей, сообщений, метрик, трафика, заявок, прайсов. Отдаёт полученное дальше по потоку и, при надобности, пунктиром как знания.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('out', 'дальше'), OUT('data', 'данные', 'data')],
      params: [
        { key: 'kind', label: 'Откуда', type: 'select', default: 'api',
          options: [['api','API-запрос'],['webhook','вебхук (приходит к нам)'],['stream','поток / подписка'],
                    ['feed','лента RSS/Atom'],['file','файл или папка'],['db','база данных'],
                    ['scrape','страница сайта'],['manual','ручной ввод']] },
        { key: 'source', label: 'Адрес источника', type: 'text', required: true,
          placeholder: 'https://api.example.com/v1/messages  |  каналы @a, @b  |  postgres://…' },
        { key: 'method', label: 'Метод', type: 'select', default: 'GET',
          options: [['GET','GET'],['POST','POST']], when: p => p.kind === 'api' || p.kind === 'scrape' },
        { key: 'query', label: 'Запрос / параметры', type: 'textarea',
          placeholder: 'что именно забираем: фильтр, SQL, параметры запроса, список каналов' },
        { key: 'auth_env', label: 'Ключ доступа — имя переменной окружения', type: 'text',
          placeholder: 'TELEGRAM_API_KEY  (сам ключ в план не пишем)' },
        { key: 'format', label: 'Формат данных', type: 'select', default: 'json',
          options: [['json','JSON'],['text','текст'],['csv','CSV'],['xml','XML'],['html','HTML'],['binary','двоичный']] },
        { key: 'schedule', label: 'Как часто забирать', type: 'select', default: 'interval',
          options: [['once','один раз'],['interval','по интервалу'],['realtime','в реальном времени'],['on_event','по событию']] },
        { key: 'interval_s', label: 'Интервал, с', type: 'number', default: 60.000, min: 1, step: 0.001,
          when: p => p.schedule === 'interval' },
        { key: 'fields', label: 'Какие поля берём', type: 'tags', placeholder: 'id, text, author, ts' },
        { key: 'limit', label: 'Лимит за раз', type: 'number', min: 0, step: 1, placeholder: '0 — без лимита' },
        { key: 'dedupe_key', label: 'Ключ уникальности', type: 'text', placeholder: 'id — чтобы не брать одно и то же дважды' },
        { key: 'output_var', label: 'Записать в', type: 'text', placeholder: 'ctx.messages' },
        { key: 'on_error', label: 'При ошибке', type: 'select', default: 'retry',
          options: [['fail','остановить'],['continue','продолжить'],['retry','повторить']] },
      ],
      summary: p => `${p.kind || 'api'}${p.source ? ' · ' + p.source : ' · источник не задан'}`,
    },

    process: {
      label: 'Обработка', category: 'work', color: '#a78bfa', icon: '⚗',
      desc: 'УНИВЕРСАЛЬНЫЙ шаг обработки данных без вызова модели: отфильтровать, привести к виду, обогатить, убрать дубли, сгруппировать, посчитать, разметить по правилу. Что именно делать — в поле «Правило».',
      inputs: [IN('in', 'вход', 'flow', true), IN('kb', 'знания', 'data', true)],
      outputs: [OUT('out', 'дальше'), OUT('data', 'результат', 'data')],
      params: [
        { key: 'op', label: 'Что делаем', type: 'select', default: 'filter',
          options: [['filter','отобрать нужное'],['map','привести к виду'],['enrich','обогатить'],
                    ['dedupe','убрать дубли'],['aggregate','сгруппировать и посчитать'],['classify','разметить по правилу'],
                    ['score','оценить'],['join','объединить источники'],['split','разбить'],['clean','почистить']] },
        { key: 'rule', label: 'Правило', type: 'textarea', required: true,
          placeholder: 'словами или выражением: «оставить сообщения за 24ч со словами из списка»' },
        { key: 'input_var', label: 'Что берём', type: 'text', placeholder: 'ctx.messages' },
        { key: 'fields', label: 'Поля', type: 'tags', placeholder: 'text, author, ts' },
        { key: 'group_by', label: 'Группировать по', type: 'text', placeholder: 'канал, час', when: p => p.op === 'aggregate' },
        { key: 'window', label: 'Окно', type: 'text', placeholder: '24h', when: p => p.op === 'aggregate' || p.op === 'dedupe' },
        { key: 'output_var', label: 'Записать в', type: 'text', placeholder: 'ctx.filtered' },
        { key: 'on_error', label: 'При ошибке', type: 'select', default: 'fail',
          options: [['fail','остановить'],['continue','продолжить'],['retry','повторить']] },
      ],
      summary: p => `${p.op || 'filter'}${p.rule ? ' · ' + String(p.rule).split('\n')[0] : ' · правило не задано'}`,
    },

    sink: {
      label: 'Выход данных', category: 'io', color: '#34d399', icon: '⤒',
      desc: 'УНИВЕРСАЛЬНАЯ отдача наружу: отправить в API или вебхук, записать в базу или файл, послать сообщение в мессенджер, положить в очередь, показать на дашборде. В отличие от «Результата» ветка на нём не заканчивается — можно продолжить цепочку.',
      inputs: [IN('in', 'вход', 'flow', true)],
      outputs: [OUT('out', 'дальше')],
      params: [
        { key: 'channel', label: 'Куда', type: 'select', default: 'api',
          options: [['api','API-запрос'],['webhook','вебхук'],['db','база данных'],['file','файл'],
                    ['message','сообщение в мессенджер'],['email','почта'],['queue','очередь'],
                    ['dashboard','дашборд'],['console','консоль']] },
        { key: 'target', label: 'Адрес назначения', type: 'text', required: true,
          placeholder: 'https://hooks.example.com/…  |  @my_channel  |  out\\feed.json' },
        { key: 'method', label: 'Метод', type: 'select', default: 'POST',
          options: [['POST','POST'],['PUT','PUT'],['PATCH','PATCH']], when: p => p.channel === 'api' || p.channel === 'webhook' },
        { key: 'auth_env', label: 'Ключ доступа — имя переменной окружения', type: 'text',
          placeholder: 'WEBHOOK_TOKEN  (сам ключ в план не пишем)' },
        { key: 'payload', label: 'Что отправляем', type: 'textarea', placeholder: 'ctx.digest  |  шаблон сообщения' },
        { key: 'format', label: 'Формат', type: 'select', default: 'json',
          options: [['json','JSON'],['text','текст'],['markdown','Markdown'],['csv','CSV'],['html','HTML']] },
        { key: 'batch', label: 'Пачкой, штук', type: 'number', min: 1, step: 1, placeholder: '1 — по одному' },
        { key: 'rate_limit', label: 'Лимит, в минуту', type: 'number', min: 0, step: 1, placeholder: '0 — без лимита' },
        { key: 'retry', label: 'Повторов', type: 'number', default: 2, min: 0, step: 1 },
        { key: 'on_error', label: 'При ошибке', type: 'select', default: 'retry',
          options: [['fail','остановить'],['continue','продолжить'],['retry','повторить']] },
      ],
      summary: p => `${p.channel || 'api'}${p.target ? ' → ' + p.target : ' · адрес не задан'}`,
    },
  };

  /* Значения по умолчанию для нового блока.
     Массивы/объекты клонируем: иначе все блоки одного типа делят один экземпляр
     (правка тегов/списка в одном блоке молча меняла остальные и сам шаблон). */
  function defaults(type) {
    const p = {};
    for (const f of (TYPES[type].params || [])) {
      if (f.default === undefined) continue;
      p[f.key] = (f.default && typeof f.default === 'object')
        ? JSON.parse(JSON.stringify(f.default)) : f.default;
    }
    return p;
  }

  /* Видимые поля с учётом условий when(). params || {} — импортированный/ИИ-узел
     может прийти без params, тогда when(undefined) уронил бы проверку и инспектор. */
  function visibleParams(type, params) {
    const p = params || {};
    return (TYPES[type].params || []).filter(f => !f.when || f.when(p));
  }

  /* Порты блока. ref — узел или имя типа.
     inputs/outputs может быть функцией от параметров: у «Выбора» столько
     выходов, сколько вариантов вписано. */
  function portsOf(ref, dir) {
    const type = typeof ref === 'string' ? ref : ref.type;
    const v = (dir === 'in' ? TYPES[type].inputs : TYPES[type].outputs) || [];
    if (typeof v !== 'function') return v;
    return v(typeof ref === 'string' ? defaults(type) : (ref.params || {}));
  }

  function findPort(ref, dir, portId) {
    return portsOf(ref, dir).find(p => p.id === portId) || null;
  }

  /* Разбор списка вариантов «Выбора».
       bugs = Поиск багов
         bugs_low = Низкая критичность [free]      ← отступ = подпункт
         bugs_high = Критичные баги [paid]         ← метка тарифа
     Порты получают ТОЛЬКО пункты верхнего уровня: подпункты — детализация
     внутри ветки, иначе холст зарастает портами. */
  function parseOptions(text) {
    const seen = {}, out = [];
    let lastTop = null;
    String(text || '').split('\n').forEach((raw, i) => {
      if (!raw.trim()) return;
      const level = /^(\s{2,}|\t)/.test(raw) ? 1 : 0;
      let s = raw.trim(), tier = 'free';
      const m = s.match(/\[(free|paid)\]$/i);
      if (m) { tier = m[1].toLowerCase(); s = s.slice(0, m.index).trim(); }
      const eq = s.indexOf('=');
      const label = (eq < 0 ? s : s.slice(eq + 1)).trim();
      // \p{L}\p{N} вместо \W: сохраняем буквы любого письма (кириллица и т.п.),
      // иначе ключ «баги» схлопывался в «_» и порты/связи ветвления ломались
      let key = (eq < 0 ? 'opt' + (i + 1) : s.slice(0, eq)).trim().replace(/[^\p{L}\p{N}_]+/gu, '_') || ('opt' + (i + 1));
      while (seen[key]) key += '_';
      seen[key] = 1;
      out.push({ key, label: label || key, tier, level, parent: level ? lastTop : null });
      if (!level) lastTop = key;
    });
    return out;
  }

  const topOptions = p => parseOptions(p.options).filter(o => o.level === 0);

  function summary(node) {
    const t = TYPES[node.type];
    try { return t.summary ? String(t.summary(node.params || {})) : ''; } catch (e) { return ''; }
  }

  return { CATEGORIES, TYPES, defaults, visibleParams, portsOf, findPort, parseOptions, summary };
})();
