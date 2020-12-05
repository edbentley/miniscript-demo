const { printType } = require("./print-type");
const {
  termSubstitution,
  typeSubstitution,
  ctxTypeSubstitution,
  getSubstitutedConstraints,
  subUnificationVars,
} = require("./substitution");
const {
  getNextTypeVar,
  addBinding,
  throwIfReservedWordOrAlreadyDefined,
} = require("./utils");
const { formatError } = require("../error");

/*
type Type =
  | { tag: "TypeArrow", argType: Type, returnType: Type }
  | { tag: "TypeUnificationVar", id: string }
  | { tag: "TypeVar", info?: Info, name: string }
  | { tag: "TypeAbs", name: string, type: Type } ("TyAll")
  | { tag: "TypeApp", info: Info, t1: Type, t2: Type }
  | { tag: "TypeRecord", row: Type, name?: string }
  | { tag: "TypeRecordRowEmpty" }
  | { tag: "TypeRecordRowExtend", key: string, extensionRow: Type, baseRow: Type }

type Term =
  | { tag: "TmVar", info: Info, name: string }
  | { tag: "TmAbs", info: Info, var?: { name: string, info: Info }, type?: Type, term: Term }
  | { tag: "TmApp", info: Info, t1: Term, t2: Term }
  | { tag: "TmLet", info: Info, name: string, nameInfo: Info, t1: Term, t2: Term }
  | { tag: "TmBool", info: Info }
  | { tag: "TmString", info: Info }
  | { tag: "TmNumber", info: Info }
  | { tag: "Tm()", info: Info }
  | { tag: "TmIf", info: Info, t1: Term, t2: Term, t3: Term }
  | { tag: "TmRecordEmpty", info: Info }
  | { tag: "TmRecordExtend", info: Info, record: Term, key: string, extensionRow: Term }
  | { tag: "TmRecordRestrict", info: Info, record: Term, key: string }
  | { tag: "TmRecordSelect", info: Info, record: Term, key: string }
  | { tag: "TmArray", info: Info, elements: [Term] }

type Binding =
  | { tag: "VarBind", type: Type, nameInfo: Info, file?: string }
  | { tag: "TmDecBind", term: Term, type?: Type, nameInfo: Info, nestedCtx?: Binding, file?: string } ("TmAbbBind")
  | { tag: "TypeVarBind", file?: string }
  | { tag: "TypeDecBind", type: Type, nameInfo: Info, file?: string } ("TyAbbBind")

type Context = {
  [name: string]: Binding
}

type Command =
  | { tag: "Eval", info: Info, term: Term }
  | { tag: "Bind", info: Info, name: string, binding: Binding }

type Info = {
  loc: Loc
}

type Constraint = [Type, Type][]

*/

const { getNextPlaceholderVar } = require("./placeholder-gen");

const processCommand = ({ ctx, cmd }) => {
  switch (cmd.tag) {
    case "Eval": {
      // Just check for errors
      getTypeWithPrincipalTypes({
        ctx,
        term: cmd.term,
        principalTypes: [],
      });
      return ctx;
    }
    case "Bind": {
      // first ensure the binding is valid and contains all the inferred types
      const { bind, nestedCtx } = checkBinding({
        ctx,
        bind: cmd.binding,
        info: cmd.info,
      });

      // This binding keeps the type associated with variable names for later
      // commands
      return addBinding({ ctx, x: cmd.name, bind, nestedCtx, info: cmd.info });
    }
  }
};

/* Calculate Types */

/**
 * Incrementally get constraints and unify to get principal types
 */
const getTypeWithPrincipalTypes = ({ ctx, term, principalTypes }) => {
  const { type, constraints, nestedCtx = ctx } = getTypeWithConstraints({
    ctx,
    term,
    principalTypes,
  });
  const fullPrincipalTypes = [
    ...principalTypes,
    ...unify({
      info: term.info,
      ctx,
      constraints,
    }),
  ];

  return {
    type,
    principalTypes: fullPrincipalTypes,
    nestedCtx,
  };
};

