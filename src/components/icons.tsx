import type { SVGProps } from "react";

// UI-02(§7.1): 툴바 각 기능의 아이콘. 의미가 바로 연상되는 단순한 획(stroke)
// 아이콘을 직접 그려서, 새 의존성 없이 24x24 뷰박스·currentColor 규칙으로
// 통일한다. 툴팁(기능명)은 각 버튼의 title 속성이 맡는다(브라우저 네이티브
// 툴팁이 창 폭에 맞춰 위치를 알아서 조정하므로 잘림 문제가 없다).
type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a1 1 0 0 1 1-1h4l2 2h9a1 1 0 0 1 1 1v1H6.5a1 1 0 0 0-.95.68L3 18V7Z" />
      <path d="M3 18l2.55-7.32A1 1 0 0 1 6.5 10H21l-2.55 7.32a1 1 0 0 1-.95.68H4a1 1 0 0 1-1-1Z" />
    </Icon>
  );
}

/**
 * DET-05: 자동검출(민감정보 스캔). 돋보기 자체는 그대로 두되(사용자 요청),
 * 렌즈 안에 짧은 가로줄 두 개를 넣어 "본문을 훑으며 무언가(민감정보)를
 * 찾는다"는 의미를 더한다 — 일반적인 "본문검색" 돋보기 아이콘과 구분하기
 * 위함(재현 보고: 두 기능이 아이콘만으로 구분이 안 됨). 짧은 가로줄은
 * RedactionListIcon 등 다른 곳에서도 "텍스트 줄"을 나타내는 데 쓰는 것과
 * 같은 관용구라 앱 전체 아이콘 언어와도 맞는다.
 */
export function DetectIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6" />
      <line x1="15" y1="15" x2="20.5" y2="20.5" />
      <line x1="7" y1="8.5" x2="14" y2="8.5" />
      <line x1="7" y1="12.5" x2="11.5" y2="12.5" />
    </Icon>
  );
}

export function BookmarkIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h12a.5.5 0 0 1 .5.5v16.2a.3.3 0 0 1-.47.25L12 16.2l-6.03 4.24A.3.3 0 0 1 5.5 20.2V4a.5.5 0 0 1 .5-.5Z" />
    </Icon>
  );
}

/** LIST-08: 목록 헤더의 구분/위치 컬럼 필터 트리거. */
export function FilterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 5h17l-6 7v6l-5 2v-8l-6-7Z" />
    </Icon>
  );
}

export function RedactionListIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="4" height="3" rx="0.5" />
      <rect x="3.5" y="10.5" width="4" height="3" rx="0.5" />
      <rect x="3.5" y="16" width="4" height="3" rx="0.5" />
      <line x1="10" y1="6.5" x2="20.5" y2="6.5" />
      <line x1="10" y1="12" x2="20.5" y2="12" />
      <line x1="10" y1="17.5" x2="20.5" y2="17.5" />
    </Icon>
  );
}

export function AddRedactionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </Icon>
  );
}

export function DeleteRedactionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="4" y1="6.5" x2="20" y2="6.5" />
      <path d="M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5" />
      <line x1="10" y1="10.5" x2="10.4" y2="17" />
      <line x1="14" y1="10.5" x2="13.6" y2="17" />
    </Icon>
  );
}

/** LIST-09(신규): 블랙마킹 목록 "모두 삭제" — DeleteRedactionIcon과 같은
 * 휴지통 실루엣을 속을 채워(currentColor) 그려 "선택 하나"가 아니라
 * "전부"라는 차이를 준다. */
export function DeleteAllRedactionIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <line x1="4" y1="6.5" x2="20" y2="6.5" />
      <path d="M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path
        d="M6.5 6.5 7.3 19a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.5Z"
        fill="currentColor"
      />
    </Icon>
  );
}

export function ExportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v10.5" />
      <path d="M8 10.5 12 14.5 16 10.5" />
      <path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </Icon>
  );
}

export function ImportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 14.5V4" />
      <path d="M8 7.5 12 3.5 16 7.5" />
      <path d="M4.5 16v3a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3" />
    </Icon>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3.5h11l3.5 3.5V19a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5Z" />
      <rect x="7" y="4" width="8" height="5" />
      <rect x="7" y="14" width="10" height="6.2" />
    </Icon>
  );
}

/**
 * DET-07: 페이지 전체보기(fit-to-page) — 페이지 사각형 안에 점선 사각형을
 * 둬 "실제 표시 영역"이라는 느낌을 준다. 원래 제외영역 아이콘이었는데,
 * 사용자 요청으로 전체보기 쪽으로 옮기고 제외영역은 아래 새 아이콘으로
 * 바꿨다.
 */
export function FitToPageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <rect x="7.5" y="7" width="9" height="10" rx="0.5" strokeDasharray="2 2" />
    </Icon>
  );
}

