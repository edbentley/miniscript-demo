const { formatError } = require("../error");
const { getNextTypeVar, addBinding } = require("./utils");

// substitute term s for variable j in term t
// [j->s]t
const termSubstitution = ({ varName, substitutionTerm, term: rootTerm }) => {
  const walk = (term) => {
    switch (term.tag) {
      // if the variable matches the variable name we are trying to
      // substitute, then simply substitute it in.
      case "TmVar": {
        if (term.name === varName) {
          return substitutionTerm;
        }
        return term;
      }

      case "TmAbs":
        return {
          ...term,
          term: walk(term.term),
        };

      case "TmApp":
      case "TmLet":
        return {
          ...term,
          t1: walk(term.t1),
          t2: walk(term.t2),
        };

      case "TmRecordExtend":
        return {
          ...term,
          extensionRow: walk(term.extensionRow),
          record: walk(term.record),
        };

      case "TmRecordSelect":
        return {
          ...term,
          record: walk(term.record),
        };

      case "TmIf":
        return {
          ...term,
          t1: walk(term.t1),
          t2: walk(term.t2),
          t3: walk(term.t3),
        };

      case "TmRecordEmpty":
      case "TmBool":
      case "TmString":
      case "TmNumber":
      case "Tm()":
        return term;
    }
  };

  return walk(rootTerm);
};

// Same idea as term subtitution
const typeSubstitution = ({ typeName, substitutionType, type: rootType }) => {
  const walk = (type) => {
    switch (type.tag) {
      case "TypeVar": {
        if (type.name === typeName) {
          return substitutionType;
        }
        return type;
      }

      case "TypeUnificationVar":
        if (type.id === typeName) {
          return substitutionType;
        }
        return type;

      case "TypeRecordRowEmpty":
        return type;

      case "TypeRecord":
        return {
          ...type,
          row: walk(type.row),
        };

      case "TypeRecordRowExtend":
        return {
          ...type,
          extensionRow: walk(type.extensionRow),
          baseRow: walk(type.baseRow),
        };

      case "TypeArrow":
        return {
          tag: "TypeArrow",
          argType: walk(type.argType),
          returnType: walk(type.returnType),
        };

      case "TypeAbs":
        return {
          ...type,
          type: walk(type.type),
        };

      case "TypeApp":
        return {
          ...type,
          t1: walk(type.t1),
          t2: walk(type.t2),
        };
    }
  };

  return walk(rootType);
};

/**
 * Substitute a type into the ctx
 */
const ctxTypeSubstitution = ({ typeName, substitutionType, ctx }) => {
  return Object.entries(ctx).reduce((ctxSubs, [name, binding]) => {
    return {
      ...ctxSubs,
      [name]: binding.type
        ? {
            ...binding,
            type: typeSubstitution({
              typeName,
              substitutionType,
              type: binding.type,
            }),
          }
        : binding,
    };
  }, {});
};

/**
 * Fully remove all unification vars by substituting in principal types, and
 * then replacing any remaining vars with type vars.
 */
const subUnificationVars = ({ principalTypes, type, ctx, info }) => {
  const {
    type: substitutedType,
    ctx: substitutedNestedCtx,
  } = substitutePrincipalTypes({
    principalTypes,
    type,
    ctx,
  });

  const mutableTypeVariables = {};
  const {
    type: noUnificationVarsSubsType,
    ctx: finalCtx,
  } = replaceUnificationVarsWithTypeVars({
    type: substitutedType,
    mutableTypeVariables,
    ctx: substitutedNestedCtx,
    info,
  });
  const finalType = Object.values(mutableTypeVariables).reduce(
    (currType, typeVar) => ({
      tag: "TypeAbs",
      name: typeVar.name,
      type: currType,
    }),
    noUnificationVarsSubsType
  );
  return {
    type: finalType,
    ctx: finalCtx,
  };
};

/**
 * Substitute each principal type unification var one by one into the type, ctx
 * and the rest of the principal types
 */
const substitutePrincipalTypes = ({ principalTypes, type, ctx }) => {
  if (principalTypes.length === 0) {
    return { type, ctx };
  }
  const [[LHS, RHS], ...restPrincipalTypes] = principalTypes;

  if (LHS.tag === "TypeUnificationVar") {
    const nextSubsType = getSubstitutedType({
      typeName: LHS.id,
      subType: RHS,
      intoType: type,
    });
    const nextPrincipalTypes = getSubstitutedConstraints({
      typeName: LHS.id,
      type: RHS,
      constraints: restPrincipalTypes,
    });
    const nextCtx = ctxTypeSubstitution({
      ctx,
      typeName: LHS.id,
      substitutionType: RHS,
    });
    return substitutePrincipalTypes({
      principalTypes: nextPrincipalTypes,
      type: nextSubsType,
      ctx: nextCtx,
    });
  }
  if (RHS.tag === "TypeUnificationVar") {
    const nextSubsType = getSubstitutedType({
      typeName: RHS.id,
      subType: LHS,
      intoType: type,
    });
    const nextPrincipalTypes = getSubstitutedConstraints({
      typeName: RHS.id,
      type: LHS,
      constraints: restPrincipalTypes,
    });
    const nextCtx = ctxTypeSubstitution({
      ctx,
      typeName: RHS.id,
      substitutionType: LHS,
    });
    return substitutePrincipalTypes({
      principalTypes: nextPrincipalTypes,
      type: nextSubsType,
      ctx: nextCtx,
    });
  }
  return { type, ctx };
};