const getTypeWithConstraints = ({ ctx, term, principalTypes }) => {
  switch (term.tag) {
    case "TmVar": {
      const type = getTypeFromContext({
        info: term.info,
        ctx,
        name: term.name,
      });
      return { type, constraints: [] };
    }

    case "TmAbs": {
      if (term.type) {
        // Function was annotated. Must either be a generic type
        // containing an arrow type, or an arrow type.
        // We add constraints to confirm that the annotated type
        // matches with the inferred type of the function body.

        const simplifiedType = simplifyType({
          type: term.type,
          ctx,
          info: term.info,
        });

        if (simplifiedType.tag === "TypeArrow") {
          const { argType, returnType } = simplifiedType;

          validateType({ type: argType, ctx });
          validateType({ type: returnType, ctx });

          if (argType.tag === "TypeVar" && argType.name === "()" && term.var) {
            throw formatError({
              loc: term.var.info.loc,
              message: `Function type has no parameters`,
            });
          }

          // We add the new var binding
          const newCtx = term.var
            ? addBinding({
                ctx,
                x: term.var.name,
                bind: {
                  tag: "VarBind",
                  type: argType,
                  nameInfo: term.var.info,
                },
                info: term.var.info,
              })
            : ctx;

          // ensure function body type agrees with annotation
          const {
            type,
            principalTypes: bodyPrincipalTypes,
            nestedCtx,
          } = getTypeWithPrincipalTypes({
            ctx: newCtx,
            term: term.term,
            principalTypes,
          });

          const returnConstraint = [type, returnType];
          const newConstraints = term.var
            ? [returnConstraint]
            : [returnConstraint, [argType, { tag: "TypeVar", name: "()" }]];

          return {
            type: simplifiedType,
            constraints: [...newConstraints, ...bodyPrincipalTypes],
            nestedCtx,
          };
        } else if (simplifiedType.tag === "TypeAbs") {
          const typeAbs = simplifiedType;

          // ensure abstraction type agrees with annotation
          const {
            type,
            principalTypes: bodyPrincipalTypes,
            nestedCtx,
          } = getTypeWithPrincipalTypes({
            ctx,
            term: {
              ...term,
              type: undefined,
            },
            principalTypes,
          });

          const newConstraint = [type, typeAbs];

          return {
            type: typeAbs,
            constraints: [newConstraint, ...bodyPrincipalTypes],
            nestedCtx,
          };
        }

        throw formatError({
          loc: term.info.loc,
          message: `Expected type "${simplifiedType.tag}" to be "TypeArrow" or "TypeAbs"`,
        });
      }
      // function has no parameters, we can simplify the inference
      if (!term.var) {
        const {
          type: returnType,
          principalTypes: newPrincipalTypes,
          nestedCtx,
        } = getTypeWithPrincipalTypes({
          ctx,
          term: term.term,
          principalTypes,
        });

        return {
          type: {
            tag: "TypeArrow",
            argType: { tag: "TypeVar", name: "()" },
            returnType,
          },
          constraints: newPrincipalTypes,
          nestedCtx,
        };
      }

      /*
       If there's no type annotation on the function, we go through the
       following steps:

       1. Add placeholder type for argument of function in ctx
       2. Get type of body and its principal types
       3. Check if placeholder type was constrained
       4. If yes, substitute this type into the body and nestedCtx, then return
          "TypeArrow"
       5. If no, substitute a type variable (starting from "a") into the body
          and nestedCtx, then return "TypeAbs" holding a "TypeArrow"
       6. Bubble up any nested "TypeAbs" so that they are all at the outer level
      */

      // step 1
      const nextPlaceholderVar = getNextPlaceholderVar();
      const placeholderVarType = {
        tag: "TypeUnificationVar",
        id: nextPlaceholderVar,
      };

      const ctxWithTermVar = addBinding({
        ctx,
        x: term.var.name,
        bind: {
          tag: "VarBind",
          type: placeholderVarType,
          nameInfo: term.var.info,
        },
        info: term.var.info,
      });

      // step 2
      const {
        type,
        principalTypes: newPrincipalTypes,
        nestedCtx,
      } = getTypeWithPrincipalTypes({
        ctx: ctxWithTermVar,
        term: term.term,
        principalTypes,
      });

      // step 3
      const placeholderType = getIdentifierConstraint({
        principalTypes: newPrincipalTypes,
        placeholderId: nextPlaceholderVar,
      });

      if (placeholderType) {
        // step 4
        const substitutedType = typeSubstitution({
          typeName: nextPlaceholderVar,
          substitutionType: placeholderType,
          type,
        });

        const substitutedNestedCtx = ctxTypeSubstitution({
          typeName: nextPlaceholderVar,
          substitutionType: placeholderType,
          ctx: nestedCtx,
        });

        return {
          type: {
            tag: "TypeArrow",
            argType: placeholderType,
            returnType: substitutedType,
          },
          constraints: newPrincipalTypes,
          nestedCtx: substitutedNestedCtx,
        };
      }

      // step 5
      const typeParamVar = {
        tag: "TypeVar",
        name: getNextTypeVar({ ctx: nestedCtx, info: term.info }),
      };

      const substitutedType = typeSubstitution({
        typeName: nextPlaceholderVar,
        substitutionType: typeParamVar,
        type,
      });

      const substitutedNestedCtx = ctxTypeSubstitution({
        typeName: nextPlaceholderVar,
        substitutionType: typeParamVar,
        ctx: nestedCtx,
      });

      const substitutedNestedCtxWithTypeVar = addBinding({
        ctx: substitutedNestedCtx,
        x: typeParamVar.name,
        bind: { tag: "TypeVarBind" },
        info: term.info,
      });

      // step 6
      const inAbsType = bubbleUpNestedTypeAbs({
        nestedType: substitutedType,
        arrowArgType: typeParamVar,
      });

      return {
        type: {
          tag: "TypeAbs",
          name: typeParamVar.name,
          type: inAbsType,
        },
        constraints: newPrincipalTypes,
        nestedCtx: substitutedNestedCtxWithTypeVar,
      };
    }

    case "TmApp": {
      const {
        type: typeT1,
        principalTypes: principalTypes1,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: term.t1,
        principalTypes,
      });
      const {
        type: typeT2,
        principalTypes: principalTypes2,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: term.t2,
        principalTypes,
      });

      const addPlaceholdersForTypeParams = (type) => {
        if (type.tag === "TypeAbs") {
          // placeholder for argument
          const nextPlaceholderVar = getNextPlaceholderVar();
          const placeholderVarType = {
            tag: "TypeUnificationVar",
            id: nextPlaceholderVar,
            originalName: type.name,
          };

          // substitute our placeholder in
          const substitutedType = typeSubstitution({
            typeName: type.name,
            substitutionType: placeholderVarType,
            type: type.type,
          });

          return addPlaceholdersForTypeParams(substitutedType);
        }
        return type;
      };

      // this will be the arrow type with placeholders for parameters
      const typeT1Arrow = addPlaceholdersForTypeParams(typeT1);

      // placeholder for return type
      const nextPlaceholderVar = getNextPlaceholderVar();
      const placeholderVarType = {
        tag: "TypeUnificationVar",
        id: nextPlaceholderVar,
      };

      const newConstraint = [
        // LHS
        typeT1Arrow, //  must be equal to
        // RHS: arrow function of arg type typeT2 whose return type we can
        // infer later
        {
          tag: "TypeArrow",
          argType: typeT2,
          returnType: placeholderVarType,
        },
      ];

      return {
        type: placeholderVarType,
        constraints: [newConstraint, ...principalTypes1, ...principalTypes2],
      };
    }

    case "TmLet": {
      // TODO: implement value restriction when refs introduced
      // the value restriction: if t2 is not a "syntactic value" it cannot be treated
      // polymorphically - e.g. if you declare a function `x => x` then the
      // types of the arg and return are fixed after the first use. Whereas
      // global declations like `x => x` can be used multiple times with
      // different arguments. This avoids the type system potentially being out
      // of sync with the evaluation sequence if side effects happen (e.g.
      // reassigning a reference to a different type). explanation:
      // http://caml.inria.fr/pub/docs/oreilly-book/html/book-ora026.html#toc35

      const { name, nameInfo, t1, t2 } = term;

      if (isValue({ term: t1 })) {
        // substitute t1 for its value (T-LetPoly)
        const {
          type,
          principalTypes: newPrincipalTypes,
          nestedCtx,
        } = getTypeWithPrincipalTypes({
          ctx,
          term: termSubstitution({
            varName: name,
            substitutionTerm: t1,
            term: t2,
          }),
          principalTypes,
        });

        // We are adding t1 in the context ONLY for getting the type of t1 in
        // the symbol generator
        const {
          type: t1Type,
          nestedCtx: t1NestedCtx,
          principalTypes: t1PrincipalTypes,
        } = getTypeWithPrincipalTypes({ ctx, term: t1, principalTypes });
        const ctxWithValue = addBinding({
          ctx: nestedCtx,
          x: name,
          bind: {
            tag: "TmDecBind",
            term: t1,
            type: t1Type,
            nameInfo,
            nestedCtx: t1NestedCtx,
          },
          info: nameInfo,
        });

        return {
          type,
          constraints: [...newPrincipalTypes, ...t1PrincipalTypes],
          nestedCtx: ctxWithValue,
        };
      }
      const {
        type: type1,
        principalTypes: principalTypes1,
        nestedCtx: nestedCtx1,
      } = getTypeWithPrincipalTypes({ ctx, term: t1, principalTypes });

      const newCtx = addBinding({
        ctx,
        x: name,
        bind: { tag: "VarBind", type: type1, nameInfo },
        info: nameInfo,
      });
      const {
        type: type2,
        principalTypes: principalTypes2,
        nestedCtx: nestedCtx2,
      } = getTypeWithPrincipalTypes({ ctx: newCtx, term: t2, principalTypes });

      return {
        type: type2,
        constraints: [...principalTypes1, ...principalTypes2],
        nestedCtx: { ...nestedCtx1, ...nestedCtx2 },
      };
    }

    case "TmRecordEmpty": {
      return {
        type: {
          tag: "TypeRecord",
          row: { tag: "TypeRecordRowEmpty" },
        },
        constraints: [],
      };
    }

    case "TmRecordExtend": {
      // Create the expected record type with unification variables, if the
      // types don't match it'll fail at the infer stage. Return the unification
      // record type which will have unification variables whose type is a
      // principal type.
      const { key, extensionRow, record } = term;

      let {
        type: typeRecord,
        principalTypes: principalTypesRecord,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: record,
        principalTypes,
      });

      const { type: typeRecordSubbed } = subUnificationVars({
        principalTypes: principalTypesRecord,
        type: typeRecord,
        ctx,
        info: record.info,
      });

      // First check if record type already contains our field
      const recordTypeHasKey = (currRecord) => {
        if (currRecord.tag === "TypeRecordRowExtend") {
          if (currRecord.key === key) {
            return true;
          }
          return recordTypeHasKey(currRecord.baseRow);
        }
        return false;
      };
      const shouldUpdate =
        typeRecordSubbed.tag === "TypeRecord" &&
        recordTypeHasKey(typeRecordSubbed.row);

      if (shouldUpdate) {
        // remove the field first
        const {
          type: typeRestricted,
          principalTypes: principalTypesRestricted,
        } = getTypeWithPrincipalTypes({
          ctx,
          term: {
            tag: "TmRecordRestrict",
            info: term.info,
            key,
            record,
          },
          principalTypes,
        });
        typeRecord = typeRestricted;
        principalTypesRecord = principalTypesRestricted;
      }

      // (a, {r}) -> {key: a | r}
      const a = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };
      const r = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };
      const rRecord = {
        tag: "TypeRecord",
        row: r,
      };
      const returnType = {
        tag: "TypeRecord",
        row: {
          tag: "TypeRecordRowExtend",
          key,
          extensionRow: a,
          baseRow: r,
        },
      };

      const {
        type: typeExtensionRow,
        principalTypes: principalTypesExtensionRow,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: extensionRow,
        principalTypes,
      });

      const constraints = [
        [a, typeExtensionRow],
        [rRecord, typeRecord],
      ];

      return {
        type: returnType,
        constraints: [
          ...constraints,
          ...principalTypesExtensionRow,
          ...principalTypesRecord,
        ],
      };
    }

    case "TmRecordRestrict": {
      // Similar to extending record but removing a field
      const { record, key } = term;

      // {key: a | r} -> {r}
      const a = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };
      const r = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };
      const typeRecordPlaceholder = {
        tag: "TypeRecord",
        row: {
          tag: "TypeRecordRowExtend",
          key,
          extensionRow: a,
          baseRow: r,
        },
      };
      const returnType = {
        tag: "TypeRecord",
        row: r,
      };

      const {
        type: typeRecord,
        principalTypes: principalTypesRecord,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: record,
        principalTypes,
      });

      const rowConstraint = [typeRecordPlaceholder, typeRecord];

      return {
        type: returnType,
        constraints: [rowConstraint, ...principalTypesRecord],
      };
    }

    case "TmRecordSelect": {
      // Create the expected record type with placeholder variables, if the
      // types don't match it'll fail at the infer stage. Return the placeholder
      // row type which will have a principal type of the inferred type.
      const { record, key } = term;

      // {key: a | r} -> a
      const a = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };
      const r = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };
      const typeRecordPlaceholder = {
        tag: "TypeRecord",
        row: {
          tag: "TypeRecordRowExtend",
          key,
          extensionRow: a,
          baseRow: r,
        },
      };

      const {
        type: typeRecord,
        principalTypes: principalTypesRecord,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: record,
        principalTypes,
      });

      const rowConstraint = [typeRecordPlaceholder, typeRecord];

      return {
        type: a,
        constraints: [rowConstraint, ...principalTypesRecord],
      };
    }

    case "TmArray": {
      const placeholderElementsType = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };

      const elementTypesWithPrincipalTypes = term.elements.map((element) =>
        getTypeWithPrincipalTypes({
          ctx,
          term: element,
          principalTypes,
        })
      );

      const allPrincipalTypes = elementTypesWithPrincipalTypes.reduce(
        (curr, { principalTypes }) => [...curr, ...principalTypes],
        []
      );

      // check all same type as placeholder element
      const allSameTypeConstraints = elementTypesWithPrincipalTypes.map(
        ({ type }) => [placeholderElementsType, type]
      );

      return {
        type: {
          tag: "TypeApp",
          info: term.info,
          t1: { tag: "TypeVar", name: "Array", info: term.info },
          t2: placeholderElementsType,
        },
        constraints: [...allSameTypeConstraints, ...allPrincipalTypes],
      };
    }

    case "TmBool":
      return {
        type: { tag: "TypeVar", name: "Boolean" },
        constraints: [],
      };

    case "TmString":
      return {
        type: { tag: "TypeVar", name: "String" },
        constraints: [],
      };

    case "TmNumber":
      return {
        type: { tag: "TypeVar", name: "Number" },
        constraints: [],
      };

    case "Tm()":
      return {
        type: { tag: "TypeVar", name: "()" },
        constraints: [],
      };

    case "TmIf": {
      const {
        type: typeT1,
        principalTypes: principalTypes1,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: term.t1,
        principalTypes,
      });
      const {
        type: typeT2,
        principalTypes: principalTypes2,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: term.t2,
        principalTypes,
      });
      const {
        type: typeT3,
        principalTypes: principalTypes3,
      } = getTypeWithPrincipalTypes({
        ctx,
        term: term.t3,
        principalTypes,
      });

      const newConstraints = [
        // condition is a bool
        [typeT1, { tag: "TypeVar", name: "Boolean" }],
        // if and else must return the same type
        [typeT2, typeT3],
      ];

      return {
        type: typeT3,
        constraints: [
          ...newConstraints,
          ...principalTypes1,
          ...principalTypes2,
          ...principalTypes3,
        ],
      };
    }
  }
};

