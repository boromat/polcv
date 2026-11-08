"""Mostek PolCV <-> polanon (https://github.com/boromat/polanon).

Serwer Node uruchamia ten skrypt tylko wtedy, gdy w Ustawieniach włączono maskowanie danych osobowych.
Każde zapytanie i każda odpowiedź to jedna linia JSON:

    {"id": 1, "op": "mask", "text": "...", "terms": [...]} -> {"id": 1, "text": "...", "mapping": {...}}
    {"id": 2, "op": "restore", "texts": [...], "mapping": {...}} -> {"id": 2, "texts": [...]}

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
        from polanon import Anonymizer, default_guards
    except ImportError as exc:
        return fail(f"brak pakietu polanon ({exc})")

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
    send({"ready": True, "version": polanon.__version__, "ner": ner})

    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        try:
            if request["op"] == "mask":
                terms = request.get("terms") or []
                masker = Anonymizer([*guards, profile_guard(terms)], **options) if terms else anonymizer
                result = masker.anonymize_sync(request["text"])
                reply = {"text": result.anonymized, "mapping": result.mapping}
            elif request["op"] == "restore":
                mapping = request["mapping"]
                reply = {"texts": [Anonymizer.restore(t, mapping) for t in request["texts"]]}
            else:
                reply = {"error": f"nieznana operacja {request['op']!r}"}
        except Exception as exc:  # noqa: BLE001 - błąd jednego zapytania nie zatrzymuje mostka
            reply = {"error": f"{type(exc).__name__}: {exc}"}
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
