import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/full-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource/atkinson-hyperlegible-mono";
import "@fontsource/atkinson-hyperlegible-mono/700.css";
import "./style.css";

import { appealName, CLOUD_MODEL, deviceStatus, draftAppeal, explain, findPeople, photoStatus, prepareDevice, preparePhoto, readLetter, readMaskedLetter, readPhoto, type Explanation, type Facts, type Where } from "./ai";
import { findCodes, GROUPS, helpFor, OFFICIAL_LISTS, type FoundCode } from "./core/codes";
import { deadline, ics, parseDate, RULES, type PlanType } from "./core/deadline";
import { protections } from "./core/protections";
import { fillBack, leftovers, patternEntities, redact, type Category, type Entity, type Redaction } from "./core/redact";
import { SAMPLES } from "./samples";
import { byUrgency, isoDay, loadCases, nextStep, removeCase, upsertCase, type Care, type Case, type Status } from "./core/tracker";

// ---------- a small DOM helper ----------

type Kid = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false || v === null) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "style") el.setAttribute("style", String(v));
    else if (k === "value") (el as unknown as { value: string }).value = String(v);
    else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}

const main = document.getElementById("main")!;
const devicePill = document.getElementById("device")!;

interface State {
  device: string;
  letter: string;
  plan: PlanType;
  facts?: Facts;
  factsWhere?: Where;
  factsMs?: number;
  codes: FoundCode[];
  masked?: Redaction;
  extra: Entity[];            // details the user masked by hand
  notePeople: Entity[];       // names Gemini Nano found in the user's notes
  cloudReading?: boolean;     // the person chose to have the masked letter read in the cloud
  photo: string;              // whether this browser can read images on the device
  fromPhoto?: boolean;        // the letter text came from a photo: ask the person to check it
  explanation?: Explanation;
  explainWhere?: Where;
  explainMs?: number;
  noticeDate?: Date;
  notes: string;
  draft?: string;
  draftWhere?: Where;
  draftMs?: number;
  caseId?: string;            // set once this letter is saved to My appeals
}
const state: State = { device: "unavailable", photo: "unavailable", letter: "", plan: "unknown", codes: [], extra: [], notePeople: [], notes: "" };

const LABEL: Record<Category, string> = {
  PATIENT_NAME: "name", PROVIDER_NAME: "doctor", PERSON_NAME: "name", MEMBER_ID: "member ID", GROUP_NUMBER: "group no.",
  CLAIM_NUMBER: "claim no.", ACCOUNT_NUMBER: "account no.", DATE_OF_BIRTH: "birth date", SERVICE_DATE: "date",
  NOTICE_DATE: "date", DATE: "date", ADDRESS: "address", PHONE: "phone", EMAIL: "email", SSN: "SSN", OTHER: "hidden",
};
const categoryOf = (placeholder: string) => placeholder.slice(1, -1).replace(/_\d+$/, "") as Category;

function badge(where: Where | undefined, ms?: number, label?: string) {
  if (!where) return null;
  const device = where === "on_device";
  return h("span", { class: `badge ${device ? "badge-device" : "badge-cloud"}` },
    h("span", { class: "badge-dot", "aria-hidden": "true" }),
    label ?? (device ? "Read on this device · Gemini Nano" : `In the cloud · ${CLOUD_MODEL}`),
    ms !== undefined ? h("span", { class: "badge-ms" }, ` ${(ms / 1000).toFixed(1)} s`) : null);
}

// ---------- device status ----------

async function refreshDevice(progress?: number) {
  state.device = progress !== undefined && progress < 1 ? "downloading" : await deviceStatus();
  const text: Record<string, string> = {
    available: "On-device model ready",
    downloadable: "On-device model: one-time download when you start",
    downloading: `Downloading the on-device model${progress !== undefined ? ` · ${Math.round(progress * 100)}%` : "..."}`,
    unavailable: "No on-device model in this browser",
  };
  devicePill.textContent = text[state.device] ?? state.device;
  devicePill.dataset.state = state.device;
}

// ---------- step 0: the letter ----------

