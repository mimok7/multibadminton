# 전체 페이지 코드 정리 체크리스트

이 문서는 프로젝트의 모든 페이지를 수정하거나 리팩터링할 때 반드시 적용한다.
목표는 **사용하지 않는 코드 제거**, **중복 코드 통합**, **기능 보존**이다.

## 적용 원칙

- 코드 정리는 동작 변경이 아니다. 기존의 화면, 권한, 데이터 조회/저장, 라우팅, URL, 오류 처리, 알림 문구를 유지한다.
- 삭제 전에는 실제 사용처를 검색한다. `rg` 검색 결과가 없고 빌드/타입/런타임 경로에 필요하지 않다는 근거가 있어야 삭제한다.
- 중복 코드는 먼저 공통 컴포넌트, 훅, 유틸리티, 상수로 추출한 뒤 모든 호출부를 교체한다. 한 페이지에만 쓰이는 코드를 무리하게 공통화하지 않는다.
- 기능 보존이 불확실하면 삭제하지 않고 보류하며, 변경 사유와 확인하지 못한 위험을 기록한다.
- 사용자 앱 UI 수정 시 `badminton-user-app-design` 지침의 레이아웃, 헤더, 버튼, 모바일, 한글화 규칙을 함께 준수한다.
- `club_id`, RLS, 프로필 ID 체계, 권한 검사는 단순 중복으로 판단하여 제거하지 않는다. 멀티클럽 격리와 보안에 필요한 조건은 반드시 유지한다.

## 모든 페이지 공통 체크리스트

### 1. 변경 전 기준선

- [ ] 해당 페이지의 정상 진입 경로, 권한, 주요 사용자 흐름을 기록했다.
- [ ] 페이지가 사용하는 API, Server Action, Supabase 테이블/RPC, Context, 훅, 공통 컴포넌트를 확인했다.
- [ ] `useEffect` 의존성 배열, 로딩/에러/빈 상태, URL 파라미터, 새로고침 동작을 확인했다.
- [ ] 변경 전 `npm run type-check`와 `npm run build` 결과를 확인했거나, 실패 원인을 기록했다.
- [ ] 기존 작업 트리의 사용자 변경을 덮어쓰지 않았다.

### 2. 불필요한 코드 삭제

- [ ] 사용하지 않는 import, 변수, 타입, 상수, 함수, 컴포넌트, CSS 클래스를 제거했다.
- [ ] 도달할 수 없는 조건문, 중복 초기화, 사용하지 않는 상태와 effect를 제거했다.
- [ ] 디버깅용 `console.log`, 임시 테스트 데이터, 하드코딩된 개발용 우회 로직을 제거하거나 운영상 필요한 로그로 정리했다.
- [ ] 삭제한 심볼의 전체 사용처를 검색해 동적 호출, 문자열 라우팅, API 계약 누락이 없는지 확인했다.
- [ ] 테스트/점검 페이지는 실제 운영 페이지와 혼동되지 않도록 유지 필요성을 확인한 후 삭제 또는 접근 제한했다.

### 3. 중복 코드 통합

- [ ] 같은 조회/변환/검증/권한/날짜/표시 로직이 여러 곳에 복사되어 있는지 확인했다.
- [ ] 공통화할 코드는 `src/components`, `src/hooks`, `src/lib`, `src/types` 중 적절한 위치로 이동했다.
- [ ] 공통 함수의 입력 타입, 반환값, 오류 처리, 기본값을 명시했다.
- [ ] 통합 후 모든 호출부가 동일한 동작을 유지하는지 확인했다.
- [ ] 공통화 때문에 페이지별 권한, `club_id` 필터, 역할별 UI가 사라지지 않았는지 확인했다.

### 4. 기능 보존 및 UI 확인

- [ ] 페이지 진입, 뒤로가기, 새로고침, 직접 URL 접근이 정상이다.
- [ ] 조회, 생성, 수정, 삭제, 신청/취소, 점수 입력 등 페이지의 모든 액션이 정상이다.
- [ ] 로딩, 성공, 실패, 빈 목록, 네트워크 오류 상태가 정상 표시된다.
- [ ] 로그인하지 않은 사용자, 일반 회원, 관리자/매니저의 접근 결과가 기존과 같다.
- [ ] 모바일 화면에서 터치 영역이 충분하고 가로 스크롤/레이아웃 깨짐이 없다.
- [ ] 사용자에게 노출되는 문구가 한국어이며 같은 의미의 문구가 불필요하게 반복되지 않는다.

