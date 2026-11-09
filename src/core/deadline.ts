// Works out the appeal deadline for a denial, from the plan type and the date on the notice.
//
// Rules (checked 2026-11-08/09 against the official pages linked in RULES):
// - Marketplace and other ACA individual plans: internal appeal within 180 days of the notice.
// - Job-based (employer) plans: at least 180 days for group health plans; some require two
//   internal levels before external review.
// - Medicare Advantage (Part C) and Part D: 65 days from the date of the notice.
// - Original Medicare: the date printed on the Medicare Summary Notice; no default is assumed.
// - Medicaid: set by each state; the app asks for the date on the notice.
// A deadline printed in the letter itself always wins over these defaults.

import { DATE_PATTERN } from "./redact";

export type PlanType = "marketplace" | "employer" | "medicare_advantage" | "original_medicare" | "medicaid" | "unknown";

export interface Rule {
  label: string;
  days?: number;          // calendar days from the notice date
  note: string;
  source: string;
}

export const RULES: Record<PlanType, Rule> = {
  marketplace: {
    label: "Marketplace or other individual plan",
    days: 180,
    note: "Internal appeal within 180 days of the denial notice. If the plan says no again, you can ask for an independent external review within 4 months.",
    source: "https://www.healthcare.gov/appeal-insurance-company-decision/internal-appeals/",
  },
  employer: {
    label: "Plan through a job",
    days: 180,
    note: "Group health plans must allow at least 180 days for an internal appeal; some require two internal appeals before external review. Check your plan's documents for a longer limit.",
    source: "https://www.healthcare.gov/appeal-insurance-company-decision/internal-appeals/",
  },
  medicare_advantage: {
    label: "Medicare Advantage or Part D",
    days: 65,
    note: "Ask the plan for a reconsideration (Part D: a redetermination) within 65 days of the date on the notice.",
    source: "https://www.medicare.gov/providers-services/claims-appeals-complaints/appeals/medicare-health-plans",
  },
  original_medicare: {
    label: "Original Medicare",
    note: "File by the date printed on your Medicare Summary Notice.",
    source: "https://www.medicare.gov/providers-services/claims-appeals-complaints/appeals/original-medicare",
  },
  medicaid: {
    label: "Medicaid",
    note: "Deadlines differ by state and by plan; use the date printed on your notice.",
    source: "https://www.medicaid.gov/",
  },
  unknown: {
    label: "Not sure",
    note: "Choose your plan type above to work out the date, or use the deadline printed on the notice. Many plans allow 180 days; Medicare plans allow 65.",
    source: "https://www.healthcare.gov/appeal-insurance-company-decision/",
  },
};

const MONTH_INDEX: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parses the date formats letters use; returns a local date at noon (no time-zone surprises). */
export function parseDate(text: string): Date | undefined {
  const s = text.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return new Date(y, +m[1] - 1, +m[2], 12);
  }
  m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/);
  if (m && m[1].slice(0, 3).toLowerCase() in MONTH_INDEX) return new Date(+m[3], MONTH_INDEX[m[1].slice(0, 3).toLowerCase()], +m[2], 12);
  m = s.match(/^(\d{1,2}) ([A-Za-z]{3,9}) (\d{4})$/);
  if (m && m[2].slice(0, 3).toLowerCase() in MONTH_INDEX) return new Date(+m[3], MONTH_INDEX[m[2].slice(0, 3).toLowerCase()], +m[1], 12);
  return undefined;
}

export interface PrintedDeadline {
  date?: Date;            // "appeal by March 3, 2027"
  days?: number;          // "within 60 days of the date of this notice"
  quote: string;
}

/** Finds a deadline the letter states itself. */
export function printedDeadline(letter: string): PrintedDeadline | undefined {
  const flat = letter.replace(/\s+/g, " ");
  const byDate = new RegExp(`(?:appeal|request|file|submit|received|postmarked)[^.]{0,80}?\\b(?:by|before|no later than)\\s+(${DATE_PATTERN.source})`, "i");
  const d = flat.match(byDate);
  if (d) {
    const date = parseDate(d[1]);
    if (date) return { date, quote: d[0].trim() };
  }
  const within = flat.match(/(?:appeal|request|file|submit)[^.]{0,80}?\bwithin (\d{1,3}) (?:calendar )?days\b[^.]{0,80}/i);
  if (within) return { days: +within[1], quote: within[0].trim() };
  return undefined;
}

export interface Deadline {
  due?: Date;
  daysLeft?: number;
  basis: "printed date" | "printed days" | "plan rule" | "unknown";
  explanation: string;
  source?: string;
}

const DAY = 86_400_000;
const atNoon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);

export function deadline(plan: PlanType, noticeDate: Date | undefined, letter: string, today = new Date()): Deadline {
  const printed = printedDeadline(letter);
  const left = (due: Date) => Math.round((atNoon(due).getTime() - atNoon(today).getTime()) / DAY);
  if (printed?.date) {
    return { due: printed.date, daysLeft: left(printed.date), basis: "printed date", explanation: `Your letter says: "${printed.quote}".` };
  }
  if (printed?.days && noticeDate) {
    const due = addDays(noticeDate, printed.days);
    return { due, daysLeft: left(due), basis: "printed days", explanation: `Your letter says: "${printed.quote}". Counted from the notice date.` };
  }
  const rule = RULES[plan];
  if (rule.days && noticeDate) {
    const due = addDays(noticeDate, rule.days);
    return { due, daysLeft: left(due), basis: "plan rule", explanation: rule.note, source: rule.source };
  }
  return { basis: "unknown", explanation: noticeDate ? rule.note : `${rule.note} Add the date on the notice to count the days.`, source: rule.source };
}

/** An all-day calendar event on the due date with a reminder a week before (RFC 5545). */
export function ics(due: Date, title: string, description: string, now = new Date()): string {
  const ymd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Second Look//Appeal deadline//EN", "BEGIN:VEVENT",
    `UID:${ymd(due)}-${stamp}@second-look`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(due)}`, `DTEND;VALUE=DATE:${ymd(addDays(due, 1))}`,
    `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(description)}`,
    "BEGIN:VALARM", "TRIGGER:-P7D", "ACTION:DISPLAY", `DESCRIPTION:${esc(title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}
