import { HugeiconsIcon } from "@hugeicons/react";
import {
  AnonymousIcon,
  Csv01Icon,
  Doc01Icon,
  HtmlFile01Icon,
  LottiefilesIcon,
  Pdf01Icon,
  Svg01Icon,
  Txt01Icon,
  Xls01Icon,
  Zip01Icon,
} from "@hugeicons/core-free-icons";
import styles from "./FileTag.module.css";

// FileTag: ETT vedleggs-design for hele appen — composer-vedlegg og
// e-postvedlegg bruker samme komponent.

const FILE_ICONS: Record<string, typeof AnonymousIcon> = {
  pdf: Pdf01Icon,
  txt: Txt01Icon,
  md: Txt01Icon,
  svg: Svg01Icon,
  csv: Csv01Icon,
  xls: Xls01Icon,
  xlsx: Xls01Icon,
  html: HtmlFile01Icon,
  htm: HtmlFile01Icon,
  doc: Doc01Icon,
  docx: Doc01Icon,
  zip: Zip01Icon,
};

const FILE_TAG_COLORS: [string, string][] = [
  ["#E6F2FF", "#2e6bad"],
  ["#CDFBFB", "#1f8a8a"],
  ["#D8FDE4", "#2f8a54"],
  ["#E8FDCA", "#5f7d1e"],
  ["#FDF2B2", "#94711a"],
  ["#FFE6E8", "#b0505a"],
  ["#EEEAFF", "#6152b3"],
];

export function fileIcon(name: string): typeof AnonymousIcon {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? LottiefilesIcon;
}

export function fileTagColor(name: string): [string, string] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  let h = 0;
  for (let i = 0; i < ext.length; i++) h = (h * 31 + ext.charCodeAt(i)) >>> 0;
  return FILE_TAG_COLORS[h % FILE_TAG_COLORS.length];
}

export function FileTag({
  name,
  meta,
  onClick,
  onRemove,
  title,
}: {
  name: string;
  meta?: string;
  onClick?: () => void;
  onRemove?: () => void;
  title?: string;
}) {
  const [bg, fg] = fileTagColor(name);
  const inner = (
    <>
      <span className={styles.iconBox} style={{ background: bg, color: fg }}>
        <HugeiconsIcon icon={fileIcon(name)} size={14} strokeWidth={2} />
      </span>
      <span className={styles.name}>{name}</span>
      {meta && <span className={styles.meta}>{meta}</span>}
      {onRemove && (
        <button
          className={styles.remove}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          aria-label={`Fjern ${name}`}
        >
          ×
        </button>
      )}
    </>
  );
  if (onClick) {
    return (
      <button className={`${styles.tag} ${styles.clickable}`} onClick={onClick} title={title}>
        {inner}
      </button>
    );
  }
  return <span className={styles.tag}>{inner}</span>;
}
