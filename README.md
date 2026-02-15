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

1. **Parse** — NLP parser (`lib/nlp-parser.js`) splits natural-language grocery lists into structured items, handling quantities, notes, abbreviations, "and"/"or" splits, and section headers.
2. **Lookup** — Each item is queried against the ShopRite storefrontgateway API (`Bearer anonymous`, no login) to get its aisle/bay location for the configured store.
3. **Sort** — Items are grouped by aisle and sorted in store walk order using `lib/aisleData.js`.
4. **Write** — Markdown file with checkboxes, quantities, bay locations, and notes. Original input appended in a collapsible block.

## Caching

API results are cached in `scraper/cache.json` across runs. Items that resolved to "Unknown" are **not** cached so they get retried next time. Delete `cache.json` to force fresh lookups.

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
