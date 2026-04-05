import { invokeLLM } from "./_core/llm";
import axios from "axios";

/**
 * AGI Brain System for Kelion and Kira
 * Autonomous agents with memory, learning, and universal capabilities
 */

export interface AgentMemory {
  id: string;
  userId: number;
  agentName: "kelion" | "kira";
  conversationHistory: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
    emotion?: string;
  }>;
  knowledgeBase: Map<string, string>;
  learnings: Array<{
    topic: string;
    content: string;
    source: string;
    confidence: number;
    timestamp: Date;
  }>;
  personality: {
    traits: string[];
    communicationStyle: string;
    expertise: string[];
    limitations: string[];
  };
  currentContext: {
    userState: string;
    environmentDescription: string;
    detectedNeeds: string[];
    alerts: Array<{
      type: "danger" | "warning" | "info" | "accessibility";
      message: string;
      priority: "critical" | "high" | "medium" | "low";
    }>;
  };
}

export interface PerceptionData {
  vision?: {
    objects: Array<{ name: string; confidence: number; location: string }>;
    people: Array<{ count: number; emotions: string[]; activities: string[] }>;
    text: string[];
    hazards: string[];
  };
  audio?: {
    transcript: string;
    sentiment: string;
    tone: string;
    language: string;
  };
  sensors?: {
    temperature?: number;
    light?: number;
    motion?: boolean;
    proximity?: number;
  };
}

export interface ActionResponse {
  type: string;
  content: string;
  confidence: number;
  requiresConfirmation: boolean;
  nextActions?: string[];
  learning?: {
    topic: string;
    content: string;
  };
}

export class AGIBrain {
  private agentName: "kelion" | "kira";
  private userId: number;
  private memory: AgentMemory;
  private maxMemorySize = 10000;
  private searchApiKey = process.env.TAVILY_API_KEY;

  constructor(agentName: "kelion" | "kira", userId: number) {
    this.agentName = agentName;
    this.userId = userId;
    this.memory = this.initializeMemory();
  }

  /**
   * Initialize agent memory with personality and knowledge base
   */
  private initializeMemory(): AgentMemory {
    const personalities = {
      kelion: {
        traits: ["analytical", "logical", "patient", "educational"],
        communicationStyle: "formal and structured",
        expertise: ["mathematics", "science", "programming", "problem-solving"],
        limitations: ["creative writing", "emotional support"],
      },
      kira: {
        traits: ["empathetic", "creative", "intuitive", "supportive"],
        communicationStyle: "warm and conversational",
        expertise: ["arts", "humanities", "psychology", "communication"],
        limitations: ["technical debugging", "complex calculations"],
      },
    };

    return {
      id: `${this.agentName}-${this.userId}-${Date.now()}`,
      userId: this.userId,
      agentName: this.agentName,
      conversationHistory: [],
      knowledgeBase: new Map(),
      learnings: [],
      personality: personalities[this.agentName],
      currentContext: {
        userState: "unknown",
        environmentDescription: "",
        detectedNeeds: [],
        alerts: [],
      },
    };
  }

  /**
   * Process user input with full perception and reasoning
   */
  async processUserInput(
    input: string,
    perception?: PerceptionData
  ): Promise<ActionResponse> {
    try {
      // 1. Update context from perception
      if (perception) {
        await this.updateContextFromPerception(perception);
      }

      // 2. Detect knowledge gaps
      const knowledgeGaps = await this.detectKnowledgeGaps(input);

      // 3. Search for missing information if needed
      if (knowledgeGaps.length > 0) {
        await this.searchAndLearn(knowledgeGaps);
      }

      // 4. Determine action type
      const actionType = this.determineActionType(input);

      // 5. Execute appropriate action
      let response: ActionResponse;
      switch (actionType) {
        case "code":
          response = await this.handleCodeRequest(input);
          break;
        case "teach":
          response = await this.handleTeachingRequest(input);
          break;
        case "search":
          response = await this.handleSearchRequest(input);
          break;
        case "alert":
          response = await this.handleAlertRequest(input);
          break;
        default:
          response = await this.handleChatRequest(input);
      }

      // 6. Store in memory
      this.addToMemory(input, response.content);

      // 7. Generate learning if applicable
      if (response.learning) {
        this.addLearning(response.learning.topic, response.learning.content);
      }

      return response;
    } catch (error) {
      console.error("[AGI Brain] Error processing input:", error);
      return {
        type: "error",
        content: "I encountered an error processing your request. Please try again.",
        confidence: 0,
        requiresConfirmation: false,
      };
    }
  }

