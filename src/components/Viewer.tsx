import { useEffect, useRef, useState } from "react";
import { useAppStore } from "../store/appStore";
import { ko } from "../i18n/ko";
import { zoomIn, zoomOut } from "../services/pdfService";
import { accumulateWheelZoom } from "../utils/wheelZoom";
import { PaginatedView } from "./PaginatedView";
import { ScrollView } from "./ScrollView";
import "./Viewer.css";

// 뷰어 모드별 실제 콘텐츠(PaginatedView 등)가 §8.1 방향키 처리를 위해
// 자체 tabIndex를 갖는데, Tab/앱 기본 포커스가 겨냥하는 대상은 바깥
// wrapper(data-focus-region="viewer")다. 바깥에 포커스가 "머물러 있는 채로"
// 안쪽 인터랙티브 자식이 새로 생기면(예: 시작 시 뷰어에 기본 포커스를 준
// 상태에서 문서를 열어 PaginatedView가 처음 마운트되는 경우) 안쪽으로
// 넘겨줄 대상 자체가 실제로 반드시 있게 되는 시점에서 넘겨줘야 한다.
//
// 보기 모드 전환(페이지네이션↔연속 스크롤)도 같은 문제를 겪는다 — 이번엔
// 반대 방향으로: 안쪽 자식(예: .paginated-view)이 실제로 DOM 포커스를 갖고
// 있는 도중에 보기 모드가 바뀌면 그 자식이 통째로 unmount되는데, 브라우저는
// 포커스가 사라진 요소의 대체 대상으로 wrapper(조상)를 골라주지 않고
// document.body로 떨어뜨린다. 그러면 이 함수의 "wrapper 자신이 포커스"
// 조건에 안 걸려 방향키를 받아줄 곳이 아예 없어진다(사용자 재현: "스크롤
// 모드 전환 후에는 항상 포커스가 상실됨"). body가 활성 요소인 경우도
// 함께 잡아 새로 마운트된 안쪽 자식으로 넘겨준다.
function redirectFocusToInnerChild(wrapper: HTMLDivElement | null): void {
  if (!wrapper) return;
  const active = window.document.activeElement;
  if (active !== wrapper && active !== window.document.body) return;
  wrapper.querySelector<HTMLElement>(":scope > [tabindex]")?.focus();
}

// §7.4/§8.1: 블랙마킹 목록은 뷰어와 하나의 키보드 도메인이라, 목록 행을
// 클릭해 실제 DOM 포커스가 그리로 옮겨가도(수정·제외 등을 위해) 뷰어
// 포커스 테두리는 계속 켜져 있어야 한다. 그런데 목록은 뷰어의 DOM
// 자손이 아니라 형제라서 CSS `:focus-within`(같은 트리 안에서만 동작)만
// 으로는 표현할 수 없다 — 그래서 JS로 "포커스가 이 도메인(뷰어 또는
// 블랙마킹 목록) 안에 있는지"를 직접 추적한다.
function isViewerDomainFocused(): boolean {
  const active = window.document.activeElement;
  if (!active) return false;
  return !!(active.closest('[data-focus-region="viewer"]') || active.closest('[data-sidebar-id="redaction"]'));
}

