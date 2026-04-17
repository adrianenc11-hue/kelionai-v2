#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: voice-roundtrip
 *
 * A real user speaks, the AI listens, the AI replies with audio. End to end.
 *
 * This requires:
 *   - a real browser (Playwright/Chromium) with --use-fake-device-for-media-stream
 *     and --use-file-for-fake-audio-capture=<wav file with known utterance>;
 *   - granting camera+mic permissions to the test origin;
 *   - opening /chat, starting a session, and waiting for an incoming audio
 *     MediaStream from the RTCPeerConnection;
 *   - capturing the AI's audio output to a buffer;
 *   - running speech-to-text on the captured audio and asserting a non-empty
 *     transcript that is topically related to the input.
 *
 * None of this exists yet. Reporting the voice flow as working without this
 * script is forbidden by RULES.md (rules 1, 2, 14, 16, 25).
 *
 * This script is NOT IMPLEMENTED. It exits 1 on purpose.
 */

process.stderr.write('ACCEPTANCE FAIL: voice-roundtrip\n');
process.stderr.write('  reason: script not implemented yet; live voice round-trip is not verified\n');
process.stderr.write('  scope needed: Playwright + fake audio device + STT on captured AI audio.\n');
process.exit(1);
