// 추가됨: 프론트엔드 족보 계산 유틸리티 (Lambda Python 로직과 동일하게 포팅)

import type { Card } from "./types";

// ─── 상수 ─────────────────────────────────────────────

export const RANK_MAP: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "10": 10, "T": 10,
  "J": 11, "Q": 12, "K": 13, "A": 14,
};

const RANK_DISPLAY: Record<number, string> = {
  2:"2", 3:"3", 4:"4", 5:"5", 6:"6", 7:"7",
  8:"8", 9:"9", 10:"10", 11:"J", 12:"Q", 13:"K", 14:"A",
};

export const HAND_NAMES: Record<number, string> = {
  9: "로열 플러시", 8: "스트레이트 플러시", 7: "포카드",
  6: "풀하우스",   5: "플러시",           4: "스트레이트",
  3: "트리플",     2: "투페어",            1: "원페어",     0: "하이카드",
};

type ParsedCard = [number, string]; // [rank_int, suit]

// ─── 내부 유틸 ─────────────────────────────────────────

function parseCard(c: Card): ParsedCard {
  return [RANK_MAP[c.rank] ?? 0, c.suit];
}

function compareTB(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// ─── evaluate5: Python evaluate_5 와 동일한 로직 ────────

function evaluate5(cards: ParsedCard[]): [number, number[]] {
  const ranks = cards.map(([r]) => r).sort((a, b) => b - a);
  const suits = cards.map(([, s]) => s);

  const rankCount: Record<number, number> = {};
  ranks.forEach(r => { rankCount[r] = (rankCount[r] ?? 0) + 1; });

  const groups = Object.entries(rankCount)
    .map(([r, c]) => ({ rank: Number(r), count: c }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  const counts = groups.map(g => g.count);
  const groupRanks = groups.map(g => g.rank);

  const isFlush = new Set(suits).size === 1;
  let isStraight = false;
  let straightHigh = 0;

  const uniqueRanks = [...new Set(ranks)].sort((a, b) => b - a);

  // 일반 스트레이트
  if (uniqueRanks.length >= 5) {
    for (let i = 0; i <= uniqueRanks.length - 5; i++) {
      const w = uniqueRanks.slice(i, i + 5);
      if (w[0] - w[4] === 4 && new Set(w).size === 5) {
        isStraight = true;
        straightHigh = w[0];
        break;
      }
    }
  }
  // 휠 스트레이트 (A-2-3-4-5)
  if (!isStraight) {
    const rset = new Set(ranks);
    if ([14, 2, 3, 4, 5].every(r => rset.has(r))) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  if (isFlush && isStraight) {
    const rset = new Set(ranks);
    if (straightHigh === 14 && [10, 11, 12, 13, 14].every(r => rset.has(r))) return [9, [14]];
    return [8, [straightHigh]];
  }
  if (counts[0] === 4)                       return [7, groupRanks];
  if (counts[0] === 3 && counts[1] === 2)    return [6, groupRanks];
  if (isFlush)                               return [5, ranks];
  if (isStraight)                            return [4, [straightHigh]];
  if (counts[0] === 3)                       return [3, groupRanks];
  if (counts[0] === 2 && counts[1] === 2)    return [2, groupRanks];
  if (counts[0] === 2)                       return [1, groupRanks];
  return [0, ranks];
}

// ─── bestHand: Python best_hand 와 동일한 로직 ──────────

export function bestHand(hole: Card[], community: Card[]): [number, number[]] {
  const allCards = [...hole, ...community].map(parseCard);
  if (allCards.length === 0) return [0, []];

  // 5장 미만: 단순 평가 (프리플랍 등)
  if (allCards.length < 5) {
    const ranks = allCards.map(([r]) => r).sort((a, b) => b - a);
    const rankCount: Record<number, number> = {};
    ranks.forEach(r => { rankCount[r] = (rankCount[r] ?? 0) + 1; });
    if (Math.max(...Object.values(rankCount)) >= 2) return [1, ranks];
    return [0, ranks];
  }

  // 모든 5C(n) 조합에서 최선 찾기
  let best: [number, number[]] | null = null;
  const n = allCards.length;
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const res = evaluate5([allCards[a], allCards[b], allCards[c], allCards[d], allCards[e]]);
            if (!best || res[0] > best[0] || (res[0] === best[0] && compareTB(res[1], best[1]) > 0))
              best = res;
          }
  return best!;
}

// ─── detectDraws: Python detect_draws 와 동일한 로직 ────

export function detectDraws(hole: Card[], community: Card[]): string[] {
  const allCards = [...hole, ...community].map(parseCard);
  const draws: string[] = [];
  if (allCards.length < 2) return draws;

  // 플러시 드로우: 같은 무늬 4장
  const suitCount: Record<string, number> = {};
  allCards.forEach(([, s]) => { suitCount[s] = (suitCount[s] ?? 0) + 1; });
  if (Math.max(...Object.values(suitCount)) === 4) draws.push("flush_draw");

  // 스트레이트 드로우
  const uniqueRanks = [...new Set(allCards.map(([r]) => r))].sort((a, b) => a - b);
  let hasOesd = false;
  let hasGutshot = false;

  for (let i = 0; i <= uniqueRanks.length - 4; i++) {
    const w = uniqueRanks.slice(i, i + 4);
    if (w[3] - w[0] === 3) { hasOesd = true; break; }
    if (w[3] - w[0] <= 4)  { hasGutshot = true; }
  }
  // 휠 드로우 (A-2-3-4 또는 2-3-4-5)
  const rset = new Set(uniqueRanks);
  if (
    [14, 2, 3, 4].every(r => rset.has(r)) ||
    [2, 3, 4, 5].every(r => rset.has(r))
  ) {
    hasOesd = true;
  }

  if (hasOesd)         draws.push("oesd");
  else if (hasGutshot) draws.push("gutshot");

  return draws;
}

// ─── getHandInfo: UI용 통합 결과 ────────────────────────

export interface HandInfo {
  rank: number;
  name: string;
  description: string;
  color: string;
  stars: number;
  strengthText: string;
  draws: string[];
  drawText: string;
}

export function getHandInfo(hole: Card[], community: Card[]): HandInfo {
  const [rank, tiebreaker] = bestHand(hole, community);
  const draws = detectDraws(hole, community);
  const name = HAND_NAMES[rank];

  // 세부 설명 (핵심 카드 포함)
  let description = name;
  const r0 = RANK_DISPLAY[tiebreaker[0]];
  const r1 = RANK_DISPLAY[tiebreaker[1]];
  if      (rank === 1 && r0)       description = `${name} (${r0})`;
  else if (rank === 2 && r0 && r1) description = `${name} (${r0}, ${r1})`;
  else if (rank === 3 && r0)       description = `${name} (${r0}s)`;
  else if (rank === 4 && r0)       description = `${name} (${r0} 하이)`;
  else if (rank === 5 && r0)       description = `${name} (${r0} 하이)`;
  else if (rank === 6 && r0)       description = `${name} (${r0} 풀)`;
  else if (rank === 7 && r0)       description = `${name} (${r0}s)`;

  // 족보별 색상
  const color =
    rank === 0 ? "#8b949e" :
    rank === 1 ? "#e0e0e0" :
    rank === 2 ? "#2ecc71" :
    rank <= 4  ? "#79c0ff" :
    rank <= 6  ? "#a78bfa" :
                 "#ffd700";

  // 강도 (별점 + 텍스트)
  const strengthMap: Record<number, [number, string]> = {
    0: [1, "약한 패입니다"],
    1: [2, "평범한 패입니다"],
    2: [3, "괜찮은 패입니다"],
    3: [4, "강한 패입니다"],
    4: [4, "매우 강한 패입니다"],
    5: [4, "매우 강한 패입니다"],
    6: [5, "최강 패입니다!"],
    7: [5, "최강 패입니다!"],
    8: [5, "최강 패입니다!"],
    9: [5, "최강 패입니다!"],
  };
  const [stars, strengthText] = strengthMap[rank] ?? [1, ""];

  // 드로우 안내
  let drawText = "";
  if      (draws.includes("flush_draw")) drawText = "카드 1장으로 플러시 완성 가능";
  else if (draws.includes("oesd"))       drawText = "카드 1장으로 스트레이트 완성 가능";
  else if (draws.includes("gutshot"))    drawText = "운이 좋으면 스트레이트 완성 가능";

  return { rank, name, description, color, stars, strengthText, draws, drawText };
}
