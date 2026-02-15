# LazyShopRiteAisleMapper

CLI tool that turns a plain-text grocery list into a **store-walk-ordered markdown checklist** with aisle locations, powered by the ShopRite storefrontgateway API.

No server, no browser, no login — just Node.js.

## Quick Start

```bash
node scraper/shop.js path/to/groceries.txt
```

Outputs a `Mmm-DD.md` file (e.g. `Feb-14.md`) in the same folder as the input, with items grouped by aisle in walking order.

## Example Output

```markdown
# Shopping List — February 14, 2026 Sat 22:00
**Store:** ShopRite #592 — South Plainfield, NJ

## Produce
- [ ] Berries — ISLAND 1 *(under $5)*
- [ ] Grapes — ISLAND 1
- [ ] Apples — LEFT WALL

## Aisle 12
- [ ] Black beans ×4 cans
- [ ] Couscous ×5

## Unknown
- [ ] Queso Block cheese
```

## How It Works

1. **Parse** — The NLP parser reads the grocery file and extracts structured items (see [NLP Parsing](#nlp-parsing) below).
2. **Lookup** — Each item is queried against the ShopRite storefrontgateway API (`Bearer anonymous`, no login) to get its aisle/bay location for the configured store.
3. **Sort** — Items are grouped by aisle and sorted in store walk order using `lib/aisleData.js`.
4. **Write** — Markdown file with checkboxes, quantities, bay locations, and notes. Original input appended in a collapsible block.

## NLP Parsing

The parser (`lib/nlp-parser.js`) is a three-stage pipeline that handles the messy, informal way people actually write grocery lists:

### Stage 1: Block Splitting
Lines are classified as **section headers** (e.g. "Aisle 3:", "Freezer section:") or **item lines**. Headers are recognized but not treated as items — they provide context. Inline content after a header colon is still captured.

### Stage 2: Line Expansion
A single line like `"Cereal: Cheerios and Frosted Flakes"` becomes two separate items. The parser:
- Splits on **commas** (`berries, grapes, apples`)
- Splits on **"and"** (`Cheerios and Frosted Flakes`) — unless the phrase is a known compound like "mac and cheese" or "half and half"
- Extracts **category prefixes** (`Fruits:`, `Cold cuts:`) and **shared quantities** (`1 bag each:`)
- Identifies **directives** — vague phrases like "anything you like" or "surprise us" — and skips them

### Stage 3: Item Parsing
Each expanded item is parsed into structured fields:
- **Name** — the display name, with abbreviations expanded (`OJ` → `orange juice`, `Dz` → `dozen`)
- **Quantity** — leading (`4 cans black beans`), trailing (`bread x2`), or shared (`1 bag each:` applied to all items in that group)
- **Notes** — parentheticals extracted and preserved (`(dark green ones)`, `(under $5)`)
- **Lookup term** — a simplified version of the name for API search, with adjectives stripped (`Extra Virgin Olive Oil` → `olive oil`), "or" alternatives resolved (`yellow or white potatoes` → `potatoes`), and trailing qualifiers removed (`veggies we eat` → `vegetables`)

### Word Arrays
The parser relies on several curated word arrays to make these decisions:
- **`AND_COMPOUNDS`** — phrases that should never be split on "and" (`half and half`, `mac and cheese`, `peanut butter and jelly`)
- **`DIRECTIVE_PATTERNS`** — regex patterns matching vague/non-actionable phrases to skip
- **`ABBREVIATIONS`** — shorthand expansions (`oj`, `evoo`, `pb`, `dz`, `lg`)
- **`STRIP_PREFIXES`** / **`STRIP_SUFFIXES`** — adjectives and trailing phrases to remove from lookup terms so the API search finds the right product

### Unrecognized Entries
If an item makes it through parsing but the ShopRite API returns no matching product or no aisle location, it is placed in the **Unknown** section at the bottom of the output. Unknown items are intentionally **not cached** (see below), so they are retried on the next run — useful if the API was temporarily unavailable or the item name was slightly off.

## Caching

API results are persisted to `scraper/cache.json` so subsequent runs are near-instant for previously looked-up items. On a typical 40-item list, the first run takes ~30 seconds (two API calls per item); cached runs complete in under a second.

Key behaviors:
- **Unknown items are not cached** — if the API couldn't find an aisle, the item will be retried next run rather than permanently stuck as Unknown.
- **Cache is shared across all input files** — once "butter" is looked up, it's cached for every future list.
- **Delete `cache.json` to force fresh lookups** — useful if the store rearranges aisles or you want to refresh stale data.
- **The cache file is committed to the repo** so you can start with a pre-populated set of lookups.

## Input Format

The parser handles messy, natural-language lists:

```
Fruits: berries (under $5), grapes, apples, pears
3-4 avocados (dark green ones)
Cold cuts: Turkey, Ham, salami, provolone
Cereal: Cheerios and Frosted Flakes
Dz eggs x2
1/2 & 1/2 x6
```

See `tests/sample-shoppinglist.txt` and `tests/Unstructured-Groceries.txt` for full examples.

## Project Structure

```
scraper/
  shop.js              — CLI entry point
  cache.json           — persistent API result cache (auto-generated)
  lib/
    nlp-parser.js      — NLP shopping list parser
    aisleData.js       — store walk order (ShopRite #592)
tests/
  sample-shoppinglist.txt
  Unstructured-Groceries.txt
```

## Configuration

The store is currently hardcoded to **ShopRite #592 (South Plainfield, NJ)**. To use a different store, change `STORE_ID` in `scraper/shop.js` and update the walk order in `scraper/lib/aisleData.js`.

## Requirements

- Node.js (no npm dependencies)

## Acknowledgments

Thanks to [danielheyman/shoprite-miner](https://github.com/danielheyman/shoprite-miner) for the inspiration and for demonstrating that the ShopRite storefrontgateway API is accessible without authentication. This project is not a fork — shoprite-miner is a web app focused on price tracking, while LazyShopRiteAisleMapper is a CLI tool for aisle-based shopping list organization — but it pointed the way to the API that makes this possible.
