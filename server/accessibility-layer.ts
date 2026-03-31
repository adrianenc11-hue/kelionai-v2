import { invokeLLM } from "./_core/llm";

/**
 * Accessibility Layer for Blind and Visually Impaired Users
 * Provides audio descriptions, alerts, and alternative interaction methods
 */

export interface AccessibilitySettings {
  userId: number;
  isBlindOrVisuallyImpaired: boolean;
  preferredLanguage: string;
  audioDescriptionLevel: "minimal" | "standard" | "detailed";
  alertVolume: "low" | "medium" | "high";
  speakingRate: number; // 0.5 to 2.0
  enableHapticFeedback: boolean;
  enableAudioCues: boolean;
  enableKeyboardNavigation: boolean;
}

export interface AccessibilityAlert {
  type: "danger" | "warning" | "info" | "success";
  priority: "critical" | "high" | "medium" | "low";
  message: string;
  audioDescription: string;
  suggestedAction?: string;
}

export class AccessibilityLayer {
  private settings: AccessibilitySettings;
  private alertQueue: AccessibilityAlert[] = [];

  constructor(settings: AccessibilitySettings) {
    this.settings = settings;
  }

  /**
   * Generate audio description for image/scene
   */
  async generateAudioDescription(
    imageUrl: string,
    context?: string
  ): Promise<string> {
    const detailLevel = this.getDetailLevel();

    const prompt = `Generate a ${detailLevel} audio description for a blind person of this image: ${imageUrl}
Context: ${context || "General scene"}

The description should be:
1. Clear and concise
2. Describe important objects, people, and actions
3. Include spatial relationships
4. Mention colors and textures if relevant
5. Be engaging and informative`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are an expert at creating audio descriptions for blind and visually impaired people. Be detailed, clear, and helpful.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    return typeof msgContent === "string" ? msgContent : "";
  }

  /**
   * Convert UI element to accessible text description
   */
  async describeUIElement(
    elementType: string,
    elementContent: string,
    position?: { x: number; y: number }
  ): Promise<string> {
    const prompt = `Describe this UI element for a blind user:
Type: ${elementType}
Content: ${elementContent}
Position: ${position ? `${position.x}, ${position.y}` : "unknown"}

Provide a clear, concise description that helps the user understand what this element is and how to interact with it.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an accessibility expert. Describe UI elements clearly for blind users.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    return typeof msgContent === "string" ? msgContent : "";
  }

  /**
   * Generate keyboard navigation instructions
   */
  async generateKeyboardInstructions(pageType: string): Promise<string[]> {
    const prompt = `Generate keyboard navigation instructions for a ${pageType} page for blind users using screen readers.

Include:
1. Tab navigation order
2. Keyboard shortcuts
3. Form field navigation
4. Button activation
5. Link navigation

Format as a list of clear, actionable instructions.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are an accessibility expert specializing in keyboard navigation for screen reader users.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const content = typeof msgContent === "string" ? msgContent : "";

    return content.split("\n").filter((line) => line.trim().length > 0);
  }

  /**
   * Create alert for accessibility
   */
  async createAlert(
    type: "danger" | "warning" | "info" | "success",
    message: string,
    priority: "critical" | "high" | "medium" | "low" = "medium"
  ): Promise<AccessibilityAlert> {
    // Generate audio description for the alert
    const audioDescription = await this.generateAudioDescription(
      "",
      `Alert: ${message}`
    );

    // Suggest action based on alert type
    let suggestedAction: string | undefined;
    if (type === "danger") {
      suggestedAction = "Immediate action required";
    } else if (type === "warning") {
      suggestedAction = "Please review this information";
    }

    const alert: AccessibilityAlert = {
      type,
      priority,
      message,
      audioDescription,
      suggestedAction,
    };

    this.alertQueue.push(alert);
    return alert;
  }