### 5. 변경 후 검증

- [ ] `npm run type-check` 통과.
- [ ] `npm run build` 통과.
- [ ] 변경 페이지와 연결 페이지를 실제 브라우저에서 확인.
- [ ] 관련 API/Server Action의 성공·실패 요청을 확인.
- [ ] 멀티클럽 페이지는 다른 클럽 데이터가 노출되지 않는지 확인.
- [ ] 필요 시 `sql/MULTI_CLUB_AUDIT.sql`의 읽기 전용 감사 쿼리를 실행하고 결과를 기록.
- [ ] 변경 파일, 삭제 파일, 공통화 이유, 검증 결과를 PR/작업 기록에 남겼다.

## 페이지별 체크리스트

아래 항목은 공통 체크리스트와 함께 페이지마다 완료한다. `[ ]`를 `[x]`로 바꾸고, 미완료 사유를 페이지 옆에 기록한다.

### 공용 및 인증

- [ ] `/` (`src/app/page.tsx`) — 초기 진입, 로그인/대시보드 분기, 불필요한 안내·리다이렉트 코드.
- [ ] `/login` (`src/app/(user)/login/page.tsx`) — 로그인, 오류 표시, 세션 확인, 중복 인증 로직.
- [ ] `/select-club` (`src/app/select-club/page.tsx`) — 클럽 선택, 활성 클럽 저장, 클럽 간 데이터 격리.
- [ ] `/unauthorized` (`src/app/(user)/unauthorized/page.tsx`) — 권한 없음 안내와 복귀 경로.
- [ ] `/change-password` (`src/app/(user)/change-password/page.tsx`) — 비밀번호 변경, 유효성 검사, 성공·실패 처리.

### 사용자 페이지

- [ ] `/dashboard` (`src/app/(user)/dashboard/page.tsx`) — 대시보드 데이터, 메뉴 링크, 중복 카드/통계, 공통 헤더.
- [ ] `/profile` (`src/app/(user)/profile/page.tsx`) — 프로필 조회·수정, avatar 업로드, `profiles.id`와 `user_id` 구분.
- [ ] `/my-schedule` (`src/app/(user)/my-schedule/page.tsx`) — 내 일정 조회, 날짜/상태 표시, 중복 일정 조회.
- [ ] `/today-matches` (`src/app/(user)/today-matches/page.tsx`) — 오늘 경기 조회, 참가자·클럽 필터, 실시간 갱신.
- [ ] `/match-registration` (`src/app/(user)/match-registration/page.tsx`) — 경기 신청·취소, 정원·중복 신청 검증.
- [ ] `/my-matches` (`src/app/(user)/my-matches/page.tsx`) — 내 경기 목록, 상태별 분류, 상세 이동.
- [ ] `/scoreboard/[matchId]` (`src/app/(user)/scoreboard/[matchId]/page.tsx`) — 경기 식별자, 점수 조회·입력, 권한과 새로고침.
- [ ] `/today-scoreboard/[matchId]` (`src/app/(user)/today-scoreboard/[matchId]/page.tsx`) — 오늘 경기 점수판, 실시간 상태, scoreboard와 중복 로직.
- [ ] `/tournament-bracket` (`src/app/(user)/tournament-bracket/page.tsx`) — 대진표 조회, 라운드/승자 표시, 빈 상태.
- [ ] `/my-tournament-matches` (`src/app/(user)/my-tournament-matches/page.tsx`) — 내 대회 경기, 대회·경기 클럽 일치 검증.
- [ ] `/ranking` (`src/app/(user)/ranking/page.tsx`) — 순위 조회, 정렬·레벨 표시, 중복 통계 계산.
- [ ] `/notifications` (`src/app/(user)/notifications/page.tsx`) — 알림 조회·읽음 처리, 클럽 범위, 중복 API 호출.
- [ ] `/products/exchange` (`src/app/(user)/products/exchange/page.tsx`) — 상품 조회·교환, 코인 차감, 중복 클릭 방지.
- [ ] `/challenge` (`src/app/(user)/challenge/page.tsx`) — 도전 신청·응답·초기화, 권한과 상태 전이.
- [ ] `/app-request` (`src/app/(user)/app-request/page.tsx`) — 요청 등록, 중복 제출, 성공·실패 피드백.
- [ ] `/manual` (`src/app/(user)/manual/page.tsx`) — 매뉴얼 링크와 사용자용 문구 중복.

