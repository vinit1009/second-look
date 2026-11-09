// Rights that often decide an appeal, chosen by rule from the plan type and the letter, each with
// the official page it comes from (checked 2026-11-09). These never come from a model.

import type { FoundCode } from "./codes";
import type { PlanType } from "./deadline";

export interface Protection {
  title: string;
  body: string;
  source: string;
}

const EMERGENCY = /\bemergency (room|department|services?|care|visit)\b|\bER visit\b/i;
const NETWORK = /\b(out[- ]of[- ]network|not in (?:the |our |your )?(?:[\w ]+ )?network|network provider|non-?participating)\b/i;
const AUTH = /\b(prior )?(authori[sz]ation|pre-?certification|pre-?approval|notification)\b/i;

const PRIVATE: PlanType[] = ["marketplace", "employer", "unknown"];

export function protections(plan: PlanType, letter: string, codes: FoundCode[]): Protection[] {
  const out: Protection[] = [];
  const code = (n: string) => codes.some((c) => c.code === n);
  const emergency = EMERGENCY.test(letter);
  const networkOrAuth = NETWORK.test(letter) || AUTH.test(letter) || code("242") || code("197");

  if (emergency && networkOrAuth) {
    if (plan === "marketplace") {
      out.push({
        title: "Emergency care is protected",
        body: "Marketplace plans must cover emergency services, even at an out-of-network hospital, without prior authorization, and cannot charge more than in-network copays or coinsurance for it.",
        source: "https://www.healthcare.gov/using-marketplace-coverage/getting-emergency-care/",
      });
    } else if (plan === "medicare_advantage") {
      out.push({
        title: "Emergency care is covered in or out of network",
        body: "Medicare Advantage plans, HMOs included, cover emergency care whether the hospital is inside or outside the plan's network.",
        source: "https://www.medicare.gov/health-drug-plans/health-plans/your-health-plan-options/HMO",
      });
    } else if (PRIVATE.includes(plan)) {
      out.push({
        title: "Emergency care is protected",
        body: "Under the No Surprises Act, most private health plans must cover emergency services at out-of-network facilities without prior authorization, at in-network cost sharing.",
        source: "https://www.cms.gov/nosurprises/consumer-protections/what-are-the-new-protections",
      });
    }
  }

  if (plan === "medicare_advantage") {
    out.push({
      title: "If waiting could harm your health, ask for a fast appeal",
      body: "Medicare Advantage plans must decide an expedited appeal within 72 hours when waiting the standard 30 days could seriously harm your health. If you miss the 65-day deadline, you can still appeal with a reason for filing late.",
      source: "https://www.medicare.gov/providers-services/claims-appeals-complaints/appeals/medicare-health-plans",
    });
  } else if (PRIVATE.includes(plan)) {
    out.push({
      title: "If it can't wait, say so",
      body: "In an urgent health situation you can ask for an independent external review at the same time as your internal appeal. Internal appeals must be decided within 30 days for care you haven't had yet, and 60 days for care you've had.",
      source: "https://www.healthcare.gov/appeal-insurance-company-decision/internal-appeals/",
    });
    out.push({
      title: "If they say no again, someone independent can decide",
      body: "When a denial involves medical judgment (for example, medical necessity), you can ask an independent reviewer to decide after a final internal denial, within 4 months. Your insurer is required by law to accept the reviewer's decision.",
      source: "https://www.healthcare.gov/appeal-insurance-company-decision/external-review/",
    });
  }
  return out;
}
