# 멀티클럽 데이터 격리·보안·성능 운영 지침

이 문서는 하나의 Supabase 프로젝트에서 여러 클럽 또는 테넌트의 데이터를 안전하게 분리하는 표준을 설명한다. 현재 배드민턴 시스템뿐 아니라 지점, 학원, 조직, 고객사 단위 SaaS에도 같은 원칙을 적용할 수 있다.

## 1. 목표와 완료 기준

멀티클럽 구현은 화면에서 `club_id`를 필터링하는 것만으로 완료되지 않는다. 다음 조건을 모두 만족해야 한다.

1. 사용자는 가입한 클럽 데이터만 조회할 수 있다.
2. 활성 클럽을 변경하기 전에는 다른 클럽 데이터가 화면에 섞이지 않는다.
3. URL, 요청 본문, 브라우저 쿠키의 `club_id`를 변조해도 권한이 확대되지 않는다.
4. INSERT와 UPSERT 시 서버가 신뢰할 수 있는 활성 클럽 ID를 강제로 기록한다.
5. 서비스 역할을 사용하는 서버 API는 인증과 클럽 권한을 별도로 검증한다.
6. RPC, Realtime, Storage도 일반 테이블과 동일한 격리 기준을 적용한다.
7. 클럽별 조회 조건을 지원하는 인덱스가 존재한다.
8. 부모·자식 행의 `club_id`가 서로 다르게 저장되지 않는다.
9. 감사 SQL에서 RLS 누락, NULL 클럽, 교차 클럽 참조가 발견되지 않는다.

## 2. 핵심 용어

- 시스템 사용자 ID: `auth.users.id`, Supabase Auth가 발급한 UUID.
- 프로필 ID: `public.profiles.id`, 업무 데이터가 참조하는 사용자 UUID.
- 클럽 회원: `public.club_members`의 `(club_id, user_id)` 관계.
- 활성 클럽: 현재 요청과 화면이 대상으로 삼는 하나의 클럽.
- 시스템 관리자: 전체 클럽을 선택해 관리할 수 있는 전역 관리자.
- 클럽 관리자: 특정 클럽 안에서만 관리 권한을 가진 회원.
- 클럽 종속 테이블: 모든 업무 행이 하나의 `club_id`에 소속되는 테이블.

## 3. 권장 데이터 모델

### 3.1 클럽

