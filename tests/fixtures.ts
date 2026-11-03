import type { CvVersion, JobPosting, Profile } from '../shared/schemas';

// Fikcyjna osoba i ogłoszenie - tylko do testów.

export const profile: Profile = {
  id: 'testprofile',
  displayName: 'Test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  apiKey: '',
  photo: '',
  files: [],
  contact: {
    fullName: 'Zofia Żółkiewska',
    email: 'zofia.zolkiewska@example.com',
    phone: '+48 600 100 200',
    location: 'Kraków',
    links: [{ label: 'LinkedIn', url: 'https://www.linkedin.com/in/zofia-test' }],
  },
  headline: 'Studentka marketingu',
  summary: '',
  experience: [
    {
      id: 'exp1', kind: 'staż', role: 'Stażystka ds. marketingu', company: 'Firma Testowa Sp. z o.o.', location: 'Kraków',
      start: '2025-07', end: '2025-09', current: false, description: '',
      achievements: ['Prowadziłam profil firmy na Instagramie', 'Przygotowywałam raporty w Google Analytics 4'],
    },
  ],
  education: [
    { id: 'edu1', school: 'Uniwersytet Ekonomiczny w Krakowie', degree: 'licencjat', field: 'Marketing i komunikacja rynkowa', start: '2023-10', end: '', current: true, details: '' },
  ],
  projects: [],
  skills: [
    { id: 's1', name: 'Google Analytics 4', category: 'narzędzia', level: '' },
    { id: 's2', name: 'Canva', category: 'narzędzia', level: '' },
    { id: 's3', name: 'MS Excel', category: 'narzędzia', level: '' },
  ],
  languages: [{ id: 'l1', name: 'Angielski', level: 'B2' }],
  certificates: [],
  interests: [],
  extraFacts: [],
};

export const posting: JobPosting = {
  title: 'Młodszy Specjalista ds. Marketingu',
  company: 'Przykład S.A.',
  location: 'Kraków',
  workMode: 'hybrydowo',
  seniority: 'junior',
  industry: 'marketing',
  language: 'pl',
  cvLanguageRequired: 'any',
  companyIsInternational: false,
  summary: '',
  responsibilities: [],
  requirementsMust: [],
  requirementsNice: [],
  benefits: [],
  keywords: [
    { term: 'Google Analytics', synonyms: ['GA4', 'Google Analytics 4'], importance: 'must', category: 'narzędzie' },
    { term: 'social media', synonyms: ['media społecznościowe', 'Instagram'], importance: 'must', category: 'umiejętność' },
    { term: 'Excel', synonyms: ['MS Excel'], importance: 'nice', category: 'narzędzie' },
    { term: 'Google Ads', synonyms: ['AdWords'], importance: 'nice', category: 'narzędzie' },
  ],
  rodoClause: '',
  mentionsFutureRecruitment: false,
  photoPreference: 'unspecified',
  coverLetterRequired: false,
  applicationNotes: '',
};

export const cv: CvVersion = {
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  origin: 'generated',
  template: 'modern',
  photo: false,
  photoReason: '',
  rodo: { include: true, text: 'Wyrażam zgodę na przetwarzanie moich danych osobowych (RODO).', reason: '' },
  decisions: {},
  content: {
    language: 'pl',
    headline: 'Młodszy Specjalista ds. Marketingu',
    summary: { id: 'sum', text: 'Studentka marketingu z doświadczeniem w social media i analityce Google Analytics 4 (GA4). Zażółć gęślą jaźń.', status: 'fact', reason: '', fallbackText: '', sourceIds: ['exp1'] },
    sectionOrder: ['summary', 'experience', 'education', 'skills', 'languages'],
    experience: [
      {
        sourceId: 'exp1', role: 'Stażystka ds. marketingu', company: 'Firma Testowa Sp. z o.o.', location: 'Kraków', dates: '07.2025 – 09.2025',
        bullets: [
          { id: 'b1', text: 'Prowadzenie profilu firmy na Instagramie (social media)', status: 'fact', reason: '', fallbackText: '', sourceIds: ['exp1'] },
          { id: 'b2', text: 'Zwiększenie zasięgu profilu o ok. 30%', status: 'suggested', reason: 'Liczba szacunkowa', fallbackText: 'Rozwijanie zasięgu profilu', sourceIds: ['exp1'] },
        ],
      },
    ],
    projects: [],
    education: [{ sourceId: 'edu1', school: 'Uniwersytet Ekonomiczny w Krakowie', degree: 'Licencjat', field: 'Marketing i komunikacja rynkowa', dates: '10.2023 – obecnie', details: '' }],
    skills: [{ category: 'Narzędzia', items: ['Google Analytics 4', 'Canva', 'MS Excel'] }],
    certificates: [],
    languages: [{ name: 'Angielski', level: 'B2' }],
    interests: [],
    notes: '',
  },
};
