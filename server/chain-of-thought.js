// ═══════════════════════════════════════════════════════════════
// KelionAI — Chain-of-Thought (CoT) Module
// Shows AI reasoning steps when enabled
// ═══════════════════════════════════════════════════════════════
'use strict';

let cotEnabled = false;

function isEnabled() {
  return cotEnabled;
}
function toggle(val) {
  cotEnabled = typeof val === 'boolean' ? val : !cotEnabled;
  return cotEnabled;
}

/**
 * Wraps a system prompt with CoT instructions when enabled
 * @param {string} systemPrompt - The original system prompt
 * @returns {string} Enhanced prompt with CoT instructions
 */
function enhancePrompt(systemPrompt) {
  if (!cotEnabled) return systemPrompt;
  return (
    systemPrompt +
    `

[CHAIN OF THOUGHT MODE ACTIVE]
Before giving your final answer, show your reasoning process in a collapsible section.
Format your response like this:

<details>
<summary>🧠 Thinking process...</summary>

- Step 1: [your first reasoning step]
- Step 2: [your analysis]
- Step 3: [your conclusion logic]

</details>

Then provide your final answer below the thinking section.
This helps the user understand HOW you reached your conclusion.`
  );
}

/**
 * Strips CoT markers from a response if CoT is disabled
 * @param {string} response - The AI response
 * @returns {string} Clean response
 */
function cleanResponse(response) {
  if (cotEnabled) return response; // Keep CoT visible
  // Strip <details> blocks if they leaked through
  return response.replace(/<details>[\s\S]*?<\/details>/gi, '').trim();
}

module.exports = { isEnabled, toggle, enhancePrompt, cleanResponse };
