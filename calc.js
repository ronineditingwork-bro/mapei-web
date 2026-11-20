// Pure calculation helpers, shared by index.html and test/calc.test.js.

// "(25 кг)" -> {size: 25, unit: "кг"}; мл/г are converted to л/кг.
function parsePack(name) {
  const m = /\((\d+(?:[.,]\d+)?)\s*(кг|л|мл|г)\.?\s*\)/i.exec(name || '');
  if (!m) return null;
  let size = parseFloat(m[1].replace(',', '.'));
  let unit = m[2].toLowerCase();
  if (unit === 'мл') { size /= 1000; unit = 'л'; }
  if (unit === 'г') { size /= 1000; unit = 'кг'; }
  return { size, unit };
}

function isGrout(name) {
  return /шовн|затирк|keracolor|ultracolor|kerapoxy|керапокси|ultracare/i.test(name || '');
}

// Mapei grout formula: kg/m² = (A+B)/(A·B) · C · D · density; A,B tile sides, C tile thickness, D joint width — all mm.
function groutRate(a, b, c, d, density) {
  if (!(a > 0 && b > 0 && c > 0 && d > 0)) return 0;
  return (a + b) / (a * b) * c * d * (density || 1.6);
}

// Approximate consumption per m²; the user can override it in the app.
function defaultRate(name) {
  const n = (name || '').toUpperCase();
  if (/MAPELASTIC/.test(n)) return 3.4;       // 1.7 кг/м² на 1 мм, слой 2 мм
  if (/MAPEGUM/.test(n)) return 1.5;          // 2 слоя
  if (/PRIMER|ECO PRIM|ГРУНТ/.test(n)) return 0.15;
  if (/КЛЕЙ|ADESILEX|KERAFLEX|KERABOND|KERAQUICK|ULTRALITE|ELASTORAPID|GRANIRAPID|ADESIL/.test(n)) return 4; // шпатель 8–10 мм
  return 0;
}

// Returns {need, packs, sum, enough}; need is in pack units (кг/л).
function calc({ area, rate, reserve, packSize, price, stock }) {
  const need = area * rate * (1 + (reserve || 0) / 100);
  const packs = packSize > 0 ? Math.ceil(need / packSize - 1e-9) : 0;
  return { need, packs, sum: packs * price, enough: packs <= stock };
}


