import { useEffect, useState } from "react";
import { useAppStore } from "../store/appStore";
import { goToPage } from "../services/pdfService";
import "./PageIndicator.css";

// SPEC §7.1 툴바의 [현 페이지(직접 입력) / 전체 페이지].
export function PageIndicator() {
  const document = useAppStore((s) => s.document);
  const currentPageIndex = useAppStore((s) => s.currentPageIndex);
  const [inputValue, setInputValue] = useState(String(currentPageIndex + 1));

  useEffect(() => {
    setInputValue(String(currentPageIndex + 1));
  }, [currentPageIndex]);

  if (!document) return null;

  function commit() {
    const parsed = Number.parseInt(inputValue, 10);
    if (Number.isFinite(parsed)) {
      void goToPage(parsed - 1);
    } else {
      setInputValue(String(currentPageIndex + 1));
    }
  }

  return (
    <span className="page-indicator">
      <input
        type="number"
        min={1}
        max={document.pageCount}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        aria-label="현재 페이지"
      />
      <span className="page-indicator-total"> / {document.pageCount}</span>
    </span>
  );
}