/**
 * Unification Algorithm from Hindley and Milner to calculate solutions to
 * constraints. Returns a principal unifier.
 */
const unify = ({ info, ctx, constraints, parentRecord }) => {
  if (constraints.length === 0) {
    return [];
  }

  const [constraint, ...rest] = constraints;
  const [LHS, RHS] = constraint;

  switch (true) {
    case RHS.tag === "TypeVar": {
      if (LHS.tag === "TypeVar") {
        // LHS and RHS are the same type var, skip
        if (RHS.name === LHS.name) {
          return unify({ info, ctx, constraints: rest, parentRecord });
        }
      }

      // check with the type referred to in TypeVar
      const substitutedConstraints = [
        [LHS, getTypeFromContext({ info, ctx, name: RHS.name, isType: true })],
        ...rest,
      ];
      return unify({
        info,
        ctx,
        constraints: substitutedConstraints,
        parentRecord,
      });
    }

    case LHS.tag === "TypeVar": {
      // check with the type referred to in TypeVar
      const substitutedConstraints = [
        [getTypeFromContext({ info, ctx, name: LHS.name, isType: true }), RHS],
        ...rest,
      ];
      return unify({
        info,
        ctx,
        constraints: substitutedConstraints,
        parentRecord,
      });
    }

    case RHS.tag === "TypeUnificationVar": {
      const typeName = RHS.id;

      // LHS and RHS are the same type identifier, skip
      if (LHS.tag === "TypeUnificationVar" && typeName === LHS.id) {
        return unify({ info, ctx, constraints: rest, parentRecord });
      }

      if (typeContainsTypeName({ typeName, type: LHS })) {
        throw formatError({
          loc: info.loc,
          message: `Circular constraints for ${typeName}`,
        });
      }

      const substitutedConstraints = getSubstitutedConstraints({
        typeName,
        originalName: RHS.originalName,
        type: LHS,
        constraints: rest,
      });

      // where LHS = S, RHS = X
      return [
        // unify([X ↦ S]C')
        ...unify({
          info,
          ctx,
          constraints: substitutedConstraints,
          parentRecord,
        }),
        // [X ↦ S]
        [RHS, LHS],
      ];
    }

    case LHS.tag === "TypeUnificationVar": {
      const typeName = LHS.id;

      if (typeContainsTypeName({ typeName, type: RHS })) {
        throw formatError({
          loc: info.loc,
          message: `Circular constraints for ${typeName}`,
        });
      }

      const substitutedConstraints = getSubstitutedConstraints({
        typeName,
        originalName: LHS.originalName,
        type: RHS,
        constraints: rest,
      });

      // where RHS = T, LHS = X
      return [
        // unify([X ↦ T]C')
        ...unify({
          info,
          ctx,
          constraints: substitutedConstraints,
          parentRecord,
        }),
        // [X ↦ T]
        [LHS, RHS],
      ];
    }

    case LHS.tag === "TypeRecordRowEmpty" && RHS.tag === "TypeRecordRowEmpty":
      return unify({ info, ctx, constraints: rest, parentRecord });

    case LHS.tag === "TypeArrow" && RHS.tag === "TypeArrow": {
      // arrow functions are equal if args and return type equal
      const combinedConstraints = [
        [LHS.argType, RHS.argType],
        [LHS.returnType, RHS.returnType],
        ...rest,
      ];
      return unify({
        info,
        ctx,
        constraints: combinedConstraints,
        parentRecord,
      });
    }

    case LHS.tag === "TypeAbs" && RHS.tag === "TypeAbs": {
      // substitute type abs with common placeholder between LHS and RHS
      const placeholderVarType = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };

      throwIfReservedWordOrAlreadyDefined({ name: LHS.name, ctx, info });
      throwIfReservedWordOrAlreadyDefined({ name: RHS.name, ctx, info });

      const lhsSubbed = typeSubstitution({
        typeName: LHS.name,
        substitutionType: placeholderVarType,
        type: LHS.type,
      });

      const rhsSubbed = typeSubstitution({
        typeName: RHS.name,
        substitutionType: placeholderVarType,
        type: RHS.type,
      });

      return unify({
        info,
        ctx,
        constraints: [[lhsSubbed, rhsSubbed], ...rest],
        parentRecord,
      });
    }

    case LHS.tag === "TypeAbs": {
      // substitute type abs with unification var
      const placeholderVarType = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };

      throwIfReservedWordOrAlreadyDefined({ name: LHS.name, ctx, info });

      const lhsSubbed = typeSubstitution({
        typeName: LHS.name,
        substitutionType: placeholderVarType,
        type: LHS.type,
      });

      return unify({
        info,
        ctx,
        constraints: [[lhsSubbed, RHS], ...rest],
        parentRecord,
      });
    }

    case RHS.tag === "TypeAbs": {
      // substitute type abs with unification var
      const placeholderVarType = {
        tag: "TypeUnificationVar",
        id: getNextPlaceholderVar(),
      };

      throwIfReservedWordOrAlreadyDefined({ name: RHS.name, ctx, info });

      const rhsSubbed = typeSubstitution({
        typeName: RHS.name,
        substitutionType: placeholderVarType,
        type: RHS.type,
      });

      return unify({
        info,
        ctx,
        constraints: [[LHS, rhsSubbed], ...rest],
        parentRecord,
      });
    }

    case LHS.tag === "TypeApp": {
      const lhsSimplified = simplifyType({ type: LHS, ctx, info });
      return unify({
        info,
        ctx,
        constraints: [[lhsSimplified, RHS], ...rest],
        parentRecord,
      });
    }

    case RHS.tag === "TypeApp": {
      const rhsSimplified = simplifyType({ type: RHS, ctx, info });
      return unify({
        info,
        ctx,
        constraints: [[LHS, rhsSimplified], ...rest],
        parentRecord,
      });
    }

    case LHS.tag === "TypeRecord" &&
      RHS.tag === "TypeRecord" &&
      // Show unify message if named records have different names
      (!LHS.name || !RHS.name || LHS.name === RHS.name): {
      if (LHS.name && RHS.name && LHS.name === RHS.name) {
        return unify({
          info,
          ctx,
          constraints: rest,
          parentRecord: [LHS, RHS],
        });
      }
      return unify({
        info,
        ctx,
        constraints: [[LHS.row, RHS.row], ...rest],
        parentRecord: [LHS, RHS],
      });
    }

    case LHS.tag === "TypeRecordRowExtend" &&
      RHS.tag === "TypeRecordRowExtend": {
      const newConstraints = [];

      const rewriteRow = ({ row2, key1, extensionRow1 }) => {
        switch (row2.tag) {
          case "TypeRecordRowEmpty": {
            const { type: rhsParentUnifVarsSubsOut } = subUnificationVars({
              principalTypes: constraints,
              type: parentRecord[1],
              ctx: {},
              info,
            });
            const [rhsParentRecord] = printType({
              type: rhsParentUnifVarsSubsOut,
            });
            throw formatError({
              loc: info.loc,
              message: `Type ${rhsParentRecord} does not contain field ${key1}`,
            });
          }

          case "TypeRecordRowExtend": {
            const {
              key: key2,
              extensionRow: extensionRow2,
              baseRow: baseRow2,
            } = row2;
            // Keys must be the same and field types the same (checked in next unify)
            if (key1 === key2) {
              newConstraints.push([extensionRow1, extensionRow2]);
              return baseRow2;
            }
            // otherwise, check the next row for a match
            return {
              tag: "TypeRecordRowExtend",
              key: key2,
              extensionRow: extensionRow2,
              baseRow: rewriteRow({ key1, extensionRow1, row2: baseRow2 }),
            };
          }

          case "TypeVar": {
            const row2Record = getTypeFromContext({
              info,
              ctx,
              name: row2.name,
              isType: true,
            });
            return rewriteRow({ row2: row2Record.row, key1, extensionRow1 });
          }

          case "TypeUnificationVar": {
            const baseRow2 = {
              tag: "TypeUnificationVar",
              id: getNextPlaceholderVar(),
            };
            newConstraints.push([
              row2,
              {
                tag: "TypeRecordRowExtend",
                key: key1,
                extensionRow: extensionRow1,
                baseRow: baseRow2,
              },
            ]);
            return baseRow2;
          }

          default:
            throw formatError({
              loc: info.loc,
              message: `Expected row type in Record but got ${row2.tag}`,
            });
        }
      };

      // We get the baseRow of RHS. This is just RHS.baseRow unless the fields
      // don't match, then we swap it with the next field so that records like
      // { x: string, y: string } and { y: string, x: string } are equal.
      // Essentially we are looping LHS fields with RHS fields and adding
      // constraints whenever the keys match.
      const baseRowRHS = rewriteRow({
        row2: RHS,
        key1: LHS.key,
        extensionRow1: LHS.extensionRow,
      });

      return unify({
        info,
        ctx,
        constraints: [...newConstraints, [LHS.baseRow, baseRowRHS], ...rest],
        parentRecord,
      });
    }

    /* Error messages */

    case LHS.tag === "TypeRecordRowExtend" &&
      RHS.tag === "TypeRecordRowEmpty": {
      const { type: lhsUnifVarsSubsOut } = subUnificationVars({
        principalTypes: constraints,
        type: LHS,
        ctx: {},
        info,
      });
      const [lhsType] = printType({
        type: lhsUnifVarsSubsOut,
        hideTypeVar: true,
      });
      const { type: rhsParentUnifVarsSubsOut } = subUnificationVars({
        principalTypes: constraints,
        type: parentRecord[1],
        ctx: {},
        info,
      });
      const [rhsParentRecord] = printType({
        type: rhsParentUnifVarsSubsOut,
      });

      throw formatError({
        loc: info.loc,
        message: `Type ${rhsParentRecord} is missing field ${lhsType}`,
      });
    }
    case RHS.tag === "TypeRecordRowExtend" &&
      LHS.tag === "TypeRecordRowEmpty": {
      const { type: rhsUnifVarsSubsOut } = subUnificationVars({
        principalTypes: constraints,
        type: RHS,
        ctx: {},
        info,
      });
      const [rhsType] = printType({
        type: rhsUnifVarsSubsOut,
        hideTypeVar: true,
      });
      const { type: rhsParentUnifVarsSubsOut } = subUnificationVars({
        principalTypes: constraints,
        type: parentRecord[1],
        ctx: {},
        info,
      });
      const [rhsParentRecord] = printType({
        type: rhsParentUnifVarsSubsOut,
      });

      throw formatError({
        loc: info.loc,
        message: `Type ${rhsParentRecord} has unexpected fields ${rhsType}`,
      });
    }

    default: {
      const { type: lhsUnifVarsSubsOut } = subUnificationVars({
        principalTypes: constraints,
        type: LHS,
        ctx: {},
        info,
      });
      const { type: rhsUnifVarsSubsOut } = subUnificationVars({
        principalTypes: constraints,
        type: RHS,
        ctx: {},
        info,
      });
      const [lhsType, lhsGenerics] = printType({ type: lhsUnifVarsSubsOut });
      const [rhsType, rhsGenerics] = printType({ type: rhsUnifVarsSubsOut });

      throw formatError({
        loc: info.loc,
        message: `Type ${
          lhsGenerics ? `<${lhsGenerics.join(", ")}> ` : ""
        }${lhsType} is not compatible with type ${
          rhsGenerics ? `<${rhsGenerics.join(", ")}> ` : ""
        }${rhsType}`,
      });
    }
  }
};

