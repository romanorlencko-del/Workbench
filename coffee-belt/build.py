#!/usr/bin/env python3
"""build.py — собирает автономную страницу карты из исходника.

page.src.html + countries-110m.json + vendor/*.js -> build/standalone.html
(один файл: контуры стран и библиотеки встроены, внешних загрузок нет).
Дальше prerender.cjs сохраняет её уже отрисованной в ../coffee-belt.html.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
CDN_D3 = '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>'
CDN_TOPO = '<script src="https://cdnjs.cloudflare.com/ajax/libs/topojson/3.0.2/topojson.min.js"></script>'
HEAD = '''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
'''


def read(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return f.read()


def inline(name, banner):
    # "</script" внутри библиотеки закрыл бы тег раньше времени
    return "<script>/* %s */\n%s\n</script>" % (banner, read(name).replace("</script", "<\\/script"))


def main():
    world = json.loads(read("countries-110m.json"))
    geoms = world["objects"]["countries"]["geometries"]
    world["objects"]["countries"]["geometries"] = [g for g in geoms if g.get("id") != "010"]  # без Антарктиды
    page = read("page.src.html").replace("__WORLD__", json.dumps(world, separators=(",", ":")))
    page = page.replace(CDN_D3, inline("vendor/d3.min.js", "d3 v7.8.5, ISC License, https://d3js.org"))
    page = page.replace(CDN_TOPO, inline("vendor/topojson.min.js", "topojson v3.0.2, ISC License"))
    i = page.index('<div class="wrap">')
    os.makedirs(os.path.join(HERE, "build"), exist_ok=True)
    with open(os.path.join(HERE, "build", "standalone.html"), "w", encoding="utf-8") as f:
        f.write(HEAD + page[:i] + "</head>\n<body>\n" + page[i:] + "\n</body>\n</html>\n")


if __name__ == "__main__":
    main()
