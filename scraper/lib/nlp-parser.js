// ============================================================
// NLP Shopping List Parser
// ============================================================
// Multi-stage pipeline that handles natural language grocery lists:
//   Stage 1: splitIntoBlocks — identify section headers vs item lines
//   Stage 2: expandLine — split one line into multiple items
//   Stage 3: parseItem — extract structured fields from each item

// ---- Abbreviation map ----
const ABBREVIATIONS = {
  'oj':        'orange juice',
  'evoo':      'extra virgin olive oil',
  'pb':        'peanut butter',
  'pb&j':      'peanut butter and jelly',
  'dz':        'dozen',
  'btl':       'bottle',
  'btls':      'bottles',
  'pkg':       'package',
  'pkt':       'packet',
  'tbsp':      'tablespoon',
  'tsp':       'teaspoon',
  'gal':       'gallon',
  'qt':        'quart',
  'pt':        'pint',
  'lg':        'large',
  'sm':        'small',
  'med':       'medium',
};

// ---- Compounds that should NOT be split on "and" ----
const AND_COMPOUNDS = [
  'half and half',
  'mac and cheese',
  'macaroni and cheese',
  'salt and pepper',
  'bread and butter',
  'peanut butter and jelly',
  'chips and dip',
  'rice and beans',
  'oil and vinegar',
  'cream and sugar',
  'ham and cheese',
  'surf and turf',
  'fruit and nut',
  'franks and beans',
];

// ---- Directive phrases to skip ----
const DIRECTIVE_PATTERNS = [
  /^anything you like/i,
  /^whatever you like/i,
  /^surprise us/i,
  /^whatever looks good/i,
  /^your choice/i,
  /^dealer'?s? choice/i,
  /^if something looks/i,
  /^surprise us if something/i,
];

// ---- Section header patterns ----
const HEADER_PATTERNS = [
  /^aisle\s+\d+.*:/i,
  /^across\s+back/i,
  /^back\s+of\s+(the\s+)?store/i,
  /^last\s+aisle/i,
  /^first\s+aisle/i,
  /^freezer\s+section/i,
  /^frozen\s+section/i,
  /^dairy\s+section/i,
  /^deli\s+section/i,
  /^produce\s+section/i,
  /^bakery\s+section/i,
  /^meat\s+section/i,
];

// ---- Adjective prefixes to strip from lookup terms ----
const STRIP_PREFIXES = [
  'plain', 'fresh', 'deli', 'organic', 'raw', 'whole', 'natural',
  'extra virgin', 'extra', 'large', 'small', 'medium',
  'salted', 'unsalted', 'honey', 'smoked',
];

// ---- Trailing phrases to strip from lookup terms ----
const STRIP_SUFFIXES = [
  /\s+we\s+eat$/i,
  /\s+we\s+like$/i,
  /\s+we\s+use$/i,
  /\s+we\s+need$/i,
  /\s+in\s+a\s+bag$/i,
  /\s+in\s+bags?$/i,
  /\s+in\s+water$/i,
  /\s+cans?$/i,
  /\s+bottles?$/i,
];

// ---- Category prefixes (inline headers like "Fruits:") ----
// Allows optional parenthetical between name and colon: "Cold cuts (note):"
const CATEGORY_PREFIX_RE = /^(fruits?|veggies|vegetables?|cereal|cold\s*cuts?|snacks?|drinks?|beverages?|meats?|dairy|frozen|bread|condiments?|spices?|herbs?)\s*(?:\([^)]*\)\s*)?:/i;

// ---- Brand/qualifier prefixes (like "Pillsbury quick bake tubes:") ----
// These are prefixes followed by colon that introduce a list but are not categories
const BRAND_PREFIX_RE = /^([A-Z][a-zA-Z\s]+(?:brand|tubes?|packs?|variety|style|kind))[\s]*:/i;

// ============================================================
// Stage 1: splitIntoBlocks
// ============================================================
function splitIntoBlocks(text) {
  const lines = text.split(/\n/);
  const blocks = [];
  let currentSection = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Check if this line is a section header
    const isHeader = HEADER_PATTERNS.some(p => p.test(line));
    if (isHeader) {
      // Extract section name (strip trailing colon and parenthetical)
      let sectionName = line.replace(/\s*\(.*?\)\s*/g, '').replace(/:.*$/, '').trim();
      currentSection = sectionName;

      // Check for inline content after the colon
      const colonIdx = line.indexOf(':');
      if (colonIdx !== -1) {
        const afterColon = line.substring(colonIdx + 1).trim();
        if (afterColon) {
          // Could be a directive or items after the header
          const isDirective = DIRECTIVE_PATTERNS.some(p => p.test(afterColon));
          if (isDirective) {
            blocks.push({ type: 'directive', text: afterColon, section: currentSection, raw: line });
          } else {
            blocks.push({ type: 'items', text: afterColon, section: currentSection, raw: line });
          }
        }
      }
      continue;
    }

    blocks.push({ type: 'items', text: line, section: currentSection, raw: line });
  }

  return blocks;
}

