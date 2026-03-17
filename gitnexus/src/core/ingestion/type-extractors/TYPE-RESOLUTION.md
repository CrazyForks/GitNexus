# Type Resolution System

GitNexus's type resolution system maps variables to their declared types across 12 languages, enabling receiver-constrained call resolution. When code calls `user.save()`, the resolver needs to know that `user` is of type `User` to link the call to `User#save` rather than `Repo#save`.

The system is designed to be **conservative** (no false bindings), **single-pass** (no fixpoint iteration), and **per-file** (no cross-file type inference at this layer).

## Architecture

```
                                 ┌──────────────────────┐
                                 │     type-env.ts      │
                                 │                      │
                                 │  buildTypeEnv()      │
                                 │  - Single AST walk   │
                                 │  - Scope tracking    │
                                 │  - Tier orchestration │
                                 └──────────┬───────────┘
                                            │ dispatches to
                    ┌───────────────────────┬┴┬───────────────────────┐
                    │                       │ │                       │
          ┌─────────▼──────────┐  ┌─────────▼─▼────────┐  ┌──────────▼─────────┐
          │   shared.ts        │  │  <language>.ts      │  │    types.ts        │
          │                    │  │                      │  │                    │
          │  Container table   │  │  Per-language        │  │  Interface defs    │
          │  Type extractors   │  │  extractors          │  │  for all extractor │
          │  Generic helpers   │  │  (12 files)          │  │  function types    │
          └────────────────────┘  └──────────────────────┘  └────────────────────┘
```

### Files

| File | Purpose |
|------|---------|
| `type-env.ts` | Core engine. Single-pass AST walker that orchestrates all tiers. Exports `buildTypeEnv()` and the `TypeEnvironment` interface. |
| `types.ts` | TypeScript interfaces for all extractor function signatures (`TypeBindingExtractor`, `ForLoopExtractor`, `PatternBindingExtractor`, etc.). |
| `shared.ts` | Language-agnostic helpers: `extractSimpleTypeName`, `extractElementTypeFromString`, `resolveIterableElementType`, `CONTAINER_DESCRIPTORS`, `TYPED_PARAMETER_TYPES`. |
| `index.ts` | Dispatch map from `SupportedLanguages` to `LanguageTypeConfig` objects. |
| `typescript.ts` | TypeScript/JavaScript extractors (shared config). Includes JSDoc parsing. |
| `jvm.ts` | Java + Kotlin extractors (separate configs, shared file). |
| `csharp.ts` | C# extractors. |
| `go.ts` | Go extractors. Handles range clause semantics (channel vs slice). |
| `rust.ts` | Rust extractors. Handles `if let`, match arms, `Self` resolution. |
| `python.ts` | Python extractors. Handles `match`/`case` with `as` patterns. |
| `php.ts` | PHP extractors. Includes PHPDoc parsing. |
| `ruby.ts` | Ruby extractors. Includes YARD annotation parsing. |
| `swift.ts` | Swift extractors. Most minimal — no for-loop or pattern binding support yet. |
| `c-cpp.ts` | C/C++ extractors (shared config). Handles structured bindings and templates. |

## Resolution Tiers

The system resolves variable types through a priority-ordered cascade. Each tier runs during the same single AST walk; higher tiers only activate when lower tiers produce no binding.

### Tier 0: Explicit Type Annotations

Direct extraction from AST type nodes. This is the highest-confidence tier.

```typescript
// TypeScript
const user: User = getUser();        // user → User

// Java
User user = getUser();               // user → User

// Go
var user User                        // user → User

// Rust
let user: User = get_user();         // user → User

// Python
user: User = get_user()              // user → User
```

**How it works:** `extractDeclaration` reads the `type` field from declaration AST nodes and calls `extractSimpleTypeName` to normalize it (unwrapping generics, nullable wrappers, qualified names).

**Parameters** are handled separately via `extractParameter`, using the same `extractSimpleTypeName` logic on function parameter type annotations. The shared `TYPED_PARAMETER_TYPES` set gates which AST node types trigger parameter extraction.

### Tier 0b: For-Loop Element Type Resolution

For-each loops with implicit element types (e.g., `for (var user in users)`) resolve the loop variable's type from the iterable's container type.

```csharp
// C#: var foreach
foreach (var user in users) { user.Save(); }  // user → User (from List<User>)

// TypeScript: for-of
for (const user of users) { user.save(); }    // user → User (from User[])

// Rust: for-in
for user in users.iter() { user.save(); }     // user → User (from Vec<User>)
```

**Three-strategy cascade** (in `resolveIterableElementType`):

1. **declarationTypeNodes** — Raw AST type annotation node. Handles container types where `extractSimpleTypeName` returned `undefined` (e.g., `User[]`, `List[User]`). Falls back to file scope when the iterable is a class field.
2. **scopeEnv string** — `extractElementTypeFromString` on the stored type string. Uses bracket-balanced parsing (no regex) for generic argument extraction.
3. **AST walk** — Language-specific upward walk to enclosing function parameters to read type annotations directly.

