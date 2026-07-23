// Delt avatar-logikk (mail-kortet, widget-deling m.m.): deterministisk farge
// fra adressen + initialer fra navn/adresse.
export const AVATAR_COLORS: [string, string][] = [
  ["#E6F2FF", "#2e6bad"],
  ["#CDFBFB", "#1f8a8a"],
  ["#D8FDE4", "#2f8a54"],
  ["#E8FDCA", "#5f7d1e"],
  ["#FDF2B2", "#94711a"],
  ["#FFE6E8", "#b0505a"],
  ["#EEEAFF", "#6152b3"],
];

export function avatarColor(addr: string): [string, string] {
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string, address?: string): string {
  const src = (name || address || "").trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
