// src/usage/aggregate.ts
// Agrega usage de todos os chats salvos no vault — base pra Usage tab.
//
// Lê via listAllChats (que já parsa frontmatter de todos os modos),
// calcula custo via getPricing+calculateCost, e devolve breakdown
// por provider / modelo / modo / dia + chats ordenados por custo.

import { type ChatSummary } from "../core/chatPersistence";
import { calculateCost, getPricing, type ModelPricing } from "./pricing";

/** Bucket de agregação — totais e flag de "algum modelo sem preço". */
export interface UsageBucket {
  chats: number;
  tokensIn: number;
  tokensOut: number;
  /** Do tokensIn, quanto veio do cache de prompt. */
  tokensCached: number;
  cost: number; // USD, 0 se tudo free
  /** true se algum chat dentro do bucket tem modelo sem pricing conhecido */
  hasUnknownCost: boolean;
}

/** Row de uma conversa, com cost já calculado. */
export interface ChatUsageRow {
  id: string;
  title: string;
  date: string;
  /** YYYY-MM-DD extraído de date (UTC). */
  day: string;
  provider: string;
  model: string;
  mode: string;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  cost: number | null; // null = pricing unknown
  messages: number;
  filePath: string;
}

/** Resultado completo da agregação. */
export interface UsageAggregate {
  total: UsageBucket;
  byProvider: Record<string, UsageBucket>;
  byModel: Record<string, UsageBucket>;
  byMode: Record<string, UsageBucket>;
  /** YYYY-MM-DD → bucket. Ordenar por chave pra heatmap. */
  byDay: Record<string, UsageBucket>;
  /** Chats sorted by cost desc (pra "top 10 caras"). null cost vai pro fim. */
  chats: ChatUsageRow[];
  /** Período coberto. */
  periodStart: string | null;
  periodEnd: string | null;
}

function emptyBucket(): UsageBucket {
  return {
    chats: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    cost: 0,
    hasUnknownCost: false,
  };
}

function dayFromIso(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function bump(bucket: UsageBucket, row: ChatUsageRow): void {
  bucket.chats += 1;
  bucket.tokensIn += row.tokensIn;
  bucket.tokensOut += row.tokensOut;
  bucket.tokensCached += row.tokensCached;
  if (row.cost == null) {
    bucket.hasUnknownCost = true;
  } else {
    bucket.cost += row.cost;
  }
}

/**
 * Constrói ChatUsageRow a partir de ChatSummary + pricing lookup.
 * Cost vira null quando o pricing do modelo não cobre os tokens existentes.
 *
 * `pricingCache` (opcional) memoiza getPricing por `${provider}::${model}` —
 * pricing é estático, então em vaults grandes evita refazer o lookup linear
 * por chat (v0.1.228).
 */
function summaryToRow(s: ChatSummary, pricingCache?: Map<string, ModelPricing>): ChatUsageRow {
  let pricing: ModelPricing;
  if (pricingCache) {
    const key = `${s.provider}::${(s.model || "").toLowerCase()}`;
    pricing = pricingCache.get(key) ?? getPricing(s.provider, s.model);
    pricingCache.set(key, pricing);
  } else {
    pricing = getPricing(s.provider, s.model);
  }
  // Saneia tokens: ChatSummary vem de frontmatter parseado e pode trazer
  // NaN/undefined, que envenenaria todos os totais via bump() (v0.1.228).
  const tokensIn = Number.isFinite(s.tokensIn) ? s.tokensIn : 0;
  const tokensOut = Number.isFinite(s.tokensOut) ? s.tokensOut : 0;
  const tokensCached = Number.isFinite(s.tokensCached) ? (s.tokensCached ?? 0) : 0;
  const gravado = Number.isFinite(s.tokensCacheWrite) ? (s.tokensCacheWrite ?? 0) : 0;
  const cost = calculateCost(pricing, tokensIn, tokensOut, 0, 0, {
    lido: tokensCached,
    gravado,
  });
  return {
    id: s.id,
    title: s.title,
    date: s.date,
    day: dayFromIso(s.date),
    provider: s.provider,
    model: s.model,
    mode: s.mode,
    tokensIn,
    tokensOut,
    tokensCached,
    cost,
    messages: s.messageCount,
    filePath: s.filePath,
  };
}

/**
 * Filtra chats pelo período (`periodDays`). 0/undefined = sem filtro.
 * Compara via `date` ISO no chat. Default cutoff: hoje - periodDays.
 */
function filterByPeriod(rows: ChatUsageRow[], periodDays?: number): ChatUsageRow[] {
  if (!periodDays || periodDays <= 0) return rows;
  const cutoffMs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  return rows.filter((r) => {
    const t = Date.parse(r.date);
    return !isNaN(t) && t >= cutoffMs;
  });
}

/**
 * Agrega summaries JÁ CARREGADOS — zero IO (v0.1.103). Permite reaproveitar
 * uma única passada de listAllChats em quem precisa de recentes + stats
 * (ex.: dashboard da StarterScreen), em vez de reler o disco.
 */
export function aggregateFromSummaries(
  summaries: ChatSummary[],
  periodDays = 0
): UsageAggregate {
  // Memo de pricing por `${provider}::${model}` — escopo da agregação,
  // descartado ao fim (sem cache stale entre chamadas) (v0.1.228).
  const pricingCache = new Map<string, ModelPricing>();
  const rawRows = summaries.map((s) => summaryToRow(s, pricingCache));
  const rows = filterByPeriod(rawRows, periodDays);

  const total = emptyBucket();
  const byProvider: Record<string, UsageBucket> = {};
  const byModel: Record<string, UsageBucket> = {};
  const byMode: Record<string, UsageBucket> = {};
  const byDay: Record<string, UsageBucket> = {};

  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const row of rows) {
    bump(total, row);

    const p = row.provider || "(desconhecido)";
    byProvider[p] ??= emptyBucket();
    bump(byProvider[p], row);

    const m = row.model || "(desconhecido)";
    byModel[m] ??= emptyBucket();
    bump(byModel[m], row);

    const mode = row.mode || "chat";
    byMode[mode] ??= emptyBucket();
    bump(byMode[mode], row);

    const day = row.day || "(sem data)";
    byDay[day] ??= emptyBucket();
    bump(byDay[day], row);

    if (row.day) {
      if (!minDate || row.day < minDate) minDate = row.day;
      if (!maxDate || row.day > maxDate) maxDate = row.day;
    }
  }

  // Ordena chats por custo desc. null cost vai pro fim.
  const sortedChats = [...rows].sort((a, b) => {
    if (a.cost == null && b.cost == null) return 0;
    if (a.cost == null) return 1;
    if (b.cost == null) return -1;
    return b.cost - a.cost;
  });

  return {
    total,
    byProvider,
    byModel,
    byMode,
    byDay,
    chats: sortedChats,
    periodStart: minDate,
    periodEnd: maxDate,
  };
}

/** Helper UI: ordena entries dum Record<string, UsageBucket> por cost desc. */
export function sortBucketEntries(
  buckets: Record<string, UsageBucket>
): Array<[string, UsageBucket]> {
  return Object.entries(buckets).sort(([, a], [, b]) => b.cost - a.cost);
}
