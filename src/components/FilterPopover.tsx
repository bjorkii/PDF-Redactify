import { useEffect, useRef, type ReactNode } from "react";
import "./FilterPopover.css";

interface FilterPopoverProps {
  onClose: () => void;
  children: ReactNode;
}

/**
 * LIST-08: 목록 헤더 필터 트리거 아래에 뜨는 작은 팝오버 껍데기. 바깥을
 * 클릭하면 닫힌다(pointerdown 기준 — click보다 먼저 잡아야 헤더 셀의
 * 정렬 클릭과 겹치지 않는다). 안쪽 클릭은 stopPropagation으로 막아, 헤더
 * 셀의 정렬 onClick이 팝오버 조작 중에 잘못 발동하지 않게 한다.
 */
export function FilterPopover({ onClose, children }: FilterPopoverProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    }
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  return (
    <div ref={ref} className="filter-popover" onClick={(event) => event.stopPropagation()}>
      {children}
    </div>
  );
}
