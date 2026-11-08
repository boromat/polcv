import type { CvContent, CvText, Profile } from '../../shared/schemas';
import { normalize } from '../ats/keywords';
import { profileLanguage } from '../llm/prompts/githubProjects';
import { newId } from '../storage/store';
import { tr } from '../i18n';

const MONTH_YEAR = /^(\d{1,2})[./](\d{4})$/;
const YEAR = /^(\d{4})$/;
const NOW = /^(obecnie|nadal|teraz|do dziś|present|now|current|currently|ongoing)$/i;

/** Data z CV ("03.2024", "03/2024", "2024") w formacie profilu (RRRR-MM albo RRRR). */
function profileDate(s: string): string | null {
  const m = MONTH_YEAR.exec(s.trim());
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1].padStart(2, '0')}`;
  return YEAR.test(s.trim()) ? s.trim() : null;
}

/** "03.2024 – 06.2025", "09/2023 - present" → daty profilu; null, gdy to nie jest czytelny zakres. */
export function parseCvDates(s: string): { start: string; end: string; current: boolean } | null {
  const parts = s.split(/\s*[-\u2013\u2014]\s*/).filter(Boolean);
  if (parts.length !== 2) return null;
  const start = profileDate(parts[0]);
  if (!start) return null;
  if (NOW.test(parts[1].trim())) return { start, end: '', current: true };
  const end = profileDate(parts[1]);
  return end ? { start, end, current: false } : null;
}

const same = (a: string, b: string) => normalize(a) === normalize(b);
/** Zmienione i niepuste: wyczyszczenie pola w CV nie kasuje danych w profilu. */
const edited = (before: string, after: string) => !!after.trim() && after.trim() !== before.trim();

/**
 * Punkty CV poprawione przez kandydata trafiają do osiągnięć pozycji profilu: poprawka zastępuje tekst,
 * z którego punkt powstał (gdy jest w profilu dosłownie), a nowy punkt jest dopisywany.
 */
function syncBullets(achievements: string[], before: CvText[], after: CvText[]): boolean {
  const old = new Map(before.map((b) => [b.id, b.text]));
  let touched = false;
  for (const b of after) {
    // Niepotwierdzona sugestia AI to jeszcze nie fakt od kandydata.
    if (b.status !== 'fact' || !edited(old.get(b.id) ?? '', b.text)) continue;
    const text = b.text.trim();
    if (achievements.some((a) => same(a, text))) continue;
    const was = old.get(b.id);
    const i = was ? achievements.findIndex((a) => same(a, was)) : -1;
    if (i >= 0) achievements[i] = text;
    else achievements.push(text);
    touched = true;
  }
  return touched;
}

/** Grupa umiejętności z CV → kategoria w profilu. */
function skillCategory(group: string): Profile['skills'][number]['category'] {
  const g = normalize(group);
  if (/narzedzi|tool/.test(g)) return 'narzędzia';
  if (/miekk|kompetenc|soft|interpersonal/.test(g)) return 'miękkie';
  if (/techn|program|dev/.test(g)) return 'techniczne';
  return 'inne';
}

/**
 * Poprawki kandydata w CV, które dotyczą faktów, trafiają też do profilu, żeby kolejne CV ich nie zgubiły:
 * stanowiska, firmy, daty, projekty, punkty, nowe umiejętności, języki, certyfikaty i zainteresowania.
 * Tytuł i podsumowanie są pisane pod ogłoszenie, więc zostają tylko w CV. CV w innym języku niż profil
 * (np. angielskie z polskiego profilu) niczego nie nadpisuje. Zmienia `profile`, zwraca opis tego, co zmieniło.
 */
export function syncCvEdit(profile: Profile, before: CvContent, after: CvContent): string[] {
  if (after.language !== profileLanguage(profile)) return [];
  const changes: string[] = [];

  for (const cur of after.experience) {
    const prev = before.experience.find((x) => x.sourceId === cur.sourceId);
    const item = profile.experience.find((e) => e.id === cur.sourceId);
    if (!prev || !item) continue;
    let touched = false;
    for (const key of ['role', 'company', 'location'] as const) {
      if (edited(prev[key], cur[key])) {
        item[key] = cur[key].trim();
        touched = true;
      }
    }
    const dates = edited(prev.dates, cur.dates) ? parseCvDates(cur.dates) : null;
    if (dates) {
      Object.assign(item, dates);
      touched = true;
    }
    if (syncBullets(item.achievements, prev.bullets, cur.bullets)) touched = true;
    if (touched) changes.push(tr('doświadczenie „{name}”', { name: item.role || item.company }));
  }

  for (const cur of after.projects) {
    const prev = before.projects.find((x) => x.sourceId === cur.sourceId);
    const item = profile.projects.find((p) => p.id === cur.sourceId);
    if (!prev || !item) continue;
    let touched = false;
    for (const key of ['name', 'role', 'link'] as const) {
      if (edited(prev[key], cur[key])) {
        item[key] = cur[key].trim();
        touched = true;
      }
    }
    const dates = edited(prev.dates, cur.dates) ? parseCvDates(cur.dates) : null;
    if (dates) {
      item.start = dates.start;
      item.end = dates.end;
      touched = true;
    }
    for (const tech of cur.technologies) {
      if (prev.technologies.some((x) => same(x, tech)) || item.technologies.some((x) => same(x, tech))) continue;
      item.technologies.push(tech.trim());
      touched = true;
    }
    if (syncBullets(item.achievements, prev.bullets, cur.bullets)) touched = true;
    if (touched) changes.push(tr('projekt „{name}”', { name: item.name }));
  }

  for (const cur of after.education) {
    const prev = before.education.find((x) => x.sourceId === cur.sourceId);
    const item = profile.education.find((e) => e.id === cur.sourceId);
    if (!prev || !item) continue;
    let touched = false;
    for (const key of ['school', 'degree', 'field'] as const) {
      if (edited(prev[key], cur[key])) {
        item[key] = cur[key].trim();
        touched = true;
      }
    }
    const dates = edited(prev.dates, cur.dates) ? parseCvDates(cur.dates) : null;
    if (dates) {
      Object.assign(item, dates);
      touched = true;
    }
    // Szczegóły w CV to wybór pod ogłoszenie: zastępują profil tylko wtedy, gdy były z nim zgodne, inaczej są dopisywane.
    if (edited(prev.details, cur.details) && !normalize(item.details).includes(normalize(cur.details))) {
      const text = cur.details.trim();
      item.details = !item.details.trim() || same(item.details, prev.details) ? text : `${item.details.trim()}; ${text}`;
      touched = true;
    }
    if (touched) changes.push(tr('wykształcenie „{name}”', { name: item.school || item.field }));
  }

  const addedSkills: string[] = [];
  const oldSkills = before.skills.flatMap((g) => g.items);
  for (const group of after.skills) {
    for (const name of group.items) {
      if (oldSkills.some((x) => same(x, name)) || profile.skills.some((s) => same(s.name, name))) continue;
      profile.skills.push({ id: newId(), name: name.trim(), category: skillCategory(group.category), level: '' });
      addedSkills.push(name.trim());
    }
  }
  if (addedSkills.length) changes.push(tr('umiejętności: {names}', { names: addedSkills.join(', ') }));

  let languages = false;
  for (const cur of after.languages) {
    if (!cur.name.trim()) continue;
    const prev = before.languages.find((x) => same(x.name, cur.name));
    const item = profile.languages.find((l) => same(l.name, cur.name));
    if (item) {
      if (prev && edited(prev.level, cur.level)) {
        item.level = cur.level.trim();
        languages = true;
      }
    } else if (!prev) {
      profile.languages.push({ id: newId(), name: cur.name.trim(), level: cur.level.trim() });
      languages = true;
    }
  }
  if (languages) changes.push(tr('języki'));

  const addedCerts = after.certificates.filter(
    (c) => c.name.trim() && !before.certificates.some((x) => same(x.name, c.name)) && !profile.certificates.some((x) => same(x.name, c.name)),
  );
  for (const c of addedCerts) profile.certificates.push({ id: newId(), kind: 'certyfikat', name: c.name.trim(), issuer: c.issuer.trim(), date: c.date.trim() });
  if (addedCerts.length) changes.push(tr('certyfikaty'));

  const addedInterests = after.interests.filter((i) => i.trim() && !before.interests.some((x) => same(x, i)) && !profile.interests.some((x) => same(x, i)));
  profile.interests.push(...addedInterests.map((i) => i.trim()));
  if (addedInterests.length) changes.push(tr('zainteresowania'));

  return changes;
}
