// ═══════════════════════════════════════════════════════════════
// K-Doctor Webhook — receives Sentry alerts, triggers auto-repair
// Deploy as Netlify Function
// ═══════════════════════════════════════════════════════════════

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const payload = JSON.parse(event.body);

        // Extract error details from Sentry webhook
        const errorMessage = payload.data?.issue?.title || payload.message || 'Unknown error';
        const errorFile = extractFile(payload);
        const errorLine = extractLine(payload);
        const sentryUrl = payload.data?.issue?.web_url || payload.url || '';

        console.log(`[K-Doctor] Received: ${errorMessage} in ${errorFile}:${errorLine}`);

        // Safety: check cooldown (max 10 per day)
        // In production, use a database counter

        // Trigger GitHub Actions via repository_dispatch
        const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
        const REPO = process.env.GITHUB_REPO || 'adrianenc11hue/KelionAI';

        const response = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
            method: 'POST',
            headers: {
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                event_type: 'sentry-error',
                client_payload: {
                    error_message: errorMessage.substring(0, 200),
                    error_file: errorFile,
                    error_line: errorLine,
                    sentry_url: sentryUrl,
                    timestamp: new Date().toISOString(),
                },
            }),
        });

        if (response.ok || response.status === 204) {
            console.log('[K-Doctor] GitHub Action triggered successfully');
            return {
                statusCode: 200,
                body: JSON.stringify({ status: 'triggered', error: errorMessage }),
            };
        } else {
            const errText = await response.text();
            console.error('[K-Doctor] GitHub API error:', errText);
            return {
                statusCode: 500,
                body: JSON.stringify({ status: 'error', detail: errText }),
            };
        }
    } catch (err) {
        console.error('[K-Doctor] Error:', err.message);
        return {
            statusCode: 500,
            body: JSON.stringify({ status: 'error', message: err.message }),
        };
    }
};

function extractFile(payload) {
    try {
        const frames = payload.data?.issue?.metadata?.value?.match(/at\s+.*?\((.*?):\d+:\d+\)/);
        if (frames) return frames[1];

        const stacktrace = payload.data?.event?.exception?.values?.[0]?.stacktrace?.frames;
        if (stacktrace && stacktrace.length > 0) {
            const last = stacktrace[stacktrace.length - 1];
            return last.filename || last.abs_path || 'unknown';
        }
    } catch (e) { }
    return 'unknown';
}

function extractLine(payload) {
    try {
        const stacktrace = payload.data?.event?.exception?.values?.[0]?.stacktrace?.frames;
        if (stacktrace && stacktrace.length > 0) {
            return stacktrace[stacktrace.length - 1].lineno || '0';
        }
    } catch (e) { }
    return '0';
}
