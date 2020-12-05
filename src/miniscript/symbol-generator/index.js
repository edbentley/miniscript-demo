const { printType } = require("../typechecker/print-type");
const { typeSubstitution } = require("../typechecker/substitution");

/*
type Symbol = {
  tag:
    | "VariableDeclaration"
    | "FunctionArgumentDeclaration"
    | "VariableUsage"
    | "Builtin"
    | "TypeVariableDeclaration"
  name: string;
  type: string;
  rawType: Type;
  generics?: string[];
}

type Meta = {
  line: number;
  character: number;
}
*/

/**
 * Takes a context, commands and location in the source code. Returns
 * information about the symbol at the location, such as type.
 *
 * In meta, line number is 1-index and character is 0-index (consistent with
 * esprima)
 */
function getSymbol({ ctx, commands, meta }) {
  const rootCtxEntry = Object.entries(ctx).find(([, binding]) => {
    if (binding.file === "global") return false;
    switch (binding.tag) {
      case "TmDecBind":
        return (
          isInInfo({ info: binding.term.info, meta }) ||
          isInInfo({ info: binding.nameInfo, meta })
        );
      case "TypeDecBind":
        return isInInfo({ info: binding.nameInfo, meta });

      default:
        return false;
    }
  });

  if (!rootCtxEntry) {
    // See if we can find it in any of the Eval commands
    const evalCommand = commands.find(
      (c) => c.tag === "Eval" && isInInfo({ info: c.info, meta })
    );
    if (!evalCommand) return null;
    return getSymbolFromTerm({
      term: evalCommand.term,
      nestedCtx: ctx,
      meta,
    });
  }

  const [name, binding] = rootCtxEntry;

  switch (binding.tag) {
    case "TmDecBind": {
      if (isInInfo({ info: binding.nameInfo, meta })) {
        const [typeDisplay, generics] = printType({ type: binding.type });
        return {
          tag: "VariableDeclaration",
          name,
          type: typeDisplay,
          rawType: binding.type,
          generics,
        };
      }
      return getSymbolFromTerm({
        term: binding.term,
        termType: binding.type,
        nestedCtx: binding.nestedCtx,
        meta,
      });
    }
    case "TypeDecBind": {
      const [typeDisplay, generics] = printType({ type: binding.type });
      return {
        tag: "TypeVariableDeclaration",
        name,
        type: typeDisplay,
        rawType: binding.type,
        generics,
      };
    }

    default:
      return null;
  }
}

