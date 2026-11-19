export type Role = "admin" | "user";
export type MatchStatus = "pending" | "scheduled" | "live" | "finished" | "walkover" | "bye" | "cancelled";
export type Game = [number, number];

export interface Viewer {
  id: string;
  username: string | null;
  full_name: string;
  role: Role;
}

/** Tài khoản trong trang quản lý (chỉ admin hệ thống thấy). */
export interface Account extends Viewer {
  disabled_at: string | null;
  last_login_at: string | null;
  created_at: string;
  has_password: boolean;
}

export interface TournamentSummary {
  id: string;
  slug: string;
  name: string;
  venue: string;
  starts_at: string;
  status: "draft" | "published" | "ongoing" | "completed";
}

export interface Category {
  id: string;
  code: string;
  name: string;
  is_doubles: boolean;
  group_count: number;
  advance_per_group: number;
  points_to_win: number;
  max_points: number;
  games_to_win: number;
  /** Luật riêng theo vòng: knockout["1"] = chung kết, "2" = bán kết…, "*" = mọi vòng loại. */
  round_rules: { group?: ScoringRules; knockout?: Record<string, ScoringRules> };
  stage: "setup" | "groups" | "knockout" | "completed";
  entry_count: number;
}

export interface Tournament extends TournamentSummary {
  courts: number;
  slot_minutes: number;
  viewerRole: "admin" | "organizer" | "referee" | null;
  categories: Category[];
}

export interface Side {
  id: string;
  name: string;
  club: string;
  disqualified: boolean;
}

export interface ScoringRules {
  pointsToWin: number;
  maxPoints: number;
  gamesToWin: number;
}

export interface Match {
  id: string;
  tournamentId: string;
  category: { id: string; code: string; name: string };
  stage: "group" | "knockout";
  groupName: string | null;
  round: number;
  /** "Lượt 2" (vòng bảng) hoặc "Bán kết", "Chung kết"… (loại trực tiếp) */
  roundLabel: string;
  position: number;
  status: MatchStatus;
  games: Game[];
  court: number | null;
  scheduledAt: string | null;
  /** BTC đã gọi vào sân, chưa có điểm (null khi chưa gọi hoặc đã đánh). */
  calledAt: string | null;
  /** Lúc được gọi vào sân — giữ cả khi đang đánh (tính thời gian chiếm sân). */
  courtSince: string | null;
  version: number;
  updatedAt: string;
  referee: { id: string; name: string } | null;
  a: Side | null;
  b: Side | null;
  winner: "a" | "b" | null;
  rules: ScoringRules;
}

export interface StandingRow {
  entryId: string;
  rank: number | null;
  played: number;
  won: number;
  lost: number;
  gamesFor: number;
  gamesAgainst: number;
  pointsFor: number;
  pointsAgainst: number;
  name: string;
  club: string;
  disqualified: boolean;
  dqReason: string | null;
}

export interface GroupStanding {
  groupId: string;
  name: string;
  complete: boolean;
  standings: StandingRow[];
}

export interface Bracket {
  rounds: { round: number; label: string; matches: Match[] }[];
}

export interface Entry {
  id: string;
  name: string;
  player1_name: string;
  player2_name: string | null;
  club: string;
  draw_lot: number | null;
  disqualified_at: string | null;
  dq_reason: string | null;
  group_id: string | null;
  group_name: string | null;
  has_played: boolean;
  /** Hồ sơ VĐV (id — không phải dữ liệu cá nhân). */
  player1_athlete_id: string | null;
  player2_athlete_id: string | null;
}

/** Hồ sơ VĐV (CHỈ BTC — có MSSV/SĐT/email). */
export interface Athlete {
  id: string;
  full_name: string;
  student_id: string | null;
  phone: string | null;
  email: string | null;
  club: string;
  created_at: string;
  entries: { entryId: string; categoryCode: string; entryName: string; disqualified: boolean }[];
}

export interface TournamentEvent {
  id: string;
  action: "draw" | "redraw" | "disqualify" | "reinstate" | "swap" | "edit_entry" | "schedule"
    | "category_create" | "category_update" | "category_delete"
    | "call_match" | "uncall_match" | "move_match" | "court_referee" | "athlete_update" | "rules_update";
  details: Record<string, unknown>;
  created_at: string;
  actor: string;
  category_code: string | null;
}

export interface Staff {
  user_id: string;
  role: "organizer" | "referee";
  full_name: string;
}

/** Bảng điều phối sân (GET /tournaments/:id/courts). */
export interface CourtBoard {
  restMinutes: number;
  courts: { court: number; referee: { id: string; name: string } | null; current: Match | null; suggestionId: string | null }[];
  queue: { match: Match; busyWith: { name: string; court: number | null }[]; restingMinutes: number }[];
}
