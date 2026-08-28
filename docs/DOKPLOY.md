# Dokploy + Railpack 배포

이 앱은 Dokploy의 Railpack build type과 SvelteKit `adapter-node`로 실행합니다. 저장소의 `railpack.json`이 빌드와 실행 명령을 정의하므로 Dokploy에서 별도 command override를 입력하지 않습니다.

## Application 설정

- Source: 이 프로젝트가 포함된 Git repository와 배포 branch
- Base Directory: 저장소 root에 이 프로젝트가 있으면 `.`, monorepo면 해당 하위 경로
- Build Type: `Railpack`
- Container Port: `3000`
- Replicas: `1`
- Health Check Path: `/api/health`
- Health Check Port: `3000`
- Expected Status: `200`

Railpack이 저장소의 설정을 사용하면 다음 명령이 적용됩니다.

```text
Build: pnpm run build:railpack
Start: node build
Listen: 0.0.0.0:3000
```

## Environment Variables

Dokploy Environment 탭에 다음 값을 실제 운영 값으로 등록합니다.

```dotenv
ORIGIN=https://your-app.example.com
CAFE24_CLIENT_ID=replace_with_cafe24_client_id
CAFE24_CLIENT_SECRET=replace_with_cafe24_client_secret
CAFE24_REDIRECT_URI=https://your-app.example.com/auth/callback
CAFE24_API_VERSION=2026-06-01
CAFE24_TOKEN_ENCRYPTION_KEYS=v1:replace_with_32_byte_base64url_key
CAFE24_OAUTH_STATE_SECRET=replace_with_random_secret
CAFE24_SKIP_HMAC_CHECK=false
```

`ORIGIN`은 Dokploy의 실제 HTTPS domain origin이어야 합니다. 이 값이 틀리면 same-origin POST 검증과 Secure cookie 처리가 실패할 수 있습니다. `CAFE24_REDIRECT_URI`는 같은 origin의 `/auth/callback`이어야 합니다.

`HOST`, `PORT`, `NODE_ENV`, reverse proxy header 설정은 `railpack.json`에 있으므로 Dokploy에서 다시 등록할 필요가 없습니다. 다른 `PORT`를 덮어쓰면 Dokploy domain의 Container Port도 같게 변경해야 합니다.

DB 없이 IndexedDB envelope를 사용하므로 refresh token 동시 갱신 경쟁을 피하기 위해 우선 replica를 `1`로 유지합니다.

## Cafe24 앱 설정

```text
App URL: https://your-app.example.com/app
Redirect URI: https://your-app.example.com/auth/callback
```

권한 관리에서 다음 scope를 모두 선택합니다.

```text
mall.read_product
mall.write_product
mall.read_application
mall.write_application
```

## 배포 확인

Dokploy Deployments 로그에서 `pnpm run build:railpack`과 `node build`이 사용되는지 확인합니다. 배포 후 실제 domain으로 health endpoint를 확인합니다.

```bash
curl -fsS https://app-cafe24-additional-products.fixpl.net/api/health
```

정상 응답:

```json
{ "ok": true, "service": "cafe24-additional-products-app" }
```

이후 Cafe24 관리자에서 앱을 실행해 OAuth 승인, encrypted IndexedDB envelope 저장, CSV POST/PUT을 순서대로 검증합니다.
