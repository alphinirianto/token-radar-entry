// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and may add
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol is
// pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol); the
// snapshot's live-token protocols are kept apart and shown as the market's own values, never mixed into
// the ranked board.
//
// Implied value is derived dynamically from the snapshot's live-token protocols in the same category
// (median MCap/TVL ratio, with a fallback to global median when category peers < min_category_peers),
// then adjusted for chain count, 7-day momentum, and protocol age:
//
//   categoryRatio = median MCap/TVL of live peers in category (or global median fallback)
//   baseVal       = tvl_usd x categoryRatio
//   chainMult     = 1 + chain_weight x min(chains.length, 4)
//   growth        = clamp(change_7d, -60, 120) per cent
//   growthMult    = 1 + (growth / 100) x growth_weight
//   maturity      = maturity_floor + min(age_days, maturity_days) / maturity_days x maturity_range (unknown: unknown_age_days)
//   implied       = max(1, round(baseVal x chainMult x growthMult x maturity))

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  global_fallback_ratio: number;
  min_category_peers: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
}

export const MODEL: ModelConstants = {
  global_fallback_ratio: 1.5,
  min_category_peers: 3,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_weight: 0.05,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-peer-1';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_ratio: number;
    category_ratio_source: string;
    category_peer_count: number;
    chain_multiplier: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_ratio: number;
  category_ratio_source: string;
  category_peer_count: number;
  chain_multiplier: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

function median(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Compute category MCap/TVL ratios from live-token protocols. */
export function computeCategoryRatios(protocols: SnapshotProtocol[], minPeers: number, globalFallback: number): { categoryRatios: Map<string, number>; globalMedian: number; peerCounts: Map<string, number> } {
  const live = protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.tvl_usd > 0);
  const byCategory = new Map<string, number[]>();
  const globalRatios: number[] = [];

  for (const p of live) {
    const ratio = (p.mcap_usd!) / p.tvl_usd;
    globalRatios.push(ratio);
    const cat = p.category ?? 'Other';
    let list = byCategory.get(cat);
    if (!list) {
      list = [];
      byCategory.set(cat, list);
    }
    list.push(ratio);
  }

  const globalMedian = globalRatios.length > 0 ? median(globalRatios) : globalFallback;
  const categoryRatios = new Map<string, number>();
  const peerCounts = new Map<string, number>();

  const allCategories = new Set<string>();
  for (const p of protocols) {
    allCategories.add(p.category ?? 'Other');
  }

  for (const cat of allCategories) {
    const ratios = byCategory.get(cat) ?? [];
    peerCounts.set(cat, ratios.length);
    if (ratios.length >= minPeers) {
      categoryRatios.set(cat, median(ratios));
    } else {
      categoryRatios.set(cat, globalMedian);
    }
  }

  return { categoryRatios, globalMedian, peerCounts };
}

/** The implied value one protocol gets under `model` using category live-peer ratio and adjustments. */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, categoryRatios: Map<string, number>, globalMedianRatio: number, peerCounts: Map<string, number>): { implied: number; ratio: number; ratioSource: string; peerCount: number; chainMult: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const cat = protocol.category ?? 'Other';
  const peerCount = peerCounts.get(cat) ?? 0;
  const ratio = categoryRatios.get(cat) ?? globalMedianRatio;
  const ratioSource = peerCount >= model.min_category_peers
    ? `category median (${peerCount} live peers)`
    : `global median fallback (${peerCount} live peer${peerCount === 1 ? '' : 's'} < ${model.min_category_peers} threshold)`;
  const baseVal = protocol.tvl_usd * ratio;
  const chainMult = 1 + model.chain_weight * Math.min(protocol.chains.length, 4);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, protocol.listed_at);
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const implied = Math.max(1, Math.round(baseVal * chainMult * growthMult * maturityMult));
  return { implied, ratio, ratioSource, peerCount, chainMult, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const { categoryRatios, globalMedian, peerCounts } = computeCategoryRatios(snapshot.protocols, model.min_category_peers, model.global_fallback_ratio);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();

  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const res = impliedValue(p, snapshot.as_of, model, categoryRatios, globalMedian, peerCounts);
    return { p, ...res };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.slug ? -1 : a.p.slug > b.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_ratio: s.ratio,
      category_ratio_source: s.ratioSource,
      category_peer_count: s.peerCount,
      chain_multiplier: s.chainMult,
      growth_pct: s.growthPct,
      growth_multiplier: s.growthMult,
      maturity_multiplier: s.maturityMult,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * A protocol's tailored farm plan: derived strictly from the protocol's own chain, category, TVL, and age.
 * Each protocol gets customized steps, actions, costs, and timeframes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chainsStr = p.chains.length > 0 ? p.chains.join(', ') : 'Ethereum';
  const primaryChain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const cat = p.category ?? 'DeFi';
  const name = p.name;
  const lowerCat = cat.toLowerCase();

  let action = `Deposit $${capital} equivalent of the asset the protocol accepts into ${name}'s ${cat} vault or pool on ${primaryChain}.`;
  if (lowerCat.includes('dex') || lowerCat.includes('yield') || lowerCat.includes('amm')) {
    action = `Provide $${capital} equivalent of liquidity in ${name}'s AMM pools on ${primaryChain} using the asset the protocol accepts.`;
  } else if (lowerCat.includes('lend') || lowerCat.includes('cdp') || lowerCat.includes('collateral')) {
    action = `Supply $${capital} equivalent of collateral in ${name} on ${primaryChain} using the asset the protocol accepts and maintain a healthy loan ratio.`;
  } else if (lowerCat.includes('staking') || lowerCat.includes('restak')) {
    action = `Stake $${capital} equivalent of the supported staking asset through ${name} on ${primaryChain} to receive receipt tokens.`;
  } else if (lowerCat.includes('bridge')) {
    action = `Bridge $${capital} equivalent of assets across ${p.chains.slice(0, 2).join(' and ') || primaryChain} using ${name}.`;
  }

  const steps: FarmStep[] = [
    {
      text: `Initialize a dedicated non-custodial wallet for interacting with ${name} across ${chainsStr}, ensuring complete seed phrase isolation.`,
      cost: `Estimated $3.50 gas allocation on ${primaryChain}`,
      time: `5 minutes`
    },
    {
      text: action,
      cost: `$${capital} principal + ~$${capital >= 150 ? 12 : 6} execution gas on ${primaryChain}`,
      time: `15 minutes setup`
    },
    {
      text: `Perform a secondary protocol interaction within ${name} such as governance participation, claiming rewards, or rebalancing collateral across ${p.chains.slice(0, 3).join(', ') || primaryChain}.`,
      cost: `~$2.00 weekly interaction gas`,
      time: `10 minutes weekly`
    },
    {
      text: `Maintain the active position in ${name} on ${primaryChain} for a minimum duration of ${hold} consecutive days to qualify for snapshot epochs.`,
      cost: `Opportunity cost on $${capital} principal locked in ${cat}`,
      time: `${hold} days continuous hold`
    },
    {
      text: `Verify reward accrual and point allocation directly through ${name}'s official dashboard interface, avoiding unverified claim links.`,
      cost: `Zero fee for verification`,
      time: `5 minutes per epoch`
    },
    {
      text: `Record transaction hashes, deposit timestamps, and withdrawal parameters in a farm ledger for ${name}.`,
      cost: `Time investment only`,
      time: `5 minutes logging`
    }
  ];

  return steps.map(stepText);
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_ratio: row.model.category_ratio,
    category_ratio_source: row.model.category_ratio_source,
    category_peer_count: row.model.category_peer_count,
    chain_multiplier: row.model.chain_multiplier,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const expected = Math.max(1, Math.round(r.tvl_usd * r.model.category_ratio * r.model.chain_multiplier * r.model.growth_multiplier * r.model.maturity_multiplier));
    if (Math.abs(r.implied_value_usd - expected) > 1) return `${r.slug} implied value ${r.implied_value_usd} does not match expected model calculation ${expected}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
