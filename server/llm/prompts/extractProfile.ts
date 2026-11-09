import { ProfileExtractSchema, type Profile, type ProfileExtract } from '../../../shared/schemas';
import { callJson } from '../openrouter';
import { json, profileForPrompt, today } from './common';

const SYSTEM = `Przepisujesz CV kandydata do ustrukturyzowanego profilu.
Zasady:
- Przepisuj tylko to, co jest w tekście CV. Niczego nie dodawaj, nie oceniaj i nie upiększaj.
- Zachowaj język oryginału (CV po polsku → wartości po polsku).
- Daty zapisuj jako RRRR-MM (albo RRRR, jeśli brak miesiąca). Brak daty = pusty string. Trwające: current=true i end="".
- Osiągnięcia i obowiązki rozbij na osobne punkty w "achievements"; "description" to 1-2 zdania ogólnego opisu (albo pusty).
- Umiejętności rozbij na pojedyncze pozycje (np. "Excel", "SQL", "Praca w zespole") i przypisz kategorię: techniczne / narzędzia / miękkie / inne.
- Projekty (studenckie, własne, z kół naukowych, hackathony) zapisz w "projects", nie w "experience".
- Kursy, szkolenia i certyfikaty zapisz w "certificates" z odpowiednim "kind".
- Linki (LinkedIn, GitHub, portfolio) w contact.links z etykietą.
- Pole "id": dla nowych pozycji wpisz "new".
Dzisiejsza data: ${today()}.`;

export async function extractProfile(cvText: string, ctx: { profileId: string }): Promise<ProfileExtract> {
  return callJson({
    schema: ProfileExtractSchema,
    schemaName: 'profile',
    verbatim: true,
    tier: 'fast',
    temperature: 0,
    maxTokens: 7000,
    system: SYSTEM,
    user: `Tekst CV:\n"""\n${cvText}\n"""`,
    ctx: { ...ctx, task: 'import CV' },
  });
}

const MERGE_SYSTEM = `${SYSTEM}

Masz ISTNIEJĄCY profil (JSON) i NOWE CV tego samego kandydata. Zwróć zaktualizowany profil:
- Pozycje z istniejącego profilu, które odpowiadają tej samej rzeczy w nowym CV, zachowaj z tym samym "id" i zaktualizuj ich treść, jeśli nowe CV ma więcej lub nowsze informacje.
- Nowe pozycje z nowego CV dodaj z "id": "new".
- NIE usuwaj pozycji z istniejącego profilu, których brak w nowym CV (kandydat mógł je pominąć celowo).
- Kontakt i podsumowanie weź z nowszego CV, jeśli tam są.`;

export async function mergeProfile(existing: Profile, cvText: string, ctx: { profileId: string }): Promise<ProfileExtract> {
  const { extraFacts, ...current } = profileForPrompt(existing);
  return callJson({
    schema: ProfileExtractSchema,
    schemaName: 'profile',
    verbatim: true,
    tier: 'fast',
    temperature: 0,
    maxTokens: 7000,
    system: MERGE_SYSTEM,
    user: `ISTNIEJĄCY profil:\n${json(current)}\n\nNOWE CV:\n"""\n${cvText}\n"""`,
    ctx: { ...ctx, task: 'aktualizacja profilu z CV' },
  });
}
