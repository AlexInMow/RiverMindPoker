import type { Language } from "../../shared/types";

export function LanguageSwitch({ language, onChange, className = "" }: { language: Language; onChange: (language: Language) => void; className?: string }) {
  return <div className={`language-switch ${className}`} aria-label="Language / Язык"><button className={language === "ru" ? "active" : ""} onClick={() => onChange("ru")}>RU</button><i /><button className={language === "en" ? "active" : ""} onClick={() => onChange("en")}>EN</button></div>;
}
