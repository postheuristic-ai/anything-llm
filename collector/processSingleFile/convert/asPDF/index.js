const { v4 } = require("uuid");
const {
  createdDate,
  trashFile,
  writeToServerDocuments,
} = require("../../../utils/files");
const { tokenizeString } = require("../../../utils/tokenizer");
const { default: slugify } = require("slugify");
const PDFLoader = require("./PDFLoader");
const OCRLoader = require("../../../utils/OCRLoader");

async function asPdf({
  fullFilePath = "",
  filename = "",
  options = {},
  metadata = {},
}) {
  const pdfLoader = new PDFLoader(fullFilePath, {
    splitPages: true,
  });

  console.log(`-- Working ${filename} --`);
  const pageContent = [];
  let docs = await pdfLoader.load();

  // Character threshold per page to determine if OCR is needed
  // Pages with fewer characters than this are likely scanned/image-based
  const OCR_THRESHOLD = options?.ocr?.threshold || 50;

  if (docs.length === 0) {
    console.log(
      `[asPDF] No text content found for ${filename}. Will attempt OCR parse.`
    );
    docs = await new OCRLoader({
      targetLanguages: options?.ocr?.langList,
    }).ocrPDF(fullFilePath);
  } else {
    // Check for pages with insufficient text content (potential scanned pages in mixed PDFs)
    const lowContentPages = [];
    const pageMap = new Map();

    for (const doc of docs) {
      const pageNum = doc.metadata?.loc?.pageNumber;
      if (pageNum) {
        pageMap.set(pageNum, doc);
        const textLength = (doc.pageContent || "").trim().length;
        if (textLength < OCR_THRESHOLD) {
          lowContentPages.push(pageNum);
        }
      }
    }

    // If we have pages with low content, OCR those specific pages
    if (lowContentPages.length > 0) {
      console.log(
        `[asPDF] Found ${lowContentPages.length} page(s) with minimal text (< ${OCR_THRESHOLD} chars). Attempting OCR on pages: ${lowContentPages.join(", ")}`
      );

      try {
        // OCR the entire document to get all pages
        const ocrDocs = await new OCRLoader({
          targetLanguages: options?.ocr?.langList,
        }).ocrPDF(fullFilePath);

        // Replace low-content pages with their OCR results
        for (const ocrDoc of ocrDocs) {
          const pageNum = ocrDoc.metadata?.loc?.pageNumber;
          if (pageNum && lowContentPages.includes(pageNum)) {
            const ocrTextLength = (ocrDoc.pageContent || "").trim().length;
            const originalTextLength = (pageMap.get(pageNum)?.pageContent || "").trim().length;

            // Only replace if OCR found more content
            if (ocrTextLength > originalTextLength) {
              console.log(
                `-- Replacing pg ${pageNum} content with OCR result (${originalTextLength} -> ${ocrTextLength} chars) --`
              );
              pageMap.set(pageNum, ocrDoc);
            }
          }
        }

        // Rebuild docs array with OCR-enhanced pages
        docs = Array.from(pageMap.values()).sort(
          (a, b) => a.metadata.loc.pageNumber - b.metadata.loc.pageNumber
        );
      } catch (error) {
        console.error(
          `[asPDF] OCR fallback failed for low-content pages: ${error.message}`
        );
        // Continue with original docs if OCR fails
      }
    }
  }

  for (const doc of docs) {
    console.log(
      `-- Parsing content from pg ${
        doc.metadata?.loc?.pageNumber || "unknown"
      } --`
    );
    if (!doc.pageContent || !doc.pageContent.length) continue;
    pageContent.push(doc.pageContent);
  }

  if (!pageContent.length) {
    console.error(`[asPDF] Resulting text content was empty for ${filename}.`);
    trashFile(fullFilePath);
    return {
      success: false,
      reason: `No text content found in ${filename}.`,
      documents: [],
    };
  }

  const content = pageContent.join("");
  const data = {
    id: v4(),
    url: "file://" + fullFilePath,
    title: metadata.title || filename,
    docAuthor:
      metadata.docAuthor ||
      docs[0]?.metadata?.pdf?.info?.Creator ||
      "no author found",
    description:
      metadata.description ||
      docs[0]?.metadata?.pdf?.info?.Title ||
      "No description found.",
    docSource: metadata.docSource || "pdf file uploaded by the user.",
    chunkSource: metadata.chunkSource || "",
    published: createdDate(fullFilePath),
    wordCount: content.split(" ").length,
    pageContent: content,
    token_count_estimate: tokenizeString(content),
  };

  const document = writeToServerDocuments({
    data,
    filename: `${slugify(filename)}-${data.id}`,
    options: { parseOnly: options.parseOnly },
  });
  trashFile(fullFilePath);
  console.log(`[SUCCESS]: ${filename} converted & ready for embedding.\n`);
  return { success: true, reason: null, documents: [document] };
}

module.exports = asPdf;
