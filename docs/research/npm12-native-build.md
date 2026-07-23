# TASK-086 — npm 12에서 `npx nautli` 네이티브 빌드 차단 실측

## 결론

**재현됨.** npm 12.0.1은 fresh install 시 `better-sqlite3@12.11.1`의 install script를 allowlist 미등록으로 차단한다. 설치 명령 자체는 성공(종료 0)하지만 네이티브 `.node` 바인딩이 없어서 `nautli stats`는 종료 1이다. 올바른 `npm exec` 전역형도 같은 방식으로 실패한다.

테스트 플랫폼에서는 허용 후 실제 prebuild 다운로드와 로드까지 성공했다. 즉 이번 실패의 직접 원인은 prebuild 부재나 node-gyp 실패가 아니라 **npm 12 install-script 정책에 의한 script 미실행**이다.

## 환경

| 항목 | 값 |
| --- | --- |
| Node.js (system) | `v22.22.1` |
| npm (system) | `10.9.4` |
| 재현에 사용한 npm | `npx -y npm@12`, 결과 `12.0.1` |
| 플랫폼 | macOS `darwin-arm64` |
| Node ABI | `127` |
| nautli (HEAD archive) | `0.2.4` |
| better-sqlite3 | `12.11.1` |

`npm@12.0.1`은 이 Node 버전에 대해 `^22.22.2 || ^24.15.0 || >=26.0.0`을 요구한다는 `EBADENGINE` 경고를 냈다. 단, 아래 npm 12 설치·exec·approve·rebuild 명령은 모두 실행됐으며, 결과에는 이 경고를 포함해 기록했다.

## 수행 명령

저장소 작업 트리는 건드리지 않고 다음으로 HEAD snapshot을 임시 디렉터리에 만들었다.

```sh
git -C /Users/bugbookee/Desktop/nautli archive HEAD | tar -x -C "$tmp/src"
(cd "$tmp/src" && npm pack)
```

생성 tarball: `nautli-0.2.4.tgz` (273.2 kB).

상위 디렉터리의 npm 프로젝트 탐색을 피하기 위해 독립 임시 fixture에 `package.json`을 만들고 `--prefix`로 설치 지점을 고정했다. 각 테스트에는 새 `NAUTLI_HOME`과 npm cache를 주었다.

```sh
NAUTLI_HOME="$tmp/nautli-home-local" \
NPM_CONFIG_CACHE="$tmp/npm-cache-local" \
npx -y npm@12 install --prefix "$tmp/local-install" \
  "$tmp/src/nautli-0.2.4.tgz"

node "$tmp/local-install/node_modules/nautli/src/cli.js" stats
```

## 로컬 tarball 설치 결과

| 확인 | 종료 코드 | 결과 |
| --- | ---: | --- |
| npm 12 install | 0 | 129 packages 설치, lifecycle 차단 경고 발생 |
| `require('better-sqlite3')` | 0 | 함수와 prototype은 존재 (`TYPE=function`, `PROTOTYPE=true`, `DATABASE_PROTOTYPE=true`) |
| `new Database(':memory:')` | 1 | 네이티브 바인딩 미발견 |
| `node .../nautli/src/cli.js stats` | 1 | 같은 바인딩 미발견을 `E_INVALID_INPUT`으로 출력 |

정확한 npm 12 경고:

