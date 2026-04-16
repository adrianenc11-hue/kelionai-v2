import OpenAI from 'openai';
import { getWorldContext } from './worldContext.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const memories = new Map();

export class AvatarBrain {
  constructor(name, personality) {
    this.name = name;
    this.personality = personality;
  }

  async think(userId, message, location) {
    const context = await getWorldContext(location);
    if (!memories.has(userId)) memories.set(userId, []);
    const memory = memories.get(userId);

    const prompt = You are ${this.name}, .
REAL WORLD: , , °C
Reply in user language. Short (2-3 sentences).;

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
  }
}

function detectLanguage(text) {
  if (/[ăâîșț]/i.test(text)) return 'ro';
  if (/[àâçéèêë]/i.test(text)) return 'fr';
  if (/[äöüß]/i.test(text)) return 'de';
  if (/[áéíóúñ]/i.test(text)) return 'es';
  return 'en';
}

export const kelionBrain = new AvatarBrain('Kelion', 'friendly, enthusiastic');
export const kiraBrain = new AvatarBrain('Kira', 'professional, analytical');
