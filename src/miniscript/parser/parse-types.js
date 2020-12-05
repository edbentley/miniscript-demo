const P = require("parsimmon");
const { formatError } = require("../error");

const textParser = P.seq(P.index, P.regexp(/\w+/), P.index);

const CreateLang = ({ toLoc, varName }) =>
  P.createLanguage({
    Declaration: (r) => {
      return P.seq(
        P.optWhitespace,
        P.string("type"),
        P.whitespace,
        r.VarName,
        r.GenericParamsDeclaration,
        P.optWhitespace,
        P.string("="),
        P.optWhitespace,
        r.ArrowValue,
        P.alt(P.whitespace, P.string(";")),
        P.optWhitespace
      ).map((x) => {
        const varName = x[3];
        const params = x[4];
        let value = x[8];

        if (params && Array.isArray(params)) {
          value = {
            type: "TypeAbstraction",
            params,
            body: value,
          };
        }

        return {
          type: "TypeDeclaration",
          id: varName,
          init: value,
        };
      });
    },

    Annotation: (r) => {
      return P.seq(
        P.optWhitespace,
        r.FuncName,
        r.GenericParamsDeclaration,
        P.optWhitespace,
        P.string("::"),
        P.whitespace,
        r.ArrowValue,
        P.optWhitespace
      ).map((x) => {
        const params = x[2];
        const value = x[6];

        if (params && Array.isArray(params)) {
          return {
            type: "TypeAbstraction",
            params,
            body: value,
          };
        }

        return value;
      });
    },

    GlobalAnnotation: (r) => {
      // an annotation where the varName is not known beforehand
      // returns the type and varName
      // varName can contain # for a unique namespace
      return P.seq(
        P.optWhitespace,
        P.seq(P.index, P.regexp(/[#\w]+/), P.index),
        r.GenericParamsDeclaration,
        P.optWhitespace,
        P.string("::"),
        P.whitespace,
        r.ArrowValue,
        P.optWhitespace
      ).map((x) => {
        const [, parsedVarName] = x[1];
        const params = x[2];
        const value = x[6];

        if (params && Array.isArray(params)) {
          return {
            value: {
              type: "TypeAbstraction",
              params,
              body: value,
            },
            varName: parsedVarName,
          };
        }

        return { value, varName: parsedVarName };
      });
    },

    FuncName: () => {
      return P.seq(P.index, P.string(varName), P.index);
    },

    VarName: () => {
      return P.seq(
        P.index,
        P.alt(P.regexp(/[A-Z]\w*/), P.string("()")),
        P.index
      ).map((x) => {
        const [start, typeStr, end] = x;
        return {
          type: "TypeIdentifier",
          loc: toLoc({ start, end }),
          name: typeStr,
        };
      });
    },

    GenericParamsDeclaration: (r) => {
      return P.alt(
        r.GenericParams.wrap(P.string("<"), P.string(">")),
        P.optWhitespace
      );
    },

    GenericParams: (r) => {
      return P.alt(
        P.seq(
          r.GenericParam,
          P.string(","),
          P.whitespace,
          r.GenericParams
        ).map(([p, , , params]) => [p, ...params]),
        r.GenericParam.map((x) => [x])
      );
    },

    GenericParam: () => {
      return textParser.map(([start, name, end]) => {
        return {
          type: "TypeParameter",
          name,
          loc: toLoc({ start, end }),
        };
      });
    },

    ArrowValue: (r) => {
      return P.alt(
        P.seq(
          P.string("("),
          r.ArrowValue,
          P.seq(P.string(")"), P.whitespace, P.string("->"), P.whitespace),
          r.Value
        ).map(([, argument, , body]) => {
          return {
            type: "TypeArrow",
            argument,
            body,
          };
        }),
        P.seq(
          r.Value,
          P.seq(P.whitespace, P.string("->"), P.whitespace),
          r.ArrowValue
        ).map(([argument, , body]) => {
          return {
            type: "TypeArrow",
            argument,
            body,
          };
        }),
        r.Value
      );
    },

    Value: (r) => {
      return P.alt(r.Array, r.ValueNotArray);
    },

    ValueNotArray: (r) => {
      return P.alt(r.TypeApplication, r.Record, r.TypeIdentifier);
    },

    TypeApplication: (r) => {
      return P.seq(
        r.TypeIdentifier,
        r.GenericArgs.wrap(P.string("<"), P.string(">"))
      ).map(([callee, args]) => {
        return {
          type: "TypeApplication",
          callee,
          arguments: args,
        };
      });
    },

    GenericArgs: (r) => {
      return P.alt(
        P.seq(
          r.ArrowValue,
          P.string(","),
          P.whitespace,
          r.GenericArgs
        ).map(([p, , , params]) => [p, ...params]),
        r.ArrowValue.map((x) => [x])
      );
    },

    TypeIdentifier: () => {
      return P.alt(textParser, P.seq(P.index, P.string("()"), P.index)).map(
        ([start, name, end]) => ({
          type: "TypeIdentifier",
          name,
          loc: toLoc({ start, end }),
        })
      );
    },

    Array: (r) => {
      return P.seq(
        P.index,
        P.alt(r.ArrowValue.wrap(P.string("("), P.string(")")), r.ValueNotArray),
        P.string("[]").atLeast(1),
        P.index
      ).map(([start, value, arrays, end]) => {
        return arrays.reduce((out, _, index) => {
          const endOffsetted = {
            ...end,
            column: end.column - 2 * (arrays.length - index - 1),
          };
          return {
            type: "TypeArray",
            loc: toLoc({ start, end: endOffsetted }),
            elements: out,
          };
        }, value);
      });
    },

    Record: (r) => {
      return r.RecordFields.wrap(P.string("{"), P.string("}")).map(
        (properties) => ({
          type: "TypeRecord",
          properties: Array.isArray(properties) ? properties : [],
        })
      );
    },

    RecordFields: (r) => {
      return P.alt(
        P.seq(
          r.RecordField,
          P.string(","),
          r.RecordFields
        ).map(([f, , fields]) => [f, ...fields]),
        r.RecordField.map((x) => [x]),
        P.optWhitespace
      );
    },

    RecordField: (r) => {
      return P.alt(
        P.seq(
          P.optWhitespace,
          P.index,
          P.string("..."),
          r.TypeIdentifier,
          P.index,
          P.optWhitespace
        ).map((x) => {
          const start = x[1];
          const end = x[4];
          const argument = x[3];

          return {
            type: "TypeSpread",
            argument,
            loc: toLoc({ start, end }),
          };
        }),
        P.seq(
          P.optWhitespace,
          P.index,
          textParser,
          r.GenericParamsDeclaration,
          P.string(":"),
          P.whitespace,
          r.ArrowValue,
          P.index,
          P.optWhitespace
        ).map((x) => {
          const start = x[1];
          const end = x[7];
          const [fieldNameStart, fieldName, fieldNameEnd] = x[2];
          const params = x[3];
          let value = x[6];

          if (params && Array.isArray(params)) {
            value = {
              type: "TypeAbstraction",
              params,
              body: value,
            };
          }

          return {
            type: "TypeProperty",
            key: {
              name: fieldName,
              loc: toLoc({ start: fieldNameStart, end: fieldNameEnd }),
            },
            value,
            loc: toLoc({ start, end }),
          };
        })
      );
    },
  });

/**
 * Convert a block of type declarations to nodes
 *
 * e.g.
 * ```
 * type X = number
 * type Id<a> = a -> Bar<a, number>
 * type Add = Id<string>
 * type Foo<a, b> = Bar<a, b>
 * type Record<a, b, r> = { ...r, x: a, y: b }
 * type NumArray<a> = a[]
 * ```
 */
const typeCommentsToNodes = (commentBlock) => {
  if (!commentBlock) {
    return [];
  }

  const { value: code, loc } = commentBlock;
  const lineOffset = loc.start.line - 1;
  const toLoc = blockToLoc(lineOffset);

  const parser = CreateLang({ toLoc }).Declaration.many();

  const out = parser.parse(code);

  if (!out.status) {
    const { line, column } = out.index;
    throw formatError({
      loc: { start: { line, column }, end: { line, column: column + 1 } },
      message: `Expected ${out.expected.join(" or ")}`,
    });
  }

  return out.value;
};

/**
 * Convert a function annotation to node
 *
 * If no varName supplied, will return { varName, value }
 *
 * e.g.
 * - `addOne :: number -> number`
 * - `addOne<a, b> :: a -> X<b -> string>`
 * - `addOne :: { x: number } -> number`
 */
const functionAnnotationToNode = ({ varName, comment }) => {
  const parser = varName
    ? CreateLang({ toLoc: lineToLoc, varName }).Annotation
    : CreateLang({ toLoc: lineToLoc }).GlobalAnnotation;

  const out = parser.parse(comment);

  if (!out.status) {
    const { line, column } = out.index;
    throw formatError({
      loc: { start: { line, column }, end: { line, column: column + 1 } },
      message: `Expected ${out.expected.join(" or ")}`,
    });
  }

  return out.value;
};

// line comments add 2 to index since the // gets stripped
// then convert 1-index to 0-index
const lineToLoc = ({ start, end }) => ({
  start: { line: start.line, column: start.column + 1 },
  end: { line: end.line, column: end.column + 1 },
});

const blockToLoc = (lineOffset) => ({ start, end }) => ({
  start: { line: start.line + lineOffset, column: start.column - 1 },
  end: { line: end.line + lineOffset, column: end.column - 1 },
});

module.exports = { typeCommentsToNodes, functionAnnotationToNode };
