import * as cheerio from 'cheerio';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { HttpError } from '../storage/store';
import { withPage } from '../cv/browser';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const MAX_CHARS = 18_000;
const MIN_USEFUL = 600;

export interface FetchedPosting {
  text: string;
  method: string;
}

const BLOCK_TAGS = 'p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,section,article,header,footer,tr,table,br,dd,dt';

/** HTML → tekst z zachowanymi akapitami i punktorami (ważne dla AI). */
export function htmlToText(html: string): string {
  const $ = cheerio.load(`<div id="__root">${html}</div>`);
  $('script,style,noscript,svg,iframe,button,form,nav').remove();
  $('li').each((_, el) => {
    $(el).prepend('• ');
  });
  $(BLOCK_TAGS).each((_, el) => {
    $(el).append('\n');
  });
  return $('#__root')
    .text()
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const asText = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return /<[a-z][\s\S]*>/i.test(v) ? htmlToText(v) : v.trim();
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('value' in o) return asText(o.value) + (o.type ? ` (${o.type})` : '');
    if ('name' in o) return asText(o.name);
    if ('description' in o) return asText(o.description);
    return Object.entries(o)
      .filter(([k]) => !k.startsWith('@'))
      .map(([, x]) => asText(x))
      .filter(Boolean)
      .join(', ');
  }
  return String(v);
};

function findJobPostings(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) node.forEach((n) => findJobPostings(n, out));
  else if (node && typeof node === 'object') {
    const o = node as Record<string, unknown>;
    const t = o['@type'];
    if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) out.push(o);
    if (o['@graph']) findJobPostings(o['@graph'], out);
  }
  return out;
}

/** Dane JobPosting ze schema.org - pracuj.pl, justjoin.it i nofluffjobs je publikują. */
export function jsonLdToText(html: string): string {
  const $ = cheerio.load(html);
  const postings: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      findJobPostings(JSON.parse($(el).text()), postings);
    } catch {
      /* uszkodzony JSON-LD pomijamy */
    }
  });
  const jp = postings[0];
  if (!jp) return '';
  const fields: [string, unknown][] = [
    ['Stanowisko', jp.title],
    ['Firma', (jp.hiringOrganization as any)?.name ?? jp.hiringOrganization],
    ['Lokalizacja', jp.jobLocation],
    ['Tryb pracy', jp.jobLocationType],
    ['Forma zatrudnienia', jp.employmentType],
    ['Branża', jp.industry],
    ['Poziom', jp.experienceRequirements],
    ['O firmie', jp.employerOverview],
    ['Opis', jp.description],
    ['Obowiązki', jp.responsibilities],
    ['Kwalifikacje', jp.qualifications],
    ['Umiejętności', jp.skills],
    ['Benefity', jp.jobBenefits],
  ];
  return fields
    .map(([label, v]) => [label, asText(v)] as const)
    .filter(([, v]) => v)
    .map(([label, v]) => `${label}: ${v}`)
    .join('\n\n');
}

export function readableText(html: string): string {
  try {
    const { document } = parseHTML(html);
    const article = new Readability(document as any).parse();
    if (article?.content) return htmlToText(article.content);
  } catch {
    /* przechodzimy do prostego ekstraktu */
  }
  const $ = cheerio.load(html);
  return htmlToText($('main').html() || $('body').html() || '');
}

function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const head = html.slice(0, 20_000).toLowerCase();
  return /just a moment|attention required|access denied|cf-chl-|verify you are human|enable javascript and cookies/.test(head);
}

/** Łączy dane strukturalne z treścią strony (klauzula RODO bywa tylko w treści). */
function combine(html: string): string {
  const ld = jsonLdToText(html);
  const body = readableText(html);
  const parts = [ld && `=== Dane ogłoszenia (JSON-LD) ===\n${ld}`, body && `=== Treść strony ===\n${body}`].filter(Boolean);
  return parts.join('\n\n').slice(0, MAX_CHARS);
}

export async function fetchPosting(rawUrl: string): Promise<FetchedPosting> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new HttpError(400, 'To nie wygląda na poprawny link (powinien zaczynać się od https://).');
  }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'Obsługiwane są tylko linki http(s).');

  // 1–2. Zwykłe pobranie: JSON-LD + główna treść.
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8', Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    if (res.ok && !looksBlocked(res.status, html)) {
      const text = combine(html);
      if (text.length >= MIN_USEFUL) return { text, method: jsonLdToText(html) ? 'json-ld' : 'html' };
    }
  } catch {
    /* spróbujemy przeglądarką */
  }

  // 3. Strony renderowane JavaScriptem - prawdziwa przeglądarka (bez obchodzenia zabezpieczeń).
  try {
    const html = await withPage(async (page) => {
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'pl-PL,pl;q=0.9' });
      const resp = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
      const content = await page.content();
      return looksBlocked(resp?.status() ?? 200, content) ? '' : content;
    });
    const text = html ? combine(html) : '';
    if (text.length >= MIN_USEFUL) return { text, method: 'browser' };
  } catch {
    /* koniec możliwości */
  }

  throw new HttpError(
    422,
    'Nie udało się pobrać treści ogłoszenia z tego linku (strona mogła zablokować pobieranie). Skopiuj tekst ogłoszenia i wklej go w pole poniżej.',
  );
}
