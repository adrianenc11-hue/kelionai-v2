'use strict';

/**
 * F11 — unit tests for the Pollinations.ai image-generation helper.
 */

function freshService() {
  jest.resetModules();
  return require('../src/services/imageGen');
}

describe('imageGen.generateImage (Pollinations.ai)', () => {
  it('rejects empty prompt', async () => {
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: '   ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Missing prompt/);
  });

  it('returns a pollinations URL for a valid prompt', async () => {
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: 'a calm sunset over the sea' });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^https:\/\/image\.pollinations\.ai\/prompt\/a%20calm%20sunset/);
    expect(r.title).toBe('a calm sunset over the sea');
    expect(r.prompt).toBe('a calm sunset over the sea');
    expect(r.model).toBe('pollinations-flux');
  });

  it('parses size into width and height', async () => {
    const { generateImage } = freshService();
    const r = await generateImage({ prompt: 'dog', size: '800x600' });
    expect(r.ok).toBe(true);
    expect(r.url).toContain('width=800');
    expect(r.url).toContain('height=600');
  });
});

describe('realTools.toolGenerateImage dispatch', () => {
  it('executeRealTool("generate_image") routes through toolGenerateImage and returns pollinations URL', async () => {
    jest.resetModules();
    const { executeRealTool, REAL_TOOL_NAMES } = require('../src/services/realTools');
    expect(REAL_TOOL_NAMES).toContain('generate_image');
    const r = await executeRealTool('generate_image', { prompt: 'castle' });
    expect(r.ok).toBe(true);
    expect(r.url).toMatch(/^https:\/\/image\.pollinations\.ai/);
  });
});
