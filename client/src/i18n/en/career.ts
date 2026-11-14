/** Angielskie tłumaczenia: career. Klucz to polski tekst z kodu. */
export const career: Record<string, string> = {
  // components/ui.tsx: komponenty wspólne
  'AI pracuje - zwykle trwa to 15-60 sekund.': 'The AI is working, this usually takes 15-60 seconds.',
  'Jeszcze pracuję - to może potrwać do ok. 3 minut. Nie zamykaj tej strony.': 'Still working, this can take up to about 3 minutes. Please do not close this page.',
  Zamknij: 'Close',
  'brak oceny': 'not scored',

  // components/ui.tsx: STATUS_LABELS (tłumaczone tam, gdzie są wyświetlane)
  Szkic: 'Draft',
  Przygotowane: 'Prepared',
  Wysłane: 'Sent',
  Rozmowa: 'Interview',
  Odrzucone: 'Rejected',
  Oferta: 'Offer',

  // components/ui.tsx: SECTION_LABELS
  Podsumowanie: 'Summary',
  Doświadczenie: 'Experience',
  Projekty: 'Projects',
  Wykształcenie: 'Education',
  Umiejętności: 'Skills',
  'Certyfikaty i kursy': 'Certificates and courses',
  Języki: 'Languages',
  Zainteresowania: 'Interests',

  // components/ui.tsx: TEMPLATES
  Nowoczesny: 'Modern',
  Klasyczny: 'Classic',
  Kompaktowy: 'Compact',
  'Granatowe akcenty, czytelny': 'Navy accents, easy to read',
  'Czarno-biały, elegancki': 'Black and white, elegant',
  'Więcej treści na stronie': 'More content per page',

  // HistoryPage
  'Usunąć aplikację „{title}” z historii?': 'Remove the application "{title}" from your history?',
  'Historia aplikacji': 'Application history',
  '1 aplikacja · koszt AI łącznie {cost}': '1 application · total AI cost {cost}',
  '{n} aplikacji · koszt AI łącznie {cost}': '{n} applications · total AI cost {cost}',
  'Jeszcze nic tu nie ma': 'Nothing here yet',
  'Wklej link do pierwszego ogłoszenia, a program przygotuje CV pod nie.':
    'Paste a link to your first job posting and the app will prepare a CV for it.',
  'Zrób pierwsze CV': 'Make your first CV',
  'Wszystkie ({n})': 'All ({n})',
  Wynik: 'Score',
  Status: 'Status',
  'Koszt AI': 'AI cost',
  ogłoszenie: 'job posting',

  // ProfilesPage
  'Usunąć profil „{name}” razem z historią aplikacji? Tego nie da się cofnąć.':
    'Delete the profile "{name}" together with its application history? This cannot be undone.',
  Profile: 'Profiles',
  'Każda osoba ma swój profil z danymi i historią aplikacji. Profile są zapisane tylko na tym komputerze.':
    'Each person has their own profile with their details and application history. Profiles are stored only on this computer.',
  aktywny: 'active',
  'brak danych': 'no details',
  'utworzony {date}': 'created {date}',
  Używaj: 'Use',
  'Nowy profil': 'New profile',
  'Zacznij od utworzenia profilu': 'Start by creating a profile',
  'Wpisz nazwę (np. swoje imię albo „Kolega”). W następnym kroku wgrasz swoje obecne CV, a AI wypełni profil za Ciebie.':
    'Enter a name (e.g. your first name or "Friend"). In the next step you upload your current CV and the AI fills in the profile for you.',
  'Nazwa profilu': 'Profile name',
  'Utwórz profil': 'Create profile',

  // CareerPage: strona i zakładki
  'Porozmawiaj z doradcą AI o tym, czego szukasz - potem dostaniesz propozycje stanowisk z gotowymi linkami do wyszukiwania na pracuj.pl, justjoin.it, nofluffjobs, Smart Jobs i theprotocol.it.':
    'Tell the AI advisor what you are looking for, then get role suggestions with ready-made search links for pracuj.pl, justjoin.it, nofluffjobs, Smart Jobs and theprotocol.it.',
  'Zaproponuj stanowiska od nowa': 'Suggest roles again',
  'Pokaż propozycje pracy': 'Show role suggestions',
  'Doradca ma już wystarczająco informacji.': 'The advisor has enough information now.',
  'Propozycje i oferty': 'Suggestions and offers',
  'Co doradca o Tobie wie': 'What the advisor knows about you',
  'Jeszcze nie ma propozycji': 'No suggestions yet',
  'Najlepiej najpierw porozmawiaj z doradcą (kilka minut), ale propozycje możesz wygenerować w każdej chwili - na podstawie profilu i preferencji.':
    'It is best to chat with the advisor first (a few minutes), but you can generate suggestions at any time from your profile and preferences.',
  'Szukaj ofert dla wszystkich': 'Find job offers for all roles',
  'Przy każdym stanowisku są linki do wyszukiwarek portali. Znalezioną ofertę wklej w':
    "Each role has links to the portals' search pages. Paste an offer you find into",
  'Automatyczne wyszukiwanie i ocenę ofert ({portals}) możesz włączyć w':
    'You can turn on automatic search and scoring of offers ({portals}) in',
  Ustawieniach: 'Settings',
  'Dobieram stanowiska do Twojego profilu…': 'Matching roles to your profile…',
  'Zacząć rozmowę od nowa? Preferencje i zapisane w profilu informacje zostaną.':
    'Start the chat over? Your preferences and the details saved in your profile will be kept.',

  // CareerPage: rozmowa z doradcą
  'Rozmowa z doradcą': 'Chat with the advisor',
  'Zacznij od nowa': 'Start over',
  'Doradca pisze…': 'The advisor is typing…',
  'Doradca nie odpowiedział na Twoją ostatnią wiadomość.': 'The advisor did not reply to your last message.',
  'Spróbuj ponownie': 'Try again',
  'Napisz odpowiedź… (Enter - wyślij, Shift+Enter - nowa linia)': 'Write a reply… (Enter to send, Shift+Enter for a new line)',
  Wyślij: 'Send',
  '{n} / {max} znaków': '{n} / {max} characters',
  '{n} / {max} znaków - skróć wiadomość albo podziel ją na dwie.': '{n} / {max} characters. Shorten the message or split it in two.',
  'Konkretne informacje o Twoim doświadczeniu zapisują się w profilu („Twoje odpowiedzi na pytania AI”) i trafią do kolejnych CV.':
    'Specific details about your experience are saved in your profile ("Your answers to AI questions") and used in your future CVs.',
  'Wiadomość nie została wysłana ({error}). Tekst jest z powrotem w polu poniżej - spróbuj wysłać ponownie.':
    'The message was not sent ({error}). The text is back in the field below, try sending it again.',
  'Brak połączenia z programem - sprawdź, czy okno start.bat jest otwarte. Twój tekst jest z powrotem w polu poniżej.':
    'No connection to the app. Check that the start.bat window is open. Your text is back in the field below.',
  'Doradca nie odpowiedział: {error}': 'The advisor did not reply: {error}',

  // CareerPage: preferencje
  'Czego szukasz': 'What you are looking for',
  'Doradca uzupełnia to w trakcie rozmowy. Możesz też zmienić wszystko ręcznie.':
    'The advisor fills this in during the chat. You can also change anything yourself.',
  'Stanowiska / kierunki (po przecinku)': 'Roles / fields (comma-separated)',
  'np. analityk danych, marketing': 'e.g. data analyst, marketing',
  'Tryb pracy': 'Work mode',
  stacjonarnie: 'on-site',
  hybrydowo: 'hybrid',
  zdalnie: 'remote',
  Miasto: 'City',
  'Dla pracy stacjonarnej i hybrydowej.': 'For on-site and hybrid work.',
  'Zaznacz stacjonarnie lub hybrydowo, żeby szukać w okolicy.': 'Tick on-site or hybrid to search nearby.',
  // Polska nazwa miasta, bo trafia do linków i wyszukiwarek polskich portali.
  'np. Warszawa': 'e.g. Warszawa',
  'Promień od miasta': 'Radius from the city',
  'do {r} km': 'up to {r} km',
  'Praca zdalna jest szukana w całej Polsce - niezależnie od miasta.':
    'Remote work is searched across all of Poland, regardless of the city.',
  'Min. wynagrodzenie (zł brutto / mies.)': 'Min. salary (PLN gross / month)',
  '0 = bez wymagań. Oferty bez podanej kwoty zostają.': '0 = no minimum. Offers without a stated salary are kept.',
  'np. 5000': 'e.g. 5000',
  Poziom: 'Level',
  'Staż / praktyki': 'Internship / traineeship',
  Dowolny: 'Any',
  'Wymiar pracy': 'Working hours',
  'Pełny etat': 'Full-time',
  'Część etatu': 'Part-time',
  'Forma umowy (pusto = dowolna)': 'Contract type (none ticked = any)',
  'Inne oczekiwania': 'Other expectations',
  'np. nie chcę sprzedaży telefonicznej': 'e.g. no telesales',
  'Zapisz preferencje': 'Save preferences',

  // Wartości danych (zapisywane po polsku, tłumaczone tylko do wyświetlenia): formy umowy
  'umowa o pracę': 'employment contract (UoP)',
  'umowa zlecenie': 'mandate contract (umowa zlecenie)',
  B2B: 'B2B',
  'staż / praktyki': 'internship / traineeship',
  'umowa o dzieło': 'contract for specific work (umowa o dzieło)',
  dowolna: 'any',
  // tryb pracy w ofertach
  zdalna: 'remote',
  hybrydowa: 'hybrid',
  stacjonarna: 'on-site',
  'stacjonarna / hybrydowa': 'on-site / hybrid',
  // poziom, wymiar pracy, dopasowanie stanowiska
  staż: 'internship',
  junior: 'junior',
  mid: 'mid',
  dowolny: 'any',
  'pełny etat': 'full-time',
  'część etatu': 'part-time',
  wysokie: 'high',
  średnie: 'medium',
  ambitne: 'stretch',
  // powody odrzucenia ofert z serwera
  duplikaty: 'duplicates',
  'dla bardziej doświadczonych': 'senior roles',
  'inna forma umowy': 'other contract type',
  'za niskie wynagrodzenie': 'salary too low',
  'umowa: {list}': 'contract: {list}',

  // CareerPage: stanowiska i oferty
  'dopasowanie: {fit}': 'match: {fit}',
  'Szukam…': 'Searching…',
  'Odśwież oferty': 'Refresh offers',
  'Szukaj ofert': 'Find job offers',
  'Czego brakuje:': 'What is missing:',
  'Otwórz wyszukiwanie:': 'Open a search:',
  'Szukam ofert ({portals}) i oceniam dopasowanie… (ok. 10-30 s)': 'Searching for offers ({portals}) and rating the match… (about 10-30 s)',
  'Sprawdzono {n} ofert, pasuje do Twoich preferencji: {m}': 'Checked {n} offers, matching your preferences: {m}',
  '(w tym {n} słabo dopasowanych - ukryte)': '(weak matches hidden: {n})',
  'Wyszukano {date}.': 'Searched on {date}.',
  'Odrzucone: {list}.': 'Filtered out: {list}.',
  'Brak ofert spełniających wszystkie Twoje preferencje.': 'No offers meet all of your preferences.',
  'Poniżej są dopasowane oferty, które odpadły przez filtry - może warto je poluzować.':
    'Below are matching offers that your filters ruled out, so it may be worth loosening them.',
  'Spróbuj zwiększyć promień, dopuścić pracę zdalną albo inne formy umowy.':
    'Try a larger radius, or allow remote work or other contract types.',
  'Pokaż mniej': 'Show less',
  'Pokaż wszystkie ({n})': 'Show all ({n})',
  'Ukryj słabiej dopasowane': 'Hide weaker matches',
  'Pokaż słabiej dopasowane ({n})': 'Show weaker matches ({n})',
  'Ukryj oferty poza Twoimi filtrami': 'Hide offers outside your filters',
  'Pokaż dopasowane oferty poza Twoimi filtrami ({n})': 'Show matching offers outside your filters ({n})',
  'poza filtrem: {reason}': 'outside your filters: {reason}',
  'Zrób CV pod to': 'Make a CV for this',
  'CV już zrobione': 'CV already made',
  'Otwórz aplikację z tym CV': 'Open the application with this CV',
};
