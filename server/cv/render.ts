import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { CoverLetter, CvContent, CvText, CvVersion, Profile, SectionKey, TemplateId } from '../../shared/schemas';

const require = createRequire(import.meta.url);

// ---------- Czcionki (wbudowane jako data URI, żeby PDF wyglądał tak samo na każdym komputerze) ----------

const FONT_PKGS: Record<TemplateId, { pkg: string; family: string }> = {
  classic: { pkg: '@fontsource/source-sans-3', family: 'Source Sans 3' },
  modern: { pkg: '@fontsource/inter', family: 'Inter' },
  compact: { pkg: '@fontsource/ibm-plex-sans', family: 'IBM Plex Sans' },
};

const fontCache = new Map<string, string>();

function fontCss(pkg: string): string {
  const cached = fontCache.get(pkg);
  if (cached) return cached;
  const dir = path.dirname(require.resolve(`${pkg}/package.json`));
  let out = '';
  for (const w of [400, 600, 700]) {
    const css = fs.readFileSync(path.join(dir, `${w}.css`), 'utf8');
    // Tylko latin + latin-ext (polskie znaki są w latin-ext); woff2 jako base64.
    for (const block of css.split(/(?=\/\*)/)) {
      if (!/-latin(-ext)?-\d+-normal \*\//.test(block)) continue;
      out += block
        .replace(/src:[^;]+;/, (src) => {
          const file = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(src)?.[1];
          if (!file) return src;
          const b64 = fs.readFileSync(path.join(dir, 'files', file)).toString('base64');
          return `src: url(data:font/woff2;base64,${b64}) format('woff2');`;
        })
        .replace(/font-display:[^;]+;/, '');
    }
  }
  fontCache.set(pkg, out);
  return out;
}

// ---------- Pomocnicze ----------

export const esc = (s: string) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const LABELS = {
  pl: {
    summary: 'Podsumowanie',
    experience: 'Doświadczenie zawodowe',
    projects: 'Projekty',
    education: 'Wykształcenie',
    skills: 'Umiejętności',
    certificates: 'Certyfikaty i kursy',
    languages: 'Języki obce',
    interests: 'Zainteresowania',
  },
  en: {
    summary: 'Summary',
    experience: 'Experience',
    projects: 'Projects',
    education: 'Education',
    skills: 'Skills',
    certificates: 'Certifications',
    languages: 'Languages',
    interests: 'Interests',
  },
} as const;

export const sectionLabel = (lang: 'pl' | 'en', key: SectionKey) => LABELS[lang][key];

const prettyUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const href = (u: string) => (/^https?:\/\//.test(u) ? u : `https://${u}`);

export type RenderMode = 'preview' | 'pdf';

/** Tekst z uwzględnieniem decyzji; w podglądzie oczekujące sugestie są podświetlone. */
function textOf(t: CvText, decisions: CvVersion['decisions'], mode: RenderMode): string | null {
  if (t.status === 'suggested') {
    const d = decisions[t.id];
    if (d === 'rejected') return t.fallbackText.trim() ? esc(t.fallbackText) : null;
    if (d === 'accepted') return esc(t.text);
    return mode === 'preview' ? `<mark class="suggested" data-id="${esc(t.id)}">${esc(t.text)}</mark>` : esc(t.text);
  }
  return esc(t.text);
}

function bulletsHtml(items: CvText[], decisions: CvVersion['decisions'], mode: RenderMode): string {
  const lis = items.map((b) => textOf(b, decisions, mode)).filter((x): x is string => !!x && x.trim() !== '');
  return lis.length ? `<ul>${lis.map((l) => `<li>${l}</li>`).join('')}</ul>` : '';
}

// ---------- CSS szablonów ----------

const BASE_CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: var(--font), Arial, sans-serif; font-size: var(--fs); line-height: 1.38; color: #1d1d1f; background: #fff; }
.sheet { width: 210mm; min-height: 297mm; padding: var(--m-top) var(--m-side) var(--m-bottom); margin: 0 auto; background: #fff; position: relative; }
@media print { .sheet { width: auto; min-height: 0; padding: 0; margin: 0; } .page-guide { display: none; } }
@media screen { body { background: #e9ebef; padding: 16px 0; } .sheet { box-shadow: 0 2px 12px rgba(0,0,0,.12); } }
.page-guide { position: absolute; left: 0; right: 0; border-top: 2px dashed #e5484d; pointer-events: none; }
.page-guide span { position: absolute; right: 6px; top: 2px; font: 600 10px/1 Arial, sans-serif; color: #e5484d; background: #fff; padding: 2px 4px; }
a { color: inherit; text-decoration: none; }
header.cv-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 6mm; }
header .id { flex: 1; min-width: 0; }
h1.name { font-size: var(--fs-name); font-weight: 700; line-height: 1.1; letter-spacing: -0.01em; }
.headline { font-size: calc(var(--fs) * 1.12); font-weight: 600; margin-top: 1.2mm; }
.contact { margin-top: 1.8mm; font-size: calc(var(--fs) * 0.95); }
.contact .sep { color: #9a9aa0; padding: 0 .35em; }
img.photo { width: 28mm; height: 35mm; object-fit: cover; border-radius: 2px; flex-shrink: 0; }
section { margin-top: var(--gap); }
h2 { font-size: calc(var(--fs) * 1.08); font-weight: 700; break-after: avoid; margin-bottom: 1.6mm; }
.entry { break-inside: avoid; margin-top: 2mm; }
.entry:first-of-type { margin-top: 0; }
.entry-head { display: flex; justify-content: space-between; gap: 4mm; align-items: baseline; }
.entry-head .title { font-weight: 600; }
.entry-head .dates { white-space: nowrap; color: #55555c; font-size: calc(var(--fs) * 0.95); }
.sub { color: #55555c; font-size: calc(var(--fs) * 0.95); }
ul { margin: 0.8mm 0 0 4.2mm; }
li { margin-top: 0.5mm; padding-left: 0.6mm; }
p { margin: 0; }
.skills-row { margin-top: 0.6mm; }
.skills-row b { font-weight: 600; }
.rodo { margin-top: 5mm; font-size: 7.4pt; line-height: 1.3; color: #66666c; break-inside: avoid; }
mark.suggested { background: #ffe58f; border-bottom: 2px solid #f5a623; color: inherit; padding: 0 1px; cursor: pointer; }
mark.suggested.focus { outline: 2px solid #f5a623; }
`;

const TEMPLATE_CSS: Record<TemplateId, string> = {
  classic: `
:root { --font: 'Source Sans 3'; --fs: 10.6pt; --fs-name: 22pt; --gap: 4.2mm; }
header.cv-header { border-bottom: 1.2px solid #1d1d1f; padding-bottom: 3mm; }
h2 { letter-spacing: .03em; font-size: 11.2pt; border-bottom: 0.8px solid #b9b9bf; padding-bottom: .8mm; }
`,
  modern: `
:root { --font: 'Inter'; --fs: 9.8pt; --fs-name: 21pt; --gap: 4.4mm; --accent: #1f4e79; }
h1.name { color: var(--accent); }
.headline { color: #3a3a40; }
header.cv-header { padding-bottom: 2.5mm; border-bottom: 2.4px solid var(--accent); }
h2 { color: var(--accent); font-size: 10.4pt; letter-spacing: .01em; }
h2::before { content: ''; display: inline-block; width: 3.2mm; height: 3.2mm; background: var(--accent); border-radius: 1px; margin-right: 2mm; vertical-align: -0.3mm; }
.entry-head .title { color: #111; }
li::marker { color: var(--accent); }
`,
  compact: `
:root { --font: 'IBM Plex Sans'; --fs: 9.3pt; --fs-name: 18pt; --gap: 3.2mm; }
body { line-height: 1.3; }
header.cv-header { border-bottom: 1px solid #1d1d1f; padding-bottom: 2mm; }
h2 { letter-spacing: .02em; font-size: 10.2pt; border-bottom: 0.6px solid #c3c3c8; padding-bottom: .5mm; margin-bottom: 1.2mm; }
img.photo { width: 24mm; height: 30mm; }
.entry { margin-top: 1.4mm; }
ul { margin-top: .4mm; }
li { margin-top: .2mm; }
`,
};

/** Marginesy w mm: [góra, boki, dół]. @page nie widzi zmiennych CSS, więc wstawiamy liczby. */
const MARGINS: Record<TemplateId, [number, number, number]> = {
  classic: [14, 16, 13],
  modern: [13, 15, 12],
  compact: [10, 12, 10],
};

function docHtml(template: TemplateId, title: string, body: string, mode: RenderMode, extraHead = ''): string {
  const [mt, ms, mb] = MARGINS[template];
  const pageCss = `@page { size: A4; margin: ${mt}mm ${ms}mm ${mb}mm; } :root { --m-top: ${mt}mm; --m-side: ${ms}mm; --m-bottom: ${mb}mm; }`;
  const guide =
    mode === 'preview'
      ? `<script>
(function(){
  function draw(){
    var s=document.querySelector('.sheet'); if(!s) return;
    document.querySelectorAll('.page-guide').forEach(function(g){g.remove();});
    var mm=s.offsetWidth/210, top=${mt}*mm, contentH=(297-${mt}-${mb})*mm;
    var end=0;
    Array.prototype.forEach.call(s.children,function(ch){ if(!ch.classList.contains('page-guide')) end=Math.max(end, ch.offsetTop+ch.offsetHeight); });
    var n=1;
    while(end>top+contentH*n+1){ var g=document.createElement('div'); g.className='page-guide'; g.style.top=(top+contentH*n)+'px';
      g.innerHTML='<span>koniec strony '+n+'</span>'; s.appendChild(g); n++; }
    try{ parent.postMessage({type:'cv-pages', pages:n}, '*'); }catch(e){}
  }
  // Kartka A4 (≈794 px) skalowana do szerokości panelu podglądu.
  function fit(){ document.documentElement.style.zoom = String(Math.min(1, (window.innerWidth - 20) / 794)); draw(); }
  window.addEventListener('load', fit); window.addEventListener('resize', fit); document.fonts && document.fonts.ready.then(fit);
  document.addEventListener('click', function(e){ var m=e.target.closest && e.target.closest('mark.suggested');
    if(m){ try{ parent.postMessage({type:'cv-suggested-click', id:m.dataset.id}, '*'); }catch(_){} } });
})();
</script>`
      : '';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${fontCss(FONT_PKGS[template].pkg)}${pageCss}${BASE_CSS}${TEMPLATE_CSS[template]}</style>${extraHead}</head>
<body><div class="sheet">${body}</div>${guide}</body></html>`;
}

function headerHtml(profile: Profile, headline: string, photoDataUri: string | null): string {
  const c = profile.contact;
  const parts = [
    c.email && `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`,
    c.phone && esc(c.phone),
    c.location && esc(c.location),
    ...c.links.filter((l) => l.url).map((l) => `<a href="${esc(href(l.url))}">${esc(prettyUrl(l.url))}</a>`),
  ].filter(Boolean);
  return `<header class="cv-header"><div class="id">
<h1 class="name">${esc(c.fullName || profile.displayName)}</h1>
${headline ? `<div class="headline">${esc(headline)}</div>` : ''}
<div class="contact">${parts.join('<span class="sep">|</span>')}</div>
</div>${photoDataUri ? `<img class="photo" src="${photoDataUri}" alt="">` : ''}</header>`;
}

function sectionHtml(key: SectionKey, c: CvContent, d: CvVersion['decisions'], mode: RenderMode): string {
  const h = `<h2>${esc(sectionLabel(c.language, key))}</h2>`;
  switch (key) {
    case 'summary': {
      const t = textOf(c.summary, d, mode);
      return t ? `<section>${h}<p>${t}</p></section>` : '';
    }
    case 'experience': {
      if (!c.experience.length) return '';
      const items = c.experience.map(
        (e) => `<div class="entry"><div class="entry-head"><span class="title">${esc(e.role)}${e.company ? ` – ${esc(e.company)}` : ''}</span><span class="dates">${esc(e.dates)}</span></div>
${e.location ? `<div class="sub">${esc(e.location)}</div>` : ''}${bulletsHtml(e.bullets, d, mode)}</div>`,
      );
      return `<section>${h}${items.join('')}</section>`;
    }
    case 'projects': {
      if (!c.projects.length) return '';
      const tech = c.language === 'pl' ? 'Technologie' : 'Tech';
      const items = c.projects.map(
        (p) => `<div class="entry"><div class="entry-head"><span class="title">${esc(p.name)}${p.role ? ` – ${esc(p.role)}` : ''}</span><span class="dates">${esc(p.dates)}</span></div>
${p.technologies.length || p.link ? `<div class="sub">${p.technologies.length ? `${tech}: ${esc(p.technologies.join(', '))}` : ''}${p.technologies.length && p.link ? ' | ' : ''}${p.link ? `<a href="${esc(href(p.link))}">${esc(prettyUrl(p.link))}</a>` : ''}</div>` : ''}
${bulletsHtml(p.bullets, d, mode)}</div>`,
      );
      return `<section>${h}${items.join('')}</section>`;
    }
    case 'education': {
      if (!c.education.length) return '';
      const items = c.education.map(
        (e) => `<div class="entry"><div class="entry-head"><span class="title">${esc([e.degree, e.field].filter(Boolean).join(', '))}</span><span class="dates">${esc(e.dates)}</span></div>
<div class="sub">${esc(e.school)}</div>${e.details ? `<p>${esc(e.details)}</p>` : ''}</div>`,
      );
      return `<section>${h}${items.join('')}</section>`;
    }
    case 'skills': {
      const rows = c.skills.filter((g) => g.items.length);
      if (!rows.length) return '';
      return `<section>${h}${rows.map((g) => `<div class="skills-row"><b>${esc(g.category)}:</b> ${esc(g.items.join(', '))}</div>`).join('')}</section>`;
    }
    case 'certificates': {
      if (!c.certificates.length) return '';
      return `<section>${h}<ul>${c.certificates.map((x) => `<li>${esc(x.name)}${x.issuer ? ` – ${esc(x.issuer)}` : ''}${x.date ? ` (${esc(x.date)})` : ''}</li>`).join('')}</ul></section>`;
    }
    case 'languages': {
      if (!c.languages.length) return '';
      return `<section>${h}<p>${c.languages.map((l) => `${esc(l.name)}${l.level ? ` – ${esc(l.level)}` : ''}`).join('<span class="sep">  |  </span>')}</p></section>`;
    }
    case 'interests': {
      if (!c.interests.length) return '';
      return `<section>${h}<p>${esc(c.interests.join(', '))}</p></section>`;
    }
  }
}

export function photoDataUri(profileDir: string, photo: string): string | null {
  if (!photo) return null;
  try {
    const buf = fs.readFileSync(path.join(profileDir, photo));
    const mime = photo.endsWith('.png') ? 'image/png' : photo.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

const ALL_SECTIONS: SectionKey[] = ['summary', 'experience', 'projects', 'education', 'skills', 'certificates', 'languages', 'interests'];

export function renderCvHtml(cv: CvVersion, profile: Profile, photo: string | null, mode: RenderMode): string {
  const c = cv.content;
  // Sekcje spoza sectionOrder (np. dodane ręcznie) dokładamy na końcu, żeby nic nie zginęło.
  const order = [...new Set([...c.sectionOrder, ...ALL_SECTIONS])];
  const body = [
    headerHtml(profile, c.headline, cv.photo ? photo : null),
    ...order.map((k) => sectionHtml(k, c, cv.decisions, mode)),
    cv.rodo.include && cv.rodo.text ? `<div class="rodo">${esc(cv.rodo.text)}</div>` : '',
  ].join('\n');
  return docHtml(cv.template, `CV – ${profile.contact.fullName}`, body, mode);
}

export function renderLetterHtml(letter: CoverLetter, profile: Profile, template: TemplateId, posting: { company: string; title: string }, mode: RenderMode): string {
  const date = new Date().toLocaleDateString(letter.language === 'pl' ? 'pl-PL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const place = profile.contact.location ? `${esc(profile.contact.location.split(',')[0])}, ` : '';
  const re = letter.language === 'pl' ? 'Dotyczy' : 'Re';
  const body = `${headerHtml(profile, '', null)}
<div style="margin-top:8mm;text-align:right">${place}${esc(date)}</div>
<div style="margin-top:6mm"><b>${esc(posting.company)}</b></div>
<div style="margin-top:1mm">${re}: ${esc(posting.title)}</div>
<div style="margin-top:8mm">${esc(letter.greeting)}</div>
${letter.paragraphs.map((p) => `<p style="margin-top:3.5mm;text-align:justify">${esc(p)}</p>`).join('\n')}
<div style="margin-top:7mm">${esc(letter.closing)}</div>
<div style="margin-top:1.5mm;font-weight:600">${esc(profile.contact.fullName)}</div>`;
  return docHtml(template, `List motywacyjny – ${profile.contact.fullName}`, body, mode);
}
