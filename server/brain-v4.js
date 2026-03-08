// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v4.0
// CLAUDE TOOL CALLING — No more 5-layer pipeline
// Claude decides which tools to call, executes them, responds directly
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");
const { MODELS } = require("./config/models");
const { buildSystemPrompt } = require("./persona");
const vm = require("vm");

// ── Tool Definitions for Claude ──
const TOOL_DEFINITIONS = [
    {
        name: "search_web",
        description: "Search the internet for current, real-time information. Use for news, facts, prices, events, people, anything requiring up-to-date data.",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "The search query in the user's language" },
            },
            required: ["query"],
        },
    },
    {
        name: "get_weather",
        description: "Get current weather and forecast for a city.",
        input_schema: {
            type: "object",
            properties: {
                city: { type: "string", description: "City name, e.g. 'București', 'London'" },
            },
            required: ["city"],
        },
    },
    {
        name: "generate_image",
        description: "Generate an image from a text description using AI (DALL-E).",
        input_schema: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Detailed description of the image to generate, in English" },
            },
            required: ["prompt"],
        },
    },
    {
        name: "play_radio",
        description: "Play a live radio station. Available: Kiss FM, Europa FM, Radio ZU, Digi FM, Magic FM, Rock FM, Pro FM, Virgin Radio, Gold FM, Radio Guerrilla, Romantic FM, BBC, CNN, Jazz FM, Classical, Chill, Lo-Fi, Dance, Electronica, Ambient.",
        input_schema: {
            type: "object",
            properties: {
                station: { type: "string", description: "Station name like 'Kiss FM', 'Europa FM', 'Jazz FM', 'Lo-fi'" },
            },
            required: ["station"],
        },
    },
    {
        name: "play_video",
        description: "Search and play a video (YouTube, Netflix, etc.) on the user's screen.",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "What to search for, e.g. 'relaxing music', 'cat videos'" },
            },
            required: ["query"],
        },
    },
    {
        name: "open_website",
        description: "Open a website or web page on the user's screen/monitor.",
        input_schema: {
            type: "object",
            properties: {
                url: { type: "string", description: "Full URL or search term to navigate to" },
            },
            required: ["url"],
        },
    },
    {
        name: "get_news",
        description: "Get latest news articles, optionally filtered by topic.",
        input_schema: {
            type: "object",
            properties: {
                topic: { type: "string", description: "News topic: 'general', 'tech', 'business', 'sports', 'science', 'health'" },
            },
            required: ["topic"],
        },
    },
    {
        name: "check_system_health",
        description: "Check the health status of all KelionAI systems, APIs, and services.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "get_trading_intelligence",
        description: "Get cryptocurrency/stock trading analysis, signals, and market intelligence.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "show_map",
        description: "Show a location on Google Maps.",
        input_schema: {
            type: "object",
            properties: {
                place: { type: "string", description: "Place name or address" },
            },
            required: ["place"],
        },
    },
    {
        name: "get_legal_info",
        description: "Get legal information: terms of service, privacy policy, GDPR, refund policy.",
        input_schema: {
            type: "object",
            properties: {
                document: { type: "string", description: "Which document: 'terms', 'privacy', 'gdpr', 'refund', 'cookie'" },
            },
            required: ["document"],
        },
    },
    {
        name: "recall_memory",
        description: "Recall what you remember about the user from past conversations.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    // ═══ PROGRAMMING TOOLS ═══
    {
        name: "execute_javascript",
        description: "Execute JavaScript code in a sandboxed environment and return the result. Use for calculations, data processing, sorting, transformations, algorithm testing. Timeout: 3 seconds. No file system or network access.",
        input_schema: {
            type: "object",
            properties: {
                code: { type: "string", description: "JavaScript code to execute. Must return a value or use console.log()." },
            },
            required: ["code"],
        },
    },
    {
        name: "database_query",
        description: "Query the Supabase/PostgreSQL database. Read-only SELECT queries. Tables: users, conversations, messages, user_preferences, brain_memory, subscriptions, api_keys, media_log, trades.",
        input_schema: {
            type: "object",
            properties: {
                table: { type: "string", description: "Table name to query" },
                select: { type: "string", description: "Columns to select, e.g. 'id, name, created_at'" },
                filters: { type: "string", description: "Filter conditions, e.g. 'status=active' or 'created_at>2024-01-01'" },
                limit: { type: "number", description: "Max rows to return (default 10, max 50)" },
            },
            required: ["table"],
        },
    },
    // ═══ ELECTRONIC & DEFECTOSCOPY TOOLS ═══
    {
        name: "analyze_schematic",
        description: "Analyze an electronic circuit schematic from an uploaded image. Identifies components (resistors, capacitors, ICs, transistors), traces signal paths, calculates power consumption, finds potential issues (short circuits, missing decoupling caps, wrong values). Requires an image to be uploaded.",
        input_schema: {
            type: "object",
            properties: {
                focus: { type: "string", description: "What to focus on: 'full_analysis', 'component_list', 'signal_path', 'power_analysis', 'error_check', 'improvement_suggestions'" },
            },
            required: ["focus"],
        },
    },
    {
        name: "defect_analysis",
        description: "Analyze images for defects using non-destructive testing (NDT) principles. Supports: X-ray images, ultrasound scans, thermal images, visual inspection photos. Identifies cracks, voids, corrosion, delamination, porosity, inclusions. Requires an image to be uploaded.",
        input_schema: {
            type: "object",
            properties: {
                material: { type: "string", description: "Material type: 'metal', 'composite', 'ceramic', 'plastic', 'weld', 'pcb', 'unknown'" },
                method: { type: "string", description: "NDT method: 'visual', 'xray', 'ultrasound', 'thermal', 'magnetic', 'eddy_current'" },
            },
            required: ["method"],
        },
    },
    {
        name: "component_lookup",
        description: "Search for electronic component datasheets and specifications. Find pinouts, max ratings, package types, alternatives, and pricing.",
        input_schema: {
            type: "object",
            properties: {
                component: { type: "string", description: "Component name or part number, e.g. 'LM7805', 'ATmega328', '100nF capacitor'" },
                info: { type: "string", description: "What info: 'datasheet', 'pinout', 'alternatives', 'specs', 'pricing'" },
            },
            required: ["component"],
        },
    },
    // ═══ MEDICAL / MRI / CANCER RESEARCH TOOLS ═══
    {
        name: "analyze_medical_image",
        description: "Analyze medical imaging (MRI/RMN, CT, PET, X-ray, ultrasound) for educational and research purposes. Identifies anatomical structures, highlights anomalies, measures dimensions. ⚠️ NOT a medical diagnosis — for research/educational use only. Requires an image to be uploaded.",
        input_schema: {
            type: "object",
            properties: {
                modality: { type: "string", description: "Imaging modality: 'mri', 'ct', 'pet', 'xray', 'ultrasound', 'mammography'" },
                body_region: { type: "string", description: "Body region: 'brain', 'chest', 'abdomen', 'pelvis', 'spine', 'extremity', 'breast', 'head_neck'" },
                focus: { type: "string", description: "Analysis focus: 'anatomy', 'anomaly_detection', 'measurements', 'comparison', 'full_report'" },
            },
            required: ["modality"],
        },
    },
    {
        name: "pubmed_search",
        description: "Search PubMed for medical research articles, clinical trials, drug studies. Returns titles, abstracts, authors, and DOI links. Use for evidence-based medical information.",
        input_schema: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query, e.g. 'BRCA1 breast cancer treatment 2024', 'MRI glioblastoma detection'" },
                max_results: { type: "number", description: "Max results (default 5, max 20)" },
            },
            required: ["query"],
        },
    },
    {
        name: "dose_calculator",
        description: "Radiotherapy dose calculations for educational purposes. Calculates: absorbed dose, equivalent dose, effective dose, treatment fractionation, decay corrections. ⚠️ NOT for clinical use.",
        input_schema: {
            type: "object",
            properties: {
                calculation: { type: "string", description: "Type: 'absorbed_dose', 'equivalent_dose', 'effective_dose', 'fractionation', 'decay', 'inverse_square'" },
                parameters: { type: "string", description: "JSON string with calculation parameters, e.g. '{\"dose_per_fraction\": 2, \"fractions\": 30, \"tissue\": \"tumor\"}'" },
            },
            required: ["calculation", "parameters"],
        },
    },
    // ═══ OSCILLOSCOPE & SPECTROMETER & ENGINEERING TOOLS ═══
    {
        name: "analyze_oscilloscope",
        description: "Analyze oscilloscope screenshots/waveforms. Measures: frequency, amplitude, rise/fall time, duty cycle, phase shift, noise level, signal integrity (overshoot, ringing, jitter). Identifies signal types (sine, square, PWM, I2C, SPI, UART). Requires an image to be uploaded.",
        input_schema: {
            type: "object",
            properties: {
                channels: { type: "string", description: "Number of channels visible: '1', '2', '4'" },
                expected_signal: { type: "string", description: "What the signal should be: 'sine', 'square', 'pwm', 'i2c', 'spi', 'uart', 'analog', 'power_supply', 'unknown'" },
                focus: { type: "string", description: "Analysis focus: 'frequency', 'amplitude', 'timing', 'noise', 'signal_integrity', 'protocol_decode', 'full_analysis', 'compare_channels'" },
            },
            required: ["focus"],
        },
    },
    {
        name: "analyze_spectrometer",
        description: "Analyze spectrometer data/screenshots. Supports: optical emission spectroscopy (OES), mass spectrometry, UV-Vis, infrared (IR/FTIR), Raman, X-ray fluorescence (XRF), gamma spectroscopy. Identifies peaks, wavelengths, elements, compounds. Requires an image or data.",
        input_schema: {
            type: "object",
            properties: {
                type: { type: "string", description: "Spectrometer type: 'oes', 'mass', 'uv_vis', 'ir', 'ftir', 'raman', 'xrf', 'gamma', 'nmr', 'unknown'" },
                analysis: { type: "string", description: "What to analyze: 'peak_identification', 'element_identification', 'compound_identification', 'concentration', 'quality_check', 'full_analysis'" },
                sample: { type: "string", description: "Sample type if known: 'metal', 'organic', 'polymer', 'pharmaceutical', 'environmental', 'biological', 'unknown'" },
            },
            required: ["type", "analysis"],
        },
    },
    {
        name: "circuit_improvement",
        description: "Suggest improvements to an electronic circuit design. Analyzes for: efficiency, EMI/EMC compliance, thermal management, component selection, cost optimization, reliability, safety standards (IEC, CE, UL). Can work from schematic image or text description.",
        input_schema: {
            type: "object",
            properties: {
                circuit_type: { type: "string", description: "Circuit type: 'power_supply', 'amplifier', 'filter', 'digital', 'mixed_signal', 'rf', 'motor_driver', 'sensor_interface', 'medical_device', 'other'" },
                goal: { type: "string", description: "Improvement goal: 'efficiency', 'noise_reduction', 'cost', 'reliability', 'size', 'safety', 'emc', 'thermal', 'all'" },
                constraints: { type: "string", description: "Design constraints, e.g. 'max 5V, <100mA, medical grade, -20 to +70C'" },
            },
            required: ["circuit_type", "goal"],
        },
    },
    {
        name: "create_technical_manual",
        description: "Generate or update a technical manual/documentation. Creates structured documents with: specifications, measurement procedures, acceptance criteria, limits, calibration data, maintenance schedules. Stores in database for versioning.",
        input_schema: {
            type: "object",
            properties: {
                action: { type: "string", description: "Action: 'create', 'update', 'add_section', 'add_measurement', 'export'" },
                title: { type: "string", description: "Manual title, e.g. 'Linear Accelerator QA Protocol', 'MRI Daily Checks'" },
                section: { type: "string", description: "Section to create/update: 'specifications', 'procedures', 'limits', 'calibration', 'maintenance', 'troubleshooting', 'safety'" },
                content: { type: "string", description: "Content to add: measurement results, limits, procedures, notes" },
            },
            required: ["action", "title"],
        },
    },
    {
        name: "measurement_log",
        description: "Log, track, and analyze measurements over time. Records values with timestamps, checks against limits (pass/fail), tracks trends, generates calibration reports. Supports any measurement type (voltage, current, dose, temperature, frequency, etc.).",
        input_schema: {
            type: "object",
            properties: {
                action: { type: "string", description: "Action: 'record', 'check_limits', 'trend', 'report', 'history', 'calibration'" },
                equipment: { type: "string", description: "Equipment name/ID, e.g. 'Linac-1', 'MRI-Siemens-3T', 'Osciloscop-Rigol'" },
                parameter: { type: "string", description: "What was measured: 'output_dose', 'voltage', 'frequency', 'temperature', 'field_uniformity'" },
                value: { type: "number", description: "Measured value" },
                unit: { type: "string", description: "Unit: 'Gy', 'mV', 'MHz', '°C', 'mA', '%'" },
                limit_min: { type: "number", description: "Minimum acceptable value" },
                limit_max: { type: "number", description: "Maximum acceptable value" },
            },
            required: ["action", "equipment"],
        },
    },
];