const isValue = ({ term }) => {
  switch (term.tag) {
    case "TmBool":
    case "TmString":
    case "TmNumber":
    case "Tm()":
    case "TmAbs":
    case "TmRecordEmpty":
      return true;
    case "TmRecordExtend":
      return (
        isValue({ term: term.record }) && isValue({ term: term.extensionRow })
      );
    case "TmRecordRestrict":
    case "TmRecordSelect":
      return isValue({ term: term.record });
    case "TmArray":
      return term.elements.every(({ value }) => isValue({ term: value }));
    default:
      return false;
  }
};

/**
 * Use to avoid cyclic substitutions for type identifiers e.g. X = X->X
 */
const typeContainsTypeName = ({ typeName, type }) => {
  switch (type.tag) {
    case "TypeArrow":
      return (
        typeContainsTypeName({ typeName, type: type.argType }) ||
        typeContainsTypeName({ typeName, type: type.returnType })
      );

    case "TypeAbs":
      return typeContainsTypeName({ typeName, type: type.type });

    case "TypeRecord":
      return typeContainsTypeName({ typeName, type: type.row });

    case "TypeRecordRowExtend":
      return (
        typeContainsTypeName({ typeName, type: type.baseRow }) ||
        typeContainsTypeName({ typeName, type: type.extensionRow })
      );

    case "TypeVar":
    case "TypeRecordRowEmpty":
    case "TypeConstant":
      return false;

    case "TypeUnificationVar":
      return typeName === type.id;
  }
};

