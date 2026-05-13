'use strict';

const { smartFetch } = require('./modelRouter');

/**
 * Swarm Expert — Multi-agent orchestration for heavy/premium tasks.
 * Pattern: ARCHITECT → EXECUTORS → REVIEWER
 * 
 * FIX 2026-05-13: Added 30s timeout per agent to prevent infinite hangs.
 * Admin always uses heavy model (no credit gating for admin).
 */

const AGENT_TIMEOUT_MS = 120_000; // 120s max per agent call

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms))
  ]);
}

async function runSwarmTask(task, context = {}, creditsBalance = 0, tools = undefined) {
  console.log(`[swarm] Initiating swarm for task: "${task.slice(0, 80)}..."`);
  
  // 1. The ARCHITECT — Planning the execution
  const architectPrompt = `
    You are the Kelion Swarm Architect. Your goal is to break down a complex task into a set of precise execution steps.
    
    TASK: ${task}
    CONTEXT: ${JSON.stringify(context)}
    
    Break this down into 1-3 clear sub-tasks for specialized agents.
    Output ONLY a JSON array of tasks: ["task 1", "task 2", ...]
  `;

  let subTasks = [];
  try {
    const architectResult = await withTimeout(
      smartFetch('chat_heavy', { // Hermes 3 405B Uncensored
        messages: [{ role: 'system', content: architectPrompt }],
        temperature: 0.2,
        max_tokens: 512,
      }, true),
      AGENT_TIMEOUT_MS,
      'Architect'
    );
    const raw = await architectResult.response.json();
    const content = raw.choices[0].message.content;
    subTasks = JSON.parse(content.match(/\[.*\]/s)[0]);
  } catch (err) {
    console.error('[swarm] Architect failed:', err.message);
    subTasks = [task]; // Fallback to single task
  }

  // 2. The EXECUTORS — Parallel execution (with timeout per executor)
  console.log(`[swarm] Dispatching ${subTasks.length} sub-tasks to executors...`);
  const executorResults = await Promise.all(subTasks.map(async (st, i) => {
    const executorPrompt = `Specialized Agent ${i+1}. Perform sub-task: ${st}. Context: ${task}.
    If you need to use tools, call them. You have full workspace access.`;
    
    try {
      const result = await withTimeout(
        smartFetch('coder_heavy', { // Qwen 3 Coder Uncensored
          messages: [{ role: 'system', content: executorPrompt }],
          tools: tools,
          temperature: 0.5,
          max_tokens: 2048,
        }, true),
        AGENT_TIMEOUT_MS,
        `Executor ${i+1}`
      );
      const json = await result.response.json();
      const choice = json.choices[0];
      
      if (choice.message.tool_calls) {
        const { executeRealTool } = require('./realTools');
        console.log(`[swarm] Executor ${i+1} calling ${choice.message.tool_calls.length} tools...`);
        
        const toolResults = await Promise.all(choice.message.tool_calls.map(async (tc) => {
          try {
            const r = await withTimeout(
              executeRealTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'), context),
              60_000,
              `Tool ${tc.function.name}`
            );
            return `Tool ${tc.function.name} output: ${JSON.stringify(r)}`;
          } catch (toolErr) {
            return `Tool ${tc.function.name} failed: ${toolErr.message}`;
          }
        }));
        
        return `Agent ${i+1} executed tools and got: ${toolResults.join('\n')}\nContent: ${choice.message.content || ''}`;
      }
      return choice.message.content || '[No output]';
    } catch (err) {
      console.error(`[swarm] Executor ${i+1} failed:`, err.message);
      return `Agent ${i+1} failed: ${err.message}`;
    }
  }));

  // 3. The REVIEWER — Synthesis and Verification
  console.log(`[swarm] Synthesizing results...`);
  try {
    const reviewerPrompt = `
      You are the Kelion Swarm Reviewer. Combine the following agent outputs into a final, high-quality response.
      Verify correctness and ensure it meets the original user intent.
      
      ORIGINAL TASK: ${task}
      AGENT OUTPUTS:
      ${executorResults.map((r, i) => `Agent ${i+1}: ${r}`).join('\n\n')}
      
      FINAL RESPONSE:
    `;

    const finalResult = await withTimeout(
      smartFetch('chat', { // Dolphin Mistral Uncensored
        messages: [{ role: 'system', content: reviewerPrompt }],
        tools: tools,
        tool_choice: tools ? 'auto' : undefined,
        temperature: 0.3,
        max_tokens: 4096,
      }, true),
      AGENT_TIMEOUT_MS,
      'Reviewer'
    );

    const finalJson = await finalResult.response.json();
    const choice = finalJson.choices?.[0];
    
    return {
      ok: true,
      reply: choice?.message?.content || '',
      toolCalls: choice?.message?.tool_calls,
      agentsUsed: subTasks.length + 2,
      plan: subTasks
    };
  } catch (err) {
    console.error('[swarm] Reviewer failed:', err.message);
    // Return whatever the executors produced
    return {
      ok: true,
      reply: executorResults.join('\n\n---\n\n'),
      toolCalls: undefined,
      agentsUsed: subTasks.length + 1,
      plan: subTasks
    };
  }
}

module.exports = { runSwarmTask };
