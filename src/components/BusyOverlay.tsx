import { useAppStore } from "../store/appStore";
import "./BusyOverlay.css";

/**
 * UI-PROGRESS: 저장(SAVE-03)/내보내기(IO-01) 처리 중 전역 입력 차단 오버레이.
 * busy인 동안 앱 본체(툴바·뷰어·목록·사이드바) 위를 덮어 **모든 마우스 조작을
 * 흡수**한다(키보드는 App.tsx의 window capture 게이트가 담당). 중단 버튼은
 * 상태바(StatusBar)가 이 오버레이보다 위 스택에 있어 그대로 클릭된다.
 *
 * 오버레이는 상태바 영역까지 덮지만, 상태바가 자체 불투명 배경 + 더 높은 z-index로
 * 그 위에 그려지므로 중단 버튼은 가려지지 않고 클릭 가능하다.
 */
export function BusyOverlay() {
  const busy = useAppStore((s) => s.busy);
  if (!busy) return null;
  // 오버레이 자체가 pointer 이벤트를 흡수한다. contextmenu(우클릭 메뉴)도 막는다.
  return <div className="busy-overlay" onContextMenu={(e) => e.preventDefault()} aria-hidden="true" />;
}
