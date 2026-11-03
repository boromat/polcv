import { CareerProposalsSchema, CareerTurnSchema, OfferRankSchema, type Career, type CareerTurn, type JobLead, type Profile, type RoleProposal } from '../../../shared/schemas';
import { callJson } from '../openrouter';
import { json, profileForPrompt, today } from './common';

const TURN_SYSTEM = `Jesteś doradcą kariery na polskim rynku pracy. Prowadzisz z kandydatem (zwykle student/junior) krótką rozmowę, żeby:
1) zrozumieć, jakiej pracy szuka: stanowiska i kierunki, co go interesuje, czego nie chce;
2) pogłębić doświadczenie, które w profilu jest opisane ogólnie albo go brakuje: konkretne zadania, narzędzia, projekty, efekty, liczby - to przyda się potem w CV;
3) poznać preferencje: miasto i promień (km) dla pracy stacjonarnej/hybrydowej, czy praca zdalna z całej Polski wchodzi w grę, minimalne wynagrodzenie (brutto miesięcznie), forma umowy, wymiar etatu, poziom (staż/junior/mid).

ZASADY ROZMOWY:
- Jedno pytanie naraz (najwyżej dwa krótkie, ściśle powiązane). Krótko, życzliwie, po polsku, na "Ty".
- Nawiązuj do poprzedniej odpowiedzi kandydata i dopytuj, gdy jest ogólna.
- Formy z rodzajem: jeśli kandydat sam pisze o sobie formami z rodzajem ("zbudowałem"/"zbudowałam"), używaj tego samego rodzaju; inaczej pisz neutralnie ("co było Twoim zadaniem?"). O sobie pisz neutralnie ("zapisuję", "mam to zapisane").
- Nie pytaj o rzeczy, które już wiesz z profilu, preferencji, podsumowania lub wcześniejszej rozmowy.
- Jeśli kandydat nie odpowiedział na Twoje pytanie, tylko zmienił temat - możesz ponowić je NAJWYŻEJ RAZ. Jeśli dalej je pomija, odpuść i przejdź do kolejnego tematu.
- Pilnuj, żeby w trakcie rozmowy pokryć wszystkie trzy obszary (czego szuka, doświadczenie, preferencje) - nie utykaj na jednym.
- Nie oceniaj i nie zmyślaj. Nie obiecuj konkretnych ofert.
- Gdy rozmowa jest pusta: przywitaj się jednym zdaniem, powiedz, że zadasz kilka pytań, i zadaj pierwsze, nawiązując do profilu.

POLA ODPOWIEDZI:
- "reply": Twoja następna wiadomość do kandydata.
- "prefs": PEŁNE aktualne preferencje. Zmieniaj tylko to, co kandydat powiedział lub jednoznacznie potwierdził; resztę przepisz bez zmian z OBECNYCH PREFERENCJI. salaryMin w PLN brutto/mies. (jeśli poda netto lub stawkę godzinową - przelicz orientacyjnie i powiedz o tym).
- "newFacts": tylko NOWE, konkretne informacje o doświadczeniu/umiejętnościach z OSTATNIEJ wiadomości kandydata (bez preferencji i bez wymyślania). "topic" krótko (np. "Python - automatyzacja raportów"), "answer" - treść jego słowami, doprecyzowana. Pusta lista, jeśli nic nowego.
- "summary": 3–6 zdań aktualnego podsumowania: czego kandydat szuka, co umie, jakie ma warunki.
- "done": true, gdy wiesz już wystarczająco dużo (zwykle po 8–12 pytaniach) albo kandydat chce kończyć - wtedy "reply" to krótkie podsumowanie i zachęta do kliknięcia "Pokaż propozycje pracy". Po zakończeniu kandydat może dalej pisać - wtedy odpowiadaj normalnie.
Dzisiejsza data: ${today()}.`;

export async function careerTurn(profile: Profile, career: Career): Promise<CareerTurn> {
  const history = career.chat.slice(-30).map((m) => `${m.role === 'user' ? 'KANDYDAT' : 'DORADCA'}: ${m.content}`).join('\n\n');
  return callJson({
    schema: CareerTurnSchema,
    schemaName: 'career_turn',
    tier: 'main',
    temperature: 0.5,
    maxTokens: 3000,
    system: TURN_SYSTEM,
    user: `PROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nOBECNE PREFERENCJE:\n${json(career.prefs)}\n\nDOTYCHCZASOWE PODSUMOWANIE:\n${career.summary || '(brak)'}\n\nROZMOWA:\n${history || '(jeszcze się nie zaczęła)'}`,
    ctx: { profileId: profile.id, task: 'doradca kariery - rozmowa' },
  });
}