function renderStart() {
  main.replaceChildren();
  const area = h("textarea", {
    id: "letter", class: "paper-input", spellcheck: false, rows: 10, value: state.letter,
    placeholder: "Paste the denial letter or Explanation of Benefits here, or a photo of it. Nothing is uploaded.",
    oninput: () => { state.letter = area.value; go.disabled = !area.value.trim(); },
    onpaste: (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) { e.preventDefault(); renderPhoto(file); }
    },
  });
  const picker = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp", capture: "environment", class: "visually-hidden",
    onchange: () => { const f = picker.files?.[0]; if (f) renderPhoto(f); } });
  const photoButton = h("button", { class: "quiet", onclick: () => picker.click() }, "Use a photo instead");
  const go = h("button", { class: "primary", disabled: !state.letter.trim(), onclick: () => start() },
    state.device === "unavailable" ? "Mask it, then read it" : "Read it on this device");
  const samples = h("div", { class: "samples" }, h("span", { class: "samples-label" }, "No letter to hand? Try one:"),
    ...SAMPLES.map((s) => h("button", { class: "chip", onclick: () => { area.value = s.text; state.letter = s.text; state.plan = s.plan; go.disabled = false; area.focus(); } }, s.title)));
  main.append(
    h("section", { class: "hero" },
      h("h1", {}, "Your insurer said no.", h("br"), h("em", {}, "Take a second look.")),
      h("p", { class: "lede" }, "Paste the letter. Second Look explains it in plain words, finds your appeal deadline and drafts the appeal, while your name, member ID and dates stay on this computer."),
    ),
    h("section", { class: "start" },
      h("label", { for: "letter", class: "step-label" }, h("span", { class: "step-no" }, "1"), "The letter"),
      state.fromPhoto ? h("p", { class: "notice", role: "status" }, "Here is the text from your photo, read on this device. Check it against the letter, especially amounts, dates and codes, then press Read it on this device.") : null,
      h("div", { class: "paper" }, area),
      h("div", { class: "actions" }, go, photoButton, picker, h("p", { class: "fine" },
        state.device === "unavailable"
          ? "This browser cannot run Gemini Nano, so personal details are masked by pattern matching and you will see exactly what would be sent before anything is."
          : "The first time, Chrome downloads Gemini Nano (a few GB) and keeps it for next time.")),
      samples,
    ),
  );
}

// ---------- a photo of the letter ----------

