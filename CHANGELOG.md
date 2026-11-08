# Changelog

All notable changes to PolCV are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

[Unreleased]: https://github.com/boromat/polcv/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/boromat/polcv/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/boromat/polcv/releases/tag/v1.0.0
