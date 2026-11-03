# Changelog

All notable changes to PolCV are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
