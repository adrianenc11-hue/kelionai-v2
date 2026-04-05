import { getUserLearningProfile, upsertUserLearningProfile } from "./db";
import type { CharacterName } from "./characters";

export type UserLevel = "child" | "casual" | "professional" | "academic" | "technical";

export async function updateLearningProfile(userId: number, data: {
  detectedLevel?: string;
  language?: string;
  avatar?: string;
  isVoice?: boolean;
  topic?: string;
}): Promise<void> {
  const profile = await getUserLearningProfile(userId);
  const current = profile || {};

  const interactionCount = ((current as any).interactionCount || 0) + 1;
  const voiceInteractionCount = ((current as any).voiceInteractionCount || 0) + (data.isVoice ? 1 : 0);

  const topics: string[] = ((current as any).topics as string[]) || [];
  if (data.topic && !topics.includes(data.topic)) {
    topics.unshift(data.topic);
    if (topics.length > 20) topics.pop();
  }

  // Blend detected level with history (don't change abruptly)
  let finalLevel = (current as any).detectedLevel || data.detectedLevel || "casual";
  if (data.detectedLevel && data.detectedLevel !== finalLevel) {
    // Only update after 3+ interactions with consistent level
    if (interactionCount > 3) finalLevel = data.detectedLevel;
  }

  const learningScore = Math.min(1000, ((current as any).learningScore || 0) + 1);

  await upsertUserLearningProfile(userId, {
    detectedLevel: finalLevel,
    preferredLanguage: data.language || (current as any).preferredLanguage || "en",
    preferredAvatar: data.avatar || (current as any).preferredAvatar || "kelion",
    interactionCount,
    voiceInteractionCount,
    topics,
    learningScore,
  });
}

export async function getPersonalizedContext(userId: number): Promise<{
  level: string;
  language: string;
  avatar: CharacterName;
  topics: string[];
  interactionCount: number;
}> {
  const profile = await getUserLearningProfile(userId);
  return {
    level: (profile?.detectedLevel as string) || "casual",
    language: profile?.preferredLanguage || "en",
    avatar: (profile?.preferredAvatar as CharacterName) || "kelion",
    topics: (profile?.topics as string[]) || [],
    interactionCount: profile?.interactionCount || 0,
  };
}
