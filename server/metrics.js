// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Prometheus Metrics
// Real counters, histograms, gauges for every endpoint
// ═══════════════════════════════════════════════════════════════
const client = require('prom-client');

// Create a Registry
const register = new client.Registry();

// Default Node.js metrics (CPU, memory, event loop)
client.collectDefaultMetrics({ register });

// ─── Push to Grafana Cloud (every 15s) ──────────────────────
if (process.env.GRAFANA_PROM_URL) {
    const pushInterval = 15000;
    setInterval(async () => {
        try {
            const metricsData = await register.metrics();
            const resp = await fetch(process.env.GRAFANA_PROM_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain',
                    'Authorization': 'Basic ' + Buffer.from(
                        `${process.env.GRAFANA_PROM_USER}:${process.env.GRAFANA_PROM_PASS}`
                    ).toString('base64')
                },
                body: metricsData
            });
            if (!resp.ok) console.warn('[METRICS] Grafana push failed:', resp.status);
        } catch (e) {
            console.warn('[METRICS] Grafana push error:', e.message);
        }
    }, pushInterval);
    console.log('[METRICS] Grafana Cloud push enabled (every 15s)');
}

// ─── Custom Metrics ───────────────────────────────────────────

// HTTP request duration
const httpDuration = new client.Histogram({
    name: 'kelionai_http_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30],
    registers: [register],
});

// HTTP request duration (standard name)
const httpRequestDuration = new client.Histogram({
    name: 'kelionai_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registers: [register],
});

// HTTP requests total
const httpRequestsTotal = new client.Counter({
    name: 'kelionai_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});

// API call counters
const apiCalls = new client.Counter({
    name: 'kelionai_api_calls_total',
    help: 'Total API calls by endpoint and result',
    labelNames: ['endpoint', 'result'],
    registers: [register],
});

// AI request duration
const aiRequestDuration = new client.Histogram({
    name: 'kelionai_ai_request_duration_seconds',
    help: 'Duration of AI provider requests in seconds',
    labelNames: ['provider', 'model'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60],
    registers: [register],
});

// AI requests total
const aiRequestsTotal = new client.Counter({
    name: 'kelionai_ai_requests_total',
    help: 'Total AI requests by provider',
    labelNames: ['provider', 'status'],
    registers: [register],
});

// AI response latency
const aiLatency = new client.Histogram({
    name: 'kelionai_ai_latency_seconds',
    help: 'AI API response time (Claude/OpenAI)',
    labelNames: ['provider'],
    buckets: [0.5, 1, 2, 3, 5, 10, 20],
    registers: [register],
});

// TTS latency
const ttsLatency = new client.Histogram({
    name: 'kelionai_tts_latency_seconds',
    help: 'TTS response time (ElevenLabs/OpenAI)',
    labelNames: ['provider'],
    buckets: [0.3, 0.5, 1, 2, 3, 5],
    registers: [register],
});

// Active connections
const activeConnections = new client.Gauge({
    name: 'kelionai_active_connections',
    help: 'Number of active HTTP connections',
    registers: [register],
});

// Error counter
const errorCount = new client.Counter({
    name: 'kelionai_errors_total',
    help: 'Total errors by type',
    labelNames: ['type', 'endpoint'],
    registers: [register],
});

// AI provider health
const aiHealth = new client.Gauge({
    name: 'kelionai_ai_provider_health',
    help: '1 = healthy, 0 = unhealthy',
    labelNames: ['provider'],
    registers: [register],
});

// ─── Middleware ────────────────────────────────────────────────

function metricsMiddleware(req, res, next) {
    if (req.path === '/metrics' || req.path === '/health') return next();
    const end = httpRequestDuration.startTimer();
    activeConnections.inc();
    const start = process.hrtime.bigint();

    res.on('finish', () => {
        activeConnections.dec();
        const duration = Number(process.hrtime.bigint() - start) / 1e9;
        const route = req.route ? req.route.path : req.path;
        httpDuration.observe({ method: req.method, route, status: res.statusCode }, duration);
        const labels = { method: req.method, route, status_code: res.statusCode };
        end(labels);
        httpRequestsTotal.inc(labels);
    });

    next();
}

// ─── Export ────────────────────────────────────────────────────

module.exports = {
    register,
    httpDuration,
    httpRequestDuration,
    httpRequestsTotal,
    apiCalls,
    aiRequestDuration,
    aiRequestsTotal,
    aiLatency,
    ttsLatency,
    activeConnections,
    errorCount,
    aiHealth,
    metricsMiddleware,
};
