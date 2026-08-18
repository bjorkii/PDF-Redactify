import { useRef } from "react";
import { useAppStore } from "../store/appStore";
import { computeDraggedMargins, EMPTY_MARGINS, type ExclusionEdge } from "../utils/exclusionZone";
import "./ExclusionZoneOverlay.css";

interface ExclusionZoneOverlayProps {
  pageIndex: number;
  /** EDIT-14: 읽기전용(드래그 가이드 없이 바만) — bbox가 제외영역에 닿는 동안 잠깐 표시. */
  readOnly?: boolean;
}

/**
 * DET-07: 페이지 상/하/좌/우 가장자리에 드래그 가능한 가이드 바를 두고,
 * 안쪽으로 끌면 그 바깥쪽(회색 음영)이 자동검출 제외 영역이 된다.
 * PaginatedView에서 exclusionZoneEditMode가 켜져 있을 때만 렌더된다(연속
 * 스크롤 모드는 EDIT-01의 bbox 드래그 생성과 같은 이유로 범위 밖 — 여러
 * 페이지가 동시에 마운트돼 좌표 처리가 복잡함).
 */
export function ExclusionZoneOverlay({ pageIndex, readOnly = false }: ExclusionZoneOverlayProps) {
  const exclusionZones = useAppStore((s) => s.exclusionZones);
  const setPageExclusionMargins = useAppStore((s) => s.setPageExclusionMargins);
  const overlayRef = useRef<HTMLDivElement>(null);

  const margins = exclusionZones.find((z) => z.pageIndex === pageIndex)?.margins ?? EMPTY_MARGINS;

  // 드래그 시작 시점의 margins를 그대로 클로저로 들고 간다 — 매 pointermove마다
  // 커서의 절대 위치로부터 그 축의 새 마진값을 다시 계산하므로(델타 누적이
  // 아님) 드래그 중인 축 자체는 이 클로저가 "낡아도" 문제없고, 나머지 3개
  // 축은 이 드래그 동안 안 바뀌므로 시작 시점 값 그대로가 맞다
  // (RedactionOverlay의 리사이즈 핸들 드래그와 동일한 패턴).
  function handleGuidePointerDown(edge: ExclusionEdge, event: React.PointerEvent) {
    event.preventDefault();
    event.stopPropagation();

    function handleMove(moveEvent: PointerEvent) {
      const rect = overlayRef.current!.getBoundingClientRect();
      const relative =
        edge === "top" || edge === "bottom"
          ? (moveEvent.clientY - rect.top) / rect.height
          : (moveEvent.clientX - rect.left) / rect.width;
      setPageExclusionMargins(pageIndex, computeDraggedMargins(margins, edge, relative));
    }

    function handleUp() {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return (
    <div
      ref={overlayRef}
      className={`exclusion-zone-overlay${readOnly ? " exclusion-zone-overlay-contact" : ""}`}
    >
      {margins.top > 0 && (
        <div className="exclusion-zone-band exclusion-zone-band-top" style={{ height: `${margins.top * 100}%` }} />
      )}
      {margins.bottom > 0 && (
        <div
          className="exclusion-zone-band exclusion-zone-band-bottom"
          style={{ height: `${margins.bottom * 100}%` }}
        />
      )}
      {margins.left > 0 && (
        <div className="exclusion-zone-band exclusion-zone-band-left" style={{ width: `${margins.left * 100}%` }} />
      )}
      {margins.right > 0 && (
        <div
          className="exclusion-zone-band exclusion-zone-band-right"
          style={{ width: `${margins.right * 100}%` }}
        />
      )}

      {/* 넷 다 top/left로만 위치를 잡는다(bottom/right 마진은 1-마진으로
          환산) — CSS의 -5px 마진 보정을 top/left 한 방향으로만 다루면
          되도록 통일한다. readOnly(접촉 표시)일 때는 드래그 가이드를 뺀다. */}
      {!readOnly && (
        <>
          <div
            className="exclusion-zone-guide exclusion-zone-guide-horizontal"
            style={{ top: `${margins.top * 100}%` }}
            onPointerDown={(event) => handleGuidePointerDown("top", event)}
          />
          <div
            className="exclusion-zone-guide exclusion-zone-guide-horizontal"
            style={{ top: `${(1 - margins.bottom) * 100}%` }}
            onPointerDown={(event) => handleGuidePointerDown("bottom", event)}
          />
          <div
            className="exclusion-zone-guide exclusion-zone-guide-vertical"
            style={{ left: `${margins.left * 100}%` }}
            onPointerDown={(event) => handleGuidePointerDown("left", event)}
          />
          <div
            className="exclusion-zone-guide exclusion-zone-guide-vertical"
            style={{ left: `${(1 - margins.right) * 100}%` }}
            onPointerDown={(event) => handleGuidePointerDown("right", event)}
          />
        </>
      )}
    </div>
  );
}
