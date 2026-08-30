// ─── whisper-url.test.js ─────────────────────────────────────────────────────
// THE URL THE BROWSER ASKS FOR MUST BE A URL THE SERVER ANSWERS.
//
// ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
// Both halves were tested and both were green. The browser half asked for
// `/api/speech/model/whisper-tiny/config.json`, because transformers.js puts
// the model name in the path. The server half answered
// `/api/speech/model/config.json`. Neither test knew about the other, and I
// "verified it live" by curling the server's shape — seven 200s against a URL
// NO CLIENT EVER REQUESTS.
//
// Amr found it by pressing the button.
//
// So this test imports BOTH SIDES and joins them: it builds the url exactly as
// transformers.js does, from the real configured env, and hands the tail to
// the real server-side resolver. There is no fake in it. If either side moves,
// this fails.

import { describe, it, expect } from 'vitest';
import { configure, SOURCES } from './whisper.js';
import { keyForRequest } from '../../server/src/whisper-serve.js';
import { MODEL_FILES, keyFor } from '../../server/src/whisper-model.js';

/** The model id passed to pipeline() in loadTranscriber. */
const MODEL = 'whisper-tiny';

const fakeEnv = () => ({
  backends: { onnx: { wasm: {} } },
});

/**
 * Exactly how transformers.js assembles a file url:
 *   remoteHost + remotePathTemplate(with {model} filled) + '/' + file
 */
function urlFor(env, file) {
  const path = env.remotePathTemplate.replace('{model}', MODEL).replace('{revision}', 'main');
  return `${env.remoteHost}${path}/${file}`;
}

describe('☠ THE TWO HALVES MEET', () => {
  it('every file the browser asks OUR SERVER for is one our server serves', () => {
    const env = fakeEnv();
    configure({ source: SOURCES.origin, environment: env });
    // configure() reads window.location.origin; jsdom gives us one.
    for (const file of MODEL_FILES) {
      const url = urlFor(env, file);
      // What Express hands the route as `req.params.splat`, joined.
      const tail = url.split('/api/speech/model/')[1];
      expect(tail, `url was ${url}`).toBeTruthy();
      expect(keyForRequest(tail), `browser asked for ${url}`).toBe(keyFor(file));
    }
  });

  it('the url really does contain the model name — the thing I missed', () => {
    const env = fakeEnv();
    configure({ source: SOURCES.origin, environment: env });
    expect(urlFor(env, 'config.json')).toMatch(/\/api\/speech\/model\/whisper-tiny\/config\.json$/);
  });

  it('every file the browser asks THE BUCKET for is where installModel put it', () => {
    const env = fakeEnv();
    configure({ source: SOURCES.cdn, cdnBase: 'https://bucket.example', environment: env });
    for (const file of MODEL_FILES) {
      // uploadPublicAt stores at keyFor(file); the CDN serves <base>/<key>.
      expect(urlFor(env, file)).toBe(`https://bucket.example/${keyFor(file)}`);
    }
  });
});

describe('the allow-list still holds with the model name in the path', () => {
  it('a prefixed traversal is refused just the same', () => {
    expect(keyForRequest('whisper-tiny/../generations/x.png')).toBeNull();
    expect(keyForRequest('whisper-tiny/../../backups/db.sql.gz')).toBeNull();
    expect(keyForRequest('whisper-tiny/whisper-tiny/config.json')).toBeNull();
  });

  it('and a second model name cannot be smuggled in', () => {
    expect(keyForRequest('whisper-base/config.json')).toBeNull();
  });
});
