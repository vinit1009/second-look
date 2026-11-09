// The three AI steps, each with the inference mode its privacy needs (Firebase AI Logic hybrid inference):
//
//   read     ONLY_ON_DEVICE    the raw letter, with names and IDs, never leaves the device;
//                              if Gemini Nano is not available this step does not run at all.
//   explain  PREFER_ON_DEVICE  runs on the masked letter: on the device when it can, otherwise in
//                              the cloud, which is safe because personal details are already masked.
//   draft    PREFER_IN_CLOUD   the appeal letter, from masked facts only and after the user agrees;
//                              offline, the SDK falls back to Gemini Nano.

import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel, type LanguageModelCreateOptions } from "firebase/ai";
import type { PlanType } from "./core/deadline";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
});
const ai = getAI(app, { backend: new GoogleAIBackend() });

export const CLOUD_MODEL = "gemini-3.5-flash-lite";
const TEXT_IO: LanguageModelCreateOptions = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };

export type Where = "on_device" | "in_cloud";
export interface Answer<T> { value: T; where: Where; ms: number }

// ---------- step 1: read the letter on the device ----------

export interface Facts {
  insurer: string;
  plan_type: PlanType;
  notice_date: string;
  service: string;
  service_date: string;
  provider: string;
  amount_billed: string;
  plan_paid: string;
  you_owe: string;
  denial_reason: string;
  people: string[];
}

const FACTS_SCHEMA = {
  type: "object",
  properties: {
    insurer: { type: "string" },
    plan_type: { type: "string", enum: ["marketplace", "employer", "medicare_advantage", "original_medicare", "medicaid", "unknown"] },
    notice_date: { type: "string" },
    service: { type: "string" },
    service_date: { type: "string" },
    provider: { type: "string" },
    amount_billed: { type: "string" },
    plan_paid: { type: "string" },
    you_owe: { type: "string" },
    denial_reason: { type: "string" },
    people: { type: "array", items: { type: "string" } },
  },
  required: ["insurer", "plan_type", "notice_date", "service", "service_date", "provider", "amount_billed", "plan_paid", "you_owe", "denial_reason", "people"],
};

const reader: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: TEXT_IO, promptOptions: { responseConstraint: FACTS_SCHEMA } },
});

const READ_PROMPT = `You read health insurance denial letters and Explanations of Benefits.
Fill in each field from the letter below. Copy names, dates and amounts exactly as they are written. Use "" when the letter does not say.
- insurer: the company that sent the letter.
- plan_type: marketplace (individual or HealthCare.gov plan), employer (plan through a job), medicare_advantage (Medicare Advantage or Part D plan), original_medicare (Medicare Summary Notice), medicaid, or unknown.
- notice_date: the date of the letter or notice.
- service and service_date: what was denied and when it was received.
- provider: the doctor, clinic or hospital that gave the care.
- amount_billed: the amount charged. plan_paid: what the plan paid or allowed. you_owe: what the letter says the person may owe. As written, with the dollar sign.
- denial_reason: the reason the letter gives, in its own words.
- people: the full name of every person in the letter (patient, member, doctors). No companies.

Letter:
"""
`;

/** Gemini Nano status in this browser: "available", "downloadable", "downloading" or "unavailable". */
export async function deviceStatus(): Promise<string> {
  const lm = (globalThis as { LanguageModel?: { availability(o?: object): Promise<string> } }).LanguageModel;
  if (!lm) return "unavailable";
  try {
    return await lm.availability(TEXT_IO);
  } catch {
    return "unavailable";
  }
}

/** Downloads Gemini Nano if needed. Must run from a click or key press. */
export async function prepareDevice(progress: (share: number) => void): Promise<void> {
  await reader.initializeDeviceModel(progress);
  await explainer.initializeDeviceModel(() => {});
}

async function timed<T>(model: GenerativeModel, prompt: string, parse: (text: string) => T): Promise<Answer<T>> {
  const t0 = performance.now();
  const result = await model.generateContent(prompt);
  const where = (result.response.inferenceSource ?? "in_cloud") as Where;
  return { value: parse(result.response.text()), where, ms: Math.round(performance.now() - t0) };
}

export function readLetter(letter: string): Promise<Answer<Facts>> {
  return timed(reader, READ_PROMPT + letter.slice(0, 12_000) + '\n"""', (t) => JSON.parse(t) as Facts);
}

// Browsers without Gemini Nano: the same reading, but only of the masked letter and only after the
// user has seen it. PREFER_ON_DEVICE still uses the device if the model appears later.
const maskedReader: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  onDeviceParams: { createOptions: TEXT_IO, promptOptions: { responseConstraint: FACTS_SCHEMA } },
  inCloudParams: { model: CLOUD_MODEL, generationConfig: { responseMimeType: "application/json", responseJsonSchema: FACTS_SCHEMA, temperature: 0.1 } },
});

export function readMaskedLetter(maskedLetter: string): Promise<Answer<Facts>> {
  return timed(maskedReader, READ_PROMPT + maskedLetter.slice(0, 12_000) + '\n"""', (t) => JSON.parse(t) as Facts);
}

