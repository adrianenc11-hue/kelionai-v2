# KelionAI v2 - API Documentation

All API endpoints are served via **tRPC** at `/api/trpc`. Authentication uses Manus OAuth with session cookies.

---

## Authentication

### `auth.me` (Query)
Returns the currently authenticated user or null.

**Auth:** Public  
**Input:** None  
**Output:** `{ id, name, email, role, subscriptionTier, createdAt } | null`

### `auth.logout` (Mutation)
Logs out the current user by clearing the session cookie.

**Auth:** Protected  
**Input:** None  
**Output:** `{ success: boolean }`

---

## Chat

### `chat.listConversations` (Query)
Lists all conversations for the authenticated user.

**Auth:** Protected  
**Input:** None  
**Output:** `Array<{ id, userId, title, avatar, createdAt, updatedAt }>`

### `chat.getConversation` (Query)
Gets a specific conversation with all messages.

**Auth:** Protected  
**Input:** `{ conversationId: number }`  
**Output:** `{ conversation: {...}, messages: Array<{ id, role, content, aiModel, createdAt }> }`  
**Errors:** "Conversation not found or access denied"

### `chat.sendMessage` (Mutation)
Sends a message and gets an AI response through Brain v4.

**Auth:** Protected  
**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| conversationId | number | No | Auto-creates if not provided |
| message | string | Yes | User's message text |
| avatar | "kelion" \| "kira" | No | Default: "kelion" |
| imageUrl | string | No | Image URL for vision analysis |

**Output:**
| Field | Type | Description |
|-------|------|-------------|
| success | boolean | Always true on success |
| conversationId | number | The conversation ID (new or existing) |
| message | string | AI response text |
| audioUrl | string? | TTS audio URL if generated |
| confidence | string? | "verified" \| "high" \| "medium" \| "low" |
| toolsUsed | string[]? | List of tools used (e.g., "search_web", "get_weather") |
| userLevel | string? | Detected user level |
| language | string? | Detected language |
| voiceCloningStep | object? | Voice cloning step data if triggered |

**Errors:** "Message limit reached for {tier} plan"

### `chat.voiceCloningStep` (Mutation)
Processes a step in the voice cloning flow.

**Auth:** Protected  
**Input:** `{ step: number, audioBase64?: string }`  
**Output:** `{ step, action, description }`

### `chat.deleteConversation` (Mutation)
Deletes a conversation.

**Auth:** Protected  
**Input:** `{ conversationId: number }`  
**Output:** `{ success: boolean }`

---

## Voice

### `voice.transcribeAudio` (Mutation)
Transcribes audio to text using Whisper API.

**Auth:** Protected  
**Input:** `{ audioUrl: string (URL), language?: string }`  
**Output:** `{ text: string, language: string, duration: number }`  
**Limits:** Free: 10 min/month, Pro: 100, Enterprise: 1000

### `voice.generateSpeech` (Mutation)
Generates speech from text using ElevenLabs TTS.

**Auth:** Protected  
**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| text | string (1-5000 chars) | Yes | Text to speak |
| avatar | "kelion" \| "kira" | No | Default: "kelion" |
| useClonedVoice | boolean | No | Use user's cloned voice |
| quality | "standard" \| "high" \| "ultra" | No | Default: "high" |
| language | string | No | Language code for TTS |

**Output:** `{ audioUrl: string, duration: number, avatar: string }`

### `voice.cloneVoice` (Mutation)
Clones a user's voice from audio recording.

**Auth:** Protected  
**Input:** `{ audioBase64: string, voiceName?: string }`  
**Output:** `{ success: boolean, voiceId: string, voiceName: string, message: string }`

### `voice.getClonedVoice` (Query)
Gets the user's active cloned voice info.

**Auth:** Protected  
**Output:** `{ hasClonedVoice: boolean, voiceName: string?, voiceId: string?, createdAt?: Date }`

### `voice.deleteClonedVoice` (Mutation)
Deletes the user's cloned voice from ElevenLabs and database.

**Auth:** Protected  
**Output:** `{ success: boolean }`

### `voice.getVoiceUsage` (Query)
Gets voice usage statistics.

**Auth:** Protected  
**Output:** `{ used: number, limit: number, remaining: number, percentage: number, elevenLabs: {...} }`

---

## Contact

### `contact.sendMessage` (Mutation)
Sends a contact message with AI auto-response.

**Auth:** Public  
**Input:** `{ name: string, email: string, subject: string, message: string }`  
**Output:** `{ success: boolean, autoResponse: string, ticketId: string }`

---

## Admin

### `admin.getStats` (Query)
Gets dashboard statistics (users, conversations, messages, revenue).

**Auth:** Admin only  
**Output:** `{ totalUsers, totalConversations, totalMessages, activeToday, revenue, brainStats }`

### `admin.getUsers` (Query)
Lists all users with pagination.

**Auth:** Admin only  
**Input:** `{ page?: number, limit?: number }`  
**Output:** `{ users: Array<{...}>, total: number }`

### `admin.getBrainDiagnostics` (Query)
Gets Brain v4 diagnostic information.

**Auth:** Admin only  
**Output:** `{ version, tools, capabilities, antiHallucination, userLevels }`

---

## Subscription Tiers

| Tier | Messages/month | Voice min/month | Price |
|------|---------------|-----------------|-------|
| Free | 50 | 10 | $0 |
| Pro | 500 | 100 | $9.99/mo |
| Enterprise | 10,000 | 1,000 | $49.99/mo |

---

## Error Handling

All errors follow tRPC error format:
```json
{
  "error": {
    "message": "Human-readable error message",
    "code": "UNAUTHORIZED | FORBIDDEN | NOT_FOUND | BAD_REQUEST | INTERNAL_SERVER_ERROR"
  }
}
```
