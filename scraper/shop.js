#!/usr/bin/env node
// ============================================================
// ShopRite CLI — Shopping List → Markdown with Aisle Lookups
// ============================================================
// Usage: node scraper/shop.js path/to/groceries.txt [--store=NNN]
//
// Reads a natural-language grocery list, calls the ShopRite
// storefrontgateway API for aisle locations, and writes a
// store-walk-ordered markdown file with checkboxes.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseShoppingList } = require('./lib/nlp-parser');

// ---- Load aisle sort order (path relative to project root) ----
const aisleDataPath = path.resolve(__dirname, 'lib', 'aisleData.js');
// aisleData.js declares `const AISLE_SORT_ORDER = {...}` but doesn't export.
// We eval it to grab the value without modifying that file.
const aisleDataSrc = fs.readFileSync(aisleDataPath, 'utf-8');
const AISLE_SORT_ORDER = (function () {
  const m = aisleDataSrc.match(/const AISLE_SORT_ORDER\s*=\s*(\{[\s\S]*?\n\});/);
  if (!m) throw new Error('Could not parse AISLE_SORT_ORDER from aisleData.js');
  return eval('(' + m[1] + ')');
})();

// ============================================================
// ShopRite Storefrontgateway API (inlined from server.js)
// ============================================================
const API_BASE = 'https://storefrontgateway.shoprite.com/api';
const DEFAULT_STORE_ID = '592';

// ---- Parse --store=NNN from CLI args ----
const storeArg = process.argv.find(a => a.startsWith('--store='));
const STORE_ID = storeArg ? storeArg.split('=')[1] : DEFAULT_STORE_ID;

// ---- Persistent disk cache (scraper/cache.json, keyed by store) ----
const CACHE_PATH = path.resolve(__dirname, 'cache.json');
const cache = new Map();
let allCacheData = {};

