# Ewaluacja jakości generowania CV

Testy w `tests/` sprawdzają, że kod działa. Ten folder mierzy coś innego: jak dobrze model pisze CV, które przechodzi
kontrole PolCV, trzyma się profilu i pasuje do ogłoszenia.

## Jak uruchomić

```bash
npm run eval -- --model anthropic/claude-haiku-5.5   # wymaga zmiennej OPENROUTER_API_KEY, kosztuje
npm run eval -- --mock                              # atrapa modelu, bez kosztów (sprawdza skrypt, nie model)
npm run eval -- --report                            # tabela porównawcza wszystkich wyników z results/
npm run eval -- --interview --mock                  # próbna rozmowa na atrapie (opis na końcu tego pliku)
```

Opcje: `--fast-model <id>` (analiza ogłoszeń, domyślnie Haiku 5.5), `--cases 01,15` (tylko wybrane przypadki),
`--concurrency 3`. Skrypt pracuje na tymczasowym folderze danych, nie na `data/`, a klucz bierze tylko ze zmiennej
środowiskowej. W CI ewaluacja działa wyłącznie na atrapie modelu (`tests/eval.test.ts`), bez płatnego API.

## Co jest mierzone

Każda para przechodzi przez `services.generate`, czyli tę samą ścieżkę co przycisk **Napisz CV**: model pisze CV,
kontrole odrzucają złą odpowiedź (do 3 podejść), liczby spoza profilu stają się żółtymi sugestiami, a za długie CV
jest skracane do jednej strony A4. Potem skrypt liczy:

| Miara | Jak |
|---|---|
| CV przyjęte w 1., 2., 3. podejściu | która odpowiedź modelu przeszła walidację (`observeCalls` w `server/llm/openrouter.ts`) |
| Odrzucenia: bez źródła / umiejętności / styl / szkoła / format | te same kontrole, które odrzuciły odpowiedź (`sourceIssues`, `skillIssues`, `styleIssues`, `educationIssues` z `cvChecks.ts`) |
| Liczby spoza profilu | punkty, które `groundCv` zamienił w żółte sugestie |
| Pokrycie słów kluczowych | `scoreKeywords`, ta sama funkcja co w ocenie ATS: punkty / maksimum |
| Jedna strona A4 | liczba stron PDF wydrukowanego jak w aplikacji |
| Koszt i czas | `usage.cost` z odpowiedzi OpenRouter, czas całego `generate` (z podejściami i skracaniem) |
| Zakazane fakty | dla 5 par lista faktów, których profil nie potwierdza; szukane w gotowym CV z polską odmianą, osobno w treści i w żółtych sugestiach |

## Zbiór

18 fikcyjnych par w `cases/`: 5 studentów, 5 juniorów, 2 osoby zmieniające branżę i 6 osób do pracy fizycznej.
2 ogłoszenia są po angielsku (CV ma wyjść po angielsku z polskiego profilu). Cztery pary to pułapki:
ogłoszenie wymaga Javy, której profil nie ma (15), profil bez żadnej liczby (16), bardzo długi profil z 8 stanowiskami i
ponad 30 umiejętnościami (17), ogłoszenie dla kierowcy C+E przy prawie jazdy kat. B (18). Zakazane fakty mają pary
01, 02, 09, 15 i 18. Osoby, firmy i szkoły są wymyślone, adresy i linki to `example.com`.

Ogłoszenia przeanalizował raz `anthropic/claude-haiku-5.5` (10.11.2026); wynik jest zamrożony w `posting.parsed.json`,
żeby każdy model pisał CV z tego samego wejścia. Pytania o braki w profilu i ocena AI-rekrutera nie wchodzą do
ewaluacji (pierwsze wymagają odpowiedzi kandydata, druga to osobny model oceniający).

## Wyniki: 10.11.2026

