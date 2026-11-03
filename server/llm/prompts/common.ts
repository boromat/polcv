import type { CvContent, CvVersion, JobPosting, Profile } from '../../../shared/schemas';

/** Profil bez danych technicznych (klucz API, pliki) — tylko to, co AI ma wiedzieć. */
export function profileForPrompt(p: Profile) {
  const { apiKey, files, photo, id, displayName, createdAt, updatedAt, ...rest } = p;
  return rest;
}

export function postingForPrompt(j: JobPosting) {
  const { benefits, ...rest } = j;
  return rest;
}

export const today = () => new Date().toISOString().slice(0, 10);

export const json = (v: unknown) => JSON.stringify(v, null, 1);

/** Treść CV z zastosowanymi decyzjami: zaakceptowane → fakt, odrzucone → wersja bezpieczna. */
export function applyDecisions(cv: CvVersion): CvContent {
  const resolve = <T extends { id: string; text: string; status: string; fallbackText: string }>(t: T): T | null => {
    if (t.status !== 'suggested') return t;
    const d = cv.decisions[t.id];
    if (d === 'accepted') return { ...t, status: 'fact', reason: '', fallbackText: '' };
    if (d === 'rejected') return t.fallbackText.trim() ? { ...t, text: t.fallbackText, status: 'fact', reason: '', fallbackText: '' } : null;
    return t;
  };
  const c = cv.content;
  const summary = resolve(c.summary) ?? { ...c.summary, text: '', status: 'fact' as const };
  return {
    ...c,
    summary,
    experience: c.experience.map((e) => ({ ...e, bullets: e.bullets.map(resolve).filter((b) => b !== null) })),
    projects: c.projects.map((p) => ({ ...p, bullets: p.bullets.map(resolve).filter((b) => b !== null) })),
  };
}

export const WRITING_RULES = `
ZASADY PRAWDOMÓWNOŚCI (najważniejsze):
- Każde stwierdzenie musi wynikać z profilu kandydata lub z jego odpowiedzi w "extraFacts" (has=true). W "sourceIds" podaj id pozycji profilu, z których korzystasz.
- NIE wymyślaj firm, stanowisk, dat, liczb, procentów, narzędzi, certyfikatów ani obowiązków. Jeśli w "extraFacts" kandydat odpowiedział has=false, NIE przypisuj mu tej umiejętności.
- NIE przenoś wymagań z ogłoszenia na kandydata: jeśli ogłoszenie wymaga np. "statystyki" albo "matematyki biznesowej", a profil tego nie potwierdza, nie pisz, że kandydat to zna — dotyczy to także podsumowania i umiejętności.
- NIE dopisuj szczegółów, których nie ma w profilu: jak często ("codziennie"), do czego, w jakiej skali, z kim, z jakim efektem. Przed zwróceniem odpowiedzi sprawdź każde zdanie: czy wynika z profilu? Jeśli nie — usuń je albo oznacz jako "suggested".
- Wolno przeredagować fakty językiem ogłoszenia (np. "robiłem posty na FB" → "Tworzenie i publikacja treści w social media (Facebook)").
- Gdy proponujesz sformułowanie odważniejsze niż fakty (np. szacunkowa liczba, silniejsza rola, wniosek o efekcie), ustaw status "suggested", w "reason" napisz po polsku, co jest odważniejsze i co kandydat musi potwierdzić, a w "fallbackText" podaj bezpieczną, czysto faktyczną wersję. Używaj tego oszczędnie (maks. 3–4 na CV).

ZASADY ATS:
- Używaj DOSŁOWNEGO brzmienia słów kluczowych z ogłoszenia, gdy są zgodne z prawdą (ATS dopasowuje tekst dosłownie). Skrót i pełną nazwę podaj raz razem, np. "Google Analytics 4 (GA4)".
- Nie upychaj słów kluczowych: jedno słowo maks. 2–3 razy w całym CV, zawsze w naturalnym zdaniu.
- Proste znaki: bez emoji, ikon, tabel, symboli dekoracyjnych.

ZASADY PISANIA:
- Punkty zaczynaj od czynności, schemat: co zrobiono + jak/czym + efekt (liczba tylko, jeśli jest w profilu). Maks. ~25 słów na punkt, 2–5 punktów na pozycję, najtrafniejsze na górze.
- Po polsku: jeśli w profilu kandydat pisze formami z rodzajem ("zrealizowałem"/"zrealizowałam"), zachowaj ten sam rodzaj; jeśli nie wiadomo, używaj form rzeczownikowych ("Realizacja…", "Przygotowanie…"). Nie zgaduj płci na podstawie imienia.
- Po angielsku: czasowniki w czasie przeszłym (Built, Led, Analysed), bez zaimków.
- Unikaj pustych frazesów ("kreatywny, komunikatywny, sumienny") bez dowodu w treści.
`;