const PROPOSALS_SYSTEM = `Jesteś doradcą kariery na polskim rynku pracy. Na podstawie profilu kandydata, jego odpowiedzi i preferencji zaproponuj 5–8 stanowisk, na które ma REALNE szanse teraz.
Zasady:
- Mieszanka: większość "wysokie" i "średnie" dopasowanie, 1–2 "ambitne" (wymagają nadrobienia czegoś, ale są osiągalne).
- Uwzględnij stanowiska, których kandydat szuka (targetRoles), ale dodaj też pokrewne, o których mógł nie pomyśleć.
- "title": nazwa stanowiska tak, jak pojawia się w ogłoszeniach (np. "Młodszy analityk danych").
- "why": 2–3 zdania, odwołuj się do KONKRETNYCH elementów profilu (projekt, staż, narzędzie).
- "gaps": czego brakuje względem typowych wymagań (krótko, 0–4 pozycje). "howToClose": konkretnie, jak to nadrobić w kilka tygodni.
- "seniority": staż / junior / mid - zgodnie z doświadczeniem kandydata i jego preferencją.
- "keywords": 3–4 krótkie frazy (1–3 słowa), które wpisałby rekruter albo kandydat w wyszukiwarkę portalu z ofertami. Używaj nazw, które NAPRAWDĘ pojawiają się w tytułach polskich ogłoszeń: w IT zwykle po angielsku ("AI engineer", "machine learning", "python developer", "RPA developer"), poza IT po polsku ("analityk danych", "specjalista ds. marketingu"). Najpopularniejsza fraza pierwsza. Bez słów o poziomie i trybie ("junior", "stażysta", "praca", "zdalna").
- "id": r1, r2, …
- "intro": 2–3 zdania podsumowania dla kandydata.
Nie wymyślaj doświadczenia kandydata. Wszystko po polsku (poza angielską frazą w keywords).`;

export async function proposeRoles(profile: Profile, career: Career) {
  return callJson({
    schema: CareerProposalsSchema,
    schemaName: 'career_proposals',
    tier: 'main',
    temperature: 0.4,
    maxTokens: 5000,
    system: PROPOSALS_SYSTEM,
    user: `PROFIL KANDYDATA:\n${json(profileForPrompt(profile))}\n\nPREFERENCJE:\n${json(career.prefs)}\n\nPODSUMOWANIE ROZMOWY:\n${career.summary || '(brak rozmowy)'}`,
    ctx: { profileId: profile.id, task: 'doradca kariery - propozycje' },
  });
}

const RANK_SYSTEM = `Oceniasz, na ile oferty pracy pasują do kandydata (student/junior) i jakie ma szanse. Dla każdej oferty: "match" 0–100 (realna szansa + dopasowanie umiejętności i poziomu) oraz "reason" - jedno krótkie zdanie po polsku (maks. 15 słów), np. "Zgadza się SQL i Power BI, ale wymagają 2 lat doświadczenia".
Oceniaj tylko na podstawie podanych danych oferty - nie wymyślaj wymagań. Oferty dla wyraźnie bardziej doświadczonych osób oceniaj nisko. Zwróć ocenę dla KAŻDEGO "id".`;

export async function rankOffers(profile: Profile, career: Career, role: RoleProposal, leads: JobLead[]) {
  const candidate = {
    summary: career.summary,
    skills: profile.skills.map((s) => s.name),
    experience: profile.experience.map((e) => `${e.role} – ${e.company}`),
    projects: profile.projects.map((p) => `${p.name} (${p.technologies.join(', ')})`),
    education: profile.education.map((e) => `${e.degree} ${e.field}, ${e.school}`),
    languages: profile.languages.map((l) => `${l.name} ${l.level}`),
  };
  const offers = leads.map((l) => ({ id: l.id, title: l.title, company: l.company, seniority: l.seniority, skills: l.skills, workModes: l.workModes, contracts: l.contracts }));
  return callJson({
    schema: OfferRankSchema,
    schemaName: 'offer_rank',
    tier: 'fast',
    temperature: 0,
    maxTokens: 4000,
    system: RANK_SYSTEM,
    user: `KANDYDAT:\n${json(candidate)}\n\nSZUKANE STANOWISKO: ${role.title} (${role.seniority})\n\nOFERTY:\n${json(offers)}`,
    ctx: { profileId: profile.id, task: 'doradca kariery - ocena ofert' },
  });
}
