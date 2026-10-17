// Route of the user guide (KRB-199) and of its PDF, without the locale
// prefix. Kept apart from the text: the proxy, the menus and the
// footers import only these paths.

/** The guide page, public: /fr/guide. */
export const GUIDE_PATH = "/guide";

/** Folder of public/ that holds the screenshots and the PDF. */
export const GUIDE_ASSETS_DIR = "guide";

/** The PDF made from the page by scripts/guide-pdf.mjs, served as a static file. */
export const GUIDE_PDF_PATH = `/${GUIDE_ASSETS_DIR}/guide-kolabreport.pdf`;
