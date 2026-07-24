import { useState } from "react";
import type { AuthUser } from "../../lib/api";
import styles from "./Settings.module.css";

// Settings er redusert til kun General (profil/preferanser) — all styring
// (forbruk, kunnskap, dokumenter, ansatte, tilganger, tilkoblinger, graf,
// kvote) skjer nå som kommandoer i chatten sammen med agenten.
export function Settings({ user, onClose }: { user: AuthUser; onClose?: () => void }) {
  const [name, setName] = useState("Ola Nordmann");
  const [email, setEmail] = useState(user.email);
  const [language, setLanguage] = useState("nb");
  const [theme, setTheme] = useState("system");

  return (
    <div className={styles.wrap}>
      {onClose && (
        <button className={styles.close} onClick={onClose} aria-label="Lukk">
          ✕
        </button>
      )}
      <nav className={styles.nav}>
        <div className={styles.navHead}>Settings</div>
        <button type="button" className={`${styles.navItem} ${styles.navItemActive}`}>
          General
        </button>
      </nav>

      <div className={styles.panel}>
        <div className={styles.content}>
          <div className={styles.section}>
            <div className={styles.sectionMeta}>
              <div className={styles.sectionTitle}>Profil</div>
              <div className={styles.sectionDesc}>
                Navnet og e-posten som vises på kontoen din.
              </div>
            </div>

            <div className={styles.fields}>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Navn</span>
                  <input
                    className={styles.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>E-post</span>
                  <input
                    className={styles.input}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              </div>
            </div>
          </div>

          <div className={styles.section}>
            <div className={styles.sectionMeta}>
              <div className={styles.sectionTitle}>Preferanser</div>
              <div className={styles.sectionDesc}>Språk og utseende.</div>
            </div>

            <div className={styles.fields}>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Språk</span>
                  <select
                    className={styles.input}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="nb">Norsk (bokmål)</option>
                    <option value="en">English</option>
                  </select>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Tema</span>
                  <select
                    className={styles.input}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="system">Følg systemet</option>
                    <option value="dark">Mørkt</option>
                    <option value="light">Lyst</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
