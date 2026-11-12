// The appeal tracker: what happens after the letter is written, and the date that matters at each step.
// Saved cases stay in this browser's storage; nothing here touches the network.
//
// Rules (checked 2026-11-11 against these official pages):
// - Internal appeals, Marketplace and job-based plans: the plan must decide within 30 days for care not yet
//   received and within 60 days for care already received; urgent cases go faster (72 hours).
//   https://www.healthcare.gov/appeal-insurance-company-decision/internal-appeals/
// - External review: ask within 4 months after the final denial; standard reviews are decided within
//   45 days of the request, expedited ones within 72 hours; free in the federal process, at most $25 otherwise.
//   https://www.healthcare.gov/appeal-insurance-company-decision/external-review/
// - Medicare health plans: pre-service appeal 30 days, payment appeal 60 days, fast appeal 72 hours; the
//   plan may take up to 14 more days in some cases.
//   https://www.medicare.gov/providers-services/claims-appeals-complaints/appeals/medicare-health-plans

import { addDays, RULES, type PlanType } from "./deadline";

export type Status = "drafted" | "sent" | "approved" | "denied_again" | "external_sent" | "closed";
export type Care = "received" | "not_yet" | "urgent";

export interface Case {
  id: string;
  created: string;       // ISO date-time
  title: string;         // what was denied
  insurer: string;
  plan: PlanType;
  care: Care;
  due?: string;          // appeal deadline, YYYY-MM-DD
  status: Status;
  sent?: string;         // YYYY-MM-DD
  decided?: string;      // YYYY-MM-DD, the plan's answer to the appeal
  externalSent?: string; // YYYY-MM-DD
  letter: string;        // the letter as the person saved it
}

export interface Step {
  label: string;         // what to do or wait for
  date?: Date;           // the date that matters
  daysLeft?: number;
  overdue?: boolean;
  advice: string;
  source?: string;
  done?: boolean;
}

const INTERNAL = "https://www.healthcare.gov/appeal-insurance-company-decision/internal-appeals/";
const EXTERNAL = "https://www.healthcare.gov/appeal-insurance-company-decision/external-review/";
const MEDICARE_PLANS = "https://www.medicare.gov/providers-services/claims-appeals-complaints/appeals/medicare-health-plans";

const DAY = 86_400_000;
const noon = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
const daysBetween = (from: Date, to: Date) => Math.round((noon(to).getTime() - noon(from).getTime()) / DAY);

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function fromIso(s?: string): Date | undefined {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : undefined;
}
/** Calendar months later, kept to the last day of a shorter month (Jan 31 + 1 month = Feb 28). */
export function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last), 12);
}

/** Days the plan has to answer an appeal, or undefined where no single rule applies. */
export function decisionDays(plan: PlanType, care: Care): number | undefined {
  if (plan !== "marketplace" && plan !== "employer" && plan !== "medicare_advantage") return undefined;
  return care === "urgent" ? 3 : care === "not_yet" ? 30 : 60;
}

function timed(label: string, date: Date, today: Date, advice: string, source: string | undefined, late: string): Step {
  const daysLeft = daysBetween(today, date);
  return { label, date, daysLeft, overdue: daysLeft < 0, advice: daysLeft < 0 ? late : advice, source };
}

/** The next thing that matters for a case, with its date when a rule gives one. */
export function nextStep(c: Case, today = new Date()): Step {
  const plansWithRules = c.plan === "marketplace" || c.plan === "employer";
  switch (c.status) {
    case "drafted": {
      const due = fromIso(c.due);
      const source = RULES[c.plan].source;
      if (!due) return { label: "Send the appeal", advice: "Use the deadline printed on your notice. Send it in a way you can prove: the plan's portal, fax with a confirmation page, or certified mail.", source };
      return timed("Send the appeal by", due, today,
        "Send it in a way you can prove: the plan's portal, fax with a confirmation page, or certified mail. Then mark it as sent here.",
        source, "The deadline has passed. Send it anyway and ask the plan in writing to accept it late for good cause.");
    }
    case "sent": {
      const sent = fromIso(c.sent);
      const days = decisionDays(c.plan, c.care);
      const source = c.plan === "medicare_advantage" ? MEDICARE_PLANS : INTERNAL;
      if (!sent || !days) return { label: "Wait for the plan's answer", advice: "Your notice says how long the plan has to decide. If you hear nothing, call and ask for the decision in writing.", source: RULES[c.plan].source };
      const extra = c.plan === "medicare_advantage" ? " The plan may take up to 14 more days in some cases." : "";
      return timed("The plan should answer by", addDays(sent, days), today,
        `It has ${days === 3 ? "72 hours" : `${days} days`} for ${c.care === "urgent" ? "an urgent appeal" : c.care === "not_yet" ? "care you have not had yet" : "care you already had"}.${extra} Keep any letters it sends.`,
        source, "The plan's time to answer has run out. Call, note who you spoke to, and ask for the decision in writing.");
    }
    case "denied_again": {
      const decided = fromIso(c.decided);
      if (plansWithRules && decided) {
        return timed("Ask for an external review by", addMonths(decided, 4), today,
          "An independent reviewer, not your insurer, decides. The plan's final letter says how to ask. The federal review process is free; other reviews cost at most $25.",
          EXTERNAL, "The usual 4-month window has passed. Read the plan's final letter: it gives the exact deadline and how to ask anyway.");
      }
      return { label: "Take the next step", advice: "The plan's letter names the next level of appeal and its deadline. Medicare and Medicaid have more levels, run outside your plan.", source: RULES[c.plan].source };
    }
    case "external_sent": {
      const asked = fromIso(c.externalSent);
      if (!asked) return { label: "Wait for the reviewer", advice: "Standard external reviews are decided within 45 days of the request.", source: EXTERNAL };
      const days = c.care === "urgent" ? 3 : 45;
      return timed("The reviewer should decide by", addDays(asked, days), today,
        `Standard reviews are decided within 45 days; urgent ones within 72 hours. If the reviewer sides with you, the plan must pay or approve the care.`,
        EXTERNAL, "The review is past its usual time. Contact the reviewer named in your letters and ask for the status.");
    }
    case "approved":
      return { label: "Approved", done: true, advice: "The denial was reversed. Keep the decision letter, and check the next bill or Explanation of Benefits to make sure it was paid." };
    case "closed":
      return { label: "Closed", done: true, advice: "You stopped tracking this one. Your letter stays here until you delete it." };
  }
}

// ---------- saved cases, in this browser only ----------

const KEY = "second-look-cases-v1";

export function loadCases(): Case[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Case[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveCases(list: Case[]): void {
  globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
}

export function upsertCase(c: Case): Case[] {
  const list = loadCases().filter((x) => x.id !== c.id);
  list.unshift(c);
  saveCases(list);
  return list;
}

export function removeCase(id: string): Case[] {
  const list = loadCases().filter((x) => x.id !== id);
  saveCases(list);
  return list;
}

/** Cases with the soonest date that matters first; finished ones last. */
export function byUrgency(list: Case[], today = new Date()): Case[] {
  const rank = (c: Case) => {
    const s = nextStep(c, today);
    if (s.done) return Number.MAX_SAFE_INTEGER;
    return s.daysLeft ?? 100_000;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}
