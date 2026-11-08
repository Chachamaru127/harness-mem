------------------------------- MODULE PurgePlan -------------------------------

EXTENDS Integers, Sequences, FiniteSets, TLC, Apalache, Variants

VARIABLE
  (*
    @type: (Int -> Bool);
  *)
  archived

VARIABLE
  (*
    @type: (Int -> Bool);
  *)
  held

VARIABLE
  (*
    @type: (Int -> Bool);
  *)
  purged

(*
  @type: (() => Bool);
*)
RecomputeAtExecute == FALSE

VARIABLE
  (*
    @type: Bool;
  *)
  backedUp

VARIABLE
  (*
    @type: (Int -> Bool);
  *)
  planned

VARIABLE
  (*
    @type: Bool;
  *)
  hasPlan

VARIABLE
  (*
    @type: Int;
  *)
  now

VARIABLE
  (*
    @type: Int;
  *)
  expiry

(*
  @type: (() => Set(Int));
*)
Rows == { 0, 1 }

(*
  @type: ((Int) => Bool);
*)
Archive(r_141) ==
  r_141 \in Rows
    /\ ~(archived[r_141])
    /\ ~(purged[r_141])
    /\ ~(held[r_141])
    /\ archived' := [ archived EXCEPT ![r_141] = TRUE ]
    /\ held' := held
    /\ purged' := purged
    /\ backedUp' := backedUp
    /\ planned' := planned
    /\ hasPlan' := hasPlan
    /\ now' := now
    /\ expiry' := expiry

(*
  @type: ((Int) => Bool);
*)
SetHold(r_179) ==
  r_179 \in Rows
    /\ ~(purged[r_179])
    /\ held' := [ held EXCEPT ![r_179] = TRUE ]
    /\ archived' := archived
    /\ purged' := purged
    /\ backedUp' := backedUp
    /\ planned' := planned
    /\ hasPlan' := hasPlan
    /\ now' := now
    /\ expiry' := expiry

(*
  @type: (() => Bool);
*)
Backup ==
  ~backedUp
    /\ backedUp' := TRUE
    /\ archived' := archived
    /\ held' := held
    /\ purged' := purged
    /\ planned' := planned
    /\ hasPlan' := hasPlan
    /\ now' := now
    /\ expiry' := expiry

(*
  @type: (() => Bool);
*)
Plan ==
  backedUp
    /\ hasPlan' := TRUE
    /\ planned' := [ r_223 \in Rows |-> archived[r_223] /\ ~(held[r_223]) ]
    /\ expiry' := now + 1
    /\ archived' := archived
    /\ held' := held
    /\ purged' := purged
    /\ backedUp' := backedUp
    /\ now' := now

(*
  @type: (() => Bool);
*)
Tick ==
  now < 3
    /\ now' := now + 1
    /\ archived' := archived
    /\ held' := held
    /\ purged' := purged
    /\ backedUp' := backedUp
    /\ planned' := planned
    /\ hasPlan' := hasPlan
    /\ expiry' := expiry

(*
  @type: (() => Bool);
*)
NoHoldLoss == \A r_362 \in Rows: ~(held[r_362]) \/ ~(purged[r_362])

(*
  @type: (() => Bool);
*)
NeverPurged == ~(\E r_370 \in Rows: purged[r_370])

(*
  @type: (() => Set(Int));
*)
candidates == { r_41 \in Rows: archived[r_41] /\ ~(held[r_41]) }

(*
  @type: (() => Bool);
*)
init ==
  archived = [ id__58 \in Rows |-> FALSE ]
    /\ held = [ id__65 \in Rows |-> FALSE ]
    /\ purged = [ id__72 \in Rows |-> FALSE ]
    /\ backedUp = FALSE
    /\ planned = [ id__82 \in Rows |-> FALSE ]
    /\ hasPlan = FALSE
    /\ now = 0
    /\ expiry = 0

(*
  @type: (() => Set(Int));
*)
target ==
  IF RecomputeAtExecute THEN candidates ELSE { r_51 \in Rows: planned[r_51] }

(*
  @type: (() => Bool);
*)
q_init == init

(*
  @type: (() => Bool);
*)
q_inv == NoHoldLoss

(*
  @type: (() => Bool);
*)
Execute ==
  hasPlan
    /\ now < expiry
    /\ backedUp
    /\ (RecomputeAtExecute
      => planned = [ r_297 \in Rows |-> archived[r_297] /\ ~(held[r_297]) ])
    /\ purged' := [ r_310 \in Rows |-> purged[r_310] \/ r_310 \in target ]
    /\ archived' := archived
    /\ held' := held
    /\ backedUp' := backedUp
    /\ planned' := planned
    /\ hasPlan' := hasPlan
    /\ now' := now
    /\ expiry' := expiry

(*
  @type: (() => Bool);
*)
step ==
  Archive(0)
    \/ Archive(1)
    \/ SetHold(0)
    \/ SetHold(1)
    \/ Backup
    \/ Plan
    \/ Tick
    \/ Execute

(*
  @type: (() => Bool);
*)
q_step == step

================================================================================