```sql
CREATE TABLE public.clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

### 3.2 클럽 회원

```sql
CREATE TABLE public.club_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  UNIQUE (club_id, user_id)
);
```

`user_id`가 Auth ID인지 프로필 ID인지 프로젝트 전체에서 하나로 통일해야 한다. 이 프로젝트는 과거 데이터 호환을 위해 `profiles.id`와 `profiles.user_id`를 모두 해석하지만, 신규 프로젝트는 `profiles.id = auth.users.id` 규칙을 권장한다.

### 3.3 클럽 종속 업무 테이블

```sql
CREATE TABLE public.example_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_example_records_club_id
ON public.example_records (club_id);
```

모든 클럽 종속 테이블은 `club_id NOT NULL`, 외래키, 인덱스를 기본값으로 사용한다.

## 4. 방어 계층

데이터 격리는 한 계층에만 의존하지 않는다.

### 4.1 입력 계층

- 쿠키와 요청 본문의 클럽 ID는 UUID 형식을 검증한다.
- 사용자가 전달한 `club_id`를 저장 값으로 그대로 사용하지 않는다.
- 클럽 선택 요청은 로그인 여부와 활성 회원 상태를 확인한다.
- 정지되거나 탈퇴한 회원의 기존 쿠키는 무효 처리한다.

현재 공통 구현은 `src/lib/club-scope.ts`의 `normalizeClubId()`를 사용한다.

### 4.2 애플리케이션 계층

- 브라우저와 일반 서버 클라이언트는 모든 클럽 종속 조회에 활성 `club_id`를 추가한다.
- INSERT와 UPSERT는 활성 클럽 ID로 강제 덮어쓴다.
- 활성 클럽이 없는 서비스 역할 클라이언트는 fail-closed 방식으로 실패해야 한다.
- 필터 래퍼가 클라이언트를 수정한다면 해당 클라이언트를 요청 간 공유하지 않는다.

### 4.3 데이터베이스 계층

- 노출 스키마의 모든 클럽 테이블에 RLS를 활성화한다.
- 기존 허용 정책과 별도로 `AS RESTRICTIVE` 정책을 사용해 클럽 가입 조건을 강제한다.
- `anon`에는 명시적인 거부 정책을 둔다.
- UPDATE 정책에는 `USING`과 `WITH CHECK`를 모두 둔다.
- RLS 함수의 `auth.uid()` 같은 고정 값은 `(SELECT auth.uid())` 형태로 평가 횟수를 줄인다.

### 4.4 관계 무결성 계층

단순 외래키는 부모와 자식의 `club_id`가 같은지 보장하지 않는다. 다음 관계는 감사하거나 복합 외래키/트리거로 강제해야 한다.

- 일정 ↔ 생성 경기
- 참가자 ↔ 일정
- 경기 결과 ↔ 생성 경기
- 대회 경기 ↔ 대회
- 구매 ↔ 상품
- 설문 응답 ↔ 설문

데이터량과 변경 빈도가 높다면 `(id, club_id)` UNIQUE 제약과 `(parent_id, club_id)` 복합 외래키를 권장한다.

## 5. 활성 클럽 전달 표준

현재 프로젝트는 다음 두 값을 함께 사용한다.

- `active_club_id` 쿠키: Next.js 라우팅과 서버 요청의 활성 클럽.
- `x-club-id` 헤더: `profiles`처럼 직접 `club_id`가 없는 테이블의 RLS 문맥.

규칙은 다음과 같다.

1. 쿠키는 서버 액션에서만 선택 권한을 확인한 후 설정한다.
2. 쿠키를 읽을 때 항상 UUID 정규화를 수행한다.
3. 유효하지 않은 쿠키가 있으면 “쿠키가 존재한다”고 처리하지 않는다.
4. 브라우저 Supabase 클라이언트는 클럽 변경 시 새로 생성한다.
5. 클럽 변경 시 이전 Realtime 채널을 모두 제거한다.
6. 헤더가 없을 때 다른 클럽 프로필을 반환하지 않는다.

쿠키는 현재 브라우저 클라이언트가 읽어야 하므로 `httpOnly`가 아니다. 따라서 쿠키 자체를 권한 증명으로 사용해서는 안 된다. 최종 권한은 회원 테이블과 RLS가 판단해야 한다.

## 6. RLS 표준

### 6.1 내부 회원 확인 함수

복잡한 회원 확인은 비노출 `private` 스키마에 둔다.

```sql
CREATE OR REPLACE FUNCTION private.is_active_club_member(target_club_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.club_members cm
    WHERE cm.club_id = target_club_id
      AND cm.user_id = (SELECT private.current_profile_id())
      AND cm.status = 'active'
  );
