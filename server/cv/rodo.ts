import type { JobPosting } from '../../shared/schemas';

export const RODO_STANDARD =
  'Wyrażam zgodę na przetwarzanie moich danych osobowych dla potrzeb niezbędnych do realizacji procesu rekrutacji zgodnie z Rozporządzeniem Parlamentu Europejskiego i Rady (UE) 2016/679 z dnia 27 kwietnia 2016 r. w sprawie ochrony osób fizycznych w związku z przetwarzaniem danych osobowych i w sprawie swobodnego przepływu takich danych oraz uchylenia dyrektywy 95/46/WE (RODO).';

export const RODO_FUTURE =
  'Wyrażam również zgodę na przetwarzanie moich danych osobowych w celu przyszłych procesów rekrutacyjnych.';

export const RODO_STANDARD_EN =
  'I hereby consent to the processing of my personal data for the purposes necessary for the recruitment process in accordance with Regulation (EU) 2016/679 of the European Parliament and of the Council of 27 April 2016 (GDPR).';

export interface RodoDecision {
  include: boolean;
  text: string;
  reason: string;
}

/** Klauzula RODO: dosłowna z ogłoszenia > standardowa (PL) > brak (oferta zagraniczna po angielsku). */
export function decideRodo(posting: Pick<JobPosting, 'rodoClause' | 'mentionsFutureRecruitment' | 'companyIsInternational'>, lang: 'pl' | 'en'): RodoDecision {
  const own = posting.rodoClause.trim();
  if (own) return { include: true, text: own, reason: 'Ogłoszenie podaje własną treść klauzuli — wklejono ją dosłownie.' };
  if (lang === 'en' && posting.companyIsInternational) {
    return { include: false, text: '', reason: 'Firma zagraniczna i CV po angielsku — klauzula RODO nie jest zwyczajowo wymagana.' };
  }
  if (lang === 'en') {
    return { include: true, text: RODO_STANDARD_EN, reason: 'Polska firma, CV po angielsku — dodano klauzulę w wersji angielskiej.' };
  }
  const text = posting.mentionsFutureRecruitment ? `${RODO_STANDARD} ${RODO_FUTURE}` : RODO_STANDARD;
  return {
    include: true,
    text,
    reason: posting.mentionsFutureRecruitment
      ? 'Standardowa klauzula + zgoda na przyszłe rekrutacje (ogłoszenie o nią prosi).'
      : 'Polska oferta bez własnej klauzuli — dodano standardową klauzulę RODO.',
  };
}

/** Zdjęcie: tylko gdy profil je ma, oferta jest polska i nie zastrzega braku zdjęcia. */
export function decidePhoto(
  posting: Pick<JobPosting, 'photoPreference' | 'companyIsInternational'>,
  lang: 'pl' | 'en',
  hasPhoto: boolean,
): { include: boolean; reason: string } {
  if (!hasPhoto) return { include: false, reason: 'Profil nie ma zdjęcia.' };
  if (posting.photoPreference === 'unwanted') return { include: false, reason: 'Ogłoszenie prosi o CV bez zdjęcia.' };
  if (posting.photoPreference === 'wanted') return { include: true, reason: 'Ogłoszenie prosi o zdjęcie.' };
  if (lang === 'en' || posting.companyIsInternational) {
    return { include: false, reason: 'Oferta zagraniczna/anglojęzyczna — tam CV zwykle są bez zdjęcia.' };
  }
  return { include: true, reason: 'Polska oferta — zdjęcie jest tu zwyczajowe.' };
}

/** Język CV: wymóg z ogłoszenia, a jeśli go nie ma — język ogłoszenia. */
export function decideLanguage(posting: Pick<JobPosting, 'cvLanguageRequired' | 'language'>): 'pl' | 'en' {
  if (posting.cvLanguageRequired !== 'any') return posting.cvLanguageRequired;
  return posting.language;
}
