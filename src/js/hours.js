// Understands the common forms of OpenStreetMap `opening_hours`, e.g.
//   "24/7", "08:00-23:00", "Mo-Sa 09:00-21:00; Su off", "Mo-Fr 10:00-14:00,17:00-02:00"
// Anything more exotic (months, holidays, sunrise, "+") returns null = unknown.

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const cache = new Map();

function parseDays(s) {
  const days = new Set();
  let onlyHoliday = true;
  for (const token of s.split(',')) {
    if (token === 'PH' || token === 'SH') continue; // can't know holidays offline; ignore
    onlyHoliday = false;
    const [a, b] = token.split('-');
    const i = DAYS.indexOf(a);
    if (i < 0) return null;
    if (b === undefined) { days.add(i); continue; }
    const j = DAYS.indexOf(b);
    if (j < 0) return null;
    for (let d = i; ; d = (d + 1) % 7) { days.add(d); if (d === j) break; }
  }
  return onlyHoliday ? 'holiday' : days;
}

function parseTimes(s) {
  if (/^(off|closed)$/i.test(s)) return [];
  const ranges = [];
  for (const part of s.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const start = Number(m[1]) * 60 + Number(m[2]);
    let end = Number(m[3]) * 60 + Number(m[4]);
    if (start > 1440 || end > 48 * 60) return null;
    if (end <= start) end += 1440; // runs past midnight
    ranges.push([start, end]);
  }
  return ranges;
}

/** Returns an array of 7 (Mon..Sun) lists of [startMin, endMin], or null if not understood. */
export function parseHours(text) {
  if (!text || typeof text !== 'string') return null;
  if (cache.has(text)) return cache.get(text);
  let week = Array.from({ length: 7 }, () => []);
  let ok = true;
  for (const raw of text.split(';')) {
    const rule = raw.trim().replace(/\s+/g, ' ');
    if (!rule) continue;
    if (rule === '24/7') { week = week.map(() => [[0, 1440]]); continue; }
    const space = rule.indexOf(' ');
    const head = space > 0 ? rule.slice(0, space).replace(/:$/, '') : rule;
    let days = parseDays(head);
    let timePart = rule;
    if (days) timePart = space > 0 ? rule.slice(space + 1).trim() : '';
    else days = new Set([0, 1, 2, 3, 4, 5, 6]);
    if (days === 'holiday') continue;
    const times = timePart === '24/7' ? [[0, 1440]] : parseTimes(timePart);
    if (!times) { ok = false; break; }
    days.forEach((d) => { week[d] = times; });
  }
  const result = ok ? week : null;
  cache.set(text, result);
  return result;
}

/** true = open, false = closed, null = unknown. */
export function isOpenAt(text, date = new Date()) {
  const week = parseHours(text);
  if (!week) return null;
  const today = (date.getDay() + 6) % 7;
  const yesterday = (today + 6) % 7;
  const mins = date.getHours() * 60 + date.getMinutes();
  if (week[today].some(([s, e]) => mins >= s && mins < e)) return true;
  if (week[yesterday].some(([, e]) => e > 1440 && mins < e - 1440)) return true;
  return false;
}