const getSubstitutedConstraints = ({
  typeName,
  originalName,
  type,
  constraints,
}) => {
  return constraints.map(([LHS, RHS]) => [
    getSubstitutedType({
      typeName,
      originalName,
      subType: type,
      intoType: LHS,
    }),
    getSubstitutedType({
      typeName,
      originalName,
      subType: type,
      intoType: RHS,
    }),
  ]);
};

const getSubstitutedType = ({ typeName, originalName, subType, intoType }) => {
  switch (intoType.tag) {
    case "TypeArrow":
      // walk down tree of arrow functions
      return {
        tag: "TypeArrow",
        argType: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.argType,
        }),
        returnType: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.returnType,
        }),
      };

    case "TypeRecord":
      return {
        ...intoType,
        row: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.row,
        }),
      };

    case "TypeRecordRowExtend":
      return {
        ...intoType,
        extensionRow: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.extensionRow,
        }),
        baseRow: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.baseRow,
        }),
      };

    case "TypeApp": {
      return {
        ...intoType,
        t1: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.t1,
        }),
        t2: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.t2,
        }),
      };
    }

    case "TypeRecordRowEmpty":
      // these can't contain any identifiers
      return intoType;

    case "TypeUnificationVar":
      // if it's a match return subtituted type, else return other identifier
      return typeName === intoType.id
        ? originalName
          ? {
              ...subType,
              // subbedTypes is used for type lookup outside of type checker
              subbedTypes: {
                [originalName]: subType,
              },
            }
          : subType
        : intoType;

    case "TypeVar":
      return typeName === intoType.name ? subType : intoType;

    case "TypeAbs":
      return {
        ...intoType,
        type: getSubstitutedType({
          typeName,
          subType,
          intoType: intoType.type,
        }),
      };

    default:
      throw Error(`Unknown type ${intoType.tag}`);
  }
};

/**
 * Replace remaining unification variables with type variables
 *
 * @param mutableTypeVariables A map of unification var id to type variable. Can be
 * mutated during recursion.
 */
const replaceUnificationVarsWithTypeVars = ({
  type,
  mutableTypeVariables,
  ctx,
  info,
}) => {
  switch (type.tag) {
    case "TypeArrow": {
      // walk down tree of arrow functions
      const { type: argType, ctx: argCtx } = replaceUnificationVarsWithTypeVars(
        {
          mutableTypeVariables,
          ctx,
          info,
          type: type.argType,
        }
      );
      const {
        type: returnType,
        ctx: returnCtx,
      } = replaceUnificationVarsWithTypeVars({
        mutableTypeVariables,
        ctx: argCtx,
        info,
        type: type.returnType,
      });

      return {
        type: {
          tag: "TypeArrow",
          argType,
          returnType,
        },
        ctx: returnCtx,
      };
    }

    case "TypeRecord": {
      const { type: row, ctx: rowCtx } = replaceUnificationVarsWithTypeVars({
        mutableTypeVariables,
        ctx,
        info,
        type: type.row,
      });
      return {
        type: {
          ...type,
          row,
        },
        ctx: rowCtx,
      };
    }

    case "TypeRecordRowExtend": {
      const {
        type: extensionRow,
        ctx: extensionRowCtx,
      } = replaceUnificationVarsWithTypeVars({
        mutableTypeVariables,
        ctx,
        info,
        type: type.extensionRow,
      });
      const {
        type: baseRow,
        ctx: baseRowCtx,
      } = replaceUnificationVarsWithTypeVars({
        mutableTypeVariables,
        ctx: extensionRowCtx,
        info,
        type: type.baseRow,
      });

      return {
        type: {
          ...type,
          extensionRow,
          baseRow,
        },
        ctx: baseRowCtx,
      };
    }

    case "TypeApp": {
      const { type: t1, ctx: ctxT1 } = replaceUnificationVarsWithTypeVars({
        mutableTypeVariables,
        ctx,
        info,
        type: type.t1,
      });
      const { type: t2, ctx: ctxT2 } = replaceUnificationVarsWithTypeVars({
        mutableTypeVariables,
        ctx: ctxT1,
        info,
        type: type.t2,
      });
      return {
        type: {
          ...type,
          t1,
          t2,
        },
        ctx: ctxT2,
      };
    }

    case "TypeRecordRowEmpty":
    case "TypeVar":
      // these can't contain any unification vars
      return { type, ctx };

    case "TypeUnificationVar": {
      if (type.id in mutableTypeVariables) {
        return { type: mutableTypeVariables[type.id], ctx };
      }
      const typeVar = {
        tag: "TypeVar",
        name: getNextTypeVar({ ctx, info }),
      };
      mutableTypeVariables[type.id] = typeVar;
      return {
        type: typeVar,
        ctx: addBinding({
          ctx,
          x: typeVar.name,
          bind: { tag: "TypeVarBind" },
          info,
        }),
      };
    }

    case "TypeAbs": {
      const { type: absType, ctx: absCtx } = replaceUnificationVarsWithTypeVars(
        {
          mutableTypeVariables,
          ctx,
          info,
          type: type.type,
        }
      );
      return {
        type: {
          ...type,
          type: absType,
        },
        ctx: absCtx,
      };
    }

    default:
      throw formatError({
        loc: info.loc,
        message: `Unknown type ${type.tag}`,
      });
  }
};

module.exports = {
  termSubstitution,
  typeSubstitution,
  ctxTypeSubstitution,
  getSubstitutedConstraints,
  subUnificationVars,
};
