import { describe, expect, it } from 'vitest';
import { cleanTail } from '../server/llm/strings';

describe('zabłąkane znaki na końcu tekstów od AI', () => {
  it('usuwa "}" bez pary', () => {
    expect(cleanTail('Brakuje konkretnych projektów i efekty.}')).toBe('Brakuje konkretnych projektów i efekty.');
    expect(cleanTail('…i efekty.}')).toBe('…i efekty.');
  });

  it('usuwa "]" i cudzysłów bez pary, także kilka naraz i ze spacją na końcu', () => {
    expect(cleanTail('Lista zadań]')).toBe('Lista zadań');
    expect(cleanTail('Dobre CV."}')).toBe('Dobre CV.');
    expect(cleanTail('Dobre CV. } ')).toBe('Dobre CV.');
  });

  it('zostawia znaki, które mają parę', () => {
    expect(cleanTail('Lista [a] ok]')).toBe('Lista [a] ok]');
    expect(cleanTail('Ukończony kurs "Excel w biznesie"')).toBe('Ukończony kurs "Excel w biznesie"');
    expect(cleanTail('Ukończony kurs „Excel w biznesie"')).toBe('Ukończony kurs „Excel w biznesie"');
    expect(cleanTail('Zmienna {x}')).toBe('Zmienna {x}');
    expect(cleanTail('Bez zmian. ')).toBe('Bez zmian. ');
  });

  it('działa na całej strukturze JSON i nie rusza innych wartości', () => {
    expect(cleanTail({ a: 'Tekst.}', b: ['Lista]', 'ok'], n: 3, f: true })).toEqual({ a: 'Tekst.', b: ['Lista', 'ok'], n: 3, f: true });
  });
});