/** DET-07: 페이지별 탐지 제외영역 설정 토글. 페이지 사각형의 위/아래를
 * 실제 UI의 회색 음영과 같은 방식(채워진 띠)으로 가려, "가장자리는
 * 탐지에서 뺀다"는 의미를 그대로 보여준다. */
export function ExclusionZoneIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="1" />
      <rect x="4" y="3" width="16" height="4.5" rx="1" fill="currentColor" stroke="none" />
      <rect x="4" y="16.5" width="16" height="4.5" rx="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/**
 * PDF-05: 페이지네이션(한 장) 전환 아이콘 — 모서리가 접힌 "문서 한 장" 모양.
 * 스크롤 모드 아이콘(두 장이 이어짐)과 한눈에 대비되도록 단순한 낱장 문서로
 * 그린다(사용자 참고 이미지 요청 — 본문줄 대신 접힌 모서리로 "한 장"을 표현).
 */
export function PaginatedViewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 3.5h8l4 4v12.4a.6.6 0 0 1-.6.6H6a.6.6 0 0 1-.6-.6V4.1A.6.6 0 0 1 6 3.5Z" />
      <path d="M14 3.5V7.5h4" />
    </Icon>
  );
}

/**
 * PDF-05: 연속 스크롤 모드 전환 아이콘. **넓은 페이지 두 장의 일부**만 보이고
 * 바깥(위·아래) 변을 아이콘 경계까지 터, 페이지가 밖으로 계속 이어지는(스크롤
 * 도중) 느낌을 준다 — 중앙 연결선은 없다. 아래 페이지 우상단을 살짝 접어 "페이지"
 * 임을 강조한다(사용자 확정 도안). PaginatedViewIcon(낱장 문서)과 바로 대비된다.
 */
export function ScrollViewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4.5 2 V10.5 H19.5 V2" />
      <path d="M4.5 22 V14 H16.5 L19.5 17 V22" />
      <path d="M16.5 14 V17 H19.5" />
    </Icon>
  );
}

export function ZoomOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      <line x1="15.3" y1="15.3" x2="20.5" y2="20.5" />
    </Icon>
  );
}

export function ZoomInIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      <line x1="15.3" y1="15.3" x2="20.5" y2="20.5" />
    </Icon>
  );
}

export function ColorSettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5a8.5 8.5 0 1 0 0 17c1 0 1.7-.8 1.7-1.7 0-.45-.18-.85-.46-1.15-.28-.3-.46-.7-.46-1.15 0-.9.75-1.6 1.7-1.6H16a4 4 0 0 0 4-4c0-4.4-3.6-7.4-8-7.4Z" />
      <circle cx="7.8" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="10.2" cy="7.3" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7.3" r="1" fill="currentColor" stroke="none" />
      <circle cx="16.7" cy="11" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function ShortcutsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <line x1="6" y1="9.5" x2="6" y2="9.5" />
      <line x1="9" y1="9.5" x2="9" y2="9.5" />
      <line x1="12" y1="9.5" x2="12" y2="9.5" />
      <line x1="15" y1="9.5" x2="15" y2="9.5" />
      <line x1="18" y1="9.5" x2="18" y2="9.5" />
      <line x1="7.5" y1="14.5" x2="16.5" y2="14.5" />
    </Icon>
  );
}

/**
 * SIDE-04: 블랙마킹 사이드바 도킹 상태(핀이 꽂힌 모양) — 눌러서 플로팅으로.
 * 이전엔 머리(플래그 모양)+바늘(선)을 기하학적 바운딩박스 중심으로만
 * 맞췄는데, 머리 쪽이 잉크(획 길이)가 훨씬 많아 여전히 위로 쏠려 보인다는
 * 재현 보고가 있었다 — 원(머리)의 둘레와 바늘 길이를 각각 "잉크량"으로
 * 놓고 무게중심이 정중앙(12)에 오도록 좌표를 다시 계산해 그렸다. 툴바
 * 아이콘(18px)보다 약간 작게 기본 14px로 렌더링해, 이 버튼이 있는 사이드바
 * 이름표시줄이 텍스트만 있는 다른 이름표시줄보다 두꺼워지지 않게 한다.
 */
export function PinIcon(props: IconProps) {
  return (
    <Icon width={14} height={14} {...props}>
      <circle cx="12" cy="10.3" r="4" />
      <line x1="12" y1="14.3" x2="12" y2="21.3" />
    </Icon>
  );
}

/** SIDE-04: 블랙마킹 사이드바 플로팅 상태(핀이 풀린 모양) — 눌러서 도킹으로. */
export function PinOffIcon(props: IconProps) {
  return (
    <Icon width={14} height={14} {...props}>
      <circle cx="12" cy="10.3" r="4" />
      <line x1="12" y1="14.3" x2="12" y2="21.3" />
      <line x1="4" y1="4" x2="20" y2="20" />
    </Icon>
  );
}
