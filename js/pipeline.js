/* pipeline.js — РАБОЧИЙ конвейер проекта (example.js — просто демо).
   Загружается кнопкой «загрузить конвейер проекта» внизу палитры.

   ШАГ 1 — ГОТОВ. Два способа подключить проект:
          (а) загрузка архива на сервер;
          (б) мини-приложение-шлюз: сканирует локально, граф отдаёт сразу,
              исходники агенты запрашивают через него по требованию.
          Приватность у обоих одинаковая: запрещённые пути, удаление кода
          после прогона, журнал доступа. История репозитория приезжает —
          ключ, стёртый из рабочего дерева, живёт в коммитах и работает.
          Дальше два шлюза: годности (есть ли что разбирать — до того, как
          тратиться на граф и бота) и полноты графа (разобралось ли; иначе
          эксперты вернут пустоту, а пользователь прочитает «всё чисто»).
          Профиль в два приёма: скрипт считает языки и сборку точно, бот
          решает только неоднозначное — СУБД и платформу; пользователь
          профиль подтверждает или правит. Карточка проекта уходит в базу
          знаний ДО всех ожиданий: ушёл пользователь или нет, проект
          посчитан не зря — на этих данных учится сервис.
          Письменность комментариев считается там же, где манифесты:
          от неё зависит потолок контекста (иероглифика съедает его
          кратно быстрее) и то, на каком языке отвечают эксперты.
          Язык общения не определяем — берём из браузера, пользователь
          правит его на подтверждении профиля. Цитаты из кода не
          переводятся никогда: находка на языке пользователя, строка —
          как в файле.

   ШАГ 2 — ГОТОВ. Все четыре направления разведены на подпункты, у каждого
          подпункта свой исполнитель: 17 агентов и 9 скриптов без LLM.
          Баги 6 · Качество 6 · Уязвимости 7 · Оптимизация 7.
          Своды → единый файл находок → агент градации (единственный, кто
          выставляет критичность) → хранилище → гейт выдачи → отчёты.

   СЕРВЕР И КЛИЕНТ: сервер — Linux. На нём всё, что видит код целиком и
          стоит денег: 17 экспертов и все обращения к моделям, 13 скриптов
          (все на python, PowerShell нет ни одного), граф в Neo4j, единый
          файл находок, градация, хранилище, гейт выдачи, отчёты.
          Клиент — только то, что физически обязано быть у пользователя:
          доступ к файлам и экраны (прогресс, подтверждение профиля,
          выбор направлений). Три входа: ① загрузка — любой браузер,
          ② мини-приложение — Windows/macOS/Linux, ③ папка прямо из
          браузера — только Chromium, с откатом на ① или ②. Где строится
          граф, решает поле where у блока графа: у ② на машине
          пользователя, у ① и ③ на сервере.

   КЛИЕНТ: вкладка и мини-приложение — две обёртки одного клиента, протокол
          общий, поэтому сервер не знает, кто на том конце: клиент шлёт
          дерево с манифестами, просит и отдаёт фрагменты, шлёт прогресс.
          Прогон начинается только когда предварительное собрано целиком:
          нужные фрагменты забираются заранее, по подсказке графа
          (access = prefetch у обоих клиентских входов), а не дочитываются
          по ходу — иначе закрытая вкладка роняет прогон на середине.
          Предзабор — это не «весь код на сервер»: запрещённые пути
          отсекаются на клиенте, остальное живёт по сроку хранения. Предзабор
          идёт фоном, пока пользователь ещё смотрит карточку и выбирает
          направления. Экран у пользователя один, меняются только его
          состояния по шагу и этапу. Вход в сервис обязателен даже для
          бесплатного прогона: прогоны, карточки и запомненная папка висят
          на аккаунте, админский аккаунт отдельный. Уведомление о готовности
          придёт тем же каналом, которым пользователь обратился, — это
          прорабатывается позже.

   СЕРВЕР: прогоны идут в очереди, каждый в своей папке work/runs/<id> и со
          своим срезом графа — иначе второй пользователь затирает первого.
          Все адреса вынесены в переменные окружения ({{env.DATABASE_URL}},
          {{env.NEO4J_URL}}), путей с буквой диска в конвейере нет: перенос
          и миграция не должны требовать правки плана.
          Потолка стоимости прогона пока НЕТ намеренно — сначала копим
          статистику на первой тысяче пользователей, для этого каждый прогон
          пишет свои токены, деньги и тайминги в таблицу прогонов; потолок
          ставится потом, по данным, а не на глаз. Числа параллельности
          (max_parallel и потолки очередей) подбираются на отладочных
          прогонах — держать их в одном месте, не разносить по узлам.
          Тяжёлая модель пока не подключена: base_url пустой, все эксперты
          работают на основной. Как появится доступ — заполнить адрес и
          перевести на неё тех, кто ходит путями по графу.
          Повторный прогон не считается заново: проект узнаётся по хешу,
          граф дополняется инкрементально, эксперты идут только по
          изменившемуся и по тому, что от него зависит.

   ЧЕГО НЕТ: бэкенд не пишется до конца планирования (meta.stage = 'plan',
          поэтому проверка не требует endpoint'ов). Тариф [free]/[paid] в
          меню не размечен — этим пользователь займётся сам.

   ПРАВИЛО ПРАВКИ: поднимай meta.rev при каждом изменении этого файла —
          иначе у пользователя на холсте останется старое автосохранение.
          Координаты не расставляй руками: кнопка ⌗ или клавиша L. */