function getSymbolFromTerm({ term, termType, nestedCtx, meta }) {
  if (
    !isInInfo({ info: term.info, meta }) &&
    // terms within TmLet t2 are outside of term.info
    term.tag !== "TmLet"
  )
    return null;

  switch (term.tag) {
    case "TmAbs": {
      if (term.var && isInInfo({ info: term.var.info, meta })) {
        // Symbol is function argument declaration
        const type = findTypeInNestedCtx({
          ctx: nestedCtx,
          name: term.var.name,
        });
        if (!type) return null;
        const [typeDisplay, generics] = printType({ type });
        return {
          tag: "FunctionArgumentDeclaration",
          name: term.var.name,
          type: typeDisplay,
          rawType: type,
          generics,
        };
      }
      return getSymbolFromTerm({ term: term.term, nestedCtx, meta });
    }
    case "TmVar": {
      const type = findTypeInNestedCtx({ ctx: nestedCtx, name: term.name });
      if (!type) return null;
      const [typeDisplay, generics] = printType({ type });
      return {
        tag: "VariableUsage",
        name: term.name,
        type: typeDisplay,
        rawType: type,
        generics,
      };
    }
    case "TmApp": {
      const { t1, t2 } = term;
      if (isInInfo({ info: t1.info, meta })) {
        const symbol = getSymbolFromTerm({ term: t1, nestedCtx, meta });
        if (!symbol) return null;

        // Check if t1 was an abstract type and applied against another type
        if (symbol.rawType.tag === "TypeAbs") {
          const typeVarName = symbol.rawType.name;

          // TODO: termType is available for top-level bindings, but there's no
          // easy way to get this within abstraction currently
          if (!termType) return null;

          const typeVarType = termType.subbedTypes[typeVarName];

          if (!typeVarType) return null;

          const substitutedType = typeSubstitution({
            typeName: symbol.rawType.name,
            substitutionType: typeVarType,
            type: symbol.rawType.type,
          });
          const [typeDisplay, generics] = printType({ type: substitutedType });
          return {
            ...symbol,
            type: typeDisplay,
            rawType: substitutedType,
            generics,
          };
        }
        return symbol;
      }
      if (isInInfo({ info: t2.info, meta })) {
        return getSymbolFromTerm({ term: t2, nestedCtx, meta });
      }
      return null;
    }

    case "TmIf": {
      const { t1, t2, t3 } = term;
      if (isInInfo({ info: t1.info, meta })) {
        return getSymbolFromTerm({ term: t1, nestedCtx, meta });
      }
      if (isInInfo({ info: t2.info, meta })) {
        return getSymbolFromTerm({ term: t2, nestedCtx, meta });
      }
      if (isInInfo({ info: t3.info, meta })) {
        return getSymbolFromTerm({ term: t3, nestedCtx, meta });
      }
      return null;
    }

    case "TmLet": {
      const { t1, t2, name } = term;
      if (isInInfo({ info: term.nameInfo, meta })) {
        const type = findTypeInNestedCtx({
          ctx: nestedCtx,
          name: term.name,
        });
        if (!type) return null;
        const [typeDisplay, generics] = printType({ type });
        return {
          tag: "VariableDeclaration",
          name: term.name,
          type: typeDisplay,
          rawType: type,
          generics,
        };
      }
      if (isInInfo({ info: t1.info, meta })) {
        return getSymbolFromTerm({
          term: t1,
          nestedCtx: nestedCtx[name].nestedCtx || nestedCtx,
          meta,
        });
      }
      return getSymbolFromTerm({ term: t2, nestedCtx, meta });
    }

    case "TmRecordSelect": {
      return getSymbolFromTerm({ term: term.record, nestedCtx, meta });
    }

    case "TmRecordExtend": {
      const { record, extensionRow } = term;
      if (
        record.tag !== "TmRecordEmpty" &&
        isInInfo({ info: record.info, meta })
      ) {
        return getSymbolFromTerm({ term: record, nestedCtx, meta });
      }
      return getSymbolFromTerm({ term: extensionRow, nestedCtx, meta });
    }

    case "TmRecordEmpty": {
      const rawType = { tag: "TypeRecordRowEmpty" };
      const [typeDisplay, generics] = printType({ type: rawType });
      return {
        tag: "Builtin",
        name: "",
        type: typeDisplay,
        rawType: rawType,
        generics,
      };
    }

    case "TmString": {
      const rawType = {
        tag: "TypeVar",
        name: "String",
      };
      const [typeDisplay, generics] = printType({ type: rawType });
      return {
        tag: "Builtin",
        name: "",
        type: typeDisplay,
        rawType: rawType,
        generics,
      };
    }
    case "TmNumber": {
      const rawType = {
        tag: "TypeVar",
        name: "Number",
      };
      const [typeDisplay, generics] = printType({ type: rawType });
      return {
        tag: "Builtin",
        name: "",
        type: typeDisplay,
        rawType: rawType,
        generics,
      };
    }
    case "TmBool": {
      const rawType = {
        tag: "TypeVar",
        name: "Boolean",
      };
      const [typeDisplay, generics] = printType({ type: rawType });
      return {
        tag: "Builtin",
        name: "",
        type: typeDisplay,
        rawType: rawType,
        generics,
      };
    }

    default:
      return null;
  }
}

function findTypeInNestedCtx({ ctx, name }) {
  const ctxEntry = Object.entries(ctx).find(([ctxName]) => name === ctxName);
  if (!ctxEntry) return null;
  const [, value] = ctxEntry;
  return value.type;
}

function isInInfo({ info, meta: { line, character } }) {
  const onSameLine = info.loc.end.line === info.loc.start.line;
  const withinStartColumn = character >= info.loc.start.column;
  const withinEndColumn = character <= info.loc.end.column;

  if (onSameLine) {
    return info.loc.end.line === line && withinStartColumn && withinEndColumn;
  }

  if (info.loc.start.line === line) {
    return withinStartColumn;
  }

  if (info.loc.end.line === line) {
    return withinEndColumn;
  }

  return line > info.loc.start.line && line < info.loc.end.line;
}

module.exports = {
  getSymbol,
};
