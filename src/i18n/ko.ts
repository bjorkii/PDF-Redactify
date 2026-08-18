// SPEC §9.3: UI는 한국어로 통일한다. Phase 1은 다국어 전환 없이 단일 로케일이므로
// 별도 i18n 프레임워크 없이 문자열을 이 파일 하나로 리소스화한다.
export const ko = {
  toolbar: {
    openFile: "파일 열기",
    detect: "민감정보 검출",
    bookmarkSidebar: "북마크 사이드바",
    redactionSidebar: "블랙마킹 목록 사이드바",
    addRedaction: "블랙마킹 추가",
    export: "내보내기",
    import: "가져오기",
    save: "저장",
    viewModePaginated: "페이지 보기",
    viewModeScroll: "연속 스크롤 보기",
    zoomOut: "축소",
    zoomIn: "확대",
    fitToPage: "전체보기",
    colorSettings: "색상 설정",
    shortcuts: "단축키",
    exclusionZoneEdit: "제외영역 설정",
    exclusionZoneEditOff: "제외영역 설정 끄기",
    exclusionZoneApplyAll: "모든 페이지에 적용",
  },
  viewer: {
    empty: "열린 PDF가 없습니다. 파일을 열어주세요.",
  },
  bookmarkSidebar: {
    title: "북마크",
    empty: "북마크가 없습니다.",
  },
  redactionSidebar: {
    title: "블랙마킹 목록",
    empty: "검출된 항목이 없습니다.",
    float: "플로팅으로 전환",
    dock: "도킹",
    delete: "삭제",
    deleteAll: "모두삭제",
    newItemPlaceholder: "사용자 추가",
  },
  statusBar: {
    ready: "준비됨",
    cancelDetection: "취소",
    // UI-PROGRESS: 저장/내보내기 진행률·중단·완료.
    saving: "저장 중…",
    exporting: "내보내는 중…",
    cancelOperation: "중단",
    remainingTime: "예상 잔여시간",
    calculating: "--:--",
    open: "열기",
  },
  /** §5.3 구분(category) 드롭박스 표시명. 순서가 그대로 드롭박스 옵션 순서. */
  redactionCategories: [
    { value: "RRN", label: "주민등록번호" },
    { value: "PhoneNumber", label: "전화번호" },
    { value: "FaxNumber", label: "팩스번호" },
    { value: "Passport", label: "여권번호" },
    { value: "Card", label: "신용카드" },
    { value: "BankAccount", label: "계좌번호" },
    { value: "Email", label: "이메일" },
    { value: "DateOfBirth", label: "생년월일" },
    { value: "Address", label: "주소" },
    { value: "Custom", label: "사용자 지정" },
  ],
} as const;
