// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v4.0
// GEMINI TOOL CALLING — No more 5-layer pipeline
// Gemini decides which tools to call, executes them, responds directly
// ═══════════════════════════════════════════════════════════════
'use strict';

const logger = require('./logger');
const { MODELS } = require('./config/models');
const { buildSystemPrompt, buildNewbornPrompt } = require('./persona');
const { getPatternsText, recordUserInteraction, getProactiveSuggestion } = require('./k1-meta-learning');
const { selfEvaluate, getQualityHints } = require('./k1-performance');
const vm = require('vm');

// ── Tool Definitions for Gemini (functionDeclarations format) ──
// Converter: transforms existing input_schema to Gemini parameters format
function toGeminiTools(defs) {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.input_schema,
  }));
}

// ── Tool Definitions (shared format — converted at API call time) ──
const TOOL_DEFINITIONS = [
  {
    name: 'search_web',
    description:
      'Search the internet for current, real-time information. Use for news, facts, prices, events, people, anything requiring up-to-date data.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "The search query in the user's language",
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_weather',
    description: 'Get current weather and forecast for a city.',
    input_schema: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: "City name, e.g. 'București', 'London'",
        },
      },
      required: ['city'],
    },
  },
  {
    name: 'generate_image',
    description: 'Generate an image from a text description using AI (DALL-E).',
    input_schema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Detailed description of the image to generate, in English',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'play_radio',
    description:
      'Play a live radio station. Available: Kiss FM, Europa FM, Radio ZU, Digi FM, Magic FM, Rock FM, Pro FM, Virgin Radio, Gold FM, Radio Guerrilla, Romantic FM, BBC, CNN, Jazz FM, Classical, Chill, Lo-Fi, Dance, Electronica, Ambient.',
    input_schema: {
      type: 'object',
      properties: {
        station: {
          type: 'string',
          description: "Station name like 'Kiss FM', 'Europa FM', 'Jazz FM', 'Lo-fi'",
        },
      },
      required: ['station'],
    },
  },
  {
    name: 'play_video',
    description: "Search and play a video (YouTube, Netflix, etc.) on the user's screen.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "What to search for, e.g. 'relaxing music', 'cat videos'",
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_website',
    description: "Open a website or web page on the user's screen/monitor.",
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'Full URL or search term to navigate to',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'get_news',
    description: 'Get latest news articles, optionally filtered by topic.',
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: "News topic: 'general', 'tech', 'business', 'sports', 'science', 'health'",
        },
      },
      required: ['topic'],
    },
  },
  {
    name: 'check_system_health',
    description: 'Check the health status of all KelionAI systems, APIs, and services.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_trading_intelligence',
    description: 'Get cryptocurrency/stock trading analysis, signals, and market intelligence.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'show_map',
    description: 'Show a location on Google Maps.',
    input_schema: {
      type: 'object',
      properties: {
        place: { type: 'string', description: 'Place name or address' },
      },
      required: ['place'],
    },
  },
  {
    name: 'get_legal_info',
    description: 'Get legal information: terms of service, privacy policy, GDPR, refund policy.',
    input_schema: {
      type: 'object',
      properties: {
        document: {
          type: 'string',
          description: "Which document: 'terms', 'privacy', 'gdpr', 'refund', 'cookie'",
        },
      },
      required: ['document'],
    },
  },
  {
    name: 'recall_memory',
    description: 'Recall what you remember about the user from past conversations.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  // ═══ PROGRAMMING TOOLS ═══
  {
    name: 'execute_javascript',
    description:
      'Execute JavaScript code in a sandboxed environment and return the result. Use for calculations, data processing, sorting, transformations, algorithm testing. Timeout: 3 seconds. No file system or network access.',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute. Must return a value or use /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* /* console.log() (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */ (removed) */.',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'database_query',
    description:
      'Query the Supabase/PostgreSQL database. Read-only SELECT queries. Tables: users, conversations, messages, user_preferences, brain_memory, subscriptions, api_keys, media_log, trades.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Table name to query' },
        select: {
          type: 'string',
          description: "Columns to select, e.g. 'id, name, created_at'",
        },
        filters: {
          type: 'string',
          description: "Filter conditions, e.g. 'status=active' or 'created_at>2024-01-01'",
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default 10, max 50)',
        },
      },
      required: ['table'],
    },
  },
  // ═══ ELECTRONIC & DEFECTOSCOPY TOOLS ═══
  {
    name: 'analyze_schematic',
    description:
      'Analyze an electronic circuit schematic from an uploaded image. Identifies components (resistors, capacitors, ICs, transistors), traces signal paths, calculates power consumption, finds potential issues (short circuits, missing decoupling caps, wrong values). Requires an image to be uploaded.',
    input_schema: {
      type: 'object',
      properties: {
        focus: {
          type: 'string',
          description:
            "What to focus on: 'full_analysis', 'component_list', 'signal_path', 'power_analysis', 'error_check', 'improvement_suggestions'",
        },
      },
      required: ['focus'],
    },
  },
  {
    name: 'defect_analysis',
    description:
      'Analyze images for defects using non-destructive testing (NDT) principles. Supports: X-ray images, ultrasound scans, thermal images, visual inspection photos. Identifies cracks, voids, corrosion, delamination, porosity, inclusions. Requires an image to be uploaded.',
    input_schema: {
      type: 'object',
      properties: {
        material: {
          type: 'string',
          description: "Material type: 'metal', 'composite', 'ceramic', 'plastic', 'weld', 'pcb', 'unknown'",
        },
        method: {
          type: 'string',
          description: "NDT method: 'visual', 'xray', 'ultrasound', 'thermal', 'magnetic', 'eddy_current'",
        },
      },
      required: ['method'],
    },
  },
  {
    name: 'component_lookup',
    description:
      'Search for electronic component datasheets and specifications. Find pinouts, max ratings, package types, alternatives, and pricing.',
    input_schema: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          description: "Component name or part number, e.g. 'LM7805', 'ATmega328', '100nF capacitor'",
        },
        info: {
          type: 'string',
          description: "What info: 'datasheet', 'pinout', 'alternatives', 'specs', 'pricing'",
        },
      },
      required: ['component'],
    },
  },
  // ═══ MEDICAL / MRI / CANCER RESEARCH TOOLS ═══
  {
    name: 'analyze_medical_image',
    description:
      'Analyze medical imaging (MRI/RMN, CT, PET, X-ray, ultrasound) for educational and research purposes. Identifies anatomical structures, highlights anomalies, measures dimensions. ⚠️ NOT a medical diagnosis — for research/educational use only. Requires an image to be uploaded.',
    input_schema: {
      type: 'object',
      properties: {
        modality: {
          type: 'string',
          description: "Imaging modality: 'mri', 'ct', 'pet', 'xray', 'ultrasound', 'mammography'",
        },
        body_region: {
          type: 'string',
          description:
            "Body region: 'brain', 'chest', 'abdomen', 'pelvis', 'spine', 'extremity', 'breast', 'head_neck'",
        },
        focus: {
          type: 'string',
          description: "Analysis focus: 'anatomy', 'anomaly_detection', 'measurements', 'comparison', 'full_report'",
        },
      },
      required: ['modality'],
    },
  },
  {
    name: 'pubmed_search',
    description:
      'Search PubMed for medical research articles, clinical trials, drug studies. Returns titles, abstracts, authors, and DOI links. Use for evidence-based medical information.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: "Search query, e.g. 'BRCA1 breast cancer treatment 2024', 'MRI glioblastoma detection'",
        },
        max_results: {
          type: 'number',
          description: 'Max results (default 5, max 20)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'dose_calculator',
    description:
      'Radiotherapy dose calculations for educational purposes. Calculates: absorbed dose, equivalent dose, effective dose, treatment fractionation, decay corrections. ⚠️ NOT for clinical use.',
    input_schema: {
      type: 'object',
      properties: {
        calculation: {
          type: 'string',
          description:
            "Type: 'absorbed_dose', 'equivalent_dose', 'effective_dose', 'fractionation', 'decay', 'inverse_square'",
        },
        parameters: {
          type: 'string',
          description:
            'JSON string with calculation parameters, e.g. \'{"dose_per_fraction": 2, "fractions": 30, "tissue": "tumor"}\'',
        },
      },
      required: ['calculation', 'parameters'],
    },
  },
  // ═══ OSCILLOSCOPE & SPECTROMETER & ENGINEERING TOOLS ═══
  {
    name: 'analyze_oscilloscope',
    description:
      'Analyze oscilloscope screenshots/waveforms. Measures: frequency, amplitude, rise/fall time, duty cycle, phase shift, noise level, signal integrity (overshoot, ringing, jitter). Identifies signal types (sine, square, PWM, I2C, SPI, UART). Requires an image to be uploaded.',
    input_schema: {
      type: 'object',
      properties: {
        channels: {
          type: 'string',
          description: "Number of channels visible: '1', '2', '4'",
        },
        expected_signal: {
          type: 'string',
          description:
            "What the signal should be: 'sine', 'square', 'pwm', 'i2c', 'spi', 'uart', 'analog', 'power_supply', 'unknown'",
        },
        focus: {
          type: 'string',
          description:
            "Analysis focus: 'frequency', 'amplitude', 'timing', 'noise', 'signal_integrity', 'protocol_decode', 'full_analysis', 'compare_channels'",
        },
      },
      required: ['focus'],
    },
  },
  {
    name: 'analyze_spectrometer',
    description:
      'Analyze spectrometer data/screenshots. Supports: optical emission spectroscopy (OES), mass spectrometry, UV-Vis, infrared (IR/FTIR), Raman, X-ray fluorescence (XRF), gamma spectroscopy. Identifies peaks, wavelengths, elements, compounds. Requires an image or data.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            "Spectrometer type: 'oes', 'mass', 'uv_vis', 'ir', 'ftir', 'raman', 'xrf', 'gamma', 'nmr', 'unknown'",
        },
        analysis: {
          type: 'string',
          description:
            "What to analyze: 'peak_identification', 'element_identification', 'compound_identification', 'concentration', 'quality_check', 'full_analysis'",
        },
        sample: {
          type: 'string',
          description:
            "Sample type if known: 'metal', 'organic', 'polymer', 'pharmaceutical', 'environmental', 'biological', 'unknown'",
        },
      },
      required: ['type', 'analysis'],
    },
  },
  {
    name: 'circuit_improvement',
    description:
      'Suggest improvements to an electronic circuit design. Analyzes for: efficiency, EMI/EMC compliance, thermal management, component selection, cost optimization, reliability, safety standards (IEC, CE, UL). Can work from schematic image or text description.',
    input_schema: {
      type: 'object',
      properties: {
        circuit_type: {
          type: 'string',
          description:
            "Circuit type: 'power_supply', 'amplifier', 'filter', 'digital', 'mixed_signal', 'rf', 'motor_driver', 'sensor_interface', 'medical_device', 'other'",
        },
        goal: {
          type: 'string',
          description:
            "Improvement goal: 'efficiency', 'noise_reduction', 'cost', 'reliability', 'size', 'safety', 'emc', 'thermal', 'all'",
        },
        constraints: {
          type: 'string',
          description: "Design constraints, e.g. 'max 5V, <100mA, medical grade, -20 to +70C'",
        },
      },
      required: ['circuit_type', 'goal'],
    },
  },
  {
    name: 'create_technical_manual',
    description:
      'Generate or update a technical manual/documentation. Creates structured documents with: specifications, measurement procedures, acceptance criteria, limits, calibration data, maintenance schedules. Stores in database for versioning.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Action: 'create', 'update', 'add_section', 'add_measurement', 'export'",
        },
        title: {
          type: 'string',
          description: "Manual title, e.g. 'Linear Accelerator QA Protocol', 'MRI Daily Checks'",
        },
        section: {
          type: 'string',
          description:
            "Section to create/update: 'specifications', 'procedures', 'limits', 'calibration', 'maintenance', 'troubleshooting', 'safety'",
        },
        content: {
          type: 'string',
          description: 'Content to add: measurement results, limits, procedures, notes',
        },
      },
      required: ['action', 'title'],
    },
  },
  {
    name: 'measurement_log',
    description:
      'Log, track, and analyze measurements over time. Records values with timestamps, checks against limits (pass/fail), tracks trends, generates calibration reports. Supports any measurement type (voltage, current, dose, temperature, frequency, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Action: 'record', 'check_limits', 'trend', 'report', 'history', 'calibration'",
        },
        equipment: {
          type: 'string',
          description: "Equipment name/ID, e.g. 'Linac-1', 'MRI-Siemens-3T', 'Osciloscop-Rigol'",
        },
        parameter: {
          type: 'string',
          description: "What was measured: 'output_dose', 'voltage', 'frequency', 'temperature', 'field_uniformity'",
        },
        value: { type: 'number', description: 'Measured value' },
        unit: {
          type: 'string',
          description: "Unit: 'Gy', 'mV', 'MHz', '°C', 'mA', '%'",
        },
        limit_min: { type: 'number', description: 'Minimum acceptable value' },
        limit_max: { type: 'number', description: 'Maximum acceptable value' },
      },
      required: ['action', 'equipment'],
    },
  },
  // ═══ OFFICE / SECRETARY TOOLS ═══
  {
    name: 'send_email',
    description:
      'Compose and send an email. Can draft, review, or send immediately. Supports HTML formatting, attachments description, CC/BCC. Requires RESEND_API_KEY or SMTP configured.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Action: 'draft' (preview), 'send' (send now), 'reply' (reply to last)",
        },
        to: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body (can include HTML)' },
        cc: { type: 'string', description: 'CC recipients (comma separated)' },
        priority: {
          type: 'string',
          description: "Priority: 'high', 'normal', 'low'",
        },
      },
      required: ['action', 'to', 'subject', 'body'],
    },
  },
  {
    name: 'manage_calendar',
    description:
      'Manage calendar events and appointments. Create, list, update, delete events. Set reminders. Check availability. Find free slots.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Action: 'create', 'list', 'update', 'delete', 'today', 'week', 'find_free', 'remind'",
        },
        title: { type: 'string', description: 'Event title' },
        date: {
          type: 'string',
          description: "Date: 'YYYY-MM-DD' or 'today', 'tomorrow', 'monday'",
        },
        time: { type: 'string', description: "Time: 'HH:MM' (24h format)" },
        duration: {
          type: 'number',
          description: 'Duration in minutes (default 60)',
        },
        location: { type: 'string', description: 'Meeting location or URL' },
        notes: { type: 'string', description: 'Additional notes' },
        recurring: {
          type: 'string',
          description: "Recurrence: 'daily', 'weekly', 'monthly', 'none'",
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'create_document',
    description:
      'Create professional documents: letters, memos, reports, invoices, proposals, contracts, meeting minutes, certificates. Generates structured, formatted content ready to export.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            "Document type: 'letter', 'memo', 'report', 'invoice', 'proposal', 'contract', 'minutes', 'certificate', 'cv', 'cover_letter'",
        },
        title: { type: 'string', description: 'Document title' },
        recipient: { type: 'string', description: 'Who the document is for' },
        content: {
          type: 'string',
          description: 'Key content/details to include',
        },
        language: {
          type: 'string',
          description: "Language: 'ro', 'en', 'de', 'fr'",
        },
        format: {
          type: 'string',
          description: "Format: 'professional', 'formal', 'casual', 'legal'",
        },
      },
      required: ['type', 'title'],
    },
  },
  {
    name: 'task_manager',
    description:
      'Manage tasks and
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'add', 'list', 'complete', 'update', 'delete', 'prioritize', 'overdue', 'today', 'search'",
        },
        task: { type: 'string', description: 'Task description' },
        project: { type: 'string', description: 'Project/category name' },
        priority: {
          type: 'string',
          description: "Priority: 'urgent', 'high', 'medium', 'low'",
        },
        deadline: {
          type: 'string',
          description: "Deadline: 'YYYY-MM-DD' or 'today', 'tomorrow', 'next_week'",
        },
        assigned_to: { type: 'string', description: 'Who is responsible' },
        status: {
          type: 'string',
          description: "Status: 'todo', 'in_progress', 'done', 'blocked'",
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'contact_book',
    description:
      'Manage contacts and address book. Add, search, update, categorize contacts. Store phone, email, company, notes. Mini CRM functionality.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Action: 'add', 'search', 'update', 'delete', 'list', 'categorize'",
        },
        name: { type: 'string', description: 'Contact name' },
        phone: { type: 'string', description: 'Phone number' },
        email: { type: 'string', description: 'Email address' },
        company: { type: 'string', description: 'Company/organization' },
        category: {
          type: 'string',
          description: "Category: 'client', 'supplier', 'colleague', 'personal', 'medical', 'government'",
        },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['action'],
    },
  },
  {
    name: 'translate_document',
    description:
      'Translate text or documents between languages. Supports: Romanian, English, German, French, Spanish, Italian, Hungarian. Preserves formatting and technical terminology.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to translate' },
        from: {
          type: 'string',
          description: "Source language: 'ro', 'en', 'de', 'fr', 'es', 'it', 'hu', 'auto'",
        },
        to: {
          type: 'string',
          description: "Target language: 'ro', 'en', 'de', 'fr', 'es', 'it', 'hu'",
        },
        style: {
          type: 'string',
          description: "Style: 'formal', 'casual', 'technical', 'legal', 'medical'",
        },
      },
      required: ['text', 'to'],
    },
  },
  {
    name: 'summarize_document',
    description:
      'Summarize long documents, emails, reports, meeting notes. Extract key points, action items, decisions, deadlines.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to summarize' },
        style: {
          type: 'string',
          description: "Style: 'bullet_points', 'executive_summary', 'action_items', 'key_decisions', 'full'",
        },
        length: {
          type: 'string',
          description: "Length: 'short' (1-3 sentences), 'medium' (paragraph), 'detailed' (full page)",
        },
      },
      required: ['text', 'style'],
    },
  },
  // ═══ DRAWING & MS OFFICE TOOLS ═══
  {
    name: 'draw_diagram',
    description:
      'Create technical drawings, diagrams, flowcharts, circuit schematics, UML, organizational charts, network diagrams, Gantt charts. Generates Mermaid diagram code or SVG description. Can also analyze and improve uploaded diagrams.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description:
            "Diagram type: 'flowchart', 'circuit', 'sequence', 'class', 'state', 'er', 'gantt', 'pie', 'network', 'org_chart', 'mind_map', 'block_diagram', 'pcb_layout', 'wiring_diagram'",
        },
        description: {
          type: 'string',
          description: 'What the diagram should show',
        },
        action: {
          type: 'string',
          description: "Action: 'create', 'modify', 'analyze' (if image uploaded)",
        },
        style: {
          type: 'string',
          description: "Style: 'technical', 'simple', 'detailed', 'presentation'",
        },
      },
      required: ['type', 'description'],
    },
  },
  {
    name: 'create_spreadsheet',
    description:
      'Generate spreadsheet data compatible with Excel/Google Sheets. Creates tables, calculations, formulas, data analysis. Outputs CSV or structured data. Can create: budgets, inventories, measurement logs, price lists, schedules, grade books, financial reports.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Spreadsheet title' },
        type: {
          type: 'string',
          description:
            "Type: 'budget', 'inventory', 'schedule', 'price_list', 'measurement_log', 'financial', 'grades', 'timesheet', 'custom'",
        },
        columns: {
          type: 'string',
          description: 'Column names, comma separated',
        },
        data: {
          type: 'string',
          description: 'Data to include or instructions for generating data',
        },
        formulas: {
          type: 'string',
          description: "Excel formulas or calculations needed: 'SUM', 'AVERAGE', 'total', 'subtotals'",
        },
      },
      required: ['title', 'type'],
    },
  },
  {
    name: 'create_presentation',
    description:
      'Generate presentation outlines and content for PowerPoint/Google Slides. Creates slide structure with titles, bullet points, speaker notes. Can generate for: business, technical, medical, educational, project updates.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Presentation title' },
        topic: {
          type: 'string',
          description: 'Main topic and key points to cover',
        },
        slides: {
          type: 'number',
          description: 'Number of slides (default 10)',
        },
        audience: {
          type: 'string',
          description: "Target audience: 'executives', 'technical', 'students', 'clients', 'medical_staff'",
        },
        style: {
          type: 'string',
          description: "Style: 'professional', 'educational', 'pitch', 'report', 'training'",
        },
        language: {
          type: 'string',
          description: "Language: 'ro', 'en', 'de', 'fr'",
        },
      },
      required: ['title', 'topic'],
    },
  },
  {
    name: 'file_converter',
    description:
      'Convert between formats: text to HTML, markdown to HTML, CSV to table, JSON to table, numbers to chart data. Format data for different outputs.',
    input_schema: {
      type: 'object',
      properties: {
        input_format: {
          type: 'string',
          description: "Input format: 'text', 'markdown', 'csv', 'json', 'html', 'table'",
        },
        output_format: {
          type: 'string',
          description: "Output format: 'html', 'markdown', 'csv', 'json', 'table', 'excel_formula'",
        },
        data: { type: 'string', description: 'Data to convert' },
      },
      required: ['input_format', 'output_format', 'data'],
    },
  },
  // ═══ CAMERA / VISION / R&D INSPECTION TOOLS ═══
  {
    name: 'pcb_inspection',
    description:
      'Inspect PCB (printed circuit board) from camera/photo. Detects: cold solder joints, solder bridges, missing components, tombstoning, wrong polarity, damaged traces, via issues, contamination. Quality classes: IPC-A-610 Class 1/2/3. Requires image upload.',
    input_schema: {
      type: 'object',
      properties: {
        board_type: {
          type: 'string',
          description: "Board type: 'smt', 'through_hole', 'mixed', 'bga', 'flex', 'rigid_flex'",
        },
        class: {
          type: 'string',
          description: "IPC class: 'class1' (consumer), 'class2' (industrial), 'class3' (high-rel/medical/military)",
        },
        focus: {
          type: 'string',
          description:
            "Focus: 'solder_quality', 'component_placement', 'trace_integrity', 'contamination', 'full_inspection'",
        },
      },
      required: ['focus'],
    },
  },
  {
    name: 'thermal_analysis',
    description:
      'Analyze thermal camera images. Identifies: hotspots, cold spots, thermal gradients, insulation failures, overheating components, electrical faults. For: electronics, building inspection, mechanical, medical thermography. Requires thermal image upload.',
    input_schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: "Domain: 'electronics', 'building', 'mechanical', 'electrical', 'medical', 'solar_panel'",
        },
        focus: {
          type: 'string',
          description:
            "Focus: 'hotspot_detection', 'thermal_gradient', 'insulation', 'overheating', 'comparison', 'full_analysis'",
        },
        max_temp: {
          type: 'number',
          description: 'Maximum acceptable temperature in °C',
        },
      },
      required: ['domain', 'focus'],
    },
  },
  {
    name: 'microscope_analysis',
    description:
      'Analyze microscope images. Supports: optical microscopy, SEM, TEM, fluorescence, metallurgical. Identifies: grain structure, defects, contamination, dimensions, surface topology, crystallography. For: materials science, biology, electronics, quality control.',
    input_schema: {
      type: 'object',
      properties: {
        microscope_type: {
          type: 'string',
          description: "Type: 'optical', 'sem', 'tem', 'fluorescence', 'metallurgical', 'stereo', 'confocal'",
        },
        sample: {
          type: 'string',
          description: "Sample type: 'metal', 'semiconductor', 'biological', 'polymer', 'ceramic', 'composite', 'pcb'",
        },
        magnification: {
          type: 'string',
          description: "Magnification level if known: '10x', '100x', '1000x', '10000x'",
        },
        focus: {
          type: 'string',
          description:
            "Focus: 'grain_structure', 'defect_detection', 'measurement', 'surface_analysis', 'contamination', 'full_analysis'",
        },
      },
      required: ['microscope_type', 'focus'],
    },
  },
  {
    name: 'visual_quality_check',
    description:
      'Visual quality inspection from camera/photo. Checks: surface finish, dimensional accuracy, assembly quality, paint/coating, packaging, labeling. Returns PASS/FAIL with defect list. For manufacturing QC, incoming inspection, outgoing inspection.',
    input_schema: {
      type: 'object',
      properties: {
        product_type: {
          type: 'string',
          description:
            "Product type: 'electronic_device', 'mechanical_part', 'medical_device', 'packaging', 'assembly', 'raw_material'",
        },
        standard: {
          type: 'string',
          description: "Quality standard: 'iso9001', 'iec62368', 'iec60601' (medical), 'mil_std', 'custom'",
        },
        criteria: {
          type: 'string',
          description: 'Inspection criteria or checklist items',
        },
      },
      required: ['product_type'],
    },
  },
  {
    name: 'compare_images',
    description:
      'Compare two states of the same item: before/after repair, golden sample vs production, reference vs actual. Identifies differences, deviations, changes. For QC, repair verification, reverse engineering.',
    input_schema: {
      type: 'object',
      properties: {
        context: {
          type: 'string',
          description: "Context: 'before_after', 'golden_vs_production', 'reference_vs_actual', 'revision_comparison'",
        },
        focus: {
          type: 'string',
          description: "What to compare: 'dimensions', 'components', 'surface', 'color', 'layout', 'full'",
        },
      },
      required: ['context'],
    },
  },
  // ═══ EDUCATION / TEACHING TOOLS ═══
  {
    name: 'quiz_generator',
    description:
      'Generate tests, quizzes, and exams for any subject and level. Supports: Romanian curriculum (școală, liceu, BAC, admitere), international (GCSE, A-Level, AP, IB, SAT). Subjects: math, physics, chemistry, biology, Romanian, English, history, geography, IT/CS. Generates questions with answers and grading rubric.',
    input_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description:
            "Subject: 'matematica', 'fizica', 'chimie', 'biologie', 'romana', 'engleza', 'istorie', 'geografie', 'informatica', 'math', 'physics', 'chemistry', 'biology', 'english', 'history', 'computer_science'",
        },
        level: {
          type: 'string',
          description:
            "Level: 'clasa5-8', 'clasa9-12', 'bac', 'admitere', 'gcse', 'a_level', 'ap', 'ib', 'university', 'masters'",
        },
        topic: {
          type: 'string',
          description: "Specific topic, e.g. 'Ecuatii de gradul 2', 'Legile lui Newton', 'Romantismul'",
        },
        question_count: {
          type: 'number',
          description: 'Number of questions (default 10)',
        },
        type: {
          type: 'string',
          description:
            "Question type: 'multiple_choice', 'open_ended', 'true_false', 'fill_blank', 'essay', 'mixed', 'problems'",
        },
        difficulty: {
          type: 'string',
          description: "Difficulty: 'easy', 'medium', 'hard', 'exam_level'",
        },
        include_answers: {
          type: 'boolean',
          description: 'Include answer key (default true)',
        },
      },
      required: ['subject', 'level', 'topic'],
    },
  },
  {
    name: 'grade_book',
    description:
      'Manage student grades, calculate averages, generate reports. Digital catalog. Tracks: note, absențe, medii semestriale/anuale, clasament, statistici. For teachers and students.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'add_grade', 'add_absence', 'calculate_average', 'report', 'ranking', 'statistics', 'list'",
        },
        student: { type: 'string', description: 'Student name' },
        subject: { type: 'string', description: 'Subject name' },
        grade: {
          type: 'number',
          description: 'Grade (1-10 for RO, 0-100 for international)',
        },
        date: { type: 'string', description: 'Date: YYYY-MM-DD' },
        semester: {
          type: 'string',
          description: "Semester: '1', '2', 'annual'",
        },
        class_name: {
          type: 'string',
          description: "Class: '9A', '11B', 'Year 10'",
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'lesson_planner',
    description:
      'Create lesson plans (‘planuri de lecție’) following Romanian curriculum (OMEN) or international standards. Includes: objectives, activities, timing, materials, assessment, differentiation. Can generate annual/semester plans, unit plans, daily plans.',
    input_schema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          description: "Plan type: 'daily', 'unit', 'semester', 'annual'",
        },
        subject: { type: 'string', description: 'Subject' },
        grade_level: {
          type: 'string',
          description: "Grade: 'clasa1', 'clasa5', 'clasa9', 'year7', 'grade10'",
        },
        topic: { type: 'string', description: 'Topic or unit' },
        duration: {
          type: 'number',
          description: 'Duration in minutes (default 50)',
        },
        curriculum: {
          type: 'string',
          description: "Curriculum: 'romania', 'uk', 'us', 'ib', 'cambridge'",
        },
        language: {
          type: 'string',
          description: "Language: 'ro', 'en', 'de', 'fr', 'hu'",
        },
      },
      required: ['subject', 'grade_level', 'topic'],
    },
  },
  {
    name: 'flashcards',
    description:
      'Create flashcard sets for spaced repetition learning. Generate cards from any topic, track progress, test knowledge. Supports any language and subject.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Action: 'create', 'review', 'test', 'list', 'stats'",
        },
        set_name: { type: 'string', description: 'Flashcard set name' },
        topic: { type: 'string', description: 'Topic to create cards for' },
        count: {
          type: 'number',
          description: 'Number of cards to generate (default 20)',
        },
        language: {
          type: 'string',
          description: "Language: 'ro', 'en', 'de', 'fr'",
        },
        difficulty: {
          type: 'string',
          description: "Difficulty: 'beginner', 'intermediate', 'advanced'",
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'exercise_generator',
    description:
      'Generate practice exercises and problems with step-by-step solutions. Math, physics, chemistry calculations with full working. From simple arithmetic to university-level problems. Shows methodology and formulas used.',
    input_schema: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: "Subject: 'math', 'physics', 'chemistry', 'engineering', 'electronics', 'statistics'",
        },
        topic: {
          type: 'string',
          description: "Topic, e.g. 'integrals', 'circuit analysis', 'stoichiometry', 'beam deflection'",
        },
        count: {
          type: 'number',
          description: 'Number of exercises (default 5)',
        },
        difficulty: {
          type: 'string',
          description: "Difficulty: 'easy', 'medium', 'hard', 'competition', 'olympiad'",
        },
        show_solution: {
          type: 'boolean',
          description: 'Include step-by-step solutions (default true)',
        },
        level: {
          type: 'string',
          description: "Level: 'school', 'highschool', 'university', 'postgrad'",
        },
      },
      required: ['subject', 'topic'],
    },
  },
  // ═══ LEGAL / JURIDIC ═══
  {
    name: 'legal_consultant',
    description:
      'Legal consultation tool. Romanian law (Cod Civil, Cod Penal, Codul Muncii, GDPR, OUG), EU law, international. Drafts contracts, analyzes clauses, explains legal terms. ⚠️ For informational purposes only, not legal advice.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'explain_law', 'draft_contract', 'analyze_contract', 'rights', 'procedure', 'deadline', 'template'",
        },
        domain: {
          type: 'string',
          description:
            "Legal domain: 'civil', 'penal', 'muncii', 'comercial', 'fiscal', 'gdpr', 'proprietate', 'familie', 'administrativ'",
        },
        question: {
          type: 'string',
          description: 'Legal question or document to analyze',
        },
        jurisdiction: {
          type: 'string',
          description: "Jurisdiction: 'romania', 'eu', 'us', 'uk', 'germany'",
        },
      },
      required: ['action', 'question'],
    },
  },
  // ═══ FINANCE / ACCOUNTING ═══
  {
    name: 'financial_calculator',
    description:
      'Financial calculations: loan/mortgage calculator, compound interest, ROI, NPV, IRR, depreciation, tax estimation, currency conversion, inflation adjustment. Supports RON, EUR, USD, GBP.',
    input_schema: {
      type: 'object',
      properties: {
        calculation: {
          type: 'string',
          description:
            "Type: 'loan', 'mortgage', 'compound_interest', 'roi', 'npv', 'irr', 'depreciation', 'tax', 'currency', 'inflation', 'salary_net', 'vat'",
        },
        parameters: {
          type: 'string',
          description: 'JSON parameters, e.g. \'{"amount": 100000, "rate": 5.5, "years": 30, "currency": "RON"}\'',
        },
      },
      required: ['calculation', 'parameters'],
    },
  },
  // ═══ AUTOMOTIVE ═══
  {
    name: 'car_diagnostic',
    description:
      'Car diagnostic helper. Decode OBD-II error codes, diagnose symptoms, maintenance schedules, repair estimates, technical specs lookup. Works with any car make/model.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'decode_obd', 'diagnose_symptom', 'maintenance', 'specs', 'recall', 'repair_estimate', 'fluid_specs'",
        },
        code: {
          type: 'string',
          description: "OBD-II code, e.g. 'P0300', 'P0420', 'C0035'",
        },
        car: {
          type: 'string',
          description: "Car make/model/year, e.g. 'Dacia Duster 2022', 'BMW 320d 2019'",
        },
        symptom: {
          type: 'string',
          description: "Symptom description, e.g. 'engine shaking at idle', 'squeaking brakes'",
        },
      },
      required: ['action'],
    },
  },
  // ═══ CYBERSECURITY ═══
  {
    name: 'security_audit',
    description:
      'Cybersecurity analysis tool. Check password strength, analyze URLs for phishing, review code for vulnerabilities, OWASP guidelines, security headers check, SSL/TLS analysis, data breach lookup.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'password_strength', 'phishing_check', 'code_review', 'headers_check', 'ssl_check', 'owasp', 'breach_check', 'encryption_advice'",
        },
        target: {
          type: 'string',
          description: 'URL, password, code snippet, or email to analyze',
        },
        context: {
          type: 'string',
          description: "Additional context, e.g. 'web application', 'api', 'mobile app', 'iot device'",
        },
      },
      required: ['action', 'target'],
    },
  },
  // ═══ ARCHITECTURE / CONSTRUCTION ═══
  {
    name: 'structural_calculator',
    description:
      'Architecture and construction calculations. Beam load, concrete mix, material quantities, energy efficiency rating (certificate energetic), cost estimation (deviz), surface area, volume calculations. Romanian building standards (CR-0, P100).',
    input_schema: {
      type: 'object',
      properties: {
        calculation: {
          type: 'string',
          description:
            "Type: 'beam_load', 'concrete_mix', 'material_quantity', 'energy_rating', 'cost_estimate', 'surface_area', 'foundation', 'insulation', 'electrical_load', 'plumbing'",
        },
        parameters: {
          type: 'string',
          description: 'JSON with dimensions, materials, loads, etc.',
        },
        standard: {
          type: 'string',
          description: "Standard: 'romania_cr0', 'eurocode', 'aci', 'bs'",
        },
      },
      required: ['calculation', 'parameters'],
    },
  },
  // ═══ MARKETING / SEO ═══
  {
    name: 'marketing_analyzer',
    description:
      'Marketing and SEO tool. Generate ad copy, social media posts, SEO analysis, keyword research, competitor analysis, A/B test ideas, email campaigns, brand naming, hashtag generation.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'seo_audit', 'keywords', 'ad_copy', 'social_post', 'email_campaign', 'competitor', 'brand_name', 'hashtags', 'content_calendar', 'ab_test'",
        },
        topic: { type: 'string', description: 'Product, service, or brand' },
        platform: {
          type: 'string',
          description: "Platform: 'google', 'facebook', 'instagram', 'tiktok', 'linkedin', 'youtube', 'twitter'",
        },
        audience: { type: 'string', description: 'Target audience' },
        language: {
          type: 'string',
          description: "Language: 'ro', 'en', 'de', 'fr'",
        },
      },
      required: ['action', 'topic'],
    },
  },
  // ═══ HEALTH / FITNESS ═══
  {
    name: 'health_tracker',
    description:
      'Health and fitness tracking. BMI, calorie needs, workout plans, body fat estimation, heart rate zones, hydration calculator, sleep analysis. Stores history in database. ⚠️ Not medical advice.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'bmi', 'calories', 'workout_plan', 'body_fat', 'heart_zones', 'hydration', 'sleep', 'log_weight', 'log_workout', 'progress'",
        },
        parameters: {
          type: 'string',
          description:
            'JSON: \'{"weight_kg": 80, "height_cm": 175, "age": 30, "gender": "M", "activity": "moderate"}\'',
        },
        goal: {
          type: 'string',
          description: "Goal: 'lose_weight', 'gain_muscle', 'maintain', 'endurance', 'flexibility'",
        },
      },
      required: ['action'],
    },
  },
  // ═══ COOKING / NUTRITION ═══
  {
    name: 'recipe_generator',
    description:
      'Generate recipes based on ingredients, diet restrictions, cuisine type. Calculates nutrition, scales portions, suggests substitutions. Supports Romanian, Mediterranean, Asian, etc.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: "Action: 'generate', 'scale', 'substitute', 'meal_plan', 'nutrition', 'shopping_list'",
        },
        ingredients: {
          type: 'string',
          description: 'Available ingredients, comma separated',
        },
        cuisine: {
          type: 'string',
          description: "Cuisine: 'romaneasca', 'italian', 'asian', 'mexican', 'french', 'mediterranean', 'any'",
        },
        diet: {
          type: 'string',
          description:
            "Diet: 'normal', 'vegetarian', 'vegan', 'keto', 'paleo', 'gluten_free', 'diabetic', 'low_sodium'",
        },
        servings: { type: 'number', description: 'Number of servings' },
      },
      required: ['action'],
    },
  },
  // ═══ MUSIC / AUDIO ═══
  {
    name: 'music_theory',
    description:
      'Music theory and audio analysis. Chord progressions, scale identification, key detection, tempo/BPM, song structure analysis, transposition, ear training exercises, music notation.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'chords', 'scales', 'key_detection', 'transpose', 'progression', 'tempo', 'ear_training', 'notation', 'song_structure'",
        },
        input: {
          type: 'string',
          description: 'Musical input: chord names, scale, notes, song title',
        },
        key: {
          type: 'string',
          description: "Musical key: 'C', 'Am', 'Eb', 'F#m'",
        },
        instrument: {
          type: 'string',
          description: "Instrument: 'piano', 'guitar', 'bass', 'ukulele', 'violin', 'any'",
        },
      },
      required: ['action'],
    },
  },
  // ═══ 3D PRINTING ═══
  {
    name: 'print3d_helper',
    description:
      '3D printing assistant. Material selection (PLA, ABS, PETG, TPU, Nylon, Resin), print settings optimizer, troubleshooting (stringing, warping, layer adhesion), cost estimation, STL analysis recommendations.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'material_select', 'settings', 'troubleshoot', 'cost_estimate', 'design_tips', 'compare_materials', 'post_processing'",
        },
        printer: {
          type: 'string',
          description: "Printer type: 'fdm', 'sla', 'sls', 'any'",
        },
        material: {
          type: 'string',
          description: "Material: 'pla', 'abs', 'petg', 'tpu', 'nylon', 'resin', 'pc', 'asa'",
        },
        problem: {
          type: 'string',
          description: 'Problem description for troubleshooting',
        },
        dimensions: {
          type: 'string',
          description: "Part dimensions: 'LxWxH in mm'",
        },
      },
      required: ['action'],
    },
  },
  // ═══ AGRICULTURE ═══
  {
    name: 'agro_advisor',
    description:
      'Agriculture advisor. Crop planning, soil analysis interpretation, pest/disease identification (from photo), fertilizer calculator, irrigation planning, harvest timing, weather impact on crops. Supports Romanian agriculture.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            "Action: 'crop_plan', 'soil_analysis', 'pest_identify', 'fertilizer', 'irrigation', 'harvest', 'weather_impact', 'rotation', 'organic'",
        },
        crop: {
          type: 'string',
          description: "Crop: 'wheat', 'corn', 'sunflower', 'rapeseed', 'potato', 'tomato', 'grape', 'apple', 'any'",
        },
        location: { type: 'string', description: 'Location/region' },
        soil_type: {
          type: 'string',
          description: "Soil type: 'clay', 'sandy', 'loam', 'silt', 'chalky', 'peat'",
        },
        area: { type: 'string', description: 'Area in hectares' },
      },
      required: ['action'],
    },
  },
];

