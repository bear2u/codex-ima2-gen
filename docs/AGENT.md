# Agent Mode

Agent Mode는 이미지 생성을 채팅, 세션, 큐, 도구 실행 기록으로 묶어 관리하는 워크스페이스입니다. Classic/Node 모드가 즉시 생성 중심이라면, Agent Mode는 사용자의 자연어 요청을 생성 계획으로 바꾸고, 여러 이미지 변형을 큐에서 처리하며, 결과와 컨텍스트를 세션 단위로 유지합니다.

## 핵심 개념

### 채팅형 이미지 생성

사용자는 Agent 채팅창에 만들 이미지를 자연어로 입력합니다. 프론트엔드는 요청을 Agent 큐 API로 보내고, 서버 워커가 실제 이미지 생성을 처리합니다.

- UI 진입점: `ui/src/components/agent/AgentWorkspace.tsx`
- API 라우트: `routes/agent.ts`
- 런타임 실행: `lib/agentRuntime.ts`

### 세션

Agent 작업은 세션 단위로 저장됩니다. 각 세션은 다음 상태를 가집니다.

- 세션 제목
- 대화 turn 목록
- 생성된 이미지 목록
- 현재 선택된 이미지
- 생성 설정
- 웹 검색 사용 여부
- compact 상태
- 큐 상태 요약

세션 데이터는 SQLite 테이블 `agent_sessions`, `agent_turns`, `agent_images`, `agent_queue_items` 등에 저장됩니다.

### 이미지 컨텍스트 Manifest

이미지를 생성하기 전에 서버는 현재 세션 상태를 `<ima2-image-context>` manifest로 구성합니다. 이 manifest는 실제 생성 프롬프트 앞에 붙어, 이전 이미지와 제약 조건을 모델에 전달합니다.

포함되는 정보:

- `sessionId`
- 현재 이미지 id/path/prompt/revisedPrompt
- style lock 목록
- subject lock 목록
- reference 목록
- web finding 목록
- 허용된 Agent tools

구현 위치: `lib/agentStore.ts`의 `buildImageContextManifest()`

## Agent Tools

Agent Mode에서 허용된 도구는 코드상 다음 3개로 고정되어 있습니다.

```text
ima2.get_image_context
ima2.web_search
ima2.generate_image
```

### `ima2.get_image_context`

현재 세션의 이미지 컨텍스트 manifest를 로드합니다. 실제 외부 도구 호출이라기보다, 서버가 Agent turn에 기록하는 내부 컨텍스트 단계입니다.

### `ima2.web_search`

웹 검색이 켜져 있을 때 Responses API 호출에 web search 옵션을 전달합니다. 응답에서 web search call 수가 보고되면 Agent web finding으로 기록합니다.

### `ima2.generate_image`

실제 이미지 생성을 수행합니다. 내부적으로 `generateViaResponses()`를 호출하고, 생성 결과를 `generated` 저장소에 파일로 저장한 뒤 Agent 이미지로 import합니다.

Codex/ChatGPT OAuth 세션을 사용해 `image_generation` tool을 호출하는 내부 파이프라인은 [CODEX_IMAGE_PIPELINE.md](./CODEX_IMAGE_PIPELINE.md)를 참고하세요.

## 생성 계획

Agent Mode는 입력 프롬프트와 설정을 보고 생성 계획을 만듭니다.

구현 위치: `lib/agentGenerationPlanner.ts`

### 자동 계획

기본 전략은 `auto`입니다. 이 경우 사용자의 문장에 포함된 개수 표현을 감지합니다.

예시:

- `3장`
- `세 가지 시안`
- `multiple variants`
- `options`
- `비교`
- `A/B`

명확한 다중 요청이 없으면 1장을 생성합니다. “여러 가지”, “다양하게”, “후보” 같은 모호한 다중 요청은 기본 3장으로 계획합니다.

### 수동 계획

생성 전략을 `manual`로 바꾸면 설정된 `variants` 개수만큼 생성합니다.

### 병렬 처리

여러 이미지를 생성할 때는 병렬 실행이 가능합니다.

- 설정 범위: 1-8
- 기본값: 2
- OAuth provider 상한: 2
- high quality 상한: 2
- API provider는 품질 제한이 없으면 최대 8까지 계획 가능

## Slash Commands

Agent Composer에서 `/`로 시작하는 명령을 사용할 수 있습니다.

```text
/question <topic>
/variants <1-8> <prompt>
/generate <1-8> <prompt>
/parallelism <1-8> <prompt>
/help
```

### `/question`

이미지를 생성하지 않고 질문에 대한 답변만 받습니다.

### `/variants`

지정한 개수만큼 이미지 변형을 강제로 생성합니다.

### `/generate`

지정한 개수의 bounded fanout 생성을 수행합니다.

### `/parallelism`

이번 요청에서 사용할 병렬 수를 제한합니다.

### `/help`

사용 가능한 Agent 명령어 목록을 보여줍니다.

구현 위치:

- 서버 파서: `lib/agentCommandParser.ts`
- UI 명령 목록: `ui/src/components/agent/slashCommands.ts`

## 큐와 워커

Agent 생성 요청은 즉시 실행되지 않고 큐 항목으로 저장됩니다.

주요 API:

- `POST /api/agent/sessions/:sessionId/queue`
- `GET /api/agent/queue`
- `GET /api/agent/sessions/:sessionId/queue`
- `POST /api/agent/queue/:itemId/cancel`
- `POST /api/agent/queue/:itemId/retry`

