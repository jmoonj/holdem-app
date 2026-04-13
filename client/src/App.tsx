import { useState, useEffect, useMemo } from "react";
import { Card, Street, AIRecommendation, PlayerState, ShowdownResult } from "./types";
import { getHandInfo } from "./handEval"; // 추가됨

const API_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:80";

const STREET_LABELS: Record<Street, string> = {
  preflop: "Pre-Flop", flop: "Flop", turn: "Turn", river: "River",
};
const NEXT_STREET_LABELS: Record<string, string> = {
  preflop: "Flop 공개", flop: "Turn 공개", turn: "River 공개",
};
const SEAT_MAP: Record<number, string[]> = {
  2: ["top-center"],
  3: ["top-left", "top-right"],
  4: ["top-center", "mid-left", "mid-right"],
  5: ["top-left", "top-right", "mid-left", "mid-right"],
  6: ["top-left", "top-right", "mid-left", "mid-right", "bot-right"],
};

// ─── PlayingCard Component ─────────────────────────

function PlayingCard({
  rank, suit, faceDown = false, size = "medium",
}: {
  rank: string; suit: string; faceDown?: boolean; size?: "small" | "medium" | "large";
}) {
  const isRed = suit === "♥" || suit === "♦";
  const color = isRed ? "#cc0000" : "#111111";

  const sizes = {
    small:  { width: 38,  height: 54,  rankTop: 11, suitTop: 10, suitCenter: 18, padding: 3 },
    medium: { width: 65,  height: 92,  rankTop: 15, suitTop: 13, suitCenter: 30, padding: 4 },
    large:  { width: 85,  height: 120, rankTop: 20, suitTop: 16, suitCenter: 44, padding: 5 },
  };
  const s = sizes[size];

  if (faceDown) {
    return (
      <div style={{
        width: s.width, height: s.height,
        background: "repeating-linear-gradient(45deg,#1a237e,#1a237e 4px,#283593 4px,#283593 8px)",
        border: "2px solid #ffd700",
        borderRadius: 6,
        boxShadow: "2px 3px 6px rgba(0,0,0,0.5)",
        flexShrink: 0,
      }} />
    );
  }

  return (
    <div style={{
      width: s.width, height: s.height,
      background: "white",
      border: "1px solid #bbb",
      borderRadius: 6,
      boxShadow: "2px 3px 6px rgba(0,0,0,0.4)",
      padding: s.padding,
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      color,
      fontFamily: "serif",
      userSelect: "none",
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
        <span style={{ fontSize: s.rankTop, fontWeight: "bold" }}>{rank}</span>
        <span style={{ fontSize: s.suitTop }}>{suit}</span>
      </div>
      <div style={{ textAlign: "center", fontSize: s.suitCenter }}>{suit}</div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1, alignSelf: "flex-end", transform: "rotate(180deg)" }}>
        <span style={{ fontSize: s.rankTop, fontWeight: "bold" }}>{rank}</span>
        <span style={{ fontSize: s.suitTop }}>{suit}</span>
      </div>
    </div>
  );
}

// ─── Confidence Dots ───────────────────────────────

function ConfidenceDots({ level }: { level: "low" | "medium" | "high" }) {
  const filled = level === "low" ? 1 : level === "medium" ? 2 : 3;
  return (
    <span className="confidence-dots">
      {[1, 2, 3].map((i) => (
        <span key={i} className={`dot ${i <= filled ? "filled" : ""}`} />
      ))}
    </span>
  );
}

