import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import mysql from "mysql2/promise";
import axios from "axios";
import cors from "cors";

const app = express();
const PORT = 80;

app.use(cors());
app.use(express.json());

// ─── 카드 덱 유틸 ─────────────────────────────────────────────────

type Suit = "♠" | "♥" | "♦" | "♣";
type Rank = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";

interface Card {
  suit: Suit;
  rank: Rank;
}

interface PlayerState {
  id: number;
  isUser: boolean;
  chips: number;
  currentBet: number;
  totalBet: number;
  folded: boolean;
  isDealer: boolean;
  cards: Card[];
  isAllIn?: boolean;      // 변경됨: 올인 여부 플래그
  aiRaiseCount?: number;  // 변경됨: AI 연속 레이즈 카운트 (스트리트별 리셋)
}

function createDeck(): Card[] {
  const suits: Suit[] = ["♠", "♥", "♦", "♣"];
  const ranks: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck: Card[] = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function dealCards(deck: Card[], count: number): { dealt: Card[]; remaining: Card[] } {
  return {
    dealt: deck.slice(0, count),
    remaining: deck.slice(count),
  };
}

// ─── 핸드 랭크 평가 ────────────────────────────────────────────────

const RANK_VALUE: Record<string, number> = {
  '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,
  '9':9,'10':10,'J':11,'Q':12,'K':13,'A':14
};
const RANK_NAME: Record<number, string> = {
  2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',
  9:'9',10:'10',11:'잭',12:'퀸',13:'킹',14:'에이스'
};

interface HandResult {
  handName: string;
  handRank: number;
  tiebreaker: number[];
  description: string;
}

function evaluate5Cards(cards: Card[]): HandResult {
  const ranks = cards.map(c => RANK_VALUE[c.rank]).sort((a,b) => b-a);
  const suits = cards.map(c => c.suit);
  const rankCount: Record<number,number> = {};
  ranks.forEach(r => { rankCount[r] = (rankCount[r]||0)+1; });
  const groups = Object.entries(rankCount)
    .map(([r,c]) => ({ rank: Number(r), count: c }))
    .sort((a,b) => b.count-a.count || b.rank-a.rank);
  const counts = groups.map(g => g.count);
  const groupRanks = groups.map(g => g.rank);
  const isFlush = new Set(suits).size === 1;
  const uniqueRanks = [...new Set(ranks)].sort((a,b) => b-a);
  let isStraight = false, straightHigh = 0;
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0]-uniqueRanks[4] === 4) { isStraight=true; straightHigh=uniqueRanks[0]; }
    if (uniqueRanks[0]===14&&uniqueRanks[1]===5&&uniqueRanks[2]===4&&uniqueRanks[3]===3&&uniqueRanks[4]===2) {
      isStraight=true; straightHigh=5;
    }
  }
  if (isFlush&&isStraight&&straightHigh===14) return { handName:'로열 플러시', handRank:9, tiebreaker:[9], description:'최강 패! 무조건 올인하세요.' };
  if (isFlush&&isStraight) return { handName:`스트레이트 플러시 (${RANK_NAME[straightHigh]} 하이)`, handRank:8, tiebreaker:[8,straightHigh], description:'매우 강한 패입니다.' };
  if (counts[0]===4) return { handName:`포카드 (${RANK_NAME[groupRanks[0]]}s)`, handRank:7, tiebreaker:[7,groupRanks[0],groupRanks[1]], description:'매우 강한 패입니다.' };
  if (counts[0]===3&&counts[1]===2) return { handName:`풀하우스 (${RANK_NAME[groupRanks[0]]} 풀 오브 ${RANK_NAME[groupRanks[1]]})`, handRank:6, tiebreaker:[6,groupRanks[0],groupRanks[1]], description:'강한 패입니다.' };
  if (isFlush) return { handName:`플러시 (${RANK_NAME[ranks[0]]} 하이)`, handRank:5, tiebreaker:[5,...ranks], description:'준수한 패입니다.' };
  if (isStraight) return { handName:`스트레이트 (${RANK_NAME[straightHigh]} 하이)`, handRank:4, tiebreaker:[4,straightHigh], description:'준수한 패입니다.' };
  if (counts[0]===3) return { handName:`트리플 (${RANK_NAME[groupRanks[0]]}s)`, handRank:3, tiebreaker:[3,groupRanks[0],groupRanks[1],groupRanks[2]], description:'어느 정도 강한 패입니다.' };
  if (counts[0]===2&&counts[1]===2) return { handName:`투페어 (${RANK_NAME[groupRanks[0]]} & ${RANK_NAME[groupRanks[1]]})`, handRank:2, tiebreaker:[2,groupRanks[0],groupRanks[1],groupRanks[2]], description:'보통 수준의 패입니다.' };
  if (counts[0]===2) return { handName:`원페어 (${RANK_NAME[groupRanks[0]]}s)`, handRank:1, tiebreaker:[1,...groupRanks], description:'약한 패입니다.' };
  return { handName:`하이카드 (${RANK_NAME[ranks[0]]})`, handRank:0, tiebreaker:[0,...ranks], description:'매우 약한 패입니다.' };
}

function compareTiebreaker(a: number[], b: number[]): number {
  for (let i=0; i<Math.min(a.length,b.length); i++) {
    if (a[i]!==b[i]) return a[i]-b[i];
  }
  return 0;
}

