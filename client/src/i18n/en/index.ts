import { application } from './application';
import { career } from './career';
import { interview } from './interview';
import { profile } from './profile';
import { shell } from './shell';

/** Wszystkie angielskie tłumaczenia interfejsu, kluczem jest polski tekst. */
export const EN: Record<string, string> = { ...shell, ...career, ...profile, ...application, ...interview };

/** Części słownika osobno, żeby test wykrył ten sam tekst przetłumaczony na dwa sposoby. */
export const EN_PARTS = { shell, career, profile, application, interview };