// 추가됨: 튜토리얼 오버레이 컴포넌트
function TutorialOverlay({ onClose }: { onClose: () => void }) {
  const [slide, setSlide] = useState(0);
  const slides = [
    {
      title: "🃏 버튼 설명",
      type: "buttons" as const,
      rows: [
        { label: "CHECK",  cls: "tut-check", desc: "추가 베팅 없이 다음으로 넘김 (베팅이 없을 때만 가능)" },
        { label: "CALL",   cls: "tut-call",  desc: "상대방 베팅 금액만큼 따라감" },
        { label: "RAISE",  cls: "tut-raise", desc: "베팅 금액을 올림 (슬라이더로 금액 조절)" },
        { label: "FOLD",   cls: "tut-fold",  desc: "패를 포기하고 이번 핸드 기권" },
        { label: "조언받기", cls: "tut-ai",  desc: "AI 코치가 현재 패에 맞는 액션 추천" },
      ],
    },
    {
      title: "🏆 족보 순서 (약함 → 강함)",
      type: "hands" as const,
      hands: [
        "하이카드", "원페어", "투페어", "트리플",
        "스트레이트", "플러시", "풀하우스", "포카드",
        "스트레이트 플러시", "로열 플러시",
      ],
    },
  ];
  const isLast = slide === slides.length - 1;
  const current = slides[slide];
  return (
    <div className="tutorial-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tutorial-card">
        <h2 className="tutorial-title">{current.title}</h2>
        <div className="tutorial-body">
          {current.type === "buttons"
            ? current.rows.map((r, i) => (
                <div key={i} className="tutorial-row">
                  <span className={`tut-badge ${r.cls}`}>{r.label}</span>
                  <span className="tut-desc">{r.desc}</span>
                </div>
              ))
            : current.hands.map((h, i) => (
                <div key={i} className="tutorial-hand-row">
                  <span className="tut-hand-rank">{i + 1}</span>
                  <span className="tut-hand-name">{h}</span>
                </div>
              ))
          }
        </div>
        <div className="tutorial-footer">
          <div className="tut-dots">
            {slides.map((_, i) => <span key={i} className={`tut-dot ${i === slide ? "active" : ""}`} />)}
          </div>
          {isLast
            ? <button className="btn-tut-action" onClick={onClose}>게임 시작! 🎮</button>
            : <button className="btn-tut-action" onClick={() => setSlide(s => s + 1)}>다음 →</button>
          }
        </div>
      </div>
    </div>
  );
}

// ─── Player Slot Card ──────────────────────────────

