import "./style.css";
// (1) Desired editor features:
// BEGIN_FEATURES
import "monaco-editor/esm/vs/editor/browser/controller/coreCommands.js";
// import 'monaco-editor/esm/vs/editor/browser/widget/codeEditorWidget.js';
// import 'monaco-editor/esm/vs/editor/browser/widget/diffEditorWidget.js';
// import 'monaco-editor/esm/vs/editor/browser/widget/diffNavigator.js';
import "monaco-editor/esm/vs/editor/contrib/anchorSelect/anchorSelect.js";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/bracketMatching.js";
import "monaco-editor/esm/vs/editor/contrib/caretOperations/caretOperations.js";
// import 'monaco-editor/esm/vs/editor/contrib/caretOperations/transpose.js';
import "monaco-editor/esm/vs/editor/contrib/clipboard/clipboard.js";
// import 'monaco-editor/esm/vs/editor/contrib/codeAction/codeActionContributions.js';
// import 'monaco-editor/esm/vs/editor/contrib/codelens/codelensController.js';
// import 'monaco-editor/esm/vs/editor/contrib/colorPicker/colorDetector.js';
import "monaco-editor/esm/vs/editor/contrib/comment/comment.js";
// import 'monaco-editor/esm/vs/editor/contrib/contextmenu/contextmenu.js';
import "monaco-editor/esm/vs/editor/contrib/cursorUndo/cursorUndo.js";
// import 'monaco-editor/esm/vs/editor/contrib/dnd/dnd.js';
import "monaco-editor/esm/vs/editor/contrib/find/findController.js";
import "monaco-editor/esm/vs/editor/contrib/folding/folding.js";
// import 'monaco-editor/esm/vs/editor/contrib/fontZoom/fontZoom.js';
// import 'monaco-editor/esm/vs/editor/contrib/format/formatActions.js';
import "monaco-editor/esm/vs/editor/contrib/gotoError/gotoError.js";
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/documentSymbols.js";
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/goToCommands.js";
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/link/goToDefinitionAtPosition.js";
import "monaco-editor/esm/vs/editor/contrib/hover/hover.js";
import "monaco-editor/esm/vs/editor/contrib/inPlaceReplace/inPlaceReplace.js";
import "monaco-editor/esm/vs/editor/contrib/indentation/indentation.js";
import "monaco-editor/esm/vs/editor/contrib/linesOperations/linesOperations.js";
// import 'monaco-editor/esm/vs/editor/contrib/links/links.js';
// import 'monaco-editor/esm/vs/editor/contrib/multicursor/multicursor.js';
// import 'monaco-editor/esm/vs/editor/contrib/parameterHints/parameterHints.js';
// import 'monaco-editor/esm/vs/editor/contrib/rename/onTypeRename.js';
// import 'monaco-editor/esm/vs/editor/contrib/rename/rename.js';
// import 'monaco-editor/esm/vs/editor/contrib/smartSelect/smartSelect.js';
// import 'monaco-editor/esm/vs/editor/contrib/snippet/snippetController2.js';
// import 'monaco-editor/esm/vs/editor/contrib/suggest/suggestController.js';
// import 'monaco-editor/esm/vs/editor/contrib/toggleTabFocusMode/toggleTabFocusMode.js';
// import 'monaco-editor/esm/vs/editor/contrib/unusualLineTerminators/unusualLineTerminators.js';
// import 'monaco-editor/esm/vs/editor/contrib/viewportSemanticTokens/viewportSemanticTokens.js';
// import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/wordHighlighter.js';
// import 'monaco-editor/esm/vs/editor/contrib/wordOperations/wordOperations.js';
// import 'monaco-editor/esm/vs/editor/contrib/wordPartOperations/wordPartOperations.js';
import "monaco-editor/esm/vs/editor/standalone/browser/accessibilityHelp/accessibilityHelp.js";
// import 'monaco-editor/esm/vs/editor/standalone/browser/iPadShowKeyboard/iPadShowKeyboard.js';
// import 'monaco-editor/esm/vs/editor/standalone/browser/inspectTokens/inspectTokens.js';
// import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js';
// import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js';
// import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess.js';
// import 'monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneHelpQuickAccess.js';
// import 'monaco-editor/esm/vs/editor/standalone/browser/referenceSearch/standaloneReferenceSearch.js';
// import 'monaco-editor/esm/vs/editor/standalone/browser/toggleHighContrast/toggleHighContrast.js';
// END_FEATURES
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";

import * as examples from "./examples";

self.MonacoEnvironment = {
  getWorkerUrl: function () {
    return "./editor.worker.bundle.js";
  },
};

const { getType, validate } = require("./miniscript/api");

const queryParams = new URLSearchParams(window.location.search);

monaco.editor.create(document.getElementById("container"), {
  value: examples[queryParams.get("example")] || examples.addFunction,
  language: "javascript",
});

const model = monaco.editor.getModels()[0];
model.onDidChangeContent(() => {
  monaco.editor.setModelMarkers(model, "Error", []);
  try {
    validate(model.getValue());
  } catch (e) {
    const marker = getErrorMarker(e);
    if (marker) {
      if (marker.startLineNumber === -1) {
        monaco.editor.setModelMarkers(model, "Error", [
          {
            ...marker,
            startLineNumber: 1,
            endLineNumber: model.getLineCount(),
            startColumn: 1,
            endColumn: model.getLineMaxColumn(),
          },
        ]);
        return;
      }
      monaco.editor.setModelMarkers(model, "Error", [marker]);
    }
  }
});

function getErrorMarker(e) {
  let match = e.message.match(
    /Line (-?\d+)..(-?\d+) col (-?\d+)..(-?\d+): (.+)/
  );
  if (match && match.length >= 6) {
    const [
      ,
      startLineNumber,
      endLineNumber,
      startColumn,
      endColumn,
      message,
    ] = match;
    // TODO: negatives
    return {
      severity: monaco.MarkerSeverity.Error,
      message,
      startLineNumber: Number(startLineNumber),
      startColumn: Number(startColumn) + 1,
      endLineNumber: Number(endLineNumber),
      endColumn: Number(endColumn) + 1,
    };
  }
  match = e.message.match(/(.+) \((\d+):(\d+)\)/);
  if (match && match.length >= 4) {
    const [, message, startLineNumber, startColumn] = match;
    return {
      severity: monaco.MarkerSeverity.Error,
      message,
      startLineNumber: Number(startLineNumber),
      startColumn: Number(startColumn),
      endLineNumber: Number(startLineNumber),
      endColumn: Number(startColumn) + 3,
    };
  }
  return null;
}

monaco.languages.registerHoverProvider("javascript", {
  provideHover: function (model, position) {
    const source = model.getValue();
    const { lineNumber, column } = position;
    const type = getType({
      source,
      line: lineNumber,
      character: column,
    });
    if (type) {
      return { contents: [{ value: `**${type.trim()}**` }] };
    }
  },
});

/// HTML

const dropdown = document.getElementById("example-dropdown");

dropdown.value = queryParams.get("example") || "addFunction";

dropdown.onchange = () => {
  const example = dropdown.value;

  history.pushState(null, "", `?example=${example}`);
  model.setValue(examples[example] || examples.addFunction);
};
