'use strict';

const { smartFetch } = require('./modelRouter');

/**
 * Swarm Expert — Multi-agent orchestration for heavy/premium tasks.
 * Pattern: 1 to X agents depending on complexity and credits.
 * 
 * Flow: ARCHITECT → EXECUTORS → REVIEWER
 */

async function runSwarmTask(task, context = {}, creditsBalance = 0, tools = undefined) {
  console.log(`[swarm] Initiating swarm for task: "${task.slice(0, 50)}..."`);
  
  // 1. The ARCHITECT — Planning the execution
  const architectPrompt = `
    You are the Kelion Swarm Architect. Your goal is to break down a complex task into a set of precise execution steps.
    
    TASK: ${task}
    CONTEXT: ${JSON.stringify(context)}
    
    Break this down into 1-3 clear sub-tasks for specialized agents.
    Output ONLY a JSON array of tasks: ["task 1", "task 2", ...]
  `;

  const architectResult = await smartFetch('coder', {
    messages: [{ role: 'system', content: architectPrompt }],
    temperature: 0.2
  }, true); // Always HEAVY for Architect

  let subTasks = [];
  try {
    const raw = await architectResult.response.json();
    const content = raw.choices[0].message.content;
    subTasks = JSON.parse(content.match(/\[.*\]/s)[0]);
  } catch (err) {
    console.error('[swarm] Architect failed to plan:', err.message);
    subTasks = [task]; // Fallback to single task
  }

  // 2. The EXECUTORS — Parallel execution
  console.log(`[swarm] Dispatching ${subTasks.length} sub-tasks to executors...`);
  const executorResults = await Promise.all(subTasks.map(async (st, i) => {
    const executorPrompt = `Specialized Agent ${i+1}. Perform sub-task: ${st}. Context: ${task}.
    If you need to use tools, call them. You have full workspace access.`;
    
    // Admin always gets the heaviest models for all agents. 
    // Otherwise, depends on credits.
    const useHeavyExecutor = (creditsBalance > 500); 

    const result = await smartFetch('coder', {
      messages: [{ role: 'system', content: executorPrompt }],
      tools: tools,
      temperature: 0.5
    }, useHeavyExecutor);
    const json = await result.response.json();
    const choice = json.choices[0];
    
    if (choice.message.tool_calls) {
      const { executeRealTool } = require('./realTools');
      console.log(`[swarm] Executor ${i+1} calling ${choice.message.tool_calls.length} tools...`);
      
      const toolResults = await Promise.all(choice.message.tool_calls.map(async (tc) => {
        const r = await executeRealTool(tc.function.name, JSON.parse(tc.function.arguments || '{}'), context);
        return `Tool ${tc.function.name} output: ${JSON.stringify(r)}`;
      }));
      
      return `Agent ${i+1} executed tools and got: ${toolResults.join('\n')}\nContent: ${choice.message.content || ''}`;
    }
    return choice.message.content || '[No output]';
  }));

  // 3. The REVIEWER — Synthesis and Verification
  console.log(`[swarm] Synthesizing results...`);
  const reviewerPrompt = `
    You are the Kelion Swarm Reviewer. Combine the following agent outputs into a final, high-quality response.
    Verify correctness and ensure it meets the original user intent.
    
    ORIGINAL TASK: ${task}
    AGENT OUTPUTS:
    ${executorResults.map((r, i) => `Agent ${i+1}: ${r}`).join('\n\n')}
    
    FINAL RESPONSE:
  `;

  const finalResult = await smartFetch('coder', {
    messages: [{ role: 'system', content: reviewerPrompt }],
    tools: tools,
    tool_choice: tools ? 'auto' : undefined,
    temperature: 0.3
  }, true); // Always HEAVY for Reviewer

  const finalJson = await finalResult.response.json();
  const choice = finalJson.choices?.[0];
  
  return {
    ok: true,
    reply: choice?.message?.content || '',
    toolCalls: choice?.message?.tool_calls,
    agentsUsed: subTasks.length + 2,
    plan: subTasks
  };
}

module.exports = { runSwarmTask };
