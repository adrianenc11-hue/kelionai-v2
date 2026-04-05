import { invokeLLM } from "./_core/llm";

/**
 * AGI Decision Engine
 * Processes camera input and makes autonomous decisions for avatars
 */

export interface Decision {
  action: "speak" | "listen" | "react" | "analyze" | "alert" | "teach" | "help";
  priority: "critical" | "high" | "normal" | "low";
  content?: string;
  emotion?: string;
  gesture?: string;
  alert?: string;
  reasoning: string;
}

export class AGIDecisionEngine {
  private decisionHistory: Decision[] = [];

  /**
   * Make a decision based on context
   */
  async makeDecision(context: {
    userState: any;
    conversationHistory: Array<{ role: string; content: string }>;
    currentEmotion: string;
  }): Promise<Decision> {
    try {
      const decision = await this.generateDecision(context);
      this.decisionHistory.push(decision);
      return decision;
    } catch (error) {
      console.error("[AGI Decision Engine] Error making decision:", error);
      return {
        action: "listen",
        priority: "normal",
        emotion: "neutral",
        reasoning: "Error in decision making, entering listen mode",
      };
    }
  }

  /**
   * Generate decision using LLM
   */
  private async generateDecision(context: any): Promise<Decision> {
    const prompt = `You are an AGI avatar making real-time decisions.

Current Situation:
- User emotion: ${context.userState?.emotion || "neutral"}
- Current emotion: ${context.currentEmotion}
- Recent messages: ${context.conversationHistory.slice(-2).map((m: any) => `${m.role}: ${m.content}`).join(" | ")}

Choose ONE action:
1. "speak" - Respond to user
2. "listen" - Wait and listen
3. "react" - React to user's emotion
4. "analyze" - Analyze something
5. "alert" - Alert about something
6. "teach" - Teach something
7. "help" - Offer help

Respond ONLY with JSON:
{
  "action": "speak|listen|react|analyze|alert|teach|help",
  "priority": "critical|high|normal|low",
  "content": "what to say if speaking",
  "emotion": "neutral|happy|sad|thinking|excited|confused",
  "gesture": "gesture description",
  "alert": "alert message if applicable",
  "reasoning": "why you made this decision"
}`;

    try {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "You are an autonomous AGI avatar. Respond only with valid JSON.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      const msgContent = response.choices[0]?.message.content;
      const content = typeof msgContent === "string" ? msgContent : "";

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("[AGI Decision Engine] Error parsing decision:", error);
    }

    return {
      action: "listen",
      priority: "normal",
      emotion: "neutral",
      reasoning: "Default listen mode",
    };
  }

  /**
   * Get decision history
   */
  getDecisionHistory(): Decision[] {
    return this.decisionHistory;
  }

  /**
   * Clear decision history
   */
  clearDecisionHistory(): void {
    this.decisionHistory = [];
  }
}

export default AGIDecisionEngine;
