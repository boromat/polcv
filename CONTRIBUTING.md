# Contributing

Bug reports, fixes and new job portals are welcome. PolCV is a local CV generator: a React
interface and an Express server in TypeScript, Chromium for the PDF, OpenRouter for the AI and,
optionally, polanon to mask personal data before it reaches a model.

## Setup

```bash
npm install
npx playwright install chromium
npm run dev        # API on :3000 + Vite with hot reload on :5173
```

Node.js 24 LTS, or 26 and newer (`package.json`, `start.bat` and both READMEs say the same, and
`tests/docs.test.ts` keeps them in step). The masking tests need polanon (`pip install polanon`)
and are skipped without it. Your profile, settings and CVs live in `data/`, which git ignores; the
OpenRouter key is read from `OPENROUTER_API_KEY` first.

## Quality bar

- `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` pass locally. CI runs them on
  Linux and Windows (the app has paths of its own on Windows: `start.bat`, `py`, `npm.cmd`,
  case-insensitive file names), and runs the masking tests against the real polanon.
- Tests for every behaviour change, and no network or paid API in them: the AI client, the portals
  and Nominatim are tested with a stubbed `fetch`. A change to a prompt or to the CV checks is
  measured, not asserted: run `npm run eval -- --mock` to check the harness, and a real run
  (`evals/README.md`) before and after if you have a key.
- The schemas the model must follow live in `shared/schemas.ts` (zod); the JSON schemas sent to the
  model are generated from them, never written by hand.
- Every interface string goes through the translation function and gets its English in
  `client/src/i18n/en.ts` or `server/i18n/en.ts`; `tests/i18n.test.ts` fails on a missing one.
- An automated search of a job portal only where the portal's `robots.txt` allows it, off by
  default, at a modest pace, identifying itself as `PolCV/<version>`. Anything else gets a search
  link the user opens in their own browser.
- Plain sentences in the imperative mood for commit messages, one logical change each:
  `Search Smart Jobs next to nofluffjobs`, `Use made-up examples in prompts, tests and notes`.
- `README.md` is Polish and `README.en.md` is its English translation: a change to one is made to
  the other in the same commit.

## Test data

Invented people only, in tests, fixtures, eval cases, screenshots and issues alike. A CV is
personal data: no real CV, profile, posting with a recruiter's details, or log belongs in the
repository, and someone else's CV only with their consent.

- Names are made up, and e-mail addresses and websites use `example.com` or a `.example` domain
  (`zofia.zolkiewska@example.com`).
- A PESEL has a valid checksum and a birth date before 1860 or after 2100, so it can never belong
  to a living person: `50810112354` is 1 January 1850.
- Employers, schools and projects in examples are fictional or neutral; `evals/cases/` shows the
  shape.

## Changes written with AI tools

Welcome, on the same terms as any other change. Say in the pull request that an AI tool wrote or
helped write it, and which one, so the review knows where to look. You answer for the change as if
you had typed it yourself: you have read every line, run the quality bar above, and can answer
questions about it. A pull request that nobody answers for after a review is closed.

## Masking and security

Masking of personal data before an AI call is done by
[polanon](https://github.com/boromat/polanon). A value it did not recognise is a detection gap in
polanon: report it there, with invented text of the same shape. A way for another page or another
machine to read the profile or run a command, or for personal data to reach the model while masking
is on, is a security report: see `SECURITY.md`, never a public issue.
