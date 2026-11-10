/** Treść błędu do pokazania (w `catch` błąd ma typ unknown: może to być Error, napis albo cokolwiek innego). */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
