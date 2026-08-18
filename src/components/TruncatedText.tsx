import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeTooltipAlign, type TooltipAlign } from "../utils/tooltipPosition";
import "./TruncatedText.css";

interface TruncatedTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (event: React.MouseEvent<HTMLSpanElement>) => void;
  onMouseDown?: (event: React.MouseEvent<HTMLSpanElement>) => void;
}

interface TooltipState {
  align: TooltipAlign;
  top: number;
  /** align=left면 앵커 왼쪽 x, align=right면 undefined. */
  left?: number;
  /** align=right면 뷰포트 오른쪽 여백(window.innerWidth - anchorRight). */
  right?: number;
}

/**
 * 좁은 폭에서 말줄임(…) 처리되는 텍스트 + 툴팁(BM-04, LIST-07/UI-01에서도
 * 재사용). 실제로 잘렸을 때만(scrollWidth > clientWidth) 툴팁을 띄운다.
 *
 * UI-04(B-4): 툴팁은 **document.body로 portal**해 `position: fixed`로 띄운다 —
 * 예전엔 `.truncated-text`(overflow: hidden)의 자식이라 그 부모와 목록 스크롤
 * 컨테이너의 overflow에 **잘려 보이지 않았다**(검출목록 '내용' 셀에서 재현).
 * 앵커의 getBoundingClientRect로 좌표를 잡고, 창 오른쪽에 치우쳤으면 오른쪽
 * 경계에 맞춰(왼쪽으로 자람) 화면 밖으로 안 잘리게 한다(§6.2/§7.1). hover 즉시
 * (지연 없이) 뜨고 포커스와 무관하다(mouseenter 기반).
 */
export function TruncatedText({ text, className, style, onClick, onMouseDown }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<TooltipState | null>(null);

  function handleMouseEnter() {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    const rect = el.getBoundingClientRect();
    const align = computeTooltipAlign(rect.left, window.innerWidth);
    setTip({
      align,
      top: rect.bottom + 4,
      left: align === "left" ? rect.left : undefined,
      right: align === "right" ? window.innerWidth - rect.right : undefined,
    });
  }

  function handleMouseLeave() {
    setTip(null);
  }

  return (
    <span
      ref={ref}
      className={`truncated-text${className ? ` ${className}` : ""}`}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      {text}
      {tip &&
        createPortal(
          <span
            className="truncated-text-tooltip"
            style={{ top: tip.top, left: tip.left, right: tip.right }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
