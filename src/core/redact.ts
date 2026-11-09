// Masks personal details before anything leaves the device, and puts them back afterwards.
//
// Two sources of things to mask: patterns that need no model (labelled IDs, dates, phone
// numbers, emails, addresses, SSNs) and entities the on-device model found (names written
// in running text). Every distinct value gets a stable placeholder such as [PATIENT_NAME]
// or [DATE_2]; the map from placeholder to value never leaves the device.

export type Category =
  | "PATIENT_NAME" | "PROVIDER_NAME" | "PERSON_NAME" | "MEMBER_ID" | "GROUP_NUMBER" | "CLAIM_NUMBER"
  | "ACCOUNT_NUMBER" | "DATE_OF_BIRTH" | "SERVICE_DATE" | "NOTICE_DATE" | "DATE"
  | "ADDRESS" | "PHONE" | "EMAIL" | "SSN" | "OTHER";

export interface Entity {
  category: Category;
  value: string;
}

export interface Redaction {
  text: string;                       // the masked text
  map: Record<string, string>;        // "[PATIENT_NAME]" -> "Dana Whitfield"
  found: { placeholder: string; category: Category; value: string }[];
}

const MONTHS = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
export const DATE_PATTERN = new RegExp(
  `\\b(?:\\d{1,2}/\\d{1,2}/(?:\\d{4}|\\d{2})|\\d{4}-\\d{2}-\\d{2}|${MONTHS}\\.? \\d{1,2},? \\d{4}|\\d{1,2} ${MONTHS} \\d{4})\\b`,
  "g",
);

const MONTH_DAY = new RegExp(`\\b${MONTHS}\\.? \\d{1,2}(?:st|nd|rd|th)?\\b(?!,? \\d{4})`, "g");

