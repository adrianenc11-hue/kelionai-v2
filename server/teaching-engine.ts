import { invokeLLM } from "./_core/llm";

/**
 * Teaching and Tutoring Engine
 * Adaptive learning system for personalized education
 */

export interface StudentProfile {
  userId: number;
  learningStyle: "visual" | "auditory" | "kinesthetic" | "reading-writing";
  knowledgeLevel: "beginner" | "intermediate" | "advanced";
  subjects: string[];
  progressHistory: Array<{
    subject: string;
    topic: string;
    score: number;
    timestamp: Date;
  }>;
  preferences: {
    pacePreference: "slow" | "normal" | "fast";
    examplePreference: "simple" | "detailed" | "comprehensive";
    interactivityLevel: "low" | "medium" | "high";
  };
}

export interface LessonPlan {
  title: string;
  subject: string;
  level: string;
  objectives: string[];
  content: string;
  examples: string[];
  exercises: Array<{
    question: string;
    answer: string;
    difficulty: "easy" | "medium" | "hard";
  }>;
  quiz: Array<{
    question: string;
    options: string[];
    correctAnswer: number;
    explanation: string;
  }>;
}

export interface QuizResult {
  score: number;
  totalQuestions: number;
  percentage: number;
  feedback: string;
  areasToImprove: string[];
  nextRecommendation: string;
}

export class TeachingEngine {
  /**
   * Create personalized lesson plan
   */
  async createLessonPlan(
    subject: string,
    topic: string,
    studentProfile: StudentProfile
  ): Promise<LessonPlan> {
    const prompt = `Create a detailed lesson plan for teaching ${topic} in ${subject}.
Student profile:
- Learning style: ${studentProfile.learningStyle}
- Knowledge level: ${studentProfile.knowledgeLevel}
- Pace preference: ${studentProfile.preferences.pacePreference}
- Example preference: ${studentProfile.preferences.examplePreference}

Format the response as JSON with: title, subject, level, objectives (array), content, examples (array), exercises (array with question/answer/difficulty), quiz (array with question/options/correctAnswer/explanation).`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are an expert educator. Create comprehensive, personalized lesson plans in JSON format.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const content = typeof msgContent === "string" ? msgContent : "";

    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("[Teaching Engine] Error parsing lesson plan:", error);
    }

