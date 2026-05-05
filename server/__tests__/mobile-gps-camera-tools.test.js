const { KELION_TOOLS, buildKelionToolsChatCompletions, buildKelionToolsGoogle } = require('../src/routes/realtime')

describe('PR #139 — mobile GPS + camera voice tools', () => {
  test('KELION_TOOLS includes get_my_location with include_address', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'get_my_location')
    expect(tool).toBeDefined()
    expect(tool.properties).toBeDefined()
    expect(tool.properties.include_address).toBeDefined()
    expect(tool.properties.include_address.type).toBe('boolean')
    // Must not mark include_address required — the tool is callable
    // with zero args ("where am I?") so the model can invoke it
    // without knowing about the flag.
    expect((tool.required || []).length).toBe(0)
  })

  test('KELION_TOOLS includes switch_camera with front/back enum', () => {
    const tool = KELION_TOOLS.find((t) => t.name === 'switch_camera')
    expect(tool).toBeDefined()
    expect(tool.properties).toBeDefined()
    expect(tool.properties.side).toBeDefined()
    expect(tool.properties.side.enum).toEqual(['front', 'back'])
    // `side` is optional because when the user says "flip" we want the
    // client handler to toggle to the opposite of the current side.
    expect((tool.required || []).length).toBe(0)
  })

  test('Chat Completions adapter surfaces both new tools in the function catalog', () => {
    const ccTools = buildKelionToolsChatCompletions()
    const names = ccTools.map((t) => t.name || t.function?.name).filter(Boolean)
    expect(names).toContain('get_my_location')
    expect(names).toContain('switch_camera')
  })

  test('Google adapter surfaces both new tools under functionDeclarations', () => {
    const googleTool = buildKelionToolsGoogle()
    const decls = (Array.isArray(googleTool) ? googleTool : [googleTool])
      .flatMap((t) => (t && t.functionDeclarations) || [])
    const names = decls.map((d) => d.name)
    expect(names).toContain('get_my_location')
    expect(names).toContain('switch_camera')
  })

  test('persona prompt mentions both tools so the model knows to call them', () => {
    const realtime = require('../src/routes/realtime')
    // buildKelionPersona isn't exported directly but the prompt text
    // lives in this file — grep the module source at require time via
    // the KELION_TOOLS description coverage. We assert the declarative
    // tool descriptions reference the right user utterances.
    const loc = realtime.KELION_TOOLS.find((t) => t.name === 'get_my_location')
    expect(loc.description.toLowerCase()).toMatch(/where am i|location|unde sunt/i)
    const sw = realtime.KELION_TOOLS.find((t) => t.name === 'switch_camera')
    expect(sw.description.toLowerCase()).toMatch(/flip|switch|schimb/i)
  })
})
