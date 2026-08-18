import { useAppStore } from "../store/appStore";
import "./DragDropOverlay.css";

/** UX 편의: 파일을 앱 위로 드래그하는 동안 놓을 수 있다는 안내를 보여준다. */
export function DragDropOverlay() {
  const dragOverActive = useAppStore((s) => s.dragOverActive);
  if (!dragOverActive) return null;

  return (
    <div className="drag-drop-overlay">
      <p className="drag-drop-overlay-message">여기에 놓아서 PDF 열기</p>
    </div>
  );
}