Model pisania CV i analizy ogłoszeń: `anthropic/claude-haiku-5.5`, czyli ten, którego autor używa na co dzień (w kodzie
domyślnie do pisania jest ustawiony `anthropic/claude-sonnet-5.5`). Cztery przebiegi po 18 par tego samego dnia: 1. na
kodzie z commita `8816d1d`, 2. po poprawce kontroli podsumowania (`cd48204`), 3. z nową kontrolą listy umiejętności
(`5d64949`), 4. po poprawce tej kontroli (`843562d`); opisy niżej. Szczegóły dla każdej pary:
[przebieg 1](results/2026-11-10_anthropic_claude-haiku-5.5.md),
[przebieg 2](results/2026-11-10_anthropic_claude-haiku-5.5_po-poprawce.md),
[przebieg 3](results/2026-11-10_anthropic_claude-haiku-5.5_kontrola-umiejetnosci.md),
[przebieg 4](results/2026-11-10_anthropic_claude-haiku-5.5_poprawka-umiejetnosci.md).

| Miara | 1 | 2 (podsumowanie) | 3 (umiejętności) | 4 (poprawka) |
|---|---|---|---|---|
| CV przyjęte w 1. / 2. / 3. podejściu | 61% / 22% / 6% | 94% / 0% / 6% | 78% / 11% / 6% | 89% / 11% / 0% |
| Nie powstało (3 odrzucone podejścia) | 11% (2 z 18) | 0% | 6% (1 z 18) | 0% |
| Wpisy bez źródła w profilu odrzucone przez kontrolę | 0 | 0 | 0 | 0 |
| Umiejętności spoza profilu odrzucone przez kontrolę | - | - | 5 | 3 |
| Liczby spoza profilu zamienione w sugestie | 0 | 0 | 2 | 0 |
| Pokrycie słów kluczowych (jak w ocenie ATS) | 56% | 59% | 55% | 58% |
| CV na jednej stronie A4 | 100% (1 skrócone przez AI) | 100% (1 skrócone) | 100% (1 skrócone) | 94% (1 skrócone, ale na 2 strony) |
| Zakazane fakty: w treści / w sugestiach | 2 / 5 | 8 / 0 | 3 / 2 | 3 / 2 |
| Koszt na CV | $0,0022 | $0,0019 | $0,0021 | $0,0018 |
| Czas na CV (średnio / najdłużej) | 8,9 s / 17,3 s | 8,1 s / 25,0 s | 9,1 s / 27,9 s | 8,3 s / 21,2 s |

Analiza 18 ogłoszeń (raz, potem zamrożona) kosztowała $0,018; pisanie CV $0,044 w pierwszym przebiegu, $0,034 w drugim,
$0,039 w trzecim i $0,032 w czwartym.

Porównanie z `anthropic/claude-sonnet-5.5` i `openai/gpt-6.1-sol` jest niżej, w sekcji „Porównanie modeli”.

### Co z tego wynika (przebieg 1)

- **Model nie zmyślał faktów, które łapią kontrole.** Żadna odpowiedź nie miała pozycji spoza profilu, a w żadnym CV
  nie było liczby, której nie ma w profilu (także w pułapce bez liczb).
- **Wszystkie 12 odrzuceń dotyczyło podsumowania**, nie treści: czas przeszły z rodzajem („Ukończyłam”,
  „zaprojektowałem”), 3. osoba („jest”) albo równoważnik („Absolwentka…”). W dwóch parach (02, 03) model trzy razy
  napisał podsumowanie w czasie przeszłym i CV nie powstało. Te profile mają podane zaimki, więc forma z rodzajem
  byłaby poprawna: kontrola jest tu ostrzejsza, niż trzeba, i to ona, a nie model, kosztuje 11% nieudanych CV.
- **Zakazane fakty w treści to tytuł CV.** Aplikacja z założenia przepisuje tytuł stanowiska z ogłoszenia, więc
  kandydat bez Javy dostał tytuł „Junior Java Developer”, a kurier z kat. B „Kierowca zawodowy kat. C+E”. Pozostałe
  trafienia są w podsumowaniu jako żółte sugestie do decyzji kandydata („Chcę rozwijać swoje umiejętności w Javie 17”,
  „kartę kierowcy zdobędę przed podjęciem pracy”). W punktach doświadczenia i w umiejętnościach nie było żadnego.
