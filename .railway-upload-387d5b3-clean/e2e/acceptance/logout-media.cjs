#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: logout-media
 *
 * After logout, the user's microphone and camera must be released. The
 * only way to verify this truthfully is in a real browser, because media
 * tracks are held by the browser, not by the server.
 *
 * This script uses Playwright to:
 *   1. Register + log in.
 *   2. Navigate to /chat and click "Porneste chat" which calls getUserMedia.
 *   3. Observe that a MediaStream with audio+video tracks is active.
 *   4. Trigger logout (via app nav).
 *   5. Observe that all tracks from that stream are in readyState='ended'.
 *
 * If the browser reports any track still 'live' after logout, this script
 * fails. No workaround, no mock, no cosmetic.
 *
 * This script is NOT IMPLEMENTED YET because it requires:
 *   - automated click path to the logout button (depends on UI stability);
 *   - instrumentation of the MediaStream from inside the page;
 *   - a browser granted permanent camera+mic permissions for the test origin.
 *
 * Until it is written, the capability is NOT DELIVERED. That is the honest
 * default.
 */

process.stderr.write('ACCEPTANCE FAIL: logout-media\n');
process.stderr.write('  reason: script not implemented yet; logout-kills-media capability is not verified\n');
process.stderr.write('  next step: implement Playwright flow that grants media permissions,\n');
process.stderr.write('             captures the MediaStream references, triggers logout, and\n');
process.stderr.write('             asserts every track is readyState="ended".\n');
process.exit(1);
