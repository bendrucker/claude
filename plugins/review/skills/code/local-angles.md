# Local Finder Angles

Selection, caps, and the candidate shape match [angles.md](angles.md). Every angle here belongs to the `full` set in [efforts.md](efforts.md).

## Correctness Angles

### Angle F — typed-failure auditor

Flag an expected failure that leaves its module as a thrown exception, a rejected promise, or a panic while the signature promises a value: a lookup miss, a rejected payload, an unavailable dependency, a write that lost a race. A catch that flattens several of those into one error the caller cannot branch on counts too. Also flag input that reaches typed code in the shape it arrived in, with no parse between: a request body, a database row, a cache hit, an RPC response, an environment variable.

## Cleanup Angles

### Type Discipline

Flag a raw primitive where the surrounding code already declares a domain type for the same thing: a bare string id beside a declared id type, a duration or byte count as a plain number where a unit type exists, a path kept as text past the point something parses it. Name the existing type. Also flag booleans on one record or signature that encode a lifecycle rather than independent facts (`isLoading` beside `isDone`), and name the combination that has no meaning.

### Discoverability

Flag an exported name whose plain-text search returns the wrong window: a one-word name (`diff`, `queue`, `run`), an unqualified verb (`validate`, `format`), a bare-role filename (`utils`, `types`), two spellings of one concept (`orgId` beside `organizationId`), or a name whose behavior changed underneath it. A symbol copied to a second definition site instead of moved counts too.

### Coupling

Flag Feature Envy (a function reading or writing another module's data more than its own), Data Clumps (the same few parameters travelling together through several signatures), Shotgun Surgery (one logical change forcing scattered edits across this diff), Divergent Change (one file edited for several unrelated reasons), and Message Chains (`a.b().c().d()` binding the caller to every hop's shape). Name the smell and the move that removes it. Skip a shape a repo convention endorses or a linter enforces.
