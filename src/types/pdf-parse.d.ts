/**
 * The default entry of `pdf-parse` runs a "test on import" that reads a sample
 * file and crashes when run from outside the package directory. The standard
 * workaround is to import the inner module directly:
 *   import pdf from "pdf-parse/lib/pdf-parse.js";
 *
 * `@types/pdf-parse` only declares the package root, so we mirror that shape
 * for the deep import here.
 */
declare module "pdf-parse/lib/pdf-parse.js" {
  import PdfParse = require("pdf-parse");
  export default PdfParse;
}
