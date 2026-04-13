export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export type Street = "preflop" | "flop" | "turn" | "river";

export interface Card {
  suit: Suit;
  rank: Rank;
}

export interface PlayerState {
  id: number;
  isUser: boolean;
  chips: number;
  currentBet: number;
  totalBet: number;
  folded: boolean;
  isDealer: boolean;
  cards: Card[];
}

export interface PlayerChips {
  chips: number;
  totalGames: number;
  totalWins: number;
}

export interface AIRecommendation {
  action: "fold" | "call" | "raise" | "check";
  raise_amount?: number;
  raise_options?: { min: number; halfPot: number; potSize: number; twicePot: number; allIn: number };
  confidence: "low" | "medium" | "high";
  hand_strength?: string;
  win_probability?: string;
  bluff_recommended: boolean;
  reason: string;
  warning: string;
}

export interface ShowdownResult {
  winner: { id: number; isUser: boolean };
  allPlayerCards: { id: number; cards: Card[]; folded: boolean }[];
  handRanks: { playerId: number; rank: number; label: string }[];
  finalChips: { id: number; chips: number }[];
  pot: number;
  updatedChips?: number;
  isGameOver?: boolean;
}