  /**
   * Update agent context from perception data
   */
  private async updateContextFromPerception(perception: PerceptionData): Promise<void> {
    const context = this.memory.currentContext;

    // Process vision data
    if (perception.vision) {
      const hazards = perception.vision.hazards || [];
      if (hazards.length > 0) {
        context.alerts.push({
          type: "danger",
          message: `Detected hazards: ${hazards.join(", ")}`,
          priority: "critical",
        });
      }

      context.environmentDescription = `Objects: ${perception.vision.objects
        .map((o) => o.name)
        .join(", ")}. People: ${perception.vision.people.length}`;
    }

    // Process audio data
    if (perception.audio) {
      context.userState = perception.audio.sentiment;
    }

    // Process sensor data
    if (perception.sensors) {
      if (perception.sensors.temperature && perception.sensors.temperature > 40) {
        context.alerts.push({
          type: "warning",
          message: "High temperature detected",
          priority: "high",
        });
      }
    }
  }

  /**
   * Detect what the agent doesn't know
   */
  private async detectKnowledgeGaps(input: string): Promise<string[]> {
    const gaps: string[] = [];
    const unknownPatterns = [
      "what is",
      "how do",
      "explain",
      "tell me about",
      "define",
      "who is",
      "where is",
    ];

    for (const pattern of unknownPatterns) {
      if (input.toLowerCase().includes(pattern)) {
        const topic = input.substring(input.indexOf(pattern) + pattern.length).trim();
        if (!this.memory.knowledgeBase.has(topic)) {
          gaps.push(topic);
        }
      }
    }

    return gaps;
  }

  /**
   * Search the web for missing information and learn
   */
  private async searchAndLearn(topics: string[]): Promise<void> {
    for (const topic of topics) {
      try {
        const searchResults = await this.searchWeb(topic);
        if (searchResults.length > 0) {
          const summary = await this.summarizeSearchResults(searchResults);
          this.memory.knowledgeBase.set(topic, summary);
          this.addLearning(topic, summary, "web_search");
        }
      } catch (error) {
        console.error(`[AGI Brain] Error searching for ${topic}:`, error);
      }
    }
  }

  /**
   * Search the web using Tavily API
   */
  private async searchWeb(query: string): Promise<any[]> {
    if (!this.searchApiKey) {
      console.warn("[AGI Brain] Tavily API key not configured");
      return [];
    }

    try {
      const response = await axios.post("https://api.tavily.com/search", {
        api_key: this.searchApiKey,
        query,
        include_answer: true,
        max_results: 5,
      });

      return response.data.results || [];
    } catch (error) {
      console.error("[AGI Brain] Web search error:", error);
      return [];
    }
  }

  /**
   * Summarize search results using LLM
   */
  private async summarizeSearchResults(results: any[]): Promise<string> {
    const content = results.map((r) => r.content).join("\n");

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "Summarize the following search results in 2-3 sentences.",
        },
        {
          role: "user",
          content,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    return typeof msgContent === "string" ? msgContent : "";
  }

  /**
   * Determine the type of action needed
   */
  private determineActionType(input: string): string {
    const lowerInput = input.toLowerCase();

    if (
      lowerInput.includes("code") ||
      lowerInput.includes("write") ||
      lowerInput.includes("function")
    ) {
      return "code";
    }
    if (
      lowerInput.includes("teach") ||
      lowerInput.includes("explain") ||
      lowerInput.includes("learn")
    ) {
      return "teach";
    }
    if (
      lowerInput.includes("search") ||
      lowerInput.includes("find") ||
      lowerInput.includes("look up")
    ) {
      return "search";
    }
    if (
      lowerInput.includes("alert") ||
      lowerInput.includes("danger") ||
      lowerInput.includes("warning")
    ) {
      return "alert";
    }

    return "chat";
  }

