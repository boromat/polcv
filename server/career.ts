import type { Career, CareerPrefs, Profile } from '../shared/schemas';
import * as store from './storage/store';
import { HttpError, newId, nowIso } from './storage/store';
import { careerTurn, proposeRoles, rankOffers } from './llm/prompts/career';
import { searchRole } from './jobs/search';
import { normalize } from './ats/keywords';
import { tr } from './i18n';

const MAX_RANKED = 20;
const MAX_EXCLUDED = 10;

/** Jedna tura rozmowy: zapis wiadomości kandydata, odpowiedź doradcy, preferencje i nowe fakty do profilu. */
export async function chat(profileId: string, message: string): Promise<Career> {
  const text = message.trim();
  let career: Career;
  if (text) {
    // Zapisujemy od razu - jeśli AI zawiedzie, wiadomość kandydata nie przepadnie.
    career = await store.updateCareer(profileId, (c) => {
      c.chat.push({ role: 'user', content: text, at: nowIso() });
    });
  } else {
    career = await store.getCareer(profileId);
    // Pusta wiadomość: otwiera rozmowę albo ponawia odpowiedź na ostatnią wiadomość kandydata.
    if (career.chat.length && career.chat.at(-1)!.role === 'assistant') return career;
  }
  const basis = career.chat.at(-1);

  const profile = await store.getProfile(profileId);
  const turn = await careerTurn(profile, career);

  // Konkretne informacje o doświadczeniu trafiają do profilu - wykorzystają je kolejne CV.
  // Dopisujemy do świeżo odczytanego profilu: zmiany zrobione w trakcie odpowiedzi AI zostają.
  const isNew = (p: Profile) => {
    const known = new Set(p.extraFacts.map((f) => normalize(f.topic)));
    return turn.newFacts.filter((f) => f.topic.trim() && f.answer.trim() && !known.has(normalize(f.topic)));
  };
  if (isNew(profile).length) {
    await store.updateProfile(profileId, (p) => {
      for (const f of isNew(p)) {
        p.extraFacts.push({ id: newId(), topic: f.topic.trim(), has: true, answer: f.answer.trim(), source: tr('Rozmowa z doradcą kariery'), date: nowIso().slice(0, 10) });
      }
    });
  }

  return store.updateCareer(profileId, (c) => {
    // Rozmowa wyczyszczona w trakcie odpowiedzi - ta odpowiedź dotyczy starej rozmowy, więc ją pomijamy.
    if (basis && !c.chat.some((m) => m.at === basis.at && m.role === basis.role && m.content === basis.content)) return;
    c.chat.push({ role: 'assistant', content: turn.reply, at: nowIso() });
    c.prefs = turn.prefs;
    c.summary = turn.summary || c.summary;
    c.done = turn.done;
  });
}

export async function resetChat(profileId: string): Promise<Career> {
  return store.updateCareer(profileId, (c) => {
    c.chat = [];
    c.done = false;
  });
}

export async function savePrefs(profileId: string, prefs: CareerPrefs): Promise<Career> {
  return store.updateCareer(profileId, (c) => {
    c.prefs = { ...prefs, radiusKm: Math.max(0, Math.min(200, Math.round(prefs.radiusKm || 0))), salaryMin: Math.max(0, Math.round(prefs.salaryMin || 0)) };
  });
}

export async function makeProposals(profileId: string): Promise<Career> {
  const [profile, career] = await Promise.all([store.getProfile(profileId), store.getCareer(profileId)]);
  const res = await proposeRoles(profile, career);
  const roles = res.roles.map((r, i) => ({ ...r, id: `r${i + 1}`, keywords: r.keywords.slice(0, 4) }));
  return store.updateCareer(profileId, (c) => {
    c.proposals = { createdAt: nowIso(), intro: res.intro, roles };
    c.offers = {};
  });
}

/** Oferty dla stanowiska: wyszukiwanie na portalach, filtry z preferencji, ocena dopasowania przez AI. */
export async function findOffers(profileId: string, roleId: string): Promise<Career> {
  if (!(await store.getSettings()).jobSearch) {
    throw new HttpError(403, tr('Wyszukiwanie ofert jest wyłączone. Możesz je włączyć w Ustawieniach albo otworzyć wyszukiwanie na portalu linkiem przy stanowisku.'));
  }
  const [profile, career] = await Promise.all([store.getProfile(profileId), store.getCareer(profileId)]);
  const role = career.proposals?.roles.find((r) => r.id === roleId);
  if (!role) throw new HttpError(404, tr('Nie ma takiej propozycji - wygeneruj propozycje ponownie.'));
  const proposalsAt = career.proposals!.createdAt;

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
      errors.push(tr('Nie udało się ocenić dopasowania ofert przez AI - pokazuję je bez oceny.'));
    }
    const byMatch = (a: (typeof kept)[number], b: (typeof kept)[number]) => (b.match ?? -1) - (a.match ?? -1);
    items.sort(byMatch);
    extra.sort(byMatch);
  }

  // Wyszukiwanie i ocena trwają długo, a klient szuka kilku stanowisk naraz - zapisujemy tylko wynik tego stanowiska.
  return store.updateCareer(profileId, (c) => {
    // Propozycje wygenerowane od nowa w trakcie wyszukiwania - wynik dotyczy starej listy, więc go pomijamy.
    if (c.proposals?.createdAt !== proposalsAt) return;
    c.offers[roleId] = { fetchedAt: nowIso(), items, excluded: extra, stats, errors, scanned };
  });
}
