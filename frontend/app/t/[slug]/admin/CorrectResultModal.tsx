"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, Modal, Notice, Select } from "../../../components/ui";
import { api } from "../../../lib/api";
import { completeScore } from "../../../lib/matchControls";
import type { Game, Match, ResultCorrection } from "../../../lib/types";
import { useAdmin } from "./AdminContext";

export function CorrectResultModal({ match, onClose }: { match: Match; onClose: () => void }) {
  const { act } = useAdmin();
  const [winner, setWinner] = useState<"" | "a" | "b">(match.status === "walkover" ? match.winner ?? "" : "");
  const [scores, setScores] = useState<[string, string][]>(() => Array.from(
    { length: match.rules.gamesToWin * 2 - 1 },
    (_, i) => match.games[i] ? [String(match.games[i][0]), String(match.games[i][1])] : ["", ""],
  ));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const base = { version: match.version, reason: reason.trim() };
    let body: ResultCorrection;
    if (winner) {
      body = { ...base, action: "walkover", walkoverWinner: winner };
    } else {
      const games: Game[] = [];
      for (const [i, [a, b]] of scores.entries()) {
        if (!a && !b) continue;
        if (!a || !b || games.length !== i || !/^\d+$/.test(a) || !/^\d+$/.test(b)) {
          setError("Nhập đủ điểm hai bên theo thứ tự game, không để trống game ở giữa.");
          return;
        }
        games.push([Number(a), Number(b)]);
      }
      if (!completeScore(games, match.rules)) {
        setError("Tỉ số chưa hợp lệ hoặc chưa đủ số game thắng theo luật của trận.");
        return;
      }
      body = { ...base, action: "finish", games };
    }
    setError(null);
    setSaving(true);
    try {
      await api(`/matches/${match.id}/result`, { method: "PUT", body });
      await act(async () => undefined, "Đã sửa kết quả và lưu lý do vào nhật ký");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Sửa kết quả đã chốt">
      <form className="space-y-4" onSubmit={submit}>
        {error && <Notice kind="error">{error}</Notice>}
        <p className="text-sm font-semibold">{match.a?.name} – {match.b?.name}</p>
        <p className="text-sm text-slate-600">Trận không mở lại và không chiếm sân. Nhật ký BTC lưu kết quả trước, sau và lý do sửa.</p>
        <Select label="Cách xác nhận kết quả" value={winner} onChange={(e) => setWinner(e.target.value as typeof winner)}>
          <option value="">Tính theo tỉ số</option>
          <option value="a">W.O. — {match.a?.name} thắng</option>
          <option value="b">W.O. — {match.b?.name} thắng</option>
        </Select>
        {!winner && scores.map((game, i) => (
          <fieldset key={i} className="grid grid-cols-2 gap-3">
            <legend className="mb-1 text-sm font-semibold">Game {i + 1}</legend>
            {game.map((value, side) => (
              <Field key={side} label={side === 0 ? "Điểm bên A" : "Điểm bên B"}
                type="number" min={0} max={match.rules.maxPoints} inputMode="numeric" value={value}
                onChange={(e) => setScores(scores.map((g, j) => i !== j ? g : side === 0 ? [e.target.value, g[1]] : [g[0], e.target.value]))} />
            ))}
          </fieldset>
        ))}
        <Field label="Lý do sửa kết quả" required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)}
          hint="Không ghi thông tin liên hệ hay mã số sinh viên." />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={reason.trim().length < 3}>Lưu kết quả</Button>
        </div>
      </form>
    </Modal>
  );
}
