const { parseDeclaration } = require("../parser");
const { processCommand } = require("../typechecker");

const getInitCtx = () => {
  const fileContent = `
  /*
type () = {}

type String = {
  length: String,
  startsWith: String -> Boolean,
  endsWith: String -> Boolean,
  split: String -> String[],
  toLocaleLowerCase: () -> String
}

type Number = {
  toString<unused>: unused -> String
}

type Boolean = {
  toString<plhd>: plhd -> String
}

type Array<arrtype> = {
  length: Number,
  map<newtype>: (arrtype -> newtype) -> newtype[],
  join: String -> String
}

type JSONT = {
  stringify<plhd>: plhd -> String
}
*/

// parseFloat :: String -> Number
// parseInt :: String -> Number

// JSON :: JSONT

// Number##binaryOp :: Number -> Number -> Number
  `;

  const commands = parseDeclaration(fileContent);

  const ctx = commands.reduce((ctx, cmd) => processCommand({ ctx, cmd }), {});

  return ctx;
};

module.exports = {
  getInitCtx,
};
