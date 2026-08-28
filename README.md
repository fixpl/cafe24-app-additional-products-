# Cafe24 추가구성상품 CSV 등록 앱

Cafe24 OAuth로 로그인한 뒤 CSV를 검증하고, 기준상품별 추가구성상품만 등록하거나 수정하는 SvelteKit 앱입니다. 별도 DB 없이 실행하며, Vercel은 `@sveltejs/adapter-vercel`, Dokploy/Railpack은 `@sveltejs/adapter-node`를 사용합니다.

## 처리 범위

앱이 요청하고 토큰 발급 후 검증하는 Cafe24 scope는 아래 네 개입니다.

- `mall.read_product`
- `mall.write_product`
- `mall.read_application`
- `mall.write_application`

실제 상품 변경 호출은 Cafe24 Admin API의 아래 두 요청으로 제한합니다.

- 등록: `POST https://{mall_id}.cafe24api.com/api/v2/admin/products/{product_no}/additionalproducts`
- 수정: `PUT https://{mall_id}.cafe24api.com/api/v2/admin/products/{product_no}/additionalproducts`

요청 본문은 `request.additional_products`에 추가구성상품 번호 배열을 전달합니다. 일반 상품 등록, 상품 수정, 삭제 또는 다른 Cafe24 API는 이 앱의 범위가 아닙니다.

## 인증과 토큰 보관

OAuth callback은 SvelteKit server에서 access token과 refresh token을 받은 뒤 AES-256-GCM으로 암호화합니다. 브라우저 IndexedDB에는 토큰 원문이 아니라 인증 정보와 결합된 ciphertext envelope만 저장합니다. 실제 API 요청 때 브라우저가 envelope를 SvelteKit endpoint로 보내면, server가 Vercel Environment Variable의 키로 복호화하여 Cafe24 API를 호출합니다.

사용자는 `mall_id`나 `shop_no`를 앱 화면에서 직접 입력하지 않습니다. Cafe24 관리자의 설치 앱이 등록된 App URL을 실행하면 루트 `/`로 들어온 launch query도 내부 `/app` 검증 경로로 전달하여 HMAC을 검증하고 OAuth를 자동 시작합니다. 앱을 다시 실행할 때마다 authorization code를 새 access token과 refresh token으로 교환하고, 기존 IndexedDB envelope를 새 값으로 교체합니다. 정상적인 Cafe24 실행 정보 없이 직접 접속하면 업로드 화면이나 수동 연결 폼 대신 정상 실행 안내만 표시합니다.

앱을 열어 둔 동안에는 background timer로 토큰을 계속 갱신하지 않습니다. Cafe24 추가구성상품 API를 호출할 때 access token 만료가 5분 이내이거나 첫 호출이 `401`이면 refresh token으로 한 번 자동 갱신하고, 갱신된 token pair를 다시 암호화해 IndexedDB envelope를 업데이트합니다. refresh token까지 만료되거나 갱신이 거절되면 Cafe24 관리자에서 앱을 다시 실행해야 합니다.

SvelteKit server는 브라우저의 IndexedDB에 직접 접근할 수 없습니다. IndexedDB 조회와 저장은 브라우저 코드가 담당하고, server에는 해당 요청에 필요한 envelope만 전달됩니다. 따라서 DevTools에서 ciphertext와 메타데이터는 볼 수 있지만 access token과 refresh token 원문은 저장되지 않습니다.

암호화 키는 다음 형식의 `CAFE24_TOKEN_ENCRYPTION_KEYS`로 관리합니다.

```text
v2:<현재-32-byte-base64url-key>,v1:<이전-32-byte-base64url-key>
```

첫 번째 키로 새 envelope를 암호화하고 나머지 키는 기존 envelope 복호화에만 사용합니다. 키 교체가 끝날 때까지 이전 키를 유지해야 기존 로그인이 끊기지 않습니다. 키 원문은 코드나 브라우저로 전달하지 않습니다.

DB가 없으므로 refresh 경쟁을 전역으로 잠글 수 없습니다. 한 브라우저 탭 안의 요청은 조정할 수 있지만, 여러 탭이나 여러 Vercel instance가 같은 refresh token을 동시에 갱신하는 경쟁은 완전히 제거되지 않습니다. 인증 오류가 반복되면 Cafe24 OAuth를 다시 연결해야 합니다.

