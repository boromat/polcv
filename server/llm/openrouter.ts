import { z } from 'zod';
import { appendUsage, getProfile, getSettings, HttpError, nowIso } from '../storage/store';
import { maskForAi, profileTerms, TOKENS_NOTE } from '../privacy/polanon';

const API = 'https://openrouter.ai/api/v1';

export interface LlmContext {
  profileId: string;
  applicationId?: string;
  task: string;
}

export interface CallOptions<T> {
  schema: z.ZodType<T>;
  schemaName: string;
  system: string;
  user: string;
  tier: 'main' | 'fast';
  ctx: LlmContext;
  temperature?: number;
  maxTokens?: number;
}

/** Klucz z profilu ma pierwszeństwo przed globalnym (żeby kolega płacił za swoje). */
async function resolveKey(profileId: string): Promise<string> {
  const settings = await getSettings();
  let key = settings.apiKey;
  if (profileId) {
    const p = await getProfile(profileId).catch(() => null);
    if (p?.apiKey) key = p.apiKey;
  }
  key ||= process.env.OPENROUTER_API_KEY || '';
  if (!key) throw new HttpError(400, 'Brak klucza OpenRouter. Wklej go w Ustawieniach.');
  return key;
}

/**
 * Tryb strict wymaga, by każdy obiekt miał additionalProperties:false i wszystkie
 * pola w `required` — dopinamy to rekurencyjnie na schemacie z zoda.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { target: 'draft-7', unrepresentable: 'any' }) as any;
  delete js.$schema;
  const walk = (n: any) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'object' && n.properties) {
      n.additionalProperties = false;
      n.required = Object.keys(n.properties);
    }
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (typeof v === 'object') walk(v);
    }
  };
  walk(js);
  return js;
}

function extractJson(text: string): unknown {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.search(/[{[]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start > 0 || (end >= 0 && end < t.length - 1)) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

interface ChatResponse {
  content: string;
  finishReason: string;
  model: string;
  cost: number;
  tokensIn: number;
  tokensOut: number;
}

async function chat(key: string, body: Record<string, unknown>, attempt = 0): Promise<ChatResponse> {
  let res: Response;
  try {
    res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'PolCV',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (e: any) {
    if (attempt < 1) return chat(key, body, attempt + 1);
    throw new HttpError(502, `Brak połączenia z OpenRouter (${e.name === 'TimeoutError' ? 'przekroczony czas' : e.message}).`);
  }

  const raw = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(raw);
  } catch {
    /* odpowiedź nie-JSON obsłużona niżej */
  }

  if (!res.ok || json?.error) {
    const status = json?.error?.code && typeof json.error.code === 'number' ? json.error.code : res.status;
    const msg: string = json?.error?.message || raw.slice(0, 300);
    if (status === 401) throw new HttpError(401, 'OpenRouter odrzucił klucz API. Sprawdź klucz w Ustawieniach.');
    if (status === 402) throw new HttpError(402, 'Brak środków na koncie OpenRouter. Doładuj konto na openrouter.ai/settings/credits.');
    if ((status === 429 || status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      return chat(key, body, attempt + 1);
    }
    const err = new HttpError(status >= 400 && status < 600 ? status : 502, `OpenRouter: ${msg}`);
    (err as any).raw = msg;
    throw err;
  }

  const choice = json.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    finishReason: String(choice?.finish_reason ?? ''),
    model: json.model || String(body.model),
    cost: Number(json.usage?.cost ?? 0),
    tokensIn: Number(json.usage?.prompt_tokens ?? 0),
    tokensOut: Number(json.usage?.completion_tokens ?? 0),
  };
}

/**
 * Wywołanie modelu, które zwraca obiekt zgodny ze schematem zoda.
 * Maks. 3 zapytania: po błędzie walidacji — prośba o poprawkę; po zapętleniu/ucięciu
 * lub pustej odpowiedzi — nowa próba od zera z inną temperaturą (tańsze modele potrafią
 * się zapętlić w trybie JSON, a odsyłanie im tych śmieci nic nie daje).
 */
