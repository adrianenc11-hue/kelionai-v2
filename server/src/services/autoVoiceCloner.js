'use strict';

const { getDb } = require('../db');
const { addVoice, deleteVoice } = require('./elevenLabsTTS');

/**
 * Gets the Voice ID cloned for a specific WhatsApp contact.
 */
async function getContactVoiceId(contactId) {
  const db = getDb();
  if (!db) return null;
  const row = await db.get('SELECT voice_id FROM whatsapp_contact_voices WHERE contact_id = ?', [contactId]);
  return row ? row.voice_id : null;
}

/**
 * Updates the last used timestamp for a cloned voice, protecting it from GC.
 */
async function markContactVoiceUsed(contactId) {
  const db = getDb();
  if (!db) return;
  await db.run('UPDATE whatsapp_contact_voices SET last_used_at = CURRENT_TIMESTAMP WHERE contact_id = ?', [contactId]);
}

/**
 * Clones a voice via ElevenLabs and stores the ID for the contact.
 */
async function createContactVoice(contactId, audioBuffer, mimeType, senderName) {
  const db = getDb();
  if (!db) return null;
  
  // Create name for voice in ElevenLabs dashboard
  const safeName = senderName ? senderName.replace(/[^a-zA-Z0-9 ]/g, '') : 'Unknown';
  const phoneSuffix = contactId.split('@')[0].slice(-4);
  const name = `Kelion AutoClone - ${safeName} (${phoneSuffix})`;
  
  // Call ElevenLabs
  const voiceId = await addVoice(name, audioBuffer.toString('base64'), mimeType);
  
  // Insert into DB
  await db.run(
    'INSERT INTO whatsapp_contact_voices (contact_id, voice_id) VALUES (?, ?) ON CONFLICT(contact_id) DO UPDATE SET voice_id = EXCLUDED.voice_id, last_used_at = CURRENT_TIMESTAMP',
    [contactId, voiceId]
  );
  
  return voiceId;
}

/**
 * Garbage collector: cleans up voices not used in the last 24 hours.
 */
async function garbageCollectVoices() {
  const db = getDb();
  if (!db) return;
  
  try {
    const rows = await db.all('SELECT contact_id, voice_id, last_used_at FROM whatsapp_contact_voices');
    
    // 24 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    for (const row of rows) {
      const lastUsed = new Date(row.last_used_at);
      if (lastUsed < twentyFourHoursAgo) {
          try {
            console.log(`[Voice GC] Deleting voice ${row.voice_id} for ${row.contact_id} (inactive > 24h)`);
            await deleteVoice(row.voice_id);
            await db.run('DELETE FROM whatsapp_contact_voices WHERE contact_id = ?', [row.contact_id]);
          } catch (err) {
            console.error(`[Voice GC] Failed to delete voice ${row.voice_id}:`, err.message);
          }
      }
    }
  } catch (dbErr) {
    console.error('[Voice GC] Database error:', dbErr.message);
  }
}

let gcInterval = null;
function startGarbageCollection(intervalMs = 60 * 60 * 1000) { // Every 1 hour
  if (gcInterval) clearInterval(gcInterval);
  gcInterval = setInterval(() => {
    garbageCollectVoices().catch(err => console.error('[Voice GC] Error:', err.message));
  }, intervalMs);
  console.log(`[Voice GC] Started background garbage collector. (Checks every ${intervalMs/1000/60} mins)`);
}

module.exports = {
  getContactVoiceId,
  markContactVoiceUsed,
  createContactVoice,
  garbageCollectVoices,
  startGarbageCollection
};