```text
npm warn install-scripts 1 package had install scripts blocked because they are not covered by allowScripts:
npm warn install-scripts   better-sqlite3@12.11.1 (install: prebuild-install || node-gyp rebuild --release)
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

실제 로드 시 오류는 `Could not locate the bindings file`이고, 검색 경로에는 다음이 포함됐다.

```text
.../node_modules/better-sqlite3/build/Release/better_sqlite3.node
.../node_modules/better-sqlite3/lib/binding/node-v127-darwin-arm64/better_sqlite3.node
```

따라서 `require()` 반환값/`.prototype`만으로 네이티브 모듈이 작동한다고 볼 수 없다. `new Database(':memory:')`와 CLI 실행이 실질적인 로드 검증이다.

## 전역형 (`npx`) 결과

요청에 적힌 아래 형태는 npm exec의 package 지정 문법으로 해석되지 않았다.

```sh
npx -y npm@12 exec --yes "$tarball" nautli stats
```

이는 tarball 자체를 실행하려 해 `Permission denied`로 종료 **126**이었다.

동등한 유효 문법으로 재실행했다.

```sh
NAUTLI_HOME="$tmp/nautli-home-exec" \
NPM_CONFIG_CACHE="$tmp/npm-cache-exec" \
npx -y npm@12 exec --yes --package="$tarball" -- nautli stats
```

이 명령은 종료 **1**이었고, npm의 임시 `_npx/.../node_modules/better-sqlite3` 아래에서 위와 동일한 `Could not locate the bindings file` 오류가 났다. 즉 fresh-user `npx nautli` 경로도 네이티브 모듈 때문에 실제로 막힌다.

## 허용/복구 및 prebuild 검증

차단된 설치 fixture에서 다음을 실행했다.

```sh
npx -y npm@12 --prefix "$tmp/local-install" \
  install-scripts approve --all --allow-scripts-pin
npx -y npm@12 --prefix "$tmp/local-install" \
  rebuild better-sqlite3 --foreground-scripts
```

| 확인 | 종료 코드 | 결과 |
| --- | ---: | --- |
| `install-scripts approve --all --allow-scripts-pin` | 0 | consuming root `package.json`에 `"better-sqlite3@12.11.1": true` 기록 |
| `rebuild better-sqlite3 --foreground-scripts` | 0 | `prebuild-install || node-gyp rebuild --release` 실행 성공 |
| `new Database(':memory:')` | 0 | `OPEN_OK=true` |
| `nautli stats` | 0 | `{"total":0,"byStatus":{},"byScope":{}}` |

prebuild 존재를 추측하지 않기 위해, 빈 임시 npm cache를 lower-case `npm_config_cache`로 지정하고 `prebuild-install --verbose`를 실행했다. 실제 결과는 다음과 같았다.

```text
GET https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/
  better-sqlite3-v12.11.1-node-v127-darwin-arm64.tar.gz
HTTP 200
Successfully installed prebuilt binary!
```

따라서 **better-sqlite3 12.11.1에는 이 실측 플랫폼/ABI (`darwin-arm64`, Node ABI 127)용 prebuild가 실제로 있다.** 이번 npm 12 차단 상태에서는 그 다운로드 단계 자체가 실행되지 않았다.

## 대응 결정 권고

1. **문서 변경은 필요하다.** npm 12 사용자의 일반 설치 복구 절차를 명시한다: `npm install nautli` 후 `npm install-scripts approve --all --allow-scripts-pin`, 이어서 이미 차단된 경우 `npm rebuild better-sqlite3`, 그 다음 `nautli stats`.
2. **문서만으로 fresh `npx nautli`는 해결되지 않는다.** 실측에서 allowlist는 `nautli` 패키지가 아니라 consuming root의 `package.json`에 기록됐다. 빈 npx 임시 프로젝트에는 그 사전 승인이 없으므로, 현재 배포 형태의 무설정 `npx nautli`는 npm 12에서 계속 실패한다.
3. `npx nautli`를 지원 계약으로 유지하려면 package/docs의 단순 문구보다 큰 배포·의존성 설계 변경이 필요하다(예: npm install lifecycle에 의존하지 않는 저장소 백엔드 또는 별도 설치/승인 흐름). 최소한 해당 제한을 README/릴리스 노트에 명시해야 한다.

이번 결론은 npm 12.0.1을 Node 22.22.1에서 실행한 실측이다. npm 12이 이 Node patch 버전에 낸 engine 경고는 별도 호환성 이슈지만, install-script 차단 경고와 네이티브 바인딩 실패는 명시적으로 관측됐다.
