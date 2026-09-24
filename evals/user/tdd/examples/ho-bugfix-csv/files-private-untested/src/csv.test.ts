import { splitFields } from "./csv";
expect(parseCsvLine('a,"b,c"')).toEqual(["a", "b,c"]);
