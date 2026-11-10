# Changelog

All notable changes to PolCV are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-11-10

### Added

- **Quality evaluation of CV generation** (for developers). `npm run eval -- --model <id>` runs 18
  fictional profile and posting pairs, including traps, through the same CV generation as the app
  and reports which attempt passed the checks, what they caught, keyword coverage, whether the CV
  fits one page, forbidden facts that got through, and cost and time per CV. CI runs it on a mock
  model only. The first run, on Claude Haiku 5.5, is described in `evals/README.md`.
- In *Szukaj pracy*, an offer you already made a CV for shows *CV already made*, linking to that
  application, so it is easy to spot after the offers are refreshed and rearranged.
- **Add entries in the CV editor.** Experience, Projects and Education have *+ experience*,
  *+ project* and *+ school* buttons, for example for the company you work at now. As soon as the
  entry has a role or company (a project its name, a school its name or field), it is also added
  to your profile, so the next CVs include it.
- **Sync with profile.** Each CV version remembers what your profile held when it was made. In
  *History* and next to the version picker, *Sync with profile (n)* shows how many things have been
  added or changed since (from the career advisor chat, gap answers, profile edits or GitHub) and
  brings them into a new version without touching your own edits in the CV. A changed role,
  company, school, place or date of an entry the CV already has is copied straight from the
  profile, without the AI. The AI writes only what is new (entries, points from new achievements
  or facts, skills, certificates, languages), and only those new parts are taken from its answer:
  your summary, points and order stay word for word, and points you removed do not come back.
  A CV that grows past one page is not shortened on its own; you get a note and can remove
  something or use *Shorten to 1 page*. When nothing new fits the posting, no version is added and
  the counter goes back to zero. The previous version stays in the list. Corrections made in the
  CV editor itself do not come back as changes. When there is nothing to sync, *History* offers
  *Generate again* instead, after a confirmation that says your own edits do not carry over.
- **Instruction for the AI.** At the bottom of the CV editor you can tell the AI what to change, for
  example "add my vocational placement and scouting from my profile". It does only that, using only
  facts from your profile, does not bring back what you removed on purpose, keeps the CV to one page
  and saves the result as a new version.
- **How you refer to yourself.** Creating a profile asks for *on*, *ona* or *ono* (it can be changed
  in *Mój profil*). The gap questions and the career advisor address you in the matching Polish
  forms ("wykonywałeś", "wykonywałaś", "wykonywałoś"), and interview answers and cover letters use
  them in the first person. Profiles without a choice keep the neutral wording. Before, gap questions
  often needed several AI calls because the model kept writing gendered forms.
- **Updates from Settings.** When a newer PolCV release is on GitHub, Settings show it with an
  *Update PolCV* button for copies made with `git clone` (it runs `git pull`, `npm install` and the
  build, then asks you to start PolCV again) and a link to the releases page otherwise. The release
  is checked through GitHub's public API at most once an hour.
- **Install the spaCy model** for polanon with one button in Settings (`polanon[ner]` and the Polish
  `pl_core_news_md` model, about 50 MB), after a confirmation that shows the commands.

### Changed

- **You choose what *Improve automatically* changes.** The button now opens a list in the report:
  the recruiter's fixes (current text and proposal), keywords your profile backs up, weak criteria,
  repeated words and mixed date formats. Nothing is ticked in advance, and the AI changes only what
  you tick. It answers with changes to specific places (replace, add or remove a point, the
  summary, the headline, skills) instead of a whole new CV, and anything outside your choice is
  sent back, so the rest of the CV, including your own wording, stays word for word. Mixed date
  formats are fixed by the app without the AI. A CV that grows past one page is not shortened on
  its own, and the message lists what changed. The list needs a current score; after editing the
  CV, *Score again* comes first.
- **One place for OpenRouter keys, and an environment variable that wins.** All keys now live in
  `data/settings.json`: the key from Settings and the keys of profiles that pay from their own
  account, which used to be stored in each `profile.json` and are moved over on the first start.
  `OPENROUTER_API_KEY` now takes precedence over both instead of being the last fallback, and it
  is never written to disk. Settings and both READMEs say plainly where the key is kept.
- **Commands from Settings run only after you confirm them.** Updating PolCV (`git pull --ff-only`,
  `npm install`, `npm run build`) and installing polanon or its spaCy model (`pip install`) first
  show the exact commands the server is about to run, and the server runs them only when the
  request carries exactly those confirmed commands. Before, the PolCV update dialog only
  described the steps. The README has a new security section about this and the Host and Origin
  checks.