// ============================================================
// Stage 2: expandLine
// ============================================================
function expandLine(block) {
  if (block.type === 'directive') {
    return [{ raw: block.raw, directive: block.text, section: block.section }];
  }

  let text = block.text;
  const section = block.section;
  const raw = block.raw;
  const results = [];

  // Extract category prefix if present ("Fruits:", "Cereal:", etc.)
  let category = null;
  const catMatch = text.match(CATEGORY_PREFIX_RE);
  if (catMatch) {
    category = catMatch[1].trim();
    text = text.substring(catMatch[0].length).trim();
  }

  // Check for brand/qualifier prefix ("Pillsbury quick bake tubes:")
  // More generic: anything before colon that looks like a qualifier
  if (!category) {
    const genericColonMatch = text.match(/^([^,:]{3,}):\s*(.+)/);
    if (genericColonMatch) {
      const before = genericColonMatch[1].trim();
      const after = genericColonMatch[2].trim();
      // If what's before the colon doesn't look like "quantity pattern: items"
      // and what's after has commas (a list), treat it as a qualifier prefix
      const isQtyPrefix = /^\d+\s+(bag|can|box|pack|ct|lb)s?\s+each$/i.test(before);
      if (!isQtyPrefix && (after.includes(',') || /\band\b/i.test(after))) {
        category = before;
        text = after;
      }
    }
  }

  // Extract shared quantity prefix like "1 bag each:"
  let sharedQty = null;
  const sharedQtyMatch = text.match(/^(\d+\s+(?:bag|can|box|pack|ct|lb|bottle|jar|bunch)s?\s+each)\s*:\s*/i);
  if (sharedQtyMatch) {
    sharedQty = sharedQtyMatch[1].trim();
    text = text.substring(sharedQtyMatch[0].length).trim();
  }

  // Split on commas first
  let segments = text.split(/\s*,\s*/);

  // For each segment, potentially split on "and" (unless compound)
  const items = [];
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (!trimmed) continue;

    // Check if this is a directive
    const isDirective = DIRECTIVE_PATTERNS.some(p => p.test(trimmed));
    if (isDirective) {
      results.push({ raw: raw, directive: trimmed, section: section });
      continue;
    }

    // Strip trailing periods
    const cleaned = trimmed.replace(/\.\s*$/, '').trim();
    if (!cleaned) continue;

    // Try "and"-split, respecting compounds
    const andSplit = splitOnAnd(cleaned);
    items.push(...andSplit);
  }

  for (const item of items) {
    results.push({
      raw: raw,
      itemText: item.trim(),
      section: section,
      category: category,
      sharedQty: sharedQty,
    });
  }

  return results;
}

function splitOnAnd(text) {
  // Check if the whole phrase is a known compound
  const lower = text.toLowerCase();
  for (const compound of AND_COMPOUNDS) {
    if (lower.includes(compound)) {
      return [text];
    }
  }

  // Split on " and " (word boundary)
  const parts = text.split(/\s+and\s+/i);
  if (parts.length > 1) {
    return parts.map(p => p.trim()).filter(Boolean);
  }
  return [text];
}