function getBestFiveCardHand(cards: Card[]): HandResult {
  const n = cards.length;
  let best: HandResult | null = null;
  function combine(start: number, chosen: Card[]) {
    if (chosen.length===5) {
      const result = evaluate5Cards(chosen);
      if (!best || compareTiebreaker(result.tiebreaker, best.tiebreaker)>0) best=result;
      return;
    }
    for (let i=start; i<=n-(5-chosen.length); i++) combine(i+1,[...chosen,cards[i]]);
  }
  combine(0,[]);
  return best!;
}

function evaluateHand(holeCards: Card[], communityCards: Card[]): HandResult {
  const all = [...holeCards, ...communityCards];
  if (all.length < 5) {
    const ranks = all.map(c => RANK_VALUE[c.rank]);
    const suits = all.map(c => c.suit);
    const rankCount: Record<number,number> = {};
    ranks.forEach(r => { rankCount[r]=(rankCount[r]||0)+1; });
    const maxCount = Math.max(...Object.values(rankCount));
    const suitCount: Record<string,number> = {};
    suits.forEach(s => { suitCount[s]=(suitCount[s]||0)+1; });
    if (maxCount>=2) {
      const pairRank = Number(Object.entries(rankCount).find(([,c])=>c>=2)?.[0]);
      return { handName:`원페어 (${RANK_NAME[pairRank]}s)`, handRank:1, tiebreaker:[1,pairRank], description:'포켓 페어입니다.' };
    }
    if (Math.max(...Object.values(suitCount))>=4) {
      return { handName:`플러시 드로우`, handRank:0, tiebreaker:[0,Math.max(...ranks)], description:'플러시 완성까지 한 장 남았습니다.' };
    }
    const sorted = ranks.sort((a,b)=>b-a);
    return { handName:`하이카드 (${RANK_NAME[sorted[0]]})`, handRank:0, tiebreaker:[0,...sorted], description:'매우 약한 패입니다.' };
  }
  return getBestFiveCardHand(all);
}

function calcRaiseOptions(pot: number, currentBet: number, myChips: number) {
  const minRaise  = Math.min(Math.max(currentBet * 2, 20), myChips);
  const halfPot   = Math.min(Math.floor(pot * 0.5), myChips);
  const potSize   = Math.min(pot, myChips);
  const twicePot  = Math.min(pot * 2, myChips);
  const allIn     = myChips;
  return { minRaise, halfPot, potSize, twicePot, allIn };
}

// ─── 핸드 평가 테스트 ─────────────────────────────────────────────
function runHandTests() {
  const t = (label: string, hole: Card[], community: Card[], expected: string) => {
    const r = evaluateHand(hole, community);
    const ok = r.handName.includes(expected) ? "✓" : "✗";
    console.log(`${ok} [${label}] ${r.handName} (기대: ${expected})`);
  };
  t("투페어(쓰리페어)", [{rank:"5",suit:"♠"},{rank:"5",suit:"♥"}], [{rank:"Q",suit:"♥"},{rank:"Q",suit:"♦"},{rank:"8",suit:"♥"},{rank:"8",suit:"♦"}], "투페어");
  t("풀하우스", [{rank:"A",suit:"♠"},{rank:"A",suit:"♥"}], [{rank:"A",suit:"♦"},{rank:"K",suit:"♣"},{rank:"K",suit:"♠"},{rank:"Q",suit:"♥"},{rank:"2",suit:"♦"}], "풀하우스");
  t("포카드", [{rank:"A",suit:"♠"},{rank:"A",suit:"♥"}], [{rank:"A",suit:"♦"},{rank:"A",suit:"♣"},{rank:"K",suit:"♠"},{rank:"Q",suit:"♥"},{rank:"2",suit:"♦"}], "포카드");
  t("휠스트레이트", [{rank:"A",suit:"♠"},{rank:"2",suit:"♥"}], [{rank:"3",suit:"♦"},{rank:"4",suit:"♣"},{rank:"5",suit:"♠"},{rank:"K",suit:"♥"},{rank:"Q",suit:"♦"}], "스트레이트");
  t("프리플랍하이카드", [{rank:"A",suit:"♠"},{rank:"K",suit:"♥"}], [], "하이카드");
}

// ─── DB Connection ────────────────────────────────────────────────

let dbPool: mysql.Pool | null = null;

