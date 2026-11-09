import { describe, expect, it } from "vitest";
import { COMMON, findCodes, helpFor } from "../src/core/codes";
import { deadline, ics, parseDate, printedDeadline } from "../src/core/deadline";
import { protections } from "../src/core/protections";
import { fillBack, leftovers, patternEntities, redact } from "../src/core/redact";
import { SAMPLES } from "../src/samples";

const sample = (id: string) => SAMPLES.find((s) => s.id === id)!.text;

describe("codes", () => {
  it("finds adjustment codes with their group and remark codes", () => {
    const found = findCodes(sample("mri"));
    expect(found.map((c) => c.raw)).toEqual(["CO-50", "N115"]);
    expect(found[0]).toMatchObject({ kind: "adjustment", group: "CO", code: "50" });
    expect(helpFor(found[0])?.meaning).toMatch(/medically necessary/);
  });

  it("does not report remark-like words in a letter without codes", () => {
    expect(findCodes("Please call us about form N12 at Suite M15.")).toEqual([]);
  });

  it("reads spaced and letter codes", () => {
    expect(findCodes("Codes: PR 1, CO-B7 and OA23").map((c) => `${c.group}-${c.code}`)).toEqual(["PR-1", "CO-B7", "OA-23"]);
  });

  it("explains every code in its own words, without the official X12 text", () => {
    for (const help of Object.values(COMMON)) {
      expect(help.meaning.length).toBeGreaterThan(10);
      expect(help.tryThis.length).toBeGreaterThan(10);
    }
    expect(COMMON["50"].meaning).not.toMatch(/deemed a .?medical necessity/i);
  });
});

describe("redaction", () => {
  it("masks labelled IDs, names, dates, addresses and phone numbers by pattern alone", () => {
    const r = redact(sample("mri"), patternEntities(sample("mri")));
    for (const secret of ["Dana Whitfield", "EVH-55210983", "ZX-448812", "03/22/1984", "1187 Larkspur Lane", "(217) 555-0142", "Dr. Alan Brooks", "IND-2026"]) {
      expect(r.text).not.toContain(secret);
    }
    expect(r.text).toContain("[PATIENT_NAME]");
    expect(r.text).toContain("[MEMBER_ID]");
    expect(r.text).toContain("CO-50");            // codes and amounts stay
    expect(r.text).toContain("$1,840.00");
    expect(leftovers(r.text)).toEqual([]);
  });

  it("puts the details back, and reports placeholders it does not know", () => {
    const r = redact(sample("er"), patternEntities(sample("er")));
    const draft = "Re: claim [CLAIM_NUMBER] for [PATIENT_NAME]. Phone: [YOUR_PHONE]. Enclosed: [LIST ENCLOSED DOCUMENTS, IF ANY].";
    const back = fillBack(draft, r.map);
    expect(back.text).toContain("ER55102");
    expect(back.text).toContain("Rosa Delgado-Hart");
    expect(back.unknown).toEqual(["[YOUR_PHONE]", "[LIST ENCLOSED DOCUMENTS, IF ANY]"]);
  });

  it("masks names the model found in running text, and keeps placeholders stable for later text", () => {
    const text = "My neighbour Lena Park drove me. Lena Park can confirm the pain started on 10/01/2026.";
    const first = redact(sample("auth"), patternEntities(sample("auth")));
    const notes = redact(text, [...patternEntities(text), { category: "PATIENT_NAME", value: "Lena Park" }], first);
    expect(notes.text).not.toContain("Lena Park");
    expect(notes.map["[PATIENT_NAME]"]).toBe("Marcus Oyelaran");
    expect(Object.values(notes.map)).toContain("Lena Park");
    expect(notes.text).not.toContain("10/01/2026");
  });

  it("prefers the most specific category for a value", () => {
    const r = redact("DOB: 03/22/1984", patternEntities("DOB: 03/22/1984"));
    expect(r.text).toBe("DOB: [DATE_OF_BIRTH]");
  });
});

describe("deadlines", () => {
  const today = new Date(2026, 10, 9, 12);

  it("parses the date formats letters use", () => {
    expect(parseDate("October 14, 2026")?.toDateString()).toBe("Wed Oct 14 2026");
    expect(parseDate("2026-10-02")?.toDateString()).toBe("Fri Oct 02 2026");
    expect(parseDate("11/2/26")?.toDateString()).toBe("Mon Nov 02 2026");
    expect(parseDate("2 November 2026")?.toDateString()).toBe("Mon Nov 02 2026");
  });

  it("uses the days the letter states, counted from the notice", () => {
    const d = deadline("marketplace", parseDate("October 14, 2026"), sample("mri"), today);
    expect(d.basis).toBe("printed days");
    expect(d.due?.toDateString()).toBe("Mon Apr 12 2027");      // 180 days after Oct 14, 2026
    expect(d.daysLeft).toBe(154);
  });

  it("falls back to the plan's rule", () => {
    const d = deadline("employer", parseDate("2026-10-02"), sample("auth"), today);
    expect(d.basis).toBe("plan rule");
    expect(d.due?.toDateString()).toBe("Wed Mar 31 2027");      // 180 days after Oct 2, 2026
  });

  it("reads 65 days for Medicare Advantage from the letter", () => {
    const d = deadline("medicare_advantage", parseDate("November 2, 2026"), sample("er"), today);
    expect(d.due?.toDateString()).toBe("Wed Jan 06 2027");      // 65 days after Nov 2, 2026
  });

  it("prefers a printed date, and never invents one for Original Medicare", () => {
    expect(printedDeadline("You must file your appeal by March 3, 2027.")?.date?.toDateString()).toBe("Wed Mar 03 2027");
    const none = deadline("original_medicare", parseDate("November 2, 2026"), "Your claim was denied.", today);
    expect(none.basis).toBe("unknown");
    expect(none.due).toBeUndefined();
  });

  it("writes a calendar file with a reminder a week before", () => {
    const cal = ics(new Date(2027, 3, 12, 12), "Appeal deadline", "Claim ZX-448812, appeal due", new Date(Date.UTC(2026, 10, 9)));
    expect(cal).toContain("DTSTART;VALUE=DATE:20270412");
    expect(cal).toContain("DTEND;VALUE=DATE:20270413");
    expect(cal).toContain("TRIGGER:-P7D");
    expect(cal).toContain("Claim ZX-448812\\, appeal due");
    expect(cal.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});

describe("protections", () => {
  it("flags emergency care denied as out of network, by plan type", () => {
    const er = sample("er");
    const ma = protections("medicare_advantage", er, findCodes(er)).map((p) => p.title);
    expect(ma[0]).toBe("Emergency care is covered in or out of network");
    expect(ma).toContain("If waiting could harm your health, ask for a fast appeal");
    const mk = protections("marketplace", er, findCodes(er));
    expect(mk[0].source).toContain("healthcare.gov/using-marketplace-coverage/getting-emergency-care");
    expect(protections("employer", er, findCodes(er))[0].source).toContain("cms.gov/nosurprises");
  });

  it("does not claim emergency protections for planned care", () => {
    const pt = sample("auth");
    const titles = protections("employer", pt, findCodes(pt)).map((p) => p.title);
    expect(titles.some((t) => t.startsWith("Emergency"))).toBe(false);
    expect(titles).toContain("If they say no again, someone independent can decide");
  });

  it("offers nothing it cannot source for Original Medicare or Medicaid", () => {
    expect(protections("original_medicare", sample("mri"), [])).toEqual([]);
    expect(protections("medicaid", sample("mri"), [])).toEqual([]);
  });
});
