# How MiniScript Works

The api ([api.js](./api.js)) works in the following way:

```
Parser ---> Type Checker ---> Printer
```

## Parser

First esprima is used to parse the JavaScript code to generate a standard JS
AST.

The initial code block is then given to [parse-types.js](./parse-types.js),
which adds onto the JS AST with some MiniScript specific Type Nodes,
[similar to estree](https://github.com/estree/estree/blob/master/es5.md):

```js
type TypeDeclaration = {
  type: "TypeDeclaration",
  id: TypeUnificationVar,
  init: TypeExpression
}

type TypeArrow = {
  type: "TypeArrow",
  argument: TypeIdentifier,
  body: TypeArrow | TypeIdentifier
}

type TypeAbstraction = {
  type: "TypeAbstraction",
  params: [TypeParameter],
  body: Type
}

type TypeApplication = {
  type: "TypeApplication",
  callee: Type,
  arguments: [Type]
}

type TypeIdentifier = {
  type: "TypeIdentifier",
  name: string,
  loc: Location
}

type TypeArray = {
  type: "TypeArray",
  elements: Type,
  loc: Location
}

type TypeRecord = {
  type: "TypeRecord",
  properties: TypeProperty
}

type TypeProperty = {
  type: "TypeProperty",
  key: {
    name: string,
    loc: Loc
  },
  value: Type,
  loc: Location
}

type TypeSpread = {
  type: "TypeSpread",
  argument: Type,
  loc: Location
}

type TypeParameter = {
  type: "TypeParameter",
  name: string,
  loc: Location
}

type TypeGlobal = {
  type: "TypeGlobal",
  name: string,
  value: Type
}
```

This JS + Types AST is transformed in ([transform-ast.js](./transform-ast.js)) into **Commands**, which can be seen as the root nodes of the MiniScript AST. Any valid JS that is not part of MiniScript will throw an error here.

Commands are in two forms:

- `Eval`: the evaluation of a term. Has to have side-effects to do anything useful.
- `Bind`: attaching a **Binding** to a variable name, which is then put in the Context

Bindings are an association betwen a variable name and its value. The name of the binding is stored in the Context as a map `{ name: Binding }`. We have the following term bindings:

- `VarBind`: a binding for an argument of a function. For example `x` in `const id = x => x`. This binding stores a type for the argument (can be a placeholder for type inference).
- `TmDecBind`: a binding for a variable declaration. For example `x` in `const x = 5`. The term on the RHS of the equals is stored in the binding (term `5` in this case).

And type bindings:

- `TypeVarBind`: a type variable in polymorphism. For example `a` in the function type annotation `// id<a> :: a -> a`.
- `TypeDecBind`: a binding for a type variable declaration. For example `X` in `type X = string`.

The terms and types contained within the bindings can be seen in the Type Checker.

### Polymorphism

Consider the function annotation:

```js
// id<a> :: a -> a
const id = x => x;
```

We actually interpret this like a 'type function' (or abstraction):

```js
const id = a -> x => x;
```

The output command is (location info omitted):

```JSON
[
  {
    "tag": "Bind",
    "name": "id",
    "binding": {
      "tag": "TmDecBind",
      "term": {
        "tag": "TmTypeAbstraction",
        "typeVarName": "a",
        "term": {
          "tag": "TmAbs",
          "varName": "x",
          "type": {
            "tag": "TypeAbs",
            "name": "a",
            "type": {
              "tag": "TypeArrow",
              "argType": {
                "tag": "TypeVar",
                "name": "a"
              },
              "returnType": {
                "tag": "TypeVar",
                "name": "a"
              }
            }
          },
          "term": {
            "tag": "TmVar",
            "name": "x"
          }
        }
      }
    }
  }
]
```
