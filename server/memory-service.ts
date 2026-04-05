import { getUserMemories, saveUserMemory, deleteUserMemory, clearUserMemories } from "./db";
import { invokeLLM } from "./_core/llm";

export async function getMemoriesForContext(userId: number): Promise<string> {
  const memories = await getUserMemories(userId);
  if (!memories.length) return "";
  const lines = memories.map(m => `- ${m.key}: ${m.value}`).join("\n");
  return `\n\nWhat you know about this user:\n${lines}`;
}

export async function extractAndSaveMemories(userId: number, userMessage: string, aiResponse: string): Promise<void> {
  try {
    const result = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `Extract important facts about the user from this conversation. Return a JSON array of {key, value, importance} objects. importance: 1=low, 2=medium, 3=high. Only extract clear, factual information about the USER (not general info). Max 5 facts. If nothing important, return [].`,
        },
        {
          role: "user",
          content: `User said: "${userMessage}"\nAI responded: "${aiResponse.slice(0, 500)}"`,
        },
      ],
      responseFormat: { type: "json_object" },
    });

    const content = result.choices?.[0]?.message?.content as string;
    if (!content) return;

    let parsed: any;
    try { parsed = JSON.parse(content); } catch { return; }

    const facts: Array<{ key: string; value: string; importance?: number }> = 
      Array.isArray(parsed) ? parsed : (parsed.facts || parsed.memories || []);

    for (const fact of facts.slice(0, 5)) {
      if (fact.key && fact.value) {
        await saveUserMemory(userId, fact.key, fact.value, fact.importance || 1);
      }
    }
  } catch (e) {
    // Silent — memories are non-critical
  }
}

export { getUserMemories, saveUserMemory, deleteUserMemory, clearUserMemories };
