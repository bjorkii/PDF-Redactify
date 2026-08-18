import { useAppStore } from "../store/appStore";
import { buildShortcutSections, isKeySeparator } from "../utils/shortcutList";
import { osKeySymbols } from "../utils/platform";
import "./ShortcutsDialog.css";

/** KEY-01(§7.1/§8): 툴바 "단축키" 버튼으로 여는 전체 단축키 안내창. */
export function ShortcutsDialog() {
  const open = useAppStore((s) => s.shortcutsDialogOpen);
  const setOpen = useAppStore((s) => s.setShortcutsDialogOpen);
  if (!open) return null;

  const sections = buildShortcutSections(osKeySymbols());

  return (
    <div className="shortcuts-dialog-backdrop" onClick={() => setOpen(false)}>
      <div
        className="shortcuts-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="단축키"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shortcuts-dialog-header">
          <span>단축키</span>
          <button type="button" onClick={() => setOpen(false)}>
            닫기
          </button>
        </div>
        <div className="shortcuts-dialog-grid">
          {sections.map((section) => (
            <section key={section.title} className="shortcuts-dialog-section">
              <h3>{section.title}</h3>
              <ul>
                {section.rows.map((row) => (
                  <li key={row.action}>
                    <span className="shortcuts-dialog-action">{row.action}</span>
                    <span className="shortcuts-dialog-keys">
                      {row.keys.split(" ").map((token, i) =>
                        isKeySeparator(token) ? (
                          <span key={i} className="shortcuts-dialog-sep">
                            {token}
                          </span>
                        ) : (
                          <kbd key={i}>{token}</kbd>
                        ),
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="shortcuts-dialog-footnote">
          문자 단축키(C·z·x·a·f·s·d 등)는 한/영 입력 상태와 무관하게 동작합니다.
        </p>
      </div>
    </div>
  );
}
