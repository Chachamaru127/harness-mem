// 記憶の削除（hard purge）の 2 段階の計画と実行の模型（2026-11-08）
//
// 出典:
//   Spec.md §Memory Lifecycle And Autonomous Forgetting（2026-11-08 時点）
//     - legal_hold / private / secret / sensitive は自動 archive・purge の候補にしない
//     - hard purge は archive 済みの行だけを対象にし、restore できる backup を要求する
//   memory-server/src/core/harness-mem-core.ts
//     - executeHardPurge: BEGIN IMMEDIATE の中で prepareHardPurgeManifest をやり直し、
//       要求の manifest_hash と一致しなければ拒否する（実行時の再計算）
//     - assertHardPurgeExecuteGates: manifest_hash、有効な plan、expires_at の一致、
//       期限切れの拒否を行う
//     - selectHardPurgeCandidateRows: archive 済みでない行と legal_hold の行を拒否する
//
// 抽象化: 行は 2 つ。状態は archived / legal hold / purged の 3 つ。
// 計画は「その時点の候補集合」を持ち、実行時に候補を計算し直すかどうかを
// RecomputeAtExecute で切り替える。false は、計画を作り直さない退行の負の対照。
module PurgePlan {
  pure val RecomputeAtExecute = true
  pure val Rows = Set(0, 1)

  var archived: int -> bool
  var held: int -> bool
  var purged: int -> bool
  var backedUp: bool
  var planned: int -> bool
  var hasPlan: bool
  var now: int
  var expiry: int

  // 実行時に消してよい行（実装の再計算に対応する）
  def candidates = Rows.filter(r => archived.get(r) and not(held.get(r)))

  // 実際に消す行。再計算する設計では候補、しない設計では計画時の集合
  def target =
    if (RecomputeAtExecute) candidates else Rows.filter(r => planned.get(r))

  action init = all {
    archived' = Rows.mapBy(_ => false),
    held' = Rows.mapBy(_ => false),
    purged' = Rows.mapBy(_ => false),
    backedUp' = false,
    planned' = Rows.mapBy(_ => false),
    hasPlan' = false,
    now' = 0,
    expiry' = 0,
  }

  // L1: 可逆な archive。legal_hold の行は対象外
  action Archive(r) = all {
    Rows.contains(r),
    not(archived.get(r)),
    not(purged.get(r)),
    not(held.get(r)),
    archived' = archived.set(r, true),
    held' = held, purged' = purged, backedUp' = backedUp,
    planned' = planned, hasPlan' = hasPlan, now' = now, expiry' = expiry,
  }

  // 後から legal_hold が付く（計画の後に置かれる場合を含む）
  action SetHold(r) = all {
    Rows.contains(r),
    not(purged.get(r)),
    held' = held.set(r, true),
    archived' = archived, purged' = purged, backedUp' = backedUp,
    planned' = planned, hasPlan' = hasPlan, now' = now, expiry' = expiry,
  }

  // restore できる backup を取る
  action Backup = all {
    not(backedUp),
    backedUp' = true,
    archived' = archived, held' = held, purged' = purged,
    planned' = planned, hasPlan' = hasPlan, now' = now, expiry' = expiry,
  }

  // 計画を作る。候補集合と期限を持つ（実装の manifest と expires_at）
  action Plan = all {
    backedUp,
    hasPlan' = true,
    planned' = Rows.mapBy(r => archived.get(r) and not(held.get(r))),
    expiry' = now + 1,
    archived' = archived, held' = held, purged' = purged, backedUp' = backedUp,
    now' = now,
  }

  action Tick = all {
    now < 3,
    now' = now + 1,
    archived' = archived, held' = held, purged' = purged, backedUp' = backedUp,
    planned' = planned, hasPlan' = hasPlan, expiry' = expiry,
  }

  // 実行。期限切れは拒否する。再計算する設計では、計画の後に候補が変わっていれば拒否する
  action Execute = all {
    hasPlan,
    now < expiry,
    backedUp,
    RecomputeAtExecute implies planned == Rows.mapBy(r => archived.get(r) and not(held.get(r))),
    purged' = Rows.mapBy(r => purged.get(r) or target.contains(r)),
    archived' = archived, held' = held, backedUp' = backedUp,
    planned' = planned, hasPlan' = hasPlan, now' = now, expiry' = expiry,
  }

  action step = any { Archive(0), Archive(1), SetHold(0), SetHold(1), Backup, Plan, Tick, Execute }

  // C1: legal_hold の行を消さない
  val NoHoldLoss = Rows.forall(r => not(held.get(r)) or not(purged.get(r)))

  // C2: 削除まで到達できる（到達性の否定命題）
  val NeverPurged = not(Rows.exists(r => purged.get(r)))
}
