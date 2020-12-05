const { parseScript } = require("./parser");
const { processCommand } = require("./typechecker");
const { getSymbol } = require("./symbol-generator");
const { getInitCtx } = require("./globals/init-ctx");

/**
 * Get the type of source file at line (1-index) and character (1-index)
 */
const getType = ({ source, line, character }) => {
  let ctx = {};
  let commands = [];
  try {
    const initCtx = getInitCtx();
    commands = parseScript(source);
    ctx = commands.reduce((ctx, cmd) => processCommand({ ctx, cmd }), initCtx);
  } catch (_) {
    // try to get type up to what could be processed
  }

  const symbol = getSymbol({
    ctx,
    meta: {
      line: line,
      character: character - 1, // 1-index to 0-index character
    },
    commands,
  });

  if (!symbol) return "";

  const { name, type, generics } = symbol;

  if (generics && generics.length > 0) {
    return `${name}<${generics.join(", ")}> :: ${type}`;
  }
  return `${name} :: ${type}`;
};

/**
 * Throws error if source code cannot be parsed / types errors
 */
const validate = (source) => {
  const commands = parseScript(source);
  const initCtx = getInitCtx();
  commands.reduce((ctx, cmd) => processCommand({ ctx, cmd }), initCtx);
};

module.exports = {
  getType,
  validate,
};
