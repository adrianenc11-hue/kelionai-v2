import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import ro from "./ro.json";
import en from "./en.json";
import es from "./es.json";
import fr from "./fr.json";
import de from "./de.json";

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { ro: { translation: ro }, en: { translation: en }, es: { translation: es }, fr: { translation: fr }, de: { translation: de } },
    fallbackLng: "en",
    detection: { order: ["localStorage", "navigator"], caches: ["localStorage"] },
    interpolation: { escapeValue: false },
  });

export default i18n;
