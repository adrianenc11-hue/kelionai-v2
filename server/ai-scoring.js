'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// KelionAI — AI SCORING ENGINE
// Uses Gemini/GPT to evaluate trading signals with market context
// Returns confidence score 0-100 + reasoning
// ═══════════════════════════════════════════════════════════════════════════

const logger = require('./logger');
const { MODELS } = require('./config/models');

class AIScoring {
  constructor() {
    this.apiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY || '';
    this.model = MODELS.GEMINI_CHAT; // Centralized from config/models.js
    this.scoreCache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 min cache per asset
    this.stats = { totalScored: 0, avgScore: 0, lastScoredAt: null };
  }

  /**
   * Score a trading signal using AI
   * @param {Object} signalData - { asset, confluence, rsi, macd, smartMoney, mta, price }
   * @returns {Promise<{ score: number, reasoning: string, action: string, riskLevel: string }>}
   */
  async scoreSignal(signalData) {
    const { asset } = signalData;
    const cacheKey = `${asset}_${signalData.confluence?.signal}`;
    const cached = this.scoreCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.cacheTTL) {
      return cached.result;
    }

    if (!this.apiKey) {
      return this._fallbackScore(signalData);
    }

    try {
      const prompt = this._buildPrompt(signalData);
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 300 },
          }),
        }
      );

      if (!response.ok) {
        logger.warn({ component: 'AIScoring', status: response.status }, 'AI API failed, using fallback');
        return this._fallbackScore(signalData);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const result = this._parseResponse(text, signalData);

      this.scoreCache.set(cacheKey, { result, ts: Date.now() });
      this.stats.totalScored++;
      this.stats.avgScore = Math.round(
        (this.stats.avgScore * (this.stats.totalScored - 1) + result.score) / this.stats.totalScored
      );
      this.stats.lastScoredAt = new Date().toISOString();

      return result;
    } catch (e) {
      logger.error({ component: 'AIScoring', err: e.message }, 'AI scoring failed');
      return this._fallbackScore(signalData);
    }
  }

  _buildPrompt(data) {
    return `You are a professional quantitative trader. Score this trading signal 0-100 and give a brief reason.

ASSET: ${data.asset}
PRICE: $${data.price}
CONFLUENCE: ${data.confluence?.signal} (${data.confluence?.confidence}% confidence)
RSI: ${data.rsi?.value} (${data.rsi?.signal})
MACD: ${data.macd?.crossSignal} (histogram: ${data.macd?.histogram})
SMART MONEY: ${data.smartMoney?.phase || 'N/A'} (${data.smartMoney?.signal || 'N/A'})
MTA ALIGNMENT: ${data.mta?.overallSignal || 'N/A'} (${data.mta?.alignment || 0}%)
VOLUME TREND: ${data.smartMoney?.volumeTrend || 'N/A'}

Reply in JSON format ONLY:
{"score": <0-100>, "action": "<STRONG_BUY|BUY|HOLD|SELL|STRONG_SELL>", "risk": "<low|medium|high|extreme>", "reason": "<30 words max>"}`;
  }

  _parseResponse(text, data) {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: Math.min(100, Math.max(0, parseInt(parsed.score, 10) || 50)),
          action: parsed.action || data.confluence?.signal || 'HOLD',
          riskLevel: parsed.risk || 'medium',
          reasoning: parsed.reason || 'AI analysis complete',
          source: 'gemini-ai',
        };
      }
    } catch (_e) {
      // Parse failed, use fallback
    }
    return this._fallbackScore(data);
  }

  _fallbackScore(data) {
    // Mathematical scoring without AI
    let score = 50;
    const conf = data.confluence;

    if (conf?.signal === 'STRONG BUY') score += 25;
    else if (conf?.signal === 'BUY') score += 15;
    else if (conf?.signal === 'SELL') score -= 15;
    else if (conf?.signal === 'STRONG SELL') score -= 25;

    // RSI extremes
    if (data.rsi?.value < 30)
      score += 10; // Oversold = buy opportunity
    else if (data.rsi?.value > 70) score -= 10; // Overbought = sell

    // Smart Money alignment
    if (data.smartMoney?.signal === conf?.signal?.replace('STRONG ', '')) score += 10;

    // MTA alignment bonus
    if (data.mta?.alignment > 70) score += 10;
    else if (data.mta?.alignment < 30) score -= 5;

    score = Math.min(100, Math.max(0, score));
    const action =
      score >= 75 ? 'STRONG_BUY' : score >= 60 ? 'BUY' : score <= 25 ? 'STRONG_SELL' : score <= 40 ? 'SELL' : 'HOLD';
    const risk = score >= 70 || score <= 30 ? 'medium' : 'low';

    return {
      score,
      action,
      riskLevel: risk,
      reasoning: `Mathematical: confluence ${conf?.confidence || 0}%, RSI ${data.rsi?.value || 50}`,
      source: 'mathematical-fallback',
    };
  }

  getStats() {
    return this.stats;
  }
}

const scorer = new AIScoring();
/**
 * undefined
 * @returns {*}
 */
module.exports = scorer;
module.exports.AIScoring = AIScoring;
