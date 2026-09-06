export type NormalizedNeed = {
  key: string;
  name: string;
  category: string;
};

function ascii(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^a-zA-Z0-9'&+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeKey(value: string) {
  return ascii(value)
    .toLowerCase()
    .replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|ml|cl|litre|litres|l|pints?|oz)\b/g, " ")
    .replace(/\b\d+\s*[x×]\s*\d+(?:\.\d+)?\s*(?:kg|g|ml|cl|l)?\b/g, " ")
    .replace(/\b(?:pack|pk)\s*of\s*\d+\b/g, " ")
    .replace(/\b\d+\s*(?:pack|pk)\b/g, " ")
    .replace(/\b\d+\s*count\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function has(value: string, ...terms: string[]) {
  return terms.every((term) => value.includes(term));
}

function freshFruit(value: string, fruit: string) {
  if (!value.includes(fruit)) return false;
  const reject = ["yog", "bar", "wafer", "muffin", "cereal", "drink", "dessert", "crumble", "pie", "jam", "juice", "smoothie", "baby", "kiddylicious", "ella", "nutri", "onken"];
  return !reject.some((term) => value.includes(term));
}

export function inferNeed(articleName: string): NormalizedNeed {
  const clean = ascii(articleName);
  const value = ` ${clean.toLowerCase()} `;

  if ((has(value, "semi", "skimmed", "milk") || has(value, "semi", "skimmed milk")) && !value.includes("chocolate") && !value.includes("formula")) {
    return { key: "semi-skimmed-milk", name: "Semi-skimmed milk", category: "Dairy & eggs" };
  }
  if (has(value, "whole", "milk") && !value.includes("chocolate") && !value.includes("formula")) {
    return { key: "whole-milk", name: "Whole milk", category: "Dairy & eggs" };
  }
  if (has(value, "double", "cream")) return { key: "double-cream", name: "Double cream", category: "Dairy & eggs" };

  if (value.includes("bread") && !["pitta", "naan", "garlic", "flatbread", "breaded", "breadstick", "gingerbread", "pizza"].some((term) => value.includes(term))) {
    if (value.includes("wholemeal")) return { key: "wholemeal-bread", name: "Wholemeal bread", category: "Bakery" };
    if (value.includes("50/50") || value.includes("half and half")) return { key: "half-and-half-bread", name: "50/50 bread", category: "Bakery" };
    if (value.includes("white")) return { key: "white-bread", name: "White bread", category: "Bakery" };
  }

  if (freshFruit(value, "blueberr")) return { key: "blueberries", name: "Blueberries", category: "Fruit & veg" };
  if (freshFruit(value, "blackberr")) return { key: "blackberries", name: "Blackberries", category: "Fruit & veg" };
  if (freshFruit(value, "raspberr")) return { key: "raspberries", name: "Raspberries", category: "Fruit & veg" };
  if (freshFruit(value, "strawberr")) return { key: "strawberries", name: "Strawberries", category: "Fruit & veg" };
  if (value.includes("banana") && !["yog", "bar", "wafer", "dessert", "milk", "smoothie", "baby"].some((term) => value.includes(term))) return { key: "bananas", name: "Bananas", category: "Fruit & veg" };
  if (value.includes("melon slices")) return { key: "melon-slices", name: "Melon slices", category: "Fruit & veg" };

  if (value.includes("sausage roll")) return { key: "sausage-rolls", name: "Sausage rolls", category: "Chilled" };
  if (value.includes("baked beans") && !value.includes("coffee")) return { key: "baked-beans", name: "Baked beans", category: "Tins & cupboard" };
  if ((value.includes("dishwasher") && (value.includes("capsule") || value.includes("tablet")))) return { key: "dishwasher-tablets", name: "Dishwasher tablets", category: "Household" };
  if (value.includes("wafer thin") && value.includes("ham")) return { key: "wafer-thin-ham", name: "Wafer thin ham", category: "Chilled" };
  if (value.includes("seedless raisins")) return { key: "raisins", name: "Raisins", category: "Snacks & drinks" };

  const nappySize = value.match(/(?:nappy pants?|easy fit pants?).*?size\s*(\d+)/i);
  if (nappySize) return { key: `nappy-pants-size-${nappySize[1]}`, name: `Nappy pants size ${nappySize[1]}`, category: "Baby" };

  const category = inferCategory(clean);
  const genericKey = normalizeKey(clean);
  return { key: genericKey || clean.toLowerCase(), name: clean, category };
}

export function inferCategory(articleName: string) {
  const value = articleName.toLowerCase();
  if (/blueberr|blackberr|raspberr|strawberr|banana|apple|pear|grape|melon|cucumber|tomato|plum|peach|easy peeler|orange|lettuce|pepper|carrot|potato/.test(value)) return "Fruit & veg";
  if (/bread|bagel|croissant|brioche|pitta|naan|wrap|rolls?\b/.test(value) && !/sausage roll/.test(value)) return "Bakery";
  if (/milk|cream|cheese|yog|yogh|butter|egg/.test(value)) return "Dairy & eggs";
  if (/ham|sausage|bacon|chicken|beef|pork|turkey|salami|pizza|ready meal/.test(value)) return "Chilled";
  if (/beans|pasta|rice|sauce|cereal|coffee|tea|flour|sugar|stock|tin|tinned/.test(value)) return "Tins & cupboard";
  if (/crisps|biscuit|chocolate|snack|juice|squash|cola|zero cans|raisins|bar multipack/.test(value)) return "Snacks & drinks";
  if (/frozen|ice cream/.test(value)) return "Frozen";
  if (/dishwasher|washing|detergent|cleaner|toilet roll|kitchen roll|bin bag|foil|bleach/.test(value)) return "Household";
  if (/nappy|baby|fred & flo|aptamil|wipes/.test(value)) return "Baby";
  if (/shampoo|conditioner|toothpaste|deodorant|sanitary|pads|shower gel|soap/.test(value)) return "Health & beauty";
  return "Other";
}
