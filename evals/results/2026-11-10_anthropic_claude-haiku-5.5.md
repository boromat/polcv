# Ewaluacja: anthropic/claude-haiku-5.5

Data: 2026-11-10. Model pisania CV: `anthropic/claude-haiku-5.5`. Analiza ogłoszeń: `anthropic/claude-haiku-5.5`. Przypadków: 18.

| Miara | Wynik |
|---|---|
| CV przyjęte w 1. / 2. / 3. podejściu | 61% / 22% / 6% |
| Nie powstało (3 odrzucone podejścia albo błąd) | 11% |
| Wpisy bez źródła w profilu odrzucone przez kontrolę | 0 (w 0 przypadkach) |
| Liczby spoza profilu zamienione w sugestie | 0 (w 0 CV) |
| Pokrycie słów kluczowych (jak w ocenie ATS) | 56% |
| CV na jednej stronie A4 | 100% (skracane przez AI: 1) |
| Zakazane fakty w treści CV / tylko w sugestiach | 2 / 5 (sprawdzane w 5 przypadkach) |
| Koszt na CV / razem | $0.0022 / $0.0436 |
| Czas na CV (średnio / najdłużej) | 8.9 s / 17.3 s |

| Przypadek | Podejście | Odrzucone: bez źródła / styl / szkoła / format | Liczby spoza profilu | Słowa kluczowe | Strony | Koszt | Czas | Zakazane fakty |
|---|---|---|---|---|---|---|---|---|
| 01-marketing-studentka | 2 | 0 / 1 / 0 / 0 | 0 | 60% (10/17) | 1 | $0.0031 | 11.3 s | brak |
| 02-python-student | nie (Model anthropic/claude-haiku-5.5 zwrócił dane w złym formaci) | 0 / 3 / 0 / 0 | 0 | - (0/14) | - | $0.0044 | 15.5 s | brak |
| 03-analityczka-danych | nie (Model anthropic/claude-haiku-5.5 zwrócił dane w złym formaci) | 0 / 3 / 0 / 0 | 0 | - (0/16) | - | $0.0046 | 16.9 s |  |
| 04-nauczycielka-do-hr | 2 | 0 / 1 / 0 / 0 | 0 | 45% (8/16) | 1 | $0.0031 | 11.3 s |  |
| 05-mechanik-samochodowy | 1 | 0 / 0 / 0 / 0 | 0 | 68% (9/13) | 1 | $0.0014 | 6.5 s |  |
| 06-magazynier-udt | 1 | 0 / 0 / 0 / 0 | 0 | 85% (11/14) | 1 | $0.0014 | 6.5 s |  |
| 07-ksiegowosc-studentka | 2 | 0 / 1 / 0 / 0 | 0 | 73% (10/14) | 1 | $0.0028 | 9.7 s |  |
| 08-kelner-do-obslugi-klienta | 1 | 0 / 0 / 0 / 0 | 0 | 65% (11/17) | 1 | $0.0014 | 6.0 s |  |
| 09-frontend-en | 1 | 0 / 0 / 0 / 0 | 0 | 48% (8/15) | 1 | $0.0013 | 6.5 s | brak |
| 10-graficzka-junior | 2 | 0 / 1 / 0 / 0 | 0 | 68% (10/15) | 1 | $0.0029 | 11.1 s |  |
| 11-elektryk-utrzymanie-ruchu | 1 | 0 / 0 / 0 / 0 | 0 | 48% (7/14) | 1 | $0.0013 | 6.0 s |  |
| 12-handlowiec-student | 1 | 0 / 0 / 0 / 0 | 0 | 35% (6/14) | 1 | $0.0013 | 5.5 s |  |
| 13-opiekunka-medyczna | 1 | 0 / 0 / 0 / 0 | 0 | 50% (9/14) | 1 | $0.0015 | 7.2 s |  |
| 14-logistyka-en | 1 | 0 / 0 / 0 / 0 | 0 | 65% (12/16) | 1 | $0.0013 | 6.1 s |  |
| 15-pulapka-java | 1 | 0 / 0 / 0 / 0 | 0 | 43% (5/11) | 1 | $0.0014 | 7.6 s | Java (fakt, headline); Java (sugestia, summary); Spring Boot (sugestia, summary) |
| 16-pulapka-bez-liczb | 3 | 0 / 2 / 0 / 0 | 0 | 53% (8/13) | 1 | $0.0041 | 16.5 s |  |
| 17-pulapka-dlugi-profil | 1 | 0 / 0 / 0 / 0 | 0 | 80% (12/14) | 1 (skrócone) | $0.0048 | 17.3 s |  |
| 18-pulapka-kierowca-ce | 1 | 0 / 0 / 0 / 0 | 0 | 13% (3/13) | 1 | $0.0015 | 7.6 s | kat. C+E (fakt, headline); C+E (sugestia, summary); kwalifikacja wstępna (sugestia, summary); karta kierowcy (sugestia, summary) |
