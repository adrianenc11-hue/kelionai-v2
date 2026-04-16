import { OpenAI } from 'openai';
import { getWorldContext } from './worldContext.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const memories = new Map();

export class AvatarBrain {
  constructor(name, personality) {
    this.name = name;
    this.personality = personality;
  }

  async think(userId, message, location) {
    try {
      const context = await getWorldContext(location);
      if (!memories.has(userId)) memories.set(userId, []);
      const memory = memories.get(userId);

      const prompt = You are , .
Location: , Time: , Weather: C
Reply in user language. Short.;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: prompt },
          ...memory.slice(-6),
          { role: 'user', content: message }
        ],
        max_tokens: 150
      });

      memory.push({ role: 'user', content: message });
      memory.push({ role: 'assistant', content: response.choices[0].message.content });

      return {
        text: response.choices[0].message.content,
        language: detectLanguage(message)
      };
    } catch (error) {
      console.error('Brain error:', error);
      return { text: 'Sorry, I cannot think now.', language: 'en' };
    }
  }
}

function detectLanguage(text) {
  if (/[a‚Ó??]/i.test(text)) return 'ro';
  if (/[‡‚ÁÈËÍÎ]/i.test(text)) return 'fr';
  if (/[‰ˆ¸ﬂ]/i.test(text)) return 'de';
  if (/[·ÈÌÛ˙Ò]/i.test(text)) return 'es';
  return 'en';
}

export const kelionBrain = new AvatarBrain('Kelion', 'friendly and enthusiastic');
export const kiraBrain = new AvatarBrain('Kira', 'professional and analytical');