**Container descriptors** (`CONTAINER_DESCRIPTORS` in `shared.ts`) map container type names to their type parameter semantics. For example, `Map` has arity 2 with `.keys()` yielding the first type arg and `.values()` yielding the last. This enables:

```typescript
for (const key of map.keys()) { ... }    // key → string (first type arg)
for (const val of map.values()) { ... }  // val → User   (last type arg)
```

### Tier 0c: Pattern Binding

Pattern matching constructs that introduce new typed variables.

```csharp
// C# is-pattern
if (obj is User user) { user.Save(); }                   // user → User

// C# recursive_pattern
if (obj is User { Name: "Alice" } u) { u.Save(); }       // u → User

// Java instanceof
if (obj instanceof User user) { user.save(); }            // user → User

// Kotlin when/is (with position-indexed overrides)
when (obj) {
    is User -> obj.save()     // obj → User (within this branch only)
    is Repo -> obj.archive()  // obj → Repo (within this branch only)
}

// Rust if-let
if let Some(user) = opt { user.save(); }                  // user → User
if let Ok(user) = result { user.save(); }                 // user → User

// TypeScript instanceof
if (x instanceof User) { x.save(); }                     // x → User

// Python match/case as
match obj:
    case User() as user: user.save()                      // user → User
```

**Binding semantics:**
- **First-writer-wins** (default): The first pattern binding for a variable name sticks. Used by Java, C#, TypeScript, Rust, Python.
- **Position-indexed overwrite** (Kotlin only): Each branch gets its own type for the same variable, tracked by AST position ranges. Prevents cross-arm contamination.

### Tier 1: Constructor Inference

When no explicit type annotation exists, infer from constructor calls.

```typescript
// TypeScript
const user = new User();              // user → User (via extractInitializer)

// C#
var user = new User();                // user → User

// Java
User user = new User();              // already Tier 0, but:
var user = new UserService();        // user → UserService (Tier 1)

// Kotlin
val user = User()                     // user → User (needs SymbolTable to confirm User is a class)

// Rust
let user = User::new();              // user → User

// C++
auto user = User();                  // user → User (needs classNames lookup)

// Ruby
user = User.new                      // user → User (via extractRubyConstructorAssignment)
```

**Cross-file verification:** Some languages (Kotlin, C++) can't distinguish `User()` from `getUser()` syntactically. The `scanConstructorBinding` scanner collects unverified `{varName, calleeName}` pairs. These are later verified against the `SymbolTable` — if the callee name matches a known class/struct, the binding is accepted.

### Tier 2: Assignment Chain Propagation

Single-pass propagation of type bindings through plain-identifier assignments.

```typescript
const user: User = getUser();  // user → User (Tier 0)
const alias = user;            // alias → User (Tier 2: propagated from user)
const b = alias;               // b → User (Tier 2: multi-hop, if forward-declared)
```

**How it works:** During the AST walk, `extractPendingAssignment` collects `{lhs, rhs}` pairs for declarations where the LHS has no type and the RHS is a bare identifier. After the walk completes, a single pass resolves each pending assignment by looking up the RHS in `scopeEnv` (or file scope).

**Limitations:** Forward-order only. `const b = a; const a: User = ...` won't resolve `b`. No fixpoint iteration — single pass covers 95%+ of real-world patterns.

## Scope Model

The type environment is scope-aware to prevent variable name collisions across functions.

```
File scope ('')
├── config → Config
├── users → Map           (class field)
│
├── processUsers@100
│   ├── user → User       (from for-loop)
│   └── alias → User      (from assignment chain)
│
└── processRepos@200
    └── repo → Repo       (from for-loop)
```

**Scope keys:** `functionName@startIndex` for function-local scopes, `''` for file-level scope.

**Lookup order** (in `TypeEnvironment.lookup`):
1. Position-indexed pattern overrides (Kotlin when/is)
2. Function-local scope (`processUsers@100`)
3. File-level scope (`''`)
4. Special receivers: `this`/`self`/`$this` → enclosing class name via AST walk; `super`/`base`/`parent` → parent class via heritage node

## Language Feature Matrix

| Feature | TS/JS | Java | Kotlin | C# | Go | Rust | Python | PHP | Ruby | Swift | C/C++ |
|---------|:-----:|:----:|:------:|:--:|:--:|:----:|:------:|:---:|:----:|:-----:|:-----:|
| Declarations | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Parameters | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| Constructor inference | Yes | Yes | Yes | -- | -- | Yes | Yes | Yes | Yes | Yes | Yes |
| Constructor binding scan | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| For-loop element types | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | -- | Yes |
| Pattern binding | Yes | Yes | Yes | Yes | -- | Yes | Yes | -- | -- | -- | -- |
| Assignment chains | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | -- | Yes |
| Comment-based types | JSDoc | -- | -- | -- | -- | -- | -- | PHPDoc | YARD | -- | -- |
| Return type extraction | JSDoc | -- | -- | -- | -- | -- | -- | PHPDoc | YARD | -- | -- |

