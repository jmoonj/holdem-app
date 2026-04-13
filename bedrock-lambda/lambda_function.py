from itertools import combinations  # 추가됨
from collections import Counter     # 추가됨
import json
import traceback
import boto3

# 추가됨: 랭크 맵 및 족보 이름
RANK_MAP = {
    '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
    '8': 8, '9': 9, '10': 10, 'T': 10,
    'J': 11, 'Q': 12, 'K': 13, 'A': 14
}
HAND_NAMES = {
    9: "로열 플러시", 8: "스트레이트 플러시", 7: "포카드",
    6: "풀하우스", 5: "플러시", 4: "스트레이트",
    3: "트리플", 2: "투페어", 1: "원페어", 0: "하이카드"
}


# 추가됨: 카드 파싱 (rank 숫자, suit 문자) 튜플 반환
def parse_card(c):
    if isinstance(c, dict):
        rank_str = c.get('rank', '')
        suit = c.get('suit', '')
    else:
        rank_str = str(c)
        suit = ''
    rank_int = RANK_MAP.get(rank_str, 0)
    return (rank_int, suit)


# 추가됨: 5장 카드 평가 → (hand_rank_int, ranks_desc)
def evaluate_5(cards):
    ranks = sorted([r for r, s in cards], reverse=True)
    suits = [s for r, s in cards]
    counter = Counter(ranks)
    counts = sorted(counter.values(), reverse=True)
    rank_groups = sorted(counter.keys(), key=lambda r: (counter[r], r), reverse=True)

    is_flush = len(set(suits)) == 1
    is_straight = False
    straight_high = 0

    unique_ranks = sorted(set(ranks), reverse=True)
    # 일반 스트레이트
    if len(unique_ranks) >= 5:
        for i in range(len(unique_ranks) - 4):
            window = unique_ranks[i:i+5]
            if window[0] - window[4] == 4 and len(set(window)) == 5:
                is_straight = True
                straight_high = window[0]
                break
    # 휠 스트레이트 (A-2-3-4-5)
    if not is_straight and set([14, 2, 3, 4, 5]).issubset(set(ranks)):
        is_straight = True
        straight_high = 5

    if is_flush and is_straight:
        if straight_high == 14 and set(ranks) == {10, 11, 12, 13, 14}:
            return (9, [14])
        return (8, [straight_high])
    if counts == [4, 1]:
        return (7, rank_groups)
    if counts == [3, 2]:
        return (6, rank_groups)
    if is_flush:
        return (5, ranks)
    if is_straight:
        return (4, [straight_high])
    if counts[0] == 3:
        return (3, rank_groups)
    if counts[:2] == [2, 2]:
        return (2, rank_groups)
    if counts[0] == 2:
        return (1, rank_groups)
    return (0, ranks)


# 추가됨: 5장 미만 카드(홀카드 2장 등)에 대한 족보 판단
def evaluate_available(cards):
    if not cards:
        return (0, [])
    ranks = sorted([r for r, s in cards], reverse=True)
    cnt = Counter(ranks)
    counts = sorted(cnt.values(), reverse=True)

    if counts[0] == 4: return (7, ranks)      # 포카드 (방어용)
    if counts[0] == 3: return (3, ranks)      # 트리플
    if counts[:2] == [2, 2]: return (2, ranks) # 투페어
    if counts[0] == 2: return (1, ranks)      # 원페어
    return (0, ranks)                          # 하이카드


# 변경됨: 보유 카드 중 최선의 5장 조합 반환 (5장 미만 시 evaluate_available 호출)
def best_hand(hole, community):
    all_cards = hole + community
    if len(all_cards) == 0:
        return (0, [])
    # 변경됨: 5장 미만이면 evaluate_available로 정확히 판단 (기존: 하이카드 폴백)
    if len(all_cards) < 5:
        return evaluate_available(all_cards)
    best = None
    for combo in combinations(all_cards, 5):
        result = evaluate_5(list(combo))
        if best is None or result[0] > best[0] or (result[0] == best[0] and result[1] > best[1]):
            best = result
    return best


