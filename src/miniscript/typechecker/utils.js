const { formatError } = require("../error");

// Common functions used in multiple files

const getNextTypeVar = ({ ctx, info }) => {
  // "a" is char code 97, "b" is char code 98... "z" is 122
  const potentialConflicts = Object.entries(ctx)
    .map(([name, binding]) => {
      if (binding.tag === "TypeVarBind") {
        return name;
      }
      return "";
    })
    .filter((c) => c.length === 1);
  for (let i = 97; i <= 122; i++) {
    const char = String.fromCharCode(i);
    if (!potentialConflicts.includes(char)) {
      return char;
    }
  }
  throw formatError({
    loc: info.loc,
    message: "Ran out of lowercase type variables",
  });
};

const addBinding = ({ ctx, x, bind, info }) => {
  throwIfReservedWordOrAlreadyDefined({ name: x, ctx, info });
  return {
    ...ctx,
    [x]: bind,
  };
};

const throwIfReservedWordOrAlreadyDefined = ({ name, ctx, info }) => {
  if (ctx[name] !== undefined) {
    throw formatError({
      loc: info.loc,
      message: `${name} is already defined`,
    });
  }
  if (reservedWords.includes(name)) {
    throw formatError({
      loc: info.loc,
      message: `${name} is a reserved word`,
    });
  }
};

const reservedWords = ["string", "boolean", "number"];

module.exports = {
  getNextTypeVar,
  addBinding,
  throwIfReservedWordOrAlreadyDefined,
};
