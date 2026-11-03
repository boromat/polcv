import { z } from 'zod';

// Schematy LLM mają wszystkie pola wymagane (bez .optional()), bo tryb "strict"
// structured outputs wymaga pełnej listy `required`. Brak wartości = '' lub [].

// ---------- Profil kandydata ----------

export const LinkSchema = z.object({ label: z.string(), url: z.string() });

export const ExperienceSchema = z.object({
  id: z.string(),
  kind: z.enum(['praca', 'staż', 'praktyki', 'wolontariat', 'freelance', 'inne']),
  role: z.string(),
  company: z.string(),
  location: z.string(),
  start: z.string().describe('RRRR-MM albo RRRR, pusty jeśli brak'),
  end: z.string().describe('RRRR-MM albo RRRR, pusty jeśli trwa lub brak'),
  current: z.boolean(),
  description: z.string(),
  achievements: z.array(z.string()),
});

export const EducationSchema = z.object({
  id: z.string(),
  school: z.string(),
  degree: z.string().describe('np. licencjat, inżynier, magister, technikum, liceum'),
  field: z.string(),
  start: z.string(),
  end: z.string(),
  current: z.boolean(),
  details: z.string().describe('średnia, praca dyplomowa, koła naukowe, ważne przedmioty'),
});

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  start: z.string(),
  end: z.string(),
  description: z.string(),
  technologies: z.array(z.string()),
  link: z.string(),
  achievements: z.array(z.string()),
});

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['techniczne', 'narzędzia', 'miękkie', 'inne']),
  level: z.string().describe('np. podstawowy, średni, zaawansowany; pusty jeśli nieznany'),
});

export const LanguageSchema = z.object({
  id: z.string(),
  name: z.string(),
  level: z.string().describe('np. B2, C1, ojczysty'),
});

export const CertificateSchema = z.object({
  id: z.string(),
  kind: z.enum(['certyfikat', 'kurs', 'szkolenie']),
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
});

export const ExtraFactSchema = z.object({
  id: z.string(),
  topic: z.string(),
  has: z.boolean(),
  answer: z.string(),
  source: z.string(),
  date: z.string(),
});

export const ContactSchema = z.object({
  fullName: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  links: z.array(LinkSchema),
});

/** Część profilu, którą AI wyciąga z CV. */
export const ProfileExtractSchema = z.object({
  contact: ContactSchema,
  headline: z.string(),
  summary: z.string(),
  experience: z.array(ExperienceSchema),
  education: z.array(EducationSchema),
  projects: z.array(ProjectSchema),
  skills: z.array(SkillSchema),
  languages: z.array(LanguageSchema),
  certificates: z.array(CertificateSchema),
  interests: z.array(z.string()),
});

export const ProfileSchema = ProfileExtractSchema.extend({
  id: z.string(),
  displayName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  apiKey: z.string(),
  photo: z.string(),
  files: z.array(z.object({ name: z.string(), original: z.string(), uploadedAt: z.string() })),
  extraFacts: z.array(ExtraFactSchema),
});

// ---------- Ogłoszenie ----------

export const KeywordSchema = z.object({
  term: z.string().describe('dokładne brzmienie z ogłoszenia'),
  synonyms: z.array(z.string()).describe('skróty, pełne nazwy, wersje PL/EN'),
  importance: z.enum(['must', 'nice']),
  category: z.enum(['umiejętność', 'narzędzie', 'kompetencja miękka', 'język', 'wykształcenie', 'certyfikat', 'inne']),
});

