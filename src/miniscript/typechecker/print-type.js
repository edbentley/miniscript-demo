/**
 * Returns a tuple of type and (optional) array of generic type names
 */
const printType = ({
  type,
  isFirstFieldInRecord = false,
  hideTypeVar = false,
}) => {
  switch (type.tag) {
    case "TypeApp": {
      const t1Str = printType({ type: type.t1 })[0];
      let t2Str = printType({ type: type.t2 })[0];
      if (type.t2.tag === "TypeArrow") {
        t2Str = [`(${t2Str})`];
      }
      if (t1Str === "Array") {
        return [`${t2Str}[]`];
      }
      return [`${t1Str}<${t2Str}>`];
    }

    case "TypeArrow": {
      let argType = printType({ type: type.argType })[0];
      if (type.argType.tag === "TypeArrow") {
        argType = `(${argType})`;
      }
      return [`${argType} -> ${printType({ type: type.returnType })[0]}`];
    }

    case "TypeAbs": {
      const [bodyType, generics = []] = printType({
        type: type.type,
        hideTypeVar,
      });
      return [bodyType, [type.name, ...generics]];
    }

    case "TypeVar": {
      return [
        hideTypeVar ? "" : isFirstFieldInRecord ? `...${type.name}` : type.name,
      ];
    }

    case "TypeRecord": {
      if (type.name) {
        return [type.name];
      }
      const [rows] = printType({ type: type.row, isFirstFieldInRecord: true });
      return [rows === "" ? "{}" : `{ ${rows} }`];
    }

    case "TypeRecordRowExtend": {
      const [rowType, generics] = printType({ type: type.extensionRow });
      const fieldTypeStr = `${type.key}${
        generics ? `<${generics.join(", ")}>` : ""
      }: ${rowType}`;
      const [baseRowType] = printType({
        type: type.baseRow,
        isFirstFieldInRecord,
        hideTypeVar,
      });
      if (baseRowType === "") {
        return [fieldTypeStr];
      }
      return [`${baseRowType}, ${fieldTypeStr}`];
    }

    case "TypeRecordRowEmpty": {
      return [""];
    }

    default:
      throw Error(`Compiler error: unknown type ${type.tag}`);
  }
};

module.exports = {
  printType,
};
