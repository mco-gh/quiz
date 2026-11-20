// Quiz writing with Anthropic's Claude, called straight from the host's
// browser with the host's own API key. There is no server in between: the key
// and the topic go only to Anthropic. The SDK is bundled into vendor/ (see
// build/) and only downloaded when the host first asks for a quiz.
//
// The prompt descends from Quizaic's: give the model a role, the quiz
// parameters as a list, and a short set of rules. Instead of asking for "just
// the JSON" and digging it out of the reply, we ask for structured output, so
// the reply always parses into exactly the shape we need.
//
// Checking follows Quizaic's accuracy work: every multiple-choice question is
// one truth and three lies, so we split each question into one assertion per
// answer, shuffle all of them together (so related assertions don't sit side
// by side), and ask the model to judge each one on its own. A question is
// flagged when its correct answer is judged false or a wrong answer judged
// true. The host then fixes or replaces it.

export const MODEL = 'claude-opus-5-5';
export const KEY_URL = 'https://platform.claude.com/settings/keys';
export const ANSWERS = 4;

export class AiError extends Error {
  // kind: 'badkey' | 'credit' | 'quota' | 'network' | 'blocked' | 'bad'
  constructor(kind, detail) { super(detail || kind); this.kind = kind; }
}

let sdk = null;
const loadSdk = () => (sdk ??= import('./vendor/anthropic.js'));

const LEVELS = {
  easy: 'easy: well-known facts most people would get right',
  medium: 'medium: a typical pub-quiz level',
  hard: 'hard: for enthusiasts; specific details, but still fair and verifiable',
};

const SYSTEM = 'You are a trivia expert who writes accurate, fun multiple choice quizzes for groups playing together.';

const RULES = `RULES:
- Accuracy is critical. Only use facts you are certain of.
- Each question must have exactly ${ANSWERS} responses and exactly one correct response, copied exactly from the responses array.
- Wrong responses must be plausible but clearly wrong. Never use "all of the above" or "none of the above".
- Don't give the answer away in the question. Don't repeat questions.
- Keep questions under 140 characters and responses under 50 characters.
- Write everything in the quiz language, but keep proper names as they are usually written in that language.`;

/** Ask Claude for an object matching a Zod schema. */
async function ask(apiKey, { prompt, schema, effort = 'high' }) {
  const { Anthropic, betaZodOutputFormat, z } = await loadSdk();
  // dangerouslyAllowBrowser: the SDK refuses to run in a page by default, because a
  // key shipped with a site is exposed to every visitor. Here the key is the
  // host's own, typed in by them, so the usual objection does not apply.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let response;
  try {
    response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort, format: betaZodOutputFormat(schema(z)) },
      // If the model declines a request for policy reasons, let the API retry it
      // on its default fallback model instead of failing.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new AiError('badkey', error.message);
    if (error instanceof Anthropic.RateLimitError) throw new AiError('quota', error.message);
    if (error instanceof Anthropic.BadRequestError && /credit balance/i.test(error.message)) throw new AiError('credit', error.message);
    if (error instanceof Anthropic.APIConnectionError) throw new AiError('network', error.message);
    if (error instanceof Anthropic.APIError) throw new AiError('bad', error.message);
    throw error;
  }
  if (response.stop_reason === 'refusal') throw new AiError('blocked');
  if (response.stop_reason === 'max_tokens' || !response.parsed_output) throw new AiError('bad', 'Unreadable reply');
  return response.parsed_output;
}

const question = (z) => z.object({
  question: z.string(),
  responses: z.array(z.string()),
  correct: z.string().describe('The correct response, copied exactly from responses.'),
});

const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** Turn the model's question into ours: { q, a: [4 strings], c: index }, answers shuffled. */
function tidy(raw) {
  const q = clean(raw?.question);
  const responses = (raw?.responses ?? []).map(clean).filter(Boolean);
  const correct = clean(raw?.correct);
  if (!q || responses.length !== ANSWERS || new Set(responses).size !== ANSWERS) return null;
  let c = responses.indexOf(correct);
  if (c < 0) c = responses.findIndex((r) => r.toLowerCase() === correct.toLowerCase());
  if (c < 0) return null;
  // Deal the answers again so the right one isn't always in the same place.
  const order = shuffle([0, 1, 2, 3]);
  return { q, a: order.map((i) => responses[i]), c: order.indexOf(c) };
}

/**
 * Write a quiz. Returns { title, emoji, questions: [{ q, a, c }] }.
 * language is the language's English name, e.g. "French".
 */
export async function writeQuiz({ apiKey, topic, difficulty, count, language }) {
  const prompt = `Generate a multiple choice trivia quiz.

Topic: ${topic}
Quiz difficulty level: ${LEVELS[difficulty] ?? LEVELS.medium}
Number of questions: ${count}
Number of responses per question: ${ANSWERS}
Quiz language: ${language}

Also give the quiz a short, fun title (at most 40 characters, in the quiz language) and one emoji that suits the topic.

${RULES}`;
  const raw = await ask(apiKey, {
    prompt,
    schema: (z) => z.object({ title: z.string(), emoji: z.string(), questions: z.array(question(z)) }),
  });
  const questions = (raw.questions ?? []).map(tidy).filter(Boolean).slice(0, count);
  if (!questions.length) throw new AiError('bad', 'No usable questions');
  return { title: clean(raw.title).slice(0, 60) || topic, emoji: [...clean(raw.emoji)].slice(0, 2).join('') || '❓', questions };
}

/** Write one new question on the topic, different from those listed. */
export async function writeQuestion({ apiKey, topic, difficulty, language, avoid }) {
  const prompt = `Write one new multiple choice trivia question.

Topic: ${topic}
Quiz difficulty level: ${LEVELS[difficulty] ?? LEVELS.medium}
Number of responses: ${ANSWERS}
Quiz language: ${language}

It must be different from these questions, which are already in the quiz:
${avoid.map((q) => `- ${q}`).join('\n')}

${RULES}`;
  for (let tries = 0; tries < 2; tries++) {
    const fresh = tidy(await ask(apiKey, { prompt, schema: question }));
    if (fresh) return fresh;
  }
  throw new AiError('bad', 'No usable question');
}

/**
 * Check a quiz's answers. Returns the indexes of questions that look wrong.
 * Each question becomes one assertion per answer; all are shuffled and judged
 * independently.
 */
export async function checkQuiz({ apiKey, questions }) {
  const claims = shuffle(questions.flatMap((q, qi) =>
    q.a.map((answer, ai) => ({ qi, truth: ai === q.c, text: `Question: ${q.q} Answer: ${answer}` }))));
  const numbered = claims.map((claim, i) => `${i + 1}. ${claim.text}`).join('\n');
  const prompt = `You are a meticulous fact checker. Each numbered line below pairs a trivia question with a proposed answer. For each line, decide whether the proposed answer is a correct answer to its question. Judge every line on its own. If a line is ambiguous or you are unsure, mark it false.

${numbered}

Return one verdict for every line, using the line numbers.`;
  const raw = await ask(apiKey, {
    prompt,
    schema: (z) => z.object({ verdicts: z.array(z.object({ line: z.number().int(), correct: z.boolean() })) }),
  });
  const flagged = new Set();
  for (const verdict of raw.verdicts ?? []) {
    const claim = claims[verdict.line - 1];
    if (claim && verdict.correct !== claim.truth) flagged.add(claim.qi);
  }
  return [...flagged].sort((a, b) => a - b);
}
