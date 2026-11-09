// Fictional sample letters for trying the app. Every person, plan, address and number here
// is invented; none of it is real patient data.

export interface Sample {
  id: string;
  title: string;
  plan: "marketplace" | "employer" | "medicare_advantage";
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    id: "mri",
    title: "MRI denied as not medically necessary (individual plan)",
    plan: "marketplace",
    text: `Evergreen Valley Health Plan
PO Box 4410, Springfield, IL 62701

Notice date: October 14, 2026

Dana Whitfield
1187 Larkspur Lane, Apt 4B
Springfield, IL 62704

Member ID: EVH-55210983
Group number: IND-2026
Claim number: ZX-448812
Date of birth: 03/22/1984

Dear Dana Whitfield,

We reviewed the claim for services you received on September 30, 2026 from Dr. Alan Brooks at Prairie Spine Center.

Service: MRI of the lumbar spine without contrast
Amount billed: $1,840.00
Amount allowed: $0.00
You may owe: $1,840.00

Reason: CO-50 These are non-covered services because this is not deemed a medical necessity by the payer. Remark code N115: this decision was based on a local coverage policy.

Our clinical policy requires at least six weeks of conservative treatment, such as physical therapy, before advanced imaging of the lower back.

If you disagree with this decision, you may request an internal appeal within 180 days of the date of this notice. You may also ask for copies of the documents and the clinical criteria we used, free of charge. Call Member Services at (217) 555-0142.`,
  },
  {
    id: "auth",
    title: "Physical therapy denied for missing prior authorization (job-based plan)",
    plan: "employer",
    text: `Summit Ridge Benefits Administrators
Explanation of Benefits

Statement date: 2026-10-02
Patient: Marcus Oyelaran
Member ID: SRB778120455
Group number: 30471
Claim number: 2026-0917-3381

Provider: Riverbend Physical Therapy
Dates of service: 08/04/2026 to 09/15/2026 (12 visits)
Amount billed: $2,160.00   Plan paid: $0.00

Reason code CO-197: Precertification/authorization/notification absent.
Your plan requires prior authorization for more than 6 physical therapy visits per year. No authorization was on file for visits 7 through 12.

You have the right to appeal. Send your written appeal to Summit Ridge Appeals Unit, 4400 Commerce Parkway, Denver, CO 80216. For questions, email appeals@summitridge-benefits.example or call 303-555-0187.`,
  },
  {
    id: "er",
    title: "Emergency room visit denied as out of network (Medicare Advantage)",
    plan: "medicare_advantage",
    text: `Lakeshore Advantage Plus (HMO)
Notice of Denial of Payment

Date of this notice: November 2, 2026
Member: Rosa Delgado-Hart
Member number: LAP-901-338-27
Claim number: ER55102

Dear Ms. Rosa Delgado-Hart,

We cannot pay for the emergency room visit on October 18, 2026 at Harborview Community Hospital because the hospital is not in the Lakeshore Advantage Plus network.
Reason: CO-242 Services not provided by network/primary care providers.

Amount billed: $3,412.50

If you disagree, you or your representative can ask us for a reconsideration. Your request must be received within 65 days of the date of this notice.`,
  },
];
