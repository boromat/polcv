# PolCV

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**A CV tailored to one job posting — built for the Polish job market.** A local web app for
students and juniors that writes the CV and scores it the way an ATS and an AI recruiter would.
Everything runs on your computer; only the text the AI needs goes out, through
[OpenRouter](https://openrouter.ai).

What general-purpose tools (Jobscan, Teal, Rezi) do not do for a Polish application:

- **Polish job boards** — reads postings from pracuj.pl, justjoin.it and nofluffjobs.
- **The GDPR (RODO) consent clause** Polish employers expect, added automatically or copied word
  for word from the posting; the **photo** follows Polish custom and the posting's wishes.
- **Keywords matched across Polish inflection** — "marketingu", "marketingiem" and "marketing" are
  one word, as they are to an ATS.
- **A Polish or English CV**, following the language of the posting. The interface is in Polish.
- **A career advisor that knows the local terms:** employment contract (UoP), mandate contract,
  B2B, gross monthly salary, a radius around your city or remote from anywhere in Poland.
- **Polish personal data kept private** — optionally with [polanon](https://github.com/boromat/polanon),
  which masks Polish names in every grammatical case, PESEL, NIP and more before anything reaches
  the model.

> Po polsku: [README.md](README.md).

## What it does

1. **Reads the posting** from a link (pracuj.pl, justjoin.it, nofluffjobs and most other sites, via
   schema.org `JobPosting` data or the page text) or from pasted text, and turns it into
   requirements, keywords with synonyms and weights, the GDPR clause and photo expectations.
2. **Asks about the gaps** between the posting and your profile, and remembers your answers for
   the next CV.
3. **Writes the CV without inventing anything.** Every line points at a fact in your profile;
   bolder wording is marked yellow and needs your approval before the PDF can be exported.
4. **Scores it 0–100:** keywords (40 pts, computed locally with Polish inflection and synonyms),
   ATS readability (20 pts, checked on text extracted back from the generated PDF) and an AI
   recruiter review (40 pts) with concrete fixes — plus an *Improve automatically* button.
5. **Exports a one-page PDF** with selectable text from three ATS-safe templates, keeps a history
   of applications with statuses, and on request prepares you for the interview or drafts a cover
   letter.
6. **Career advisor (optional):** a chat that learns what you are looking for, proposes roles you
   have a real chance at, and gives you ready-made search links for job portals.

## Quick start

Requires [Node.js](https://nodejs.org) 24 LTS.

**Windows:** double-click `start.bat`. The first run installs dependencies and Chromium (~150 MB),
then opens <http://localhost:3000>.

**Anywhere else:**

```bash
npm run setup   # npm install + Chromium for PDFs + build
npm start       # http://localhost:3000
```

Then open **Ustawienia** (Settings) and paste an OpenRouter API key. The defaults are Claude
Sonnet for writing and Claude Haiku for parsing; one CV with its report costs roughly
$0.05–0.15. The Settings page lists the models and shows what you have spent.

## Privacy

- Profiles, CVs, postings and the API key live in the `data/` folder next to the app, never in
  this repository. The server listens on `127.0.0.1` only.
- The profile and posting text are sent to OpenRouter and the model you pick, and nothing else
  leaves your machine (apart from fetching the postings you link).
- **Optional: [polanon](https://github.com/boromat/polanon).** If Python 3.11+ and
  `pip install polanon` are available, *Ustawienia → Ochrona danych osobowych* can mask your name,
  e-mail, phone, address, company names and profile links as tokens such as `<OSOBA_1>` before
  any text reaches the model, and put the originals back into its answer. The Settings page can
  install it for you. PolCV works the same without it; when masking is on but polanon is not
  working, nothing is sent at all. Masking is pseudonymisation, not anonymisation — see polanon's
  threat model.

## Job portals

The career advisor gives every proposed role search links for pracuj.pl, justjoin.it and
nofluffjobs: you open them in your own browser, and the app fetches nothing.

An **automated search** that fetches, filters and AI-ranks offers is available for nofluffjobs —
the one portal whose `robots.txt` allows it. It is **off by default**; switching it on in Settings
means you accept responsibility for using it in line with the portal's terms, for personal use and
at a modest pace. The app identifies itself as `PolCV/1.0` and makes only a handful of requests
per role. City coordinates for the radius filter come from
[OpenStreetMap Nominatim](https://nominatim.org) (© OpenStreetMap contributors, cached locally).

## Disclaimer

- PolCV is not affiliated with pracuj.pl, justjoin.it, nofluffjobs, OpenRouter or any model
  provider; their names are used only to say what the app works with.
- You are responsible for what you send to employers: the app marks AI suggestions, but it is your
  CV. The score is a simulation of typical ATS rules and an AI opinion, not a promise.
- Only import other people's CVs with their consent.
- Provided "as is", without warranty — see [LICENSE](LICENSE).

## Development

```bash
npm install
npx playwright install chromium
npm run dev        # API on :3000 + Vite with hot reload on :5173
npm test           # vitest: keywords, GDPR logic, PDF round trip, AI client, search, polanon bridge
npm run typecheck
```

- `server/` — Express API: posting fetchers and job search (`jobs/`), prompts (`llm/prompts/`),
  templates and PDF (`cv/`), ATS scoring (`ats/`), polanon bridge (`privacy/`), JSON storage
  (`storage/`).
- `client/` — React interface.
- `shared/schemas.ts` — zod schemas shared by both sides; the JSON schemas sent to the model are
  generated from them.

Tests that need polanon are skipped when it is not installed.

## License

[MIT](LICENSE) © 2026 BoroMat