// [label pattern, category]: the value is the token (or name) that follows the label.
const LABELLED: [RegExp, Category][] = [
  [/\b(?:member|subscriber|enrollee|beneficiary)\s*(?:id|identification|number|no\.?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/gi, "MEMBER_ID"],
  [/\b(?:medicare (?:number|no\.?)|mbi)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{6,})/gi, "MEMBER_ID"],
  [/\bgroup\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,})/gi, "GROUP_NUMBER"],
  [/\bclaim\s*(?:number|no\.?|#|id)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi, "CLAIM_NUMBER"],
  [/\b(?:account|patient account|reference)\s*(?:number|no\.?|#)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})/gi, "ACCOUNT_NUMBER"],
  [/\b(?:date of birth|birth date|dob)\s*[:#]?\s*([^\n,;]{6,20}?\d{2,4})\b/gi, "DATE_OF_BIRTH"],
  // The label in any case, the name itself capitalised ("Patient: Marcus Oyelaran").
  [/\b(?:[Pp]atient|[Mm]ember|[Ss]ubscriber|[Ii]nsured|[Ee]nrollee|PATIENT|MEMBER)(?: [Nn]ame| NAME)?\s*:\s*([A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+){1,3})/g, "PATIENT_NAME"],
  [/\bDear (?:Mr\.?|Ms\.?|Mrs\.?|Mx\.?|Dr\.?)?\s*([A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+){0,2}),/g, "PATIENT_NAME"],
  [/\b((?:Dr\.|Doctor) [A-Z][a-zA-Z'.-]+(?: [A-Z][a-zA-Z'.-]+)?)/g, "PROVIDER_NAME"],
];

const PLAIN: [RegExp, Category][] = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "EMAIL"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "SSN"],
  [/(?:\+1[\s.-]?)?(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g, "PHONE"],
  [/\b\d{1,6} [A-Z0-9][A-Za-z0-9.' ]{1,40} (?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Ter|Terrace|Cir|Circle)\.?(?:,? (?:Apt|Suite|Ste|Unit|#)\.? ?[A-Za-z0-9-]+)?\b/g, "ADDRESS"],
  [/\b[A-Z][A-Za-z .'-]{1,30}, [A-Z]{2} \d{5}(?:-\d{4})?\b/g, "ADDRESS"],
  [/\bP\.?O\.? Box \d{1,6}\b/gi, "ADDRESS"],
];

/** Personal details found by patterns alone (no model). */
export function patternEntities(text: string): Entity[] {
  const out: Entity[] = [];
  for (const [re, category] of LABELLED) {
    for (const m of text.matchAll(re)) out.push({ category, value: m[1].trim() });
  }
  for (const [re, category] of PLAIN) {
    for (const m of text.matchAll(re)) out.push({ category, value: m[0].trim() });
  }
  for (const m of text.matchAll(DATE_PATTERN)) out.push({ category: "DATE", value: m[0] });
  // A month and day without a year ("from July 20 to ...") still dates someone's care.
  for (const m of text.matchAll(MONTH_DAY)) out.push({ category: "DATE", value: m[0] });
  return out;
}

const PRIORITY: Category[] = [
  "SSN", "EMAIL", "PHONE", "MEMBER_ID", "GROUP_NUMBER", "CLAIM_NUMBER", "ACCOUNT_NUMBER",
  "DATE_OF_BIRTH", "SERVICE_DATE", "NOTICE_DATE", "PATIENT_NAME", "PROVIDER_NAME", "PERSON_NAME", "ADDRESS", "DATE", "OTHER",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Masks every entity in `text`. Entities with the same value (ignoring case and spacing) share a
 * placeholder; the most specific category wins (a date of birth is not also a plain DATE).
 * `previous` keeps placeholders stable when masking more text later (the user's own notes).
 */
export function redact(text: string, entities: Entity[], previous?: Redaction): Redaction {
  const norm = (v: string) => v.replace(/\s+/g, " ").trim().toLowerCase();
  const best = new Map<string, Entity>();
  for (const e of entities) {
    const v = e.value.replace(/\s+/g, " ").trim();
    if (v.length < 3) continue;
    const k = norm(v);
    const cur = best.get(k);
    if (!cur || PRIORITY.indexOf(e.category) < PRIORITY.indexOf(cur.category)) best.set(k, { category: e.category, value: v });
  }
  const map: Record<string, string> = { ...(previous?.map ?? {}) };
  const byValue = new Map(Object.entries(map).map(([ph, v]) => [norm(v), ph]));
  const counts = new Map<Category, number>();
  for (const ph of Object.keys(map)) {
    const cat = ph.slice(1, -1).replace(/_\d+$/, "") as Category;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const found: Redaction["found"] = [...(previous?.found ?? [])];
  const ordered = [...best.values()].sort((a, b) => PRIORITY.indexOf(a.category) - PRIORITY.indexOf(b.category));
  for (const e of ordered) {
    if (byValue.has(norm(e.value))) continue;
    const n = (counts.get(e.category) ?? 0) + 1;
    counts.set(e.category, n);
    const ph = n === 1 ? `[${e.category}]` : `[${e.category}_${n}]`;
    map[ph] = e.value;
    byValue.set(norm(e.value), ph);
    found.push({ placeholder: ph, category: e.category, value: e.value });
  }
  // Replace longer values first so "Dana Whitfield" goes before "Dana".
  let out = text;
  const pairs = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  for (const [ph, v] of pairs) {
    const re = new RegExp(escape(v).replace(/\s+/g, "\\s+"), "gi");
    out = out.replace(re, ph);
  }
  return { text: out, map, found };
}

/** Puts the real details back into text written with the placeholders. */
export function fillBack(text: string, map: Record<string, string>): { text: string; unknown: string[] } {
  // Known placeholders go back in; any other bracketed capitals ("[YOUR PHONE NUMBER]") are blanks
  // the writer left for the person to fill in.
  const out = text.replace(/\[[A-Z][A-Z_]*(?:_\d+)?\]/g, (ph) => (ph in map ? map[ph] : ph));
  const unknown = new Set(out.match(/\[[A-Z][A-Z0-9 ,.'’/()_-]*[A-Z0-9)]\]/g) ?? []);
  return { text: out, unknown: [...unknown] };
}

/** Whatever still looks personal after masking: a last check shown on the consent screen. */
export function leftovers(masked: string): Entity[] {
  return patternEntities(masked).filter((e) => !/^\[[A-Z_0-9]+\]$/.test(e.value));
}