$$;
```

`SECURITY DEFINER`는 회원 테이블의 RLS 재귀를 피하기 위해 제한적으로 사용한다. 반드시 다음을 지킨다.

- `public` 스키마에 두지 않는다.
- `search_path`를 고정한다.
- 함수 안에서 호출자의 `auth.uid()`를 확인한다.
- `PUBLIC`과 `anon`의 실행 권한을 회수한다.

### 6.2 클럽 테이블 제한 정책

```sql
CREATE POLICY tenant_isolation
ON public.example_records
AS RESTRICTIVE
FOR ALL
TO authenticated
USING ((SELECT private.is_active_club_member(club_id)))
WITH CHECK ((SELECT private.is_active_club_member(club_id)));
```

### 6.3 익명 거부 정책

```sql
CREATE POLICY tenant_deny_anon
ON public.example_records
AS RESTRICTIVE
FOR ALL
TO anon
USING (false)
WITH CHECK (false);
```

### 6.4 허용 정책과 제한 정책의 차이

- 기본 정책은 permissive이며 여러 정책이 OR로 결합된다.
- restrictive 정책은 기존 허용 결과에 AND로 추가된다.
- restrictive 정책만 있고 permissive 정책이 하나도 없으면 접근이 허용되지 않는다.
- 격리 정책은 “어느 클럽 행인가”를 판단하고, 기존 업무 정책은 “무슨 작업을 할 수 있는가”를 판단하도록 역할을 분리한다.

## 7. 프로필 격리

`profiles`에는 `club_id`가 없기 때문에 무조건 전체 프로필을 조회하면 회원 정보가 섞인다.

권장 방식은 다음 중 하나다.

1. `club_members`를 시작점으로 프로필을 JOIN한다.
2. 활성 클럽 헤더를 RLS에서 읽고 같은 클럽 회원 프로필만 허용한다.
3. 서버에서 대상 회원 ID를 먼저 얻고 `.in('id', memberIds)`로 일괄 조회한다.

서비스 역할로 `profiles.select('*')`를 호출하면 RLS가 적용되지 않는다. 반드시 대상 ID 또는 클럽 회원 JOIN으로 범위를 제한한다.

## 8. 서비스 역할 사용 규칙

서비스 역할 키는 RLS를 우회한다. 다음 위치에만 존재해야 한다.

- 서버 전용 모듈
- 인증된 API Route 또는 Server Action
- 서명된 Cron 작업
- 내부 운영 스크립트

금지 사항:

- `NEXT_PUBLIC_` 환경 변수에 서비스 키 저장
- Client Component에서 서비스 키 사용
- 인증 없는 API에서 서비스 클라이언트 생성
- 요청 본문의 사용자 ID 또는 클럽 ID만 믿고 서비스 작업 수행
- 필터가 적용된 서비스 클라이언트를 전역 싱글턴으로 공유

서버 API의 최소 순서는 다음과 같다.

1. `auth.getUser()`로 JWT 검증
2. 활성 클럽 UUID 검증
3. 클럽 회원/역할 검증
4. 입력 스키마 검증
5. 범위가 강제된 서비스 작업
6. 오류 메시지에서 내부 SQL과 키 정보 제거

## 9. RPC와 고권한 함수

RPC는 Supabase 클라이언트의 `.from()` 필터를 거치지 않는다. 함수 자체가 클럽 범위를 받아야 한다.

```sql
CREATE FUNCTION public.example_summary(p_club_id uuid)
RETURNS TABLE (...)
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT ...
  FROM public.example_records
  WHERE club_id = p_club_id;
