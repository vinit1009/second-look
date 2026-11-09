// Finds claim adjustment codes in a denial letter and explains the common ones.
//
// The code numbers are industry identifiers. The official descriptions belong to X12
// (https://x12.org/codes), so they are not copied here: each entry below is our own short,
// plain-language summary plus what usually helps in an appeal. Letters usually print the
// insurer's own wording next to the code, and the app shows that wording too.

export type Group = "CO" | "PR" | "OA" | "PI" | "CR";

export interface FoundCode {
  raw: string;            // as written, e.g. "CO-50" or "N115"
  kind: "adjustment" | "remark";
  group?: Group;
  code: string;           // "50", "B7", "N115"
}

export interface CodeHelp {
  meaning: string;        // what the insurer is saying, in plain words
  tryThis: string;        // what usually helps in an appeal
}

export const GROUPS: Record<Group, string> = {
  CO: "Contractual: under the provider's contract, the provider usually cannot bill you for this part.",
  PR: "Patient responsibility: the insurer says this part is yours to pay.",
  OA: "Other adjustment: neither of the usual categories applies.",
  PI: "Payer-initiated reduction: the insurer reduced the amount on its own determination.",
  CR: "Correction or reversal of an earlier decision.",
};

export const COMMON: Record<string, CodeHelp> = {
  "1": { meaning: "The amount went toward your deductible.", tryThis: "Usually not appealable; check the deductible total on your plan's portal." },
  "2": { meaning: "This is your coinsurance share.", tryThis: "Usually not appealable unless the provider was billed as out of network by mistake." },
  "3": { meaning: "This is your copay.", tryThis: "Usually not appealable; compare it with the copay listed in your plan documents." },
  "4": { meaning: "The billing code and a modifier on it do not match, or a required modifier is missing.", tryThis: "Ask the provider's billing office to correct and resubmit the claim." },
  "11": { meaning: "The diagnosis on the claim does not match the procedure.", tryThis: "Ask the provider to check the diagnosis codes and resubmit, or send records that link the two." },
  "16": { meaning: "The claim is missing information or has a billing error.", tryThis: "Ask the provider what was missing; a corrected claim often fixes this without an appeal." },
  "18": { meaning: "The insurer thinks this is a duplicate of a claim it already processed.", tryThis: "Check whether the first claim was paid; if the services were different, say so with dates." },
  "22": { meaning: "The insurer thinks another plan should pay first.", tryThis: "Update your coordination-of-benefits information with the insurer, then ask for reprocessing." },
  "27": { meaning: "The service date is after your coverage ended.", tryThis: "If you were covered on that date, send proof of coverage (ID card, premium receipts)." },
  "29": { meaning: "The claim was filed after the insurer's time limit.", tryThis: "This is usually the provider's problem, not yours; ask the provider for proof of timely filing." },
  "31": { meaning: "The insurer could not match the patient to a member.", tryThis: "Check the name, date of birth and member ID on the claim with the provider." },
  "45": { meaning: "The charge is above the amount the insurer allows.", tryThis: "With an in-network provider you usually owe nothing for this part; check that it is not billed to you." },
  "50": { meaning: "The insurer says the service was not medically necessary.", tryThis: "Ask your doctor for a letter of medical necessity and include your records; ask for the criteria the insurer used." },
  "96": { meaning: "The insurer lists this charge as not covered.", tryThis: "Check the plan's covered services list and ask which exclusion it relied on." },
  "97": { meaning: "The insurer says this service is included in another service it already paid.", tryThis: "Ask the provider whether the service was separate; if so, they can explain or resubmit it." },
  "109": { meaning: "The insurer says it is not the right payer for this claim.", tryThis: "Confirm which plan covered you on the service date and send the claim there." },
  "119": { meaning: "A benefit limit for this period has been reached.", tryThis: "Check the count against your plan's limit; ask for an exception if the care is medically necessary." },
  "151": { meaning: "The insurer thinks the number or frequency of services is more than the records support.", tryThis: "Send records showing why each service was needed." },
  "167": { meaning: "The diagnosis is not covered.", tryThis: "Ask your doctor whether another accurate diagnosis applies, and ask the insurer which policy excludes it." },
  "170": { meaning: "The insurer will not pay this type of provider for this service.", tryThis: "Ask whether a covered provider type was available; network gaps can support an exception." },
  "197": { meaning: "Prior authorization or notification was needed and is missing.", tryThis: "Ask the provider to request authorization after the fact and include why the care could not wait." },
  "198": { meaning: "The care went beyond what was authorized.", tryThis: "Ask the provider to request an extension of the authorization with the medical reasons." },
  "204": { meaning: "The plan does not cover this service, equipment or drug.", tryThis: "Ask for the exact plan language; for drugs, ask your doctor about a formulary exception." },
  "242": { meaning: "The provider was not in the plan's network or was not your primary care provider.", tryThis: "If no in-network provider was available, or it was an emergency, say so; surprise-billing protections may apply." },
  "252": { meaning: "The insurer needs more documents before deciding.", tryThis: "Ask exactly which documents and send them; this is often a request, not a final no." },
  "B7": { meaning: "The provider was not certified or eligible to be paid for this service on that date.", tryThis: "Ask the provider about their enrolment; this is usually theirs to fix." },
};

// Adjustment codes: a group code joined to a number or a letter-and-number code (CO-50, PR 1, CO-B7, OA23).
const ADJUSTMENT = /\b(CO|PR|OA|PI|CR)[\s-]?([A-Z]?\d{1,3})\b/g;
// Remark codes: M, N or MA followed by digits (N115, MA130, M15).
const REMARK = /\b(MA\d{2,3}|M\d{1,3}|N\d{1,3})\b/g;

export function findCodes(text: string): FoundCode[] {
  const out: FoundCode[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(ADJUSTMENT)) {
    const key = `${m[1]}-${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ raw: m[0], kind: "adjustment", group: m[1] as Group, code: m[2] });
    }
  }
  // Remark codes look like ordinary words and IDs (N1, M15), so only report them in a letter
  // that talks about remark or reason codes, or that already has adjustment codes.
  const remarkContext = out.length > 0 || /\b(remark|rarc|reason code)/i.test(text);
  for (const m of remarkContext ? text.matchAll(REMARK) : []) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push({ raw: m[0], kind: "remark", code: m[1] });
    }
  }
  return out;
}

export function helpFor(code: FoundCode): CodeHelp | undefined {
  return code.kind === "adjustment" ? COMMON[code.code] : undefined;
}

export const OFFICIAL_LISTS = {
  adjustment: "https://x12.org/codes/claim-adjustment-reason-codes",
  remark: "https://x12.org/codes/remittance-advice-remark-codes",
};
