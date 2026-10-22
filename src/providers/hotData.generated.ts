// src/providers/hotData.generated.ts
// AUTO-GERADO por scripts/collect-hot.mjs — NÃO editar à mão.
// Popularidade ("hot") por padrão de id de modelo (0..1).
//   OPEN  = HuggingFace (downloads + trending, dado REAL)
//   CLOSED = baseline curado (gpt/claude/gemini não têm API pública de uso)
// Atualiza semanal: `node scripts/collect-hot.mjs` + commit se houver diff.

/** [padrão (string de RegExp), score 0..1]. O dataCollect pega o MAIOR score
 *  entre todos os padrões que casam o id do modelo. */
export const HOT_DATA: [string, number][] = [
  ["claude-(fable|opus|sonnet)", 0.96],
  ["(^|/)gpt-5", 0.95],
  ["(^|/)gpt-4o", 0.9],
  ["gemini-(3|2\\.5-(pro|flash))", 0.9],
  ["qwen", 0.85],
  ["deepseek", 0.82],
  ["(^|/)o[34](\\b|-)", 0.8],
  ["flux", 0.74],
  ["gemma", 0.73],
  ["(llama|meta-)", 0.72],
  ["claude-haiku", 0.72],
  ["(mistral|mixtral|codestral|pixtral|ministral)", 0.68],
  ["(stable-?diffusion|sdxl)", 0.66],
  ["(^|/)o1(\\b|-)", 0.65],
  ["(dall-e|gpt-image|nano-?banana|imagen)", 0.6],
  ["claude-3", 0.5],
  ["gemini-(1\\.5|2\\.0)", 0.5],
];