$$;
```

원칙:

- 가능하면 `SECURITY INVOKER`를 사용한다.
- `SECURITY DEFINER`는 함수 내부에서 호출자와 클럽 권한을 다시 확인한다.
- 함수 생성 직후 `REVOKE ALL ... FROM PUBLIC, anon`을 실행한다.
- 기존 함수의 `RETURNS TABLE` 컬럼 또는 반환 타입을 변경할 때는 `CREATE OR REPLACE`가 아니라 정확한 인자 시그니처로 `DROP FUNCTION` 후 재생성한다.
- Cron 전용 함수는 `service_role`에만 EXECUTE를 부여한다.
- 전체 클럽 집계 함수는 이름에 global/system 의미를 명시하고 시스템 관리자만 호출한다.
- RPC 인자에 `club_id`가 없다면 멀티클럽 전환 누락으로 간주한다.

## 10. Storage 보안

Storage 경로는 `{auth.uid()}/파일명` 형식을 사용한다.

```sql
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
)
```

UPDATE와 DELETE는 `owner_id`도 확인한다. 업로드 API가 서비스 역할을 사용하면 다음을 서버에서 검증한다.

- 로그인 사용자
- 파일 크기
- MIME 타입
- 서버가 생성한 저장 경로
- DB 프로필 갱신 실패 시 업로드 파일 제거

사용자가 보낸 파일 경로나 사용자 ID를 그대로 사용하지 않는다.

## 11. Realtime 격리

Realtime 구독에는 가능한 한 서버 필터를 지정한다.

```ts
.on('postgres_changes', {
  event: '*',
  schema: 'public',
  table: 'notifications',
  filter: `club_id=eq.${clubId}`,
}, handler)
```

추가 규칙:

- 채널 이름에 클럽 ID를 포함한다.
- 콜백에서도 `payload.new.club_id`를 재검증한다.
- 클럽 변경과 로그아웃 시 채널을 제거한다.
- 이벤트 후 재조회할 때도 클럽 필터가 적용된 클라이언트를 사용한다.

## 12. 조회 성능

### 12.1 컬럼 선택

목록 화면에서 `select('*')`를 사용하지 않는다. 화면에 필요한 컬럼만 조회한다.

### 12.2 N+1 제거

반복문 안에서 조회하거나 저장하지 않는다.

- ID를 모아 `.in()`으로 조회
- 관계 JOIN 사용
- 여러 행을 배열로 한 번에 INSERT
- 독립 조회는 `Promise.all()`로 병렬 실행

### 12.3 인덱스 순서

멀티클럽 쿼리는 보통 `club_id = ?` 조건을 사용하므로 복합 인덱스의 첫 컬럼을 `club_id`로 둔다.

```sql
CREATE INDEX ON match_schedules
  (club_id, match_date, scheduled_time, court_number);
```

등호 조건을 앞에, 범위·정렬 조건을 뒤에 둔다.

### 12.4 부분 인덱스

활성 행이나 NULL이 아닌 행만 반복 조회하면 부분 인덱스를 사용한다.

```sql
CREATE INDEX ON club_members (user_id, club_id)
WHERE status = 'active';
```

### 12.5 인덱스 과다 방지

인덱스는 읽기를 빠르게 하지만 INSERT와 UPDATE 비용을 증가시킨다. 사용하지 않는 인덱스는 `pg_stat_user_indexes`로 확인한 뒤 제거한다. 이름만 다른 중복 인덱스를 만들지 않는다.

## 13. 저장 안전성과 원자성

다음 작업은 하나의 DB 함수 또는 트랜잭션으로 처리한다.

- 경기 결과와 코인 정산
- 상품 구매와 잔액 차감
- 대진표 생성과 일정 연결
- 회원 삭제와 관련 데이터 정리

동시 수정이 가능한 잔액·점수 행은 `SELECT ... FOR UPDATE` 또는 조건부 UPDATE를 사용한다.

```sql
UPDATE club_members
SET coin_balance = coin_balance - p_price
WHERE club_id = p_club_id
  AND user_id = p_user_id
  AND coin_balance >= p_price
