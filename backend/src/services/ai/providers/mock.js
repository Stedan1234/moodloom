// A stand-in language model for automated tests and offline demos. It
// returns a well-formed direction built only from what it was sent, so the
// whole pipeline (selection, prompt, parsing, validation, storage) can be
// exercised without a key or a network. It is refused in production by
// config.js, and anything it writes is labelled model "mock".
export const mockProvider = {
  name: 'mock',
  model: 'mock',
  lastRequest: null,
  async complete(request) {
    mockProvider.lastRequest = request;
    const ids = [...request.prompt.matchAll(/<reference id="(\d+)"/g)].map((m) => Number(m[1]));
    const colors = [...new Set([...request.prompt.matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0].toLowerCase()))];
    const half = Math.max(1, Math.ceil(ids.length / 2));
    const direction = {
      statement:
        'MOCK OUTPUT. A quiet, confident direction that lets a small set of strong references lead: restrained colour, deliberate type, generous space.',
      themes: [
        { name: 'Restraint first', description: 'Few elements, each given room. Mock theme built from the first half of the references.', evidence: ids.slice(0, half) },
        { name: 'One loud note', description: 'A single accent carries the energy. Mock theme built from the rest.', evidence: ids.slice(half).concat(99999999) },
      ],
      palette: { notes: 'Lead with the darkest and lightest shared colours; use the most saturated one sparingly.', colors: colors.slice(0, 4).concat('#123abc') },
      typography: 'One characterful display face against a plain text face.',
      imagery: 'Close crops, natural light, real texture.',
      tone_words: ['measured', 'warm', 'direct'],
      avoid: ['Stock gradients', 'More than one accent colour'],
      tensions: ['Some references are playful while the brief asks for calm.'],
      gaps: ['No references yet for motion or small-size use.'],
      next_steps: ['Pick the accent colour.', 'Sketch three layouts using only the first theme.'],
    };
    return { text: '```json\n' + JSON.stringify(direction, null, 2) + '\n```', usage: { input_tokens: 0, output_tokens: 0 }, model: 'mock' };
  },
};