// ── Tool executor: maps tool names to brain methods ──
async function executeTool(brain, toolName, toolInput, userId) {
  try {
    switch (toolName) {
      case 'search_web':
        return await brain._search(toolInput.query);
      case 'get_weather':
        return await brain._weather(toolInput.city);
      case 'generate_image':
        return await brain._imagine(toolInput.prompt);
      case 'play_radio':
        return await brain._radio(toolInput.station);
      case 'play_video':
        return await brain._video(toolInput.query);
      case 'open_website':
        return brain._webNav ? await brain._webNav(toolInput.url) : await brain._openURL(toolInput.url);
      case 'get_news':
        return await brain._newsAction(toolInput.topic || 'general');
      case 'check_system_health':
        return await brain._healthCheck();
      case 'get_trading_intelligence':
        return await brain._tradeIntelligence();
      case 'show_map':
        return await brain._map(toolInput.place);
      case 'get_legal_info':
        return await brain._legalAction(toolInput.document);
      case 'recall_memory':
        return await brain._memory(userId);
      // ═══ PROGRAMMING TOOLS ═══
      case 'execute_javascript': {
        const sandbox = {
          result: undefined,
          console: {
            log: (...a) => {
              sandbox.result = a.map(String).join(' ');
            },
          },
          Math,
          Date,
          JSON,
          parseInt,
          parseFloat,
          isNaN,
          Array,
          Object,
          String,
          Number,
          Boolean,
          RegExp,
          Map,
          Set,
        };
        const ctx = vm.createContext(sandbox);
        try {
          const r = vm.runInContext(toolInput.code, ctx, { timeout: 3000 });
          return {
            result: sandbox.result !== undefined ? sandbox.result : String(r),
            executed: true,
          };
        } catch (execErr) {
          return { error: execErr.message, executed: false };
        }
      }
      case 'database_query': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const lim = Math.min(toolInput.limit || 10, 50);
        let q = brain.supabaseAdmin
          .from(toolInput.table)
          .select(toolInput.select || '*')
          .limit(lim);
        if (toolInput.filters) {
          for (const f of toolInput.filters.split(',')) {
            const [col, val] = f.trim().split('=');
            if (col && val) q = q.eq(col.trim(), val.trim());
          }
        }
        const { data, error: dbErr } = await q;
        if (dbErr) return { error: dbErr.message };
        return { rows: data, count: data?.length || 0 };
      }
      // ═══ ELECTRONIC & DEFECTOSCOPY ═══
      case 'analyze_schematic': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No image uploaded. Please upload a schematic image first.',
          };
        const prompt = `You are an expert electronics engineer. Analyze this circuit schematic image.\nFocus: ${toolInput.focus}\n\nProvide:\n1. List all identified components with values\n2. Trace signal/power paths\n3. Calculate approximate power consumption\n4. Identify any design issues or improvements\n5. Suggest component alternatives if applicable\n\nBe precise, use standard EE terminology.`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'defect_analysis': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No image uploaded. Please upload an inspection image.',
          };
        const prompt = `Expert NDT (Non-Destructive Testing) defect analysis.\nMethod: ${toolInput.method}\nMaterial: ${toolInput.material || 'unknown'}\n\nAnalyze this image for:\n1. Cracks, fractures, or discontinuities\n2. Voids, porosity, or inclusions\n3. Corrosion or material degradation\n4. Dimensional anomalies\n5. Severity classification (Critical/Major/Minor/Acceptable)\n6. Recommended follow-up actions\n\nUse standard NDT terminology and reference applicable standards (ASTM, ISO, EN).`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'component_lookup': {
        const searchQuery = `${toolInput.component} ${toolInput.info || 'datasheet'} electronic component specifications`;
        return await brain._search(searchQuery);
      }
      // ═══ MEDICAL TOOLS ═══
      case 'analyze_medical_image': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No medical image uploaded. Please upload an MRI/CT/X-ray image.',
          };
        const prompt = `Expert radiologist analysis (EDUCATIONAL/RESEARCH ONLY — NOT clinical diagnosis).\nModality: ${toolInput.modality?.toUpperCase() || 'Unknown'}\nBody region: ${toolInput.body_region || 'unspecified'}\nFocus: ${toolInput.focus || 'full_report'}\n\n⚠️ DISCLAIMER: This is for educational and research purposes only. Not a medical diagnosis.\n\nProvide:\n1. Imaging technique identification and quality assessment\n2. Normal anatomical structures visible\n3. Any notable findings or anomalies (location, size, characteristics)\n4. Signal intensity patterns (for MRI) or density patterns (for CT)\n5. Differential considerations based on imaging characteristics\n6. Suggested additional views or imaging if needed\n7. Relevant measurement annotations\n\nUse standard radiological terminology (ACR BI-RADS for breast, Fleischner for lung nodules, etc).`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'pubmed_search': {
        const maxResults = Math.min(toolInput.max_results || 5, 20);
        try {
          const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=${maxResults}&sort=relevance&term=${encodeURIComponent(toolInput.query)}`;
          const sr = await fetch(searchUrl);
          const sd = await sr.json();
          const ids = sd.esearchresult?.idlist || [];
          if (ids.length === 0) return { results: [], message: 'No articles found' };
          const detailUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`;
          const dr = await fetch(detailUrl);
          const dd = await dr.json();
          const articles = ids
            .map((id) => {
              const a = dd.result?.[id];
              if (!a) return null;
              return {
                title: a.title,
                authors: (a.authors || [])
                  .slice(0, 3)
                  .map((au) => au.name)
                  .join(', '),
                journal: a.fulljournalname,
                year: a.pubdate,
                doi: a.elocationid,
                pmid: id,
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
              };
            })
            .filter(Boolean);
          return { results: articles, total: sd.esearchresult?.count || 0 };
        } catch (pubErr) {
          return { error: pubErr.message };
        }
      }
      case 'dose_calculator': {
        try {
          const params = JSON.parse(toolInput.parameters);
          const calc = toolInput.calculation;
          let result = {};
          if (calc === 'fractionation') {
            const totalDose = (params.dose_per_fraction || 2) * (params.fractions || 30);
            const BED = totalDose * (1 + (params.dose_per_fraction || 2) / (params.alpha_beta || 10));
            result = {
              total_dose_Gy: totalDose,
              BED_Gy: BED.toFixed(2),
              EQD2_Gy: (BED / (1 + 2 / (params.alpha_beta || 10))).toFixed(2),
              fractions: params.fractions || 30,
              dose_per_fraction_Gy: params.dose_per_fraction || 2,
            };
          } else if (calc === 'decay') {
            const activity =
              (params.initial_activity || 100) *
              Math.pow(0.5, (params.time_hours || 0) / (params.half_life_hours || 6));
            result = {
              remaining_activity: activity.toFixed(2),
              unit: params.unit || 'MBq',
              decay_factor: (activity / (params.initial_activity || 100)).toFixed(4),
            };
          } else if (calc === 'inverse_square') {
            const newDose =
              ((params.dose || 100) * Math.pow(params.distance1 || 1, 2)) / Math.pow(params.distance2 || 2, 2);
            result = {
              new_dose_rate: newDose.toFixed(2),
              reduction_factor: (newDose / (params.dose || 100)).toFixed(4),
            };
          } else {
            result = {
              error: 'Unknown calculation type. Use: fractionation, decay, inverse_square',
            };
          }
          result.disclaimer = '⚠️ EDUCATIONAL ONLY — not for clinical treatment planning';
          return result;
        } catch (calcErr) {
          return { error: 'Invalid parameters: ' + calcErr.message };
        }
      }
      // ═══ OSCILLOSCOPE & SPECTROMETER & ENGINEERING ═══
      case 'analyze_oscilloscope': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No oscilloscope screenshot uploaded. Please upload a waveform image.',
          };
        const prompt = `Expert oscilloscope waveform analysis.\nChannels: ${toolInput.channels || 'unknown'}\nExpected signal: ${toolInput.expected_signal || 'unknown'}\nFocus: ${toolInput.focus}\n\nAnalyze this oscilloscope screenshot. Provide:\n1. Signal type identification (sine, square, PWM, digital protocol)\n2. Measurements: frequency, period, amplitude (Vpp, Vrms), DC offset\n3. Rise/fall time, duty cycle (if applicable)\n4. Signal quality: noise level, overshoot, ringing, jitter\n5. If multiple channels: phase relationship, timing differences\n6. Protocol decode if digital (I2C, SPI, UART — identify data if visible)\n7. Anomalies: glitches, crosstalk, ground bounce, reflections\n8. Recommendations for improvement\n\nUse precise measurements from the scope's grid/cursors. Reference time/div and volt/div settings.`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'analyze_spectrometer': {
        if (!brain._currentMediaData?.imageBase64) {
          // Try web search for reference data if no image
          return await brain._search(
            `${toolInput.type} spectroscopy ${toolInput.analysis} ${toolInput.sample || ''} reference spectrum`
          );
        }
        const prompt = `Expert spectrometry analysis.\nType: ${toolInput.type?.toUpperCase()}\nAnalysis: ${toolInput.analysis}\nSample: ${toolInput.sample || 'unknown'}\n\nAnalyze this spectrum. Provide:\n1. Peak identification — wavelength/mass/wavenumber and intensity\n2. Element or compound identification based on peak positions\n3. Concentration estimates if calibration data is visible\n4. Spectral quality assessment (resolution, baseline, noise)\n5. Comparison with known reference spectra\n6. Potential interferences or overlapping peaks\n7. Quantitative results if standards are visible\n8. Recommendations for measurement improvement\n\nUse standard spectroscopic nomenclature and reference databases (NIST, HITRAN, Sadtler).`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'circuit_improvement': {
        let context = '';
        if (brain._currentMediaData?.imageBase64) {
          const visionResult = await brain._vision(brain._currentMediaData.imageBase64, userId);
          context = typeof visionResult === 'string' ? visionResult : JSON.stringify(visionResult);
        }
        const searchQuery = `${toolInput.circuit_type} circuit ${toolInput.goal} improvement best practices ${toolInput.constraints || ''}`;
        const searchResult = await brain._search(searchQuery);
        return {
          circuit_analysis: context || 'No schematic image provided — working from description',
          improvement_research: searchResult,
          circuit_type: toolInput.circuit_type,
          optimization_goal: toolInput.goal,
          constraints: toolInput.constraints || 'none specified',
        };
      }
      case 'create_technical_manual': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected — cannot store manual' };
        const manualKey = `manual:${toolInput.title.replace(/\s+/g, '_').toLowerCase()}`;
        if (toolInput.action === 'create' || toolInput.action === 'update' || toolInput.action === 'add_section') {
          const { data: existing } = await brain.supabaseAdmin
            .from('user_preferences')
            .select('value')
            .eq('key', manualKey)
            .maybeSingle();
          const manual = existing?.value || {
            title: toolInput.title,
            created: new Date().toISOString(),
            sections: {},
            version: 1,
          };
          if (toolInput.section && toolInput.content) {
            manual.sections[toolInput.section] = manual.sections[toolInput.section] || [];
            manual.sections[toolInput.section].push({
              content: toolInput.content,
              timestamp: new Date().toISOString(),
            });
          }
          manual.version = (manual.version || 0) + 1;
          manual.updated = new Date().toISOString();
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: manualKey, value: manual }, { onConflict: 'user_id,key' });
          return {
            status: 'saved',
            title: manual.title,
            version: manual.version,
            sections: Object.keys(manual.sections),
            total_entries: Object.values(manual.sections).flat().length,
          };
        }
        if (toolInput.action === 'export') {
          const { data } = await brain.supabaseAdmin
            .from('user_preferences')
            .select('value')
            .eq('key', manualKey)
            .maybeSingle();
          return data?.value || { error: 'Manual not found' };
        }
        return {
          error: 'Unknown action. Use: create, update, add_section, export',
        };
      }
      case 'measurement_log': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const logKey = `measurements:${toolInput.equipment.replace(/\s+/g, '_').toLowerCase()}`;
        if (toolInput.action === 'record') {
          const { data: existing } = await brain.supabaseAdmin
            .from('user_preferences')
            .select('value')
            .eq('key', logKey)
            .maybeSingle();
          const log = existing?.value || {
            equipment: toolInput.equipment,
            measurements: [],
          };
          const entry = {
            parameter: toolInput.parameter,
            value: toolInput.value,
            unit: toolInput.unit || '',
            timestamp: new Date().toISOString(),
          };
          if (toolInput.limit_min !== undefined || toolInput.limit_max !== undefined) {
            entry.limit_min = toolInput.limit_min;
            entry.limit_max = toolInput.limit_max;
            entry.status =
              (toolInput.limit_min !== undefined && toolInput.value < toolInput.limit_min) ||
              (toolInput.limit_max !== undefined && toolInput.value > toolInput.limit_max)
                ? 'FAIL'
                : 'PASS';
          }
          log.measurements.push(entry);
          if (log.measurements.length > 500) log.measurements = log.measurements.slice(-500);
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: logKey, value: log }, { onConflict: 'user_id,key' });
          return {
            status: 'recorded',
            entry,
            total_measurements: log.measurements.length,
          };
        }
        if (toolInput.action === 'history' || toolInput.action === 'trend' || toolInput.action === 'report') {
          const { data } = await brain.supabaseAdmin
            .from('user_preferences')
            .select('value')
            .eq('key', logKey)
            .maybeSingle();
          if (!data?.value) return { error: 'No measurements found for this equipment' };
          const measurements = data.value.measurements || [];
          const filtered = toolInput.parameter
            ? measurements.filter((m) => m.parameter === toolInput.parameter)
            : measurements;
          const values = filtered.map((m) => m.value).filter((v) => typeof v === 'number');
          const stats =
            values.length > 0
              ? {
                  count: values.length,
                  min: Math.min(...values),
                  max: Math.max(...values),
                  avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(3),
                  latest: filtered[filtered.length - 1],
                }
              : {};
          return {
            equipment: toolInput.equipment,
            parameter: toolInput.parameter || 'all',
            stats,
            recent: filtered.slice(-10),
            pass_rate:
              filtered.length > 0
                ? (
                    (filtered.filter((m) => m.status === 'PASS').length / filtered.filter((m) => m.status).length) *
                    100
                  ).toFixed(1) + '%'
                : 'N/A',
          };
        }
        return { error: 'Unknown action. Use: record, history, trend, report' };
      }
      // ═══ OFFICE / SECRETARY TOOLS ═══
      case 'send_email': {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return { error: 'Email not configured. Set RESEND_API_KEY in .env' };
        if (toolInput.action === 'draft') {
          return {
            status: 'draft',
            to: toolInput.to,
            subject: toolInput.subject,
            body: toolInput.body,
            cc: toolInput.cc || null,
            message: "Draft ready. Say 'send' to send it.",
          };
        }
        try {
          const emailBody = {
            from: process.env.EMAIL_FROM || process.env.ADMIN_EMAIL || '',
            to: toolInput.to.split(',').map((e) => e.trim()),
            subject: toolInput.subject,
            html: toolInput.body,
          };
          if (toolInput.cc) emailBody.cc = toolInput.cc.split(',').map((e) => e.trim());
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(emailBody),
          });
          const result = await r.json();
          if (!r.ok)
            return {
              error: result.message || 'Email failed',
              status: r.status,
            };
          return {
            status: 'sent',
            id: result.id,
            to: toolInput.to,
            subject: toolInput.subject,
          };
        } catch (emailErr) {
          return { error: emailErr.message };
        }
      }
      case 'manage_calendar': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const calKey = `calendar:${userId || 'system'}`;
        const { data: existing } = await brain.supabaseAdmin
          .from('user_preferences')
          .select('value')
          .eq('user_id', userId || 'system')
          .eq('key', calKey)
          .maybeSingle();
        const calendar = existing?.value || { events: [] };
        if (toolInput.action === 'create') {
          const event = {
            id: Date.now().toString(36),
            title: toolInput.title,
            date: toolInput.date,
            time: toolInput.time,
            duration: toolInput.duration || 60,
            location: toolInput.location,
            notes: toolInput.notes,
            recurring: toolInput.recurring || 'none',
            created: new Date().toISOString(),
          };
          calendar.events.push(event);
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: calKey, value: calendar }, { onConflict: 'user_id,key' });
          return { status: 'created', event };
        }
        if (toolInput.action === 'list' || toolInput.action === 'today' || toolInput.action === 'week') {
          const now = new Date();
          const today = now.toISOString().split('T')[0];
          let filtered = calendar.events;
          if (toolInput.action === 'today') filtered = filtered.filter((e) => e.date === today || e.date === 'today');
          if (toolInput.action === 'week') {
            const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];
            filtered = filtered.filter((e) => e.date >= today && e.date <= weekEnd);
          }
          return { events: filtered.slice(-20), total: filtered.length };
        }
        if (toolInput.action === 'delete') {
          calendar.events = calendar.events.filter((e) => e.title !== toolInput.title);
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: calKey, value: calendar }, { onConflict: 'user_id,key' });
          return { status: 'deleted', title: toolInput.title };
        }
        return {
          events: calendar.events.slice(-20),
          total: calendar.events.length,
        };
      }
      case 'create_document': {
        // Gemini will generate the document content based on the description
        // We store it in DB for retrieval
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const docKey = `doc:${toolInput.title.replace(/\s+/g, '_').toLowerCase()}`;
        const doc = {
          type: toolInput.type,
          title: toolInput.title,
          recipient: toolInput.recipient,
          content: toolInput.content,
          language: toolInput.language || 'ro',
          format: toolInput.format || 'professional',
          created: new Date().toISOString(),
        };
        await brain.supabaseAdmin
          .from('user_preferences')
          .upsert({ user_id: userId || 'system', key: docKey, value: doc }, { onConflict: 'user_id,key' });
        return {
          status: 'created',
          type: toolInput.type,
          title: toolInput.title,
          message: 'Document generated and saved. Tell me if you want to modify or export it.',
        };
      }
      case 'task_manager': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const taskKey = `tasks:${userId || 'system'}`;
        const { data: existing } = await brain.supabaseAdmin
          .from('user_preferences')
          .select('value')
          .eq('user_id', userId || 'system')
          .eq('key', taskKey)
          .maybeSingle();
        const tasks = existing?.value || { items: [] };
        if (toolInput.action === 'add') {
          const item = {
            id: Date.now().toString(36),
            task: toolInput.task,
            project: toolInput.project || 'general',
            priority: toolInput.priority || 'medium',
            deadline: toolInput.deadline,
            assigned_to: toolInput.assigned_to,
            status: 'todo',
            created: new Date().toISOString(),
          };
          tasks.items.push(item);
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: taskKey, value: tasks }, { onConflict: 'user_id,key' });
          return { status: 'added', item, total: tasks.items.length };
        }
        if (toolInput.action === 'complete') {
          const found = tasks.items.find((t) => t.task.toLowerCase().includes((toolInput.task || '').toLowerCase()));
          if (found) {
            found.status = 'done';
            found.completed = new Date().toISOString();
          }
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: taskKey, value: tasks }, { onConflict: 'user_id,key' });
          return { status: 'completed', task: found || 'not found' };
        }
        if (toolInput.action === 'list' || toolInput.action === 'today' || toolInput.action === 'overdue') {
          let filtered = tasks.items;
          if (toolInput.action === 'overdue') {
            const today = new Date().toISOString().split('T')[0];
            filtered = filtered.filter((t) => t.deadline && t.deadline < today && t.status !== 'done');
          }
          if (toolInput.project) filtered = filtered.filter((t) => t.project === toolInput.project);
          if (toolInput.status) filtered = filtered.filter((t) => t.status === toolInput.status);
          return {
            tasks: filtered,
            total: filtered.length,
            done: tasks.items.filter((t) => t.status === 'done').length,
            pending: tasks.items.filter((t) => t.status !== 'done').length,
          };
        }
        return {
          tasks: tasks.items.filter((t) => t.status !== 'done').slice(-20),
          total: tasks.items.length,
        };
      }
      case 'contact_book': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const cbKey = `contacts:${userId || 'system'}`;
        const { data: existing } = await brain.supabaseAdmin
          .from('user_preferences')
          .select('value')
          .eq('user_id', userId || 'system')
          .eq('key', cbKey)
          .maybeSingle();
        const contacts = existing?.value || { items: [] };
        if (toolInput.action === 'add') {
          const contact = {
            name: toolInput.name,
            phone: toolInput.phone,
            email: toolInput.email,
            company: toolInput.company,
            category: toolInput.category || 'personal',
            notes: toolInput.notes,
            added: new Date().toISOString(),
          };
          contacts.items.push(contact);
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: cbKey, value: contacts }, { onConflict: 'user_id,key' });
          return { status: 'added', contact, total: contacts.items.length };
        }
        if (toolInput.action === 'search') {
          const q = (toolInput.name || toolInput.company || '').toLowerCase();
          const found = contacts.items.filter(
            (c) =>
              (c.name || '').toLowerCase().includes(q) ||
              (c.company || '').toLowerCase().includes(q) ||
              (c.email || '').toLowerCase().includes(q)
          );
          return { results: found, count: found.length };
        }
        if (toolInput.action === 'list') {
          let filtered = contacts.items;
          if (toolInput.category) filtered = filtered.filter((c) => c.category === toolInput.category);
          return { contacts: filtered, total: filtered.length };
        }
        return {
          contacts: contacts.items.slice(-20),
          total: contacts.items.length,
        };
      }
      case 'translate_document': {
        // Gemini handles translation natively — just return the instruction for the AI
        return {
          action: 'translate',
          text: toolInput.text,
          from: toolInput.from || 'auto',
          to: toolInput.to,
          style: toolInput.style || 'formal',
          message: `Translate the following text to ${toolInput.to}: ${toolInput.text.substring(0, 2000)}`,
        };
      }
      case 'summarize_document': {
        return {
          action: 'summarize',
          text: toolInput.text.substring(0, 4000),
          style: toolInput.style,
          length: toolInput.length || 'medium',
          message: `Summarize in style '${toolInput.style}': ${toolInput.text.substring(0, 2000)}`,
        };
      }
      // ═══ DRAWING & MS OFFICE TOOLS ═══
      case 'draw_diagram': {
        // Check if there's an uploaded image to analyze
        if (toolInput.action === 'analyze' && brain._currentMediaData?.imageBase64) {
          return await brain._vision(brain._currentMediaData.imageBase64, userId);
        }
        // Generate Mermaid diagram code based on description
        const diagramTypes = {
          flowchart: 'graph TD',
          circuit: 'graph LR',
          sequence: 'sequenceDiagram',
          class: 'classDiagram',
          state: 'stateDiagram-v2',
          er: 'erDiagram',
          gantt: 'gantt',
          pie: 'pie',
          mind_map: 'mindmap',
        };
        const mermaidType = diagramTypes[toolInput.type] || 'graph TD';
        return {
          diagram_type: toolInput.type,
          mermaid_syntax: mermaidType,
          description: toolInput.description,
          style: toolInput.style || 'technical',
          instruction: `Generate a Mermaid diagram of type '${mermaidType}' for: ${toolInput.description}. Return the complete Mermaid code wrapped in \`\`\`mermaid ... \`\`\` blocks.`,
        };
      }
      case 'create_spreadsheet': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const ssKey = `spreadsheet:${toolInput.title.replace(/\s+/g, '_').toLowerCase()}`;
        const spreadsheet = {
          title: toolInput.title,
          type: toolInput.type,
          columns: toolInput.columns ? toolInput.columns.split(',').map((c) => c.trim()) : [],
          data: toolInput.data,
          formulas: toolInput.formulas,
          created: new Date().toISOString(),
          format: 'csv',
        };
        await brain.supabaseAdmin
          .from('user_preferences')
          .upsert({ user_id: userId || 'system', key: ssKey, value: spreadsheet }, { onConflict: 'user_id,key' });
        return {
          status: 'created',
          title: toolInput.title,
          type: toolInput.type,
          columns: spreadsheet.columns,
          instruction: `Generate CSV data for a ${toolInput.type} spreadsheet titled '${toolInput.title}'. Columns: ${toolInput.columns || 'auto'}. Data: ${toolInput.data || 'generate sample'}. Include formulas: ${toolInput.formulas || 'none'}. Format as a proper CSV table.`,
        };
      }
      case 'create_presentation': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const presKey = `presentation:${toolInput.title.replace(/\s+/g, '_').toLowerCase()}`;
        const slides = toolInput.slides || 10;
        const presentation = {
          title: toolInput.title,
          topic: toolInput.topic,
          slides,
          audience: toolInput.audience || 'general',
          style: toolInput.style || 'professional',
          language: toolInput.language || 'ro',
          created: new Date().toISOString(),
        };
        await brain.supabaseAdmin
          .from('user_preferences')
          .upsert({ user_id: userId || 'system', key: presKey, value: presentation }, { onConflict: 'user_id,key' });
        return {
          status: 'created',
          title: toolInput.title,
          slides,
          instruction: `Generate a ${slides}-slide presentation for audience '${toolInput.audience || 'general'}'. Title: '${toolInput.title}'. Topic: ${toolInput.topic}. For each slide provide: slide number, title, bullet points (3-5), and speaker notes. Language: ${toolInput.language || 'ro'}. Style: ${toolInput.style || 'professional'}.`,
        };
      }
      case 'file_converter': {
        return {
          input_format: toolInput.input_format,
          output_format: toolInput.output_format,
          data: toolInput.data.substring(0, 4000),
          instruction: `Convert the following ${toolInput.input_format} data to ${toolInput.output_format} format: ${toolInput.data.substring(0, 2000)}`,
        };
      }
      // ═══ CAMERA / VISION / R&D INSPECTION ═══
      case 'pcb_inspection': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No PCB image uploaded. Please take a photo or upload an image of the PCB.',
          };
        const prompt = `Expert PCB inspection (IPC-A-610 ${toolInput.class || 'Class 2'}).\nBoard type: ${toolInput.board_type || 'mixed'}\nFocus: ${toolInput.focus}\n\nInspect this PCB image for:\n1. Solder joint quality (cold joints, bridges, insufficient/excess solder, voids)\n2. Component placement (alignment, tombstoning, wrong orientation/polarity)\n3. Missing or wrong components\n4. PCB damage (scratches, delamination, burned areas)\n5. Trace integrity (breaks, shorts, hairline cracks)\n6. Contamination (flux residue, foreign particles)\n7. Via and through-hole fill quality\n8. Conformal coating issues (if visible)\n\nFor each defect found, provide:\n- Location (reference designator or board area)\n- Defect type\n- Severity: CRITICAL / MAJOR / MINOR / COSMETIC\n- IPC-A-610 reference if applicable\n- Recommended corrective action\n\nOverall verdict: PASS / REWORK / REJECT`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'thermal_analysis': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No thermal image uploaded. Please upload a thermal camera image.',
          };
        const prompt = `Expert thermal imaging analysis.\nDomain: ${toolInput.domain}\nFocus: ${toolInput.focus}\nMax acceptable temp: ${toolInput.max_temp || 'not specified'}°C\n\nAnalyze this thermal image:\n1. Identify all hotspots with estimated temperatures\n2. Map thermal gradients and distribution\n3. Flag any anomalies (unexpected hot/cold spots)\n4. Compare against expected thermal profile for ${toolInput.domain}\n5. Identify potential failures or issues\n6. Risk assessment: HIGH / MEDIUM / LOW\n7. Recommended actions (monitoring, repair, replacement)\n\nUse the color scale visible in the image for temperature estimation.`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'microscope_analysis': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No microscope image uploaded. Please upload a microscope capture.',
          };
        const prompt = `Expert microscopy analysis.\nMicroscope: ${toolInput.microscope_type}\nSample: ${toolInput.sample || 'unknown'}\nMagnification: ${toolInput.magnification || 'unknown'}\nFocus: ${toolInput.focus}\n\nAnalyze this microscope image:\n1. Identify structures, features, and morphology\n2. Grain size and distribution (if metallic)\n3. Defects: cracks, voids, inclusions, contamination\n4. Surface roughness/topology assessment\n5. Dimensional measurements (using scale bar if visible)\n6. Phase identification (if metallurgical)\n7. Quality assessment vs expected for this material/process\n8. Comparison with standard microstructures\n\nUse standard materials science / ${toolInput.sample || 'general'} terminology.`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'visual_quality_check': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'No product image uploaded. Please upload a photo for quality inspection.',
          };
        const prompt = `Visual Quality Inspection Report.\nProduct: ${toolInput.product_type}\nStandard: ${toolInput.standard || 'general'}\nCriteria: ${toolInput.criteria || 'standard visual inspection'}\n\nInspect this image:\n1. Surface finish quality (scratches, dents, marks, burrs)\n2. Dimensional compliance (visible alignment, gaps, fits)\n3. Assembly quality (fasteners, connections, seals)\n4. Labeling/marking correctness and legibility\n5. Color/coating uniformity\n6. Foreign material or contamination\n7. Packaging integrity (if applicable)\n\nFor each finding:\n- Defect description\n- Location\n- Severity: CRITICAL / MAJOR / MINOR / COSMETIC\n- Accept/Reject decision\n\nFINAL VERDICT: PASS ✅ / FAIL ❌ / CONDITIONAL PASS ⚠️`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      case 'compare_images': {
        if (!brain._currentMediaData?.imageBase64)
          return {
            error: 'Please upload the image(s) to compare. For before/after, upload the current state.',
          };
        const prompt = `Visual comparison analysis.\nContext: ${toolInput.context}\nFocus: ${toolInput.focus || 'full'}\n\nAnalyze this image and provide:\n1. Identify all visible features and components\n2. Note any deviations from expected state\n3. Dimensional or positional differences\n4. Quality differences (surface, finish, alignment)\n5. Missing or added elements\n6. Overall change assessment\n\nProvide a structured comparison table where possible.`;
        return (await brain._vision(brain._currentMediaData.imageBase64, userId)) || { analysis: prompt };
      }
      // ═══ EDUCATION / TEACHING TOOLS ═══
      case 'quiz_generator': {
        const questions = toolInput.question_count || 10;
        return {
          action: 'generate_quiz',
          subject: toolInput.subject,
          level: toolInput.level,
          topic: toolInput.topic,
          questions,
          type: toolInput.type || 'mixed',
          difficulty: toolInput.difficulty || 'medium',
          include_answers: toolInput.include_answers !== false,
          instruction: `Generate a ${toolInput.difficulty || 'medium'} difficulty ${toolInput.type || 'mixed'} quiz with ${questions} questions.\nSubject: ${toolInput.subject}\nLevel: ${toolInput.level}\nTopic: ${toolInput.topic}\n\nFormat each question with:\n- Question number and text\n- Options (if multiple choice: A, B, C, D)\n- Correct answer\n- Brief explanation\n\nAt the end provide a grading rubric and total points.`,
        };
      }
      case 'grade_book': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const gbKey = `gradebook:${userId || 'system'}`;
        const { data: existing } = await brain.supabaseAdmin
          .from('user_preferences')
          .select('value')
          .eq('user_id', userId || 'system')
          .eq('key', gbKey)
          .maybeSingle();
        const gradebook = existing?.value || { students: {} };
        if (toolInput.action === 'add_grade') {
          const key = toolInput.student || 'unknown';
          if (!gradebook.students[key]) gradebook.students[key] = { grades: [], absences: 0 };
          gradebook.students[key].grades.push({
            subject: toolInput.subject,
            grade: toolInput.grade,
            date: toolInput.date || new Date().toISOString().split('T')[0],
            semester: toolInput.semester || '1',
          });
          await brain.supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId || 'system', key: gbKey, value: gradebook }, { onConflict: 'user_id,key' });
          return {
            status: 'recorded',
            student: key,
            grade: toolInput.grade,
            subject: toolInput.subject,
          };
        }
        if (toolInput.action === 'calculate_average' || toolInput.action === 'report') {
          const results = {};
          for (const [name, data] of Object.entries(gradebook.students)) {
            const grades = data.grades.filter((g) => !toolInput.subject || g.subject === toolInput.subject);
            const values = grades.map((g) => g.grade);
            results[name] = {
              grades: values,
              average: values.length > 0 ? (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2) : 'N/A',
              count: values.length,
              absences: data.absences,
            };
          }
          return {
            students: results,
            total_students: Object.keys(results).length,
          };
        }
        if (toolInput.action === 'ranking') {
          const ranking = Object.entries(gradebook.students)
            .map(([name, data]) => {
              const vals = data.grades.map((g) => g.grade);
              return {
                name,
                average: vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0,
              };
            })
            .sort((a, b) => b.average - a.average);
          return {
            ranking: ranking.map((r, i) => ({
              position: i + 1,
              ...r,
              average: r.average.toFixed(2),
            })),
          };
        }
        return {
          students: Object.keys(gradebook.students),
          total: Object.keys(gradebook.students).length,
        };
      }
      case 'lesson_planner': {
        return {
          action: 'create_plan',
          type: toolInput.type || 'daily',
          subject: toolInput.subject,
          grade_level: toolInput.grade_level,
          topic: toolInput.topic,
          duration: toolInput.duration || 50,
          curriculum: toolInput.curriculum || 'romania',
          language: toolInput.language || 'ro',
          instruction: `Create a ${toolInput.type || 'daily'} lesson plan.\nSubject: ${toolInput.subject}\nGrade: ${toolInput.grade_level}\nTopic: ${toolInput.topic}\nDuration: ${toolInput.duration || 50} min\nCurriculum: ${toolInput.curriculum || 'romania'}\nLanguage: ${toolInput.language || 'ro'}\n\nInclude:\n1. Competențe specifice / Learning objectives\n2. Resurse și materiale\n3. Desfășurarea lecției (timing per activitate)\n4. Metode didactice\n5. Evaluare\n6. Teme / Follow-up\n7. Diferențiere (elevi cu dificultăți / elevi avansați)`,
        };
      }
      case 'flashcards': {
        if (!brain.supabaseAdmin) return { error: 'Database not connected' };
        const _fcKey = `flashcards:${(toolInput.set_name || toolInput.topic || 'default').replace(/\s+/g, '_').toLowerCase()}`;
        if (toolInput.action === 'create') {
          return {
            action: 'create',
            set_name: toolInput.set_name || toolInput.topic,
            topic: toolInput.topic,
            count: toolInput.count || 20,
            instruction: `Generate ${toolInput.count || 20} flashcards for topic '${toolInput.topic}'.\nDifficulty: ${toolInput.difficulty || 'intermediate'}\nLanguage: ${toolInput.language || 'ro'}\n\nFormat each card as:\n**Card N:**\nFront: [question/term]\nBack: [answer/definition]\n\nMake them progressively harder.`,
          };
        }
        if (toolInput.action === 'list') {
          const { data: sets } = await brain.supabaseAdmin
            .from('user_preferences')
            .select('key, value')
            .eq('user_id', userId || 'system')
            .like('key', 'flashcards:%');
          return {
            sets: (sets || []).map((s) => ({
              name: s.key.replace('flashcards:', ''),
              cards: s.value?.cards?.length || 0,
            })),
          };
        }
        return {
          action: toolInput.action,
          set_name: toolInput.set_name || 'default',
        };
      }
      case 'exercise_generator': {
        return {
          action: 'generate',
          subject: toolInput.subject,
          topic: toolInput.topic,
          count: toolInput.count || 5,
          difficulty: toolInput.difficulty || 'medium',
          show_solution: toolInput.show_solution !== false,
          level: toolInput.level || 'highschool',
          instruction: `Generate ${toolInput.count || 5} ${toolInput.difficulty || 'medium'}-difficulty exercises.\nSubject: ${toolInput.subject}\nTopic: ${toolInput.topic}\nLevel: ${toolInput.level || 'highschool'}\n\nFor each exercise:\n1. Problem statement (clear, precise)\n2. Given data\n3. Required: what to find\n4. Step-by-step solution with formulas\n5. Final answer with units\n6. Brief explanation of methodology\n\nUse proper mathematical notation. Show all intermediate steps.`,
        };
      }
      // ═══ LEGAL ═══
      case 'legal_consultant': {
        const searchQuery = `${toolInput.domain || ''} ${toolInput.question} ${toolInput.jurisdiction || 'romania'} law legislation`;
        const searchResult = await brain._search(searchQuery);
        return {
          action: toolInput.action,
          domain: toolInput.domain,
          jurisdiction: toolInput.jurisdiction || 'romania',
          research: searchResult,
          disclaimer: '⚠️ Informativ — nu constituie consiliere juridică. Consultați un avocat.',
        };
      }
      // ═══ FINANCE ═══
      case 'financial_calculator': {
        try {
          const params = JSON.parse(toolInput.parameters);
          const calc = toolInput.calculation;
          let result = {};
          if (calc === 'loan' || calc === 'mortgage') {
            const P = params.amount || 100000;
            const r = (params.rate || 5) / 100 / 12;
            const n = (params.years || 30) * 12;
            const monthly = (P * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
            result = {
              monthly_payment: monthly.toFixed(2),
              total_paid: (monthly * n).toFixed(2),
              total_interest: (monthly * n - P).toFixed(2),
              currency: params.currency || 'RON',
            };
          } else if (calc === 'compound_interest') {
            const A = (params.principal || 10000) * Math.pow(1 + (params.rate || 5) / 100, params.years || 10);
            result = {
              final_amount: A.toFixed(2),
              profit: (A - (params.principal || 10000)).toFixed(2),
            };
          } else if (calc === 'salary_net') {
            const gross = params.amount || 5000;
            const cas = gross * 0.25;
            const cass = gross * 0.1;
            const tax = (gross - cas - cass) * 0.1;
            result = {
              gross,
              cas: cas.toFixed(0),
              cass: cass.toFixed(0),
              tax: tax.toFixed(0),
              net: (gross - cas - cass - tax).toFixed(0),
              currency: 'RON',
            };
          } else {
            result = {
              instruction: `Calculate ${calc} with parameters: ${JSON.stringify(params)}`,
            };
          }
          return result;
        } catch (e) {
          return { error: 'Invalid parameters: ' + e.message };
        }
      }
      // ═══ AUTOMOTIVE ═══
      case 'car_diagnostic': {
        if (toolInput.action === 'decode_obd' && toolInput.code) {
          return await brain._search(`OBD-II code ${toolInput.code} meaning cause fix ${toolInput.car || ''}`);
        }
        if (toolInput.action === 'diagnose_symptom') {
          return await brain._search(`car ${toolInput.car || ''} ${toolInput.symptom} cause diagnosis fix`);
        }
        if (toolInput.action === 'maintenance' || toolInput.action === 'specs') {
          return await brain._search(`${toolInput.car || 'car'} ${toolInput.action} schedule specifications`);
        }
        return await brain._search(
          `${toolInput.car || 'car'} ${toolInput.action} ${toolInput.symptom || toolInput.code || ''}`
        );
      }
      // ═══ CYBERSECURITY ═══
      case 'security_audit': {
        if (toolInput.action === 'password_strength') {
          const p = toolInput.target;
          const score = {
            length: p.length >= 12,
            upper: /[A-Z]/.test(p),
            lower: /[a-z]/.test(p),
            digit: /\d/.test(p),
            special: /[!@#$%^&*]/.test(p),
            noCommon: !/password|123456|qwerty/i.test(p),
          };
          const strength = Object.values(score).filter(Boolean).length;
          return {
            score: strength + '/6',
            rating: strength >= 5 ? 'STRONG' : strength >= 3 ? 'MEDIUM' : 'WEAK',
            details: score,
            recommendations:
              strength < 5
                ? 'Add more complexity: uppercase, numbers, special characters, min 12 chars'
                : 'Good password!',
          };
        }
        return await brain._search(
          `cybersecurity ${toolInput.action} ${toolInput.target} ${toolInput.context || ''} best practices OWASP`
        );
      }
      // ═══ ARCHITECTURE ═══
      case 'structural_calculator': {
        try {
          const params = JSON.parse(toolInput.parameters);
          return {
            calculation: toolInput.calculation,
            parameters: params,
            standard: toolInput.standard || 'eurocode',
            instruction: `Perform ${toolInput.calculation} calculation with: ${JSON.stringify(params)}. Standard: ${toolInput.standard || 'eurocode'}. Show all formulas and steps.`,
          };
        } catch (e) {
          return { error: 'Invalid parameters: ' + e.message };
        }
      }
      // ═══ MARKETING ═══
      case 'marketing_analyzer': {
        if (toolInput.action === 'keywords' || toolInput.action === 'seo_audit' || toolInput.action === 'competitor') {
          return await brain._search(
            `${toolInput.action} ${toolInput.topic} ${toolInput.platform || ''} ${toolInput.audience || ''}`
          );
        }
        return {
          action: toolInput.action,
          topic: toolInput.topic,
          platform: toolInput.platform,
          audience: toolInput.audience,
          language: toolInput.language || 'ro',
          instruction: `Generate ${toolInput.action} for '${toolInput.topic}'. Platform: ${toolInput.platform || 'all'}. Audience: ${toolInput.audience || 'general'}. Language: ${toolInput.language || 'ro'}.`,
        };
      }
      // ═══ HEALTH ═══
      case 'health_tracker': {
        if (
          toolInput.action === 'bmi' ||
          toolInput.action === 'calories' ||
          toolInput.action === 'body_fat' ||
          toolInput.action === 'heart_zones'
        ) {
          try {
            const p = JSON.parse(toolInput.parameters || '{}');
            if (toolInput.action === 'bmi') {
              const bmi = (p.weight_kg || 75) / Math.pow((p.height_cm || 175) / 100, 2);
              return {
                bmi: bmi.toFixed(1),
                category: bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese',
                disclaimer: '⚠️ Nu e sfat medical',
              };
            }
            if (toolInput.action === 'calories') {
              const bmr =
                p.gender === 'F'
                  ? 447.6 + 9.25 * (p.weight_kg || 65) + 3.1 * (p.height_cm || 165) - 4.33 * (p.age || 30)
                  : 88.36 + 13.4 * (p.weight_kg || 80) + 4.8 * (p.height_cm || 175) - 5.68 * (p.age || 30);
              const multipliers = {
                sedentary: 1.2,
                light: 1.375,
                moderate: 1.55,
                active: 1.725,
                very_active: 1.9,
              };
              const tdee = bmr * (multipliers[p.activity] || 1.55);
              return {
                bmr: bmr.toFixed(0),
                tdee: tdee.toFixed(0),
                lose_weight: (tdee - 500).toFixed(0),
                gain_muscle: (tdee + 300).toFixed(0),
              };
            }
          } catch (_e) {
            return { error: 'Invalid parameters' };
          }
        }
        return {
          action: toolInput.action,
          goal: toolInput.goal,
          instruction: `Generate ${toolInput.action} plan for goal: ${toolInput.goal || 'general health'}`,
        };
      }
      // ═══ COOKING ═══
      case 'recipe_generator': {
        return {
          action: toolInput.action,
          ingredients: toolInput.ingredients,
          cuisine: toolInput.cuisine || 'romaneasca',
          diet: toolInput.diet || 'normal',
          servings: toolInput.servings || 4,
          instruction: `${toolInput.action === 'generate' ? 'Generate a recipe' : toolInput.action} for ${toolInput.cuisine || 'Romanian'} cuisine. Ingredients: ${toolInput.ingredients || 'any'}. Diet: ${toolInput.diet || 'normal'}. Servings: ${toolInput.servings || 4}. Include nutrition per serving.`,
        };
      }
      // ═══ MUSIC ═══
      case 'music_theory': {
        return {
          action: toolInput.action,
          input: toolInput.input,
          key: toolInput.key,
          instrument: toolInput.instrument,
          instruction: `Music theory: ${toolInput.action}. Input: ${toolInput.input || 'any'}. Key: ${toolInput.key || 'C'}. Instrument: ${toolInput.instrument || 'any'}. Provide notation, diagrams, and practical examples.`,
        };
      }
      // ═══ 3D PRINTING ═══
      case 'print3d_helper': {
        if (toolInput.action === 'troubleshoot' && toolInput.problem) {
          return await brain._search(
            `3d printing ${toolInput.printer || 'fdm'} ${toolInput.material || ''} ${toolInput.problem} fix solution`
          );
        }
        return {
          action: toolInput.action,
          printer: toolInput.printer || 'fdm',
          material: toolInput.material,
          dimensions: toolInput.dimensions,
          instruction: `3D printing: ${toolInput.action}. Printer: ${toolInput.printer || 'FDM'}. Material: ${toolInput.material || 'PLA'}. ${toolInput.problem || toolInput.dimensions || ''}`,
        };
      }
      // ═══ AGRICULTURE ═══
      case 'agro_advisor': {
        if (toolInput.action === 'pest_identify' && brain._currentMediaData?.imageBase64) {
          return await brain._vision(brain._currentMediaData.imageBase64, userId);
        }
        const agriQuery = `${toolInput.action} ${toolInput.crop || ''} ${toolInput.location || 'Romania'} ${toolInput.soil_type || ''} agriculture farming`;
        return await brain._search(agriQuery);
      }
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (e) {
    logger.warn({ component: 'BrainV4', tool: toolName, err: e.message }, `Tool ${toolName} failed`);
    brain.recordError(toolName, e.message);
    return { error: e.message };
  }
}

// ── Extract monitor data from tool results ──
function extractMonitor(toolResults) {
  for (const r of toolResults) {
    if (r.result && typeof r.result === 'object') {
      if (r.result.monitorURL) return { content: r.result.monitorURL, type: 'url' };
      if (r.result.mapURL) return { content: r.result.mapURL, type: 'map' };
      if (r.result.imageUrl) return { content: r.result.imageUrl, type: 'image' };
      if (r.result.radioURL || r.result.streamUrl)
        return {
          content: r.result.radioURL || r.result.streamUrl,
          type: 'radio',
        };
      if (r.result.videoURL || r.result.youtubeURL)
        return {
          content: r.result.videoURL || r.result.youtubeURL,
          type: 'video',
        };
    }
  }
  return { content: null, type: null };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: thinkV4 — Gemini Tool Calling loop
// ═══════════════════════════════════════════════════════════════
async function thinkV4(
  brain,
  message,
  avatar,
  history,
  language,
  userId,
  conversationId,
  mediaData = {},
  isAdmin = false
) {
  brain.conversationCount++;
  const startTime = Date.now();
  brain._currentMediaData = mediaData || {};

  try {
    // Agent logging removed — was hardcoded to localhost:7257
    // ── 1. Quota check ──
    const quota = await brain.checkQuota(userId);
    if (!quota.allowed) {
      const upgradeMsg =
        language === 'ro'
          ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează pentru mai multe mesaje! 🚀`
          : `You've reached your ${quota.limit} messages/month limit on ${quota.plan.toUpperCase()}. Upgrade for more! 🚀`;
      return {
        enrichedMessage: upgradeMsg,
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: { complexity: 'simple', language },
        thinkTime: Date.now() - startTime,
        confidence: 1.0,
      };
    }

    // ── 2. Load memory + profile (parallel) ──
    const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
      brain.loadMemory(userId, 'text', 20, message),
      brain.loadMemory(userId, 'visual', 5, message),
      brain.loadMemory(userId, 'audio', 5, message),
      brain.loadFacts(userId, 20),
      brain._loadProfileCached(userId),
    ]);
    const memoryContext = brain.buildMemoryContext(memories, visualMem, audioMem, facts);
    const profileContext = profile ? profile.toContextString() : '';

    // ── 3. Emotion detection (fast, no AI needed) ──
    const lower = message.toLowerCase();
    let emotionalTone = 'neutral';
    let emotionHint = '';
    for (const [emo, { pattern, responseHint }] of Object.entries(brain.constructor.EMOTION_MAP || {})) {
      if (pattern.test(lower)) {
        emotionalTone = emo;
        emotionHint = responseHint || '';
        break;
      }
    }
    const frustration = brain.constructor.detectFrustration ? brain.constructor.detectFrustration(message) : 0;
    if (frustration > 0.6) {
      emotionHint = 'User is very frustrated. Be patient, acknowledge the issue, provide solutions quickly.';
    }

    // ── 3b. Context switch detection ──
    const topicKeywords = {
      trading:
        /\b(trade|trading|buy|sell|BTC|ETH|crypto|piață|preț|analiză|signal|RSI|MACD|invest|portofoliu|acțiuni|bursă|forex)\b/i,
      coding: /\b(code|coding|bug|error|function|deploy|API|server|git|commit|script|database|program)\b/i,
      news: /\b(news|știri|știre|politic|război|eveniment|actual|azi|ieri|breaking)\b/i,
      weather: /\b(vreme|meteo|weather|ploaie|soare|temperatură|grad|frig|cald)\b/i,
      music: /\b(muzică|music|song|cântec|artist|album|concert|playlist)\b/i,
      personal: /\b(eu|mine|viața|familie|sănătate|hobby|plan|sentiment|gândesc|simt)\b/i,
    };
    let currentTopic = 'general';
    for (const [topic, pattern] of Object.entries(topicKeywords)) {
      if (pattern.test(message)) {
        currentTopic = topic;
        break;
      }
    }
    // Static var to track previous topic across calls
    if (!brain._lastTopic) brain._lastTopic = 'general';
    let contextSwitchHint = '';
    if (brain._lastTopic !== currentTopic && brain._lastTopic !== 'general' && currentTopic !== 'general') {
      contextSwitchHint = `\n[CONTEXT SWITCH] Userul a trecut de la ${brain._lastTopic} la ${currentTopic}. Ajustează-ți tonul și cunoștințele.`;
    }
    brain._lastTopic = currentTopic;

    // ── 4. Build system prompt with FULL context ──
    const geoBlock = mediaData.geo
      ? `\n[USER LOCATION] Lat: ${mediaData.geo.lat}, Lng: ${mediaData.geo.lng}${mediaData.geo.accuracy ? ` (accuracy: ${Math.round(mediaData.geo.accuracy)}m)` : ''}. Use this for weather, nearby places, and location-aware responses.`
      : '';
    const memoryBlock = [profileContext, memoryContext].filter(Boolean).join(' || ');
    const emotionBlock = emotionHint ? `\n[EMOTIONAL CONTEXT] User mood: ${emotionalTone}. ${emotionHint}` : '';
    const now = new Date();
    const dateTimeBlock = `\n[CURRENT DATE & TIME] ${now.toLocaleDateString('ro-RO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ora ${now.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Bucharest' })} (Romania). Folosește MEREU aceste date când userul întreabă de zi, dată sau oră.`;
    const patternsBlock = getPatternsText();
    const qualityHints = getQualityHints();
    const proactiveHint = getProactiveSuggestion();
    const systemPrompt =
      process.env.NEWBORN_MODE === 'true'
        ? buildNewbornPrompt(memoryBlock + patternsBlock + qualityHints + contextSwitchHint + proactiveHint)
        : buildSystemPrompt(
            avatar,
            language,
            memoryBlock +
              emotionBlock +
              geoBlock +
              dateTimeBlock +
              patternsBlock +
              qualityHints +
              contextSwitchHint +
              proactiveHint,
            '',
            null
          );

    // ── 5. Prepare messages for Gemini ──
    // Compress history to last 20 messages max
    const recentHistory = (history || []).slice(-20).map((h) => ({
      role: h.role === 'user' ? 'user' : 'model',
      parts: [
        {
          text: typeof h.content === 'string' ? h.content : JSON.stringify(h.content),
        },
      ],
    }));

    // Handle vision: if image is provided, add it to the message
    const userParts = [];
    if (mediaData.imageBase64) {
      userParts.push({
        inlineData: {
          mimeType: mediaData.imageMimeType || 'image/jpeg',
          data: mediaData.imageBase64,
        },
      });
      // Auto-camera: add accessibility hint for concise descriptions
      if (mediaData.isAutoCamera) {
        userParts.push({
          text:
            '[AUTO-CAMERA] Aceasta e imagine automată de la camera utilizatorului. ' +
            'Regulă: NU descrie toată camera/scena. Fii SCURT (1-2 propoziții). ' +
            'Menționează DOAR: persoane (culori exacte de haine), pericole, text vizibil. ' +
            'Dacă nu e nimic nou de spus, nu comenta imaginea deloc — răspunde normal la mesaj.',
        });
      }
    }
    userParts.push({ text: message });

    const geminiMessages = [...recentHistory, { role: 'user', parts: userParts }];

    // ── 6. CALL GEMINI WITH TOOLS ──
    // First call: Gemini decides what tools to use
    const toolsUsed = [];
    const toolResults = [];
    let finalResponse = '';
    let totalTokens = 0;
    const MAX_TOOL_ROUNDS = 3; // Prevent infinite loops

    let currentMessages = geminiMessages;

    // ── Set media data so tool handlers can access uploaded images ──
    brain._currentMediaData = mediaData || {};

    const geminiApiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      // Agent logging removed — was hardcoded to localhost:7257
      throw new Error('GOOGLE_AI_KEY not configured — cannot call Gemini API');
    }

    const geminiModel = MODELS.GEMINI_CHAT;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
    const geminiTools = [{ functionDeclarations: toGeminiTools(TOOL_DEFINITIONS) }];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const geminiBody = {
        contents: currentMessages,
        tools: geminiTools,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          maxOutputTokens: 2048,
          temperature: 0.7,
        },
      };

      const r = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
      });

      if (!r.ok) {
        const errText = await r.text().catch(() => 'unknown');
        throw new Error(`Gemini API ${r.status}: ${errText.substring(0, 200)}`);
      }

      const response = await r.json();
      totalTokens +=
        (response.usageMetadata?.promptTokenCount || 0) + (response.usageMetadata?.candidatesTokenCount || 0);

      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) {
        // No content — check for safety block or empty response
        const blockReason = candidate?.finishReason || response.promptFeedback?.blockReason;
        if (blockReason) logger.warn({ component: 'BrainV4', blockReason }, 'Gemini blocked response');
        break;
      }

      const parts = candidate.content.parts;

      // Check if Gemini wants to use tools (functionCall parts)
      const functionCalls = parts.filter((p) => p.functionCall);
      if (functionCalls.length === 0) {
        // No tool calls — extract text response
        finalResponse = parts
          .filter((p) => p.text)
          .map((p) => p.text)
          .join('\n');
        break;
      }

      // Execute all requested tools in parallel
      const toolPromises = functionCalls.map(async (fc) => {
        const result = await executeTool(brain, fc.functionCall.name, fc.functionCall.args || {}, userId);
        toolsUsed.push(fc.functionCall.name);
        toolResults.push({ name: fc.functionCall.name, result });
        brain.toolStats[fc.functionCall.name] = (brain.toolStats[fc.functionCall.name] || 0) + 1;
        return {
          functionResponse: {
            name: fc.functionCall.name,
            response:
              typeof result === 'string'
                ? { result }
                : JSON.parse(JSON.stringify(result, (_, v) => (typeof v === 'string' ? v.substring(0, 4000) : v))),
          },
        };
      });

      const toolResponseParts = await Promise.all(toolPromises);

      // Add model response + tool results to conversation
      currentMessages = [
        ...currentMessages,
        { role: 'model', parts: candidate.content.parts },
        { role: 'user', parts: toolResponseParts },
      ];
    }

    // ── 7. Post-processing ──
    const thinkTime = Date.now() - startTime;

    // Save memory (async, non-blocking)
    brain.saveMemory(userId, 'text', message, { response: finalResponse.substring(0, 200) }, 5).catch((err) => {
      console.error(err);
    });
    brain.learnFromConversation(userId, message, finalResponse).catch((err) => {
      console.error(err);
    });
    if (profile) {
      profile.updateFromConversation(message, language, {
        emotionalTone,
        topics: [],
      });
      profile.save(brain.supabaseAdmin).catch((err) => {
        console.error(err);
      });
    }

    // Track usage
    brain.incrementUsage(userId, toolsUsed.length, totalTokens).catch((err) => {
      console.error(err);
    });

    // Confidence
    let confidence = 0.7;
    if (toolsUsed.length > 0) confidence += 0.15;
    if (toolsUsed.length > 2) confidence += 0.1;
    confidence = Math.min(1.0, confidence);

    // ── Multi-AI Consensus for complex/critical queries ──
    // Triggers when: query used 2+ tools OR frustration is high OR no tools verified data
    let consensusEngine = null;
    const isComplex = toolsUsed.length >= 2 || frustration >= 3;
    const needsVerification = toolsUsed.length === 0 && message.length > 80;
    if ((isComplex || needsVerification) && typeof brain.multiAIConsensus === 'function') {
      try {
        const consensusResult = await brain.multiAIConsensus(
          `Verify and improve this answer if needed. User question: "${message.substring(0, 300)}"\nCurrent answer: "${finalResponse.substring(0, 500)}"\nProvide ONLY the improved answer text, nothing else.`,
          800
        );
        if (consensusResult && consensusResult.text) {
          consensusEngine = consensusResult.engine;
          if (consensusResult.consensus) confidence = Math.min(1.0, confidence + 0.1);
          // Use consensus answer only if it's substantially different and longer
          if (consensusResult.text.length > finalResponse.length * 1.3) {
            finalResponse = consensusResult.text;
            logger.info({ component: 'BrainV4', engine: consensusEngine }, '🤝 Consensus answer used');
          }
        }
      } catch (e) {
        logger.warn({ component: 'BrainV4', err: e.message }, 'Consensus check failed (non-blocking)');
      }
    }

    logger.info(
      {
        component: 'BrainV4',
        tools: toolsUsed,
        rounds: toolResults.length,
        thinkTime,
        tokens: totalTokens,
      },
      `🧠 V4 Think: ${toolsUsed.length} tools | ${thinkTime}ms | ${totalTokens} tokens`
    );

    // Agent logging removed — was hardcoded to localhost:7257
    // ── Self-evaluate response quality ──
    try {
      const evalDomain = toolsUsed.includes('trading_analysis')
        ? 'trading'
        : toolsUsed.includes('web_search')
          ? 'research'
          : toolsUsed.includes('code_execute')
            ? 'coding'
            : 'general';
      selfEvaluate(message, finalResponse, evalDomain);
      recordUserInteraction({ domain: evalDomain, userMessage: message });
    } catch (_) {
      /* non-blocking */
    }

    return {
      enrichedMessage: finalResponse,
      enrichedContext: finalResponse,
      toolsUsed,
      monitor: extractMonitor(toolResults),
      analysis: {
        complexity: toolsUsed.length > 1 ? 'complex' : 'simple',
        emotionalTone,
        language: language || 'ro',
        topics: [],
        isEmotional: emotionalTone !== 'neutral',
        frustrationLevel: frustration,
      },
      chainOfThought: null, // Gemini does it internally
      compressedHistory: recentHistory,
      failedTools: toolResults.filter((r) => r.result?.error).map((r) => r.name),
      thinkTime,
      confidence,
      sourceTags: toolsUsed.length > 0 ? ['VERIFIED', ...toolsUsed.map((t) => `SOURCE:${t}`)] : ['ASSUMPTION'],
      agent: 'v4-gemini-tools',
      profileLoaded: !!profile,
    };
  } catch (e) {
    const thinkTime = Date.now() - startTime;
    brain.recordError('thinkV4', e.message);
    logger.error({ component: 'BrainV4', err: e.message, thinkTime }, `🧠 V4 Think failed: ${e.message}`);
    // Agent logging removed — was hardcoded to localhost:7257

    // FALLBACK to v3 think
    logger.info({ component: 'BrainV4' }, '⚠️ Falling back to v3 think');
    try {
      return await brain.think(message, avatar, history, language, userId, conversationId, mediaData, isAdmin);
    } catch (e2) {
      // Agent logging removed — was hardcoded to localhost:7257
      return {
        enrichedMessage:
          language === 'ro'
            ? 'Îmi pare rău, am întâmpinat o problemă tehnică și nu pot răspunde acum. Te rog să încerci din nou. 🔧'
            : "I'm sorry, I encountered a technical issue and can't respond right now. Please try again. 🔧",
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: {
          complexity: 'simple',
          language: language || 'ro',
          emotionalTone: 'neutral',
          topics: [],
        },
        chainOfThought: null,
        compressedHistory: history || [],
        failedTools: [],
        thinkTime,
        confidence: 0,
        agent: 'error-fallback',
        error: `V4: ${e.message} | V3: ${e2.message}`,
      };
    }
  }
}

/**
 * undefined
 * @returns {*}
 */
module.exports = { thinkV4, TOOL_DEFINITIONS, executeTool };