# 추가됨: 드로우 감지
def detect_draws(hole, community):
    all_cards = hole + community
    draws = []
    if len(all_cards) < 2:
        return draws

    # 플러시 드로우: 같은 무늬 4장
    suit_counts = Counter(s for r, s in all_cards)
    if max(suit_counts.values()) == 4:
        draws.append('flush_draw')

    # 스트레이트 드로우
    unique_ranks = sorted(set(r for r, s in all_cards))
    for i in range(len(unique_ranks) - 3):
        window = unique_ranks[i:i+4]
        if window[-1] - window[0] == 3 and len(window) == 4:
            # 양방향 스트레이트 드로우
            draws.append('oesd')
            break
        if window[-1] - window[0] <= 4 and len(window) == 4:
            # 거트샷
            draws.append('gutshot')
    # 휠 드로우: A-2-3-4 또는 2-3-4-5
    if set([14, 2, 3, 4]).issubset(set(unique_ranks)) or set([2, 3, 4, 5]).issubset(set(unique_ranks)):
        if 'oesd' not in draws:
            draws.append('oesd')

    return draws


# 추가됨: 승리 확률 추정
def win_probability_estimate(hand_rank, street, draws):
    base = {9: 99, 8: 97, 7: 95, 6: 85, 5: 75, 4: 65, 3: 55, 2: 45, 1: 35, 0: 20}
    prob = base.get(hand_rank, 20)

    if street in ('preflop', 'flop'):
        if 'flush_draw' in draws:
            prob += 15
        if 'oesd' in draws:
            prob += 12
        if 'gutshot' in draws:
            prob += 6

    return min(prob, 98)


# 추가됨: 챗봇 요청 처리 함수
def handle_chat(input_data):
    bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

    message = input_data.get("message", "")
    game_context = input_data.get("gameContext") or {}
    last_advice = input_data.get("lastAdvice") or {}

    player_cards = game_context.get("playerCards", [])
    community_cards = game_context.get("communityCards", [])
    street = game_context.get("street", "")
    pot = game_context.get("pot", 0)
    my_chips = game_context.get("myChips", 0)

    def card_str(c):
        return f"{c['rank']}{c['suit']}" if isinstance(c, dict) else str(c)

    player_cards_str = ", ".join(card_str(c) for c in player_cards) if player_cards else "없음"
    community_cards_str = ", ".join(card_str(c) for c in community_cards) if community_cards else "없음"

    advice_action = last_advice.get("action", "없음") if last_advice else "없음"
    advice_reason = last_advice.get("reason", "") if last_advice else ""
    advice_str = f"추천 액션: {advice_action}\n이유: {advice_reason}" if last_advice else "없음"

    prompt = f"""당신은 텍사스 홀덤 코치입니다. 초보자의 질문에 친절하고 간결하게 한국어로 답하세요.

현재 게임 상황:
- 내 카드: {player_cards_str}
- 커뮤니티 카드: {community_cards_str}
- 단계: {street} | 팟: {pot}칩 | 내 칩: {my_chips}칩

직전 AI 조언:
{advice_str}

플레이어 질문: {message}

3문장 이내로 명확하고 구체적으로 답변해주세요."""

    try:
        response = bedrock.converse(
            modelId="amazon.nova-lite-v1:0",
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 200, "temperature": 0.5},
        )
        reply = response["output"]["message"]["content"][0]["text"]
        return json.dumps({"reply": reply}, ensure_ascii=False)
    except Exception as e:
        print(f"[ERROR] Chat error: {e}")
        return json.dumps({"reply": "죄송합니다, 답변을 받지 못했습니다."}, ensure_ascii=False)