운영에서는 같은 몰의 업로드를 한 번에 한 탭에서만 실행합니다. 만료 시점에 인증 오류가 발생하면 Cafe24 관리자에서 실제 반영 상태를 먼저 확인한 뒤 연결을 다시 만들고, 미반영 행만 새 CSV로 재실행합니다. 여러 instance까지 안전하게 직렬화해야 한다면 IndexedDB-only 제약을 풀고 KV/Redis/DB 기반의 짧은 refresh lock과 envelope version 저장이 필요합니다.

## Cafe24 앱 설정

Cafe24 개발자센터 앱 설정에는 배포 도메인을 기준으로 다음 URL을 등록합니다.

- App URL: `https://your-app.vercel.app/app`
- Redirect URI: `https://your-app.vercel.app/auth/callback`

Redirect URI는 `CAFE24_REDIRECT_URI`와 문자 단위로 같아야 합니다. 권한 관리에서 `mall.read_product`, `mall.write_product`, `mall.read_application`, `mall.write_application`을 모두 선택합니다. 코드는 Cafe24 앱 실행 시 네 scope를 OAuth 요청에 자동으로 포함하고, 발급된 토큰과 IndexedDB envelope에도 네 scope가 정확히 있는지 검증합니다. `CAFE24_SKIP_HMAC_CHECK=true`는 로컬 개발에서만 사용할 수 있으며 production에서는 허용되지 않습니다.

## CSV 형식

이 앱은 CSV만 처리합니다. `.xlsx`와 `.xls`는 직접 읽지 않으므로 제공하는 양식 CSV를 Excel에서 열어 편집한 뒤 `CSV UTF-8(쉼표로 분리)`로 저장합니다.

헤더는 아래 순서와 이름을 그대로 사용합니다.

```text
처리방식,기준상품번호,추가구성상품번호1,추가구성상품번호2,...,추가구성상품번호10
```

- `처리방식`: `등록`/`POST` 또는 `수정`/`PUT`
- `기준상품번호`: 추가구성상품을 연결할 기준 상품번호
- `추가구성상품번호1` ~ `추가구성상품번호10`: 연결할 상품번호
- 한 기준상품에는 추가구성상품을 1개 이상, 최대 10개까지 입력
- 파일 하나에는 데이터 행을 최대 200개까지 입력
- 같은 기준상품번호의 중복 행, 추가구성상품번호 중복, 기준상품 자체를 추가구성상품으로 지정한 행은 오류 처리

빈 추가구성상품 칸은 건너뜁니다. 검증 오류가 하나라도 있으면 전체 실행을 차단하고, Cafe24 API 호출 전에 오류 행을 표시합니다.

## 로컬 실행

Node.js 22와 pnpm 10을 기준으로 합니다.

```bash
cp .env.example .env
pnpm install
pnpm run dev
```

32-byte base64url 암호화 키는 다음처럼 생성할 수 있습니다.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

검증 명령은 다음과 같습니다.

```bash
pnpm run check
pnpm run lint
pnpm run test:unit
pnpm run build
pnpm run build:railpack
```

`pnpm run test:e2e`는 Playwright browser가 설치된 환경에서 실행합니다.

## Dokploy + Railpack 배포

저장소의 `railpack.json`이 Node.js 22, `pnpm run build:railpack`, `node build`, `0.0.0.0:3000`을 설정합니다. Dokploy Application은 Build Type `Railpack`, Base Directory `.`, Container Port `3000`, Health Check `/api/health`로 설정합니다. Build Command와 Start Command는 Dokploy에서 따로 덮어쓰지 않습니다.

Dokploy Environment Variables에 `.env.example`의 실제 값을 등록하고, `ORIGIN`과 `CAFE24_REDIRECT_URI`를 같은 production domain 기준으로 설정합니다. 자세한 설정과 검증 순서는 [`docs/DOKPLOY.md`](docs/DOKPLOY.md)를 참조합니다.

## Vercel 배포

Vercel Project의 Environment Variables에 `.env.example`의 실제 값을 등록하고, production domain으로 Cafe24 App URL과 Redirect URI를 갱신합니다. Preview domain과 production domain을 혼용하면 OAuth state 또는 Redirect URI 검증이 실패할 수 있습니다. 기본 `pnpm run build`는 기존처럼 Vercel adapter를 사용합니다.