window.PIPELINE = {
  version: 1,
  name: 'ИИ-анализатор проекта',
  meta: {
    description: 'Шаг 1 — два варианта приёма проекта (загрузка / мини-приложение), шлюз годности, профиль и граф знаний параллельно, шлюз полноты графа, подтверждение профиля пользователем, карточка проекта в базу знаний, затем выбор целевых действий. Развилка вида анализа: по коду (SAST) или по работающему приложению (DAST) — отдельная ветка с подтверждением владения адресом и обходом целей.',
    workdir: '{{env.WORKDIR}}',
    max_parallel: 4,
    log_level: 'info',
    stage: 'plan',
    /* Версия плана. Поднимается при каждой правке этого файла — по ней
       приложение понимает, что на холсте лежит устаревшее автосохранение. */
    rev: 41,
    input_reserve_tokens: 8000,
    models: {
      primary: {
        label: 'Основная', provider: 'openai-compatible',
        base_url: 'https://api.gonka24.com/v1', model: 'qwen3-235b',
        api_key_env: 'GONKA_API_KEY',
        context_tokens: 160000, max_output_tokens: 16384,
      },
      heavy: {
        label: 'Тяжёлая', provider: 'openai-compatible',
        base_url: '', model: 'glm-5.2',
        api_key_env: 'GLM_API_KEY',
        context_tokens: 1000000, max_output_tokens: 32768,
      },
    },
  },
  seq: 112,
  nodes: [
    { id: 'note_0', type: 'note', name: 'Шаг 1', x: 40, y: -81, enabled: true, notes: '',
      params: { text: 'Два способа подключить проект.\n① Загрузка архива на сервер.\n② Мини-приложение — шлюз: сканирует у пользователя, граф отдаёт сразу, исходники — по запросу агента.\nПорт «доступ к коду» одинаков для обоих: агенту всё равно, откуда читать.' } },

    { id: 'gaps_76', type: 'transform', name: 'Что осталось непроверенным', x: 3760, y: 1452, enabled: true,
      notes: 'Единственное место, где сходится правда о полноте прогона. Эксперт мог не дать находок по четырём разным причинам, и они не равнозначны: отработал и чисто — это результат, а упал, не уложился в таймаут, пропущен из-за слепой зоны графа или закрыт тарифом — это дырка в проверке. Раньше упавший эксперт исчезал молча, и направление выглядело чистым. Отсюда правило: направление, где хоть один эксперт не отработал, не может быть показано как «чисто» — оно показывается как неполное, с перечнем того, что не смотрели. Для живой ветки полнота считается иначе — по очереди охоты: что осталось в hunt_queue на выходе из петли, то не досмотрено, чаще всего потому, что кончился бюджет проб.',
      params: { language: 'python',
                code: 'HARD = {"failed", "timeout", "skipped_blind", "skipped_paywall"}\nWHY = {\n  "failed": "эксперт упал",\n  "timeout": "не уложился в срок",\n  "skipped_blind": "нечего смотреть: граф не дал нужного",\n  "skipped_paywall": "недоступно на текущем тарифе",\n}\ngaps = {}\nfor r in ctx.get("expert_runs", []):\n    if r["status"] not in HARD: continue\n    gaps.setdefault(r["direction"], []).append({\n      "эксперт": r["role"], "почему": WHY[r["status"]], "детали": r.get("error", "")[:200],\n    })\ncoverage = {}\nfor d in ctx.get("selected", []):\n    lost = gaps.get(d, [])\n    total = sum(1 for r in ctx.get("expert_runs", []) if r["direction"] == d)\n    coverage[d] = {\n      "полная": not lost,\n      "проверено": total - len(lost), "из": total,\n      "не проверено": lost,\n    }\n# динамика: полнота меряется не экспертами, а очередью охоты — что осталось в hunt_queue, то не досмотрено (обычно кончился бюджет проб)\nhunt = ctx.get("hunt")\nif hunt is not None:\n    left = ctx.get("hunt_queue", [])\n    planned = hunt.get("planned", len(left))\n    blinded = hunt.get("blinded", [])\n    coverage["динамика"] = {\n      "полная": not left and not blinded,\n      "проверено": planned - len(left), "из": planned,\n      "не проверено": [{"цель": r["target"], "класс": r["class"]} for r in left[:50]],\n      "ослеплено WAF": [{"цель": b["target"], "класс": b["class"]} for b in blinded[:50]],\n      "бюджет исчерпан": hunt.get("probes_left", 1) <= 0,\n      "WAF": (ctx.get("waf") or {}).get("present", False),\n    }\n# ponytail: одно правило вместо флага на каждом отчёте — направление с дыркой никогда не «чисто»\nctx["coverage"] = coverage\nctx["has_gaps"] = any(not c["полная"] for c in coverage.values())',
                output_var: 'ctx.coverage' } },

    { id: 'store_run_77', type: 'store', name: 'Финализация прогона (→ complete)', x: 4070, y: 1452, enabled: true,
      notes: 'Строка runs уже заведена в run_open (status=running). Здесь она ФИНАЛИЗИРУЕТСЯ: status running→complete + цена/тайминги/покрытие/пробелы. Флаг complete — единственная точка коммита: прогон становится «настоящим» только когда он лёг, потребители читают только complete. Она же отвечает на «этот проект уже считался»: совпал хеш И status=complete — переиспользуем граф и гоняем экспертов только по изменившемуся. Обновление по run_id (dedupe_key), не вставка.',
      params: { writes: ['статус complete','проект','хеш содержимого','токены и деньги по этапам','тайминги','покрытие и пробелы','версия конвейера','способ подключения'],
                dataset: 'runs', anonymize: false,
                target: 'postgres', uri: '{{env.DATABASE_URL}}',
                keep: 'forever',
                dedupe_key: 'run_id',
                versioning: true, redact_secrets: true, store_snippets: false,
                output_var: 'ctx.run_record' } },

    { id: 'note_db_78', type: 'note', name: 'База данных', x: 4070, y: 1180, enabled: true, notes: '',
      params: { text: 'Пять хранилищ, разведены по жизни данных, а не по технологии.\n\n① Postgres — леджер, источник истины. Пять таблиц на аккаунте: accounts (учётка, тариф, роль) → projects (проект аккаунта; вид = код | живой) → project_versions (состояние на момент прогона: хеш содержимого для кода, project_id для живого) → runs (прогон: стоимость, тайминги, покрытие, пробелы, версия конвейера) → findings (находки; единый локус: файл:строка для кода, url для живого). Снесли Postgres — потеряли историю и биллинг; остальное пересобираемо.\n\n② Neo4j — карта, пересобираемая проекция. Код-граф (SAST) и карта живой площадки (DAST), оба по project_id, запрос всегда по одному проекту. Код-граф держим (по хешу → переиспользуем на неизменном репо), живой граф эфемерный (пересобираем каждый прогон). Снесли Neo4j — построим заново.\n\n③ Вектор — наши карточки приёмов планировщику. Курируемый контент, не накопленное от пользователей; находки сюда НЕ индексируем.\n\n④ Blob (S3) — отчёты артефактом по run_id; гейт отдаёт без пересчёта.\n\n⑤ Лог — аудит доступа, append-only, партиции по времени; в горячую БД не льём.\n\nСекреты (токены сессий DAST, ключи моделей) — отдельный контур: секрет-менеджер + память прогона. В Postgres/Neo4j/отчёт/лог не попадают НИКОГДА.\n\nКлиентский исходник не хранит никто: в находках — вычищенные от секретов цитаты, в графе живого — форма полей (имена+типы), не значения.\n\nСроки по жизни: код удаляется сразу после прогона; находки — по отчёту (until_paid: бесплатный истекает, оплаченный навсегда); карточки проектов обезличены и остаются — на них учится сервис. Правку профиля («что бот определил неверно») дописывает store_profile_fix_106 — самый ценный размеченный сигнал.\n\nОтказоустойчивость: run_id рождается в run_open ДО первой записи; строка runs держит статус running→complete (единственная отметка коммита); таблица run_state — чекпоинт прогона (последняя стадия, сделанные цель×класс петли, готовые эксперты SAST по (run_id, role): возобновление догоняет незавершённых, готовых не перезапускает — дорогой LLM не переплачивается). Все записи идемпотентны (upsert по run_id) — повтор после сбоя не двоит. Потребители читают только complete; осиротевшие running (мёртвый heartbeat) подбирает сборщик — возобновляет с чекпоинта или метит failed.' } },

    { id: 'note_pg_durability_110', type: 'note', name: 'Postgres: реплика и бэкап', x: 4400, y: 1180, enabled: true, notes: '',
      params: { text: 'Postgres — единственный исток (все пять store-узлов пишут в него; Neo4j / blob / вектор пересобираемы). Вся durability сконцентрирована здесь — и здесь же самый маленький фронт восстановления.\n\nРЕПЛИКА (доступность). Горячий standby через потоковую репликацию + автофейловер (managed или Patroni). Отдельная выгода: read-replica снимает аналитику («какой парсер писать», расчётное время, покрытие) с горячего OLTP — та самая «аналитика мимо OLTP» из разбора масштаба. Синхронность точечно: точку коммита runs.status=complete держим СИНХРОННОЙ — прогон «настоящий» только когда флаг лёг и на standby (RPO=0 для зачтённого/оплаченного); массовые findings можно async ради скорости.\n\nБЭКАП (катастрофа) — ОРТОГОНАЛЕН реплике: порча данных, кривая миграция, DROP TABLE, потеря региона реплицируются на standby тоже — реплика от них не спасает. PITR (базовый снимок + архив WAL) → откат на любую секунду; retention 30.000 дн PITR + периодические долгие снимки; хранить ОФСАЙТ (другой регион/аккаунт). Непроверенный бэкап — не бэкап: регулярный тест-восстановление.\n\nБэкапим ТОЛЬКО Postgres: Neo4j пересобираем прогоном, blob/S3 долговечен сам, вектор — наш контент под версией. Малый очерченный фронт — плата за то, что сделали Postgres единым истоком.\n\nrun_state и heartbeat тоже тут → сборщик осиротевших прогонов переживает фейловер: после переключения на standby незавершённые running видны и подхватываются с чекпоинта.' } },

    { id: 'note_failmode_111', type: 'note', name: 'Контракт отказа: фатал vs деградация', x: 4400, y: 1650, enabled: true, notes: '',
      params: { text: 'Каждый узел при сбое ЛИБО фаталит прогон, ЛИБО деградирует — третьего нет. Граница одна: если продолжить — рискуем показать ложное «чисто/готово» или испортить durable-состояние → ФАТАЛ; если сбой лишь СУЖАЕТ охват → ДЕГРАДАЦИЯ, но потеря ОБЯЗАТЕЛЬНО пишется в пробелы (gaps_76), не молча.\n\nФАТАЛ (стоп → runs.status=failed → сборщик/пользователь перезапускают; все фаталы с retry перед сдачей): auth_73; run_open_107 (нет run_id — нечего ключевать); финализация store_run_77 (точка коммита: не лёг флаг complete — прогон НЕ complete); store_15 (находки не персистнулись — отчёт из памяти был бы враньём); шлюз полноты графа (пустой граф → эксперты вернут пустоту); Postgres как единый исток недоступен.\n\nДЕГРАДАЦИЯ (continue + запись пробела в охват): упал один эксперт или сканер (on_error=skip/continue) → его зона в gaps_76; лёг вектор kb_dast_cards → планировщик без подсказок, но охота идёт; не отрендерился blob/отчёт → находки целы в Postgres, дорендерим; недоступен лог/аудит → прогон не блокируем; не сработали канарейка или WAF-детект → метим ослеплённое.\n\nГЛАВНОЕ: деградация НИКОГДА не молчит — каждая пропущенная зона видна в отчёте как пробел, иначе пользователь прочитает суженный охват как «проблем нет». Тот же принцип, что у шлюза полноты графа и слепых зон. У store-узлов нет поля on_error в схеме — их фатальность задаётся этим контрактом, а не параметром.' } },

    { id: 'note_client_75', type: 'note', name: 'Клиент', x: 350, y: -81, enabled: true, notes: '',
      params: { text: 'Вкладка и мини-приложение — одна программа в двух обёртках.\nПротокол один, сообщений четыре:\n① «вот дерево и манифесты» — сразу при сканировании;\n② «дай эти файлы» — список от сервера по подсказке графа;\n③ «вот фрагменты» — кусками по max_fragment_kb, запрещённые пути вырезаны на клиенте;\n④ «вот прогресс» — этапы, проценты, текущий файл.\nСервер не знает, кто на том конце, и не имеет второго приёмника.\n\nЭкран у пользователя один, меняются состояния: вход → выбор способа → сканирование → карточка проекта → выбор направлений → работа → отчёт. Каждое состояние — часть воронки, а не отдельная страница.' } },

    { id: 'start_1', type: 'start', name: 'Открытие сервиса', x: 40, y: 40, enabled: true,
      notes: 'Пользователь зашёл в сервис. Дальше выбирает, каким способом отдать проект на анализ. Язык общения берём из заголовка браузера — это только предположение, поправить его можно на подтверждении профиля. Определять его по коду нельзя: комментарии бывают на одном языке, а читает отчёт человек на другом.',
      params: { trigger: 'manual', cron: '', payload: '{"reply_lang": "{{request.accept_language}}"}' } },

    { id: 'auth_73', type: 'task', name: 'Вход в аккаунт', x: 195, y: 40, enabled: true,
      notes: 'Регистрация обязательна даже для бесплатного прогона: к аккаунту привязываются прогоны, карточки проектов и запомненная папка, иначе вернувшемуся пользователю нечего показать. Аккаунт один на весь сервис. Админский — отдельный, роли не смешиваются. Серверную часть клиент не видит вовсе: он говорит с одной точкой входа, а не с внутренними службами.',
      params: { instruction: 'Показать вход и регистрацию. Пропускать дальше только с аккаунтом — анонимных прогонов нет. Вернуть идентификатор аккаунта, его тариф и роль (пользователь или администратор); администратора уводить в свой раздел, а не в этот конвейер.',
                inputs: ['ctx.reply_lang'],
                output_var: 'ctx.account', timeout_s: 1800.000, on_error: 'fail' } },

    { id: 'run_open_107', type: 'script', name: 'Открытие прогона', x: 195, y: 145, enabled: true,
      notes: 'Рождает run_id ДО первой записи и заводит строку runs со status=running и heartbeat — единственная точка, через которую проходит любой прогон (до развилки код/живой). С этого момента всё ключуется по run_id, и любая запись идемпотентна: повтор после сбоя не двоит. run_id прямым присваиванием в ctx (переживает узел), stdout — только сводка.',
      params: { runtime: 'python',
                code: 'import uuid, json, time\nrun_id = uuid.uuid4().hex[:16]\nrun = {"run_id": run_id, "account": ctx["account"]["id"], "status": "running",\n       "started_at": time.time(), "heartbeat": time.time(), "pipeline_rev": ctx.get("meta_rev")}\ndb_upsert("runs", key="run_id", row=run)   # строка прогона существует ДО первой записи\nctx["run_id"] = run_id\nctx["run"] = run\nprint(json.dumps({"run_id": run_id, "status": "running"}, ensure_ascii=False))',
                cwd: '', env: 'DATABASE_URL={{env.DATABASE_URL}}', timeout_s: 30.000,
                output_var: 'ctx.run_open', on_error: 'fail' } },

    { id: 'sweep_cron_108', type: 'start', name: 'Сборщик: расписание', x: 3860, y: 980, enabled: true,
      notes: 'Фоновой сборщик осиротевших прогонов — отдельная точка входа, не часть основного конвейера. Тикает по расписанию и ищет прогоны, упавшие на середине.',
      params: { trigger: 'cron', cron: '*/5 * * * *', payload: '{}' } },

    { id: 'run_sweeper_109', type: 'script', name: 'Подбор осиротевших прогонов', x: 4070, y: 1050, enabled: true,
      notes: 'Восстановление: берёт runs со status=running и мёртвым heartbeat (старше порога) → по чекпоинту в run_state ЛИБО возобновляет прогон с последней пройденной стадии (идемпотентность делает это безопасным), ЛИБО метит failed, чтобы пользователь перезапустил. Полупрогон не виснет в running навсегда.',
      params: { runtime: 'python',
                code: 'import json, time\nTHRESHOLD_S = 900\nnow = time.time()\nstale = db_query("SELECT * FROM runs WHERE status=%s AND heartbeat < %s", ["running", now - THRESHOLD_S])\nout = []\nfor r in stale:\n    cp = db_get("run_state", key="run_id", val=r["run_id"])\n    if cp and cp.get("resumable"):\n        resume_run(r["run_id"], cp)          # возобновить с чекпоинта\n        out.append({"run_id": r["run_id"], "action": "resumed", "from": cp.get("stage")})\n    else:\n        db_update("runs", key="run_id", val=r["run_id"], set={"status": "failed"})\n        out.append({"run_id": r["run_id"], "action": "failed"})\nprint(json.dumps({"swept": out, "count": len(out)}, ensure_ascii=False))',
                cwd: '', env: 'DATABASE_URL={{env.DATABASE_URL}}', timeout_s: 120.000,
                output_var: 'ctx.swept', on_error: 'continue' } },

    { id: 'choice_entry_2', type: 'choice', name: 'Как подключим проект?', x: 350, y: 40, enabled: true,
      notes: 'Развилка входа. Один вариант из трёх — режим single, поэтому ниже слияние ждёт любую ветку, а не все. Третий пункт показываем только там, где браузер его умеет: File System Access API есть в Chromium и нет в Safari и Firefox. Проверка делается до показа списка, чтобы пользователь не выбирал недоступное.',
      params: { title: 'Как отдать проект на анализ?', mode: 'single',
                options: 'upload = Загрузить проект\nagent = Установить мини-приложение\nbrowser = Открыть папку прямо в браузере',
                defaults: ['upload'], timeout_s: 1800.000, on_timeout: 'defaults', output_var: 'ctx.entry_mode' } },

    /* ── Развилка вида анализа: по коду (SAST) или по работающему приложению
          (DAST). У динамики другой вход целиком — не дерево файлов, а живой
          адрес, — поэтому она уходит в отдельную ветку. Сами динамические
          эксперты пойдут дальше, за описью целей, отдельным шагом. */

    { id: 'choice_scope_80', type: 'choice', name: 'Код или приложение?', x: 195, y: 250, enabled: true,
      notes: 'Развилка двух видов анализа. «По коду» — весь существующий путь: три способа подключить исходники, граф, статические эксперты; смотрим, как написано. «По работающему приложению» — динамическая ветка: бьём запросами по живому стенду и смотрим ответ. Входы разные целиком: статике нужно дерево файлов, динамике — адрес и подтверждение владения, поэтому пути и расходятся здесь, сразу после входа в аккаунт. Пока один вид из двух (mode single); когда появятся динамические эксперты, обе ветви можно свести на агенте градации — находка, подтверждённая и кодом, и живым ответом, сильнее любой одиночной.',
      params: { title: 'Что проверяем?', mode: 'single',
                options: 'code = По коду проекта\nlive = По работающему приложению',
                defaults: ['code'], timeout_s: 1800.000, on_timeout: 'defaults', output_var: 'ctx.analysis_scope' } },

    { id: 'dast_verify_81', type: 'task', name: 'Адрес и подтверждение владения', x: 40, y: 430, enabled: true,
      notes: 'Шлюз ветки, аналог входа в аккаунт для кода. Пользователь вводит адрес — один URL или список доменов для группы компаний — и доказывает, что они его: запись DNS TXT с выданным токеном либо файл по известному пути. Без подтверждения дальше нельзя: иначе сервис превращается в инструмент атаки на чужой адрес по просьбе анонима. Здесь же фиксируется охват — какие домены и пути можно трогать, а какие нет, — и дальше обход за него не выходит.',
      params: { instruction: 'Принять один адрес или список доменов. По каждому проверить владение — DNS TXT с выданным токеном либо файл по известному пути. Неподтверждённые адреса отбросить и назвать причину. Зафиксировать охват: разрешённые домены и пути, явные исключения. Вернуть только подтверждённые цели и границы охвата.',
                inputs: ['ctx.account'],
                output_var: 'ctx.dast_scope', timeout_s: 1800.000, on_error: 'fail' } },

    { id: 'dast_ident_94', type: 'transform', name: 'Личность прогона', x: 40, y: 520, enabled: true,
      notes: 'Личность живого прогона. У ветки по коду проект — это дерево файлов, а тут проект — подтверждённый домен, поэтому идентичность заводится ровно здесь, сразу за воротами владения. Из подтверждённых целей берём домены, по ним считаем стабильный project_id: тот же набор доменов узнаётся при повторном прогоне, и прогоны группируются под одним проектом; опорный домен идёт меткой. Задаём и рабочую папку прогона work/runs/dast-<id>, чтобы общий хвост — единый файл находок, хранилище, отчёты — писал с меткой проекта, а не вслепую. В отличие от кода, «содержимое» живого приложения дёшево не хешируется, поэтому повтор не пропускаем как «уже считали»: живой стенд мог измениться со вчера.',
      params: { language: 'python',
                code: 'import hashlib\nfrom urllib.parse import urlparse\nsc = ctx["dast_scope"]\ntargets = sc.get("targets") or []\ndomains = sorted({(urlparse(t if "://" in t else "http://" + t).hostname or t) for t in targets})\nlabel = domains[0] if domains else "dast"\nseed = "|".join(domains) if domains else label\npid = hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16]   # тот же домен → тот же проект\nctx["project_id"] = pid\nctx["project"] = {"kind": "dast", "label": label, "domains": domains, "targets": len(targets)}\nctx["project_path"] = "work/runs/dast-" + pid                 # рабочая папка прогона на сервере (Linux)\nctx["content_hash"] = pid                                     # живой стенд не хешируем — повтор не пропускаем',
                output_var: 'ctx.project_id' } },

    { id: 'dast_rate_104', type: 'script', name: 'Темп и предохранитель стенда', x: 40, y: 543, enabled: true,
      notes: 'Одно место на всю живую ветку для темпа и вежливости к чужому стенду — раньше RPS=10 был размножен по пяти узлам (доразведка, наблюдение, скан, проба, досмотр), а meta прямо требует держать числа параллельности в одном месте. Собирает из env политику ctx.rate: запросов в секунду, всплеск, потолок ожидания запроса — плюс предохранитель: сколько 5xx/таймаутов подряд считать перегрузкой, что делать (backoff — притормозить и вернуться после паузы; stop — снять ветку), общий флаг tripped на прогон. Все шлющие узлы получают её параметром rate= вместо своего RPS; рантайм-хелперы http/crawl/run_tool держат темп и щёлкают предохранитель централизованно — иначе разросшийся скан или петля завалят чужой сайт, и это уже не тест, а атака. Параллельность очередей — сосед по замыслу: meta.max_parallel.',
      params: { runtime: 'python',
                code: 'import json\nrate = {\n  "rps": float(RPS),\n  "burst": int(BURST),\n  "timeout_ms": int(TIMEOUT_MS),\n  "max_5xx_streak": int(MAX_5XX),\n  "cooldown_s": float(COOLDOWN),\n  "on_overload": ON_OVERLOAD.strip() or "backoff",\n  "tripped": False,\n}\nctx["rate"] = rate\nprint(json.dumps(rate, ensure_ascii=False))',
                cwd: '', env: 'RPS=10\nBURST=20\nTIMEOUT_MS=15000\nMAX_5XX=8\nCOOLDOWN=30\nON_OVERLOAD=backoff',
                timeout_s: 30.000, output_var: 'ctx.rate', on_error: 'continue' } },

    { id: 'dast_session_103', type: 'script', name: 'Личности прогона (вход в приложение)', x: 40, y: 565, enabled: true,
      notes: 'Вход в само тестируемое приложение — то, чего не давали ворота владения (dast_verify_81 доказывает, что домен твой, но внутрь не логинит). Заводит одну-две подтверждённые личности из env DAST_AUTH (учётки/токены живут на бэкенде, не в плане): для каждой либо готовый токен/кука, либо рецепт входа (POST на форму → Set-Cookie или токен из ответа), плюс необязательный self-эндпоинт, чтобы узнать СВОЙ object-id. Две личности нужны для access/IDOR-BOLA: «шлём от A, трогаем объект B». Секреты держит в ctx.sessions.by_label — в модель они НЕ уходят, планировщику отдаётся только сводка identities (метка + self_id). Пусто в env — аноним, как раньше: за-логиновая поверхность просто не видна (уедет в пробелы). Сессия прокидывается во все шлющие узлы (обход, доразведка, наблюдение, скан, проба) параметром session у http/crawl/run_tool.',
      params: { runtime: 'python',
                code: 'import json\nraw = DAST_AUTH.strip()\nsess = {"enabled": False, "primary": None, "by_label": {}, "identities": []}\ndef login(it):\n    if it.get("token"): return {"type": "bearer", "value": it["token"]}\n    if it.get("cookie"): return {"type": "cookie", "value": it["cookie"]}\n    lg = it.get("login")\n    if not lg: return None\n    r = http({"method": lg.get("method", "POST"), "url": lg["url"], "headers": lg.get("headers", {}), "body": lg.get("body", "")})\n    sc = r.headers.get("set-cookie")\n    if sc: return {"type": "cookie", "value": sc}\n    try: body = json.loads(r.body)\n    except Exception: body = {}\n    tok = body\n    for k in str(lg.get("token_path", "token")).split("."):\n        tok = tok.get(k) if isinstance(tok, dict) else None\n    return {"type": "bearer", "value": tok} if tok else None\nfor it in (json.loads(raw) if raw else []):\n    auth = login(it)\n    if not auth: continue\n    label = it.get("label") or ("id%d" % (len(sess["identities"]) + 1))\n    self_id = None\n    slf = it.get("self")\n    if slf:\n        rs = http({"method": "GET", "url": slf["url"]}, session=auth)\n        try: b = json.loads(rs.body)\n        except Exception: b = {}\n        self_id = b.get(slf.get("field", "id")) if isinstance(b, dict) else None\n    sess["by_label"][label] = auth\n    sess["identities"].append({"label": label, "self_id": self_id, "alive": True})\nif sess["identities"]:\n    sess["enabled"] = True\n    sess["primary"] = sess["by_label"][sess["identities"][0]["label"]]\nctx["sessions"] = sess\nprint(json.dumps({"enabled": sess["enabled"], "identities": sess["identities"]}, ensure_ascii=False))',
                cwd: '', env: 'DAST_AUTH={{env.DAST_AUTH}}',
                timeout_s: 120.000, output_var: 'ctx.sessions_summary', on_error: 'continue' } },

    { id: 'dast_crawl_82', type: 'script', name: 'Обход целей', x: 40, y: 610, enabled: true,
      notes: 'Краулер: с подтверждённых адресов обходит приложение и собирает карту — страницы, формы, точки ввода, видимые API. Один URL и группа сайтов — не две ветки, а один параметр: разное число стартовых адресов (seeds), механика та же. Обход держится внутри охвата из предыдущего шага и не выходит за разрешённые домены. Видит только то, что отдаёт живой сервер, кода не читает.',
      params: { runtime: 'python',
                code: 'import json\nseeds = ctx["dast_scope"]["targets"]         # подтверждённые адреса\nscope = ctx["dast_scope"]["allow"]           # разрешённые домены и пути\nsess = (ctx.get("sessions") or {}).get("primary")   # вход в приложение: краулим за-логиновую поверхность\npages = crawl(seeds, allow=scope, max_pages=int(MAX_PAGES), max_depth=int(MAX_DEPTH), session=sess, rate=ctx.get("rate"))\nprint(json.dumps({\n  "seeds": len(seeds),\n  "pages": len(pages),\n  "forms": sum(len(p.get("forms", [])) for p in pages),\n  "map": pages,\n}, ensure_ascii=False))',
                cwd: '', env: 'MAX_PAGES=2000\nMAX_DEPTH=6',
                timeout_s: 1800.000, output_var: 'ctx.dast_map', on_error: 'fail' } },

    { id: 'dast_discover_96', type: 'script', name: 'Доразведка входов', x: 40, y: 700, enabled: true,
      notes: 'Content-discovery: входы, до которых не ведёт ни одна ссылка, — обход их не видит. Два источника внутри охвата, без выхода за разрешённые домены: сперва то, что приложение объявляет само (robots.txt, sitemap.xml, пути в JS) — дёшево, без перебора; затем перебор путей по словарю (админки, служебные и старые эндпоинты, бэкапы, .git). Держит RPS, чтобы не завалить чужой стенд, как проба и скан. Не ворота и не находки: on_error=continue, отдаёт только расширение поверхности. Найденное дедуплицируется против карты обхода и вливается в опись целей рядом с формами и параметрами; дальше по этим входам идут и быстрый скан, и петля охоты.',
      params: { runtime: 'python',
                code: 'import json\nscope = ctx["dast_scope"]["allow"]\nseeds = ctx["dast_scope"]["targets"]\nknown = {p["url"] for p in ctx["dast_map"]["map"]}   # что уже нашёл обход — повторно не долбим\nsess = (ctx.get("sessions") or {}).get("primary")    # доразведка тоже под сессией — за-логиновые пути\nfound = []\nfor base in seeds:\n    for path, src in read_declared(base, session=sess):            # robots.txt, sitemap.xml, пути из JS — без перебора\n        found.append({"url": path, "source": src})\n    for hit in fuzz_paths(base, wordlist=WORDLIST, ext=[e for e in EXT.split(",") if e], allow=scope, rate=ctx.get("rate"), max_paths=int(MAX_PATHS), session=sess):\n        found.append({"url": hit["url"], "status": hit.get("status"), "source": "wordlist"})\nendpoints, seen = [], set(known)\nfor e in found:\n    if in_scope(e["url"], scope) and e["url"] not in seen:\n        seen.add(e["url"]); endpoints.append(e)\nprint(json.dumps({"endpoints": endpoints, "count": len(endpoints),\n  "by_source": {s: sum(1 for e in endpoints if e["source"] == s) for s in {e["source"] for e in endpoints}}}, ensure_ascii=False))',
                cwd: '', env: 'WORDLIST=common\nEXT=,php,asp,aspx,jsp,json,bak,old\nMAX_PATHS=5000',
                timeout_s: 1800.000, output_var: 'ctx.dast_discovered', on_error: 'continue' } },

    { id: 'dast_graph_97', type: 'codegraph', name: 'Карта связей площадки', x: 40, y: 745, enabled: true,
      notes: 'Карта связей живой площадки — аналог codegraph первой цепочки, но кода и AST нет: структура выводится из поведения сервера. Билдер чёрного ящика (builder=custom) собирает из обхода (dast_map) и доразведки (dast_discovered) граф в тот же Neo4j по project_id. Узлы: Page (url, код, тип), Endpoint (метод+путь), Input (форма или параметр), DataShape (наблюдаемая форма ответа — намёк на данные за эндпоинтом). Рёбра: LINKS и REDIRECTS между url, SUBMITS форма→эндпоинт, TAKES эндпоинт→вход, RETURNS эндпоинт→данные (это и есть доступ к данным), плюс метка auth (public или требует-вход, по 200 против 401/403). Наблюдающие запросы идут в охвате, с RPS. Граф уходит в отдельный порт «карта» планировщика: охота идёт по карте (вход→эндпоинт→данные), а не по плоскому списку. Опись целей пока остаётся списком входов рядом. Живой стенд меняется — incremental дополняет карту при повторе.',
      params: { builder: 'custom', source: '{{ctx.dast_map}}', where: 'server',
                extract: ['pages','endpoints','inputs','forms','params','datashapes','links','redirects','auth'],
                storage: 'neo4j', uri: '{{env.NEO4J_URL}}',
                incremental: true, summarize: false, output_var: 'ctx.live_graph' } },

    { id: 'dast_targets_83', type: 'transform', name: 'Опись целей', x: 40, y: 790, enabled: true,
      notes: 'Из карты обхода — список целей для динамических экспертов: точки ввода (формы, параметры запроса, заголовки), видимые эндпоинты, места входа. То же, чем для статики служит «что открыто наружу» (v_surface_42), только собранное не из графа, а с живого сервера. Дальше по этой описи активные проверки шлют запросы и смотрят ответ.',
      params: { language: 'python',
                code: 'm = ctx["dast_map"]\ntargets = []\nfor p in m["map"]:\n    for f in p.get("forms", []):\n        targets.append({"kind": "form", "url": p["url"], "inputs": f.get("fields", [])})\n    for q in p.get("params", []):\n        targets.append({"kind": "param", "url": p["url"], "name": q})\n# входы глубже ссылок (content-discovery): не-связанные пути и объявленные приложением\nfor e in ctx.get("dast_discovered", {}).get("endpoints", []):\n    targets.append({"kind": "endpoint", "url": e["url"], "found": e.get("source")})\nctx["dast_targets"] = {"count": len(targets), "items": targets, "pages": m["pages"], "discovered": ctx.get("dast_discovered", {}).get("count", 0)}',
                output_var: 'ctx.dast_targets' } },

    { id: 'dast_observe_98', type: 'script', name: 'Наблюдение форм ответа', x: 40, y: 880, enabled: true,
      notes: 'Наблюдение форм ответа — превращает карту из «где входы» в «где данные и чем ключуются». Шлёт только безопасные GET по эндпоинтам описи, в охвате, с RPS; разбирает форму ответа (JSON): коллекция или объект, набор полей, поля-идентификаторы (id, *_id, uuid, ref, key), поля с чувствительным именем (password, token, ssn, email, role, internal…). Пишет DataShape-узлы и RETURNS-рёбра в ту же Neo4j-карту по project_id. Отдаёт зацепки петле: эндпоинт с id-полем → класс access (ручка для IDOR/BOLA: запроси соседний id), эндпоинт с чувствительным полем → класс disclosure (лишнее в ответе). Наблюдаем ФОРМУ — имена и типы полей, не значения: приватность цела, значения не храним. Только GET, без слепых POST на изменяющие эндпоинты. on_error=continue — не ворота, только обогащает карту и очередь.',
      params: { runtime: 'python',
                code: 'import json\neps = ctx["dast_targets"]["items"]\nSENS = tuple(SENSITIVE.split(","))\ndef shape(body, ctype):\n    if "json" not in (ctype or "").lower(): return None\n    try: v = json.loads(body)\n    except Exception: return None\n    rows = v if isinstance(v, list) else [v]\n    obj = next((r for r in rows if isinstance(r, dict)), None)\n    if obj is None: return None\n    fields = sorted(obj.keys())\n    return {"kind": "collection" if isinstance(v, list) else "object", "count": len(rows), "fields": fields,\n            "ids": [f for f in fields if f.lower().endswith(("id","_id","uuid","ref","key"))],\n            "sensitive": [f for f in fields if any(s in f.lower() for s in SENS)]}\nshapes, seeds = [], []\nsess = (ctx.get("sessions") or {}).get("primary")   # наблюдаем за-логиновые ответы: там id-поля и чувствительное\nfor t in eps:\n    r = http({"method": "GET", "url": t["url"]}, session=sess, rate=ctx.get("rate"))   # только наблюдение, без изменений\n    sh = shape(r.body[:int(MARK)], r.headers.get("content-type"))\n    if not sh: continue\n    shapes.append({"endpoint": t["url"], "status": r.status, **sh})\n    if sh["ids"]: seeds.append({"target": t, "class": "access", "why": "id-поля: " + ",".join(sh["ids"])})\n    if sh["sensitive"]: seeds.append({"target": t, "class": "disclosure", "why": "поля: " + ",".join(sh["sensitive"])})\ngraph_annotate("DataShape", shapes, project=ctx["project_id"])   # DataShape-узлы и RETURNS-рёбра в ту же карту\nctx["dast_shapes"] = {"observed": len(shapes), "shapes": shapes, "seeds": seeds}\nprint(json.dumps({"observed": len(shapes), "access": sum(1 for s in seeds if s["class"] == "access"), "disclosure": sum(1 for s in seeds if s["class"] == "disclosure")}, ensure_ascii=False))',
                cwd: '', env: 'SENSITIVE=password,passwd,token,secret,ssn,card,cvv,email,phone,role,is_admin,internal\nMARK=4096',
                timeout_s: 1800.000, output_var: 'ctx.dast_shapes', on_error: 'continue' } },

    { id: 'dast_waf_105', type: 'script', name: 'Детект WAF / блокировки', x: 40, y: 925, enabled: true,
      notes: 'Ловит ситуацию «нас режут», чтобы заблокированный прогон не читался как «чисто». Раньше при WAF каждая злая проба ловила 403, судья опровергал всё, и отчёт выходил чистым на слепом стенде — худший ответ. База: на безопасный адрес из описи шлём мягкий GET и пару заведомо-злых (script, OR 1=1, обход пути); если добрый отвечает 200, а злые — 403/406/429 или страницей-заглушкой, значит WAF есть, и снимаем его подпись (статус + маркеры тела + вендор по заголовкам cf-ray/x-sucuri/incapsula/aws-waf). Кладёт ctx.waf={present,vendor,block_status,block_markers}. Проба потом метит свой ответ blocked по этой подписи, контроль такую пробу считает НЕ опровергнутой, а слепой зоной — она уезжает в пробелы прогона (gaps_76: «ослеплено WAF»), не в «чисто». Это ДЕТЕКТ, не обход: обход (мутации/обфускация под WAF) — отдельный корпус-шаг. В охвате, под общей политикой темпа ctx.rate и сессией.',
      params: { runtime: 'python',
                code: 'import json\nscope = ctx["dast_scope"]["allow"]\neps = ctx.get("dast_targets", {}).get("items", [])\nsess = (ctx.get("sessions") or {}).get("primary")\ntargets = ctx["dast_scope"]["targets"] or [""]\nbase = eps[0]["url"] if eps else targets[0]\nwaf = {"present": False, "vendor": None, "block_status": None, "block_markers": [], "tested": 0, "note": ""}\nif not base or not in_scope(base, scope):\n    ctx["waf"] = waf\n    print(json.dumps({"present": False, "reason": "no_base"}, ensure_ascii=False)); raise SystemExit\ndef get(url):\n    return http({"method": "GET", "url": url}, rate=ctx.get("rate"), session=sess)\nbenign = get(base)\nfor h, tag in [("cf-ray", "cloudflare"), ("x-sucuri-id", "sucuri"), ("x-iinfo", "incapsula"), ("x-amzn-waf-action", "aws-waf")]:\n    if benign.headers.get(h):\n        waf["vendor"] = tag; break\nif not waf["vendor"] and "akamai" in (benign.headers.get("server") or "").lower():\n    waf["vendor"] = "akamai"\nsep = "&" if "?" in base else "?"\nblocked = []\nfor p in [x for x in ATTACKISH.split("|") if x]:   # заведомо-злые строки: WAF режет, обычное приложение просто 404/echo\n    r = get(base + sep + p)\n    waf["tested"] += 1\n    body = (r.body[:2048] or "").lower()\n    marks = [m for m in BLOCKMARKS.split("|") if m and m.lower() in body]\n    if (r.status in (403, 406, 429, 503) and r.status != benign.status) or marks:\n        blocked.append((r.status, marks))\nif blocked:\n    waf["present"] = True\n    waf["block_status"] = blocked[0][0]\n    waf["block_markers"] = sorted({m for _, ms in blocked for m in ms})\n    waf["note"] = "приложение режет злые запросы — заблокированные пробы уедут в слепую зону"\nctx["waf"] = waf\nprint(json.dumps({"present": waf["present"], "vendor": waf["vendor"], "block_status": waf["block_status"], "blocked_of": waf["tested"]}, ensure_ascii=False))',
                cwd: '', env: 'ATTACKISH=q=<script>alert(1)</script>|q=1 OR 1=1|q=../../../../etc/passwd\nBLOCKMARKS=access denied|request blocked|attention required|has been blocked|web application firewall|forbidden by administrative rules',
                timeout_s: 120.000, output_var: 'ctx.waf', on_error: 'continue' } },

    { id: 'dast_scan_85', type: 'script', name: 'Быстрая проверка готовыми инструментами', x: 40, y: 970, enabled: true,
      notes: 'Первый, дешёвый проход по описи целей — пятью готовыми опенсорс-сканерами: nuclei, ZAP baseline, nikto, testssl, wapiti. Динамический аналог статических скриптов без LLM: считает машина, не модель. Каждый инструмент — отдельный процесс на сервере, у всех есть машинный вывод (JSON/XML), поэтому выход собирается штатно: тонкий адаптер разбирает родной формат инструмента и приводит его к общей форме находки-кандидата {инструмент, цель, тип, severity_raw, заголовок, доказательство}. Всё сводится в один список и дедуплицируется — один и тот же дефект от двух сканеров становится одной записью. Свою критичность инструменты ставят по-разному, и ей мы НЕ доверяем: severity_raw держим как зацепку, критичность выставляет агент градации. Проход шумный и приблизительный, сам ничего не решает — только показывает, куда копать. И это НЕ ворота: вернули пусто — углублённый разбор всё равно идёт, автосканеры слепы к логике, правам и бизнес-правилам. testssl смотрит TLS хоста, остальные — url и точки ввода, поэтому каждому уходит свой срез описи. Инструменты разноязыкие (nuclei — Go, ZAP — Java/докер, nikto — Perl, testssl — bash, wapiti — Python), оттого и живут за адаптерами; при нужде каждый разнесётся в свой блок, как подпункты шага 2.',
      params: { runtime: 'python',
                code: 'import json\ntargets = ctx["dast_targets"]["items"]\nscope   = ctx["dast_scope"]["allow"]        # разрешённые домены и пути\ntools   = [t for t in TOOLS.split(",") if t.strip()]\n\n# у каждого сканера свой машинный отчёт (nuclei jsonl, ZAP -J json, nikto -Format json,\n# testssl --jsonfile, wapiti -f json); adapt() разбирает его и приводит к общей форме\ncand = []\nsess = (ctx.get("sessions") or {}).get("primary")   # сканеры под сессией — иначе видят только гостевую поверхность\nfor name in tools:\n    raw = run_tool(name, targets, allow=scope, timeout=int(PER_TOOL_S), session=sess, rate=ctx.get("rate"))\n    cand += adapt(name, raw)                 # -> {tool, target, type, severity_raw, title, evidence}\ncand = dedupe(cand)                          # один дефект от двух сканеров — одна запись\nprint(json.dumps({\n  "tools": tools,\n  "targets": len(targets),\n  "candidates": cand,\n  "by_tool": {t: sum(1 for c in cand if c.get("tool") == t) for t in tools},\n}, ensure_ascii=False))',
                cwd: '', env: 'TOOLS=nuclei,zap-baseline,nikto,testssl,wapiti\nPER_TOOL_S=600',
                timeout_s: 1800.000, output_var: 'ctx.dast_scan', on_error: 'continue' } },

    { id: 'note_dast_84', type: 'note', name: 'Петля охоты за дырами', x: 40, y: 1150, enabled: true, notes: '',
      params: { text: 'Динамические эксперты — не отдельные блоки, а роли в одной петле: гипотеза → проба → проверка → уточнение.\n\nЧто ищем по ответу (классы):\n① Инъекции — SQL/NoSQL/команды/шаблоны: ошибка БД, задержка, boolean-разница.\n② Отражение и XSS — ввод вернулся в ответ без экранирования.\n③ Доступ и права (IDOR) — 200 и чужое там, где ждали 401/403.\n④ Раскрытие — стек-трейс, отладка, бэкап, ключ в ответе.\n⑤ SSRF — сервер по нашему вводу сходил на канарейку (нужен внешний OOB-домен).\n⑥ Логика и злоупотребление — обход шага, гонка, mass-assignment, отрицательная сумма; тут гипотеза важнее сигнатуры.\n\nПетля: планировщик выдаёт ОДНУ пробу по классу → скрипт реально шлёт и меряет → судья читает разницу и выносит вердикт (подтверждено / опровергнуто / уточнить) → контроль хранит бюджет и очередь и возвращает виток.\n\nРасчёт на среднюю модель (qwen 35b–235b): модель делает по одному узкому шагу со строгим JSON, а слать запросы, мерить и решать «повторяемо ли» — это код, не модель. Подтверждение засчитывает скрипт по воспроизводимому признаку, а не на слово модели.' } },

    /* ── Динамические эксперты как петля: гипотеза → проба → проверка →
          уточнение. Роли узкие, шаг маленький, ввод/вывод строгий JSON —
          с расчётом на среднюю модель (qwen 35b–235b). Отправка запросов,
          замеры и проверка воспроизводимости — код, не модель. */

    { id: 'dast_worklist_86', type: 'transform', name: 'Очередь охоты', x: 40, y: 1330, enabled: true,
      notes: 'Собирает список «что и на чём проверять»: каждый пункт — цель × класс, к нему приложены признак подтверждения и зацепка. Первыми идут зацепки быстрой проверки — там уже есть след; потом холодные цели без единого срабатывания сканеров, по ним всё равно надо пройтись (молчание автосканера не значит «чисто»). Планировщику не нужно держать в голове весь список: он получает один пункт за виток. Здесь же ставится бюджет проб — жёсткий потолок, чтобы петля на платной модели не считала бесконечно.',
      params: { language: 'python',
                code: 'scan = ctx.get("dast_scan", {}).get("candidates", [])\ntargets = ctx["dast_targets"]["items"]\nCLASSES = ["injection", "xss", "access", "disclosure", "ssrf", "logic"]\nHINT = {\n  "injection": "ошибка БД, задержка по времени, boolean-разница",\n  "xss": "ввод вернулся в ответ без экранирования",\n  "access": "200 и чужие данные там, где ждали 401/403",\n  "disclosure": "стек-трейс, отладка, бэкап или ключ в ответе",\n  "ssrf": "сервер сходил на нашу канарейку",\n  "logic": "прошёл запрещённый исход: обход шага, гонка, отрицательная сумма",\n}\ndef item(target, cls, seed, hot):\n    return {"target": target, "class": cls, "signal": HINT[cls], "seed": seed, "hot": hot, "attempts": []}\nq = []\nfor c in scan:                       # сперва зацепки сканеров — там уже есть след\n    cls = c.get("type", "injection")\n    if cls in HINT: q.append(item(c["target"], cls, c, True))\nfor s in ctx.get("dast_shapes", {}).get("seeds", []):   # зацепки по форме ответа: id-объект в access, чувствительное поле в disclosure\n    q.append(item(s["target"], s["class"], s, True))\nfor t in targets:                    # потом холодные цели — пройтись, даже если сканеры молчали\n    for cls in CLASSES:\n        q.append(item(t, cls, None, False))\nctx["hunt_queue"] = q\nctx["hunt"] = {"probes_left": 4000, "planned": len(q), "attempts": {}, "findings": []}   # бюджет проб — жёсткий потолок, planned — сколько проверок наметили\nctx["current"] = q[0] if q else None',
                output_var: 'ctx.hunt_queue' } },

    { id: 'dast_canary_100', type: 'script', name: 'Канарейка OOB (подготовка)', x: 40, y: 1420, enabled: true,
      notes: 'Устанавливает канал out-of-band для слепых классов — там, где дыра не видна в ответе (ssrf, слепые инъекции по DNS/HTTP). Коллектор — своя инфраструктура на бэкенде, как Neo4j: слушатель на весь wildcard *.<OAST_DOMAIN>, логирует любой прилёт (DNS или HTTP) с уникальным поддоменом-токеном; домен и адрес журнала — в env. Здесь только готовим состояние прогона: домен, адрес опроса, окно ожидания синхронного прилёта и пустую карту токенов (token → цель+класс) для разбора поздних прилётов. Пусто в env — канал выключен: слепые пробы не подтверждаем (честно уедет в пробелы прогона), петля не падает. Маркер в пробу ставит планировщик (%%OOB%%), уникальный адрес подставляет и прилёт проверяет скрипт пробы — код, не модель.',
      params: { runtime: 'python',
                code: 'import json\ndom = OAST_DOMAIN.strip()\ncanary = {"enabled": bool(dom), "domain": dom, "poll": OAST_POLL.strip(), "wait_s": float(OOB_WAIT), "tokens": {}, "hits": []}\nctx["canary"] = canary\nprint(json.dumps(canary, ensure_ascii=False))',
                cwd: '', env: 'OAST_DOMAIN={{env.OAST_DOMAIN}}\nOAST_POLL={{env.OAST_POLL}}\nOOB_WAIT=8',
                timeout_s: 60.000, output_var: 'ctx.canary', on_error: 'continue' } },

    { id: 'dast_hunt_87', type: 'loop', name: 'Петля: гипотеза → проба → проверка', x: 40, y: 1510, enabled: true,
      notes: 'Крутится, пока в очереди есть цели и не исчерпан бюджет проб. Один виток — одна гипотеза и одна проба. Планировщик берёт текущий пункт (или уточнение к прошлому), скрипт шлёт пробу, судья выносит вердикт, контроль решает: подтвердилось — в находки и снять пункт; уточнить — тот же пункт с новой подсказкой ещё раз; опроверглось, сдался или кончились попытки — следующий пункт. Потолок витков и бюджет проб — жёсткие тормоза: на платных локальных моделях разросшаяся петля стоит денег. Чекпоинт каждого витка в run_state по run_id (сделанные цель×класс, probes_left, остаток hunt_queue) — упавший прогон сборщик возобновляет с последнего чекпоинта, а не с нуля.',
      params: { mode: 'while', condition: 'ctx.hunt.probes_left > 0 and ctx.hunt_queue',
                max_iterations: 2000, delay_s: 0.000, break_on_error: false } },

    { id: 'agent_dast_planner_88', type: 'agent', name: 'Планировщик проб', x: 350, y: 1470, enabled: true,
      notes: 'Берёт один пункт очереди — цель, класс, признак и что уже пробовали — и выдаёт РОВНО одну пробу: гипотезу, готовый запрос (метод, url, заголовки, тело), контрольный запрос для сравнения и признак удачи. Не строит стратегию на десять ходов — один конкретный следующий запрос. Строгий JSON, температура ноль: средней модели (qwen 35b–235b) так проще не расплыться. Ответ сервера не выдумывает — его пришлёт скрипт. Идей по классу больше нет — ставит give_up, пункт снимется. Перед генерацией тянет по классу top-k карточек известных приёмов из базы знаний (порт «знания») — строит пробу на известном приёме, а не с нуля. Карта связей площадки приходит отдельным data-портом «карта», не мешаясь с карточками в «знаниях». Для слепых проб (ssrf, слепые инъекции) ставит маркер %%OOB%% — код подставит адрес канарейки и проверит прилёт. Для access выбирает личность полем "as" — слать от одной, трогать объект другой.',
      params: { provider: 'project', model_ref: 'primary', base_url: '', model: '', api_key_env: '',
                system_prompt: 'Ты ищешь одну уязвимость за раз в живом приложении. Тебе дают цель, класс, признак его подтверждения и что уже пробовали. По классу тебе подмешаны top-k карточек известных приёмов (приём, паттерн пробы, признак подтверждения) — если подходящий есть, строй пробу на нём, а не с нуля. Для слепых классов (ssrf; инъекции с выводом по DNS/HTTP) подтверждение приходит не в ответе, а прилётом на нашу канарейку — вставь в пробу маркер %%OOB%% туда, где хочешь заставить сервер сходить наружу (адрес в параметре, поле, внешняя сущность); код подставит уникальный адрес и проверит прилёт. Есть до двух личностей (сессий) — их метки и собственные object-id даны ниже; для класса access суть в том, чтобы слать ОТ одной личности, а трогать объект ДРУГОЙ (её self_id или соседний id): 200 с чужими данными = сломанный доступ. Ставь в probe и control поле "as" с меткой личности, от которой слать (по умолчанию первая). Верни РОВНО одну следующую пробу строгим JSON и больше ничего. Одна проба — один конкретный запрос. Ответ сервера не придумывай, его пришлёт скрипт. Если идей по этому классу больше нет — верни give_up: true.',
                prompt: 'Цель: {{ctx.current.target}}\nКласс: {{ctx.current.class}}\nПризнак удачи: {{ctx.current.signal}}\nЗацепка сканера: {{ctx.current.seed}}\nУже пробовали: {{ctx.current.attempts}}\nЛичности (метка + свой object-id): {{ctx.sessions.identities}}\n\nВерни JSON:\n{\n  "hypothesis": "что предполагаем",\n  "probe":   {"as": "", "method": "", "url": "", "headers": {}, "body": ""},\n  "control": {"as": "", "method": "", "url": "", "headers": {}, "body": ""},\n  "expect": "какой признак в ответе подтвердит",\n  "give_up": false\n}',
                temperature: 0.000, max_tokens: 2048, tools: [], graph_in: true, output_var: 'ctx.hypothesis',
                retry: 2, timeout_s: 120.000, stream: false } },

    { id: 'kb_dast_cards_95', type: 'kb', name: 'Карточки техник (DAST)', x: 660, y: 1650, enabled: true,
      notes: 'База знаний приёмов под руку планировщику. Карточки {класс, приём, паттерн пробы, признак подтверждения, источник}, дистиллированные из корпуса исследований (research/dast-research-corpus.md) по шести классам петли. Планировщик тянет top-k карточек по классу текущего пункта (ctx.current.class) перед генерацией — средняя модель опирается на известный приём, а не выдумывает с нуля; это и есть вход KB-retrieval. Подключается пунктиром в порт «знания» планировщика — тем же способом, каким контекст проекта питает статических экспертов. Признак подтверждения из карточки задаёт ожидаемый признак пробы; критичность карточка не ставит, её выставляет градация. Наполняется на бэкенде, адрес в {{env.KB_DAST_CARDS}} — план от наполнения не зависит (stage=plan).',
      params: { kind: 'vector', source: '{{env.KB_DAST_CARDS}}',
                embed_model: '', top_k: 5, chunk_size: 800, chunk_overlap: 120,
                refresh: 'on_start' } },

    { id: 'script_dast_probe_89', type: 'script', name: 'Отправка пробы', x: 660, y: 1470, enabled: true,
      notes: 'Единственное место, где реально уходит запрос. Берёт пробу и контрольный запрос, проверяет, что адрес в подтверждённом охвате, шлёт пробу дважды (на воспроизводимость) и контроль, снимает статус, время, длину, срез тела и разницу проба-контроль. Меряет код, а не модель: судья потом смотрит на факт, а не на воображаемый ответ. Вне охвата, give_up или сетевая ошибка — помечает и выходит тихо, петлю не роняет. Держит RPS, чтобы не завалить чужой стенд.',
      params: { runtime: 'python',
                code: 'import json, time, secrets\nh = ctx.get("hypothesis", {})\nif h.get("give_up"):\n    print(json.dumps({"skipped": "give_up"}, ensure_ascii=False)); raise SystemExit\nc = ctx.get("canary", {})\nprobe = h.get("probe", {})\nblob = " ".join([probe.get("url", ""), probe.get("body", "") or ""] + [str(x) for x in (probe.get("headers") or {}).values()])\noob_used = "%%OOB%%" in blob\ntoken = ""\nif oob_used:\n    if not c.get("enabled"):\n        print(json.dumps({"skipped": "no_canary"}, ensure_ascii=False)); raise SystemExit\n    token = secrets.token_hex(8)                    # уникальный токен -> адрес канарейки\n    host = token + "." + c["domain"]\n    def sub(s): return s.replace("%%OOB%%", host) if isinstance(s, str) else s\n    probe["url"] = sub(probe.get("url", ""))\n    probe["body"] = sub(probe.get("body", "") or "")\n    probe["headers"] = {k: sub(v) for k, v in (probe.get("headers") or {}).items()}\n    ctx["canary"]["tokens"][token] = {"target": (ctx.get("current") or {}).get("target"), "class": (ctx.get("current") or {}).get("class")}\nif not in_scope(probe["url"], ctx["dast_scope"]["allow"]):   # за охват не выходим\n    print(json.dumps({"error": "out_of_scope"}, ensure_ascii=False)); raise SystemExit\nsessions = ctx.get("sessions") or {}\ndef pick(label):\n    return (sessions.get("by_label") or {}).get(label) or sessions.get("primary")\ndef send(req):\n    t = time.time()\n    r = http(req, session=pick(req.get("as")), rate=ctx.get("rate"))   # шлём от выбранной личности (access: от A по объекту B)\n    return {"status": r.status, "ms": round((time.time() - t) * 1000, 3), "len": len(r.body), "body": r.body[:int(MARK)]}\na1 = send(probe); a2 = send(probe)                 # дважды — проверка воспроизводимости\nbase = send(h["control"]) if h.get("control") else None\nwaf = ctx.get("waf") or {}\nblocked = bool(waf.get("present")) and (a1["status"] == waf.get("block_status") or any(m in (a1.get("body") or "").lower() for m in waf.get("block_markers", [])))   # WAF срезал — не «чисто»\noob = {"used": oob_used, "token": token, "hit": False}\nif oob_used:                                       # подтверждение блайнда — не в ответе, а прилётом на канарейку\n    end = time.time() + float(c.get("wait_s", 8))\n    while time.time() < end:\n        rp = http({"method": "GET", "url": c["poll"] + "?token=" + token}, rate=ctx.get("rate"))\n        try: hits = json.loads(rp.body)\n        except Exception: hits = []\n        if hits:\n            oob.update({"hit": True, "protocol": hits[0].get("protocol"), "at": hits[0].get("at"), "source": hits[0].get("remote")})\n            break\n        time.sleep(1)\nprint(json.dumps({\n  "probe": a1, "probe_repeat": a2, "control": base,\n  "diff_len": (a1["len"] - base["len"]) if base else None,\n  "reproducible": a1["status"] == a2["status"],\n  "oob": oob,\n  "blocked": blocked,\n}, ensure_ascii=False))',
                cwd: '', env: 'MARK=2048',
                timeout_s: 120.000, output_var: 'ctx.probe_result', on_error: 'continue' } },

    { id: 'agent_dast_verify_90', type: 'agent', name: 'Судья пробы', x: 970, y: 1470, enabled: true,
      notes: 'Читает гипотезу и то, что реально вернул сервер (разницу проба-контроль, воспроизводимость), и выносит вердикт: подтверждено, опровергнуто или уточнить. По умолчанию — опровергнуто: подтверждает только конкретный воспроизводимый признак, а не «похоже». Средние модели любят соглашаться, поэтому промпт толкает в обратную сторону, а воспроизводимость всё равно перепроверит контроль-скрипт. «Уточнить» — вернуть в петлю с подсказкой, что поменять.',
      params: { provider: 'project', model_ref: 'primary', base_url: '', model: '', api_key_env: '',
                system_prompt: 'Ты проверяешь гипотезу об уязвимости по фактическому ответу сервера. По умолчанию гипотеза опровергнута. Подтверждаешь только если в ответе есть конкретный признак из «ждали» и он воспроизводимый. Ничего не додумываешь сверх данных. Если в данных есть oob.hit=true — сервер сходил на нашу канарейку по нашему уникальному токену: это сильнейшее подтверждение, выноси confirmed. Для ssrf без прилёта подтверждения нет. Для access/IDOR (BOLA): проба слалась под одной личностью; если статус 200 и в теле пробы есть self_id ДРУГОЙ личности (он указан в «ждали»), которого НЕТ в теле контроля (свой объект) — это сломанный объектный доступ, выноси confirmed. Верни строгий JSON.',
                prompt: 'Гипотеза: {{ctx.hypothesis.hypothesis}}\nЖдали признак: {{ctx.hypothesis.expect}}\nОтвет сервера: {{ctx.probe_result}}\n\nВерни JSON:\n{\n  "verdict": "confirmed | refuted | refine",\n  "why": "ссылка на конкретный признак в ответе",\n  "refine_hint": "если refine — что поменять в пробе"\n}',
                temperature: 0.000, max_tokens: 1024, tools: [], output_var: 'ctx.verdict',
                retry: 2, timeout_s: 120.000, stream: false } },

    { id: 'transform_dast_control_91', type: 'transform', name: 'Контроль петли', x: 1280, y: 1470, enabled: true,
      notes: 'Тормоз и бухгалтерия петли, всё детерминировано. Списывает пробу с бюджета. Подтверждение засчитывает сам, по факту из probe_result (воспроизводимо и есть предсказанный признак), а не по слову судьи — так ложное «подтверждено» от средней модели не проходит. Подтвердилось — в находки, пункт снят. Уточнить — дописывает подсказку в attempts и оставляет пункт, пока не кончились попытки по нему. Опроверглось, сдался или упёрся в потолок попыток — пункт снят. Готовит ctx.current на следующий виток.',
      params: { language: 'python',
                code: 'MAX_TRIES = 5\nh = ctx.get("hypothesis", {})\nv = ctx.get("verdict", {})\npr = ctx.get("probe_result", {})\nhunt = ctx["hunt"]; q = ctx["hunt_queue"]; cur = ctx.get("current")\nhunt["probes_left"] -= 1\nkey = str((cur["target"], cur["class"])) if cur else ""\ntries = hunt["attempts"].get(key, 0) + 1\nhunt["attempts"][key] = tries\n# прилёт на канарейку — сильнейшее подтверждение: сервер физически сходил к нам по нашему токену\noob = pr.get("oob", {})\noob_hit = bool(oob.get("used") and oob.get("hit"))\nif oob_hit: ctx["canary"].setdefault("hits", []).append({"token": oob.get("token")})\n# подтверждение засчитывает КОД: прилёт на канарейку ИЛИ (судья confirmed И проба воспроизводима)\nconfirmed = oob_hit or (v.get("verdict") == "confirmed" and pr.get("reproducible") is True)\nif confirmed:\n    hunt["findings"].append({"target": cur["target"], "class": cur["class"],\n                             "hypothesis": h.get("hypothesis"), "evidence": pr, "why": v.get("why")})\n    if cur in q: q.remove(cur)\nelif pr.get("blocked"):          # WAF срезал пробу — это не «чисто», а слепая зона\n    hunt.setdefault("blinded", []).append({"target": cur["target"], "class": cur["class"]})\n    if cur in q: q.remove(cur)\nelif v.get("verdict") == "refine" and not h.get("give_up") and tries < MAX_TRIES:\n    cur["attempts"].append({"probe": h.get("probe"), "why": v.get("why"), "hint": v.get("refine_hint")})\nelse:\n    if cur in q: q.remove(cur)          # опроверглось / сдался / потолок попыток\nctx["current"] = q[0] if q else None\nctx["dast_findings"] = hunt["findings"]',
                output_var: 'ctx.dast_findings' } },

    { id: 'dast_canary_sweep_101', type: 'script', name: 'Досмотр канарейки', x: 40, y: 1600, enabled: true,
      notes: 'После петли — последний опрос коллектора по всем выданным токенам, у которых в петле прилёта не было. Слепой прилёт часто отложен: сервер поставил задачу в очередь (экспорт, вебхук, импорт по URL) и сходил на канарейку через десятки секунд, уже после окна пробы. Поздний прилёт — тоже подтверждённая находка, иначе деферред-SSRF молча теряется и прогон выглядит чистым. Токен разбирается обратно в цель и класс по карте из подготовки, находки дописываются в общий ctx.dast_findings перед сводом. Канал выключен или всё уже зачтено — проходит пустым.',
      params: { runtime: 'python',
                code: 'import json\nc = ctx.get("canary", {})\nif not c.get("enabled"):\n    print(json.dumps(ctx.get("dast_findings", []), ensure_ascii=False)); raise SystemExit\nseen = {x.get("token") for x in c.get("hits", [])}\nlate = []\nfor token, meta in c.get("tokens", {}).items():\n    if token in seen: continue\n    r = http({"method": "GET", "url": c["poll"] + "?token=" + token}, rate=ctx.get("rate"))\n    try: hits = json.loads(r.body)\n    except Exception: hits = []\n    if not hits: continue\n    h0 = hits[0]\n    late.append({"target": meta.get("target"), "class": meta.get("class"), "hypothesis": "отложенный прилёт на канарейку", "evidence": {"oob": {"hit": True, "protocol": h0.get("protocol"), "at": h0.get("at"), "token": token}}, "why": "сервер сходил на канарейку по нашему токену уже после окна пробы"})\nf = ctx.get("dast_findings", []) + late\nctx["dast_findings"] = f\nprint(json.dumps(f, ensure_ascii=False))',
                cwd: '', env: '',
                timeout_s: 300.000, output_var: 'ctx.dast_findings', on_error: 'continue' } },

    { id: 'transform_dast_collect_92', type: 'transform', name: 'Свод динамических находок', x: 350, y: 1690, enabled: true,
      notes: 'После петли приводит подтверждённые динамические находки к той же схеме, что и статические (эксперт, направление, локус, доказательство, уверенность), и вливает их в общий поток ctx.findings. Критичность не проставлена — её выставит агент градации. Отсюда живая ветка сходится со статической: обе идут в «единый файл находок» через свод веток, и одна дыра, подтверждённая и кодом, и живым ответом, у градации становится одной сильной находкой. Локус динамической находки — адрес: файла у неё нет, ставим url.',
      params: { language: 'python',
                code: 'f = ctx.get("dast_findings", [])\n# в ту же схему, что у статики, чтобы «единый файл находок» и градация читали одинаково\nmapped = [{\n  "expert": "dast_" + x["class"],\n  "direction": "vulns",\n  "source": "dast",\n  "file": x["target"],          # у живой ветки локус — адрес, а не файл\n  "line": 0,\n  "title": x.get("hypothesis") or x["class"],\n  "detail": x.get("why", ""),\n  "failure_scenario": "подтверждено на живом сервере: " + (x.get("why") or ""),\n  "evidence": "живой ответ, воспроизведено",\n  "proof": x.get("evidence"),\n  "confidence": 0.900,          # подтверждено кодом по воспроизводимости\n} for x in f]\nctx["findings_dast"] = mapped\nctx["findings"] = ctx.get("findings", []) + mapped   # общий поток со статикой — сходятся на градации',
                output_var: 'ctx.findings' } },

    { id: 'source_upload_3', type: 'source', name: '① Загрузка на сервер', x: 660, y: 283, enabled: true,
      notes: 'Пользователь отдаёт архив, папку или git-URL. Код лежит у нас — доступен и графу, и агентам целиком. Правила приватности те же, что у шлюза: запрещённые пути не читаем вовсе, после прогона код удаляем, каждое обращение пишем в журнал. Раньше этих правил здесь не было, и архив с .env и ключами оставался у нас бессрочно.',
      params: { mode: 'upload', accept: '.zip, .tar.gz, .rar, папка', max_size_mb: 500, unpack: true,
                dest: 'work/runs/{{ctx.run_id}}/project',
                deny_paths: ['.env','*.pem','*.key','id_rsa*','*.p12','*.pfx','secrets/*','credentials*','*.keystore'],
                retention: 'no_store', audit_log: true,
                git_history: 'full', history_depth: 0,
                exclude: ['node_modules','dist','build','venv','__pycache__'],
                output_var: 'ctx.project_path' } },

    { id: 'source_agent_4', type: 'source', name: '② Мини-приложение', x: 660, y: 40, enabled: true,
      notes: 'Приложение-шлюз между кодом пользователя и нашим сервером. Ставится, привязывается кодом устройства, получает папку проекта. При сканировании сразу отдаёт граф, манифесты и дерево; нужные исходники забираются через него заранее, фрагментами по подсказке графа — прогон не должен зависеть от того, жив ли клиент в эту секунду.',
      params: { mode: 'local_agent', platforms: ['windows','macos','linux'],
                pairing: 'device_code', transport: 'websocket',
                send: ['graph','manifests','file_tree','metrics','git_history'],
                access: 'prefetch', retention: 'cache', cache_ttl_s: 900.000, max_fragment_kb: 256,
                deny_paths: ['.env','*.pem','*.key','id_rsa*','*.p12','*.pfx','secrets/*','credentials*','*.keystore'],
                audit_log: true, watch: true,
                git_history: 'full', history_depth: 0,
                exclude: ['node_modules','dist','build','venv','__pycache__'],
                output_var: 'ctx.project_path' } },

    { id: 'source_browser_72', type: 'source', name: '③ Прямо в браузере', x: 660, y: 520, enabled: true,
      notes: 'Вход без установки: страница просит папку через File System Access API и читает файлы прямо у пользователя. Только Chromium — Chrome, Edge, Opera; в Safari и Firefox API нет, поэтому откат обязателен. Продаёт «ничего не ставить», а не «код не уезжает»: граф строится на сервере, файлы уходят по запросу — дублировать вариант ② незачем. Запрещённые пути отсекаются в браузере, до отправки. Цена режима: вкладку нельзя закрывать, за изменениями никто не следит, история репозитория недоступна — значит поиск секретов по коммитам здесь слепнет.',
      params: { mode: 'browser', fallback: 'upload', remember_folder: true,
                send: ['file_tree','manifests'],
                access: 'prefetch', max_fragment_kb: 256,
                deny_paths: ['.env','*.pem','*.key','id_rsa*','*.p12','*.pfx','secrets/*','credentials*','*.keystore'],
                retention: 'no_store', audit_log: true, git_history: 'off',
                exclude: ['node_modules','.git','dist','build','venv','__pycache__'],
                output_var: 'ctx.project_path' } },

    { id: 'progress_5', type: 'progress', name: 'Прогресс сканирования', x: 970, y: 71, enabled: true,
      notes: 'Пока мини-приложение обходит проект, пользователь видит этапы, проценты и текущий файл. События идут по тому же WebSocket, что и граф.',
      params: { title: 'Сканируем проект',
                show: ['этапы','проценты','текущий файл','счётчик файлов','расчётное время','ошибки'],
                eta_from: 'history', events_from: 'ctx.scan_events', update_ms: 500,
                cancellable: true, on_cancel: 'stop' } },

    { id: 'merge_entry_7', type: 'merge', name: 'Проект подключён', x: 1280, y: 187, enabled: true,
      notes: 'Сработала одна из двух веток входа — стратегия «любая». Дальше путь общий, независимо от способа подключения.',
      params: { strategy: 'any', timeout_s: 3600.000, output_var: 'ctx.source' } },

    { id: 'queue_scan_8', type: 'queue', name: 'Два скана параллельно', x: 1590, y: 187, enabled: true,
      notes: 'Профиль и граф знаний независимы: граф определяет языки сам, по расширениям, и не ждёт ответа профилировщика.',
      params: { mode: 'parallel', concurrency: 2, order: 'fifo', priority: 0, retry: 1,
                backoff_s: 2.000, rate_limit: 0, dedupe: false, on_error: 'stop' } },

    { id: 'agent_profile_9', type: 'agent', name: 'Бот №1 · Профиль проекта', x: 1900, y: 157, enabled: true,
      notes: 'Языки и сборку уже посчитал скрипт — бот их не пересчитывает, а получает готовыми. Ему остаётся неоднозначное: какие фреймворки на самом деле используются, есть ли база и какая, на что проект собирается. Читает код через порт «доступ к коду» — одинаково для обоих входов. Каждое утверждение со ссылкой на файл; чего нет — null, а не догадка.',
      params: { provider: 'project', model_ref: 'primary',
                base_url: '', model: '', api_key_env: '',
                system_prompt: 'Ты профилировщик проекта. Языки, доли и пакетные менеджеры тебе уже даны — посчитаны точно, не пересчитывай и не спорь с ними. Твоя часть — то, что из манифеста не видно: какие фреймворки реально используются, подключена ли база и какая, на какую платформу собирается проект. Каждое утверждение подкрепляешь ссылкой на файл (evidence). Не хватает данных — ставишь null и перечисляешь, каких файлов не хватило. Ничего не додумываешь.',
                prompt: 'Проект: {{ctx.project_path}}\nПосчитано скриптом: {{ctx.manifest}}\n\nОпредели то, чего в этих цифрах нет:\n1) фреймворки — какие действительно используются, а не просто лежат в зависимостях\n2) база данных: подключена или нет, какая СУБД, где объявлено подключение\n3) целевая платформа: windows | linux | macos | ios | android | web | cross\n\nВерни JSON:\n{\n  "frameworks": [{"name": "", "evidence": ""}],\n  "database": {"present": false, "engine": null, "evidence": ""},\n  "platform": {"target": "", "evidence": ""},\n  "confidence": 0.000,\n  "missing_evidence": []\n}',
                temperature: 0.000, max_tokens: 4096, tools: [], output_var: 'ctx.profile',
                retry: 2, timeout_s: 240.000, stream: false } },

    { id: 'codegraph_10', type: 'codegraph', name: 'Граф знаний проекта', x: 1900, y: 400, enabled: true,
      notes: 'Разбор AST там, где лежит код: в варианте ② — на машине пользователя, в варианте ① — на сервере. Хранится граф в обоих случаях у нас, в Neo4j. Строит парсер, а не LLM — иначе рёбра выдумываются и результат не повторяется.',
      params: { builder: 'codegraphcontext', source: '{{ctx.project_path}}', where: 'auto', languages: ['auto'],
                extract: ['files','modules','classes','functions','calls','imports','db_models','endpoints','configs','env_vars'],
                storage: 'neo4j', uri: '{{env.NEO4J_URL}}',
                exclude: ['node_modules','.git','dist','build','venv','__pycache__','vendor'],
                incremental: true, max_files: 20000, summarize: false, output_var: 'ctx.graph' } },

    { id: 'merge_scan_11', type: 'merge', name: 'Дождаться обоих', x: 2210, y: 306, enabled: true,
      notes: 'Выбор действий показываем только когда готовы и профиль, и граф — иначе список предлагается вслепую.',
      params: { strategy: 'all', timeout_s: 1800.000, output_var: 'ctx.scan' } },

    { id: 'choice_action_12', type: 'choice', name: 'Что делать с проектом?', x: 2520, y: 508, enabled: true,
      notes: 'Четыре основных направления. Подпункты и разметка тарифа [free]/[paid] прорабатываются позже — механика двух уровней в блоке уже есть, ждёт наполнения.',
      params: { title: 'Проект просканирован. Что запускаем?', mode: 'multi', allow_select_all: true,
                options: [
                  'quality = Качество и здоровье кода',
                  'bugs = Баги',
                  'vulns = Уязвимости системы',
                  'perf = Оптимизация',
                ].join('\n'),
                defaults: [], timeout_s: 1800.000, on_timeout: 'none', output_var: 'ctx.selected' } },

    { id: 'context_20', type: 'context', name: 'Контекст проекта', x: 2520, y: 258, enabled: true,
      notes: 'Пучок из графа знаний и доступа к коду. Все эксперты цепляются сюда одним портом — не надо тянуть связь от каждого источника к каждому агенту. Поэтому язык объявляется здесь один раз, а не переписывается в семнадцать промптов: без этого модель уплывает в язык комментариев и отвечает китайцу по-китайски, а русскому — тоже по-китайски. Потолок контекста поправляется на письменность: токенизаторы обучены на английском, и тот же объём кода с иероглификой съедает бюджет кратно быстрее, иначе эксперт молча обрежет файлы.',
      params: { budget_tokens: 60000, budget_by_writing: true, priority: ['graph','manifests','code'], fetch: 'prefetch', cache: true,
                reply_lang: '{{ctx.reply_lang}}', quote_original: true } },

    /* ── Шаг 1, доработка: прогресс на обоих входах, два шлюза, точный счёт
          манифестов, подтверждение профиля и карточка проекта в базу знаний. */

    { id: 'progress_upload_60', type: 'progress', name: 'Прогресс загрузки', x: 970, y: 283, enabled: true,
      notes: 'У загрузки на сервер стадия тоже длинная: приём архива, распаковка, обход дерева. Раньше плашка висела только на мини-приложении, и здесь пользователь минуту смотрел в неподвижный экран. Расчётное время берём из истории похожих проектов — ради этого и копим карточки.',
      params: { title: 'Загружаем и распаковываем',
                show: ['этапы','проценты','текущий файл','счётчик файлов','расчётное время','ошибки'],
                eta_from: 'history', events_from: 'ctx.upload_events', update_ms: 500,
                cancellable: true, on_cancel: 'stop' } },

    { id: 'script_triage_61', type: 'script', name: 'Годен ли проект', x: 1280, y: 700, enabled: true,
      notes: 'Дешёвая проверка по дереву файлов — до того, как тратиться на граф и на бота. Если приехал датасет, вёрстка или язык, которого мы не разбираем, узнать об этом надо здесь, а не в конце прогона. Дерево уже есть у обоих входов: мини-приложение шлёт его при сканировании, у загрузки оно на сервере.',
      params: { runtime: 'python',
                code: 'import json, collections\nPARSABLE = {"py","js","ts","tsx","jsx","java","go","rs","cs","php","rb","kt","swift","c","cc","cpp","h","hpp","scala","dart"}\ntree = ctx["file_tree"]\next = collections.Counter(f["ext"].lower().lstrip(".") for f in tree)\nsrc = sum(c for e, c in ext.items() if e in PARSABLE)\nshare = src / max(len(tree), 1)\nprint(json.dumps({\n  "total_files": len(tree),\n  "source_files": src,\n  "parsable_share": round(share, 3),\n  "languages": {e: round(c / max(src, 1), 3) for e, c in ext.most_common(12) if e in PARSABLE},\n  "unsupported": [e for e, c in ext.most_common(12) if e not in PARSABLE and c >= 20],\n  "bytes": sum(f.get("size", 0) for f in tree),\n  "ok": src > 0 and share >= float(MIN_SHARE),\n  "reason": "" if src else "не найдено исходников на языках, которые мы разбираем",\n}, ensure_ascii=False))',
                cwd: '', env: 'MIN_SHARE=0.100',
                timeout_s: 60.000, output_var: 'ctx.triage', on_error: 'fail' } },

    { id: 'cond_triage_62', type: 'condition', name: 'Есть что разбирать?', x: 1590, y: 700, enabled: true,
      notes: 'Развилка годности. Нет исходников — дальше не идём: граф выйдет пустым, а семнадцать экспертов вернут «ничего не найдено», и пользователь прочитает это как «у меня всё хорошо».',
      params: { expression: 'ctx.triage.ok',
                note: 'есть исходники и их доля не ниже MIN_SHARE' } },

    { id: 'script_manifest_63', type: 'script', name: 'Языки, сборка и письменность', x: 1900, y: 700, enabled: true,
      notes: 'Точный ответ, который нельзя отдавать боту: языки, доли, пакетные менеджеры и система сборки считаются из манифестов и расширений арифметикой. Тот же принцип, по которому девять подпунктов шага 2 отданы скриптам. Бот получает готовые цифры и разбирается только с неоднозначным. Здесь же, одним обходом, считается письменность комментариев — китайский, хинди, арабский, кириллица: от неё зависит потолок контекста у экспертов. Отдельного определителя языка не ставим, диапазонов Юникода хватает; языки различаются только внутри латиницы, а на решения это уже не влияет.',
      params: { runtime: 'python',
                code: 'import json, collections\nEXT = {"py":"python","js":"javascript","ts":"typescript","tsx":"typescript","jsx":"javascript",\n       "java":"java","go":"go","rs":"rust","cs":"csharp","php":"php","rb":"ruby","kt":"kotlin",\n       "swift":"swift","c":"c","h":"c","cc":"cpp","cpp":"cpp","hpp":"cpp","scala":"scala","dart":"dart"}\nMANIFEST = {"package.json":"npm","requirements.txt":"pip","pyproject.toml":"pip","pom.xml":"maven",\n            "build.gradle":"gradle","go.mod":"go modules","Cargo.toml":"cargo","composer.json":"composer",\n            "Gemfile":"bundler","pubspec.yaml":"pub","CMakeLists.txt":"cmake"}\nBUILD = {"Dockerfile":"docker","docker-compose":"compose","Makefile":"make",".github/workflows":"github actions",\n         "vite.config":"vite","webpack.config":"webpack","tsconfig.json":"typescript"}\ntree = ctx["file_tree"]\nnames = [f["path"] for f in tree]\nlang = collections.Counter()\nfor f in tree:\n    e = f["ext"].lower().lstrip(".")\n    if e in EXT: lang[EXT[e]] += 1\ntotal = max(sum(lang.values()), 1)\n# ponytail: считаем письменность, а не язык — на решения влияет только она. Определитель языка добавить, если понадобится отличать испанский от английского\nWRITING = [("cyrillic",0x400,0x4FF),("greek",0x370,0x3FF),("arabic",0x600,0x6FF),("hebrew",0x590,0x5FF),\n           ("devanagari",0x900,0x97F),("thai",0xE00,0xE7F),("hangul",0xAC00,0xD7AF),\n           ("kana",0x3040,0x30FF),("han",0x4E00,0x9FFF)]\nw = collections.Counter()\nlines = hits = 0\nfor path, _, line in walk_files(only=SAMPLE_GLOBS.split(",")):\n    lines += 1\n    if lines > int(SAMPLE_LINES): break\n    if line.isascii(): continue\n    hits += 1\n    for ch in line:\n        o = ord(ch)\n        for name, lo, hi in WRITING:\n            if lo <= o <= hi:\n                w[name] += 1\n                break\nhan = w.pop("han", 0)\nkana = w.pop("kana", 0)\nif han or kana: w["japanese" if kana else "chinese"] = han + kana\nprint(json.dumps({\n  "languages": [{"name": n, "share": round(c / total, 3), "files": c} for n, c in lang.most_common()],\n  "package_managers": sorted({v for k, v in MANIFEST.items() if any(x.endswith(k) for x in names)}),\n  "build": sorted({v for k, v in BUILD.items() if any(k in x for x in names)}),\n  "manifests": [x for x in names if x.split("/")[-1] in MANIFEST],\n  "writing": {k: round(c / max(sum(w.values()), 1), 3) for k, c in w.most_common()},\n  "non_ascii_share": round(hits / max(lines, 1), 3),\n}, ensure_ascii=False))',
                cwd: '', env: 'SAMPLE_GLOBS=*.py,*.js,*.ts,*.tsx,*.java,*.go,*.rs,*.cs,*.php,*.rb,*.kt,*.swift,*.c,*.cpp,*.md\nSAMPLE_LINES=20000',
                timeout_s: 90.000, output_var: 'ctx.manifest', on_error: 'continue' } },

    { id: 'transform_graphcheck_64', type: 'transform', name: 'Полнота графа и карточка проекта', x: 2210, y: 700, enabled: true,
      notes: 'Считает, что реально разобралось: сколько файлов вошло в граф против найденных, есть ли функции, вызовы, эндпоинты, модели базы. Отсюда же собирается карточка для пользователя — вместе с честной пометкой, какие направления окажутся слепыми. Пишет две переменные: ctx.graph_check и ctx.profile_card.',
      params: { language: 'python',
                code: 'g = ctx["graph"]["stats"]\nt = ctx["triage"]\np = ctx["profile"]\nm = ctx["manifest"]\ncov = round(g["parsed_files"] / max(t["source_files"], 1), 3)\nblind = []\nif g.get("endpoints", 0) == 0:\n    blind.append("Уязвимости: «что открыто наружу» — эндпоинтов в графе нет")\nif g.get("db_models", 0) == 0 and not p["database"]["present"]:\n    blind.append("Оптимизация: пункты про базу — базы в проекте не видно")\nif g.get("calls", 0) == 0:\n    blind.append("Качество: «мёртвый код» и «запутанные зависимости» — вызовы не разобрались")\nctx["graph_check"] = {"coverage": cov, "functions": g.get("functions", 0), "blind": blind}\nctx["profile_card"] = {\n  "языки": m["languages"], "сборка": m["build"], "пакеты": m["package_managers"],\n  "письменность комментариев": m.get("writing") or "латиница",\n  "отвечаем на языке": ctx.get("reply_lang", "из браузера"),\n  "база данных": p["database"], "платформа": p["platform"],\n  "файлов всего": t["total_files"], "разобрано в граф": str(int(cov * 100)) + "%",\n  "не разберём": t["unsupported"], "слепые зоны": blind,\n}',
                output_var: 'ctx.graph_check' } },

    { id: 'cond_graph_65', type: 'condition', name: 'Граф получился?', x: 2520, y: 700, enabled: true,
      notes: 'Последний шлюз перед выбором действий. Ноль функций — парсер не справился, продолжать нельзя: иначе выдадим «проблем не найдено» на неразобранном проекте, а это худший из возможных ответов. Неполный, но живой граф пропускаем — про слепые зоны пользователь прочитает в карточке.',
      params: { expression: 'ctx.graph_check.functions > 0',
                note: 'неполнота графа не останавливает, она показывается в карточке' } },

    { id: 'store_project_66', type: 'store', name: 'Карточка проекта в базу знаний', x: 2830, y: 700, enabled: true,
      notes: 'Пишется ДО всех ожиданий пользователя: ушёл он с экрана подтверждения или не выбрал направления — проект всё равно посчитан не зря. На этих карточках держится расчётное время в прогрессе, подсказки по языкам и приоритет, какой парсер писать следующим. Обезличено: имена и пути хешируются, исходники сюда не попадают. Правку профиля пользователь вносит позже — её дописывает store_profile_fix_106 после подтверждения.',
      params: { writes: ['профиль','манифесты','метрики графа','способ подключения','тайминги стадий','слепые зоны'],
                dataset: 'projects', anonymize: true,
                target: 'postgres', uri: '{{env.DATABASE_URL}}',
                keep: 'forever',
                dedupe_key: 'project_id + content_hash',
                versioning: true, redact_secrets: true, store_snippets: false,
                output_var: 'ctx.project_id' } },

    { id: 'choice_confirm_67', type: 'choice', name: 'Подтверждение профиля', x: 2830, y: 900, enabled: true,
      notes: 'Бот показывает, что понял про проект, пользователь формально подтверждает. Две выгоды сразу: он видит, туда ли мы смотрим, а его правка — размеченный ответ, на котором профилировщик учится. Не ответил за полчаса — карточка уже сохранена, ждём возвращения.',
      params: { title: 'Вот что мы поняли про проект. Всё верно?', show_var: 'ctx.profile_card',
                mode: 'single', options: 'ok = Всё верно, продолжаем\nfix = Поправить',
                allow_select_all: false, defaults: ['ok'],
                timeout_s: 1800.000, on_timeout: 'none', output_var: 'ctx.profile_confirmed' } },

    { id: 'task_fix_68', type: 'task', name: 'Правка профиля', x: 2520, y: 900, enabled: true,
      notes: 'Пользователь исправляет то, что бот определил неверно: язык, СУБД, платформу. Правка дописывается в ту же карточку по ctx.project_id и помечается как подтверждённая человеком — самые ценные данные, которые даёт шаг 1. Повторно подтверждать не просим: правка и есть подтверждение.',
      params: { instruction: 'Показать поля профиля — языки, пакетные менеджеры, СУБД, платформу и язык, на котором нам отвечать, — с текущими значениями и дать поправить. Исправленное сохранить в ctx.profile, рядом записать, что именно бот определил неверно, для дообучения.',
                inputs: ['ctx.profile','ctx.manifest','ctx.project_id'],
                output_var: 'ctx.profile', timeout_s: 1800.000, on_error: 'continue' } },

    { id: 'store_profile_fix_106', type: 'store', name: 'Правка профиля → база знаний', x: 2520, y: 1060, enabled: true,
      notes: 'Дописывает в карточку проекта (по project_id) то, что пользователь поправил, и рядом — что именно бот определил неверно. Самый ценный размеченный сигнал шага 1: на нём учится профилировщик. store_project_66 пишется ДО подтверждения, поэтому правку персистит отдельная запись-обновление ПОСЛЕ task_fix_68 — иначе сигнал уходил в никуда с концом прогона. Обезличено, в тот же общий Postgres.',
      params: { writes: ['подтверждённый профиль','что бот определил неверно'],
                dataset: 'projects', anonymize: true,
                target: 'postgres', uri: '{{env.DATABASE_URL}}',
                keep: 'forever',
                dedupe_key: 'project_id + content_hash',
                versioning: true, redact_secrets: true, store_snippets: false,
                output_var: 'ctx.project_id' } },

    { id: 'store_reject_69', type: 'store', name: 'Карточка непригодного проекта', x: 1590, y: 900, enabled: true,
      notes: 'Проекты, которые мы не смогли разобрать, — самая полезная строка в базе знаний: из неё видно, какой парсер писать следующим. Пишем то немногое, что знаем: размер, расширения, причину отказа. Сюда сходятся оба отказа — и «нет исходников», и «граф не построился».',
      params: { writes: ['расширения','размер','причина отказа','способ подключения'],
                dataset: 'projects', anonymize: true,
                target: 'postgres', uri: '{{env.DATABASE_URL}}',
                keep: 'forever',
                dedupe_key: 'project_id + content_hash',
                versioning: true, redact_secrets: true, store_snippets: false,
                output_var: 'ctx.project_id' } },

    { id: 'output_reject_70', type: 'output', name: 'Не смогли разобрать', x: 1900, y: 900, enabled: true,
      notes: 'Единственный честный ответ на непригодный вход: почему не смогли и что нужно, чтобы смогли. Лучше сказать это сразу, чем показать пустой отчёт «проблем не найдено».',
      params: { target: 'variable', path: 'ctx.reject_message', format: 'markdown', append: false } },

    { id: 'output_saved_71', type: 'output', name: 'Сохранено, ждём возвращения', x: 2210, y: 900, enabled: true,
      notes: 'Сюда приходят оба «пользователь ушёл»: не подтвердил профиль и не выбрал направления. Прогон не пропадает — карточка в базе, граф построен; вернётся и продолжит с этого места.',
      params: { target: 'variable', path: 'ctx.saved_message', format: 'markdown', append: false } },

    { id: 'group_bugs_22', type: 'expert_group', name: 'Группа экспертов · Баги', x: 2830, y: 1119, enabled: true,
      notes: 'Шесть экспертов направления «Баги» одной карточкой. У всех одинаковые входы и выходы, отличаются только роль, чек-лист, область поиска и переменная вывода — значит это строки состава, а не отдельные блоки. Чекпоинт: результат каждого эксперта кэшируется по (run_id, role) в run_state; возобновление гоняет только незавершённых, готовых не перезапускает — дорогой LLM не переплачивается.',
      params: { title: 'Баги',
                model_ref: 'primary', temperature: 0.000, max_tokens: 8192, timeout_s: 600.000, retry: 2,
                scope: 'graph_then_code', tools: ['graph_query','code_read'], concurrency: 6, on_error: 'skip',
                rules: 'Критичность не выставляешь — её ставит отдельный агент градации.\nКаждая находка обязана иметь сценарий отказа: конкретный вход → неверный результат.\nБез доказательства из кода находка не выдаётся.\nСтиль, форматирование и вкусовщину не трогаешь: находка — это то, что ломается, а не то, что неудобно.',
                ignores: ['стиль','форматирование','именование'],
                scenario_required: true, evidence_required: true, sets_severity: false,
                experts: [
                  { role: 'логика', scope: '', output_var: 'ctx.bugs_logic',
                    method: 'Начни с функций, где от условия зависит денежный, правовой или необратимый итог.\nДля каждого условия подставь пограничные значения и пройди обе ветки руками.\nСверь порядок шагов с тем, что обещают имя функции и её описание.\nЗасчитывай, только когда назовёшь конкретный вход и неверный результат на нём; сомнение в читаемости находкой не считается.',
                    checklist: [
                      'Условие проверяет не то, что нужно: перепутаны > и >=, инвертирована проверка',
                      'Ветки if / else перепутаны местами',
                      'Операции выполняются в неверном порядке',
                      'Ошибка в формуле, знаке или единицах измерения',
                      'Сравниваются ссылки вместо значений',
                      'Ранний выход пропускает обязательный шаг',
                      'Условие всегда истинно или всегда ложно',
                    ].join('\n') },
                  { role: 'обработка ошибок', scope: '', output_var: 'ctx.bugs_errors',
                    method: 'Найди места, где вызывается чужой код: сеть, база, файл, сторонняя библиотека.\nДля каждого посмотри, что происходит при отказе: перехвачено, проглочено, переброшено или продолжено как при успехе.\nОтдельно проверь частично применённые изменения — есть ли откат.\nЗасчитывай, когда назовёшь отказ и то, чем он обернётся для данных или для пользователя; сознательно проглоченная ошибка с рабочим запасным путём находкой не считается.',
                    checklist: [
                      'Исключение перехвачено и проглочено без обработки',
                      'Ошибка записана в лог, но выполнение продолжается как при успехе',
                      'Нет отката после частично применённой операции',
                      'Внешний вызов без обработки таймаута и отказа',
                      'При перебросе потерян исходный контекст ошибки',
                      'Обработчик ловит слишком широкий тип и скрывает чужие сбои',
                      'Возврат «пустого» значения вместо сообщения об ошибке',
                    ].join('\n') },
                  { role: 'краевые значения', scope: 'code', tools: ['code_read'], output_var: 'ctx.bugs_edge',
                    method: 'Возьми входы функции и перебери предельные значения: пусто, ноль, отрицательное, граница диапазона, очень длинное.\nКаждое веди до первой операции, которая на нём сломается или вернёт неверное.\nДля дат отдельно проверь конец месяца, високосный год и смену часового пояса.\nЗасчитывай с конкретным значением на входе и тем, что оно даёт на выходе; предельное значение, которое проверка на входе не пропускает, находкой не считается.',
                    checklist: [
                      'Пустой список, строка или словарь',
                      'null / undefined / None там, где ожидается значение',
                      'Ноль в знаменателе и при взятии остатка',
                      'Отрицательное значение там, где ждут положительное',
                      'Границы индексов и диапазонов: первый, последний, за пределом',
                      'Переполнение и потеря точности',
                      'Очень длинный вход: строка, файл, коллекция',
                      'Даты: конец месяца, високосный год, смена часового пояса',
                    ].join('\n') },
                  { role: 'целостность данных', scope: '', output_var: 'ctx.bugs_data',
                    method: 'Найди операции, меняющие больше одной записи или больше одного хранилища.\nПроверь, идут ли они одной транзакцией и не успевают ли данные измениться между проверкой и записью.\nДля перезаписи ищи сверку версии, для удаления — возможность восстановить.\nЗасчитывай, когда опишешь порядок событий, при котором данные останутся несогласованными; изменение одной записи одной операцией и действие, безопасно повторяемое, находкой не считаются.',
                    checklist: [
                      'Изменение нескольких записей без транзакции',
                      'Проверка и запись разнесены: между ними данные успевают измениться',
                      'Перезапись без проверки версии или метки времени',
                      'Удаление без возможности восстановления',
                      'Валидация только на стороне клиента, на входе в хранилище её нет',
                      'Записали в одно хранилище и не записали во второе',
                      'Миграция без обратного шага',
                    ].join('\n') },
                  { role: 'параллельность', scope: '', output_var: 'ctx.bugs_race',
                    method: 'Найди состояние, к которому обращаются из нескольких потоков, обработчиков или экземпляров.\nВ каждом месте разнеси проверку и действие во времени и посмотри, что успевает вклиниться между ними.\nОтдельно проверь повторный запуск обработчика на том же событии и порядок захвата двух ресурсов.\nЗасчитывай, когда опишешь чередование шагов, дающее неверный итог; само по себе отсутствие блокировки без такого чередования — не находка.',
                    checklist: [
                      'Общее изменяемое состояние без синхронизации',
                      'Проверка и действие разнесены: между ними состояние меняется',
                      'Обработчик может запуститься повторно на том же событии',
                      'Результат зависит от порядка завершения асинхронных операций',
                      'Два ресурса захватываются в разном порядке — взаимная блокировка',
                      'Счётчик или кеш меняется без атомарной операции',
                      'Фоновая задача переживает отмену и дописывает данные',
                    ].join('\n') },
                  { role: 'ресурсы', scope: 'graph', tools: ['graph_query'], output_var: 'ctx.bugs_resources',
                    method: 'Спроси у графа места, где ресурс открывается: файл, соединение, курсор, таймер, подписка.\nОт каждого пройди все пути выхода, включая выход по ошибке, и найди те, где освобождения нет.\nОтдельно посмотри, ограничен ли рост коллекций и кешей.\nЗасчитывай, когда назовёшь путь выхода без освобождения; освобождение в общем месте на всех путях находкой не считается.',
                    checklist: [
                      'Файл, соединение или курсор открыт и не закрыт на всех путях выхода',
                      'Таймер, подписка или слушатель не отменяется',
                      'Коллекция или кеш растёт без ограничения',
                      'Соединение взято из пула и не возвращено',
                      'Временные файлы не удаляются',
                      'Поток или процесс создаётся в цикле без потолка',
                      'Блокировка захвачена и не снята при ошибке',
                    ].join('\n') },
                ],
                output_var: 'ctx.bugs_all' } },

    { id: 'dir_quality_31', type: 'direction', name: 'Качество и здоровье кода', x: 2830, y: 707, enabled: true,
      notes: 'Карточка направления «Качество». Граница с «Багами»: сюда идёт то, из-за чего тяжело развивать, туда — то, из-за чего ломается. Половина подпунктов считается графом, без агента.',
      params: { title: 'Качество и здоровье кода',
                items: [
                  'dead = Код, который больше не используется',
                  'coupling = Запутанные зависимости между модулями',
                  'complex = Слишком сложные места',
                  'experts = Экспертный разбор: дубли, слои, покрытие проверками',
                ].join('\n'),
                run: 'all', concurrency: 6, on_error: 'skip', output_var: 'ctx.quality_dispatch' } },

    { id: 'q_dead_32', type: 'script', name: 'Мёртвый код', x: 3140, y: 1730, enabled: true,
      notes: 'Запрос к графу, без LLM: функции и экспорты, до которых нет пути от точек входа. Ответ детерминированный и повторяемый — агенту тут делать нечего.',
      params: { runtime: 'python',
                code: 'from neo4j import GraphDatabase\nQ = """\nMATCH (f:Function)\nWHERE NOT ()-[:CALLS]->(f) AND coalesce(f.is_entrypoint,false)=false\nRETURN f.file AS file, f.line AS line, f.name AS name\n"""\nrows = run_cypher(Q)\nprint(json.dumps([{"expert":"dead_code","direction":"quality","file":r["file"],"line":r["line"],\n  "title":f\'Функция {r["name"]} не вызывается\',"detail":"","failure_scenario":"",\n  "evidence":"нет входящих рёбер CALLS в графе","confidence":0.950} for r in rows], ensure_ascii=False))',
                cwd: '', env: 'NEO4J_URI={{ctx.graph.uri}}', timeout_s: 120.000,
                output_var: 'ctx.q_dead', on_error: 'continue' } },

    { id: 'q_coupling_33', type: 'script', name: 'Запутанные зависимости', x: 3140, y: 1548, enabled: true,
      notes: 'Тоже чистый запрос к графу: замкнутые цепочки импортов и модули с аномально высокой связностью — те, что нельзя тронуть, не задев половину проекта.',
      params: { runtime: 'python',
                code: 'CYCLES = """\nMATCH p=(m:Module)-[:IMPORTS*2..8]->(m) RETURN [x IN nodes(p) | x.path] AS ring LIMIT 200\n"""\nHUBS = """\nMATCH (m:Module)<-[:IMPORTS]-(x) WITH m, count(x) AS deg WHERE deg > 12\nRETURN m.path AS path, deg ORDER BY deg DESC\n"""\nout = []\nfor r in run_cypher(CYCLES):\n    out.append({"expert":"coupling","direction":"quality","file":r["ring"][0],"line":0,\n      "title":"Замкнутая цепочка импортов","detail":" → ".join(r["ring"]),\n      "failure_scenario":"","evidence":"цикл в графе IMPORTS","confidence":1.000})\nfor r in run_cypher(HUBS):\n    out.append({"expert":"coupling","direction":"quality","file":r["path"],"line":0,\n      "title":f\'От модуля зависит {r["deg"]} других\',"detail":"","failure_scenario":"",\n      "evidence":"степень входящих IMPORTS","confidence":1.000})\nprint(json.dumps(out, ensure_ascii=False))',
                cwd: '', env: 'NEO4J_URI={{ctx.graph.uri}}', timeout_s: 120.000,
                output_var: 'ctx.q_coupling', on_error: 'continue' } },

    { id: 'q_complex_34', type: 'script', name: 'Слишком сложные места', x: 3140, y: 1366, enabled: true,
      notes: 'Метрики, снятые при построении графа: длина функции, глубина вложенности, цикломатическая сложность. Пороги вынесены в переменные окружения, чтобы их можно было крутить без правки кода.',
      params: { runtime: 'python',
                code: 'Q = """\nMATCH (f:Function)\nWHERE f.cyclomatic > $cx OR f.lines > $ln OR f.depth > $dp\nRETURN f.file AS file, f.line AS line, f.name AS name,\n       f.cyclomatic AS cx, f.lines AS ln, f.depth AS dp\nORDER BY f.cyclomatic DESC\n"""\nrows = run_cypher(Q, cx=int(MAX_CX), ln=int(MAX_LINES), dp=int(MAX_DEPTH))\nprint(json.dumps([{"expert":"complexity","direction":"quality","file":r["file"],"line":r["line"],\n  "title":f\'{r["name"]}: сложность {r["cx"]}, {r["ln"]} строк, вложенность {r["dp"]}\',\n  "detail":"","failure_scenario":"","evidence":"метрики из индексации",\n  "confidence":1.000} for r in rows], ensure_ascii=False))',
                cwd: '', env: 'NEO4J_URI={{ctx.graph.uri}}\nMAX_CX=15\nMAX_LINES=80\nMAX_DEPTH=4',
                timeout_s: 120.000, output_var: 'ctx.q_complex', on_error: 'continue' } },

    { id: 'merge_quality_38', type: 'merge', name: 'Свод по качеству', x: 3450, y: 1452, enabled: true,
      notes: 'Сводит шесть подпунктов направления в один список. Скрипты и агенты отдают находки в одной схеме, поэтому склейка механическая.',
      params: { strategy: 'all', timeout_s: 3600.000, output_var: 'ctx.quality_all' } },

    { id: 'dir_vulns_39', type: 'direction', name: 'Уязвимости системы', x: 2830, y: 913, enabled: true,
      notes: 'Карточка направления «Уязвимости». Граница с остальными: сюда идёт то, чем может воспользоваться посторонний. Четыре подпункта из семи считаются скриптами — там возможен точный ответ, и отдавать его агенту нельзя.',
      params: { title: 'Уязвимости системы',
                items: [
                  'secrets = Пароли и ключи, забытые в коде',
                  'deps = Небезопасные готовые библиотеки',
                  'surface = Что открыто наружу',
                  'config = Опасная конфигурация',
                  'experts = Экспертный разбор: права, внедрение, хранение данных',
                ].join('\n'),
                run: 'all', concurrency: 7, on_error: 'skip', output_var: 'ctx.vulns_dispatch' } },

    { id: 'v_secrets_40', type: 'script', name: 'Секреты и ключи', x: 3140, y: 2596, enabled: true,
      notes: 'Шаблоны известных форматов ключей плюс оценка энтропии строк. Смотрит и в историю репозитория — удалённый из кода ключ остаётся в коммитах и продолжает работать. Тестовые фикстуры и примеры отсеиваются по списку исключений.',
      params: { runtime: 'python',
                code: 'import re, math, json\nPAT = {\n  "aws_key": r"AKIA[0-9A-Z]{16}",\n  "private_key": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",\n  "slack": r"xox[baprs]-[0-9A-Za-z-]{10,}",\n  "jwt": r"eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.",\n  "generic": r"(?i)(secret|token|passwd|password|api[_-]?key)\\s*[=:]\\s*[\\"\\\']([^\\"\\\']{12,})",\n}\ndef entropy(s):\n    return -sum((s.count(c)/len(s)) * math.log2(s.count(c)/len(s)) for c in set(s))\nout = []\nfor path, line_no, line in walk_files(include_git_history=True):\n    if any(x in path for x in SKIP.split(",")): continue\n    for kind, rx in PAT.items():\n        m = re.search(rx, line)\n        if not m: continue\n        val = m.group(0)\n        if kind == "generic" and entropy(val) < float(MIN_ENTROPY): continue\n        out.append({"expert":"secrets","direction":"vulns","file":path,"line":line_no,\n          "title":f"Похоже на секрет: {kind}","detail":mask(val),\n          "failure_scenario":"ключ доступен всем, у кого есть репозиторий",\n          "evidence":f"шаблон {kind}","confidence":0.900})\nprint(json.dumps(out, ensure_ascii=False))',
                cwd: '', env: 'SKIP=test,tests,fixtures,example,sample,mock,__snapshots__\nMIN_ENTROPY=3.500',
                timeout_s: 300.000, output_var: 'ctx.v_secrets', on_error: 'continue' } },

    { id: 'v_deps_41', type: 'script', name: 'Небезопасные библиотеки', x: 3140, y: 2398, enabled: true,
      notes: 'Берёт список зависимостей из манифестов и спрашивает базы OSV и NVD. Никакого рассуждения: версия либо попадает в диапазон известной уязвимости, либо нет. Транзитивные зависимости считаются наравне с прямыми — ломают чаще через них.',
      params: { runtime: 'python',
                code: 'import json, urllib.request\ndeps = read_manifests(include_transitive=True)   # [{name, version, ecosystem}]\nout = []\nfor d in deps:\n    q = {"package":{"name":d["name"],"ecosystem":d["ecosystem"]},"version":d["version"]}\n    r = urllib.request.urlopen(OSV_URL, json.dumps(q).encode())\n    for v in json.load(r).get("vulns", []):\n        sev = (v.get("database_specific") or {}).get("severity","")\n        out.append({"expert":"deps","direction":"vulns","file":d["manifest"],"line":d.get("line",0),\n          "title":f\'{d["name"]} {d["version"]}: {v["id"]}\',"detail":v.get("summary",""),\n          "failure_scenario":v.get("details","")[:400],\n          "evidence":f\'OSV {v["id"]}, severity {sev}\',"confidence":1.000})\nprint(json.dumps(out, ensure_ascii=False))',
                cwd: '', env: 'OSV_URL=https://api.osv.dev/v1/query', timeout_s: 300.000,
                output_var: 'ctx.v_deps', on_error: 'continue' } },

    { id: 'v_surface_42', type: 'script', name: 'Что открыто наружу', x: 3140, y: 2778, enabled: true,
      notes: 'Не находки, а поверхность атаки: все точки, куда можно постучаться извне. Это опись, с которой работают эксперты по правам и внедрению — им нужны источники недоверенного ввода.',
      params: { runtime: 'python',
                code: 'Q = """\nMATCH (e:Endpoint)\nOPTIONAL MATCH (e)-[:HANDLED_BY]->(h:Function)\nRETURN e.method AS method, e.path AS path, e.public AS public,\n       h.file AS file, h.line AS line, h.name AS handler\n"""\nout = []\nfor r in run_cypher(Q):\n    out.append({"expert":"surface","direction":"vulns","file":r["file"],"line":r["line"],\n      "title":f\'{r["method"]} {r["path"]}\',"detail":f\'обработчик {r["handler"]}\',\n      "failure_scenario":"","evidence":"узел Endpoint в графе",\n      "confidence":1.000})\nprint(json.dumps(out, ensure_ascii=False))',
                cwd: '', env: 'NEO4J_URI={{ctx.graph.uri}}', timeout_s: 120.000,
                output_var: 'ctx.v_surface', on_error: 'continue' } },

    { id: 'v_config_43', type: 'script', name: 'Опасная конфигурация', x: 3140, y: 2216, enabled: true,
      notes: 'Отладочный режим в бою, CORS нараспашку, учётки по умолчанию, лишние права, выключенная проверка сертификатов. Стоит копейки, а ломают чаще всего именно через это.',
      params: { runtime: 'python',
                code: 'import json, re\nRULES = [\n  (r"(?i)\\bdebug\\s*[=:]\\s*(true|1|on)\\b", "Отладочный режим включён"),\n  (r"(?i)allow[_-]?origin\\s*[=:]\\s*[\\"\\\']?\\*", "CORS открыт для всех источников"),\n  (r"(?i)verify\\s*[=:]\\s*False|rejectUnauthorized\\s*:\\s*false", "Проверка TLS-сертификата отключена"),\n  (r"(?i)(user|login)\\s*[=:]\\s*[\\"\\\']?(admin|root)[\\"\\\']?", "Учётная запись по умолчанию"),\n  (r"(?i)chmod\\s+777|permissions?\\s*[=:]\\s*0?777", "Права 777"),\n  (r"(?i)ssl\\s*[=:]\\s*(false|off|0)", "Соединение без шифрования"),\n]\nout = []\nfor path, line_no, line in walk_files(only=CONFIG_GLOBS.split(",")):\n    for rx, title in RULES:\n        if re.search(rx, line):\n            out.append({"expert":"config","direction":"vulns","file":path,"line":line_no,\n              "title":title,"detail":line.strip()[:200],\n              "failure_scenario":"","evidence":"совпадение правила конфигурации",\n              "confidence":0.850})\nprint(json.dumps(out, ensure_ascii=False))',
                cwd: '', env: 'CONFIG_GLOBS=*.env,*.ini,*.cfg,*.conf,*.yml,*.yaml,*.toml,*.json,Dockerfile,docker-compose*',
                timeout_s: 180.000, output_var: 'ctx.v_config', on_error: 'continue' } },

    { id: 'merge_vulns_47', type: 'merge', name: 'Свод по уязвимостям', x: 3450, y: 2401, enabled: true,
      notes: 'Сводит семь подпунктов в один список. Для этого направления градация строже: находка без пути эксплуатации отклоняется, а не понижается в критичности.',
      params: { strategy: 'all', timeout_s: 3600.000, output_var: 'ctx.vulns_all' } },

    { id: 'dir_perf_48', type: 'direction', name: 'Оптимизация', x: 2830, y: 501, enabled: true,
      notes: 'Карточка направления «Оптимизация». Граница с «Багами»: там ломается со временем, здесь работает, но обходится дороже нужного. Статический анализ не измеряет — поэтому находки формулируются как подозрения с оценкой выигрыша, а приоритет им расставляют замеры.',
      params: { title: 'Оптимизация',
                items: [
                  'cost = На что уходят деньги',
                  'measure = Сверка с замерами',
                  'experts = Экспертный разбор: база, горячий путь, алгоритмы, повторы, ответы',
                ].join('\n'),
                run: 'all', concurrency: 7, on_error: 'skip', output_var: 'ctx.perf_dispatch' } },

    { id: 'p_cost_54', type: 'script', name: 'На что уходят деньги', x: 3140, y: 714, enabled: true,
      notes: 'Считает, а не рассуждает: сколько в коде вызовов платных внешних сервисов и откуда, сколько весит сборка и образ, какие зависимости тянут основной объём.',
      params: { runtime: 'python',
                code: 'import json, os\nQ = """\nMATCH (f:Function)-[:CALLS]->(x:External)\nWHERE x.host IN $paid\nRETURN x.host AS host, f.file AS file, f.line AS line, count(*) AS calls\nORDER BY calls DESC\n"""\nout = []\nfor r in run_cypher(Q, paid=PAID_HOSTS.split(",")):\n    out.append({"expert":"cost","direction":"perf","file":r["file"],"line":r["line"],\n      "title":f\'Платный вызов {r["host"]}: {r["calls"]} мест\',"detail":"",\n      "failure_scenario":"","evidence":"рёбра CALLS к внешнему сервису",\n      "confidence":1.000})\nfor name, size in measure_build_artifacts():   # сборка, образ, крупнейшие зависимости\n    if size > int(SIZE_LIMIT_MB) * 1024 * 1024:\n        out.append({"expert":"cost","direction":"perf","file":name,"line":0,\n          "title":f"{name}: {round(size/1048576, 3)} МБ","detail":"",\n          "failure_scenario":"","evidence":"замер размера артефакта","confidence":1.000})\nprint(json.dumps(out, ensure_ascii=False))',
                cwd: '{{ctx.project_path}}',
                env: 'NEO4J_URI={{ctx.graph.uri}}\nPAID_HOSTS=api.openai.com,api.anthropic.com,maps.googleapis.com,api.twilio.com,api.stripe.com\nSIZE_LIMIT_MB=50',
                timeout_s: 300.000, output_var: 'ctx.p_cost', on_error: 'continue' } },

    { id: 'p_measure_55', type: 'script', name: 'Замеры пользователя', x: 3140, y: 896, enabled: true,
      notes: 'Единственный источник фактов в этом направлении. Принимает приложенные логи, метрики или профиль и приводит их к виду «функция → время, вызовы». Ничего не ищет сам: его результат нужен агенту градации, чтобы расставить приоритет по реальному времени, а не по подозрению.',
      params: { runtime: 'python',
                code: 'import json\n# принимаем то, что приложил пользователь: профиль, логи медленных запросов, метрики\nrows = []\nfor path in MEASURE_FILES.split(","):\n    if not path.strip():\n        continue\n    rows += normalize_profile(path.strip())   # -> [{symbol, file, line, total_ms, calls, share}]\nrows.sort(key=lambda r: -r["total_ms"])\nprint(json.dumps({"available": bool(rows), "top": rows[:200]}, ensure_ascii=False))',
                cwd: '{{ctx.project_path}}',
                env: 'MEASURE_FILES={{ctx.user_measurements}}',
                timeout_s: 180.000, output_var: 'ctx.measurements', on_error: 'continue' } },

    { id: 'merge_perf_56', type: 'merge', name: 'Свод по оптимизации', x: 3450, y: 708, enabled: true,
      notes: 'Сводит семь подпунктов. Шесть дают подозрения, седьмой — факты: замеры уходят агенту градации, и приоритет получают те места, которые реально отнимают время.',
      params: { strategy: 'all', timeout_s: 3600.000, output_var: 'ctx.perf_all' } },


    { id: 'note_step2', type: 'note', name: 'Шаг 2', x: 40, y: -200, enabled: true, notes: '',
      params: { text: 'Все четыре направления разведены:\nБаги — 6, Качество — 6, Уязвимости — 7, Оптимизация — 7.\nВсего 26 подпунктов: 17 экспертов-агентов и 9 скриптов без LLM.' } },

    { id: 'merge_findings_14', type: 'merge', name: 'Все находки', x: 3760, y: 1425, enabled: true,
      notes: 'Сводит своды всех направлений в один поток находок. Общая схема у всех экспертов делает это склейкой, а не разбором.',
      params: { strategy: 'all', timeout_s: 7200.000, output_var: 'ctx.findings' } },

    { id: 'merge_branches_93', type: 'merge', name: 'Свод веток: код и живой', x: 3915, y: 1180, enabled: true,
      notes: 'Сюда сходятся две взаимоисключающие ветки анализа: статическая (свод всех направлений по коду) и динамическая (находки петли охоты по живому приложению). Развилка вида анализа — «один из двух», поэтому стратегия «любая»: ждём ту ветвь, что реально шла, а не обе (иначе непройденная ветка не придёт никогда и всё повиснет). Дальше поток общий — единый файл находок и градация. Появится совмещённый режим (обе сразу) — стратегия станет «ждать все».',
      params: { strategy: 'any', timeout_s: 7200.000, output_var: 'ctx.findings' } },

    { id: 'file_findings_29', type: 'script', name: 'Единый файл находок', x: 4070, y: 1425, enabled: true,
      notes: 'Складывает все находки проекта в один файл, дописывая по мере поступления. Это тот самый документ по проекту, с которым дальше работает градация — и который переживёт обрыв на середине прогона.',
      params: { runtime: 'python',
                code: 'import json, pathlib\np = pathlib.Path(out_path)\np.parent.mkdir(parents=True, exist_ok=True)\nbook = json.loads(p.read_text("utf-8")) if p.exists() else {"project": project, "findings": []}\nbook["findings"].extend(findings)\np.write_text(json.dumps(book, ensure_ascii=False, indent=2), "utf-8")\nprint(len(book["findings"]))',
                cwd: '{{ctx.project_path}}',
                env: 'out_path=out\\project_findings.json\nproject={{ctx.project_path}}\nfindings={{ctx.findings}}',
                timeout_s: 120.000, output_var: 'ctx.findings_file', on_error: 'fail' } },

    { id: 'agent_grade_30', type: 'agent', name: 'Агент градации', x: 4380, y: 1413, enabled: true,
      notes: 'Единственный, кто выставляет критичность. Видит все находки сразу, поэтому может сравнивать их между собой, склеивать дубли от разных экспертов и убирать то, что не подтверждается. Модель тяжёлая — файл находок большой.',
      params: { provider: 'project', model_ref: 'heavy', base_url: '', model: '', api_key_env: '',
                system_prompt: 'Ты судья находок. Эксперты критичность не ставили — ставишь ты, по одной шкале для всех направлений: info, low, medium, high, critical. Опирайся на последствие и достижимость: что произойдёт и насколько реально туда попасть. Склеивай дубли, найденные разными экспертами. Находку без сценария отказа или без доказательства помечай rejected, а не понижай в критичности. Находки идут из двух источников: статический разбор кода и динамическая проверка живого приложения (у динамических source=dast). Одну и ту же дыру, подтверждённую и кодом, и живым ответом, склей в одну и подними — двойное подтверждение сильнее любого одиночного; динамическую находку без воспроизводимого живого ответа не принимай.',
                prompt: 'Файл находок: {{ctx.findings_file}}\nЗамеры пользователя: {{ctx.measurements}} — если они есть, приоритет находок направления «Оптимизация» ставь по фактическому времени, а не по подозрению; если замеров нет, так и помечай.\n\nДля каждой находки выставь severity и priority, склей дубли, отсей неподтверждённые.\n\nВерни JSON:\n{\n  "graded": [{"id":"","severity":"","priority":0,"direction":"","file":"","line":0,"title":"","why_this_severity":"","duplicates":[]}],\n  "rejected": [{"id":"","reason":""}],\n  "totals": {"critical":0,"high":0,"medium":0,"low":0,"info":0}\n}',
                temperature: 0.000, max_tokens: 32768, tools: [], output_var: 'ctx.graded',
                retry: 2, timeout_s: 900.000, stream: false } },

    { id: 'store_15', type: 'store', name: 'Хранилище находок', x: 4690, y: 1425, enabled: true,
      notes: 'Кладёт ВСЁ найденное, включая платное. Секреты вырезаются перед сохранением: находка «вот твой ключ» не должна превращаться в чужой ключ, лежащий у нас вечно. Срок — по отчёту (until_paid): бесплатный истекает, оплаченный остаётся навсегда. Пишет в ОБЩИЙ Postgres рядом с прогонами и карточками — иначе находки не соединить с runs/projects для агрегатов «какой парсер писать» и покрытия. Локус единый: файл:строка для кода, url для живого (source=sast|dast). Идемпотентный upsert по run_id+ключ: повтор после сбоя не двоит; run_id берётся из run_open, здесь не минтится.',
      params: { writes: ['находки'], dataset: 'findings', anonymize: false,
                target: 'postgres', uri: '{{env.DATABASE_URL}}', keep: 'until_paid',
                dedupe_key: 'project_id + locus + rule + evidence_hash', versioning: true,
                redact_secrets: true, store_snippets: false, output_var: 'ctx.findings_stored' } },

    { id: 'paywall_16', type: 'paywall', name: 'Гейт выдачи', x: 5000, y: 1413, enabled: true,
      notes: 'Ничего не пересчитывает — только решает, что показать. Разметку тарифа берёт из меток [free]/[paid] в меню, а не из собственного списка: два списка рано или поздно разъедутся, и платный пункт утечёт бесплатно. Читает только прогоны со status=complete — полупрогон (упал на середине) пользователю не показывается.',
      params: { source_of_truth: 'menu', free_items: [],
                free_severity: ['info','low'],
                preview_shows: ['количество','критичность','категория','имя файла'],
                preview_hides: ['строка','фрагмент кода','сценарий отказа','способ эксплуатации','патч'],
                provider: 'stripe', price_model: 'one_off', wait_s: 86400.000,
                access_after_pay: 'forever', output_var: 'ctx.payment' } },

    { id: 'output_free_17', type: 'output', name: 'Бесплатный отчёт', x: 5310, y: 1425, enabled: true,
      notes: 'Карта проекта, документация, мелкие баги и быстрые оптимизации — полностью, со всеми деталями. Путь адресован по run_id — ключ объекта в blob-хранилище (S3); гейт отдаёт готовый артефакт без пересчёта.',
      params: { target: 'file', path: 'runs/{{ctx.run_id}}/report_free.md', format: 'markdown', append: false } },

    { id: 'output_preview_18', type: 'output', name: 'Витрина', x: 5310, y: 1789, enabled: true,
      notes: 'Что нашли, но не показываем: «3 критических бага, 1 путь несанкционированного доступа». Без строк, фрагментов и способа эксплуатации.',
      params: { target: 'variable', path: 'ctx.preview', format: 'json', append: false } },

    { id: 'output_full_19', type: 'output', name: 'Полный отчёт', x: 5310, y: 1607, enabled: true,
      notes: 'Открывается после оплаты. Данные не пересчитываются — они уже лежат в хранилище с момента прогона. Путь адресован по run_id — ключ объекта в blob-хранилище (S3).',
      params: { target: 'file', path: 'runs/{{ctx.run_id}}/report_full.md', format: 'markdown', append: false } },
    { id: 'group_quality_57', type: 'expert_group', name: "Группа экспертов · Качество", x: 3140, y: 1130, enabled: true,
      notes: "Три LLM-эксперта направления «Качество». Мёртвый код, запутанные зависимости и слишком сложные места считаются рядом скриптами по графу — там модель не нужна. Чекпоинт: результат каждого эксперта кэшируется по (run_id, role) в run_state; возобновление гоняет только незавершённых, готовых не перезапускает — дорогой LLM не переплачивается.",
      params: { title: "Качество и здоровье кода",
                model_ref: 'primary', temperature: 0.000, max_tokens: 8192, timeout_s: 600.000, retry: 2,
                scope: 'graph_then_code', tools: ['graph_query','code_read'], concurrency: 3, on_error: 'skip',
                rules: "Критичность находок не выставляешь — это делает отдельный агент градации.\nОбщих оценок «в целом по проекту» не выдаёшь: каждая находка — конкретное место.\nСвой любимый подход не навязываешь: судишь по правилу, принятому в самом проекте, а если правила нет — так и пишешь.\nСовпадение по форме без совпадения смысла находкой не считается.\nПо каждой подтверждённой находке говоришь, что именно с ней делать.",
                ignores: ['стиль','форматирование','именование'],
                scenario_required: true, evidence_required: true, sets_severity: false,
                experts: [
                  { role: "дубли", scope: "graph_then_code", output_var: "ctx.q_dup",
                    method: "Спроси у графа функции с похожими соседями по вызовам, дальше сверяй по коду.\nСравнивай смысл, а не форму: те же шаги в том же порядке и тот же итог при тех же входах.\nРазные имена, порядок необязательных проверок и мелкие детали дублем быть не мешают.\nЗасчитывай, когда назовёшь оба места и общую часть; совпадение по форме без совпадения смысла — не находка.",
                    checklist: "Две функции с разными именами повторяют одну и ту же бизнес-логику: те же шаги в том же порядке и тот же итог.\nОдин и тот же расчёт (комиссия, скидка, срок, лимит) написан заново в нескольких местах.\nОдинаковая проверка входящих данных переписана вручную вместо обращения к общей.\nКусок кода скопировали и слегка правили: совпадают ветвления, отличаются только имена переменных.\nОбработка одной и той же ошибки повторяется почти дословно в разных местах.\nОдин и тот же перечень значений или таблица соответствий заведены дважды.\nРядом со старой функцией живёт её новая версия, и обе ещё используются." },
                  { role: "архитектура и слои", scope: "graph", tools: ["graph_query"], output_var: "ctx.q_layers",
                    method: "Сначала определи, какие слои приняты в самом проекте — по расположению файлов и по преобладающему направлению вызовов.\nПострой по графу направления между слоями и найди рёбра, идущие против принятого порядка.\nОтдельно поищи круговые вызовы между модулями одного уровня.\nЗасчитывай, когда правило проекта видно и место его нарушает; единичные отступления на общем фоне помечай как исключения, а не как другое правило.",
                    checklist: "Слой, отвечающий за общение с пользователем, обращается к хранилищу напрямую, минуя промежуточный.\nЗапрос к базе данных написан прямо в месте приёма пользовательского запроса.\nБизнес-логика — расчёты, условия, решения — лежит в файле, который отвечает только за показ.\nНижний слой обращается к верхнему: хранилище или расчёт вызывает то, что его же и вызвало.\nДва модуля одного уровня вызывают друг друга по кругу.\nК внешней службе ходят напрямую из нескольких мест, хотя для этого есть отдельный общий слой.\nПорядок обращений соблюдён почти везде, а в паре мест обойдён — это единичные исключения, а не другое правило." },
                  { role: "покрытие проверками", scope: "graph", tools: ["graph_query"], output_var: "ctx.q_tests",
                    method: "Спроси у графа функции, до которых не ведёт путь ни от одного теста.\nИз них оставь те, что трогают деньги, права доступа или необратимые действия.\nУ покрытых важных мест проверь, не подменено ли вокруг всё так, что настоящая логика в тесте не выполняется.\nЗасчитывай конкретную функцию и то, чем грозит её отказ; общий процент покрытия находкой не считается.",
                    checklist: "Работа с деньгами — списание, начисление, возврат, расчёт стоимости — не вызывается ни из одного теста.\nПроверка прав доступа, кому что можно, не покрыта ни одним тестом.\nНеобратимое действие — удаление, отправка, публикация — проверяется только вручную.\nНа удачный ход событий тест есть, а на отказ, ошибку или повтор нет ни одного.\nФункция, работающая с данными пользователей, задевается тестами только косвенно, через соседний код.\nТест на важное место есть, но всё вокруг подменено, и настоящая логика в нём не выполняется.\nВажная функция проверена в одном простом случае, а предельные и пограничные значения не проверены." },
                ],
                output_var: "ctx.quality_experts" } },

    { id: 'group_vulns_58', type: 'expert_group', name: "Группа экспертов · Уязвимости", x: 3140, y: 1980, enabled: true,
      notes: "Три LLM-эксперта направления «Уязвимости». Секреты, уязвимые библиотеки, опись открытого наружу и опасная конфигурация остаются скриптами: там нужен точный ответ, а не рассуждение. Чекпоинт: результат каждого эксперта кэшируется по (run_id, role) в run_state; возобновление гоняет только незавершённых, готовых не перезапускает — дорогой LLM не переплачивается.",
      params: { title: "Уязвимости системы",
                model_ref: 'primary', temperature: 0.000, max_tokens: 8192, timeout_s: 600.000, retry: 2,
                scope: 'graph_then_code', tools: ['graph_query','code_read'], concurrency: 3, on_error: 'skip',
                rules: "Критичность не выставляешь — её ставит отдельный агент градации.\nНаходка без прослеженного пути от внешней точки до уязвимого места не выдаётся вовсе.\nВ поле failure_scenario пишешь путь эксплуатации: кто и откуда приходит → через что проходит → что получает.\nНа опись открытых наружу точек из соседнего подпункта не полагаешься — она считается одновременно с тобой; нужные точки входа спрашиваешь у графа сам.\nЕсли на пути уже стоит работающая защита — проверка прав, параметризация запроса, экранирование, белый список — находки нет.",
                ignores: ['стиль','форматирование','именование'],
                scenario_required: true, evidence_required: true, sets_severity: false,
                experts: [
                  { role: "вход без проверки прав", scope: "", model_ref: "heavy", output_var: "ctx.v_access",
                    method: "Спроси у графа точки, открытые наружу, и веди от каждой путь внутрь до обработчика.\nНа пути отметь, где стоит вход в систему и где проверка прав; ищи участок, где до опасного действия нет ни одной.\nГде объект берётся по идентификатору из запроса — проверь сверку принадлежности обратившемуся, а не только роль.\nК обработчику ведёт несколько путей — пройди каждый: хватает одного без проверки.\nЗасчитывай, только когда путь снаружи до места без проверки прослежен целиком; стоит рабочая проверка на пути — находки нет.",
                    checklist: "Открытая наружу точка, на пути от которой до обработчика не встречается ни одной проверки входа и прав\nОбработчик отдаёт или меняет объект по идентификатору из запроса, не проверив, что объект принадлежит обратившемуся\nПроверяется роль, но не проверяется принадлежность конкретной записи тому, кто её запросил\nК одному обработчику ведут два пути, и проверка прав стоит только на одном из них\nТокен или идентификатор сессии предсказуем: собран из порядкового номера, времени или данных пользователя\nСессия или токен живёт бессрочно и не отзывается при выходе, смене пароля и отзыве прав\nПраво проверяется только в интерфейсе, а на входе в сам обработчик проверки нет" },
                  { role: "внедрение через ввод", scope: "", model_ref: "heavy", output_var: "ctx.v_injection",
                    method: "Начни от значения, пришедшего снаружи, и веди его до опасной операции: запрос к базе, команда оболочки, шаблон, путь к файлу, переход по адресу, разбор объекта.\nНа всём пути смотри, обезвреживается ли значение — экранируется, параметризуется, сверяется с белым списком.\nК той же операции ведёт второй вход — проверь и его: защита на одном пути не закрывает другой.\nЗасчитывай, когда путь от ввода до операции прослежен без обезвреживания по дороге; есть рабочая защита на пути — находки нет.",
                    checklist: "Запрос к базе собирается склейкой строк, и в склейку попадает значение, пришедшее от пользователя\nКоманда оболочки собирается из значения, пришедшего снаружи\nЗначение из запроса подставляется в шаблон страницы или письма без экранирования\nИз пользовательского значения собирается путь к файлу — можно выйти за пределы разрешённой папки\nСервер сам идёт по адресу, который пришёл в запросе пользователя\nДанные из запроса разбираются как сохранённый объект: при разборе создаются объекты и выполняется код\nЗначение из ввода попадает в выражение или запрос, который собирается и вычисляется на лету\nПроверка ввода стоит на одной точке входа, а ко второй, ведущей к той же опасной операции, значение приходит непроверенным" },
                  { role: "хранение и передача", scope: "", output_var: "ctx.v_storage",
                    method: "Найди по графу и коду места, где рождаются, лежат и уходят наружу пароли, ключи, персональные и платёжные данные.\nДля хранения смотри способ: открыто, обратимо, быстрым хешем, с занижёнными параметрами.\nДля передачи смотри, шифруется ли канал и проверяется ли сертификат.\nОтдельно ищи утечку секрета в журнал, трассировку или сообщение об ошибке.\nЗасчитывай конкретное место с данными и способом; общей оценки «шифрование слабое» без места не выноси.",
                    checklist: "Пароли лежат в открытом виде, зашифрованы обратимо или хешируются быстрым алгоритмом без соли\nПараметры хеширования занижены — числа проходов и памяти не хватает, перебор дёшев\nПерсональные и платёжные данные хранятся без шифрования\nСоединение с базой, очередью или внешним сервисом идёт без шифрования либо с отключённой проверкой сертификата\nВ журнал, трассировку или сообщение об ошибке попадают пароль, токен, номер карты или персональные данные\nКлюч шифрования хранится рядом с данными, которые он защищает, и никогда не меняется\nШифрование, подпись или генерация случайных значений написаны вручную вместо готового проверенного механизма\nВзят устаревший алгоритм или слишком короткий ключ, от которых давно отказались" },
                ],
                output_var: "ctx.vulns_experts" } },

    { id: 'group_perf_59', type: 'expert_group', name: "Группа экспертов · Оптимизация", x: 3140, y: 494, enabled: true,
      notes: "Пять LLM-экспертов направления «Оптимизация». Расходы на внешние сервисы и сверка с замерами пользователя остаются скриптами. Чекпоинт: результат каждого эксперта кэшируется по (run_id, role) в run_state; возобновление гоняет только незавершённых, готовых не перезапускает — дорогой LLM не переплачивается.",
      params: { title: "Оптимизация",
                model_ref: 'primary', temperature: 0.000, max_tokens: 8192, timeout_s: 600.000, retry: 2,
                scope: 'graph_then_code', tools: ['graph_query','code_read'], concurrency: 5, on_error: 'skip',
                rules: "Статический анализ ничего не измеряет: утверждать «вот из-за этого тормозит» или «вот узкое место» запрещено.\nФормулировка любой находки — «подозрительное место, проверить замером».\nДля каждой находки оценивай ожидаемый выигрыш и цену переделки.\nКритичность не выставляй — это не твоя работа.\nКаждого кандидата проверяй по коду: по одному названию или по связи в графе находку не выноси.\nНаходка имеет смысл только на реальных объёмах: если данных заведомо мало и рост не ожидается — не выноси.\nЕсли предлагаешь сохранять готовый результат и отдавать повторно, сначала проверь, безопасен ли устаревший ответ.",
                ignores: ['стиль','форматирование','именование'],
                scenario_required: true, evidence_required: true, sets_severity: false,
                experts: [
                  { role: "обращения к базе", scope: "graph_then_code", output_var: "ctx.p_db",
                    method: "Спроси у графа места, где обращение к базе стоит внутри цикла или внутри обработчика запроса.\nУ каждого запроса посмотри ограничение количества строк, набор запрашиваемых полей и наличие индекса под отбор и сортировку.\nПрикинь число строк и запросов на реальных объёмах, а не на тестовых.\nЗасчитывай как подозрительное место с оценкой выигрыша и цены переделки; утверждать, что тормозит именно здесь, запрещено.",
                    checklist: "Обращение к базе внутри цикла: отдельный запрос на каждый элемент списка\nВыборка без ограничения количества строк — читается вся таблица целиком\nОтбор или сортировка по полю, для которого нет индекса\nЗапрос тянет все поля, хотя дальше используются два-три\nСвязанные данные догружаются отдельными запросами вместо одного соединения таблиц\nОтбор и сортировка выполняются в коде после того, как все строки уже вытащены из базы\nЗапись или обновление идут по одной строке там, где данные приходят пачкой\nПодсчёт количества делается выборкой всех строк вместо счёта на стороне базы" },
                  { role: "горячий путь", scope: "graph_then_code", output_var: "ctx.p_hot",
                    method: "Определи путь от приёма запроса до ответа пользователю и держись только его.\nНа этом пути найди ожидания: сеть, база, файл, чужой сервис, пауза, общая блокировка.\nОтметь то, что можно унести в фон или запустить одновременно вместо очереди.\nЗасчитывай с оценкой выигрыша и цены переделки; без замера называть узкое место запрещено.",
                    checklist: "На быстром пути ответа стоит ожидание ответа от чужого сервиса или от базы\nЧтение файла или обращение по сети выполняется внутри цикла обработки запроса\nНесколько независимых обращений к внешним сервисам идут по очереди, хотя могли бы одновременно\nДолгая работа — отправка письма, сборка отчёта, выгрузка — выполняется прямо в обработчике, а не в фоновой очереди\nПауза или повтор с задержкой стоит внутри цикла на пути ответа пользователю\nТяжёлый расчёт или обход большого списка выполняется прямо на пути ответа\nВсе запросы проходят через одну общую блокировку и ждут друг друга\nЗапись в журнал или отправка метрик выполняется на каждом шаге цикла обработки запроса" },
                  { role: "алгоритмы и структуры", scope: "code", tools: ["code_read"], output_var: "ctx.p_algo",
                    method: "Посмотри вложенность проходов по одним и тем же данным и прикинь, как растёт работа при увеличении входа.\nПроверь, какой структурой ищут: перебор списка там, где подошли бы словарь или множество.\nОтдельно посмотри, не пересобирается ли коллекция или строка заново на каждом шаге.\nЗасчитывай, когда назовёшь размер данных, при котором это станет заметно; на заведомо малых объёмах без ожидаемого роста — не находка.",
                    checklist: "Вложенный проход по одним и тем же данным: цикл внутри цикла по тому же списку\nПоиск нужного элемента перебором списка там, где подошли бы словарь или множество\nСортировка выполняется внутри цикла, хотя между итерациями данные не меняются\nКоллекция пересобирается заново на каждой итерации: склейка списков, копия целиком\nОдна и та же строка или структура разбирается заново на каждом шаге цикла\nСклейка текста в цикле по кусочку вместо сборки за один раз\nПолная сортировка всего списка там, где нужны только несколько первых элементов\nПересечение или разность двух списков считаются двойным перебором вместо множеств" },
                  { role: "повторные вычисления", scope: "graph_then_code", output_var: "ctx.p_cache",
                    method: "Проследи одну операцию целиком и посчитай, сколько раз за неё повторяются одинаковые запросы, чтения и расчёты с теми же входами.\nОтдели неизменное за всё время работы от меняющегося редко и от меняющегося постоянно.\nПрежде чем предлагать сохранять готовый результат, проверь, безопасен ли устаревший ответ в этом месте.\nЗасчитывай с числом повторов и оценкой выигрыша; повтор заведомо дешёвой операции и место, где устаревший ответ опасен, находкой не считаются.",
                    checklist: "Один и тот же запрос с теми же параметрами повторяется несколько раз за одну операцию\nФайл настроек читается и разбирается заново при каждом вызове, а не один раз при запуске\nСправочник, который почти не меняется, загружается заново на каждый запрос\nРезультат тяжёлого расчёта нигде не сохраняется, хотя входные данные те же самые\nК внешнему сервису идут повторные обращения за уже полученными данными\nШаблон, схема или образец для разбора текста собирается заново при каждом использовании\nЗначение, неизменное за всё время работы программы, вычисляется при каждом обращении\nОдна и та же проверка прав или настроек выполняется несколько раз в пределах одного запроса" },
                  { role: "тяжёлые ответы", scope: "graph_then_code", output_var: "ctx.p_payload",
                    method: "Возьми ответы, уходящие наружу, и оцени их размер на реальных данных: сколько элементов, какие поля, какая вложенность.\nНайди списки без ограничения количества и без разбивки на страницы, а также служебные поля, вызывающей стороне не нужные.\nПосмотри, собирается ли большой ответ целиком в памяти вместо отдачи по частям.\nЗасчитывай с оценкой размера и выигрыша от сокращения; ответ, заведомо малый на реальных данных и не растущий, находкой не считается.",
                    checklist: "Список отдаётся целиком, без ограничения количества и без разбивки на страницы\nВ ответ попадают внутренние и служебные поля, которые вызывающей стороне не нужны\nВложенный объект отдаётся целиком там, где хватило бы ссылки или его номера\nОбъёмный текстовый ответ отдаётся без сжатия\nКартинки и файлы отдаются в исходном виде, без ограничения размера и без уменьшенных копий\nОдни и те же справочные данные повторяются в каждом элементе списка вместо общего словаря\nВ один ответ собраны данные нескольких разделов, хотя обычно нужен только один\nБольшой ответ целиком собирается в памяти вместо отдачи по частям" },
                ],
                output_var: "ctx.perf_experts" } },

  ],
  edges: [
    { id: 'g1', from: { node: 'dir_quality_31', port: 'experts' }, to: { node: 'group_quality_57', port: 'in' }, kind: 'flow' },
    { id: 'g2', from: { node: 'dir_vulns_39', port: 'experts' },   to: { node: 'group_vulns_58', port: 'in' },   kind: 'flow' },
    { id: 'g3', from: { node: 'dir_perf_48', port: 'experts' },    to: { node: 'group_perf_59', port: 'in' },    kind: 'flow' },
    { id: 'g4', from: { node: 'group_quality_57', port: 'out' }, to: { node: 'merge_quality_38', port: 'in' }, kind: 'flow' },
    { id: 'g5', from: { node: 'group_vulns_58', port: 'out' },   to: { node: 'merge_vulns_47', port: 'in' },   kind: 'flow' },
    { id: 'g6', from: { node: 'group_perf_59', port: 'out' },    to: { node: 'merge_perf_56', port: 'in' },    kind: 'flow' },
    { id: 'g7', from: { node: 'context_20', port: 'out' }, to: { node: 'group_quality_57', port: 'kb' }, kind: 'data' },
    { id: 'g8', from: { node: 'context_20', port: 'out' }, to: { node: 'group_vulns_58', port: 'kb' },   kind: 'data' },
    { id: 'g9', from: { node: 'context_20', port: 'out' }, to: { node: 'group_perf_59', port: 'kb' },    kind: 'data' },
    { id: 'p1',  from: { node: 'start_1', port: 'out' },            to: { node: 'auth_73', port: 'in' },          kind: 'flow' },
    { id: 'p1b', from: { node: 'auth_73', port: 'out' },            to: { node: 'run_open_107', port: 'in' },      kind: 'flow' },
    { id: 'p1c', from: { node: 'run_open_107', port: 'out' },       to: { node: 'choice_scope_80', port: 'in' },   kind: 'flow' },
    { id: 'sw1', from: { node: 'sweep_cron_108', port: 'out' },     to: { node: 'run_sweeper_109', port: 'in' },   kind: 'flow' },

    /* Развилка вида анализа: код → существующий вход, приложение → ветка DAST. */
    { id: 's1', from: { node: 'choice_scope_80', port: 'code' },    to: { node: 'choice_entry_2', port: 'in' },   kind: 'flow' },
    { id: 's2', from: { node: 'choice_scope_80', port: 'live' },    to: { node: 'dast_verify_81', port: 'in' },   kind: 'flow' },
    { id: 'd1', from: { node: 'dast_verify_81', port: 'out' },      to: { node: 'dast_ident_94', port: 'in' },    kind: 'flow' },
    { id: 'd1b', from: { node: 'dast_ident_94', port: 'out' },      to: { node: 'dast_rate_104', port: 'in' },     kind: 'flow' },
    { id: 'd1r', from: { node: 'dast_rate_104', port: 'out' },       to: { node: 'dast_session_103', port: 'in' }, kind: 'flow' },
    { id: 'd1c', from: { node: 'dast_session_103', port: 'out' },   to: { node: 'dast_crawl_82', port: 'in' },    kind: 'flow' },
    { id: 'd2', from: { node: 'dast_crawl_82', port: 'out' },       to: { node: 'dast_discover_96', port: 'in' }, kind: 'flow' },
    { id: 'd2b', from: { node: 'dast_discover_96', port: 'out' },   to: { node: 'dast_graph_97', port: 'in' },     kind: 'flow' },
    { id: 'd2c', from: { node: 'dast_graph_97', port: 'out' },      to: { node: 'dast_targets_83', port: 'in' },   kind: 'flow' },
    { id: 'kb2', from: { node: 'dast_graph_97', port: 'graph' },    to: { node: 'agent_dast_planner_88', port: 'graph' }, kind: 'data' },
    { id: 'd3', from: { node: 'dast_targets_83', port: 'out' },     to: { node: 'dast_observe_98', port: 'in' },   kind: 'flow' },
    { id: 'd3b', from: { node: 'dast_observe_98', port: 'out' },    to: { node: 'dast_waf_105', port: 'in' },      kind: 'flow' },
    { id: 'd3c', from: { node: 'dast_waf_105', port: 'out' },       to: { node: 'dast_scan_85', port: 'in' },      kind: 'flow' },
    { id: 'd4',  from: { node: 'dast_scan_85', port: 'out' },              to: { node: 'dast_worklist_86', port: 'in' },          kind: 'flow' },
    { id: 'd5',  from: { node: 'dast_worklist_86', port: 'out' },          to: { node: 'dast_canary_100', port: 'in' },           kind: 'flow' },
    { id: 'd5b', from: { node: 'dast_canary_100', port: 'out' },           to: { node: 'dast_hunt_87', port: 'in' },              kind: 'flow' },
    { id: 'd6',  from: { node: 'dast_hunt_87', port: 'body' },             to: { node: 'agent_dast_planner_88', port: 'in' },     kind: 'flow' },
    { id: 'd7',  from: { node: 'agent_dast_planner_88', port: 'out' },     to: { node: 'script_dast_probe_89', port: 'in' },      kind: 'flow' },
    { id: 'd8',  from: { node: 'script_dast_probe_89', port: 'out' },      to: { node: 'agent_dast_verify_90', port: 'in' },      kind: 'flow' },
    { id: 'd9',  from: { node: 'agent_dast_verify_90', port: 'out' },      to: { node: 'transform_dast_control_91', port: 'in' }, kind: 'flow' },
    { id: 'd10', from: { node: 'transform_dast_control_91', port: 'out' }, to: { node: 'dast_hunt_87', port: 'loop_back' },       kind: 'flow' },
    { id: 'd11', from: { node: 'dast_hunt_87', port: 'done' },             to: { node: 'dast_canary_sweep_101', port: 'in' },     kind: 'flow' },
    { id: 'd11b',from: { node: 'dast_canary_sweep_101', port: 'out' },     to: { node: 'transform_dast_collect_92', port: 'in' }, kind: 'flow' },
    /* KB-retrieval (шаг №1): карточки приёмов по классу → порт «знания» планировщика, пунктир — как контекст к статическим экспертам */
    { id: 'kb1', from: { node: 'kb_dast_cards_95', port: 'data' }, to: { node: 'agent_dast_planner_88', port: 'kb' }, kind: 'data' },
    { id: 'p2',  from: { node: 'choice_entry_2', port: 'upload' },  to: { node: 'source_upload_3', port: 'in' },  kind: 'flow' },
    { id: 'p3',  from: { node: 'choice_entry_2', port: 'agent' },   to: { node: 'source_agent_4', port: 'in' },   kind: 'flow' },
    { id: 'p3b', from: { node: 'choice_entry_2', port: 'browser' }, to: { node: 'source_browser_72', port: 'in' }, kind: 'flow' },
    { id: 'p4c', from: { node: 'source_browser_72', port: 'out' },  to: { node: 'progress_upload_60', port: 'in' }, kind: 'flow' },
    { id: 'p4',  from: { node: 'source_upload_3', port: 'out' },    to: { node: 'progress_upload_60', port: 'in' }, kind: 'flow' },
    { id: 'p4b', from: { node: 'progress_upload_60', port: 'out' }, to: { node: 'merge_entry_7', port: 'in' },    kind: 'flow' },
    { id: 'p5',  from: { node: 'source_agent_4', port: 'out' },     to: { node: 'progress_5', port: 'in' },       kind: 'flow' },
    { id: 'p6',  from: { node: 'progress_5', port: 'out' },         to: { node: 'merge_entry_7', port: 'in' },    kind: 'flow' },

    /* Шлюз годности: дешёвая проверка дерева до того, как тратиться на сканы. */
    { id: 'p7',  from: { node: 'merge_entry_7', port: 'out' },      to: { node: 'script_triage_61', port: 'in' }, kind: 'flow' },
    { id: 'p7b', from: { node: 'script_triage_61', port: 'out' },   to: { node: 'cond_triage_62', port: 'in' },   kind: 'flow' },
    { id: 'p7c', from: { node: 'cond_triage_62', port: 'true' },    to: { node: 'queue_scan_8', port: 'in' },     kind: 'flow' },
    { id: 'p7d', from: { node: 'cond_triage_62', port: 'false' },   to: { node: 'store_reject_69', port: 'in' },  kind: 'flow' },

    { id: 'p8',  from: { node: 'queue_scan_8', port: 'out' },       to: { node: 'script_manifest_63', port: 'in' }, kind: 'flow' },
    { id: 'p8b', from: { node: 'script_manifest_63', port: 'out' }, to: { node: 'agent_profile_9', port: 'in' },  kind: 'flow' },
    { id: 'p9',  from: { node: 'queue_scan_8', port: 'out' },       to: { node: 'codegraph_10', port: 'in' },     kind: 'flow' },
    { id: 'p10', from: { node: 'agent_profile_9', port: 'out' },    to: { node: 'merge_scan_11', port: 'in' },    kind: 'flow' },
    { id: 'p11', from: { node: 'codegraph_10', port: 'out' },       to: { node: 'merge_scan_11', port: 'in' },    kind: 'flow' },

    /* Шлюз полноты графа → карточка в базу знаний → подтверждение → меню. */
    { id: 'p12',  from: { node: 'merge_scan_11', port: 'out' },            to: { node: 'transform_graphcheck_64', port: 'in' }, kind: 'flow' },
    { id: 'p12b', from: { node: 'transform_graphcheck_64', port: 'out' },  to: { node: 'cond_graph_65', port: 'in' },      kind: 'flow' },
    { id: 'p12c', from: { node: 'cond_graph_65', port: 'true' },           to: { node: 'store_project_66', port: 'in' },   kind: 'flow' },
    { id: 'p12d', from: { node: 'cond_graph_65', port: 'false' },          to: { node: 'store_reject_69', port: 'in' },    kind: 'flow' },
    { id: 'p12e', from: { node: 'store_reject_69', port: 'out' },          to: { node: 'output_reject_70', port: 'in' },   kind: 'flow' },
    { id: 'p12f', from: { node: 'store_project_66', port: 'out' },         to: { node: 'choice_confirm_67', port: 'in' },  kind: 'flow' },
    { id: 'p12g', from: { node: 'choice_confirm_67', port: 'ok' },         to: { node: 'choice_action_12', port: 'in' },   kind: 'flow' },
    { id: 'p12h', from: { node: 'choice_confirm_67', port: 'fix' },        to: { node: 'task_fix_68', port: 'in' },        kind: 'flow' },
    { id: 'p12i', from: { node: 'task_fix_68', port: 'out' },              to: { node: 'store_profile_fix_106', port: 'in' }, kind: 'flow' },
    { id: 'p12i2', from: { node: 'store_profile_fix_106', port: 'out' },   to: { node: 'choice_action_12', port: 'in' },   kind: 'flow' },

    /* Оба «пользователь ушёл» — в одну плашку. Карточка к этому моменту сохранена. */
    { id: 'p12j', from: { node: 'choice_confirm_67', port: 'none' },       to: { node: 'output_saved_71', port: 'in' },    kind: 'flow' },
    { id: 'p12k', from: { node: 'choice_action_12', port: 'none' },        to: { node: 'output_saved_71', port: 'in' },    kind: 'flow' },

    { id: 'q1', from: { node: 'choice_action_12', port: 'quality' }, to: { node: 'dir_quality_31', port: 'in' }, kind: 'flow' },

    /* карточка «Качество»: три запроса к графу + три эксперта → свод */
    { id: 'k1', from: { node: 'dir_quality_31', port: 'dead' },      to: { node: 'q_dead_32', port: 'in' },     kind: 'flow' },
    { id: 'k2', from: { node: 'dir_quality_31', port: 'coupling' },  to: { node: 'q_coupling_33', port: 'in' }, kind: 'flow' },
    { id: 'k3', from: { node: 'dir_quality_31', port: 'complex' },   to: { node: 'q_complex_34', port: 'in' },  kind: 'flow' },
    { id: 'k7',  from: { node: 'q_dead_32', port: 'out' },     to: { node: 'merge_quality_38', port: 'in' }, kind: 'flow' },
    { id: 'k8',  from: { node: 'q_coupling_33', port: 'out' }, to: { node: 'merge_quality_38', port: 'in' }, kind: 'flow' },
    { id: 'k9',  from: { node: 'q_complex_34', port: 'out' },  to: { node: 'merge_quality_38', port: 'in' }, kind: 'flow' },
    { id: 'k13', from: { node: 'merge_quality_38', port: 'out' }, to: { node: 'merge_findings_14', port: 'in' }, kind: 'flow' },

    { id: 'k14', from: { node: 'context_20', port: 'out' }, to: { node: 'q_dead_32', port: 'kb' },     kind: 'data' },
    { id: 'k15', from: { node: 'context_20', port: 'out' }, to: { node: 'q_coupling_33', port: 'kb' }, kind: 'data' },
    { id: 'k16', from: { node: 'context_20', port: 'out' }, to: { node: 'q_complex_34', port: 'kb' },  kind: 'data' },
    { id: 'q3', from: { node: 'choice_action_12', port: 'vulns' },   to: { node: 'dir_vulns_39', port: 'in' }, kind: 'flow' },

    /* карточка «Уязвимости»: четыре скрипта + три эксперта → свод */
    { id: 'v1', from: { node: 'dir_vulns_39', port: 'secrets' },   to: { node: 'v_secrets_40', port: 'in' }, kind: 'flow' },
    { id: 'v2', from: { node: 'dir_vulns_39', port: 'deps' },      to: { node: 'v_deps_41', port: 'in' },    kind: 'flow' },
    { id: 'v3', from: { node: 'dir_vulns_39', port: 'surface' },   to: { node: 'v_surface_42', port: 'in' }, kind: 'flow' },
    { id: 'v4', from: { node: 'dir_vulns_39', port: 'config' },    to: { node: 'v_config_43', port: 'in' },  kind: 'flow' },
    { id: 'v8',  from: { node: 'v_secrets_40', port: 'out' }, to: { node: 'merge_vulns_47', port: 'in' }, kind: 'flow' },
    { id: 'v9',  from: { node: 'v_deps_41', port: 'out' },    to: { node: 'merge_vulns_47', port: 'in' }, kind: 'flow' },
    { id: 'v10', from: { node: 'v_surface_42', port: 'out' }, to: { node: 'merge_vulns_47', port: 'in' }, kind: 'flow' },
    { id: 'v11', from: { node: 'v_config_43', port: 'out' },  to: { node: 'merge_vulns_47', port: 'in' }, kind: 'flow' },
    { id: 'v15', from: { node: 'merge_vulns_47', port: 'out' }, to: { node: 'merge_findings_14', port: 'in' }, kind: 'flow' },

    { id: 'v16', from: { node: 'context_20', port: 'out' }, to: { node: 'v_secrets_40', port: 'kb' }, kind: 'data' },
    { id: 'v17', from: { node: 'context_20', port: 'out' }, to: { node: 'v_deps_41', port: 'kb' },    kind: 'data' },
    { id: 'v18', from: { node: 'context_20', port: 'out' }, to: { node: 'v_surface_42', port: 'kb' }, kind: 'data' },
    { id: 'v19', from: { node: 'context_20', port: 'out' }, to: { node: 'v_config_43', port: 'kb' },  kind: 'data' },
    { id: 'q4', from: { node: 'choice_action_12', port: 'perf' },    to: { node: 'dir_perf_48', port: 'in' }, kind: 'flow' },

    /* карточка «Оптимизация»: пять экспертов + два скрипта → свод */
    { id: 'o6', from: { node: 'dir_perf_48', port: 'cost' },    to: { node: 'p_cost_54', port: 'in' },    kind: 'flow' },
    { id: 'o7', from: { node: 'dir_perf_48', port: 'measure' }, to: { node: 'p_measure_55', port: 'in' }, kind: 'flow' },
    { id: 'o13', from: { node: 'p_cost_54', port: 'out' },    to: { node: 'merge_perf_56', port: 'in' }, kind: 'flow' },
    { id: 'o14', from: { node: 'p_measure_55', port: 'out' }, to: { node: 'merge_perf_56', port: 'in' }, kind: 'flow' },
    { id: 'o15', from: { node: 'merge_perf_56', port: 'out' }, to: { node: 'merge_findings_14', port: 'in' }, kind: 'flow' },

    { id: 'o21', from: { node: 'context_20', port: 'out' }, to: { node: 'p_cost_54', port: 'kb' },    kind: 'data' },

    /* направление «Баги»: одна группа экспертов, состав внутри карточки */
    { id: 'q2', from: { node: 'choice_action_12', port: 'bugs' }, to: { node: 'group_bugs_22', port: 'in' }, kind: 'flow' },
    { id: 'b1', from: { node: 'group_bugs_22', port: 'out' }, to: { node: 'merge_findings_14', port: 'in' }, kind: 'flow' },
    { id: 'g10', from: { node: 'context_20', port: 'out' },   to: { node: 'group_bugs_22', port: 'kb' },     kind: 'data' },

    /* контекст проекта — один пучок на всех экспертов */
    { id: 'c1', from: { node: 'codegraph_10', port: 'graph' },     to: { node: 'context_20', port: 'in' }, kind: 'data' },
    { id: 'c2', from: { node: 'source_upload_3', port: 'code' },   to: { node: 'context_20', port: 'in' }, kind: 'data' },
    { id: 'c3', from: { node: 'source_agent_4', port: 'code' },    to: { node: 'context_20', port: 'in' }, kind: 'data' },

    { id: 'q8',  from: { node: 'merge_findings_14', port: 'out' },  to: { node: 'merge_branches_93', port: 'in' },   kind: 'flow' },
    { id: 'q8d', from: { node: 'transform_dast_collect_92', port: 'out' }, to: { node: 'merge_branches_93', port: 'in' }, kind: 'flow' },
    { id: 'q8e', from: { node: 'merge_branches_93', port: 'out' },  to: { node: 'file_findings_29', port: 'in' },   kind: 'flow' },
    { id: 'q15', from: { node: 'file_findings_29', port: 'out' },   to: { node: 'gaps_76', port: 'in' },            kind: 'flow' },
    { id: 'q15b',from: { node: 'gaps_76', port: 'out' },            to: { node: 'agent_grade_30', port: 'in' },     kind: 'flow' },
    { id: 'q16', from: { node: 'agent_grade_30', port: 'out' },     to: { node: 'store_15', port: 'in' },           kind: 'flow' },
    { id: 'q9',  from: { node: 'store_15', port: 'out' },           to: { node: 'store_run_77', port: 'in' },      kind: 'flow' },
    { id: 'q9b', from: { node: 'store_run_77', port: 'out' },       to: { node: 'paywall_16', port: 'in' },        kind: 'flow' },
    { id: 'q10', from: { node: 'store_15', port: 'data' },          to: { node: 'paywall_16', port: 'findings' },  kind: 'data' },
    { id: 'q11', from: { node: 'paywall_16', port: 'free' },        to: { node: 'output_free_17', port: 'in' },    kind: 'flow' },
    { id: 'q12', from: { node: 'paywall_16', port: 'preview' },     to: { node: 'output_preview_18', port: 'in' }, kind: 'flow' },
    { id: 'q13', from: { node: 'paywall_16', port: 'paid' },        to: { node: 'output_full_19', port: 'in' },    kind: 'flow' },

    { id: 'p13', from: { node: 'source_upload_3', port: 'code' },   to: { node: 'agent_profile_9', port: 'kb' },  kind: 'data' },
    { id: 'p14', from: { node: 'source_agent_4', port: 'code' },    to: { node: 'agent_profile_9', port: 'kb' },  kind: 'data' },
    { id: 'p15', from: { node: 'source_upload_3', port: 'code' },   to: { node: 'script_triage_61', port: 'kb' },   kind: 'data' },
    { id: 'p16', from: { node: 'source_agent_4', port: 'code' },    to: { node: 'script_triage_61', port: 'kb' },   kind: 'data' },
    { id: 'p17', from: { node: 'source_upload_3', port: 'code' },   to: { node: 'script_manifest_63', port: 'kb' }, kind: 'data' },
    { id: 'p18', from: { node: 'source_agent_4', port: 'code' },    to: { node: 'script_manifest_63', port: 'kb' }, kind: 'data' },
    { id: 'c4',  from: { node: 'source_browser_72', port: 'code' }, to: { node: 'context_20', port: 'in' },         kind: 'data' },
    { id: 'p13b',from: { node: 'source_browser_72', port: 'code' }, to: { node: 'agent_profile_9', port: 'kb' },    kind: 'data' },
    { id: 'p15b',from: { node: 'source_browser_72', port: 'code' }, to: { node: 'script_triage_61', port: 'kb' },   kind: 'data' },
    { id: 'p18b',from: { node: 'source_browser_72', port: 'code' }, to: { node: 'script_manifest_63', port: 'kb' }, kind: 'data' },
  ],
};
