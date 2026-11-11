/** Angielskie tłumaczenia komunikatów serwera i raportu ATS. Klucz to polski tekst z kodu. */
export const EN: Record<string, string> = {
  'Nie ma takiego adresu API': 'There is no such API address',
  'Plik jest za duży (maks. 12 MB).': 'The file is too large (max. 12 MB).',
  'Błąd programu: {error}': 'Program error: {error}',

  // routes/*
  'Wiadomość jest za długa (maks. {max} znaków).': 'The message is too long (max. {max} characters).',
  'Niepoprawne preferencje: {field}': 'Invalid preferences: {field}',
  'Brak klucza.': 'No key provided.',
  'usunięty profil': 'deleted profile',
  'Podaj nazwę profilu.': 'Enter a profile name.',
  'Niepoprawne dane profilu: {field} {problem}': 'Invalid profile data: {field} {problem}',
  'Nie wybrano pliku CV.': 'No CV file was selected.',
  'Nie wybrano zdjęcia.': 'No photo was selected.',
  'Zdjęcie musi być w formacie JPG, PNG lub WEBP.': 'The photo must be a JPG, PNG or WEBP file.',
  'Brak zdjęcia': 'No photo',
  'Nie udało się odczytać zdjęcia. Zapisz je jako JPG lub PNG i spróbuj ponownie.': 'The photo could not be read. Save it as a JPG or PNG and try again.',
  'Zdjęcie jest za duże nawet po zmniejszeniu (maks. 1 MB). Wybierz inne zdjęcie.': 'The photo is still too large after shrinking it (max. 1 MB). Choose a different photo.',
  'Nieprawidłowy numer wersji': 'Invalid version number',
  'Nieznany status': 'Unknown status',
  'Niepoprawne odpowiedzi': 'Invalid answers',
  'Niepoprawne dane CV: {field}': 'Invalid CV data: {field}',
  'Ten PDF nie został jeszcze zapisany.': 'This PDF has not been saved yet.',
  'Niepoprawny list': 'Invalid cover letter',

  // career.ts, jobs/search.ts
  'Rozmowa z doradcą kariery': 'Chat with the career advisor',
  'Wyszukiwanie ofert jest wyłączone. Możesz je włączyć w Ustawieniach albo otworzyć wyszukiwanie na portalu linkiem przy stanowisku.':
    'Job search is turned off. You can turn it on in Settings, or use the link next to the role to search the job portal yourself.',
  'Nie ma takiej propozycji - wygeneruj propozycje ponownie.': 'This role suggestion no longer exists. Generate the suggestions again.',
  'Nie udało się ocenić dopasowania ofert przez AI - pokazuję je bez oceny.':
    'The AI could not score how well these job postings match, so they are shown without a score.',
  'Ustaw miasto albo zaznacz pracę zdalną w preferencjach.': 'Set a city or tick remote work in your preferences.',
  '{portal}: nie udało się pobrać części wyników.': '{portal}: some of the results could not be fetched.',

  // services.ts
  'Podaj link do ogłoszenia albo wklej jego treść.': 'Enter a link to the job posting or paste the posting text.',
  'Treść ogłoszenia jest za krótka - wklej całe ogłoszenie.': 'The posting text is too short. Paste the whole job posting.',
  'Najpierw trzeba przeanalizować ogłoszenie.': 'The job posting has to be analysed first.',
  'Odpowiedź przy aplikacji: {title} - {company}': 'Answer given when applying: {title} - {company}',
  'Nie znam / nie mam doświadczenia.': "I don't know it / I have no experience with it.",
  'Brak przeanalizowanego ogłoszenia.': 'There is no analysed job posting.',
  'Nie udało się uzyskać oceny AI.': 'Could not get the AI review.',
  'AI nie oceniło wszystkich kryteriów, więc ta część wyniku została pominięta. Oceń CV ponownie.':
    'The AI did not rate every criterion, so this part of the score was left out. Score the CV again.',
  'Najpierw wygeneruj CV.': 'Generate the CV first.',
  'Zatwierdź albo odrzuć {n} sugestie (żółte fragmenty), zanim pobierzesz PDF.':
    'Accept or reject the remaining suggestions ({n}, highlighted in yellow) before you download the PDF.',
  'Brak listu motywacyjnego.': 'There is no cover letter yet.',

  // storage/store.ts
  'Nieprawidłowy identyfikator': 'Invalid identifier',
  'Nie znaleziono profilu': 'Profile not found',
  'Nie znaleziono aplikacji': 'Application not found',
  'Brak wersji CV nr {v}': 'CV version {v} does not exist',
  'Plik {file} jest uszkodzony i nie da się go odczytać ({error}).': 'The file {file} is damaged and cannot be read ({error}).',

  // security.ts
  'Odmowa dostępu: PolCV przyjmuje zapytania tylko pod adresem localhost, a to przyszło pod adres {host}. Jeśli otwierasz program pod inną nazwą, dopisz ją w zmiennej CV_ALLOWED_HOSTS.':
    'Access denied: PolCV only accepts requests sent to localhost, but this one was sent to {host}. If you open the program under a different name, add it to the CV_ALLOWED_HOSTS variable.',
  'Odmowa dostępu: zapytanie z innej strony ({origin}) zostało zablokowane.': 'Access denied: a request from another website ({origin}) was blocked.',

  // cv/importCv.ts, cv/browser.ts, cv/render.ts, jobs/fetchPosting.ts
  'Obsługiwane formaty CV: PDF, DOCX, TXT.': 'Supported CV formats: PDF, DOCX, TXT.',
  'Z tego pliku nie da się odczytać tekstu (to może być skan lub obrazek). Wgraj CV zapisane jako PDF z Worda/Google Docs albo plik DOCX.':
    'No text can be read from this file (it may be a scan or an image). Upload a CV saved as a PDF from Word or Google Docs, or a DOCX file.',
  'Nie udało się uruchomić przeglądarki Chromium ({error}). Uruchom w folderze programu: npx playwright install chromium':
    'Could not start the Chromium browser ({error}). In the program folder, run: npx playwright install chromium',
  'koniec strony {n}': 'end of page {n}',
  'To nie wygląda na poprawny link (powinien zaczynać się od https://).': 'This does not look like a valid link (it should start with https://).',
  'Obsługiwane są tylko linki http(s).': 'Only http(s) links are supported.',
  'Nie udało się pobrać treści ogłoszenia z tego linku (strona mogła zablokować pobieranie). Skopiuj tekst ogłoszenia i wklej go w pole poniżej.':
    'Could not fetch the job posting from this link (the site may have blocked it). Copy the posting text and paste it into the field below.',

  // cv/github.ts, services.ts: projekty z GitHuba
  'Podaj nazwę użytkownika z GitHuba albo link do profilu, np. github.com/jan-kowalski.':
    'Enter a GitHub username or a profile link, e.g. github.com/jan-kowalski.',
  'Na GitHubie nie ma użytkownika „{user}”. Sprawdź nazwę albo link do profilu.': 'There is no GitHub user "{user}". Check the username or the profile link.',
  '„{user}” to organizacja, a nie konto osoby. Podaj swoją nazwę użytkownika z GitHuba.':
    '"{user}" is an organisation, not a personal account. Enter your own GitHub username.',
  'Użytkownik {user} nie ma na GitHubie publicznych projektów (forki pomijamy).': 'The GitHub user {user} has no public projects (forks are skipped).',
  'GitHub chwilowo ogranicza liczbę zapytań bez logowania (60 na godzinę). Spróbuj ponownie o {time} (za ok. {min} min).':
    'GitHub is limiting requests made without signing in (60 per hour). Try again at {time} (in about {min} min).',
  'GitHub chwilowo ogranicza liczbę zapytań bez logowania. Spróbuj ponownie za godzinę.':
    'GitHub is limiting requests made without signing in. Try again in an hour.',
  'Brak połączenia z GitHubem ({reason}). Sprawdź internet i spróbuj ponownie.':
    'Could not connect to GitHub ({reason}). Check your internet connection and try again.',
  'GitHub odpowiedział kodem {status}. Spróbuj ponownie za chwilę.': 'GitHub responded with status {status}. Try again in a moment.',

  // cv/rodo.ts: wyjaśnienia decyzji o klauzuli i zdjęciu (sama klauzula idzie za językiem CV)
  'Ogłoszenie podaje własną treść klauzuli - wklejono ją dosłownie.': 'The job posting gives its own clause wording, so it was copied word for word.',
  'Firma zagraniczna i CV po angielsku - klauzula RODO nie jest zwyczajowo wymagana.':
    'Foreign company and an English CV: a GDPR consent clause is not usually expected.',
  'Polska firma, CV po angielsku - dodano klauzulę w wersji angielskiej.': 'Polish company, English CV: the English version of the clause was added.',
  'Standardowa klauzula + zgoda na przyszłe rekrutacje (ogłoszenie o nią prosi).':
    'Standard clause plus consent for future recruitment (the job posting asks for it).',
  'Polska oferta bez własnej klauzuli - dodano standardową klauzulę RODO.': 'Polish job posting without its own clause: the standard GDPR clause was added.',
  'Profil nie ma zdjęcia.': 'Your profile has no photo.',
  'Ogłoszenie prosi o CV bez zdjęcia.': 'The job posting asks for a CV without a photo.',
  'Ogłoszenie prosi o zdjęcie.': 'The job posting asks for a photo.',
  'Oferta zagraniczna/anglojęzyczna - tam CV zwykle są bez zdjęcia.': 'Foreign or English-language job posting: CVs there usually have no photo.',
  'Polska oferta - zdjęcie jest tu zwyczajowe.': 'Polish job posting: a photo is customary here.',

  // llm/openrouter.ts
  'Brak klucza OpenRouter. Wklej go w Ustawieniach.': 'No OpenRouter key. Paste it in Settings.',
  'Brak połączenia z OpenRouter ({reason}).': 'Could not connect to OpenRouter ({reason}).',
  'przekroczony czas': 'timed out',
  'OpenRouter odrzucił klucz API. Sprawdź klucz w Ustawieniach.': 'OpenRouter rejected the API key. Check the key in Settings.',
  'Brak środków na koncie OpenRouter. Doładuj konto na openrouter.ai/settings/credits.':
    'Your OpenRouter account has no credit left. Top it up at openrouter.ai/settings/credits.',
  'Model {model} zapętlił się albo urwał odpowiedź ({task}) w 3 próbach. Spróbuj ponownie albo wybierz inny model w Ustawieniach.':
    'The model {model} got stuck in a loop or cut its answer short ({task}) in 3 attempts. Try again or choose a different model in Settings.',
  'Model {model} zwrócił dane w złym formacie ({task}) w 3 próbach. Spróbuj ponownie albo wybierz inny model w Ustawieniach.':
    'The model {model} returned data in the wrong format ({task}) in 3 attempts. Try again or choose a different model in Settings.',
  'Nie udało się pobrać listy modeli z OpenRouter.': 'Could not fetch the model list from OpenRouter.',
  'Klucz nieprawidłowy.': 'The key is invalid.',
  'OpenRouter odpowiedział kodem {status}.': 'OpenRouter responded with code {status}.',
  'bez limitu': 'no limit',
  'limit {amount} $': 'limit {amount} USD',
  'Klucz działa. Zużyto {used} $ ({limit}).': 'The key works. Used so far: {used} USD ({limit}).',

  // llm/prompts/cvChecks.ts
  'Liczba spoza profilu ({numbers}) - potwierdź albo odrzuć.': 'A number that is not in your profile ({numbers}). Confirm or reject it.',
  'Tytuł z ogłoszenia, a profil nie potwierdza: {names}. Zostaw go tylko, jeśli to prawda.': 'The title comes from the posting, and your profile does not confirm: {names}. Keep it only if it is true.',

  // mockInterview.ts: próbna rozmowa
  'Nie ma trwającej próbnej rozmowy. Zacznij nową.': 'There is no mock interview in progress. Start a new one.',
  'Poprzednia odpowiedź czeka jeszcze na ocenę. Spróbuj ponownie.': 'Your previous answer is still waiting for feedback. Try again.',
  'Odpowiedź jest pusta.': 'The answer is empty.',
  'Nie ma takiego faktu w tej rozmowie.': 'There is no such fact in this interview.',
  'Próbna rozmowa': 'Mock interview',
  'Niepoprawne dane faktu': 'Invalid fact data',

  // llm/prompts/mockChecks.ts: o co rekruter dopyta na próbnej rozmowie
  'Umiejętność „{skill}” jest w CV, ale nie pokazuje jej żaden punkt doświadczenia ani projekt: rekruter zapyta, gdzie jej użyto i z jakim efektem.':
    'The skill "{skill}" is in your CV, but no experience point or project shows it: the recruiter will ask where you used it and with what result.',
  'Punkt „{text}” ({where}) nie ma żadnej liczby: rekruter dopyta o skalę i efekt (ile, jak często, co się zmieniło).':
    'The point "{text}" ({where}) has no number: the recruiter will ask about scale and result (how many, how often, what changed).',
  'Daty projektu „{name}” w CV ({cv}) różnią się od dat repozytorium GitHub w profilu ({profile}): rekruter może zapytać, kiedy naprawdę nad nim pracowano.':
    'The dates of the project "{name}" in your CV ({cv}) differ from the GitHub repository dates in your profile ({profile}): the recruiter may ask when you really worked on it.',
  'Daty projektu „{name}” w CV ({cv}) różnią się od profilu ({profile}): rekruter może zapytać, kiedy naprawdę nad nim pracowano.':
    'The dates of the project "{name}" in your CV ({cv}) differ from your profile ({profile}): the recruiter may ask when you really worked on it.',
  '„{name}”: data końca ({end}) jest wcześniejsza niż początek ({start}).': '"{name}": the end date ({end}) is earlier than the start ({start}).',
  '„{name}”: początek ({start}) jest w przyszłości.': '"{name}": the start ({start}) is in the future.',

  // llm/prompts/improvePlan.ts: co kandydat może dopisać w profilu
  '„{term}” (wymagane w ogłoszeniu): jeśli to znasz, dopisz w profilu, gdzie i jak tego używasz.':
    '"{term}" (required in the job posting): if you know it, add to your profile where and how you use it.',
  '„{term}”: w profilu jest tylko na liście umiejętności. Dopisz, gdzie tego używasz (np. w opisie stażu albo projektu), a CV pokaże to jako dowód.':
    '"{term}": your profile only has it in the skills list. Add where you use it (e.g. in an internship or project description) and the CV will show it as evidence.',
  '„{term}”: dopisz w profilu przykład z pracy albo projektu, który to pokazuje.': '"{term}": add an example from work or a project to your profile that shows it.',
  'Konkretne efekty: dopisz w profilu wyniki swojej pracy (liczby, skala, co powstało), jeśli je znasz.':
    'Concrete results: add the results of your work to your profile (numbers, scale, what you produced) if you know them.',
  'Raport nie wskazuje niczego, co AI mogłoby jeszcze poprawić, więc nowa wersja nie powstała.':
    'The report shows nothing more the AI could improve, so no new version was created.',
  'Bez nowych informacji AI nie poprawi już tego CV, więc nowa wersja nie powstała. Możesz dopisać w profilu:':
    'Without new information the AI cannot improve this CV any further, so no new version was created. You can add this to your profile:',

  // privacy/polanon.ts (stan i błędy pokazywane w Ustawieniach)
  '{command} to Python {version}': '{command} is Python {version}',
  'Pakiet polanon nie jest zainstalowany.': 'The polanon package is not installed.',
  'polanon wymaga Pythona 3.11 lub nowszego ({found}).': 'polanon needs Python 3.11 or newer ({found}).',
  'Nie znaleziono Pythona 3.11+.': 'Python 3.11+ was not found.',
  'polanon nie wystartował w ciągu {seconds} s': 'polanon did not start within {seconds} s',
  'Podaj pełną ścieżkę do pliku Pythona na tym komputerze, np. C:\\Python312\\python.exe. Ścieżki względne i sieciowe nie są dozwolone, a puste pole oznacza wykrywanie automatyczne.':
    'Enter the full path to the Python file on this computer, e.g. C:\\Python312\\python.exe. Relative and network paths are not allowed; leave the field empty to detect Python automatically.',
  'Wskazany plik ({name}) to nie Python. Podaj ścieżkę do python.exe, python3.exe albo py.exe (w Linuksie i macOS: python albo python3).':
    'The selected file ({name}) is not Python. Enter the path to python.exe, python3.exe or py.exe (on Linux and macOS: python or python3).',
  'Nie znaleziono pliku {path}.': 'File not found: {path}.',
  'proces polanon zakończył się (kod {code})': 'the polanon process exited (code {code})',
  'proces polanon nie działa': 'the polanon process is not running',
  'polanon nie odpowiedział w ciągu 120 s': 'polanon did not respond within 120 s',
  'Maskowanie danych osobowych (polanon) jest włączone, ale nie działa: {error}. Nic nie zostało wysłane do AI. Napraw to w Ustawieniach albo wyłącz maskowanie.':
    'Personal data masking (polanon) is turned on but is not working: {error}. Nothing was sent to the AI. Fix it in Settings or turn masking off.',

  // ats/formatChecks.ts: nazwy i opisy kontroli w raporcie ATS
  'Tekst da się odczytać': 'Text can be read',
  'PDF zawiera prawdziwy tekst, nie obrazek.': 'The PDF contains real text, not an image.',
  'W PDF jest bardzo mało tekstu do odczytania.': 'The PDF has very little readable text.',
  'Imię i nazwisko': 'Full name',
  'Odczytane poprawnie.': 'Read correctly.',
  'Brak imienia i nazwiska w profilu - uzupełnij je.': 'Your profile has no full name. Please add it.',
  'Adres e-mail': 'Email address',
  'Odczytany poprawnie.': 'Read correctly.',
  'Nie znaleziono w tekście odczytanym z PDF.': 'Not found in the text read from the PDF.',
  'Brak e-maila w profilu - ATS nie będzie mógł się z Tobą skontaktować.':
    'Your profile has no email address, so the ATS will have no way to contact you.',
  'Numer telefonu': 'Phone number',
  'Brak telefonu w profilu (albo jest niepełny).': 'Your profile has no phone number (or it is incomplete).',
  'Standardowe nagłówki sekcji': 'Standard section headings',
  'Rozpoznane nagłówki: {list}.': 'Recognised headings: {list}.',
  brak: 'none',
  'Polskie znaki i kodowanie': 'Polish characters and encoding',
  'W tekście są zepsute znaki - ATS może źle odczytać CV.': 'The text contains broken characters, so the ATS may misread your CV.',
  'Znaki odczytane poprawnie.': 'Characters read correctly.',
  'Nie wykryto polskich znaków w CV po polsku.': 'No Polish characters were found in a CV written in Polish.',
  'Długość CV': 'CV length',
  'Jedna strona - idealnie dla studenta/juniora.': 'One page: ideal for a student or junior.',
  '{pages} strony - dla juniora najlepiej skrócić do jednej.': '{pages} pages: for a junior, it is best to cut it down to one.',
  'Kolejność czytania': 'Reading order',
  'ATS czyta sekcje w dobrej kolejności.': 'The ATS reads the sections in the right order.',
  'Sekcje są odczytywane w innej kolejności niż na stronie.': 'The sections are read in a different order than they appear on the page.',
  'Spójny format dat': 'Consistent date format',
  'Daty w jednym formacie.': 'All dates use the same format.',
  'Daty są zapisane w różnych formatach - ujednolić np. do MM.RRRR.': 'Dates are written in different formats. Make them consistent, e.g. MM.YYYY.',
  'doświadczenie „{name}”': 'experience "{name}"',
  'projekt „{name}”': 'project "{name}"',
  'wykształcenie „{name}”': 'education "{name}"',
  'umiejętności: {names}': 'skills: {names}',
  'języki': 'languages',
  'certyfikaty': 'certificates',
  'zainteresowania': 'interests',
  'Napisz krótko, gdzie i jak tego używasz.': 'Write briefly where and how you use it.',
  'nowe doświadczenie „{name}”': 'new experience "{name}"',
  'nowy projekt „{name}”': 'new project "{name}"',
  'nowa szkoła „{name}”': 'new school "{name}"',
  'To CV ma już wszystko z profilu: od tej wersji nic nie doszło.': 'This CV already has everything from your profile: nothing has been added since this version.',
  'Ta kopia PolCV nie pochodzi z git clone, więc nie zaktualizuje się sama. Pobierz nową wersję ze strony {url}.': 'This copy of PolCV did not come from git clone, so it cannot update itself. Download the new version from {url}.',
  'Napisz, co AI ma zmienić w CV.': 'Write what the AI should change in the CV.',
  'Nowości z profilu nie pasują do tego ogłoszenia, więc CV zostaje bez zmian.': 'The new things in your profile do not fit this posting, so the CV stays as it is.',
  'Poprawione według profilu: {items}.': 'Updated from your profile: {items}.',
  'Reszta CV została bez zmian, z Twoimi poprawkami.': 'The rest of the CV is unchanged, with your own edits.',
  'Jest tylko na liście umiejętności: AI pokaże je w punkcie albo w podsumowaniu, tam gdzie potwierdza to profil.':
    'It is only in the skills list: the AI will show it in a point or in the summary, where your profile backs it up.',
  'AI dopisze je do listy umiejętności (w profilu jest na liście).': 'The AI will add it to the skills list (your profile lists it).',
  'AI dopisze je w treści CV, tam gdzie potwierdza to profil.': 'The AI will add it to the CV text, where your profile backs it up.',
  'Słowo kluczowe „{term}”': 'Keyword "{term}"',
  'Z profilu: „{text}”': 'From your profile: "{text}"',
  'Mniej powtórzeń': 'Fewer repetitions',
  'Słowa powtórzone za często: {terms}. AI zostawi każde najwyżej 2-3 razy.': 'Words repeated too often: {terms}. The AI will keep each at most 2-3 times.',
  'Jeden format dat': 'One date format',
  'Daty w CV są zapisane różnie: program zapisze wszystkie jako {format}, bez AI.': 'The dates in the CV are written in different ways: the app will write all of them as {format}, without the AI.',
  'podsumowanie': 'summary',
  'tytuł': 'headline',
  'szkoła „{name}”': 'school "{name}"',
  'nowy punkt „{text}”': 'new point "{text}"',
  'usunięty punkt „{text}”': 'removed point "{text}"',
  'punkt „{text}”': 'point "{text}"',
  'Umiejętności': 'Skills',
  'umiejętność „{name}”': 'skill "{name}"',
  'CV zmieniło się od ostatniej oceny: najpierw kliknij „Oceń ponownie”, żeby zobaczyć aktualne poprawki.': 'The CV has changed since it was last scored: click "Score again" first to see the current fixes.',
  'Zaznacz, co AI ma poprawić.': 'Select what the AI should fix.',
  'Zaznaczonych poprawek nie ma już w raporcie. Odśwież stronę albo oceń CV ponownie.': 'The selected fixes are no longer in the report. Reload the page or score the CV again.',
  'format dat': 'date format',
  'AI nie znalazło nic do zmiany w zaznaczonych miejscach, więc nowa wersja nie powstała.': 'The AI found nothing to change in the selected parts, so no new version was created.',
  'Zmienione: {items}.': 'Changed: {items}.',
  'Program uruchamia polecenia dopiero po potwierdzeniu dokładnie tych komend. Odśwież stronę i potwierdź je ponownie.':
    'The app runs commands only after you confirm exactly these commands. Reload the page and confirm them again.',
  'CV nie mieści się już na jednej stronie: usuń coś w edytorze albo kliknij „Skróć do 1 strony”.':'The CV no longer fits on one page: remove something in the editor or click "Shorten to 1 page".',
};
