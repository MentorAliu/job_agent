import "server-only";

/**
 * How CV bullets and summaries are worded, shared by the CV builder and the
 * apply kit's tailoring so both write the same way: the result first, the
 * profile's numbers only, strong and varied verbs. Each line is one rule of
 * the prompts' "Rules:" list.
 */
export const CV_WRITING_RULES = `- Bullets: start with a strong action verb (present tense for the current role, past tense for the others). Lead with the result or the scale when the facts give one, then how it was done, such as "Cut checkout load time by 40% by moving rendering to the server". When the facts give no result, say what the candidate built, owned or led, and for whom or at what scale if the facts say.
- Numbers: only the ones the facts state, kept exact. Never estimate, round or turn a vague fact into a number, and no intensifiers such as "significantly" or "dramatically" that the facts don't back.
- Verbs: precise ones such as built, led, shipped, designed, migrated, automated, cut or mentored. No weak openers such as "helped", "worked on", "assisted", "was involved in", "participated in" or "responsible for", and no two bullets under one role starting with the same verb.
- Tools: where a fact names the tools behind a piece of work, name them in that bullet, such as "with React and TypeScript", so they read in context as well as in the skills list.
- Seniority: for a senior, lead or manager target, put the facts about ownership, architecture and technical decisions, leading or mentoring people and work across teams first, when the profile has them.
- In the CV: no total years of experience unless the profile states that number, no first person, and no filler such as "various", "a number of" or "etc.". No clichés such as "passionate", "results-driven", "team player" or "hard-working".`;
