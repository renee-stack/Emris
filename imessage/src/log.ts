const oneLine = (s: string) => s.replace(/\n/g, "\\n");
export const logIn = (who: string, text: string) =>
  console.log(`${new Date().toISOString()} IN  ${who}: ${oneLine(text)}`);
export const logOut = (who: string, text: string) =>
  console.log(`${new Date().toISOString()} OUT ${who}: ${oneLine(text)}`);
