---- MODULE WorkGate_TTrace_1794134088 ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, WorkGate

_expression ==
    LET WorkGate_TEExpression == INSTANCE WorkGate_TEExpression
    IN WorkGate_TEExpression!expression
----

_trace ==
    LET WorkGate_TETrace == INSTANCE WorkGate_TETrace
    IN WorkGate_TETrace!trace
----

_inv ==
    ~(
        TLCGet("level") = Len(_TETrace)
        /\
        phase = (3)
        /\
        versionOk = (FALSE)
        /\
        tested = (FALSE)
        /\
        ci = (1)
    )
----

_init ==
    /\ phase = _TETrace[1].phase
    /\ tested = _TETrace[1].tested
    /\ ci = _TETrace[1].ci
    /\ versionOk = _TETrace[1].versionOk
----

_next ==
    /\ \E i,j \in DOMAIN _TETrace:
        /\ \/ /\ j = i + 1
              /\ i = TLCGet("level")
        /\ phase  = _TETrace[i].phase
        /\ phase' = _TETrace[j].phase
        /\ tested  = _TETrace[i].tested
        /\ tested' = _TETrace[j].tested
        /\ ci  = _TETrace[i].ci
        /\ ci' = _TETrace[j].ci
        /\ versionOk  = _TETrace[i].versionOk
        /\ versionOk' = _TETrace[j].versionOk

\* Uncomment the ASSUME below to write the states of the error trace
\* to the given file in Json format. Note that you can pass any tuple
\* to `JsonSerialize`. For example, a sub-sequence of _TETrace.
    \* ASSUME
    \*     LET J == INSTANCE Json
    \*         IN J!JsonSerialize("WorkGate_TTrace_1794134088.json", _TETrace)

=============================================================================

 Note that you can extract this module `WorkGate_TEExpression`
  to a dedicated file to reuse `expression` (the module in the 
  dedicated `WorkGate_TEExpression.tla` file takes precedence 
  over the module `WorkGate_TEExpression` below).

---- MODULE WorkGate_TEExpression ----
EXTENDS Sequences, TLCExt, Toolbox, Naturals, TLC, WorkGate

expression == 
    [
        \* To hide variables of the `WorkGate` spec from the error trace,
        \* remove the variables below.  The trace will be written in the order
        \* of the fields of this record.
        phase |-> phase
        ,tested |-> tested
        ,ci |-> ci
        ,versionOk |-> versionOk
        
        \* Put additional constant-, state-, and action-level expressions here:
        \* ,_stateNumber |-> _TEPosition
        \* ,_phaseUnchanged |-> phase = phase'
        
        \* Format the `phase` variable as Json value.
        \* ,_phaseJson |->
        \*     LET J == INSTANCE Json
        \*     IN J!ToJson(phase)
        
        \* Lastly, you may build expressions over arbitrary sets of states by
        \* leveraging the _TETrace operator.  For example, this is how to
        \* count the number of times a spec variable changed up to the current
        \* state in the trace.
        \* ,_phaseModCount |->
        \*     LET F[s \in DOMAIN _TETrace] ==
        \*         IF s = 1 THEN 0
        \*         ELSE IF _TETrace[s].phase # _TETrace[s-1].phase
        \*             THEN 1 + F[s-1] ELSE F[s-1]
        \*     IN F[_TEPosition - 1]
    ]

=============================================================================



Parsing and semantic processing can take forever if the trace below is long.
 In this case, it is advised to uncomment the module below to deserialize the
 trace from a generated binary file.

\*
\*---- MODULE WorkGate_TETrace ----
\*EXTENDS IOUtils, TLC, WorkGate
\*
\*trace == IODeserialize("WorkGate_TTrace_1794134088.bin", TRUE)
\*
\*=============================================================================
\*

---- MODULE WorkGate_TETrace ----
EXTENDS TLC, WorkGate

trace == 
    <<
    ([phase |-> 0,versionOk |-> FALSE,tested |-> FALSE,ci |-> 0]),
    ([phase |-> 1,versionOk |-> FALSE,tested |-> FALSE,ci |-> 0]),
    ([phase |-> 2,versionOk |-> FALSE,tested |-> FALSE,ci |-> 1]),
    ([phase |-> 3,versionOk |-> FALSE,tested |-> FALSE,ci |-> 1])
    >>
----


=============================================================================

---- CONFIG WorkGate_TTrace_1794134088 ----

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
\* Generated on Sun Nov 08 19:34:49 JST 2026