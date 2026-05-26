# Codex OAuth Image Pipeline

이 문서는 `ima2-gen`이 내부적으로 Codex/ChatGPT OAuth 세션을 사용해 이미지를 생성하는 흐름을 설명합니다.

프로젝트에서 흔히 말하는 “Codex imagen 호출”은 코드상 별도 `imagen` SDK를 직접 호출하는 구조가 아니라, 로컬 Codex OAuth 세션을 재사용하는 `openai-oauth` 프록시를 띄운 뒤 OpenAI Responses 형식의 `/v1/responses` 요청에 `image_generation` tool을 포함해 호출하는 구조입니다.

## 전체 흐름

```text
UI 또는 CLI
  -> Express route
  -> lib/responsesImageAdapter.ts
  -> provider 분기
      -> oauth: local openai-oauth proxy /v1/responses
      -> api: https://api.openai.com/v1/responses
  -> Responses stream/json 파싱
  -> image_generation_call.result base64 추출
  -> generated 파일 저장 + metadata 저장
  -> UI history / Agent image / Node graph 등에 반영
```

## OAuth 경로의 핵심

### 1. Codex 로그인 상태 감지

CLI는 `ima2 serve` 또는 `ima2 setup` 시 기존 Codex 로그인 상태를 확인합니다.

구현 위치: `lib/codexDetect.ts`

확인 대상:

- `~/.codex/auth.json`
- `~/.chatgpt-local/auth.json`
- `~/.config/codex/auth.json`
- `codex login status`

로그인이 없으면 setup 흐름에서 다음 명령을 실행합니다.

```bash
npx @openai/codex login
```

즉, 기본 OAuth 생성 경로는 OpenAI API key가 아니라 사용자의 로컬 Codex/ChatGPT OAuth 세션에 의존합니다.

### 2. openai-oauth 프록시 실행

서버 시작 시 OAuth 자동 시작이 켜져 있으면 로컬 프록시를 실행합니다.

구현 위치: `lib/oauthLauncher.ts`

실행 명령:

```bash
npx openai-oauth --port 10531
```

기본 포트는 `10531`입니다. 프록시가 준비되면 서버 런타임 컨텍스트에는 다음 값이 들어갑니다.

- `ctx.oauthUrl`
- `ctx.oauthReadyState`
- `ctx.oauthReadyPromise`

서버 시작 로그 예시:

```text
Starting openai-oauth on port 10531...
Image Gen running at http://127.0.0.1:3333
Provider policy: OAuth and API-key Responses providers. OAuth proxy port 10531.
[oauth] OpenAI-compatible endpoint ready at http://127.0.0.1:10531/v1
```

### 3. Responses endpoint 선택

공통 이미지 어댑터는 provider에 따라 endpoint를 선택합니다.

구현 위치: `lib/responsesImageAdapter.ts`의 `getEndpoint()`

```text
provider === "api"
  -> https://api.openai.com/v1/responses
  -> Authorization: Bearer <OPENAI_API_KEY>

provider !== "api"
  -> http://127.0.0.1:<oauthPort>/v1/responses
  -> Authorization header 없음
```

OAuth 경로에서는 프록시가 Codex/ChatGPT OAuth 세션을 이용해 upstream 인증을 처리하므로 앱 요청 자체에는 API key header가 붙지 않습니다.

## 이미지 생성 요청 payload

기본 텍스트 이미지 생성은 `generateViaResponses()`가 처리합니다.

구현 위치: `lib/responsesImageAdapter.ts`

요청 payload의 핵심 구조:

```json
{
  "model": "gpt-5.4-mini",
  "input": [
    {
      "role": "developer",
      "content": "You are an image generation assistant..."
    },
    {
      "role": "user",
      "content": "user prompt or mixed image/text content"
    }
  ],
  "tools": [
    { "type": "web_search" },
    {
      "type": "image_generation",
      "quality": "medium",
      "size": "1024x1024",
      "moderation": "low"
    }
  ],
  "tool_choice": "required",
  "reasoning": { "effort": "low" },
  "stream": true
}
```