/** Downscales a photo and returns it as base64 JPEG for the on-device model. */
async function photoToJpeg(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = h("canvas", { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.9);
  return url.slice(url.indexOf(",") + 1);
}

function renderPhoto(file: File) {
  const src = URL.createObjectURL(file);
  const canRead = state.photo !== "unavailable";
  const read = h("button", { class: "primary", disabled: !canRead, onclick: async () => {
    main.replaceChildren(h("section", { class: "working" }, h("h2", {}, "Reading your photo"), h("img", { class: "thumb", src, alt: "Your photo" }), steps));
    steps.replaceChildren();
    progress(state.photo === "available" ? "Getting Gemini Nano ready on this device" : "Downloading Gemini Nano to this computer, once");
    try {
      const jpeg = await photoToJpeg(file);
      await preparePhoto((p) => refreshDevice(p));
      await refreshDevice();
      progress("Reading the text in your photo, on this device");
      const r = await readPhoto(jpeg);
      progress("Done", true);
      URL.revokeObjectURL(src);
      state.letter = r.value;
      state.fromPhoto = true;
      state.photo = "available";
      renderStart();
    } catch (err) {
      renderError(err);
    }
  } }, "Read this photo on this device");
  main.replaceChildren(h("section", { class: "card wide" },
    h("h2", {}, "Your photo"),
    h("img", { class: "photo", src, alt: "The photo you chose" }),
    canRead
      ? h("p", {}, "Gemini Nano will read the text in this photo here, on this computer. The photo is never uploaded.")
      : h("p", {}, "This browser cannot read photos on the device, so Second Look will not upload it. Type or paste the text of the letter instead."),
    h("div", { class: "actions" }, read, h("button", { class: "quiet", onclick: () => { URL.revokeObjectURL(src); renderStart(); } }, canRead ? "Choose another" : "Back")),
  ));
}

// ---------- the reading ----------

const steps = h("ol", { class: "progress", "aria-live": "polite" });
function progress(text: string, done = false) {
  const last = steps.lastElementChild;
  if (last && !last.classList.contains("done")) last.classList.add("done");
  steps.append(h("li", { class: done ? "done" : "" }, text));
}

async function start() {
  const letter = state.letter.trim();
  if (!letter) return;
  state.fromPhoto = false;
  main.replaceChildren(h("section", { class: "working" }, h("h2", {}, "Reading your letter"), steps));
  steps.replaceChildren();
  state.codes = findCodes(letter);
  try {
    if (state.device !== "unavailable") {
      const download = state.device === "downloadable" || state.device === "downloading";
      progress(download ? "Downloading Gemini Nano to this computer, once" : "Getting Gemini Nano ready on this device");
      let skipped = false;
      const fill = h("span", { class: "meter-fill" });
      if (download) {
        steps.lastElementChild!.append(
          h("div", { class: "meter", role: "progressbar", "aria-label": "Gemini Nano download" }, fill),
          h("p", { class: "fine" }, "Chrome keeps the model for next time, so this happens only once. It can take a few minutes."),
          h("button", { class: "quiet", onclick: () => { skipped = true; state.cloudReading = true; remask(); renderConsentToRead("downloading"); } }, "Don't wait: mask it and use the cloud"));
      }
      await prepareDevice((p) => { refreshDevice(p); fill.style.width = `${Math.round(p * 100)}%`; });
      if (skipped) return; // the person chose the masked cloud path; the download carries on for next time
      await refreshDevice();
      progress("Reading the letter on this device: amounts, dates, people");
      const read = await readLetter(letter);
      Object.assign(state, { facts: read.value, factsWhere: read.where, factsMs: read.ms });
      if (read.value.plan_type && read.value.plan_type !== "unknown") state.plan = read.value.plan_type;
      remask();
    } else {
      remask();
      state.cloudReading = true;
      progress("Masked personal details by pattern; waiting for you before anything is sent");
      return renderConsentToRead("unavailable");
    }
    await explainStep();
  } catch (err) {
    renderError(err);
  }
}

/** Masks the letter with pattern matches, names the model found, and anything the user marked. */
function remask() {
  const people: Entity[] = (state.facts?.people ?? []).filter((n) => n.trim().length > 2).map((value) => ({
    category: new RegExp(`(Dr\\.?|Doctor)\\s+${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(state.letter) || /^Dr\.?\s/.test(value) ? "PROVIDER_NAME" : "PERSON_NAME",
    value,
  }));
  const dated: Entity[] = [];
  if (state.facts?.notice_date) dated.push({ category: "NOTICE_DATE", value: state.facts.notice_date });
  if (state.facts?.service_date) dated.push({ category: "SERVICE_DATE", value: state.facts.service_date });
  state.masked = redact(state.letter, [...patternEntities(state.letter), ...dated, ...people, ...state.extra]);
  state.noticeDate = parseDate(state.facts?.notice_date ?? "") ?? state.noticeDate;
}

async function explainStep() {
  progress(state.device === "unavailable" ? "Explaining the masked letter in the cloud" : "Explaining it in plain words");
  const ex = await explain(state.masked!.text, state.device === "available" && !state.cloudReading);
  Object.assign(state, { explanation: ex.value, explainWhere: ex.where, explainMs: ex.ms });
  progress("Done", true);
  renderResults();
}

// Without Gemini Nano: show the masked letter first and read it in the cloud only after a yes.
function renderConsentToRead(why: "unavailable" | "downloading") {
  main.replaceChildren(
    h("section", { class: "card wide" },
      h("h2", {}, why === "downloading" ? "Read it in the cloud while Gemini Nano downloads" : "This browser can't read the letter privately"),
      h("p", {}, why === "downloading"
        ? "Below is your letter with personal details masked by pattern matching. If it looks right, it can be read in the cloud now; next time, Gemini Nano will read it on this computer. Names written in running text may be missed, so check it."
        : "Gemini Nano runs in desktop Chrome. Here, Second Look can still help: below is your letter with personal details masked by pattern matching. If it looks right, it can be read in the cloud. Names written in running text may be missed, so check it."),
      maskedPreview(),
      h("div", { class: "actions" },
        h("button", { class: "primary", onclick: async () => {
          try {
            main.replaceChildren(h("section", { class: "working" }, h("h2", {}, "Reading the masked letter"), steps));
            progress("Reading the masked letter in the cloud");
            const read = await readMaskedLetter(state.masked!.text);
            const facts = read.value;
            const back = (s: string) => fillBack(s, state.masked!.map).text;
            state.facts = { ...facts, notice_date: back(facts.notice_date), service_date: back(facts.service_date), provider: back(facts.provider), people: [] };
            Object.assign(state, { factsWhere: read.where, factsMs: read.ms });
            if (facts.plan_type !== "unknown") state.plan = facts.plan_type;
            state.noticeDate = parseDate(state.facts.notice_date) ?? state.noticeDate;
            await explainStep();
          } catch (err) { renderError(err); }
        } }, "Read the masked letter in the cloud"),
        h("button", { class: "quiet", onclick: renderStart }, "Start over")),
    ));
}

// ---------- results ----------

function renderResults() {
  const f = state.facts!;
  main.replaceChildren(
    h("div", { class: "spread" },
      h("section", { class: "sheet-col" },
        h("div", { class: "step-label" }, h("span", { class: "step-no" }, "1"), "Your letter, annotated"),
        annotatedLetter(),
        h("p", { class: "legend" },
          h("mark", { class: "reason static" }, "the reason"), " · ", h("span", { class: "code" }, "codes"), " · ",
          h("mark", { class: "pii static" }, "personal details"), " are masked before anything leaves this device."),
        h("button", { class: "quiet", onclick: renderStart }, "Start over with another letter"),
      ),
      h("section", { class: "notes-col" },
        factsCard(f),
        explanationCard(),
        codesCard(),
        deadlineCard(),
        rightsCard(),
        caseCard(),
      ),
    ),
  );
  // Bring the highlighted reason into view inside the sheet as its highlight sweeps in.
  const mark = main.querySelector<HTMLElement>("mark.reason");
  const sheet = mark?.closest<HTMLElement>(".sheet");
  if (mark && sheet) sheet.scrollTop = Math.max(0, mark.offsetTop - sheet.clientHeight / 3);
}

function factsCard(f: Facts) {
  const row = (k: string, v: string) => (v ? h("div", { class: "fact" }, h("dt", {}, k), h("dd", {}, v)) : null);
  return h("article", { class: "card" },
    h("header", { class: "card-head" }, h("h2", {}, "What the letter says"), badge(state.factsWhere, state.factsMs, state.factsWhere === "on_device" ? undefined : `Masked, read in the cloud · ${CLOUD_MODEL}`)),
    h("dl", { class: "facts" },
      row("From", f.insurer), row("Plan", RULES[state.plan].label), row("Care", f.service), row("Given by", f.provider),
      row("Billed", f.amount_billed), row("Plan paid", f.plan_paid), row("You may owe", f.you_owe), row("Notice dated", f.notice_date)),
  );
}

function explanationCard() {
  const e = state.explanation!;
  return h("article", { class: "card" },
    h("header", { class: "card-head" }, h("h2", {}, "In plain words"), badge(state.explainWhere, state.explainMs, state.explainWhere === "on_device" ? "On this device · Gemini Nano" : undefined)),
    h("p", { class: "summary" }, fillBack(e.summary, state.masked!.map).text),
    e.reasons.length ? h("ul", { class: "reasons" }, ...e.reasons.map((r) => h("li", {}, h("strong", {}, fillBack(r.reason, state.masked!.map).text), " ", fillBack(r.plain, state.masked!.map).text))) : null,
  );
}

function codesCard() {
  if (!state.codes.length) return null;
  return h("article", { class: "card" },
    h("header", { class: "card-head" }, h("h2", {}, "The codes"), h("span", { class: "badge badge-fixed" }, "From a fixed table, not a model")),
    h("ul", { class: "codes" }, ...state.codes.map((c) => {
      const help = helpFor(c);
      return h("li", {},
        h("span", { class: "code big" }, c.kind === "adjustment" ? `${c.group}-${c.code}` : c.code),
        h("div", {},
          c.group ? h("p", { class: "group" }, GROUPS[c.group]) : null,
          help ? h("p", {}, help.meaning) : h("p", {}, c.kind === "remark" ? "A remark code: extra detail about the decision." : "Not in our short list."),
          help ? h("p", { class: "try" }, h("strong", {}, "What helps: "), help.tryThis) : null,
          h("a", { href: c.kind === "remark" ? OFFICIAL_LISTS.remark : OFFICIAL_LISTS.adjustment, rel: "noopener", target: "_blank" }, "Official wording (X12)")));
    })),
  );
}

function deadlineCard() {
  const box = h("div", { class: "deadline-box" });
  const plan = h("select", { id: "plan", onchange: () => { state.plan = plan.value as PlanType; draw(); } },
    ...(Object.keys(RULES) as PlanType[]).map((k) => h("option", { value: k, selected: k === state.plan }, RULES[k].label)));
  const iso = (d?: Date) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : "");
  const date = h("input", { type: "date", id: "notice", value: iso(state.noticeDate), onchange: () => { state.noticeDate = parseDate(date.value); draw(); } });
  function draw() {
    const d = deadline(state.plan, state.noticeDate, state.letter);
    const fmt = (x: Date) => x.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    box.replaceChildren(
      d.due
        ? h("div", { class: `due ${d.daysLeft! < 14 ? "urgent" : ""}` },
          h("span", { class: "due-label" }, d.daysLeft! >= 0 ? "Appeal by" : "The deadline was"),
          h("span", { class: "due-date" }, fmt(d.due)),
          h("span", { class: "due-left" }, d.daysLeft! >= 0 ? `${d.daysLeft} days left` : `${-d.daysLeft!} days ago; you may still ask for an extension for good cause`))
        : h("div", { class: "due unknown" }, h("span", { class: "due-label" }, "Deadline"), h("span", { class: "due-date small" }, state.plan === "unknown" ? "Choose your plan type to count the days" : "Use the date printed on your notice")),
      h("p", { class: "fine" }, d.explanation, " ", d.source ? h("a", { href: d.source, rel: "noopener", target: "_blank" }, "Source") : null),
      d.due ? h("button", { class: "quiet", onclick: () => download("appeal-deadline.ics", ics(d.due!, "Appeal deadline: denied claim", `File the appeal for the denied claim (${state.facts?.service || "see letter"}). Drafted with Second Look.`), "text/calendar") }, "Add to my calendar") : "",
    );
  }
  draw();
  return h("article", { class: "card" },
    h("header", { class: "card-head" }, h("h2", {}, "Your deadline"), h("span", { class: "badge badge-fixed" }, "Worked out here, by rule")),
    h("div", { class: "row" }, h("label", {}, "Plan type", plan), h("label", {}, "Notice date", date)),
    box,
  );
}

function rightsCard() {
  const items = protections(state.plan, state.letter, state.codes);
  if (!items.length) return null;
  return h("article", { class: "card" },
    h("header", { class: "card-head" }, h("h2", {}, "Rights that can help"), h("span", { class: "badge badge-fixed" }, "From official sources, not a model")),
    h("ul", { class: "rights" }, ...items.map((p) => h("li", {},
      h("strong", {}, p.title), h("p", {}, p.body), h("a", { href: p.source, rel: "noopener", target: "_blank" }, new URL(p.source).hostname.replace(/^www\./, ""))))),
  );
}

function caseCard() {
  const notes = h("textarea", {
    class: "notes", rows: 6, value: state.notes,
    placeholder: "In your own words: why should they pay? What did your doctor say, what did you try first, why couldn't it wait?",
    oninput: () => { state.notes = notes.value; },
  });
  const tips = (state.explanation?.next_steps ?? []).slice(0, 4);
  return h("article", { class: "card accent" },
    h("header", { class: "card-head" }, h("h2", {}, "Your side of the story")),
    tips.length ? h("div", { class: "tips" }, h("p", { class: "fine" }, "Points that could help, from the letter:"),
      ...tips.map((t) => h("button", { class: "chip", onclick: () => { notes.value = `${notes.value.trim()}${notes.value.trim() ? "\n" : ""}- ${fillBack(t, state.masked!.map).text}`; state.notes = notes.value; } }, `+ ${fillBack(t, state.masked!.map).text}`))) : null,
    notes,
    h("div", { class: "actions" }, h("button", { class: "primary", onclick: renderConsent }, "Draft my appeal letter")),
  );
}

// ---------- consent: what leaves the device ----------

/** Masked text drawn the way it will be sent: every hidden detail is a black bar. */
function barred(text: string, cls = "") {
  const map = state.masked!.map;
  const sheet = h("div", { class: `sheet masked ${cls}`, tabindex: 0, "aria-label": "Text as it would be sent, with personal details masked" });
  for (const p of text.split(/(\[[A-Z][A-Z_]*(?:_\d+)?\])/g)) {
    if (p in map) sheet.append(h("span", { class: "bar", title: `${p} stays on this device` }, h("span", { class: "bar-label" }, LABEL[categoryOf(p)] ?? "hidden")));
    else sheet.append(p);
  }
  return sheet;
}

/** Masks the letter and the notes together, so a detail gets one placeholder in both. */
function maskAll(): { letter: string; notes: string } {
  remask();
  const notes = redact(state.notes, [...patternEntities(state.notes), ...state.notePeople, ...state.extra], state.masked);
  state.masked = { ...state.masked!, map: notes.map };
  return { letter: state.masked.text, notes: notes.text };
}

// Without Gemini Nano (before reading): just the masked letter, with a way to hide more.
function maskedPreview() {
  const box = h("div", { class: "preview" });
  const draw = () => {
    remask();
    const left = leftovers(state.masked!.text);
    box.replaceChildren(barred(state.masked!.text), h("div", { class: "preview-foot" },
      h("p", { class: "fine" }, `${Object.keys(state.masked!.map).length} details masked`, left.length ? `; ${left.length} may be personal, look closely` : "", ". Select any other words and hide them."),
      hideButton(draw)));
  };
  draw();
  return box;
}

function hideButton(redraw: () => void) {
  return h("button", { class: "quiet", onclick: () => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel || sel.length < 2) return flash("Select the words to hide first");
    state.extra.push({ category: "OTHER", value: sel });
    redraw();
  } }, "Hide selected words");
}

async function renderConsent() {
  state.notePeople = [];
  if (state.notes.trim() && state.device === "available") {
    main.replaceChildren(h("section", { class: "working" }, h("h2", {}, "Checking your notes"), steps));
    steps.replaceChildren();
    progress("Looking for names in your notes, on this device");
    try {
      const found = await findPeople(state.notes);
      state.notePeople = found.value.people.filter((n) => n.trim().length > 2).map((value) => ({ category: "PERSON_NAME" as const, value }));
    } catch (err) {
      console.warn("people check failed", err);
    }
  }
  drawConsent();
}

function drawConsent() {
  const masked = maskAll();
  const left = [...leftovers(masked.letter), ...leftovers(masked.notes)];
  const agree = h("input", { type: "checkbox", id: "agree", onchange: () => { send.disabled = !agree.checked; } });
  const send = h("button", { class: "primary", disabled: true, onclick: () => draftStep(masked.notes) }, "Send the masked text and draft my letter");
  main.replaceChildren(
    h("section", { class: "card wide consent" },
      h("div", { class: "step-label" }, h("span", { class: "step-no" }, "2"), "Before anything leaves this device"),
      h("h2", {}, "This is everything that would be sent"),
      h("p", {}, "To write a strong letter, Second Look uses Gemini in the cloud. It sees only what is shown here: the letter with your details blacked out, and your own notes. Your real name, IDs and dates are put back into the letter afterwards, here on your device."),
      h("div", { class: "preview" },
        barred(masked.letter),
        state.notes.trim() ? h("div", {}, h("p", { class: "fine sheet-caption" }, "Your notes, as they would be sent:"), barred(masked.notes, "small-sheet")) : null,
        h("div", { class: "preview-foot" },
          h("p", { class: "fine" }, `${Object.keys(state.masked!.map).length} details masked`, left.length ? `; ${left.length} may be personal, look closely` : "", ". Spot anything else? Select it and hide it."),
          hideButton(drawConsent))),
      h("label", { class: "agree" }, agree, " I have checked it and I'm happy for this masked text to be sent to Google's Gemini to draft my letter."),
      h("div", { class: "actions" }, send, h("button", { class: "quiet", onclick: renderResults }, "Back")),
    ),
  );
}

async function draftStep(maskedNotes: string) {
  main.replaceChildren(h("section", { class: "working" }, h("h2", {}, "Drafting your appeal"), steps));
  steps.replaceChildren();
  progress("Sending the masked letter and notes to Gemini");
  try {
    const codes = state.codes.map((c) => `${c.kind === "adjustment" ? `${c.group}-${c.code}` : c.code}: ${helpFor(c)?.meaning ?? "see the letter"}`);
    const rights = protections(state.plan, state.letter, state.codes).map((p) => `${p.title}: ${p.body}`);
    const d = await draftAppeal({ maskedLetter: state.masked!.text, maskedNotes, plan: state.plan, appealName: appealName(state.plan), codes, rights });
    Object.assign(state, { draft: d.value, draftWhere: d.where, draftMs: d.ms });
    progress("Putting your details back in, on this device", true);
    renderLetter();
  } catch (err) {
    renderError(err);
  }
}

// ---------- the appeal letter ----------

function renderLetter() {
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const back = fillBack(state.draft!, { ...state.masked!.map, "[TODAY]": today });
  const area = h("textarea", { class: "paper-input letter-out", rows: 26, value: back.text, spellcheck: true });
  const encl = encloseList();
  main.replaceChildren(
    h("div", { class: "spread" },
      h("section", { class: "sheet-col" },
        h("div", { class: "step-label" }, h("span", { class: "step-no" }, "3"), "Your appeal letter"),
        h("div", { class: "paper" }, area),
        h("div", { class: "actions" },
          h("button", { class: "primary", onclick: async () => { await navigator.clipboard.writeText(area.value); flash("Copied"); } }, "Copy"),
          h("button", { class: "quiet", onclick: () => download("appeal-letter.txt", area.value, "text/plain") }, "Download"),
          h("button", { class: "quiet", onclick: () => printLetter(area.value) }, "Print"),
          h("button", { class: "quiet", onclick: renderResults }, "Back to the notes")),
      ),
      h("section", { class: "notes-col" },
        trackCard(area),
        h("article", { class: "card" },
          h("header", { class: "card-head" }, h("h2", {}, "How it was written"), badge(state.draftWhere, state.draftMs, state.draftWhere === "on_device" ? `${navigator.onLine ? "Cloud unavailable" : "Offline"}, so drafted on this device · Gemini Nano` : `From masked text, in the cloud · ${CLOUD_MODEL}`)),
          h("p", {}, state.draftWhere === "on_device"
            ? "Gemini Nano wrote it here, on this computer: nothing left the device."
            : "Gemini in the cloud saw only placeholders like [PATIENT_NAME]; your details were filled back in on this device."),
          back.unknown.length ? h("div", { class: "blanks" }, h("p", {}, h("strong", {}, "Fill these in before you send it:")), h("ul", {}, ...back.unknown.map((u) => h("li", {}, h("code", {}, u))))) : null,
        ),
        h("article", { class: "card" }, h("header", { class: "card-head" }, h("h2", {}, "Send it with")), encl),
        deadlineCard(),
      ),
    ),
  );
}

function encloseList() {
  const items = ["A copy of the denial letter or Explanation of Benefits", "Your doctor's letter explaining why the care was needed", "Medical records that back it up (notes, test results, treatments tried)"];
  const has = (n: string) => state.codes.some((c) => c.code === n);
  if (has("197") || has("198")) items.push("Any record of the authorization request, and why the care could not wait");
  if (has("242")) items.push("Anything showing it was an emergency, or that no in-network provider was available");
  if (has("16") || has("252")) items.push("The missing information the insurer asked for");
  items.push("Keep a copy of everything, and send it in a way you can track (fax confirmation, certified mail or the insurer's portal)");
  return h("ul", { class: "checklist" }, ...items.map((t) => h("li", {}, t)));
}

// ---------- annotated letter ----------

function annotatedLetter() {
  const text = state.letter;
  const lower = text.toLowerCase();
  type R = { s: number; e: number; kind: "pii" | "code"; ph?: string };
  const ranges: R[] = [];
  for (const [ph, value] of Object.entries(state.masked!.map)) {
    let i = lower.indexOf(value.toLowerCase());
    while (i >= 0) { ranges.push({ s: i, e: i + value.length, kind: "pii", ph }); i = lower.indexOf(value.toLowerCase(), i + value.length); }
  }
  for (const c of state.codes) {
    let i = text.indexOf(c.raw);
    while (i >= 0) { ranges.push({ s: i, e: i + c.raw.length, kind: "code" }); i = text.indexOf(c.raw, i + c.raw.length); }
  }
  ranges.sort((a, b) => a.s - b.s || b.e - a.e);
  const inner: R[] = [];
  for (const r of ranges) if (!inner.length || r.s >= inner[inner.length - 1].e) inner.push(r);
  const reason = state.facts?.denial_reason?.trim() ?? "";
  const rs = reason.length > 12 ? lower.indexOf(reason.toLowerCase().slice(0, 60)) : -1;
  const re = rs >= 0 ? Math.min(text.length, rs + reason.length) : -1;
  const cuts = new Set([0, text.length, ...inner.flatMap((r) => [r.s, r.e]), ...(rs >= 0 ? [rs, re] : [])]);
  const points = [...cuts].sort((a, b) => a - b);
  const sheet = h("div", { class: "sheet", role: "document" });
  let reasonMark: HTMLElement | null = null;
  for (let k = 0; k < points.length - 1; k++) {
    const a = points[k], b = points[k + 1];
    const piece = text.slice(a, b);
    const r = inner.find((x) => x.s <= a && b <= x.e);
    const node = r?.kind === "pii"
      ? h("mark", { class: "pii", title: `Masked as ${r.ph} before anything is shared` }, piece)
      : r?.kind === "code" ? h("span", { class: "code" }, piece) : document.createTextNode(piece);
    if (rs >= 0 && a >= rs && b <= re) {
      if (!reasonMark) { reasonMark = h("mark", { class: "reason" }); sheet.append(reasonMark); }
      reasonMark.append(node);
    } else {
      reasonMark = null;
      sheet.append(node);
    }
  }
  return sheet;
}

// ---------- small things ----------

// ---------- My appeals: saved cases and the next date that matters ----------

const casesLink = document.getElementById("cases-link") as HTMLButtonElement;
casesLink.onclick = () => renderCases();
function refreshCasesLink() {
  const n = loadCases().length;
  casesLink.hidden = n === 0;
  casesLink.textContent = `My appeals (${n})`;
}

function trackCard(letter: HTMLTextAreaElement) {
  const had = !!state.facts?.service_date;
  const care = h("select", {},
    h("option", { value: "received", selected: had }, "Yes, I already had it"),
    h("option", { value: "not_yet", selected: !had }, "Not yet: it needs approval first"),
    h("option", { value: "urgent" }, "It is urgent: my health can't wait"));
  const said = h("p", { class: "fine", role: "status" });
  const save = h("button", { class: "primary", onclick: () => {
    const d = deadline(state.plan, state.noticeDate, state.letter);
    const c: Case = {
      id: state.caseId ?? crypto.randomUUID(), created: new Date().toISOString(),
      title: state.facts?.service || "Denied claim", insurer: state.facts?.insurer || "",
      plan: state.plan, care: care.value as Care, due: d.due ? isoDay(d.due) : undefined,
      status: "drafted", letter: letter.value,
    };
    state.caseId = c.id;
    upsertCase(c);
    refreshCasesLink();
    save.textContent = "Update the saved appeal";
    said.replaceChildren("Saved in this browser only (anyone using this browser profile can open it). ",
      h("a", { href: "#", onclick: (e: Event) => { e.preventDefault(); renderCases(); } }, "Open My appeals"));
  } }, state.caseId ? "Update the saved appeal" : "Save to My appeals");
  return h("article", { class: "card accent" },
    h("header", { class: "card-head" }, h("h2", {}, "Keep track of it"), h("span", { class: "badge badge-fixed" }, "Stays on this device")),
    h("p", {}, "Save the letter and Second Look counts down to each date that matters: your deadline, when the plan must answer, and when you can ask for an independent review."),
    h("label", { class: "stack" }, "Have you already had this care?", care),
    h("div", { class: "actions" }, save), said);
}

const STATUS_LABEL: Record<Status, string> = {
  drafted: "Letter ready", sent: "Sent, waiting", approved: "Approved", denied_again: "Denied again", external_sent: "External review", closed: "Closed",
};

function renderCases() {
  refreshCasesLink();
  const list = byUrgency(loadCases());
  main.replaceChildren(
    h("section", { class: "hero" },
      h("h1", {}, "My appeals"),
      h("p", { class: "lede" }, "Each appeal you saved, with the next date that matters. Kept in this browser only: nothing on this page is sent anywhere.")),
    list.length ? h("div", { class: "cases" }, ...list.map(caseItem)) : h("p", { class: "fine" }, "Nothing saved yet. After you draft a letter, choose Save to My appeals."),
    h("div", { class: "actions" }, h("button", { class: "primary", onclick: () => { state.caseId = undefined; renderStart(); } }, "Check another letter")),
  );
}

function caseItem(c: Case): HTMLElement {
  const step = nextStep(c);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "long", day: "numeric" });
  const save = (patch: Partial<Case>) => { upsertCase({ ...c, ...patch }); renderCases(); };
  const today = isoDay(new Date());
  const when = h("input", { type: "date", value: today, max: today, "aria-label": "Date" });
  const mark = (status: Status, field: "sent" | "decided" | "externalSent") => () => save({ status, [field]: when.value || today });
  const moves: HTMLElement[] = [];
  if (c.status === "drafted") moves.push(h("button", { class: "primary", onclick: mark("sent", "sent") }, "I sent it"));
  if (c.status === "sent") moves.push(h("button", { class: "primary", onclick: mark("approved", "decided") }, "They said yes"), h("button", { class: "quiet", onclick: mark("denied_again", "decided") }, "They said no again"));
  if (c.status === "denied_again") moves.push(h("button", { class: "primary", onclick: mark("external_sent", "externalSent") }, "I asked for an external review"), h("button", { class: "quiet", onclick: () => save({ status: "closed" }) }, "Stop tracking"));
  if (c.status === "external_sent") moves.push(h("button", { class: "primary", onclick: mark("approved", "decided") }, "The reviewer sided with me"), h("button", { class: "quiet", onclick: () => save({ status: "closed" }) }, "The denial stands"));
  const letter = h("pre", { class: "case-letter", hidden: true }, c.letter);
  let armed = false;
  const del = h("button", { class: "quiet", onclick: () => {
    if (!armed) { armed = true; del.textContent = "Delete it for good?"; setTimeout(() => { armed = false; del.textContent = "Delete"; }, 4000); return; }
    removeCase(c.id); renderCases();
  } }, "Delete");
  return h("article", { class: "card case" },
    h("header", { class: "card-head" },
      h("h2", {}, c.title),
      h("span", { class: `badge status-${c.status}` }, STATUS_LABEL[c.status])),
    c.insurer ? h("p", { class: "fine" }, `${c.insurer} · ${RULES[c.plan].label}`) : h("p", { class: "fine" }, RULES[c.plan].label),
    h("div", { class: `due ${step.overdue ? "urgent" : ""} ${step.done ? "done" : ""}` },
      h("span", { class: "due-label" }, step.label),
      step.date ? h("span", { class: "due-date" }, fmt(step.date)) : null,
      step.date && !step.done ? h("span", { class: "due-left" }, step.overdue ? `${-step.daysLeft!} days ago` : step.daysLeft === 0 ? "Today" : `In ${step.daysLeft} days`) : null),
    h("p", { class: "fine" }, step.advice, " ", step.source ? h("a", { href: step.source, rel: "noopener", target: "_blank" }, "Source") : null),
    moves.length ? h("div", { class: "actions" }, h("label", { class: "inline" }, "Date", when), ...moves) : null,
    h("div", { class: "actions" },
      step.date && !step.done ? h("button", { class: "quiet", onclick: () => download("appeal-date.ics", ics(step.date!, `${step.label} ${fmt(step.date!)}: ${c.title}`, `${step.advice} Tracked with Second Look.`), "text/calendar") }, "Add to my calendar") : null,
      h("button", { class: "quiet", onclick: () => { letter.hidden = !letter.hidden; } }, "Show the letter"),
      h("button", { class: "quiet", onclick: async () => { await navigator.clipboard.writeText(c.letter); flash("Copied"); } }, "Copy the letter"),
      del),
    letter,
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  h("a", { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function printLetter(text: string) {
  const w = window.open("", "_blank", "noopener=no");
  if (!w) return;
  w.document.write(`<pre style="font: 12pt/1.5 Georgia, serif; white-space: pre-wrap; margin: 1in">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`);
  w.document.close();
  w.print();
}

function flash(text: string) {
  const t = h("div", { class: "toast", role: "status" }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 1600);
}

function renderError(err: unknown) {
  console.error(err);
  const msg = err instanceof Error ? err.message : String(err);
  main.replaceChildren(h("section", { class: "card wide" },
    h("h2", {}, "Something went wrong"),
    h("p", {}, msg),
    h("p", { class: "fine" }, "Nothing was sent without your say-so. You can try again, or start over."),
    h("div", { class: "actions" }, h("button", { class: "primary", onclick: () => (state.facts ? renderResults() : renderStart()) }, "Try again"), h("button", { class: "quiet", onclick: renderStart }, "Start over"))));
}

// Say so when the connection drops: reading, explaining and drafting carry on with Gemini Nano.
const net = document.getElementById("net")!;
const showNet = () => { net.hidden = navigator.onLine; };
addEventListener("online", showNet);
addEventListener("offline", showNet);
showNet();

// After one visit the app opens without a connection; the reading and, offline, the drafting run on Gemini Nano.
if ("serviceWorker" in navigator && import.meta.env.PROD) navigator.serviceWorker.register("/sw.js").catch(() => {});

// Show the page at once; the device check can take a moment, and the start screen follows it.
renderStart();
refreshCasesLink();
photoStatus().then((p) => { state.photo = p; });
refreshDevice().then(() => {
  if (main.querySelector(".start")) {
    const letter = (main.querySelector("#letter") as HTMLTextAreaElement | null)?.value ?? "";
    renderStart();
    const area = main.querySelector("#letter") as HTMLTextAreaElement | null;
    if (area && letter) { area.value = letter; area.dispatchEvent(new Event("input")); }
  }
});