- **Pokrycie słów kluczowych** jest najniższe w pułapce C+E (13%), gdzie powinno, i u handlowca (35%).
  Najwyższe przy magazynierze z UDT (85%) i długim profilu e-commerce (80%).
- **Jedna strona A4 zawsze**, także przy bardzo długim profilu (raz skracany przez AI).

### Poprawka i przebieg 2

Na podstawie przebiegu 1 kontrola podsumowania przepuszcza teraz czas przeszły w 1. osobie w formie, którą kandydat
podał w profilu („Ukończyłam” dla *ona*); inny rodzaj i 2. osoba dalej wracają do modelu, a bez zaimków nic się nie
zmieniło. W przebiegu 2:

- **Wszystkie CV powstały, 17 z 18 za pierwszym podejściem.** Odrzucenia z przebiegu 1 zniknęły, bo były dokładnie tym
  przypadkiem. Zostały dwa odrzucenia 3. osoby w podsumowaniu (para 15) i jedno przy skracaniu długiego profilu
  (zgubione słowo kluczowe „Shopify”, poprawione w drugim podejściu).
- **Zakazane fakty w treści wzrosły z 2 do 8**, choć poprawka dotyczy tylko podsumowania. Tym razem model dopisał do
  listy umiejętności technologie, których profil nie ma: „Google Ads” (01), „React” i „TypeScript” (09) oraz
  „Java (w nauce)” (15). To prawdziwe przekroczenie: prompt każe brać umiejętności tylko z profilu, ale przy generowaniu
  nic tego nie sprawdza (aplikacja pokazuje tylko ostrzeżenie w edytorze). Dwa kolejne trafienia to znowu tytuły CV
  przepisane z ogłoszenia, a dwa ostatnie to uczciwe deklaracje w podsumowaniu („Chcę rozwijać się w zespole backendu
  jako programista Java”, „chcę uzyskać uprawnienia C+E”), które dopasowanie słów też liczy.
- **Ta różnica to najpewniej zmienność modelu, nie skutek poprawki**, ale jeden przebieg na wersję tego nie
  rozstrzyga. Wniosek dla programu: listę umiejętności trzeba sprawdzać względem profilu już przy generowaniu, tak jak
  pozycje i liczby, a nie liczyć na to, że model zawsze posłucha promptu.

### Kontrola umiejętności i przebieg 3

Po przebiegu 2 lista umiejętności jest sprawdzana przy pisaniu CV, przy „Popraw automatycznie” i przy wybranych
zmianach z raportu. Konkretna pozycja, której profil nie potwierdza (nazwa techniczna jak „TypeScript” czy
„Google Ads” albo umiejętność wymagana w ogłoszeniu jak „Java”), wraca do modelu, także z dopiskiem „(w nauce)”.
Przy poprawie zostaje to, co CV już miało, np. umiejętność dopisana przez kandydata. W przebiegu 3 (`5d64949`):

- **Lista umiejętności jest czysta.** Żaden zakazany fakt nie trafił do umiejętności (w przebiegu 2 były 4). Trzy
  trafienia w treści to znowu dwa tytuły CV przepisane z ogłoszenia („Junior Java Developer”, „Kierowca zestawu ciągnik
  siodłowy z naczepą (kat. C+E)”) i uczciwa deklaracja „chcę zdobyć uprawnienia C+E”. Dwie sugestie to zdanie „Nie mam
  jeszcze doświadczenia w Javie ani w Spring Boot, dlatego chcę rozwijać się w Javie 17 i Spring Boot”.
- **Kontrola była za ostra dla CV po angielsku.** W parze 14 (absolwent logistyki, ogłoszenie po angielsku) odrzuciła
  wszystkie 3 podejścia i CV nie powstało. Wynik nie zapisywał jeszcze nazw odrzuconych pozycji, ale ta wersja kontroli
  porównywała z polskim profilem całą frazę z nazwą techniczną, więc tłumaczenia jak „CMR documentation” (z „dokumenty
  CMR”) czy „TMS system” (z „system TMS”) nie miały jak przejść, a model nie może ich napisać po polsku.