export async function callJson<T>(opts: CallOptions<T>): Promise<T> {
  const key = await resolveKey(opts.ctx.profileId);
  const settings = await getSettings();
  const model = opts.tier === 'main' ? settings.mainModel : settings.fastModel;
  const jsonSchema = toStrictJsonSchema(opts.schema);
  const temperature = opts.temperature ?? 0.4;
  // Opcjonalnie (polanon): dane osobowe zamienione na tokeny, zanim cokolwiek wyjdzie do OpenRouter.
  const masked = settings.maskPii
    ? await maskForAi(opts.user, settings, profileTerms(opts.ctx.profileId ? await getProfile(opts.ctx.profileId).catch(() => null) : null))
    : null;
  const user = masked?.text ?? opts.user;

  let system = `${opts.system}${masked ? TOKENS_NOTE : ''}

Zwróć WYŁĄCZNIE jeden obiekt JSON zgodny z podanym schematem — bez komentarzy i bez bloków markdown.`;
  let useSchema = true;
  let requireParams = true;

  const record = (r: ChatResponse) =>
    appendUsage({
      at: nowIso(),
      profileId: opts.ctx.profileId,
      applicationId: opts.ctx.applicationId ?? '',
      task: opts.ctx.task,
      model: r.model,
      cost: r.cost,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
    });

  const send = async (extra: { role: string; content: string }[], temp: number): Promise<ChatResponse> => {
    const body: Record<string, unknown> = {
      model,
      temperature: temp,
      max_tokens: opts.maxTokens ?? 8000,
      usage: { include: true },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }, ...extra],
    };
    if (useSchema) {
      body.response_format = { type: 'json_schema', json_schema: { name: opts.schemaName, strict: true, schema: jsonSchema } };
      // Tylko dostawcy, którzy naprawdę wymuszają schemat (inaczej OpenRouter może trafić na takiego, który go ignoruje).
      if (requireParams) body.provider = { require_parameters: true };
    }
    try {
      const r = await chat(key, body);
      await record(r);
      return r;
    } catch (e: any) {
      const unsupported = e instanceof HttpError && (e.status === 400 || e.status === 404) && /endpoint|provider|response_format|json_schema|structured|parameter/i.test(e.message);
      if (useSchema && unsupported) {
        // 404 = żaden dostawca nie spełnia require_parameters → próbujemy bez tego filtra;
        // 400 o response_format = model w ogóle nie zna schematu.
        if (requireParams && e.status === 404) requireParams = false;
        else {
          // Model w ogóle nie obsługuje json_schema — opisujemy schemat w promptcie.
          useSchema = false;
          system += `

Schemat JSON:
${JSON.stringify(jsonSchema)}`;
        }
        return send(extra, temp);
      }
      throw e;
    }
  };

  const tryParse = (r: ChatResponse): { ok: true; data: T } | { ok: false; error: string } => {
    if (!r.content.trim()) return { ok: false, error: 'pusta odpowiedź' };
    try {
      const parsed = opts.schema.safeParse(extractJson(r.content));
      if (parsed.success) return { ok: true, data: parsed.data };
      return { ok: false, error: z.prettifyError(parsed.error).slice(0, 2000) };
    } catch (e: any) {
      return { ok: false, error: `Niepoprawny JSON: ${e.message}` };
    }
  };

  const freshTemp = temperature < 0.3 ? 0.5 : 0.2;
  let res = await send([], temperature);
  let lastBroken = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const parsed = tryParse(res);
    if (parsed.ok) return masked ? masked.restore(parsed.data) : parsed.data;
    lastBroken = !res.content.trim() || res.finishReason === 'length';
    console.warn(
      `[AI] ${opts.schemaName}: odrzucona odpowiedź ${attempt}/3 (${res.model}, finish=${res.finishReason || '?'}, ${res.tokensOut} tok.): ${parsed.error.slice(0, 300)}`,
    );
    if (attempt === 3) break;
    if (lastBroken || attempt === 2) res = await send([], freshTemp);
    else
      res = await send(
        [
          { role: 'assistant', content: res.content.slice(0, 20_000) },
          { role: 'user', content: `Twoja odpowiedź nie przeszła walidacji:
${parsed.error}

Zwróć poprawiony, kompletny obiekt JSON.` },
        ],
        temperature,
      );
  }
  throw new HttpError(
    502,
    lastBroken
      ? `Model ${model} zapętlił się albo urwał odpowiedź (${opts.schemaName}) w 3 próbach. Spróbuj ponownie albo wybierz inny model w Ustawieniach.`
      : `Model ${model} zwrócił dane w złym formacie (${opts.schemaName}) w 3 próbach. Spróbuj ponownie albo wybierz inny model w Ustawieniach.`,
  );
}

export interface ModelInfo {
  id: string;
  name: string;
  promptPrice: number;
  completionPrice: number;
  contextLength: number;
}

let modelCache: { at: number; list: ModelInfo[] } | null = null;

/** Lista modeli obsługujących structured outputs (publiczne API, bez klucza). */
export async function listModels(): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.at < 3600_000) return modelCache.list;
  const res = await fetch(`${API}/models`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new HttpError(502, 'Nie udało się pobrać listy modeli z OpenRouter.');
  const json: any = await res.json();
  const list: ModelInfo[] = (json.data as any[])
    .filter((m) => (m.supported_parameters ?? []).includes('structured_outputs') && !String(m.id).endsWith(':batch'))
    .map((m) => ({
      id: m.id,
      name: m.name,
      promptPrice: Number(m.pricing?.prompt ?? 0) * 1e6,
      completionPrice: Number(m.pricing?.completion ?? 0) * 1e6,
      contextLength: Number(m.context_length ?? 0),
    }));
  modelCache = { at: Date.now(), list };
  return list;
}

/** Sprawdza klucz i saldo przez /key. */
export async function checkKey(key: string): Promise<{ ok: boolean; message: string }> {
  const res = await fetch(`${API}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (res.status === 401) return { ok: false, message: 'Klucz nieprawidłowy.' };
  if (!res.ok) return { ok: false, message: `OpenRouter odpowiedział kodem ${res.status}.` };
  const j: any = await res.json();
  const d = j.data ?? {};
  const used = Number(d.usage ?? 0).toFixed(2);
  const limit = d.limit == null ? 'bez limitu' : `limit ${Number(d.limit).toFixed(2)} $`;
  return { ok: true, message: `Klucz działa. Zużyto ${used} $ (${limit}).` };
}