const getTypeFromContext = ({ info, ctx, name, isType = false }) => {
  const binding = getBinding({ info, ctx, name, isType });
  switch (binding.tag) {
    case "VarBind":
    case "TypeDecBind":
      return binding.type;
    case "TmDecBind":
      if (!binding.type) {
        throw formatError({
          loc: info.loc,
          message: `No type recorded for variable ${name}`,
        });
      }
      return binding.type;
    case "TypeVarBind":
      return null;
  }
};

const getBinding = ({ info, ctx, name, isType }) => {
  const ctxValue = ctx[name];
  if (ctxValue === undefined) {
    throw formatError({
      loc: info.loc,
      message: `Undeclared${isType ? " type " : " "}variable ${name}`,
    });
  }
  return ctxValue;
};

/**
 * - Confirms the types of a declaration binding match up
 * - Adds the type of the declaration if not explicitly stated by checking type
 *   of term with constraints
 * - Substitutes unification variables in principal types in
 * - If not a declaration binding, just return as is
 */
const checkBinding = ({ ctx, bind, info }) => {
  switch (bind.tag) {
    case "TmDecBind": {
      const { type, term } = bind;
      if (!type) {
        const {
          type: inferredType,
          principalTypes,
          nestedCtx,
        } = getTypeWithPrincipalTypes({
          ctx,
          term,
          principalTypes: [],
        });

        const {
          type: finalType,
          ctx: nestedCtxWithTypeVars,
        } = subUnificationVars({
          principalTypes,
          type: inferredType,
          ctx: nestedCtx,
          info: term.info,
        });

        return {
          bind: {
            ...bind,
            type: finalType,
            nestedCtx: nestedCtxWithTypeVars,
          },
          nestedCtx: nestedCtxWithTypeVars,
        };
      }

      // TODO --- this code currently can't be reached, see TODO in parse
      // const typePrime = typeOf({ ctx, term });

      // if (!typesEqual({ ctx, type1: type, type2: typePrime })) {
      //  throw Error   `Type of binding does not match declared type`
      // }
      return bind;
    }

    case "VarBind":
    case "TypeDecBind": {
      const type = simplifyType({ type: bind.type, ctx, info });
      return { bind: { ...bind, type } };
    }

    default:
      return { bind };
  }
};

