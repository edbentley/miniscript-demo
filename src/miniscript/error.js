const formatError = ({ loc, message }) => {
  if (!loc) {
    return Error(message);
  }

  const { start, end } = loc;
  return Error(
    `Line ${start.line}..${end.line} col ${start.column}..${end.column}: ${message}`
  );
};

const parseError = (errMessage) => {
  const regex = /^Line (\d+)..(\d+) col (\d+)..(\d+): (.+)$/;

  const match = errMessage.match(regex);

  if (!match) {
    return { message };
  }

  const [, startLine, endLine, startCol, endCol, message] = match;

  return {
    loc: {
      start: {
        line: parseInt(startLine),
        column: parseInt(startCol),
      },
      end: {
        line: parseInt(endLine),
        column: parseInt(endCol),
      },
    },
    message,
  };
};

module.exports = {
  formatError,
  parseError,
};