    // Return default lesson plan
    return {
      title: topic,
      subject,
      level: studentProfile.knowledgeLevel,
      objectives: [`Understand ${topic}`],
      content: content || `Learn about ${topic}`,
      examples: [],
      exercises: [],
      quiz: [],
    };
  }

  /**
   * Generate adaptive quiz based on student performance
   */
  async generateAdaptiveQuiz(
    subject: string,
    topic: string,
    studentProfile: StudentProfile,
    previousScore?: number
  ): Promise<Array<{ question: string; options: string[]; correctAnswer: number }>> {
    let difficulty = "medium";
    if (previousScore !== undefined) {
      if (previousScore > 80) {
        difficulty = "hard";
      } else if (previousScore < 60) {
        difficulty = "easy";
      }
    }

    const prompt = `Generate 5 multiple-choice quiz questions about ${topic} in ${subject}.
Difficulty level: ${difficulty}
Student knowledge level: ${studentProfile.knowledgeLevel}

Format as JSON array with: question, options (array of 4), correctAnswer (index 0-3).`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: "You are an expert quiz creator. Generate educational questions in JSON format.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const content = typeof msgContent === "string" ? msgContent : "";

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("[Teaching Engine] Error parsing quiz:", error);
    }

    return [];
  }

  /**
   * Evaluate quiz answers
   */
  async evaluateQuiz(
    answers: number[],
    quiz: Array<{ question: string; options: string[]; correctAnswer: number; explanation: string }>
  ): Promise<QuizResult> {
    let correctCount = 0;
    const areasToImprove: string[] = [];

    for (let i = 0; i < answers.length; i++) {
      if (answers[i] === quiz[i].correctAnswer) {
        correctCount++;
      } else {
        areasToImprove.push(`Question ${i + 1}: ${quiz[i].question}`);
      }
    }

    const percentage = Math.round((correctCount / quiz.length) * 100);

    // Generate feedback
    let feedback = "";
    if (percentage === 100) {
      feedback = "Perfect score! You've mastered this topic.";
    } else if (percentage >= 80) {
      feedback = "Great job! You have a solid understanding of this topic.";
    } else if (percentage >= 60) {
      feedback = "Good effort! Review the areas you struggled with and try again.";
    } else {
      feedback = "Keep practicing! This topic requires more study.";
    }

    const nextRecommendation =
      percentage >= 80
        ? "Move to the next topic"
        : "Review the lesson and practice more exercises";

    return {
      score: correctCount,
      totalQuestions: quiz.length,
      percentage,
      feedback,
      areasToImprove,
      nextRecommendation,
    };
  }

  /**
   * Generate personalized learning path
   */
  async generateLearningPath(
    subject: string,
    studentProfile: StudentProfile
  ): Promise<string[]> {
    const prompt = `Create a structured learning path for ${subject} for a ${studentProfile.knowledgeLevel} student.
Return as JSON array of topics in recommended order.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a curriculum designer. Create logical learning progressions in JSON format.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const content = typeof msgContent === "string" ? msgContent : "";

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("[Teaching Engine] Error parsing learning path:", error);
    }

    return [
      "Fundamentals",
      "Core Concepts",
      "Advanced Topics",
      "Practical Applications",
      "Mastery",
    ];
  }

  /**
   * Provide tutoring assistance for specific problem
   */
  async provideTutoring(
    subject: string,
    problem: string,
    studentProfile: StudentProfile
  ): Promise<string> {
    const prompt = `Help a ${studentProfile.knowledgeLevel} student understand this problem in ${subject}:

${problem}

Provide:
1. Step-by-step explanation
2. Key concepts involved
3. Similar examples
4. Practice tips

Adapt to their learning style: ${studentProfile.learningStyle}`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are an expert tutor. Explain concepts clearly and adapt to student learning styles.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    return typeof msgContent === "string" ? msgContent : "Unable to provide tutoring at this time.";
  }

  /**
   * Generate practice exercises
   */
  async generateExercises(
    subject: string,
    topic: string,
    difficulty: "easy" | "medium" | "hard",
    count: number = 5
  ): Promise<
    Array<{
      exercise: string;
      solution: string;
      explanation: string;
    }>
  > {
    const prompt = `Generate ${count} ${difficulty} practice exercises for ${topic} in ${subject}.
Include solutions and explanations.

Format as JSON array with: exercise, solution, explanation.`;

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are an expert problem setter. Create educational exercises in JSON format.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const msgContent = response.choices[0]?.message.content;
    const content = typeof msgContent === "string" ? msgContent : "";

    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("[Teaching Engine] Error parsing exercises:", error);
    }

    return [];
  }

  /**
   * Track student progress
   */
  trackProgress(studentProfile: StudentProfile, subject: string, score: number): void {
    studentProfile.progressHistory.push({
      subject,
      topic: subject,
      score,
      timestamp: new Date(),
    });

    // Adjust knowledge level based on performance
    const recentScores = studentProfile.progressHistory
      .filter((p) => p.subject === subject)
      .slice(-5)
      .map((p) => p.score);

    const averageScore = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

    if (averageScore > 85 && studentProfile.knowledgeLevel !== "advanced") {
      studentProfile.knowledgeLevel = "advanced";
    } else if (averageScore < 60 && studentProfile.knowledgeLevel !== "beginner") {
      studentProfile.knowledgeLevel = "beginner";
    }
  }

  /**
   * Generate study recommendations
   */
  async generateRecommendations(studentProfile: StudentProfile): Promise<string[]> {
    const recommendations: string[] = [];

    // Analyze progress
    if (studentProfile.progressHistory.length === 0) {
      recommendations.push("Start with fundamental topics");
      return recommendations;
    }

    const recentScores = studentProfile.progressHistory.slice(-10).map((p) => p.score);
    const averageScore = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;

    if (averageScore > 85) {
      recommendations.push("You're doing great! Try advanced topics");
      recommendations.push("Help others by explaining concepts");
    } else if (averageScore > 70) {
      recommendations.push("Good progress! Practice more exercises");
      recommendations.push("Review challenging topics");
    } else {
      recommendations.push("Focus on fundamentals");
      recommendations.push("Take more time with each topic");
      recommendations.push("Use more examples and visual aids");
    }

    // Personalized recommendations
    if (studentProfile.learningStyle === "visual") {
      recommendations.push("Use diagrams and visual explanations");
    } else if (studentProfile.learningStyle === "auditory") {
      recommendations.push("Listen to explanations and discussions");
    }

    return recommendations;
  }
}

export default TeachingEngine;
