export const INSTRUCTIONS_START = "<!-- nautli:instructions -->";
export const INSTRUCTIONS_END = "<!-- /nautli:instructions -->";

export const AI_INSTRUCTIONS = `${INSTRUCTIONS_START}
## nautli memory rules

- At the start of a conversation or when context is needed, check relevant memories with \`briefing\` or \`recall\` first. If the briefing includes a [nautli] status line (pending review cards or stalled digestion), relay it to the user.
- Use \`remember\` to save one fact at a time only when the user explicitly asks you to remember it, or when a meaningful decision, verified lesson, or state change will be useful again.
- Do not save small talk, speculation, one-off information, unverified content, or intermediate work.
- Use the \`person\` scope for persistent personal preferences and information, \`procedure\` for workflows shared across projects, and \`project:<project-name>\` for facts specific to one project.
- When recalling memories, prefer the scope of the current task. Do not treat memories from another project as facts about the current project.
- When correcting or updating a memory, set the previous fact as \`supersedes\` when possible.
${INSTRUCTIONS_END}`;

export const AI_INSTRUCTIONS_KO = `${INSTRUCTIONS_START}
## nautli 기억 사용 규칙

- 대화를 시작하거나 작업 맥락이 필요할 때 \`briefing\` 또는 \`recall\`로 관련 기억을 먼저 확인한다. briefing에 [nautli] 상태 줄(리뷰 카드 대기·소화 멈춤)이 있으면 사용자에게 전달한다.
- 사용자가 명시적으로 기억해 달라고 했거나, 앞으로 다시 쓰일 의미 있는 결정·검증된 교훈·상태 변화가 생겼을 때만 \`remember\`로 한 사실씩 저장한다.
- 잡담, 추측, 일회성 정보, 아직 검증되지 않은 내용, 작업의 중간 과정은 저장하지 않는다.
- 개인의 지속적인 선호·정보는 \`person\`, 여러 프로젝트에 공통인 절차는 \`procedure\`, 특정 프로젝트의 사실은 \`project:<프로젝트명>\` scope를 사용한다.
- 기억을 조회할 때는 현재 작업과 같은 scope를 우선하고, 다른 프로젝트의 기억을 현재 프로젝트 사실처럼 사용하지 않는다.
- 기존 기억을 정정하거나 갱신할 때는 가능하면 이전 fact를 \`supersedes\`로 지정한다.
${INSTRUCTIONS_END}`;

export function instructionsFor(locale) {
  return locale === "ko" ? AI_INSTRUCTIONS_KO : AI_INSTRUCTIONS;
}

export const INSTRUCTIONS_PREVIEW = `Location: CLAUDE.md\n\nBlock to add:\n${AI_INSTRUCTIONS}`;
export const INSTRUCTIONS_PREVIEW_KO = `추가될 위치: CLAUDE.md\n\n추가될 블록:\n${AI_INSTRUCTIONS_KO}`;
