# Changelog

All notable changes to PolCV are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- In *Szukaj pracy*, an offer you already made a CV for shows *CV already made*, linking to that
  application, so it is easy to spot after the offers are refreshed and rearranged.
- **Add entries in the CV editor.** Experience, Projects and Education have *+ experience*,
  *+ project* and *+ school* buttons, for example for the company you work at now. As soon as the
  entry has a role or company (a project its name, a school its name or field), it is also added
  to your profile, so the next CVs include it.
- **Sync with profile.** Each CV version remembers what your profile held when it was made. In
  *History* and next to the version picker, *Sync with profile (n)* shows how many things have been
  added since (from the career advisor chat, gap answers, profile edits or GitHub) and asks the AI
  to work the relevant ones into a new version, kept to one page. The previous version stays in the
  list.

### Fixed

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

[Unreleased]: https://github.com/boromat/polcv/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/boromat/polcv/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/boromat/polcv/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/boromat/polcv/releases/tag/v1.0.0
