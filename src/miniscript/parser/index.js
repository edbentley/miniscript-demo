const babelParser = require("@babel/parser");
const {
  typeCommentsToNodes,
  functionAnnotationToNode,
} = require("./parse-types");
const { nodesToCommands } = require("./transform-ast");

const parseScript = (code) => {
  const {
    program: { body: nodes },
    comments,
  } = babelParser.parse(code, babelOptions);

  const commentBlocks = comments.filter((c) => c.type === "CommentBlock");

  // Hardcoded: types must be in first block comment of file
  const typesCommentBlock = commentBlocks.length > 0 && commentBlocks[0];

  const typeNodes = typeCommentsToNodes(typesCommentBlock);

  // console.log(JSON.stringify(nodes));

  return nodesToCommands({ nodes: [...typeNodes, ...nodes] });
};

const parseDeclaration = (code) => {
  const { comments } = babelParser.parse(code, babelOptions);

  const commentBlocks = comments.filter((c) => c.type === "CommentBlock");
  const commentLines = comments.filter((c) => c.type === "CommentLine");

  // Hardcoded: types must be in first block comment of file
  const typesCommentBlock = commentBlocks.length > 0 && commentBlocks[0];

  const typeNodes = typeCommentsToNodes(typesCommentBlock);

  const annotationNodes = commentLines.map(({ value: comment }) => {
    const { varName, value } = functionAnnotationToNode({ comment });
    return {
      type: "TypeGlobal",
      name: varName,
      value,
    };
  });

  return nodesToCommands({
    nodes: [...typeNodes, ...annotationNodes],
    file: "global",
  });
};

const babelOptions = {
  sourceType: "script",
  strictMode: true,
  plugins: ["estree", "jsx", "optionalChaining", "nullishCoalescingOperator"],
};

module.exports = {
  parseScript,
  parseDeclaration,
};
