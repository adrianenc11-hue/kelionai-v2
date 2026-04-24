'use strict';

// Smoke tests for the Vertex AI Gemini Live WebSocket proxy.
//
// We exercise the pure helpers (URL + project/location resolution)
// here. The full upgrade-handler path needs a live Vertex endpoint
// to be meaningful, so we leave that for a manual smoke step and
// focus on catching regressions in the env-wiring logic.

const { _internals } = require('../src/routes/vertexLiveProxy');

describe('vertexLiveProxy.resolveProjectAndLocation', () => {
  const savedEnv = {};
  const KEYS = [
    'GOOGLE_CLOUD_PROJECT',
    'GCP_PROJECT_ID',
    'VERTEX_PROJECT_ID',
    'GOOGLE_CLOUD_LOCATION',
    'VERTEX_LOCATION',
    'GCP_SERVICE_ACCOUNT_JSON',
  ];
  beforeEach(() => {
    KEYS.forEach((k) => { savedEnv[k] = process.env[k]; delete process.env[k]; });
  });
  afterEach(() => {
    KEYS.forEach((k) => {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    });
  });

  test('pulls project from GOOGLE_CLOUD_PROJECT when set', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'my-proj';
    const { project, location } = _internals.resolveProjectAndLocation();
    expect(project).toBe('my-proj');
    expect(location).toBe('us-central1');
  });

  test('falls back to service account JSON project_id', () => {
    process.env.GCP_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'from-sa' });
    const { project } = _internals.resolveProjectAndLocation();
    expect(project).toBe('from-sa');
  });

  test('explicit location env overrides default', () => {
    process.env.GOOGLE_CLOUD_PROJECT = 'x';
    process.env.GOOGLE_CLOUD_LOCATION = 'europe-west4';
    const { location } = _internals.resolveProjectAndLocation();
    expect(location).toBe('europe-west4');
  });

  test('missing project returns empty string (not undefined)', () => {
    const { project } = _internals.resolveProjectAndLocation();
    expect(project).toBe('');
  });
});

describe('vertexLiveProxy.buildUpstreamUrl', () => {
  test('points at the regional Vertex endpoint BidiGenerateContent path', () => {
    const url = _internals.buildUpstreamUrl('us-central1');
    expect(url).toBe(
      'wss://us-central1-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent',
    );
  });

  test('respects the location argument', () => {
    const url = _internals.buildUpstreamUrl('europe-west4');
    expect(url.startsWith('wss://europe-west4-aiplatform.googleapis.com/')).toBe(true);
  });
});
