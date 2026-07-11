# Project Rules & Guidelines

- **Browser Verification**: Do not run the browser subagent (`browser_subagent`) to verify UI changes unless explicitly requested by the user, as it consumes too many tokens.
- **Implementation Plans**: Do not write or create implementation plans (`implementation_plan.md`) unless the user explicitly requests or mentions it in their request.
- **Walkthroughs**: Do not create or update walkthrough files (`walkthrough.md`) unless the user explicitly requests or mentions it in their request.
- **Build Execution**: Do not run build commands (e.g., `npm run build` or `next build`) to verify changes unless the user explicitly requests or mentions it in their request.
- **Language of Communication**: 모든 채팅 답변은 한국어(한글)로 작성하되, 특별한 언급이 없으면 핵심만 매우 간단하게 답변합니다. (토큰 절약 목적)
- **English for Code/System**: 채팅 답변 외의 소스 코드 주석, 커밋 메시지, 터미널 로그 설명, 설정 등은 한글화하지 않고 영어(영문) 상태를 유지합니다.
- **No Scientific Plugins**: Do not load, use, or reference any scientific plugins or skills (such as science, alphafold, pubmed, clinical-trials, etc.) in this workspace.
- **Deployment & Push Workflow**: When a deployment or git push is requested by the user, always perform type check (`npm run type-check`), stage and commit changes with a descriptive English commit message, and push to the origin remote (`git push origin main`) as a batch.
- **Code Cleanup During Changes**: When modifying code, remove dead, duplicated, or otherwise unnecessary code if its removal does not change required functionality or behavior.
- **Authorization Checks**: Keep route authorization in one server-side gate whenever possible; do not repeat the same permission check in layouts, shells, and child pages unless the second check protects a separate data mutation or API boundary.
- **Change Quality Review**: Before editing, inspect the affected flow for dead code, duplication, error paths, performance bottlenecks, and security risks. Remove only code that is confirmed unnecessary and behavior-safe to remove.
- **Required Post-Change Verification**: After every code change, run the narrowest relevant checks at minimum (type-check, lint, tests, or a read-only data/API verification), inspect the diff, and report any remaining warnings or unverified behavior. Run a production build when explicitly requested or when the change affects build/runtime boundaries.
