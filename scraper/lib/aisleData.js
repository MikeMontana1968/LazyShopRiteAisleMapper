// ============================================================
// ShopRite Aisle Database — Store #592 South Plainfield, NJ
// ============================================================
//
// STORE-SPECIFIC, NOT WAKEFERN-WIDE.
// Aisle numbers and department locations vary by store. This file
// is for ShopRite #592 (South Plainfield, NJ) only.
//
// How this was built:
//   Probed via the ShopRite storefrontgateway API on 2026-02-14
//   (https://storefrontgateway.shoprite.com/api) using the probe-*.js
//   scripts to query product locations for ~200 common items, then
//   grouped by aisle to establish the walk-order and keyword map.
//
// How to update:
//   AISLE_SORT_ORDER — Edit manually if the store rearranges aisles.
//     The numeric values set walk order (lower = earlier in the trip).
//

const AISLE_SORT_ORDER = {
  'Produce':          1,
  'Bakery':           2,
  'Bread':            3,
  'Deli':             4,
  'Meat':             5,
  'Seafood':          6,
  'Backwall':         7,
  'Aisle 1':          10,
  'Aisle 2':          11,
  'Aisle 3':          12,
  'Aisle 4':          13,
  'Aisle 5':          14,
  'Aisle 6':          15,
  'Aisle 7':          16,
  'Aisle 8':          17,
  'Aisle 9':          18,
  'Aisle 10':         19,
  'Aisle 11':         20,
  'Aisle 12':         21,
  'Aisle 13':         22,
  'Aisle 14':         23,
  'Aisle 15':         24,
  'Aisle 16':         25,
  'Aisle 17':         26,
  'Aisle 18':         27,
  'Aisle 19':         28,
  'Aisle 20':         29,
  'Dairy':            30,
  'International Cheese': 31,
  'Kosher':           32,
  'Frozen':           33,
  'Natural':          34,
  'Health & Beauty':  35,
  'Pharmacy':         36,
  'Floral':           37,
  'Grocery':          38,
  'Bulk':             39,
  'Customer Service': 40,
  'Unknown':          99,
};
