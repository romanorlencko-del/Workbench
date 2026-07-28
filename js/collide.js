/* collide.js — геометрия коллизий: AABB-разведение (режим «блок») и объезд
   узлов проводом. Без зависимостей, общий для холста (editor) и жгута (harness).
   Все прямоугольники — в графовых координатах: {x, y, w, h}, точки — {x, y}. */

window.Collide = (function () {

  /* Минимальный вектор выталкивания (MTV) прямоугольника a из b с зазором gap.
     Толкаем по оси меньшего проникновения — так узел «скользит» вдоль соседа,
     а не прыгает. null — если не пересекаются. */
  function mtv(a, b, gap) {
    const g = gap || 0;
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    const bcx = b.x + b.w / 2, bcy = b.y + b.h / 2;
    const ox = (a.w / 2 + b.w / 2 + g) - Math.abs(acx - bcx);
    const oy = (a.h / 2 + b.h / 2 + g) - Math.abs(acy - bcy);
    if (ox <= 0 || oy <= 0) return null;
    if (ox < oy) return { x: acx < bcx ? -ox : ox, y: 0, pen: ox };
    return { x: 0, y: acy < bcy ? -oy : oy, pen: oy };
  }

  /* Разведение «блоком»: группа moving двигается как единое целое, statics
     стоят на месте. Возвращает поправку {x,y}, которую надо прибавить ко всем
     прямоугольникам moving, чтобы ни один не налезал на statics. Каждый проход
     гасит самое глубокое перекрытие — так группа сползает в свободный угол. */
  function resolveBlock(moving, statics, gap, iters) {
    let cx = 0, cy = 0;
    const N = iters || 12;
    for (let k = 0; k < N; k++) {
      let worst = null, worstPen = 0.02;
      for (const m of moving) {
        const box = { x: m.x + cx, y: m.y + cy, w: m.w, h: m.h };
        for (const s of statics) {
          const v = mtv(box, s, gap);
          if (v && v.pen > worstPen) { worst = v; worstPen = v.pen; }
        }
      }
      if (!worst) break;
      cx += worst.x; cy += worst.y;
    }
    return { x: cx, y: cy };
  }

  /* Пересекает ли отрезок a→b прямоугольник r, раздутый на pad (Liang–Barsky).
     Возвращает true только при заходе внутрь тела, касание краем не считаем. */
  function segRect(a, b, r, pad) {
    const p = pad || 0;
    const x1 = r.x - p, y1 = r.y - p, x2 = r.x + r.w + p, y2 = r.y + r.h + p;
    const dx = b.x - a.x, dy = b.y - a.y;
    let t0 = 0, t1 = 1;
    const clip = (num, den) => {
      if (den === 0) return num >= 0;              // отрезок параллелен грани
      const t = num / den;
      if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    if (clip(a.x - x1, -dx) && clip(x2 - a.x, dx) && clip(a.y - y1, -dy) && clip(y2 - a.y, dy)) {
      return t1 - t0 > 0.001;
    }
    return false;
  }

  /* Объезд: если прямой путь a→b протыкает какие-то из obstacles, вернуть, с
     какой стороны обойти (up/над или down/под) и по какому уровню y, плюс
     x-размах преграды. null — путь свободен. */
  function detour(a, b, obstacles, pad) {
    const p = pad || 0;
    const hit = obstacles.filter(r => segRect(a, b, r, p));
    if (!hit.length) return null;
    const top = Math.min(...hit.map(r => r.y - p));
    const bot = Math.max(...hit.map(r => r.y + r.h + p));
    const x1 = Math.min(...hit.map(r => r.x - p));
    const x2 = Math.max(...hit.map(r => r.x + r.w + p));
    const lineY = (a.y + b.y) / 2;
    const up = lineY - top, down = bot - lineY;        // цена обхода сверху / снизу
    return (up <= down)
      ? { side: 'up', y: top, x1, x2 }
      : { side: 'down', y: bot, x1, x2 };
  }

  return { mtv, resolveBlock, segRect, detour };
})();
