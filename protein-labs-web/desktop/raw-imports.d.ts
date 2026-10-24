// Vite inlines `?raw` imports as strings (the user manual's Markdown).
declare module "*.md?raw" {
  const source: string;
  export default source;
}