## Container Type Descriptors

The `CONTAINER_DESCRIPTORS` table in `shared.ts` maps container base type names to their type parameter semantics. This drives correct element type extraction from generic containers during for-loop resolution.

**Arity 2 (key-value):**
`Map`, `WeakMap`, `HashMap`, `BTreeMap`, `LinkedHashMap`, `TreeMap`, `dict`, `Dict`, `Dictionary`, `SortedDictionary`, `Record`, `OrderedDict`, `ConcurrentHashMap`, `ConcurrentDictionary`, `MutableMap`

**Arity 1 (single-element):**
`Array`, `List`, `ArrayList`, `LinkedList`, `Vec`, `VecDeque`, `Set`, `HashSet`, `BTreeSet`, `TreeSet`, `Queue`, `Deque`, `Stack`, `Sequence`, `Iterable`, `Iterator`, `IEnumerable`, `IList`, `ICollection`, `Collection`, `ObservableCollection`, `IEnumerator`, `SortedSet`, `Stream`, `MutableList`, `MutableSet`, `LinkedHashSet`, `ArrayDeque`, `PriorityQueue`, `list`, `set`, `tuple`, `frozenset`

Each descriptor specifies which methods yield the key type (`.keys()`, `.keySet()`, `.Keys`) vs the value type (`.values()`, `.get()`, `.Values`). Unknown containers fall back to a method-name heuristic.

## How It Integrates with the Pipeline

```
  parse-worker.ts
       │
       ▼
  buildTypeEnv(tree, language, symbolTable?)
       │
       ├──► TypeEnvironment.lookup(varName, callNode)
       │         │
       │         ▼
       │    call-processor.ts
       │    - Resolves receiver type for method calls
       │    - Filters candidate targets by receiver match
       │    - Uses constructorBindings for cross-file inference
       │
       └──► discarded after file processing
```

The `TypeEnvironment` is built once per file during the ingestion pipeline's call-resolution phase. The `call-processor` uses `lookup()` to determine the receiver type for each method call expression, then filters the candidate symbols from the `SymbolTable` to find the correct target.

## Roadmap

### Phase 7: Cross-Scope Type Propagation

Three deferred gaps share the same root blocker — the `ForLoopExtractor` interface only receives the current method's `scopeEnv`, not the full `TypeEnvironment`.

**7A. Go `call_expression` as range iterable**
`for _, user := range getUsers()` — the iterable is a function call, not a variable. Requires passing `returnTypeMap` to `extractForLoopBinding` so it can look up `getUsers → []User`. Touches the `ForLoopExtractor` interface which all 10 language extractors implement.

**7B. PHP `@var` class property scope propagation**
`foreach ($this->users as $user)` only works when `$users` type is in the method's scope (via `@param`). Class property `@var` annotations are stored at file scope, but `extractForLoopBinding` only queries function scope. Same infrastructure as 7A — extractors need access to the full `TypeEnvironment`.

**7C. Rust `struct_pattern` in match arms**
`match user { User { name, email } => ... }` — `struct_pattern` destructures named fields, but field-level type info isn't available without field resolution infrastructure. Can bind the overall variable (via `@` pattern) but not individual destructured fields.

**Approach:** Extend the `ForLoopExtractor` type signature to accept the full `TypeEnvironment` (or at minimum, both scope-level and file-level env maps). This is a coordinated change across all 10 language extractors.

### Phase 8: Field-Type Resolution

Currently, the system resolves variable types but not field access chains. `user.address.city` can resolve `user → User` but cannot resolve `address → Address` without field-type information from the class definition.

**Scope:**
- Parse class/struct field declarations to build a field type map per class
- Enable chained member access resolution: `user.address.city` → resolve each segment
- Required for: PHP chained property access (`$this->property->method()`), Rust struct field destructuring, TypeScript deep property access

### Phase 9: Return-Type-Aware Resolution

The `scanConstructorBinding` mechanism currently only handles `var x = CalleeName()` patterns where the callee is a class constructor. Extending this to full return-type inference would enable:

- `var users = repo.getUsers()` → `users: List<User>` (from `getUsers` return type)
- For-loop over function call results: `for user in getUsers()` (Phase 7A prerequisite)
- Method chain inference: `repo.getUsers().first()` → User

**Approach:** The call-processor already extracts return types from function signatures. Feed this information back into `TypeEnvironment` as a `returnTypeMap` for cross-reference during type resolution.

### Gaps by Language

| Language | Missing | Phase |
|----------|---------|-------|
| Swift | For-loop binding, pattern binding, assignment chains | 7+ |
| Go | Call expression as range iterable | 7A |
| PHP | `@var` scope propagation, chained property access | 7B, 8 |
| Rust | Struct pattern destructuring | 7C |
| All | Field-type resolution | 8 |
| All | Return-type-aware variable binding | 9 |