def lambda_handler(event, context):
    print("EC2 -> Lambda로 전달된 데이터", event["body"])

    try:
        input_data = json.loads(event["body"])
    except (json.JSONDecodeError, TypeError):
        return {"statusCode": 400, "body": "Invalid JSON format"}

    # 추가됨: 챗봇 요청 라우팅
    if input_data.get("requestType") == "chat":
        return handle_chat(input_data)

    if not input_data.get("playerCards"):
        return {"statusCode": 400, "body": "playerCards is required"}

    bedrock = boto3.client("bedrock-runtime", region_name="us-east-1")

    player_cards = input_data.get("playerCards")
    community_cards = input_data.get("communityCards", [])
    street = input_data.get("street")
    pot = input_data.get("pot", 0)
    my_chips = input_data.get("myChips", 1000)
    current_bet = input_data.get("currentBet", 0)
    my_current_bet = input_data.get("myCurrentBet", 0)
    player_count = input_data.get("playerCount", 4)
    active_players = input_data.get("activePlayers", player_count)
    can_check = input_data.get("canCheck", True)
    can_call = input_data.get("canCall", False)
    call_needed = input_data.get("callNeeded", 0)
    pot_odds_ratio = input_data.get("potOddsRatio", 0)
    min_raise = input_data.get("minRaise", 20)
    half_pot = input_data.get("halfPot", int(pot * 0.5))
    pot_size = input_data.get("potSize", pot)
    twice_pot = input_data.get("twicePot", pot * 2)
    all_in = input_data.get("allIn", my_chips)

    def card_str(c):
        return f"{c['rank']}{c['suit']}" if isinstance(c, dict) else str(c)

    player_cards_str = ", ".join(card_str(c) for c in player_cards)
    community_cards_str = ", ".join(card_str(c) for c in community_cards) if community_cards else "없음"

    # 추가됨: Python으로 직접 족보/확률 계산
    hole_parsed = [parse_card(c) for c in player_cards]
    community_parsed = [parse_card(c) for c in community_cards]
    hand_rank, _ = best_hand(hole_parsed, community_parsed)
    hand_name = HAND_NAMES[hand_rank]
    draws = detect_draws(hole_parsed, community_parsed)
    win_prob = win_probability_estimate(hand_rank, street, draws)
    confidence = "high" if hand_rank >= 5 else ("medium" if hand_rank >= 2 else "low")
    pot_odds_pct = round(call_needed / (pot + call_needed) * 100, 1) if (pot + call_needed) > 0 else 0

    # 변경됨: AI는 전략 판단만 담당 (족보/확률은 Python이 계산한 값 주입)
    prompt = f"""당신은 텍사스 홀덤 전략 코치입니다. JSON 형식으로만 응답하세요.

=== 게임 상황 ===
내 홀 카드: {player_cards_str}
커뮤니티 카드: {community_cards_str}
현재 단계: {street}
활성 플레이어: {active_players}명 / 전체 {player_count}명

=== 이미 계산된 정보 (수정 금지) ===
족보: {hand_name}
승리 확률: 약 {win_prob}%
컨피던스: {confidence}
팟 오즈: {pot_odds_pct}%
드로우: {', '.join(draws) if draws else '없음'}

=== 베팅 옵션 ===
팟: {pot}칩 | 내 칩: {my_chips}칩
can_check={can_check} / can_call={can_call} / call_needed={call_needed}칩
레이즈 옵션: 최소={min_raise}, 소극={half_pot}, 표준={pot_size}, 공격={twice_pot}, 올인={all_in}

=== 지시사항 ===
1. action: can_check=False이면 check 금지, can_call=False이면 call 금지
2. raise_amount: 레이즈 선택 시 위 5가지 옵션 중 하나만 선택
3. reason: 초보자용 4-5문장 (족보+액션이유+팟오즈 포함)
4. warning: 조심할 점 1-2문장
5. bluff_recommended: 블러프가 유효한 상황인지

다음 JSON 형식으로만 응답 (마크다운, 추가 텍스트 절대 없이):
{{
  "action": "check 또는 call 또는 raise 또는 fold 중 가능한 것만",
  "raise_amount": 레이즈 금액(옵션 중 하나, 아니면 0),
  "raise_options": {{
    "min": {min_raise},
    "halfPot": {half_pot},
    "potSize": {pot_size},
    "twicePot": {twice_pot},
    "allIn": {all_in}
  }},
  "confidence": "{confidence}",
  "hand_strength": "{hand_name}",
  "win_probability": "약 {win_prob}%",
  "bluff_recommended": true 또는 false,
  "reason": "초보자도 이해할 수 있게 4-5문장 한국어",
  "warning": "조심할 점 1-2문장 한국어"
}}"""

    print(f"[DEBUG] prompt length={len(prompt)}, hand={hand_name}, win={win_prob}%, conf={confidence}")

    try:
        response = bedrock.converse(
            modelId="amazon.nova-lite-v1:0",
            messages=[{"role": "user", "content": [{"text": prompt}]}],
            inferenceConfig={"maxTokens": 600, "temperature": 0.3},
        )

        ai_response = response["output"]["message"]["content"][0]["text"]
        return ai_response

    except Exception as e:
        print(f"[ERROR] type={type(e).__name__}, msg={e}")
        traceback.print_exc()
        raise Exception("Lambda function error")