// 커넥션 풀에서 커넥션을 가져오는 헬퍼 (기존 dbConnection 참조 호환)
const getDb = () => dbPool;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS game_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    player_count INT NOT NULL,
    player_cards JSON NOT NULL,
    community_cards JSON,
    street ENUM('preflop','flop','turn','river') DEFAULT 'preflop',
    deck JSON NOT NULL,
    ai_recommendation TEXT DEFAULT NULL,
    pot INT DEFAULT 0,
    current_bet INT DEFAULT 0,
    player_states JSON,
    session_start_chips INT DEFAULT 1000,
    session_end_chips INT DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const CREATE_PLAYER_CHIPS_SQL = `
  CREATE TABLE IF NOT EXISTS player_chips (
    id INT AUTO_INCREMENT PRIMARY KEY,
    player_id VARCHAR(50) NOT NULL UNIQUE,
    chips INT NOT NULL DEFAULT 1000,
    total_games INT DEFAULT 0,
    total_wins INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const COLUMNS_TO_ADD = [
  { name: "pot",                sql: "ALTER TABLE game_sessions ADD COLUMN pot INT DEFAULT 0" },
  { name: "current_bet",        sql: "ALTER TABLE game_sessions ADD COLUMN current_bet INT DEFAULT 0" },
  { name: "player_states",      sql: "ALTER TABLE game_sessions ADD COLUMN player_states JSON" },
  { name: "session_start_chips",sql: "ALTER TABLE game_sessions ADD COLUMN session_start_chips INT DEFAULT 1000" },
  { name: "session_end_chips",  sql: "ALTER TABLE game_sessions ADD COLUMN session_end_chips INT DEFAULT NULL" },
];

async function connectToDatabase(): Promise<void> {
  const { DB_HOST, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

  if (!DB_HOST || !DB_USER || !DB_PASSWORD || !DB_NAME) {
    console.error("DB 환경변수가 설정되지 않았습니다.");
    return;
  }

  try {
    // 커넥션 풀 생성 (타임아웃 자동 재연결, waitForConnections)
    dbPool = mysql.createPool({
      host: DB_HOST,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

    // 풀에서 커넥션 하나 빌려서 초기 설정
    const conn = await dbPool.getConnection();
    await conn.execute(CREATE_TABLE_SQL);
    await conn.execute(CREATE_PLAYER_CHIPS_SQL);

    for (const col of COLUMNS_TO_ADD) {
      const [rows] = await conn.execute(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'game_sessions' AND COLUMN_NAME = ?`,
        [DB_NAME, col.name]
      );
      if ((rows as mysql.RowDataPacket[]).length === 0) {
        await conn.execute(col.sql);
        console.log(`컬럼 추가: ${col.name}`);
      }
    }
    conn.release();

    console.log("MySQL 풀 연결 성공 & game_sessions 테이블 준비 완료");
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error("DB 접속 거부: 사용자명 또는 비밀번호를 확인해주세요.");
    } else if (err.code === "ECONNREFUSED") {
      console.error("DB 연결 실패: MySQL 서버가 실행 중인지 확인해주세요.");
    } else if (err.code === "ER_BAD_DB_ERROR") {
      console.error("DB 오류: 데이터베이스가 존재하지 않습니다.");
    } else {
      console.error("DB 연결 오류:", err.message);
    }
    dbPool = null;
  }
}

function getDatabaseConfigStatus() {
  return {
    DB_HOST: process.env.DB_HOST || "(미설정)",
    DB_USER: process.env.DB_USER || "(미설정)",
    DB_NAME: process.env.DB_NAME || "(미설정)",
  };
}

function printServerStatus(): void {
  const dbConfig = getDatabaseConfigStatus();
  console.log("\n========================================");
  console.log("  Texas Hold'em Practice API 서버");
  console.log("========================================");
  console.log(`  URL:              http://localhost:${PORT}`);
  console.log(`  DB 연결:          ${dbPool ? "연결됨" : "연결 안됨"}`);
  console.log(`  DB HOST:          ${dbConfig.DB_HOST}`);
  console.log(`  DB USER:          ${dbConfig.DB_USER}`);
  console.log(`  DB NAME:          ${dbConfig.DB_NAME}`);
  console.log(`  Bedrock Lambda:   ${process.env.BEDROCK_LAMBDA_URL || "(미설정)"}`);
  console.log("========================================\n");
}

// ─── Middleware ───────────────────────────────────────────────────

function checkDbConnection(req: Request, res: Response, next: NextFunction): void {
  if (!dbPool) {
    res.status(503).json({ success: false, error: "데이터베이스에 연결되어 있지 않습니다" });
    return;
  }
  next();
}

// ─── Lambda 호출 함수 ────────────────────────────────────────────

const callBedrockLambda = async (gameState: object): Promise<string> => {
  if (!process.env.BEDROCK_LAMBDA_URL) {
    throw new Error("Bedrock Lambda URL이 설정되지 않았습니다");
  }
  try {
    const response = await axios.post(process.env.BEDROCK_LAMBDA_URL, gameState);
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      console.error("Bedrock Lambda 호출 오류 - status:", error.response?.status);
      console.error("Bedrock Lambda 호출 오류 - data:", JSON.stringify(error.response?.data));
    } else {
      console.error("Bedrock Lambda 호출 오류:", error);
    }
    throw new Error("Bedrock Lambda 서비스 호출 실패");
  }
};

// ─── AI 베팅 처리 ────────────────────────────────────────────────

