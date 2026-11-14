// Token Radar's value model (radar-2): one snapshot of the protocol universe in, one ranked
// board out. The board covers every slug in the snapshot's watchlist (the floor, never a ceiling)
// and every other pre-token protocol the house's own exclusion rule keeps: no wrapped, staked or
// bridged product of a token that already trades, no exchange, no versioned pool.
//
// The implied value is calibrated from the snapshot itself, not from a flat multiple: for each
// category, the model's multiple is the MEDIAN market-cap-per-TVL of the live-token protocols in
// that category that this snapshot records. A category with fewer than three live comparables, or
// none at all, falls back to the global median of the same ratio. No protocol name is ever
// special-cased: the same function scores every row, and the dashboard prints the calibration
// table the function used, so any reader can check the number.
//
//   implied = tvl_usd x multiple(category) x growthMult x maturityMult
//   growthMult   = 1 + clamp(change_7d, -60, 120) / 100 x 0.5
//   maturityMult = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age unknown: 365 days)
//
// A farm plan is derived from the protocol's own record (category, chains, TVL, age), never from
// a hand-written list of names: seven steps, each with what it costs and how long it takes.

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

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live comparables a category needs before its own median is trusted. */
export const MIN_COMPS = 3;
/** The multiple is never trusted outside this band: a single tiny protocol's token cannot set it. */
export const MULTIPLE_FLOOR = 0.02;
export const MULTIPLE_CAP = 2.0;

/** One category's calibration: what the live market says a dollar of its TVL is worth. */
export interface CategoryMultiple {
  category: string;
  /** Live comparables in the snapshot with both a market cap and a TVL. */
  comps: number;
  /** The median market-cap-per-TVL of those comparables, null when there are none. */
  median: number | null;
  /** The multiple the model applies: the median when comps >= MIN_COMPS, else the global median. */
  multiple: number;
  /** True when the category fell back to the global median. */
  fallback: boolean;
}

/** The calibration the model computed from this snapshot's live protocols. */
export interface Calibration {
  /** Median market-cap-per-TVL across every live protocol in the snapshot. */
  globalMedian: number;
  /** Live protocols counted. */
  liveCount: number;
  /** One entry per category that appears on the board, in category order. */
  byCategory: CategoryMultiple[];
}

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
  /** True when the snapshot's watchlist names this slug. */
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    comps: number;
    multiple_fallback: boolean;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
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
  watchlist: boolean;
  implied_value_usd: number;
  multiple: number;
  comps: number;
  multiple_fallback: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  /** Its own market-cap-per-TVL: the ratio the calibration is built from. */
  ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_median: number;
  calibration: CategoryMultiple[];
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

/** The median of a sorted array, or null when empty. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories the house's watchlist rule keeps out: a wrapped, staked or bridged product. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** An exchange's name at the start of a protocol's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, and nothing the house's own rule
 * keeps out — not a bridge, not liquid staking or restaking, not an exchange, not a versioned
 * pool, and its name carries no wrapped/staked word. The watchlist was built by this same rule,
 * so every watchlist slug passes it; it is what keeps a wrapped product of a trading token off
 * the early radar too.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

/**
 * The calibration: for every category on the board, the median market-cap-per-TVL of the
 * snapshot's live-token protocols in that category (at least MIN_COMPS of them, else the global
 * median of the same ratio), clamped into [MULTIPLE_FLOOR, MULTIPLE_CAP]. The multiples are
 * computed from the snapshot handed in, never from a list written into the model.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  let liveCount = 0;
  for (const p of snapshot.protocols) {
    if (isPreToken(p)) continue;
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    liveCount++;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    allRatios.push(ratio);
    if (p.category !== null) {
      const list = ratiosByCategory.get(p.category) ?? [];
      list.push(ratio);
      ratiosByCategory.set(p.category, list);
    }
  }
  allRatios.sort((a, b) => a - b);
  const globalMedian = medianOf(allRatios) ?? 0.2;
  const clamp = (n: number): number => Math.min(MULTIPLE_CAP, Math.max(MULTIPLE_FLOOR, n));
  const categories = new Set<string>();
  for (const p of snapshot.protocols) if (p.category !== null) categories.add(p.category);
  const byCategory: CategoryMultiple[] = [...categories].sort().map((category) => {
    const ratios = (ratiosByCategory.get(category) ?? []).slice().sort((a, b) => a - b);
    const med = medianOf(ratios);
    const fallback = ratios.length < MIN_COMPS;
    return {
      category,
      comps: ratios.length,
      median: med,
      multiple: clamp(fallback ? globalMedian : med!),
      fallback,
    };
  });
  return { globalMedian, liveCount, byCategory };
}

/** The multiple one category gets under a calibration (global median when unlisted). */
export function multipleFor(calibration: Calibration, category: string | null): { multiple: number; comps: number; fallback: boolean } {
  if (category === null) {
    return { multiple: Math.min(MULTIPLE_CAP, Math.max(MULTIPLE_FLOOR, calibration.globalMedian)), comps: 0, fallback: true };
  }
  const entry = calibration.byCategory.find((c) => c.category === category);
  if (entry === undefined) {
    return { multiple: Math.min(MULTIPLE_CAP, Math.max(MULTIPLE_FLOOR, calibration.globalMedian)), comps: 0, fallback: true };
  }
  return { multiple: entry.multiple, comps: entry.comps, fallback: entry.fallback };
}