- Odrzucenia za umiejętności były też w parach 05 i 17 (po jednym, CV przeszło w 2. podejściu); liczba 5 w tabeli to
  niepotwierdzone pozycje w odrzuconych podejściach, policzone jeszcze starszą funkcją.

Poprawka po przebiegu 3 (`843562d`): pozycja wraca do modelu tylko wtedy, gdy ma nazwę, której profil nie ma (skrót,
nazwa techniczna, w CV po polsku też słowo z wielkiej litery w środku, jak „Ads” w „Google Ads”), albo gdy jest
narzędziem lub nazwą z ogłoszenia. „CMR documentation” i „Obsługa systemu TMS” przechodzą, gdy profil ma „CMR” i „TMS”;
pozostałe niepotwierdzone pozycje pokazuje tylko ostrzeżenie w edytorze. Wynik zapisuje teraz nazwy odrzuconych
umiejętności (ostatnia kolumna tabeli dla każdej pary).

### Przebieg 4 (po poprawce kontroli umiejętności)

- **Wszystkie CV powstały, 16 z 18 za pierwszym podejściem.** Para 14 (CV po angielsku) przeszła od razu, z pokryciem
  słów kluczowych 65%.
- **Kontrola złapała dokładnie to, co w przebiegu 2 przeszło:** „Google Ads” (01) oraz „React” i „TypeScript” (09).
  W obu parach drugie podejście miało już listę bez nich. Innych odrzuceń za umiejętności nie było.
- **Zakazane fakty jak w przebiegu 3:** w treści dwa tytuły CV z ogłoszenia i deklaracja „uzupełniając uprawnienia C+E”
  w podsumowaniu, w sugestiach zdanie „Chciałbym rozwijać kompetencje backendowe w Javie 17 i Spring Boot”.
  W umiejętnościach i punktach doświadczenia nie ma żadnego.
- **Nowy problem, niezwiązany z kontrolą umiejętności:** długi profil (17) po skracaniu przez AI zajął 2 strony.
  Skracanie jest jedno i potem nikt nie sprawdza liczby stron; w przebiegach 1-3 to jedno podejście wystarczało.
  Kontrola umiejętności przy skracaniu nie odrzuca pozycji, które CV już miało, więc skracania nie blokuje.
  Po przebiegu 4 AI skraca drugi raz, od skróconej wersji, gdy CV dalej wystaje (`bff5955`); wynik zapisuje, ile
  razy skracało (w tabeli dla każdej pary „skrócone 2 razy”). Sprawdzenie samej pary 17 po tej zmianie
  ([wynik](results/2026-11-10_anthropic_claude-haiku-5.5_skracanie-17.md), $0,005): jedno skracanie wystarczyło i CV
  zmieściło się na stronie, więc drugie się nie uruchomiło. Na prawdziwym modelu drugie skracanie jest więc dalej
  niesprawdzone, a testy pokazują je tylko na atrapie.

### Tytuł CV jako sugestia (pary 15 i 18)

We wszystkich czterech przebiegach zakazane fakty w treści to głównie tytuły przepisane z ogłoszenia („Junior Java
Developer” bez Javy, „Kierowca… kat. C+E” przy kat. B). Od commita `a415fae` tytuł, który wymienia narzędzie,
certyfikat albo nazwaną umiejętność z ogłoszenia, której profil nie potwierdza, albo kategorię prawa jazdy, staje się
żółtą sugestią, a w CV zostaje wersja bezpieczna (bez tej nazwy albo tytuł z profilu). Sprawdzenie na samych parach 15
i 18 ([wynik](results/2026-11-10_anthropic_claude-haiku-5.5_tytul.md), $0,004; data w pliku to data UTC, przebieg był
11.11.2026 tuż po północy):

| Para | Zakazane fakty w treści: przebiegi 1 / 2 / 3 / 4 | Po zmianie | Gdzie są teraz |
|---|---|---|---|
| 15 (Java) | 1 / 3 / 1 / 1 | 0 | „Junior Java Developer” tylko w sugestii tytułu |
| 18 (C+E) | 1 / 2 / 2 / 2 | 0 | „Kierowca zestawu ciągnik siodłowy z naczepą (kat. C+E)” tylko w sugestii tytułu |

