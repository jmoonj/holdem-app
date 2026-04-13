# Texas Hold'em Practice App

AWS 3-Tier 아키텍처(S3 + EC2 + RDS)와 Amazon Bedrock Lambda를 활용한 텍사스 홀덤 모의 연습 웹 앱.

---

## 주요 기능

- 2~6인 텍사스 홀덤 게임 진행 (Pre-Flop → Flop → Turn → River → Showdown)
- AI 베팅 전략 추천 (Amazon Bedrock Nova Lite 모델)
- AI 코치 챗봇 (게임 상황 기반 질의응답)
- 칩 영속 관리 (RDS), 칩 충전 (+500칩) 기능
- AI 플레이어 칩 누적 보존 / 파산 시 자동 부활
- 실시간 족보 표시 + 강도 안내 (하이카드~로열플러시, ★ 게이지)
- SB / BB / D 포지션 배지 표시
- 첫 진입 튜토리얼 오버레이 (버튼 설명 + 족보 순서)

---

## AWS 아키텍처

```
사용자 브라우저
    │
    ▼
[S3 정적 호스팅]  ← React(Vite) 빌드 결과물
    │ API 요청 (HTTP)
    ▼
[EC2]  ← Express + TypeScript 게임 서버 (포트 80)
    │                    │
    ▼                    ▼
[RDS MySQL]         [Lambda Function URL]
게임 세션 저장         │
플레이어 칩 저장       ▼
                  [Amazon Bedrock]
                  Nova Lite 모델
                  AI 추천 / 챗봇
```

### 사용 리소스

| 리소스 | 역할 |
|--------|------|
| **S3** (정적 호스팅) | React 클라이언트 호스팅 |
| **EC2** (t2.micro, Amazon Linux 2023) | Express API 서버 (포트 80) |
| **RDS** (MySQL) | `game_sessions`, `player_chips` 테이블 |
| **Lambda** (Python 3.12, Function URL) | Bedrock 호출 브릿지 |
| **Amazon Bedrock** | `amazon.nova-lite-v1:0` — AI 추천 + 챗봇 |

---

## 실행 방법

### 0. 사전 준비

- Node.js 18+
- MySQL 클라이언트 (로컬 개발 시)
- AWS Lambda 함수에 **Bedrock 호출 권한** 부여 필요

### 1. 환경변수 설정

**server/.env** (`.env.example` 참고)

```env
DB_HOST=<RDS 엔드포인트>
DB_USER=<DB 사용자명>
DB_PASSWORD=<DB 비밀번호>
DB_NAME=<DB 이름>
BEDROCK_LAMBDA_URL=<Lambda Function URL>
```

**client/.env**

```env
VITE_SERVER_URL=http://<EC2 퍼블릭 IP>
```

> ⚠️ `.env` 파일은 `.gitignore`에 포함되어 있습니다. **절대 커밋하지 마세요.**

### 2. 서버 실행 (EC2)

```bash
cd server
npm install
sudo npm start        # 포트 80 사용 (sudo 필요)
```

### 3. 클라이언트 빌드 & 배포 (S3)

```bash
cd client
npm install
npm run build         # dist/ 생성
```

생성된 `dist/` 폴더 안의 파일을 S3 버킷 루트에 업로드합니다.
(S3 버킷 → 객체 업로드 → `dist/` 내부 파일 전체 선택)

### 4. Lambda 배포

`bedrock-lambda/lambda_function.py` 내용을 AWS 콘솔에서 Lambda 함수에 붙여넣고 **Deploy** 클릭.

---

## 접속 정보 (데모 환경)

| 항목 | 값 |
|------|-----|
| 클라이언트 URL | `http://kmucloud-22-s3-hw.s3-website-us-east-1.amazonaws.com` |
| 별도 로그인 없음 | 접속 즉시 게임 시작 가능 |
| 초기 지급 칩 | 1000칩 |
| 칩 부족 시 | 화면 우상단 **+500칩** 버튼으로 충전 |

> 테스트 계정 불필요 — 단일 플레이어 앱으로 누구나 바로 사용 가능합니다.

---

## 폴더 구조

```
holdem-app/
├── server/
│   ├── src/server.ts       # Express API 서버
│   ├── .env.example        # 환경변수 템플릿
│   └── package.json
├── client/
│   ├── src/
│   │   ├── App.tsx         # 메인 UI
│   │   ├── handEval.ts     # 프론트엔드 족보 계산 유틸리티
│   │   └── types.ts
│   ├── .env.example
│   └── package.json
├── bedrock-lambda/
│   └── lambda_function.py  # Nova Lite AI 추천 + 챗봇
├── .gitignore
└── README.md
```

---

## 주의사항

- `.env` 파일, `.pem` 키 파일은 `.gitignore`에 포함 → 커밋 전 반드시 확인
- Lambda에 Bedrock 호출 권한(`AmazonBedrockFullAccess`) 부여 필요
- EC2 포트 80 사용으로 `sudo npm start` 필요
- S3 버킷 퍼블릭 액세스 허용 및 정적 웹사이트 호스팅 활성화 필요