RETURNING coin_balance;
```

반환 행이 없으면 잔액 부족 또는 범위 오류로 처리한다.

## 14. 새 클럽 종속 기능 추가 체크리스트

새 테이블 또는 기능을 추가할 때 아래를 모두 확인한다.

- [ ] `club_id uuid NOT NULL`이 있는가?
- [ ] `clubs(id)` 외래키가 있는가?
- [ ] `club_id` 선두 인덱스가 있는가?
- [ ] `CLUB_SCOPED_TABLES`에 등록했는가?
- [ ] RLS가 ENABLE/FORCE 상태인가?
- [ ] authenticated restrictive 정책이 있는가?
- [ ] anon 거부 정책이 있는가?
- [ ] INSERT/UPSERT가 요청 본문의 `club_id`를 신뢰하지 않는가?
- [ ] 부모 행과 자식 행의 클럽 일치가 보장되는가?
- [ ] RPC에 `p_club_id`가 있는가?
- [ ] Realtime에 클럽 필터가 있는가?
- [ ] 서비스 역할 API에 인증과 권한 검사가 있는가?
- [ ] 다른 두 클럽 계정으로 교차 접근 테스트를 했는가?

## 15. 테스트 매트릭스

최소 두 클럽 A/B와 다음 계정을 준비한다.

- A 일반회원
- A 관리자
- B 일반회원
- A와 B에 모두 가입한 회원
- 시스템 관리자
- 정지 회원
- 비로그인 사용자

필수 테스트:

1. A 회원이 B 행 ID를 직접 조회하면 0행 또는 403이어야 한다.
2. A 회원이 B `club_id`로 INSERT하면 실패해야 한다.
3. A/B 복수 회원이 A를 선택하면 A 데이터만 보여야 한다.
4. 클럽 변경 직후 이전 Realtime 이벤트가 표시되지 않아야 한다.
5. 정지 회원의 기존 쿠키로 접근하면 클럽 선택 또는 권한 없음으로 이동해야 한다.
6. 비로그인 사용자가 Data API로 클럽 테이블을 조회하면 데이터가 없어야 한다.
7. 시스템 관리자가 선택한 클럽 범위에서만 일반 관리 화면 데이터를 보아야 한다.
8. 서비스 API에 인증 없이 요청하면 401/403/404여야 한다.
9. 다른 사용자의 UUID 경로로 Storage 업로드·수정·삭제가 실패해야 한다.
10. 부모와 다른 클럽 ID의 자식 행 저장이 실패하거나 감사에 잡혀야 한다.

## 16. SQL 적용 순서

현재 프로젝트의 권장 적용 순서:

1. DB 백업 또는 PITR 상태 확인
2. `sql/MULTI_CLUB_TENANT_ISOLATION.sql`
3. `sql/PERFORMANCE_OPTIMIZATION.sql`
4. `sql/setup_avatars_storage_rls.sql`
5. Supabase 타입 재생성
6. 애플리케이션 배포
7. `sql/MULTI_CLUB_AUDIT.sql`
8. Security Advisor와 Performance Advisor 실행

인덱스 SQL은 이용자가 적은 시간에 실행한다. 대형 테이블은 각 `CREATE INDEX CONCURRENTLY` 문을 트랜잭션 밖에서 개별 실행하는 별도 운영 절차를 사용한다.

## 17. 감사 SQL 결과 해석

`MULTI_CLUB_AUDIT.sql` 기준:

- `rls_enabled`, `rls_forced`: 클럽 종속 테이블은 모두 true가 권장된다.
- `tenant_isolation`: authenticated 행마다 있어야 한다.
- `tenant_deny_anon`: anon 행마다 있어야 한다.
- `null_club_rows`: 모두 0이어야 한다.
- `mismatched_rows`: 모두 0이어야 한다.
- 외래키 인덱스 누락: 실제 JOIN·삭제 경로를 확인해 필요한 인덱스를 추가한다.
- 공개 SECURITY DEFINER 결과: 함수별 내부 인증 검사를 검토하고 불필요한 PUBLIC/anon 권한을 회수한다.

감사 SQL을 서비스 역할 또는 SQL Editor에서 실행하면 RLS를 우회하므로 데이터가 보이는 것이 정상이다. 감사 목적은 정책 상태와 데이터 무결성 확인이다.

## 18. 모니터링

정기적으로 다음을 확인한다.

- `pg_stat_statements`의 총 실행 시간 상위 쿼리
- 평균 100ms 이상인 빈번한 쿼리
- 순차 스캔이 많은 대형 테이블
- 사용되지 않는 인덱스
- Realtime 채널 수와 중복 구독
- 401/403 증가율
- 클럽 ID가 없는 쓰기 오류
- API별 p50/p95 응답 시간

성능 변경 전후에는 동일한 파라미터로 `EXPLAIN (ANALYZE, BUFFERS)`를 비교한다. 운영 데이터가 변경되는 쿼리에는 `EXPLAIN ANALYZE`를 직접 사용하지 않는다.

## 19. 장애 대응

### 데이터가 섞여 보일 때

1. 활성 클럽 쿠키 값과 UUID 형식을 확인한다.
2. 네트워크 요청의 `x-club-id`를 확인한다.
3. 해당 테이블이 `CLUB_SCOPED_TABLES`에 있는지 확인한다.
4. 쿼리가 서비스 역할인지 확인한다.
5. RPC가 클럽 인자를 받는지 확인한다.
6. Realtime 구독 필터와 이전 채널 정리를 확인한다.
7. 감사 SQL의 교차 클럽 참조 결과를 확인한다.

### 정상 데이터가 보이지 않을 때

1. `club_members.status = 'active'`인지 확인한다.
2. `auth.users.id`, `profiles.id`, `profiles.user_id` 연결을 확인한다.
3. permissive 업무 정책이 존재하는지 확인한다.
4. Data API GRANT와 RLS를 별도로 확인한다.
5. 요청 헤더가 빠졌는지 확인한다.

### 저장이 느릴 때

1. 반복문 안의 await를 찾는다.
2. 불필요한 `.select('*')` 반환을 제거한다.
3. 저장 후 전체 목록 재조회 대신 변경 행만 반영한다.
4. 트리거와 SECURITY DEFINER 함수의 실행 계획을 확인한다.
5. 인덱스가 너무 많아 쓰기 비용이 증가했는지 확인한다.

## 20. 다른 프로젝트에 적용하는 방법

다른 프로젝트에서는 다음 이름만 업무 용어에 맞게 바꾼다.

- `clubs` → organizations, branches, schools, tenants
- `club_members` → organization_members, memberships
- `active_club_id` → active_tenant_id
- `x-club-id` → x-tenant-id
- `CLUB_SCOPED_TABLES` → TENANT_SCOPED_TABLES

나머지 원칙은 동일하다. 클라이언트 필터는 사용 편의를 위한 1차 방어이고, RLS와 서버 권한 검사가 최종 보안 경계라는 점을 유지해야 한다.

## 21. 현재 프로젝트 기준 파일

- 클럽 범위 정의: `src/lib/club-scope.ts`
- 브라우저 Supabase 클라이언트: `src/lib/supabase.ts`
- 서버·서비스 Supabase 클라이언트: `src/lib/supabase-server.ts`
- 클럽 쿠키 및 목록: `src/lib/club.ts`
- 클럽 역할 확인: `src/lib/club-auth.ts`
- 클럽 선택 서버 액션: `src/app/actions/club.ts`
- 데이터 격리 SQL: `sql/MULTI_CLUB_TENANT_ISOLATION.sql`
- 성능 인덱스 SQL: `sql/PERFORMANCE_OPTIMIZATION.sql`
- Storage 정책 SQL: `sql/setup_avatars_storage_rls.sql`
- 읽기 전용 감사 SQL: `sql/MULTI_CLUB_AUDIT.sql`

이 문서를 변경할 때는 코드와 SQL의 실제 구현도 함께 수정한다. 문서, 타입, RLS, 애플리케이션 필터 중 하나만 변경하면 장기적으로 다시 데이터 혼합 문제가 발생한다.

## 22. 공식 참고 자료

- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase API 보안과 요청 정보: https://supabase.com/docs/guides/api/securing-your-api
- Supabase 데이터베이스 성능 디버깅: https://supabase.com/docs/guides/database/debugging-performance
- Supabase RLS 성능 권장 사항: https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv
- Supabase Storage 접근 제어: https://supabase.com/docs/guides/storage/security/access-control
- PostgreSQL RLS: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL 인덱스: https://www.postgresql.org/docs/current/indexes.html

Supabase는 Data API의 테이블 GRANT와 RLS를 별도 보안 계층으로 취급한다. 신규 테이블을 추가할 때는 필요한 역할에 최소 권한만 명시적으로 부여하고, RLS 정책을 별도로 구성한다.