// 4976.5 -> "Четыре тысячи девятьсот семьдесят шесть рублей 50 копеек"
function rubToWords(amount) {
  const kop = Math.round(amount * 100);
  let rub = Math.floor(kop / 100);
  const ones = [['', 'один', 'два'], ['', 'одна', 'две']];
  const u = ['', '', '', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
  const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
  const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
  const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
  const plural = (n, f) => { n %= 100; if (n > 10 && n < 20) return f[2]; n %= 10; return n === 1 ? f[0] : n > 1 && n < 5 ? f[1] : f[2]; };
  const triad = (n, fem) => {
    const w = [hundreds[Math.floor(n / 100)]], t = n % 100;
    if (t >= 10 && t < 20) w.push(teens[t - 10]);
    else { w.push(tens[Math.floor(t / 10)]); const o = t % 10; w.push(o < 3 ? ones[fem ? 1 : 0][o] : u[o]); }
    return w.filter(Boolean).join(' ');
  };
  const scales = [[['', '', ''], 0], [['тысяча', 'тысячи', 'тысяч'], 1], [['миллион', 'миллиона', 'миллионов'], 0], [['миллиард', 'миллиарда', 'миллиардов'], 0]];
  const parts = [];
  for (let i = 0; rub > 0 && i < scales.length; i++, rub = Math.floor(rub / 1000)) {
    const n = rub % 1000;
    if (n) parts.unshift(triad(n, scales[i][1]) + (i ? ' ' + plural(n, scales[i][0]) : ''));
  }
  const r = Math.floor(kop / 100), k = kop % 100;
  const text = (parts.join(' ') || 'ноль') + ' ' + plural(r, ['рубль', 'рубля', 'рублей']) + ' ' + String(k).padStart(2, '0') + ' ' + plural(k, ['копейка', 'копейки', 'копеек']);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const money = n => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Standard Russian "Счёт на оплату" as a standalone A4 page (794 CSS px wide = A4 at 96 dpi).
// buyer: { name, inn, kpp, address, phone }; lines: { name, art, qty, price, img }; opts: { photos, arts, toolbar }.
// toolbar: on-screen «Сохранить PDF / Назад» buttons for the iPhone/browser version (hidden when printing).
function buildInvoice({ seller, buyer = {}, comment = '', lines, no, date, opts = {} }) {
  const e = escHtml;
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const d = new Date(date + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const buyerText = [buyer.name, buyer.inn && 'ИНН ' + buyer.inn, buyer.kpp && 'КПП ' + buyer.kpp, buyer.address, buyer.phone && 'тел.: ' + buyer.phone]
    .filter(Boolean).map(e).join(', ') || '—';
  const rows = lines.map((l, i) => `<tr><td class="c">${i + 1}</td>${opts.photos ? `<td class="ph">${l.img ? `<img src="${e(l.img)}" alt="">` : ''}</td>` : ''}<td>${e(l.name)}${opts.arts && l.art ? `<div class="small">арт. ${e(l.art)}</div>` : ''}</td><td class="r">${l.qty}</td><td class="c">шт</td><td class="r">${money(l.price)}</td><td class="r">${money(l.qty * l.price)}</td></tr>`).join('');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=794"><title>Счёт № ${e(no)}</title><style>
  @page { size: A4; margin: 0; }
  body { font: 11pt Arial, sans-serif; color: #000; margin: 0; padding: 40px 45px; width: 794px; box-sizing: border-box; background: #fff; }
  .ph { width: 64px; text-align: center; vertical-align: middle; } .ph img { width: 56px; height: 56px; object-fit: contain; display: block; margin: auto; }
  .comment { margin: 0 0 12px; padding: 8px 10px; border-left: 3px solid #00497a; background: #f4f7fa; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #000; padding: 3px 5px; vertical-align: top; }
  .bank td { height: 18px; } .small { font-size: 9pt; } .nb { border: 0; }
  h1 { font-size: 15pt; border-bottom: 2px solid #000; padding-bottom: 6px; margin: 18px 0 10px; }
  .party { display: grid; grid-template-columns: 110px 1fr; gap: 6px 10px; margin-bottom: 12px; }
  .items th { background: #f0f0f0; } .r { text-align: right; white-space: nowrap; } .c { text-align: center; }
  .tot { margin-top: 6px; text-align: right; font-weight: bold; } .sign { margin-top: 28px; border-top: 2px solid #000; padding-top: 18px; }
  .bar { position: sticky; top: 0; display: flex; gap: 10px; margin: -40px -45px 24px; padding: 14px 45px; background: #00497a; }
  .bar button { font: bold 20px Arial, sans-serif; border: 0; border-radius: 10px; padding: 14px 22px; background: #fff; color: #00497a; }
  @media print { .bar { display: none; } }
</style></head><body>${opts.toolbar ? `<div class="bar"><button onclick="history.back()">← Назад</button><button onclick="print()">Сохранить PDF / Поделиться</button></div>` : ''}
<table class="bank">
  <tr><td colspan="2" rowspan="2" style="width:58%">${e(seller.bank)}<br><span class="small">Банк получателя</span></td><td style="width:8%">БИК</td><td style="border-bottom:0">${e(seller.bik)}</td></tr>
  <tr><td>Сч. №</td><td style="border-top:0">${e(seller.ks)}</td></tr>
  <tr><td>ИНН ${e(seller.inn)}</td><td>КПП ${e(seller.kpp || '')}</td><td rowspan="2">Сч. №</td><td rowspan="2">${e(seller.account)}</td></tr>
  <tr><td colspan="2">${e(seller.name)}<br><span class="small">Получатель</span></td></tr>
</table>
<h1>Счёт на оплату № ${e(no)} от ${d}</h1>
<div class="party">
  <div>Поставщик (Исполнитель):</div><div><b>${e(seller.name)}, ИНН ${e(seller.inn)}, ${seller.kpp ? `КПП ${e(seller.kpp)}, ОГРН` : 'ОГРНИП'} ${e(seller.ogrn)}, ${e(seller.address)}, тел.: ${e(seller.phone)}</b></div>
  <div>Покупатель (Заказчик):</div><div><b>${buyerText}</b></div>
</div>
${comment ? `<div class="comment">${e(comment).replace(/\n/g, '<br>')}</div>` : ''}
<table class="items"><tr><th>№</th>${opts.photos ? '<th>Фото</th>' : ''}<th>Товары (работы, услуги)</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th></tr>${rows}</table>
<div class="tot">Итого: ${money(total)}</div>
<div class="tot">${seller.vatRate ? `В том числе НДС (${seller.vatRate}%): ${money(Math.round(total * seller.vatRate / (100 + seller.vatRate) * 100) / 100)}` : 'Без налога (НДС)'}</div>
<div class="tot">Всего к оплате: ${money(total)}</div>
<p>Всего наименований ${lines.length}, на сумму ${money(total)} руб.<br><b>${rubToWords(total)}</b></p>
<div class="sign">${seller.director ? `Руководитель ______________________ ${e(seller.director)}<br><br>Главный бухгалтер ______________________ ${e(seller.director)}` : `Предприниматель ______________________ ${e(seller.short)}`}</div>
</body></html>`;
}

// Product groups, in display order. First matching rule wins, so the order of rules matters
// (e.g. "добавка для шовных заполнителей" is an additive, not a grout).
const GROUPS = ['Клеи', 'Затирки цементные', 'Затирки эпоксидные', 'Герметики', 'Грунтовки', 'Гидроизоляция', 'Стяжки и ровнители', 'Добавки', 'Очистители', 'Инструмент', 'Прочее'];
const GROUP_RULES = [
  ['Инструмент', /MAPEI BASIC|губка|шпатель/i],
  ['Очистители', /очист|cleaner|keranet|pulicol|epoxy off|растворитель/i],
  ['Добавки', /добавк/i],
  ['Затирки эпоксидные', /эпоксид|kerapoxy|керапокси/i],
  ['Затирки цементные', /шовн|затирк|keracolor|ultracolor/i],
  ['Клеи', /клей|adesilex|keraflex|kerabond|ultralite|ultraflex|keralastic/i],
  ['Герметики', /герметик|mapesil|\bXS1\b/i],
  ['Грунтовки', /грунтовк|primer/i],
  ['Гидроизоляция', /гидроизол|mapelastic|mapeband|мапебанд|mapenet|idrostop|мапегард|mapetex|antipluviol|гидрофобиз/i],
  ['Стяжки и ровнители', /стяжк|наливн|ровнит|штукатурк|nivoplan|novoplan|topcem|mapefill|prosfas|раствор/i]
];
function group(name) {
  for (const [g, re] of GROUP_RULES) if (re.test(name || '')) return g;
  return 'Прочее';
}

if (typeof module !== 'undefined') module.exports = { parsePack, isGrout, groutRate, defaultRate, calc, rubToWords, buildInvoice, group, GROUPS };
