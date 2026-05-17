// src/lib/transcriptProcessor.js

// A professional dictionary for correcting commonly butchered words by SpeechRecognition
const DICTIONARY = [
  // Kelion / AI Core
  [/\b(calion|celion|khelion|quelion|chelion|chellion|kelio)\b/gi, "Kelion"],
  [/\b(kelion ai|kelion a i|chellion ai|chelion ai|calion ai)\b/gi, "KelionAI"],
  [/\b(open router|open ruter)\b/gi, "OpenRouter"],
  [/\b(gemini|gemeni|jemini)\b/gi, "Gemini"],
  [/\b(gemini|gemeny|jiminy|germany)\b/gi, "Gemini"],
  [/\b(flash|flas|fles)\b/gi, "Flash"],
  [/\b(eleven labs|ileven labs)\b/gi, "ElevenLabs"],
  
  // DevOps / Git / Tech
  [/\b(guit|ghit)\b/gi, "git"],
  [/\b(comit|comite|commitul|comitul)\b/gi, "commit"],
  [/\b(puș|puși|pus|push ul)\b/gi, "push"],
  [/\b(pul|pull ul|pool)\b/gi, "pull"],
  [/\b(diploie|deploi|deploit|diploy|diplooy)\b/gi, "deploy"],
  [/\b(apii|ipi|e p i|eipi|e ipi ai)\b/gi, "API"],
  [/\b(uil|iu ai|ju ai)\b/gi, "UI"],
  [/\b(bechend|backendul|bekend)\b/gi, "backend"],
  [/\b(frontendul|front end|frondend)\b/gi, "frontend"],
  [/\b(mărgi|mearg|mărgiul)\b/gi, "merge"],
  [/\b(branș|branchul|branci)\b/gi, "branch"],
  [/\b(repi|repo ul|ripou)\b/gi, "repo"],
  [/\b(reiluei|railuei|railwai|reilway)\b/gi, "Railway"],
  [/\b(nod js|noud|nout js)\b/gi, "Node.js"],
  [/\b(react ul|riact)\b/gi, "React"],
  [/\b(doker|docăr|docar)\b/gi, "Docker"],
  [/\b(daba beis|data beis)\b/gi, "Database"],
  
  // Common terms
  [/\b(script ul|scriptul)\b/gi, "script"],
  [/\b(updeit|update ul|abdeit)\b/gi, "update"],
  [/\b(refactoring|rifactoring|refactorizare)\b/gi, "refactor"],
  [/\b(bufer|bafer)\b/gi, "buffer"]
];

export function correctTranscript(text) {
  if (!text) return text;
  let corrected = text;
  for (const [pattern, replacement] of DICTIONARY) {
    // We use a replacer function to preserve capitalization if possible, 
    // or just drop the exact replacement.
    corrected = corrected.replace(pattern, replacement);
  }
  
  // Capitalize first letter as a professional touch
  if (corrected.length > 0) {
    corrected = corrected.charAt(0).toUpperCase() + corrected.slice(1);
  }
  
  return corrected;
}
