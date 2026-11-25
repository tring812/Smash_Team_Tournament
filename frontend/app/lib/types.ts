export type Role = "admin" | "user";
export type MatchStatus = "pending" | "scheduled" | "live" | "finished" | "walkover" | "bye" | "cancelled";
export type Game = [number, number];

/** Yêu cầu bắt đầu trận trên sân đã được BTC gán. */
export interface StartMatchInput {
  version: number;
}

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
  /** Vai trò của người xem trong giải (chỉ có trong GET /tournaments khi đã đăng nhập). */
  my_role?: "organizer" | "referee" | null;
  /** Có nhiệm vụ trọng tài ở giải này (vai trò trọng tài, phụ trách sân, hoặc được gán trận). */
  is_referee?: boolean;
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
  /** Người xem được xoá giải (quản trị viên hoặc người tạo giải). */
  canDelete: boolean;
  categories: Category[];
}

/** Giải đã xoá còn khôi phục được (GET /deleted-tournaments). */
export interface DeletedTournament {
  id: string;
  slug: string;
  name: string;
  starts_at: string;
  deleted_at: string;
  /** Sau mốc này máy chủ xoá hẳn. */
  purge_at: string;
  deleted_by: string | null;
}

/** Một VĐV của đội: athleteId = hồ sơ VĐV theo giải (phân biệt người trùng tên), không kèm MSSV/SĐT. */
export interface PlayerRef {
  athleteId: string | null;
  name: string;
}

export interface Side {
  id: string;
  name: string;
  club: string;
  disqualified: boolean;
  players?: PlayerRef[];
}

/** Ô VĐV trên biên bản: đội a/b, VĐV 1/2 (đánh đơn chỉ có a1, b1). */
export type Slot = "a1" | "a2" | "b1" | "b2";

/** Một sự kiện biên bản diễn biến điểm (GET /matches/:id → rallies). */
export interface Rally {
  seq: number;
  game: number;
  /** start = chọn người giao/nhận · point = pha cầu · fix_server = sửa người giao · override = BTC sửa tay tỉ số */
  type: "start" | "point" | "fix_server" | "override";
  side: "a" | "b" | null;
  /** start / fix_server: người giao được chọn · point: người giao pha kế tiếp (máy chủ tính) */
  server: Slot | null;
  receiver: Slot | null;
  score: Game | null;
  games: Game[] | null;
  at: string;
}

export interface ScoringRules {
  pointsToWin: number;
  maxPoints: number;
  gamesToWin: number;
}

export interface Match {
  id: string;
  tournamentId: string;
  /** Trạng thái giải của trận — "completed" thì Bàn điểm khoá nhập điểm. */
  tournamentStatus: "draft" | "published" | "ongoing" | "completed";
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
  /** Chỉ có ở GET /matches/:id và các thao tác biên bản. */
  rallies?: Rally[];
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
  players?: PlayerRef[];
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

/**
 * `data` của sự kiện SSE `changed` (`GET /tournaments/:id/stream`): chỉ là phạm vi thay đổi, không mang dữ liệu trận.
 * `match`: chỉ tỉ số / biên bản / trọng tài của các trận này đổi; `structure`: tải lại toàn bộ.
 */
export type LiveChange = { kind: "match"; matchIds: string[] } | { kind: "structure" };

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
    | "call_match" | "uncall_match" | "move_match" | "court_referee" | "athlete_update" | "rules_update"
    | "referee_create" | "referee_update" | "referee_remove"
    | "rally_fix_server" | "rally_undo" | "score_confirm" | "start_match";
  details: Record<string, unknown>;
  created_at: string;
  actor: string;
  category_code: string | null;
}

/** Trọng tài của giải kèm tài khoản (GET /tournaments/:id/referees — chỉ BTC). */
export interface RefereeAccount {
  id: string;
  username: string | null;
  full_name: string;
  disabled_at: string | null;
  last_login_at: string | null;
  has_password: boolean;
  account_role: "admin" | "user";
  other_tournaments: number;
  matches_assigned: number;
  courts: number[];
  /** BTC này được sửa / khoá / đặt lại mật khẩu (tài khoản không làm ở giải của BTC khác). */
  can_manage: boolean;
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