### 매니저 및 관리자 페이지

- [ ] `/manager` (`src/app/(manager)/manager/page.tsx`) — 관리자 대시보드, 권한, 통계·메뉴 중복.
- [ ] `/admin` (`src/app/(admin)/admin/page.tsx`, `src/app/(manager)/manager/admin/page.tsx`) — 관리자 진입과 역할별 메뉴.
- [ ] `/admin/members` (`src/app/(admin)/admin/members/page.tsx`, `src/app/(manager)/manager/admin/members/page.tsx`) — 회원 관리의 공통화와 역할 차이 보존.
- [ ] `/members` (`src/app/(manager)/members/page.tsx`) — 회원 목록·검색·필터·상세.
- [ ] `/players` (`src/app/(manager)/players/page.tsx`) — 선수 목록·경기 생성 연결.
- [ ] `/players-scheduled` (`src/app/(manager)/players-scheduled/page.tsx`) — 예정 선수 조회와 일정 필터.
- [ ] `/attendance` (`src/app/(manager)/manager/attendance/page.tsx`) — 출석 조회·수정, `attendances` 클럽 단위 중복 키.
- [ ] `/match-schedule` (`src/app/(manager)/match-schedule/page.tsx`) — 경기 일정 CRUD, 상태·날짜·클럽 필터.
- [ ] `/match-assignment` (`src/app/(manager)/match-assignment/page.tsx`) — 선수 배정, 팀 구성, 생성 결과 보존.
- [ ] `/match-results` (`src/app/(manager)/match-results/page.tsx`) — 결과 입력·수정, 점수 제한·승패 계산.
- [ ] `/recurring-matches` (`src/app/(manager)/recurring-matches/page.tsx`) — 반복 경기 템플릿, 생성·수정·삭제.
- [ ] `/team-management` (`src/app/(manager)/team-management/page.tsx`) — 팀 구성, 선수 중복·정렬·저장.
- [ ] `/settings` (`src/app/(manager)/settings/page.tsx`) — 경기·코인·레벨 설정, 저장 권한.
- [ ] `/manager/courts` (`src/app/(manager)/manager/courts/page.tsx`) — 코트 설정과 경기 배정 연계.
- [ ] `/manager/coins` (`src/app/(manager)/manager/coins/page.tsx`) — 코인 설정·거래 기준.
- [ ] `/manager/products` (`src/app/(manager)/manager/products/page.tsx`) — 상품 CRUD·재고·교환 연계.
- [ ] `/manager/notifications` (`src/app/(manager)/manager/notifications/page.tsx`) — 공지/알림 CRUD와 클럽 범위.
- [ ] `/manager/pair-tournament-settings` (`src/app/(manager)/manager/pair-tournament-settings/page.tsx`) — 대회 설정 저장과 유효성 검사.
- [ ] `/manager/tournament-bracket` (`src/app/(manager)/manager/tournament-bracket/page.tsx`) — 대회 대진표 생성·표시.
- [ ] `/manager/tournament-matches` (`src/app/(manager)/manager/tournament-matches/page.tsx`) — 대회 경기 CRUD·일괄 수정·일정.
- [ ] `/manager/manual` (`src/app/(manager)/manager/manual/page.tsx`) — 관리자 매뉴얼과 중복 안내.
- [ ] `/admin-setup` (`src/app/(admin)/admin-setup/page.tsx`) — 초기 설정, 재실행 안전성, 운영 환경 노출 여부.

### 슈퍼관리자 및 점검 페이지

