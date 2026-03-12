"use strict";

/**
 * BRAIN SESSION — Persistent admin-brain chat memory
 * 
 * Stores conversations in Supabase so the brain can resume
 * from where it left off between sessions.
 */

const logger = require("./logger");

class BrainSession {
  constructor(supabase) {
    this._db = supabase;
    this._cache = new Map(); // sessionId → messages[]
    this._maxMessages = 100; // max messages per session
    this._maxSessions = 50;  // max stored sessions
  }

  /**
   * Get or create a session. Returns { id, messages, context, created_at }
   */
  async getSession(sessionId) {
    // Check cache first
    if (this._cache.has(sessionId)) {
      return this._cache.get(sessionId);
    }

    if (!this._db) {
      // No DB — use in-memory only
      const session = { id: sessionId, messages: [], context: {}, created_at: new Date().toISOString() };
      this._cache.set(sessionId, session);
      return session;
    }

    try {
      const { data, error } = await this._db
        .from("brain_admin_sessions")
        .select("*")
        .eq("id", sessionId)
        .single();

      if (error && error.code !== "PGRST116") {
        logger.warn({ component: "BrainSession", err: error.message }, "DB read error");
      }

      if (data) {
        const session = {
          id: data.id,
          messages: data.messages || [],
          context: data.context || {},
          created_at: data.created_at,
        };
        this._cache.set(sessionId, session);
        return session;
      }

      // Create new session
      const session = { id: sessionId, messages: [], context: {}, created_at: new Date().toISOString() };
      this._cache.set(sessionId, session);
      return session;
    } catch (e) {
      logger.error({ component: "BrainSession", err: e.message }, "getSession failed");
      const session = { id: sessionId, messages: [], context: {}, created_at: new Date().toISOString() };
      this._cache.set(sessionId, session);
      return session;
    }
  }

  /**
   * Add a message to session and persist
   */
  async addMessage(sessionId, role, content, metadata = {}) {
    const session = await this.getSession(sessionId);
    
    const msg = {
      role, // "user" or "brain"
      content,
      timestamp: new Date().toISOString(),
      ...metadata,
    };

    session.messages.push(msg);

    // Trim old messages if over limit
    if (session.messages.length > this._maxMessages) {
      session.messages = session.messages.slice(-this._maxMessages);
    }

    this._cache.set(sessionId, session);

    // Persist to DB
    await this._persist(session);

    return msg;
  }

  /**
   * Update session context (files read, pending approvals, etc.)
   */
  async updateContext(sessionId, contextUpdate) {
    const session = await this.getSession(sessionId);
    session.context = { ...session.context, ...contextUpdate };
    this._cache.set(sessionId, session);
    await this._persist(session);
  }

  /**
   * Get all sessions (for history sidebar)
   */
  async listSessions() {
    if (!this._db) {
      return Array.from(this._cache.values()).map(s => ({
        id: s.id,
        messageCount: s.messages.length,
        lastMessage: s.messages[s.messages.length - 1]?.content?.slice(0, 80) || "",
        created_at: s.created_at,
        updated_at: s.messages[s.messages.length - 1]?.timestamp || s.created_at,
      }));
    }

    try {
      const { data, error } = await this._db
        .from("brain_admin_sessions")
        .select("id, created_at, updated_at, messages")
        .order("updated_at", { ascending: false })
        .limit(this._maxSessions);

      if (error) {
        logger.warn({ component: "BrainSession", err: error.message }, "listSessions error");
        return [];
      }

      return (data || []).map(s => ({
        id: s.id,
        messageCount: (s.messages || []).length,
        lastMessage: (s.messages || []).slice(-1)[0]?.content?.slice(0, 80) || "",
        created_at: s.created_at,
        updated_at: s.updated_at,
      }));
    } catch (e) {
      logger.error({ component: "BrainSession", err: e.message }, "listSessions failed");
      return [];
    }
  }

  /**
   * Persist session to Supabase
   */
  async _persist(session) {
    if (!this._db) return;

    try {
      const { error } = await this._db
        .from("brain_admin_sessions")
        .upsert({
          id: session.id,
          messages: session.messages,
          context: session.context,
          created_at: session.created_at,
          updated_at: new Date().toISOString(),
        }, { onConflict: "id" });

      if (error) {
        logger.warn({ component: "BrainSession", err: error.message }, "Persist failed");
      }
    } catch (e) {
      logger.error({ component: "BrainSession", err: e.message }, "Persist error");
    }
  }

  /**
   * Build conversation history for AI context
   * Returns formatted string of last N messages
   */
  buildHistory(session, maxMessages = 20) {
    const recent = session.messages.slice(-maxMessages);
    if (recent.length === 0) return "(Conversație nouă — prima interacțiune)";

    return recent.map(m => {
      const role = m.role === "user" ? "ADRIAN" : "CREIER";
      return `[${role}] ${m.content}`;
    }).join("\n\n");
  }
}

module.exports = BrainSession;