export const JobPostingSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  workMode: z.string().describe('zdalnie / hybrydowo / stacjonarnie / brak informacji'),
  seniority: z.string(),
  industry: z.string(),
  language: z.enum(['pl', 'en']).describe('język, w którym napisano ogłoszenie'),
  cvLanguageRequired: z.enum(['pl', 'en', 'any']),
  companyIsInternational: z.boolean().describe('czy rekrutuje firma zagraniczna lub w pełni anglojęzyczna'),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  requirementsMust: z.array(z.string()),
  requirementsNice: z.array(z.string()),
  benefits: z.array(z.string()),
  keywords: z.array(KeywordSchema),
  rodoClause: z.string().describe('dosłowna treść klauzuli do wpisania w CV, jeśli ogłoszenie ją podaje; inaczej pusty'),
  mentionsFutureRecruitment: z.boolean(),
  photoPreference: z.enum(['wanted', 'unwanted', 'unspecified']),
  coverLetterRequired: z.boolean(),
  applicationNotes: z.string().describe('inne instrukcje dla kandydata, np. co wpisać w tytule maila'),
});

// ---------- Pytania o braki ----------

export const GapQuestionSchema = z.object({
  id: z.string(),
  requirement: z.string(),
  importance: z.enum(['must', 'nice']),
  question: z.string(),
  hint: z.string().describe('podpowiedź, co warto napisać w odpowiedzi'),
});

export const GapAnalysisSchema = z.object({
  covered: z.array(z.string()).describe('wymagania potwierdzone w profilu'),
  questions: z.array(GapQuestionSchema),
});

export const GapAnswerSchema = z.object({
  questionId: z.string(),
  requirement: z.string(),
  question: z.string(),
  has: z.boolean(),
  answer: z.string(),
});

// ---------- CV ----------

export const CvTextSchema = z.object({
  id: z.string(),
  text: z.string(),
  status: z.enum(['fact', 'suggested']),
  reason: z.string().describe('dla suggested: co jest odważniejsze i co kandydat musi potwierdzić; dla fact pusty'),
  fallbackText: z.string().describe('dla suggested: bezpieczna, w pełni faktyczna wersja; dla fact pusty'),
  sourceIds: z.array(z.string()),
});

export const SectionKeys = ['summary', 'experience', 'projects', 'education', 'skills', 'certificates', 'languages', 'interests'] as const;

export const CvContentSchema = z.object({
  language: z.enum(['pl', 'en']),
  headline: z.string(),
  summary: CvTextSchema,
  sectionOrder: z.array(z.enum(SectionKeys)),
  experience: z.array(z.object({
    sourceId: z.string(),
    role: z.string(),
    company: z.string(),
    location: z.string(),
    dates: z.string(),
    bullets: z.array(CvTextSchema),
  })),
  projects: z.array(z.object({
    sourceId: z.string(),
    name: z.string(),
    role: z.string(),
    dates: z.string(),
    technologies: z.array(z.string()),
    link: z.string(),
    bullets: z.array(CvTextSchema),
  })),
  education: z.array(z.object({
    sourceId: z.string(),
    school: z.string(),
    degree: z.string(),
    field: z.string(),
    dates: z.string(),
    details: z.string(),
  })),
  skills: z.array(z.object({ category: z.string(), items: z.array(z.string()) })),
  certificates: z.array(z.object({ name: z.string(), issuer: z.string(), date: z.string() })),
  languages: z.array(z.object({ name: z.string(), level: z.string() })),
  interests: z.array(z.string()),
  notes: z.string().describe('krótka notatka dla kandydata: co podkreślono, czego brakuje'),
});

export const TemplateIds = ['classic', 'modern', 'compact'] as const;
export type TemplateId = (typeof TemplateIds)[number];

export const CvVersionSchema = z.object({
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  origin: z.enum(['generated', 'improved']),
  content: CvContentSchema,
  decisions: z.record(z.string(), z.enum(['accepted', 'rejected'])),
  template: z.enum(TemplateIds),
  photo: z.boolean(),
  photoReason: z.string(),
  rodo: z.object({ include: z.boolean(), text: z.string(), reason: z.string() }),
});

// ---------- Ocena ATS / AI ----------

export const AiCriterionKeys = ['must_have_match', 'achievements', 'summary_fit', 'clarity', 'red_flags'] as const;

