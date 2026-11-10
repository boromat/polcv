import type { Profile } from '../../shared/schemas';

// Atrapa modelu do CI i do sprawdzenia skryptu bez płatnego API: odpowiada jak OpenRouter, a CV składa z profilu,
// który dostaje w prompcie. Nie ocenia jakości modelu - sprawdza tylko, że cała ścieżka i metryki działają.

export interface MockOptions {
  /** imiona i nazwiska kandydatów, dla których pierwsza odpowiedź ma pozycję spoza profilu (do sprawdzenia podejść) */
  invalidFirst?: string[];
  /** umiejętności spoza profilu dopisane tylko w pierwszej odpowiedzi (kontrola ma je odrzucić) */
  extraSkillsFirst?: Record<string, string[]>;
  /** dodatkowy punkt w pierwszej pozycji doświadczenia, w każdej odpowiedzi (do sprawdzenia zakazanych faktów) */
  extraBullet?: Record<string, string>;
}

type PromptProfile = Omit<Profile, 'id' | 'displayName' | 'apiKey' | 'files' | 'photo' | 'createdAt' | 'updatedAt'>;

const between = (text: string, start: string, end: string): string | null => {
  const i = text.indexOf(start);
  if (i < 0) return null;
  const j = text.indexOf(end, i + start.length);
  return text.slice(i + start.length, j < 0 ? undefined : j);
};

const bullet = (id: string, text: string, sourceIds: string[]) => ({ id, text, status: 'fact', reason: '', fallbackText: '', sourceIds });

function mockCv(p: PromptProfile, lang: 'pl' | 'en', opts: MockOptions, first: boolean) {
  const pl = lang === 'pl';
  const name = p.contact.fullName;
  const invalid = first && (opts.invalidFirst ?? []).includes(name);
  const extra = first ? (opts.extraSkillsFirst?.[name] ?? []) : [];
  const extraBullet = opts.extraBullet?.[name];
  return {
    language: lang,
    headline: p.headline || (pl ? 'Kandydat' : 'Candidate'),
    summary: bullet('s1', pl ? 'Szukam pracy, w której wykorzystam swoje doświadczenie.' : 'Candidate looking for a role that builds on their experience.', []),
    sectionOrder: ['summary', 'experience', 'projects', 'education', 'skills', 'languages'],
    experience: [
      ...p.experience.map((e, i) => ({
        sourceId: e.id,
        role: e.role,
        company: e.company,
        location: e.location,
        dates: '',
        bullets: [
          bullet(`e${i}`, pl ? 'Realizacja bieżących zadań na stanowisku' : 'Handled day-to-day tasks in the role', [e.id]),
          // Liczba, której nie ma w profilu: groundCv ma ją zamienić w żółtą sugestię.
          ...(i === 0 ? [bullet('n1', pl ? 'Obsługa 937 zamówień dziennie' : 'Handled 937 orders a day', [e.id])] : []),
          ...(i === 0 && extraBullet ? [bullet('x1', extraBullet, [e.id])] : []),
        ],
      })),
      ...(invalid ? [{ sourceId: 'zmyslona-firma', role: pl ? 'Kierownik' : 'Manager', company: 'Nieistniejąca Firma', location: '', dates: '', bullets: [] }] : []),
    ],
    projects: p.projects.map((x) => ({ sourceId: x.id, name: x.name, role: x.role, dates: '', technologies: x.technologies.slice(0, 4), link: x.link, bullets: [] })),
    education: p.education.map((e) => ({ sourceId: e.id, school: e.school, degree: e.degree, field: e.field, dates: '', details: '' })),
    skills: [{ category: pl ? 'Umiejętności' : 'Skills', items: [...p.skills.slice(0, 8).map((s) => s.name), ...extra] }],
    certificates: [],
    languages: p.languages.map((l) => ({ name: l.name, level: l.level })),
    interests: [],
    notes: '',
  };
}

function mockPosting(text: string) {
  const title = text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('Treść') && !l.startsWith('"""')) ?? 'Stanowisko';
  return {
    title,
    company: '',
    location: '',
    workMode: 'brak informacji',
    seniority: 'junior',
    industry: '',
    language: /[ąćęłńóśźż]/i.test(text) ? 'pl' : 'en',
    cvLanguageRequired: 'any',
    companyIsInternational: false,
    summary: '',
    responsibilities: [],
    requirementsMust: [],
    requirementsNice: [],
    benefits: [],
    keywords: [],
    rodoClause: '',
    mentionsFutureRecruitment: false,
    photoPreference: 'unspecified',
    coverLetterRequired: false,
    applicationNotes: '',
  };
}

/** fetch odpowiadający jak OpenRouter: lista modeli niedostępna (404), czat zwraca JSON zgodny ze schematem zadania. */
export function mockFetch(opts: MockOptions = {}): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.endsWith('/chat/completions') || !init?.body) return new Response('{}', { status: 404 });
    const body = JSON.parse(String(init.body));
    const messages: { role: string; content: string }[] = body.messages;
    const system = messages[0].content;
    const user = messages[1].content;
    const name: string = body.response_format?.json_schema?.name ?? '';
    let content: unknown;
    if (name === 'job_posting') content = mockPosting(user);
    else if (system.includes('SKRACANIE DO JEDNEJ STRONY')) content = JSON.parse(between(user, 'OBECNE CV:\n', '\n\n') ?? '{}');
    else {
      const profile = JSON.parse(between(user, 'PROFIL KANDYDATA:\n', '\n\nNapisz CV') ?? '{}') as PromptProfile;
      const lang = /language="en"/.test(user) ? 'en' : 'pl';
      // Pierwsza próba to ta bez prośby o poprawkę.
      content = mockCv(profile, lang, opts, messages.length === 2);
    }
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }],
        usage: { cost: 0.001, prompt_tokens: 1000, completion_tokens: 500 },
      }),
    );
  }) as typeof fetch;
}
