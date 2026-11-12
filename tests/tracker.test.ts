import { describe, expect, it } from "vitest";
import { addMonths, byUrgency, decisionDays, fromIso, isoDay, nextStep, type Case } from "../src/core/tracker";

const today = new Date(2026, 10, 12, 9);   // Nov 12, 2026
const base: Case = {
  id: "a", created: "2026-11-12T09:00:00Z", title: "MRI of the lumbar spine", insurer: "Acme Health",
  plan: "marketplace", care: "received", status: "drafted", letter: "Dear Appeals Department,",
};

describe("dates", () => {
  it("round-trips ISO days", () => {
    expect(isoDay(fromIso("2026-03-09")!)).toBe("2026-03-09");
    expect(fromIso("March 9")).toBeUndefined();
  });
  it("adds calendar months and keeps to the end of shorter months", () => {
    expect(isoDay(addMonths(fromIso("2026-01-31")!, 1))).toBe("2026-02-28");
    expect(isoDay(addMonths(fromIso("2026-11-12")!, 4))).toBe("2027-03-12");
  });
  it("gives the official decision times only where one rule applies", () => {
    expect(decisionDays("marketplace", "received")).toBe(60);
    expect(decisionDays("employer", "not_yet")).toBe(30);
    expect(decisionDays("medicare_advantage", "urgent")).toBe(3);
    expect(decisionDays("medicaid", "received")).toBeUndefined();
    expect(decisionDays("original_medicare", "received")).toBeUndefined();
  });
});

describe("next step", () => {
  it("counts down to the appeal deadline", () => {
    const s = nextStep({ ...base, due: "2027-05-01" }, today);
    expect(s.label).toBe("Send the appeal by");
    expect(s.daysLeft).toBe(170);
    expect(s.overdue).toBe(false);
  });
  it("says what to do once the deadline has passed", () => {
    const s = nextStep({ ...base, due: "2026-11-01" }, today);
    expect(s.overdue).toBe(true);
    expect(s.advice).toMatch(/good cause/);
  });
  it("without a deadline points to the notice", () => {
    const s = nextStep({ ...base, plan: "medicaid" }, today);
    expect(s.date).toBeUndefined();
    expect(s.advice).toMatch(/printed on your notice/);
  });
  it("waits 60 days for care already received, 30 for care not yet had", () => {
    const sent = { ...base, status: "sent" as const, sent: "2026-11-12" };
    expect(isoDay(nextStep(sent, today).date!)).toBe("2027-01-11");
    expect(isoDay(nextStep({ ...sent, care: "not_yet" }, today).date!)).toBe("2026-12-12");
    expect(nextStep({ ...sent, care: "urgent" }, today).advice).toMatch(/72 hours/);
  });
  it("mentions Medicare's possible extension and links Medicare's page", () => {
    const s = nextStep({ ...base, plan: "medicare_advantage", status: "sent", sent: "2026-11-12", care: "not_yet" }, today);
    expect(s.advice).toMatch(/14 more days/);
    expect(s.source).toMatch(/medicare\.gov/);
  });
  it("gives 4 months for an external review after a second no", () => {
    const s = nextStep({ ...base, status: "denied_again", decided: "2026-11-12" }, today);
    expect(s.label).toBe("Ask for an external review by");
    expect(isoDay(s.date!)).toBe("2027-03-12");
    expect(s.source).toMatch(/external-review/);
  });
  it("does not invent an external review date for Medicare or Medicaid", () => {
    const s = nextStep({ ...base, plan: "medicaid", status: "denied_again", decided: "2026-11-12" }, today);
    expect(s.date).toBeUndefined();
  });
  it("expects the external reviewer within 45 days, 72 hours when urgent", () => {
    const asked = { ...base, status: "external_sent" as const, externalSent: "2026-11-12" };
    expect(isoDay(nextStep(asked, today).date!)).toBe("2026-12-27");
    expect(isoDay(nextStep({ ...asked, care: "urgent" }, today).date!)).toBe("2026-11-15");
  });
  it("is done once approved or closed", () => {
    expect(nextStep({ ...base, status: "approved" }, today).done).toBe(true);
    expect(nextStep({ ...base, status: "closed" }, today).done).toBe(true);
  });
});

describe("ordering", () => {
  it("puts the soonest date first and finished cases last", () => {
    const list: Case[] = [
      { ...base, id: "done", status: "approved" },
      { ...base, id: "later", due: "2027-05-01" },
      { ...base, id: "soon", due: "2026-11-20" },
      { ...base, id: "late", due: "2026-11-01" },
    ];
    expect(byUrgency(list, today).map((c) => c.id)).toEqual(["late", "soon", "later", "done"]);
  });
});