- W obu parach jedyny zakazany fakt jest w sugestii, którą kandydat musi zatwierdzić; deklaracji w podsumowaniu tym
  razem nie było (to zmienność modelu, nie skutek zmiany).
- W parze 15 kontrola umiejętności odrzuciła pierwsze podejście za „Java 17 (do nauki)”, „Spring Boot (do nauki)” i
  „Kubernetes (podstawy)”; drugie było już bez nich.
- Pokrycie słów kluczowych w parze 18 spadło z 45% do 35%: tytuł bezpieczny nie ma „kat. C+E”, a ocena liczy
  oczekującą sugestię w wersji bezpiecznej. To uczciwy wynik dla kandydata z kat. B; po zaakceptowaniu tytułu słowo wraca.
- Dwie pary to tylko sprawdzenie działania, nie pomiar: pełny przebieg z tą zmianą to porównanie modeli niżej.

## Porównanie modeli: 11.11.2026

Pełne przebiegi 18 par na tych samych zamrożonych ogłoszeniach (data w plikach to data UTC, 2026-11-10), z kodem z
commita `a415fae`, czyli z kontrolą umiejętności, sugestią tytułu i drugim skracaniem. Modele:
`anthropic/claude-sonnet-5.5` (domyślny model pisania w `server/storage/store.ts`) i `openai/gpt-6.1-sol` (inny dostawca
w tej samej cenie za token: $2 / $10 za 1M tokenów wejścia / wyjścia na OpenRouter, sprawdzone 11.11.2026). Dla
`anthropic/claude-haiku-5.5` ($0,10 / $0,50) tabela bierze przebieg 4 sprzed sugestii tytułu, więc jego 2 z 3 zakazanych
faktów w treści to tytuły, które dziś byłyby sugestią (zob. sprawdzenie par 15 i 18 wyżej). Szczegóły:
[Sonnet](results/2026-11-10_anthropic_claude-sonnet-5.5.md), [GPT](results/2026-11-10_openai_gpt-6.1-sol.md),
[Haiku](results/2026-11-10_anthropic_claude-haiku-5.5_poprawka-umiejetnosci.md); wszystkie przebiegi naraz:
`npm run eval -- --report`.

| Miara | `anthropic/claude-haiku-5.5` | `anthropic/claude-sonnet-5.5` | `openai/gpt-6.1-sol` |
|---|---|---|---|
| CV przyjęte w 1. / 2. / 3. podejściu | 89% / 11% / 0% | 100% / 0% / 0% | 100% / 0% / 0% |
| Nie powstało | 0% | 0% | 0% |
| Odrzucenia: bez źródła / umiejętności | 0 / 3 | 0 / 0 | 0 / 0 |
| Liczby spoza profilu zamienione w sugestie | 0 | 0 | 0 |
| Pokrycie słów kluczowych (jak w ocenie ATS) | 58% | 59% | 56% |
| CV na jednej stronie A4 | 94% (1 skrócone, ale na 2 strony) | 100% (1 skrócone) | 100% (bez skracania) |
| Zakazane fakty: w treści / w sugestiach | 3 / 2 | 1 / 2 | 0 / 0 |
| Koszt na CV | $0,0018 | $0,0311 | $0,0179 |
| Czas na CV (średnio / najdłużej) | 8,3 s / 21,2 s | 9,6 s / 26,6 s | 12,6 s / 19,9 s |

Przebieg Sonneta kosztował $0,56, GPT $0,32 (razem $0,88, mniej niż szacowane $1,5-3).

- **Sonnet i GPT nie potrzebowały żadnej poprawki:** każde CV przeszło kontrole za pierwszym razem. Haiku w 2 parach
  dopisał umiejętności spoza profilu (Google Ads, React, TypeScript) i dopiero kontrola kazała je usunąć.
- **Zakazane fakty.** U Sonneta jedyny „fakt” to uczciwa deklaracja w podsumowaniu pary 15 („Chcę rozwijać się w
  kierunku Javy”), a dwa tytuły z ogłoszenia (Java, C+E) czekają w sugestiach. GPT w ogóle nie przepisał tych tytułów
  i nie wspomniał tych nazw nawet w podsumowaniu.