// ── Tool executor: maps tool names to brain methods ──
async function executeTool(brain, toolName, toolInput, userId) {
    try {
        switch (toolName) {
            case "search_web":
                return await brain._search(toolInput.query);
            case "get_weather":
                return await brain._weather(toolInput.city);
            case "generate_image":
                return await brain._imagine(toolInput.prompt);
            case "play_radio":
                return await brain._radio(toolInput.station);
            case "play_video":
                return await brain._video(toolInput.query);
            case "open_website":
                return brain._webNav ? await brain._webNav(toolInput.url) : await brain._openURL(toolInput.url);
            case "get_news":
                return await brain._newsAction(toolInput.topic || "general");
            case "check_system_health":
                return await brain._healthCheck();
            case "get_trading_intelligence":
                return await brain._tradeIntelligence();
            case "show_map":
                return await brain._map(toolInput.place);
            case "get_legal_info":
                return await brain._legalAction(toolInput.document);
            case "recall_memory":
                return await brain._memory(userId);
            // ═══ PROGRAMMING TOOLS ═══
            case "execute_javascript": {
                const sandbox = { result: undefined, console: { log: (...a) => { sandbox.result = a.map(String).join(" "); } }, Math, Date, JSON, parseInt, parseFloat, isNaN, Array, Object, String, Number, Boolean, RegExp, Map, Set };
                const ctx = vm.createContext(sandbox);
                try {
                    const r = vm.runInContext(toolInput.code, ctx, { timeout: 3000 });
                    return { result: sandbox.result !== undefined ? sandbox.result : String(r), executed: true };
                } catch (execErr) {
                    return { error: execErr.message, executed: false };
                }
            }
            case "database_query": {
                if (!brain.supabaseAdmin) return { error: "Database not connected" };
                const lim = Math.min(toolInput.limit || 10, 50);
                let q = brain.supabaseAdmin.from(toolInput.table).select(toolInput.select || "*").limit(lim);
                if (toolInput.filters) {
                    for (const f of toolInput.filters.split(",")) {
                        const [col, val] = f.trim().split("=");
                        if (col && val) q = q.eq(col.trim(), val.trim());
                    }
                }
                const { data, error: dbErr } = await q;
                if (dbErr) return { error: dbErr.message };
                return { rows: data, count: data?.length || 0 };
            }
            // ═══ ELECTRONIC & DEFECTOSCOPY ═══
            case "analyze_schematic": {
                if (!brain._currentMediaData?.imageBase64) return { error: "No image uploaded. Please upload a schematic image first." };
                const prompt = `You are an expert electronics engineer. Analyze this circuit schematic image.\nFocus: ${toolInput.focus}\n\nProvide:\n1. List all identified components with values\n2. Trace signal/power paths\n3. Calculate approximate power consumption\n4. Identify any design issues or improvements\n5. Suggest component alternatives if applicable\n\nBe precise, use standard EE terminology.`;
                return await brain._vision(brain._currentMediaData.imageBase64, userId) || { analysis: prompt };
            }
            case "defect_analysis": {
                if (!brain._currentMediaData?.imageBase64) return { error: "No image uploaded. Please upload an inspection image." };
                const prompt = `Expert NDT (Non-Destructive Testing) defect analysis.\nMethod: ${toolInput.method}\nMaterial: ${toolInput.material || "unknown"}\n\nAnalyze this image for:\n1. Cracks, fractures, or discontinuities\n2. Voids, porosity, or inclusions\n3. Corrosion or material degradation\n4. Dimensional anomalies\n5. Severity classification (Critical/Major/Minor/Acceptable)\n6. Recommended follow-up actions\n\nUse standard NDT terminology and reference applicable standards (ASTM, ISO, EN).`;
                return await brain._vision(brain._currentMediaData.imageBase64, userId) || { analysis: prompt };
            }
            case "component_lookup": {
                const searchQuery = `${toolInput.component} ${toolInput.info || "datasheet"} electronic component specifications`;
                return await brain._search(searchQuery);
            }
            // ═══ MEDICAL TOOLS ═══
            case "analyze_medical_image": {
                if (!brain._currentMediaData?.imageBase64) return { error: "No medical image uploaded. Please upload an MRI/CT/X-ray image." };
                const prompt = `Expert radiologist analysis (EDUCATIONAL/RESEARCH ONLY — NOT clinical diagnosis).\nModality: ${toolInput.modality?.toUpperCase() || "Unknown"}\nBody region: ${toolInput.body_region || "unspecified"}\nFocus: ${toolInput.focus || "full_report"}\n\n⚠️ DISCLAIMER: This is for educational and research purposes only. Not a medical diagnosis.\n\nProvide:\n1. Imaging technique identification and quality assessment\n2. Normal anatomical structures visible\n3. Any notable findings or anomalies (location, size, characteristics)\n4. Signal intensity patterns (for MRI) or density patterns (for CT)\n5. Differential considerations based on imaging characteristics\n6. Suggested additional views or imaging if needed\n7. Relevant measurement annotations\n\nUse standard radiological terminology (ACR BI-RADS for breast, Fleischner for lung nodules, etc).`;
                return await brain._vision(brain._currentMediaData.imageBase64, userId) || { analysis: prompt };
            }
            case "pubmed_search": {
                const maxResults = Math.min(toolInput.max_results || 5, 20);
                try {
                    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${maxResults}&sort=relevance&term=${encodeURIComponent(toolInput.query)}`;
                    const sr = await fetch(searchUrl);
                    const sd = await sr.json();
                    const ids = sd.esearchresult?.idlist || [];
                    if (ids.length === 0) return { results: [], message: "No articles found" };
                    const detailUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(",")}`;
                    const dr = await fetch(detailUrl);
                    const dd = await dr.json();
                    const articles = ids.map(id => {
                        const a = dd.result?.[id];
                        if (!a) return null;
                        return { title: a.title, authors: (a.authors || []).slice(0, 3).map(au => au.name).join(", "), journal: a.fulljournalname, year: a.pubdate, doi: a.elocationid, pmid: id, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` };
                    }).filter(Boolean);
                    return { results: articles, total: sd.esearchresult?.count || 0 };
                } catch (pubErr) {
                    return { error: pubErr.message };
                }
            }
            case "dose_calculator": {
                try {
                    const params = JSON.parse(toolInput.parameters);
                    const calc = toolInput.calculation;
                    let result = {};
                    if (calc === "fractionation") {
                        const totalDose = (params.dose_per_fraction || 2) * (params.fractions || 30);
                        const BED = totalDose * (1 + (params.dose_per_fraction || 2) / (params.alpha_beta || 10));
                        result = { total_dose_Gy: totalDose, BED_Gy: BED.toFixed(2), EQD2_Gy: (BED / (1 + 2 / (params.alpha_beta || 10))).toFixed(2), fractions: params.fractions || 30, dose_per_fraction_Gy: params.dose_per_fraction || 2 };
                    } else if (calc === "decay") {
                        const activity = (params.initial_activity || 100) * Math.pow(0.5, (params.time_hours || 0) / (params.half_life_hours || 6));
                        result = { remaining_activity: activity.toFixed(2), unit: params.unit || "MBq", decay_factor: (activity / (params.initial_activity || 100)).toFixed(4) };
                    } else if (calc === "inverse_square") {
                        const newDose = (params.dose || 100) * Math.pow(params.distance1 || 1, 2) / Math.pow(params.distance2 || 2, 2);
                        result = { new_dose_rate: newDose.toFixed(2), reduction_factor: (newDose / (params.dose || 100)).toFixed(4) };
                    } else {
                        result = { error: "Unknown calculation type. Use: fractionation, decay, inverse_square" };
                    }
                    result.disclaimer = "⚠️ EDUCATIONAL ONLY — not for clinical treatment planning";
                    return result;
                } catch (calcErr) {
                    return { error: "Invalid parameters: " + calcErr.message };
                }
            }
            // ═══ OSCILLOSCOPE & SPECTROMETER & ENGINEERING ═══
            case "analyze_oscilloscope": {
                if (!brain._currentMediaData?.imageBase64) return { error: "No oscilloscope screenshot uploaded. Please upload a waveform image." };
                const prompt = `Expert oscilloscope waveform analysis.\nChannels: ${toolInput.channels || "unknown"}\nExpected signal: ${toolInput.expected_signal || "unknown"}\nFocus: ${toolInput.focus}\n\nAnalyze this oscilloscope screenshot. Provide:\n1. Signal type identification (sine, square, PWM, digital protocol)\n2. Measurements: frequency, period, amplitude (Vpp, Vrms), DC offset\n3. Rise/fall time, duty cycle (if applicable)\n4. Signal quality: noise level, overshoot, ringing, jitter\n5. If multiple channels: phase relationship, timing differences\n6. Protocol decode if digital (I2C, SPI, UART — identify data if visible)\n7. Anomalies: glitches, crosstalk, ground bounce, reflections\n8. Recommendations for improvement\n\nUse precise measurements from the scope's grid/cursors. Reference time/div and volt/div settings.`;
                return await brain._vision(brain._currentMediaData.imageBase64, userId) || { analysis: prompt };
            }
            case "analyze_spectrometer": {
                if (!brain._currentMediaData?.imageBase64) {
                    // Try web search for reference data if no image
                    return await brain._search(`${toolInput.type} spectroscopy ${toolInput.analysis} ${toolInput.sample || ""} reference spectrum`);
                }
                const prompt = `Expert spectrometry analysis.\nType: ${toolInput.type?.toUpperCase()}\nAnalysis: ${toolInput.analysis}\nSample: ${toolInput.sample || "unknown"}\n\nAnalyze this spectrum. Provide:\n1. Peak identification — wavelength/mass/wavenumber and intensity\n2. Element or compound identification based on peak positions\n3. Concentration estimates if calibration data is visible\n4. Spectral quality assessment (resolution, baseline, noise)\n5. Comparison with known reference spectra\n6. Potential interferences or overlapping peaks\n7. Quantitative results if standards are visible\n8. Recommendations for measurement improvement\n\nUse standard spectroscopic nomenclature and reference databases (NIST, HITRAN, Sadtler).`;
                return await brain._vision(brain._currentMediaData.imageBase64, userId) || { analysis: prompt };
            }
            case "circuit_improvement": {
                let context = "";
                if (brain._currentMediaData?.imageBase64) {
                    const visionResult = await brain._vision(brain._currentMediaData.imageBase64, userId);
                    context = typeof visionResult === "string" ? visionResult : JSON.stringify(visionResult);
                }
                const searchQuery = `${toolInput.circuit_type} circuit ${toolInput.goal} improvement best practices ${toolInput.constraints || ""}`;
                const searchResult = await brain._search(searchQuery);
                return {
                    circuit_analysis: context || "No schematic image provided — working from description",
                    improvement_research: searchResult,
                    circuit_type: toolInput.circuit_type,
                    optimization_goal: toolInput.goal,
                    constraints: toolInput.constraints || "none specified",
                };
            }
            case "create_technical_manual": {
                if (!brain.supabaseAdmin) return { error: "Database not connected — cannot store manual" };
                const manualKey = `manual:${toolInput.title.replace(/\s+/g, "_").toLowerCase()}`;
                if (toolInput.action === "create" || toolInput.action === "update" || toolInput.action === "add_section") {
                    const { data: existing } = await brain.supabaseAdmin.from("user_preferences").select("value").eq("key", manualKey).maybeSingle();
                    const manual = existing?.value || { title: toolInput.title, created: new Date().toISOString(), sections: {}, version: 1 };
                    if (toolInput.section && toolInput.content) {
                        manual.sections[toolInput.section] = manual.sections[toolInput.section] || [];
                        manual.sections[toolInput.section].push({ content: toolInput.content, timestamp: new Date().toISOString() });
                    }
                    manual.version = (manual.version || 0) + 1;
                    manual.updated = new Date().toISOString();
                    await brain.supabaseAdmin.from("user_preferences").upsert({ user_id: userId || "system", key: manualKey, value: manual }, { onConflict: "user_id,key" });
                    return { status: "saved", title: manual.title, version: manual.version, sections: Object.keys(manual.sections), total_entries: Object.values(manual.sections).flat().length };
                }
                if (toolInput.action === "export") {
                    const { data } = await brain.supabaseAdmin.from("user_preferences").select("value").eq("key", manualKey).maybeSingle();
                    return data?.value || { error: "Manual not found" };
                }
                return { error: "Unknown action. Use: create, update, add_section, export" };
            }
            case "measurement_log": {
                if (!brain.supabaseAdmin) return { error: "Database not connected" };
                const logKey = `measurements:${toolInput.equipment.replace(/\s+/g, "_").toLowerCase()}`;
                if (toolInput.action === "record") {
                    const { data: existing } = await brain.supabaseAdmin.from("user_preferences").select("value").eq("key", logKey).maybeSingle();
                    const log = existing?.value || { equipment: toolInput.equipment, measurements: [] };
                    const entry = { parameter: toolInput.parameter, value: toolInput.value, unit: toolInput.unit || "", timestamp: new Date().toISOString() };
                    if (toolInput.limit_min !== undefined || toolInput.limit_max !== undefined) {
                        entry.limit_min = toolInput.limit_min;
                        entry.limit_max = toolInput.limit_max;
                        entry.status = (toolInput.limit_min !== undefined && toolInput.value < toolInput.limit_min) || (toolInput.limit_max !== undefined && toolInput.value > toolInput.limit_max) ? "FAIL" : "PASS";
                    }
                    log.measurements.push(entry);
                    if (log.measurements.length > 500) log.measurements = log.measurements.slice(-500);
                    await brain.supabaseAdmin.from("user_preferences").upsert({ user_id: userId || "system", key: logKey, value: log }, { onConflict: "user_id,key" });
                    return { status: "recorded", entry, total_measurements: log.measurements.length };
                }
                if (toolInput.action === "history" || toolInput.action === "trend" || toolInput.action === "report") {
                    const { data } = await brain.supabaseAdmin.from("user_preferences").select("value").eq("key", logKey).maybeSingle();
                    if (!data?.value) return { error: "No measurements found for this equipment" };
                    const measurements = data.value.measurements || [];
                    const filtered = toolInput.parameter ? measurements.filter(m => m.parameter === toolInput.parameter) : measurements;
                    const values = filtered.map(m => m.value).filter(v => typeof v === "number");
                    const stats = values.length > 0 ? { count: values.length, min: Math.min(...values), max: Math.max(...values), avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(3), latest: filtered[filtered.length - 1] } : {};
                    return { equipment: toolInput.equipment, parameter: toolInput.parameter || "all", stats, recent: filtered.slice(-10), pass_rate: filtered.length > 0 ? ((filtered.filter(m => m.status === "PASS").length / filtered.filter(m => m.status).length) * 100).toFixed(1) + "%" : "N/A" };
                }
                return { error: "Unknown action. Use: record, history, trend, report" };
            }
            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    } catch (e) {
        logger.warn({ component: "BrainV4", tool: toolName, err: e.message }, `Tool ${toolName} failed`);
        brain.recordError(toolName, e.message);
        return { error: e.message };
    }
}

// ── Extract monitor data from tool results ──
function extractMonitor(toolResults) {
    for (const r of toolResults) {
        if (r.result && typeof r.result === "object") {
            if (r.result.monitorURL) return { content: r.result.monitorURL, type: "url" };
            if (r.result.mapURL) return { content: r.result.mapURL, type: "map" };
            if (r.result.imageUrl) return { content: r.result.imageUrl, type: "image" };
            if (r.result.radioURL || r.result.streamUrl) return { content: r.result.radioURL || r.result.streamUrl, type: "radio" };
            if (r.result.videoURL || r.result.youtubeURL) return { content: r.result.videoURL || r.result.youtubeURL, type: "video" };
        }
    }
    return { content: null, type: null };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: thinkV4 — Claude Tool Calling loop
// ═══════════════════════════════════════════════════════════════
async function thinkV4(brain, message, avatar, history, language, userId, conversationId, mediaData = {}, isAdmin = false) {
    brain.conversationCount++;
    const startTime = Date.now();
    brain._currentMediaData = mediaData || {};

    try {
        // ── 1. Quota check ──
        const quota = await brain.checkQuota(userId);
        if (!quota.allowed) {
            const upgradeMsg = language === "ro"
                ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează pentru mai multe mesaje! 🚀`
                : `You've reached your ${quota.limit} messages/month limit on ${quota.plan.toUpperCase()}. Upgrade for more! 🚀`;
            return { enrichedMessage: upgradeMsg, toolsUsed: [], monitor: { content: null, type: null }, analysis: { complexity: "simple", language }, thinkTime: Date.now() - startTime, confidence: 1.0 };
        }

        // ── 2. Load memory + profile (parallel) ──
        const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
            brain.loadMemory(userId, "text", 20, message),
            brain.loadMemory(userId, "visual", 5, message),
            brain.loadMemory(userId, "audio", 5, message),
            brain.loadFacts(userId, 20),
            brain._loadProfileCached(userId),
        ]);
        const memoryContext = brain.buildMemoryContext(memories, visualMem, audioMem, facts);
        const profileContext = profile ? profile.toContextString() : "";

        // ── 3. Emotion detection (fast, no AI needed) ──
        const lower = message.toLowerCase();
        let emotionalTone = "neutral";
        let emotionHint = "";
        for (const [emo, { pattern, responseHint }] of Object.entries(brain.constructor.EMOTION_MAP || {})) {
            if (pattern.test(lower)) {
                emotionalTone = emo;
                emotionHint = responseHint || "";
                break;
            }
        }
        const frustration = brain.constructor.detectFrustration ? brain.constructor.detectFrustration(message) : 0;
        if (frustration > 0.6) {
            emotionHint = "User is very frustrated. Be patient, acknowledge the issue, provide solutions quickly.";
        }

        // ── 4. Build system prompt with FULL context ──
        const memoryBlock = [profileContext, memoryContext].filter(Boolean).join(" || ");
        const emotionBlock = emotionHint ? `\n[EMOTIONAL CONTEXT] User mood: ${emotionalTone}. ${emotionHint}` : "";
        const systemPrompt = buildSystemPrompt(avatar, language, memoryBlock + emotionBlock, "", null);

        // ── 5. Prepare messages for Claude ──
        // Compress history to last 20 messages max
        const recentHistory = (history || []).slice(-20).map(h => ({
            role: h.role === "user" ? "user" : "assistant",
            content: typeof h.content === "string" ? h.content : JSON.stringify(h.content),
        }));

        // Handle vision: if image is provided, add it to the message
        const userContent = [];
        if (mediaData.imageBase64) {
            userContent.push({
                type: "image",
                source: { type: "base64", media_type: mediaData.imageMimeType || "image/jpeg", data: mediaData.imageBase64 },
            });
        }
        userContent.push({ type: "text", text: message });

        const claudeMessages = [...recentHistory, { role: "user", content: userContent.length === 1 ? message : userContent }];

        // ── 6. CALL CLAUDE WITH TOOLS ──
        // First call: Claude decides what tools to use
        let toolsUsed = [];
        let toolResults = [];
        let finalResponse = "";
        let totalTokens = 0;
        const MAX_TOOL_ROUNDS = 3; // Prevent infinite loops

        let currentMessages = claudeMessages;

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
            const claudeBody = {
                model: MODELS.ANTHROPIC_CHAT,
                max_tokens: 2048,
                system: systemPrompt,
                messages: currentMessages,
                tools: TOOL_DEFINITIONS,
            };

            const r = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": brain.anthropicKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify(claudeBody),
            });

            if (!r.ok) {
                const errText = await r.text().catch(() => "unknown");
                throw new Error(`Claude API ${r.status}: ${errText.substring(0, 200)}`);
            }

            const response = await r.json();
            totalTokens += (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

            // Check stop reason
            if (response.stop_reason === "end_turn" || response.stop_reason !== "tool_use") {
                // Claude finished — extract text response
                finalResponse = response.content
                    .filter(b => b.type === "text")
                    .map(b => b.text)
                    .join("\n");
                break;
            }

            // Claude wants to use tools
            const toolUseBlocks = response.content.filter(b => b.type === "tool_use");
            if (toolUseBlocks.length === 0) {
                finalResponse = response.content.filter(b => b.type === "text").map(b => b.text).join("\n");
                break;
            }

            // Execute all requested tools in parallel
            const toolPromises = toolUseBlocks.map(async (block) => {
                const result = await executeTool(brain, block.name, block.input, userId);
                toolsUsed.push(block.name);
                toolResults.push({ name: block.name, result });
                brain.toolStats[block.name] = (brain.toolStats[block.name] || 0) + 1;
                return {
                    type: "tool_result",
                    tool_use_id: block.id,
                    content: typeof result === "string" ? result : JSON.stringify(result).substring(0, 4000),
                };
            });

            const toolResultBlocks = await Promise.all(toolPromises);

            // Add assistant response + tool results to conversation
            currentMessages = [
                ...currentMessages,
                { role: "assistant", content: response.content },
                { role: "user", content: toolResultBlocks },
            ];
        }

        // ── 7. Post-processing ──
        const thinkTime = Date.now() - startTime;

        // Save memory (async, non-blocking)
        brain.saveMemory(userId, "text", message, { response: finalResponse.substring(0, 200) }, 5).catch(() => { });
        brain.learnFromConversation(userId, message, finalResponse).catch(() => { });
        if (profile) {
            profile.updateFromConversation(message, language, { emotionalTone, topics: [] });
            profile.save(brain.supabaseAdmin).catch(() => { });
        }

        // Track usage
        brain.incrementUsage(userId, toolsUsed.length, totalTokens).catch(() => { });

        // Confidence
        let confidence = 0.7;
        if (toolsUsed.length > 0) confidence += 0.15;
        if (toolsUsed.length > 2) confidence += 0.1;
        confidence = Math.min(1.0, confidence);

        logger.info(
            { component: "BrainV4", tools: toolsUsed, rounds: toolResults.length, thinkTime, tokens: totalTokens },
            `🧠 V4 Think: ${toolsUsed.length} tools | ${thinkTime}ms | ${totalTokens} tokens`,
        );

        return {
            enrichedMessage: finalResponse,
            enrichedContext: finalResponse,
            toolsUsed,
            monitor: extractMonitor(toolResults),
            analysis: {
                complexity: toolsUsed.length > 1 ? "complex" : "simple",
                emotionalTone,
                language: language || "ro",
                topics: [],
                isEmotional: emotionalTone !== "neutral",
                frustrationLevel: frustration,
            },
            chainOfThought: null, // Claude does it internally
            compressedHistory: recentHistory,
            failedTools: toolResults.filter(r => r.result?.error).map(r => r.name),
            thinkTime,
            confidence,
            sourceTags: toolsUsed.length > 0 ? ["VERIFIED", ...toolsUsed.map(t => `SOURCE:${t}`)] : ["ASSUMPTION"],
            agent: "v4-claude-tools",
            profileLoaded: !!profile,
        };
    } catch (e) {
        const thinkTime = Date.now() - startTime;
        brain.recordError("thinkV4", e.message);
        logger.error({ component: "BrainV4", err: e.message, thinkTime }, `🧠 V4 Think failed: ${e.message}`);

        // FALLBACK to v3 think
        logger.info({ component: "BrainV4" }, "⚠️ Falling back to v3 think");
        try {
            return await brain.think(message, avatar, history, language, userId, conversationId, mediaData, isAdmin);
        } catch (e2) {
            return {
                enrichedMessage: message,
                toolsUsed: [],
                monitor: { content: null, type: null },
                analysis: { complexity: "simple", language: language || "ro", emotionalTone: "neutral", topics: [] },
                chainOfThought: null,
                compressedHistory: history || [],
                failedTools: [],
                thinkTime,
                confidence: 0.3,
            };
        }
    }
}

module.exports = { thinkV4, TOOL_DEFINITIONS };
