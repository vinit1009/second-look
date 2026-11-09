// Firebase AI Logic hybrid inference, with the mode each step's privacy needs.
//
// The device side exists from page load and never touches the network:
//   read      ONLY_ON_DEVICE   the raw letter, with names and IDs.
//   people    ONLY_ON_DEVICE   names in the person's own notes.
//   explain   ONLY_ON_DEVICE   the masked letter, when Gemini Nano is here.
// The cloud side is created only after the person agrees to use the cloud, so until then the page
// loads no Google script (App Check's reCAPTCHA) and sends nothing:
//   draft     PREFER_IN_CLOUD  the appeal letter from masked text; offline, Gemini Nano drafts it.
//   read/explain ONLY_IN_CLOUD the masked letter, for browsers without Gemini Nano.
// PREFER_ON_DEVICE is not used: it sends requests to the cloud whenever the on-device model is
// merely "downloadable", which is not acceptable for the raw letter.

import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type GenerativeModel, type LanguageModelCreateOptions } from "firebase/ai";
import type { PlanType } from "./core/deadline";

const CONFIG = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
};
const deviceAI = getAI(initializeApp(CONFIG, "device"), { backend: new GoogleAIBackend() });

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

const reader: GenerativeModel = getGenerativeModel(deviceAI, {
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
    // Some builds expose the API but never answer (no model service); do not wait forever.
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("unavailable"), 4000));
    return await Promise.race([lm.availability(TEXT_IO), timeout]);
  } catch {
    return "unavailable";
  }
}

/** Downloads Gemini Nano if needed. Must run from a click or key press. */
export async function prepareDevice(progress: (share: number) => void): Promise<void> {
  await reader.initializeDeviceModel(progress);
  await deviceExplainer.initializeDeviceModel(() => {});
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

// Browsers without Gemini Nano: the same reading, of the masked letter only, after the person has
// seen it and agreed.
export function readMaskedLetter(maskedLetter: string): Promise<Answer<Facts>> {
  return timed(cloud().reader, READ_PROMPT + maskedLetter.slice(0, 12_000) + '\n"""', (t) => JSON.parse(t) as Facts);
}

// The person's own notes can name people the letter does not (a relative, a therapist), so they are
// read on the device too before the consent screen.
const PEOPLE_SCHEMA = { type: "object", properties: { people: { type: "array", items: { type: "string" } } }, required: ["people"] };
const peopleFinder: GenerativeModel = getGenerativeModel(deviceAI, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: TEXT_IO, promptOptions: { responseConstraint: PEOPLE_SCHEMA } },
});

export function findPeople(text: string): Promise<Answer<{ people: string[] }>> {
  return timed(peopleFinder, `List the full name of every person named in this text, exactly as written. People only: no companies, clinics or places. If there are none, return an empty list.\n\nText:\n"""\n${text.slice(0, 6_000)}\n"""`, (t) => JSON.parse(t) as { people: string[] });
}

// A photo of a paper letter is read the same way: on the device only. Photos are never sent anywhere.
const IMAGE_IO: LanguageModelCreateOptions = { expectedInputs: [{ type: "image" }, { type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };
const photoReader: GenerativeModel = getGenerativeModel(deviceAI, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: IMAGE_IO },
});

/** Whether this browser can read images on the device ("available", "downloadable", ... or "unavailable"). */
export async function photoStatus(): Promise<string> {
  const lm = (globalThis as { LanguageModel?: { availability(o?: object): Promise<string> } }).LanguageModel;
  if (!lm) return "unavailable";
  try {
    const timeout = new Promise<string>((resolve) => setTimeout(() => resolve("unavailable"), 4000));
    return await Promise.race([lm.availability(IMAGE_IO), timeout]);
  } catch {
    return "unavailable";
  }
}

/** Turns a photo (JPEG, base64) into the letter's text with Gemini Nano. Must start from a click. */
export async function readPhoto(jpegBase64: string, progress: (share: number) => void): Promise<Answer<string>> {
  await photoReader.initializeDeviceModel(progress);
  const t0 = performance.now();
  const result = await photoReader.generateContent([
    { type: "text", text: "Transcribe all the text in this photo of a letter exactly as written, line by line. Keep numbers, dates, codes and amounts exactly. Output only the text, nothing else." },
    { type: "inlineData", inlineData: { mimeType: "image/jpeg", data: jpegBase64 } },
  ]);
  return { value: result.response.text().trim(), where: (result.response.inferenceSource ?? "on_device") as Where, ms: Math.round(performance.now() - t0) };
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

const deviceExplainer: GenerativeModel = getGenerativeModel(deviceAI, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: TEXT_IO, promptOptions: { responseConstraint: EXPLAIN_SCHEMA } },
});

