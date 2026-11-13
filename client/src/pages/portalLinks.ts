import type { CareerPrefs, JobLead, RoleProposal } from '../../../shared/schemas';

export const PORTAL_NAMES: Record<JobLead['portal'], string> = { pracuj: 'pracuj.pl', justjoin: 'justjoin.it', nofluff: 'nofluffjobs', smartjobs: 'Smart Jobs' };

// pracuj.pl: 1 praktykant, 3 asystent, 17 junior, 4 mid. Kod 2 ("pracownik fizyczny") jest przy każdym poziomie,
// bo tak portal oznacza oferty dla mechaników, spawaczy czy magazynierów, bez podziału na junior i mid.
const LEVELS: Record<RoleProposal['seniority'], { pracuj: string; justjoin: string; nofluff: string }> = {
  staż: { pracuj: '1,2,3', justjoin: 'junior', nofluff: 'trainee,junior' },
  junior: { pracuj: '1,2,3,17', justjoin: 'junior', nofluff: 'trainee,junior' },
  mid: { pracuj: '2,17,4', justjoin: 'mid', nofluff: 'junior,mid' },
};

/**
 * Linki do wyszukiwarek portali z frazą, miastem i poziomem - otwiera je kandydat, program niczego nie pobiera.
 * Smart Jobs nie ma w adresie filtra poziomu, a miasto podaje numerem z OpenStreetMap (zna go tylko serwer),
 * więc jego link ma frazę i tryb pracy.
 */
export function portalLinks(role: RoleProposal, prefs: CareerPrefs) {
  const phrase = role.keywords[0] || role.title;
  const q = encodeURIComponent(phrase);
  const city = prefs.city.trim();
  const local = !!city && (prefs.onsite || prefs.hybrid);
  const remoteOnly = !local && prefs.remote;
  const citySlug = city.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-');
  const lv = LEVELS[role.seniority];

  const pracuj = new URLSearchParams({ et: lv.pracuj });
  if (remoteOnly) pracuj.set('wm', 'home-office');
  if (local) pracuj.set('rd', String(prefs.radiusKm));
  const nofluff = [`keyword=${phrase}`, `seniority=${lv.nofluff}`, remoteOnly ? 'city=remote' : local ? `city=${citySlug}` : ''].filter(Boolean).join(' ');
  const smart = new URLSearchParams({ query: phrase });
  const modes = remoteOnly ? ['remote'] : local ? [prefs.onsite && 'onSite', prefs.hybrid && 'hybrid'].filter(Boolean) : [];
  if (modes.length) smart.set('workModes', modes.join(','));
  return [
    { name: 'pracuj.pl', url: `https://www.pracuj.pl/praca/${q};kw${local ? `/${encodeURIComponent(city.toLowerCase())};wp` : ''}?${pracuj}` },
    { name: 'justjoin.it', url: `https://justjoin.it/job-offers/${remoteOnly ? 'remote' : local ? citySlug : 'all-locations'}?keyword=${q}&experience-level=${lv.justjoin}` },
    { name: 'nofluffjobs', url: `https://nofluffjobs.com/pl/?criteria=${encodeURIComponent(nofluff)}` },
    { name: 'Smart Jobs', url: `https://thesmartjobs.com/pl/praca?${smart}` },
  ];
}
