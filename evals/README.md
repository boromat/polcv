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
| Odrzucenia: bez źródła / styl / szkoła / format | te same kontrole, które odrzuciły odpowiedź (`sourceIssues`, `styleIssues`, `educationIssues` z `cvChecks.ts`) |
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
domyślnie do pisania jest ustawiony `anthropic/claude-sonnet-5.5`). Jeden przebieg, 18 par. Szczegóły dla każdej pary:
[`results/2026-11-10_anthropic_claude-haiku-5.5.md`](results/2026-11-10_anthropic_claude-haiku-5.5.md).

| Miara | `anthropic/claude-haiku-5.5` |
|---|---|
| CV przyjęte w 1. / 2. / 3. podejściu | 61% / 22% / 6% |
| Nie powstało (3 odrzucone podejścia) | 11% (2 z 18) |
| Wpisy bez źródła w profilu odrzucone przez kontrolę | 0 |
| Liczby spoza profilu zamienione w sugestie | 0 |
| Pokrycie słów kluczowych (jak w ocenie ATS) | 56% |
| CV na jednej stronie A4 | 100% (1 skrócone przez AI) |
| Zakazane fakty: w treści / w sugestiach | 2 / 5 |
| Koszt na CV | $0,0022 (razem $0,044 za pisanie i $0,018 za analizę 18 ogłoszeń) |
| Czas na CV | średnio 8,9 s, najdłużej 17,3 s |

Porównania z innymi modelami jeszcze nie ma: pierwszy przebieg objął tylko model używany na co dzień. Skrypt jest
gotowy (`npm run eval -- --model <id>`, potem `--report`), a dla wybranego zestawu trzech modeli koszt szacowany był
na ok. $1.

### Co z tego wynika

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

## Ograniczenia

- **Mały zbiór.** 18 par to za mało, żeby różnice o kilka punktów procentowych coś znaczyły; jedna para to 6%.
- **Dane przygotował autor narzędzia.** Profile i ogłoszenia mogą nieświadomie pasować do tego, co PolCV robi dobrze.
  Nie są to prawdziwe CV ani ogłoszenia.
- **Jeden przebieg.** Model pisze z temperaturą 0,4, więc kolejny przebieg da trochę inne liczby. Wyniki nie mają
  przedziałów ufności.
- **Metryki są automatyczne.** Nie oceniają, czy CV dobrze się czyta i czy rekruter zaprosiłby kandydata.
  Pokrycie słów kluczowych zależy też od jakości jednorazowej analizy ogłoszeń przez Haiku.
- **Zakazane fakty to dopasowanie słów.** Złapie też uczciwą deklarację („chcę się nauczyć Javy”), dlatego wynik
  podaje, gdzie i w jakiej formie fakt się pojawił, a tabela dla każdej pary pokazuje to miejsce.
