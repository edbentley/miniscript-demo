export const addFunction = `const addOne = x => x + 1;
// A simple function which infers the type of x as Number

const result = addOne(41);
// Try changing the argument type
`;

export const booleanFunction = `const boolToBinary = x => x ? 1 : 0;

// Conditionals do not cooerce the type or check for truthiness.
// So x is inferred as type Boolean.

const result = boolToBinary(true);
// Try passing in a different type
`;

export const idFunction = `const id = x => x;
// Here is a simple function which returns what you pass in.
// Its type is inferred as a generic type parameter a.

const myString = id("hello world");
// So passing in a string returns a String type.
// Guess what happens if you pass in a different type.
`;

export const functionAnnotations = `// getTrue :: () -> Boolean
const getTrue = () => true;

// id<z> :: z -> z
const id = x => x;

// getY<r, s> :: { ...r, y: s } -> s
const getY = record => record.y;

// If you want to write out the types, you can.
// So long as it is consistent with the inferred types.
// Try changing the return value of getTrue.
`;

export const records = `const myRecord = { y: [1, 2, 3] };
// Records can be defined

const extendedRecord = { ...myRecord, z: 6 };
// And extended

const add1ToY = x => x.y + 1;
// Records as function arguments have their type inferred.
// { ...a, y: Number } means this function can accept records with other fields,
// where a is a generic type

const result1 = add1ToY({ y: 5 });
// This works

const result2 = add1ToY({ y: 5, z: "Hello" });
// This is fine too

const myFunc = x => {
  const unused = x.y + 1;
  return x;
};
// It also means functions like this, which only know about a y field...

const result3 = myFunc({ y: 1, p: 5 });
// Will preserve the p field in the type of result3, which myFunc knew nothing about.
// This is also known as duck typing.

// No type annotations necessary
`;

export const stringRecords = `const startsWithHello = str => str.startsWith("Hello");
// Here the function takes a record with a startsWith field

const result = startsWithHello("Hey");
// So this works since String is a record

const result2 = startsWithHello({ startsWith: _ => false });
// And any records with a startsWith field work too
`;

export const typeVars = `/*
type Num = Number;

type Foo<x, y> = y -> x;
type Bar<a> = a -> Foo<a, Number>;
type Concrete = Bar<String>;
*/

// addOne :: Num -> Num
const addOne = x => x + 1;

// Type variables are defined at the top of the file in a comment block
`;
