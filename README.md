# Second Look

**Your insurer said no. Take a second look, privately.**

Second Look helps someone whose health insurance claim was denied. They paste the denial letter or Explanation of Benefits; Second Look explains it in plain words, works out the appeal deadline, points out rights that often decide these appeals, and drafts the appeal letter. The letter is read by Gemini Nano inside Chrome on their own computer. Their name, member ID, dates and address never leave the device: only a masked copy goes to the cloud, and only after they have seen it and said yes.

Live demo: https://second-look-hybrid.web.app (desktop Chrome for the on-device model; other browsers get the masked cloud path). Try it with the built-in sample letters; every person and number in them is invented.

Built for [#BuildHybridAI 2026](https://firebasehybridaihackathon.devpost.com) with [Firebase AI Logic hybrid inference](https://firebase.google.com/docs/ai-logic/hybrid).

## Why hybrid, step by step

Each step uses the inference mode its privacy needs, and the screen says where each answer came from (`response.inferenceSource`):

| Step | Input | Mode | Why |
|---|---|---|---|
| Read the letter: insurer, plan type, dates, amounts, the reason, the people named | the raw letter | `ONLY_ON_DEVICE` | The raw letter is full of personal details. If Gemini Nano is not available, this step does not run in the cloud instead: the person sees a masked copy first (below). |
| Find names in the person's own notes | their notes | `ONLY_ON_DEVICE` | Notes name people the letter does not (a relative, a therapist). |
| Explain it in plain words | the masked letter | `ONLY_ON_DEVICE` (or `ONLY_IN_CLOUD` after a yes, where there is no Gemini Nano) | Already masked, but the cloud still waits for the person's say-so. |
| Draft the appeal letter | masked letter, masked notes, code meanings, rules | `PREFER_IN_CLOUD` | Writing a strong letter benefits from the larger model. With no network, the SDK falls back to Gemini Nano, which gets the same rules as a system prompt. |

The cloud side (a second Firebase app with App Check and reCAPTCHA Enterprise) is created only when the person first agrees to use the cloud. Until then the page talks to no host but its own: no Google script, no request. That was checked in the browser's resource timing list on the live site.

`PREFER_ON_DEVICE` is deliberately not used: it sends a request to the cloud whenever the on-device model is merely "downloadable", which is not acceptable for the raw letter. The private steps use `ONLY_ON_DEVICE` and call `initializeDeviceModel()` from the person's click. Browsers that expose the Prompt API but never answer it are detected with a timeout and get the masked cloud path.

## Works offline

After one visit, a service worker (generated at build time with the exact file list, `vite.config.ts`) keeps the app shell. With no connection at all, Second Look still opens, reads the letter, explains it, works out the deadline and drafts the appeal: `PREFER_IN_CLOUD` falls back to Gemini Nano, which gets the same drafting rules as a system prompt. Checked on the live site with the network switched off.

## Masking

Before anything can leave the device, details are replaced with placeholders such as `[PATIENT_NAME]`, `[MEMBER_ID]` or `[DATE_2]` (`src/core/redact.ts`):

- patterns that need no model: labelled IDs (member, group, claim, account, Medicare number), dates (also without a year), dates of birth, phone numbers, emails, street addresses, PO boxes, SSNs, names after labels like "Patient:" or "Dear";
- names Gemini Nano finds in running text, in the letter and in the person's notes;
- anything the person selects on the consent screen and hides.

The consent screen shows exactly what would be sent, with black bars where the details were. The map from placeholder to value stays in memory on the device, and the drafted letter gets the real details back there. Nothing is stored.

## What is not left to a model

- **Codes** (`src/core/codes.ts`): adjustment codes like CO-50 and remark codes like N115 are found by pattern, and the common ones are explained from a short table written in our own words, with what usually helps. The official descriptions belong to X12 and are linked, not copied.
- **Deadlines** (`src/core/deadline.ts`): a deadline printed in the letter wins ("within 180 days of the date of this notice", "by March 3, 2027"); otherwise the plan's rule: 180 days for Marketplace and job-based plans, 65 days for Medicare Advantage and Part D, the date on the notice for Original Medicare and Medicaid. A calendar file with a reminder a week ahead.
- **Rights** (`src/core/protections.ts`): chosen by rule from the plan type and the letter, each linked to the official page it comes from: emergency care at out-of-network hospitals (HealthCare.gov, the No Surprises Act, Medicare.gov), fast appeals, independent external review. The drafting prompt may cite only these.

## Run it

```bash
npm install
cp .env.example .env.local      # your Firebase web app's config
npm run dev                     # http://localhost:5173
npm test                        # unit tests for codes, masking, deadlines and rights
```

The Firebase project needs Firebase AI Logic with the Gemini Developer API (the console's AI Logic > Get started does this; `scripts/setup-firebase.md` has the same steps as API calls). Gemini Nano needs desktop Chrome with the Prompt API; Chrome downloads the model on first use.

Deploy: `npm run build && python3 scripts/deploy.py <site-id> --account <your gcloud account>` uploads `dist/` through the Firebase Hosting REST API with a strict Content Security Policy.

## Limits

Second Look is not legal or medical advice, and it does not file anything. Rules differ by plan and by state; the app links each rule to its source and tells people to check their plan documents. The on-device model is small, so the facts it reads are shown for the person to check.

## License

MIT