// 변경됨: 스트리트별 베팅 제한, 올인 조건 강화, 레이즈 빈도 제한
function aiDecide(
  player: PlayerState,
  currentBet: number,
  pot: number,
  street: string,
  communityCards: Card[]
): { action: string; amount: number } {
  const callAmount = currentBet - player.currentBet;
  const rand = Math.random();
  const raiseCount = player.aiRaiseCount || 0;

  // 변경됨: 연속 레이즈 3회 초과 금지
  const canRaise = raiseCount < 3;

  // 변경됨: AI 핸드 강도 평가 (스킵 최소화)
  const handResult = evaluateHand(player.cards, communityCards);
  const handRank = handResult.handRank;

  // 변경됨: 올인은 트리플 이상(handRank >= 3)만 허용, 블러핑 올인 제거
  const canAllIn = handRank >= 3;

  // 변경됨: 스트리트별 최대 베팅 한도
  const potRatioMap: Record<string, number> = {
    preflop: 3.0, flop: 0.75, turn: 1.0, river: 1.0,
  };
  const maxBetFromPot = Math.max(Math.floor(pot * (potRatioMap[street] ?? 1.0)), 20);

  // 변경됨: 핸드 강도 medium 이하면 레이즈 확률 40% 이하로 제한
  const raiseThreshold = handRank >= 2 ? 0.28 : 0.14;

  if (callAmount === 0) {
    if (canRaise && rand < raiseThreshold) {
      let raiseAmt = Math.min(Math.floor(pot * 0.4) + 20, maxBetFromPot);
      // 변경됨: 강한 핸드 아닌 경우 올인 방지
      if (!canAllIn) raiseAmt = Math.min(raiseAmt, player.chips - 1);
      raiseAmt = Math.min(raiseAmt, player.chips);
      if (raiseAmt > 0) return { action: "raise", amount: raiseAmt };
    }
    return { action: "check", amount: 0 };
  }

  // call amount > 0
  if (rand < 0.28) return { action: "fold", amount: 0 };

  if (canRaise && rand > 0.72 && handRank >= 1) {
    let extraRaise = Math.min(Math.floor(pot * 0.25) + 10, maxBetFromPot);
    const total = callAmount + extraRaise;
    // 변경됨: 강한 핸드 아닌 경우 올인 방지
    const maxTotal = canAllIn ? player.chips : Math.max(player.chips - 1, callAmount);
    const actual = Math.min(total, maxTotal);
    if (actual > callAmount) {
      return { action: "raise", amount: actual - callAmount };
    }
  }

  return { action: "call", amount: callAmount };
}

function applyBet(
  player: PlayerState,
  action: string,
  amount: number,
  currentBet: number,
  pot: number
): { player: PlayerState; pot: number; currentBet: number } {
  const p = { ...player };

  if (action === "fold") {
    p.folded = true;
    return { player: p, pot, currentBet };
  }

  if (action === "check") {
    return { player: p, pot, currentBet };
  }

  if (action === "call") {
    const callAmount = Math.min(currentBet - p.currentBet, p.chips);
    p.chips -= callAmount;
    p.currentBet += callAmount;
    p.totalBet += callAmount;
    pot += callAmount;
    if (p.chips === 0) p.isAllIn = true; // 변경됨: 올인 플래그 설정
    return { player: p, pot, currentBet };
  }

  if (action === "raise") {
    const callAmount = currentBet - p.currentBet;
    const total = callAmount + amount;
    const actual = Math.min(total, p.chips);
    p.chips -= actual;
    p.currentBet += actual;
    p.totalBet += actual;
    pot += actual;
    currentBet = p.currentBet;
    if (p.chips === 0) p.isAllIn = true;       // 변경됨: 올인 플래그 설정
    p.aiRaiseCount = (p.aiRaiseCount || 0) + 1; // 변경됨: 레이즈 카운트 증가
    return { player: p, pot, currentBet };
  }

  return { player: p, pot, currentBet };
}

// ─── Routes ──────────────────────────────────────────────────────

app.get("/", (_req: Request, res: Response) => {
  const dbConfig = getDatabaseConfigStatus();
  res.json({
    success: true,
    data: {
      server: "Texas Hold'em Practice API",
      status: dbPool ? "DB 연결됨" : "DB 연결 안됨",
      dbConfig,
      bedrock_lambda_url: process.env.BEDROCK_LAMBDA_URL || "(미설정)",
    },
  });
});

// GET /api/player/chips
app.get("/api/player/chips", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const [rows] = await dbPool!.execute("SELECT * FROM player_chips WHERE player_id = 'user'");
    const records = rows as mysql.RowDataPacket[];

    if (records.length === 0) {
      await dbPool!.execute("INSERT INTO player_chips (player_id, chips) VALUES ('user', 1000)");
      res.json({ success: true, data: { chips: 1000, totalGames: 0, totalWins: 0 } });
      return;
    }

    const r = records[0];
    res.json({ success: true, data: { chips: r.chips, totalGames: r.total_games, totalWins: r.total_wins } });
  } catch (error) {
    console.error("칩 조회 오류:", error);
    res.status(500).json({ success: false, error: "칩 조회 실패" });
  }
});

// POST /api/player/reset
app.post("/api/player/reset", checkDbConnection, async (req: Request, res: Response) => {
  try {
    await dbPool!.execute(
      "INSERT INTO player_chips (player_id, chips) VALUES ('user', 1000) ON DUPLICATE KEY UPDATE chips = 1000"
    );
    res.json({ success: true, data: { chips: 1000 } });
  } catch (error) {
    console.error("칩 리셋 오류:", error);
    res.status(500).json({ success: false, error: "칩 리셋 실패" });
  }
});

// POST /api/player/refill — 500칩 충전
app.post("/api/player/refill", checkDbConnection, async (req: Request, res: Response) => {
  try {
    await dbPool!.execute(
      "INSERT INTO player_chips (player_id, chips) VALUES ('user', 500) ON DUPLICATE KEY UPDATE chips = chips + 500"
    );
    const [rows] = await dbPool!.execute("SELECT chips FROM player_chips WHERE player_id = 'user'");
    const chips = (rows as mysql.RowDataPacket[])[0].chips;
    res.json({ success: true, data: { chips } });
  } catch (error) {
    console.error("칩 충전 오류:", error);
    res.status(500).json({ success: false, error: "칩 충전 실패" });
  }
});

