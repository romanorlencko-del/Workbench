#!/usr/bin/env python3
"""update.py — обновление конструктора из GitHub: кнопкой в интерфейсе и командой в терминале.

Проверка спрашивает у GitHub последний коммит ветки. Установка тянет zip этой
ветки, распаковывает во временную папку, убеждается, что внутри действительно
конструктор, делает резервную копию заменяемых файлов и только потом подменяет.

Что НИКОГДА не трогается: планы, стройки, чек-листы, рабочие папки, резервные
копии и файл версии — всё пользовательское перечислено в KEEP. Лишние локальные
файлы не удаляются: обновление кладёт новое поверх, но не подчищает то, чего в
выпуске нет, — иначе чей-нибудь рабочий файл однажды исчезнет молча.

Только стандартная библиотека, как и весь остальной движок.

Настройка — переменные окружения:
  TESTER_REPO    владелец/репозиторий на GitHub, например user/bench (обязательно)
  TESTER_BRANCH  ветка, по умолчанию main
  TESTER_TOKEN   токен: нужен приватному репозиторию и снимает лимит запросов

Из терминала (из папки движка):
  py update.py check      есть ли новая версия
  py update.py apply      обновиться
  py update.py rollback   вернуть предыдущую версию
  py update.py where      куда смотрим и что установлено
"""
import io
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

# Собранный .exe распакован во временную папку, и подменять там нечего: обновлять
# надо то, что лежит рядом с исполняемым файлом. Для обычного запуска это одно и то же.
if getattr(sys, "frozen", False):
    ROOT = os.path.dirname(sys.executable)
else:
    ROOT = os.path.dirname(os.path.abspath(__file__))

BACKUPS = os.path.join(ROOT, "backups")
STATE_FILE = os.path.join(ROOT, ".bench-version.json")
API = "https://api.github.com"
TIMEOUT = 30.0
MAX_ARCHIVE = 128 * 1024 * 1024        # потолок на выпуск: больше — что-то не то приехало

# Пользовательское. Совпадение проверяется по первому сегменту пути внутри выпуска.
KEEP = {"projects", "backups", "workspaces", "logs", ".git", ".venv",
        "__pycache__", ".bench-version.json"}

# Признаки того, что в архиве действительно конструктор, а не случайный репозиторий.
REQUIRED = ("serve.py", "index.html", os.path.join("js", "blocks.js"))


def _conf():
    repo = (os.environ.get("TESTER_REPO") or "").strip().strip("/")
    branch = (os.environ.get("TESTER_BRANCH") or "main").strip()
    token = (os.environ.get("TESTER_TOKEN") or "").strip()
    return repo, branch, token


def _get(url, token, accept="application/vnd.github+json"):
    req = urllib.request.Request(url, headers={
        "Accept": accept,
        "User-Agent": "bench-updater",
        **({"Authorization": "Bearer " + token} if token else {}),
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return r.read()


def state():
    """Что установлено сейчас. Файла нет — значит движок ни разу не обновлялся отсюда."""
    try:
        with open(STATE_FILE, encoding="utf-8-sig") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _write_state(repo, branch, sha, date):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"repo": repo, "branch": branch, "sha": sha, "committed": date,
                   "installed": time.strftime("%Y-%m-%dT%H:%M:%S")}, f,
                  ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_FILE)