/** The growth clamp and weight: a seven-day move, bounded, at half strength. */
const GROWTH_FLOOR = -60;
const GROWTH_CAP = 120;
const GROWTH_WEIGHT = 0.5;
/** Maturity: 0.6 for a brand-new protocol, rising to 1.0 after three tokenless years. */
const MATURITY_FLOOR = 0.6;
const MATURITY_RANGE = 0.4;
const MATURITY_DAYS = 1095;
const UNKNOWN_AGE_DAYS = 365;

/** The multipliers and the implied value one protocol gets under a calibration. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
): { implied: number; multiple: number; comps: number; fallback: boolean; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, comps, fallback } = multipleFor(calibration, protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * GROWTH_WEIGHT;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult = MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult));
  return { implied, multiple, comps, fallback, growthPct, growthMult, maturityMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever else the board carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor — the whole
  // of it, not a sample. A chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const watchlistSet = new Set(snapshot.watchlist);
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
    token_status: 'pre-token' as const,
    watchlist: watchlistSet.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // The multiple is stored at full precision, not rounded: the dashboard re-does the
      // arithmetic from this file, and a rounded multiple would make every row disagree by a
      // few hundred thousand dollars on a billion-dollar TVL.
      multiple: s.multiple,
      comps: s.comps,
      multiple_fallback: s.fallback,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's family, for the farm plan's actions. */
function familyOf(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('uncollateralized')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm')) return 'dex';
  if (c.includes('risk curator') || c.includes('allocator') || c.includes('curator')) return 'vault';
  if (c.includes('yield aggregator') || c.includes('yield')) return 'yield';
  if (c.includes('rwa') || c.includes('anchor btc') || c.includes('decentralized btc')) return 'rwa';
  if (c.includes('basis')) return 'basis';
  if (c.includes('restak') || c.includes('staking')) return 'stake';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return 'perps';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('payment') || c.includes('card')) return 'payments';
  if (c.includes('chain')) return 'chain';
  if (c.includes('stable')) return 'stable';
  if (c.includes('governance')) return 'governance';
  if (c.includes('launchpad') || c.includes('indexes') || c.includes('farm')) return 'vault';
  return 'generic';
}