// POST /api/game/start
app.post("/api/game/start", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const { playerCount, previousPlayerStates } = req.body; // 변경됨: 이전 핸드 AI 칩 보존용

    if (!playerCount || typeof playerCount !== "number" || playerCount < 2 || playerCount > 6) {
      res.status(400).json({ success: false, error: "플레이어 수는 2~6명이어야 합니다" });
      return;
    }

    // 변경됨: 이전 핸드 AI 칩 추출 (파산 시 1000으로 부활)
    const prevAiChips: Record<number, number> = {};
    if (Array.isArray(previousPlayerStates)) {
      for (const p of previousPlayerStates as PlayerState[]) {
        if (!p.isUser) {
          prevAiChips[p.id] = p.chips > 0 ? p.chips : 1000;
          if (p.chips <= 0) console.log(`AI Player ${p.id} 파산 → 1000칩으로 부활`);
        }
      }
    }

    // 유저 칩 조회 (없으면 1000으로 초기화)
    const [chipRows] = await dbPool!.execute(
      "SELECT chips FROM player_chips WHERE player_id = 'user'"
    );
    const chipRecords = chipRows as mysql.RowDataPacket[];
    let userChips = 1000;
    if (chipRecords.length > 0) {
      userChips = chipRecords[0].chips;
    } else {
      await dbPool!.execute(
        "INSERT INTO player_chips (player_id, chips) VALUES ('user', 1000)"
      );
    }

    if (userChips <= 0) {
      res.status(400).json({ success: false, error: "칩이 없습니다. 게임을 리셋해주세요." });
      return;
    }

    const deck = shuffleDeck(createDeck());
    let remaining = deck;

    // 모든 플레이어에게 홀 카드 2장씩 지급
    const allPlayerCards: Card[][] = [];
    for (let i = 0; i < playerCount; i++) {
      const { dealt, remaining: rest } = dealCards(remaining, 2);
      allPlayerCards.push(dealt);
      remaining = rest;
    }

    // 딜러 = 인덱스 0 (유저), Small Blind = 1, Big Blind = 2
    const SMALL_BLIND = 10;
    const BIG_BLIND = 20;

    const playerStates: PlayerState[] = allPlayerCards.map((cards, i) => ({
      id: i + 1,
      isUser: i === 0,
      chips: i === 0 ? userChips : (prevAiChips[i + 1] ?? 1000), // 변경됨: AI는 이전 핸드 칩 보존, 없으면 1000
      currentBet: 0,
      totalBet: 0,
      folded: false,
      isDealer: i === 0,
      cards,
    }));

    // Small Blind 자동 징수
    const sbIdx = 1 % playerCount;
    playerStates[sbIdx].chips -= SMALL_BLIND;
    playerStates[sbIdx].currentBet = SMALL_BLIND;
    playerStates[sbIdx].totalBet = SMALL_BLIND;

    // Big Blind 자동 징수
    const bbIdx = 2 % playerCount;
    playerStates[bbIdx].chips -= BIG_BLIND;
    playerStates[bbIdx].currentBet = BIG_BLIND;
    playerStates[bbIdx].totalBet = BIG_BLIND;

    const pot = SMALL_BLIND + BIG_BLIND;
    const currentBet = BIG_BLIND;

    const [result] = await dbPool!.execute(
      `INSERT INTO game_sessions (player_count, player_cards, community_cards, street, deck, pot, current_bet, player_states, session_start_chips)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        playerCount,
        JSON.stringify(allPlayerCards),
        JSON.stringify([]),
        "preflop",
        JSON.stringify(remaining),
        pot,
        currentBet,
        JSON.stringify(playerStates),
        userChips,
      ]
    );

    const insertId = (result as mysql.ResultSetHeader).insertId;

    res.status(201).json({
      success: true,
      data: {
        id: insertId,
        playerCards: allPlayerCards[0],
        playerStates,
        pot,
        currentBet,
        street: "preflop",
        communityCards: [],
      },
    });
  } catch (error) {
    console.error("게임 시작 오류:", error);
    res.status(500).json({ success: false, error: "게임 시작에 실패했습니다" });
  }
});

// POST /api/game/:id/next-street
app.post("/api/game/:id/next-street", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [rows] = await dbPool!.execute("SELECT * FROM game_sessions WHERE id = ?", [id]);
    const sessions = rows as mysql.RowDataPacket[];

    if (sessions.length === 0) {
      res.status(404).json({ success: false, error: "게임 세션을 찾을 수 없습니다" });
      return;
    }

    const session = sessions[0];
    const currentStreet: string = session.street;

    if (currentStreet === "river") {
      res.status(400).json({ success: false, error: "이미 River 단계입니다." });
      return;
    }

    const streetOrder: Record<string, string> = { preflop: "flop", flop: "turn", turn: "river" };
    const cardsToReveal: Record<string, number> = { preflop: 3, flop: 1, turn: 1 };

    const nextStreet = streetOrder[currentStreet];
    const revealCount = cardsToReveal[currentStreet];

    const currentCommunity: Card[] = typeof session.community_cards === "string"
      ? JSON.parse(session.community_cards) : session.community_cards ?? [];
    const currentDeck: Card[] = typeof session.deck === "string"
      ? JSON.parse(session.deck) : session.deck;

    const { dealt, remaining } = dealCards(currentDeck, revealCount);
    const newCommunity = [...currentCommunity, ...dealt];

    // 새 스트리트 시작 시 currentBet 초기화, playerStates의 currentBet도 0으로
    let playerStates: PlayerState[] = typeof session.player_states === "string"
      ? JSON.parse(session.player_states) : session.player_states ?? [];

    playerStates = playerStates.map(p => ({ ...p, currentBet: 0, aiRaiseCount: 0 })); // 변경됨: 레이즈 카운트도 리셋

    await dbPool!.execute(
      "UPDATE game_sessions SET street = ?, community_cards = ?, deck = ?, current_bet = 0, player_states = ? WHERE id = ?",
      [nextStreet, JSON.stringify(newCommunity), JSON.stringify(remaining), JSON.stringify(playerStates), id]
    );

    res.json({
      success: true,
      data: {
        street: nextStreet,
        communityCards: newCommunity,
        playerStates,
        pot: session.pot,
        currentBet: 0,
      },
    });
  } catch (error) {
    console.error("다음 스트리트 오류:", error);
    res.status(500).json({ success: false, error: "다음 단계 진행에 실패했습니다" });
  }
});

// POST /api/game/:id/bet
app.post("/api/game/:id/bet", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { action, amount } = req.body as { action: "fold" | "call" | "raise" | "check"; amount?: number };

    const [rows] = await dbPool!.execute("SELECT * FROM game_sessions WHERE id = ?", [id]);
    const sessions = rows as mysql.RowDataPacket[];

    if (sessions.length === 0) {
      res.status(404).json({ success: false, error: "게임 세션을 찾을 수 없습니다" });
      return;
    }

    const session = sessions[0];
    let playerStates: PlayerState[] = typeof session.player_states === "string"
      ? JSON.parse(session.player_states) : session.player_states ?? [];
    let pot: number = session.pot || 0;
    let currentBet: number = session.current_bet || 0;

    // 유저(인덱스 0) 베팅 처리
    const userResult = applyBet(playerStates[0], action, amount || 0, currentBet, pot);
    playerStates[0] = userResult.player;
    pot = userResult.pot;
    currentBet = userResult.currentBet;

    // 변경됨: 커뮤니티 카드 파싱 (AI 핸드 평가용)
    const communityCardsForAI: Card[] = typeof session.community_cards === "string"
      ? JSON.parse(session.community_cards) : session.community_cards ?? [];

    // AI 플레이어들 자동 베팅
    for (let i = 1; i < playerStates.length; i++) {
      if (playerStates[i].folded) continue;
      if (playerStates[i].isAllIn) continue; // 변경됨: 올인 플레이어 스킵
      const aiAction = aiDecide(playerStates[i], currentBet, pot, session.street, communityCardsForAI); // 변경됨
      const aiResult = applyBet(playerStates[i], aiAction.action, aiAction.amount, currentBet, pot);
      playerStates[i] = aiResult.player;
      pot = aiResult.pot;
      currentBet = aiResult.currentBet;
    }

    // 변경됨: 활성/올인 플레이어 분리 처리
    const activePlayers = playerStates.filter(p => !p.folded);
    const actionablePlayers = activePlayers.filter(p => !p.isAllIn); // 변경됨
    let nextAction: "next-street" | "showdown" | "continue" = "continue";

    if (activePlayers.length === 1) {
      nextAction = "showdown";
    } else if (actionablePlayers.length === 0) {
      // 변경됨: 전원 올인 - 남은 커뮤니티 카드 자동 오픈 후 쇼다운
      let deck: Card[] = typeof session.deck === "string" ? JSON.parse(session.deck) : session.deck;
      let community: Card[] = communityCardsForAI;
      const streetOrder = ["preflop", "flop", "turn", "river"];
      const currentIdx = streetOrder.indexOf(session.street as string);
      const cardsPerStep: Record<string, number> = { preflop: 3, flop: 1, turn: 1 };
      for (let s = currentIdx; s < 3; s++) {
        const { dealt, remaining } = dealCards(deck, cardsPerStep[streetOrder[s]]);
        community = [...community, ...dealt];
        deck = remaining;
      }
      const finalPlayerStates = playerStates.map(p => ({ ...p, currentBet: 0, aiRaiseCount: 0 }));
      await dbPool!.execute(
        "UPDATE game_sessions SET pot = ?, current_bet = 0, player_states = ?, community_cards = ?, deck = ?, street = 'river' WHERE id = ?",
        [pot, JSON.stringify(finalPlayerStates), JSON.stringify(community), JSON.stringify(deck), id]
      );
      const userChipsNow2 = finalPlayerStates.find(p => p.isUser)?.chips ?? 0;
      await dbPool!.execute(
        "INSERT INTO player_chips (player_id, chips) VALUES ('user', ?) ON DUPLICATE KEY UPDATE chips = ?",
        [userChipsNow2, userChipsNow2]
      );
      return res.json({
        success: true,
        data: { playerStates: finalPlayerStates, pot, currentBet: 0, nextAction: "showdown", autoRunoutCards: community },
      });
    } else {
      // 변경됨: 올인 제외 액션 가능 플레이어의 베팅 완료 여부 확인
      const maxBet = Math.max(...activePlayers.map(p => p.currentBet), 0);
      if (actionablePlayers.every(p => p.currentBet >= maxBet)) {
        nextAction = session.street === "river" ? "showdown" : "next-street";
      }
    }

    await dbPool!.execute(
      "UPDATE game_sessions SET pot = ?, current_bet = ?, player_states = ? WHERE id = ?",
      [pot, currentBet, JSON.stringify(playerStates), id]
    );

    // 유저 칩 즉시 DB 동기화
    const userChipsNow = playerStates.find(p => p.isUser)?.chips ?? 0;
    await dbPool!.execute(
      "INSERT INTO player_chips (player_id, chips) VALUES ('user', ?) ON DUPLICATE KEY UPDATE chips = ?",
      [userChipsNow, userChipsNow]
    );

    res.json({
      success: true,
      data: { playerStates, pot, currentBet, nextAction },
    });
  } catch (error) {
    console.error("베팅 오류:", error);
    res.status(500).json({ success: false, error: "베팅 처리에 실패했습니다" });
  }
});

// POST /api/game/:id/showdown
app.post("/api/game/:id/showdown", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [rows] = await dbPool!.execute("SELECT * FROM game_sessions WHERE id = ?", [id]);
    const sessions = rows as mysql.RowDataPacket[];

    if (sessions.length === 0) {
      res.status(404).json({ success: false, error: "게임 세션을 찾을 수 없습니다" });
      return;
    }

    const session = sessions[0];
    const playerStates: PlayerState[] = typeof session.player_states === "string"
      ? JSON.parse(session.player_states) : session.player_states ?? [];
    const communityCards: Card[] = typeof session.community_cards === "string"
      ? JSON.parse(session.community_cards) : session.community_cards ?? [];
    const pot: number = session.pot || 0;

    const activePlayers = playerStates.filter(p => !p.folded);

    // 핸드 평가
    const handRanks = playerStates.map(p => {
      if (p.folded) return { playerId: p.id, rank: -1, label: "Folded", tiebreaker: [-1] };
      const result = evaluateHand(p.cards, communityCards);
      return { playerId: p.id, rank: result.handRank, label: result.handName, tiebreaker: result.tiebreaker };
    });

    // 승자 결정 (tiebreaker 기반)
    let winner = activePlayers[0];
    let winnerHandRank = handRanks.find(h => h.playerId === winner.id)!;

    for (const player of activePlayers.slice(1)) {
      const hr = handRanks.find(h => h.playerId === player.id)!;
      if (compareTiebreaker(hr.tiebreaker, winnerHandRank.tiebreaker) > 0) {
        winner = player;
        winnerHandRank = hr;
      }
    }

    // 팟 지급
    const afterPot = playerStates.map(p => {
      if (p.id === winner.id) return { ...p, chips: p.chips + pot };
      return p;
    });

    // 추가됨: AI 파산(chips <= 0) 부활 처리 — 다음 핸드 시작 전 칩 보충
    const finalStates = afterPot.map(p => {
      if (!p.isUser && p.chips <= 0) {
        console.log(`AI Player ${p.id} 파산 → 1000칩으로 부활`);
        return { ...p, chips: 1000 };
      }
      return p;
    });

    const userFinalChips = finalStates.find(p => p.isUser)?.chips ?? 0;
    const userWon = winner.isUser;

    await dbPool!.execute(
      "UPDATE game_sessions SET player_states = ?, session_end_chips = ? WHERE id = ?",
      [JSON.stringify(finalStates), userFinalChips, id]
    );

    // player_chips 업데이트: 칩 + 전적
    await dbPool!.execute(
      `INSERT INTO player_chips (player_id, chips, total_games, total_wins)
       VALUES ('user', ?, 1, ?)
       ON DUPLICATE KEY UPDATE chips = ?, total_games = total_games + 1, total_wins = total_wins + ?`,
      [userFinalChips, userWon ? 1 : 0, userFinalChips, userWon ? 1 : 0]
    );

    res.json({
      success: true,
      data: {
        winner: { id: winner.id, isUser: winner.isUser },
        allPlayerCards: playerStates.map(p => ({ id: p.id, cards: p.cards, folded: p.folded })),
        handRanks,
        finalChips: finalStates.map(p => ({ id: p.id, chips: p.chips })),
        pot,
        updatedChips: userFinalChips,
        isGameOver: userFinalChips <= 0,
      },
    });
  } catch (error) {
    console.error("쇼다운 오류:", error);
    res.status(500).json({ success: false, error: "쇼다운 처리에 실패했습니다" });
  }
});

// POST /api/game/:id/ai-recommend
app.post("/api/game/:id/ai-recommend", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const [rows] = await dbPool!.execute("SELECT * FROM game_sessions WHERE id = ?", [id]);
    const sessions = rows as mysql.RowDataPacket[];

    if (sessions.length === 0) {
      res.status(404).json({ success: false, error: "게임 세션을 찾을 수 없습니다" });
      return;
    }

    const session = sessions[0];
    const playerStates: PlayerState[] = typeof session.player_states === "string"
      ? JSON.parse(session.player_states) : session.player_states ?? [];

    const userState = playerStates[0];
    const activePlayers = playerStates.filter(p => !p.folded).length;
    const curBet = session.current_bet || 0;
    const myBet = userState?.currentBet || 0;
    const myChips = userState?.chips || 1000;
    const pot = session.pot || 0;
    const canCheck = myBet >= curBet;
    const canCall = curBet > myBet;
    const callNeeded = Math.max(0, curBet - myBet);
    const potOddsRatio = (pot + callNeeded) > 0 ? Math.round(callNeeded / (pot + callNeeded) * 100) : 0;
    const raiseOpts = calcRaiseOptions(pot, curBet, myChips);

    const gameState = {
      playerCards: userState?.cards || [],
      communityCards: typeof session.community_cards === "string"
        ? JSON.parse(session.community_cards) : session.community_cards ?? [],
      street: session.street,
      pot,
      myChips,
      currentBet: curBet,
      myCurrentBet: myBet,
      playerCount: session.player_count,
      activePlayers,
      canCheck,
      canCall,
      callNeeded,
      potOddsRatio,
      minRaise: raiseOpts.minRaise,
      halfPot: raiseOpts.halfPot,
      potSize: raiseOpts.potSize,
      twicePot: raiseOpts.twicePot,
      allIn: raiseOpts.allIn,
    };

    const recommendation = await callBedrockLambda(gameState);

    await dbPool!.execute(
      "UPDATE game_sessions SET ai_recommendation = ? WHERE id = ?",
      [typeof recommendation === "string" ? recommendation : JSON.stringify(recommendation), id]
    );

    res.json({ success: true, data: { recommendation } });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "AI 추천 실패";
    console.error("AI 추천 오류:", error);
    res.status(500).json({ success: false, error: errMsg });
  }
});

// POST /api/game/:id/chat  // 추가됨: AI 챗봇 엔드포인트
app.post("/api/game/:id/chat", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { message, lastAdvice } = req.body as { message: string; lastAdvice?: object };

    if (!message?.trim()) {
      res.status(400).json({ success: false, error: "메시지가 없습니다" });
      return;
    }

    const [rows] = await dbPool!.execute("SELECT * FROM game_sessions WHERE id = ?", [id]);
    const sessions = rows as mysql.RowDataPacket[];

    if (sessions.length === 0) {
      res.status(404).json({ success: false, error: "게임 세션을 찾을 수 없습니다" });
      return;
    }

    const session = sessions[0];
    const playerStates: PlayerState[] = typeof session.player_states === "string"
      ? JSON.parse(session.player_states) : session.player_states ?? [];
    const userState = playerStates.find(p => p.isUser);

    const chatPayload = {
      requestType: "chat",
      message: message.trim(),
      gameContext: {
        playerCards: userState?.cards || [],
        communityCards: typeof session.community_cards === "string"
          ? JSON.parse(session.community_cards) : session.community_cards ?? [],
        street: session.street,
        pot: session.pot || 0,
        myChips: userState?.chips || 0,
      },
      lastAdvice: lastAdvice || null,
    };

    const rawReply = await callBedrockLambda(chatPayload);

    let replyText: string;
    if (typeof rawReply === "string") {
      try {
        const parsed = JSON.parse(rawReply);
        replyText = parsed.reply || rawReply;
      } catch {
        replyText = rawReply;
      }
    } else {
      replyText = (rawReply as { reply?: string }).reply || String(rawReply);
    }

    res.json({ success: true, data: { reply: replyText } });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "채팅 실패";
    console.error("채팅 오류:", error);
    res.status(500).json({ success: false, error: errMsg });
  }
});

// GET /api/game/:id
app.get("/api/game/:id", checkDbConnection, async (req: Request, res: Response) => {
  try {
    const [rows] = await dbPool!.execute("SELECT * FROM game_sessions WHERE id = ?", [req.params.id]);
    const sessions = rows as mysql.RowDataPacket[];

    if (sessions.length === 0) {
      res.status(404).json({ success: false, error: "게임 세션을 찾을 수 없습니다" });
      return;
    }

    const session = sessions[0];
    const playerStates: PlayerState[] = typeof session.player_states === "string"
      ? JSON.parse(session.player_states) : session.player_states ?? [];
    const allPlayerCards: Card[][] = typeof session.player_cards === "string"
      ? JSON.parse(session.player_cards) : session.player_cards;

    res.json({
      success: true,
      data: {
        id: session.id,
        playerCards: allPlayerCards[0],
        communityCards: typeof session.community_cards === "string"
          ? JSON.parse(session.community_cards) : session.community_cards ?? [],
        street: session.street,
        playerCount: session.player_count,
        playerStates,
        pot: session.pot || 0,
        currentBet: session.current_bet || 0,
        ai_recommendation: session.ai_recommendation,
      },
    });
  } catch (error) {
    console.error("게임 조회 오류:", error);
    res.status(500).json({ success: false, error: "게임 조회에 실패했습니다" });
  }
});

// ─── Error Handlers ──────────────────────────────────────────────

process.on("uncaughtException", (error) => {
  console.error("예상치 못한 오류:", error);
});

process.on("unhandledRejection", (reason) => {
  console.error("처리되지 않은 Promise 거부:", reason);
});

// ─── Server Start ────────────────────────────────────────────────

async function startServer(): Promise<void> {
  console.log("\n=== 핸드 평가 테스트 ===");
  runHandTests();
  await connectToDatabase();
  app.listen(PORT, () => {
    printServerStatus();
  });
}

startServer();

export { app };
