import { useEffect, useMemo, useState } from "react";
import type { Language, PublicGameState } from "../../shared/types";
import { t } from "../i18n";

export function Controls({ game, disabled, onAction, onNext, language }: { game: PublicGameState; disabled: boolean; onAction: (type: string, amount?: number) => void; onNext: () => void; language: Language }) {
  const fixed = (type: string) => game.legalActions.find((action) => action.type === type);
  const sizing = fixed("raise") ?? fixed("bet");
  const [amount, setAmount] = useState(sizing?.min ?? 0);
  useEffect(() => setAmount(sizing?.min ?? 0), [game.handNumber, game.street, sizing?.min]);
  const clamp = (value: number) => sizing ? Math.max(sizing.min!, Math.min(sizing.max!, Math.round(value))) : 0;
  const quickSizes = useMemo(() => [
    ["⅓", game.pot / 3], ["½", game.pot / 2], ["⅔", game.pot * 2 / 3], ["¾", game.pot * 3 / 4], [t(language, "pot"), game.pot],
  ] as Array<[string, number]>, [game.pot, language]);

  if (game.street === "complete") return <div className="complete-actions"><span>{t(language, "nextAuto")}</span>{!game.matchOver && <button disabled={disabled} onClick={onNext}>{t(language, "nextHand")} <b>→</b></button>}</div>;
  return (
    <div className={`controls ${disabled ? "disabled" : ""}`}>
      {sizing && <div className="sizing-row">
        <div className="quick-sizes">{quickSizes.map(([label, value]) => <button key={label} disabled={disabled} onClick={() => setAmount(clamp(value))}>{label}</button>)}<button disabled={disabled} onClick={() => setAmount(sizing.max!)}>{t(language, "max")}</button></div>
        <input className="bet-slider" type="range" min={sizing.min} max={sizing.max} step={Math.max(1, game.config.smallBlind)} value={amount} disabled={disabled} onChange={(event) => setAmount(Number(event.target.value))} />
        <label className="amount-input"><span>{t(language, "to")}</span><input type="number" min={sizing.min} max={sizing.max} value={amount} disabled={disabled} onChange={(event) => setAmount(clamp(Number(event.target.value)))} /></label>
      </div>}
      <div className="action-row">
        {fixed("fold") && <button className="action secondary danger fold-action" disabled={disabled} onClick={() => onAction("fold")}>{t(language, "fold")}</button>}
        {fixed("check") && <button className="action secondary" disabled={disabled} onClick={() => onAction("check")}>{t(language, "check")}</button>}
        {fixed("call") && <button className="action call" disabled={disabled} onClick={() => onAction("call")}>{t(language, "call")} <strong>{fixed("call")!.amount}</strong></button>}
        {sizing && <button className="action primary" disabled={disabled} onClick={() => onAction(sizing.type, amount)}>{sizing.type === "bet" ? t(language, "bet") : t(language, "raiseTo")} <strong>{amount}</strong></button>}
        {fixed("all-in") && <button className="action allin" disabled={disabled} onClick={() => onAction("all-in")}>{t(language, "allIn")} <strong>{fixed("all-in")!.amount}</strong></button>}
      </div>
    </div>
  );
}