- **Pokrycie słów kluczowych jest podobne** (56-59%), z różnicami w pojedynczych parach. GPT najrzadziej używa słów z
  ogłoszenia tam, gdzie kandydat ich nie ma: w pułapce Java ma 30% (Sonnet 55%), w pułapce C+E 5% (Sonnet 10%,
  Haiku 45%, ale u Haiku z tytułem „kat. C+E” jako faktem). Najwięcej zyskuje Sonnet u nauczycielki przechodzącej do HR
  (48% wobec 38% u Haiku) i u handlowca (45% wobec 30-35%).
- **Koszt i czas.** Sonnet jest ok. 17 razy droższy od Haiku na CV, GPT ok. 10 razy; GPT jest najwolniejszy, ale CV
  długiego profilu (17) zmieścił na stronie bez skracania.
- **Drugie skracanie nie zadziałało w żadnym przebiegu:** Sonnet skrócił CV długiego profilu raz i zmieściło się na
  stronie, GPT nie skracał wcale. Na prawdziwym modelu drugie skracanie jest więc dalej niesprawdzone.
- To po jednym przebiegu na model na 18 parach: różnica kilku punktów procentowych w pokryciu albo jeden zakazany
  fakt to w granicach zmienności (zob. ograniczenia niżej).

## Ograniczenia

- **Mały zbiór.** 18 par to za mało, żeby różnice o kilka punktów procentowych coś znaczyły; jedna para to 6%.
- **Dane przygotował autor narzędzia.** Profile i ogłoszenia mogą nieświadomie pasować do tego, co PolCV robi dobrze.
  Nie są to prawdziwe CV ani ogłoszenia.
- **Jeden przebieg na wersję.** Model pisze z temperaturą 0,4, więc kolejny przebieg da inne liczby; przebiegi 1 i 2
  powyżej różnią się np. liczbą zakazanych faktów w umiejętnościach (0 i 4). Wyniki nie mają przedziałów ufności.
- **Metryki są automatyczne.** Nie oceniają, czy CV dobrze się czyta i czy rekruter zaprosiłby kandydata.
  Pokrycie słów kluczowych zależy też od jakości jednorazowej analizy ogłoszeń przez Haiku.
- **Zakazane fakty to dopasowanie słów.** Złapie też uczciwą deklarację („chcę się nauczyć Javy”), dlatego wynik
  podaje, gdzie i w jakiej formie fakt się pojawił, a tabela dla każdej pary pokazuje to miejsce.

## Próbna rozmowa

`npm run eval -- --interview --model <id>` (z `--mock` na atrapie, bez kosztów; `--cases 01,09` zawęża) przeprowadza
próbne rozmowy przez ten sam kod co aplikacja (`server/mockInterview.ts`): plan pytań, ocena każdej odpowiedzi,
dopytanie, podsumowanie. W CI działa tylko atrapa (`tests/evalInterview.test.ts`).

**Zbiór.** 6 fikcyjnych kandydatów w `interview/cases/`: każdy bierze profil i zamrożone ogłoszenie z pary w `cases/`
(01 marketing, 03 analiza danych, 05 mechanik, 07 księgowość, 09 frontend po angielsku, 12 handlowiec) i ma gotowe
odpowiedzi według rodzaju pytania z planu: dobrą z liczbami z profilu, ogólnikową (z odpowiedzią na dopytanie), z błędem
merytorycznym (np. „anonimizację nakazuje AI Act”, „stawka VAT to 25%”, „TypeScript sprawdza przeglądarka”),
przechwałkę bez pokrycia w profilu i zbyt długą. CV to wierna kopia profilu bez AI, bo oceniamy odpowiedzi, a nie CV.

**Miary:**

