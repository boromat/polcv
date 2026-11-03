import type { Career, CareerPrefs } from '../shared/schemas';
import * as store from './storage/store';
import { HttpError, newId, nowIso } from './storage/store';
import { careerTurn, proposeRoles, rankOffers } from './llm/prompts/career';
import { searchRole } from './jobs/search';
import { normalize } from './ats/keywords';

const MAX_RANKED = 20;
const MAX_EXCLUDED = 10;

/** Jedna tura rozmowy: zapis wiadomości kandydata, odpowiedź doradcy, preferencje i nowe fakty do profilu. */
export async function chat(profileId: string, message: string): Promise<Career> {
  const career = await store.getCareer(profileId);
  const text = message.trim();
  if (text) {
    // Zapisujemy od razu - jeśli AI zawiedzie, wiadomość kandydata nie przepadnie.
    career.chat.push({ role: 'user', content: text, at: nowIso() });
    await store.saveCareer(profileId, career);
  } else if (career.chat.length && career.chat.at(-1)!.role === 'assistant') {
    // Pusta wiadomość: otwiera rozmowę albo ponawia odpowiedź na ostatnią wiadomość kandydata.
    return career;
  }

  const profile = await store.getProfile(profileId);
  const turn = await careerTurn(profile, career);

  career.chat.push({ role: 'assistant', content: turn.reply, at: nowIso() });
  career.prefs = turn.prefs;
  career.summary = turn.summary || career.summary;
  career.done = turn.done;

  // Konkretne informacje o doświadczeniu trafiają do profilu - wykorzystają je kolejne CV.
  const known = new Set(profile.extraFacts.map((f) => normalize(f.topic)));
  const fresh = turn.newFacts.filter((f) => f.topic.trim() && f.answer.trim() && !known.has(normalize(f.topic)));
  if (fresh.length) {
    for (const f of fresh) {
      profile.extraFacts.push({ id: newId(), topic: f.topic.trim(), has: true, answer: f.answer.trim(), source: 'Rozmowa z doradcą kariery', date: nowIso().slice(0, 10) });
    }
    await store.saveProfile(profile);
  }
  await store.saveCareer(profileId, career);
  return career;
}

export async function resetChat(profileId: string): Promise<Career> {
  const career = await store.getCareer(profileId);
  career.chat = [];
  career.done = false;
  await store.saveCareer(profileId, career);
  return career;
}

export async function savePrefs(profileId: string, prefs: CareerPrefs): Promise<Career> {
  const career = await store.getCareer(profileId);
  career.prefs = { ...prefs, radiusKm: Math.max(0, Math.min(200, Math.round(prefs.radiusKm || 0))), salaryMin: Math.max(0, Math.round(prefs.salaryMin || 0)) };
  await store.saveCareer(profileId, career);
  return career;
}

export async function makeProposals(profileId: string): Promise<Career> {
  const [profile, career] = await Promise.all([store.getProfile(profileId), store.getCareer(profileId)]);
  const res = await proposeRoles(profile, career);
  const roles = res.roles.map((r, i) => ({ ...r, id: `r${i + 1}`, keywords: r.keywords.slice(0, 4) }));
  career.proposals = { createdAt: nowIso(), intro: res.intro, roles };
  career.offers = {};
  await store.saveCareer(profileId, career);
  return career;
}

/** Oferty dla stanowiska: wyszukiwanie na portalach, filtry z preferencji, ocena dopasowania przez AI. */
export async function findOffers(profileId: string, roleId: string): Promise<Career> {
  if (!(await store.getSettings()).jobSearch) {
    throw new HttpError(403, 'Wyszukiwanie ofert jest wyłączone. Możesz je włączyć w Ustawieniach albo otworzyć wyszukiwanie na portalu linkiem przy stanowisku.');
  }
  const [profile, career] = await Promise.all([store.getProfile(profileId), store.getCareer(profileId)]);
  const role = career.proposals?.roles.find((r) => r.id === roleId);
  if (!role) throw new HttpError(404, 'Nie ma takiej propozycji - wygeneruj propozycje ponownie.');

  const { kept, excluded, stats, errors, scanned } = await searchRole(role, career.prefs);
  // Najpierw oferty z frazą w tytule, potem najnowsze - do oceny AI trafia ograniczona liczba.
  const words = [...role.keywords, role.title].flatMap((k) => normalize(k).split(' ')).filter((w) => w.length > 3);
  const relevance = (t: string) => words.filter((w) => normalize(t).includes(w.slice(0, 5))).length;
  const pick = (list: typeof kept, n: number) =>
    list.sort((a, b) => relevance(b.title) - relevance(a.title) || b.publishedAt.localeCompare(a.publishedAt)).slice(0, n);
  const items = pick(kept, MAX_RANKED);
  // Odrzucone przez preferencje też oceniamy - kandydat może zdecydować, że np. B2B jednak wchodzi w grę.
  const extra = pick(excluded, MAX_EXCLUDED);
  const toRank = [...items, ...extra];

  if (toRank.length) {
    try {
      const ranked = await rankOffers(profile, career, role, toRank);
      const byId = new Map(ranked.ranked.map((r) => [r.id, r]));
      for (const l of toRank) {
        const r = byId.get(l.id);
        if (r) {
          l.match = Math.max(0, Math.min(100, Math.round(r.match)));
          l.matchReason = r.reason;
        }
      }
    } catch (e: any) {
      if (e instanceof HttpError && [400, 401, 402, 503].includes(e.status)) throw e;
      errors.push('Nie udało się ocenić dopasowania ofert przez AI - pokazuję je bez oceny.');
    }
    const byMatch = (a: (typeof kept)[number], b: (typeof kept)[number]) => (b.match ?? -1) - (a.match ?? -1);
    items.sort(byMatch);
    extra.sort(byMatch);
  }

  career.offers[roleId] = { fetchedAt: nowIso(), items, excluded: extra, stats, errors, scanned };
  await store.saveCareer(profileId, career);
  return career;
}
