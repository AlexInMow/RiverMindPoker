import { useEffect, useState } from "react";
import type { Language } from "../../shared/types";
import type { LocalPlayerProfile } from "../../shared/history";
import { api } from "../api";
import { LanguageSwitch } from "./LanguageSwitch";

export function ProfileSelect({ language, onLanguage, onSelect }: { language: Language; onLanguage: (language: Language) => void; onSelect: (profile: LocalPlayerProfile) => void }) {
  const [profiles, setProfiles] = useState<LocalPlayerProfile[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const load = () => void api.profiles().then(setProfiles).catch((reason) => setError(String(reason)));
  useEffect(load, []);
  const create = async () => {
    try { const profile = await api.createProfile(name); setName(""); onSelect(profile); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const rename = async (profile: LocalPlayerProfile) => {
    const next = window.prompt(language === "ru" ? "Новое имя" : "New name", profile.displayName);
    if (next === null) return;
    try { await api.renameProfile(profile.id, next); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const remove = async (profile: LocalPlayerProfile) => {
    const message = language === "ru" ? `Скрыть профиль «${profile.displayName}»? История останется в локальной базе.` : `Hide “${profile.displayName}”? Its history will remain in the local database.`;
    if (!window.confirm(message)) return;
    try { await api.deleteProfile(profile.id); load(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <main className="profile-shell">
    <LanguageSwitch language={language} onChange={onLanguage} className="setup-language" />
    <div className="brand"><span className="brand-chip">R</span><span>RIVERMIND</span></div>
    <section className="profile-card">
      <span className="eyebrow">{language === "ru" ? "ЛОКАЛЬНЫЕ ПРОФИЛИ" : "LOCAL PROFILES"}</span>
      <h1>{language === "ru" ? "Кто играет?" : "Who is playing?"}</h1>
      <p>{language === "ru" ? "Статистика и история хранятся только на этом Mac." : "Statistics and history stay on this Mac."}</p>
      <div className="profile-list">{profiles.map((profile) => <div className="profile-row" key={profile.id}>
        <button className="profile-name" onClick={() => onSelect(profile)}><span>{profile.displayName.slice(0, 1).toUpperCase()}</span><b>{profile.displayName}</b></button>
        <button onClick={() => void rename(profile)} title={language === "ru" ? "Переименовать" : "Rename"}>✎</button>
        <button onClick={() => void remove(profile)} title={language === "ru" ? "Удалить" : "Delete"}>×</button>
      </div>)}</div>
      <div className="profile-create"><input maxLength={40} value={name} placeholder={language === "ru" ? "Имя нового игрока" : "New player name"} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} /><button disabled={!name.trim()} onClick={() => void create()}>{language === "ru" ? "СОЗДАТЬ" : "CREATE"}</button></div>
      {error && <p className="profile-error">{error}</p>}
    </section>
  </main>;
}
