"""Mostek PolCV <-> polanon (https://github.com/boromat/polanon).

Serwer Node uruchamia ten skrypt tylko wtedy, gdy w Ustawieniach włączono maskowanie danych osobowych.
Każde zapytanie i każda odpowiedź to jedna linia JSON:

    {"id": 1, "op": "mask", "text": "...", "terms": [...]} -> {"id": 1, "text": "...", "mapping": {...}}
    {"id": 2, "op": "restore", "texts": [...], "mapping": {...}} -> {"id": 2, "texts": [...]}

Po starcie mostek wysyła {"ready": true, ..., "notes": {"pl": "...", "en": "..."}}: notkę polanonu o tokenach
(token_instructions) do promptu systemowego, po polsku i po angielsku.

Maskowanie kończy ostatnia kontrola polanonu (leaked_tokens): gdy w zamaskowanym tekście została któraś wartość
z mapowania, odpowiedź to {"id": 1, "leaked": ["<OSOBA_1>"]}, bez tekstu i bez wartości. Błąd zapytania to
{"id": 1, "error": "KeyError"}: sama nazwa wyjątku, bo jego treść potrafi zacytować kawałek CV.

Mapowanie tokenów żyje w pamięci serwera przez czas jednego wywołania AI i nie jest nigdzie zapisywane.
Z argumentem --status skrypt tylko wypisuje, co jest zainstalowane, i kończy działanie.
"""

import importlib.util
import json
import re
import sys

#: Typy danych kandydata, które PolCV podaje z profilu. LINK (token <LINK_1>) jest w polanonie
#: wbudowany od wersji po 0.2.1, a w starszych to typ własny tego strażnika; ADDRESS to ulica z pola
#: z miejscowością, zapisana bez "ul." i bez kodu pocztowego, której reguły nie rozpoznają.
PROFILE_TYPES = frozenset({"PERSON", "EMAIL", "PHONE", "LINK", "ADDRESS"})


def profile_guard(terms: list[dict]):
    """Strażnik z danymi kandydata z profilu: maskuje je zawsze, także tam, gdzie reguły ich nie widzą.

    Reguły polanonu nie rozpoznają np. nazwiska w linku (linkedin.com/in/jan-kowalski) ani imienia
    spoza listy polskich imion - dane z profilu są znane, więc maskujemy je dosłownie.
    """
    from polanon import Guard, Span

    class ProfileGuard(Guard):
        name = "cv_profile"
        entity_types = frozenset({"LINK"})

        def __init__(self) -> None:
            self.patterns = []
            for term in terms:
                kind, text = term.get("type"), str(term.get("text", "")).strip()
                if kind not in PROFILE_TYPES or len(text) < 3:
                    continue
                if kind == "LINK":
                    core = re.sub(r"^(?:https?://)?(?:www\.)?", "", text, flags=re.IGNORECASE).rstrip("/")
                    pattern = r"(?:https?://)?(?:www\.)?" + re.escape(core) + r"/?"
                else:
                    pattern = r"\s+".join(re.escape(word) for word in text.split())
                self.patterns.append((kind, re.compile(rf"(?<!\w){pattern}(?!\w)", re.IGNORECASE)))

        def detect(self, text: str, enabled: set[str]) -> list:
            return [
                Span(m.start(), m.end(), kind, 1.0, self.name)
                for kind, pattern in self.patterns
                if kind in enabled
                for m in pattern.finditer(text)
            ]

    return ProfileGuard()


def main() -> int:
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    if "--status" in sys.argv[1:]:
        return status()

    try:
        import polanon
    except ImportError as exc:
        return fail(f"brak pakietu polanon ({exc})")
    try:
        # token_instructions jest w polanonie od 0.4.0, leaked_tokens od 0.4.2. Serwer sprawdza numer wersji
        # (PolCV potrzebuje 0.4.3) przed uruchomieniem mostka; to na wypadek numeru, którego nie odczytał.
        from polanon import Anonymizer, default_guards, leaked_tokens, token_instructions
    except ImportError:
        return fail(f"polanon {getattr(polanon, '__version__', '?')} jest za stary, zaktualizuj go w Ustawieniach")

    ner = "--ner" in sys.argv[1:]
    try:
        guards = default_guards(with_ner=ner)
    except (ImportError, OSError) as exc:  # spaCy albo model pl_core_news_md nie jest zainstalowany
        return fail(f"brak spaCy albo modelu pl_core_news_md ({exc})")
    options = {}
    if ner:
        # Model językowy oznacza "Google Ads" czy "Python" jako nazwy własne - te zostają czytelne.
        from polanon import WELL_KNOWN_NAMES, Allowlist

        options["allowlist"] = Allowlist(WELL_KNOWN_NAMES)
    anonymizer = Anonymizer(guards, **options)
    notes = {language: token_instructions(language) for language in ("pl", "en")}
    send({"ready": True, "version": polanon.__version__, "ner": ner, "notes": notes})

    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        try:
            if request["op"] == "mask":
                terms = request.get("terms") or []
                masker = Anonymizer([*guards, profile_guard(terms)], **options) if terms else anonymizer
                result = masker.anonymize_sync(request["text"])
                # Ostatnia kontrola, zanim tekst wyjdzie do AI: czy żadna zamaskowana wartość nie została w tekście.
                leaked = leaked_tokens(result.anonymized, result.mapping)
                reply = {"leaked": leaked} if leaked else {"text": result.anonymized, "mapping": result.mapping}
            elif request["op"] == "restore":
                mapping = request["mapping"]
                reply = {"texts": [Anonymizer.restore(t, mapping) for t in request["texts"]]}
            else:
                reply = {"error": f"nieznana operacja {request['op']!r}"}
        except Exception as exc:  # noqa: BLE001 - błąd jednego zapytania nie zatrzymuje mostka
            # Sama nazwa wyjątku, jak w MaskedTurn polanonu: treść (np. KeyError: 'Kowalski') potrafi cytować CV.
            reply = {"error": type(exc).__name__}
        reply["id"] = request.get("id")
        send(reply)
    return 0


def status() -> int:
    info = {"python": sys.version.split()[0], "polanon": None, "spacy": False, "model": False}
    try:
        import polanon

        info["polanon"] = polanon.__version__
    except ImportError:
        pass
    info["spacy"] = importlib.util.find_spec("spacy") is not None
    info["model"] = importlib.util.find_spec("pl_core_news_md") is not None
    send(info)
    return 0


def fail(message: str) -> int:
    send({"ready": False, "error": message})
    return 3


def send(message: dict) -> None:
    print(json.dumps(message, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    sys.exit(main())
