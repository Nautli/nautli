# nautli telemetry collector

선택 수집(기본 꺼짐) 엔드포인트의 전체 소스입니다. 이 폴더가 실제 배포본이며, 무엇을 받고 무엇을 거부하는지 코드로 확인할 수 있습니다.

- 받는 것: 카드 개수, 판정 경로 통계 같은 숫자와 설치 식별자(uuid), 앱 버전, OS 종류
- 거부하는 것: 그 외 모든 문자열. 노트나 기억의 내용이 섞인 요청은 400으로 거부됩니다(`onlyNumericLeaves`)
- 끄고 켜기: `nautli telemetry on|off|status` (기본 꺼짐)
