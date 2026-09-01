import type { Card as CardType, Suit } from "../../shared/types";

const suitSymbols: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function PlayingCard({ card, hidden = false, delay = 0, small = false }: { card?: CardType; hidden?: boolean; delay?: number; small?: boolean }) {
  if (hidden || !card) return <div className={`playing-card card-back ${small ? "small" : ""}`} style={{ animationDelay: `${delay}ms` }}><div className="back-mark">RM</div></div>;
  const rank = card[0] === "T" ? "10" : card[0];
  const suit = card[1] as Suit;
  const red = suit === "h" || suit === "d";
  return (
    <div className={`playing-card ${red ? "red" : "black"} ${small ? "small" : ""}`} style={{ animationDelay: `${delay}ms` }}>
      <div className="card-corner"><span>{rank}</span><span>{suitSymbols[suit]}</span></div>
      <div className="card-suit">{suitSymbols[suit]}</div>
      <div className="card-corner bottom"><span>{rank}</span><span>{suitSymbols[suit]}</span></div>
    </div>
  );
}
