import { Logo } from "../../ui/Logo";
import styles from "./LogoLab.module.css";

export function LogoLab() {
  return (
    <div className={styles.page}>
      <Logo size={220} flutter />
    </div>
  );
}
