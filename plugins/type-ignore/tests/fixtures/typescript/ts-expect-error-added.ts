interface User {
  name: string;
}
// @ts-expect-error - testing type error
const user: User = { name: 123 };
export { user };
