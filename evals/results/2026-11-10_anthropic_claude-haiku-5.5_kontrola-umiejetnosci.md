# Ewaluacja: anthropic/claude-haiku-5.5 (kontrola-umiejetnosci)

Data: 2026-11-10. Model pisania CV: `anthropic/claude-haiku-5.5`. Analiza ogłoszeń: `anthropic/claude-haiku-5.5`. Przypadków: 18.

| Miara | Wynik |
|---|---|
| CV przyjęte w 1. / 2. / 3. podejściu | 78% / 11% / 6% |
| Nie powstało (3 odrzucone podejścia albo błąd) | 6% |
| Wpisy bez źródła w profilu odrzucone przez kontrolę | 0 (w 0 przypadkach) |
| Umiejętności spoza profilu odrzucone przez kontrolę | 5 |
| Liczby spoza profilu zamienione w sugestie | 2 (w 2 CV) |
| Pokrycie słów kluczowych (jak w ocenie ATS) | 55% |
| CV na jednej stronie A4 | 100% (skracane przez AI: 1) |
| Zakazane fakty w treści CV / tylko w sugestiach | 3 / 2 (sprawdzane w 5 przypadkach) |
| Koszt na CV / razem | $0.0021 / $0.0388 |
| Czas na CV (średnio / najdłużej) | 9.1 s / 27.9 s |

| Przypadek | Podejście | Odrzucone: bez źródła / umiejętności / styl / szkoła / format | Liczby spoza profilu | Słowa kluczowe | Strony | Koszt | Czas | Zakazane fakty |
|---|---|---|---|---|---|---|---|---|
| 01-marketing-studentka | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 60% (10/17) | 1 | $0.0015 | 7.9 s | brak |
| 02-python-student | 3 | 0 / 0 / 2 / 0 / 0 | 0 | 53% (7/14) | 1 | $0.0044 | 17.7 s | brak |
| 03-analityczka-danych | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 57% (10/16) | 1 | $0.0015 | 7.9 s |  |
| 04-nauczycielka-do-hr | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 40% (8/16) | 1 | $0.0015 | 7.0 s |  |
| 05-mechanik-samochodowy | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 70% (9/13) | 1 | $0.0030 | 11.8 s |  |
| 06-magazynier-udt | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 85% (11/14) | 1 | $0.0014 | 7.2 s |  |
| 07-ksiegowosc-studentka | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 70% (9/14) | 1 | $0.0014 | 5.9 s |  |
| 08-kelner-do-obslugi-klienta | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 65% (12/17) | 1 | $0.0015 | 7.7 s |  |
| 09-frontend-en | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 48% (8/15) | 1 | $0.0015 | 8.1 s | brak |
| 10-graficzka-junior | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 68% (10/15) | 1 | $0.0014 | 6.7 s |  |
| 11-elektryk-utrzymanie-ruchu | 1 | 0 / 0 / 0 / 0 / 0 | 1 | 48% (7/14) | 1 | $0.0013 | 6.0 s |  |
| 12-handlowiec-student | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 35% (6/14) | 1 | $0.0013 | 6.0 s |  |
| 13-opiekunka-medyczna | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 40% (7/14) | 1 | $0.0015 | 6.8 s |  |
| 14-logistyka-en | nie (Model anthropic/claude-haiku-5.5 zwrócił dane w złym formaci) | 0 / 3 / 0 / 0 / 0 | 0 | - (0/16) | - | $0.0039 | 15.0 s |  |
| 15-pulapka-java | 1 | 0 / 0 / 0 / 0 / 0 | 1 | 43% (5/11) | 1 | $0.0013 | 6.1 s | Java (fakt, headline); Java (sugestia, summary); Spring Boot (sugestia, summary) |
| 16-pulapka-bez-liczb | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 53% (8/13) | 1 | $0.0013 | 6.1 s |  |
| 17-pulapka-dlugi-profil | 2 | 0 / 1 / 0 / 0 / 0 | 0 | 78% (12/14) | 1 (skrócone) | $0.0079 | 27.9 s |  |
| 18-pulapka-kierowca-ce | 1 | 0 / 0 / 0 / 0 / 0 | 0 | 30% (5/13) | 1 | $0.0013 | 7.1 s | kat. C+E (fakt, headline); kat. C+E (fakt, summary) |
