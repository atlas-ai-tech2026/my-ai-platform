// ─── kie-model-reader.js ─────────────────────────────────────────────────────
// Read a model's API page and write down what it actually accepts.
//
// Amr, 2026-09-05: "Before you add it you go to kie, the page of the API, and
// read it properly… read all the API catalogues, for the current and the new,
// to be understood, and keep it in your database. This is very important."
//
// ── WHY THIS CAN BE DONE HONESTLY RATHER THAN GUESSED ──────────────────────
// kie's model pages are Next.js pages carrying a __NEXT_DATA__ blob, and
// inside it `playgroundData.formContent` is the REAL parameter schema its own
// playground renders from — parameterKey, the option lists, the defaults, the
// accepted file types, whether several references are allowed. Verified
// against nano-banana-pro on 2026-09-05:
//
//   prompt        PlaygroundTextarea    required, maxLength 20000
//   image_input   PlaygroundFileUpload  multiple, jpeg/png/webp, 30 MB
//   aspect_ratio  PlaygroundSelect      1:1 2:3 3:2 3:4 4:3 4:5 5:4 …
//   resolution    PlaygroundRadio       1K 2K 4K, default 1K
//   output_format PlaygroundRadio       png jpg
//
// That is the whole checklist, read rather than inferred. The page also
// carries `apiDocumentUrl` and `pricingDesc` — "18 credits (~$0.09) for 1K/2K
// and 24 credits (~$0.12) for 4K" — which is why a model's price is a table
// and not a number.
//
// ☠ WHAT IT MUST NEVER DO IS GUESS. A field it cannot find is recorded as
// unknown, and a page it cannot parse makes the row say "I cannot read this,
// not confirmed from my side" — Amr's own words, and the whole point. An
// invented parameter is worse than an absent one: it produces a model that
// looks configured and fails at generate time, after the credits are taken.

const PAGE = (path) => `https://kie.ai/${path}`;

/** Pull the __NEXT_DATA__ payload out of a kie model page. */
export function extractNextData(html = '') {
  const m = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** Turn kie's playground field list into our checklist. */
export function readFormContent(formContent = []) {
  const spec = {
    prompt: false,
    negative_prompt: false,
    aspect_ratios: null,
    qualities: null,
    output_formats: null,
    max_references: 0,
    reference_types: null,
    max_reference_mb: null,
    durations: null,
    audio: false,
    fields: [],
    unknown_fields: [],
  };

  for (const entry of formContent || []) {
    const type = entry?.type || '';
    const p = entry?.props || {};
    const key = p.parameterKey;
    if (!key) { spec.unknown_fields.push(type); continue; }
    spec.fields.push({ key, type, required: !!p.required });

    const values = (list) => (list || []).map((o) => o?.value).filter((v) => v != null);

    // ☠ THE ORDER AND THE ANCHORS BOTH MATTER, and a test caught this before it
    // shipped: "duration" CONTAINS the letters r-a-t-i-o — duRATIOn — so a
    // loose /ratio/ claimed every video model's lengths as aspect ratios. The
    // most specific keys are matched first, and "ratio" only counts when it is
    // the whole word or the end of one.
    if (key === 'prompt') spec.prompt = true;
    else if (/negative/i.test(key)) spec.negative_prompt = true;
    else if (/duration|^length$/i.test(key)) spec.durations = values(p.radioOptions || p.selectOption);
    else if (/audio|sound/i.test(key)) spec.audio = true;
    else if (/aspect/i.test(key) || /(^|_)ratio$/i.test(key)) spec.aspect_ratios = values(p.selectOption || p.radioOptions);
    else if (/resolution|^quality$/i.test(key)) spec.qualities = values(p.radioOptions || p.selectOption);
    else if (/(^|_)format$/i.test(key)) spec.output_formats = values(p.radioOptions || p.selectOption);
    else if (type === 'PlaygroundFileUpload') {
      // ☠ THIS IS THE FIELD THAT BIT HIM. How many references a model takes was
      // buried in a `.slice(0, N)` in the request builder, so four images went
      // to a model that uses one and three vanished without a word (#112).
      // kie states it here: `multiple` plus, sometimes, an explicit maximum.
      const max = Number(p.maxFiles || p.maxCount || 0);
      spec.max_references = max > 0 ? max : (p.multiple ? -1 : 1);   // -1 = several, count not stated
      spec.reference_types = p.acceptedFileTypes || null;
      spec.max_reference_mb = Number(p.maxFileSize) || null;
    }
  }
  return spec;
}

/**
 * Read one model. Returns { ok, spec } or { ok: false, reason } — and the
 * reason is written onto the row for Amr to see, never swallowed.
 */
export async function readKieModel(path, { fetchImpl = fetch } = {}) {
  if (!path) return { ok: false, reason: 'no kie path recorded for this model' };
  let html;
  try {
    const res = await fetchImpl(PAGE(path), { headers: { 'User-Agent': 'voxel-model-reader' } });
    if (!res.ok) return { ok: false, reason: `kie's page for "${path}" replied ${res.status}` };
    html = await res.text();
  } catch (e) {
    return { ok: false, reason: `could not reach kie's page for "${path}": ${e?.message || e}` };
  }

  const data = extractNextData(html);
  if (!data) return { ok: false, reason: `kie's page for "${path}" carried no readable data` };

  const group = data?.props?.pageProps?.pageData?.groupData?.[0];
  if (!group) return { ok: false, reason: `kie's page for "${path}" has no model on it` };

  const formContent = group?.playgroundData?.formContent;
  if (!Array.isArray(formContent) || !formContent.length) {
    // The page loaded and the model exists, but its parameters are not
    // published in a form we can read. That is a REAL answer and it must be
    // shown as one — not silently treated as "no parameters".
    return {
      ok: false,
      reason: `kie publishes no parameter list for "${path}" — its options cannot be confirmed from here`,
      partial: { kie_model: group.model || null, api_doc_url: group.apiDocumentUrl || null },
    };
  }

  return {
    ok: true,
    spec: {
      kie_model: group.model || path,
      api_doc_url: group.apiDocumentUrl || null,
      // Left as kie's own words on purpose. It reads "18 credits (~$0.09) for
      // 1K/2K and 24 credits (~$0.12) for 4K" — a price PER TIER, which is why
      // Amr sets the number rather than accepting one I computed.
      pricing_text: group.pricingDesc || null,
      provider: group.provider || null,
      ...readFormContent(formContent),
    },
  };
}

/** One sentence for the row, so the tab can say what was found without opening it. */
export function describeSpec(spec) {
  if (!spec) return null;
  const bits = [];
  if (spec.max_references === -1) bits.push('several reference images');
  else if (spec.max_references > 0) bits.push(`${spec.max_references} reference image${spec.max_references === 1 ? '' : 's'}`);
  else bits.push('no reference images');
  if (spec.aspect_ratios?.length) bits.push(`${spec.aspect_ratios.length} aspect ratios`);
  if (spec.qualities?.length) bits.push(spec.qualities.join('/'));
  if (spec.durations?.length) bits.push(`${spec.durations.length} lengths`);
  bits.push(spec.negative_prompt ? 'negative prompt' : 'no negative prompt');
  return bits.join(' · ');
}
