const { formatError } = require("../error");
const { functionAnnotationToNode } = require("./parse-types");

const nodesToCommands = ({ nodes, file }) => {
  // We do a rough sort by line number to intersperse the comments containing
  // type definitions in the right order
  return (
    nodes
      .sort((a, b) => {
        if (a.type !== "CommentLine" && b.type !== "CommentLine") {
          // keep same order for non-comments ordering
          return 0;
        }
        return a.loc.start.line - b.loc.start.line;
      })
      .map((node) =>
        translateNode({
          n: node,
          isGlobal: true,
          file,
        })
      )
      // if node is an unrelated comment it'll be null
      .filter(Boolean)
  );
};

const translateNode = ({
  n,
  leadingComment,
  bindName,
  isGlobal = false,
  siblings,
  file = "current",
}) => {
  switch (n.type) {
    case "BlockStatement": {
      const { body } = n;

      if (body.length < 1) {
        throw formatError({
          loc: n.loc,
          message: "Empty body not allowed.",
        });
      }

      const returnStatement = body[body.length - 1];

      if (returnStatement.type !== "ReturnStatement") {
        throw formatError({
          loc: returnStatement.loc,
          message: "Block must end with a return statement.",
        });
      }

      if (body.length === 1) {
        return translateNode({
          n: returnStatement,
        });
      }

      return translateNode({
        n: body[0],
        siblings: body.slice(1),
      });
    }

    case "ReturnStatement": {
      return translateNode({ n: n.argument });
    }

    case "VariableDeclaration": {
      if (n.kind !== `const` && n.kind !== `let`) {
        throw formatError({
          loc: n.loc,
          message: `${n.kind} cannot be used to declare a variable. Use let or const.`,
        });
      }
      const { declarations, leadingComments } = n;
      if (declarations.length !== 1) {
        throw formatError({
          loc: n.loc,
          message: "Only single declarations allowed.",
        });
      }

      const varDeclarator = declarations[0];
      if (varDeclarator.type !== "VariableDeclarator") {
        throw formatError({
          loc: n.loc,
          message:
            "Variable declaration must be followed by a variable declarator",
        });
      }

      const { id, init } = varDeclarator;
      if (id.type !== "Identifier") {
        throw formatError({
          loc: id.loc,
          message: "Only simple variable assignments allowed (for now)",
        });
      }

      const name = id.name;

      if (isGlobal) {
        return {
          tag: "Bind",
          info: { loc: n.loc },
          name,
          binding: {
            tag: "TmDecBind",
            term: translateNode({
              n: init,
              leadingComment:
                leadingComments && leadingComments[leadingComments.length - 1],
              bindName: name,
            }),
            nameInfo: { loc: id.loc },
            file,
            // type?: Type --> TODO: if we want to allow type notations it would be done here
          },
        };
      }
      return {
        tag: "TmLet",
        info: { loc: n.loc },
        name,
        nameInfo: { loc: id.loc },
        t1: translateNode({
          n: init,
        }),
        t2: translateNode({
          n: siblings[0],
          siblings: siblings.slice(1),
        }),
      };
    }

    case "ArrowFunctionExpression": {
      const paramsLength = n.params.length;
      if (paramsLength > 1) {
        throw formatError({
          loc: n.params[1].loc,
          message: "Functions can only have one argument",
        });
      }

      const type =
        leadingComment &&
        leadingComment.loc.end.line === n.loc.start.line - 1 &&
        translateNode({
          n: getCommentTypeNode({
            comment: leadingComment,
            name: bindName,
          }),
        });

      if (type && type.tag !== "TypeArrow" && type.tag !== "TypeAbs") {
        throw formatError({
          loc: leadingComment.loc,
          message: "Function annotation missing return type",
        });
      }

      if (paramsLength === 0) {
        return {
          tag: "TmAbs",
          info: { loc: n.loc },
          var: null,
          type,
          term: translateNode({ n: n.body }),
        };
      }

      const param = n.params[0];
      return {
        tag: "TmAbs",
        info: { loc: n.loc },
        var: {
          name: param.name,
          info: { loc: param.loc },
        },
        type,
        term: translateNode({ n: n.body }),
      };
    }

    case "ConditionalExpression": {
      const { test, consequent, alternate } = n;
      return {
        tag: "TmIf",
        info: { loc: n.loc },
        t1: translateNode({ n: test }),
        t2: translateNode({ n: consequent }),
        t3: translateNode({ n: alternate }),
      };
    }

    case "Identifier": {
      return {
        tag: "TmVar",
        info: { loc: n.loc },
        name: n.name,
      };
    }

    case "ObjectExpression": {
      const { properties, loc } = n;
      const [firstProperty, ...restProperties] = properties;

      let initProperty;
      let iterateProperties;
      if (firstProperty && firstProperty.type === "SpreadElement") {
        initProperty = translateNode({ n: firstProperty.argument });
        iterateProperties = restProperties || [];
      } else {
        initProperty = { tag: "TmRecordEmpty", info: { loc } };
        iterateProperties = properties;
      }

      const record = iterateProperties.reduce((record, property) => {
        if (property.type === "SpreadElement") {
          throw formatError({
            loc: property.loc,
            message: "Spread operator only allowed before declared fields",
          });
        }
        if (property.type === "Property") {
          if (property.computed) {
            throw formatError({
              loc: property.key.loc,
              message: "Computed fields not supported (currently)",
            });
          }
          return {
            tag: "TmRecordExtend",
            info: { loc: property.loc },
            key: property.key.name,
            extensionRow: translateNode({ n: property.value }),
            record,
          };
        }
        throw formatError({
          loc: property.key.loc,
          message: `Unknown property type ${property.type}`,
        });
      }, initProperty);
      return record;
    }

    case "ArrayExpression": {
      const { loc, elements } = n;
      return {
        tag: "TmArray",
        info: { loc },
        elements: elements.map((e) => translateNode({ n: e })),
      };
    }

    case "MemberExpression": {
      const { computed, object, property, loc } = n;
      if (computed) {
        throw formatError({
          loc: property.loc,
          message: "Computed fields not supported (currently)",
        });
      }
      return {
        tag: "TmRecordSelect",
        info: { loc },
        record: translateNode({ n: object }),
        key: property.name,
      };
    }

    case "Literal": {
      switch (typeof n.value) {
        case "boolean":
          return {
            tag: "TmBool",
            info: { loc: n.loc },
          };

        case "number":
          if (Number.isNaN(n.value)) {
            throw formatError({
              loc: n.loc,
              message: "NaN is not allowed",
            });
          }
          return {
            tag: "TmNumber",
            info: { loc: n.loc },
          };

        case "string":
          return {
            tag: "TmString",
            info: { loc: n.loc },
          };

        default:
          throw formatError({
            loc: n.loc,
            message: `Unknown literal type ${typeof n.value}`,
          });
      }
    }

    case "BinaryExpression": {
      switch (n.operator) {
        case "+":
        case "-":
        case "*":
        case "/":
        case "%": {
          const left = translateNode({ n: n.left });
          return {
            tag: "TmApp",
            info: { loc: n.loc },
            t1: {
              tag: "TmApp",
              info: left.info,
              t1: {
                tag: "TmVar",
                info: { loc: negLoc },
                name: "Number##binaryOp",
              },
              t2: left,
            },
            t2: translateNode({ n: n.right }),
          };
        }

        default:
          throw formatError({
            loc: n.loc,
            message: `Unknown operator ${n.operator}`,
          });
      }
    }

    case "ExpressionStatement": {
      return {
        tag: "Eval",
        info: { loc: n.loc },
        term: translateNode({ n: n.expression }),
      };
    }

    case "CallExpression": {
      const argumentsLength = n.arguments.length;
      if (argumentsLength > 1) {
        throw formatError({
          loc: n.arguments[1].loc,
          message: "Functions cannot have more than one argument",
        });
      }
      const argument =
        argumentsLength === 0
          ? { tag: "Tm()", info: { loc: n.loc } }
          : translateNode({ n: n.arguments[0] });

      return {
        tag: "TmApp",
        info: { loc: n.loc },
        t1: translateNode({ n: n.callee }),
        t2: argument,
      };
    }

    /* Types (not part of JS AST) */

    case "TypeDeclaration": {
      const { id, init } = n;

      const { name, loc } = id;

      let type = translateNode({ n: init });

      // add name onto global records for nice printing
      if (file === "global") {
        if (type.tag === "TypeRecord") {
          type.name = name;
        } else if (type.tag === "TypeAbs" && type.type.tag === "TypeRecord") {
          // single level of abstraction
          type.type.name = name;
        }
      }

      return {
        tag: "Bind",
        info: { loc },
        name,
        binding: {
          tag: "TypeDecBind",
          type,
          nameInfo: { loc },
          file,
        },
      };
    }

    case "TypeArrow": {
      const { argument, body } = n;
      return {
        tag: "TypeArrow",
        argType: translateNode({ n: argument }),
        returnType: translateNode({ n: body }),
      };
    }
    case "TypeAbstraction": {
      const { params, body } = n;

      const bodyType = translateNode({ n: body });

      return params.reduceRight((type, { name, loc }) => {
        return {
          tag: "TypeAbs",
          name,
          type,
          info: { loc },
        };
      }, bodyType);
    }

    case "TypeApplication": {
      const { callee, arguments: args } = n;

      const calleeType = translateNode({ n: callee });

      const argumentTypes = args.map((arg) => translateNode({ n: arg }));

      return argumentTypes.reduceRight((type, argType, index) => {
        return {
          tag: "TypeApp",
          t1: type,
          t2: argType,
          info: {
            loc: { start: type.info.loc.start, end: args[index].loc.end },
          },
        };
      }, calleeType);
    }

    case "TypeIdentifier":
    case "TypeParameter": {
      const { loc, name } = n;
      return {
        tag: "TypeVar",
        info: { loc },
        name,
      };
    }

    case "TypeArray": {
      const { loc } = n;
      return {
        tag: "TypeApp",
        info: { loc },
        t1: { tag: "TypeVar", name: "Array", info: { loc } },
        t2: translateNode({ n: n.elements }),
      };
    }

    case "TypeRecord": {
      const { properties, loc } = n;
      const [firstProperty, ...restProperties] = properties;

      let initProperty;
      let iterateProperties;
      if (firstProperty && firstProperty.type === "TypeSpread") {
        initProperty = translateNode({ n: firstProperty.argument });
        iterateProperties = restProperties || [];
      } else {
        initProperty = { tag: "TypeRecordRowEmpty", info: { loc } };
        iterateProperties = properties;
      }

      const rowType = iterateProperties.reduce((baseRow, property) => {
        if (property.type === "TypeSpread") {
          throw formatError({
            loc: property.loc,
            message: "Spread operator only allowed before declared fields",
          });
        }
        if (property.type === "TypeProperty") {
          return {
            tag: "TypeRecordRowExtend",
            key: property.key.name,
            extensionRow: translateNode({ n: property.value }),
            baseRow,
          };
        }
        throw formatError({
          loc: property.key.loc,
          message: `Unknown property type ${property.type}`,
        });
      }, initProperty);

      return {
        tag: "TypeRecord",
        row: rowType,
      };
    }

    case "TypeGlobal": {
      const { name, value } = n;

      return {
        tag: "Bind",
        info: {
          loc: negLoc,
        },
        name,
        binding: { tag: "VarBind", type: translateNode({ n: value }), file },
      };
    }

    default:
      throw formatError({
        loc: n.loc,
        message: `Unknown type ${n.type}`,
      });
  }
};

const getCommentTypeNode = ({ comment, name }) => {
  if (comment.type !== "CommentLine") {
    throw formatError({
      loc: comment.loc,
      message: "Function annotations must use //",
    });
  }

  return functionAnnotationToNode({ varName: name, comment: comment.value });
};

// So that these elements can't be looked up
const negLoc = {
  start: { line: -1, column: -1 },
  end: { line: -1, column: -1 },
};

module.exports = {
  nodesToCommands,
};
