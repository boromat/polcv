/** Dozwolona nazwa użytkownika GitHuba: litery, cyfry i myślniki, do 39 znaków, bez myślnika na początku. */
const USER_RE = /^[a-z\d](?:[a-z\d-]{0,38})$/i;

/**
 * Nazwa użytkownika z tego, co wpisał kandydat: "jan-kowalski", "@jan-kowalski", "github.com/jan-kowalski"
 * albo link do repozytorium ("https://github.com/jan-kowalski/projekt"). null = to nie jest nazwa użytkownika.
 */
export function parseGithubUser(input: string): string | null {
  const s = input.trim();
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#\s]*)/i.exec(s);
  const user = url ? url[1] : s.replace(/^@/, '');
  return USER_RE.test(user) ? user : null;
}

/** Nazwa użytkownika z pierwszego linku do GitHuba w profilu (do podpowiedzi w formularzu); pusty, gdy brak. */
export function githubUserFromLinks(links: { url: string }[]): string {
  for (const l of links) {
    if (!/github\.com\//i.test(l.url)) continue;
    const user = parseGithubUser(l.url);
    if (user) return user;
  }
  return '';
}