  /**
   * Handle code generation requests
   */
  private async handleCodeRequest(input: string): Promise<ActionResponse> {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are ${this.agentName}, an expert programmer. Generate clean, well-documented code.`,
        },
        {
          role: "user",
          content: input,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const code = typeof msgContent === "string" ? msgContent : "";

    return {
      type: "code",
      content: code,
      confidence: 0.9,
      requiresConfirmation: true,
      learning: {
        topic: "code_generation",
        content: code,
      },
    };
  }

  /**
   * Handle teaching requests
   */
  private async handleTeachingRequest(input: string): Promise<ActionResponse> {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are ${this.agentName}, an expert teacher. Explain concepts clearly with examples.`,
        },
        {
          role: "user",
          content: input,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const explanation = typeof msgContent === "string" ? msgContent : "";

    return {
      type: "teach",
      content: explanation,
      confidence: 0.85,
      requiresConfirmation: false,
      learning: {
        topic: "teaching",
        content: explanation,
      },
    };
  }

  /**
   * Handle search requests
   */
  private async handleSearchRequest(input: string): Promise<ActionResponse> {
    const searchQuery = input.replace(/search|find|look up/i, "").trim();
    const results = await this.searchWeb(searchQuery);
    const summary = await this.summarizeSearchResults(results);

    return {
      type: "search",
      content: summary,
      confidence: 0.8,
      requiresConfirmation: false,
      learning: {
        topic: searchQuery,
        content: summary,
      },
    };
  }

  /**
   * Handle alert/safety requests
   */
  private async handleAlertRequest(input: string): Promise<ActionResponse> {
    const alerts = this.memory.currentContext.alerts;

    if (alerts.length === 0) {
      return {
        type: "alert",
        content: "No alerts detected.",
        confidence: 1.0,
        requiresConfirmation: false,
      };
    }

    const alertMessages = alerts.map((a) => `[${a.priority.toUpperCase()}] ${a.message}`).join("\n");

    return {
      type: "alert",
      content: alertMessages,
      confidence: 0.95,
      requiresConfirmation: true,
    };
  }

  /**
   * Handle regular chat requests
   */
  private async handleChatRequest(input: string): Promise<ActionResponse> {
    const systemPrompt = `You are ${this.agentName}, an AI agent with the following traits: ${this.memory.personality.traits.join(
      ", "
    )}.
Communication style: ${this.memory.personality.communicationStyle}.
Expertise: ${this.memory.personality.expertise.join(", ")}.
Known limitations: ${this.memory.personality.limitations.join(", ")}.
You have access to a knowledge base and can search the web for information you don't know.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: systemPrompt,
        },
        ...this.memory.conversationHistory.slice(-10).map((h) => ({
          role: h.role,
          content: h.content,
        })),
        {
          role: "user",
          content: input,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const content = typeof msgContent === "string" ? msgContent : "";

    return {
      type: "chat",
      content,
      confidence: 0.85,
      requiresConfirmation: false,
    };
  }

  /**
   * Add message to conversation history
   */
  private addToMemory(userInput: string, assistantResponse: string): void {
    this.memory.conversationHistory.push({
      role: "user",
      content: userInput,
      timestamp: new Date(),
    });

    this.memory.conversationHistory.push({
      role: "assistant",
      content: assistantResponse,
      timestamp: new Date(),
    });

    // Maintain memory size limit
    if (this.memory.conversationHistory.length > this.maxMemorySize) {
      this.memory.conversationHistory = this.memory.conversationHistory.slice(
        -this.maxMemorySize
      );
    }
  }

  /**
   * Add learning to knowledge base
   */
  private addLearning(topic: string, content: string, source: string = "conversation"): void {
    this.memory.learnings.push({
      topic,
      content,
      source,
      confidence: 0.8,
      timestamp: new Date(),
    });

    // Keep learnings sorted by recency
    this.memory.learnings.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get agent memory for persistence
   */
  getMemory(): AgentMemory {
    return this.memory;
  }

  /**
   * Restore agent memory from storage
   */
  restoreMemory(savedMemory: AgentMemory): void {
    this.memory = savedMemory;
  }
}
