import { useState } from "react";
import { Usage } from "./Usage";
import { Admin } from "./Admin";
import { Connectors } from "./Connectors";
import type { AuthUser } from "../../lib/api";
import styles from "./Settings.module.css";

type Tab = "general" | "usage" | "connectors" | "admin";

const TABS: { key: Tab; label: string }[] = [
  { key: "general", label: "General" },
  { key: "usage", label: "Usage" },
  { key: "connectors", label: "Connectors" },
];

export function Settings({ user }: { user: AuthUser }) {
  const [tab, setTab] = useState<Tab>("general");
  const tabs =
    user.role === "admin"
      ? [...TABS, { key: "admin" as Tab, label: "Admin" }]
      : TABS;
  const [name, setName] = useState("Ola Nordmann");
  const [email, setEmail] = useState("ola@nordmann.no");
  const [language, setLanguage] = useState("nb");
  const [theme, setTheme] = useState("system");

  return (
    <div className={styles.wrap}>
      <nav className={styles.nav}>
        <div className={styles.navHead}>Settings</div>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`${styles.navItem} ${tab === t.key ? styles.navItemActive : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className={styles.panel}>
        {tab === "usage" ? (
          <Usage />
        ) : tab === "admin" ? (
          <Admin currentUserId={user.id} />
        ) : tab === "connectors" ? (
          <Connectors />
        ) : (
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
                    type="email"
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
              <div className={styles.sectionDesc}>
                Språk og utseende for grensesnittet.
              </div>
            </div>

            <div className={styles.fields}>
              <div className={styles.grid2}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Språk</span>
                  <select
                    className={styles.select}
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    <option value="nb">Norsk (bokmål)</option>
                    <option value="nn">Norsk (nynorsk)</option>
                    <option value="en">English</option>
                  </select>
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Tema</span>
                  <select
                    className={styles.select}
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
        )}
      </div>
    </div>
  );
}