- [ ] `/superadmin` (`src/app/superadmin/page.tsx`) — 슈퍼관리자 권한과 클럽 범위.
- [ ] `/superadmin/login` (`src/app/superadmin/login/page.tsx`) — 별도 인증 흐름과 세션 분리.
- [ ] `/superadmin/clubs` (`src/app/superadmin/clubs/page.tsx`) — 클럽 CRUD와 전체 클럽 접근 권한.
- [ ] `/superadmin/members` (`src/app/superadmin/members/page.tsx`) — 전체 회원 조회·수정과 개인정보 노출.
- [ ] `/maintenance` (`src/app/maintenance/page.tsx`) — 운영 중단 안내와 복귀 링크.
- [ ] `/schedule` (`src/app/schedule/page.tsx`), `/schedule-new` (`src/app/schedule-new/page.tsx`) — 레거시/신규 일정 페이지의 역할 중복과 리다이렉트.
- [ ] `/attendance-all-test` (`src/app/attendance-all-test/page.tsx`), `/test-attendance-all` (`src/app/test-attendance-all/page.tsx`) — 테스트 페이지의 운영 노출·삭제 필요성.
- [ ] `/database-test` (`src/app/database-test/page.tsx`) — DB 테스트 코드, 민감정보 노출, 운영 접근 제한.

## 페이지 간 중복 정리 후보

- [ ] 공통 페이지 헤더, 홈 버튼, 로딩/오류/빈 상태 UI를 공통 컴포넌트로 통합했다.
- [ ] 회원 목록·검색·필터·레벨 표시 로직을 공통화하되 관리자/매니저 권한 차이를 보존했다.
- [ ] 경기 일정·참가자·점수·대회 경기 조회의 날짜/상태/클럽 필터를 공통 유틸리티로 통합했다.
- [ ] `scoreboard`와 `today-scoreboard`, 관리자 결과 입력 간 점수·승패 계산 중복을 검토했다.
- [ ] 대회 대진표와 대회 경기 페이지 간 브래킷·라운드 표시 중복을 검토했다.
- [ ] 알림, 상품, 코인, 프로필의 API 호출 및 오류 처리 중복을 검토했다.
- [ ] 동일한 Supabase 조회를 페이지마다 직접 구현하지 않고 기존 `src/lib`, 훅, Context를 우선 재사용했다.

## 최종 승인 조건

다음 중 하나라도 충족되지 않으면 정리 작업을 완료로 처리하지 않는다.

- [ ] 불필요한 코드 삭제 근거가 있다.
- [ ] 중복 제거 후 모든 호출부가 정상 동작한다.
- [ ] 기능·권한·멀티클럽 데이터 격리가 유지된다.
- [ ] `npm run type-check`와 `npm run build`가 통과한다.
- [ ] 변경 페이지를 모바일/데스크톱에서 확인했다.
- [ ] 기능상 문제를 확인하지 못한 경우 그 사실과 남은 위험을 기록했다.

## 후속 수정 의무 규칙

앞으로 어느 페이지나 공통 코드에 추가 수정이 발생하더라도, 해당 변경에 이 체크리스트를 다시 적용한다. 기능 추가, 버그 수정, UI 수정, SQL/RLS 수정 여부와 관계없이 변경 전 기준선 확인과 변경 후 검증을 생략하지 않는다.

## 2026-07-13 전체 1차 점검 기록

- [x] `src/app` 전체 페이지 및 API 라우트 빌드 대상 확인.
- [x] `npm run build` 통과. 전체 라우트 정적 생성 및 서버 라우트 컴파일 확인.
- [x] `npm run type-check` 단독 실행 통과.
- [x] 자동으로 확인 가능한 `prefer-const` 항목을 기능 변경 없이 정리.
- [x] 멀티클럽 필터, 점수판, 대회, 일정 관련 코드의 자동 정리 후 타입 검증.
- [ ] ESLint 전체 통과 — 기존 코드에 `any`, 미사용 심볼, Hook 의존성, JSX 특수문자 등 699건이 남아 있어 후속 작업 대상으로 분리.
- [ ] 브라우저에서 로그인 사용자·관리자·매니저·슈퍼관리자의 실제 데이터 흐름과 클럽 간 격리를 수동 확인.

이번 점검에서 기능 영향이 불명확한 대형 경기 생성·대회·점수판 로직은 무리하게 삭제하지 않는다. 해당 영역은 페이지별 실제 시나리오 확인 후 단계적으로 정리한다.

