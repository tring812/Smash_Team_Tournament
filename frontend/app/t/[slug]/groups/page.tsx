import { Suspense } from "react";
import { CardSkeleton } from "../../../components/ui";
import { TournamentHub } from "../TournamentHub";

/** Trang giải công khai — tab "groups" (cùng khung với các tab khác, xem TournamentHub). */
export default function Page() {
  return <Suspense fallback={<CardSkeleton rows={4} />}><TournamentHub tab="groups" /></Suspense>;
}