export const AiReviewSchema = z.object({
  criteria: z.array(z.object({
    key: z.enum(AiCriterionKeys),
    score: z.number().describe('0-10'),
    comment: z.string(),
  })),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  fixes: z.array(z.object({
    section: z.string(),
    find: z.string().describe('dokładny fragment z CV do zmiany albo pusty, jeśli to dopisanie'),
    replace: z.string(),
    why: z.string(),
    needsUserInput: z.boolean().describe('true, jeśli poprawka wymaga informacji, których nie ma w CV'),
  })),
  wouldInterview: z.enum(['tak', 'raczej tak', 'raczej nie', 'nie']),
  verdict: z.string(),
});

export const KeywordWhereKeys = ['summary', 'experience', 'projects', 'education', 'certificates', 'languages', 'skills', 'headline', 'technologies', 'interests'] as const;

export const AtsReportSchema = z.object({
  createdAt: z.string(),
  version: z.number(),
  /** null = ocena niepełna (bez części AI); same słowa kluczowe i format nie dają wyniku łącznego */
  total: z.number().nullable(),
  keywords: z.object({
    score: z.number(),
    max: z.number(),
    matched: z.array(z.object({
      term: z.string(),
      importance: z.enum(['must', 'nice']),
      foundAs: z.string(),
      count: z.number(),
      /** sekcje CV, w których słowo występuje (brak w starszych raportach) */
      where: z.array(z.enum(KeywordWhereKeys)).optional(),
      /** 1 = pełne punkty, 0.5 = tylko na liście, 0 = kompetencja miękka bez przykładu (brak w starszych raportach = 1) */
      credit: z.number().optional(),
    })),
    missing: z.array(z.object({ term: z.string(), importance: z.enum(['must', 'nice']) })),
    stuffing: z.array(z.string()),
  }),
  format: z.object({
    score: z.number(),
    max: z.number(),
    pages: z.number(),
    checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string(), weight: z.number() })),
  }),
  ai: z.object({ score: z.number(), max: z.number(), review: AiReviewSchema }).nullable(),
  aiError: z.string(),
});

// ---------- Dodatki ----------

export const InterviewPrepSchema = z.object({
  overview: z.string(),
  questions: z.array(z.object({
    category: z.enum(['techniczne', 'behawioralne', 'o doświadczenie', 'motywacja i firma', 'trudne']),
    question: z.string(),
    whyAsked: z.string(),
    suggestedAnswer: z.string(),
    tips: z.string(),
  })),
  questionsToAsk: z.array(z.string()),
  topicsToReview: z.array(z.object({ topic: z.string(), why: z.string(), howToPrepare: z.string() })),
  weakSpots: z.array(z.object({ issue: z.string(), howToAddress: z.string() })),
});

export const CoverLetterSchema = z.object({
  language: z.enum(['pl', 'en']),
  greeting: z.string(),
  paragraphs: z.array(z.string()),
  closing: z.string(),
});

// ---------- Aplikacja ----------

export const ApplicationStatuses = ['szkic', 'przygotowane', 'wysłane', 'rozmowa', 'odrzucone', 'oferta'] as const;

export const ApplicationSchema = z.object({
  id: z.string(),
  profileId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  url: z.string(),
  rawText: z.string(),
  fetchMethod: z.string(),
  posting: JobPostingSchema.nullable(),
  gap: z.object({ questions: z.array(GapQuestionSchema), covered: z.array(z.string()), answers: z.array(GapAnswerSchema) }).nullable(),
  status: z.enum(ApplicationStatuses),
  notes: z.string(),
  currentVersion: z.number(),
  pdfFile: z.string(),
  hasInterviewPrep: z.boolean(),
  hasCoverLetter: z.boolean(),
});