// ============================================================
// Stage 3: parseItem
// ============================================================
function parseItem(entry) {
  if (entry.directive) {
    return {
      raw: entry.raw,
      name: null,
      qty: '',
      notes: '',
      lookupTerm: null,
      category: entry.category || null,
      section: entry.section || null,
      directive: entry.directive,
    };
  }

  let text = entry.itemText;
  const section = entry.section;
  const category = entry.category;
  const sharedQty = entry.sharedQty;

  // ---- Extract notes (parentheticals) ----
  const notesList = [];
  text = text.replace(/\(([^)]+)\)/g, (_, content) => {
    notesList.push(content.trim());
    return '';
  }).trim();

  const notes = notesList.join('; ');

  // ---- Normalize abbreviations ----
  // Handle "1/2 & 1/2" → "half and half"
  text = text.replace(/1\/2\s*&\s*1\/2/gi, 'half and half');
  text = text.replace(/1\/2\s+and\s+1\/2/gi, 'half and half');

  // Handle "Dz" prefix (e.g., "Dz eggs x2")
  let dozenMultiplier = false;
  if (/^dz\b/i.test(text)) {
    dozenMultiplier = true;
    text = text.replace(/^dz\s*/i, '').trim();
  }

  // ---- Extract quantity ----
  let qty = '';
  let name = text;

  // Pattern: trailing "x2", "x 3", etc.
  const trailingX = name.match(/^(.+?)\s+x\s*(\d+)\s*$/i);
  if (trailingX) {
    name = trailingX[1].trim();
    qty = trailingX[2];
  }

  // Pattern: leading "4 cans", "2 large packs of"
  if (!qty) {
    const leadingQty = name.match(/^(\d+[-–]?\d*)\s+(cans?|boxes?|bags?|packs?|bottles?|jars?|bunche?s?|large\s+packs?\s+of|packs?\s+of)\s+(.+)/i);
    if (leadingQty) {
      qty = `${leadingQty[1]} ${leadingQty[2]}`.trim();
      name = leadingQty[3].trim();
    }
  }

  // Pattern: leading plain number "3-4 avocados", "4-5 limes"
  if (!qty) {
    const leadingNum = name.match(/^(\d+[-–]\d+|\d+)\s+(.+)/);
    if (leadingNum) {
      // Don't consume the number if it looks like part of the name (e.g., "7up")
      const rest = leadingNum[2];
      if (!/^[a-z]/.test(rest) || rest.length > 2) {
        qty = leadingNum[1];
        name = rest.trim();
      }
    }
  }

  // Apply dozen multiplier
  if (dozenMultiplier) {
    if (qty) {
      qty = `${qty} dozen`;
    } else {
      qty = 'dozen';
    }
  }

  // Apply shared quantity if no specific qty found
  if (!qty && sharedQty) {
    qty = sharedQty;
  }

  // ---- Normalize single-word abbreviations in name ----
  const nameLower = name.toLowerCase().trim();
  if (ABBREVIATIONS[nameLower]) {
    name = ABBREVIATIONS[nameLower];
  }

  // ---- Build lookup term ----
  let lookupTerm = name;

  // Handle "or" alternatives: "yellow or white potatoes" → "potatoes"
  // "honey or deli Ham" → "ham"
  // "Sugar in the raw or organic sugar" → "sugar"
  const orMatch = lookupTerm.match(/^(.+?)\s+or\s+(.+)$/i);
  if (orMatch) {
    const left = orMatch[1].trim();
    const right = orMatch[2].trim();
    // Use the right side (usually more specific/core), but take the noun
    // If right side has an adjective + noun, prefer the noun
    // Simple heuristic: use the shorter side, or the right side's last word
    const rightWords = right.split(/\s+/);
    const leftWords = left.split(/\s+/);
    // If both sides share a common noun, use that
    const lastRight = rightWords[rightWords.length - 1].toLowerCase();
    const lastLeft = leftWords[leftWords.length - 1].toLowerCase();
    if (lastRight === lastLeft) {
      // Shared noun: "yellow potatoes or white potatoes" → "potatoes"
      lookupTerm = lastRight;
    } else if (rightWords.length > 1) {
      // "yellow or white potatoes" → noun is last word of right side
      lookupTerm = rightWords[rightWords.length - 1];
    } else if (leftWords.length > 1) {
      // "dark chocolate or milk" → noun is last word of left side
      lookupTerm = leftWords[leftWords.length - 1];
    } else {
      // Both single words, use right side
      lookupTerm = right;
    }
  }

  // Strip adjective prefixes from lookup
  let lookupLower = lookupTerm.toLowerCase();
  for (const prefix of STRIP_PREFIXES) {
    if (lookupLower.startsWith(prefix + ' ')) {
      lookupTerm = lookupTerm.substring(prefix.length).trim();
      lookupLower = lookupTerm.toLowerCase();
    }
  }

  // Strip trailing qualifier phrases
  for (const suffix of STRIP_SUFFIXES) {
    lookupTerm = lookupTerm.replace(suffix, '').trim();
  }

  // Normalize "veggies" → "vegetables" in lookup
  lookupTerm = lookupTerm.replace(/\bveggies\b/gi, 'vegetables');

  // Clean up whitespace
  lookupTerm = lookupTerm.replace(/\s+/g, ' ').trim();
  name = name.replace(/\s+/g, ' ').trim();

  // Capitalize name nicely
  if (name === name.toLowerCase()) {
    name = name.charAt(0).toUpperCase() + name.slice(1);
  }

  return {
    raw: entry.raw,
    name: name,
    qty: qty,
    notes: notes,
    lookupTerm: lookupTerm.toLowerCase(),
    category: category || null,
    section: section || null,
    directive: null,
  };
}

// ============================================================
// Main parse function
// ============================================================
function parseShoppingList(text) {
  const blocks = splitIntoBlocks(text);
  const expanded = [];
  for (const block of blocks) {
    expanded.push(...expandLine(block));
  }
  const parsed = expanded.map(parseItem);
  return parsed;
}

module.exports = { parseShoppingList, splitIntoBlocks, expandLine, parseItem };
