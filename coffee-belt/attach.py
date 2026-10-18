#!/usr/bin/env python3
"""attach.py — вкладывает данные в PDF-отчёт и пишет ../coffee-belt-report.pdf.

Берёт build/report-raw.pdf и build/data.json (их делает report.cjs) и добавляет
в PDF файлы-вложения: две таблицы CSV (открываются в Excel) и полный JSON.
"""
import csv
import io
import json
import os

from pypdf import PdfReader, PdfWriter

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
SEASONS = ["2021/22", "2022/23", "2023/24", "2024/25", "2025/26", "2026/27"]
MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"]
LEVELS = ["межсезонье", "малый сбор", "сбор", "пик"]


def to_csv(header, rows):
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")  # «;» — чтобы русский Excel сразу разложил по столбцам
    w.writerow(header)
    w.writerows(rows)
    return ("﻿" + buf.getvalue()).encode("utf-8")  # BOM: Excel узнаёт UTF-8


def dec(v):
    return str(v).replace(".", ",")


def main():
    data = json.load(open(os.path.join(BUILD, "data.json"), encoding="utf-8"))
    data.sort(key=lambda r: -r["vol"])

    countries = to_csv(
        ["Страна", "ISO", "Регион", "Урожай 2026/27, млн мешков", "Арабика, %", "Робуста, %",
         "Высота от, м", "Высота до, м", "Средняя высота, м", "Мытая, %", "Натуральная, %", "Хани, %",
         "Вет-халл / муссон, %", "Основная обработка", "Сорта", "Профиль чашки", "Терруар",
         "Сезон сбора по месяцам", "Сверка с другими источниками"],
        [[r["name"], r["iso"], r["region"], dec(r["vol"]), r["ara"], r["rob"], r["alt"][0], r["alt"][1], r["altAvg"],
          r["mix"]["washed"], r["mix"]["natural"], r["mix"]["honey"], r["mix"]["special"], r["main"],
          ", ".join(r["varieties"]), r["notes"], r["terroir"],
          ", ".join("%s: %s" % (MONTHS[i], LEVELS[l]) for i, l in enumerate(r["cal"]) if l),
          r["check"]] for r in data])

    dynamics = to_csv(
        ["Страна", "ISO"] + SEASONS + ["Примечание"],
        [[r["name"], r["iso"]] + [dec(v) for v in r["hist"]] + [r.get("histNote", "")] for r in data]
        + [["Сумма 12 стран", ""] + [dec(round(sum(r["hist"][i] for r in data), 3)) for i in range(6)]
           + ["2026/27 — прогноз USDA"]])

    writer = PdfWriter(clone_from=PdfReader(os.path.join(BUILD, "report-raw.pdf")))
    writer.add_metadata({
        "/Title": "Кофейный пояс Земли — выращивание и производство кофе",
        "/Subject": "12 крупнейших стран, сезон 2026/27, динамика 2021/22–2026/27 (USDA, ICO, CONAB, FNC)",
        "/Keywords": "кофе, арабика, робуста, USDA, ICO, урожай",
    })
    writer.add_attachment("coffee-countries.csv", countries)
    writer.add_attachment("coffee-dynamics-2021-2027.csv", dynamics)
    writer.add_attachment("coffee-data.json", json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8"))
    writer.page_mode = "/UseAttachments"  # просмотрщик сразу покажет панель вложений
    with open(os.path.join(HERE, "..", "coffee-belt-report.pdf"), "wb") as f:
        writer.write(f)


if __name__ == "__main__":
    main()