/**
 * Returns if identifier has been constrained and returns that type, otherwise
 * returns nullish
 */
const getIdentifierConstraint = ({ principalTypes, placeholderId }) => {
  const constraint = principalTypes.find(([LHS, RHS]) => {
    return (
      (LHS.tag === "TypeUnificationVar" && LHS.id === placeholderId) ||
      (RHS.tag === "TypeUnificationVar" && RHS.id === placeholderId)
    );
  });
  if (!constraint) {
    return null;
  }
  const [LHS, RHS] = constraint;
  return LHS.tag === "TypeUnificationVar" ? RHS : LHS;
};

/**
 * Ensure a type exists in the context
 */
const validateType = ({ type, ctx }) => {
  if (
    type.tag === "TypeVar" &&
    !ctx[type.name] &&
    !predefined.includes(type.name)
  ) {
    throw formatError({
      loc: type.info ? type.info.loc : null,
      message: `Undeclared type variable ${type.name}`,
    });
  }
};

// TODO: support recursive types
const predefined = ["String", "Number", "Boolean", "Array"];

/**
 * Walk through a type and apply any type applications, e.g. Id<string>
 */
const simplifyType = ({ type: baseType, ctx: baseCtx, info }) => {
  const walk = ({ type, ctx, isSpread = false }) => {
    switch (type.tag) {
      case "TypeArrow":
        return {
          ...type,
          argType: walk({ type: type.argType, ctx }),
          returnType: walk({ type: type.returnType, ctx }),
        };

      case "TypeRecord":
        return {
          ...type,
          row: walk({ type: type.row, ctx }),
        };

      case "TypeRecordRowExtend":
        return {
          ...type,
          extensionRow: walk({ type: type.extensionRow, ctx }),
          baseRow: walk({ type: type.baseRow, ctx, isSpread: true }),
        };

      case "TypeUnificationVar":
      case "TypeRecordRowEmpty":
      case "TypeConstant":
        return type;

      case "TypeVar": {
        if (isSpread) {
          // e.g. ...A
          const varType = getTypeFromContext({
            info,
            ctx,
            name: type.name,
            isType: true,
          });
          if (varType) {
            if (varType.name) {
              throw formatError({
                loc: info.loc,
                message: "Can't spread built-in type",
              });
            }
            return varType.row;
          }
          // if its a type parameter just return as-is
        }
        validateType({ type, ctx });
        return type;
      }

      case "TypeAbs":
        return {
          ...type,
          type: walk({
            type: type.type,
            ctx: addBinding({
              ctx,
              x: type.name,
              bind: { tag: "TypeVarBind" },
              info,
            }),
          }),
        };

      case "TypeApp": {
        const { t1, t2, info } = type;

        const simplifiedT1 = walk({ type: t1, ctx });

        if (simplifiedT1.tag !== "TypeAbs") {
          if (simplifiedT1.tag !== "TypeVar") {
            throw formatError({
              loc: info.loc,
              message: `Can only pass type parameters into a type variable, not ${simplifiedT1.tag}`,
            });
          }

          let bindingT1;
          // TODO: array hard code since no recursive types
          try {
            bindingT1 = getBinding({
              info,
              ctx,
              name: simplifiedT1.name,
              isType: true,
            });
          } catch (e) {
            if (simplifiedT1.name === "Array") {
              return type;
            }
            throw e;
          }

          if (
            bindingT1.tag !== "TypeDecBind" &&
            bindingT1.type.tag !== "TypeAbs"
          ) {
            throw formatError({
              loc: info.loc,
              message: "Can't pass type parameter into non-generic type",
            });
          }
          return typeSubstitution({
            typeName: bindingT1.type.name,
            substitutionType: t2,
            type: bindingT1.type.type,
          });
        }

        return typeSubstitution({
          typeName: simplifiedT1.name,
          substitutionType: t2,
          type: simplifiedT1.type,
        });
      }
    }
  };
  return walk({ type: baseType, ctx: baseCtx });
};

const bubbleUpNestedTypeAbs = ({ nestedType, arrowArgType }) => {
  if (nestedType.tag === "TypeAbs") {
    return {
      tag: "TypeAbs",
      name: nestedType.name,
      type: {
        tag: "TypeArrow",
        argType: arrowArgType,
        returnType: nestedType.type,
      },
    };
  }

  return {
    tag: "TypeArrow",
    argType: arrowArgType,
    returnType: nestedType,
  };
};

module.exports = {
  processCommand,
};
