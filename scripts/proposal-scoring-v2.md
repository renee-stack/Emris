# Proposal: contract.md §3 scoring v2

**Status:** proposed, needs sign-off from all four builders. Not live: `data/` still holds v1 output.
**Try it:** `scripts/.venv/bin/python scripts/score.py --scoring v2 --out /some/dir`

## Why

On real data (796 tracts, 401 permits, as of 2026-10-30), v1 has four problems:

1. **8 of the top 15 tracts are there on a single permit.** One permit is enough for ~91 on both `mf_permits` and `permit_momentum`.
2. **Small counts read as huge momentum.** 1 permit this year vs 0 last year = +100%; 5 vs 0 = +500%.
3. **One old permit scores below none.** A tract whose only permit was filed 13–24 months ago gets momentum −100% and score 2, while tracts with no permits get 36. The bottom 5 are all this case.
4. **Permits with unknown units drive momentum.** New City 6103 scores 87 on four permits with no known unit count (likely commercial).

## What changes

Only §3 changes. The data shapes (§1) and the API (§2) are unchanged, so no code outside `/scripts` needs to change.

Replace §3.2 (permit_momentum) and §3.3 with the following:

> Let `n` = the tract's permits with `units >= 5` and `age_years < 2`. `MIN_ACTIVITY = 3`.
>
> - **permit_momentum**: `L` = permits with `units >= 5` and `age_years < 1`; `P` = permits with `units >= 5` and `1 <= age_years < 2`. Permits with `units = null` are excluded.
>   raw = `(L - P) / (P + 2)` if `n >= MIN_ACTIVITY`, else `0`.
>
> **Composite**
> ```
> permit_part = 0.45 * signals.mf_permits + 0.30 * signals.permit_momentum
> k           = min(1, n / MIN_ACTIVITY)
> composite   = median(permit_part over all tracts) + (permit_part - median) * k
>               + 0.25 * signals.infra_proximity
>               + units_24mo * 1e-6          // tie-break only
> ```
> `score`, `percentile`, `permit_count_24mo` and `units_24mo` are computed as before.
>
> **momentum_pct** = `round(100 * (L - P) / max(P, 1), 1)`, using the L and P above.
> **momentum** = `"flat"` if `n < MIN_ACTIVITY`; else `"up"` if `momentum_pct > 10`, `"down"` if `< -10`, else `"flat"`.

`mf_permits`, `infra_proximity`, the pctRank function and the weights (0.45 / 0.30 / 0.25) are unchanged.

In plain terms: momentum only counts once a tract has at least 3 known multifamily permits, it is smoothed so tiny counts can't produce huge swings, and a tract with thin permit evidence is pulled toward the citywide middle on the permit signals. Infrastructure is not pulled.

Also folds in two v1 drifts already in the code, so the contract matches: permits cover 24 months, not 30, and momentum thresholds are strict (`> 10`, `< -10`).

## Effect on real data

| | v1 | v2 |
|---|---|---|
| Top-15 tracts with a single permit | 8 | 0 |
| Top-15 tracts with < 3 multifamily permits | 13 | 5 (all have 2 permits, 80–251 units) |
| Former single-permit leaders | 98–99 | 95–97 (still top ~5%, but out of the top 15) |
| Score of the former bottom 5 | 2 | 37 (same as tracts with no permits) |
| New City 6103 (4 unknown-unit permits) | 87 | 37 |
| Tracts labelled up / down | 120 / 98 | 9 / 14 |
| Largest tie | 504 tracts at 36 | 587 tracts at 37 |

**Known tradeoff:** the largest tie grows. Tracts with only unknown-unit or small permits now tie with tracts that have none. That is accurate, since neither has multifamily evidence. The real infrastructure list should break many of these ties, because today's 10 mock projects give 43 to nearly every tract.