| Miara | Jak |
|---|---|
| Ogólnikowa odpowiedź dostała dopytanie | czy po odpowiedzi „ogólnikowej” rekruter zadał dopytanie |
| Błąd merytoryczny wskazany | czy ocena odpowiedzi z błędem ma co najmniej jeden `factualErrors` |
| Dobra wyżej niż ogólnikowa | w ilu rozmowach średni wynik dobrych odpowiedzi jest wyższy niż ogólnikowych |
| Wymyślone fakty w mocniejszych wersjach | liczone niezależnie od kontroli w kodzie: zakazane nazwy z listy przypadku (z odmianą) i liczby spoza profilu, CV i odpowiedzi kandydata, bez miejsc w nawiasach |
| Odrzucone odpowiedzi modelu | ile razy kontrole (plan, mocniejsza wersja, dopytanie) kazały modelowi poprawić odpowiedź |
| Koszt i czas jednej rozmowy | koszt z zapisu zużycia (zadanie „próbna rozmowa”), czas od planu do podsumowania |

### Przebieg 1: 11.11.2026, `anthropic/claude-haiku-5.5`

Kod z commita `565765b`, [szczegóły](results/2026-11-11_anthropic_claude-haiku-5.5_interview.md). Miarę „dobra
odpowiedź dostała dopytanie” dopisałem po przebiegu i policzyłem z zapisanych danych, bez nowych wywołań.

| Miara | Wynik |
|---|---|
| Rozmowy zakończone | 5 z 6 |
| Ogólnikowa odpowiedź dostała dopytanie | 5 z 5 |
| Dobra odpowiedź dostała dopytanie (powinno być 0) | 20 z 21 |
| Błąd merytoryczny wskazany | 5 z 5 |
| Dobra odpowiedź oceniona wyżej niż ogólnikowa | 5 z 5 rozmów |
| Średni wynik: dobra / ogólnikowa / z błędem / przechwałka / zbyt długa | 2,2 / 1,8 / 1,2 / 1,0 / 2,6 |
| Kryterium długości: dobra / zbyt długa | 1,2 / 3,4 |
| Wymyślone fakty w mocniejszych wersjach | 2 („B2B” w odpowiedzi na pytanie o brak, para 12) |
| Odpowiedzi modelu odrzucone przez kontrole | 14 |
| Koszt / czas jednej rozmowy | $0,028 / 105 s (razem $0,14) |

Co działa: każdy błąd merytoryczny (AI Act, stawka VAT, płyn hamulcowy, marża i narzut, konwersja w GA4) został
wskazany, przechwałki dostały najniższy wynik, a kontrola zatrzymała w mocniejszych wersjach m.in. „Google Ads”,
„Next.js” i „hurtownię danych”, których kandydaci nie mieli. Plan trzy razy wrócił do modelu (brak pytania po
angielsku, 9 pytań, brak pytania o narzędzia) i za każdym razem został poprawiony.

Co nie działa (poprawki opisane niżej):

- **Dopytanie prawie zawsze.** Haiku dopytywał po 20 z 21 dobrych odpowiedzi, więc „ogólnikowa dostała dopytanie” nic
  nie znaczy. Specyfikacja mówi o dopytaniu tylko przy odpowiedzi ogólnikowej.
- **Kryterium długości odwrócone.** Zwięzłe dobre odpowiedzi (40-70 słów) dostały za długość średnio 1,2, a zbyt długie
  (ok. 250 słów) 3,4. Przez to zbyt długie miały wyższy średni wynik niż dobre.
- **Rozmowa 09 (po angielsku) się przerwała.** Mocniejsza wersja pierwszej odpowiedzi trzy razy wymieniała React,
  TypeScript i Next.js z ogłoszenia (kandydat ich nie ma), kontrola trzy razy ją odrzuciła i ocena się nie udała.
- **Fałszywy alarm.** „GA4” zostało odrzucone, choć profil ma „Google Analytics 4” (ogłoszenie podaje je jako
  synonim); kontrola nazw nie brała synonimów z ogłoszenia. Odrzucała też pojęcia z dziedziny w odpowiedziach
  sytuacyjnych („CTR”, „CPC”).
- „B2B” liczę jako wymyślony fakt według listy przypadku, ale padło w pytaniu o brak, gdzie nazwy z dziedziny są
  dozwolone; zapis nie miał jeszcze treści mocniejszych wersji, więc nie da się sprawdzić, czy to deklaracja, czy
  przypisanie doświadczenia (od teraz wynik zapisuje te teksty).