// 변경됨: isSB, isBB props 추가 + 포지션 배지 표시
function PlayerSlotCard({ player, showCards, isSB, isBB }: {
  player: PlayerState;
  showCards: boolean;
  isSB?: boolean;
  isBB?: boolean;
}) {
  return (
    <div className={`slot-card ${player.folded ? "slot-folded" : ""}`}>
      <div className="slot-name-row">
        <span className="slot-name">Player {player.id}</span>
        <span className="pos-badges">
          {player.isDealer && <span className="badge-pos badge-dealer">D</span>}
          {isSB && <span className="badge-pos badge-sb">SB</span>}
          {isBB && <span className="badge-pos badge-bb">BB</span>}
        </span>
      </div>
      <div className="slot-cards">
        {player.folded
          ? <span className="fold-badge">FOLD</span>
          : showCards
            ? player.cards.map((c, i) => <PlayingCard key={i} rank={c.rank} suit={c.suit} size="small" />)
            : <><PlayingCard rank="" suit="" faceDown={true} size="small" /><PlayingCard rank="" suit="" faceDown={true} size="small" /></>
        }
      </div>
      {player.currentBet > 0 && <div className="slot-bet">베팅 {player.currentBet}칩</div>}
      <div className="slot-chips">{player.chips}칩</div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────

function App() {
  const [gameId, setGameId] = useState<number | null>(null);
  const [playerCount, setPlayerCount] = useState(4);
  const [myCards, setMyCards] = useState<Card[]>([]);
  const [communityCards, setCommunityCards] = useState<Card[]>([]);
  const [street, setStreet] = useState<Street>("preflop");
  const [playerStates, setPlayerStates] = useState<PlayerState[]>([]);
  const [pot, setPot] = useState(0);
  const [currentBet, setCurrentBet] = useState(0);
  const [raiseAmount, setRaiseAmount] = useState("");
  const [recommendation, setRecommendation] = useState<AIRecommendation | null>(null);
  const [showdown, setShowdown] = useState<ShowdownResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [error, setError] = useState("");

  const [totalChips, setTotalChips] = useState(1000);
  const [totalGames, setTotalGames] = useState(0);
  const [totalWins, setTotalWins] = useState(0);
  const [sessionStartChips, setSessionStartChips] = useState(1000);
  const [isBankrupt, setIsBankrupt] = useState(false);

  // 추가됨: 챗봇 상태
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);

  // 추가됨: 튜토리얼 상태
  const [showTutorial, setShowTutorial] = useState(false);

  const gameStarted = gameId !== null;
  const isRiver = street === "river";
  const myState = playerStates.find(p => p.isUser);
  const callAmount = myState ? Math.max(0, currentBet - myState.currentBet) : 0;
  const canCheck = callAmount === 0;
  const minRaise = Math.max(currentBet * 2, 20);
  const maxRaise = myState?.chips || 0;

  const recAction = recommendation?.action;
  const checkCallHighlight = canCheck ? recAction === "check" : recAction === "call";

  useEffect(() => { loadPlayerChips(); }, []);

  // 추가됨: 최초 진입 시 tutorialSeen 없으면 자동 표시
  useEffect(() => {
    if (!localStorage.getItem("tutorialSeen")) setShowTutorial(true);
  }, []);

  const closeTutorial = () => {
    localStorage.setItem("tutorialSeen", "true");
    setShowTutorial(false);
  };

  const loadPlayerChips = async () => {
    try {
      const res = await fetch(`${API_URL}/api/player/chips`);
      const json = await res.json();
      if (json.success) {
        setTotalChips(json.data.chips);
        setTotalGames(json.data.totalGames);
        setTotalWins(json.data.totalWins);
        if (json.data.chips <= 0) setIsBankrupt(true);
      }
    } catch { /* 서버 미연결 시 무시 */ }
  };

  const resetChips = async () => {
    try {
      const res = await fetch(`${API_URL}/api/player/reset`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setTotalChips(1000);
        setIsBankrupt(false);
        setShowdown(null);
      }
    } catch {
      setError("칩 리셋에 실패했습니다");
    }
  };

  const refillChips = async () => {
    try {
      const res = await fetch(`${API_URL}/api/player/refill`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setTotalChips(json.data.chips);
        setIsBankrupt(false);
      }
    } catch {
      setError("칩 충전에 실패했습니다");
    }
  };

  const startGame = async () => {
    setIsLoading(true);
    setError("");
    setRecommendation(null);
    setShowdown(null);
    setRaiseAmount("");
    setChatMessages([]); // 추가됨: 새 게임 시작 시 채팅 초기화
    setChatInput("");

    try {
      const res = await fetch(`${API_URL}/api/game/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerCount,
          previousPlayerStates: playerStates.length > 0 ? playerStates : undefined, // 변경됨: AI 칩 보존
        }),
      });
      const json = await res.json();

      if (json.success) {
        setGameId(json.data.id);
        setMyCards(json.data.playerCards);
        setCommunityCards([]);
        setStreet("preflop");
        setPlayerStates(json.data.playerStates || []);
        setPot(json.data.pot || 0);
        setCurrentBet(json.data.currentBet || 0);
        const startChips = json.data.playerStates?.find((p: PlayerState) => p.isUser)?.chips || totalChips;
        setSessionStartChips(startChips);
        setTotalChips(startChips);
      } else {
        setError(json.error || "게임 시작에 실패했습니다");
        if (json.error?.includes("칩이 없습니다")) setIsBankrupt(true);
      }
    } catch {
      setError("서버에 연결할 수 없습니다");
    } finally {
      setIsLoading(false);
    }
  };

  const nextStreet = async () => {
    if (!gameId) return;
    setIsLoading(true);
    setError("");
    setRecommendation(null);

    try {
      const res = await fetch(`${API_URL}/api/game/${gameId}/next-street`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setCommunityCards(json.data.communityCards);
        setStreet(json.data.street as Street);
        setPlayerStates(json.data.playerStates || []);
        setPot(json.data.pot || 0);
        setCurrentBet(json.data.currentBet || 0);
      } else {
        setError(json.error || "다음 단계 진행에 실패했습니다");
      }
    } catch {
      setError("서버에 연결할 수 없습니다");
    } finally {
      setIsLoading(false);
    }
  };

  const placeBet = async (action: "fold" | "call" | "raise" | "check", amount?: number) => {
    if (!gameId) return;
    setIsLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/game/${gameId}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, amount }),
      });
      const json = await res.json();

      if (json.success) {
        setPlayerStates(json.data.playerStates);
        setPot(json.data.pot);
        setCurrentBet(json.data.currentBet);
        setRaiseAmount("");
        const updatedUserChips = json.data.playerStates?.find((p: PlayerState) => p.isUser)?.chips;
        if (updatedUserChips !== undefined) setTotalChips(updatedUserChips);

        if (json.data.nextAction === "showdown") {
          // 추가됨: 전원 올인 런아웃 시 자동 오픈된 커뮤니티 카드 반영
          if (json.data.autoRunoutCards) {
            setCommunityCards(json.data.autoRunoutCards);
            setStreet("river");
          }
          await triggerShowdown();
        } else if (json.data.nextAction === "next-street") {
          await nextStreet();
        }
      } else {
        setError(json.error || "베팅 처리에 실패했습니다");
      }
    } catch {
      setError("서버에 연결할 수 없습니다");
    } finally {
      setIsLoading(false);
    }
  };

  const triggerShowdown = async () => {
    if (!gameId) return;
    try {
      const res = await fetch(`${API_URL}/api/game/${gameId}/showdown`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        setShowdown(json.data);
        if (json.data.updatedChips !== undefined) {
          setTotalChips(json.data.updatedChips);
          if (json.data.isGameOver) setIsBankrupt(true);
        }
        await loadPlayerChips();
      }
    } catch {
      setError("쇼다운 처리에 실패했습니다");
    }
  };

  const requestAI = async () => {
    if (!gameId) return;
    setIsAiLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_URL}/api/game/${gameId}/ai-recommend`, { method: "POST" });
      const json = await res.json();
      if (json.success) {
        const raw = json.data.recommendation;
        let parsed: AIRecommendation;
        if (typeof raw === "string") {
          const jsonStr = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          parsed = JSON.parse(jsonStr);
        } else {
          parsed = raw as AIRecommendation;
        }
        setRecommendation(parsed);
      } else {
        setError(json.error || "AI 추천 요청에 실패했습니다");
      }
    } catch {
      setError("AI 서비스에 연결할 수 없습니다");
    } finally {
      setIsAiLoading(false);
    }
  };

  // 추가됨: AI 챗봇 메시지 전송
  const sendChat = async () => {
    if (!gameId || !chatInput.trim() || isChatLoading) return;
    const msg = chatInput.trim();
    setChatInput("");
    setChatMessages(prev => [...prev, { role: "user", text: msg }]);
    setIsChatLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/game/${gameId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, lastAdvice: recommendation }),
      });
      const json = await res.json();
      if (json.success) {
        setChatMessages(prev => [...prev, { role: "ai", text: json.data.reply }]);
      } else {
        setChatMessages(prev => [...prev, { role: "ai", text: "죄송합니다, 답변을 받지 못했습니다." }]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role: "ai", text: "AI 서비스에 연결할 수 없습니다." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const otherPlayers = playerStates.filter(p => !p.isUser);
  const seats = SEAT_MAP[playerCount] || SEAT_MAP[4];
  const profit = showdown ? (showdown.updatedChips ?? totalChips) - sessionStartChips : 0;

  // 추가됨: SB/BB 포지션 계산 (딜러=index 0, SB=index 1, BB=index 2 % playerCount)
  const sbPlayerId = playerStates.length > 0 ? playerStates[1 % playerStates.length]?.id : null;
  const bbPlayerId = playerStates.length > 0 ? playerStates[2 % playerStates.length]?.id : null;
  const myIsSB = myState ? myState.id === sbPlayerId : false;
  const myIsBB = myState ? myState.id === bbPlayerId : false;

  // 추가됨: 실시간 족보 계산 (myCards + communityCards 변경 시만 재계산)
  const handInfo = useMemo(() => {
    if (myCards.length === 0) return null;
    return getHandInfo(myCards, communityCards);
  }, [myCards, communityCards]);

  // 레이즈 옵션 closest 계산
  const getRaiseClosest = () => {
    if (!recommendation?.raise_options || !recommendation.raise_amount || recommendation.raise_amount <= 0) return -1;
    const opts = recommendation.raise_options;
    const vals = [opts.min, opts.halfPot, opts.potSize, opts.twicePot, opts.allIn];
    const dists = vals.map(v => Math.abs(v - recommendation.raise_amount!));
    return dists.indexOf(Math.min(...dists));
  };
  const closestRaiseIdx = getRaiseClosest();

  // 변경됨: AI 추천 없을 때도 레이즈 옵션 항상 계산 (게임 상태 기반)
  const localRaiseOptions = {
    min: minRaise,
    halfPot: Math.max(Math.floor(pot * 0.5), minRaise),
    potSize: Math.max(pot, minRaise),
    twicePot: Math.max(pot * 2, minRaise),
    allIn: maxRaise,
  };
  const displayRaiseOptions = recommendation?.raise_options ?? localRaiseOptions;

  // ─── 파산 화면 ─────────────────────────────────
  if (isBankrupt && !gameStarted) {
    return (
      <div className="app">
        <h1>🃏 Texas Hold'em</h1>
        <div className="bankrupt-panel">
          <div className="bankrupt-icon">💸</div>
          <h2>파산!</h2>
          <p>칩이 모두 떨어졌습니다.</p>
          <button className="btn-refill" onClick={refillChips}>
            +500칩 충전
          </button>
          <button className="btn-reset" onClick={resetChips}>
            칩 리셋 (1000칩으로 다시 시작)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <h1>🃏 Texas Hold'em</h1>

      {/* 상단 칩 현황 */}
      <div className="chips-bar">
        <span>🪙 내 칩: <strong>{totalChips}칩</strong></span>
        <span>전적: <strong>{totalGames}전 {totalWins}승</strong></span>
        <button className="btn-refill-small" onClick={refillChips}>+500칩</button>
        {totalChips <= 0 && (
          <button className="btn-reset-small" onClick={resetChips}>칩 리셋</button>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      {/* 인원 선택 + 시작 */}
      <div className="controls">
        <label>인원 선택</label>
        <div className="player-btns">
          {[2, 3, 4, 5, 6].map((n) => (
            <button
              key={n}
              className={`btn-player ${playerCount === n ? "active" : ""}`}
              onClick={() => setPlayerCount(n)}
              disabled={isLoading || gameStarted}
            >
              {n}명
            </button>
          ))}
        </div>
        <button className="btn-start" onClick={startGame} disabled={isLoading || totalChips <= 0}>
          {isLoading ? "처리 중..." : gameStarted ? "새 게임" : "시작"}
        </button>
      </div>

      {/* 메인 2컬럼 레이아웃 */}
      <div className="game-wrapper">
        {/* 왼쪽: 테이블 + 내 카드 + 베팅 */}
        <div className="left-section">

          {/* 쇼다운 결과 */}
          {showdown && (
            <div className="showdown-panel">
              <h2>🏆 쇼다운 결과</h2>
              <div className="showdown-winner">
                {showdown.winner.isUser ? "🎉 내가 이겼습니다!" : `Player ${showdown.winner.id} 승리!`}
                <span className="pot-prize"> (+{showdown.pot}칩)</span>
              </div>
              <div className="showdown-cards">
                {showdown.allPlayerCards.map((pc) => {
                  const hr = showdown.handRanks.find(h => h.playerId === pc.id);
                  const fc = showdown.finalChips.find(f => f.id === pc.id);
                  const isWinner = showdown.winner.id === pc.id;
                  return (
                    <div key={pc.id} className={`showdown-player ${isWinner ? "winner" : ""} ${pc.folded ? "sd-folded" : ""}`}>
                      <div className="sd-name">{pc.id === 1 ? "나" : `P${pc.id}`} {isWinner ? "👑" : ""}</div>
                      <div className="sd-cards">
                        {pc.folded
                          ? <span className="fold-badge">FOLD</span>
                          : pc.cards.map((c, i) => <PlayingCard key={i} rank={c.rank} suit={c.suit} size="small" />)
                        }
                      </div>
                      <div className="sd-hand">{hr?.label || ""}</div>
                      <div className="sd-chips">{fc?.chips || 0}칩</div>
                    </div>
                  );
                })}
              </div>
              <div className="result-summary">
                <div className="result-row">
                  <span>내 남은 칩</span>
                  <strong>{showdown.updatedChips ?? totalChips}칩</strong>
                </div>
                <div className={`result-row ${profit >= 0 ? "profit-pos" : "profit-neg"}`}>
                  <span>이번 게임 손익</span>
                  <strong>{profit >= 0 ? "+" : ""}{profit}칩</strong>
                </div>
              </div>
              {showdown.isGameOver ? (
                <button className="btn-reset" onClick={resetChips}>칩 리셋 (1000칩으로 다시 시작)</button>
              ) : (
                <button className="btn-new-game" onClick={startGame}>다음 게임 시작 (칩 자동 이어짐)</button>
              )}
            </div>
          )}

          {/* 포커 테이블 */}
          {!showdown && (
            <div className="table-scene">
              {otherPlayers.map((player, i) => (
                <div key={player.id} className={`slot-wrapper seat-${seats[i] || "top-center"}`}>
                  {/* 변경됨: SB/BB 포지션 배지 전달 */}
                  <PlayerSlotCard
                    player={player}
                    showCards={false}
                    isSB={player.id === sbPlayerId}
                    isBB={player.id === bbPlayerId}
                  />
                </div>
              ))}
              <div className="poker-table-oval">
                {gameStarted ? (
                  <div className="table-inner">
                    <div className="table-pot">🏆 팟: {pot}칩</div>
                    <div className="table-street-label">{STREET_LABELS[street]}</div>
                    <div className="table-community-cards">
                      {communityCards.length > 0
                        ? communityCards.map((card, i) => <PlayingCard key={i} rank={card.rank} suit={card.suit} size="medium" />)
                        : <span className="table-waiting">커뮤니티 카드 대기 중</span>
                      }
                    </div>
                  </div>
                ) : (
                  <div className="table-placeholder">게임을 시작하세요</div>
                )}
              </div>
            </div>
          )}

          {/* 내 카드 영역 */}
          {!showdown && (
            <div className="my-hand-section">
              <div className="my-hand-header">
                <span className="my-hand-name">나 (Player 1)</span>
                {/* 변경됨: 포지션 배지 표시 */}
                <span className="pos-badges">
                  {myState?.isDealer && <span className="badge-pos badge-dealer">D</span>}
                  {myIsSB && <span className="badge-pos badge-sb">SB</span>}
                  {myIsBB && <span className="badge-pos badge-bb">BB</span>}
                </span>
                {myState && <span className="slot-chips">{myState.chips}칩</span>}
                {myState && myState.currentBet > 0 && <span className="slot-bet">베팅 {myState.currentBet}칩</span>}
                {myState?.folded && <span className="fold-badge">FOLD</span>}
              </div>
              <div className="my-cards-row">
                {myCards.length > 0
                  ? myCards.map((c, i) => <PlayingCard key={i} rank={c.rank} suit={c.suit} size="large" />)
                  : <>
                    <div className="card-placeholder" style={{ width: 85, height: 120 }} />
                    <div className="card-placeholder" style={{ width: 85, height: 120 }} />
                  </>
                }
              </div>
              {/* 추가됨: 실시간 족보 + 강도 표시 (기능 2+3) */}
              {handInfo && gameStarted && !showdown && (
                <div className="hand-info-bar">
                  <div className="hand-info-top">
                    <span className="hand-info-name" style={{ color: handInfo.color }}>
                      현재 족보: {handInfo.description}
                    </span>
                    <span className="hand-stars">
                      {"★".repeat(handInfo.stars)}{"☆".repeat(5 - handInfo.stars)}
                    </span>
                  </div>
                  <span className="hand-strength-text">{handInfo.strengthText}</span>
                  {handInfo.drawText && (
                    <span className="hand-draw-text">💡 {handInfo.drawText}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 베팅 액션 */}
          {!showdown && (
            <div className="betting-section">
              <div className="betting-header">
                <span className="betting-title">🎯 당신의 선택</span>
                <span>팟 <strong>{pot}칩</strong></span>
                {!canCheck && <span>콜 <strong>{callAmount}칩</strong></span>}
              </div>

              {gameStarted && myState && !myState.folded ? (
                <>
                  <div className="bet-btns">
                    <div className={`btn-wrap ${recAction === "fold" ? "ai-highlight" : ""}`}>
                      <button className="btn-action btn-fold" onClick={() => placeBet("fold")} disabled={isLoading}>
                        ❌ FOLD
                      </button>
                      <span className="btn-desc">포기하기<br /><small>(패를 버림)</small></span>
                    </div>
                    <div className={`btn-wrap ${checkCallHighlight ? "ai-highlight" : ""}`}>
                      <button
                        className={`btn-action ${canCheck ? "btn-check" : "btn-call"}`}
                        onClick={() => placeBet(canCheck ? "check" : "call")}
                        disabled={isLoading}
                      >
                        ✅ {canCheck ? "CHECK" : `CALL ${callAmount}칩`}
                      </button>
                      <span className="btn-desc">
                        {canCheck ? "넘기기" : "맞추기"}<br />
                        <small>{canCheck ? "(베팅 없이)" : `(${callAmount}칩 콜)`}</small>
                      </span>
                    </div>
                    <div className={`btn-wrap ${recAction === "raise" ? "ai-highlight" : ""}`}>
                      {/* 변경됨: raiseAmount 없으면 minRaise 기본값 사용, disabled 조건 완화 */}
                      <button
                        className="btn-action btn-raise"
                        onClick={() => placeBet("raise", Number(raiseAmount) || minRaise)}
                        disabled={isLoading || (myState?.chips ?? 0) <= 0}
                      >
                        🔼 RAISE {raiseAmount ? `${raiseAmount}칩` : `${minRaise}칩`}
                      </button>
                      <span className="btn-desc">올리기<br /><small>(더 베팅)</small></span>
                    </div>
                  </div>

                  {/* 변경됨: 레이즈 옵션 버튼 5개 - AI 추천 여부와 관계없이 항상 표시 */}
                  <div className="raise-options-grid">
                    <div className="raise-options-label">
                      🔼 레이즈 금액 선택
                      {recommendation?.raise_options && <span className="raise-ai-badge"> (AI 추천 기반)</span>}
                    </div>
                    <div className="raise-options-btns">
                      {[
                        { label: "최소",   desc: "부담 없이 압박",    value: displayRaiseOptions.min },
                        { label: "소극적", desc: "살짝 압박",         value: displayRaiseOptions.halfPot },
                        { label: "표준",   desc: "일반적인 레이즈",   value: displayRaiseOptions.potSize },
                        { label: "공격적", desc: "강하게 압박",       value: displayRaiseOptions.twicePot },
                        { label: "올인",   desc: "모든 칩을 걺",      value: displayRaiseOptions.allIn },
                      ].map(({ label, desc, value }, idx) => (
                        <button
                          key={label}
                          className={`btn-raise-opt ${String(value) === raiseAmount ? "selected" : ""} ${idx === closestRaiseIdx ? "ai-pick-raise" : ""}`}
                          onClick={() => setRaiseAmount(String(value))}
                          disabled={isLoading}
                        >
                          <span className="raise-opt-label">{label}</span>
                          <span className="raise-opt-chips">{value}칩</span>
                          <span className="raise-opt-desc">{desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="raise-row">
                    <input
                      type="number"
                      className="raise-input"
                      placeholder="레이즈 금액 직접 입력"
                      value={raiseAmount}
                      onChange={e => setRaiseAmount(e.target.value)}
                      min={minRaise}
                      max={maxRaise}
                    />
                    <span className="raise-limits">최소 {minRaise}칩 ~ 최대 {maxRaise}칩</span>
                  </div>
                </>
              ) : gameStarted && myState?.folded ? (
                <div className="folded-notice">이번 라운드 폴드됨</div>
              ) : null}

              <div className="street-btns">
                <button className="btn-next" onClick={nextStreet} disabled={!gameStarted || isRiver || isLoading}>
                  {isRiver ? "River 완료" : (NEXT_STREET_LABELS[street] ?? "다음 단계")}
                </button>
                {isRiver && gameStarted && (
                  <button className="btn-showdown" onClick={triggerShowdown} disabled={isLoading}>
                    쇼다운 (카드 공개)
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 오른쪽: AI 코치 패널 */}
        <div className="right-section">
          <div className="ai-panel">
            <div className="ai-panel-header">
              <span>🤖 AI 코치의 조언</span>
              <button className="btn-ai" onClick={requestAI} disabled={!gameStarted || isAiLoading}>
                {isAiLoading ? "분석 중..." : "조언 받기"}
              </button>
            </div>

            {isAiLoading ? (
              <p className="ai-loading">AI가 패를 분석하고 있습니다...</p>
            ) : recommendation ? (
              <div className="ai-result">
                <div className="ai-section">
                  <div className="ai-section-title">📊 내 패 분석</div>
                  {recommendation.hand_strength && (
                    <div className="ai-row">핸드 강도: <strong>{recommendation.hand_strength}</strong></div>
                  )}
                  {recommendation.win_probability && (
                    <div className="ai-row">승리 확률: <strong>{recommendation.win_probability}</strong></div>
                  )}
                </div>
                <div className="ai-section">
                  <div className="ai-section-title">💡 추천 액션</div>
                  <div className="ai-action-row">
                    <span className={`action-badge action-${recommendation.action}`}>
                      {recommendation.action.toUpperCase()}{" "}
                      {recommendation.action === "fold" ? "🔽" : recommendation.action === "raise" ? "🔼" : "➡️"}
                    </span>
                    <span className="ai-confidence">
                      확신도: {recommendation.confidence.toUpperCase()}
                      <ConfidenceDots level={recommendation.confidence} />
                    </span>
                  </div>
                  {recommendation.raise_amount !== undefined && recommendation.raise_amount > 0 && (
                    <div className="ai-row">레이즈 추천 금액: <strong>{recommendation.raise_amount}칩</strong></div>
                  )}
                  <div className="ai-row">블러핑: {recommendation.bluff_recommended ? "추천 ✓" : "비추천 ✗"}</div>
                </div>
                <div className="ai-section">
                  <div className="ai-section-title">📝 이유</div>
                  <p className="ai-reason">{recommendation.reason}</p>
                </div>
                <div className="ai-section">
                  <div className="ai-section-title">⚠️ 주의</div>
                  <p className="ai-warning">{recommendation.warning}</p>
                </div>
              </div>
            ) : (
              <p className="ai-empty">
                {gameStarted ? "'조언 받기' 버튼을 눌러보세요" : "게임을 시작하면 AI 코치의 조언을 받을 수 있습니다"}
              </p>
            )}

            {/* 변경됨: AI 챗봇 섹션 - 게임 시작 후 항상 표시 */}
            {gameStarted && (
              <div className="chat-section">
                <div className="chat-section-title">💬 AI 코치에게 질문하기</div>

                {/* 대화 내역 */}
                {chatMessages.length > 0 ? (
                  <div className="chat-messages">
                    {chatMessages.map((msg, i) => (
                      <div key={i} className={`chat-bubble ${msg.role}`}>
                        {msg.role === "ai" && <span className="chat-avatar">🤖</span>}
                        <span className="chat-text">{msg.text}</span>
                        {msg.role === "user" && <span className="chat-avatar">👤</span>}
                      </div>
                    ))}
                    {isChatLoading && (
                      <div className="chat-bubble ai">
                        <span className="chat-avatar">🤖</span>
                        <span className="chat-text ai-loading">답변 생성 중...</span>
                      </div>
                    )}
                  </div>
                ) : !recommendation ? (
                  <p className="chat-guide">먼저 "조언 받기" 버튼을 눌러보세요</p>
                ) : null}

                {/* 입력 영역 */}
                <div className="chat-input-row">
                  <input
                    className="chat-input"
                    type="text"
                    placeholder={recommendation ? "조언에 대해 질문하세요..." : "먼저 조언을 받아보세요"}
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendChat()}
                    disabled={!recommendation || isChatLoading}
                  />
                  <button
                    className="btn-chat-send"
                    onClick={sendChat}
                    disabled={!recommendation || isChatLoading || !chatInput.trim()}
                  >
                    {isChatLoading ? "..." : "전송"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 추가됨: 튜토리얼 오버레이 */}
      {showTutorial && <TutorialOverlay onClose={closeTutorial} />}

      {/* 추가됨: 우하단 고정 "?" 도움말 버튼 */}
      <button className="btn-help" onClick={() => setShowTutorial(true)} title="도움말">?</button>
    </div>
  );
}

export default App;