// SPEC §6.1 뷰어. 페이지네이션/연속 스크롤 두 보기 모드를 전환한다(PDF-05).
// SIDE-05(§7.4): 포커스 시 테두리 강조 — 다른 곳(북마크 등)처럼 `.focus-region`
// 클래스의 outline으로 하지 않고 별도 오버레이 엘리먼트(`.viewer-focus-overlay`)를
// 쓴다. `.viewer`를 리사이징하면 페이지 비트맵이 뷰어 가장자리까지 꽉 차는
// 크기가 되는 경우가 있는데, outline(음수 offset이라 border-box 안쪽에
// 그려짐)의 페인트 순서가 웹뷰 구현에 따라 페이지 이미지 아래로 깔려버려
// 안 보이는 문제가 있었다(사용자 리사이즈 재현 보고). 오버레이는 position:
// absolute + z-index:auto라 CSS 스태킹 규칙상 non-positioned 콘텐츠(페이지
// 이미지 포함) 위에 그려지는 게 보장된다.
export function Viewer() {
  const document = useAppStore((s) => s.document);
  const renderedPage = useAppStore((s) => s.renderedPage);
  const viewMode = useAppStore((s) => s.viewMode);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const showContent = Boolean(document) && (viewMode !== "paginated" || Boolean(renderedPage));
  const [domainFocused, setDomainFocused] = useState(false);

  // 바깥이 이미 포커스된 채로(예: 앱 시작 시 기본 포커스) 안쪽 콘텐츠가
  // placeholder → 실제 뷰(PaginatedView/ScrollView)로 바뀌는 경우, 포커스
  // 자체는 아무 이벤트 없이(전환이 아니라 그대로 유지된 것이므로) 그대로
  // 바깥에 머물러 있다 — onFocus 핸들러가 못 잡는 케이스라 별도로 처리.
  useEffect(() => {
    redirectFocusToInnerChild(wrapperRef.current);
  }, [showContent, viewMode]);

  // 뷰어(블랙마킹 목록 포함) 도메인 포커스 테두리 — isViewerDomainFocused
  // 설명 참고. focusin/focusout 둘 다 들어야 한다: focusin만으로는 포커스가
  // 아예 사라지는 경우(예: blur 후 아무 데도 안 감)를 못 잡는다.
  useEffect(() => {
    function update() {
      setDomainFocused(isViewerDomainFocused());
    }
    window.addEventListener("focusin", update);
    window.addEventListener("focusout", update);
    return () => {
      window.removeEventListener("focusin", update);
      window.removeEventListener("focusout", update);
    };
  }, []);

  // 바깥이 "직접"(자식에게서 버블된 게 아니라) 포커스를 받는 일반적인
  // 경우(Tab 복귀 등)를 위한 핸들러 — 이미 있는 안쪽 자식으로 즉시 넘긴다.
  function handleFocus(event: React.FocusEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    redirectFocusToInnerChild(event.currentTarget);
  }

  // B-2(DIST-04): 페이지 이미지 위에서 뜨는 OS/웹뷰 컨텍스트 메뉴(맥의 "연락처에
  // 추가"·"이미지 저장" 등)를 막는다 — 블랙마킹 도구라 뷰어에서 우클릭 메뉴가
  // 필요 없고, 원문 이미지를 저장/복사하는 경로가 노출되면 안 된다.
  // B-3(DIST-05): 페이지 이미지 드래그가 스냅샷 드래그(바탕화면으로 끌어 캡처
  // 이미지 생성)로 바뀌는 것을 막는다 — 뷰어 안의 모든 drag 시작을 차단한다.
  // (개별 <img draggable={false}> + CSS -webkit-user-drag:none와 이중 방어.)
  function blockDefault(event: React.SyntheticEvent) {
    event.preventDefault();
  }

  // §8.1 $확대/축소(cmd-트랙패드 두손가락 / 트랙패드 벌리기 / cmd-휠). 트랙패드
  // 핀치는 브라우저가 ctrlKey를 얹은 wheel 이벤트로 합성해 보낸다(실제 물리
  // Ctrl 키와 무관) — OS 모디파이어 자동 매핑(§8) 대상인 cmd(맥)/ctrl(윈도)
  // 명시 휠도 같이 받는다. 두 view 모드(PaginatedView/ScrollView) 모두 여기
  // 하나로 처리한다. React의 onWheel은 기본적으로 passive로 등록돼
  // preventDefault()가 안 먹으므로(브라우저 자체 확대/스크롤이 계속 발생),
  // 네이티브 리스너를 { passive: false }로 직접 붙인다.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    let accumulated = 0;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();

      const result = accumulateWheelZoom(accumulated, event.deltaY);
      accumulated = result.remaining;
      for (let i = 0; i < Math.abs(result.steps); i += 1) {
        void (result.steps > 0 ? zoomIn() : zoomOut());
      }
    }

    wrapper.addEventListener("wheel", handleWheel, { passive: false });
    return () => wrapper.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`viewer${domainFocused ? " viewer-domain-focused" : ""}`}
      role="main"
      tabIndex={0}
      data-focus-region="viewer"
      onFocus={handleFocus}
      onContextMenu={blockDefault}
      onDragStart={blockDefault}
    >
      {showContent ? (
        viewMode === "paginated" ? (
          <PaginatedView />
        ) : (
          <ScrollView />
        )
      ) : (
        <p className="viewer-placeholder">{ko.viewer.empty}</p>
      )}
      <div className="viewer-focus-overlay" aria-hidden="true" />
    </div>
  );
}