- **Posting links are fetched as PolCV.** The app now identifies itself as `PolCV/<version>` with a
  link to the repository when it fetches a posting, also in the Chromium fallback, instead of
  posing as a Chrome browser. When a site blocks automated requests (403, 429, 503 or a "verify you
  are human" page), the app asks you to paste the posting text right away instead of trying again
  with a browser.
- **No en dashes either.** Besides the long dash (—), the CV, cover letters and everything the AI
  writes now use a plain hyphen instead of the en dash (–): dates read "07.2025 - 09.2025", ranges
  "2-3", and the template separates role and company with " - ". Older versions are shown and
  exported the same way without being written again. Text copied word for word from a posting,
  such as its GDPR clause, stays as it is.

### Fixed

- A CV that still runs over one page after the AI shortened it is shortened once more, starting
  from the shorter version, when a CV is written, after the instruction for the AI and with
  *Shorten to 1 page*. In the quality evaluation a very long profile took 2 pages after a single
  pass. If it still does not fit after the second pass, it is saved as it is: the page count in the
  editor shows it, and *Shorten to 1 page* still works.
- The skills list is now checked against your profile in a new CV, after *Improve automatically* and
  after the changes you pick from the report. A specific skill the profile does not confirm (a
  technical name such as "TypeScript" or "Google Ads", or a skill the posting asks for, such as
  "Java") goes back to the model, also with a note such as "(w nauce)", and missing skills show
  up in the report instead. Before, only the editor warned about it, and in the quality evaluation
  Claude Haiku 5.5 added such skills to 3 of 18 CVs. A skill in other words passes when the names in
  it are in the profile: "CMR documentation" in a CV in English for "dokumenty CMR", or "Obsługa
  systemu TMS" for "system TMS" (this one still gets the editor warning). Skills the CV already had,
  such as ones you added yourself, are kept when it is improved.
- The CV summary may use the past tense in the candidate's own form when the profile says how they
  refer to themselves, for example "Ukończyłam technikum" for *ona*. The check used to reject every
  gendered past form, which in the quality evaluation made Claude Haiku 5.5 give up on 2 of 18 CVs
  after three attempts. Forms of another gender and the second person still go back to the model,
  and profiles without a choice keep the present tense only.
- The career advisor now writes a job, internship or volunteering you describe in the chat into the
  *Experience* section of your profile (role, company, dates, achievements). Before, it was saved
  only as loose facts, so the profile's *Experience* stayed empty. The same company under another
  legal form (for example "Sp. z o.o." and "SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ") gets new
  achievements instead of a copy.
- The pracuj.pl link under *Otwórz wyszukiwanie* showed no offers for manual trades (mechanic,
  welder, painter and the like): its level filter allowed only trainee, assistant and junior, while
  the portal marks these offers as *manual worker*. That level is now included for every seniority.
- The career advisor no longer leaves remote work on for someone looking for local or manual work,
  which filled the results with unrelated remote offers.
- An entry added with *+ experience*, *+ project* or *+ school* and left empty no longer leaves an
  empty block in the preview, the PDF or the score.
- The CV summary is now in the first person from its first sentence ("Jestem studentem…",
  "Studiuję…") instead of opening like a description of someone else ("Student kierunku X,
  pracujący z…"). A summary that opens with a role noun or a participle after a comma goes back to
  the model for a fix.
- Shortening a CV to one page could silently drop a school (for example a technical secondary school
  with a vocational title). Every school in the profile now stays in the CV, with fewer details if
  space is short, and a CV that misses one goes back to the model for a fix.
- *Improve automatically*, *Shorten to 1 page* and the instruction for the AI no longer make the AI
  rewrite text you wrote yourself: the style checks (first person in the summary, noun forms in
  points) apply only to what the AI writes anew, so your own wording passes as it is.
- An answer to a long gap question that lists several tools ("Make, n8n, Zapier or Power Automate")
  no longer confirms all of them: *Improve automatically* and the skill check count only what the
  answer itself says. A short topic, such as a keyword confirmed with *I have this*, still counts.

## [1.1.0] - 2026-11-08

### Added

- **Courses and certificates.** Once the CV is ready, a new tab suggests the courses and
  certificates that would help most for that posting, starting with those that cover required
  skills the profile does not confirm. Each one shows the provider, whether it is free, how long it
  takes, which requirements it covers and a search link; the AI gives no links of its own, so it
  cannot make one up.
- **Projects from GitHub.** On *Mój profil*, enter a GitHub username or profile link and the app
  reads your public repositories (the 10 most recently updated, forks skipped) and adds them as
  projects with a short description, technologies, dates and a link. The AI writes only what the
  repository descriptions and READMEs say, and a number that is not in them is dropped. Projects
  already in the profile stay untouched, missing technologies are added as skills, and the GitHub
  link goes into your contact links.
- **Reviews on GoWork.** Under every company name (career advisor offers, History and the
  application page) there is a link that opens a search for employer reviews on GoWork.pl. The
  company's legal form ("sp. z o.o.", "S.A." and the like) is left out of the search, and the app
  fetches nothing from GoWork.
- **"I have this" in the ATS report.** Click a missing keyword (required or nice to have), write
  briefly where you use it, and the answer is saved to your profile like a gap question answer.
  *Improve automatically* then works it into the CV.
- **Fill in data for fixes.** Fixes marked "needs your input" have a *Fill in* button. The answer
  goes to your profile, and the next *Improve automatically* applies that fix with your data.
- **CV edits update the profile.** Facts you correct in the editor are saved to your profile too:
  roles, companies, dates, project names and links, points (as achievements), new skills,
  technologies, languages, certificates and interests. The title and summary stay in the CV, since
  they are written for one posting, and an English CV made from a Polish profile changes nothing.
  The editor says what it updated.
- **polanon updates.** Settings show the installed polanon version next to the newest one on PyPI
  and, when a newer one is out, an *Update to …* button that runs the same `pip install --upgrade
  polanon` as the install button. The version check asks PyPI's public API only, at most once an
  hour.

### Fixed

- Gap questions no longer fail with "wrong format" for large profiles: the answer limit is higher, the
  list of covered requirements is shorter, and when the model keeps writing gendered forms such as
  "używałeś" after its retries, the questions are accepted instead of stopping the CV.
- Writing a CV with Claude Haiku 5.5 no longer fails with "the model looped or cut its answer off".
  The model spent its whole answer limit on thinking before writing anything; reasoning is now turned
  off for JSON answers (models that must reason think briefly instead). The app also checks which
  parameters a model supports and stops sending a temperature to models that ignore it, so providers
  that enforce the answer format are found again.
- CVs fit on one A4 page again. When the text runs a little over, the template shrinks the font and
  spacing (never below 8.6 pt), then the margins (never below 10 mm), in the preview, the PDF and
  the score alike. When even that is not enough, the AI shortens the new CV once by as much as it
  runs over, keeping the posting's keywords. An older version that still spills over has a
  *Shorten to 1 page* button next to its page count. The prompt also asks for a shorter CV from the
  start (about 300-420 words, one-line points).
- The Polish CV summary is written in the first person, as the candidate writes it ("Znam…",
  "Tworzę…"), instead of the third person ("Zna…", "Tworzy…"). Present tense keeps it free of
  gendered past forms, and a summary in the third person goes back to the model for a fix. Points
  keep the usual noun form ("Tworzenie…").
- With *Mask personal data* on, more of your own data is masked before it reaches the AI: the
  GitHub or LinkedIn login from your profile and project links wherever it appears, also without
  the link (the GitHub import sends it as a JSON field and in repository names), your surname on
  its own, also in lowercase, and a street with a house number in the location field, while the
  city stays readable. The GitHub account you import projects from is masked too, even when it is
  not the one in your profile.

## [1.0.1] - 2026-11-03

### Added

- **English interface.** A PL | EN switch in the header changes the whole app, including the
  messages from the server and everything the AI writes for you (gap questions, notes, the report,
  the career advisor, interview prep). The CV itself still follows the language of the posting.
- The version number at the bottom of Settings, with a link to this changelog.
- Demo animations in both READMEs, and CI that runs the types, tests and build on Ubuntu and
  Windows, plus the masking tests against the real polanon package.

### Changed

- **An honest ATS score.** Keywords count from the CV content by section: full credit in the
  summary, experience, projects and education, half credit when a keyword appears only in the
  skills list or the headline. The GDPR clause no longer counts as keywords, soft skills count only
  when a bullet shows them, and Polish inflection is understood (bazy/baz, praca/pracy).
- Pending suggestions are scored as their safe version, and a missing AI review gives no total
  ("ocena niepełna") instead of an inflated one.
- **"Popraw automatycznie" works from a plan.** The app first works out what can honestly be
  improved: keywords the profile supports, keywords to move from the skills list into a bullet,
  the recruiter's fixes that need no new information. When there is nothing to do, it does not
  call the AI and lists what you could add to your profile instead. A new version becomes current
  only when it does not score lower.
- CV bullets always use noun forms in Polish and start with a verb in English; company names and
  dates come from the profile, and a number that is not in the profile becomes a yellow suggestion.
- The AI recruiter scores all five criteria against an anchored rubric and asks you direct
  questions when it needs more information.
- Gap questions avoid gendered forms such as "miałeś(-aś)".
- The AI no longer writes long dashes in CVs and letters.
- Automated job search covers nofluffjobs only and is off by default; every proposed role has
  search links for pracuj.pl, justjoin.it and nofluffjobs that you open yourself.
- The profile saves itself a second after each change.

### Fixed

- Saving two things at once could corrupt the data files; slow operations could overwrite each
  other's results (job searches, advisor chat, notes).
- A rejected yellow suggestion came back after editing the same bullet.
- Unsaved profile edits, including an imported CV, were lost when leaving the page.
- Gap answers piled up in the profile on every retry.
- PDF downloads and AI actions could miss the last edit.
- A failed Chromium launch crashed the server; `start.bat` did not retry an unfinished install and
  closed the window on errors.
- A posting link to a PDF sent raw bytes to the AI; large profile photos made huge CV PDFs; a
  temporary map service error was remembered as an unknown city.
- Errors after long actions appeared outside the visible area, and the chat lost the cursor after
  every message.

### Security

- The API answers only on `localhost` and refuses changes requested by other websites.
- The custom Python path for polanon must point to a local Python.

## [1.0.0] - 2026-11-03

First public release: a CV tailored to one job posting, scored the way an ATS and an AI recruiter
would, with a career advisor, interview prep, cover letters and optional masking with polanon.

[Unreleased]: https://github.com/boromat/polcv/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/boromat/polcv/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/boromat/polcv/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/boromat/polcv/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/boromat/polcv/releases/tag/v1.0.0