/** The family's primary action: what the farmer actually does with the capital. */
function primaryAction(family: string, p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 against it so the position shows both sides of the market.`;
    case 'dex':
      return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} in the pair it routes most volume through.`;
    case 'vault':
      return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares in the farming wallet.`;
    case 'yield':
      return `Deposit $${capital} into ${name}'s highest-yield strategy on ${chain} and leave the position compounding.`;
    case 'rwa':
      return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the farming wallet.`;
    case 'basis':
      return `Deposit $${capital} into ${name}'s basis vault on ${chain} so the position earns the funding-rate spread.`;
    case 'stake':
      return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it the same week.`;
    case 'bridge':
      return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds inside its app.`;
    case 'prediction':
      return `Fund the wallet with $${capital} and place two small market positions on ${name}, on opposite outcomes.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full hold.`;
    case 'payments':
      return `Move $${capital} through ${name} on ${chain} in three separate payments over the first week.`;
    case 'chain':
      return `Bridge $${capital} of USDC onto ${chain} and use ${name}'s flagship app with it at least twice.`;
    case 'stable':
      return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
    case 'governance':
      return `Deposit $${capital} into ${name} on ${chain} and vote on one live proposal from the farming wallet.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The family's second qualifying action: a different touchpoint from the first. */
function secondAction(family: string, p: SnapshotProtocol, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Repay half the borrowed $20 and borrow it again, so the wallet shows a second borrow event.`;
    case 'dex':
      return `Swap $25 through ${name} on ${chain} in each direction, using the pool you already supplied.`;
    case 'vault':
      return `Deposit a second, smaller amount into a different ${name} vault on ${chain}.`;
    case 'yield':
      return `Claim the strategy's accrued yield once, then redeposit the claim into the same strategy.`;
    case 'rwa':
      return `Check the asset's backing page once and record the reserve figure in the farm log.`;
    case 'basis':
      return `Open the vault's funding-rate page and record the current annualised spread in the farm log.`;
    case 'stake':
      return `Delegate a further $25 of the staking asset through ${name} from the same wallet.`;
    case 'perps':
      return `Place one limit order on ${name}, then cancel it, so the wallet shows order activity.`;
    case 'bridge':
      return `Bridge $25 back the other way through ${name} so the wallet shows two-way volume.`;
    case 'prediction':
      return `Close one of the two positions before its market resolves and keep the other open.`;
    case 'insurance':
      return `File a test quote for a second cover amount and save the quote reference.`;
    case 'payments':
      return `Send one more payment of $25 through ${name} to a second wallet you control.`;
    case 'chain':
      return `Use a second app on ${chain} that ${name} lists as a partner, with $25 of the bridged funds.`;
    case 'stable':
      return `Swap $25 of the stable asset for USDC and back through ${name} to show redemption activity.`;
    case 'governance':
      return `Delegate the voting power to a second wallet you control and vote from it once.`;
    default:
      return `Make a second deposit of $25 into ${name} on ${chain} from the same wallet.`;
  }
}

/** The family's weekly action: what to repeat while the position is held. */
function weeklyAction(family: string, p: SnapshotProtocol): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Each week, adjust the borrow by a few dollars and check the health factor stays above 2.`;
    case 'dex':
      return `Each week, add $10 of liquidity or claim the pool's fees once.`;
    case 'vault':
      return `Each week, check the vault's points page and record the points balance in the farm log.`;
    case 'yield':
      return `Each week, claim and redeposit the week's yield into the same strategy.`;
    case 'rwa':
      return `Each week, confirm the yield asset's balance grew and record the new balance.`;
    case 'basis':
      return `Each week, record the funding-rate spread and the vault's weekly return.`;
    case 'stake':
      return `Each week, claim the staking rewards and restake them through ${name}.`;
    case 'perps':
      return `Each week, open and close one small hedged trade so the wallet shows steady volume.`;
    case 'bridge':
      return `Each week, bridge $10 each way through ${name} to keep the route warm.`;
    case 'prediction':
      return `Each week, open one small new position on ${name} on a market that closes soon.`;
    case 'insurance':
      return `Each week, check the policy is still active and the cover amount is unchanged.`;
    case 'payments':
      return `Each week, send one payment of $10 through ${name} for a real expense.`;
    case 'chain':
      return `Each week, use one app on the chain with $10 so the wallet stays active there.`;
    case 'stable':
      return `Each week, mint or redeem $10 of the stable asset to show ongoing use.`;
    case 'governance':
      return `Each week, vote on any live proposal from the farming wallet.`;
    default:
      return `Each week, make one qualifying action: a deposit, a swap, a vote or a claim.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. Every step is
 * derived from the protocol's own record (family from its category, capital from its TVL, hold
 * from its age, chain from its own list), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyOf(p);
  return [
    {
      text: `Use a fresh wallet that holds only the farm funds, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: primaryAction(family, p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 200 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondAction(family, p, chain),
      cost: 'about $3 of gas and $25 of movement',
      time: '10 minutes',
    },
    {
      text: weeklyAction(family, p),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, and plan how you will unwind the position.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** How many live-token protocols the Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** The live-token protocols, by market cap, for the dashboard's Comparables tab. */
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
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? Math.round((p.mcap_usd / p.tvl_usd) * 1000) / 1000 : null,
    }));
}

/** A board row's compact form for data.js, farm plan included. */
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
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    multiple: row.model.multiple,
    comps: row.model.comps,
    multiple_fallback: row.model.multiple_fallback,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData; calibration: Calibration } {
  const calibration = calibrate(snapshot);
  const board = buildBoard(snapshot, calibration);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_median: Math.round(calibration.globalMedian * 10000) / 10000,
    calibration: calibration.byCategory,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, calibration };
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
