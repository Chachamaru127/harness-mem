---- MODULE PurgePlan_TTrace_1794137486 ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, PurgePlan

_expression ==
    LET PurgePlan_TEExpression == INSTANCE PurgePlan_TEExpression
    IN PurgePlan_TEExpression!expression
----

_trace ==
    LET PurgePlan_TETrace == INSTANCE PurgePlan_TETrace
    IN PurgePlan_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        archived = ((0 :> TRUE @@ 1 :> FALSE))
        /\
        backedUp = (TRUE)
        /\
        held = ((0 :> TRUE @@ 1 :> FALSE))
        /\
        now = (0)
        /\
        expiry = (1)
        /\
        hasPlan = (TRUE)
        /\
        planned = ((0 :> TRUE @@ 1 :> FALSE))
        /\
        purged = ((0 :> TRUE @@ 1 :> FALSE))
    )
----

_init ==
    /\ purged = _TETrace[1].purged
    /\ now = _TETrace[1].now
    /\ backedUp = _TETrace[1].backedUp
    /\ expiry = _TETrace[1].expiry
    /\ hasPlan = _TETrace[1].hasPlan
    /\ planned = _TETrace[1].planned
    /\ held = _TETrace[1].held
    /\ archived = _TETrace[1].archived
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ purged  = _TETrace[i].purged
        /\ purged' = _TETrace[j].purged
        /\ now  = _TETrace[i].now
        /\ now' = _TETrace[j].now
        /\ backedUp  = _TETrace[i].backedUp
        /\ backedUp' = _TETrace[j].backedUp
        /\ expiry  = _TETrace[i].expiry
        /\ expiry' = _TETrace[j].expiry
        /\ hasPlan  = _TETrace[i].hasPlan
        /\ hasPlan' = _TETrace[j].hasPlan
        /\ planned  = _TETrace[i].planned
        /\ planned' = _TETrace[j].planned
        /\ held  = _TETrace[i].held
        /\ held' = _TETrace[j].held
        /\ archived  = _TETrace[i].archived
        /\ archived' = _TETrace[j].archived

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("PurgePlan_TTrace_1794137486.json", _TETrace)

=============================================================================

 Note that you can extract this module `PurgePlan_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `PurgePlan_TEExpression.tla` file takes precedence 
  over the module `PurgePlan_TEExpression` below).

---- MODULE PurgePlan_TEExpression ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, PurgePlan

expression == 
    [
        \* To hide variables of the `PurgePlan` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        purged |-> purged
        ,now |-> now
        ,backedUp |-> backedUp
        ,expiry |-> expiry
        ,hasPlan |-> hasPlan
        ,planned |-> planned
        ,held |-> held
        ,archived |-> archived
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_purgedUnchanged |-> purged = purged'
        
        \* Format the `purged` variable as Json value.
        \* ,_purgedJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(purged)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_purgedModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].purged # _TETrace[s-1].purged
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE PurgePlan_TETrace ----
\*EXTENDS IOUtils, TLC, PurgePlan
\*
\*trace == IODeserialize("PurgePlan_TTrace_1794137486.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE PurgePlan_TETrace ----
EXTENDS TLC, PurgePlan

trace == 
    <<
    ([archived |-> (0 :> FALSE @@ 1 :> FALSE),backedUp |-> FALSE,held |-> (0 :> FALSE @@ 1 :> FALSE),now |-> 0,expiry |-> 0,hasPlan |-> FALSE,planned |-> (0 :> FALSE @@ 1 :> FALSE),purged |-> (0 :> FALSE @@ 1 :> FALSE)]),
    ([archived |-> (0 :> TRUE @@ 1 :> FALSE),backedUp |-> FALSE,held |-> (0 :> FALSE @@ 1 :> FALSE),now |-> 0,expiry |-> 0,hasPlan |-> FALSE,planned |-> (0 :> FALSE @@ 1 :> FALSE),purged |-> (0 :> FALSE @@ 1 :> FALSE)]),
    ([archived |-> (0 :> TRUE @@ 1 :> FALSE),backedUp |-> TRUE,held |-> (0 :> FALSE @@ 1 :> FALSE),now |-> 0,expiry |-> 0,hasPlan |-> FALSE,planned |-> (0 :> FALSE @@ 1 :> FALSE),purged |-> (0 :> FALSE @@ 1 :> FALSE)]),
    ([archived |-> (0 :> TRUE @@ 1 :> FALSE),backedUp |-> TRUE,held |-> (0 :> FALSE @@ 1 :> FALSE),now |-> 0,expiry |-> 1,hasPlan |-> TRUE,planned |-> (0 :> TRUE @@ 1 :> FALSE),purged |-> (0 :> FALSE @@ 1 :> FALSE)]),
    ([archived |-> (0 :> TRUE @@ 1 :> FALSE),backedUp |-> TRUE,held |-> (0 :> TRUE @@ 1 :> FALSE),now |-> 0,expiry |-> 1,hasPlan |-> TRUE,planned |-> (0 :> TRUE @@ 1 :> FALSE),purged |-> (0 :> FALSE @@ 1 :> FALSE)]),
    ([archived |-> (0 :> TRUE @@ 1 :> FALSE),backedUp |-> TRUE,held |-> (0 :> TRUE @@ 1 :> FALSE),now |-> 0,expiry |-> 1,hasPlan |-> TRUE,planned |-> (0 :> TRUE @@ 1 :> FALSE),purged |-> (0 :> TRUE @@ 1 :> FALSE)])
    >>
----


=============================================================================

---- CONFIG PurgePlan_TTrace_1794137486 ----

INVARIANT
    _inv

CHECK_DEADLOCK
    \* CHECK_DEADLOCK off because of PROPERTY or INVARIANT above.
    FALSE

INIT
    _init

NEXT
    _next

CONSTANT
    _TETrace <- _trace

ALIAS
    _expression
=============================================================================
\* Generated on Sun Nov 08 20:31:26 JST 2026