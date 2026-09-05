// ─── kie-model-reader.test.js ────────────────────────────────────────────────
// One rule above all the others: this must never invent a parameter.
//
// A guessed field produces a model that LOOKS configured and fails at generate
// time — after the credits are taken. "I could not read this" is the correct
// answer to an unreadable page, and Amr asked for it by name: "you must give
// me a message: I cannot read it, and it's not confirmed from my side."
//
// The fixture is kie's real nano-banana-pro page, saved 2026-09-05, so these
// assertions are against what kie actually publishes rather than a shape I
// imagined.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readKieModel, readFormContent, extractNextData, describeSpec } from './kie-model-reader.js';

const FIXTURE = readFileSync(
  path.resolve(process.cwd(), 'server/src/__fixtures__/kie-nano-banana-pro.html'), 'utf8',
);
const serving = (html, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, text: async () => html });

describe('reading a real kie page', () => {
  it('reads nano-banana-pro exactly as kie publishes it', async () => {
    const r = await readKieModel('nano-banana-pro', { fetchImpl: serving(FIXTURE) });
    expect(r.ok).toBe(true);
    expect(r.spec.kie_model).toBe('nano-banana-pro');
    expect(r.spec.aspect_ratios).toContain('16:9');
    expect(r.spec.aspect_ratios).toContain('auto');
    expect(r.spec.qualities).toEqual(['1K', '2K', '4K']);
    expect(r.spec.prompt).toBe(true);
    expect(r.spec.negative_prompt).toBe(false);
  });

  it('captures the reference-image rules — the field that caused #112', async () => {
    // How many references a model takes was buried in a .slice(0, N) in the
    // request builder, so four images went to a model that uses one and three
    // vanished with no message. kie states it; now we store it.
    const { spec } = await readKieModel('nano-banana-pro', { fetchImpl: serving(FIXTURE) });
    expect(spec.max_references).toBe(-1);          // several, count not stated
    expect(spec.reference_types).toContain('image/png');
    expect(spec.max_reference_mb).toBe(30);
  });

  it('keeps the API document link and kie\'s own pricing words', async () => {
    const { spec } = await readKieModel('nano-banana-pro', { fetchImpl: serving(FIXTURE) });
    expect(spec.api_doc_url).toContain('docs.kie.ai');
    // "18 credits (~$0.09) for 1K/2K and 24 credits (~$0.12) for 4K" — a price
    // PER TIER, which is why Amr sets the number rather than taking mine.
    expect(spec.pricing_text).toMatch(/1K\/2K/);
    expect(spec.pricing_text).toMatch(/4K/);
  });

  it('summarises the row in one line', async () => {
    const { spec } = await readKieModel('nano-banana-pro', { fetchImpl: serving(FIXTURE) });
    const line = describeSpec(spec);
    expect(line).toContain('several reference images');
    expect(line).toContain('1K/2K/4K');
    expect(line).toContain('no negative prompt');
  });
});

