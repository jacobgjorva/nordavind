import { useMemo } from "react";
import type { QueryResult, WidgetSpec } from "../../lib/api";
import { distinctValues, type ControlState } from "./controlsLogic";
import styles from "./WidgetView.module.css";

// WidgetControls rendrer søk/filter/sort/gruppe over kortet. Virker på de rå
// (ufiltrerte) radene — distinkte filterverdier hentes derfra.
export function WidgetControls({
  spec,
  data,
  state,
  onChange,
}: {
  spec: WidgetSpec;
  data: QueryResult;
  state: ControlState;
  onChange: (next: ControlState) => void;
}) {
  const filterOptions = useMemo(
    () =>
      (spec.filters ?? []).map((f) => ({
        ...f,
        values: distinctValues(data, f.column),
      })),
    [spec.filters, data]
  );

  const groupable = !!spec.group && data.columns.includes(spec.group);

  return (
    <div className={styles.controls}>
      {spec.search && (
        <input
          className={styles.ctrlSearch}
          type="search"
          placeholder="Søk …"
          value={state.search}
          onChange={(e) => onChange({ ...state, search: e.target.value })}
        />
      )}

      {filterOptions.map((f) => (
        <label key={f.column} className={styles.ctrlField}>
          <span className={styles.ctrlLabel}>{f.label ?? f.column}</span>
          <select
            className={styles.ctrlSelect}
            value={state.filters[f.column] ?? ""}
            onChange={(e) =>
              onChange({
                ...state,
                filters: { ...state.filters, [f.column]: e.target.value },
              })
            }
          >
            <option value="">Alle</option>
            {f.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ))}

      {spec.sort && spec.sort.length > 0 && (
        <label className={styles.ctrlField}>
          <span className={styles.ctrlLabel}>Sortér</span>
          <select
            className={styles.ctrlSelect}
            value={state.sort}
            onChange={(e) => onChange({ ...state, sort: Number(e.target.value) })}
          >
            {spec.sort.map((s, i) => (
              <option key={i} value={i}>
                {s.label ?? s.column}
              </option>
            ))}
          </select>
        </label>
      )}

      {groupable && (
        <label className={styles.ctrlField}>
          <span className={styles.ctrlLabel}>Grupper</span>
          <select
            className={styles.ctrlSelect}
            value={state.group}
            onChange={(e) => onChange({ ...state, group: e.target.value })}
          >
            <option value="">Nei</option>
            <option value={spec.group}>{spec.group}</option>
          </select>
        </label>
      )}
    </div>
  );
}
