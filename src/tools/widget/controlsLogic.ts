import type { QueryResult, WidgetSpec } from "../../lib/api";

// Kontroller agenten kan legge på en widget. Alt virker klient-side på de
// allerede hentede radene — visualene røres ikke.
export interface ControlState {
  search: string;
  filters: Record<string, string>; // kolonne -> valgt verdi ("" = alle)
  sort: number; // indeks i spec.sort (-1 = ingen/standard)
  group: string; // gruppe-kolonne ("" = ingen)
}

export function initialState(spec: WidgetSpec): ControlState {
  return {
    search: "",
    filters: {},
    sort: (spec.sort?.length ?? 0) > 0 ? 0 : -1,
    // Gruppering kollapser radene til én per gruppeverdi — det gir mening som
    // standard for bar/donut, men ødelegger tidsaksen på linje/sparkline.
    group:
      spec.group && (spec.type === "bar" || spec.type === "donut")
        ? spec.group
        : "",
  };
}

export function hasControls(spec: WidgetSpec): boolean {
  return !!(
    (spec.search && spec.search.length) ||
    (spec.filters && spec.filters.length) ||
    (spec.sort && spec.sort.length) ||
    spec.group
  );
}

function colIndex(data: QueryResult, name: string): number {
  return data.columns.indexOf(name);
}

// autoFilters utleder filtre fra dataene når specen ikke har noen: alle
// kategoriske kolonner (ikke-numeriske, 2-25 distinkte verdier, ikke y-verdien)
// får et nedtrekk. Gir filter-mulighet på samtlige widget-typer.
export function autoFilters(
  data: QueryResult,
  spec: WidgetSpec
): { column: string; label?: string }[] {
  const out: { column: string; label?: string }[] = [];
  for (let i = 0; i < data.columns.length; i++) {
    const col = data.columns[i];
    // y er verdien og x er selve aksen — filter på dem gir ikke mening.
    if (col === spec.y || col === spec.x) continue;
    const seen = new Set<string>();
    let numeric = true;
    let hasValue = false;
    for (const r of data.rows) {
      const v = r[i];
      if (v === null || v === undefined || String(v) === "") continue;
      hasValue = true;
      seen.add(String(v));
      if (typeof v !== "number" && isNaN(Number(String(v).replace(",", "."))))
        numeric = false;
      if (seen.size > 25) break;
    }
    if (!hasValue || numeric) continue;
    if (seen.size >= 2 && seen.size <= 25) out.push({ column: col });
  }
  return out;
}

// Distinkte verdier i en kolonne, sortert — til filter-nedtrekkene.
export function distinctValues(data: QueryResult, column: string): string[] {
  const i = colIndex(data, column);
  if (i < 0) return [];
  const seen = new Set<string>();
  for (const r of data.rows) {
    const v = r[i];
    if (v !== null && v !== undefined && String(v) !== "") seen.add(String(v));
  }
  return [...seen].sort((a, b) => a.localeCompare(b, "nb"));
}

// Summér y-kolonnen per unik verdi i gruppe-kolonnen. Andre kolonner tar første
// forekomst. Beholder kolonne-rekkefølgen.
function groupRows(data: QueryResult, spec: WidgetSpec, groupCol: string): QueryResult {
  const gi = colIndex(data, groupCol);
  if (gi < 0) return data;
  const yi = spec.y ? colIndex(data, spec.y) : -1;
  const buckets = new Map<string, (string | number | null)[]>();
  for (const r of data.rows) {
    const key = String(r[gi] ?? "");
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, [...r]);
    } else if (yi >= 0) {
      cur[yi] = (Number(cur[yi]) || 0) + (Number(r[yi]) || 0);
    }
  }
  return { columns: data.columns, rows: [...buckets.values()] };
}

// applyControls kjører filter -> søk -> gruppering -> sortering og gir nye rader.
export function applyControls(
  data: QueryResult,
  spec: WidgetSpec,
  state: ControlState
): QueryResult {
  let rows = data.rows;

  const activeFilters = Object.entries(state.filters).filter(([, v]) => v !== "");
  if (activeFilters.length) {
    rows = rows.filter((r) =>
      activeFilters.every(([col, val]) => {
        const i = colIndex(data, col);
        return i < 0 || String(r[i] ?? "") === val;
      })
    );
  }

  const q = state.search.trim().toLowerCase();
  if (q) {
    const cols = spec.search?.length
      ? spec.search.map((c) => colIndex(data, c)).filter((i) => i >= 0)
      : data.columns.map((_, i) => i);
    rows = rows.filter((r) =>
      cols.some((i) => String(r[i] ?? "").toLowerCase().includes(q))
    );
  }

  let out: QueryResult = { columns: data.columns, rows };

  // Linje/sparkline: gruppering kollapser tidsaksen — blokkeres uansett state.
  if (state.group && spec.type !== "line" && spec.type !== "sparkline") {
    out = groupRows(out, spec, state.group);
  }

  const s = state.sort >= 0 ? spec.sort?.[state.sort] : undefined;
  if (s) {
    const i = colIndex(out, s.column);
    if (i >= 0) {
      const dir = s.dir === "desc" ? -1 : 1;
      out = {
        columns: out.columns,
        rows: [...out.rows].sort((a, b) => {
          const av = a[i];
          const bv = b[i];
          const an = typeof av === "number" ? av : Number(av);
          const bn = typeof bv === "number" ? bv : Number(bv);
          if (!isNaN(an) && !isNaN(bn)) return (an - bn) * dir;
          return String(av ?? "").localeCompare(String(bv ?? ""), "nb") * dir;
        }),
      };
    }
  }

  return out;
}
