// CLIP embedder (OpenAI's CLIP ViT-B/32, run locally through
// transformers.js / ONNX Runtime). Unlike the classic features it
// understands content: a serif poster and a serif book cover land near each
// other even with different colours, and text can be compared with images,
// which is what makes "search by description" and zero-shot tags possible.
//
// It is opt-in (AI_EMBEDDER=clip) because it needs the optional
// @huggingface/transformers package, downloads roughly 350MB of model
// weights on first use and wants about 1GB of RAM. Nothing is sent to a
// third party: the model runs in this process.
import sharp from 'sharp';
import { config } from '../../../config.js';
import { SHARP_OPTIONS } from '../../analysis.js';
import { TAG_VOCABULARY } from '../vocabulary.js';

let loading = null;

async function load() {
  if (!loading) {
    loading = (async () => {
      let tf;
      try {
        tf = await import('@huggingface/transformers');
      } catch {
        throw new Error(
          'AI_EMBEDDER=clip needs the optional package. Run: npm install @huggingface/transformers (in backend/).'
        );
      }
      const model = config.ai.clipModel;
      const [processor, vision, tokenizer, textModel] = await Promise.all([
        tf.AutoProcessor.from_pretrained(model),
        tf.CLIPVisionModelWithProjection.from_pretrained(model),
        tf.AutoTokenizer.from_pretrained(model),
        tf.CLIPTextModelWithProjection.from_pretrained(model),
      ]);
      return { tf, processor, vision, tokenizer, textModel };
    })();
    loading.catch(() => {
      loading = null; // allow a retry after a failed download
    });
  }
  return loading;
}

function normalise(data) {
  const vector = Float32Array.from(data);
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

async function embedImage(buffer) {
  const { tf, processor, vision } = await load();
  // Decode with sharp (same limits as everywhere else) and hand CLIP plain
  // RGB pixels, rather than letting the library fetch or decode anything.
  const { data, info } = await sharp(buffer, SHARP_OPTIONS)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(336, 336, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image = new tf.RawImage(new Uint8ClampedArray(data), info.width, info.height, 3);
  const inputs = await processor(image);
  const { image_embeds } = await vision(inputs);
  return normalise(image_embeds.data);
}

async function embedTexts(texts) {
  const { tokenizer, textModel } = await load();
  const inputs = tokenizer(texts, { padding: true, truncation: true });
  const { text_embeds } = await textModel(inputs);
  const dims = text_embeds.dims[1];
  return texts.map((_, i) => normalise(text_embeds.data.slice(i * dims, (i + 1) * dims)));
}

let vocabularyVectors = null;

// Zero-shot tags: compare the image with a sentence for every word in the
// vocabulary and keep the few that stand clearly above the rest.
async function suggestTags(imageVector, { max = 3, minProbability = 0.12 } = {}) {
  if (!vocabularyVectors) vocabularyVectors = await embedTexts(TAG_VOCABULARY.map(([, sentence]) => sentence));
  const logits = vocabularyVectors.map((v) => {
    let dot = 0;
    for (let i = 0; i < v.length; i++) dot += v[i] * imageVector[i];
    return dot * 100; // CLIP's learned temperature
  });
  const maxLogit = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - maxLogit));
  const total = exps.reduce((a, b) => a + b, 0);
  return exps
    .map((e, i) => ({ tag: TAG_VOCABULARY[i][0], p: e / total }))
    .filter((t) => t.p >= minProbability)
    .sort((a, b) => b.p - a.p)
    .slice(0, max)
    .map((t) => t.tag);
}

export const clipEmbedder = {
  name: 'clip-vit-b32',
  semantic: true,
  embedImage,
  async embedText(text) {
    return (await embedTexts([text]))[0];
  },
  suggestTags,
  load,
};