// The person's own notes can name people the letter does not (a relative, a therapist), so they are
// read on the device too before the consent screen.
const PEOPLE_SCHEMA = { type: "object", properties: { people: { type: "array", items: { type: "string" } } }, required: ["people"] };
const peopleFinder: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: TEXT_IO, promptOptions: { responseConstraint: PEOPLE_SCHEMA } },
});

export function findPeople(text: string): Promise<Answer<{ people: string[] }>> {
  return timed(peopleFinder, `List the full name of every person named in this text, exactly as written. People only: no companies, clinics or places. If there are none, return an empty list.\n\nText:\n"""\n${text.slice(0, 6_000)}\n"""`, (t) => JSON.parse(t) as { people: string[] });
}

// ---------- step 2: explain the masked letter ----------

export interface Explanation {
  summary: string;
  reasons: { reason: string; plain: string }[];
  next_steps: string[];
}

const EXPLAIN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    reasons: { type: "array", items: { type: "object", properties: { reason: { type: "string" }, plain: { type: "string" } }, required: ["reason", "plain"] } },
    next_steps: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "reasons", "next_steps"],
};

const explainer: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_ON_DEVICE,
  onDeviceParams: { createOptions: TEXT_IO, promptOptions: { responseConstraint: EXPLAIN_SCHEMA } },
  inCloudParams: { model: CLOUD_MODEL, generationConfig: { responseMimeType: "application/json", responseJsonSchema: EXPLAIN_SCHEMA, temperature: 0.3 } },
});

const EXPLAIN_PROMPT = `Explain this health insurance denial to the person who received it, in short, plain, kind sentences that anyone can follow. Words in square brackets, like [PATIENT_NAME], are hidden personal details: keep them as they are.
- summary: two sentences: what was denied and why.
- reasons: each reason the letter gives for saying no, in a few words, with a plain explanation. Leave out billing codes like CO-50 or N115; they are explained separately.
- next_steps: up to four specific things that would help an appeal, based only on what the letter says.

Letter:
"""
`;

export function explain(maskedLetter: string): Promise<Answer<Explanation>> {
  return timed(explainer, EXPLAIN_PROMPT + maskedLetter.slice(0, 12_000) + '\n"""', (t) => JSON.parse(t) as Explanation);
}

// ---------- step 3: draft the appeal letter ----------

const DRAFT_RULES = `You write first-level appeal letters for people whose health insurance claim was denied, written in their own name.
Rules:
- Words in square brackets, like [PATIENT_NAME] or [CLAIM_NUMBER], stand for personal details. Copy them exactly as written, brackets included. Never guess what they hide.
- Never invent facts or law: no made-up dates, numbers, diagnoses, treatments, quotes, laws or rules. Mention a rule only if it is in the list of rules you are given. Where the letter needs something you do not have, write a short bracketed blank in capitals for the person to fill in, like [YOUR PHONE NUMBER].
- Structure: sender block, the date written as [TODAY], insurer, a "Re:" line with the member ID and claim number, the request for review, why the denial should be reversed (use the person's own points), what is enclosed, a request for the documents and criteria used in the decision, and a closing with their name.
- Address it to the insurer: "Dear Appeals Department,". It is signed by the person: [PATIENT_NAME] when that placeholder exists.
- Plain, polite and firm. Under 350 words. Plain text only, no markdown.`;

const drafter: GenerativeModel = getGenerativeModel(ai, {
  mode: InferenceMode.PREFER_IN_CLOUD,
  // Offline, Gemini Nano drafts instead; it gets the same rules as a system prompt.
  onDeviceParams: { createOptions: { ...TEXT_IO, initialPrompts: [{ role: "system", content: [{ type: "text", value: DRAFT_RULES }] }] } },
  inCloudParams: {
    model: CLOUD_MODEL,
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
    systemInstruction: DRAFT_RULES,
  },
});

export interface DraftInput {
  maskedLetter: string;
  maskedNotes: string;
  plan: PlanType;
  appealName: string;     // "internal appeal", "reconsideration", "redetermination"
  codes: string[];        // "CO-50: the insurer says the service was not medically necessary"
  rights: string[];       // rule texts from official sources that may apply
}

export function draftAppeal(d: DraftInput): Promise<Answer<string>> {
  const prompt = `Write the appeal letter for this denial. Call it a ${d.appealName} (use those words in the first paragraph).

The denial letter (personal details hidden):
"""
${d.maskedLetter.slice(0, 10_000)}
"""

Codes in the letter, explained:
${d.codes.length ? d.codes.map((c) => `- ${c}`).join("\n") : "- none found"}

Rules that may apply, from official sources (cite one plainly only if it fits; do not add any others):
${d.rights.length ? d.rights.map((r) => `- ${r}`).join("\n") : "- none"}

What the person wants to say, in their own words:
"""
${d.maskedNotes || "(nothing added)"}
"""`;
  return timed(drafter, prompt, (t) => plain(t));
}

/** Letters are plain text: drop markdown a model may add anyway. */
export function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*]\s+(?=\S)/gm, "- ").trim();
}

export function appealName(plan: PlanType): string {
  if (plan === "medicare_advantage") return "request for reconsideration";
  if (plan === "original_medicare") return "request for redetermination";
  return "request for an internal appeal";
}