describe('☠ it says "I cannot read this" rather than inventing anything', () => {
  it('a page that will not load', async () => {
    const r = await readKieModel('gone', { fetchImpl: serving('', false, 404) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('404');
    expect(r.spec).toBeUndefined();
  });

  it('a network failure', async () => {
    const r = await readKieModel('x', { fetchImpl: vi.fn().mockRejectedValue(new Error('timeout')) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('timeout');
  });

  it('a page with no data blob at all', async () => {
    const r = await readKieModel('x', { fetchImpl: serving('<html><body>hello</body></html>') });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no readable data');
  });

  it('☠ a page that loads but publishes NO parameter list', async () => {
    // The hardest case to get right: the model exists and the page is fine, so
    // the temptation is to record "no parameters". That is a claim, and a wrong
    // one. It is an unreadable model, and the row must say so.
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { pageData: { groupData: [{ model: 'quiet', apiDocumentUrl: 'https://docs.kie.ai/x', playgroundData: {} }] } } },
    })}</script>`;
    const r = await readKieModel('quiet', { fetchImpl: serving(html) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('cannot be confirmed');
    // What little it DID learn is still handed back, rather than thrown away.
    expect(r.partial.api_doc_url).toContain('docs.kie.ai');
  });

  it('no path recorded at all', async () => {
    const r = await readKieModel('', { fetchImpl: serving(FIXTURE) });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('no kie path');
  });

  it('never returns a spec when it failed', async () => {
    for (const f of [serving('', false, 500), serving('<html></html>'), vi.fn().mockRejectedValue(new Error('x'))]) {
      const r = await readKieModel('p', { fetchImpl: f });
      expect(r.ok).toBe(false);
      expect(r.spec, 'a failed read must carry NO spec — a half-read model is the dangerous one')
        .toBeUndefined();
    }
  });
});

describe('readFormContent', () => {
  it('records a field it does not recognise instead of dropping it', () => {
    // An unrecognised field is a REASON TO LOOK, not something to discard —
    // it may be the one that makes the model behave differently.
    const spec = readFormContent([
      { type: 'PlaygroundMystery', props: {} },
      { type: 'PlaygroundTextarea', props: { parameterKey: 'prompt' } },
    ]);
    expect(spec.unknown_fields).toContain('PlaygroundMystery');
    expect(spec.prompt).toBe(true);
  });

  it('a single-file upload means exactly one reference', () => {
    const spec = readFormContent([
      { type: 'PlaygroundFileUpload', props: { parameterKey: 'image', multiple: false } },
    ]);
    expect(spec.max_references).toBe(1);
  });

  it('an explicit maximum beats the multiple flag', () => {
    const spec = readFormContent([
      { type: 'PlaygroundFileUpload', props: { parameterKey: 'image', multiple: true, maxFiles: 8 } },
    ]);
    expect(spec.max_references).toBe(8);
  });

  it('finds a negative prompt when the model has one', () => {
    const spec = readFormContent([
      { type: 'PlaygroundTextarea', props: { parameterKey: 'negative_prompt' } },
    ]);
    expect(spec.negative_prompt).toBe(true);
  });

  it('reads video length and audio', () => {
    const spec = readFormContent([
      { type: 'PlaygroundRadio', props: { parameterKey: 'duration', radioOptions: [{ value: '5' }, { value: '10' }] } },
      { type: 'PlaygroundRadio', props: { parameterKey: 'audio', radioOptions: [{ value: 'on' }] } },
    ]);
    expect(spec.durations).toEqual(['5', '10']);
    expect(spec.audio).toBe(true);
  });

  it('survives rubbish input', () => {
    expect(readFormContent(null).fields).toEqual([]);
    expect(readFormContent([null, {}]).unknown_fields.length).toBeGreaterThan(0);
  });
});

describe('extractNextData', () => {
  it('returns null on unparseable JSON rather than throwing', () => {
    expect(extractNextData('<script id="__NEXT_DATA__">{ nope</script>')).toBe(null);
    expect(extractNextData('nothing here')).toBe(null);
  });
});

// ─── THE SUBSTRING TRAP ─────────────────────────────────────────────────────
// ☠ "duration" contains the letters r-a-t-i-o. A loose /ratio/ match recorded
// every video model's LENGTHS as its aspect ratios — a model that looked
// configured and would have generated at the wrong shape. Caught by a test
// before it shipped, which is the only reason it is not in production.
describe('keys that contain other keys', () => {
  it('duration is a duration, not an aspect ratio', () => {
    const spec = readFormContent([
      { type: 'PlaygroundRadio', props: { parameterKey: 'duration', radioOptions: [{ value: '5' }, { value: '10' }] } },
    ]);
    expect(spec.durations).toEqual(['5', '10']);
    expect(spec.aspect_ratios, 'duration must NOT be read as a ratio').toBe(null);
  });

  it('aspect_ratio is still an aspect ratio', () => {
    const spec = readFormContent([
      { type: 'PlaygroundSelect', props: { parameterKey: 'aspect_ratio', selectOption: [{ value: '16:9' }] } },
    ]);
    expect(spec.aspect_ratios).toEqual(['16:9']);
    expect(spec.durations).toBe(null);
  });

  it('a bare "ratio" key still counts', () => {
    const spec = readFormContent([
      { type: 'PlaygroundSelect', props: { parameterKey: 'ratio', selectOption: [{ value: '1:1' }] } },
    ]);
    expect(spec.aspect_ratios).toEqual(['1:1']);
  });

  it('output_format is a format, and does not swallow other keys', () => {
    const spec = readFormContent([
      { type: 'PlaygroundRadio', props: { parameterKey: 'output_format', radioOptions: [{ value: 'png' }] } },
      { type: 'PlaygroundRadio', props: { parameterKey: 'duration', radioOptions: [{ value: '8' }] } },
    ]);
    expect(spec.output_formats).toEqual(['png']);
    expect(spec.durations).toEqual(['8']);
  });
});