웹 검색을 끄면 `web_search` tool은 제외됩니다.

```json
"tools": [
  {
    "type": "image_generation",
    "quality": "medium",
    "size": "1024x1024",
    "moderation": "low"
  }
]
```

## Prompt 구성

이미지 생성용 developer prompt는 `lib/oauthProxy/prompts.ts`에서 관리됩니다.

주요 prompt:

- `GENERATE_DEVELOPER_PROMPT`
- `GENERATE_NO_SEARCH_DEVELOPER_PROMPT`
- `EDIT_DEVELOPER_PROMPT`
- `EDIT_NO_SEARCH_DEVELOPER_PROMPT`
- `MULTIMODE_DEVELOPER_PROMPT`
- `MULTIMODE_NO_SEARCH_DEVELOPER_PROMPT`

핵심 정책:

- 최종 출력은 텍스트가 아니라 `image_generation` tool 호출이어야 합니다.
- 사용자의 원문 프롬프트를 기본적으로 보존합니다.
- 시각적으로 충분한 프롬프트는 번역/요약/재작성하지 않습니다.
- factual visual accuracy가 필요한 경우에만 web search를 사용합니다.
- 이미지 편집에서는 원본 스타일, 색감, 구도 보존을 우선합니다.
- multimode에서는 하나의 콜라주가 아니라 여러 개의 독립 `image_generation_call` 결과를 요구합니다.

## Reference 이미지 처리

텍스트 생성에 reference가 붙으면 `generateViaResponses()`는 reference를 Responses input content로 변환합니다.

구현 위치:

- `lib/responsesImageAdapter.ts`의 `normalizeRef()`
- `lib/referenceImageCompress.ts`
- `lib/refs.ts`

content 예시:

```json
[
  {
    "type": "input_image",
    "image_url": "data:image/png;base64,..."
  },
  {
    "type": "input_text",
    "text": "user prompt"
  }
]
```

편집 경로인 `editViaResponses()`는 원본 이미지를 강제로 압축해 input image로 넣고, 추가 reference와 mask guide가 있으면 함께 전달합니다.

중요: 현재 mask는 픽셀 단위 inpaint 보장을 하는 마스크가 아니라 “어디에 편집을 적용할지”를 알려주는 prompt guidance로 전달됩니다.

## 결과 파싱

Responses 호출은 기본적으로 stream 모드입니다.

구현 위치: `lib/responsesImageAdapter.ts`의 `parseStream()`

파서가 보는 주요 이벤트:

- `response.output_text.delta`
- `response.output_text.done`
- `response.output_item.done`
- `response.completed`
- `error`

이미지 결과는 다음 조건으로 추출합니다.

```text
event.type === "response.output_item.done"
item.type === "image_generation_call"
item.result exists
```

이때 `item.result`가 최종 base64 이미지입니다.

함께 추출하는 값:

- `revised_prompt`
- `usage`
- web search call count
- text output
- 이벤트 수와 이벤트 타입 통계

stream이 아닌 JSON 응답이면 `parseJson()`이 `output[]`에서 같은 방식으로 `image_generation_call.result`를 찾습니다.

## 저장 흐름

각 route는 `generateViaResponses()` 또는 `editViaResponses()`가 반환한 base64 이미지를 파일로 저장합니다.

대표 route:

- `routes/generate.ts`
- `routes/edit.ts`
- `routes/multimode.ts`
- `routes/nodes.ts`
- `lib/agentRuntime.ts`

Agent Mode의 저장 흐름은 `lib/agentRuntime.ts`의 `persistAgentImage()`가 담당합니다.

Agent 저장 파일명 예시:

```text
<timestamp>_<random>_agent.png
```

저장 위치:

```text
config.storage.generatedDir
```

저장 시 함께 처리되는 것:

- 이미지 파일 write
- sidecar metadata JSON write
- PNG/JPEG/WebP metadata best-effort embed
- history index invalidation
- Agent image import

## Route별 호출 경로

### Classic generate