워커는 1.5초 간격으로 큐를 확인합니다.

기본 실행 제한:

- 전역 동시 실행: 최대 2개
- 세션당 동시 실행: 최대 1개

큐 항목 상태:

- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`

구현 위치: `lib/agentQueueWorker.ts`, `lib/agentQueueStore.ts`

## 화면 구성

Agent UI는 화면 크기에 따라 레이아웃이 바뀌지만, 기본적으로 다음 영역으로 나뉩니다.

### 세션 영역

세션 생성, 선택, 이름 변경, 삭제를 제공합니다. 각 세션에는 이미지 수, 웹 검색 사용 여부, compact 상태, 큐 실행 상태가 표시됩니다.

### 채팅 영역

사용자 요청, Agent 응답, 도구 실행 그룹, 생성 이미지 썸네일을 표시합니다. 도구 실행 그룹은 접거나 펼쳐서 request id, 입력 요약, 출력 요약, 소요 시간, 결과 이미지를 확인할 수 있습니다.

### 오른쪽 사이드바

탭 구성:

- `Image`: 현재 이미지와 변형 목록
- `Library`: 프롬프트 라이브러리 삽입
- `Forms`: Agent form 템플릿 삽입
- `Quality`: 품질, 크기, 포맷, 모더레이션, 변형 수, 병렬 수
- `Model`: 모델, provider, reasoning effort
- `Queue`: 큐 상태, 취소, 재시도

## 기본 생성 설정

Agent Mode의 기본 생성 설정은 다음과 같습니다.

```text
provider: oauth
model: gpt-5.4-mini
quality: medium
size: 1024x1024
format: png
moderation: low
reasoningEffort: medium
webSearchEnabled: true
generationStrategy: auto
variants: 1
maxAutoVariants: 8
parallelism: 2
```

구현 위치: `lib/agentSettings.ts`

## API 요약

### Tool 목록

```http
GET /api/agent/tools
```

허용된 Agent tool 목록을 반환합니다.

### Workspace 로드

```http
GET /api/agent/sessions
GET /api/agent/sessions?selectedSessionId=<id>
```

세션 목록, turn 목록, 이미지 목록, 현재 이미지, manifest, 큐 상태를 포함한 workspace payload를 반환합니다.

### 세션 생성

```http
POST /api/agent/sessions
```

body 예시:

```json
{
  "title": "New Agent",
  "webSearchEnabled": true,
  "currentImage": {
    "filename": "example.png",
    "url": "/generated/example.png",
    "prompt": "original prompt"
  }
}
```

### 세션 수정

```http
PATCH /api/agent/sessions/:sessionId
```

수정 가능한 값:

- `title`
- `webSearchEnabled`
- `generationSettings`
- `currentImageId`
- `styleLocks`
- `subjectLocks`

### 세션 삭제

```http
DELETE /api/agent/sessions/:sessionId
```

### 세션 compact

```http
POST /api/agent/sessions/:sessionId/compact
```

세션을 compact 상태로 표시하고 resume용 manifest를 유지했다는 assistant turn을 남깁니다.

### 직접 turn 실행

```http
POST /api/agent/sessions/:sessionId/turns
```

큐를 거치지 않고 단일 이미지 생성 흐름을 실행합니다. 현재 UI는 주로 queue API를 사용합니다.

### 큐 등록

```http
POST /api/agent/sessions/:sessionId/queue
```

body 예시:

```json
{
  "prompt": "세 가지 다른 구도의 제품 광고 이미지",
  "options": {
    "provider": "oauth",
    "model": "gpt-5.4-mini",
    "quality": "medium",
    "size": "1024x1024",
    "format": "png",
    "moderation": "low",
    "reasoningEffort": "medium",
    "webSearchEnabled": true,
    "generationStrategy": "auto",
    "variants": 1,
    "maxAutoVariants": 8,
    "parallelism": 2
  }
}
```

## 현재 제한 사항

현재 코드 기준으로는 다음 부분이 완성 기능이라기보다 골격 또는 placeholder에 가깝습니다.

- Composer의 참조 첨부 버튼은 UI에 있지만 실제 파일 첨부 핸들러가 연결되어 있지 않습니다.
- 오른쪽 `Refs` 탭은 참조가 없다는 placeholder를 표시합니다.
- 오른쪽 `Web` 탭은 웹 근거가 없다는 placeholder를 표시합니다.
- `Memory` 탭은 style lock과 subject lock이 컨텍스트에 보존된다는 안내만 표시합니다.
- style lock, subject lock을 사용자가 직접 편집하는 UI는 별도로 보이지 않습니다.
- 실시간 스트리밍 UI가 아니라 큐 상태를 약 1.5초 간격으로 폴링합니다.

## 관련 파일

- `routes/agent.ts`: Agent API 라우트
- `lib/agentRuntime.ts`: Agent turn 실행과 이미지 저장
- `lib/agentGenerationPlanner.ts`: 자동 생성 계획 수립
- `lib/agentQueueWorker.ts`: 큐 워커
- `lib/agentQueueStore.ts`: 큐 저장소
- `lib/agentStore.ts`: 세션, turn, 이미지, manifest 저장소
- `lib/agentSettings.ts`: Agent 생성 설정 기본값과 정규화
- `lib/agentCommandParser.ts`: slash command 파서
- `ui/src/components/agent/`: Agent UI 컴포넌트
- `ui/src/lib/agentApi.ts`: Agent 프론트엔드 API 클라이언트
