import type { Career, JobLead, RoleProposal } from '../../../shared/schemas';

/** Ta sama oferta mimo innych parametrów w linku (np. śledzących) albo ukośnika na końcu. */
export const offerKey = (url: string) => {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).toLowerCase().replace(/\/+$/, '');
  } catch {
    return url.trim().toLowerCase();
  }
};

export interface TopOffer {
  lead: JobLead;
  /** Stanowisko, przy którym oferta dostała tę ocenę. */
  role: RoleProposal;
}

/** Ta sama oferta (tytuł i firma - jak przy duplikatach na serwerze) znaleziona dla kilku stanowisk albo na dwóch portalach. */
const sameOffer = (l: JobLead) => [l.title, l.company].map((s) => s.toLowerCase().split(/\s+/).filter(Boolean).join(' ')).join('|');

/**
 * Najwyżej ocenione przez AI oferty ze wszystkich stanowisk: tylko te, które przeszły filtry preferencji
 * i mają ocenę co najmniej `minMatch`. Oferta znaleziona dla kilku stanowisk liczy się raz, z najwyższą oceną.
 */
export function topOffers(roles: RoleProposal[], offers: Career['offers'], n: number, minMatch: number): TopOffer[] {
  const best = new Map<string, TopOffer & { match: number }>();
  for (const role of roles) {
    for (const lead of offers[role.id]?.items ?? []) {
      if (lead.match == null || lead.match < minMatch) continue;
      const key = sameOffer(lead);
      const prev = best.get(key);
      if (!prev || lead.match > prev.match) best.set(key, { lead, role, match: lead.match });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.match - a.match || b.lead.publishedAt.localeCompare(a.lead.publishedAt))
    .slice(0, n)
    .map(({ lead, role }) => ({ lead, role }));
}
