// Forma prawna nic nie wnosi do wyszukiwania opinii, a pełne "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" z ogłoszeń je psuje.
const LEGAL_FORM =
  /(?<![\p{L}\d])(sp[óo]łka\s+(z\s+ograniczon[aą]\s+odpowiedzialno[sś]ci[aą]|z\s+o\.\s*o\.?|akcyjna|komandytow[oa](-akcyjna)?|jawna|cywilna|partnerska)|sp\.\s*z\s*o\.\s*o\.?|sp\.\s*[kj]\.?|s\.\s*k\.\s*a\.?|s\.\s*[ac]\.?|sa|gmbh|ltd\.?|inc\.?|llc)(?![\p{L}\d])/giu;

/** Nazwa firmy bez formy prawnej i cudzysłowów, np. "PRZYKŁADOWA FIRMA" z "PRZYKŁADOWA FIRMA SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ". */
export function companyCore(name: string): string {
  const core = name
    .replace(LEGAL_FORM, ' ')
    .replace(/[„”“"]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.-]+|[\s,.-]+$/g, '');
  return core || name.trim();
}

/**
 * Wyszukiwanie opinii o firmie na GoWork.pl. GoWork nie ma zwykłej strony z wynikami wyszukiwania
 * (szuka przez własne, niepubliczne API), więc link prowadzi do Google z site:gowork.pl.
 * Program niczego z GoWork nie pobiera: link otwiera użytkownik.
 */
export function goworkSearchUrl(company: string): string {
  const core = companyCore(company);
  return core ? `https://www.google.com/search?q=${encodeURIComponent(`${core} site:gowork.pl`)}` : '';
}
