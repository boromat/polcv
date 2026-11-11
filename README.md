# PolCV

**Polski** · [English](README.en.md)

[![CI](https://github.com/boromat/polcv/actions/workflows/ci.yml/badge.svg)](https://github.com/boromat/polcv/actions/workflows/ci.yml)
[![Licencja: MIT](https://img.shields.io/badge/licencja-MIT-blue.svg)](LICENSE)

**CV pod konkretne ogłoszenie - zrobione dla polskiego rynku pracy.** Otwarty program na Twój komputer dla studentów i juniorów: z linku do ogłoszenia robi CV pisane pod systemy ATS i ocenę AI-rekrutera. Program jest darmowy; płacisz tylko za użycie AI (zwykle 20-60 gr za CV).

![PolCV: wklejenie ogłoszenia, pytania o braki w profilu, CV z podglądem na żywo i raport ATS z polską odmianą słów kluczowych](docs/demo.gif)

<sub>Demo na fikcyjnych danych: kandydat Kacper Nowicki i ogłoszenie firmy Acme Media nie istnieją.</sub>

Czym różni się od zagranicznych narzędzi (Jobscan, Teal, Rezi):

- **polskie portale** - czyta ogłoszenia z pracuj.pl, justjoin.it i nofluffjobs,
- **klauzula RODO** dodawana automatycznie (albo dosłownie ta z ogłoszenia), **zdjęcie** według polskich zwyczajów i wymagań oferty,
- **słowa kluczowe z polską odmianą** - przy liczeniu wyniku „marketingu”, „marketingiem” i „marketing” to dla programu to samo słowo; nie każdy system ATS rozpoznaje odmianę, więc AI wpisuje w CV słowa w brzmieniu z ogłoszenia, tam gdzie to zgodne z prawdą,
- **CV po polsku albo po angielsku** - w języku ogłoszenia; sam program ma interfejs po polsku i po angielsku (przełącznik PL | EN), więc pomoże też osobom, które dopiero uczą się polskiego,
- **doradca kariery** zna polskie realia: UoP / zlecenie / B2B, wynagrodzenie brutto, praca w promieniu od miasta albo zdalnie z całej Polski,
- **polskie dane osobowe pod ochroną** - opcjonalnie z [polanon](https://github.com/boromat/polanon), który maskuje imiona w każdym przypadku, PESEL, NIP i inne, zanim cokolwiek trafi do AI.

Jak to działa:

1. wklejasz link do ogłoszenia (pracuj.pl, justjoin.it, nofluffjobs i inne),
2. AI wyciąga z niego wymagania i słowa kluczowe, których szukają systemy ATS,
3. dopytuje o rzeczy, których brakuje w Twoim profilu (odpowiedzi zapamiętuje),
4. pisze CV pod to ogłoszenie - bez zmyślania; odważniejsze sformułowania zaznacza na żółto do Twojej decyzji, także tytuł z ogłoszenia, gdy wymienia coś, czego profil nie potwierdza (np. „Junior Java Developer” bez Javy),
5. ocenia CV jak system ATS i AI-rekruter (wynik 0-100) i umie je automatycznie poprawić,
6. zapisuje PDF i historię aplikacji ze statusami; na życzenie przygotowuje do rozmowy, prowadzi próbną rozmowę z oceną każdej odpowiedzi i pisze list motywacyjny,
7. na życzenie dopisuje do profilu Twoje projekty z GitHuba - tylko publiczne repozytoria i tylko to, co wynika z ich opisów i plików README.

Wszystkie dane zostają na Twoim komputerze, w folderze `data`. Do AI (przez OpenRouter) wysyłana jest tylko treść profilu i ogłoszenia (oraz opisy Twoich publicznych repozytoriów, gdy dodajesz projekty z GitHuba) - a jeśli chcesz, z danymi osobowymi zamienionymi na tokeny (zob. [Ochrona danych osobowych](#ochrona-danych-osobowych-polanon--opcjonalnie)).

## Uruchomienie (Windows)

1. Zainstaluj **Node.js 24 LTS** ze strony <https://nodejs.org> (jeśli jeszcze go nie masz; działa też Node.js 26 i nowszy).
2. Kliknij dwukrotnie **`start.bat`**.
   - Za pierwszym razem program instaluje swoje części i pobiera przeglądarkę Chromium (ok. 150 MB) - to trwa kilka minut.
   - Potem sam otworzy się adres <http://localhost:3000>.
3. Okno z czarnym tłem musi być otwarte, dopóki korzystasz z programu. Zamknięcie go wyłącza program.

## Klucz OpenRouter (jednorazowo)

OpenRouter to jedno konto, przez które program korzysta z modeli AI (np. Claude). Płacisz tylko za to, czego użyjesz.

1. Wejdź na <https://openrouter.ai> i załóż konto.
2. W zakładce **Credits** doładuj konto (np. 5-10 $).
3. W zakładce **Keys** kliknij **Create Key** i skopiuj klucz (zaczyna się od `sk-or-`).
4. W programie wejdź w **Ustawienia**, wklej klucz i kliknij **Sprawdź i zapisz**.

Klucz zapisuje się **zwykłym tekstem w pliku `data/settings.json`** na Twoim komputerze. Jeśli wolisz nie trzymać go na dysku, ustaw zmienną środowiskową `OPENROUTER_API_KEY` (w ustawieniach systemu albo w terminalu przed `npm start`): ma pierwszeństwo przed kluczem z Ustawień i kluczami profili, a program nigdzie jej nie zapisuje.

### Ile to kosztuje

Przy domyślnych modelach (Claude Sonnet do pisania i oceny, Claude Haiku do analizy) jedno CV z oceną to zwykle **ok. 0,05-0,15 $** (20-60 gr). Automatyczna poprawka, przygotowanie do rozmowy i list motywacyjny kosztują podobnie. W **Ustawieniach** widać dokładne wydatki i można wybrać tańsze lub mocniejsze modele.

## Jak używać

1. **Profile** → utwórz profil (np. swoje imię).
2. **Mój profil** → wgraj swoje obecne CV (PDF/DOCX). AI wypełni formularz - sprawdź dane (zmiany zapisują się same). Im więcej szczegółów (projekty, kursy, liczby), tym lepsze CV.
3. **Nowe CV** → wklej link do ogłoszenia. Jeśli strona nie da się pobrać, wklej tekst ogłoszenia.
4. Odpowiedz na pytania o brakujące wymagania (albo je pomiń) → **Napisz CV**.
5. W edytorze:
   - zdecyduj o **żółtych** fragmentach („To prawda - zostaw” albo „Użyj bezpiecznej wersji”),
   - popraw tekst, jeśli chcesz - podgląd odświeża się na bieżąco (czerwona linia = koniec strony); poprawione fakty (stanowiska, daty, punkty, nowe umiejętności) zapisują się też w profilu,
   - zakładka **Raport** pokazuje wynik i konkretne poprawki; brakujące słowo kluczowe, które znasz, kliknij i napisz, gdzie tego używasz, a przy poprawkach „wymaga Twoich danych” kliknij **Uzupełnij**; odpowiedzi trafiają do profilu, a **Popraw automatycznie** tworzy nową wersję i ocenia ją ponownie.
6. **Pobierz PDF** - plik zapisuje się też w historii. Status zmieniaj w **Historii** (Wysłane → Rozmowa → Oferta…).
7. Gdy dostaniesz zaproszenie: otwórz aplikację → zakładka **Rozmowa** → **Przygotuj mnie do rozmowy**. Tam też jest **Próbna rozmowa**:
   - AI-rekruter zadaje 6-8 pytań pod to ogłoszenie po jednym (przedstawienie się, doświadczenie, zadanie sytuacyjne, wiedza z wymagań, narzędzia, pytanie o brak; jedno po angielsku, gdy ogłoszenie wymaga angielskiego). Dopytuje o to, co program sam znalazł w CV: umiejętność bez dowodu w doświadczeniu, punkt bez liczby, daty projektu inne niż w profilu,
   - po ogólnikowej odpowiedzi dopytuje najwyżej raz; pytanie możesz pominąć, a rozmowę zakończyć w każdej chwili i wznowić później,
   - każda odpowiedź dostaje wynik 1-5 (konkret i liczby, dopasowanie do ogłoszenia, struktura, poprawność, długość), uwagi i mocniejszą wersję. Mocniejsza wersja bierze fakty tylko z profilu, CV i Twoich odpowiedzi; brakujące dane zostawia w nawiasach do uzupełnienia, np. „[ile dokumentów tygodniowo]”, a program odrzuca liczbę albo nazwę spoza tych źródeł,
   - nowe fakty z odpowiedzi (np. „skrypt oszczędza godzinę dziennie”) trafiają do profilu dopiero po kliknięciu **Dopisz do profilu**: na próbnej rozmowie się improwizuje, a profil zasila każde kolejne CV,
   - na końcu: średni wynik, mocne strony, rzeczy do poprawy, lista miejsc w nawiasach do przygotowania, tematy do powtórki, ocena Twoich pytań do firmy i koszt rozmowy. Podsumowania kolejnych podejść zostają, więc widać postęp.

   Ograniczenia: o firmie rekruter wie tylko to, co jest w ogłoszeniu (resztę wpisuje jako „sprawdź przed rozmową”, ale tego program nie umie sprawdzić w kodzie); błędy merytoryczne wskazuje tylko, gdy model jest pewny, więc może któryś przeoczyć; rozmowa jest pisana, nie głosowa. Koszt jednej rozmowy to ok. 0,40 $ na domyślnym Claude Sonnet 5.5 i ok. 0,02 $ na Claude Haiku 5.5.
8. Chcesz uzupełnić braki? Zakładka **Kursy i certyfikaty** (gdy CV jest gotowe) podpowiada, które kursy i certyfikaty najbardziej pomogą w tej rekrutacji, z czasem nauki, kosztem i linkiem do wyszukania.

## Szukaj pracy (doradca kariery)

Zakładka **Szukaj pracy**:

1. **Rozmowa** - doradca AI zadaje pytania po kolei: jakiej pracy szukasz, co konkretnie było Twoim zadaniem (dopytuje o szczegóły), gdzie i na jakich warunkach chcesz pracować. Rozmowa jest zapamiętywana - możesz wrócić później. Konkretne informacje o doświadczeniu trafiają do profilu (kolejne CV je wykorzystają).
2. **Czego szukasz** - panel z preferencjami, który doradca wypełnia w trakcie rozmowy; możesz go zmienić ręcznie:
   - praca **stacjonarna/hybrydowa** w promieniu (10-100 km) od wybranego miasta,
   - praca **zdalna** z całej Polski,
   - minimalne wynagrodzenie, forma umowy, wymiar etatu, poziom (staż/junior/mid).
3. **Propozycje i oferty** - AI proponuje 5-8 stanowisk z uzasadnieniem i tym, czego brakuje. Przy każdym są linki **Otwórz wyszukiwanie: pracuj.pl · justjoin.it · nofluffjobs** z frazą, miastem, promieniem i poziomem - otwierasz je sam w przeglądarce, a ciekawą ofertę wklejasz w **Nowe CV**.

Pod nazwą firmy (przy ofertach, w Historii i w aplikacji) jest link **opinie na GoWork**, który otwiera wyszukiwanie opinii o pracodawcy na GoWork.pl. Program niczego z GoWork nie pobiera.

### Automatyczne wyszukiwanie ofert (domyślnie wyłączone)

W **Ustawieniach** możesz włączyć wyszukiwanie, w którym program sam przeszukuje nofluffjobs (jedyny z tych portali, którego plik `robots.txt` na to pozwala), odrzuca oferty niepasujące do preferencji (seniorzy, zła umowa, za niska stawka), ocenia dopasowanie pozostałych przez AI, a **Zrób CV pod to** od razu zaczyna CV pod wybraną ofertę.

Włączając je, bierzesz na siebie korzystanie zgodne z regulaminem portalu: tylko na własny użytek i z umiarem. Program przedstawia się jako `PolCV/<wersja>` z linkiem do tego repozytorium i wysyła kilka zapytań na stanowisko. Współrzędne miast do filtra promienia pochodzą z OpenStreetMap Nominatim (© autorzy OpenStreetMap) i są zapamiętywane lokalnie. Oferty bez podanego wynagrodzenia nie są odrzucane przez filtr kwoty.

## Ochrona danych osobowych (polanon) - opcjonalnie

[polanon](https://github.com/boromat/polanon) to osobny, darmowy pakiet Pythona. Gdy jest zainstalowany, w **Ustawieniach → Ochrona danych osobowych** możesz włączyć maskowanie: zanim tekst trafi do AI, imię i nazwisko, e-mail, telefon, adres, nazwy firm i linki z profilu zamieniane są na tokeny (np. `<OSOBA_1>`), a w odpowiedzi AI program wstawia prawdziwe wartości z powrotem. Model widzi tylko tokeny.

- Potrzebny jest Python 3.11+ (<https://www.python.org/downloads/>, zaznacz „Add python.exe to PATH”). Sam polanon zainstalujesz przyciskiem w Ustawieniach albo poleceniem `py -m pip install polanon`. Gdy na PyPI wyjdzie nowsza wersja, Ustawienia to pokażą i zaktualizują go jednym przyciskiem. Tam też jednym przyciskiem zainstalujesz model spaCy, a gdy wyjdzie nowe wydanie PolCV, zaktualizujesz sam program (przy kopii z `git clone`).
- Bez Pythona i polanonu PolCV działa normalnie - to tylko dodatkowa ochrona.
- Gdy maskowanie jest włączone, a polanon przestanie działać, program **nic nie wyśle** do AI i pokaże błąd.
- To pseudonimizacja, nie pełna anonimizacja: nie każdy szczegół da się wykryć (np. nazwa uczelni). Dokładniej działa z modelem spaCy: `py -m pip install "polanon[ner]"` i `py -m spacy download pl_core_news_md`.

## Udostępnianie koledze

**Na tym samym komputerze:** kolega tworzy własny profil (lista profili w prawym górnym rogu). W jego profilu można wkleić jego własny klucz OpenRouter - wtedy płaci za siebie. Ten klucz też leży w `data/settings.json`, nie w plikach profilu.

**Na jego komputerze:** skopiuj cały folder programu **bez folderów `data` i `node_modules`** (np. spakuj do ZIP). Kolega instaluje Node.js i uruchamia `start.bat`. Folder `data` zawiera Twoje CV i dane osobowe - nie wysyłaj go nikomu.

## Gdzie są moje dane

Folder `data` obok programu:

- `settings.json` - klucz OpenRouter z Ustawień i własne klucze profili (zwykłym tekstem; klucz ze zmiennej `OPENROUTER_API_KEY` nie trafia do żadnego pliku), wybrane modele i przełączniki (wyszukiwanie, maskowanie),
- `geocache.json` - zapamiętane współrzędne miast (do filtra promienia),
- `profiles/<id>/profile.json` - profil, `files/` - wgrane CV, zdjęcie,
- `profiles/<id>/career.json` - rozmowa z doradcą, preferencje, propozycje i znalezione oferty,
- `profiles/<id>/applications/<id>/` - ogłoszenie, wersje CV, raporty, zapisany PDF, próbna rozmowa (`mock-interview.json`),
- `usage.jsonl` - historia kosztów AI.

Kopia zapasowa = skopiowanie folderu `data`.

## Gdy coś nie działa

- **„Brak klucza OpenRouter”** - wklej klucz w Ustawieniach.
- **„Brak środków na koncie OpenRouter”** - doładuj konto na openrouter.ai.
- **Link z ogłoszeniem się nie pobiera** - kliknij „Link nie działa? Wklej treść ogłoszenia”, zaznacz całą stronę ogłoszenia (Ctrl+A), skopiuj i wklej. Program pobiera ogłoszenie jako `PolCV/<wersja>` (nie udaje przeglądarki), a gdy strona blokuje takie pobieranie, nie próbuje tego obejść, tylko prosi o wklejenie treści.
- **„Z tego pliku nie da się odczytać tekstu”** - Twoje CV jest skanem/obrazkiem. Zapisz je ponownie jako PDF z Worda albo Google Docs.
- **Okno `start.bat` zamyka się od razu** - uruchom je ponownie i przeczytaj komunikat; zwykle brakuje Node.js.
- **Port 3000 zajęty** - zamknij inne okno PolCV albo ustaw inny port: w `start.bat` przed `call npm start` dopisz `set PORT=3001`.

## Jakość generowania

Na 18 fikcyjnych parach profil + ogłoszenie z [`evals/`](evals/README.md) (11.11.2026, po jednym przebiegu na model) wszystkie trzy sprawdzone modele napisały 18 CV, które przeszły kontrole, i żadne nie miało pozycji, liczby ani umiejętności spoza profilu:

| Model | Za pierwszym podejściem | Pokrycie słów kluczowych | Koszt na CV | Czas na CV |
|---|---|---|---|---|
| `anthropic/claude-sonnet-5.5` | 18 z 18 | 59% | $0,031 | 9,6 s |
| `openai/gpt-6.1-sol` | 18 z 18 | 56% | $0,018 | 12,6 s |
| `anthropic/claude-haiku-5.5` | 16 z 18 | 58% | $0,002 | 8,3 s |

**Polecam domyślny `anthropic/claude-sonnet-5.5`:** każde CV przechodzi kontrole od razu, ma najlepsze pokrycie słów kluczowych i powstaje w ok. 10 s, a 100 CV kosztuje ok. $3. Gdy liczy się koszt, `anthropic/claude-haiku-5.5` jest ok. 17 razy tańszy przy podobnym pokryciu, ale częściej dopisuje umiejętności spoza profilu (np. Reacta), które kontrola musi odrzucić. `openai/gpt-6.1-sol` był najostrożniejszy, ale najwolniejszy i słabiej używał słów z ogłoszenia w parach-pułapkach. Tytuł z ogłoszenia, którego profil nie potwierdza (np. „Junior Java Developer” bez Javy), trafia do żółtej sugestii. Drugie skracanie za długiego CV nie uruchomiło się w żadnym przebiegu, więc na prawdziwym modelu jest jeszcze niesprawdzone. To mały zbiór przygotowany przez autora programu: metody, wyniki dla każdej pary i ograniczenia opisuje [evals/README.md](evals/README.md).

## Bezpieczeństwo

- Serwer nasłuchuje tylko na `127.0.0.1`. API odpowiada tylko pod `localhost`, `127.0.0.1` i `[::1]`, a zapytania zmieniające dane wysłane z innych stron dostają odmowę (program sprawdza nagłówki Host i Origin). Obca strona otwarta w tej samej przeglądarce nie odczyta więc Twojego profilu i niczego nie uruchomi.
- Klucz OpenRouter leży zwykłym tekstem w `data/settings.json`, razem z własnymi kluczami profili (`profile.json` ich nie zawiera, a przeglądarka dostaje je tylko zamaskowane). Zmienna środowiskowa `OPENROUTER_API_KEY` ma pierwszeństwo i nie jest zapisywana na dysku.
- Ustawienia mogą uruchomić programy na Twoim komputerze: `git pull --ff-only`, `npm install` i `npm run build` przy aktualizacji PolCV oraz `pip install` przy instalacji polanonu i modelu spaCy. Przed uruchomieniem program pokazuje dokładne komendy i czeka na Twoje potwierdzenie, a serwer uruchamia tylko komendy, które zostały potwierdzone.
- Żeby udostępnić PolCV w sieci domowej, ustaw `CV_HOST=0.0.0.0` (wtedy każdy w tej sieci widzi Twoje dane); API odpowiada wtedy także pod adresami IP i nazwą tego komputera. Jeśli otwierasz PolCV pod inną nazwą, dopisz ją po przecinku w `CV_ALLOWED_HOSTS`, np. `CV_ALLOWED_HOSTS=polcv.lan`.

## Zastrzeżenia

- PolCV nie jest powiązany z pracuj.pl, justjoin.it, nofluffjobs, GoWork, OpenRouter ani dostawcami modeli AI - ich nazwy służą tylko do opisu, z czym program współpracuje.
- Za treść CV wysyłanego pracodawcy odpowiadasz Ty. Program oznacza sugestie AI, ale decyzja należy do Ciebie. Wynik 0-100 to symulacja typowych reguł ATS i opinia AI, nie gwarancja.
- Cudze CV importuj tylko za zgodą tej osoby.
- Program jest udostępniany „tak jak jest”, bez gwarancji (licencja MIT).

## Dla programisty

```bash
npm install
npx playwright install chromium
npm run dev        # serwer (3000) + interfejs z hot-reload (5173)
npm test           # testy: słowa kluczowe, RODO, PDF w obie strony, klient AI, wyszukiwanie, mostek polanon, komponenty interfejsu
npm run typecheck  # TypeScript 7 (pakiet @typescript/native)
npm run lint       # ESLint z typescript-eslint; pakiet typescript 6.0 jest tylko dla jego parsera
npm run eval -- --mock   # ewaluacja jakości na atrapie modelu; z --model <id> na prawdziwym API (evals/README.md)
npm run eval -- --interview --mock   # ewaluacja próbnej rozmowy na atrapie modelu
```

- `server/` - Express: pobieranie ogłoszeń i wyszukiwanie (`jobs/`), prompty AI (`llm/prompts/`), szablony i PDF (`cv/`), ocena ATS (`ats/`), mostek do polanonu (`privacy/`), zapis plików (`storage/`).
- `client/` - interfejs React.
- `shared/schemas.ts` - wspólne schematy danych (zod), z których powstają też schematy JSON dla AI.

Adres i dozwolone nazwy serwera (`CV_HOST`, `CV_ALLOWED_HOSTS`) opisuje sekcja [Bezpieczeństwo](#bezpieczeństwo).