def check():
    """Есть ли новая версия. Ничего не скачивает и не меняет."""
    repo, branch, token = _conf()
    if not repo:
        return {"ok": False, "configured": False,
                "error": "не задан TESTER_REPO — неоткуда обновляться"}
    cur = state()
    try:
        raw = _get("%s/repos/%s/commits/%s" % (API, repo, branch), token)
        top = json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        hint = {401: "нужен TESTER_TOKEN", 403: "исчерпан лимит запросов или нужен токен",
                404: "нет такого репозитория или ветки"}.get(e.code, "")
        return {"ok": False, "configured": True,
                "error": "GitHub ответил %s%s" % (e.code, " — " + hint if hint else "")}
    except (urllib.error.URLError, ValueError, KeyError) as e:
        return {"ok": False, "configured": True, "error": "не удалось спросить GitHub: %s" % e}

    sha = top.get("sha") or ""
    commit = top.get("commit") or {}
    return {
        "ok": True, "configured": True, "repo": repo, "branch": branch,
        "current": cur.get("sha"), "current_committed": cur.get("committed"),
        "latest": sha, "latest_committed": (commit.get("committer") or {}).get("date"),
        "message": (commit.get("message") or "").split("\n")[0][:200],
        "behind": bool(sha) and cur.get("sha") != sha,
        "known": bool(cur.get("sha")),
    }


def _members(zf):
    """Пути внутри архива без верхней папки repo-branch/, с защитой от выхода наружу."""
    out = []
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        parts = [p for p in name.split("/") if p not in ("", ".")]
        if len(parts) < 2:
            continue                                  # сама верхняя папка
        rel = parts[1:]
        if any(p == ".." for p in rel):
            continue                                  # выход за пределы — пропускаем молча
        out.append((info, os.path.join(*rel), rel[0], name.endswith("/")))
    return out