```text
POST /api/generate
  -> routes/generate.ts
  -> generateViaResponses(...)
  -> /v1/responses + image_generation
  -> generated image 저장
```

### Edit

```text
POST /api/edit
  -> routes/edit.ts
  -> editViaResponses(...)
  -> input_image + edit prompt + image_generation
  -> generated image 저장
```

### Multimode

```text
POST /api/multimode
  -> routes/multimode.ts
  -> generateMultimodeViaResponses(...)
  -> up to N image_generation_call outputs
  -> 각 이미지 저장
```

### Node mode

```text
POST /api/node/generate
  -> routes/nodes.ts
  -> generateViaResponses(...) or editViaResponses(...)
  -> node result에 이미지 연결
```

### Agent mode

```text
POST /api/agent/sessions/:sessionId/queue
  -> queue item 생성
  -> lib/agentQueueWorker.ts
  -> runAgentGenerationPlan(...)
  -> generateViaResponses(...)
  -> persistAgentImage(...)
```

Agent Mode는 프롬프트 앞에 `<ima2-image-context>` manifest를 붙여 현재 세션 컨텍스트를 전달합니다.

## OAuth와 API provider 차이

| 항목 | OAuth provider | API provider |
| --- | --- | --- |
| endpoint | local `openai-oauth` proxy | `https://api.openai.com/v1/responses` |
| 인증 | Codex/ChatGPT OAuth 세션 | OpenAI API key |
| Authorization header | 앱에서는 없음 | `Bearer <OPENAI_API_KEY>` |
| 기본 provider | 예 | 아니오 |
| 설정 필요 | Codex login | API key |
| 대표 실패 | OAuth expired, proxy unavailable | API key missing/invalid |

## Timeout과 오류 처리

기본 생성 timeout은 config의 OAuth generation timeout을 사용합니다.

관련 config:

- `config.oauth.generationTimeoutMs`
- `config.oauth.statusTimeoutMs`
- `config.oauth.proxyPort`
- `config.oauth.autoStart`

주요 오류 코드:

- `OAUTH_UNAVAILABLE`
- `AUTH_CHATGPT_EXPIRED`
- `API_KEY_REQUIRED`
- `AUTH_API_KEY_INVALID`
- `MODERATION_REFUSED`
- `INVALID_REQUEST`
- `RESPONSES_IMAGE_TIMEOUT`
- `EMPTY_RESPONSE`

`postResponses()`는 HTTP 4xx/5xx 응답을 읽고 upstream error body를 분류해 사용자에게 노출 가능한 메시지로 변환합니다.

## 현재 코드상 주의점

- 현재 활성 공통 경로는 `lib/responsesImageAdapter.ts`입니다.
- `lib/oauthProxy/generators.ts`에도 OAuth 생성 함수들이 남아 있지만, 주요 route들은 `responsesImageAdapter.ts`를 import해 사용합니다.
- OAuth provider는 API key 없이 동작하지만, Codex/ChatGPT OAuth 세션과 `openai-oauth` 프록시가 정상이어야 합니다.
- `gpt-5.5` 같은 모델은 계정, quota, Codex CLI 버전, backend capability의 영향을 받을 수 있습니다.
- `gpt-5.3-codex-spark`는 config에서 unsupported 모델로 분류됩니다.

## 관련 파일

- `bin/ima2.ts`: setup/serve 흐름, OAuth 설정, Codex login 실행
- `lib/codexDetect.ts`: Codex auth 감지
- `lib/oauthLauncher.ts`: `openai-oauth` 프록시 실행과 ready 감지
- `lib/responsesImageAdapter.ts`: provider 분기, Responses 요청, stream/json 파싱
- `lib/oauthProxy/prompts.ts`: 이미지 생성/편집 developer prompt
- `lib/referenceImageCompress.ts`: reference/edit 이미지 압축
- `routes/generate.ts`: Classic generate API
- `routes/edit.ts`: edit API
- `routes/multimode.ts`: multimode API
- `routes/nodes.ts`: Node mode generate/edit API
- `lib/agentRuntime.ts`: Agent mode generate/persist 흐름
