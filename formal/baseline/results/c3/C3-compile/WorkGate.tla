------------------------------- MODULE WorkGate -------------------------------

EXTENDS Integers, Sequences, FiniteSets, TLC, Apalache, Variants

VARIABLE
  (*
    @type: Bool;
  *)
  versionOk

(*
  @type: (() => Bool);
*)
BranchProtected == TRUE

VARIABLE
  (*
    @type: Int;
  *)
  phase

VARIABLE
  (*
    @type: Bool;
  *)
  tested

VARIABLE
  (*
    @type: Int;
  *)
  ci

(*
  @type: (() => Bool);
*)
TestFail ==
  ((phase = 1 \/ phase = 2) /\ ci = 0)
    /\ phase' := phase
    /\ tested' := FALSE
    /\ ci' := ci
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
OpenPR ==
  phase = 1
    /\ phase' := 2
    /\ tested' := tested
    /\ ci' := 1
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
CIPass ==
  ci = 1
    /\ phase' := phase
    /\ tested' := tested
    /\ ci' := 2
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
CIFail ==
  ci = 1
    /\ phase' := phase
    /\ tested' := tested
    /\ ci' := 3
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
Merge ==
  phase = 2
    /\ (~BranchProtected \/ ci = 2)
    /\ phase' := 3
    /\ tested' := tested
    /\ ci' := ci
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
SyncVersion ==
  phase = 3
    /\ phase' := phase
    /\ tested' := tested
    /\ ci' := ci
    /\ versionOk' := TRUE

(*
  @type: (() => Bool);
*)
Release ==
  (phase = 3 /\ versionOk)
    /\ phase' := 4
    /\ tested' := tested
    /\ ci' := ci
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
Hold ==
  phase' := phase
    /\ tested' := tested
    /\ ci' := ci
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
init == phase = 0/\ tested = FALSE/\ ci = 0/\ versionOk = FALSE

(*
  @type: (() => Bool);
*)
NoUnverifiedMerge == phase < 3 \/ ci = 2

(*
  @type: (() => Bool);
*)
NeverReleased == ~(phase = 4)

(*
  @type: (() => Bool);
*)
Plan ==
  phase = 0
    /\ phase' := 1
    /\ tested' := tested
    /\ ci' := ci
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
Edit ==
  (phase = 1 \/ phase = 2)
    /\ phase' := phase
    /\ tested' := FALSE
    /\ ci' := 0
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
TestPass ==
  ((phase = 1 \/ phase = 2) /\ ci = 0)
    /\ phase' := phase
    /\ tested' := TRUE
    /\ ci' := ci
    /\ versionOk' := versionOk

(*
  @type: (() => Bool);
*)
step ==
  Plan
    \/ Edit
    \/ TestPass
    \/ TestFail
    \/ OpenPR
    \/ CIPass
    \/ CIFail
    \/ Merge
    \/ SyncVersion
    \/ Release
    \/ Hold

(*
  @type: (() => Bool);
*)
q_init == init

(*
  @type: (() => Bool);
*)
q_inv == NoUnverifiedMerge

(*
  @type: (() => Bool);
*)
q_step == step

================================================================================