def apply():
    """Скачать, проверить, сохранить старое и подменить. Возвращает отчёт."""
    if getattr(sys, "frozen", False):
        return {"ok": False, "error": "собранная версия не умеет заменять сама себя — "
                                      "переустановите .exe или запускайте из исходников"}
    repo, branch, token = _conf()
    if not repo:
        return {"ok": False, "error": "не задан TESTER_REPO — неоткуда обновляться"}

    info = check()
    if not info.get("ok"):
        return info
    sha, date = info["latest"], info.get("latest_committed")

    url = "https://codeload.github.com/%s/zip/refs/heads/%s" % (repo, branch)
    try:
        blob = _get(url, token, accept="application/zip")
    except (urllib.error.URLError, urllib.error.HTTPError) as e:
        return {"ok": False, "error": "не скачалось: %s" % e}
    if len(blob) > MAX_ARCHIVE:
        return {"ok": False, "error": "выпуск больше %d МБ — это не похоже на движок"
                                      % (MAX_ARCHIVE // (1024 * 1024))}

    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile as e:
        return {"ok": False, "error": "архив битый: %s" % e}

    with zf:
        members = _members(zf)
        have = {rel for _, rel, _, is_dir in members if not is_dir}
        missing = [r for r in REQUIRED if r not in have]
        if missing:
            return {"ok": False, "error": "в архиве нет %s — это не конструктор"
                                          % ", ".join(missing)}

        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = os.path.join(BACKUPS, stamp)
        written, saved = [], []
        try:
            for zinfo, rel, first, is_dir in members:
                if first in KEEP or is_dir:
                    continue
                dest = os.path.join(ROOT, rel)
                # то, что заменяем, сначала откладываем — иначе откатываться будет нечем
                if os.path.exists(dest):
                    keep_at = os.path.join(backup, rel)
                    os.makedirs(os.path.dirname(keep_at), exist_ok=True)
                    shutil.copy2(dest, keep_at)
                    saved.append(rel)
                os.makedirs(os.path.dirname(dest) or ROOT, exist_ok=True)
                with zf.open(zinfo) as src, open(dest, "wb") as dst:
                    shutil.copyfileobj(src, dst)
                written.append(rel)
        except (OSError, zipfile.BadZipFile) as e:
            # на полпути: возвращаем всё сохранённое обратно и уходим ни с чем
            restored = _restore(backup, saved)
            return {"ok": False, "error": "установка сорвалась: %s" % e,
                    "rolled_back": restored, "backup": backup}

    if saved:
        try:
            with open(os.path.join(backup, "manifest.json"), "w", encoding="utf-8") as f:
                json.dump({"files": saved, "replaced_at": stamp,
                           "was": state(), "now": sha}, f, ensure_ascii=False, indent=2)
        except OSError:
            pass                                      # опись — удобство, не условие отката

    _write_state(repo, branch, sha, date)
    return {"ok": True, "from": info.get("current"), "to": sha,
            "files": len(written), "backup": backup if saved else None,
            "restart_required": True}


def _restore(backup, names):
    done = 0
    for rel in names:
        src = os.path.join(backup, rel)
        if not os.path.exists(src):
            continue
        try:
            dest = os.path.join(ROOT, rel)
            os.makedirs(os.path.dirname(dest) or ROOT, exist_ok=True)
            shutil.copy2(src, dest)
            done += 1
        except OSError:
            pass
    return done


def rollback():
    """Вернуть последнюю сохранённую версию файлов."""
    try:
        dirs = sorted(d for d in os.listdir(BACKUPS)
                      if os.path.isdir(os.path.join(BACKUPS, d)))
    except OSError:
        dirs = []
    if not dirs:
        return {"ok": False, "error": "резервных копий нет — откатывать не к чему"}
    backup = os.path.join(BACKUPS, dirs[-1])
    try:
        with open(os.path.join(backup, "manifest.json"), encoding="utf-8-sig") as f:
            man = json.load(f)
        names = man.get("files") or []
        was = man.get("was") or {}
    except (OSError, ValueError):
        names, was = [], {}
        for base, _, files in os.walk(backup):
            for n in files:
                if n == "manifest.json":
                    continue
                names.append(os.path.relpath(os.path.join(base, n), backup))

    done = _restore(backup, names)
    if was.get("sha"):
        _write_state(was.get("repo", ""), was.get("branch", ""), was["sha"], was.get("committed"))
    elif os.path.exists(STATE_FILE):
        try:
            os.remove(STATE_FILE)                     # откатились в состояние «не обновлялись»
        except OSError:
            pass
    return {"ok": True, "backup": backup, "files": done, "restart_required": True}


def _cli():
    cmd = (sys.argv[1] if len(sys.argv) > 1 else "check").lower()
    if cmd in ("-h", "--help", "help"):
        print(__doc__)
        return 0
    if cmd == "where":
        repo, branch, _ = _conf()
        print("папка:     %s" % ROOT)
        print("источник:  %s" % ("%s@%s" % (repo, branch) if repo else "не задан (TESTER_REPO)"))
        cur = state()
        print("версия:    %s" % (cur.get("sha", "")[:12] or "неизвестна — ни разу не обновлялись"))
        return 0
    if cmd == "check":
        r = check()
        if not r.get("ok"):
            print("не вышло: %s" % r.get("error"))
            return 1
        if r["behind"]:
            print("есть новая версия: %s (%s)" % (r["latest"][:12], r.get("message", "")))
            print("текущая: %s" % ((r.get("current") or "")[:12] or "неизвестна"))
            print("обновиться:  py update.py apply")
        else:
            print("уже последняя: %s" % r["latest"][:12])
        return 0
    if cmd == "apply":
        r = apply()
        if not r.get("ok"):
            print("не вышло: %s" % r.get("error"))
            return 1
        print("обновлено до %s, файлов: %d" % (r["to"][:12], r["files"]))
        if r.get("backup"):
            print("прежние файлы: %s" % r["backup"])
        print("перезапустите движок, чтобы новая версия заработала")
        return 0
    if cmd == "rollback":
        r = rollback()
        if not r.get("ok"):
            print("не вышло: %s" % r.get("error"))
            return 1
        print("возвращено файлов: %d из %s" % (r["files"], r["backup"]))
        print("перезапустите движок")
        return 0
    print("неизвестная команда: %s (check | apply | rollback | where)" % cmd)
    return 2


if __name__ == "__main__":
    sys.exit(_cli())