const EXPLAIN_PROMPT = `Explain this health insurance denial to the person who received it, in short, plain, kind sentences that anyone can follow. Words in square brackets, like [PATIENT_NAME], are hidden personal details: keep them as they are.
- summary: two sentences: what was denied and why.
- reasons: each reason the letter gives for saying no, in a few words, with a plain explanation. Leave out billing codes like CO-50 or N115; they are explained separately.
- next_steps: up to four specific things that would help an appeal, based only on what the letter says.

Letter:
"""
`;

export function explain(maskedLetter: string, onDevice: boolean): Promise<Answer<Explanation>> {
  return timed(onDevice ? deviceExplainer : cloud().explainer, EXPLAIN_PROMPT + maskedLetter.slice(0, 12_000) + '\n"""', (t) => JSON.parse(t) as Explanation);
}

// ---------- step 3: draft the appeal letter ----------

const DRAFT_RULES = `You write first-level appeal letters for people whose health insurance claim was denied, written in their own name.
Rules:
- Words in square brackets, like [PATIENT_NAME] or [CLAIM_NUMBER], stand for personal details. Copy them exactly as written, brackets included. Never guess what they hide.
- Never invent facts or law: no made-up dates, numbers, diagnoses, treatments, quotes, laws or rules. Mention a rule only if it is in the list of rules you are given. Where the letter needs something you do not have, write a short bracketed blank in capitals for the person to fill in, like [YOUR PHONE NUMBER].
- Structure: sender block, the date written as [TODAY], insurer, a "Re:" line with the member ID and claim number, the request for review, why the denial should be reversed (use the person's own points), what is enclosed, a request for the documents and criteria used in the decision, and a closing with their name.
- Address it to the insurer: "Dear Appeals Department,". It is signed by the person: [PATIENT_NAME] when that placeholder exists.
- Plain, polite and firm. Under 350 words. Plain text only, no markdown.`;

// ---------- the cloud side, created on consent ----------

interface CloudSide { reader: GenerativeModel; explainer: GenerativeModel; drafter: GenerativeModel }
let cloudSide: CloudSide | undefined;

/** Builds the cloud models the first time they are needed, after the person's yes. */
function cloud(): CloudSide {
  if (cloudSide) return cloudSide;
  const app = initializeApp(CONFIG, "cloud");
  const siteKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY;
  if (siteKey) {
    // App Check proves requests come from this app. Its reCAPTCHA script loads only now.
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: false });
  }
  // Standard tokens: if attestation fails, App Check sends a placeholder token and the request is
  // judged by enforcement, instead of failing before it is sent (as limited-use tokens do).
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const json = (schema: Record<string, unknown>, temperature: number) => ({ responseMimeType: "application/json", responseJsonSchema: schema, temperature });
  cloudSide = {
    reader: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: CLOUD_MODEL, generationConfig: json(FACTS_SCHEMA, 0.1) } }),
    explainer: getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: { model: CLOUD_MODEL, generationConfig: json(EXPLAIN_SCHEMA, 0.3) } }),
    drafter: getGenerativeModel(ai, {
      mode: InferenceMode.PREFER_IN_CLOUD,
      // Offline, Gemini Nano drafts instead; it gets the same rules as a system prompt.
      onDeviceParams: { createOptions: { ...TEXT_IO, initialPrompts: [{ role: "system", content: [{ type: "text", value: DRAFT_RULES }] }] } },
      inCloudParams: { model: CLOUD_MODEL, generationConfig: { temperature: 0.4, maxOutputTokens: 1200 }, systemInstruction: DRAFT_RULES },
    }),
  };
  return cloudSide;
}

export interface DraftInput {
  maskedLetter: string;
  maskedNotes: string;
  plan: PlanType;
  appealName: string;     // "internal appeal", "reconsideration", "redetermination"
  codes: string[];        // "CO-50: the insurer says the service was not medically necessary"
  rights: string[];       // rule texts from official sources that may apply
}

// Offline, the cloud side would first wait on App Check's reCAPTCHA script, which cannot load, before
// the SDK falls back; drafting goes straight to Gemini Nano instead.
const deviceDrafter: GenerativeModel = getGenerativeModel(deviceAI, {
  mode: InferenceMode.ONLY_ON_DEVICE,
  onDeviceParams: { createOptions: { ...TEXT_IO, initialPrompts: [{ role: "system", content: [{ type: "text", value: DRAFT_RULES }] }] } },
});

const CLOUD_PATIENCE_MS = 25_000;

export async function draftAppeal(d: DraftInput): Promise<Answer<string>> {
  const prompt = draftPrompt(d);
  if (!navigator.onLine) return timed(deviceDrafter, prompt, plain);
  const cloudTry = timed(cloud().drafter, prompt, plain);
  const gaveUp = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), CLOUD_PATIENCE_MS));
  const first = await Promise.race([cloudTry, gaveUp]);
  if (first !== "timeout") return first;
  cloudTry.catch(() => {}); // it may still fail later; the device draft below is what counts now
  // Connected but stuck (a blocked network, a bot check that never finishes): write it here instead.
  return timed(deviceDrafter, prompt, plain);
}

function draftPrompt(d: DraftInput): string {
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
  return prompt;
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
