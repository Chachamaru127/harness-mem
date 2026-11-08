// harness-mem の取り込み経路の模型（初期診断 v1）
//
// 出典:
//   AGENTS.md §最優先ルール 1-3   Plans.md を正本にし、着手時に cc:WIP、触った箇所の bun test を実行する
//   .github/workflows/test-suite.yml  PR と main push で repository-behavior-gate を走らせる
//   .github/workflows/release.yml      v*.*.* の tag push で npm test を通してから publish する
//   formal/baseline/evidence/repo-facts.json  main の branch protection は 404（未設定）
//
// 抽象化:
//   phase 0 依頼だけ受けた / 1 Plans.md に cc:WIP で記録 / 2 PR を開いた / 3 main に取り込んだ / 4 公開した
//   ci    0 未実行 / 1 実行中 / 2 緑 / 3 赤     tested 現在の commit で bun test が緑
//   versionOk  package.json / VERSION / CHANGELOG の同期が済んだ
//
// 対象外: 担当の取得と交代、独立レビュー、直接 push、tag 後の手戻り。
module WorkGate {
  // main に branch protection が無いこと（repo-facts.json）。true にすると保護ありの候補模型になる。
  pure val BranchProtected = false

  var phase: int
  var tested: bool
  var ci: int
  var versionOk: bool

  action init = all {
    phase' = 0,
    tested' = false,
    ci' = 0,
    versionOk' = false,
  }

  // AGENTS.md 1: 仕事を Plans.md に記録して cc:WIP にする
  action Plan = all {
    phase == 0,
    phase' = 1,
    tested' = tested,
    ci' = ci,
    versionOk' = versionOk,
  }

  // 変更を入れる。前の commit に対する test と CI の結果は失効する
  action Edit = all {
    phase == 1 or phase == 2,
    phase' = phase,
    tested' = false,
    ci' = 0,
    versionOk' = versionOk,
  }

  // AGENTS.md 3: 触った箇所の bun test
  action TestPass = all {
    (phase == 1 or phase == 2) and ci == 0,
    phase' = phase,
    tested' = true,
    ci' = ci,
    versionOk' = versionOk,
  }

  action TestFail = all {
    (phase == 1 or phase == 2) and ci == 0,
    phase' = phase,
    tested' = false,
    ci' = ci,
    versionOk' = versionOk,
  }

  // PR を開くと test-suite.yml が走る
  action OpenPR = all {
    phase == 1,
    phase' = 2,
    tested' = tested,
    ci' = 1,
    versionOk' = versionOk,
  }

  action CIPass = all {
    ci == 1,
    phase' = phase,
    tested' = tested,
    ci' = 2,
    versionOk' = versionOk,
  }

  action CIFail = all {
    ci == 1,
    phase' = phase,
    tested' = tested,
    ci' = 3,
    versionOk' = versionOk,
  }

  // gh pr merge。main が保護されていなければ CI の色を見ない
  action Merge = all {
    phase == 2,
    not(BranchProtected) or ci == 2,
    phase' = 3,
    tested' = tested,
    ci' = ci,
    versionOk' = versionOk,
  }

  // AGENTS.md §変更時の注意: setup / release では版情報と変更履歴を同期する
  action SyncVersion = all {
    phase == 3,
    phase' = phase,
    tested' = tested,
    ci' = ci,
    versionOk' = true,
  }

  // v*.*.* tag push → release.yml が npm test を通してから publish する
  action Release = all {
    phase == 3 and versionOk,
    phase' = 4,
    tested' = tested,
    ci' = ci,
    versionOk' = versionOk,
  }

  action Hold = all {
    phase' = phase,
    tested' = tested,
    ci' = ci,
    versionOk' = versionOk,
  }

  action step = any {
    Plan, Edit, TestPass, TestFail, OpenPR, CIPass, CIFail,
    Merge, SyncVersion, Release, Hold,
  }

  // C1: main に取り込まれた commit は、その同じ commit の CI が緑である
  val NoUnverifiedMerge = (phase < 3) or (ci == 2)

  // C2: 公開まで到達できる（到達性の否定命題。反例＝到達経路）
  val NeverReleased = not(phase == 4)
}
