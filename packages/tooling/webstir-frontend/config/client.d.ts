// What the build lets page code import besides modules: stylesheets, whose CSS modules give
// their class names.

declare module '*.module.css' {
  const classes: Record<string, string>;
  export default classes;
}

declare module '*.css' {
  const css: string;
  export default css;
}