### 후속 작업 1차 결과

- [x] 프로필 페이지의 사용하지 않는 폼·헬퍼·표시 계산 코드 제거.
- [x] 디버그 출석 조회의 사용하지 않는 오류 변수 제거.
- [x] 사용하지 않는 API import와 보조 함수 제거.
- [x] 선수·참가 등록 페이지의 사용하지 않는 import·상태·옵션 제거.
- [x] 헤더의 사용하지 않는 예외 변수 제거.
- [x] `npm run build` 통과.
- [x] 빌드 완료 후 단독 `npm run type-check` 통과.
- [ ] ESLint 전체 통과 — `errors=497`, `warnings=157`로 감소했으며, 남은 항목은 대회/팀 구성/일정의 대형 로직과 `any`·Hook 의존성 검토 대상이다.

### 후속 작업 2차 결과

- [x] 점수판·오늘의 점수판 키보드 액션의 불필요한 논리식 표현을 명시적 조건문으로 정리. 동작은 동일하다.
- [x] 점수판의 사용하지 않는 타이머 ref와 경기 목록의 미사용 선택 헬퍼 제거.
- [x] 출석·도전·오늘의 점수판 API에서 사용하지 않는 예외 변수와 요청 필드 제거.
- [x] API 조회·점수 저장·`club_id` 필터·권한 검증 로직은 변경하지 않았다.
- [x] `npm run build` 통과.
- [x] 빌드 완료 후 단독 `npm run type-check` 통과.
- [x] ESLint: `errors=494`, `warnings=142`로 감소.
- [ ] 대회·팀 구성 알고리즘의 미사용 계산값은 실제 운영 시나리오 확인 후 다음 단계에서 정리한다.

### 후속 작업 3차 결과

- [x] 페어 대회 설정의 미사용 요약·게임 수·그룹화 계산과 타입 제거.
- [x] 토너먼트 경기 매칭의 미사용 점수 변수와 사용하지 않는 상태 setter 정리.
- [x] 팀 관리의 미사용 타입·상태·해제 보조 함수 제거.
- [x] 경기 생성 알고리즘, 대진 저장, 점수 계산 결과, 권한·클럽 필터는 변경하지 않았다.
- [x] `npm run build` 통과.
- [x] 빌드 완료 후 단독 `npm run type-check` 통과.
- [x] ESLint: `errors=494`, `warnings=123`으로 감소.
- [ ] 남은 미사용 대형 함수(`optimizeMatchBalancing`, `generateMatches`, `handleApplyCourtAndTime`)는 실제 호출 경로 확인 후 4차에서 판단한다.

### 후속 작업 4차 결과

- [x] 토너먼트 대형 함수 3개의 전체 호출 경로를 검색해 현재 호출부가 없음을 확인했다.
- [x] 경기 결과 페이지의 사용하지 않는 정렬 상태·정렬 핸들러·그룹화 계산을 제거했다.
- [x] 모바일 경기 결과 카드와 실제 결과 조회 화면은 유지했다.
- [x] 대형 토너먼트 함수는 주변 상태·보조 함수와의 연결 위험이 있어 기능 안전성을 위해 보존했다.
- [x] `npm run build` 통과.
- [x] 빌드 완료 후 단독 `npm run type-check` 통과.
- [x] ESLint: `errors=493`, `warnings=118`로 감소.
- [ ] 남은 대형 함수는 별도 테스트 시나리오 확보 후 제거 여부를 결정한다.

### PWA 설치 안내 수정 결과

- [x] 모바일뿐 아니라 컴퓨터 Chrome·Edge 등 데스크톱 브라우저에서도 설치 권장 표시.
- [x] standalone 앱 실행 중이거나 설치 완료 상태가 저장된 경우 안내를 다시 표시하지 않음.
- [x] `beforeinstallprompt` 중복 전역 리스너 제거.
- [x] `appinstalled`와 설치 승인 결과를 저장해 재방문 시 설치 안내 중복 방지.
- [x] `AppInstallPrompt` ESLint 및 전체 빌드·타입 검사 통과.
- [ ] 실제 브라우저 설치 이벤트 검증 — 브라우저 자동화 연결을 사용할 수 없어 코드·빌드 검증으로 대체.
