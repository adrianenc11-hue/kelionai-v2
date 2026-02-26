'use strict';
// ═══════════════════════════════════════════════════════════════
// KelionAI — Emergency SOS helper
// ═══════════════════════════════════════════════════════════════

// Emergency numbers by country (detected from language)
const EMERGENCY = {
    ro: { police: '112', fire: '112', ambulance: '112', mountain: '0SALVAMONT', general: '112' },
    en: { police: '999/911', fire: '999/911', ambulance: '999/911', general: '112' },
    es: { police: '112', fire: '112', ambulance: '112', general: '112' },
    fr: { police: '17', fire: '18', ambulance: '15', general: '112' },
    de: { police: '110', fire: '112', ambulance: '112', general: '112' },
    it: { police: '113', fire: '115', ambulance: '118', general: '112' },
};

function buildEmergencyResponse(language, user) {
    const nums = EMERGENCY[language] || EMERGENCY.ro;
    const lang = language || 'ro';

    if (lang === 'en') {
        return `🚨 EMERGENCY DETECTED!
Emergency number: ${nums.general}
Police: ${nums.police} | Fire: ${nums.fire} | Ambulance: ${nums.ambulance}
European emergency number: 112 (works across the EU)

If you are in immediate danger:
1. Call ${nums.general} NOW
2. Stay calm and describe the situation
3. Do not hang up

${user ? 'I have noted this situation. Are you safe?' : 'Are you safe?'}

⚠️ KelionAI cannot contact emergency services. Call ${nums.general} directly.`;
    }

    if (lang === 'fr') {
        return `🚨 URGENCE DÉTECTÉE!
Police: ${nums.police} | Pompiers: ${nums.fire} | SAMU: ${nums.ambulance} | Numéro général: ${nums.general}

Si vous êtes en danger immédiat:
1. Appelez le ${nums.general} MAINTENANT
2. Restez calme et décrivez la situation
3. Ne raccrochez pas

${user ? 'J\'ai enregistré cette situation. Êtes-vous en sécurité?' : 'Êtes-vous en sécurité?'}

⚠️ KelionAI ne peut pas contacter les services d'urgence. Appelez le ${nums.general} directement.`;
    }

    if (lang === 'de') {
        return `🚨 NOTFALL ERKANNT!
Polizei: ${nums.police} | Feuerwehr: ${nums.fire} | Rettung: ${nums.ambulance} | EU-Notruf: ${nums.general}

Wenn Sie in unmittelbarer Gefahr sind:
1. Rufen Sie ${nums.general} JETZT an
2. Bleiben Sie ruhig und beschreiben Sie die Situation
3. Legen Sie nicht auf

${user ? 'Ich habe diese Situation aufgezeichnet. Sind Sie in Sicherheit?' : 'Sind Sie in Sicherheit?'}

⚠️ KelionAI kann keine Notdienste kontaktieren. Rufen Sie ${nums.general} direkt an.`;
    }

    if (lang === 'it') {
        return `🚨 EMERGENZA RILEVATA!
Polizia: ${nums.police} | Vigili del fuoco: ${nums.fire} | Ambulanza: ${nums.ambulance} | Numero generale: ${nums.general}

Se sei in pericolo immediato:
1. Chiama il ${nums.general} ORA
2. Rimani calmo e descrivi la situazione
3. Non riagganciare

${user ? 'Ho registrato questa situazione. Sei al sicuro?' : 'Sei al sicuro?'}

⚠️ KelionAI non può contattare i servizi di emergenza. Chiama il ${nums.general} direttamente.`;
    }

    if (lang === 'es') {
        return `🚨 EMERGENCIA DETECTADA!
Policía: ${nums.police} | Bomberos: ${nums.fire} | Ambulancia: ${nums.ambulance} | Número general: ${nums.general}

Si estás en peligro inmediato:
1. Llama al ${nums.general} AHORA
2. Mantén la calma y describe la situación
3. No cuelgues

${user ? 'He registrado esta situación. ¿Estás seguro/a?' : '¿Estás seguro/a?'}

⚠️ KelionAI no puede contactar a los servicios de emergencia. Llama al ${nums.general} directamente.`;
    }

    // Default: Romanian
    return `🚨 URGENȚĂ DETECTATĂ!
Număr urgențe România: 112
Pompieri: 112 | Poliție: 112 | Ambulanță: 112
Număr european: 112 (funcționează în toată UE)

Dacă ești în pericol iminent:
1. Sună 112 ACUM
2. Rămâi calm și descrie situația
3. Nu închide telefonul

${user ? 'Am înregistrat această situație. Ești în siguranță?' : 'Ești în siguranță?'}

⚠️ KelionAI nu poate contacta serviciile de urgență. Sună 112 direct.`;
}

module.exports = { buildEmergencyResponse, EMERGENCY };