export const SettingsSchema = z.object({
  apiKey: z.string(),
  mainModel: z.string(),
  fastModel: z.string(),
  /** Automatyczne wyszukiwanie ofert na portalach - wyłączone, dopóki użytkownik świadomie go nie włączy. */
  jobSearch: z.boolean(),
  /** Maskowanie danych osobowych przez polanon (opcjonalny pakiet Pythona) przed wysłaniem do AI. */
  maskPii: z.boolean(),
  /** polanon z modelem spaCy: rozpoznaje też miejsca i nazwy, których nie łapią reguły. */
  maskPiiNer: z.boolean(),
  /** Ścieżka do Pythona z polanonem; pusta = wykryj automatycznie. */
  pythonPath: z.string(),
});

export const UsageEntrySchema = z.object({
  at: z.string(),
  profileId: z.string(),
  applicationId: z.string(),
  task: z.string(),
  model: z.string(),
  cost: z.number(),
  tokensIn: z.number(),
  tokensOut: z.number(),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileExtract = z.infer<typeof ProfileExtractSchema>;
export type ExtraFact = z.infer<typeof ExtraFactSchema>;
export type JobPosting = z.infer<typeof JobPostingSchema>;
export type Keyword = z.infer<typeof KeywordSchema>;
export type GapQuestion = z.infer<typeof GapQuestionSchema>;
export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;
export type GapAnswer = z.infer<typeof GapAnswerSchema>;
export type CvText = z.infer<typeof CvTextSchema>;
export type CvContent = z.infer<typeof CvContentSchema>;
export type CvVersion = z.infer<typeof CvVersionSchema>;
export type SectionKey = (typeof SectionKeys)[number];
export type AiReview = z.infer<typeof AiReviewSchema>;
export type AtsReport = z.infer<typeof AtsReportSchema>;
export type InterviewPrep = z.infer<typeof InterviewPrepSchema>;
export type CoverLetter = z.infer<typeof CoverLetterSchema>;
export type Application = z.infer<typeof ApplicationSchema>;
export type ApplicationStatus = (typeof ApplicationStatuses)[number];
export type Settings = z.infer<typeof SettingsSchema>;
export type UsageEntry = z.infer<typeof UsageEntrySchema>;

/** Wpis historii z dołączonym kosztem i wynikiem - zwracany przez /api/applications. */
export type ApplicationSummary = Application & { costUsd: number; score: number | null; scoreIncomplete: boolean };

/** Wynik "Popraw automatycznie" - zwracany przez /improve. */
export interface ImproveResult {
  /** 'new' = nowa wersja jest bieżąca; 'old' = wyszła gorzej, bieżąca została poprzednia; 'none' = nie było czego poprawić bez nowych informacji */
  kept: 'new' | 'old' | 'none';
  /** numer nowej wersji (zapisanej także przy 'old'); null przy 'none' */
  version: number | null;
  /** świeży wynik wersji sprzed poprawy i wynik nowej; null = ocena niepełna albo brak nowej wersji */
  before: number | null;
  after: number | null;
  /** co kandydat może dopisać w profilu, żeby podnieść wynik (w języku interfejsu) */
  needsInput: string[];
  /** komunikat przy 'none' */
  message: string;
}

/** Wynik "Dodaj projekty z GitHuba" - zwracany przez /github. Profil jest już zapisany. */
export interface GithubImportResult {
  profile: Profile;
  /** nazwy dopisanych projektów i umiejętności (puste = nic nowego) */
  added: { projects: string[]; skills: string[] };
  /** id nowych pozycji, do wyróżnienia w formularzu */
  newIds: string[];
}

// ---------- Doradca kariery ----------

export const ContractTypes = ['umowa o pracę', 'umowa zlecenie', 'B2B', 'staż / praktyki'] as const;
export const WorkTimes = ['pełny etat', 'część etatu', 'dowolny'] as const;
export const Seniorities = ['staż', 'junior', 'mid', 'dowolny'] as const;

export const CareerPrefsSchema = z.object({
  targetRoles: z.array(z.string()).describe('stanowiska/kierunki, których kandydat szuka'),
  city: z.string().describe('miasto bazowe dla pracy stacjonarnej i hybrydowej'),
  radiusKm: z.number().describe('promień od miasta dla pracy stacjonarnej i hybrydowej, w km'),
  onsite: z.boolean(),
  hybrid: z.boolean(),
  remote: z.boolean().describe('praca zdalna z całej Polski'),
  salaryMin: z.number().describe('minimalne wynagrodzenie brutto miesięcznie w PLN; 0 = brak wymagań'),
  contracts: z.array(z.enum(ContractTypes)).describe('akceptowane formy umowy; pusta lista = dowolna'),
  workTime: z.enum(WorkTimes),
  seniority: z.enum(Seniorities),
  notes: z.string().describe('inne oczekiwania, np. czego kandydat nie chce'),
});

/** Odpowiedź AI w jednej turze rozmowy. */
export const CareerTurnSchema = z.object({
  reply: z.string(),
  done: z.boolean(),
  prefs: CareerPrefsSchema,
  newFacts: z.array(z.object({ topic: z.string(), answer: z.string() })),
  summary: z.string(),
});

export const RoleProposalSchema = z.object({
  id: z.string(),
  title: z.string(),
  fit: z.enum(['wysokie', 'średnie', 'ambitne']),
  seniority: z.enum(['staż', 'junior', 'mid']),
  why: z.string(),
  gaps: z.array(z.string()),
  howToClose: z.string(),
  keywords: z.array(z.string()).describe('3–4 krótkie frazy do wyszukiwarki ofert'),
});

export const CareerProposalsSchema = z.object({ intro: z.string(), roles: z.array(RoleProposalSchema) });

export const Portals = ['pracuj', 'justjoin', 'nofluff'] as const;

export const JobLeadSchema = z.object({
  id: z.string(),
  portal: z.enum(Portals),
  title: z.string(),
  company: z.string(),
  location: z.string(),
  workModes: z.array(z.string()),
  workTime: z.string(),
  salary: z.string(),
  salaryMonthly: z.number().nullable(),
  contracts: z.array(z.string()),
  seniority: z.string(),
  skills: z.array(z.string()),
  url: z.string(),
  publishedAt: z.string(),
  match: z.number().nullable(),
  matchReason: z.string(),
  /** Dlaczego oferta nie przeszła filtrów preferencji (np. "tylko B2B"); pusty = przeszła. */
  excludedBy: z.string().default(''),
});

export const OfferRankSchema = z.object({
  ranked: z.array(z.object({ id: z.string(), match: z.number(), reason: z.string() })),
});

export const CareerSchema = z.object({
  prefs: CareerPrefsSchema,
  chat: z.array(z.object({ role: z.enum(['assistant', 'user']), content: z.string(), at: z.string() })),
  summary: z.string(),
  done: z.boolean(),
  proposals: z.object({ createdAt: z.string(), intro: z.string(), roles: z.array(RoleProposalSchema) }).nullable(),
  offers: z.record(
    z.string(),
    z.object({
      fetchedAt: z.string(),
      items: z.array(JobLeadSchema),
      /** Oferty odrzucone tylko przez umowę/wynagrodzenie/etat - do pokazania na życzenie. */
      excluded: z.array(JobLeadSchema).default([]),
      /** Ile ofert odpadło z jakiego powodu. */
      stats: z.record(z.string(), z.number()).default({}),
      errors: z.array(z.string()),
      scanned: z.number(),
    }),
  ),
});

export type CareerPrefs = z.infer<typeof CareerPrefsSchema>;
export type CareerTurn = z.infer<typeof CareerTurnSchema>;
export type RoleProposal = z.infer<typeof RoleProposalSchema>;
export type JobLead = z.infer<typeof JobLeadSchema>;
export type Career = z.infer<typeof CareerSchema>;