function loadCache() {
  try {
    allCacheData = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch (_) { /* no cache file yet */ }
  const storeData = allCacheData[STORE_ID] || {};
  for (const [k, v] of Object.entries(storeData)) cache.set(k, v);
}

function saveCache() {
  // Only persist items that resolved to a real aisle (not Unknown)
  const obj = {};
  for (const [k, v] of cache) {
    if (v.aisle !== 'Unknown') obj[k] = v;
  }
  allCacheData[STORE_ID] = obj;
  fs.writeFileSync(CACHE_PATH, JSON.stringify(allCacheData, null, 2), 'utf-8');
}

loadCache();

function apiGet(urlPath) {
  return new Promise((resolve, reject) => {
    const url = urlPath.startsWith('http') ? urlPath : API_BASE + urlPath;
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Origin': 'https://www.shoprite.com',
        'Referer': 'https://www.shoprite.com/',
        'Authorization': 'Bearer anonymous',
        'X-Site-Host': 'https://www.shoprite.com',
      },
    };
    https.get(opts, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API returned ${res.statusCode}`));
        } else {
          try { resolve(JSON.parse(body)); }
          catch (e) { reject(new Error('Invalid JSON response')); }
        }
      });
    }).on('error', reject);
  });
}

// ---- Department names for parsing raw aisle text ----
const DEPARTMENTS = [
  'INTERNATIONAL CHEESE', 'CUSTOMER SERVICE', 'DAIRY/KOSHER',
  'PRODUCE', 'BAKERY', 'BACKWALL', 'DELI', 'APPY', 'MEAT', 'SEAFOOD',
  'FROZEN', 'PHARMACY', 'FLORAL', 'BREAD', 'DAIRY', 'HBC', 'NATURAL',
  'KOSHER', 'GROCERY', 'BULK',
];

const DEPT_DISPLAY = {
  'DAIRY/KOSHER': 'Dairy',       'DAIRY': 'Dairy',
  'PRODUCE': 'Produce',          'BAKERY': 'Bakery',
  'DELI': 'Deli',                'APPY': 'Deli',
  'MEAT': 'Meat',                'SEAFOOD': 'Seafood',
  'FROZEN': 'Frozen',            'PHARMACY': 'Pharmacy',
  'FLORAL': 'Floral',            'BREAD': 'Bread',
  'HBC': 'Health & Beauty',      'NATURAL': 'Natural',
  'KOSHER': 'Kosher',            'GROCERY': 'Grocery',
  'BULK': 'Bulk',
  'INTERNATIONAL CHEESE': 'International Cheese',
  'CUSTOMER SERVICE': 'Customer Service',
  'BACKWALL': 'Backwall',
};

function parseAisleText(raw) {
  if (!raw) return { aisle: 'Unknown', bay: '' };
  let text = raw.trim();
  if (!text) return { aisle: 'Unknown', bay: '' };

  text = text.replace(/^Aisle\s+/i, '').trim();

  const numMatch = text.match(/^AISLE\s*(\d+)$/i) || text.match(/^(\d+)([A-Za-z]?)$/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    return { aisle: `Aisle ${num}`, bay: numMatch[2] || '' };
  }

  const upper = text.toUpperCase();
  for (const dept of DEPARTMENTS) {
    if (upper.startsWith(dept)) {
      let remainder = text.substring(dept.length).trim();
      remainder = remainder.replace(/^[\/,;:\-]+\s*/, '').trim();
      const aisleName = DEPT_DISPLAY[dept] || dept.charAt(0) + dept.slice(1).toLowerCase();
      return { aisle: aisleName, bay: remainder };
    }
  }

  const titleCased = text.split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return { aisle: titleCased, bay: '' };
}

async function lookupItem(itemName, index, total) {
  const cacheKey = itemName.toLowerCase().trim();
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    const loc = cached.bay ? `${cached.aisle} ${cached.bay}` : cached.aisle;
    process.stderr.write(`  [${index}/${total}] ${itemName} → ${loc} (cached)\n`);
    return cached;
  }

  try {
    const searchData = await apiGet(
      `/stores/${STORE_ID}/multisearch?q=${encodeURIComponent(itemName)}&take=1`
    );

    if (!searchData.items?.[0]?.items?.[0]) {
      const result = { aisle: 'Unknown', bay: '' };
      cache.set(cacheKey, result);
      process.stderr.write(`  [${index}/${total}] ${itemName} → Unknown (no results)\n`);
      return result;
    }

    const product = searchData.items[0].items[0];
    const sku = product.sku;

    const detail = await apiGet(`/stores/${STORE_ID}/products/${sku}`);
    const loc = detail.productLocation;

    if (!loc || !loc.aisle) {
      const result = { aisle: 'Unknown', bay: '' };
      cache.set(cacheKey, result);
      process.stderr.write(`  [${index}/${total}] ${itemName} → Unknown (no location)\n`);
      return result;
    }

    const result = parseAisleText(loc.aisle);
    cache.set(cacheKey, result);
    const display = result.bay ? `${result.aisle} ${result.bay}` : result.aisle;
    process.stderr.write(`  [${index}/${total}] ${itemName} → ${display}\n`);
    return result;
  } catch (err) {
    process.stderr.write(`  [${index}/${total}] ${itemName} → ERROR: ${err.message}\n`);
    return { aisle: 'Unknown', bay: '' };
  }
}

// ============================================================
// Main CLI pipeline
// ============================================================
async function main() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const inputPath = args[0];
  if (!inputPath) {
    process.stderr.write('Usage: node scraper/shop.js <grocery-list.txt> [--store=NNN]\n');
    process.exit(1);
  }

  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    process.stderr.write(`File not found: ${resolved}\n`);
    process.exit(1);
  }

  // ---- Step 1: Parse ----
  const rawText = fs.readFileSync(resolved, 'utf-8');
  const parsed = parseShoppingList(rawText);

  const items = parsed.filter(p => p.name && !p.directive);
  const directives = parsed.filter(p => p.directive);

  process.stderr.write(
    `Parsing ${path.basename(resolved)}... ${items.length} items, ${directives.length} directive${directives.length !== 1 ? 's' : ''} skipped.\n`
  );

  // ---- Step 2: API lookups ----
  process.stderr.write('Looking up aisle locations...\n');

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const loc = await lookupItem(item.lookupTerm, i + 1, items.length);
    item.aisle = loc.aisle;
    item.bay = loc.bay;
  }

  saveCache();

  // ---- Step 3: Group & sort by aisle ----
  const groups = {};
  for (const item of items) {
    const key = item.aisle || 'Unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  const sortedAisles = Object.keys(groups).sort((a, b) => {
    const sa = AISLE_SORT_ORDER[a] ?? 98;
    const sb = AISLE_SORT_ORDER[b] ?? 98;
    return sa - sb;
  });

  // ---- Step 4: Build markdown ----
  const now = new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthFull = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December'];
  const mon = months[now.getMonth()];
  const monFull = monthFull[now.getMonth()];
  const day = now.getDate();
  const year = now.getFullYear();

  const lines = [];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow = days[now.getDay()];
  const hh = String(now.getHours()).padStart(2, '0');
  const nn = String(now.getMinutes()).padStart(2, '0');
  lines.push(`# Shopping List — ${monFull} ${day}, ${year} ${dow} ${hh}:${nn}`);
  lines.push(`**Store:** ShopRite #${STORE_ID} — South Plainfield, NJ`);
  lines.push('');

  let foundCount = 0;
  let unknownCount = 0;

  for (const aisle of sortedAisles) {
    lines.push(`## ${aisle}`);
    for (const item of groups[aisle]) {
      let line = `- [ ] ${item.name}`;
      if (item.qty) line += ` ×${item.qty}`;
      if (item.bay) line += ` — ${item.bay}`;
      if (item.notes) line += ` *(${item.notes})*`;
      lines.push(line);

      if (aisle === 'Unknown') unknownCount++;
      else foundCount++;
    }
    lines.push('');
  }

  // ---- Append original input (compressed vertical space) ----
  lines.push('---');
  lines.push(`<details><summary>Original list (${path.basename(resolved)})</summary>`);
  lines.push('');
  lines.push('```');
  const compressed = rawText.replace(/\n{3,}/g, '\n\n').trim();
  lines.push(compressed);
  lines.push('```');
  lines.push('</details>');
  lines.push('');

  const md = lines.join('\n');

  // ---- Write output file ----
  const outDir = path.dirname(resolved);
  const outName = `${mon}-${String(day).padStart(2, '0')}.md`;
  const outPath = path.join(outDir, outName);

  fs.writeFileSync(outPath, md, 'utf-8');
  process.stderr.write(
    `\nWrote ${outName} (${items.length} items, ${foundCount} found, ${unknownCount} unknown)\n`
  );
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err.message}\n`);
  process.exit(1);
});