  /**
   * Get next alert from queue
   */
  getNextAlert(): AccessibilityAlert | undefined {
    // Sort by priority
    this.alertQueue.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });

    return this.alertQueue.shift();
  }

  /**
   * Get all pending alerts
   */
  getAllAlerts(): AccessibilityAlert[] {
    return this.alertQueue;
  }

  /**
   * Clear alert queue
   */
  clearAlerts(): void {
    this.alertQueue = [];
  }

  /**
   * Generate haptic feedback pattern
   */
  generateHapticPattern(type: "success" | "error" | "warning" | "info"): number[] {
    // Haptic patterns as duration in milliseconds
    const patterns = {
      success: [50, 100, 50], // Short-long-short
      error: [100, 50, 100, 50, 100], // Long-short-long-short-long
      warning: [75, 75, 75], // Medium-medium-medium
      info: [25, 25, 25, 25], // Quick-quick-quick-quick
    };

    return patterns[type];
  }

  /**
   * Generate audio cue
   */
  async generateAudioCue(type: "success" | "error" | "warning" | "info"): Promise<string> {
    const descriptions = {
      success: "A pleasant chime sound indicating success",
      error: "A warning beep indicating an error",
      warning: "An alert sound indicating caution",
      info: "A gentle notification sound",
    };

    // In a real implementation, this would generate or fetch audio
    return descriptions[type];
  }

  /**
   * Describe color for blind users
   */
  async describeColor(colorHex: string, context?: string): Promise<string> {
    const prompt = `Describe this color (#${colorHex}) in a way that's meaningful for a blind person.
Context: ${context || "General use"}

Describe:
1. What common objects have this color
2. The feeling or mood it conveys
3. Its brightness level
4. Any patterns or textures it might represent`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are an expert at describing colors for blind people using relatable comparisons and emotional context.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    return typeof msgContent === "string" ? msgContent : "";
  }

  /**
   * Generate screen reader compatible markup
   */
  generateAccessibleMarkup(
    element: string,
    content: string,
    ariaLabel?: string,
    role?: string
  ): string {
    return `<${element} role="${role || "generic"}" aria-label="${ariaLabel || content}">
  ${content}
</${element}>`;
  }

  /**
   * Check accessibility compliance
   */
  async checkAccessibilityCompliance(htmlContent: string): Promise<{
    issues: string[];
    suggestions: string[];
    score: number;
  }> {
    const issues: string[] = [];
    const suggestions: string[] = [];

    // Check for alt text
    if (htmlContent.includes("<img") && !htmlContent.includes("alt=")) {
      issues.push("Images missing alt text");
      suggestions.push("Add descriptive alt text to all images");
    }

    // Check for heading hierarchy
    if (!htmlContent.includes("<h1")) {
      issues.push("No main heading (h1) found");
      suggestions.push("Add a main heading to the page");
    }

    // Check for form labels
    if (htmlContent.includes("<input") && !htmlContent.includes("<label")) {
      issues.push("Form inputs missing labels");
      suggestions.push("Associate labels with all form inputs");
    }

    // Check for color contrast
    if (!htmlContent.includes("aria-label") && !htmlContent.includes("title")) {
      suggestions.push("Add aria-labels for interactive elements");
    }

    // Calculate score
    const score = Math.max(0, 100 - issues.length * 25 - suggestions.length * 10);

    return { issues, suggestions, score };
  }

  /**
   * Get detail level based on settings
   */
  private getDetailLevel(): string {
    switch (this.settings.audioDescriptionLevel) {
      case "minimal":
        return "brief (1-2 sentences)";
      case "standard":
        return "moderate (2-3 sentences)";
      case "detailed":
        return "detailed (3-5 sentences)";
      default:
        return "moderate";
    }
  }

  /**
   * Update accessibility settings
   */
  updateSettings(newSettings: Partial<AccessibilitySettings>): void {
    this.settings = { ...this.settings, ...newSettings };
  }

  /**
   * Get current settings
   */
  getSettings(): AccessibilitySettings {
    return this.settings;
  }
}

export default AccessibilityLayer;
