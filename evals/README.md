# Ewaluacja jakości generowania CV

Testy w `tests/` sprawdzają, że kod działa. Ten folder mierzy coś innego: jak dobrze model pisze CV, które przechodzi
kontrole PolCV, trzyma się profilu i pasuje do ogłoszenia.

## Jak uruchomić

```bash
npm run eval -- --model anthropic/claude-haiku-5.5   # wymaga zmiennej OPENROUTER_API_KEY, kosztuje
npm run eval -- --mock                              # atrapa modelu, bez kosztów (sprawdza skrypt, nie model)
npm run eval -- --report                            # tabela porównawcza wszystkich wyników z results/
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
kodzie z commita `a4e6a78`, 2. po poprawce kontroli podsumowania (`99479d7`), 3. z nową kontrolą listy umiejętności
(`8a17c49`), 4. po poprawce tej kontroli (`a37857b`); opisy niżej. Szczegóły dla każdej pary:
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

Porównania z innymi modelami jeszcze nie ma: przebiegi objęły tylko model używany na co dzień. Skrypt jest
gotowy (`npm run eval -- --model <id>`, potem `--report`), a dla wybranego zestawu trzech modeli koszt szacowany był
na ok. $1.

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
Przy poprawie zostaje to, co CV już miało, np. umiejętność dopisana przez kandydata. W przebiegu 3 (`8a17c49`):

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

Poprawka po przebiegu 3 (`a37857b`): pozycja wraca do modelu tylko wtedy, gdy ma nazwę, której profil nie ma (skrót,
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
